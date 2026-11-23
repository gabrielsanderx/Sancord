import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as requestHttp } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const binaries = resolve(process.env.SANCORD_AUTH_QA_BIN_DIR || 'target-dev/debug');
const screenshots = resolve(process.env.SANCORD_AUTH_QA_SCREENSHOTS || 'qa-auth');
const data = await mkdtemp(join(tmpdir(), 'sancord-auth-'));
const children = [];
const connections = [];
const account = 'LumeLoginQA';
const password = 'qa-' + randomUUID();
const newPassword = 'qa-' + randomUUID();

async function port() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port: number } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return number;
}

async function until(label, condition, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    if (await condition()) return;
    await delay(100);
  } while (Date.now() < deadline);
  throw Error(`QA: tempo esgotado em ${label}`);
}

async function launch(name, args, vars) {
  const child = spawn(join(binaries, name), args, { stdio: 'ignore', windowsHide: true, env: { ...process.env, ...vars } });
  children.push(child);
  await once(child, 'spawn');
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

const bind = '127.0.0.1:' + await port();
const endpoint = 'http://' + bind;

async function startBackend({ maintenance = false } = {}) {
  const backend = await launch('sancord.exe', [], {
    SANCORD_BIND: bind, SANCORD_DATA_DIR: join(data, 'backend'), SANCORD_LOG_DIR: join(data, 'logs'), SANCORD_DISCOVERY: '0',
    SANCORD_MAINTENANCE_MODE: maintenance ? '1' : '0',
  });
  await until('backend isolado', async () => (await fetch(endpoint + '/api/health').catch(() => null))?.ok);
  return backend;
}

function post(path, value) {
  return fetch(endpoint + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(10000),
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  connections.push(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(Error('WebSocket de QA indisponível')), { once: true });
  });
  return socket;
}

async function backendEvent(token, sendType, sendPayload, expectType) {
  const socket = await connect(endpoint.replace('http:', 'ws:') + '/ws');
  let timer;
  try {
    const send = (type, payload) => socket.send(JSON.stringify({ type, payload }));
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`Sem resposta para ${expectType} no backend de QA`)), 10000);
      socket.addEventListener('message', ({ data }) => {
        const { type, payload } = JSON.parse(data);
        if (type === 'Welcome') send(sendType, sendPayload);
        if (type === expectType) resolve(payload);
        if (type === 'SendFailed') reject(Error(payload.message));
      });
      send('JoinServer', { token });
    });
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}

async function startDesktop(invite, { targetEndpoint = endpoint, virtualMedia = false } = {}) {
  const debug = 'http://127.0.0.1:' + await port();
  const args = invite ? ['sancord://open/?' + new URLSearchParams({ endpoint: targetEndpoint, invite })] : [];
  const child = await launch('SancordApp.exe', args, {
    SANCORD_DESKTOP_DATA_DIR: join(data, 'desktop'), SANCORD_SERVER_URL: targetEndpoint,
    SANCORD_DISABLE_UPDATES: '1', SANCORD_REGISTER_PROTOCOL: '0', SANCORD_DISABLE_LOCAL_HOST: '1',
    SANCORD_WINDOW_TITLE: 'Sancord · QA autenticação',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + new URL(debug).port +
      (virtualMedia ? ' --use-fake-device-for-media-stream --use-fake-ui-for-media-stream' : ''),
  });
  let target;
  await until('WebView2', async () => {
    try {
      const list = await (await fetch(debug + '/json/list')).json();
      target = list.find(item => item.type === 'page' && item.url.includes('sancord.localhost'));
      return target;
    } catch { return false; }
  });
  const socket = await connect(target.webSocketDebuggerUrl);
  const replies = new Map();
  let sequence = 0;
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    replies.get(response.id)?.(response);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { replies.delete(id); reject(Error(`CDP sem resposta para ${method}`)); }, 16000);
    replies.set(id, response => {
      clearTimeout(timer);
      replies.delete(id);
      if (response.error) reject(Error(response.error.message));
      else resolve(response.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Erro ao avaliar a interface');
    return result.result.value;
  };
  await until('interface embutida', () => evaluate(`document.readyState === 'complete' && typeof tryAutoLogin === 'function'`));
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function close() {
    const exited = once(child, 'exit');
    await Promise.race([evaluate(`window.ipc.postMessage('close')`).catch(() => {}), exited]);
    if (!await Promise.race([exited.then(() => true), delay(2500, false)])) await stop(child);
    socket.close();
  }
  return { evaluate, call, close };
}

const readLogin = `!document.getElementById('login-modal').classList.contains('hidden')`;
const activeAccount = name => `state.selfUser?.username === ${JSON.stringify(name)} &&
  document.getElementById('login-modal').classList.contains('hidden') && !document.body.hasAttribute('data-auth-pending')`;

async function fill(desktop, fields, submit = true) {
  await desktop.evaluate(`(() => {
    for (const [id, v] of Object.entries(${JSON.stringify(fields)})) document.getElementById(id).value = v;
    if (${submit}) document.getElementById('login-form').requestSubmit();
  })()`);
}

async function click(desktop, id) {
  await desktop.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
}

async function capture(desktop, name) {
  await delay(180);
  const { data } = await desktop.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(screenshots, name + '.png'), Buffer.from(data, 'base64'));
}

async function metrics(desktop, width, height, scale = 1) {
  await desktop.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await desktop.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const measured = await desktop.evaluate(`(() => {
    const area = document.getElementById('login-modal');
    const card = area.querySelector('.auth-card').getBoundingClientRect();
    const windowRect = area.getBoundingClientRect();
    return { width: Math.round(card.width), horizontal: Math.abs(card.left + card.width / 2 - innerWidth / 2),
      vertical: Math.abs(card.top + card.height / 2 - (windowRect.top + windowRect.height / 2)),
      clipping: area.scrollHeight > area.clientHeight };
  })()`);
  assert.ok(measured.width >= 420 && measured.width <= 500, 'largura do card');
  assert.ok(measured.horizontal < 2 && measured.vertical < 2 && !measured.clipping,
    `centralização em ${width}×${height} / ${scale}: ${JSON.stringify(measured)}`);
}

async function proxyForReconnectQA() {
  const tunnels = new Set();
  const peers = new Set();
  let blocked = false, wsBlocked = false, dropResponses = false, holdUpload = false;
  const proxy = createHttpServer((incoming, response) => {
    if (blocked) { incoming.socket.destroy(); return; }
    if (holdUpload && incoming.method === 'POST' && incoming.url.startsWith('/api/attachments?')) return;
    const upstream = requestHttp(endpoint + incoming.url, { method: incoming.method, headers: incoming.headers }, reply => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    });
    upstream.on('error', () => response.destroy());
    response.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  proxy.on('connection', socket => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => peers.delete(socket));
  });
  proxy.on('upgrade', (request, socket, head) => {
    if (blocked || wsBlocked) { socket.destroy(); return; }
    const upstream = createConnection({ host: '127.0.0.1', port: Number(new URL(endpoint).port) });
    tunnels.add(socket);
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => { tunnels.delete(socket); upstream.destroy(); });
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(request.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream);
    upstream.on('data', chunk => { if (!dropResponses) socket.write(chunk); });
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  return {
    origin: `http://127.0.0.1:${proxy.address().port}`,
    blockAll(value) { blocked = value; if (value) for (const socket of peers) socket.destroy(); },
    cutRealtime() { wsBlocked = true; for (const socket of tunnels) socket.destroy(); },
    restoreRealtime() { dropResponses = wsBlocked = false; },
    silence() { dropResponses = true; },
    holdUpload(value) { holdUpload = value; },
    close() { for (const socket of peers) socket.destroy(); proxy.close(); },
  };
}

async function runReconnectQA() {
  let backend = await startBackend();
  const ownerResponse = await post('/api/register', { username: 'NorteLoginQA', password });
  assert.ok(ownerResponse.ok);
  const { token: ownerToken } = await ownerResponse.json();
  const created = await backendEvent(ownerToken, 'CreateServer', { name: 'Estação Reconexão QA', template: 'friends' }, 'ServerCreated');
  const [channel, otherChannel] = created.server.text_channels.map(item => item.id);
  const voice = created.server.voice_channels[0].id;
  const destination = JSON.stringify(channel);
  const toChannel = id => `switchToServerId(${JSON.stringify(created.server.id)}, ${JSON.stringify(id)})`;
  const sendChat = async (content) => (await backendEvent(ownerToken, 'SendChat', { channel_id: channel, content }, 'NewChatMessage')).message;
  const [reply, edited, deleted] = [await sendChat('Referência para responder'), await sendChat('Antes da edição'), await sendChat('Será apagada')];
  const proxy = await proxyForReconnectQA();
  const options = { targetEndpoint: proxy.origin, virtualMedia: true };
  const stats = [];
  let desktop;
  const check = expression => desktop.evaluate(expression);
  const phase = name => `SancordConnection.status().phase === '${name}'`;
  const messages = `state.chatHistory[${destination}]`;
  const cached = text => `${messages}?.some(m => m.content === ${JSON.stringify(text)})`;
  const submit = text => check(`chatInput.value = ${JSON.stringify(text)}; submitComposer()`);
  try {
    proxy.blockAll(true);
    desktop = await startDesktop(created.server.invite_code, options);
    await until('startup offline sem dados', () => check(`!document.getElementById('offline-screen').classList.contains('hidden') && (${phase('DEGRADED')} || ${phase('OFFLINE')})`)).catch(async error => {
      const diagnostic = await check(`({ connection: typeof SancordConnection === 'undefined' ? null : SancordConnection.status(),
        offline: document.getElementById('offline-screen')?.className, login: document.getElementById('login-modal')?.className,
        secure: SancordNet.secureForAuth, dpapi: Boolean(window.__SANCORD_AUTH_DPAPI), pending: document.body.hasAttribute('data-auth-pending') })`);
      throw Error(`${error.message} ${JSON.stringify(diagnostic)}`);
    });
    await capture(desktop, '01-abertura-sem-servidor');
    proxy.blockAll(false);
    await until('login aparece sozinho', () => check(`${readLogin} && document.getElementById('offline-screen').classList.contains('hidden')`));
    await click(desktop, 'tab-register');
    await fill(desktop, { 'username-input': account, 'password-input': password });
    await until('cadastro e prévia do convite', () => check(`${activeAccount(account)} && document.getElementById('invite-preview-name').textContent === 'Estação Reconexão QA'`));
    await click(desktop, 'invite-preview-join-btn');
    await until('sala real', () => check(`${cached('Referência para responder')} && ${phase('CONNECTED')}`));
    await check(toChannel(channel));
    await check(`joinVoiceChannel(${JSON.stringify(voice)})`);
    await until('voz confirmada', () => check(`state.selfUser.voice_channel_id === ${JSON.stringify(voice)}`));
    await check(`toggleCamera()`);
    await until('câmera virtual', () => check(`state.localCameraStream?.getVideoTracks().length === 1`));
    await check(`(async () => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d'); ctx.fillRect(0, 0, 32, 32);
      await publishScreenStream(canvas.captureStream(1), getSelectedQualityProfile());
      globalThis.qaVideoTracks = [...state.localScreenStream.getVideoTracks(), ...state.localCameraStream.getVideoTracks()]; })()`);
    proxy.holdUpload(true);
    await check(`addComposerFiles([new File(['arquivo interrompido'], 'interromper.txt')]); uploadComposerFile(state.composerFiles[0])`);
    await until('upload sem resposta', () => check(`state.composerFiles[0]?.status === 'uploading'`));
    await check(`${toChannel(otherChannel)}; chatInput.value = 'Rascunho no segundo canal';`);
    proxy.silence();
    await submit('Gravada antes de perder a confirmação');
    const { DatabaseSync } = await import('node:sqlite');
    const persisted = content => {
      const db = new DatabaseSync(join(data, 'backend', 'sancord.db'), { readOnly: true });
      try { return db.prepare('SELECT count(*) AS n FROM messages WHERE content = ?').get(content).n; }
      finally { db.close(); }
    };
    await until('envio confirmado no SQLite, resposta retida no proxy', () => persisted('Gravada antes de perder a confirmação') === 1);
    assert.ok(await check(`document.querySelector('[data-send-state="sending"]')`));
    proxy.cutRealtime();
    await until('WebSocket cai com HTTP saudável', () => check(`SancordConnection.status().reason === 'realtime' && ${phase('DEGRADED')}`));
    await check(toChannel(channel));
    assert.ok(await check(`${cached('Referência para responder')} && ${cached('Será apagada')}`));
    assert.ok(await check(`state.composerFiles[0]?.error === 'Upload interrompido' && qaVideoTracks.every(track => track.readyState === 'ended') && Boolean(state.voiceRecovery)`));
    await capture(desktop, '02-conversa-e-voz-durante-queda');
    await check(`removeComposerFile(state.composerFiles[0]); setReplyingTo(${messages}.find(m => m.id === ${JSON.stringify(reply.id)}));`);
    await submit('Resposta enfileirada sem WebSocket');
    assert.match(await check(`document.getElementById('pending-chat-messages').textContent`), /Aguardando conexão/);
    await capture(desktop, '03-resposta-pendente');
    await check(`sendWs('ToggleReaction', { channel_id: ${destination}, message_id: ${JSON.stringify(reply.id)}, emoji: '👍' })`);
    assert.equal(await check(`${messages}.find(m => m.id === ${JSON.stringify(reply.id)}).reactions['👍']`), undefined);
    await backendEvent(ownerToken, 'EditChat', { channel_id: channel, message_id: edited.id, content: 'Editada durante a queda' }, 'MessageUpdated');
    await backendEvent(ownerToken, 'DeleteChat', { channel_id: channel, message_id: deleted.id }, 'MessageDeleted');
    await backendEvent(ownerToken, 'ToggleReaction', { channel_id: channel, message_id: reply.id, emoji: '👍' }, 'MessageUpdated');
    await sendChat('Chegou durante a queda');
    proxy.holdUpload(false);
    proxy.restoreRealtime();
    await until('ressincronização e envio apenas uma vez depois da reconexão', () => check(`${phase('CONNECTED')} && ${cached('Chegou durante a queda')}
      && ${cached('Editada durante a queda')} && !(${cached('Será apagada')}) && ${messages}.find(m => m.id === ${JSON.stringify(reply.id)})?.reactions?.['👍']?.length === 1
      && document.getElementById('pending-chat-messages').children.length === 0 && ${messages}.some(m => m.content === 'Resposta enfileirada sem WebSocket' && m.reply_to?.id === ${JSON.stringify(reply.id)})`));
    assert.equal(persisted('Gravada antes de perder a confirmação'), 1);
    assert.equal(persisted('Resposta enfileirada sem WebSocket'), 1);
    assert.equal(await check(`chatInput.value`), '');
    await until('voz recuperada sem mídia visual', () => check(`state.selfUser.voice_channel_id === ${JSON.stringify(voice)} && !state.voiceRecovery && !state.localCameraStream && !state.localScreenStream`));
    await capture(desktop, '04-voz-restabelecida');
    stats.push('queda apenas de WebSocket, resposta enfileirada, confirmação perdida, resync e retorno de voz');

    await check(`sendChatPayload({channel_id: ${destination}, content: 'falha controlada', attachment_ids: ['ausente']})`);
    await until('recusa preserva mensagem', () => check(`Boolean(document.querySelector('[data-send-state="failed"]'))`));
    assert.match(await check(`document.querySelector('[data-send-state="failed"]').textContent`), /Tentar novamente/);
    await check(`document.querySelector('[data-send-state="failed"] button:last-child').click(); leaveVoiceChannel({silent:true})`);
    const token = await check('getStoredToken()');
    await until('cache gravado com DPAPI', () => check(`Boolean(localStorage.getItem(SancordNet.sessionKey('sancord_offline_snapshot') + ':dpapi')) && !localStorage.getItem(SancordNet.sessionKey('sancord_offline_snapshot'))`));
    await delay(850);
    await stop(backend);
    await until('backend indisponível com dispositivo online', () => check(`SancordConnection.status().reason === 'server'`));
    await desktop.close();
    desktop = await startDesktop(undefined, options);
    await until('reabertura offline com sessão e cache protegidos', () => check(`${activeAccount(account)} && ${cached('Resposta enfileirada sem WebSocket')} && SancordConnection.status().reason === 'server'`));
    await capture(desktop, '05-reabertura-com-cache');
    backend = await startBackend({ maintenance: true });
    await until('manutenção informada pelo HTTP', () => check(`SancordConnection.status().reason === 'maintenance'`), 25000);
    await stop(backend);
    backend = await startBackend();
    await until('volta automática após manutenção', () => check(phase('CONNECTED')), 35000);
    stats.push('backend interrompido, reabertura offline, cache DPAPI, manutenção e retorno automático');

    const previousSocket = await check('state.selfUser.id');
    proxy.silence();
    await until('heartbeat detecta conexão silenciosa', () => check(`!(${phase('CONNECTED')})`), 38000);
    proxy.restoreRealtime();
    await until('novo WebSocket após heartbeat', () => check(`${phase('CONNECTED')} && state.selfUser.id !== ${JSON.stringify(previousSocket)}`));
    await post('/api/logout', { token });
    proxy.cutRealtime();
    await until('queda antes de tentar sessão revogada', () => check(`!(${phase('CONNECTED')})`));
    proxy.restoreRealtime();
    await until('sessão expirada para reconexão e mostra login', () => check(`${phase('AUTH_EXPIRED')} && ${readLogin} && !getStoredToken()`));
    stats.push('heartbeat com socket aberto e sem respostas, sessão revogada');
    console.log(stats.join('\n'));
    await desktop.close();
  } finally {
    proxy.close();
  }
}

async function runFirstAccessChatQA() {
  const { DatabaseSync } = await import('node:sqlite');
  let backend = await startBackend();
  const ownerResponse = await post('/api/register', { username: 'NorteLoginQA', password });
  assert.ok(ownerResponse.ok);
  const owner = await ownerResponse.json();
  const created = await backendEvent(owner.token, 'CreateServer', { name: 'Estação QA', template: 'friends' }, 'ServerCreated');
  const [channel, otherChannel] = created.server.text_channels.map(ch => ch.id);
  const upload = await fetch(endpoint + '/api/attachments?filename=historico.txt', {
    method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/octet-stream' }, body: 'Arquivo do histórico de QA',
  });
  assert.ok(upload.ok);
  const { attachment } = await upload.json();
  const sample = await backendEvent(owner.token, 'SendChat', { channel_id: channel, content: 'Mensagem de referência' }, 'NewChatMessage');
  await stop(backend);
  const db = new DatabaseSync(join(data, 'backend', 'sancord.db'));
  const insert = db.prepare('INSERT INTO messages (id, channel_id, author_id, author_name, content, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < 400; i++) {
    const m = { ...sample.message, id: randomUUID(), content: i === 5 ? 'Salto antigo de QA' : `Histórico QA ${i}`,
      created_at: Date.now() - (400 - i) * 60000, attachments: i % 10 === 0 ? [attachment] : [] };
    insert.run(m.id, channel, m.author_id, m.author_name, m.content, m.created_at, JSON.stringify(m));
  }
  db.exec('COMMIT');
  db.close();
  backend = await startBackend();

  const desktop = await startDesktop();
  const evaluate = desktop.evaluate;
  const visible = id => `!document.getElementById('${id}').classList.contains('hidden')`;
  await click(desktop, 'tab-register');
  await fill(desktop, { 'username-input': account, 'password-input': password });
  await until('primeiro acesso sem servidores', () => evaluate(`${activeAccount(account)} && ${visible('home-first-steps')}`));
  for (const [width, height, scale, theme] of [[1366, 768, 1, 'dark'], [940, 600, 1.5, 'light']]) {
    await desktop.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await evaluate(`document.body.dataset.theme = '${theme}'`);
    assert.ok(await evaluate(`(() => { const card = document.getElementById('home-first-steps'); const bounds = card.getBoundingClientRect();
      return bounds.width > 0 && [...card.querySelectorAll('button')].every(b => b.getBoundingClientRect().right < bounds.right); })()`));
    await capture(desktop, 'primeiro-acesso-' + theme);
  }
  await click(desktop, 'open-settings-btn');
  const settingsSearch = `document.getElementById('settings-search-input')`;
  await evaluate(`${settingsSearch}.focus(); ${settingsSearch}.value = 'microfone'; ${settingsSearch}.dispatchEvent(new Event('input'));`);
  await desktop.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert.ok(await evaluate(`document.activeElement.classList.contains('settings-search-hit')`));
  await desktop.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.activeElement.id'), 'settings-search-input');
  await evaluate(`${settingsSearch}.value = 'sem resultado qa'; ${settingsSearch}.dispatchEvent(new Event('input'));`);
  assert.ok(await evaluate(`Boolean(document.querySelector('#settings-search-results .ui-empty'))`));
  await capture(desktop, 'configuracoes-busca-vazia');
  await click(desktop, 'close-settings-btn');
  await evaluate(`document.getElementById('first-create-server').focus()`);
  await click(desktop, 'first-create-server');
  assert.equal(await evaluate('document.activeElement.id'), 'create-srv-name-input');
  await click(desktop, 'create-srv-cancel-btn');
  assert.equal(await evaluate('document.activeElement.id'), 'first-create-server');
  await click(desktop, 'first-add-friend');
  assert.equal(await evaluate('document.activeElement.id'), 'add-friend-input');
  await evaluate(`document.getElementById('add-friend-input').value = 'NorteLoginQA'; document.getElementById('add-friend-form').requestSubmit()`);
  await until('solicitação de amizade', () => evaluate(`state.outgoingRequests.some(u => u.username === 'NorteLoginQA')`));
  await evaluate(`switchToHomeFriendsView('online')`);
  await click(desktop, 'first-join-server');
  assert.equal(await evaluate('document.activeElement.id'), 'join-srv-code-input');
  await evaluate(`document.getElementById('join-srv-code-input').value = ${JSON.stringify(created.server.invite_code)}`);
  await click(desktop, 'join-srv-submit-btn');
  await until('prévia do convite', () => evaluate(`document.getElementById('invite-preview-name').textContent === 'Estação QA'`));
  await click(desktop, 'invite-preview-join-btn');
  await until('adesão de verdade e histórico inicial', () => evaluate(`state.servers.length === 1 && state.chatHistory[${JSON.stringify(channel)}]?.length >= 50`));
  await evaluate(`switchToHomeFriendsView('online')`);
  assert.equal(await evaluate(visible('home-first-steps')), false);
  await evaluate(`switchToServerId(${JSON.stringify(created.server.id)}, ${JSON.stringify(channel)})`);
  await evaluate(`chatSearchInput.value = 'Salto antigo de QA de:NorteLoginQA'; chatSearchInput.dispatchEvent(new Event('input')); chatSearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));`);
  await until('resultado de busca', () => evaluate(`Boolean(document.querySelector('.search-hit'))`));
  await evaluate(`document.querySelector('.search-hit').click()`);
  await until('salto pelo histórico real', () => evaluate(`!chatSearchInput.value && document.querySelector('.flash-highlight')?.textContent.includes('Salto antigo de QA')`));
  await capture(desktop, 'chat-salto-no-historico');
  await evaluate(`jumpToPresent()`);
  await until('volta ao presente', () => evaluate(`!getHistoryState(getActiveTextChannelId()).loading && !getHistoryState(getActiveTextChannelId()).hasNewer`));
  for (let i = 0; i < 5; i++) {
    await evaluate(`requestOlderMessages()`);
    await until('carregar página de histórico', () => evaluate(`!getHistoryState(getActiveTextChannelId()).loading`));
  }
  const count = await evaluate(`chatMessagesEl.querySelectorAll('.message-item').length`);
  assert.equal(count, 300);
  const benchmark = await evaluate(`(() => {
    const ch = getActiveTextChannelId(), history = state.chatHistory[ch].slice();
    const next = { ...history.at(-1), id: 'qa-perf', created_at: Date.now(), content: 'Nova mensagem' };
    const samples = { full: [], edge: [] };
    for (let i = 0; i < 12; i++) {
      for (const mode of i % 2 ? ['full', 'edge'] : ['edge', 'full']) {
        state.chatHistory[ch] = history.slice();
        renderChatMessagesV2({ preserveScroll: true });
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        state.chatHistory[ch] = [...history.slice(1), next];
        const existing = chatMessagesEl.querySelector('[data-msg-id="' + history[150].id + '"]');
        const start = performance.now();
        if (mode === 'full') renderChatMessagesV2(); else appendChatMessageAtCapacity(next);
        void chatMessagesEl.offsetHeight;
        if (i >= 2) samples[mode].push(performance.now() - start);
        if (mode === 'edge' && !existing.isConnected) throw Error('A janela descartou mensagens retidas no histórico');
      }
    }
    state.chatHistory[ch] = history;
    renderChatMessagesV2();
    return Object.fromEntries(Object.entries(samples).map(([key, times]) => {
      times.sort((a, b) => a-b);
      return [key, (times[4] + times[5]) / 2];
    }));
  })()`);
  await evaluate(`globalThis.qaRetainedMessage = chatMessagesEl.querySelectorAll('.message-item')[150];`);
  await backendEvent(owner.token, 'SendChat', { channel_id: channel, content: 'Chegou em tempo real no limite' }, 'NewChatMessage');
  await until('atualização no limite via WebSocket', () => evaluate(`chatMessagesEl.lastElementChild?.textContent.includes('Chegou em tempo real no limite')`));
  assert.equal(await evaluate(`qaRetainedMessage.isConnected && chatMessagesEl.querySelectorAll('.message-item').length === 300`), true);
  const input = `document.getElementById('chat-input')`;
  await evaluate(`${input}.value = 'Rascunho durante a queda'; addComposerFiles([new File(['arquivo QA'], 'rascunho.txt')]); uploadComposerFile(state.composerFiles[0]);`);
  await until('upload do anexo do rascunho', () => evaluate(`state.composerFiles[0]?.status === 'done'`));
  await evaluate(`switchToServerId(${JSON.stringify(created.server.id)}, ${JSON.stringify(otherChannel)}); switchToServerId(${JSON.stringify(created.server.id)}, ${JSON.stringify(channel)});`);
  assert.equal(await evaluate(`${input}.value`), 'Rascunho durante a queda');
  assert.equal(await evaluate(`state.composerFiles[0]?.attachment.filename`), 'rascunho.txt');
  await stop(backend);
  await until('queda real do WebSocket', () => evaluate('state.ws?.readyState !== WebSocket.OPEN'));
  await evaluate('submitComposer()');
  assert.equal(await evaluate(`${input}.value`), '');
  assert.match(await evaluate(`document.getElementById('pending-chat-messages').textContent`), /Aguardando conexão/);
  await startBackend();
  await until('reconexão do chat', () => evaluate('state.ws?.readyState === WebSocket.OPEN && wsStatusDot.classList.contains("connected")'), 22000);
  await until('envio único com anexo após reconectar', () => evaluate(`(() => { const sent = state.chatHistory[${JSON.stringify(channel)}]?.filter(m => m.content === 'Rascunho durante a queda');
    return sent?.length === 1 && sent[0].attachments?.[0]?.filename === 'rascunho.txt'; })()`));
  console.log('Primeiro acesso, foco, amizade, convite, salto, paginação, rascunho e reconexão no executável. Medianas WebView2 (ms):', benchmark);
  await desktop.close();
}

async function runAuthQA() {
  let backend = await startBackend();
  const ownerResponse = await post('/api/register', { username: 'NorteLoginQA', password });
  assert.ok(ownerResponse.ok);
  const { token: ownerToken } = await ownerResponse.json();
  const created = await backendEvent(ownerToken, 'CreateServer', { name: 'Estação QA', template: 'friends' }, 'ServerCreated');
  let desktop = await startDesktop(created.server.invite_code);
  await until('entrada inicial', () => desktop.evaluate(readLogin));
  assert.equal(await desktop.evaluate(`document.activeElement.id`), 'username-input');
  assert.equal(await desktop.evaluate(`getComputedStyle(document.getElementById('app-layout')).visibility`), 'hidden');
  assert.equal(await desktop.evaluate('Boolean(window.__SANCORD_AUTH_DPAPI)'), true);
  for (const [width, height] of [[1366, 768], [1600, 900], [1920, 1080], [2560, 1440]]) await metrics(desktop, width, height);
  for (const scale of [1, 1.25, 1.5]) await metrics(desktop, Math.round(1366 / scale), Math.round(768 / scale), scale);
  await metrics(desktop, 1366, 768);
  await capture(desktop, '01-login');

  await stop(backend);
  await fill(desktop, { 'username-input': account, 'password-input': password });
  await until('aviso de conexão', () => desktop.evaluate(`!document.getElementById('auth-retry-btn').classList.contains('hidden')`));
  await capture(desktop, '02-rede-indisponivel');
  backend = await startBackend();
  await click(desktop, 'auth-retry-btn');
  const invalidLogin = `document.getElementById('auth-password-error').textContent === 'Nome de usuário ou senha incorretos.'`;
  await until('usuário inexistente', () => desktop.evaluate(invalidLogin));

  await click(desktop, 'tab-register');
  await capture(desktop, '03-criar-conta');
  await fill(desktop, { 'username-input': 'NorteLoginQA', 'password-input': password });
  await until('conta já cadastrada', () => desktop.evaluate(`document.getElementById('auth-username-error').textContent.includes('em uso')`));
  await fill(desktop, { 'username-input': account, 'password-input': password }, false);
  await desktop.evaluate(`document.getElementById('password-input').focus()`);
  await desktop.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await desktop.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until('cadastro, sessão e convite retomado', () => desktop.evaluate(`${activeAccount(account)} &&
    document.getElementById('invite-preview-name').textContent === 'Estação QA'`));
  assert.equal(await desktop.evaluate(`Boolean(localStorage.getItem(SancordNet.sessionKey('sancord_token') + ':dpapi')) &&
    !localStorage.getItem(SancordNet.sessionKey('sancord_token')) && !localStorage.getItem(SancordNet.sessionKey('sancord_accounts')) &&
    !document.getElementById('password-input').value`), true);
  await capture(desktop, '04-convite-retomado');
  await click(desktop, 'invite-preview-join-btn');
  await until('adesão pelo convite', () => desktop.evaluate(`state.servers.some(server => server.name === 'Estação QA')`));
  await desktop.close();

  desktop = await startDesktop();
  await until('sessão restaurada após reiniciar o exe', () => desktop.evaluate(activeAccount(account)));
  const priorToken = await desktop.evaluate('getStoredToken()');
  const { recovery_code: code } = await backendEvent(priorToken, 'GenerateRecoveryCode', { current_password: password }, 'RecoveryCodeGenerated');
  await click(desktop, 'settings-logout-btn');
  await until('logout e invalidação da sessão', async () => (
    await desktop.evaluate(readLogin) && (await post('/api/session', { token: priorToken })).status === 401
  ));
  await fill(desktop, { 'username-input': account, 'password-input': 'qa-credencial-incorreta' });
  await until('senha incorreta', () => desktop.evaluate(invalidLogin));
  await capture(desktop, '05-erro-de-credenciais');

  await click(desktop, 'open-recover-password-btn');
  await capture(desktop, '06-recuperar-senha');
  await fill(desktop, {
    'auth-code-input': code, 'password-input': newPassword, 'auth-confirm-input': newPassword,
  });
  await until('recuperação com login', () => desktop.evaluate(activeAccount(account)));
  assert.equal((await post('/api/recover-password', { username: account, recovery_code: code, new_password: password })).status, 401);
  assert.equal((await post('/api/login', { username: account, password })).status, 401);
  await click(desktop, 'settings-logout-btn');
  await until('tela após logout', () => desktop.evaluate(readLogin));
  await desktop.evaluate(`document.getElementById('remember-me-input').checked = false`);
  await fill(desktop, { 'username-input': account, 'password-input': newPassword });
  await until('sessão temporária', () => desktop.evaluate(activeAccount(account)));
  assert.equal(await desktop.evaluate(`Boolean(sessionStorage.getItem(SancordNet.sessionKey('sancord_token') + ':dpapi')) &&
    !localStorage.getItem(SancordNet.sessionKey('sancord_token') + ':dpapi')`), true);
  await desktop.close();
  desktop = await startDesktop();
  await until('sessão temporária indisponível após fechar', () => desktop.evaluate(readLogin));

  // Carrega o formato que uma versão desktop anterior gravava no perfil descartável.
  await desktop.evaluate(`(() => {
    const entry = { username: 'NorteLoginQA', token: ${JSON.stringify(ownerToken)} };
    localStorage.setItem(SancordNet.sessionKey('sancord_token'), entry.token);
    localStorage.setItem(SancordNet.sessionKey('sancord_username'), entry.username);
    localStorage.setItem(SancordNet.sessionKey('sancord_accounts'), JSON.stringify([entry]));
  })()`);
  await desktop.close();
  desktop = await startDesktop();
  await until('sessão legada migrada', () => desktop.evaluate(activeAccount('NorteLoginQA')));
  assert.equal(await desktop.evaluate(`['sancord_token', 'sancord_username', 'sancord_accounts'].every(name => {
    const key = SancordNet.sessionKey(name);
    return !localStorage.getItem(key) && Boolean(localStorage.getItem(key + ':dpapi'));
  })`), true);
  await desktop.evaluate('SancordSelfProfileMenu.beginAddAccountFlow()');
  await until('seletor de conta salva', () => desktop.evaluate(`!document.getElementById('auth-saved-accounts').classList.contains('hidden')`));
  await desktop.evaluate(`document.querySelector('#auth-account-list button').click()`);
  await until('entrar com conta salva', () => desktop.evaluate(activeAccount('NorteLoginQA')));
  console.log('Login, cadastro, convite, rede, DPAPI, migração de sessão, conta salva, logout e recuperação de uso único validados.');
}

try {
  await mkdir(screenshots, { recursive: true });
  if (process.argv.includes('--reconnect')) await runReconnectQA();
  else if (process.argv.includes('--first-access-chat')) await runFirstAccessChatQA();
  else await runAuthQA();
} finally {
  for (const socket of connections) socket.close();
  await Promise.all(children.map(stop));
}
