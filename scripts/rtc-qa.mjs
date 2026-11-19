import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const users = ['VideoQA_A', 'VideoQA_B'];
const serverName = 'Voz QA local';
const password = `qa-${randomUUID()}`;
const bins = resolve(process.env.SANCORD_QA_BIN_DIR || 'target-review-phase6/debug');
const turn = {
  urls: process.env.SANCORD_QA_TURN_URL || '',
  alternateUrl: process.env.SANCORD_QA_TURN_URL_B || '',
  username: process.env.SANCORD_QA_TURN_USERNAME || '',
  credential: process.env.SANCORD_QA_TURN_CREDENTIAL || '',
};
assert.ok(!turn.urls || (turn.username && turn.credential), 'O relay de QA precisa de usuário e credencial.');
assert.ok(!turn.alternateUrl || turn.urls, 'A segunda rota exige configurar a primeira.');
const turnUrls = [turn.urls, turn.alternateUrl || turn.urls];
const mode = turn.urls ? 'relay' : 'direto';
const output = resolve(process.env.SANCORD_QA_RTC_OUT || 'qa-rtc', mode);
const data = await mkdtemp(join(tmpdir(), 'sancord-rtc-qa-'));
const processes = [];
const sockets = [];

function probePort(port = 0) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
      const selected = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(selected));
    });
  });
}

async function waitUntil(label, check, timeout = 20000) {
  const expiry = Date.now() + timeout;
  let lastError;
  do {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  } while (Date.now() < expiry);
  throw Error(`Timeout no QA de RTC: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

function launch(executable, additions) {
  const child = spawn(join(bins, executable), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, ...additions } });
  processes.push(child);
  return new Promise((resolve, reject) => {
    child.once('spawn', () => resolve(child));
    child.once('error', reject);
  });
}

async function openCdp(port) {
  const address = await waitUntil('destino WebView2', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    return (await response.json()).find(target => target.type === 'page' && target.url.includes('sancord.localhost'))?.webSocketDebuggerUrl;
  });
  const socket = new WebSocket(address);
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(Error('CDP desconectado')); });
  const pending = new Map();
  let seq = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
  };
  function call(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP: ${method} excedeu o prazo`)); }, 12000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message.error) reject(Error(message.error.message));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return {
    call,
    async run(expression) {
      const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    },
  };
}

async function openApp(base, index) {
  const port = await probePort();
  await launch('SancordApp.exe', {
    SANCORD_DESKTOP_DATA_DIR: join(data, `webview-${index}`), SANCORD_SERVER_URL: base,
    SANCORD_DISABLE_UPDATES: '1', SANCORD_DISABLE_LOCAL_HOST: '1', SANCORD_REGISTER_PROTOCOL: '0',
    SANCORD_WINDOW_TITLE: `Sancord · RTC QA ${mode} ${index + 1}`,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port} ` +
      '--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --mute-audio ' +
      '--disable-background-timer-throttling --disable-renderer-backgrounding',
  });
  const page = await openCdp(port);
  await waitUntil('tela de login', () => page.run(`document.readyState === 'complete' && typeof joinVoiceChannel === 'function' && !loginModal.classList.contains('hidden')`));
  await page.run(`(() => {
    if (${Boolean(turn.urls)}) {
      const NativePeerConnection = window.RTCPeerConnection;
      const endpoint = ${JSON.stringify(turnUrls[index])};
      window.RTCPeerConnection = class extends NativePeerConnection {
        constructor(configuration) {
          const iceServers = configuration.iceServers.filter(server => server.urls.includes(endpoint))
            .map(server => ({ ...server, urls: [endpoint] }));
          if (!iceServers.length) throw Error('O backend não anunciou a rota TURN deste cliente QA.');
          super({ ...configuration, iceServers, iceTransportPolicy: 'relay' });
          this.addEventListener('icecandidateerror', event => (globalThis.qaIceErrors ||= []).push(event.errorCode));
        }
      };
    }
    document.getElementById('tab-login').click();
    usernameInput.value = ${JSON.stringify(users[index])};
    passwordInput.value = ${JSON.stringify(password)};
    loginForm.requestSubmit();
  })()`);
  await waitUntil('login e leitura do servidor', () => page.run(`state.selfUser?.username === ${JSON.stringify(users[index])} && state.servers.some(s => s.name === ${JSON.stringify(serverName)})`));
  await page.run(`(() => {
    state.audioSettings.cameraQuality = '480';
    const server = state.servers.find(s => s.name === ${JSON.stringify(serverName)});
    switchToServerId(server.id);
    const room = server.voice_channels[0];
    globalThis.qaRoom = room.id;
    document.querySelector('[data-channel-id="' + CSS.escape(room.id) + '"] .voice-channel-join').click();
  })()`);
  await waitUntil('entrada na sala', () => page.run('state.currentVoiceChannel === qaRoom'));
  await page.run(`(() => {
    const warn = console.warn.bind(console);
    console.warn = (...args) => {
      if (String(args[0]).includes('câmera')) globalThis.qaCameraWarning = String(args[1]?.message || args[1] || args[0]);
      warn(...args);
    };
    const stop = stopCamera;
    stopCamera = (...args) => {
      globalThis.qaCameraStop = new Error().stack.split(String.fromCharCode(10)).slice(1, 5).join(' | ');
      return stop(...args);
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.video || constraints.audio) return capture(constraints);
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d');
      let frame = 0;
      const draw = () => {
        context.fillStyle = ${JSON.stringify(index === 0 ? '#251b47' : '#15363b')};
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = ${JSON.stringify(index === 0 ? '#a78bfa' : '#61d4c4')};
        context.fillRect(30, 236, (frame * 18) % 550 + 30, 12);
        context.font = 'bold 42px Segoe UI, sans-serif';
        context.fillText('Câmera virtual ${index === 0 ? 'A' : 'B'}', 30, 130);
        context.font = '22px Segoe UI, sans-serif';
        context.fillText('Sancord · QA de vídeo  /  ' + frame++, 30, 185);
      };
      draw();
      const stream = canvas.captureStream(15);
      const [track] = stream.getVideoTracks();
      const timer = setInterval(() => {
        if (track.readyState === 'live') draw();
        else clearInterval(timer);
      }, 66);
      return stream;
    };
  })()`);
  return page;
}

const readMedia = `(async () => {
  const member = (state.voiceMembers[qaRoom] || []).find(id => id !== state.selfUser.id);
  const pc = state.peers.get(member)?.pc;
  if (!pc || pc.connectionState !== 'connected') return null;
  const reports = await pc.getStats();
  const transport = [...reports.values()].find(report => report.type === 'transport' && report.selectedCandidatePairId);
  const pair = reports.get(transport?.selectedCandidatePairId);
  const inbound = [...reports.values()].filter(report => report.type === 'inbound-rtp');
  const audio = inbound.find(report => (report.kind || report.mediaType) === 'audio');
  const video = inbound.find(report => (report.kind || report.mediaType) === 'video');
  const element = document.querySelector('#stage-voice-' + CSS.escape(member) + ' video.camera-video-el');
  return {
    localCandidate: reports.get(pair?.localCandidateId)?.candidateType || null,
    remoteCandidate: reports.get(pair?.remoteCandidateId)?.candidateType || null,
    audioPackets: audio?.packetsReceived || 0, videoFrames: video?.framesDecoded || 0,
    videoSize: [element?.videoWidth || 0, element?.videoHeight || 0],
    presentedFrames: element?.getVideoPlaybackQuality().totalVideoFrames || 0,
    rttMs: Number.isFinite(pair?.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1000) : null,
  };
})()`;

async function readBoth(a, b, check, phase) {
  return waitUntil(phase, async () => {
    const readings = await Promise.all([a.run(readMedia), b.run(readMedia)]);
    return readings.every(reading => reading && check(reading)) && readings;
  }, 30000);
}

const cameraDiagnostics = `(() => ({
  allowed: voicePermissions().stream_video, starting: state.cameraStarting, cameraOn: state.cameraOn,
  warning: globalThis.qaCameraWarning || null,
  stop: globalThis.qaCameraStop || null, localTrack: state.localCameraStream?.getVideoTracks()[0]?.readyState || null,
  members: (state.voiceMembers[qaRoom] || []).map(id => Boolean(state.users.get(id)?.camera_on)),
  peers: [...state.peers.values()].map(peer => ({ signal: peer.pc.signalingState, connection: peer.pc.connectionState,
    sending: peer.cameraSenders.length, incoming: peer.incomingVideoStreams.size })),
  videos: [...document.querySelectorAll('.camera-video-el')].map(video => ({ width:video.videoWidth, track: Boolean(video.srcObject), paused:video.paused })),
}))()`;

const iceDiagnostics = `(async () => ({
  configuredRelay: state.iceServers.some(server => server.urls.some(url => url.startsWith('turn:') || url.startsWith('turns:'))),
  errors: globalThis.qaIceErrors || [],
  peers: await Promise.all([...state.peers.values()].map(async ({ pc }) => {
    const stats = [...(await pc.getStats()).values()];
    return { state: pc.iceConnectionState, gathering: pc.iceGatheringState,
      candidates: stats.filter(r => r.type.endsWith('-candidate')).map(r => [r.type, r.candidateType]),
      pairs: stats.filter(r => r.type === 'candidate-pair').map(r => [r.state, r.requestsSent, r.responsesReceived]) };
  })),
}))()`;

try {
  await mkdir(output, { recursive: true });
  const port = Number(process.env.SANCORD_QA_RTC_PORT || 3117);
  assert.ok(Number.isInteger(port) && port >= 3106 && port <= 3199, 'Use uma porta de QA entre 3106 e 3199.');
  await probePort(port);
  const base = `http://127.0.0.1:${port}`;
  await launch('sancord.exe', {
    SANCORD_BIND: `127.0.0.1:${port}`, SANCORD_DATA_DIR: join(data, 'db'), SANCORD_LOG_DIR: join(data, 'logs'),
    SANCORD_DISCOVERY: '0', SANCORD_STUN_URLS: 'stun:127.0.0.1:9', SANCORD_TURN_URLS: [...new Set(turnUrls)].filter(Boolean).join(','),
    SANCORD_TURN_USERNAME: turn.username, SANCORD_TURN_CREDENTIAL: turn.credential,
  });
  await waitUntil('backend isolado', async () => (await fetch(`${base}/api/health`)).ok);
  const seedPath = join(data, 'seed.json');
  await writeFile(seedPath, JSON.stringify({ base, password, users }));
  try {
    await execute(process.execPath, ['scripts/seed-voice-qa.mjs', seedPath], { windowsHide: true, timeout: 20000 });
  } finally {
    await unlink(seedPath);
  }
  const a = await openApp(base, 0);
  const b = await openApp(base, 1);
  let audio;
  try { audio = await readBoth(a, b, sample => sample.audioPackets > 10, 'áudio WebRTC nos dois sentidos'); }
  catch (error) {
    console.error(JSON.stringify(await Promise.all([a.run(iceDiagnostics), b.run(iceDiagnostics)])));
    throw error;
  }
  if (turn.urls) {
    for (const sample of audio) assert.deepEqual([sample.localCandidate, sample.remoteCandidate], ['relay', 'relay']);
  }
  console.log(`${mode}: áudio confirmado nos dois sentidos.`);
  await a.run(`document.getElementById('toggle-camera-btn').click()`);
  try {
    await waitUntil('câmera de A aparece em B', async () => (await b.run(readMedia))?.presentedFrames > 3);
  } catch (error) {
    console.error(JSON.stringify({ cameras: await Promise.all([a.run(cameraDiagnostics), b.run(cameraDiagnostics)]), media: await b.run(readMedia) }));
    throw error;
  }
  await b.run(`document.getElementById('toggle-camera-btn').click()`);
  const first = await readBoth(a, b, sample => sample.videoFrames > 3 && sample.presentedFrames > 3, 'câmera bidirecional');
  await wait(400);
  const advancing = await Promise.all([a.run(readMedia), b.run(readMedia)]);
  for (const [i, sample] of advancing.entries()) {
    assert.ok(sample.videoSize.every(value => value > 0) && sample.presentedFrames > first[i].presentedFrames);
    if (turn.urls) assert.deepEqual([sample.localCandidate, sample.remoteCandidate], ['relay', 'relay']);
  }
  if (turn.urls) {
    await a.run(`document.getElementById('voice-signal-box').click()`);
    await waitUntil('painel de voz identifica TURN', () => a.run(`document.getElementById('voice-connection-details').textContent.includes('TURN')`));
    const { data: panel } = await a.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(join(output, 'transporte-turn.png'), Buffer.from(panel, 'base64'));
  }
  const { data: screenshot } = await b.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(output, 'camera-bidirecional.png'), Buffer.from(screenshot, 'base64'));
  await a.run(`document.getElementById('toggle-mute-btn').click()`);
  await waitUntil('mute no fluxo local', () => a.run(`state.muted && state.localAudioStream?.getAudioTracks().every(track => !track.enabled)`));
  await a.run(`document.getElementById('toggle-mute-btn').click(); document.getElementById('toggle-camera-btn').click()`);
  await waitUntil('câmera desligada deixa de aparecer em B', () => b.run(`document.querySelectorAll('.camera-video-el').length === 1`));
  await a.run(`document.getElementById('leave-voice-btn').click()`);
  await waitUntil('saída limpa o outro cliente', () => b.run(`(state.voiceMembers[qaRoom] || []).length === 1 && state.peers.size === 0`));
  assert.ok(await a.run('!state.currentVoiceChannel && !state.localCameraStream'));
  await a.run(`document.querySelector('[data-channel-id="' + CSS.escape(qaRoom) + '"] .voice-channel-join').click()`);
  const resumed = await readBoth(a, b, sample => sample.audioPackets > 10, 'nova entrada após desconectar');
  if (turn.urls) for (const sample of resumed) assert.deepEqual([sample.localCandidate, sample.remoteCandidate], ['relay', 'relay']);
  const result = { mode, distinctTurnEndpoints: Boolean(turn.alternateUrl && turn.alternateUrl !== turn.urls), microphoneSource: 'WebView2 virtual', cameraSource: 'Canvas', audio, video: advancing, rejoined: true, cameraStopped: true };
  await writeFile(join(output, 'resultado.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  for (const socket of sockets) socket.close();
  for (const child of processes.reverse()) child.kill();
}
