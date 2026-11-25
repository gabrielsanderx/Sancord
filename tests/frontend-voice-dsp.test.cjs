const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openInterface } = require('./helpers/dom.cjs');

const {
  SancordNoiseSuppressorCore,
  VALID_MODES,
  sanitizeMode,
  migrateNoiseSuppressionSetting,
} = require(path.resolve(__dirname, '../static/js/voice-dsp-core.js'));

function seededNoise(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function rms(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / Math.max(1, arr.length));
}

function synthesizeFanBlock(len, tOffset, sr, rng, amp = 0.03) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = (tOffset + i) / sr;
    // Ruído constante de ventilador + hum de 60 Hz
    out[i] = amp * (0.65 * rng() + 0.35 * Math.sin(2 * Math.PI * 60 * t));
  }
  return out;
}

function synthesizeVoiceBlock(len, tOffset, sr, amp = 0.22) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = (tOffset + i) / sr;
    // Formantes harmônicos típicos de voz humana (150 Hz + harmônicos + fricativa suave)
    out[i] = amp * (
      0.50 * Math.sin(2 * Math.PI * 155 * t) +
      0.30 * Math.sin(2 * Math.PI * 310 * t) +
      0.15 * Math.sin(2 * Math.PI * 620 * t) +
      0.08 * Math.sin(2 * Math.PI * 1240 * t)
    );
  }
  return out;
}

test('SancordNoiseSuppressorCore: bypass verdadeiro, enum inválido e migração segura', () => {
  assert.deepEqual(VALID_MODES, ['auto', 'light', 'standard', 'strong', 'off']);
  assert.equal(sanitizeMode('STRONG'), 'strong');
  assert.equal(sanitizeMode('modo_invalido_xyz'), 'auto');
  assert.equal(migrateNoiseSuppressionSetting({ noiseGate: true }), 'auto');
  assert.equal(migrateNoiseSuppressionSetting({ noiseGate: false }), 'off');
  assert.equal(migrateNoiseSuppressionSetting({ voiceProfile: 'studio' }), 'off');
  assert.equal(migrateNoiseSuppressionSetting({ noiseSuppressionMode: 'light' }), 'light');

  const core = new SancordNoiseSuppressorCore({ sampleRate: 48000, mode: 'off' });
  const input = new Float32Array(128).map((_, i) => Math.sin(i * 0.1) * 0.4);
  const output = new Float32Array(128);
  core.processBlock(input, output);
  for (let i = 0; i < 128; i++) assert.ok(Math.abs(output[i] - input[i]) < 1e-6, 'bypass deve preservar sinal');
  assert.equal(core.getDiagnostics().suppressionActive, false);
});

test('SancordNoiseSuppressorCore: reduz ventilador/hum constante, preserva voz + hangover e trata teclado', () => {
  const sr = 48000;
  const rng = seededNoise(42);
  const core = new SancordNoiseSuppressorCore({ sampleRate: sr, mode: 'standard' });
  const out = new Float32Array(128);

  // Fase 1: 120 blocos (~320 ms) de ventilador constante (aprendizado adaptativo)
  let fanInRms = 0;
  let fanOutRms = 0;
  for (let b = 0; b < 120; b++) {
    const fan = synthesizeFanBlock(128, b * 128, sr, rng, 0.035);
    core.processBlock(fan, out);
    if (b >= 60) {
      fanInRms += rms(fan);
      fanOutRms += rms(out);
    }
  }
  const fanAttenDb = 20 * Math.log10((fanInRms + 1e-9) / (fanOutRms + 1e-9));
  assert.ok(fanAttenDb >= 18.0, `ventilador deve cair >= 18 dB no modo padrão (medido: ${fanAttenDb.toFixed(1)} dB)`);

  // Fase 2: voz humana sobre o mesmo ventilador -> VAD detecta e voz é preservada!
  let voiceInRms = 0;
  let voiceOutRms = 0;
  let peakVad = 0;
  for (let b = 120; b < 220; b++) {
    const fan = synthesizeFanBlock(128, b * 128, sr, rng, 0.035);
    const voice = synthesizeVoiceBlock(128, b * 128, sr, 0.24);
    const mix = new Float32Array(128);
    for (let i = 0; i < 128; i++) mix[i] = fan[i] + voice[i];
    core.processBlock(mix, out);
    const d = core.getDiagnostics();
    if (d.vadProb > peakVad) peakVad = d.vadProb;
    if (b >= 135) {
      voiceInRms += rms(voice);
      voiceOutRms += rms(out);
    }
  }
  assert.ok(peakVad >= 0.6, `VAD deve detectar fala (pico: ${peakVad})`);
  const voiceRetention = voiceOutRms / voiceInRms;
  assert.ok(voiceRetention >= 0.55 && voiceRetention <= 1.25, `voz deve ser preservada sem corte nem explosão (retenção: ${voiceRetention.toFixed(2)})`);

  // Fase 3: logo após a voz parar, hangover mantém vadProb > 0.25 nos primeiros ~80 ms (não corta fim de palavras)
  const fanPost = synthesizeFanBlock(128, 220 * 128, sr, rng, 0.035);
  core.processBlock(fanPost, out);
  assert.ok(core.getDiagnostics().vadProb >= 0.25, 'hangover deve segurar o fim da palavra');

  // Fase 4: fala alta / limiter suave evita clipping severo
  const loud = synthesizeVoiceBlock(128, 300 * 128, sr, 1.45);
  core.processBlock(loud, out);
  const peakOut = Math.max(...out.map(Math.abs));
  assert.ok(peakOut <= 0.965, `limiter deve manter saída segura (pico: ${peakOut})`);
  assert.equal(core.getDiagnostics().clipping, true, 'deve sinalizar clipping na entrada');
});

test('SancordNoiseSuppressorCore: tolera NaN, tamanhos inesperados, troca de sample rate e atende orçamento de CPU em soak', () => {
  const core = new SancordNoiseSuppressorCore({ sampleRate: 48000, mode: 'auto' });

  // NaN / Infinity nunca contaminam a saída
  const bad = new Float32Array(128);
  bad[0] = NaN;
  bad[17] = Infinity;
  bad[64] = -Infinity;
  const out128 = new Float32Array(128);
  core.processBlock(bad, out128);
  for (let i = 0; i < 128; i++) assert.ok(Number.isFinite(out128[i]), 'saída nunca pode conter NaN/Infinity');

  // Tamanhos inesperados de buffer (64, 200, 512) sem crash
  for (const sz of [64, 200, 512]) {
    const inp = new Float32Array(sz).fill(0.01);
    const out = new Float32Array(sz);
    core.processBlock(inp, out);
    assert.ok(Number.isFinite(out[sz - 1]));
  }

  // Troca de sample rate (48k -> 44.1k -> 16k)
  for (const sr of [44100, 16000, 48000]) {
    core.configureSampleRate(sr);
    core.reset();
    core.processBlock(new Float32Array(128).fill(0.02), out128);
    assert.equal(core.getDiagnostics().sampleRate, sr);
  }

  // Stress / Soak de 4.000 blocos (~10.6 segundos contínuos a 48 kHz) e verificação do orçamento < 2.67 ms/bloco
  const rng = seededNoise(99);
  const t0 = performance.now();
  for (let i = 0; i < 4000; i++) {
    const blk = synthesizeFanBlock(128, i * 128, 48000, rng, 0.02);
    core.processBlock(blk, out128);
  }
  const elapsedMs = performance.now() - t0;
  const avgMsPerHop = elapsedMs / 4000;
  assert.ok(avgMsPerHop < 1.2, `custo médio por bloco 128 amostras deve ficar bem abaixo de 2.67 ms (medido: ${avgMsPerHop.toFixed(3)} ms)`);
});

test('UI de Voz e vídeo: 5 modos de supressão, AEC/AGC independentes, Quick toggle e Diagnóstico apenas no Developer Mode', async (t) => {
  const h = await openInterface(t), d = h.document;

  const sel = d.getElementById('dsp-ns-mode');
  assert.ok(sel, 'dropdown de supressão de ruído deve existir');
  assert.equal(sel.value, 'auto');
  assert.ok(d.getElementById('dsp-aec'), 'AEC independente deve existir');
  assert.ok(d.getElementById('dsp-agc'), 'AGC independente deve existir');

  // Selecionar modo Forte exibe aviso discreto e atualiza descrição dinâmica
  sel.value = 'strong';
  sel.dispatchEvent(new h.w.Event('change'));
  assert.equal(d.getElementById('dsp-ns-strong-note').classList.contains('hidden'), false);
  assert.match(d.getElementById('dsp-ns-mode-desc').textContent, /barulhentos/);

  // Botão rápido da barra de voz alterna entre desligado e último modo ativo
  d.getElementById('quick-krisp-btn').click();
  assert.equal(h.run('state.audioSettings.noiseSuppressionMode'), 'off');
  d.getElementById('quick-krisp-btn').click();
  assert.equal(h.run('state.audioSettings.noiseSuppressionMode'), 'strong');

  // Diagnóstico técnico fica oculto para usuário comum e aparece com Developer Mode ON
  h.run('state.audioSettings.developerMode = false; renderDspDiagnostics({ sampleRate: 48000, frameSize: 256, hopSize: 128, latencyMs: 2.67, mode: "auto", effectiveIntensity: 0.4, noiseFloorDb: -54, vadProb: 0.8, voiceDetected: true, clipping: false, processMs: 0.06, overruns: 0 });');
  assert.equal(d.getElementById('dsp-dev-diagnostics').classList.contains('hidden'), true);
  assert.equal(d.getElementById('mic-vad-pill').textContent, 'Voz detectada');

  h.run('state.audioSettings.developerMode = true; renderDspDiagnostics({ sampleRate: 48000, frameSize: 256, hopSize: 128, latencyMs: 2.67, mode: "auto", effectiveIntensity: 0.4, noiseFloorDb: -54, vadProb: 0.8, voiceDetected: true, clipping: true, processMs: 0.06, overruns: 0 });');
  assert.equal(d.getElementById('dsp-dev-diagnostics').classList.contains('hidden'), false);
  assert.match(d.getElementById('dsp-dev-diagnostics').textContent, /48000 Hz/);
  assert.equal(d.getElementById('mic-clip-pill').classList.contains('hidden'), false);
});

test('createLocalAudioStream e botão Ligar não disparam Illegal invocation com getter WebIDL em AudioContext.prototype.audioWorklet', async (t) => {
  const h = await openInterface(t);
  const res = JSON.parse(await h.run(`(async () => {
    function FakeAudioContext() {
      this.state = 'running';
      this.currentTime = 0;
    }
    FakeAudioContext.prototype.resume = () => Promise.resolve();
    FakeAudioContext.prototype.close = () => Promise.resolve();
    FakeAudioContext.prototype.createMediaStreamSource = () => ({ connect(){} });
    FakeAudioContext.prototype.createBiquadFilter = () => ({ frequency: {}, Q: {}, connect(){} });
    FakeAudioContext.prototype.createGain = () => ({ gain: { value: 1, setTargetAtTime(){} }, connect(){} });
    FakeAudioContext.prototype.createAnalyser = () => ({ fftSize: 512, getFloatTimeDomainData(){}, connect(){} });
    FakeAudioContext.prototype.createDynamicsCompressor = () => ({ threshold:{}, knee:{}, ratio:{}, attack:{}, release:{}, connect(){} });
    FakeAudioContext.prototype.createMediaStreamDestination = () => ({
      stream: { getTracks: () => [{ stop(){} }], getAudioTracks: () => [{ enabled: true, stop(){} }] }
    });
    Object.defineProperty(FakeAudioContext.prototype, 'audioWorklet', {
      configurable: true,
      get() {
        if (!(this instanceof FakeAudioContext)) throw new TypeError('Illegal invocation');
        return null;
      }
    });
    window.AudioContext = FakeAudioContext;
    window.AudioWorkletNode = function() {};
    window.navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop(){} }],
      getAudioTracks: () => [{ enabled: true, stop(){} }]
    });
    window.navigator.mediaDevices.enumerateDevices = async () => [];
    window.__sent = [];
    sendWs = (type, payload) => { window.__sent.push({ type, payload }); return true; };
    state.selfUser = { id: 'u1', username: 'Swag', display_name: 'Swag' };
    openDmConversation('dm:ana__swag', { username: 'Ana', display_name: 'Ana' });
    document.getElementById('dm-call-btn').click();
    await new Promise(r => setTimeout(r, 80));
    const out = {
      currentVoice: state.currentVoiceChannel,
      sent: window.__sent,
      label: document.getElementById('dm-call-btn-label').textContent,
    };
    leaveVoiceChannel({ silent: true });
    return JSON.stringify(out);
  })()`));

  assert.equal(res.currentVoice, 'dmvoice:ana__swag');
  assert.equal(res.label, 'Desligar');
  assert.ok(res.sent.some(m => m.type === 'JoinVoice' && m.payload.channel_id === 'dmvoice:ana__swag'));
});
