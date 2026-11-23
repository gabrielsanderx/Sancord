import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function until(label, check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw Error(`QA de repouso: tempo esgotado em ${label}`);
}

async function createVerifiedAccount(endpoint, logs) {
  await until('backend isolado', async () => (await fetch(endpoint + '/api/health').catch(() => null))?.ok);
  const username = 'RepousoQA';
  const email = 'repouso-qa@example.invalid';
  const password = 'qa-' + randomUUID();
  const post = (path, payload) => fetch(endpoint + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const registered = await post('/api/register', { username, email, password });
  assert.ok(registered.ok, 'cadastro de QA');
  const { token } = await registered.json();
  const code = await until('código gerado no log descartável do QA', async () => {
    const names = await readdir(logs);
    for (const name of names) {
      const line = (await readFile(join(logs, name), 'utf8')).match(/repouso-qa@example\.invalid: (\d{6})/);
      if (line) return line[1];
    }
  });
  assert.ok((await post('/api/email/verify', { token, code })).ok, 'e-mail da conta de QA confirmado');
  return { username, password };
}

export async function runIdleQa(page, evaluate, endpoint, logs, baseline) {
  const account = await createVerifiedAccount(endpoint, logs);
  await page('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page('Performance.enable');
  await evaluate(`usernameInput.value = ${JSON.stringify(account.username)}; passwordInput.value = ${JSON.stringify(account.password)}; loginForm.requestSubmit()`);
  await until('WebSocket autenticado', () => evaluate('state.selfUser?.username === "RepousoQA" && SancordConnection.canWrite()'));
  await evaluate(`(() => {
    state.audioSettings.ambientFx = 'cyber';
    state.audioSettings.profileAnimations = 'always';
    applyAppThemeSettings();
    applyProfileVisualSettings();
    const area = document.createElement('section');
    area.id = 'qa-idle-scroll';
    area.style.cssText = 'position:fixed;inset:70px auto auto 280px;z-index:900;width:350px;height:240px;overflow:auto';
    document.body.appendChild(area);
    for (const name of ['visible', 'clipped']) {
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.dataset.qaCanvas = name;
      card.style.cssText = 'position:relative;width:320px;height:160px;margin:0 0 150px';
      card.innerHTML = '<div class="pf-layer" style="position:absolute;inset:0"></div>';
      area.appendChild(card);
      SanvoCosmeticsVFX.attachFrameVfx(card, 'core-pulse');
    }
    globalThis.qaIdleDraws = { visible: 0, clipped: 0 };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      const name = this.canvas.closest('[data-qa-canvas]')?.dataset.qaCanvas;
      if (name) qaIdleDraws[name]++;
      return clear.apply(this, args);
    };
    state.currentVoiceChannel = 'qa-indicadores';
    startVoicePingMonitor();
    startVoiceCallTimer();
  })()`);
  await until('Canvas visível renderizando', () => evaluate('qaIdleDraws.visible > 2'));
  const metrics = async () => Object.fromEntries((await page('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const before = await metrics();
  await evaluate('qaIdleDraws.visible = qaIdleDraws.clipped = 0');
  await delay(16000);
  const foreground = await evaluate(`({ ...qaIdleDraws, ambient: getComputedStyle(document.getElementById('ui-ambient-fx')).animationPlayState })`);
  const foregroundTaskMs = Math.round(((await metrics()).TaskDuration - before.TaskDuration) * 1000);
  assert.ok(foreground.visible > 0);
  assert.equal(foreground.clipped > 0, baseline, 'só a versão original desenha o Canvas recortado');
  assert.equal(foreground.ambient, baseline ? 'running' : 'paused');
  await evaluate(`document.getElementById('qa-idle-scroll').scrollTop = 310; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))`);
  const priorClipped = foreground.clipped;
  await until('Canvas reaparece após rolar e ambiente retoma ao usar o app', () => evaluate(`qaIdleDraws.clipped > ${priorClipped} && getComputedStyle(document.getElementById('ui-ambient-fx')).animationPlayState === 'running'`));

  const earlierHeartbeat = await evaluate('SancordConnection.status().lastHeartbeat');
  await evaluate(`window.ipc.postMessage('minimize')`);
  if (!baseline) await until('evento nativo de minimização', () => evaluate(`window.__SANVO_WINDOW_MINIMIZED === true && isVisualWindowHidden()`));
  else await delay(400);
  const hidden = await evaluate(`({ hidden: document.hidden, nativeMinimized: window.__SANVO_WINDOW_MINIMIZED ?? null,
    pingTimer: state.voicePingInterval != null, callTimer: state.voiceCallTimerInterval != null,
    startedAt: state.voiceCallStartedAt, ambient: getComputedStyle(document.getElementById('ui-ambient-fx')).animationPlayState })`);
  assert.equal(hidden.pingTimer, baseline);
  assert.equal(hidden.callTimer, baseline);
  if (!baseline) assert.equal(hidden.ambient, 'paused');
  assert.equal(await evaluate(`sendWs('Ping')`), true);
  await until('Pong real com janela minimizada', () => evaluate(`SancordConnection.status().lastHeartbeat > ${earlierHeartbeat}`));
  await delay(2600);
  await evaluate(`window.ipc.postMessage('window:focus')`);
  if (!baseline) await until('janela restaurada com timers da interface', () => evaluate(`window.__SANVO_WINDOW_MINIMIZED === false && !isVisualWindowHidden() && state.voicePingInterval != null && state.voiceCallTimerInterval != null`));
  assert.equal(await evaluate('state.voiceCallStartedAt'), hidden.startedAt);
  assert.equal(await evaluate('SancordConnection.canWrite()'), true);
  console.log(JSON.stringify({ baseline, foreground, foregroundTaskMs, hidden, websocket: 'Pong recebido durante minimização' }));
}
