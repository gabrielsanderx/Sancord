/**
 * SancordVoiceSounds (VoiceEventSoundController) — Controlador central de eventos
 * sonoros de chamadas, canais de voz, transmissão, câmera e controles locais.
 *
 * Separação explícita de políticas:
 *  - SHARED (confirmados pelo servidor via `VoiceCueEvent` com `event_id` único):
 *      voice_join, voice_leave, stream_start, stream_stop, camera_on, camera_off,
 *      call_connected, call_disconnected.
 *      (Arquitetura pronta para `sharedMute: true` no futuro se o produto decidir ativar.)
 *  - LOCAL (apenas para quem executa a ação ou recebe o toque):
 *      mute_on, mute_off, deafen_on, deafen_off, voice_reconnected, voice_error,
 *      incoming_call_loop, outgoing_call_loop.
 */
const SancordVoiceSounds = (() => {
  const EVENT_CLASSIFICATION = Object.freeze({
    // Eventos compartilhados na call
    voice_join: { scope: "shared", setting: "join" },
    voice_leave: { scope: "shared", setting: "leave" },
    stream_start: { scope: "shared", setting: "streamStart" },
    stream_stop: { scope: "shared", setting: "streamStop" },
    camera_on: { scope: "shared", setting: "camera" },
    camera_off: { scope: "shared", setting: "camera" },
    call_connected: { scope: "shared", setting: "join" },
    call_disconnected: { scope: "shared", setting: "leave" },
    // Eventos locais (não poluem a call de 10 pessoas)
    mute_on: { scope: "local", setting: "controls" },
    mute_off: { scope: "local", setting: "controls" },
    deafen_on: { scope: "local", setting: "controls", allowWhileDeafened: true },
    deafen_off: { scope: "local", setting: "controls", allowWhileDeafened: true },
    voice_reconnected: { scope: "local", setting: "join" },
    voice_error: { scope: "local", setting: "controls", allowWhileDeafened: true },
    incoming_call_loop: { scope: "local", setting: "incoming", bypassMaster: true },
    outgoing_call_loop: { scope: "local", setting: "incoming" },
  });

  const DEFAULT_PREFS = Object.freeze({
    enabled: true,
    volume: 85, // 0..100, independente do volume das pessoas na call
    ringtoneVolume: 85, // 0..100, volume específico do toque de chamadas recebidas
    join: true,
    leave: true,
    streamStart: true,
    streamStop: true,
    camera: true,
    controls: true,
    incoming: true,
    sharedMute: false, // pronto para futura ativação global se desejado
  });

  const MAX_SEEN_EVENT_IDS = 256;
  const ACTOR_SPAM_COOLDOWN_MS = 900;

  const seenEventIds = new Set();
  const seenEventOrder = [];
  const actorCategoryAt = new Map();
  let lastSessionEnteredAt = 0;

  function getPrefs() {
    const raw = (typeof state !== "undefined" && state.audioSettings?.callSounds) || {};
    const legacyVoice = typeof state !== "undefined" ? state.audioSettings?.soundVoice !== false : true;
    const baseVolume = Number.isFinite(Number(raw.volume))
      ? Math.max(0, Math.min(100, Number(raw.volume)))
      : DEFAULT_PREFS.volume;
    const ringtoneVolume = Number.isFinite(Number(raw.ringtoneVolume))
      ? Math.max(0, Math.min(100, Number(raw.ringtoneVolume)))
      : baseVolume;
    return {
      ...DEFAULT_PREFS,
      ...raw,
      enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : legacyVoice,
      volume: baseVolume,
      ringtoneVolume,
    };
  }

  function updatePrefs(patch) {
    if (typeof state === "undefined") return getPrefs();
    if (!state.audioSettings) state.audioSettings = {};
    state.audioSettings.callSounds = { ...getPrefs(), ...patch };
    if (typeof patch.enabled === "boolean") {
      state.audioSettings.soundVoice = patch.enabled;
    }
    if (typeof saveAudioSettings === "function") saveAudioSettings();
    return getPrefs();
  }

  function isDeafenedLocally() {
    if (typeof state === "undefined") return false;
    return Boolean(state.deafened || state.selfUser?.server_deafened);
  }

  function rememberEventId(eventId) {
    if (!eventId) return true;
    if (seenEventIds.has(eventId)) return false;
    seenEventIds.add(eventId);
    seenEventOrder.push(eventId);
    while (seenEventOrder.length > MAX_SEEN_EVENT_IDS) {
      const oldest = seenEventOrder.shift();
      seenEventIds.delete(oldest);
    }
    return true;
  }

  function isCueAllowed(cueId, { forcePreview = false, dmId = null } = {}) {
    const meta = EVENT_CLASSIFICATION[cueId];
    if (!meta) return false;
    if (forcePreview) return true;

    const prefs = getPrefs();
    const effVol = cueId === "incoming_call_loop" ? prefs.ringtoneVolume : prefs.volume;
    if (effVol <= 0) return false;
    if (!prefs.enabled && !meta.bypassMaster) return false;
    if (meta.setting && prefs[meta.setting] === false) return false;

    if (cueId === "incoming_call_loop") {
      if (typeof state !== "undefined" && state.audioSettings?.streamerMode) {
        return false;
      }
      // Não perturbe (DND): silencia o toque sonoro, mas mantém o aviso visual da chamada.
      if (typeof state !== "undefined" && state.selfUser?.status_kind === "dnd") {
        return false;
      }
      // Conversa silenciada: sem toque sonoro.
      if (dmId && typeof isMutedId === "function" && isMutedId(dmId)) {
        return false;
      }
    }
    // Usuário ensurdecido não recebe eventos sonoros compartilhados da call.
    if (isDeafenedLocally() && !meta.allowWhileDeafened) {
      return false;
    }
    return true;
  }

  function checkActorCooldown(actorUserId, eventType, now) {
    if (!actorUserId) return true;
    const cat = eventType.startsWith("stream_")
      ? "stream"
      : eventType.startsWith("camera_")
        ? "camera"
        : null;
    if (!cat) return true;
    const key = `${actorUserId}:${cat}`;
    const prev = actorCategoryAt.get(key) || 0;
    if (now - prev < ACTOR_SPAM_COOLDOWN_MS) return false;
    actorCategoryAt.set(key, now);
    return true;
  }

  /**
   * Processa evento compartilhado vindo do servidor (`ServerMessage::VoiceCueEvent`).
   * Valida `event_id` (deduplicação), pertencimento à mesma `voice_session_id`,
   * política de deafen, anti-spam por `actor_user_id` e preferências locais.
   */
  function handleSharedEvent(ev, opts = {}) {
    if (!ev || !ev.event_type || !ev.voice_session_id) return false;
    const meta = EVENT_CLASSIFICATION[ev.event_type];
    if (!meta || meta.scope !== "shared") return false;

    // 1. Deduplicação estrita por event_id (evita som duplicado em retry/reconnect).
    if (ev.event_id && !rememberEventId(ev.event_id)) return false;

    // 2. Ignora eventos de outros canais de voz ou quando o usuário não está em call.
    const currentChannel = typeof state !== "undefined" ? state.currentVoiceChannel : null;
    if (!currentChannel || currentChannel !== ev.voice_session_id) return false;

    // 3. Se estiver em fase de reconexão de voz, não reproduz eventos atrasados.
    if (typeof state !== "undefined" && state.voiceRecovery?.joining) return false;

    // 4. Se alguém atendeu a chamada privada, encerra imediatamente qualquer toque de chamada.
    if (ev.event_type === "call_connected" || ev.event_type === "voice_join") {
      stopOutgoingRing();
      stopIncomingRing();
    }

    // 5. Anti-spam por actor_user_id (nunca depende do nome de exibição!).
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    if (!checkActorCooldown(ev.actor_user_id, ev.event_type, now)) return false;

    // 6. Opt-out local (master toggle, categoria, deafen, volume 0%).
    if (!isCueAllowed(ev.event_type)) return false;

    const prefs = getPrefs();
    return SancordSoundManager.play(ev.event_type, { volume: prefs.volume, now });
  }

  /**
   * Reproduz feedback sonoro LOCAL (mute, deafen, conexão própria, erro, preview).
   */
  function playLocal(cueId, opts = {}) {
    const forcePreview = Boolean(opts.forcePreview);
    if (!isCueAllowed(cueId, { forcePreview })) return false;
    const prefs = getPrefs();
    const volume = forcePreview ? Math.max(prefs.volume, 60) : prefs.volume;
    return SancordSoundManager.play(cueId, {
      volume,
      ignoreCooldown: forcePreview || Boolean(opts.ignoreCooldown),
      now: opts.now,
    });
  }

  function onEnteredVoiceSession(channelId, { isReconnect = false, isOutgoingPrivateCall = false } = {}) {
    lastSessionEnteredAt = Date.now();
    if (typeof SancordSoundManager !== "undefined") {
      SancordSoundManager.applyOutputDevice(state?.audioSettings?.speakerDeviceId || "");
      SancordSoundManager.preloadCallCues();
    }
    stopIncomingRing();
    if (isReconnect) {
      playLocal("voice_reconnected", { ignoreCooldown: true });
    } else {
      playLocal("voice_join", { ignoreCooldown: true });
      if (isOutgoingPrivateCall) {
        startOutgoingRing(channelId);
      }
    }
  }

  function onLeftVoiceSession({ wasPrivateCall = false, silent = false } = {}) {
    stopOutgoingRing();
    if (silent) return false;
    return playLocal(wasPrivateCall ? "call_disconnected" : "voice_leave", { ignoreCooldown: true });
  }

  function startIncomingRing(channelId, { timeoutMs = 30000, onTimeout = null, dmId = null } = {}) {
    stopIncomingRing();
    if (!isCueAllowed("incoming_call_loop", { dmId })) return false;
    const prefs = getPrefs();
    return SancordSoundManager.startLoop("incoming", "incoming_call_loop", {
      intervalMs: 2200,
      timeoutMs,
      volume: prefs.ringtoneVolume,
      onTimeout,
    });
  }

  function stopIncomingRing() {
    return SancordSoundManager.stopLoop("incoming");
  }

  function startOutgoingRing(channelId, { timeoutMs = 30000, onTimeout = null } = {}) {
    stopOutgoingRing();
    if (!isCueAllowed("outgoing_call_loop")) return false;
    const prefs = getPrefs();
    return SancordSoundManager.startLoop("outgoing", "outgoing_call_loop", {
      intervalMs: 2600,
      timeoutMs,
      volume: Math.round(prefs.volume * 0.8),
      onTimeout,
    });
  }

  function stopOutgoingRing() {
    return SancordSoundManager.stopLoop("outgoing");
  }

  function stopAllRings() {
    stopIncomingRing();
    stopOutgoingRing();
  }

  function resetForTests() {
    seenEventIds.clear();
    seenEventOrder.length = 0;
    actorCategoryAt.clear();
    lastSessionEnteredAt = 0;
    if (typeof SancordSoundManager !== "undefined") SancordSoundManager.resetForTests();
  }

  return {
    EVENT_CLASSIFICATION,
    DEFAULT_PREFS,
    getPrefs,
    updatePrefs,
    isCueAllowed,
    handleSharedEvent,
    playLocal,
    onEnteredVoiceSession,
    onLeftVoiceSession,
    startIncomingRing,
    stopIncomingRing,
    startOutgoingRing,
    stopOutgoingRing,
    stopAllRings,
    resetForTests,
    getLastSessionEnteredAt: () => lastSessionEnteredAt,
  };
})();
const SanvoVoiceSounds = SancordVoiceSounds;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoVoiceSounds = SancordVoiceSounds;
  globalThis.SancordVoiceSounds = SancordVoiceSounds; // LEGACY COMPATIBILITY
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SancordVoiceSounds, SanvoVoiceSounds };
}
