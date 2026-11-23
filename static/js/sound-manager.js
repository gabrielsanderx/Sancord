/**
 * SancordSoundManager — Gerenciador central de assets sonoros oficiais do Sancord.
 *
 * Responsabilidades:
 *  - Catálogo de assets locais embutidos (`assets/sounds/...`) sem download remoto;
 *  - Preload e decodificação antecipada em `AudioBuffer` ao entrar em call;
 *  - Roteamento para o dispositivo de saída configurado (`setSinkId`);
 *  - Compressor/limiter anti-clipping e limite de polifonia (máx. 3 cues simultâneos);
 *  - Coalescing / cooldown por categoria para evitar caos sonoro quando vários
 *    usuários entram juntos ou alternam estados rapidamente;
 *  - Controle limpo de loops (ringtone de chamada recebida e chamada saindo).
 */
const SancordSoundManager = (() => {
  const SOUND_ASSETS = Object.freeze({
    message_received: "/assets/sounds/notifications/message_received.wav",
    voice_join: "/assets/sounds/voice/join.wav",
    voice_leave: "/assets/sounds/voice/leave.wav",
    call_connected: "/assets/sounds/voice/connected.wav",
    call_disconnected: "/assets/sounds/voice/disconnected.wav",
    voice_reconnected: "/assets/sounds/voice/reconnected.wav",
    stream_start: "/assets/sounds/stream/start.wav",
    stream_stop: "/assets/sounds/stream/stop.wav",
    camera_on: "/assets/sounds/camera/on.wav",
    camera_off: "/assets/sounds/camera/off.wav",
    mute_on: "/assets/sounds/controls/mute.wav",
    mute_off: "/assets/sounds/controls/unmute.wav",
    deafen_on: "/assets/sounds/controls/deafen.wav",
    deafen_off: "/assets/sounds/controls/undeafen.wav",
    incoming_call_loop: "/assets/sounds/calls/incoming.wav",
    outgoing_call_loop: "/assets/sounds/calls/outgoing.wav",
    voice_error: "/assets/sounds/errors/voice_error.wav",
  });

  // Separação explícita de categorias sonoras (Notificações vs Eventos de Voz vs Chamadas vs UI).
  const SOUND_CATEGORIES = Object.freeze({
    NOTIFICATION: Object.freeze(["message_received"]),
    VOICE_EVENT: Object.freeze([
      "voice_join",
      "voice_leave",
      "stream_start",
      "stream_stop",
      "camera_on",
      "camera_off",
    ]),
    CALL: Object.freeze([
      "call_connected",
      "call_disconnected",
      "voice_reconnected",
      "incoming_call_loop",
      "outgoing_call_loop",
    ]),
    UI: Object.freeze(["mute_on", "mute_off", "deafen_on", "deafen_off", "voice_error"]),
  });

  const PRELOAD_NOTIFICATION_KEYS = ["message_received", "incoming_call_loop"];

  const PRELOAD_CALL_KEYS = [
    "voice_join",
    "voice_leave",
    "stream_start",
    "stream_stop",
    "camera_on",
    "camera_off",
    "call_connected",
    "call_disconnected",
    "mute_on",
    "mute_off",
    "deafen_on",
    "deafen_off",
    "incoming_call_loop",
    "outgoing_call_loop",
  ];

  // Cooldown local mínimo (ms) por grupo de efeito para coalescing natural.
  const COOLDOWN_GROUP = {
    message_received: { group: "notification_message", ms: 450 },
    voice_join: { group: "join", ms: 320 },
    voice_leave: { group: "leave", ms: 320 },
    stream_start: { group: "stream", ms: 750 },
    stream_stop: { group: "stream", ms: 750 },
    camera_on: { group: "camera", ms: 750 },
    camera_off: { group: "camera", ms: 750 },
    voice_error: { group: "error", ms: 900 },
  };

  const MAX_POLYPHONY = 3;

  let audioCtx = null;
  let compressor = null;
  let masterGain = null;
  let currentSinkId = "";
  const decodedCache = new Map();
  const loadingPromises = new Map();
  const activeVoices = new Set();
  const lastGroupPlayedAt = new Map();
  const activeLoops = new Map(); // loopName -> { intervalId, timeoutId, stopAudio }
  let customPlayHook = null;

  function ensureContext() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      return audioCtx;
    }
    const Ctor = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
      compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, audioCtx.currentTime);
      compressor.knee.setValueAtTime(18, audioCtx.currentTime);
      compressor.ratio.setValueAtTime(6, audioCtx.currentTime);
      compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
      compressor.release.setValueAtTime(0.12, audioCtx.currentTime);

      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(1.0, audioCtx.currentTime);

      compressor.connect(masterGain);
      masterGain.connect(audioCtx.destination);
      applyOutputDevice(getConfiguredSinkId());
    } catch (_) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function getConfiguredSinkId() {
    if (typeof state !== "undefined" && state.audioSettings?.speakerDeviceId) {
      return String(state.audioSettings.speakerDeviceId);
    }
    return "";
  }

  function applyOutputDevice(deviceId = "") {
    const target = String(deviceId || "");
    currentSinkId = target;
    if (audioCtx && typeof audioCtx.setSinkId === "function") {
      audioCtx.setSinkId(target).catch(() => {});
    }
  }

  async function preloadCue(cueId) {
    const url = SOUND_ASSETS[cueId];
    if (!url) return null;
    if (decodedCache.has(cueId)) return decodedCache.get(cueId);
    if (loadingPromises.has(cueId)) return loadingPromises.get(cueId);

    const task = (async () => {
      try {
        const ctx = ensureContext();
        if (!ctx || typeof fetch !== "function") return null;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const arr = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr.slice(0));
        decodedCache.set(cueId, decoded);
        return decoded;
      } catch (_) {
        return null;
      } finally {
        loadingPromises.delete(cueId);
      }
    })();
    loadingPromises.set(cueId, task);
    return task;
  }

  function preloadCallCues() {
    for (const key of PRELOAD_CALL_KEYS) {
      preloadCue(key).catch(() => {});
    }
  }

  function preloadNotificationCues() {
    for (const key of PRELOAD_NOTIFICATION_KEYS) {
      preloadCue(key).catch(() => {});
    }
  }

  function computeEffectiveGain(volumePct) {
    const clamped = Math.max(0, Math.min(150, Number.isFinite(volumePct) ? volumePct : 100));
    if (clamped <= 0) return 0;
    // Curva perceptual suave: 50% ≈ metade percebida, 100% = ganho nominal seguro.
    return Math.min(1.25, Math.pow(clamped / 100, 1.15));
  }

  function playHtmlAudioFallback(url, gain) {
    if (typeof Audio === "undefined") return false;
    try {
      const el = new Audio(url);
      el.volume = Math.max(0, Math.min(1, gain * 0.85));
      if (currentSinkId && typeof el.setSinkId === "function") {
        el.setSinkId(currentSinkId).catch(() => {});
      }
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      return el;
    } catch (_) {
      return false;
    }
  }

  function play(cueId, opts = {}) {
    if (!SOUND_ASSETS[cueId]) return false;
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    const volumePct = typeof opts.volume === "number" ? opts.volume : 100;
    const gain = computeEffectiveGain(volumePct);
    if (gain <= 0) return false;

    if (!opts.ignoreCooldown) {
      const rule = COOLDOWN_GROUP[cueId];
      if (rule) {
        const prev = lastGroupPlayedAt.get(rule.group) || 0;
        if (now - prev < rule.ms) return false;
        lastGroupPlayedAt.set(rule.group, now);
      }
    }

    if (typeof customPlayHook === "function") {
      customPlayHook({ cueId, volume: volumePct, gain, sinkId: currentSinkId, now, opts });
    }

    const ctx = ensureContext();
    const buf = decodedCache.get(cueId);
    if (ctx && compressor && buf) {
      // Polifonia controlada: encerra a voz mais antiga se já há 3 tocando juntas.
      if (activeVoices.size >= MAX_POLYPHONY) {
        const oldest = activeVoices.values().next().value;
        if (oldest) {
          try { oldest.stop(); } catch (_) {}
          activeVoices.delete(oldest);
        }
      }
      try {
        const src = ctx.createBufferSource();
        const nodeGain = ctx.createGain();
        src.buffer = buf;
        nodeGain.gain.setValueAtTime(gain, ctx.currentTime);
        src.connect(nodeGain);
        nodeGain.connect(compressor);
        activeVoices.add(src);
        src.onended = () => activeVoices.delete(src);
        src.start(0);
        if (typeof opts.onStarted === "function") {
          opts.onStarted(() => {
            try {
              const nowT = ctx.currentTime;
              nodeGain.gain.cancelScheduledValues(nowT);
              nodeGain.gain.setValueAtTime(Math.max(0.0001, nodeGain.gain.value), nowT);
              nodeGain.gain.exponentialRampToValueAtTime(0.0001, nowT + 0.015);
              src.stop(nowT + 0.018);
            } catch (_) {
              try { src.stop(); } catch (__) {}
            }
            activeVoices.delete(src);
          });
        }
        return true;
      } catch (_) {}
    }

    // Fallback instantâneo com HTMLAudioElement (também respeita setSinkId) + dispara decode para a próxima.
    preloadCue(cueId).catch(() => {});
    const playedHtml = playHtmlAudioFallback(SOUND_ASSETS[cueId], gain);
    if (playedHtml && typeof opts.onStarted === "function") {
      opts.onStarted(() => {
        try {
          playedHtml.pause();
          playedHtml.currentTime = 0;
        } catch (_) {}
      });
    }
    if (!playedHtml && typeof opts.fallbackFn === "function") {
      try { opts.fallbackFn(gain); } catch (_) {}
    }
    return true;
  }

  function startLoop(loopName, cueId, { intervalMs = 2400, timeoutMs = 30000, volume = 100, onTimeout = null } = {}) {
    stopLoop(loopName);
    if (!SOUND_ASSETS[cueId]) return false;
    const entry = { intervalId: null, timeoutId: null, stopAudio: null };
    const tick = () => {
      if (typeof entry.stopAudio === "function") {
        try { entry.stopAudio(); } catch (_) {}
        entry.stopAudio = null;
      }
      play(cueId, {
        volume,
        ignoreCooldown: true,
        onStarted: (stopper) => {
          entry.stopAudio = stopper;
        },
      });
    };
    activeLoops.set(loopName, entry);
    tick();
    entry.intervalId = setInterval(tick, intervalMs);
    entry.timeoutId = timeoutMs > 0
      ? setTimeout(() => {
          stopLoop(loopName);
          if (typeof onTimeout === "function") onTimeout();
        }, timeoutMs)
      : null;
    return true;
  }

  function stopLoop(loopName) {
    const entry = activeLoops.get(loopName);
    if (!entry) return false;
    clearInterval(entry.intervalId);
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    if (typeof entry.stopAudio === "function") {
      try { entry.stopAudio(); } catch (_) {}
      entry.stopAudio = null;
    }
    activeLoops.delete(loopName);
    return true;
  }

  function stopAllLoops() {
    for (const name of [...activeLoops.keys()]) stopLoop(name);
  }

  function isLoopActive(loopName) {
    return activeLoops.has(loopName);
  }

  function setTestPlayHook(fn) {
    customPlayHook = typeof fn === "function" ? fn : null;
  }

  function resetForTests() {
    stopAllLoops();
    lastGroupPlayedAt.clear();
    activeVoices.clear();
    customPlayHook = null;
  }

  return {
    SOUND_ASSETS,
    SOUND_CATEGORIES,
    PRELOAD_NOTIFICATION_KEYS,
    PRELOAD_CALL_KEYS,
    MAX_POLYPHONY,
    preloadCue,
    preloadNotificationCues,
    preloadCallCues,
    applyOutputDevice,
    computeEffectiveGain,
    play,
    startLoop,
    stopLoop,
    stopAllLoops,
    isLoopActive,
    setTestPlayHook,
    resetForTests,
    getOutputDeviceId: () => currentSinkId,
  };
})();
const SanvoSoundManager = SancordSoundManager;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoSoundManager = SancordSoundManager;
  globalThis.SancordSoundManager = SancordSoundManager; // LEGACY COMPATIBILITY
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SancordSoundManager, SanvoSoundManager };
}
