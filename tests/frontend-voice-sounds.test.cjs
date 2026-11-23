const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openInterface } = require('./helpers/dom.cjs');

const ROOT = path.resolve(__dirname, '..');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    SancordVoiceSounds.resetForTests();
    globalThis.played = [];
    SancordSoundManager.setTestPlayHook((ev) => played.push(ev));
    state.selfUser = { id: "u-gabriel", username: "Gabriel", avatar_color: "#5865f2" };
    state.currentVoiceChannel = "voice-1";
    state.deafened = false;
    state.muted = false;
    state.voiceRecovery = null;
  `);
  return h;
}

test('todos os 17 assets WAV originais do Sanvo/Sancord existem, têm cabeçalho RIFF/WAVE válido e não clipam', () => {
  const { SancordSoundManager } = require(path.join(ROOT, 'static/js/sound-manager.js'));
  const entries = Object.entries(SancordSoundManager.SOUND_ASSETS);
  assert.equal(entries.length, 17);
  for (const [id, relUrl] of entries) {
    const file = path.join(ROOT, 'static', relUrl.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `Asset ausente: ${id} -> ${file}`);
    const buf = fs.readFileSync(file);
    assert.ok(buf.length > 44, `Asset muito pequeno: ${id}`);
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'RIFF', `Cabeçalho RIFF inválido em ${id}`);
    assert.equal(buf.subarray(8, 12).toString('ascii'), 'WAVE', `Cabeçalho WAVE inválido em ${id}`);
    // Garante ausência de clipping PCM 16-bit (nenhuma amostra saturada em +-32767)
    let peak = 0;
    for (let i = 44; i + 1 < buf.length; i += 2) {
      const sample = Math.abs(buf.readInt16LE(i));
      if (sample > peak) peak = sample;
    }
    assert.ok(peak > 1000 && peak < 26000, `Normalização fora da faixa segura em ${id}: peak=${peak}`);
  }
});

test('eventos compartilhados tocam para mesma call, deduplicam event_id, ignoram outro canal e barram spam', async (t) => {
  const h = await setup(t);

  // 1. Entrada, stream start/stop, câmera on/off e saída na mesma call
  h.run(`
    SancordVoiceSounds.handleSharedEvent({ event_id:"ev-1", event_type:"voice_join", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:1000 }, { now: 1000 });
    SancordVoiceSounds.handleSharedEvent({ event_id:"ev-2", event_type:"stream_start", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:2000 }, { now: 2000 });
    SancordVoiceSounds.handleSharedEvent({ event_id:"ev-3", event_type:"stream_stop", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:4000 }, { now: 4000 });
    SancordVoiceSounds.handleSharedEvent({ event_id:"ev-4", event_type:"camera_on", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:5000 }, { now: 5000 });
    SancordVoiceSounds.handleSharedEvent({ event_id:"ev-5", event_type:"voice_leave", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:6000 }, { now: 6000 });
  `);
  assert.deepEqual(
    JSON.parse(h.run('JSON.stringify(played.map(p => p.cueId))')),
    ['voice_join', 'stream_start', 'stream_stop', 'camera_on', 'voice_leave']
  );

  // 2. Deduplicação de event_id: entrega duplicada NÃO toca duas vezes
  h.run(`
    SancordVoiceSounds.handleSharedEvent({ event_id:"ev-2", event_type:"stream_start", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:7000 }, { now: 7000 });
  `);
  assert.equal(h.run('played.length'), 5);

  // 3. Evento de OUTRO canal (voice-2) nunca toca para quem está em voice-1
  h.run(`
    SancordVoiceSounds.handleSharedEvent({ event_id:"ev-other", event_type:"stream_start", voice_session_id:"voice-2", actor_user_id:"u-iumi", timestamp:8000 }, { now: 8000 });
  `);
  assert.equal(h.run('played.length'), 5);

  // 4. Spam rápido de câmera pelo mesmo ator é barrado pelo cooldown
  h.run(`
    SancordVoiceSounds.handleSharedEvent({ event_id:"spam-1", event_type:"camera_off", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:9000 }, { now: 9000 });
    SancordVoiceSounds.handleSharedEvent({ event_id:"spam-2", event_type:"camera_on", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:9100 }, { now: 9100 });
    SancordVoiceSounds.handleSharedEvent({ event_id:"spam-3", event_type:"camera_off", voice_session_id:"voice-1", actor_user_id:"u-swag", timestamp:9200 }, { now: 9200 });
  `);
  assert.equal(h.run('played.length'), 6);

  // 5. Reconnect em andamento (voiceRecovery.joining) não reproduz eventos atrasados
  h.run(`
    state.voiceRecovery = { channel: "voice-1", joining: true };
    SancordVoiceSounds.handleSharedEvent({ event_id:"rec-1", event_type:"voice_join", voice_session_id:"voice-1", actor_user_id:"u-iumi", timestamp:12000 }, { now: 12000 });
  `);
  assert.equal(h.run('played.length'), 6);
});

test('configurações de Sons de chamadas, volume 0/50/100 independente, deafen e dispositivo de saída', async (t) => {
  const h = await setup(t), d = h.document;

  // Desativar Entrada de usuário pelo checkbox em Configurações -> outros sons continuam funcionando
  const joinToggle = d.getElementById('call-sound-join');
  joinToggle.checked = false;
  joinToggle.dispatchEvent(new h.w.Event('change'));
  h.run(`
    SancordVoiceSounds.handleSharedEvent({ event_id:"cfg-1", event_type:"voice_join", voice_session_id:"voice-1", actor_user_id:"u-a", timestamp:1000 }, { now: 1000 });
    SancordVoiceSounds.handleSharedEvent({ event_id:"cfg-2", event_type:"stream_start", voice_session_id:"voice-1", actor_user_id:"u-a", timestamp:2000 }, { now: 2000 });
  `);
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(played.map(p => p.cueId))')), ['stream_start']);
  joinToggle.checked = true;
  joinToggle.dispatchEvent(new h.w.Event('change'));

  // Volume 0% -> silêncio; 50% -> metade aproximada; 100% -> ganho nominal (sem alterar speakerVolume)
  const beforeSpeakerVol = h.run('state.audioSettings.speakerVolume');
  const slider = d.getElementById('call-sounds-volume');
  slider.value = '0';
  slider.dispatchEvent(new h.w.Event('input'));
  h.run(`SancordVoiceSounds.handleSharedEvent({ event_id:"v0", event_type:"voice_join", voice_session_id:"voice-1", actor_user_id:"u-a", timestamp:3000 }, { now: 3000 })`);
  assert.equal(h.run('played.length'), 1);

  slider.value = '50';
  slider.dispatchEvent(new h.w.Event('input'));
  h.run(`SancordVoiceSounds.handleSharedEvent({ event_id:"v50", event_type:"voice_join", voice_session_id:"voice-1", actor_user_id:"u-a", timestamp:4000 }, { now: 4000 })`);
  const gain50 = h.run('played.at(-1).gain');
  assert.ok(gain50 > 0.35 && gain50 < 0.6, `ganho em 50% esperado ~0.45, obtido ${gain50}`);

  slider.value = '100';
  slider.dispatchEvent(new h.w.Event('input'));
  h.run(`SancordVoiceSounds.handleSharedEvent({ event_id:"v100", event_type:"voice_leave", voice_session_id:"voice-1", actor_user_id:"u-a", timestamp:5000 }, { now: 5000 })`);
  assert.equal(h.run('played.at(-1).gain'), 1);
  assert.equal(h.run('state.audioSettings.speakerVolume'), beforeSpeakerVol);

  // Deafen bloqueia eventos compartilhados da call, mas permite feedback local de deafen_on/deafen_off
  h.run(`
    state.deafened = true;
    SancordVoiceSounds.handleSharedEvent({ event_id:"df-1", event_type:"voice_join", voice_session_id:"voice-1", actor_user_id:"u-b", timestamp:6000 }, { now: 6000 });
    SancordVoiceSounds.playLocal("deafen_on", { ignoreCooldown: true, now: 6100 });
  `);
  assert.equal(h.run('played.at(-1).cueId'), 'deafen_on');
  assert.equal(h.run('played.filter(p => p.cueId === "voice_join").length'), 1);

  // Output device routing
  h.run('state.deafened = false; SancordSoundManager.applyOutputDevice("headset-usb-01");');
  assert.equal(h.run('SancordSoundManager.getOutputDeviceId()'), 'headset-usb-01');
});

test('ringtone de chamada privada: inicia, encerra imediatamente ao conectar/cancelar e master OFF preserva ringtone', async (t) => {
  const h = await setup(t), d = h.document;

  // Master toggle OFF desliga sons de call mas preserva ringtone se Chamadas recebidas = ON
  const master = d.getElementById('call-sounds-master');
  master.checked = false;
  master.dispatchEvent(new h.w.Event('change'));
  assert.equal(h.run('SancordVoiceSounds.isCueAllowed("voice_join")'), false);
  assert.equal(h.run('SancordVoiceSounds.isCueAllowed("incoming_call_loop")'), true);

  master.checked = true;
  master.dispatchEvent(new h.w.Event('change'));

  // Chamada privada recebida inicia loop e CallEnded encerra imediatamente
  h.run(`
    handleServerMessage({ type:"DmCallIncoming", payload:{ dm_id:"dm:gabriel:swag", voice_channel_id:"dmvoice:gabriel:swag", from_username:"Swag", from_color:"#ef4444" } });
  `);
  assert.equal(h.run('SancordSoundManager.isLoopActive("incoming")'), true);
  h.run(`handleServerMessage({ type:"CallEnded", payload:{ channel_id:"dmvoice:gabriel:swag" } })`);
  assert.equal(h.run('SancordSoundManager.isLoopActive("incoming")'), false);

  // Chamada saindo (outgoing) para imediatamente quando o outro atende (call_connected)
  h.run(`
    state.currentVoiceChannel = "dmvoice:gabriel:swag";
    SancordVoiceSounds.startOutgoingRing("dmvoice:gabriel:swag");
  `);
  assert.equal(h.run('SancordSoundManager.isLoopActive("outgoing")'), true);
  h.run(`
    SancordVoiceSounds.handleSharedEvent({ event_id:"cc-1", event_type:"call_connected", voice_session_id:"dmvoice:gabriel:swag", actor_user_id:"u-swag", timestamp:9999 }, { now: 9999 });
  `);
  assert.equal(h.run('SancordSoundManager.isLoopActive("outgoing")'), false);
  assert.equal(h.run('played.at(-1).cueId'), 'call_connected');
});
