// ============================================================================
// Sancord — Cliente WebSockets + WebRTC P2P Mesh (Voz & Compartilhamento de Tela)
// ============================================================================

const AMBIENT_IDLE_MS = 15000;
let visualWindowHidden = false;
let ambientLastInput = 0;
let ambientIdleTimer = null;

function isVisualWindowHidden() {
  return document.hidden || window.__SANVO_WINDOW_MINIMIZED === true;
}

function pauseAmbientWhenIdle() {
  ambientIdleTimer = null;
  if (!document.body.dataset.ambientFx || isVisualWindowHidden()) return;
  const remaining = AMBIENT_IDLE_MS - (performance.now() - ambientLastInput);
  if (remaining > 0) ambientIdleTimer = setTimeout(pauseAmbientWhenIdle, remaining);
  else document.documentElement.classList.add("ambient-idle");
}

function noteAmbientInput() {
  if (!document.body.dataset.ambientFx || isVisualWindowHidden()) return;
  ambientLastInput = performance.now();
  if (ambientIdleTimer === null) {
    document.documentElement.classList.remove("ambient-idle");
    ambientIdleTimer = setTimeout(pauseAmbientWhenIdle, AMBIENT_IDLE_MS);
  }
}

function syncAmbientAnimation() {
  clearTimeout(ambientIdleTimer);
  ambientIdleTimer = null;
  document.documentElement.classList.remove("ambient-idle");
  noteAmbientInput();
}

function syncVisualWindow() {
  const hidden = isVisualWindowHidden();
  if (hidden === visualWindowHidden) return;
  visualWindowHidden = hidden;
  document.documentElement.classList.toggle("visual-window-hidden", hidden);
  syncAmbientAnimation();
  document.dispatchEvent(new Event("sanvo:visual-visibility"));
}

document.addEventListener("visibilitychange", syncVisualWindow);
window.addEventListener("sanvo:window-visibility", syncVisualWindow);
for (const kind of ["pointermove", "pointerdown", "keydown", "wheel"]) {
  document.addEventListener(kind, noteAmbientInput, { passive: true });
}
syncVisualWindow();

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

const DEFAULT_AUDIO_SETTINGS = {
  micDeviceId: "",
  speakerDeviceId: "",
  cameraDeviceId: "",
  cameraQuality: "720",
  micGain: 100,
  speakerVolume: 100,
  voiceProfile: "isolation", // "isolation" | "studio" | "custom"
  inputMode: "vad", // "vad" | "ptt"
  pttKey: "Space",
  pttReleaseDelayMs: 120,
  gateThreshold: -56,
  noiseSuppressionMode: "auto", // "auto" | "light" | "standard" | "strong" | "off"
  lastActiveNsMode: "auto",
  noiseGate: false,
  highpass: true,
  compressor: true,
  aec: true,
  agc: true,
  opusHd: true,
  voiceDspPresetVersion: 3,
  screenDefaultQuality: "1080",
  screenDefaultFps: 30,
  screenDefaultAudio: true,
  soundMessages: true,
  soundVoice: true,
  notifDmBadges: true,
  soundEvents: {
    message: true,
    mention: true,
    ring: true,
    join: true,
    leave: true,
    mute: true,
    deafen: true,
    "stream-start": true,
    "stream-stop": true,
    "friend-request": true,
  },
  compactMode: false,
  showChatAvatars: true,
  showChatTimestamps: true,
  compactSidebar: false,
  chatGroupGap: 14,
  uiZoom: 100,
  customAccentColor: "",
  showProfileNameStyles: true,
  showProfileDecorations: true,
  showProfileFrames: true,
  showProfileEffects: true,
  showProfileNameplates: true,
  showProfileAnimations: true,
  appTheme: "dark", // "light" | "ash" | "dark" | "oled" | "auto"
  autoDeviceTheme: false,
  customAccentTheme: "none",
  chatFontSize: 14,
  streamerMode: false,
  glassIntensity: 60,
  ambientFx: "none", // "none" | "stars" | "cyber" | "embers" | "petals"
  uiRadius: "discord", // "discord" | "pill" | "sharp"
  voiceGlow: true,
  uiVolume: 100,
  desktopNotif: false,
  notifShowPreview: true,
  notifWhenFocused: false,
  notifTitleBadge: true,
  notifTaskbarBadge: true,
  notifDmBadges: true,
  notifFlashTaskbar: true,
  showTyping: true,
  autoEmbeds: true,
  familyFocus: false,
  linkGuard: true,
  // Acessibilidade
  uiSaturation: 100,
  highContrast: false,
  roleColorsMode: "name", // "name" | "dot" | "none"
  enhancedFocus: false,
  ttsEnabled: false,
  ttsRate: 1.0,
  ttsVolume: 100,
  // Chat e mensagens
  chatConvertEmoticons: true,
  chatInlineImages: true,
  chatAutoplayVideo: false,
  chatSpellcheck: true,
  chatEnterSends: true,
  chatGroupMessages: true,
  chatGroupWindowMins: 7,
  chatTimeFormat: "24h", // "auto" | "24h" | "12h"
  regionalDateFormat: "pt-BR", // "pt-BR" | "en-US" | "iso"
  // Atalhos customizados & Avançado
  customShortcuts: {},
  updatesAutoCheck: true,
  developerMode: false,
  logLevel: "normal",
};

function loadAudioSettings() {
  try {
    const raw = localStorage.getItem("sancord_audio_settings");
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_AUDIO_SETTINGS, ...parsed };
    // Migração segura de versões antigas e recuperação de valores inválidos.
    if (typeof SancordVoiceDspCore !== "undefined") {
      merged.noiseSuppressionMode = SancordVoiceDspCore.migrateNoiseSuppressionSetting(parsed);
      merged.lastActiveNsMode = SancordVoiceDspCore.sanitizeMode(parsed.lastActiveNsMode, "auto");
      if (merged.lastActiveNsMode === "off") merged.lastActiveNsMode = "auto";
    } else if (!["auto", "light", "standard", "strong", "off"].includes(merged.noiseSuppressionMode)) {
      merged.noiseSuppressionMode = "auto";
    }
    if (parsed && typeof parsed.agc !== "boolean") {
      merged.agc = Boolean(parsed.aec !== false);
    }
    // Calibração automática v3 (padrão estilo Discord): garante supressão limpa e limiar de voz sensível.
    if (!parsed || parsed.voiceDspPresetVersion !== 3) {
      merged.voiceProfile = "isolation";
      merged.noiseSuppressionMode = "auto";
      merged.lastActiveNsMode = "auto";
      merged.noiseGate = false;
      merged.highpass = true;
      merged.compressor = true;
      merged.aec = true;
      merged.agc = true;
      merged.opusHd = true;
      merged.gateThreshold = -56;
      merged.voiceDspPresetVersion = 3;
      try {
        localStorage.setItem("sancord_audio_settings", JSON.stringify(merged));
      } catch (_) {}
    }
    return merged;
  } catch (_) {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function saveAudioSettings() {
  try {
    localStorage.setItem("sancord_audio_settings", JSON.stringify(state.audioSettings));
  } catch (_) {}
}

let toastTimerId = null;
function showUiToast(text) {
  if (!uiToast) return;
  uiToast.textContent = text;
  uiToast.classList.remove("hidden");
  clearTimeout(toastTimerId);
  toastTimerId = setTimeout(() => {
    uiToast.classList.add("hidden");
  }, 2200);
}

function getEffectiveAppTheme(s) {
  if (s?.autoDeviceTheme || s?.appTheme === "auto") {
    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
  }
  return s?.appTheme || "dark";
}

function applyAppThemeSettings() {
  const s = state.audioSettings || DEFAULT_AUDIO_SETTINGS;
  document.body.dataset.theme = getEffectiveAppTheme(s);
  if (s.customAccentTheme && s.customAccentTheme !== "none") {
    document.body.dataset.accent = s.customAccentTheme;
  } else {
    delete document.body.dataset.accent;
  }
  if (s.customAccentColor && /^#[0-9a-f]{6}$/i.test(s.customAccentColor)) {
    document.documentElement.style.setProperty("--brand", s.customAccentColor);
  } else {
    document.documentElement.style.removeProperty("--brand");
  }
  const glass = Number.isFinite(Number(s.glassIntensity)) ? Number(s.glassIntensity) : 60;
  document.documentElement.style.setProperty("--glass-intensity", String(glass));
  const previousAmbient = document.body.dataset.ambientFx;
  if (s.ambientFx && s.ambientFx !== "none") {
    document.body.dataset.ambientFx = s.ambientFx;
  } else {
    delete document.body.dataset.ambientFx;
  }
  if (previousAmbient !== document.body.dataset.ambientFx) syncAmbientAnimation();
  document.body.dataset.radius = s.uiRadius || "discord";
  document.body.classList.toggle("voice-glow-enabled", s.voiceGlow !== false);
  document.body.classList.toggle("compact-messages", Boolean(s.compactMode));
  document.body.classList.toggle("streamer-mode", Boolean(s.streamerMode));
  document.body.classList.toggle("hide-chat-avatars", s.showChatAvatars === false);
  document.body.classList.toggle("hide-chat-timestamps", s.showChatTimestamps === false);
  document.body.classList.toggle("compact-sidebar", Boolean(s.compactSidebar));
  document.body.classList.toggle("high-contrast", Boolean(s.highContrast));
  document.body.classList.toggle("enhanced-focus", Boolean(s.enhancedFocus));
  document.body.dataset.roleColors = s.roleColorsMode || "name";
  const fs = Number(s.chatFontSize) || 14;
  document.documentElement.style.setProperty("--chat-font-size", `${fs}px`);
  const gap = Number.isFinite(Number(s.chatGroupGap)) ? Number(s.chatGroupGap) : 14;
  document.documentElement.style.setProperty("--chat-group-gap", `${gap}px`);
  const sat = Number.isFinite(Number(s.uiSaturation)) ? Math.max(0, Math.min(100, Number(s.uiSaturation))) / 100 : 1;
  document.documentElement.style.setProperty("--ui-saturation", String(sat));
  const zoom = [90, 100, 110, 125].includes(Number(s.uiZoom)) ? Number(s.uiZoom) : 100;
  document.documentElement.style.fontSize = zoom === 100 ? "" : `${zoom}%`;
  if (appearanceFontPreview) {
    appearanceFontPreview.style.fontSize = `${fs}px`;
  }
  const chatEl = document.getElementById("chat-input");
  if (chatEl) chatEl.spellcheck = s.chatSpellcheck !== false;
  document.getElementById("account-id-row")?.classList.toggle("hidden", !s.developerMode);
  document.getElementById("advanced-dev-telemetry")?.classList.toggle("hidden", !s.developerMode);
}

window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener?.("change", () => {
  if (state.audioSettings?.autoDeviceTheme || state.audioSettings?.appTheme === "auto") {
    applyAppThemeSettings();
  }
});

const state = {
  ws: null,
  selfUser: null,
  textChannels: [],
  voiceChannels: [],
  users: new Map(), // userId -> UserInfo
  voiceMembers: {}, // channelId -> [userId]
  chatHistory: {}, // channelId -> [ChatMessage]
  currentTextChannel: "geral",
  currentVoiceChannel: null,
  muted: false,
  deafened: false,
  screenSharing: false,
  cameraOn: false,
  localAudioStream: null,
  localScreenStream: null,
  localCameraStream: null,
  captureWs: null,
  selectedResolution: "1080",
  selectedFps: 60,
  selectedShareAudio: true,
  pickerSources: [],
  pickerTab: "window",
  selectedSource: null,
  peers: new Map(), // peerId -> { pc, videoStream, cameraStream, screenSenders: [], cameraSenders: [], pendingCandidates: [] }
  speakingUsers: new Set(),
  spotlightCardId: null,
  userVolumes: new Map(), // peerId -> volume (0 a 200, padrão 100)
  audioGainNodes: new Map(), // domId -> { gainNode, audioEl, peerId }
  pendingImageDataUrl: null,
  creatingChannelKind: "text",
  replyingTo: null, // { id, author_name, content }
  editingMsgId: null,
  searchQuery: "",
  typingByChannel: new Map(), // channelId -> Map(userId -> { username, timer })
  lastTypingSentAt: 0,
  audioSettings: loadAudioSettings(),
  pttHeld: false,
  recordingPttKey: false,
  micTestActive: false,
  dsp: null,
  voicePingInterval: null,
  voiceCallStartedAt: null,
  voiceCallTimerInterval: null,
  // Amigos & Mensagens Diretas (DMs)
  activeView: "server", // "server" | "home"
  homeSection: "friends", // "friends" | "starred"
  activeDmId: null, // "dm:min__max" ou null (aba Amigos)
  friendsTab: "online", // "online" | "all" | "pending" | "add"
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  dmConversations: [],
  unreadDms: new Map(), // dm_id -> count
  dmFilterQuery: "",
  friendsSearchQuery: "",
  pendingIncomingCall: null,
  activeCalls: new Map(), // voice_channel_id -> CallSnapshot (autoritativo do servidor)
  starredMsgIds: (() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("sancord_starred_msgs") || "[]"));
    } catch (_) {
      return new Set();
    }
  })(),
  ignoredUsers: (() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("sancord_ignored_users") || "[]"));
    } catch (_) {
      return new Set();
    }
  })(),
  blockedUsers: (() => {
    try {
      localStorage.removeItem("sancord_blocked_users");
    } catch (_) {}
    return new Set();
  })(),
  accountEmail: null,
  activeSessions: [],
  unreadDividerByChannel: new Map(),
  servers: [],
  // Sem hub público: começa sem servidor; o Welcome escolhe o primeiro ou abre o Início.
  activeServerId: null,
  sessionStartedAt: Date.now(),
  pendingInviteCode: new URLSearchParams(window.location.search).get("invite") || "",
};

function applySyncedUserPrefs(prefs) {
  if (!prefs || typeof prefs !== "object") return;
  const migrationPatch = {};
  if (Array.isArray(prefs.starred_messages)) {
    if (prefs.starred_messages.length === 0 && state.starredMsgIds?.size > 0) {
      migrationPatch.starred_messages = Array.from(state.starredMsgIds);
      prefs.starred_messages = migrationPatch.starred_messages;
    } else {
      state.starredMsgIds = new Set(prefs.starred_messages);
      try {
        localStorage.setItem("sancord_starred_msgs", JSON.stringify(prefs.starred_messages));
      } catch (_) {}
    }
  }
  if (Array.isArray(prefs.ignored_users)) {
    if (prefs.ignored_users.length === 0 && state.ignoredUsers?.size > 0) {
      migrationPatch.ignored_users = Array.from(state.ignoredUsers);
      prefs.ignored_users = migrationPatch.ignored_users;
    } else {
      state.ignoredUsers = new Set(prefs.ignored_users.map((u) => String(u).toLowerCase()));
      try {
        localStorage.setItem("sancord_ignored_users", JSON.stringify(prefs.ignored_users));
      } catch (_) {}
    }
  }
  if (prefs.user_notes && typeof prefs.user_notes === "object") {
    const serverKeys = Object.keys(prefs.user_notes);
    if (serverKeys.length === 0) {
      try {
        const localNotes = JSON.parse(localStorage.getItem("sancord_user_notes") || "{}");
        if (localNotes && typeof localNotes === "object" && Object.keys(localNotes).length > 0) {
          migrationPatch.user_notes = localNotes;
          prefs.user_notes = localNotes;
        }
      } catch (_) {}
    } else {
      try {
        localStorage.setItem("sancord_user_notes", JSON.stringify(prefs.user_notes));
      } catch (_) {}
    }
  }
  if (Object.keys(migrationPatch).length > 0) {
    sendWs("UpdateUserPrefs", migrationPatch);
  }
  updateHomeStarredBadge();
  if (typeof renderDmList === "function") renderDmList();
  if (state.homeSection === "starred" && typeof renderHomeStarredView === "function") renderHomeStarredView();
}

function saveStarredMessages() {
  const list = Array.from(state.starredMsgIds);
  try {
    localStorage.setItem("sancord_starred_msgs", JSON.stringify(list));
  } catch (_) {}
  if (state.prefs) {
    state.prefs.starred_messages = list;
    sendWs("UpdateUserPrefs", { starred_messages: list });
  }
  updateHomeStarredBadge();
  if (typeof renderDmList === "function") renderDmList();
  if (state.homeSection === "starred" && typeof renderHomeStarredView === "function") renderHomeStarredView();
}

function saveModerationLists() {
  const list = Array.from(state.ignoredUsers);
  try {
    localStorage.setItem("sancord_ignored_users", JSON.stringify(list));
    localStorage.removeItem("sancord_blocked_users");
  } catch (_) {}
  if (state.prefs) {
    state.prefs.ignored_users = list;
    sendWs("UpdateUserPrefs", { ignored_users: list });
  }
}

function updateHomeStarredBadge() {
  const badge = document.getElementById("home-starred-badge");
  if (!badge) return;
  const favDms = Array.isArray(state.prefs?.favorite_dms) ? state.prefs.favorite_dms.length : 0;
  const count = (state.starredMsgIds?.size || 0) + favDms;
  badge.textContent = String(count);
  badge.classList.toggle("hidden", count === 0);
}
updateHomeStarredBadge();

function getUserProfileNote(username) {
  if (!username) return "";
  const key = username.toLowerCase();
  if (state.prefs?.user_notes && typeof state.prefs.user_notes === "object" && key in state.prefs.user_notes) {
    return state.prefs.user_notes[key] || "";
  }
  try {
    const map = JSON.parse(localStorage.getItem("sancord_user_notes") || "{}");
    return map[key] || "";
  } catch (_) {
    return "";
  }
}

function setUserProfileNote(username, note) {
  if (!username) return;
  const key = username.toLowerCase();
  const clean = (note || "").trim();
  const map = { ...(state.prefs?.user_notes || {}) };
  try {
    const localMap = JSON.parse(localStorage.getItem("sancord_user_notes") || "{}");
    Object.assign(map, localMap, state.prefs?.user_notes || {});
  } catch (_) {}
  if (clean) map[key] = clean;
  else delete map[key];
  try {
    localStorage.setItem("sancord_user_notes", JSON.stringify(map));
  } catch (_) {}
  if (state.prefs) {
    state.prefs.user_notes = map;
    sendWs("UpdateUserPrefs", { user_notes: map });
  }
}

function getActiveTextChannelId() {
  if (state.activeView === "home" && state.activeDmId) {
    return state.activeDmId;
  }
  return state.currentTextChannel;
}

// Sintetizador de efeitos sonoros estilo Discord (Web Audio API)
let uiAudioCtx = null;
function playUiSound(kind, opts = {}) {
  const forcePreview = Boolean(opts?.forcePreview);
  if (!forcePreview) {
    if ((state.deafened || state.selfUser?.status_kind === "dnd") && kind !== "deafen") return;
    if ((kind === "message" || kind === "dm-message" || kind === "message_received" || kind === "mention" || kind === "friend-request") && (state.audioSettings?.soundMessages === false || state.audioSettings?.streamerMode)) return;
    if ((kind === "join" || kind === "leave" || kind === "mute" || kind === "unmute" || kind === "deafen" || kind === "stream-start" || kind === "stream-stop" || kind === "ring") && state.audioSettings?.soundVoice === false) return;
    const evKey = kind === "unmute" ? "mute" : ((kind === "dm-message" || kind === "message_received") ? "message" : kind);
    if (state.audioSettings?.soundEvents && state.audioSettings.soundEvents[evKey] === false) return;
  }
  if (opts?.viaNotificationManager && typeof SancordSoundManager !== "undefined") {
    return;
  }
  try {
    if (!uiAudioCtx) {
      uiAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (uiAudioCtx.state === "suspended") {
      uiAudioCtx.resume();
    }
    const now = uiAudioCtx.currentTime;

    const rawVol = state.audioSettings?.uiVolume ?? 100;
    const volMult = Math.max(0, Math.min(1.5, rawVol / 100));
    if (volMult === 0 && !forcePreview) return;
    const effectiveVol = volMult || 0.7;

    if ((kind === "dm-message" || kind === "message" || kind === "message_received") && typeof SancordSoundManager !== "undefined" && typeof SancordSoundManager.play === "function") {
      SancordSoundManager.play("message_received", {
        volume: forcePreview ? Math.max(rawVol, 70) : rawVol,
        ignoreCooldown: forcePreview,
        fallbackFn: () => {
          if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.synthesizeSancordDmChime === "function") {
            SancordNotifications.synthesizeSancordDmChime(uiAudioCtx, effectiveVol);
          }
        },
      });
      return;
    }

    const tone = (freq, startOffset, duration, vol = 0.08, type = "sine") => {
      const scaled = Math.max(0.002, vol * effectiveVol);
      const osc = uiAudioCtx.createOscillator();
      const gain = uiAudioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(scaled, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(uiAudioCtx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    switch (kind) {
      case "join":
        tone(440, 0, 0.11, 0.09, "triangle");
        tone(587.33, 0.09, 0.16, 0.09, "triangle");
        break;
      case "leave":
        tone(523.25, 0, 0.11, 0.08, "triangle");
        tone(349.23, 0.09, 0.16, 0.08, "triangle");
        break;
      case "mute":
        tone(480, 0, 0.07, 0.06, "sine");
        tone(360, 0.06, 0.09, 0.06, "sine");
        break;
      case "unmute":
        tone(360, 0, 0.07, 0.06, "sine");
        tone(520, 0.06, 0.09, 0.06, "sine");
        break;
      case "deafen":
        tone(340, 0, 0.08, 0.07, "triangle");
        tone(240, 0.07, 0.13, 0.07, "triangle");
        break;
      case "ring":
        tone(659.25, 0, 0.12, 0.08, "sine");
        tone(783.99, 0.14, 0.14, 0.08, "sine");
        tone(987.77, 0.28, 0.18, 0.08, "sine");
        break;
      case "stream-start":
        tone(440, 0, 0.08, 0.07, "triangle");
        tone(554.37, 0.07, 0.08, 0.07, "triangle");
        tone(659.25, 0.14, 0.18, 0.08, "triangle");
        break;
      case "stream-stop":
        tone(587.33, 0, 0.09, 0.07, "triangle");
        tone(440, 0.08, 0.14, 0.07, "triangle");
        break;
      case "friend-request":
        tone(587.33, 0, 0.08, 0.07, "triangle");
        tone(880, 0.09, 0.14, 0.08, "triangle");
        break;
      case "dm-message":
        if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.synthesizeSancordDmChime === "function") {
          SancordNotifications.synthesizeSancordDmChime(uiAudioCtx, effectiveVol);
        } else {
          tone(659.25, 0, 0.11, 0.065, "sine");
          tone(880.0, 0.07, 0.15, 0.07, "sine");
        }
        break;
      case "mention":
        tone(880, 0, 0.08, 0.075, "sine");
        tone(1174.66, 0.08, 0.12, 0.075, "sine");
        break;
      case "message":
        if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.synthesizeSancordDmChime === "function") {
          SancordNotifications.synthesizeSancordDmChime(uiAudioCtx, effectiveVol * 0.85);
        } else {
          tone(740, 0, 0.06, 0.035, "sine");
        }
        break;
    }
  } catch (_) {}
}

// Fila sequencial para processar mensagens WebSocket na ordem exata sem condição de corrida
let wsMessageQueue = Promise.resolve();

// Elementos da DOM
const appLayout = document.getElementById("app-layout");
const loginModal = document.getElementById("login-modal");
const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const tabRegister = document.getElementById("tab-register");
const tabLogin = document.getElementById("tab-login");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authErrorEl = document.getElementById("auth-error");
const wsStatusDot = document.getElementById("ws-status-dot");

const textChannelsList = document.getElementById("text-channels-list");
const voiceChannelsList = document.getElementById("voice-channels-list");
const membersList = document.getElementById("members-list");
const onlineCountTitle = document.getElementById("online-count-title");

const currentTextChannelTitle = document.getElementById("current-text-channel-title");
const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const pinnedMsgsBtn = document.getElementById("pinned-msgs-btn");
const pinnedCountBadge = document.getElementById("pinned-count-badge");
const pinnedPopover = document.getElementById("pinned-popover");
const pinnedPopoverList = document.getElementById("pinned-popover-list");
const toggleMembersBtn = document.getElementById("toggle-members-btn");
const chatSearchInput = document.getElementById("chat-search-input");
const replyPreviewBar = document.getElementById("reply-preview-bar");
const replyPreviewText = document.getElementById("reply-preview-text");
const cancelReplyBtn = document.getElementById("cancel-reply-btn");
const emojiPickerBtn = document.getElementById("emoji-picker-btn");
const emojiPopover = document.getElementById("emoji-popover");
const typingIndicatorEl = document.getElementById("typing-indicator");

const selfProfileTrigger = document.getElementById("self-profile-trigger");
const selfAvatar = document.getElementById("self-avatar");
const selfStatusDot = document.getElementById("self-status-dot");
const selfUsername = document.getElementById("self-username");
const selfStatusText = document.getElementById("self-status-text");
const toggleMuteBtn = document.getElementById("toggle-mute-btn");
const toggleDeafenBtn = document.getElementById("toggle-deafen-btn");
const openSettingsBtn = document.getElementById("open-settings-btn");

const voiceConnectionPanel = document.getElementById("voice-connection-panel");
const voiceSignalBox = document.getElementById("voice-signal-box");
const activeVoiceChannelName = document.getElementById("active-voice-channel-name");
const quickKrispBtn = document.getElementById("quick-krisp-btn");
const leaveVoiceBtn = document.getElementById("leave-voice-btn");
const toggleCameraBtn = document.getElementById("toggle-camera-btn");
const cameraBtnLabel = document.getElementById("camera-btn-label");
const shareScreenBtn = document.getElementById("share-screen-btn");
const screenBtnLabel = document.getElementById("screen-btn-label");
const micQuickChevron = document.getElementById("mic-quick-chevron");
const spkQuickChevron = document.getElementById("spk-quick-chevron");
const quickDevicePopover = document.getElementById("quick-device-popover");
const quickDeviceTitle = document.getElementById("quick-device-title");
const quickDeviceList = document.getElementById("quick-device-list");
const avatarFileInput = document.getElementById("avatar-file-input");

// Configurações Modal & Perfil Popover
const settingsModal = document.getElementById("settings-modal");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsLogoutBtn = document.getElementById("settings-logout-btn");
const settingsNavProfileCard = document.getElementById("settings-nav-profile-card");
const settingsNavAvatar = document.getElementById("settings-nav-avatar");
const settingsNavUsername = document.getElementById("settings-nav-username");
const settingsSearchInput = document.getElementById("settings-search-input");
const settingsTopbarTitle = document.getElementById("settings-topbar-title");
const settingsAvatarPreview = document.getElementById("settings-avatar-preview");
const settingsChangeAvatarBtn = document.getElementById("settings-change-avatar-btn");
const settingsStatusSelect = document.getElementById("settings-status-select");
const settingsCustomStatus = document.getElementById("settings-custom-status");
const settingsBioInput = document.getElementById("settings-bio-input");
const unsavedProfileBar = document.getElementById("unsaved-profile-bar");
const resetProfileDraftBtn = document.getElementById("reset-profile-draft-btn");
const saveProfileBtn = document.getElementById("save-profile-btn");
const voiceCallTimerEl = document.getElementById("voice-call-timer");
const changePasswordModal = document.getElementById("change-password-modal");
const micDeviceSelect = document.getElementById("mic-device-select");
const cameraDeviceSelect = document.getElementById("camera-device-select");
const cameraQualitySelect = document.getElementById("camera-quality-select");
const speakerDeviceSelect = document.getElementById("speaker-device-select");
const micGainSlider = document.getElementById("mic-gain-slider");
const micGainValue = document.getElementById("mic-gain-value");
const masterSpeakerSlider = document.getElementById("master-speaker-slider");
const masterSpeakerValue = document.getElementById("master-speaker-value");
const micTestBtn = document.getElementById("mic-test-btn");
const micBarsMeter = document.getElementById("mic-bars-meter");
const micMeterFill = document.getElementById("mic-meter-fill");
const micMeterThreshold = document.getElementById("mic-meter-threshold");
const pttKeyRow = document.getElementById("ptt-key-row");
const pttKeyDisplay = document.getElementById("ptt-key-display");
const pttRecordBtn = document.getElementById("ptt-record-btn");
const gateThresholdSlider = document.getElementById("gate-threshold-slider");
const gateThresholdValue = document.getElementById("gate-threshold-value");
const dspNoiseGateToggle = document.getElementById("dsp-noise-gate");
const dspHighpassToggle = document.getElementById("dsp-highpass");
const dspCompressorToggle = document.getElementById("dsp-compressor");
const dspAecToggle = document.getElementById("dsp-aec");
const dspOpusHdToggle = document.getElementById("dsp-opus-hd");
const resetLocalAudioBtn = document.getElementById("reset-local-audio-btn");
const notifSoundMessagesToggle = document.getElementById("notif-sound-messages");
const notifSoundVoiceToggle = document.getElementById("notif-sound-voice");
const appearanceCompactToggle = document.getElementById("appearance-compact-mode");
const appearanceAutoDeviceToggle = document.getElementById("appearance-auto-device");
const appearanceFontSlider = document.getElementById("appearance-font-slider");
const appearanceFontValue = document.getElementById("appearance-font-value");
const appearanceFontPreview = document.getElementById("appearance-font-preview");
const appearanceStreamerToggle = document.getElementById("appearance-streamer-mode");
const toggleAccentPaletteBtn = document.getElementById("toggle-accent-palette-btn");
const appearanceAccentSection = document.getElementById("appearance-accent-section");

const profilePopoverModal = document.getElementById("profile-popover-modal");
const profileCardBanner = document.getElementById("profile-card-banner");
const profileCardAvatar = document.getElementById("profile-card-avatar");
const profileCardStatusDot = document.getElementById("profile-card-status-dot");
const profileCardName = document.getElementById("profile-card-name");
const profileCardHandle = document.getElementById("profile-card-handle");
const profileCardCustomStatus = document.getElementById("profile-card-custom-status");
const profileCardMemberSince = document.getElementById("profile-card-member-since");
const profileCardFriendsSinceRow = document.getElementById("profile-card-friends-since-row");
const profileCardFriendsSince = document.getElementById("profile-card-friends-since");
const profileCardBio = document.getElementById("profile-card-bio");
const profileCardNoteInput = document.getElementById("profile-card-note-input");
const profileCardVolumeWrap = document.getElementById("profile-card-volume-wrap");
const profileCardVolPct = document.getElementById("profile-card-vol-pct");
const profileCardVolSlider = document.getElementById("profile-card-vol-slider");
const profileCardActions = document.getElementById("profile-card-actions");
const profileCardDmBtn = document.getElementById("profile-card-dm-btn");
const profileCardFriendBtn = document.getElementById("profile-card-friend-btn");
const profileCardMoreBtn = document.getElementById("profile-card-more-btn");
const profileCardMoreMenu = document.getElementById("profile-card-more-menu");
const profileMutualFriendsLabel = document.getElementById("profile-mutual-friends-label");
const profileMutualServersLabel = document.getElementById("profile-mutual-servers-label");
const profileActivityCardList = document.getElementById("profile-activity-card-list");
const profileMutualFriendsList = document.getElementById("profile-mutual-friends-list");
const profileMutualServersList = document.getElementById("profile-mutual-servers-list");

const msgContextMenu = document.getElementById("msg-context-menu");
const forwardMsgModal = document.getElementById("forward-msg-modal");
const forwardMsgPreview = document.getElementById("forward-msg-preview");
const forwardTargetsList = document.getElementById("forward-targets-list");
const cancelForwardBtn = document.getElementById("cancel-forward-btn");
const uiToast = document.getElementById("ui-toast");

// Navegação Home / Amigos / Mensagens Diretas (DMs)
const railHomeWrap = document.getElementById("rail-home-wrap");
const railServerWrap = document.getElementById("rail-server-wrap");
const navHomeBtn = document.getElementById("nav-home-btn");
const navServerBtn = document.getElementById("nav-server-btn");
const homeNotifBadge = document.getElementById("home-notif-badge");

const sidebarServerView = document.getElementById("sidebar-server-view");
const sidebarHomeView = document.getElementById("sidebar-home-view");
const dmFilterInput = document.getElementById("dm-filter-input");
const openFriendsTabBtn = document.getElementById("open-friends-tab-btn");
const friendsPendingBadge = document.getElementById("friends-pending-badge");
const dmNewAddBtn = document.getElementById("dm-new-add-btn");
const dmListEl = document.getElementById("dm-list");

const friendsMainView = document.getElementById("friends-main-view");
const chatMainView = document.getElementById("chat-main-view");
const friendsPendingPill = document.getElementById("friends-pending-pill");
const friendsAddPane = document.getElementById("friends-add-pane");
const friendsListPane = document.getElementById("friends-list-pane");
const addFriendForm = document.getElementById("add-friend-form");
const addFriendInput = document.getElementById("add-friend-input");
const addFriendFeedback = document.getElementById("add-friend-feedback");
const quickAddMembersList = document.getElementById("quick-add-members-list");
const friendsSearchInput = document.getElementById("friends-search-input");
const friendsListCount = document.getElementById("friends-list-count");
const friendsItemsList = document.getElementById("friends-items-list");

const chatHeaderIcon = document.getElementById("chat-header-icon");
const chatChannelTopic = document.getElementById("chat-channel-topic");
const dmCallBtn = document.getElementById("dm-call-btn");
const dmCallBtnLabel = document.getElementById("dm-call-btn-label");
const serverMembersPanel = document.getElementById("server-members-panel");
const dmPeerPanel = document.getElementById("dm-peer-panel");

const dmCallToast = document.getElementById("dm-call-toast");
const dmCallToastAvatar = document.getElementById("dm-call-toast-avatar");
const dmCallToastName = document.getElementById("dm-call-toast-name");
const dmCallAcceptBtn = document.getElementById("dm-call-accept-btn");
const dmCallDismissBtn = document.getElementById("dm-call-dismiss-btn");

const QUALITY_PROFILES = {
  "720": { width: 1280, height: 720, maxBitrate: 4500000, label: "720p HD" },
  "1080": { width: 1920, height: 1080, maxBitrate: 9000000, label: "1080p FHD" },
  "1440": { width: 2560, height: 1440, maxBitrate: 16000000, label: "1440p 2K" },
  "2160": { width: 3840, height: 2160, maxBitrate: 28000000, label: "4K UHD" },
};

function getSelectedQualityProfile() {
  const resKey = state.selectedResolution || "1080";
  const fps = parseInt(state.selectedFps || 60, 10);
  const base = QUALITY_PROFILES[resKey] || QUALITY_PROFILES["1080"];
  return { ...base, fps };
}

const SVG_ICONS = Object.fromEntries(Object.entries({hash:'hash',speaker:'voice',micOn:'mic',micOff:'mic-off',headOn:'headphones',headOff:'headphones-off',micOffTiny:'mic-off',headOffTiny:'headphones-off'}).map(([key,name]) => [key,SancordIcons.html(name)]));

const voiceStage = document.getElementById("voice-stage");
const stageTitle = document.getElementById("stage-title");
const stageGrid = document.getElementById("stage-grid");
const toggleStageBtn = document.getElementById("toggle-stage-btn");
const remoteAudioContainer = document.getElementById("remote-audio-container");
const guildRailList = document.getElementById("guild-rail-list");
const openAddServerBtn = document.getElementById("open-add-server-btn");
const serverTitleEl = document.getElementById("server-title");
const openServerSettingsBtn = document.getElementById("open-server-settings-btn");
const leaveServerBtn = document.getElementById("leave-server-btn");
const copyInviteBtn = document.getElementById("copy-invite-btn");
const copyInviteLabel = document.getElementById("copy-invite-label");

const appearanceGlassSlider = document.getElementById("appearance-glass-slider");
const appearanceGlassValue = document.getElementById("appearance-glass-value");
const appearanceAmbientFxSelect = document.getElementById("appearance-ambient-fx-select");
const appearanceRadiusSelect = document.getElementById("appearance-radius-select");
const appearanceVoiceGlowToggle = document.getElementById("appearance-voice-glow");
const notifDesktopToggle = document.getElementById("notif-desktop-alerts");
const notifUiVolumeSlider = document.getElementById("notif-ui-volume-slider");
const notifUiVolumeValue = document.getElementById("notif-ui-volume-value");
const notifTestSoundBtn = document.getElementById("notif-test-sound-btn");
const privacyTypingToggle = document.getElementById("privacy-typing-indicator");
const privacyAutoEmbedsToggle = document.getElementById("privacy-auto-embeds");
const exportSettingsBtn = document.getElementById("export-settings-btn");
const clearLocalNotesBtn = document.getElementById("clear-local-notes-btn");
const shortcutsPttBadge = document.getElementById("shortcuts-ptt-badge");
const shortcutsGotoVoiceBtn = document.getElementById("shortcuts-goto-voice-btn");

const screenShareModal = document.getElementById("screen-share-modal");
const pickerTabWindows = document.getElementById("picker-tab-windows");
const pickerTabMonitors = document.getElementById("picker-tab-monitors");
const pickerSourcesGrid = document.getElementById("picker-sources-grid");
const refreshSourcesBtn = document.getElementById("refresh-sources-btn");
const pickerAudioCheckbox = document.getElementById("picker-audio-checkbox");
const cancelScreenPickerBtn = document.getElementById("cancel-screen-picker-btn");
const startStreamConfirmBtn = document.getElementById("start-stream-confirm-btn");

const addTextChannelBtn = document.getElementById("add-text-channel-btn");
const addVoiceChannelBtn = document.getElementById("add-voice-channel-btn");
const createChannelModal = document.getElementById("create-channel-modal");
const createChannelTitle = document.getElementById("create-channel-title");
const createChannelDesc = document.getElementById("create-channel-desc");
const createChannelForm = document.getElementById("create-channel-form");
const newChannelNameInput = document.getElementById("new-channel-name-input");
const cancelChannelBtn = document.getElementById("cancel-channel-btn");

const imagePreviewBar = document.getElementById("image-preview-bar");
const imagePreviewThumb = document.getElementById("image-preview-thumb");
const removeImageBtn = document.getElementById("remove-image-btn");
const imageFileInput = document.getElementById("image-file-input");
const attachImageBtn = document.getElementById("attach-image-btn");

const imageLightboxModal = document.getElementById("image-lightbox-modal");
const lightboxImg = document.getElementById("lightbox-img");
const closeLightboxBtn = document.getElementById("close-lightbox-btn");

async function resolvePublicOriginUrl() {
  let targetUrl = SancordNet.origin;
  if (targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1")) {
    try {
      const res = await SancordNet.fetch("/api/public-url", { cache: "no-store" });
      const data = await res.json();
      if (data?.url) return data.url;
    } catch (_) {}
  }
  return targetUrl;
}

function getActiveServer() {
  return (
    (state.servers || []).find((s) => s.id === state.activeServerId) ||
    (state.servers || [])[0] ||
    null
  );
}

function isServerOwner(srv, username) {
  if (!srv || !username || !srv.owner_username) return false;
  return srv.owner_username.toLowerCase() === username.toLowerCase();
}

function getUserServerRoles(srv, username) {
  if (!srv || !username) return [];
  const lower = username.toLowerCase();
  const ids = srv.member_roles?.[lower] || [];
  return (srv.roles || [])
    .filter((r) => ids.includes(r.id))
    .sort((a, b) => (b.position || 0) - (a.position || 0));
}

function getServerPermissionsFor(srv, username) {
  if (!srv || !username) {
    return {
      administrator: false, manage_server: false, manage_roles: false,
      manage_channels: srv?.id === "sancord", kick_members: false, ban_members: false,
      manage_messages: false, mention_everyone: false, send_messages: true,
      attach_files: true, connect_voice: true, speak_voice: true, stream_video: true, create_invites: true, manage_invites: false,
    };
  }
  const lower = username.toLowerCase();
  if (isServerOwner(srv, lower)) {
    return {
      administrator: true, manage_server: true, manage_roles: true, manage_channels: true,
      kick_members: true, ban_members: true, manage_messages: true, mention_everyone: true,
      send_messages: true, attach_files: true, connect_voice: true, speak_voice: true,
      stream_video: true, create_invites: true, manage_invites: true,
      mute_members: true, deafen_members: true, move_members: true, view_audit_log: true, moderate_members: true,
      change_nickname: true, manage_nicknames: true, manage_expressions: true,
    };
  }
  const everyone = (srv.roles || []).find((r) => r.id === "everyone")?.permissions || {};
  const perms = {
    administrator: false, manage_server: false, manage_roles: false,
    manage_channels: srv.id === "sancord" && !srv.owner_username,
    kick_members: false, ban_members: false, manage_messages: false, mention_everyone: false,
    send_messages: true, attach_files: true, connect_voice: true, speak_voice: true,
    stream_video: true, create_invites: true, manage_invites: false,
    mute_members: false, deafen_members: false, move_members: false, view_audit_log: false, moderate_members: false,
    change_nickname: true, manage_nicknames: false, manage_expressions: false,
    ...everyone,
  };
  for (const role of getUserServerRoles(srv, lower)) {
    const p = role.permissions || {};
    if (p.administrator) {
      return {
        administrator: true, manage_server: true, manage_roles: true, manage_channels: true,
        kick_members: true, ban_members: true, manage_messages: true, mention_everyone: true,
        send_messages: true, attach_files: true, connect_voice: true, speak_voice: true,
        stream_video: true, create_invites: true, manage_invites: true,
        mute_members: true, deafen_members: true, move_members: true, view_audit_log: true, moderate_members: true,
      change_nickname: true, manage_nicknames: true, manage_expressions: true,
      };
    }
    for (const k of Object.keys(perms)) {
      if (p[k]) perms[k] = true;
    }
  }
  return perms;
}

function canUserEditServer(srv, username) {
  if (!srv || !username) return false;
  if (isServerOwner(srv, username)) return true;
  const p = getServerPermissionsFor(srv, username);
  return Boolean(p.administrator || p.manage_server || p.manage_roles || p.manage_channels || p.manage_invites || p.kick_members || p.ban_members || p.view_audit_log || p.moderate_members || p.manage_expressions);
}

function renderGuildRail() {
  // Barra com ordem personalizada, pastas, arrastar e soltar (static/js/servers.js).
  renderGuildRailV2();
}

function syncActiveServerHeaderAndControls() {
  const srv = getActiveServer();
  const me = state.selfUser?.username;
  if (serverTitleEl && srv) {
    serverTitleEl.textContent = srv.name || "Sanvo";
  }
  const canEdit = canUserEditServer(srv, me) && Boolean(srv?.owner_username || srv?.id !== "sancord");
  const isCustomNonOwner = Boolean(srv && srv.id !== "sancord" && !isServerOwner(srv, me));
  const perms = getServerPermissionsFor(srv, me);

  openServerSettingsBtn?.classList.toggle("hidden", !canEdit);
  leaveServerBtn?.classList.toggle("hidden", !isCustomNonOwner);
  addTextChannelBtn?.classList.toggle("hidden", !perms.manage_channels);
  addVoiceChannelBtn?.classList.toggle("hidden", !perms.manage_channels);
  copyInviteBtn?.classList.toggle("hidden", !perms.create_invites);
}

function switchToServerId(serverId, preferredTextChId = null) {
  const srv = (state.servers || []).find((s) => s.id === serverId) || (state.servers || [])[0];
  if (srv) {
    state.activeServerId = srv.id;
    state.textChannels = srv.text_channels || [];
    state.voiceChannels = srv.voice_channels || [];
    const allChannels = [...state.textChannels, ...state.voiceChannels];
    const validPreferred = preferredTextChId && allChannels.some((c) => c.id === preferredTextChId);
    const keepCurrent = allChannels.some((c) => c.id === state.currentTextChannel);
    if (validPreferred) {
      state.currentTextChannel = preferredTextChId;
    } else if (!keepCurrent) {
      state.currentTextChannel = firstTextChannelId(srv) || "";
    }
  }
  renderGuildRail();
  syncActiveServerHeaderAndControls();
  renderVoiceChannels();
  renderMembersSidebar();
  switchToServerView();
  // Eventos do servidor (Fase 8): atualiza o contador ao trocar de servidor.
  if (srv && typeof requestServerEvents === "function") requestServerEvents(srv.id);
  if (srv && typeof requestServerThreads === "function") requestServerThreads(srv.id);
}

copyInviteBtn?.addEventListener("click", () => openInviteServerModal());

// ============================================================================
// 1. Conexão WebSocket com o Backend Rust (Axum)
// ============================================================================

// ---------------------------------------------------------------------------
// Sessão ativa, persistente ou temporária conforme a preferência da pessoa.
// ---------------------------------------------------------------------------
function getStoredToken() {
  if (!SancordNet.secureForAuth) return null;
  return SancordSessions.get(localStorage, "sancord_token") || SancordSessions.get(sessionStorage, "sancord_token");
}

function getStoredUsername() {
  return SancordSessions.get(localStorage, "sancord_username") || SancordSessions.get(sessionStorage, "sancord_username");
}

function remembersActiveSession() {
  return Boolean(SancordSessions.get(localStorage, "sancord_token"));
}

function storeSession(token, username, remember) {
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  SancordSessions.remove(other, "sancord_token");
  SancordSessions.remove(other, "sancord_username");
  return Promise.all([
    SancordSessions.set(store, "sancord_token", token),
    SancordSessions.set(store, "sancord_username", username || ""),
    SancordSelfProfileMenu.registerSavedAccount({ token, username, remember }),
  ]).then(([storedToken]) => storedToken === true);
}

function clearStoredSession() {
  state.sanotedAccountId = null;
  window.Sanoted?.bind(null);
  for (const storage of [localStorage, sessionStorage]) {
    SancordSessions.remove(storage, "sancord_token");
    SancordSessions.remove(storage, "sancord_username");
  }
}

// ---------------------------------------------------------------------------
// Conexão em tempo real com reconexão automática (backoff exponencial + jitter)
// ---------------------------------------------------------------------------
function sendWs(type, payload) {
  return SancordConnection.send(type, payload);
}

function sendChatPayload(payload) {
  return SancordOutbox.enqueue(payload);
}

// Toast de erro com ação opcional (separado do toast informativo).
let errorToastEl = null;
let errorToastTimer = null;
function showErrorToast(text, { detail = "", actionLabel = "", onAction = null, duration = 8000 } = {}) {
  if (!errorToastEl) {
    errorToastEl = document.createElement("div");
    errorToastEl.className = "ui-error-toast hidden";
    errorToastEl.setAttribute("role", "alert");
    document.body.appendChild(errorToastEl);
  }
  errorToastEl.innerHTML = `
    <div class="ui-error-toast-body">
      <strong class="ui-error-toast-title"></strong>
      <span class="ui-error-toast-detail"></span>
    </div>
    <div class="ui-error-toast-actions">
      ${actionLabel ? `<button type="button" class="ui-error-toast-action"></button>` : ""}
      <button type="button" class="ui-error-toast-close" aria-label="Fechar">✕</button>
    </div>`;
  errorToastEl.querySelector(".ui-error-toast-title").textContent = text;
  errorToastEl.querySelector(".ui-error-toast-detail").textContent = detail;
  const hide = () => errorToastEl.classList.add("hidden");
  if (actionLabel) {
    const btn = errorToastEl.querySelector(".ui-error-toast-action");
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      hide();
      onAction?.();
    });
  }
  errorToastEl.querySelector(".ui-error-toast-close").addEventListener("click", hide);
  errorToastEl.classList.remove("hidden");
  clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(hide, duration);
}

// Erros inesperados de JS vão para o console (logs técnicos), não para a interface.
window.addEventListener("error", (e) => console.error("[Sancord] Erro não tratado:", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error("[Sancord] Promessa rejeitada:", e.reason));

// ---------------------------------------------------------------------------
// Histórico paginado: ao rolar até o topo, carrega mensagens mais antigas.
// ---------------------------------------------------------------------------
function getHistoryState(chId) {
  if (!state.historyState) state.historyState = new Map();
  if (!state.historyState.has(chId)) {
    const list = state.chatHistory?.[chId] || [];
    // Se veio uma página cheia no Welcome, provavelmente há mais no servidor.
    state.historyState.set(chId, { loading: false, hasMore: list.length >= (state.historyPageSize || 50) });
  }
  return state.historyState.get(chId);
}

function requestOlderMessages() {
  const chId = getActiveTextChannelId();
  if (!chId || (state.searchQuery || "").trim()) return;
  const hs = getHistoryState(chId);
  if (hs.loading || !hs.hasMore) return;
  const list = state.chatHistory?.[chId] || [];
  const oldest = list[0];
  if (!oldest) return;
  requestHistoryPage(chId, { before_id: oldest.id });
}

function handleMessagesPage(payload) {
  // Páginas antigas, novas e janelas ao redor de uma mensagem: static/js/chat.js.
  return handleMessagesPageV2(payload);
}

function handleMessagesPageLegacy(payload) {
  const { channel_id, messages, has_more } = payload;
  const hs = getHistoryState(channel_id);
  hs.loading = false;
  hs.hasMore = Boolean(has_more);
  chatMessagesEl.classList.remove("is-loading-history");
  const current = state.chatHistory[channel_id] || [];
  const known = new Set(current.map((m) => m.id));
  const older = (messages || []).filter((m) => !known.has(m.id));
  state.chatHistory[channel_id] = [...older, ...current];
  if (channel_id === getActiveTextChannelId() && older.length > 0) {
    // Mantém a posição visual: o conteúdo cresce para cima.
    const prevHeight = chatMessagesEl.scrollHeight;
    const prevTop = chatMessagesEl.scrollTop;
    renderChatMessages({ preserveScroll: true });
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight - prevHeight + prevTop;
  }
}

chatMessagesEl?.addEventListener("scroll", () => {
  if (chatMessagesEl.scrollTop < 120) requestOlderMessages();
}, { passive: true });

// O projeto virou Sanvo: mensagens de sistema antigas (gravadas como "Sancord" / "Sancord Bot")
// aparecem com o nome novo em todo lugar, sem reescrever o histórico salvo.
const LEGACY_SYSTEM_AUTHORS = { Sancord: "Sanvo", "Sancord Bot": "Sanvo Bot" };
function renameLegacySystemAuthors(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) renameLegacySystemAuthors(item, depth + 1);
    return;
  }
  if (Object.hasOwn(LEGACY_SYSTEM_AUTHORS, value.author_name) &&
      (value.author_id === "system" || value.author_kind === "System" || value.author_kind === "system")) {
    value.author_name = LEGACY_SYSTEM_AUTHORS[value.author_name];
  }
  for (const key in value) {
    const child = value[key];
    if (child && typeof child === "object") renameLegacySystemAuthors(child, depth + 1);
  }
}

async function handleServerMessage(msg) {
  const { type, payload, cached = false } = msg;
  renameLegacySystemAuthors(payload);

  switch (type) {
    case "AuthFailed": {
      SancordConnection.reject(payload?.message);
      break;
    }

    case "ChatAccepted": {
      SancordOutbox.acknowledge(payload.nonce, true);
      break;
    }

    case "MessagesPage": {
      handleMessagesPage(payload);
      break;
    }

    case "SendFailed": {
      if (!SancordOutbox.reject(payload.nonce, payload.message)) showErrorToast(payload.message || "Não foi possível enviar a mensagem.");
      break;
    }

    case "ScheduledMessages": {
      receiveScheduledMessages(payload);
      break;
    }

    case "UserPrefsUpdated": {
      onUserPrefsUpdated(payload);
      renderPrivacySettings();
      break;
    }

    case "ReadStateUpdated": {
      onReadStateUpdated(payload);
      break;
    }

    case "PinnedMessages": {
      onPinnedMessages(payload);
      break;
    }

    case "InviteCreated": {
      await onInviteCreated(payload);
      break;
    }

    case "InvitesList": {
      await onInvitesList(payload);
      break;
    }

    case "SanotedChanged": {
      window.Sanoted?.remoteChanged();
      break;
    }

    case "Welcome": {
      const accountChanged = state.selfUser?.username?.toLowerCase() !== payload.user?.username?.toLowerCase();
      state.awaitingReconnectSocial = !cached && !accountChanged && SancordConnection.restoredView();
      const activeDmHistory = state.awaitingReconnectSocial && state.activeDmId ? state.chatHistory[state.activeDmId] : null;
      state.reconnectViewport = !cached && !accountChanged ? captureHistoryViewport() : null;
      state.prefs = payload.prefs || { guild_layout: [], muted_servers: [], collapsed_categories: [] };
      applySyncedUserPrefs(state.prefs);
      if (typeof scheduleMuteExpiry === "function") scheduleMuteExpiry();
      state.historyPageSize = payload.history_page_size || 50;
      state.historyState = new Map();
      state.selfUser = payload.user;
      state.sanotedAccountId = payload.account_id || null;
      window.Sanoted?.bind(state.sanotedAccountId);
      SancordOutbox.bind(payload.user?.username);
      state.composerCapabilities = new Set(payload.composer_capabilities || []);
      resetBoardEditorOnAccountChange();
      resetCollectionOnAccountChange();
      resetProfileSharing();
      try {
        // Mantém o nome salvo em sincronia (usado só para exibição) e registra no seletor de contas.
        const remembered = remembersActiveSession();
        const store = remembered ? localStorage : sessionStorage;
        const curTok = getStoredToken();
        SancordSessions.set(store, "sancord_username", payload.user?.username || "");
        if (!cached && curTok && payload.user?.username && typeof SancordSelfProfileMenu !== "undefined") {
          SancordSelfProfileMenu.registerSavedAccount({
            id: payload.user.id,
            username: payload.user.username,
            display_name: payload.user.display_name,
            avatar_color: payload.user.avatar_color,
            avatar_url: payload.user.avatar_url,
            token: curTok,
            remember: remembered,
          });
        }
      } catch (_) {}
      state.servers = payload.servers || [];
      const activeSrv =
        state.servers.find((s) => s.id === state.activeServerId) || state.servers[0];
      state.activeServerId = activeSrv?.id || null;
      state.textChannels = activeSrv?.text_channels || [];
      state.voiceChannels = activeSrv?.voice_channels || [];
      state.voiceMembers = payload.voice_members;
      state.iceServers = payload.ice_servers || [];
      state.chatHistory = payload.chat_history || {};
      if (activeDmHistory) state.chatHistory[state.activeDmId] = activeDmHistory;
      onWelcomeReadStates(payload.read_states);
      const currentThread = state.threadIndex?.get(state.currentTextChannel);
      if (![...state.textChannels, ...state.voiceChannels].some(c => c.id === (currentThread?.parent_id || state.currentTextChannel))) {
        state.currentTextChannel = firstTextChannelId(activeSrv) || "";
      }

      state.users.clear();
      for (const u of payload.users) {
        state.users.set(u.id, u);
      }

      updateSelfProfileUI();
      renderGuildRail();
      syncActiveServerHeaderAndControls();
      renderTextChannels();
      renderVoiceChannels();
      renderMembersSidebar();
      updatePinnedBadge();
      refreshAudioDeviceLists();
      if (state.activeView !== "home") {
        applyChannelHeader(activeSrv, state.textChannels.find((c) => c.id === state.currentTextChannel) || state.voiceChannels.find((c) => c.id === state.currentTextChannel));
      }
      onChannelOpened(state.activeView === "home" ? state.activeDmId : getActiveTextChannelId());
      if (state.composerCapabilities.has("scheduling_v1")) sendWs("ListScheduledMessages");
      if (!activeDmHistory) renderChatMessages();
      refreshUnreadIndicators();
      if (!cached) applyDeepLinkFromUrl();
      // Fase 8: threads e eventos do servidor aberto.
      if (typeof requestServerThreads === "function") requestServerThreads(state.activeServerId);
      if (typeof requestServerEvents === "function") requestServerEvents(state.activeServerId);

      if (state.pendingInviteCode) {
        const code = state.pendingInviteCode;
        state.pendingInviteCode = "";
        setTimeout(() => {
          if (window.SancordInvites?.openInvitePreview) {
            window.SancordInvites.openInvitePreview(code);
          } else {
            openAddServerWizard("join", code);
          }
        }, 250);
      }
      // Conta sem servidor nenhum (não existe mais hub automático): abre o Início.
      if (!activeSrv && (accountChanged || state.activeView === "server")) {
        if (accountChanged) {
          state.friendsSearchQuery = "";
          if (friendsSearchInput) friendsSearchInput.value = "";
        }
        switchToHomeFriendsView(accountChanged ? "online" : null);
      }
      if (typeof SancordActivity !== "undefined") {
        SancordActivity.init();
        SancordActivity.syncToServer(true);
      }
      break;
    }

    case "SelfUpdated": {
      if (payload.user) {
        if (state.currentVoiceChannel && !payload.user.voice_channel_id) leaveVoiceChannel();
        state.selfUser = payload.user;
        updateSelfProfileUI();
        renderMembersSidebar();
        syncSettingsModalFields();
        if (typeof SancordActivity !== "undefined") SancordActivity.onSelfStatusChanged();
      }
      break;
    }

    case "ServersSync": {
      for (const server of payload.servers || []) reconcileServerAccess(state.servers.find(s => s.id === server.id), server);
      state.servers = payload.servers || [];
      const srv = getActiveServer();
      if (srv) {
        state.activeServerId = srv.id;
        state.textChannels = srv.text_channels || [];
        state.voiceChannels = srv.voice_channels || [];
      }
      renderGuildRail();
      if (state.activeView === "home" && !state.activeDmId) renderFriendsView();
      syncActiveServerHeaderAndControls();
      renderTextChannels();
      renderVoiceChannels();
      renderMembersSidebar();
      refreshServerSettingsModalIfOpen();
      break;
    }

    case "ServerCreated": {
      const { server, history, default_channel_id } = payload;
      if (server) {
        const idx = state.servers.findIndex((s) => s.id === server.id);
        if (idx >= 0) state.servers[idx] = server;
        else state.servers.push(server);
      }
      if (history) {
        state.chatHistory = { ...state.chatHistory, ...history };
      }
      if (server) {
        switchToServerId(server.id, default_channel_id || server.text_channels?.[0]?.id || null);
        showUiToast(`Entrou em ${server.name}!`);
      }
      break;
    }

    case "ServerMemberJoined": {
      const msg = payload?.message;
      if (msg && msg.channel_id) {
        if (!state.chatHistory[msg.channel_id]) state.chatHistory[msg.channel_id] = [];
        if (!state.chatHistory[msg.channel_id].some((m) => m.id === msg.id)) {
          state.chatHistory[msg.channel_id].push(msg);
          if (state.activeView === "server" && state.currentTextChannel === msg.channel_id && typeof appendMessageToDOM === "function") {
            appendMessageToDOM(msg);
          }
        }
      }
      break;
    }

    case "ServerUpdated": {
      const { server } = payload;
      if (!server) break;
      const idx = state.servers.findIndex((s) => s.id === server.id);
      const previous = state.servers[idx];
      reconcileServerAccess(previous || null, server);
      const profilesChanged = previous && (
        JSON.stringify(previous.member_nicks) !== JSON.stringify(server.member_nicks) ||
        JSON.stringify(previous.member_profiles) !== JSON.stringify(server.member_profiles)
      );
      if (idx >= 0) state.servers[idx] = server;
      else state.servers.push(server);

      if (state.activeServerId === server.id) {
        state.textChannels = server.text_channels || [];
        state.voiceChannels = server.voice_channels || [];
        let channelChanged = false;
        const stillExists = state.textChannels.some((c) => c.id === state.currentTextChannel) ||
          state.voiceChannels.some((c) => c.id === state.currentTextChannel);
        if (!stillExists) {
          state.currentTextChannel = firstTextChannelId(server) || "";
          channelChanged = true;
        }
        syncActiveServerHeaderAndControls();
        renderTextChannels();
        renderVoiceChannels();
        renderMembersSidebar();
        if (state.activeView === "server") {
          if (channelChanged) {
            switchToServerView();
          } else {
            const ch = state.textChannels.find((c) => c.id === state.currentTextChannel) ||
              state.voiceChannels.find((c) => c.id === state.currentTextChannel);
            if (ch) currentTextChannelTitle.textContent = ch.name;
            applyChannelHeader(server, ch);
            if (profilesChanged) renderChatMessages({ preserveScroll: true });
          }
        }
        // Fórum aberto: tags (filtro e etiquetas) podem ter mudado.
        if (state.forumViewChannel && typeof renderForumPosts === "function") renderForumPosts();
      }
      if (profilesChanged) refreshVisitedServerProfile(server.id);
      renderGuildRail();
      refreshServerSettingsModalIfOpen();
      break;
    }

    case "ServerProfileUpdated": {
      const { server_id, username, profile } = payload;
      const srv = state.servers.find(s => s.id === server_id);
      if (!srv || !username) break;
      const lower = username.toLowerCase();
      if (profile) srv.member_profiles = { ...srv.member_profiles, [lower]: profile };
      else if (srv.member_profiles) delete srv.member_profiles[lower];
      if (lower === state.selfUser?.username?.toLowerCase() &&
          !document.getElementById("profile-subtab-server")?.classList.contains("hidden")) {
        window.refreshServerProfileSettings?.();
      }
      if (state.activeView === "server" && state.activeServerId === server_id) {
        renderMembersSidebar();
        renderChatMessages({ preserveScroll: true });
      }
      if (currentPopoverUsername?.toLowerCase() === lower) refreshVisitedServerProfile(server_id);
      if (typeof currentCompactProfile !== "undefined" && currentCompactProfile?.serverId === server_id &&
          currentCompactProfile?.username?.toLowerCase() === lower && typeof refreshVisibleProfiles === "function") {
        refreshVisibleProfiles(username);
      }
      break;
    }

    case "ServerAccessUpdated": {
      const { server, history = {}, read_states = [] } = payload;
      let restored = false;
      for (const [id, messages] of Object.entries(history)) {
        if (!Object.hasOwn(state.chatHistory, id)) {
          state.chatHistory[id] = messages;
          state.historyState?.delete(id);
          restored = true;
        }
      }
      for (const rs of read_states) state.readStates.set(rs.channel_id, { last_read_at: rs.last_read_at, mention_count: rs.mention_count });
      await handleServerMessage({ type: "ServerUpdated", payload: { server } });
      for (const channel of server.text_channels || []) {
        if (channel.effective_permissions?.read_history !== false && !Object.hasOwn(state.chatHistory, channel.id)) {
          const hs = getHistoryState(channel.id);
          if (!hs.loading) requestHistoryPage(channel.id);
        }
      }
      if (restored && state.activeView === "server" && state.activeServerId === server.id) renderChatMessages();
      refreshUnreadIndicators();
      break;
    }

    case "ServerRemoved": {
      const { server_id, reason } = payload;
      state.servers = state.servers.filter((s) => s.id !== server_id);
      if (currentPopoverServerId === server_id) profilePopoverModal?.classList.add("hidden");
      if (serverSettingsModal && !serverSettingsModal.classList.contains("hidden") && editingServerId === server_id) {
        serverSettingsModal.classList.add("hidden");
      }
      if (state.activeServerId === server_id) {
        if (state.servers.length) switchToServerId(state.servers[0].id);
        else {
          state.activeServerId = null;
          state.textChannels = [];
          state.voiceChannels = [];
          renderGuildRail();
          switchToHomeFriendsView();
        }
      } else {
        renderGuildRail();
        if (state.activeView === "home" && !state.activeDmId) renderFriendsView();
      }
      if (reason) showUiToast(reason);
      break;
    }

    case "ServerFeedback": {
      const { ok, message: fbMsg, action } = payload;
      if (action === "schedule_message") receiveScheduleResult(ok);
      if (action === "profile_board") {
        handleBoardSaveFailure(fbMsg);
        break;
      }
      if (action === "profile_sharing") {
        setProfileSharingFeedback(fbMsg);
        break;
      }
      if (action === "badge_admin") {
        if (typeof setBadgeAdminFeedback === "function") setBadgeAdminFeedback(fbMsg);
        break;
      }
      if (action === "cosmetic_collection") {
        collectionStatus.textContent = fbMsg;
        if (!ok) showErrorToast(fbMsg);
        break;
      }
      if (action === "update_email_code" && ok) {
        promptAccountEmailCode(fbMsg);
        break;
      }
      showUiToast(fbMsg);
      if (action === "join_voice" && !ok) {
        onJoinVoiceRejected();
        if (typeof SancordVoiceSounds !== "undefined") SancordVoiceSounds.playLocal("voice_error");
      } else if (action === "voice_state" && !ok && typeof SancordVoiceSounds !== "undefined") {
        SancordVoiceSounds.playLocal("voice_error");
      }
      if (action === "change_password") {
        const pwFb = document.getElementById("account-pw-feedback");
        if (ok) {
          if (pwFb) pwFb.className = "add-friend-feedback hidden";
          document.getElementById("account-password-form")?.reset();
          changePasswordModal?.classList.add("hidden");
        } else if (pwFb) {
          pwFb.textContent = fbMsg;
          pwFb.className = "add-friend-feedback err";
          pwFb.classList.remove("hidden");
        }
      } else if (action === "update_username") {
        const renFb = document.getElementById("account-rename-feedback");
        if (renFb) {
          renFb.textContent = fbMsg;
          renFb.className = `add-friend-feedback ${ok ? "ok" : "err"}`;
          renFb.classList.remove("hidden");
        }
      } else if (action === "join_invite") {
        const jFb = document.getElementById("join-srv-feedback");
        if (jFb) {
          jFb.textContent = fbMsg;
          jFb.className = `add-friend-feedback ${ok ? "ok" : "err"}`;
          jFb.classList.remove("hidden");
        }
      } else if (action === "update_server") {
        const sFb = document.getElementById("srv-edit-feedback");
        if (sFb) {
          sFb.textContent = fbMsg;
          sFb.className = `add-friend-feedback ${ok ? "ok" : "err"}`;
          sFb.classList.remove("hidden");
        }
      }
      break;
    }

    case "UserJoined": {
      state.users.set(payload.user.id, payload.user);
      cacheMemberRosterUser(payload.user);
      if (state.selfUser && payload.user.id === state.selfUser.id) {
        state.selfUser = payload.user;
        updateSelfProfileUI();
      }
      renderVoiceChannels();
      renderMembersSidebar();
      if (typeof SancordNotifications !== "undefined") SancordNotifications.renderRailUnreadDms();
      break;
    }

    case "UserLeft": {
      const leaving = state.users.get(payload.user_id);
      if (leaving) cacheMemberRosterUser(leaving);
      state.users.delete(payload.user_id);
      closePeerConnection(payload.user_id);
      renderVoiceChannels();
      renderMembersSidebar();
      renderVoiceStage();
      break;
    }

    case "NewChatMessage": {
      const { message } = payload;
      if (message.nonce && isOwnMessage(message)) SancordOutbox.acknowledge(message.nonce);
      if (!state.chatHistory[message.channel_id]) {
        state.chatHistory[message.channel_id] = [];
      }
      if (state.chatHistory[message.channel_id].some((m) => m.id === message.id)) break;
      if (typeof SancordNotifications !== "undefined" && message.id && typeof SancordNotifications.hasProcessedMessage === "function" && SancordNotifications.hasProcessedMessage(message.id)) break;
      if (message.author_id === state.selfUser?.id) noteOwnMessageForSlowmode(message.channel_id);
      clearUserTyping(message.channel_id, message.author_id);
      // Não lidas/menções/notificação; numa janela de histórico antiga não emenda a mensagem.
      let appendable = onNewMessageForUnread(message);
      let trimmed = false;
      if (appendable) {
        const cached = cacheIncomingChatMessage(message);
        appendable = cached.stored;
        trimmed = cached.trimmed;
      }

      const viewingThisChannel = message.channel_id === getActiveTextChannelId() &&
        !(state.activeView === "home" && !state.activeDmId);
      if (viewingThisChannel && appendable) {
        if (trimmed) appendChatMessageAtCapacity(message);
        else appendChatMessageUI(message);
        updatePinnedBadge();
        maybeAckActiveChannel();
      } else if (viewingThisChannel) {
        updateJumpPresentBar();
      }

      if (!isOwnMessage(message)) {
        if (typeof SancordNotifications !== "undefined") {
          SancordNotifications.handleIncomingSound(message);
        } else {
          const policy = notificationPolicy(message);
          if (policy.sound) {
            playUiSound(policy.mention ? "mention" : "message");
          }
        }
      }
      break;
    }

    case "MessageUpdated": {
      const { message } = payload;
      const list = state.chatHistory[message.channel_id];
      if (list) {
        const idx = list.findIndex((m) => m.id === message.id);
        if (idx !== -1) list[idx] = message;
      }
      if (message.channel_id === getActiveTextChannelId()) {
        updateChatMessageUI(message);
        updatePinnedBadge();
        if (!pinnedPopover.classList.contains("hidden")) {
          renderPinnedPopover();
        }
      }
      break;
    }

    case "MessageDeleted": {
      const { channel_id, message_id } = payload;
      let deletedMsg = null;
      if (state.chatHistory[channel_id]) {
        deletedMsg = state.chatHistory[channel_id].find((m) => m.id === message_id) || null;
        state.chatHistory[channel_id] = state.chatHistory[channel_id].filter(
          (m) => m.id !== message_id
        );
      }
      if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.onMessageDeleted === "function") {
        SancordNotifications.onMessageDeleted(channel_id, message_id, deletedMsg);
      }
      if (channel_id === getActiveTextChannelId()) {
        chatMessagesEl.querySelector(`[data-msg-id="${message_id}"]`)?.remove();
        updatePinnedBadge();
        if (!pinnedPopover.classList.contains("hidden")) {
          renderPinnedPopover();
        }
      }
      break;
    }

    case "MessagesBulkDeleted": {
      const { channel_id, message_ids = [] } = payload;
      const idSet = new Set(message_ids);
      const deletedById = new Map();
      if (state.chatHistory[channel_id]) {
        for (const m of state.chatHistory[channel_id]) {
          if (idSet.has(m.id)) deletedById.set(m.id, m);
        }
        state.chatHistory[channel_id] = state.chatHistory[channel_id].filter(
          (m) => !idSet.has(m.id)
        );
      }
      if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.onMessageDeleted === "function") {
        for (const id of message_ids) {
          SancordNotifications.onMessageDeleted(channel_id, id, deletedById.get(id) || null);
        }
      }
      if (channel_id === getActiveTextChannelId()) {
        renderChatMessages({ preserveScroll: true });
        updatePinnedBadge();
        if (!pinnedPopover.classList.contains("hidden")) {
          renderPinnedPopover();
        }
      }
      break;
    }

    case "AccountEmailUpdated": {
      state.accountEmail = payload?.email || null;
      renderAccountEmailUI();
      break;
    }

    case "SessionsList": {
      state.activeSessions = payload?.sessions || [];
      renderAccountSessionsUI();
      break;
    }

    case "RecoveryCodeGenerated": {
      const code = payload?.recovery_code || "";
      if (code) {
        SancordUI.confirm({
          title: "🔑 Seu código único de recuperação",
          message: `Guarde este código em um local seguro (ele só funciona uma única vez e substitui qualquer código anterior):\n\n${code}`,
          confirmLabel: "Copiar código",
          cancelLabel: "Fechar",
        }).then((ok) => {
          if (ok) copyTextSafe(code, "Código de recuperação copiado!");
        });
      }
      break;
    }

    case "ChannelCreated": {
      const { channel, server_id } = payload;
      const srv = state.servers.find((s) => s.id === (server_id || "sancord"));
      if (srv) {
        // Anúncios e fórum também ficam na lista de texto (como no servidor).
        if (channel.kind !== "voice") {
          if (!srv.text_channels.some((c) => c.id === channel.id)) {
            srv.text_channels.push(channel);
          }
        } else {
          if (!srv.voice_channels.some((c) => c.id === channel.id)) {
            srv.voice_channels.push(channel);
          }
        }
      }
      if (!server_id || server_id === state.activeServerId) {
        if (channel.kind === "text") {
          if (!state.textChannels.some((c) => c.id === channel.id)) {
            state.textChannels.push(channel);
            state.chatHistory[channel.id] = state.chatHistory[channel.id] || [];
          }
          renderTextChannels();
        } else {
          if (!state.voiceChannels.some((c) => c.id === channel.id)) {
            state.voiceChannels.push(channel);
            state.voiceMembers[channel.id] = state.voiceMembers[channel.id] || [];
          }
          renderVoiceChannels();
        }
      }
      break;
    }

    case "ChannelDeleted": {
      const { channel_id, kind, server_id } = payload;
      const srv = state.servers.find((s) => s.id === (server_id || "sancord"));
      if (srv) {
        if (kind === "text") {
          srv.text_channels = (srv.text_channels || []).filter((c) => c.id !== channel_id);
        } else {
          srv.voice_channels = (srv.voice_channels || []).filter((c) => c.id !== channel_id);
        }
      }
      if (!server_id || server_id === state.activeServerId) {
        if (kind === "text") {
          state.textChannels = state.textChannels.filter((c) => c.id !== channel_id);
          delete state.chatHistory[channel_id];
          if (state.currentTextChannel === channel_id) {
            state.currentTextChannel = state.textChannels[0]?.id || "geral";
            if (state.activeView === "server") {
              const fallback = state.textChannels.find((c) => c.id === state.currentTextChannel);
              currentTextChannelTitle.textContent = fallback ? fallback.name : "geral";
              renderChatMessages();
            }
          }
          renderTextChannels();
        } else {
          state.voiceChannels = state.voiceChannels.filter((c) => c.id !== channel_id);
          delete state.voiceMembers[channel_id];
          delete state.chatHistory[channel_id];
          if (state.currentVoiceChannel === channel_id) {
            leaveVoiceChannel();
          }
          if (state.currentTextChannel === channel_id) {
            state.currentTextChannel = state.textChannels[0]?.id || "geral";
            if (state.activeView === "server") {
              switchToServerView();
            }
          }
          renderVoiceChannels();
        }
      }
      break;
    }

    case "UserTyping": {
      const { channel_id, user_id, username } = payload;
      if (user_id === state.selfUser?.id) break;
      registerUserTyping(channel_id, user_id, username);
      break;
    }

    case "FriendsSync": {
      const resync = state.awaitingReconnectSocial;
      state.awaitingReconnectSocial = false;
      state.friends = payload.friends || [];
      state.incomingRequests = payload.incoming_requests || [];
      state.outgoingRequests = payload.outgoing_requests || [];
      state.dmConversations = payload.dm_conversations || [];
      applySocialSync(payload);

      if (payload.dm_history) {
        for (const [dmId, msgs] of Object.entries(payload.dm_history)) {
          if (resync || !state.chatHistory[dmId]?.length) state.chatHistory[dmId] = msgs;
        }
      }

      updateHomeNotificationBadges();
      renderDmList();
      if (state.activeView === "home") {
        if (state.activeDmId) {
          const dmId = state.activeDmId;
          if (!findPrivateConv(dmId) && !findGroupDm(dmId)) {
            delete state.chatHistory[dmId];
            switchToHomeFriendsView();
            break;
          }
          updateActiveDmHeaderAndSidebar();
          if (resync && payload.dm_history && !state.pendingHistoryRestore && !getHistoryState(dmId).hasNewer) {
            renderChatMessages({ preserveScroll: true });
          }
        } else if (state.homeSection === "starred") {
          renderHomeStarredView();
        } else {
          renderFriendsView();
        }
      }
      if (friendsTabIsAdd()) {
        renderQuickAddMembers();
      }
      updateDmCallButtonUI();
      break;
    }

    case "FriendFeedback": {
      if (addFriendFeedback) {
        addFriendFeedback.textContent = payload.message;
        addFriendFeedback.className = `add-friend-feedback ${payload.ok ? "ok" : "err"}`;
      }
      if (payload.ok && addFriendInput) {
        addFriendInput.value = "";
      }
      break;
    }

    case "DmOpened": {
      const { dm_id, peer, messages } = payload;
      state.chatHistory[dm_id] = messages || [];
      openDmConversation(dm_id, peer);
      // "Ligar" do menu do membro: abre a conversa e entra na chamada dela.
      if (state.pendingCallPeer && state.pendingCallPeer === String(peer?.username || "").toLowerCase()) {
        state.pendingCallPeer = null;
        const voiceId = getDmVoiceIdFromDmId(dm_id);
        if (state.currentVoiceChannel !== voiceId) joinVoiceChannel(voiceId, getFriendlyVoiceName(voiceId));
      }
      break;
    }

    case "DmCallIncoming": {
      if (typeof showIncomingCallToast === "function") {
        showIncomingCallToast(payload);
      } else {
        const { dm_id, voice_channel_id, from_username, from_color, from_avatar } = payload;
        state.pendingIncomingCall = { dm_id, voice_channel_id, from_username };
        if (dmCallToastAvatar) {
          dmCallToastAvatar.style.background = from_color || "#5865f2";
          dmCallToastAvatar.innerHTML = renderAvatarInner(from_username, from_avatar);
        }
        const callGroup = dm_id?.startsWith("gdm:") ? findGroupDm(dm_id) : null;
        if (dmCallToastName) {
          dmCallToastName.textContent = callGroup ? `${from_username} • ${groupDisplayName(callGroup)}` : from_username;
        }
        dmCallToast?.classList.remove("hidden");
        startIncomingRing(voice_channel_id);
      }
      break;
    }

    case "CallStateUpdated": {
      if (typeof onCallStateUpdated === "function") onCallStateUpdated(payload);
      break;
    }

    case "ActiveCallsSync": {
      if (typeof onActiveCallsSync === "function") onActiveCallsSync(payload);
      break;
    }

    case "CallAnswered": {
      if (typeof onCallAnswered === "function") onCallAnswered(payload);
      break;
    }

    case "CallRingTimeout": {
      if (typeof onCallRingTimeout === "function") onCallRingTimeout(payload);
      break;
    }

    case "CallCanceled": {
      if (typeof onCallCanceled === "function") onCallCanceled(payload);
      break;
    }

    case "VoiceMoved": {
      onVoiceMoved(payload);
      break;
    }

    case "CallDeclined": {
      onCallDeclined(payload);
      break;
    }

    case "CallEnded": {
      onCallEnded(payload);
      break;
    }

    case "VoiceStateSync": {
      state.voiceMembers = payload.voice_members;
      // Perfil P1 (tempo real): mudou a aparência de alguém? Redesenha o chat aberto.
      const looks = (u) => JSON.stringify([u.avatar_url, u.avatar_decoration, u.name_style, u.name_color,
        u.name_color_secondary, u.name_gradient_direction, u.nameplate_style, u.display_name, u.bio, u.banner_url,
        u.profile_frame, u.profile_effect, u.theme_primary, u.theme_accent, u.theme_highlight, u.theme_mode, u.theme_direction,
        u.badges]);
      const before = new Map([...state.users.values()].map((u) => [u.id, looks(u)]));
      state.users.clear();
      let looksChanged = false;
      let selfLookChanged = false;
      for (const u of payload.users) {
        state.users.set(u.id, u);
        cacheMemberRosterUser(u);
        const changed = before.has(u.id) && before.get(u.id) !== looks(u);
        if (changed) {
          looksChanged = true;
          if (profilePopoverModal && !profilePopoverModal.classList.contains("hidden") &&
            currentPopoverUsername?.toLowerCase() === u.username.toLowerCase()) {
            renderVisitedProfile({ ...visitedProfileBase, ...u, ...profileAppearanceForWire(u) }, u.username, currentPopoverUserId);
          }
        }
        if (state.selfUser && u.id === state.selfUser.id) {
          state.selfUser = u;
          selfLookChanged = changed;
        }
      }
      if (looksChanged) renderChatMessages({ preserveScroll: true });
      if (selfLookChanged) renderCollectionInventory();
      confirmVoiceRecovery();
      updateSelfProfileUI();
      applyLocalMuteState();
      updateServerModerationUI();
      renderVoiceChannels();
      renderMembersSidebar();
      renderVoiceStage();
      updateDmCallButtonUI();
      if (state.activeView === "home" && !state.activeDmId) {
        if (state.homeSection === "starred") renderHomeStarredView();
        else renderFriendsView();
      }
      if (friendsTabIsAdd()) {
        renderQuickAddMembers();
      }
      break;
    }

    case "PeerJoinedVoice": {
      const { peer } = payload;
      if (peer.id !== state.selfUser?.id && state.currentVoiceChannel === payload.channel_id) {
        clearUnansweredCallTimer();
        if (typeof SancordVoiceSounds !== "undefined") SancordVoiceSounds.stopOutgoingRing();
        await initiateOfferToPeer(peer.id);
      }
      break;
    }

    case "PeerLeftVoice": {
      closePeerConnection(payload.peer_id);
      renderVoiceStage();
      break;
    }

    case "VoiceCueEvent": {
      if (typeof SancordVoiceSounds !== "undefined") {
        SancordVoiceSounds.handleSharedEvent(payload);
      }
      break;
    }

    case "WebRtcOffer": {
      await handleWebRtcOffer(payload.from_id, payload.sdp);
      break;
    }

    case "WebRtcAnswer": {
      await handleWebRtcAnswer(payload.from_id, payload.sdp);
      break;
    }

    case "WebRtcIceCandidate": {
      await handleWebRtcIceCandidate(payload.from_id, payload.candidate);
      break;
    }

    case "UserProfile": {
      onUserProfile(payload);
      break;
    }
    case "ProfileSharingState": {
      receiveProfileSharing(payload);
      break;
    }
    case "BadgeAdminState": {
      if (typeof receiveBadgeAdminState === "function") receiveBadgeAdminState(payload);
      break;
    }
    case "ProfilePresentationChanged": {
      refreshVisibleProfiles(payload.username);
      break;
    }
    case "ProfileBoardState": {
      receiveBoardEditorState(payload.board);
      break;
    }
    case "ProfileBoardSaved": {
      receiveBoardEditorState(payload.board, true);
      break;
    }

    case "AuditLog": {
      onAuditLog(payload);
      break;
    }

    case "AutoModSettings": {
      onAutoModSettings(payload);
      break;
    }

    case "CosmeticsState": {
      if (typeof onCosmeticsState === "function") onCosmeticsState(payload);
      break;
    }
    case "CosmeticCollectionUpdated": {
      onCosmeticCollectionUpdated(payload.collection);
      break;
    }
    case "ProfileLookApplied": {
      onProfileLookApplied(payload.appearance);
      break;
    }

    case "UserActivityUpdated": {
      const targetLower = String(payload.username || "").toLowerCase();
      const act = payload.activity || null;
      if (state.selfUser && state.selfUser.username?.toLowerCase() === targetLower) {
        state.selfUser.activity = act;
        if (typeof onBoardEditorChanged === "function" && boardEditor?.draft) onBoardEditorChanged();
      }
      for (const u of state.users.values()) {
        if (u.username?.toLowerCase() === targetLower) u.activity = act;
      }
      for (const f of state.friends || []) {
        if (f.username?.toLowerCase() === targetLower) f.activity = act;
      }
      renderMembersSidebar();
      if (state.activeView === "home" && !state.activeDmId) renderActiveNowPanel();
      if (visitedProfileBase && visitedProfileBase.username?.toLowerCase() === targetLower && !profilePopoverModal?.classList.contains("hidden")) {
        visitedProfileBase = { ...visitedProfileBase, activity: act };
        const sk = visitedProfileBase.status_kind || (visitedProfileBase.online ? "online" : "offline");
        populateProfileActivity(visitedProfileBase, payload.user_id, sk);
        if (typeof refreshVisitedBoardActivity === "function") refreshVisitedBoardActivity(act);
      }
      break;
    }

    case "SearchResults": {
      if (typeof onInboxResults === "function" && onInboxResults(payload)) break;
      onSearchResults(payload);
      break;
    }

    case "MessageContext": {
      if (typeof onMessageContext === "function") onMessageContext(payload);
      break;
    }

    case "ServerEvents": {
      onServerEvents(payload);
      break;
    }

    case "ThreadList": {
      onThreadList(payload);
      break;
    }

    case "ThreadUpdated": {
      onThreadUpdated(payload);
      break;
    }

    case "ThreadCreated": {
      onThreadCreated(payload);
      break;
    }

    case "ThreadDeleted": {
      onThreadDeleted(payload);
      break;
    }

    case "GroupDmOpened": {
      openGroupConversation(payload.group_id);
      break;
    }
  }
}

// ============================================================================
// 2. Motor de Áudio DSP (Supressor de Ruído, Gate, Compressor, Mic Test) & WebRTC
// ============================================================================

async function refreshAudioDeviceLists() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === "audioinput");
    const speakers = devices.filter((d) => d.kind === "audiooutput");
    const cameras = devices.filter((d) => d.kind === "videoinput");

    if (cameraDeviceSelect) {
      cameraDeviceSelect.innerHTML = `<option value="">Padrão do Sistema</option>`;
      cameras.forEach((d, idx) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Câmera ${idx + 1}`;
        cameraDeviceSelect.appendChild(opt);
      });
      const selected = state.audioSettings.cameraDeviceId || "";
      if (selected && !cameras.some(d => d.deviceId === selected)) {
        const unavailable = document.createElement("option");
        unavailable.value = selected;
        unavailable.textContent = "Câmera selecionada indisponível";
        cameraDeviceSelect.appendChild(unavailable);
      }
      cameraDeviceSelect.value = selected;
    }

    if (micDeviceSelect) {
      micDeviceSelect.innerHTML = `<option value="">Padrão do Sistema</option>`;
      mics.forEach((d, idx) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microfone ${idx + 1}`;
        micDeviceSelect.appendChild(opt);
      });
      micDeviceSelect.value = state.audioSettings.micDeviceId || "";
    }

    if (speakerDeviceSelect) {
      speakerDeviceSelect.innerHTML = `<option value="">Padrão do Sistema</option>`;
      speakers.forEach((d, idx) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Saída de Áudio ${idx + 1}`;
        speakerDeviceSelect.appendChild(opt);
      });
      speakerDeviceSelect.value = state.audioSettings.speakerDeviceId || "";
    }
  } catch (_) {}
}

const NS_MODE_LABELS = {
  auto: "Automático",
  light: "Leve",
  standard: "Padrão",
  strong: "Forte",
  off: "Desligado",
};
const NS_MODE_DESCS = {
  auto: "Ajusta a intensidade automaticamente de acordo com seu ambiente.",
  light: "Preserva ao máximo a naturalidade da voz em ambientes mais silenciosos.",
  standard: "Equilíbrio entre voz natural e redução eficiente de ruído.",
  strong: "Maior redução para ambientes barulhentos (ventilador, teclado, rua).",
  off: "Bypass verdadeiro: não aplica supressão de ruído.",
};

function currentNoiseSuppressionMode() {
  const raw = state.audioSettings?.noiseSuppressionMode;
  if (typeof SancordVoiceDspCore !== "undefined") return SancordVoiceDspCore.sanitizeMode(raw, "auto");
  return NS_MODE_LABELS[raw] ? raw : "auto";
}

function updateNoiseSuppressionUi() {
  const mode = currentNoiseSuppressionMode();
  const sel = document.getElementById("dsp-ns-mode");
  const desc = document.getElementById("dsp-ns-mode-desc");
  const note = document.getElementById("dsp-ns-strong-note");
  const nsPill = document.getElementById("mic-ns-pill");
  const abBtn = document.getElementById("mic-test-ab-btn");
  if (sel) sel.value = mode;
  if (desc) desc.textContent = NS_MODE_DESCS[mode] || NS_MODE_DESCS.auto;
  if (note) note.classList.toggle("hidden", mode !== "strong");
  if (nsPill) {
    const abRaw = Boolean(state.micTestActive && state.micTestAbRaw);
    const active = mode !== "off" && !abRaw;
    nsPill.textContent = abRaw
      ? "A/B: Sem supressão (bruto)"
      : active
        ? `Supressão ativa · ${NS_MODE_LABELS[mode]}`
        : "Supressão desligada";
    nsPill.classList.toggle("is-active", active);
  }
  if (abBtn) {
    abBtn.classList.toggle("hidden", !state.micTestActive);
    const raw = Boolean(state.micTestAbRaw);
    abBtn.setAttribute("aria-pressed", String(raw));
    abBtn.textContent = raw ? "Comparar A/B: Sem supressão (bruto)" : "Comparar A/B: Com supressão";
  }
}

function renderDspDiagnostics(diag) {
  const vadPill = document.getElementById("mic-vad-pill");
  const clipPill = document.getElementById("mic-clip-pill");
  const devBox = document.getElementById("dsp-dev-diagnostics");
  if (vadPill && diag) {
    vadPill.textContent = diag.voiceDetected ? "Voz detectada" : "Silêncio";
    vadPill.classList.toggle("is-voice", Boolean(diag.voiceDetected));
  }
  if (clipPill && diag) {
    clipPill.classList.toggle("hidden", !diag.clipping);
  }
  if (devBox) {
    const showDev = Boolean(state.audioSettings?.developerMode && diag);
    devBox.classList.toggle("hidden", !showDev);
    if (showDev) {
      const autoPct = diag.effectiveIntensity != null ? ` (auto ${Math.round(diag.effectiveIntensity * 100)}%)` : "";
      devBox.textContent =
        `DSP · ${diag.sampleRate} Hz · frame ${diag.frameSize} (hop ${diag.hopSize}, ${diag.latencyMs} ms) · modo ${diag.mode}${autoPct}` +
        ` · noise floor ${diag.noiseFloorDb} dB · VAD ${Math.round(diag.vadProb * 100)}%` +
        ` · proc ${diag.processMs} ms · overruns ${diag.overruns}`;
    }
  }
}

function applyDspParametersRealtime() {
  updateNoiseSuppressionUi();
  if (!state.dsp) return;
  const { ctx, rawStream, highpassNode, presenceNode, micGainNode, compressorNode, loopGainNode, nsNode } = state.dsp;
  const now = ctx.currentTime;
  const mode = currentNoiseSuppressionMode();
  const abRaw = Boolean(state.micTestActive && state.micTestAbRaw);
  // 85 Hz remove rumble de mesa, ar-condicionado e hum 60 Hz preservando a voz natural.
  highpassNode.frequency.setTargetAtTime(state.audioSettings.highpass && !abRaw ? 85 : 10, now, 0.02);
  if (presenceNode?.gain?.setTargetAtTime) {
    const clarityDb = state.audioSettings.highpass && !abRaw && mode !== "off" ? 1.6 : 0;
    presenceNode.gain.setTargetAtTime(clarityDb, now, 0.03);
  }
  micGainNode.gain.setTargetAtTime((state.audioSettings.micGain || 100) / 100, now, 0.02);
  // Compressor suave para evitar clipping sem amplificar ruído de fundo no silêncio.
  compressorNode.threshold.setTargetAtTime(state.audioSettings.compressor && !abRaw ? -14 : 0, now, 0.02);
  compressorNode.ratio.setTargetAtTime(state.audioSettings.compressor && !abRaw ? 2.5 : 1, now, 0.02);
  loopGainNode.gain.setTargetAtTime(state.micTestActive ? 1.0 : 0.0, now, 0.02);
  const wantNativeNs = Boolean(!abRaw && mode !== "off" && mode !== "light");
  const rawTrack = rawStream?.getAudioTracks?.()[0];
  if (rawTrack?.applyConstraints && state.dsp.lastNativeNs !== wantNativeNs) {
    state.dsp.lastNativeNs = wantNativeNs;
    rawTrack.applyConstraints({ noiseSuppression: wantNativeNs }).catch(() => {});
  }
  if (nsNode?.port) {
    try {
      nsNode.port.postMessage({ type: "setMode", mode });
      nsNode.port.postMessage({ type: "setAbBypassRaw", value: abRaw });
    } catch (_) {}
  }
}

function teardownAudioDsp() {
  if (!state.dsp) return;
  clearInterval(state.dsp.meterTimer);
  try {
    state.dsp.rawStream.getTracks().forEach((t) => t.stop());
  } catch (_) {}
  try {
    state.dsp.ctx.close();
  } catch (_) {}
  state.dsp = null;
  if (micMeterFill) micMeterFill.style.width = "0%";
}

async function ensureLocalAudioStream(forceRebuild = false) {
  if (forceRebuild && !state.currentVoiceChannel && !state.micTestActive) {
    releaseLocalAudioStream();
    return null;
  }
  if (state.audioCapturePromise) {
    const stream = await state.audioCapturePromise;
    return forceRebuild ? ensureLocalAudioStream(true) : stream;
  }
  if (state.localAudioStream && !forceRebuild) return state.localAudioStream;
  const request = createLocalAudioStream(forceRebuild);
  state.audioCapturePromise = request;
  try { return await request; }
  finally { if (state.audioCapturePromise === request) state.audioCapturePromise = null; }
}

function releaseLocalAudioStream() {
  state.audioCaptureGeneration = (state.audioCaptureGeneration || 0) + 1;
  teardownAudioDsp();
  try { state.localAudioStream?.getTracks().forEach(track => track.stop()); } catch (_) {}
  state.localAudioStream = null;
  try { state.silentAudioContext?.close().catch(() => {}); } catch (_) {}
  state.silentAudioContext = null;
}

async function createLocalAudioStream(forceRebuild = false) {
  if (state.localAudioStream && !forceRebuild) return state.localAudioStream;
  if (forceRebuild) {
    releaseLocalAudioStream();
  }
  const generation = state.audioCaptureGeneration || 0;

  const nsMode = typeof currentNoiseSuppressionMode === "function"
    ? currentNoiseSuppressionMode()
    : (state.audioSettings?.noiseSuppressionMode || "auto");
  const AudioCtxCtor = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
  const supportsWorklet = typeof AudioWorkletNode !== "undefined" &&
    typeof AudioCtxCtor === "function" &&
    Boolean(AudioCtxCtor.prototype && "audioWorklet" in AudioCtxCtor.prototype);

  // Cascata estilo Discord: usa o supressor nativo C++ do WebRTC/Chromium em modos
  // auto/standard/strong para ruídos complexos de ambiente + AudioWorklet do Sanvo
  // para silêncio limpo e supressão de transientes. Em off/light mantém captura pura.
  const wantNativeNs = Boolean(!(state.micTestActive && state.micTestAbRaw) && nsMode !== "off" && nsMode !== "light");
  const baseConstraints = {
    echoCancellation: Boolean(state.audioSettings.aec),
    noiseSuppression: wantNativeNs || (!supportsWorklet && nsMode !== "off"),
    autoGainControl: Boolean(state.audioSettings.agc),
    channelCount: 1,
    sampleRate: { ideal: 48000 },
  };
  if (state.audioSettings.micDeviceId) {
    baseConstraints.deviceId = { exact: state.audioSettings.micDeviceId };
  }

  let rawStream = null;
  try {
    rawStream = await navigator.mediaDevices.getUserMedia({ audio: baseConstraints, video: false });
  } catch (initialError) {
    try {
      // Uma recusa de permissão não deve abrir o mesmo pedido pela segunda vez.
      if (["NotAllowedError", "PermissionDeniedError"].includes(initialError.name)) throw initialError;
      rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: Boolean(state.audioSettings.aec),
          noiseSuppression: wantNativeNs || (!supportsWorklet && nsMode !== "off"),
          autoGainControl: Boolean(state.audioSettings.agc),
        },
        video: false,
      });
    } catch (err) {
      if ((state.audioCaptureGeneration || 0) !== generation) return null;
      console.warn("Microfone indisponível, criando trilha silenciosa:", err);
      const silentCtx = new (window.AudioContext || window.webkitAudioContext)();
      const silentDst = silentCtx.createMediaStreamDestination();
      state.silentAudioContext = silentCtx;
      state.microphoneUnavailable = true;
      showErrorToast("Microfone indisponível. Você pode ouvir a chamada; confira a permissão e o dispositivo nas configurações de voz.");
      state.localAudioStream = silentDst.stream;
      return silentDst.stream;
    }
  }

  if ((state.audioCaptureGeneration || 0) !== generation) {
    rawStream.getTracks().forEach(track => track.stop());
    return null;
  }
  state.microphoneUnavailable = false;
  refreshAudioDeviceLists();

  const ctx = new (window.AudioContext || window.webkitAudioContext)({
    latencyHint: "interactive",
  });
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const sourceNode = ctx.createMediaStreamSource(rawStream);
  const highpassNode = ctx.createBiquadFilter();
  highpassNode.type = "highpass";
  highpassNode.frequency.value = state.audioSettings.highpass ? 85 : 10;
  highpassNode.Q.value = 0.707;

  // Clareza vocal sutil em 3 kHz (estilo Discord) — preservando bypass em modo off.
  const presenceNode = ctx.createBiquadFilter();
  presenceNode.type = "peaking";
  presenceNode.frequency.value = 3000;
  presenceNode.Q.value = 1.0;
  if (presenceNode.gain) {
    presenceNode.gain.value = state.audioSettings.highpass && nsMode !== "off" ? 1.6 : 0;
  }

  // Supressor adaptativo de ruído em thread de áudio dedicada (AudioWorklet),
  // com fallback seguro para passthrough se o Worklet falhar ou não existir.
  let nsNode = ctx.createGain();
  let nsWorkletActive = false;
  if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
    try {
      await ctx.audioWorklet.addModule("/js/voice-dsp-core.js");
      await ctx.audioWorklet.addModule("/js/voice-dsp-worklet.js");
      if ((state.audioCaptureGeneration || 0) !== generation) {
        rawStream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        return null;
      }
      nsNode = new AudioWorkletNode(ctx, "sancord-noise-suppressor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { mode: nsMode },
      });
      nsWorkletActive = true;
    } catch (err) {
      console.warn("[SancordDSP] AudioWorklet indisponível, fallback para passthrough seguro:", err);
      nsNode = ctx.createGain();
    }
  }

  const micGainNode = ctx.createGain();
  micGainNode.gain.value = (state.audioSettings.micGain || 100) / 100;

  const analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.3;

  // Compressor suave pós-supressão (controla picos sem amplificar ruído no silêncio).
  const compressorNode = ctx.createDynamicsCompressor();
  compressorNode.threshold.value = state.audioSettings.compressor ? -14 : 0;
  compressorNode.knee.value = 20;
  compressorNode.ratio.value = state.audioSettings.compressor ? 2.5 : 1;
  compressorNode.attack.value = 0.004;
  compressorNode.release.value = 0.16;

  const gateGainNode = ctx.createGain();
  gateGainNode.gain.value = 1.0;

  const destNode = ctx.createMediaStreamDestination();
  const loopGainNode = ctx.createGain();
  loopGainNode.gain.value = state.micTestActive ? 1.0 : 0.0;

  // Ordem do pipeline: Captura (AEC/AGC/NS C++) -> Passa-alta 85Hz -> Supressor Adaptativo -> Clareza Vocal -> Ganho -> Medidor -> Compressor -> Gate auxiliar -> Opus
  sourceNode.connect(highpassNode);
  highpassNode.connect(nsNode);
  nsNode.connect(presenceNode);
  presenceNode.connect(micGainNode);
  micGainNode.connect(analyserNode);
  analyserNode.connect(compressorNode);
  compressorNode.connect(gateGainNode);
  gateGainNode.connect(destNode);
  gateGainNode.connect(loopGainNode);
  loopGainNode.connect(ctx.destination);

  const floatBuf = new Float32Array(analyserNode.fftSize);
  const dspObj = {
    ctx,
    rawStream,
    lastNativeNs: wantNativeNs,
    sourceNode,
    highpassNode,
    presenceNode,
    nsNode,
    nsWorkletActive,
    nsFallback: !nsWorkletActive,
    lastDiagnostics: null,
    micGainNode,
    analyserNode,
    compressorNode,
    gateGainNode,
    destNode,
    loopGainNode,
    gateOpen: true,
    lastOpenAt: performance.now(),
    meterTimer: null,
  };

  if (nsWorkletActive && nsNode.port) {
    nsNode.port.onmessage = (event) => {
      if (state.dsp !== dspObj) return;
      const msg = event?.data;
      if (!msg) return;
      if (msg.type === "diagnostics") {
        dspObj.lastDiagnostics = msg.data;
        if (!isVisualWindowHidden()) renderDspDiagnostics(msg.data);
      } else if (msg.type === "fallback") {
        dspObj.nsFallback = true;
        console.warn("[SancordDSP] Fallback ativado durante processamento:", msg.error);
      }
    };
  }

  dspObj.meterTimer = setInterval(() => {
    if (!state.dsp || state.dsp !== dspObj) return;
    analyserNode.getFloatTimeDomainData(floatBuf);
    let sumSq = 0;
    for (let i = 0; i < floatBuf.length; i++) {
      sumSq += floatBuf[i] * floatBuf[i];
    }
    const rms = Math.sqrt(sumSq / floatBuf.length);
    const db = Math.max(-80, Math.min(0, 20 * Math.log10(rms + 1e-6)));
    const threshold = state.audioSettings.gateThreshold ?? -52;
    const nowMs = performance.now();

    if (db >= threshold) {
      dspObj.gateOpen = true;
      dspObj.lastOpenAt = nowMs;
    } else if (nowMs - dspObj.lastOpenAt > 260) {
      dspObj.gateOpen = false;
    }

    const mutedNow = state.muted || state.deafened || selfServerMuted();
    let shouldPass = !mutedNow && (!state.currentVoiceChannel || voicePermissions().speak_voice);
    if (shouldPass && state.audioSettings.inputMode === "ptt") {
      shouldPass = state.pttHeld;
    } else if (shouldPass && state.audioSettings.noiseGate) {
      shouldPass = dspObj.gateOpen;
    }

    gateGainNode.gain.setTargetAtTime(shouldPass ? 1.0 : 0.0, ctx.currentTime, 0.012);
    if (isVisualWindowHidden()) return;

    if (micMeterFill && !micMeterFill.closest(".hidden,[hidden]")) {
      const pct = Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
      micMeterFill.style.width = `${pct}%`;
      micMeterFill.classList.toggle("active", db >= threshold);
    }

    if (micBarsMeter?.children.length && !micBarsMeter.closest(".hidden,[hidden]")) {
      const pctNorm = Math.max(0, Math.min(1, (db + 75) / 65));
      const totalBars = micBarsMeter.children.length;
      const litCount = Math.round(pctNorm * totalBars);
      for (let i = 0; i < totalBars; i++) {
        const seg = micBarsMeter.children[i];
        const isLit = i < litCount;
        seg.classList.toggle("lit", isLit);
        seg.classList.toggle("high", isLit && i >= totalBars * 0.72);
      }
    }

    // Atualiza indicador de fala do próprio usuário (combina nível dB pós-DSP + VAD harmônico do Worklet + hold suave)
    const selfId = state.selfUser?.id;
    if (selfId) {
      const diag = dspObj.lastDiagnostics;
      const vadActive = Boolean(diag && (diag.voiceDetected || Number(diag.vadProb) >= 0.30));
      const voiceNow = shouldPass && (db >= Math.min(threshold, -56) || vadActive);
      if (voiceNow) dspObj.lastSpeakingAt = nowMs;
      const isSpeaking = shouldPass && (voiceNow || (dspObj.lastSpeakingAt && nowMs - dspObj.lastSpeakingAt < 220));
      const wasSpeaking = state.speakingUsers.has(selfId);
      if (isSpeaking !== wasSpeaking) {
        if (isSpeaking) state.speakingUsers.add(selfId);
        else state.speakingUsers.delete(selfId);
        if (typeof onFrameVoiceState === "function") onFrameVoiceState(selfId);
        document
          .querySelectorAll(`[data-speaking-user="${selfId}"]`)
          .forEach((el) => el.classList.toggle("speaking", isSpeaking));
        document
          .querySelectorAll(`[data-speaking-card="${selfId}"]`)
          .forEach((el) => el.classList.toggle("speaking-border", isSpeaking));
      }
    }
  }, 35);

  state.dsp = dspObj;
  state.localAudioStream = destNode.stream;
  applyLocalMuteState();

  // Se já estiver em chamada com peers, substitui a trilha de áudio sem derrubar a call
  const newAudioTrack = state.localAudioStream.getAudioTracks()[0];
  if (newAudioTrack) {
    for (const peerEntry of state.peers.values()) {
      for (const sender of peerEntry.pc.getSenders()) {
        if (sender.track && sender.track.kind === "audio" && !peerEntry.screenSenders.includes(sender)) {
          sender.replaceTrack(newAudioTrack).catch(() => {});
        }
      }
    }
  }

  return state.localAudioStream;
}

async function joinVoiceChannel(channelId, friendlyLabel = null) {
  if (SancordConnection.isInterrupted()) { SancordConnection.markBlocked(); return; }
  const requestId = (state.voiceJoinRequestId || 0) + 1;
  state.voiceJoinRequestId = requestId;
  if (state.currentVoiceChannel === channelId) return;
  if (!isPrivateVoiceId(channelId)) {
    const srv = state.servers.find(s => s.voice_channels?.some(c => c.id === channelId));
    const ch = srv?.voice_channels.find(c => c.id === channelId);
    const permissions = getChannelPermissions(srv, ch);
    if (!permissions.view_channel || !permissions.connect_voice) {
      showErrorToast("Você não tem permissão para entrar neste canal de voz.");
      return;
    }
  }

  const audio = await ensureLocalAudioStream();
  // O pedido pode ter sido cancelado ou substituído enquanto o SO pedia o microfone.
  if (state.voiceJoinRequestId !== requestId) return;
  if (!audio) return;
  if (!sendWs("JoinVoice", { channel_id: channelId })) {
    if (!state.currentVoiceChannel && !state.micTestActive) releaseLocalAudioStream();
    showErrorToast("Não foi possível entrar na voz. Aguarde a conexão com o servidor.");
    return;
  }
  if (state.currentVoiceChannel) {
    stopScreenSharing(false);
    stopCamera(false);
    cleanupAllPeers();
  }
  state.currentVoiceChannel = channelId;

  const ch = state.voiceChannels.find((c) => c.id === channelId);
  const channelName = friendlyLabel || (ch ? ch.name : getFriendlyVoiceName(channelId));

  activeVoiceChannelName.textContent = channelName;
  stageTitle.textContent = isPrivateVoiceId(channelId) ? `Chamada privada · ${channelName}` : channelName;
  if (typeof updateVoiceDockContext === "function") updateVoiceDockContext(channelId);
  if (typeof document !== "undefined") {
    document.getElementById("stage-open-voice-chat-btn")?.classList.toggle("hidden", isPrivateVoiceId(channelId));
  }
  voiceConnectionPanel.classList.remove("hidden");
  voiceStage.classList.remove("hidden");
  toggleStageBtn.classList.remove("hidden");
  syncVoiceStageContext();

  startVoicePingMonitor();
  startVoiceCallTimer();
  // O servidor começa cada entrada como "não silenciado": reenvia o estado local.
  if (state.muted || state.deafened) syncVoiceStateWithServer();
  startUnansweredCallTimer(channelId);
  if (typeof SancordVoiceSounds !== "undefined") {
    const existingCall = state.activeCalls?.get?.(channelId);
    const outgoingPrivate =
      isPrivateVoiceId(channelId) &&
      !existingCall &&
      (typeof aloneInCall === "function" ? aloneInCall(channelId) : true);
    SancordVoiceSounds.onEnteredVoiceSession(channelId, { isOutgoingPrivateCall: outgoingPrivate });
  } else {
    playUiSound("join");
  }
  updateSelfProfileUI();
  updateQuickKrispBtnUI();
  renderVoiceChannels();
  renderVoiceStage();
  updateDmCallButtonUI();
  if (typeof renderPrivateCallBanner === "function") renderPrivateCallBanner();
}

/** O palco da call só aparece onde ela acontece: no servidor do canal de voz, ou na
 *  conversa privada/grupo da chamada. Em outra DM ou outro servidor, fica escondido. */
function voiceStageMatchesView() {
  const id = state.currentVoiceChannel;
  if (!id) return false;
  if (isPrivateVoiceId(id)) {
    const convId = id.replace(/^dmvoice:/, "dm:").replace(/^gdmvoice:/, "gdm:");
    return state.activeView === "home" && state.activeDmId === convId;
  }
  if (state.activeView !== "server") return false;
  const srv = (state.servers || []).find((s) => (s.voice_channels || []).some((c) => c.id === id));
  return !srv || srv.id === state.activeServerId;
}

function syncVoiceStageContext() {
  voiceStage?.classList.toggle("stage-out-of-context", !voiceStageMatchesView());
}

function getFriendlyVoiceName(channelId) {
  if (!channelId) return "";
  if (channelId.startsWith("gdmvoice:")) {
    const g = findGroupDm(channelId.replace(/^gdmvoice:/, "gdm:"));
    return g ? `Call do grupo: ${groupDisplayName(g)}` : "Chamada em grupo";
  }
  if (channelId.startsWith("dmvoice:")) {
    const dmId = channelId.replace(/^dmvoice:/, "dm:");
    const conv = findPrivateConv(dmId);
    if (conv) return `Call privada: @${conv.peer.username}`;
    return "Chamada Privada";
  }
  const ch =
    state.voiceChannels.find((c) => c.id === channelId) ||
    (state.servers || []).flatMap((s) => s.voice_channels || []).find((c) => c.id === channelId);
  return ch ? ch.name : "Canal de voz";
}

function leaveVoiceChannel({ silent = false } = {}) {
  cancelVoiceRecovery();
  // Cancela também uma entrada que ainda está aguardando o microfone.
  state.voiceJoinRequestId = (state.voiceJoinRequestId || 0) + 1;
  if (!state.micTestActive) releaseLocalAudioStream();
  if (!state.currentVoiceChannel) return;

  const wasPrivateCall = isPrivateVoiceId(state.currentVoiceChannel);
  if (typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.onLeftVoiceSession({ wasPrivateCall, silent });
  } else if (!silent) {
    playUiSound("leave");
  }
  clearUnansweredCallTimer();
  stopVoicePingMonitor();
  stopVoiceCallTimer();
  stopScreenSharing(false);
  stopCamera(false);
  cleanupAllPeers();
  state.currentVoiceChannel = null;

  voiceConnectionPanel.classList.add("hidden");
  voiceStage.classList.add("hidden");
  toggleStageBtn.classList.add("hidden");

  sendWs("LeaveVoice");
  updateSelfProfileUI();
  renderVoiceChannels();
  updateDmCallButtonUI();
}

function startVoicePingMonitor() {
  stopVoicePingMonitor();
  state.voicePingEnabled = true;
  syncVoiceDisplayTimers();
}

function stopVoicePingMonitor() {
  state.voicePingEnabled = false;
  clearInterval(state.voicePingInterval);
  state.voicePingInterval = null;
  if (voiceSignalBox) {
    if (typeof closeVoiceDetails === "function") closeVoiceDetails();
    voiceSignalBox.title = "Qualidade do Sinal";
    voiceSignalBox.className = "voice-signal-box";
  }
}

function formatCallDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function updateVoiceCallTimer() {
  if (!voiceCallTimerEl) return;
  const ch = state.currentVoiceChannel;
  if (ch && isPrivateVoiceId(ch)) {
    const call = state.activeCalls?.get?.(ch);
    if (call && call.state === "RINGING") {
      voiceCallTimerEl.textContent = "Chamando...";
      return;
    }
    if (call && call.state === "WAITING_ACTIVE") {
      voiceCallTimerEl.textContent = "Aguardando...";
      return;
    }
  }
  if (!state.voiceCallStartedAt) return;
  voiceCallTimerEl.textContent = formatCallDuration(Date.now() - state.voiceCallStartedAt);
}

function startVoiceCallTimer() {
  stopVoiceCallTimer();
  state.voiceCallStartedAt = Date.now();
  if (voiceCallTimerEl) {
    voiceCallTimerEl.textContent = "00:00";
  }
  syncVoiceDisplayTimers();
}

function stopVoiceCallTimer() {
  if (state.voiceCallTimerInterval) {
    clearInterval(state.voiceCallTimerInterval);
    state.voiceCallTimerInterval = null;
  }
  state.voiceCallStartedAt = null;
  if (voiceCallTimerEl) {
    voiceCallTimerEl.textContent = "00:00";
  }
}

async function updateVoicePingDisplay() {
  if (typeof refreshVoiceConnectionDetails === "function") await refreshVoiceConnectionDetails();
}

function syncVoiceDisplayTimers() {
  if (isVisualWindowHidden()) {
    clearInterval(state.voiceCallTimerInterval);
    clearInterval(state.voicePingInterval);
    state.voiceCallTimerInterval = state.voicePingInterval = null;
    return;
  }
  if (state.voiceCallStartedAt && state.voiceCallTimerInterval == null) {
    updateVoiceCallTimer();
    state.voiceCallTimerInterval = setInterval(updateVoiceCallTimer, 1000);
  }
  if (state.voicePingEnabled && state.voicePingInterval == null) {
    void updateVoicePingDisplay();
    state.voicePingInterval = setInterval(updateVoicePingDisplay, 2500);
  }
}
document.addEventListener("sanvo:visual-visibility", syncVoiceDisplayTimers);

function createOrGetPeerConnection(peerId) {
  if (state.peers.has(peerId)) {
    return state.peers.get(peerId);
  }

  // STUN/TURN vêm do servidor (Welcome); a lista fixa é só o fallback.
  const iceServers = state.iceServers?.length ? state.iceServers : RTC_CONFIG.iceServers;
  const pc = new RTCPeerConnection({ iceServers });
  const peerEntry = {
    pc,
    videoStream: null,
    cameraStream: null,
    incomingVideoStreams: new Map(), // streamId -> MediaStream
    screenSenders: [],
    cameraSenders: [],
    pendingCandidates: [],
    // "Perfect negotiation": em colisão de ofertas, o lado educado cede.
    polite: String(state.selfUser?.id || "") > String(peerId),
    makingOffer: false,
    ignoreOffer: false,
    iceRestarts: 0,
    restartTimer: null,
    vadStops: [],
  };
  state.peers.set(peerId, peerEntry);

  // Adiciona trilha de microfone local
  if (state.localAudioStream && voicePermissions().speak_voice) {
    for (const track of state.localAudioStream.getAudioTracks()) {
      pc.addTrack(track, state.localAudioStream);
    }
  } else {
    pc.addTransceiver("audio", { direction: "recvonly" });
  }

  // Se já estivermos com a câmera ligada, adiciona a trilha da webcam
  if (state.localCameraStream) {
    for (const track of state.localCameraStream.getVideoTracks()) {
      const sender = pc.addTrack(track, state.localCameraStream);
      peerEntry.cameraSenders.push(sender);
    }
  }

  // Se já estivermos compartilhando a tela, adiciona as trilhas da tela também
  if (state.localScreenStream) {
    const profile = getSelectedQualityProfile();
    for (const track of state.localScreenStream.getTracks()) {
      const sender = pc.addTrack(track, state.localScreenStream);
      peerEntry.screenSenders.push(sender);
      if (track.kind === "video") {
        applySenderEncodingParameters(sender, profile);
      }
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendWs("WebRtcIceCandidate", {
        target_id: peerId,
        candidate: event.candidate,
      });
    }
  };

  pc.ontrack = (event) => {
    if (state.peers.get(peerId) !== peerEntry || !isCurrentVoicePeer(peerId)) return;
    const track = event.track;
    const stream = event.streams[0] || new MediaStream([track]);

    if (track.kind === "audio") {
      const audioOnlyStream = new MediaStream([track]);
      const audioEntry = attachRemoteAudio(peerId, track.id, audioOnlyStream);
      const stopVad = setupVoiceActivityDetection(audioOnlyStream, () => peerId);
      peerEntry.vadStops.push(stopVad);
      track.onended = () => {
        stopVad();
        const domId = `remote-audio-${peerId}-${track.id}`;
        releaseRemoteAudio(domId, audioEntry);
      };
    } else if (track.kind === "video") {
      peerEntry.incomingVideoStreams.set(stream.id, stream);
      const cleanupStream = () => {
        peerEntry.incomingVideoStreams.delete(stream.id);
        renderVoiceStage();
      };
      track.onended = cleanupStream;
      track.onmute = () => renderVoiceStage();
      track.onunmute = () => renderVoiceStage();
      renderVoiceStage();
    }
  };

  pc.onconnectionstatechange = () => handlePeerConnectionState(peerId, peerEntry);

  return peerEntry;
}

async function flushPendingCandidates(peerEntry) {
  while (peerEntry.pendingCandidates.length > 0) {
    const cand = peerEntry.pendingCandidates.shift();
    try {
      await peerEntry.pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch (err) {
      console.warn("Erro ao aplicar ICE candidate pendente:", err);
    }
  }
}

function activeVoiceBitrateKbps() {
  const vcId = state.currentVoiceChannel;
  if (!vcId) return 0;
  for (const srv of state.servers || []) {
    const ch = (srv.voice_channels || []).find((c) => c.id === vcId);
    if (ch && ch.bitrate_kbps >= 32 && ch.bitrate_kbps <= 256) return ch.bitrate_kbps;
  }
  return 0;
}

function boostSdpVideoBitrate(sdpStr, maxBitrateBps) {
  if (!sdpStr) return sdpStr;
  const maxKbps = Math.round((maxBitrateBps || 16000000) / 1000);
  const startKbps = Math.min(maxKbps, 8000);
  const minKbps = Math.min(maxKbps, 2500);
  const opusHd = Boolean(state.audioSettings?.opusHd);
  const channelAudioKbps = activeVoiceBitrateKbps();
  const targetAudioBps = channelAudioKbps > 0 ? channelAudioKbps * 1000 : opusHd ? 96000 : 64000;
  const wantStudioStereo = state.audioSettings?.voiceProfile === "studio" && channelAudioKbps >= 128;
  const lines = sdpStr.split("\r\n");
  const out = [];
  let section = "";
  let addedBAs = false;

  for (const line of lines) {
    if (line.startsWith("m=video")) {
      section = "video";
      addedBAs = false;
    } else if (line.startsWith("m=audio")) {
      section = "audio";
      addedBAs = false;
    } else if (line.startsWith("m=")) {
      section = "";
    }

    if (section === "video" && line.startsWith("a=fmtp:") && !line.includes("x-google-max-bitrate")) {
      out.push(
        `${line};x-google-max-bitrate=${maxKbps};x-google-min-bitrate=${minKbps};x-google-start-bitrate=${startKbps}`
      );
      continue;
    }

    if (section === "audio" && targetAudioBps > 0 && line.startsWith("a=fmtp:111 ")) {
      let upgraded = line;
      if (upgraded.includes("maxaveragebitrate=")) {
        upgraded = upgraded.replace(/maxaveragebitrate=\d+/, `maxaveragebitrate=${targetAudioBps}`);
      } else {
        upgraded += `;maxaveragebitrate=${targetAudioBps}`;
      }
      if (wantStudioStereo) {
        if (!upgraded.includes("stereo=")) upgraded += ";stereo=1;sprop-stereo=1";
      } else if (!upgraded.includes("stereo=")) {
        upgraded += ";stereo=0;sprop-stereo=0";
      }
      if (!upgraded.includes("maxplaybackrate=")) upgraded += ";maxplaybackrate=48000";
      if (!upgraded.includes("sprop-maxcapturerate=")) upgraded += ";sprop-maxcapturerate=48000";
      if (!upgraded.includes("useinbandfec=")) upgraded += ";useinbandfec=1";
      out.push(upgraded);
      continue;
    }

    out.push(line);
    if (section === "video" && !addedBAs && line.startsWith("c=IN")) {
      out.push(`b=AS:${maxKbps}`);
      addedBAs = true;
    }
  }
  return out.join("\r\n");
}

function isCurrentVoicePeer(peerId) {
  return Boolean(state.currentVoiceChannel && peerId !== state.selfUser?.id &&
    state.users.get(peerId)?.voice_channel_id === state.currentVoiceChannel);
}

async function initiateOfferToPeer(peerId, { iceRestart = false } = {}) {
  if (!isCurrentVoicePeer(peerId)) return;
  const peerEntry = createOrGetPeerConnection(peerId);
  const { pc } = peerEntry;
  const profile = getSelectedQualityProfile();
  peerEntry.makingOffer = true;
  try {
    const offer = await pc.createOffer({ iceRestart });
    if (state.peers.get(peerId) !== peerEntry || !isCurrentVoicePeer(peerId)) return;
    // Uma oferta remota pode ter chegado durante o await: não sobrescreve.
    if (pc.signalingState !== "stable") return;
    offer.sdp = boostSdpVideoBitrate(offer.sdp, profile.maxBitrate);
    await pc.setLocalDescription(offer);
  } finally {
    peerEntry.makingOffer = false;
  }

  if (state.peers.get(peerId) !== peerEntry || !isCurrentVoicePeer(peerId)) return;
  sendWs("WebRtcOffer", {
    target_id: peerId,
    sdp: pc.localDescription,
  });
}

/**
 * Queda de conexão: tenta reiniciar o ICE em vez de desistir.
 * Só o lado "não educado" inicia a renegociação, evitando ofertas cruzadas.
 */
function handlePeerConnectionState(peerId, peerEntry) {
  // Eventos do RTCPeerConnection anterior podem chegar depois de uma troca de canal.
  if (state.peers.get(peerId) !== peerEntry) return;
  const { pc } = peerEntry;
  clearTimeout(peerEntry.restartTimer);
  if (pc.connectionState === "connected") {
    peerEntry.iceRestarts = 0;
    return;
  }
  if (pc.connectionState === "closed") {
    closePeerConnection(peerId);
    return;
  }
  if (pc.connectionState !== "failed" && pc.connectionState !== "disconnected") return;
  const delay = pc.connectionState === "failed" ? 0 : 4000;
  peerEntry.restartTimer = setTimeout(() => {
    if (state.peers.get(peerId) !== peerEntry || pc.connectionState === "connected") return;
    if (peerEntry.iceRestarts >= 3) {
      closePeerConnection(peerId);
      const name = state.users.get(peerId)?.username || "um participante";
      showUiToast(`Não foi possível manter a conexão de voz com ${name}.`);
      return;
    }
    peerEntry.iceRestarts += 1;
    if (!peerEntry.polite) {
      initiateOfferToPeer(peerId, { iceRestart: true }).catch(() => {});
    }
    // O lado educado espera a oferta de reinício; se não vier, a próxima falha decide.
    peerEntry.restartTimer = setTimeout(() => handlePeerConnectionState(peerId, peerEntry), 10000);
  }, delay);
}

async function handleWebRtcOffer(fromId, sdp) {
  if (!isCurrentVoicePeer(fromId)) return;
  const peerEntry = createOrGetPeerConnection(fromId);
  const { pc } = peerEntry;
  const profile = getSelectedQualityProfile();

  const collision = peerEntry.makingOffer || pc.signalingState !== "stable";
  peerEntry.ignoreOffer = !peerEntry.polite && collision;
  if (peerEntry.ignoreOffer) return;
  if (collision) {
    await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
  }
  if (state.peers.get(fromId) !== peerEntry || !isCurrentVoicePeer(fromId)) return;
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  if (state.peers.get(fromId) !== peerEntry || !isCurrentVoicePeer(fromId)) return;
  await flushPendingCandidates(peerEntry);
  if (state.peers.get(fromId) !== peerEntry || !isCurrentVoicePeer(fromId)) return;

  const answer = await pc.createAnswer();
  if (state.peers.get(fromId) !== peerEntry || !isCurrentVoicePeer(fromId)) return;
  answer.sdp = boostSdpVideoBitrate(answer.sdp, profile.maxBitrate);
  await pc.setLocalDescription(answer);
  if (state.peers.get(fromId) !== peerEntry || !isCurrentVoicePeer(fromId)) return;

  sendWs("WebRtcAnswer", {
    target_id: fromId,
    sdp: pc.localDescription,
  });
}

async function handleWebRtcAnswer(fromId, sdp) {
  if (!isCurrentVoicePeer(fromId)) return;
  const peerEntry = state.peers.get(fromId);
  if (!peerEntry || peerEntry.pc.signalingState !== "have-local-offer") return;
  await peerEntry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  await flushPendingCandidates(peerEntry);
}

async function handleWebRtcIceCandidate(fromId, candidate) {
  if (!isCurrentVoicePeer(fromId)) return;
  const peerEntry = createOrGetPeerConnection(fromId);
  if (!peerEntry.pc.remoteDescription || !peerEntry.pc.remoteDescription.type) {
    peerEntry.pendingCandidates.push(candidate);
    return;
  }
  try {
    await peerEntry.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    if (!peerEntry.ignoreOffer) console.warn("Erro ao adicionar ICE candidate:", err);
  }
}

function getPeerVolume(peerId) {
  // Guardado pelo nome (o id muda a cada conexão); ver static/js/voice.js.
  return getStoredVolume(peerId);
}

function applyVolumeToEntry(entry, clamped) {
  // Ensurdecido (por si ou pelo servidor), silenciado só para mim, ou quem fala
  // está silenciado pelo servidor: o receptor não reproduz o áudio.
  if (state.deafened || selfServerDeafened() || isPeerSilenced(entry.peerId)) {
    if (entry.audioEl) {
      entry.audioEl.muted = true;
      entry.audioEl.volume = 0;
    }
    if (entry.gainNode) entry.gainNode.gain.value = 0;
    return;
  }

  const masterMul = (state.audioSettings?.speakerVolume ?? 100) / 100;
  const effectivePct = Math.max(0, Math.min(250, clamped * masterMul));

  if (effectivePct <= 100) {
    // Reprodução direta no elemento <audio> para 0-100% (100% confiável no Chromium/WebView2)
    if (entry.gainNode) {
      entry.gainNode.gain.value = 0;
    }
    if (entry.audioEl) {
      entry.audioEl.muted = false;
      entry.audioEl.volume = effectivePct / 100;
    }
  } else {
    // Acima de 100%: usa GainNode com <audio> silenciado para evitar áudio duplo
    if (entry.gainNode) {
      if (entry.audioEl) entry.audioEl.muted = true;
      entry.gainNode.gain.value = effectivePct / 100;
    } else if (entry.audioEl) {
      entry.audioEl.muted = false;
      entry.audioEl.volume = 1;
    }
  }
}

function setPeerVolume(peerId, pct) {
  const clamped = Math.max(0, Math.min(200, Number(pct) || 0));
  state.userVolumes.set(peerId, clamped);
  storeVolume(peerId, clamped);

  for (const entry of state.audioGainNodes.values()) {
    if (entry.peerId === peerId) {
      applyVolumeToEntry(entry, clamped);
    }
  }

  document.querySelectorAll(`[data-vol-label="${peerId}"]`).forEach((el) => {
    el.textContent = `${clamped}%`;
  });
  document.querySelectorAll(`[data-vol-slider="${peerId}"]`).forEach((el) => {
    if (Number(el.value) !== clamped) el.value = clamped;
  });
}

function releaseRemoteAudio(domId, expected = null) {
  const entry = state.audioGainNodes.get(domId);
  if (!entry || (expected && entry !== expected)) return;
  state.audioGainNodes.delete(domId);
  if (entry.track) entry.track.onunmute = null;
  if (entry.audioEl) {
    entry.audioEl.muted = true;
    entry.audioEl.volume = 0;
    entry.audioEl.pause();
    entry.audioEl.srcObject = null;
    entry.audioEl.remove();
  }
  if (entry.gainNode) {
    entry.gainNode.gain.value = 0;
    try { entry.gainNode.disconnect(); } catch (_) {}
  }
  try { entry.sourceNode?.disconnect(); } catch (_) {}
}

function attachRemoteAudio(peerId, trackId, stream) {
  const domId = `remote-audio-${peerId}-${trackId}`;
  releaseRemoteAudio(domId);
  let audioEl = document.getElementById(domId);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = domId;
    audioEl.dataset.peerId = peerId;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    remoteAudioContainer.appendChild(audioEl);
  }
  audioEl.srcObject = stream;
  if (state.audioSettings?.speakerDeviceId && typeof audioEl.setSinkId === "function") {
    audioEl.setSinkId(state.audioSettings.speakerDeviceId).catch(() => {});
  }

  const volPct = getPeerVolume(peerId);
  let gainNode = null;
  let sourceNode = null;
  try {
    if (!uiAudioCtx) {
      uiAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (uiAudioCtx.state === "suspended") {
      uiAudioCtx.resume();
    }
    sourceNode = uiAudioCtx.createMediaStreamSource(stream);
    gainNode = uiAudioCtx.createGain();
    sourceNode.connect(gainNode);
    gainNode.connect(uiAudioCtx.destination);
  } catch (_) {
    try { sourceNode?.disconnect(); } catch (_) {}
    try { gainNode?.disconnect(); } catch (_) {}
    sourceNode = null;
    gainNode = null;
  }

  const track = stream.getAudioTracks().find((t) => t.id === trackId) || stream.getAudioTracks()[0];
  const entry = { gainNode, sourceNode, audioEl, peerId, track };
  state.audioGainNodes.set(domId, entry);
  applyVolumeToEntry(entry, volPct);
  audioEl.play().catch(() => {});

  if (track) {
    track.onunmute = () => {
      if (state.audioGainNodes.get(domId) !== entry) return;
      applyVolumeToEntry(entry, getPeerVolume(peerId));
      audioEl.play().catch(() => {});
    };
  }
  return entry;
}

function closePeerConnection(peerId) {
  const peerEntry = state.peers.get(peerId);
  if (peerEntry) {
    state.peers.delete(peerId);
    clearTimeout(peerEntry.restartTimer);
    for (const stop of peerEntry.vadStops || []) stop();
    peerEntry.pc.ontrack = null;
    peerEntry.pc.onicecandidate = null;
    peerEntry.pc.onconnectionstatechange = null;
    peerEntry.pc.close();
  }
  if (state.speakingUsers.delete(peerId)) {
    if (typeof onFrameVoiceState === "function") onFrameVoiceState(peerId);
    document.querySelectorAll(`[data-speaking-user="${peerId}"]`).forEach((el) => el.classList.remove("speaking"));
    document.querySelectorAll(`[data-speaking-card="${peerId}"]`).forEach((el) => el.classList.remove("speaking-border"));
  }
  for (const [domId, entry] of state.audioGainNodes.entries()) {
    if (entry.peerId === peerId) {
      releaseRemoteAudio(domId, entry);
    }
  }
  document
    .querySelectorAll(`#remote-audio-container audio[data-peer-id="${peerId}"]`)
    .forEach((el) => { el.pause(); el.srcObject = null; el.remove(); });
}

function cleanupAllPeers() {
  for (const peerId of Array.from(state.peers.keys())) {
    closePeerConnection(peerId);
  }
}

// ============================================================================
// 3. Compartilhamento de Tela (Picker Estilo Discord + Captura Nativa + Áudio)
// ============================================================================

async function applySenderEncodingParameters(sender, profile) {
  if (!sender || !sender.track || sender.track.kind !== "video") return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.degradationPreference = "maintain-resolution";
    params.encodings[0].maxBitrate = profile.maxBitrate;
    params.encodings[0].maxFramerate = profile.fps;
    params.encodings[0].scaleResolutionDownBy = 1.0;
    await sender.setParameters(params);
  } catch (err) {
    console.warn("Aviso ao aplicar bitrate de alta definição:", err);
  }
}

function canPublishVideo(channelId, kind, requestId) {
  return Boolean(channelId && state.currentVoiceChannel === channelId &&
    !state.voiceRecovery && voicePermissions().stream_video && (state[`${kind}RequestId`] || 0) === requestId);
}

function stopMediaTracks(stream) {
  for (const track of stream?.getTracks() || []) {
    track.onended = null;
    track.stop();
  }
}

async function publishScreenStream(screenStream, profile, channelId = state.currentVoiceChannel, requestId = state.screenRequestId || 0) {
  if (!canPublishVideo(channelId, "screen", requestId)) {
    stopMediaTracks(screenStream);
    return false;
  }
  state.localScreenStream = screenStream;
  state.screenSharing = true;
  shareScreenBtn?.classList.add("sharing");
  if (screenBtnLabel) screenBtnLabel.textContent = "Parar Tela";

  const videoTrack = screenStream.getVideoTracks()[0];
  if (videoTrack) {
    try {
      videoTrack.contentHint = profile.fps >= 60 ? "motion" : "detail";
    } catch (_) {}
    videoTrack.onended = () => {
      if (state.localScreenStream === screenStream) stopScreenSharing(true);
    };
  }

  syncVoiceStateWithServer();

  for (const [peerId, peerEntry] of state.peers.entries()) {
    if (state.localScreenStream !== screenStream || !canPublishVideo(channelId, "screen", requestId)) return false;
    if (state.peers.get(peerId) !== peerEntry) continue;
    for (const track of screenStream.getTracks()) {
      if (state.localScreenStream !== screenStream || !canPublishVideo(channelId, "screen", requestId)) return false;
      const sender = peerEntry.pc.addTrack(track, screenStream);
      peerEntry.screenSenders.push(sender);
      if (track.kind === "video") {
        await applySenderEncodingParameters(sender, profile);
      }
    }
    if (state.localScreenStream !== screenStream || !canPublishVideo(channelId, "screen", requestId)) return false;
    await initiateOfferToPeer(peerId);
    for (const sender of peerEntry.screenSenders) {
      await applySenderEncodingParameters(sender, profile);
    }
  }

  if (state.localScreenStream === screenStream) renderVoiceStage();
  return state.localScreenStream === screenStream;
}

async function ensureCaptureBridgeConnection() {
  if (state.captureWs?.readyState === WebSocket.OPEN) return state.captureWs;
  if (state.captureConnectPromise) return state.captureConnectPromise;
  const request = new Promise((resolve, reject) => {
    const port = window.__SANCORD_CAPTURE_PORT;
    if (!port) {
      reject(new Error("Sem bridge nativa"));
      return;
    }
    // O app desktop só aceita a conexão com o segredo desta execução.
    const token = encodeURIComponent(window.__SANCORD_CAPTURE_TOKEN || "");
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
    ws.binaryType = "arraybuffer";
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("A captura nativa não respondeu. Tente novamente."));
      ws.close();
    };
    const timer = setTimeout(fail, 8000);
    ws.onopen = () => {
      if (settled) { ws.close(); return; }
      settled = true;
      clearTimeout(timer);
      state.captureWs = ws;
      resolve(ws);
    };
    ws.onerror = fail;
    ws.onclose = () => {
      if (state.captureWs === ws) state.captureWs = null;
      fail();
    };
  });
  state.captureConnectPromise = request;
  try { return await request; }
  finally { if (state.captureConnectPromise === request) state.captureConnectPromise = null; }
}

function renderPickerSources() {
  if (!pickerSourcesGrid) return;
  const wantKind = state.pickerTab === "monitor" ? "monitor" : "window";
  const filtered = state.pickerSources.filter((s) => s.kind === wantKind);

  if (filtered.length === 0) {
    pickerSourcesGrid.innerHTML = `<div class="picker-loading">${
      wantKind === "window"
        ? "Nenhuma janela aberta encontrada. Tente a aba 'Telas'."
        : "Nenhum monitor detectado."
    }</div>`;
    return;
  }

  pickerSourcesGrid.innerHTML = "";
  for (const src of filtered) {
    const isSel = state.selectedSource && state.selectedSource.id === src.id;
    const card = document.createElement("div");
    card.className = `source-card ${isSel ? "selected" : ""}`;
    card.innerHTML = `
      <div class="source-thumb-wrap">
        <img src="${src.thumbnail}" alt="${escapeHtml(src.title)}" />
        <span class="source-res-tag">${src.width}×${src.height}</span>
        ${src.minimized ? `<span class="source-min-tag" title="Será restaurada, sem tirar o foco, quando a transmissão começar">Minimizada</span>` : ""}
      </div>
      <div class="source-title" title="${escapeHtml(src.title)}">${escapeHtml(src.title)}</div>
    `;
    card.addEventListener("click", () => {
      state.selectedSource = src;
      if (startStreamConfirmBtn) startStreamConfirmBtn.disabled = false;
      renderPickerSources();
    });
    card.addEventListener("dblclick", () => {
      state.selectedSource = src;
      if (startStreamConfirmBtn) startStreamConfirmBtn.disabled = false;
      confirmNativeScreenShare();
    });
    pickerSourcesGrid.appendChild(card);
  }
}

async function refreshPickerSources() {
  if (!pickerSourcesGrid) return;
  pickerSourcesGrid.innerHTML = `<div class="picker-loading">Capturando miniaturas das telas e aplicativos...</div>`;
  try {
    const ws = await ensureCaptureBridgeConnection();
    const onMsg = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "sources") {
          ws.removeEventListener("message", onMsg);
          state.pickerSources = msg.sources || [];
          const hasWindows = state.pickerSources.some((s) => s.kind === "window");
          if (!hasWindows) {
            state.pickerTab = "monitor";
            pickerTabWindows?.classList.remove("active");
            pickerTabMonitors?.classList.add("active");
          }
          if (!state.selectedSource) {
            const firstMatch = state.pickerSources.find((s) => s.kind === state.pickerTab) || state.pickerSources[0];
            if (firstMatch) {
              state.selectedSource = firstMatch;
              if (startStreamConfirmBtn) startStreamConfirmBtn.disabled = false;
            }
          }
          renderPickerSources();
        }
      } catch (_) {}
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ cmd: "list_sources" }));
  } catch (err) {
    console.warn("Erro ao listar janelas nativas:", err);
    pickerSourcesGrid.innerHTML = `<div class="picker-loading">Não foi possível listar as fontes. Clique em atualizar para tentar novamente.</div>`;
  }
}

async function confirmNativeScreenShare() {
  if (!state.selectedSource || state.screenStarting || state.screenSharing) return;
  const channelId = state.currentVoiceChannel;
  const requestId = state.screenRequestId = (state.screenRequestId || 0) + 1;
  if (!canPublishVideo(channelId, "screen", requestId)) return;
  state.screenStarting = true;
  const source = state.selectedSource;
  const profile = getSelectedQualityProfile();
  const captureAudio = pickerAudioCheckbox ? pickerAudioCheckbox.checked : true;
  state.selectedShareAudio = captureAudio;

  screenShareModal?.classList.add("hidden");

  if (!window.MediaStreamTrackGenerator || !window.VideoFrame) {
    await startBrowserDisplayMediaFallback(profile, captureAudio, channelId, requestId);
    return;
  }

  let cleanup = null;
  const pendingTracks = [];
  const pendingWriters = [];
  try {
    const ws = await ensureCaptureBridgeConnection();
    if (!canPublishVideo(channelId, "screen", requestId)) return;
    const videoGen = new MediaStreamTrackGenerator({ kind: "video" });
    pendingTracks.push(videoGen);
    const videoWriter = videoGen.writable.getWriter();
    pendingWriters.push(videoWriter);
    const tracks = [videoGen];

    let audioGen = null;
    let audioWriter = null;
    if (captureAudio && window.AudioData) {
      audioGen = new MediaStreamTrackGenerator({ kind: "audio" });
      pendingTracks.push(audioGen);
      audioWriter = audioGen.writable.getWriter();
      pendingWriters.push(audioWriter);
      tracks.push(audioGen);
    }

    let videoBusy = false;
    let active = true;
    let queuedAudio = 0;
    let audioChain = Promise.resolve();
    let audioTimestampUs = Math.round(performance.now() * 1000);

    const onFrameMsg = (ev) => {
      if (!active || !canPublishVideo(channelId, "screen", requestId) || !(ev.data instanceof ArrayBuffer) || ev.data.byteLength < 9) return;
      const view = new DataView(ev.data);
      const kindByte = view.getUint8(0);

      if (kindByte === 0x01) {
        if (videoBusy) return;
        videoBusy = true;
        const w = view.getUint32(1, true);
        const h = view.getUint32(5, true);
        if (!w || !h || w > 3840 || h > 2160 || w % 2 || h % 2 || ev.data.byteLength !== 9 + w * h * 3 / 2) { videoBusy = false; return; }
        const yuvBytes = new Uint8Array(ev.data, 9);
        try {
          const frame = new VideoFrame(yuvBytes, {
            format: "I420",
            codedWidth: w,
            codedHeight: h,
            timestamp: Math.round(performance.now() * 1000),
          });
          videoWriter
            .write(frame)
            .catch(() => {})
            .finally(() => {
              frame.close();
              videoBusy = false;
            });
        } catch (_) {
          videoBusy = false;
        }
      } else if (kindByte === 0x02 && audioWriter) {
        if (ev.data.byteLength < 13 || queuedAudio >= 8) return;
        const sampleRate = view.getUint32(1, true);
        const channels = view.getUint32(5, true);
        const numFrames = view.getUint32(9, true);
        if (sampleRate < 8000 || sampleRate > 192000 || !channels || channels > 8 || !numFrames || numFrames > sampleRate || ev.data.byteLength !== 13 + numFrames * channels * 4) return;
        const pcmCopy = new Float32Array(ev.data.slice(13));
        const ts = audioTimestampUs;
        audioTimestampUs += Math.round((numFrames / sampleRate) * 1000000);

        queuedAudio++;
        audioChain = audioChain.then(async () => {
          let ad = null;
          try {
            if (!active) return;
            ad = new AudioData({
              format: "f32",
              sampleRate,
              numberOfFrames: numFrames,
              numberOfChannels: channels,
              timestamp: ts,
              data: pcmCopy,
            });
            await audioWriter.write(ad);
          } catch (_) {} finally { ad?.close(); queuedAudio--; }
        });
      }
    };

    ws.addEventListener("message", onFrameMsg);
    const onBridgeClosed = () => {
      if (active && state.nativeCaptureCleanup === cleanup) {
        stopScreenSharing(true);
        showErrorToast("A captura de tela foi interrompida. Escolha uma fonte para transmitir novamente.");
      }
    };
    cleanup = () => {
      if (!active) return;
      active = false;
      ws.removeEventListener("message", onFrameMsg);
      ws.removeEventListener("close", onBridgeClosed);
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cmd: "stop_capture" }));
      } catch (_) {}
      try { videoWriter.abort().catch(() => {}); } catch (_) {}
      try { audioWriter?.abort().catch(() => {}); } catch (_) {}
      stopMediaTracks({ getTracks: () => tracks });
    };
    state.nativeCaptureCleanup = cleanup;
    ws.addEventListener("close", onBridgeClosed);

    ws.send(
      JSON.stringify({
        cmd: "start_capture",
        id: source.id,
        kind: source.kind,
        max_width: profile.width,
        max_height: profile.height,
        fps: profile.fps,
        capture_audio: captureAudio,
      })
    );

    const stream = new MediaStream(tracks);
    const published = await publishScreenStream(stream, profile, channelId, requestId);
    if (!published) {
      cleanup();
      if (state.nativeCaptureCleanup === cleanup) state.nativeCaptureCleanup = null;
    }
  } catch (err) {
    cleanup?.();
    if (!cleanup) {
      for (const writer of pendingWriters) { try { writer.abort().catch(() => {}); } catch (_) {} }
      stopMediaTracks({ getTracks: () => pendingTracks });
    }
    if (cleanup && state.nativeCaptureCleanup === cleanup) state.nativeCaptureCleanup = null;
    console.warn("Falha na captura nativa, usando fallback:", err);
    if (canPublishVideo(channelId, "screen", requestId)) {
      if (state.screenSharing) {
        await stopScreenSharing(true);
        showErrorToast("Não foi possível transmitir a tela. Tente novamente.");
      } else {
        await startBrowserDisplayMediaFallback(profile, captureAudio, channelId, requestId);
      }
    }
  } finally {
    if ((state.screenRequestId || 0) === requestId) state.screenStarting = false;
  }
}

async function startBrowserDisplayMediaFallback(profile, captureAudio, channelId = state.currentVoiceChannel, requestId = null) {
  if (requestId === null) requestId = state.screenRequestId = (state.screenRequestId || 0) + 1;
  if (!canPublishVideo(channelId, "screen", requestId)) return;
  state.screenStarting = true;
  let captured = null;
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "always",
        width: { ideal: profile.width },
        height: { ideal: profile.height },
        frameRate: { ideal: profile.fps, max: profile.fps },
      },
      audio: captureAudio
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        : false,
      systemAudio: captureAudio ? "include" : "exclude",
      windowAudio: captureAudio ? "system" : "exclude",
    });
    captured = screenStream;
    await publishScreenStream(screenStream, profile, channelId, requestId);
  } catch (err) {
    const wasCurrent = canPublishVideo(channelId, "screen", requestId);
    if (captured && state.localScreenStream === captured) await stopScreenSharing(true);
    else stopMediaTracks(captured);
    console.info("Compartilhamento de tela cancelado:", err);
    if (wasCurrent && err.name !== "NotAllowedError" && err.name !== "AbortError") {
      showErrorToast("Não foi possível compartilhar a tela. Confira a janela escolhida e tente novamente.");
    }
  } finally {
    if ((state.screenRequestId || 0) === requestId) state.screenStarting = false;
  }
}

// Eventos do Modal Picker Discord-Style
pickerTabWindows?.addEventListener("click", () => {
  state.pickerTab = "window";
  pickerTabWindows.classList.add("active");
  pickerTabMonitors?.classList.remove("active");
  renderPickerSources();
});

pickerTabMonitors?.addEventListener("click", () => {
  state.pickerTab = "monitor";
  pickerTabMonitors.classList.add("active");
  pickerTabWindows?.classList.remove("active");
  renderPickerSources();
});

document.querySelectorAll("#picker-res-pills .pill-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#picker-res-pills .pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.selectedResolution = btn.dataset.res || "1080";
  });
});

document.querySelectorAll("#picker-fps-pills .pill-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#picker-fps-pills .pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.selectedFps = parseInt(btn.dataset.fps || "60", 10);
  });
});

refreshSourcesBtn?.addEventListener("click", refreshPickerSources);
cancelScreenPickerBtn?.addEventListener("click", () => {
  screenShareModal?.classList.add("hidden");
});
startStreamConfirmBtn?.addEventListener("click", confirmNativeScreenShare);

async function toggleScreenShare() {
  if (state.voiceRecovery) { SancordConnection.markBlocked(); return; }
  if (!state.currentVoiceChannel) return;
  if (!state.screenSharing && !voicePermissions().stream_video) { showErrorToast("Você não tem permissão para transmitir neste canal."); return; }

  if (state.screenSharing || state.screenStarting) {
    await stopScreenSharing(true);
    return;
  }

  // Se estiver no Sancord.exe Desktop, abre o Picker Discord-Style nativo!
  if (window.__SANCORD_CAPTURE_PORT) {
    state.selectedSource = null;
    if (startStreamConfirmBtn) startStreamConfirmBtn.disabled = true;
    screenShareModal?.classList.remove("hidden");
    await refreshPickerSources();
    return;
  }

  // Fallback para quem abrir pelo navegador comum
  await startBrowserDisplayMediaFallback(getSelectedQualityProfile(), true);
}

async function stopScreenSharing(notifyServer = true) {
  state.screenRequestId = (state.screenRequestId || 0) + 1;
  state.screenStarting = false;
  screenShareModal?.classList.add("hidden");

  if (state.nativeCaptureCleanup) {
    try {
      state.nativeCaptureCleanup();
    } catch (_) {}
    state.nativeCaptureCleanup = null;
  }

  const previousStream = state.localScreenStream;
  const wasSharing = state.screenSharing;
  state.localScreenStream = null;
  stopMediaTracks(previousStream);
  if (!previousStream && !wasSharing) return;

  state.screenSharing = false;
  shareScreenBtn?.classList.remove("sharing");
  if (screenBtnLabel) screenBtnLabel.textContent = "Tela";

  const peerIds = [];
  for (const [peerId, peerEntry] of state.peers.entries()) {
    for (const sender of peerEntry.screenSenders) {
      try {
        peerEntry.pc.removeTrack(sender);
      } catch (_) {}
    }
    peerEntry.screenSenders = [];
    peerIds.push(peerId);
  }

  if (notifyServer) {
    syncVoiceStateWithServer();
    renderVoiceStage();
    await Promise.allSettled(peerIds.map(peerId => initiateOfferToPeer(peerId)));
  }
}

function cameraCaptureConstraints() {
  const settings = state.audioSettings || {};
  const sizes = { "480": [854, 480], "720": [1280, 720], "1080": [1920, 1080] };
  const [width, height] = Object.hasOwn(sizes, settings.cameraQuality) ? sizes[settings.cameraQuality] : sizes["720"];
  const video = { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30, max: 30 } };
  if (typeof settings.cameraDeviceId === "string" && settings.cameraDeviceId) video.deviceId = { exact: settings.cameraDeviceId };
  return { video, audio: false };
}

async function toggleCamera() {
  if (state.voiceRecovery) { SancordConnection.markBlocked(); return; }
  if (!state.currentVoiceChannel) return;
  if (!state.cameraOn && !voicePermissions().stream_video) { showErrorToast("Você não tem permissão para usar câmera neste canal."); return; }

  if (state.cameraOn || state.cameraStarting) {
    await stopCamera(true);
    return;
  }

  const channelId = state.currentVoiceChannel;
  const requestId = state.cameraRequestId = (state.cameraRequestId || 0) + 1;
  state.cameraStarting = true;
  try {
    const camStream = await navigator.mediaDevices.getUserMedia(cameraCaptureConstraints());

    if (!canPublishVideo(channelId, "camera", requestId)) {
      stopMediaTracks(camStream);
      return;
    }

    state.localCameraStream = camStream;
    state.cameraOn = true;
    refreshAudioDeviceLists();
    toggleCameraBtn?.classList.add("sharing");
    if (cameraBtnLabel) cameraBtnLabel.textContent = "Parar Câm";

    const camTrack = camStream.getVideoTracks()[0];
    if (camTrack) {
      camTrack.onended = () => {
        if (state.localCameraStream === camStream) stopCamera(true);
      };
    }

    syncVoiceStateWithServer();

    for (const [peerId, peerEntry] of state.peers.entries()) {
      if (state.localCameraStream !== camStream || !canPublishVideo(channelId, "camera", requestId)) return;
      if (state.peers.get(peerId) !== peerEntry) continue;
      for (const track of camStream.getVideoTracks()) {
        const sender = peerEntry.pc.addTrack(track, camStream);
        peerEntry.cameraSenders.push(sender);
      }
      await initiateOfferToPeer(peerId);
    }

    if (state.localCameraStream === camStream) renderVoiceStage();
  } catch (err) {
    console.warn("Não foi possível acessar a câmera:", err);
    if (canPublishVideo(channelId, "camera", requestId)) {
      await stopCamera(true);
      showErrorToast("Não foi possível acessar sua câmera. Confira o dispositivo e a permissão no Sanvo.");
    }
  } finally {
    if ((state.cameraRequestId || 0) === requestId) state.cameraStarting = false;
  }
}

async function stopCamera(notifyServer = true) {
  state.cameraRequestId = (state.cameraRequestId || 0) + 1;
  state.cameraStarting = false;
  if (!state.localCameraStream && !state.cameraOn) return;

  const previousStream = state.localCameraStream;
  state.localCameraStream = null;
  stopMediaTracks(previousStream);

  state.cameraOn = false;
  toggleCameraBtn?.classList.remove("sharing");
  if (cameraBtnLabel) cameraBtnLabel.textContent = "Vídeo";

  const peerIds = [];
  for (const [peerId, peerEntry] of state.peers.entries()) {
    for (const sender of peerEntry.cameraSenders) {
      try {
        peerEntry.pc.removeTrack(sender);
      } catch (_) {}
    }
    peerEntry.cameraSenders = [];
    peerIds.push(peerId);
  }

  if (notifyServer) {
    syncVoiceStateWithServer();
    renderVoiceStage();
    await Promise.allSettled(peerIds.map(peerId => initiateOfferToPeer(peerId)));
  }
}

// ============================================================================
// 4. Detecção de Voz (Anel Verde ao Falar) e Controles de Mute/Deafen
// ============================================================================

/** Detecta fala num fluxo remoto. Devolve uma função que encerra a detecção. */
function setupVoiceActivityDetection(stream, getUserIdFn) {
  try {
    // Um único AudioContext para todas as análises (antes era um por trilha, nunca fechado).
    if (!state.vadAudioCtx || state.vadAudioCtx.state === "closed") {
      state.vadAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const audioCtx = state.vadAudioCtx;
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    // No WebView2/Chromium, uma MediaStreamAudioSourceNode de WebRTC remoto precisa estar ligada
    // ao destination (via GainNode mudo = 0) para o grafo de áudio puxar os quadros continuamente.
    let silentSink = null;
    try {
      silentSink = audioCtx.createGain();
      silentSink.gain.value = 0;
      analyser.connect(silentSink);
      silentSink.connect(audioCtx.destination);
    } catch (_) {}

    const data = new Float32Array(analyser.fftSize);
    let lastSpeakingAt = 0;
    const updateSpeakingIndicator = () => {
      const uid = getUserIdFn();
      if (!uid) return;
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

      // Energia RMS em dB com hold suave de 240 ms para não piscar entre sílabas.
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      const db = 20 * Math.log10(Math.sqrt(sumSq / data.length) + 1e-6);
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      const canSpeak = !(uid === state.selfUser?.id && state.muted) && !isPeerSilenced(uid);
      if (canSpeak && db > -58) lastSpeakingAt = nowMs;
      const isSpeaking = Boolean(canSpeak && (db > -58 || (lastSpeakingAt > 0 && nowMs - lastSpeakingAt < 240)));
      const wasSpeaking = state.speakingUsers.has(uid);

      if (isSpeaking !== wasSpeaking) {
        if (isSpeaking) state.speakingUsers.add(uid);
        else state.speakingUsers.delete(uid);
        if (typeof onFrameVoiceState === "function") onFrameVoiceState(uid);

        document
          .querySelectorAll(`[data-speaking-user="${uid}"]`)
          .forEach((el) => el.classList.toggle("speaking", isSpeaking));
        document
          .querySelectorAll(`[data-speaking-card="${uid}"]`)
          .forEach((el) => el.classList.toggle("speaking-border", isSpeaking));
      }
    };
    let timer = null;
    const syncTimer = () => {
      if (isVisualWindowHidden()) {
        clearInterval(timer);
        timer = null;
      } else if (timer === null) {
        updateSpeakingIndicator();
        timer = setInterval(updateSpeakingIndicator, 80);
      }
    };
    syncTimer();
    document.addEventListener("sanvo:visual-visibility", syncTimer);
    return () => {
      clearInterval(timer);
      document.removeEventListener("sanvo:visual-visibility", syncTimer);
      try {
        source.disconnect();
      } catch (_) {}
      try {
        analyser.disconnect();
      } catch (_) {}
      try {
        silentSink?.disconnect();
      } catch (_) {}
    };
  } catch (_) {
    return () => {};
  }
}

function applyLocalMuteState() {
  if (state.localAudioStream) {
    for (const track of state.localAudioStream.getAudioTracks()) {
      track.enabled = !state.voiceRecovery && !state.muted && !state.deafened && !selfServerMuted();
    }
  }
  for (const entry of state.audioGainNodes.values()) {
    applyVolumeToEntry(entry, getPeerVolume(entry.peerId));
  }
}

function syncVoiceStateWithServer() {
  const profile = getSelectedQualityProfile();
  const qualityText = state.screenSharing ? `${profile.label} • ${profile.fps}FPS` : null;
  const camStreamId = state.localCameraStream?.id || null;
  const scrStreamId = state.localScreenStream?.id || null;
  if (state.selfUser) {
    state.selfUser.stream_quality = qualityText;
    state.selfUser.camera_on = state.cameraOn;
    state.selfUser.camera_stream_id = camStreamId;
    state.selfUser.screen_stream_id = scrStreamId;
  }
  sendWs("UpdateVoiceState", {
    muted: state.muted,
    deafened: state.deafened,
    screen_sharing: state.screenSharing,
    camera_on: state.cameraOn,
    stream_quality: qualityText,
    camera_stream_id: camStreamId,
    screen_stream_id: scrStreamId,
  });
}

function updateAudioControlButtonsUI() {
  if (toggleMuteBtn) {
    toggleMuteBtn.classList.toggle("active-danger", state.muted);
    toggleMuteBtn.innerHTML = state.muted ? SVG_ICONS.micOff : SVG_ICONS.micOn;
  }
  if (toggleDeafenBtn) {
    toggleDeafenBtn.classList.toggle("active-danger", state.deafened);
    toggleDeafenBtn.innerHTML = state.deafened ? SVG_ICONS.headOff : SVG_ICONS.headOn;
  }
}

toggleMuteBtn.addEventListener("click", () => {
  state.muted = !state.muted;
  updateAudioControlButtonsUI();
  if (typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.playLocal(state.muted ? "mute_on" : "mute_off", { ignoreCooldown: true });
  } else {
    playUiSound(state.muted ? "mute" : "unmute");
  }
  applyLocalMuteState();
  syncVoiceStateWithServer();
});

toggleDeafenBtn.addEventListener("click", () => {
  state.deafened = !state.deafened;
  if (state.deafened) state.muted = true;
  updateAudioControlButtonsUI();
  if (typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.playLocal(state.deafened ? "deafen_on" : "deafen_off", { ignoreCooldown: true });
  } else {
    playUiSound(state.deafened ? "deafen" : "unmute");
  }
  applyLocalMuteState();
  syncVoiceStateWithServer();
});

leaveVoiceBtn.addEventListener("click", leaveVoiceChannel);
toggleCameraBtn?.addEventListener("click", toggleCamera);
shareScreenBtn.addEventListener("click", toggleScreenShare);

toggleStageBtn.addEventListener("click", () => {
  voiceStage.classList.toggle("hidden");
});

// ============================================================================
// 5. Renderização da Interface (Canais, Palco de Call/Tela, Chat e Membros)
// ============================================================================

function getInitials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function renderAvatarInner(username, avatarUrl, animated = false) {
  if (avatarUrl) {
    const anim = animated || (typeof isAnimatedMediaUrl === "function" && isAnimatedMediaUrl(avatarUrl));
    const src = escapeHtml(cachedMediaUrl(avatarUrl));
    const alt = escapeHtml(username);
    if (anim) return `<img data-profile-src="${src}" data-anim="1" alt="${alt}" decoding="async" /><span class="profile-media-fallback" aria-hidden="true">${escapeHtml(getInitials(username))}</span>`;
    return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" />`;
  }
  return getInitials(username);
}

const STATUS_LABELS = {
  online: "Online",
  idle: "Ausente",
  dnd: "Não Perturbe",
  invisible: "Invisível",
};

const AVATAR_DECORATIONS = [
  { id: "none", name: "Nenhuma", kind: "static" },
  { id: "galaxy-portal", name: "Astrolábio Celestial", kind: "animated" },
  { id: "sakura-glow", name: "Ramo de Hanami", kind: "animated" },
  { id: "frost-crown", name: "Dragão Glacial", kind: "animated" },
  { id: "cat-gamer", name: "Kitsune-Neko Cyber", kind: "animated" },
  { id: "dragon-fire", name: "Chamas de Drakon", kind: "animated" },
  { id: "blood-moon", name: "Oráculo do Eclipse", kind: "animated" },
  { id: "ocean-bubbles", name: "Coroa das Profundezas", kind: "animated" },
  { id: "angel-wings", name: "Asas de Serafim", kind: "animated" },
  { id: "lunar", name: "Guardião das Borboletas", kind: "animated" },
  { id: "electric-pulse", name: "Espírito Raijin", kind: "animated" },
  { id: "cyber-ring", name: "Companheiro Pixel-Bot", kind: "animated" },
  { id: "core-orbit", name: "Koi de Jade & Ouro", kind: "animated" },
  { id: "eclipse-sovereign", name: "Coroa do Soberano", kind: "animated" },
];

const PROFILE_EFFECTS = [
  { id: "none", name: "Nenhum", desc: "Cartão limpo sem efeito sobreposto" },
  { id: "star-trail", name: "Eclipse da Nebulosa", desc: "Cometas pintados, nebulosa profunda e constelação em 4 atos" },
  { id: "petal-drift", name: "Rajada de Cerejeira", desc: "Brisa lateral com pétalas e flor de sakura pintadas em parallax" },
  { id: "polar-ribbon", name: "Tempestade Polar", desc: "Aurora boreal e cristais de gelo lapidados varrendo o topo" },
  { id: "circuit-boot", name: "Inicialização Holográfica", desc: "Varredura cyber com prismas holográficos projetados dos cantos" },
  { id: "embers", name: "Erupção de Brasas", desc: "Labaredas pintadas e estilhaços de magma subindo em 4 atos" },
  { id: "arcane-sigil", name: "Selo do Eclipse", desc: "Mandala arcana dourada e runas ametista desabrochando no topo" },
  { id: "abyssal-tide", name: "Maré Bioluminescente", desc: "Águas-vivas translúcidas e bolhas peroladas em correnteza turquesa" },
  { id: "seraphim-fall", name: "Chuva de Plumas", desc: "Feixe solar diagonal com plumas marfim-ouro planando suavemente" },
  { id: "dream-butterflies", name: "Revoada Onírica", desc: "Borboletas Morpho batendo asas em tempo real em espiral feérica" },
  { id: "synth-overdrive", name: "Fúria de Raijin", desc: "Raios de plasma celeste e tambores Tomoe giratórios em 4 atos" },
  { id: "eclipse-flare", name: "Overdrive Arcade", desc: "Pixel-Bot CRT voando com corações 16-bit e horizonte synthwave" },
  { id: "core-signal", name: "Dança dos Koi", desc: "Carpas Koi imperiais nadando em curva S com flores de lótus e ondas de jade" },
];

const NAMEPLATES = [
  { id: "none", name: "Sem placa", desc: "Fundo padrão da lista" },
  { id: "starlit-silt", name: "Constelação Astralium", desc: "Crescente astral e constelação cintilante", requiresCatalog: true },
  { id: "twilight-garden", name: "Ramo de Hanami", desc: "Ramo ilustrado de cerejeira com flores em balanço suave", requiresCatalog: true },
  { id: "frost-vein", name: "Cristais de Glacium", desc: "Cristais polares facetados com brilho glacial", requiresCatalog: true },
  { id: "core-stripe", name: "Pulso Synth-Neko", desc: "Facetas holográficas e telemetria lateral", requiresCatalog: true },
  { id: "ember-line", name: "Veio de Brasa", desc: "Obsidiana vulcânica com filetes de magma dourado", requiresCatalog: true },
  { id: "arcane-velvet", name: "Veludo Arcano", desc: "Veludo ametista com selo rúnico em ouro antigo", requiresCatalog: true },
  { id: "tide-glass", name: "Vidro de Maré", desc: "Vidro oceânico bioluminescente com reflexo turquesa", requiresCatalog: true },
  { id: "eclipse-gold", name: "Ouro de Serafim", desc: "Filigrana dourada catedral com luz marfim", requiresCatalog: true },
  { id: "dream-mist", name: "Bruma Onírica", desc: "Névoa feérica violeta-turquesa com borboletas luminosas", requiresCatalog: true },
  { id: "circuit-weave", name: "Corrente de Raijin", desc: "Tempestade elétrica azul-noite com filamentos de plasma", requiresCatalog: true },
  { id: "gold-leaf", name: "Lótus de Jade & Ouro", desc: "Jade imperial lapidado com filigrana dourada", requiresCatalog: true },
];

const CLASSIC_NAME_STYLES = ["gta", "neon", "chrome", "gradient", "fire", "ice", "sakura", "retro", "gothic", "toxic", "royal"];
const NEW_NAME_STYLES = ["modern", "rounded", "mono", "editorial", "bubble", "cyber", "fantasy", "outline", "glow", "prism", "holographic", "gummy", "ink", "cosmic", "custom-gradient"];
const NAME_STYLE_IDS = new Set([...CLASSIC_NAME_STYLES, ...NEW_NAME_STYLES]);
const PROFILE_NAME_FONTS = new Set(["gta", "retro", "gothic", "modern", "rounded", "mono", "editorial", "bubble", "cyber", "fantasy"]);

function profileNameParts(id = "default") {
  const [font, effect] = (id || "default").split("+");
  if (PROFILE_NAME_FONTS.has(font)) {
    return { font, effect: NAME_STYLE_IDS.has(effect) && !PROFILE_NAME_FONTS.has(effect) ? effect : "default" };
  }
  return { font: "default", effect: NAME_STYLE_IDS.has(font) ? font : "default" };
}

function composeProfileNameStyle(font, effect) {
  return font === "default" ? effect : effect === "default" ? font : `${font}+${effect}`;
}

function wrapSvgDeco(inner) {
  return `<span class="deco-svg-layer" aria-hidden="true"><svg viewBox="0 0 100 100">${inner}</svg></span>`;
}

function getDecoSvgHtml(decoId) {
  const depthArt = profileAvatarArtLayer(decoId, "front");
  if (depthArt) return profileAvatarArtLayer(decoId, "back") + depthArt;
  if (!decoId || decoId === "none") return "";
  // Perfil P2: decorações novas do Sancord (arte em static/js/profile.js).
  const art = typeof sancordDecorationArt === "function" ? sancordDecorationArt(decoId) : null;
  if (art) return wrapSvgDeco(art);
  switch (decoId) {
    case "flame-violet":
      return wrapSvgDeco(`
        <g class="deco-spin-fast">
          <circle cx="50" cy="50" r="44" fill="none" stroke="#a855f7" stroke-width="4" stroke-dasharray="38 14 22 14" stroke-linecap="round"/>
          <circle cx="50" cy="50" r="46" fill="none" stroke="#ff2e93" stroke-width="2.5" stroke-dasharray="22 28" stroke-linecap="round"/>
          <path d="M50 2 C55 8 53 14 48 15 C51 11 49 7 45 4 Z" fill="#ffbe3d"/>
          <path d="M50 98 C45 92 47 86 52 85 C49 89 51 93 55 96 Z" fill="#ff2e93"/>
        </g>
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,46,147,0.4)" stroke-width="1.5"/>
      `);
    case "cat-gamer":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#ff4f8b" stroke-width="3.2" class="deco-pulse-soft"/>
        <path d="M18 32 L24 8 L40 20 Z" fill="#18191c" stroke="#00e5ff" stroke-width="2.8" stroke-linejoin="round"/>
        <path d="M23 26 L26 14 L34 21 Z" fill="#ff4f8b"/>
        <path d="M82 32 L76 8 L60 20 Z" fill="#18191c" stroke="#00e5ff" stroke-width="2.8" stroke-linejoin="round"/>
        <path d="M77 26 L74 14 L66 21 Z" fill="#ff4f8b"/>
        <circle cx="50" cy="50" r="46" fill="none" stroke="#00e5ff" stroke-width="1.6" stroke-dasharray="14 22" class="deco-spin-slow"/>
      `);
    case "angel-wings":
      return wrapSvgDeco(`
        <ellipse cx="50" cy="11" rx="22" ry="5" fill="none" stroke="#fde68a" stroke-width="3" class="deco-pulse-soft"/>
        <path class="cos-wing-sway-l" d="M12 42 C2 32 4 20 14 26 C8 34 10 40 16 45 C6 45 4 54 14 57 C10 61 13 67 20 65" fill="none" stroke="#f8fafc" stroke-width="2.8" stroke-linecap="round"/>
        <path class="cos-wing-sway-r" d="M88 42 C98 32 96 20 86 26 C92 34 90 40 84 45 C94 45 96 54 86 57 C90 61 87 67 80 65" fill="none" stroke="#f8fafc" stroke-width="2.8" stroke-linecap="round"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(254,240,138,0.65)" stroke-width="2"/>
      `);
    case "devil-horns":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#dc2626" stroke-width="3.5" class="deco-pulse-soft"/>
        <path d="M24 26 C12 16 14 5 22 4 C21 12 26 16 33 19 Z" fill="#ef4444" stroke="#7f1d1d" stroke-width="2"/>
        <path d="M76 26 C88 16 86 5 78 4 C79 12 74 16 67 19 Z" fill="#ef4444" stroke="#7f1d1d" stroke-width="2"/>
        <circle cx="50" cy="50" r="46" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="18 16" class="deco-spin-fast"/>
      `);
    case "cyber-cyan":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#00e5ff" stroke-width="3.2" stroke-dasharray="48 16 16 16" class="deco-spin-fast"/>
        <circle cx="50" cy="50" r="47" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-dasharray="12 18" class="deco-spin-reverse"/>
        <circle cx="50" cy="6" r="2.6" fill="#fff"/>
        <circle cx="50" cy="94" r="2.6" fill="#00e5ff"/>
      `);
    case "sakura-glow":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#f472b6" stroke-width="2.8"/>
        <g class="deco-spin-slow">
          <circle cx="50" cy="7" r="4.5" fill="#fbcfe8" stroke="#ec4899" stroke-width="1.2"/>
          <circle cx="91" cy="37" r="4" fill="#fbcfe8" stroke="#ec4899" stroke-width="1.2"/>
          <circle cx="75" cy="85" r="4.5" fill="#fbcfe8" stroke="#ec4899" stroke-width="1.2"/>
          <circle cx="24" cy="84" r="4" fill="#fbcfe8" stroke="#ec4899" stroke-width="1.2"/>
          <circle cx="9" cy="36" r="4.5" fill="#fbcfe8" stroke="#ec4899" stroke-width="1.2"/>
        </g>
      `);
    case "golden-halo":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#fbbf24" stroke-width="3.2"/>
        <g class="deco-spin-slow">
          <polygon points="50,1 52,7 58,7 53,11 55,17 50,13 45,17 47,11 42,7 48,7" fill="#fef08a"/>
          <polygon points="50,83 52,89 58,89 53,93 55,99 50,95 45,99 47,93 42,89 48,89" fill="#fbbf24"/>
          <circle cx="7" cy="50" r="3" fill="#fef08a"/>
          <circle cx="93" cy="50" r="3" fill="#fef08a"/>
        </g>
      `);
    case "crimson-vortex":
      return wrapSvgDeco(`
        <g class="deco-spin-fast">
          <circle cx="50" cy="50" r="43.5" fill="none" stroke="#ff1744" stroke-width="4" stroke-dasharray="32 14"/>
          <circle cx="50" cy="50" r="46" fill="none" stroke="#fb923c" stroke-width="2" stroke-dasharray="14 22"/>
        </g>
      `);
    case "rainbow-prism":
      return wrapSvgDeco(`
        <g class="deco-spin-fast">
          <path d="M50 7 A43 43 0 0 1 87 28" fill="none" stroke="#ff3b3b" stroke-width="4" stroke-linecap="round"/>
          <path d="M87 28 A43 43 0 0 1 87 72" fill="none" stroke="#facc15" stroke-width="4" stroke-linecap="round"/>
          <path d="M87 72 A43 43 0 0 1 50 93" fill="none" stroke="#22c55e" stroke-width="4" stroke-linecap="round"/>
          <path d="M50 93 A43 43 0 0 1 13 72" fill="none" stroke="#06b6d4" stroke-width="4" stroke-linecap="round"/>
          <path d="M13 72 A43 43 0 0 1 13 28" fill="none" stroke="#6366f1" stroke-width="4" stroke-linecap="round"/>
          <path d="M13 28 A43 43 0 0 1 50 7" fill="none" stroke="#ec4899" stroke-width="4" stroke-linecap="round"/>
        </g>
      `);
    case "galaxy-portal":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-dasharray="28 12" class="deco-spin-slow"/>
        <ellipse cx="50" cy="50" rx="48" ry="18" transform="rotate(-24 50 50)" fill="none" stroke="#38bdf8" stroke-width="1.8" class="deco-pulse-soft"/>
        <circle cx="16" cy="24" r="2.8" fill="#fde68a"/>
        <circle cx="86" cy="76" r="2.4" fill="#c4b5fd"/>
      `);
    case "electric-surge":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#38bdf8" stroke-width="3" class="deco-pulse-soft"/>
        <g class="deco-spin-fast">
          <polyline points="48,2 53,9 49,10 54,17" fill="none" stroke="#fef08a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="98,48 91,53 90,49 83,54" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="48,98 53,91 49,90 54,83" fill="none" stroke="#fef08a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="2,48 9,53 10,49 17,54" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      `);
    case "dragon-fire":
      return wrapSvgDeco(`
        <g class="deco-spin-fast">
          <circle cx="50" cy="50" r="43.5" fill="none" stroke="#f97316" stroke-width="4" stroke-dasharray="40 14"/>
          <circle cx="50" cy="50" r="46" fill="none" stroke="#facc15" stroke-width="2.2" stroke-dasharray="16 20"/>
          <polygon points="50,1 55,10 45,10" fill="#fef08a"/>
          <polygon points="50,99 55,90 45,90" fill="#ef4444"/>
        </g>
      `);
    case "frost-crown":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#7dd3fc" stroke-width="3"/>
        <g class="deco-spin-slow">
          <path d="M50 3 V13 M45 6 L55 10 M55 6 L45 10" stroke="#e0f2fe" stroke-width="2" stroke-linecap="round"/>
          <path d="M50 87 V97 M45 90 L55 94 M55 90 L45 94" stroke="#e0f2fe" stroke-width="2" stroke-linecap="round"/>
          <path d="M3 50 H13 M6 45 L10 55 M6 55 L10 45" stroke="#bae6fd" stroke-width="2" stroke-linecap="round"/>
          <path d="M87 50 H97 M90 45 L94 55 M90 55 L94 45" stroke="#bae6fd" stroke-width="2" stroke-linecap="round"/>
        </g>
      `);
    case "heart-pixel":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#fb7185" stroke-width="2.8" class="deco-pulse-soft"/>
        <g class="deco-spin-slow">
          <path d="M50 13 C46 9 41 11 41 15 C41 19 50 24 50 24 C50 24 59 19 59 15 C59 11 54 9 50 13 Z" fill="#f43f5e" transform="translate(0,-9) scale(0.75) translate(16,0)"/>
          <circle cx="14" cy="50" r="3.5" fill="#fda4af"/>
          <circle cx="86" cy="50" r="3.5" fill="#fda4af"/>
          <circle cx="50" cy="92" r="3.5" fill="#f43f5e"/>
        </g>
      `);
    case "neon-glitch":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#00f0ff" stroke-width="2.8" stroke-dasharray="28 10" class="deco-spin-fast"/>
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="#ff007f" stroke-width="2.4" stroke-dasharray="18 14" class="deco-spin-reverse"/>
      `);
    case "blood-moon":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#991b1b" stroke-width="4"/>
        <path d="M16 24 A42 42 0 0 1 84 24" fill="none" stroke="#ff2e63" stroke-width="3.2" stroke-linecap="round" class="deco-spin-slow"/>
        <circle cx="50" cy="7" r="4" fill="#fecaca"/>
      `);
    case "static-royal-crown":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#f59e0b" stroke-width="3.2"/>
        <path d="M31 14 L36 3 L44 10 L50 1 L56 10 L64 3 L69 14 Z" fill="#fbbf24" stroke="#78350f" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="50" cy="9" r="2" fill="#ef4444"/>
      `);
    case "static-gold":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42" fill="none" stroke="#f59e0b" stroke-width="2.5"/>
        <path d="M12 72 C5 56 6 38 16 22 M12 58 L7 52 M10 44 L6 38 M14 31 L11 25" fill="none" stroke="#fde047" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M88 72 C95 56 94 38 84 22 M88 58 L93 52 M90 44 L94 38 M86 31 L89 25" fill="none" stroke="#fde047" stroke-width="2.6" stroke-linecap="round"/>
      `);
    case "static-cyber-hud":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="18 8"/>
        <path d="M12 22 L20 14 M88 22 L80 14 M12 78 L20 86 M88 78 L80 86" stroke="#00e5ff" stroke-width="3.5" stroke-linecap="round"/>
      `);
    case "static-crimson":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#991b1b" stroke-width="3.6"/>
        <circle cx="50" cy="50" r="46.2" fill="none" stroke="#dc2626" stroke-width="1.3" stroke-dasharray="10 4"/>
        <path d="M36 9l14-6 14 6-14 6Z" fill="#dc2626" stroke="#fecaca" stroke-width=".9"/>
        <polygon points="50,86 55,92 50,98 45,92" fill="#ef4444" stroke="#fecaca" stroke-width=".9"/>
      `);
    case "static-diamond":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#38bdf8" stroke-width="2.6"/>
        <circle cx="50" cy="50" r="46" fill="none" stroke="#bae6fd" stroke-width="1.1" stroke-dasharray="6 4"/>
        <polygon points="50,1 55,8 50,15 45,8" fill="#e0f2fe" stroke="#0284c7" stroke-width=".9"/>
        <polygon points="50,85 55,92 50,99 45,92" fill="#e0f2fe" stroke="#0284c7" stroke-width=".9"/>
        <polygon points="1,50 8,45 15,50 8,55" fill="#7dd3fc" stroke="#e0f2fe" stroke-width=".8"/>
        <polygon points="85,50 92,45 99,50 92,55" fill="#7dd3fc" stroke="#e0f2fe" stroke-width=".8"/>
      `);
    case "static-blurple":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="43" fill="none" stroke="#6366f1" stroke-width="3"/>
        <path d="M16 74c9 14 22 20 34 20s25-6 34-20" fill="none" stroke="#a5b4fc" stroke-width="1.6" stroke-linecap="round"/>
        <polygon points="50,2 56,9 50,16 44,9" fill="#818cf8" stroke="#e0e7ff" stroke-width=".9"/>
        <polygon points="50,86 55,92 50,98 45,92" fill="#57dbcf" stroke="#e0e7ff" stroke-width=".8"/>
      `);
    case "static-emerald":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#10b981" stroke-width="3.2"/>
        <circle cx="14" cy="28" r="3" fill="#6ee7b7"/>
        <circle cx="86" cy="72" r="3" fill="#6ee7b7"/>
      `);
    case "static-angel":
      return wrapSvgDeco(`
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#e2e8f0" stroke-width="2.4"/>
        <ellipse cx="50" cy="8" rx="18" ry="4" fill="none" stroke="#fef08a" stroke-width="2.2"/>
        <path d="M12 58c-6-6-6-16 1-22m75 22c6-6 6-16-1-22" fill="none" stroke="#f8fafc" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="50" cy="93" r="3.2" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
      `);
    default:
      return `<span class="deco-svg-layer" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42.5" fill="none" stroke="#5865f2" stroke-width="3"/></svg></span>`;
  }
}

function getDecoClass(decoId) {
  return decoId && decoId !== "none" ? `deco-${decoId}` : "";
}

function getNameStyleClass(styleId) {
  return NAME_STYLE_IDS.has(styleId) ? `name-style-${styleId}` : "";
}

function getNameplateClass(npId) {
  if (!npId || npId === "none") return "";
  const resolved = typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.resolveCosmeticId === "function"
    ? SancordCosmetics.resolveCosmeticId("nameplate", npId)
    : npId;
  return (NAMEPLATES.some(item => item.id === npId) || (resolved && NAMEPLATES.some(item => item.id === resolved)))
    ? `nameplate-${resolved || npId}`
    : "";
}

function applyNameplateChip(el, id) {
  if (!el) return;
  const cls = getNameplateClass(id);
  const prevCls = el.dataset.plateClass || "";
  if (prevCls !== cls) {
    if (prevCls) el.classList.remove(prevCls);
    el.classList.toggle("profile-nameplate-chip", Boolean(cls));
    el.dataset.plateClass = cls;
    if (cls) el.classList.add(cls);
  }
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.renderNameplateArt === "function") {
    SancordCosmetics.renderNameplateArt(el, cls ? id : null);
  }
}

function applyDecoToElement(el, decoId) {
  if (!el) return;
  const cls = getDecoClass(decoId);
  if (el.dataset.decoClass === cls) return;
  if (el.dataset.decoClass) el.classList.remove(el.dataset.decoClass);
  el.querySelectorAll(":scope > .deco-svg-layer").forEach(layer => layer.remove());
  el.dataset.decoClass = cls;
  if (cls) {
    el.classList.add(cls);
    const back = profileAvatarArtLayer(decoId, "back");
    if (back) el.insertAdjacentHTML("afterbegin", back);
    const markup = profileAvatarArtLayer(decoId, "front") || getDecoSvgHtml(decoId);
    if (markup) el.insertAdjacentHTML("beforeend", markup);
    if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.attachAvatarIdle === "function") {
      SancordCosmetics.attachAvatarIdle(el, decoId);
    }
  } else if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.attachAvatarIdle === "function") {
    SancordCosmetics.attachAvatarIdle(el, null);
  }
}

// Branco é a cor padrão salva em muitos perfis: no tema Claro ficaria invisível,
// então vale como "cor do tema" (texto de título) em qualquer tema.
function themedNameColor(col) {
  const v = String(col || "").trim().toLowerCase();
  if (["#fff", "#ffffff", "#f2f3f5", "#dbdee1"].includes(v)) return "";
  return /^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/.test(v) ? v : "";
}

const styledNameSources = new WeakMap();

function applyNameStyleToEl(el, userObj, fallbackColor) {
  if (!el) return;
  styledNameSources.set(el, { userObj, fallbackColor });
  el.classList.add("styled-name");
  const enabled = state.audioSettings.showProfileNameStyles !== false || el.closest("#settings-tab-profile");
  const parts = profileNameParts(enabled ? userObj?.name_style : "default");
  const st = parts.effect === "default" ? parts.font : parts.effect;
  const cls = getNameStyleClass(st);
  // Idempotente: só troca classes que realmente mudaram para nunca reiniciar animações de material.
  for (const existing of Array.from(el.classList)) {
    if (existing.startsWith("name-style-") && existing !== cls) el.classList.remove(existing);
  }
  if (cls && !el.classList.contains(cls)) el.classList.add(cls);
  if (parts.font !== "default" && parts.effect !== "default") {
    if (el.dataset.nameFont !== parts.font) el.dataset.nameFont = parts.font;
  } else if ("nameFont" in el.dataset) {
    delete el.dataset.nameFont;
  }
  const roleMode = state.audioSettings.roleColorsMode || "name";
  const rawRoleColor = themedNameColor(fallbackColor);
  const baseColor = roleMode === "name" ? rawRoleColor : "";
  const col = (enabled ? themedNameColor(userObj?.name_color) : "") || baseColor;
  el.style.color = col;
  if (col) el.style.setProperty("--name-color", col);
  else el.style.removeProperty("--name-color");
  const prevDot = el.previousElementSibling?.classList?.contains("role-color-dot") ? el.previousElementSibling : null;
  if (roleMode === "dot" && rawRoleColor && !el.closest("#settings-tab-profile")) {
    const dot = prevDot || document.createElement("span");
    dot.className = "role-color-dot";
    dot.style.background = rawRoleColor;
    dot.setAttribute("aria-hidden", "true");
    if (!prevDot) el.parentNode?.insertBefore(dot, el);
  } else if (prevDot) {
    prevDot.remove();
  }
  if (st === "custom-gradient") {
    const primary = /^#[0-9a-f]{6}$/i.test(userObj.name_color || "") ? userObj.name_color : "#8977db";
    const secondary = /^#[0-9a-f]{6}$/i.test(userObj.name_color_secondary || "") ? userObj.name_color_secondary : "#42beae";
    const direction = userObj.name_gradient_direction;
    const angles = { horizontal: "90deg", vertical: "180deg", diagonal: "135deg" };
    const angle = Object.hasOwn(angles, direction) ? angles[direction] : "90deg";
    const first = `color-mix(in srgb, ${primary} 38%, var(--name-ink))`;
    const second = `color-mix(in srgb, ${secondary} 38%, var(--name-ink))`;
    const gradient = direction === "radial" ? `radial-gradient(ellipse, ${first}, ${second})` : `linear-gradient(${angle}, ${first}, ${second})`;
    el.style.setProperty("--sancord-name-gradient", gradient);
  } else {
    el.style.removeProperty("--sancord-name-gradient");
  }
}

const showProfileNameStyles = document.getElementById("appearance-show-name-styles");
showProfileNameStyles?.addEventListener("change", () => {
  state.audioSettings.showProfileNameStyles = showProfileNameStyles.checked;
  saveAudioSettings();
  document.querySelectorAll(".styled-name").forEach(el => {
    const source = styledNameSources.get(el);
    if (source) applyNameStyleToEl(el, source.userObj, source.fallbackColor);
  });
});

function applyProfileCardVisuals(cardEl, bannerEl, effectEl, decoWrapEl, nameEl, userObj) {
  // Tema (sólido/gradiente, destaque, contraste) e banner: static/js/profile.js.
  applyProfileTheme(cardEl, userObj);
  setProfileBanner(bannerEl, userObj);
  configureProfileEffect(effectEl, userObj?.profile_effect);
  if (decoWrapEl) {
    applyDecoToElement(decoWrapEl, userObj?.avatar_decoration);
  }
  if (nameEl) {
    applyNameStyleToEl(nameEl, userObj, "#ffffff");
    applyNameplateChip(nameEl.closest(".profile-nameplate-wrap"), userObj?.nameplate_style);
  }
}

function updateSelfProfileUI() {
  if (!state.selfUser) return;
  const avatarHtml = renderAvatarInner(state.selfUser.username, state.selfUser.avatar_url);
  selfAvatar.innerHTML = avatarHtml;
  selfAvatar.style.background = state.selfUser.avatar_color;
  selfUsername.textContent = state.selfUser.username;
  selfUsername.title = state.selfUser.username;
  applyNameStyleToEl(selfUsername, state.selfUser, "#f2f3f5");
  applyDecoToElement(document.getElementById("self-avatar-deco"), state.selfUser.avatar_decoration);

  const bar = document.getElementById("self-user-profile-bar");
  if (bar) {
    // O painel inferior do usuário permanece limpo (estilo Discord), sem fundo/arte de nameplate.
    for (const c of Array.from(bar.classList)) {
      if (c.startsWith("nameplate-")) bar.classList.remove(c);
    }
    if (typeof SancordCosmetics !== "undefined") SancordCosmetics.renderNameplateArt(bar, null);
  }

  const sk = state.selfUser.status_kind || "online";
  if (selfStatusDot) {
    selfStatusDot.className = `status-badge ${sk}`;
  }
  if (state.currentVoiceChannel) {
    selfStatusText.textContent = "🔊 Em voz";
    selfStatusText.classList.add("in-voice-txt");
  } else {
    const customTxt = typeof customStatusText === "function" ? customStatusText(state.selfUser) : state.selfUser.custom_status;
    selfStatusText.textContent = customTxt || STATUS_LABELS[sk] || "Online";
    selfStatusText.classList.remove("in-voice-txt");
  }

  if (settingsAvatarPreview) {
    settingsAvatarPreview.innerHTML = avatarHtml;
    settingsAvatarPreview.style.background = state.selfUser.avatar_color;
  }
  if (settingsNavAvatar) {
    settingsNavAvatar.innerHTML = avatarHtml;
    settingsNavAvatar.style.background = state.selfUser.avatar_color;
  }
  if (settingsNavUsername) {
    settingsNavUsername.textContent = state.selfUser.username;
  }
  if (typeof SancordSelfProfileMenu !== "undefined") {
    const curTok = getStoredToken();
    if (curTok && state.selfUser.username) {
      SancordSelfProfileMenu.registerSavedAccount({
        id: state.selfUser.id,
        username: state.selfUser.username,
        display_name: state.selfUser.display_name,
        avatar_color: state.selfUser.avatar_color,
        avatar_url: state.selfUser.avatar_url,
        token: curTok,
      });
    }
    SancordSelfProfileMenu.refreshIfOpen();
  }
}

// Editor de Imagem de Perfil estilo Discord (Pan, Zoom, Rotação 90°, Suporte a GIF animado)
const avatarCropModal = document.getElementById("avatar-crop-modal");
const avatarCropCloseBtn = document.getElementById("avatar-crop-close-btn");
const avatarCropCancelBtn = document.getElementById("avatar-crop-cancel-btn");
const avatarCropResetBtn = document.getElementById("avatar-crop-reset-btn");
const avatarCropApplyBtn = document.getElementById("avatar-crop-apply-btn");
const avatarCropStage = document.getElementById("avatar-crop-stage");
const avatarCropImg = document.getElementById("avatar-crop-img");
const avatarZoomSlider = document.getElementById("avatar-zoom-slider");
const avatarRotateBtn = document.getElementById("avatar-rotate-btn");
const avatarGifNotice = document.getElementById("avatar-gif-notice");
const avatarKeepGifCheckbox = document.getElementById("avatar-keep-gif-checkbox");
const avatarCropError = document.getElementById("avatar-crop-error");

const CROP_DIAMETER = 220;
const MAX_AVATAR_GIF_BYTES = 6 * 1024 * 1024; // 6 MB

// Perfil P1: o mesmo editor recorta avatar (círculo) e banner (faixa 2,5:1).
const CROP_FRAMES = { avatar: { w: CROP_DIAMETER, h: CROP_DIAMETER, outW: 512, outH: 512 }, banner: { w: 340, h: 136, outW: 1200, outH: 480 } };
const MAX_BANNER_BYTES = 8 * 1024 * 1024;

function cropFrame() {
  return CROP_FRAMES[cropEditor.mode] || CROP_FRAMES.avatar;
}

const cropEditor = {
  mode: "avatar",
  file: null,
  fileDataUrl: null,
  mimeType: "image/jpeg",
  isGif: false,
  natW: 0,
  natH: 0,
  zoom: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  dragging: false,
  startX: 0,
  startY: 0,
  origPanX: 0,
  origPanY: 0,
};

function getCropEffectiveDims() {
  const rot90 = Math.abs(cropEditor.rotation) % 180 !== 0;
  return {
    effW: rot90 ? cropEditor.natH : cropEditor.natW,
    effH: rot90 ? cropEditor.natW : cropEditor.natH,
  };
}

function getCropTotalScale() {
  if (!cropEditor.natW || !cropEditor.natH) return 1;
  const { effW, effH } = getCropEffectiveDims();
  const frame = cropFrame();
  const baseScale = Math.max(frame.w / effW, frame.h / effH);
  return baseScale * cropEditor.zoom;
}

function clampCropPan() {
  const { effW, effH } = getCropEffectiveDims();
  const totalScale = getCropTotalScale();
  const dispW = effW * totalScale;
  const dispH = effH * totalScale;
  const frame = cropFrame();
  const maxX = Math.max(0, (dispW - frame.w) / 2);
  const maxY = Math.max(0, (dispH - frame.h) / 2);
  cropEditor.panX = Math.max(-maxX, Math.min(maxX, cropEditor.panX));
  cropEditor.panY = Math.max(-maxY, Math.min(maxY, cropEditor.panY));
}

function renderCropPreviewTransform() {
  if (!avatarCropImg || !cropEditor.natW) return;
  clampCropPan();
  const totalScale = getCropTotalScale();
  avatarCropImg.style.width = `${cropEditor.natW}px`;
  avatarCropImg.style.height = `${cropEditor.natH}px`;
  avatarCropImg.style.transform = `translate(calc(-50% + ${cropEditor.panX}px), calc(-50% + ${cropEditor.panY}px)) scale(${totalScale}) rotate(${cropEditor.rotation}deg)`;
}

function resetCropEditorTransforms() {
  cropEditor.zoom = 1;
  cropEditor.rotation = 0;
  cropEditor.panX = 0;
  cropEditor.panY = 0;
  if (avatarZoomSlider) avatarZoomSlider.value = "1";
  renderCropPreviewTransform();
}

function openAvatarCropModal(file, mode = "avatar") {
  if (!avatarCropModal || !avatarCropImg) return;
  avatarCropError?.classList.add("hidden");

  const isGif = file.type === "image/gif" || file.name?.toLowerCase().endsWith(".gif");
  const limit = mode === "banner" ? MAX_BANNER_BYTES : MAX_AVATAR_GIF_BYTES;
  if (isGif && file.size > limit) {
    showUiToast(mode === "banner" ? "Este GIF é maior que 8 MB. Escolha um GIF menor para o banner." : "Este GIF é maior que 6 MB. Escolha um GIF menor para usar como foto de perfil.");
    return;
  }
  cropEditor.mode = mode === "banner" ? "banner" : "avatar";
  cropEditor.file = file;
  avatarCropStage?.classList.toggle("banner-mode", cropEditor.mode === "banner");
  const title = avatarCropModal.querySelector(".avatar-crop-header h2");
  if (title) title.textContent = cropEditor.mode === "banner" ? "Editar banner" : "Editar avatar";

  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    cropEditor.fileDataUrl = dataUrl;
    cropEditor.mimeType = file.type || "image/jpeg";
    cropEditor.isGif = isGif;

    if (avatarGifNotice) avatarGifNotice.classList.toggle("hidden", !isGif);
    if (avatarKeepGifCheckbox) avatarKeepGifCheckbox.checked = isGif;

    avatarCropImg.onload = () => {
      cropEditor.natW = avatarCropImg.naturalWidth || 220;
      cropEditor.natH = avatarCropImg.naturalHeight || 220;
      resetCropEditorTransforms();
      avatarCropModal.classList.remove("hidden");
    };
    avatarCropImg.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function closeAvatarCropModal() {
  cropEditor.dragging = false;
  avatarCropStage?.classList.remove("dragging");
  avatarCropModal?.classList.add("hidden");
}

/** Recorte final como arquivo: GIF mantido como veio (animação) ou WebP do recorte. */
function exportCroppedImageBlob() {
  if (cropEditor.isGif && avatarKeepGifCheckbox?.checked && cropEditor.file) {
    return Promise.resolve({ blob: cropEditor.file, name: `${cropEditor.mode}.gif`, animated: true });
  }
  const frame = cropFrame();
  const canvas = drawCroppedCanvas(frame.outW, frame.outH, frame.outW / frame.w);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve({ blob, name: `${cropEditor.mode}.webp`, animated: false }) : reject(new Error("toBlob"))), "image/webp", 0.9);
  });
}

function drawCroppedCanvas(outW, outH, ratio) {
  const totalScale = getCropTotalScale();
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, outW, outH);
  ctx.save();
  ctx.translate(outW / 2 + cropEditor.panX * ratio, outH / 2 + cropEditor.panY * ratio);
  ctx.scale(totalScale * ratio, totalScale * ratio);
  ctx.rotate((cropEditor.rotation * Math.PI) / 180);
  ctx.drawImage(avatarCropImg, -cropEditor.natW / 2, -cropEditor.natH / 2, cropEditor.natW, cropEditor.natH);
  ctx.restore();
  return canvas;
}

function exportCroppedAvatarDataUrl() {
  if (cropEditor.isGif && avatarKeepGifCheckbox?.checked) {
    return cropEditor.fileDataUrl;
  }

  const OUT_SIZE = 256;
  const ratio = OUT_SIZE / CROP_DIAMETER;
  const totalScale = getCropTotalScale();

  const canvas = document.createElement("canvas");
  canvas.width = OUT_SIZE;
  canvas.height = OUT_SIZE;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, OUT_SIZE, OUT_SIZE);
  ctx.save();
  ctx.translate(OUT_SIZE / 2 + cropEditor.panX * ratio, OUT_SIZE / 2 + cropEditor.panY * ratio);
  ctx.scale(totalScale * ratio, totalScale * ratio);
  ctx.rotate((cropEditor.rotation * Math.PI) / 180);
  ctx.drawImage(
    avatarCropImg,
    -cropEditor.natW / 2,
    -cropEditor.natH / 2,
    cropEditor.natW,
    cropEditor.natH
  );
  ctx.restore();

  const usePng = cropEditor.mimeType === "image/png" || cropEditor.mimeType === "image/webp";
  return usePng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9);
}

avatarCropStage?.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  cropEditor.dragging = true;
  cropEditor.startX = e.clientX;
  cropEditor.startY = e.clientY;
  cropEditor.origPanX = cropEditor.panX;
  cropEditor.origPanY = cropEditor.panY;
  avatarCropStage.classList.add("dragging");
  avatarCropStage.setPointerCapture?.(e.pointerId);
});

window.addEventListener("pointermove", (e) => {
  if (!cropEditor.dragging) return;
  cropEditor.panX = cropEditor.origPanX + (e.clientX - cropEditor.startX);
  cropEditor.panY = cropEditor.origPanY + (e.clientY - cropEditor.startY);
  renderCropPreviewTransform();
});

window.addEventListener("pointerup", () => {
  if (!cropEditor.dragging) return;
  cropEditor.dragging = false;
  avatarCropStage?.classList.remove("dragging");
});

avatarCropStage?.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    cropEditor.zoom = Math.max(1, Math.min(3, cropEditor.zoom + delta));
    if (avatarZoomSlider) avatarZoomSlider.value = cropEditor.zoom.toFixed(2);
    renderCropPreviewTransform();
  },
  { passive: false }
);

avatarZoomSlider?.addEventListener("input", (e) => {
  cropEditor.zoom = Math.max(1, Math.min(3, parseFloat(e.target.value) || 1));
  renderCropPreviewTransform();
});

avatarRotateBtn?.addEventListener("click", () => {
  cropEditor.rotation = (cropEditor.rotation + 90) % 360;
  renderCropPreviewTransform();
});

avatarCropResetBtn?.addEventListener("click", () => {
  resetCropEditorTransforms();
  if (cropEditor.isGif && avatarKeepGifCheckbox) {
    avatarKeepGifCheckbox.checked = true;
  }
});

avatarCropCloseBtn?.addEventListener("click", closeAvatarCropModal);
avatarCropCancelBtn?.addEventListener("click", closeAvatarCropModal);
avatarCropModal?.addEventListener("click", (e) => {
  if (e.target === avatarCropModal) closeAvatarCropModal();
});

avatarCropApplyBtn?.addEventListener("click", async () => {
  try {
    const out = await exportCroppedImageBlob();
    const editorOpen = !document.getElementById("settings-tab-profile")?.classList.contains("hidden")
      && !document.getElementById("settings-modal")?.classList.contains("hidden");
    if (cropEditor.mode === "banner" || editorOpen) {
      // No editor: vira rascunho e só vai ao servidor em "Salvar" (prévia ao vivo).
      setPendingProfileMedia(cropEditor.mode, out);
    } else {
      // Fora do editor (clique no próprio avatar): aplica na hora.
      avatarCropApplyBtn.disabled = true;
      await applyProfileMedia("avatar", out.blob, out.name);
      showUiToast("Enviando avatar…");
    }
    closeAvatarCropModal();
  } catch (err) {
    console.error("Erro ao aplicar imagem de perfil:", err);
    if (avatarCropError) {
      avatarCropError.textContent = err?.message && err.message !== "toBlob" ? err.message : "Não foi possível processar esta imagem.";
      avatarCropError.classList.remove("hidden");
    }
  } finally {
    avatarCropApplyBtn.disabled = false;
  }
});

// Clicar no avatar do painel inferior abre o Self Profile Menu (nunca abre seletor de arquivo direto).

// Clicar no botão Avatar abre o subeditor de Avatar (avatares predefinidos + enviar imagem).
document.getElementById("pe-upload-avatar-btn")?.addEventListener("click", () => {
  avatarFileInput?.click();
});
document.getElementById("pe-avatar-remove-btn")?.addEventListener("click", () => {
  if (typeof setPendingProfileMedia === "function") setPendingProfileMedia("avatar", "remove");
});
document.getElementById("preview-card-avatar")?.addEventListener("click", (e) => {
  if (typeof openPeView === "function") openPeView("avatar", e.currentTarget);
});

avatarFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file && file.type.startsWith("image/")) {
    openAvatarCropModal(file);
  }
  avatarFileInput.value = "";
});

function renderTextChannels() {
  // Árvore de categorias + canais (texto, anúncios e voz) em static/js/servers.js.
  renderChannelTree();
}

function renderVoiceChannels() {
  renderChannelTree();
}

function classifyVideoResolution(videoEl, fallbackQualityStr) {
  if (fallbackQualityStr) return fallbackQualityStr;
  const w = videoEl?.videoWidth || 0;
  const h = videoEl?.videoHeight || 0;
  if (!w && !h) return "HD AO VIVO";
  if (w >= 3200 || h >= 1800) return "4K UHD";
  if (w >= 2200 || h >= 1300) return "1440p 2K";
  if (w >= 1600 || h >= 850) return "1080p FHD";
  return "720p HD";
}

function resolveRemotePeerStreams(user, peerEntry) {
  if (!peerEntry || !peerEntry.incomingVideoStreams) {
    return { cameraStream: null, screenStream: null };
  }
  const map = peerEntry.incomingVideoStreams;
  let cameraStream = null;
  let screenStream = null;

  const isLive = stream => stream?.getVideoTracks().some(t => t.readyState === "live");
  if (user.camera_on && user.camera_stream_id && isLive(map.get(user.camera_stream_id))) {
    cameraStream = map.get(user.camera_stream_id);
  }
  if (user.screen_sharing && user.screen_stream_id && isLive(map.get(user.screen_stream_id))) {
    screenStream = map.get(user.screen_stream_id);
  }

  for (const [sid, stream] of map.entries()) {
    const hasLiveTrack = stream.getVideoTracks().some((t) => t.readyState === "live");
    if (!hasLiveTrack) continue;
    if (stream === cameraStream || stream === screenStream) continue;
    if (sid === user.camera_stream_id || sid === user.screen_stream_id) continue;

    if (user.camera_on && !cameraStream && (!user.camera_stream_id || !map.has(user.camera_stream_id))) {
      cameraStream = stream;
    } else if (user.screen_sharing && !screenStream && (!user.screen_stream_id || !map.has(user.screen_stream_id))) {
      screenStream = stream;
    }
  }

  return { cameraStream, screenStream };
}

function renderVoiceStage() {
  if (!state.currentVoiceChannel) {
    stageGrid.innerHTML = "";
    voiceStage.classList.remove("has-screen", "theater-mode");
    return;
  }

  const memberIds = state.voiceRecovery ? [] : state.voiceMembers[state.currentVoiceChannel] || [];
  if (typeof syncPrivateStageControls === "function") syncPrivateStageControls();
  const activeDomIds = new Set();
  let anyScreenActive = false;

  for (const uid of memberIds) {
    const user = state.users.get(uid);
    if (!user) continue;
    const isSelf = uid === state.selfUser?.id;
    const peerEntry = state.peers.get(uid);
    const remoteStreams = isSelf ? null : resolveRemotePeerStreams(user, peerEntry);
    const cameraStream = isSelf ? state.localCameraStream : remoteStreams?.cameraStream;
    const screenStream = isSelf ? state.localScreenStream : remoteStreams?.screenStream;
    const hasCamera = Boolean(cameraStream && (user.camera_on || (!isSelf && cameraStream)));

    // 1. Card de Voz / Webcam do Participante (preserva DOM existente)
    const voiceDomId = `stage-voice-${uid}`;
    activeDomIds.add(voiceDomId);
    let card = document.getElementById(voiceDomId);
    const isSpeaking = state.speakingUsers.has(uid);

    if (!card) {
      card = document.createElement("div");
      card.id = voiceDomId;
      card.setAttribute("data-speaking-card", uid);
      stageGrid.appendChild(card);
    }

    card.className = `stage-card voice-only-card ${hasCamera ? "camera-card" : ""} ${
      isSpeaking ? "speaking-border" : ""
    }`;
    card.oncontextmenu = (e) => {
      e.preventDefault();
      openVoiceUserMenu(e, uid);
    };

    if (hasCamera) {
      let camVideo = card.querySelector("video.camera-video-el");
      if (!camVideo) {
        card.innerHTML = `
          <div class="screen-controls-overlay">
            <button type="button" class="screen-ctrl-btn cam-fs-btn" title="Tela cheia" aria-label="Tela cheia">${SancordIcons.html("expand")}</button>
          </div>
          <video class="camera-video-el" autoplay playsinline muted></video>
          <div class="stage-card-label">
            <span class="cam-badge">CÂM</span>
            <span class="cam-owner-name"></span>
          </div>
        `;
        camVideo = card.querySelector("video.camera-video-el");
        const fsBtn = card.querySelector(".cam-fs-btn");
        fsBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleElementFullscreen(card, camVideo);
        });
        card.ondblclick = (e) => {
          e.stopPropagation();
          toggleElementFullscreen(card, camVideo);
        };
      }
      if (camVideo.srcObject !== cameraStream) {
        camVideo.srcObject = cameraStream;
        camVideo.play().catch(() => {});
      }
      const ownerEl = card.querySelector(".cam-owner-name");
      if (ownerEl) {
        ownerEl.textContent = `${user.username}${isSelf ? " (Você)" : ""}`;
      }
    } else {
      card.ondblclick = null;
      card.innerHTML = `
        <div class="stage-avatar ${isSpeaking ? "speaking" : ""}" data-speaking-user="${uid}" style="background: ${user.avatar_color}">
          ${renderAvatarInner(user.username, user.avatar_url)}
        </div>
        <div class="stage-card-label">
          <span>${escapeHtml(user.display_name || user.username)}${isSelf ? " (Você)" : ""}</span>
        </div>
      `;
      card.querySelector(".stage-card-label")?.append(...voiceUserIndicators(user));
    }

    // 2. Card de Transmissão de Tela (preserva o <video> existente para não piscar nem sair da Tela Cheia)
    if (screenStream && (user.screen_sharing || (!isSelf && screenStream))) {
      anyScreenActive = true;
      const screenCardId = `screen-${uid}`;
      const screenDomId = `stage-screen-${uid}`;
      activeDomIds.add(screenDomId);

      const isSpotlight = state.spotlightCardId === screenCardId;
      let screenCard = document.getElementById(screenDomId);

      if (!screenCard) {
        screenCard = document.createElement("div");
        screenCard.id = screenDomId;

        const videoEl = document.createElement("video");
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.srcObject = screenStream;
        videoEl.play?.()?.catch?.(() => {});

        const controlsOverlay = document.createElement("div");
        controlsOverlay.className = "screen-controls-overlay";

        if (!isSelf) {
          const volPct = getPeerVolume(uid);
          const volWrap = document.createElement("div");
          volWrap.className = "volume-control-wrap";
          volWrap.title = "Volume da transmissão / participante (0% a 200%)";
          volWrap.innerHTML = `
            <span>🔊</span>
            <input type="range" min="0" max="200" step="5" value="${volPct}" class="volume-slider" data-vol-slider="${uid}" />
            <span class="volume-pct" data-vol-label="${uid}">${volPct}%</span>
          `;
          volWrap.addEventListener("click", (e) => e.stopPropagation());
          volWrap.addEventListener("dblclick", (e) => e.stopPropagation());
          const sSlider = volWrap.querySelector("input");
          sSlider.addEventListener("input", (e) => setPeerVolume(uid, e.target.value));
          controlsOverlay.appendChild(volWrap);
        }

        const spotlightBtn = document.createElement("button");
        spotlightBtn.type = "button";
        spotlightBtn.className = "screen-ctrl-btn spotlight-toggle-btn";
        spotlightBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          state.spotlightCardId = state.spotlightCardId === screenCardId ? null : screenCardId;
          renderVoiceStage();
        });

        const fullscreenBtn = document.createElement("button");
        fullscreenBtn.type = "button";
        fullscreenBtn.className = "screen-ctrl-btn fullscreen-toggle-btn";
        fullscreenBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleElementFullscreen(screenCard, videoEl);
        });

        controlsOverlay.appendChild(spotlightBtn);
        controlsOverlay.appendChild(fullscreenBtn);

        const label = document.createElement("div");
        label.className = "stage-card-label";
        label.innerHTML = `
          <span class="live-badge">TELA AO VIVO</span>
          <span class="screen-owner-text"></span>
          <span class="quality-badge"></span>
        `;

        const syncBadge = () => {
          const latestUser = state.users.get(uid) || user;
          const profile = getSelectedQualityProfile();
          const chosenLabel = isSelf
            ? `${profile.label} • ${profile.fps}FPS`
            : latestUser.stream_quality;
          const badgeEl = screenCard.querySelector(".quality-badge");
          if (badgeEl) {
            badgeEl.textContent = classifyVideoResolution(videoEl, chosenLabel);
          }
          videoEl.play?.()?.catch?.(() => {});
        };

        videoEl.addEventListener("loadedmetadata", syncBadge);
        videoEl.addEventListener("resize", syncBadge);

        screenCard.appendChild(controlsOverlay);
        screenCard.appendChild(videoEl);
        screenCard.appendChild(label);

        screenCard.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          toggleElementFullscreen(screenCard, videoEl);
        });

        screenCard.addEventListener("click", () => {
          if (document.fullscreenElement) return;
          state.spotlightCardId = state.spotlightCardId === screenCardId ? null : screenCardId;
          renderVoiceStage();
        });

        stageGrid.appendChild(screenCard);
      }

      // Atualiza estado visual sem destruir o elemento <video>
      screenCard.className = `stage-card screen-card ${isSpotlight ? "spotlight" : ""}`;
      const videoEl = screenCard.querySelector("video");
      if (videoEl && videoEl.srcObject !== screenStream) {
        videoEl.srcObject = screenStream;
        videoEl.play?.()?.catch?.(() => {});
      }

      const spotlightBtn = screenCard.querySelector(".spotlight-toggle-btn");
      if (spotlightBtn) {
        spotlightBtn.replaceChildren(SancordIcons.node(isSpotlight ? "close" : "screen"), document.createTextNode(isSpotlight ? "Reduzir" : "Modo teatro"));
      }

      const fullscreenBtn = screenCard.querySelector(".fullscreen-toggle-btn");
      if (fullscreenBtn) {
        const isFs = document.fullscreenElement === screenCard || document.fullscreenElement === videoEl;
        fullscreenBtn.replaceChildren(SancordIcons.node(isFs ? "close" : "expand"), document.createTextNode(isFs ? "Sair da tela cheia" : "Tela cheia"));
      }

      const ownerTextEl = screenCard.querySelector(".screen-owner-text");
      if (ownerTextEl) {
        ownerTextEl.textContent = `Tela de ${user.username}`;
      }

      const badgeEl = screenCard.querySelector(".quality-badge");
      if (badgeEl) {
        const profile = getSelectedQualityProfile();
        const chosenLabel = isSelf
          ? `${profile.label} • ${profile.fps}FPS`
          : user.stream_quality;
        badgeEl.textContent = classifyVideoResolution(videoEl, chosenLabel);
      }
    }
  }

  // Remove apenas os cards de quem saiu ou parou de transmitir
  Array.from(stageGrid.children).forEach((child) => {
    if (!activeDomIds.has(child.id)) {
      if (child.id === "voice-stage-waiting" && !activeDomIds.size && child.dataset.recovering === String(Boolean(state.voiceRecovery))) return;
      child.remove();
    }
  });
  if (!stageGrid.firstElementChild) {
    const waiting = document.createElement("div");
    waiting.id = "voice-stage-waiting";
    waiting.dataset.recovering = String(Boolean(state.voiceRecovery));
    waiting.innerHTML = SancordUI.emptyHTML({ icon: "voice", title: state.voiceRecovery ? "Reconectando a voz…" : "Aguardando participantes", description: state.voiceRecovery ? "Câmera e compartilhamento de tela foram interrompidos." : "Os participantes aparecem aqui quando entram na chamada." });
    stageGrid.appendChild(waiting);
  }

  voiceStage.classList.toggle("has-screen", anyScreenActive);
  voiceStage.classList.toggle("theater-mode", anyScreenActive && Boolean(state.spotlightCardId));
}

function toggleElementFullscreen(containerEl, videoEl) {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (containerEl.requestFullscreen) {
    containerEl.requestFullscreen().catch(() => {
      videoEl.requestFullscreen?.().catch(() => {});
    });
  } else if (videoEl.webkitEnterFullscreen) {
    videoEl.webkitEnterFullscreen();
  }
}

document.addEventListener("fullscreenchange", () => {
  renderVoiceStage();
});

function formatMessageContent(text) {
  // Formatação segura (Markdown + menções) em static/js/chat.js.
  return renderMarkdown(text, null);
}

function updatePinnedBadge() {
  if (!pinnedCountBadge) return;
  const list = state.chatHistory[getActiveTextChannelId()] || [];
  const count = list.filter((m) => m.pinned).length;
  pinnedCountBadge.textContent = count;
  pinnedCountBadge.classList.toggle("hidden", count === 0);
}

function renderPinnedPopover() {
  if (!pinnedPopoverList) return;
  const list = (state.chatHistory[getActiveTextChannelId()] || []).filter((m) => m.pinned);
  if (list.length === 0) {
    pinnedPopoverList.innerHTML = SancordUI.emptyHTML({icon:"pin",title:"Nenhuma mensagem fixada",description:"Fixe uma mensagem pelo menu para encontrá-la aqui."});
    return;
  }
  pinnedPopoverList.innerHTML = "";
  for (const m of list.slice().reverse()) {
    const card = document.createElement("div");
    card.className = "pinned-card";
    card.innerHTML = `
      <div class="pinned-card-author" style="color: ${m.author_color}">${escapeHtml(m.author_name)} <span class="message-time">${escapeHtml(m.timestamp)}</span></div>
      <div>${m.content ? formatMessageContent(m.content) : "<em>[Imagem]</em>"}</div>
    `;
    card.addEventListener("click", () => {
      const targetEl = chatMessagesEl.querySelector(`[data-msg-id="${m.id}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        pinnedPopover?.classList.add("hidden");
      }
    });
    pinnedPopoverList.appendChild(card);
  }
}

/** Etapa C2: responder mencionando (notifica o autor) ou não. Lembrado neste aparelho. */
function replyMentionEnabled() {
  return state.audioSettings?.replyMention !== false;
}

function renderReplyMentionToggle() {
  const btn = document.getElementById("reply-mention-toggle");
  if (!btn) return;
  const on = replyMentionEnabled();
  btn.textContent = on ? "@ ATIVADO" : "@ DESATIVADO";
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.title = on ? "O autor será mencionado e notificado. Clique para desativar." : "O autor não será notificado. Clique para mencionar.";
}

function setReplyingTo(msg) {
  state.sendWhenUploaded = false;
  state.replyingTo = {
    id: msg.id,
    channel_id: msg.channel_id || getActiveTextChannelId(),
    author_name: msg.author_name,
    content: msg.content || "[Imagem]",
  };
  if (replyPreviewText) {
    replyPreviewText.textContent = `Respondendo a @${msg.author_name}`;
    replyPreviewText.title = state.replyingTo.content.slice(0, 200);
  }
  // Responder à própria mensagem não notifica ninguém: o botão "@" some.
  const own = msg.author_name && msg.author_name.toLowerCase() === state.selfUser?.username?.toLowerCase();
  document.getElementById("reply-mention-toggle")?.classList.toggle("hidden", Boolean(own));
  renderReplyMentionToggle();
  replyPreviewBar?.classList.remove("hidden");
  chatInput?.focus();
}

document.getElementById("reply-mention-toggle")?.addEventListener("click", () => {
  state.audioSettings.replyMention = !replyMentionEnabled();
  saveAudioSettings();
  renderReplyMentionToggle();
  chatInput?.focus();
});

function clearReplyingTo() {
  if (state.replyingTo) state.sendWhenUploaded = false;
  state.replyingTo = null;
  replyPreviewBar?.classList.add("hidden");
}

function renderChatMessages(opts = {}) {
  // Agrupamento, separadores de dia, divisor de não lidas: static/js/chat.js.
  renderChatMessagesV2(opts);
}

function buildChatMessageElement(msg) {
  return buildMessageElementV2(msg);
}

function appendChatMessageUI(msg) {
  appendChatMessageUIV2(msg);
}

closeLightboxBtn?.addEventListener("click", () => {
  imageLightboxModal.classList.add("hidden");
});
imageLightboxModal?.addEventListener("click", (e) => {
  if (e.target === imageLightboxModal) {
    imageLightboxModal.classList.add("hidden");
  }
});

function cacheMemberRosterUser(user) {
  if (!user || !user.username || typeof state === "undefined") return;
  if (!state.memberRosterCache) state.memberRosterCache = new Map();
  const key = user.username.toLowerCase();
  const prev = state.memberRosterCache.get(key) || {};
  state.memberRosterCache.set(key, {
    ...prev,
    ...user,
    id: null,
    online: false,
    status_kind: "offline",
    voice_channel_id: null,
    activity: null,
  });
}

// Usa somente o cadastro de membros e o roster filtrado por privacidade recebidos do servidor.
// Membros offline preservam avatar, nome exibido, decoração, placa e estilo do nome na lista.
function sidebarMemberRows(server, users) {
  const known = new Set([...(server?.members || []), server?.owner_username].filter(Boolean).map(n => n.toLowerCase()));
  const rows = new Map();
  for (const user of users) {
    const name = user.username.toLowerCase();
    if ((!server || server.id === "sancord" || known.has(name)) && !rows.has(name)) rows.set(name, user);
  }
  if (server && server.id !== "sancord") {
    const roster = server.member_roster || null;
    const cache = typeof state !== "undefined" ? state.memberRosterCache : null;
    const friends = typeof state !== "undefined" && Array.isArray(state.friends) ? state.friends : null;
    for (const name of known) {
      if (rows.has(name)) continue;
      const fromRoster = roster && roster[name];
      const fromCache = cache && cache.get(name);
      const fromFriend = friends && friends.find(f => f && f.username && f.username.toLowerCase() === name);
      const base = fromRoster || fromCache || fromFriend;
      if (base) {
        rows.set(name, {
          ...base,
          id: null,
          username: base.username || name,
          online: false,
          status_kind: "offline",
          voice_channel_id: null,
          activity: null,
          avatar_color: base.avatar_color || "var(--bg-active)",
        });
      } else {
        rows.set(name, { id: null, username: name, status_kind: "offline", avatar_color: "var(--bg-active)", avatar_url: null });
      }
    }
  }
  return [...rows.values()];
}

function renderMembersSidebar(opts = {}) {
  const srv = getActiveServer();
  // Etapa C6: numa thread aberta, a lista mostra quem segue a thread.
  const openThreadObj = state.activeView === "server" && typeof isThreadId === "function" && isThreadId(state.currentTextChannel)
    ? threadById(state.currentTextChannel)
    : null;
  const threadMembers = openThreadObj ? new Set(openThreadObj.members || []) : null;
  const allUsers = sidebarMemberRows(srv, state.users.values())
    .filter(u => !threadMembers || threadMembers.has(u.username.toLowerCase()));
  const onlineCount = allUsers.filter(u => !SancordMemberList.isMemberOffline(u)).length;

  // Cabeçalho global "MEMBROS ONLINE" removido na vista de servidor:
  // a lista começa diretamente pelos cargos destacados, Disponível e Offline.
  if (onlineCountTitle) {
    if (threadMembers) {
      onlineCountTitle.textContent = `MEMBROS DA THREAD — ${allUsers.length}`;
      onlineCountTitle.classList.remove("hidden");
    } else {
      onlineCountTitle.textContent = "";
      onlineCountTitle.classList.add("hidden");
    }
  }
  if (typeof serverTitleEl !== "undefined" && serverTitleEl && srv && !threadMembers) {
    serverTitleEl.dataset.onlineCount = String(onlineCount);
    serverTitleEl.title = `${srv.name} — ${onlineCount} disponível${onlineCount === 1 ? "" : "is"} de ${allUsers.length}`;
  }

  const groups = SancordMemberList.buildMemberGroups(allUsers, srv?.roles || [], {
    memberRoles: srv?.member_roles || {},
    ownerUsername: srv?.owner_username || "",
    getDisplayName: (u) => memberNickname(srv, u.username) || u.display_name || u.username,
    availableLabel: "Disponível",
    offlineLabel: "Offline",
  });

  const emptyHtml = threadMembers
    ? SancordUI.emptyHTML({icon:"thread",title:"Ninguém segue esta thread",description:"Quem escrever aqui ou escolher Seguir thread aparece nesta lista."})
    : SancordUI.emptyHTML({icon:"users",title:"Ninguém por aqui",description:"Os membros aparecerão nesta lista."});

  const changed = SancordMemberList.MemberList(membersList, groups, {
    server: srv,
    threadId: openThreadObj?.id || "",
    emptyMode: threadMembers ? "thread" : "server",
    emptyHtml,
    force: Boolean(opts.force),
    voiceChannels: state.voiceChannels || [],
    statusLabels: STATUS_LABELS,
    isPrivateVoiceId,
    canViewChannel: (server, ch) => getChannelPermissions(server, ch).view_channel !== false,
    resolveAppearance: (server, u) => resolveServerProfile(server, u.username, u),
    getNameplateClass,
    getDecoClass,
    getDecoSvgHtml,
    renderAvatarInner,
    escapeHtml,
    getTimeoutUntil: memberTimeoutUntil,
    formatTimeoutEnd,
    getCustomStatus: (u) => (typeof customStatusText === "function" ? customStatusText(u) : u.custom_status || ""),
    applyNameStyle: applyNameStyleToEl,
    onOpenCompact: (u, li) => {
      const data = { author_name: u.username, author_color: u.avatar_color, author_avatar: u.avatar_url };
      openCompactProfile(u.id, data, li);
    },
    onContextMenu: (e, u) => {
      e.preventDefault();
      const data = { author_name: u.username, author_color: u.avatar_color, author_avatar: u.avatar_url };
      const openProfile = () => openMemberProfilePopover(u.id, data);
      SancordUI.contextMenu(e.clientX, e.clientY, memberUserMenuItems(srv, u, openProfile));
    },
  });

  if (changed && typeof refreshAnimatedMedia === "function") {
    refreshAnimatedMedia(membersList);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// 6. Criação de Canais (+), Upload/Ctrl+V de Imagens, Autenticação e Chat
// ============================================================================

function openCreateChannelModal(kind) {
  // Novo diálogo com tipo, categoria e descrição (static/js/servers.js).
  openCreateChannelDialog({ kind: kind || "text" });
}

function openLegacyCreateChannelModal(kind) {
  state.creatingChannelKind = kind;
  if (kind === "text") {
    createChannelTitle.textContent = "Criar Canal de Texto";
    createChannelDesc.textContent = "Canais de texto servem para mensagens, links e prints.";
    newChannelNameInput.placeholder = "Ex: memes, clipes, links...";
  } else {
    createChannelTitle.textContent = "Criar Canal de Voz";
    createChannelDesc.textContent = "Canais de voz servem para chamadas e compartilhamento de tela.";
    newChannelNameInput.placeholder = "Ex: Squad CS2, Cinema, Sala 2...";
  }
  newChannelNameInput.value = "";
  createChannelModal.classList.remove("hidden");
  newChannelNameInput.focus();
}

addTextChannelBtn?.addEventListener("click", () => openCreateChannelModal("text"));
addVoiceChannelBtn?.addEventListener("click", () => openCreateChannelModal("voice"));
cancelChannelBtn?.addEventListener("click", () => createChannelModal.classList.add("hidden"));

createChannelForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = newChannelNameInput.value.trim();
  if (!name) return;
  if (sendWs("CreateChannel", {
    name,
    kind: state.creatingChannelKind,
    server_id: state.activeServerId,
  })) createChannelModal.classList.add("hidden");
});

// Compressão inteligente de imagem via <canvas> para envio instantâneo no chat
function compressImageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function attachImageFile(file) {
  // Anexos agora sobem por HTTP com progresso (static/js/chat.js).
  if (file) addComposerFiles([file]);
}

function clearPendingImage() {
  state.pendingImageDataUrl = null;
  imagePreviewThumb.src = "";
  imagePreviewBar.classList.add("hidden");
  if (imageFileInput) imageFileInput.value = "";
}

imageFileInput?.addEventListener("change", (e) => {
  addComposerFiles(e.target.files);
  e.target.value = "";
});
removeImageBtn?.addEventListener("click", clearPendingImage);

// Ctrl+V cola prints e arquivos direto no chat (texto continua colando normalmente).
window.addEventListener("paste", (e) => {
  if (!loginModal.classList.contains("hidden")) return;
  if (chatMainView?.classList.contains("hidden")) return;
  if (e.target !== chatInput && (e.target.closest?.("input, textarea, [contenteditable], [role=dialog]"))) return;
  const files = Array.from(e.clipboardData?.files || []);
  if (files.length === 0) return;
  e.preventDefault();
  addComposerFiles(files);
});

function logoutAccount() {
  if (typeof closeSelfProfileMenu === "function") closeSelfProfileMenu();
  if (state.selfUser?.username && typeof SancordSelfProfileMenu !== "undefined") {
    SancordSelfProfileMenu.removeSavedAccount(state.selfUser.username);
  }
  leaveVoiceChannel();
  settingsModal?.classList.add("hidden");
  closeSettingsModal();
  const token = getStoredToken();
  if (token) {
    // Revoga a sessão no servidor (melhor esforço; não bloqueia a saída).
    SancordNet.fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }
  clearStoredSession();
  state.selfUser = null;
  if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.clearSessionState === "function") {
    SancordNotifications.clearSessionState();
  }
  SancordOutbox.bind(null);
  SancordOfflineCache.clear();
  SancordConnection.stop();
  showAuthScreen({ username: usernameInput.value });
}

settingsLogoutBtn?.addEventListener("click", async () => {
  await closeSettingsModal();
  if (settingsModal && !settingsModal.classList.contains("hidden")) return;
  logoutAccount();
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  // Texto + anexos já enviados; sem conexão o texto continua no campo (static/js/chat.js).
  submitComposer();
});

// ============================================================================
// 7. Recursos Discord: Digitando, Emojis, Busca, Fixadas, Perfil, Settings DSP e Atalhos
// ============================================================================

function registerUserTyping(channelId, userId, username) {
  if (!state.typingByChannel.has(channelId)) {
    state.typingByChannel.set(channelId, new Map());
  }
  const chMap = state.typingByChannel.get(channelId);
  const prev = chMap.get(userId);
  if (prev?.timer) clearTimeout(prev.timer);

  const timer = setTimeout(() => {
    chMap.delete(userId);
    if (channelId === getActiveTextChannelId()) renderTypingIndicator();
  }, 3500);

  chMap.set(userId, { username, timer });
  if (channelId === getActiveTextChannelId()) renderTypingIndicator();
}

function clearUserTyping(channelId, userId) {
  const chMap = state.typingByChannel.get(channelId);
  if (!chMap) return;
  const entry = chMap.get(userId);
  if (entry?.timer) clearTimeout(entry.timer);
  chMap.delete(userId);
  if (channelId === getActiveTextChannelId()) renderTypingIndicator();
}

function renderTypingIndicator() {
  if (!typingIndicatorEl) return;
  const chMap = state.typingByChannel.get(getActiveTextChannelId());
  if (!chMap || chMap.size === 0) {
    typingIndicatorEl.textContent = "";
    return;
  }
  const names = Array.from(chMap.values()).map((v) => v.username);
  if (names.length === 1) {
    typingIndicatorEl.textContent = `${names[0]} está digitando...`;
  } else if (names.length === 2) {
    typingIndicatorEl.textContent = `${names[0]} e ${names[1]} estão digitando...`;
  } else {
    typingIndicatorEl.textContent =
      names.length === 3 ? `${names[0]}, ${names[1]} e ${names[2]} estão digitando...` : "Várias pessoas estão digitando...";
  }
}

chatInput?.addEventListener("input", () => {
  // Privacidade: com "Exibir status Está digitando" desligado, ninguém é avisado.
  if (state.audioSettings?.showTyping === false) return;
  const now = Date.now();
  if (now - state.lastTypingSentAt > 2000 && chatInput.value.trim().length > 0) {
    state.lastTypingSentAt = now;
    sendWs("Typing", { channel_id: getActiveTextChannelId() });
  }
});

cancelReplyBtn?.addEventListener("click", clearReplyingTo);

// Seletor de emojis: construído por static/js/chat.js (busca, categorias, recentes).
let emojiTargetMsg = null;

emojiPickerBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (typeof closeStickerPicker === "function") closeStickerPicker();
  emojiTargetMsg = null;
  if (emojiPopover) emojiPopover.style.cssText = "";
  emojiPopover?.classList.toggle("hidden");
  emojiPickerBtn.setAttribute("aria-expanded", String(!emojiPopover.classList.contains("hidden")));
});

// Helper seguro para Área de Transferência (HTTPS + HTTP local)
async function copyTextSafe(text, toastMsg = "Copiado!") {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error("no clipboard");
    }
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }
  showUiToast(toastMsg);
}

// Menu de Contexto (Botão Direito em Mensagens) + Encaminhar
let activeContextMsg = null;
let forwardSourceMsg = null;

function closeMessageContextMenu() {
  msgContextMenu?.classList.add("hidden");
  activeContextMsg = null;
}

function openMessageContextMenu(e, msg) {
  if (!msgContextMenu) return;
  activeContextMsg = msg;
  closeMessageContextMenuOnlyDOM: {
    pinnedPopover?.classList.add("hidden");
    quickDevicePopover?.classList.add("hidden");
  }

  const myName = state.selfUser?.username?.toLowerCase();
  const isMine =
    msg.author_id === state.selfUser?.id ||
    (msg.author_name || "").toLowerCase() === myName;

  const activeSrv = getActiveServer();
  const canModMsg = !isPrivateTextId(msg.channel_id) &&
    messagePermissions(msg).manage_messages;
  const permissions = messagePermissions(msg);
  msgContextMenu.querySelectorAll("[data-ctx-react], [data-ctx-act=react-more]").forEach(btn => { btn.disabled = !permissions.add_reactions; });
  const pinButton = msgContextMenu.querySelector("[data-ctx-act=pin]");
  if (pinButton) pinButton.disabled = !permissions.pin_messages;
  const canDelete = isMine || canModMsg;
  const hasText = Boolean((msg.content || "").trim());

  const copyTextBtn = document.getElementById("ctx-copy-text-btn");
  const pinLabel = document.getElementById("ctx-pin-label");
  const starLabel = document.getElementById("ctx-star-label");
  const editBtn = document.getElementById("ctx-edit-btn");
  const deleteBtn = document.getElementById("ctx-delete-btn");
  const ownerSep = document.getElementById("ctx-owner-sep");

  copyTextBtn?.classList.toggle("hidden", !hasText);
  if (pinLabel) pinLabel.textContent = msg.pinned ? "Desafixar mensagem" : "Fixar mensagem";
  if (starLabel) {
    starLabel.textContent = state.starredMsgIds.has(msg.id)
      ? "Remover dos favoritos"
      : "Favoritar mensagem";
  }
  // Threads só partem de mensagens de canais comuns (não DM, não de dentro de thread).
  document.getElementById("ctx-thread-btn")?.classList.toggle(
    "hidden",
    isPrivateTextId(msg.channel_id) || (typeof isThreadId === "function" && isThreadId(msg.channel_id)) || !permissions.send_messages
  );
  editBtn?.classList.toggle("hidden", !(isMine && hasText));
  if (editBtn) editBtn.disabled = !permissions.send_messages;
  deleteBtn?.classList.toggle("hidden", !canDelete);
  ownerSep?.classList.toggle("hidden", !canDelete);

  msgContextMenu.classList.remove("hidden");
  const rect = msgContextMenu.getBoundingClientRect();
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - rect.width - 8));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - rect.height - 8));
  msgContextMenu.style.left = `${x}px`;
  msgContextMenu.style.top = `${y}px`;
}

/**
 * Etapa C2: encaminhar de verdade. O servidor guarda uma cópia congelada (texto,
 * anexos e prévias) e marca como encaminhada; até 5 destinos e comentário opcional.
 * Destinos: canais de texto onde se pode escrever (todos os servidores), DMs e grupos.
 */
function forwardTargets() {
  const out = [];
  for (const srv of state.servers || []) {
    for (const ch of srv.text_channels || []) {
      if (ch.kind === "announcement" || ch.kind === "forum") continue;
      if (typeof canPostIn === "function" && !canPostIn(srv, ch)) continue;
      out.push({ value: ch.id, label: `# ${ch.name} · ${srv.name}` });
    }
  }
  for (const dm of state.dmConversations || []) out.push({ value: dm.dm_id, label: `@ ${dm.peer?.username || "DM"}` });
  for (const g of state.groupDms || []) out.push({ value: g.id, label: `👥 ${g.name || "Grupo"}` });
  return out;
}

async function openForwardMessageModal(msg) {
  if (!msg?.id || msg.poll) {
    showErrorToast(msg?.poll ? "Enquetes não podem ser encaminhadas." : "Esta mensagem não pode ser encaminhada.");
    return;
  }
  const preview = (msg.forward?.content || msg.content || "").trim();
  const values = await SancordUI.formDialog({
    title: "Encaminhar mensagem",
    description: preview ? `"${preview.slice(0, 120)}${preview.length > 120 ? "…" : ""}"` : "Mensagem com anexos ou prévias.",
    fields: [
      { name: "targets", label: "DESTINOS (ATÉ 5)", type: "checklist", value: [], max: 5, options: forwardTargets(), emptyText: "Nenhum lugar onde você possa escrever." },
      { name: "comment", label: "COMENTÁRIO (OPCIONAL)", type: "textarea", rows: 2, maxlength: 2000, placeholder: "Adicione uma mensagem" },
    ],
    submitLabel: "Encaminhar",
  });
  const targets = (values?.targets || []).slice(0, 5);
  if (!targets.length) return;
  const source = { channel_id: msg.channel_id, message_id: msg.id };
  let sent = 0;
  for (const channel_id of targets) {
    if (sendChatPayload({ channel_id, content: (values.comment || "").trim(), forward: source, reply_to_id: null, attachment_ids: [] })) sent++;
  }
  if (sent) showUiToast(sent === 1 ? "Mensagem encaminhada." : `Mensagem encaminhada para ${sent} lugares.`);
}


cancelForwardBtn?.addEventListener("click", () => {
  forwardMsgModal?.classList.add("hidden");
  forwardSourceMsg = null;
});
forwardMsgModal?.addEventListener("click", (e) => {
  if (e.target === forwardMsgModal) {
    forwardMsgModal.classList.add("hidden");
    forwardSourceMsg = null;
  }
});

msgContextMenu?.querySelectorAll("[data-ctx-react]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const msg = activeContextMsg;
    if (!msg) return;
    sendWs("ToggleReaction", {
      channel_id: msg.channel_id,
      message_id: msg.id,
      emoji: btn.dataset.ctxReact,
    });
    closeMessageContextMenu();
  });
});

msgContextMenu?.querySelectorAll("[data-ctx-act]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const msg = activeContextMsg;
    const act = btn.dataset.ctxAct;
    const menuRect = msgContextMenu.getBoundingClientRect();
    closeMessageContextMenu();
    if (!msg) return;

    if (act === "create-thread") {
      openCreateThreadDialog(msg);
      return;
    }
    if (act === "react-more") {
      if (emojiPopover) {
        emojiTargetMsg = msg;
        emojiPopover.classList.remove("hidden");
        emojiPopover.style.position = "fixed";
        const left = Math.max(8, Math.min(menuRect.right + 6, window.innerWidth - 280));
        const top = Math.max(8, Math.min(menuRect.top, window.innerHeight - 240));
        emojiPopover.style.left = `${left}px`;
        emojiPopover.style.top = `${top}px`;
        emojiPopover.style.right = "auto";
        emojiPopover.style.bottom = "auto";
        emojiPopover.style.zIndex = "2600";
      }
    } else if (act === "reply") {
      setReplyingTo(msg);
    } else if (act === "forward") {
      openForwardMessageModal(msg);
    } else if (act === "copy-text") {
      copyTextSafe(msg.content || "", "Texto copiado!");
    } else if (act === "pin") {
      sendWs("TogglePinChat", { channel_id: msg.channel_id, message_id: msg.id });
    } else if (act === "star") {
      if (state.starredMsgIds.has(msg.id)) {
        state.starredMsgIds.delete(msg.id);
        showUiToast("Removida dos favoritos.");
      } else {
        state.starredMsgIds.add(msg.id);
        showUiToast("Mensagem salva nos favoritos!");
      }
      saveStarredMessages();
      renderChatMessages();
    } else if (act === "mark-unread") {
      // Posição de leitura salva no servidor (vale em todos os dispositivos).
      sendWs("MarkUnread", { channel_id: msg.channel_id, message_id: msg.id });
      showUiToast("Marcada como não lida.");
    } else if (act === "copy-link") {
      resolvePublicOriginUrl().then((origin) => {
        const srv = serverForChannel(msg.channel_id);
        const link = srv
          ? SancordNet.link({ server: srv.id, channel: msg.channel_id, message: msg.id }, origin)
          : SancordNet.link({ dm: msg.channel_id, message: msg.id }, origin);
        copyTextSafe(link, "Link da mensagem copiado!");
      });
    } else if (act === "edit") {
      startEditingMessage(msg);
    } else if (act === "delete") {
      // Shift+clique exclui a própria mensagem sem confirmação.
      confirmDeleteMessage(msg, e.shiftKey && isOwnMessage(msg));
    } else if (act === "copy-id") {
      copyTextSafe(msg.id, "ID da mensagem copiado!");
    }
  });
});

// Header: Mensagens Fixadas, Mostrar/Ocultar Membros, Busca no Chat
pinnedMsgsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  renderPinnedPopover();
  pinnedPopover?.classList.toggle("hidden");
});

toggleMembersBtn?.addEventListener("click", () => {
  const hiddenNow = appLayout?.classList.toggle("hide-members");
  appLayout?.classList.toggle("force-members", !hiddenNow);
  toggleMembersBtn.classList.toggle("active", !hiddenNow);
});

chatSearchInput?.addEventListener("focus", () => {
  if (typeof SancordSearch !== "undefined") SancordSearch.onFocus();
});
chatSearchInput?.addEventListener("input", (e) => {
  cancelMessageJump();
  state.searchQuery = e.target.value || "";
  if (typeof SancordSearch !== "undefined") SancordSearch.onInput(state.searchQuery);
  else renderChatMessages();
});
// Enter: busca no histórico completo do servidor (static/js/search.js).
chatSearchInput?.addEventListener("keydown", (e) => {
  if (typeof SancordSearch !== "undefined" && SancordSearch.onKeyDown(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    runServerSearch(chatSearchInput.value);
  } else if (e.key === "Escape") {
    hideSearchResults();
  }
});

document.addEventListener("click", (e) => {
  if (emojiPopover && !emojiPopover.classList.contains("hidden") && !emojiPopover.contains(e.target) && e.target !== emojiPickerBtn) {
    emojiPopover.classList.add("hidden");
    emojiPopover.style.cssText = "";
    emojiTargetMsg = null;
  }
  if (pinnedPopover && !pinnedPopover.classList.contains("hidden") && !pinnedPopover.contains(e.target) && !pinnedMsgsBtn?.contains(e.target)) {
    pinnedPopover.classList.add("hidden");
  }
  if (msgContextMenu && !msgContextMenu.classList.contains("hidden") && !msgContextMenu.contains(e.target)) {
    closeMessageContextMenu();
  }
  if (profileCardMoreMenu && !profileCardMoreMenu.classList.contains("hidden") && !profileCardMoreMenu.contains(e.target) && e.target !== profileCardMoreBtn) {
    profileCardMoreMenu.classList.add("hidden");
  }
});

// Cartão Completo de Perfil em 2 Colunas (Estilo Discord)
let currentPopoverUserId = null;
let currentPopoverUsername = null;
let currentPopoverServerId = null;
let currentPopoverPrivacy = null;
let visitedProfileBase = null;

function getRelationshipWith(username) {
  if (!username) return "none";
  const lower = username.toLowerCase();
  if (state.friends.some((f) => f.username.toLowerCase() === lower)) return "friend";
  if (state.incomingRequests.some((f) => f.username.toLowerCase() === lower)) return "incoming";
  if (state.outgoingRequests.some((f) => f.username.toLowerCase() === lower)) return "outgoing";
  return "none";
}

function updateProfileCardFriendButton(targetName) {
  if (!profileCardFriendBtn) return;
  const rel = getRelationshipWith(targetName);
  if (rel === "friend") {
    profileCardFriendBtn.textContent = "✓";
    profileCardFriendBtn.title = "Amigos — clique para remover da lista";
    profileCardFriendBtn.disabled = false;
  } else if (rel === "incoming") {
    profileCardFriendBtn.textContent = "➕";
    profileCardFriendBtn.title = "Aceitar pedido de amizade";
    profileCardFriendBtn.disabled = false;
  } else if (rel === "outgoing") {
    profileCardFriendBtn.textContent = "⏳";
    profileCardFriendBtn.title = "Pedido enviado — clique para cancelar";
    profileCardFriendBtn.disabled = false;
  } else {
    profileCardFriendBtn.textContent = "👥";
    profileCardFriendBtn.title = "Adicionar como amigo";
    profileCardFriendBtn.disabled = false;
  }
}

function switchProfileModalTab(tabKey) {
  document.querySelectorAll(".profile-tab-btn[data-profile-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.profileTab === tabKey);
  });
  document.getElementById("profile-tab-activity")?.classList.toggle("hidden", tabKey !== "activity");
  document.getElementById("profile-tab-board")?.classList.toggle("hidden", tabKey !== "board");
  document.getElementById("profile-tab-wishlist")?.classList.toggle("hidden", tabKey !== "wishlist");
  document.getElementById("profile-tab-mutual-friends")?.classList.toggle("hidden", tabKey !== "mutual-friends");
  document.getElementById("profile-tab-mutual-servers")?.classList.toggle("hidden", tabKey !== "mutual-servers");
}

document.querySelectorAll(".profile-tab-btn[data-profile-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchProfileModalTab(btn.dataset.profileTab);
    if (["board", "wishlist"].includes(btn.dataset.profileTab) && currentPopoverUsername) requestFullProfile(currentPopoverUsername);
  });
});

function populateProfileActivity(user, userId, sk) {
  // 1. Atividade atual (call, tela, câmera, status)
  if (profileActivityCardList) {
    const cards = [];
    let activeVoiceChId = null;
    for (const [chId, ids] of Object.entries(state.voiceMembers || {})) {
      if (Array.isArray(ids) && ids.includes(userId)) {
        activeVoiceChId = chId;
        break;
      }
    }

    if (user?.screen_sharing) {
      const chName = (state.voiceChannels || []).find((c) => c.id === activeVoiceChId)?.name || "Call Privada";
      cards.push({
        icon: "🖥️",
        title: "Transmitindo Tela Ao Vivo",
        sub: `Em ${chName}${user.stream_quality ? ` (${user.stream_quality})` : ""}`,
        joinChId: activeVoiceChId && !isPrivateVoiceId(activeVoiceChId) ? activeVoiceChId : null,
      });
    }
    if (user?.camera_on) {
      cards.push({
        icon: "📷",
        title: "Com a Câmera Ligada",
        sub: "Participando com vídeo na call",
      });
    }
    if (activeVoiceChId) {
      const vc = (state.voiceChannels || []).find((c) => c.id === activeVoiceChId);
      const isPublic = Boolean(vc);
      cards.push({
        icon: "🔊",
        title: `Em chamada de voz — ${vc ? vc.name : "Chamada Privada"}`,
        sub: `${(state.voiceMembers[activeVoiceChId] || []).length} participante(s) na sala`,
        joinChId: isPublic && state.currentVoiceChannel !== activeVoiceChId ? activeVoiceChId : null,
      });
    }
    if (user?.custom_status) {
      cards.push({
        icon: "💬",
        title: "Status personalizado",
        sub: user.custom_status,
      });
    }
    if (cards.length === 0) {
      cards.push({
        icon: sk === "online" || sk === "idle" || sk === "dnd" ? "🎮" : "🌙",
        title: STATUS_LABELS[sk] || "Offline",
        sub: user ? "Ativo agora no servidor Sanvo" : "Nenhuma atividade recente em jogo ou transmissão.",
      });
    }

    profileActivityCardList.innerHTML = "";
    const richAct = sk !== "offline" && user?.activity && typeof user.activity === "object" && user.activity.name ? user.activity : null;
    if (richAct && typeof SancordActivity !== "undefined" && typeof SancordActivity.createRichActivityCard === "function") {
      const richEl = SancordActivity.createRichActivityCard(richAct);
      if (richEl) profileActivityCardList.appendChild(richEl);
    }
    for (const c of cards) {
      if (richAct && c.sub === "Ativo agora no servidor Sanvo") continue;
      const row = document.createElement("div");
      row.className = "profile-activity-card";
      row.innerHTML = `
        <div class="profile-activity-left">
          <div class="profile-activity-icon">${c.icon}</div>
          <div class="profile-activity-meta">
            <strong>${escapeHtml(c.title)}</strong>
            <span>${escapeHtml(c.sub)}</span>
          </div>
        </div>
        ${c.joinChId ? `<button type="button" class="btn-primary small-btn">Entrar na Call</button>` : ""}
      `;
      if (c.joinChId) {
        row.querySelector("button")?.addEventListener("click", () => {
          profilePopoverModal?.classList.add("hidden");
          joinVoiceChannel(c.joinChId);
        });
      }
      profileActivityCardList.appendChild(row);
    }
  }
}

// A mesma apresentação vale para a prévia local e para o perfil vindo do servidor.
function renderVisitedProfile(globalProfile, name, userId) {
  visitedProfileBase = globalProfile;
  const srv = state.servers.find(s => s.id === currentPopoverServerId);
  const user = resolveServerProfile(srv, name, globalProfile);
  const appearance = {
    ...user,
    bio: currentPopoverPrivacy?.bio_visible === false ? null : user.bio,
    banner_url: currentPopoverPrivacy?.banner_visible === false ? null : user.banner_url,
  };
  const lower = name.toLowerCase();
  const serverNick = memberNickname(srv, lower);
  const handle = `@${lower.replace(/\s+/g, "")}`;
  const moreHandle = document.getElementById("profile-more-handle-sub");
  if (moreHandle) moreHandle.textContent = handle;
  const card = document.getElementById("profile-popover-card");
  renderProfileCardIdentity(card, {
    avatar: profileCardAvatar, banner: profileCardBanner, name: profileCardName, handle: profileCardHandle,
    avatarWrap: document.getElementById("profile-card-deco-wrap"), dot: profileCardStatusDot,
    status: profileCardCustomStatus, bio: profileCardBio, badges: document.getElementById("profile-card-badges"),
    pronouns: document.getElementById("profile-card-pronouns"),
    effect: document.getElementById("profile-card-effect-layer"),
  }, { ...appearance, username: name, id: userId }, "full", serverNick || user.display_name || name, handle);
  document.getElementById("profile-card-bio-wrap")?.classList.toggle("hidden", !appearance.bio?.trim());
}

function refreshVisitedServerProfile(serverId) {
  if (currentPopoverServerId === serverId && visitedProfileBase &&
      profilePopoverModal && !profilePopoverModal.classList.contains("hidden")) {
    renderVisitedProfile(visitedProfileBase, currentPopoverUsername, currentPopoverUserId);
  }
}

let visitedProfileEffectPlayed = false;

function playVisitedProfileEffectOnce() {
  if (!visitedProfileEffectPlayed) {
    visitedProfileEffectPlayed = playProfileEffect(document.getElementById("profile-card-effect-layer"));
  }
}

function openMemberProfilePopover(userId, fallbackMsg = null, { global = false } = {}) {
  if (!profilePopoverModal) return;
  closeCompactProfile(false);
  currentPopoverPrivacy = null;
  renderVisitedProfileLinks([]);
  renderVisitedBoard(null);
  renderProfileWishlist(null, document.getElementById("profile-wishlist-widgets"));
  stopProfileEffect(document.getElementById("profile-card-effect-layer"));
  visitedProfileEffectPlayed = false;
  const fallbackLower = fallbackMsg?.author_name?.toLowerCase();
  const user =
    state.users.get(userId) ||
    Array.from(state.users.values()).find(
      (u) => (fallbackLower && u.username.toLowerCase() === fallbackLower) || u.id === userId
    ) ||
    state.friends.find(
      (f) => fallbackLower && f.username.toLowerCase() === fallbackLower
    ) ||
    state.dmConversations.map((c) => c.peer).find(
      (p) => p && fallbackLower && p.username.toLowerCase() === fallbackLower
    );

  const resolvedUserId = user?.id || user?.live_id || userId;
  const name = user?.username || fallbackMsg?.author_name || "Membro";
  const nameLower = name.toLowerCase();
  const color = user?.avatar_color || fallbackMsg?.author_color || "#5865f2";
  const avatarUrl = user?.avatar_url || fallbackMsg?.author_avatar || null;
  const sk = user?.status_kind || (user ? "online" : "invisible");

  currentPopoverUserId = resolvedUserId;
  currentPopoverUsername = name;
  const activeSrv = global ? null : fallbackMsg?.channel_id
    ? serverForChannel(fallbackMsg.channel_id)
    : state.activeView === "server" ? getActiveServer() : null;
  currentPopoverServerId = activeSrv?.id && activeSrv.id !== "sancord" ? activeSrv.id : null;
  profileCardMoreMenu?.classList.add("hidden");
  document.getElementById("profile-invite-submenu")?.classList.add("hidden");

  const moreIgnoreLabel = document.getElementById("profile-more-ignore-label");
  if (moreIgnoreLabel) {
    moreIgnoreLabel.textContent = state.ignoredUsers.has(nameLower) ? "Deixar de ignorar" : "Ignorar";
  }
  const moreBlockLabel = document.getElementById("profile-more-block-label");
  if (moreBlockLabel) {
    moreBlockLabel.textContent = state.blockedUsers.has(nameLower) ? "Desbloquear" : "Bloquear";
  }
  const isSystemBotName = (n) => n === "Sanvo Bot" || n === "Sancord Bot"; // LEGACY COMPATIBILITY: aceita nome antigo do bot
  if (profileCardMemberSince) {
    const isSelf = state.selfUser?.username?.toLowerCase() === nameLower;
    profileCardMemberSince.textContent =
      isSystemBotName(name)
        ? "Sistema do Sanvo"
        : user?.created_at || (isSelf && state.selfUser?.created_at) || "Carregando…";
  }

  const rel = getRelationshipWith(name);
  if (profileCardFriendsSinceRow) {
    profileCardFriendsSinceRow.classList.toggle("hidden", rel !== "friend");
    if (profileCardFriendsSince) profileCardFriendsSince.textContent = "Amigos no Sanvo ✓";
  }

  renderProfileRoles(document.getElementById("profile-card-roles-list"), getUserServerRoles(activeSrv, name));

  if (profileCardNoteInput) {
    profileCardNoteInput.closest(".profile-info-block")?.classList.toggle("hidden",
      isSystemBotName(name) || nameLower === state.selfUser?.username?.toLowerCase());
    profileCardNoteInput.value = getUserProfileNote(name);
  }

  renderVisitedProfile({ online: Boolean(user), ...user, avatar_color: color, avatar_url: avatarUrl, status_kind: sk }, name, resolvedUserId);

  const showVol = Boolean(resolvedUserId && resolvedUserId !== state.selfUser?.id);
  if (profileCardVolumeWrap) {
    profileCardVolumeWrap.classList.toggle("hidden", !showVol);
    if (showVol) {
      const vol = getPeerVolume(resolvedUserId);
      if (profileCardVolSlider) profileCardVolSlider.value = vol;
      if (profileCardVolPct) profileCardVolPct.textContent = `${vol}%`;
    }
  }

  const isOtherRealUser =
    Boolean(name) &&
    !isSystemBotName(name) &&
    name.toLowerCase() !== state.selfUser?.username?.toLowerCase();
  if (profileCardActions) {
    profileCardActions.classList.toggle("hidden", !isOtherRealUser);
    if (isOtherRealUser) {
      updateProfileCardFriendButton(name);
    }
  }

  if (profileActivityCardList) profileActivityCardList.textContent = "Carregando atividade…";
  switchProfileModalTab("activity");
  profilePopoverModal.classList.remove("hidden");
  if (typeof queueProfileMotion === "function") queueProfileMotion();
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.reconcileIdleBudget === "function") {
    SancordCosmetics.reconcileIdleBudget();
  }
  playVisitedProfileEffectOnce();
  // Perfil completo (amigos/servidores em comum, data de entrada) vem do servidor.
  requestFullProfile(name);
}

profileCardNoteInput?.addEventListener("input", (e) => {
  if (!currentPopoverUsername) return;
  setUserProfileNote(currentPopoverUsername, e.target.value);
});

profileCardMoreBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("profile-invite-submenu")?.classList.add("hidden");
  profileCardMoreMenu?.classList.toggle("hidden");
});

profileCardMoreMenu?.querySelectorAll("[data-profile-more]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const act = btn.dataset.profileMore;
    const uname = currentPopoverUsername || "Usuário";
    const unameLower = uname.toLowerCase();

    if (act === "invite-toggle") {
      const sub = document.getElementById("profile-invite-submenu");
      if (!sub) return;
      const opening = sub.classList.contains("hidden");
      if (opening) {
        const myName = state.selfUser?.username;
        const invitable = (state.servers || []).filter((s) => {
          const perms = getServerPermissionsFor(s, myName);
          return perms.create_invites;
        });
        if (invitable.length === 0) {
          sub.innerHTML = `<div class="profile-more-item" style="opacity:0.6;cursor:default;">Sem permissão para convidar</div>`;
        } else {
          sub.innerHTML = "";
          for (const srv of invitable) {
            const sb = document.createElement("button");
            sb.type = "button";
            sb.className = "profile-more-item";
            sb.textContent = `📨 ${srv.name}`;
            sb.addEventListener("click", () => {
              sendWs("InviteFriendToServer", { server_id: srv.id, target_username: uname });
              profileCardMoreMenu.classList.add("hidden");
              sub.classList.add("hidden");
              showUiToast(`Convite de ${srv.name} enviado para ${uname}!`);
            });
            sub.appendChild(sb);
          }
        }
      }
      sub.classList.toggle("hidden");
      return;
    }

    profileCardMoreMenu.classList.add("hidden");
    if (act === "view-main") {
      switchProfileModalTab("activity");
      document.querySelector(".profile-modal-left")?.scrollTo({ top: 0, behavior: "smooth" });
      showUiToast(`Visualizando perfil principal de ${uname}`);
    } else if (act === "share") {
      const handle = `@${unameLower.replace(/\s+/g, "")}`;
      copyTextSafe(`${uname} (${handle}) — Perfil no Sanvo`, `Perfil de ${uname} copiado para compartilhar!`);
    } else if (act === "ignore") {
      if (state.ignoredUsers.has(unameLower)) {
        state.ignoredUsers.delete(unameLower);
        showUiToast(`Você deixou de ignorar ${uname}.`);
      } else {
        state.ignoredUsers.add(unameLower);
        if (currentPopoverUserId && currentPopoverUserId !== state.selfUser?.id) {
          setPeerVolume(currentPopoverUserId, 0);
          if (profileCardVolSlider) profileCardVolSlider.value = 0;
          if (profileCardVolPct) profileCardVolPct.textContent = "0%";
        }
        showUiToast(`${uname} foi ignorado neste dispositivo.`);
      }
      saveModerationLists();
      const lbl = document.getElementById("profile-more-ignore-label");
      if (lbl) lbl.textContent = state.ignoredUsers.has(unameLower) ? "Deixar de ignorar" : "Ignorar";
    } else if (act === "block") {
      // Bloqueio real no servidor (desfaz amizade, impede DM, pedido e chamada).
      if (state.blockedUsers.has(unameLower)) {
        sendWs("UnblockUser", { target_username: uname });
      } else {
        confirmBlockUser(uname);
      }
    } else if (act === "report") {
      openReportUserDialog(uname);
    } else if (act === "copy-id") {
      copyTextSafe(currentPopoverUserId || uname || "", "ID do usuário copiado!");
    }
  });
});

profileCardDmBtn?.addEventListener("click", () => {
  if (!currentPopoverUsername) return;
  profilePopoverModal?.classList.add("hidden");
  sendWs("OpenDm", { target_username: currentPopoverUsername });
});

profileCardFriendBtn?.addEventListener("click", async () => {
  if (!currentPopoverUsername) return;
  const friendTarget = currentPopoverUsername;
  const rel = getRelationshipWith(currentPopoverUsername);
  if (rel === "none") {
    sendWs("SendFriendRequest", { target_username: currentPopoverUsername });
    updateProfileCardFriendButton(currentPopoverUsername);
    profileCardFriendBtn.textContent = "⏳";
  } else if (rel === "incoming") {
    sendWs("RespondFriendRequest", { from_username: currentPopoverUsername, accept: true });
    profileCardFriendBtn.textContent = "✓";
  } else if (rel === "outgoing") {
    sendWs("CancelFriendRequest", { target_username: currentPopoverUsername });
    profileCardFriendBtn.textContent = "👥";
  } else if (rel === "friend") {
    if (await SancordUI.confirm({title:"Remover amizade?",message:`Remover ${friendTarget} da lista de amigos?`,confirmLabel:"Remover",danger:true})) {
      sendWs("RemoveFriend", { target_username: friendTarget });
      profileCardFriendBtn.textContent = "👥";
    }
  }
});

profileCardVolSlider?.addEventListener("input", (e) => {
  if (!currentPopoverUserId) return;
  const val = e.target.value;
  setPeerVolume(currentPopoverUserId, val);
  if (profileCardVolPct) profileCardVolPct.textContent = `${val}%`;
});

const closeProfileCardBtn = document.getElementById("close-profile-card-btn");

closeProfileCardBtn?.addEventListener("click", () => {
  profilePopoverModal?.classList.add("hidden");
});

profilePopoverModal?.addEventListener("click", (e) => {
  if (e.target === profilePopoverModal) {
    profilePopoverModal.classList.add("hidden");
  }
});

// Inicializar 48 barrinhas segmentadas do Teste de Microfone estilo Discord
if (micBarsMeter && micBarsMeter.children.length === 0) {
  micBarsMeter.innerHTML = Array.from({ length: 48 })
    .map(() => `<div class="mic-bar-seg"></div>`)
    .join("");
}

// Aplicar tema, modo compacto, fonte e modo streamer no carregamento
applyAppThemeSettings();

function updateQuickKrispBtnUI() {
  if (!quickKrispBtn) return;
  const mode = currentNoiseSuppressionMode();
  const active = mode !== "off";
  quickKrispBtn.classList.toggle("active-ok", active);
  quickKrispBtn.title = active
    ? `Supressão de Ruído: ${NS_MODE_LABELS[mode]} (clique para desativar)`
    : "Supressão de Ruído: Desligada (clique para ativar)";
}

quickKrispBtn?.addEventListener("click", () => {
  const mode = currentNoiseSuppressionMode();
  if (mode !== "off") {
    state.audioSettings.lastActiveNsMode = mode;
    state.audioSettings.noiseSuppressionMode = "off";
  } else {
    state.audioSettings.noiseSuppressionMode = state.audioSettings.lastActiveNsMode || "auto";
  }
  state.audioSettings.voiceProfile = "custom";
  saveAudioSettings();
  updateQuickKrispBtnUI();
  applyDspParametersRealtime();
});

// Popover rápido nas setinhas de Microfone e Alto-falante
let openQuickDeviceKind = null;

async function openQuickDeviceMenu(kind) {
  if (!quickDevicePopover || !quickDeviceList) return;
  if (openQuickDeviceKind === kind && !quickDevicePopover.classList.contains("hidden")) {
    quickDevicePopover.classList.add("hidden");
    openQuickDeviceKind = null;
    return;
  }
  openQuickDeviceKind = kind;
  if (quickDeviceTitle) {
    quickDeviceTitle.textContent = kind === "mic" ? "Dispositivo de Entrada" : "Dispositivo de Saída";
  }

  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (_) {}

  const targetKind = kind === "mic" ? "audioinput" : "audiooutput";
  const filtered = devices.filter((d) => d.kind === targetKind);
  const currentId =
    kind === "mic" ? state.audioSettings.micDeviceId : state.audioSettings.speakerDeviceId;

  const opts = [{ deviceId: "", label: "Padrão do Windows" }, ...filtered];
  quickDeviceList.innerHTML = "";

  opts.forEach((d, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const isSel = (d.deviceId || "") === (currentId || "");
    btn.className = `quick-device-opt ${isSel ? "active" : ""}`;
    const label = d.label || (kind === "mic" ? `Microfone ${idx}` : `Alto-falante ${idx}`);
    btn.innerHTML = `<span>${escapeHtml(label)}</span>${isSel ? "<span>✓</span>" : ""}`;
    btn.addEventListener("click", () => {
      if (kind === "mic") {
        state.audioSettings.micDeviceId = d.deviceId || "";
        if (micDeviceSelect) micDeviceSelect.value = state.audioSettings.micDeviceId;
        saveAudioSettings();
        ensureLocalAudioStream(true);
      } else {
        state.audioSettings.speakerDeviceId = d.deviceId || "";
        if (speakerDeviceSelect) speakerDeviceSelect.value = state.audioSettings.speakerDeviceId;
        saveAudioSettings();
        document.querySelectorAll("#remote-audio-container audio").forEach((el) => {
          if (typeof el.setSinkId === "function") {
            el.setSinkId(state.audioSettings.speakerDeviceId || "").catch(() => {});
          }
        });
      }
      quickDevicePopover.classList.add("hidden");
      openQuickDeviceKind = null;
    });
    quickDeviceList.appendChild(btn);
  });

  quickDevicePopover.classList.remove("hidden");
}

micQuickChevron?.addEventListener("click", (e) => {
  e.stopPropagation();
  openQuickDeviceMenu("mic");
});

spkQuickChevron?.addEventListener("click", (e) => {
  e.stopPropagation();
  openQuickDeviceMenu("speaker");
});

document.addEventListener("click", (e) => {
  if (
    quickDevicePopover &&
    !quickDevicePopover.classList.contains("hidden") &&
    !quickDevicePopover.contains(e.target) &&
    e.target !== micQuickChevron &&
    e.target !== spkQuickChevron
  ) {
    quickDevicePopover.classList.add("hidden");
    openQuickDeviceKind = null;
  }
});

// Modal de Configurações Full-Screen (Minha Conta, Editar Perfil, Privacidade, Notificações, Voz, Aparência, Atalhos)
const SETTINGS_TAB_TITLES = {
  account: "Minha Conta",
  profile: "Perfis",
  security: "Segurança",
  devices: "Dispositivos",
  connections: "Conexões",
  privacy: "Dados e Privacidade",
  social: "Conteúdo e Social",
  requests: "Solicitações de Mensagem",
  blocked: "Usuários Bloqueados",
  activity: "Atividade e Presença",
  voice: "Voz e Vídeo",
  notifications: "Notificações",
  appearance: "Aparência",
  accessibility: "Acessibilidade",
  chat: "Chat e Mensagens",
  language: "Idioma",
  shortcuts: "Atalhos",
  windows: "Configurações do Windows",
  updates: "Atualizações",
  advanced: "Avançado",
  diagnostics: "Diagnóstico",
  about: "Sobre o Sanvo",
};

// Rascunho e Editor Completo de Perfil (Molduras Animadas/Estáticas, Banner/GIF, Tema, Nome, Efeito, Placa)
const profileDraft = {
  status_kind: "online",
  custom_status: "",
  bio: "",
  avatar_decoration: "none",
  banner_url: "",
  theme_primary: "",
  theme_accent: "",
  name_style: "default",
  name_color: "",
  name_color_secondary: "",
  name_gradient_direction: "horizontal",
  nameplate_style: "none",
  profile_effect: "none",
  // Perfil P1: tema completo e mídia pendente ({ blob, url, name, animated } | "remove").
  theme_highlight: "",
  theme_mode: "gradient",
  theme_direction: "vertical",
  profile_frame: "none",
  badge_order: [],
  hidden_badges: [],
  media: {},
};

const bannerFileInput = document.getElementById("banner-file-input");
const openNameplatePickerBtn = document.getElementById("open-nameplate-picker-btn");
const nameplateMiniAvatar = document.getElementById("nameplate-mini-avatar");
const nameplateCurrentLabel = document.getElementById("nameplate-current-label");
const openDecorationPickerBtn = document.getElementById("open-decoration-picker-btn");
const openDecoQuickBtn = document.getElementById("open-deco-quick-btn");
const settingsDecoPreviewWrap = document.getElementById("settings-deco-preview-wrap");
const settingsDecoPreviewAvatar = document.getElementById("settings-deco-preview-avatar");
const settingsDecoLabel = document.getElementById("settings-deco-label");
const settingsNameShowcase = document.getElementById("settings-name-showcase");
const settingsNameStyleSelect = document.getElementById("settings-name-style-select");
const settingsNameColorSecondary = document.getElementById("settings-name-color-secondary");
const settingsNameGradientDirection = document.getElementById("settings-name-gradient-direction");

function syncNameStyleOptions() {
  if (!settingsNameStyleSelect) return;
  settingsNameStyleSelect.querySelectorAll('[data-catalog-name-style]').forEach(option => option.remove());
  for (const id of NEW_NAME_STYLES) {
    const item = cosmeticInfo("name_style", id);
    if (!item) continue;
    const option = document.createElement("option");
    option.dataset.catalogNameStyle = "";
    option.value = id;
    option.textContent = item.name;
    option.disabled = !ownsCosmetic("name_style", id);
    settingsNameStyleSelect.appendChild(option);
  }
  settingsNameStyleSelect.value = profileNameParts(profileDraft.name_style).effect;
}

function previewProfileNameOption(style, part, option) {
  const parts = profileNameParts(style);
  return composeProfileNameStyle(part === "font" ? option : parts.font, part === "effect" ? option : parts.effect);
}

function renderNameStyleSamples(user) {
  const host = document.getElementById("settings-name-style-samples");
  if (!host || !settingsNameStyleSelect) return;
  const name = user.display_name || user.username;
  const options = [...settingsNameStyleSelect.options];
  const catalog = JSON.stringify(options.map(opt => [opt.value, opt.textContent, opt.disabled]));
  const current = profileNameParts(user.name_style);
  const appearance = JSON.stringify([catalog, name, user.name_style, user.name_color, user.name_color_secondary, user.name_gradient_direction]);
  if (host.dataset.catalog !== catalog) {
    host.dataset.catalog = catalog;
    host.replaceChildren();
    for (const [label, part] of [["Fontes", "font"], ["Efeitos", "effect"]]) {
      const group = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = label;
      group.append(legend);
      for (const opt of options) {
        if (opt.value !== "default" && PROFILE_NAME_FONTS.has(opt.value) !== (part === "font")) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-secondary";
        btn.dataset.styleSample = opt.value;
        btn.dataset.stylePart = part;
        btn.disabled = opt.disabled;
        const sample = document.createElement("span");
        const title = document.createElement("small");
        title.textContent = opt.value === "default" ? (part === "font" ? "Padrão" : "Sólido") : opt.textContent;
        btn.append(sample, title);
        btn.addEventListener("click", () => {
          profileDraft.name_style = previewProfileNameOption(profileDraft.name_style, part, opt.value);
          settingsNameStyleSelect.value = profileNameParts(profileDraft.name_style).effect;
          refreshLiveProfilePreview();
        });
        group.append(btn);
      }
      host.append(group);
    }
  }
  for (const btn of host.querySelectorAll("[data-style-sample]")) {
    const style = btn.dataset.styleSample;
    const part = btn.dataset.stylePart;
    btn.setAttribute("aria-pressed", String(style === current[part]));
    if (host.dataset.appearance !== appearance) {
      btn.firstElementChild.textContent = name;
      applyNameStyleToEl(btn.firstElementChild, { ...user, name_style: previewProfileNameOption(user.name_style, part, style) }, "");
    }
  }
  host.dataset.appearance = appearance;
}
const settingsNameColorInput = document.getElementById("settings-name-color-input");
const custThemePreviewBox = document.getElementById("cust-theme-preview-box");
const settingsThemePrimary = document.getElementById("settings-theme-primary");
const settingsThemeAccent = document.getElementById("settings-theme-accent");
const custBannerPreviewBox = document.getElementById("cust-banner-preview-box");
const settingsChangeBannerBtn = document.getElementById("settings-change-banner-btn");
const settingsBannerBtnLabel = document.getElementById("settings-banner-btn-label");
const settingsRemoveBannerBtn = document.getElementById("settings-remove-banner-btn");
const openEffectPickerBtn = document.getElementById("open-effect-picker-btn");
const settingsEffectLabel = document.getElementById("settings-effect-label");

const liveProfilePreviewCard = document.getElementById("live-profile-preview-card");
const previewEffectLayer = document.getElementById("preview-effect-layer");
const previewCardBanner = document.getElementById("preview-card-banner");
const previewDecoWrap = document.getElementById("preview-deco-wrap");
const previewCardAvatar = document.getElementById("preview-card-avatar");
const previewCardStatusDot = document.getElementById("preview-card-status-dot");
const previewCardName = document.getElementById("preview-card-name");
const previewCardCustomStatus = document.getElementById("preview-card-custom-status");
const previewCardBio = document.getElementById("preview-card-bio");

const decorationPickerModal = document.getElementById("decoration-picker-modal");
const closeDecoPickerBtn = document.getElementById("close-deco-picker-btn");
const cancelDecoPickerBtn = document.getElementById("cancel-deco-picker-btn");
const applyDecoPickerBtn = document.getElementById("apply-deco-picker-btn");
const decoGrid = document.getElementById("deco-grid");

const effectPickerModal = document.getElementById("effect-picker-modal");
const effectPickerTitle = document.getElementById("effect-picker-title");
const closeEffectPickerBtn = document.getElementById("close-effect-picker-btn");
const closeEffectDoneBtn = document.getElementById("close-effect-done-btn");
const effectGrid = document.getElementById("effect-grid");

let pendingDecoFilter = "all";
let tempPickedDeco = "none";

function refreshLiveProfilePreview() {
  if (!state.selfUser) return;
  // Prévia usa a mídia do rascunho (ainda não salva) quando houver.
  const draftUser = draftPreviewUser();
  if (settingsAvatarPreview) {
    settingsAvatarPreview.innerHTML = renderAvatarInner(draftUser.username || state.selfUser.username, draftUser.avatar_url, draftUser.avatar_animated);
    settingsAvatarPreview.style.background = draftUser.avatar_color || state.selfUser.avatar_color;
  }
  renderDecoratedAvatar(settingsDecoPreviewAvatar, settingsDecoPreviewWrap, draftUser);
  if (settingsDecoLabel) {
    // Nome vem do catálogo do servidor (com o antigo como reserva).
    const found = cosmeticInfo("avatar_decoration", profileDraft.avatar_decoration) || AVATAR_DECORATIONS.find((d) => d.id === profileDraft.avatar_decoration);
    settingsDecoLabel.textContent = found && found.id !== "none" ? found.name : "Decoração";
  }
  const frameLabel = document.getElementById("settings-frame-label");
  if (frameLabel) {
    const fr = cosmeticInfo("profile_frame", profileDraft.profile_frame);
    frameLabel.textContent = fr ? fr.name : "Moldura";
  }

  renderDecoratedAvatar(nameplateMiniAvatar, null, draftUser);
  if (nameplateCurrentLabel) {
    const np = cosmeticInfo("nameplate", profileDraft.nameplate_style) || NAMEPLATES.find((n) => n.id === profileDraft.nameplate_style);
    nameplateCurrentLabel.textContent = np ? np.name : "Sem placa";
  }
  if (openNameplatePickerBtn) {
    Array.from(openNameplatePickerBtn.classList)
      .filter((c) => c.startsWith("nameplate-") && c !== "nameplate-trigger-box")
      .forEach((c) => openNameplatePickerBtn.classList.remove(c));
    const npCls = getNameplateClass(profileDraft.nameplate_style);
    if (npCls) openNameplatePickerBtn.classList.add(npCls);
    if (typeof SancordCosmetics !== "undefined") SancordCosmetics.renderNameplateArt(openNameplatePickerBtn, npCls ? profileDraft.nameplate_style : null);
  }

  if (settingsNameShowcase) {
    settingsNameShowcase.textContent = draftUser.display_name || state.selfUser.username;
    applyNameStyleToEl(settingsNameShowcase, profileDraft, "#ffffff");
  }
  renderNameStyleSamples(draftUser);
  document.getElementById("settings-name-gradient-controls")?.classList.toggle("hidden", profileNameParts(profileDraft.name_style).effect !== "custom-gradient");

  if (custThemePreviewBox) {
    custThemePreviewBox.style.background = profileThemeBackground(profileDraft) || "var(--bg-floating)";
  }
  document.getElementById("theme-direction-field")?.classList.toggle("hidden", profileDraft.theme_mode !== "gradient");

  const draftBanner = draftUser.banner_url;
  if (custBannerPreviewBox) {
    custBannerPreviewBox.style.backgroundImage = draftBanner ? `url("${cachedMediaUrl(draftBanner)}")` : "";
    custBannerPreviewBox.style.backgroundColor = profileDraft.theme_primary;
  }
  if (settingsBannerBtnLabel) {
    settingsBannerBtnLabel.textContent = draftBanner ? "Faixa" : "Faixa: cor do tema";
  }
  settingsRemoveBannerBtn?.classList.toggle("hidden", !draftBanner);
  document.getElementById("settings-remove-avatar-btn")?.classList.toggle("hidden", !draftUser.avatar_url);
  updateBioCounter();

  if (settingsEffectLabel) {
    const ef = cosmeticInfo("profile_effect", profileDraft.profile_effect) || PROFILE_EFFECTS.find((e) => e.id === profileDraft.profile_effect);
    settingsEffectLabel.textContent = ef && ef.id !== "none" ? ef.name : "Efeito";
  }

  // Atualiza Cartão PRÉVIA ao vivo
  renderProfileCardIdentity(liveProfilePreviewCard, {
    avatar: previewCardAvatar, avatarWrap: previewDecoWrap, dot: previewCardStatusDot, name: previewCardName,
    handle: document.getElementById("preview-card-handle"), status: previewCardCustomStatus,
    pronouns: document.getElementById("preview-card-pronouns"),
    banner: previewCardBanner, effect: previewEffectLayer, bio: previewCardBio,
    badges: document.getElementById("preview-card-badges"),
  }, draftUser, "editor-full");
  renderProfileContextPreview();
  // Editor visual (profile-editor.js): membro desde, conexões, convites e miniaturas.
  if (typeof peAfterRefresh === "function") peAfterRefresh();
  refreshAnimatedMedia(document.getElementById("settings-tab-profile") || document);
  updateProfileDirtyState();
}

function normalizedProfileAppearance(u) {
  const theme = profileTheme(u);
  return {
    avatar_decoration: u.avatar_decoration || "none",
    theme_primary: (u.theme_primary || "").toLowerCase(),
    theme_accent: (u.theme_accent || "").toLowerCase(),
    name_style: u.name_style || "default",
    name_color: (u.name_color || "").toLowerCase(),
    name_color_secondary: (u.name_color_secondary || "").toLowerCase(),
    name_gradient_direction: u.name_gradient_direction || "horizontal",
    nameplate_style: u.nameplate_style || "none",
    profile_effect: u.profile_effect || "none",
    theme_highlight: (u.theme_highlight || "").toLowerCase(),
    theme_mode: theme.mode,
    theme_direction: theme.direction,
    profile_frame: u.profile_frame || "none",
  };
}

function getNormalizedSavedProfile() {
  const u = state.selfUser || {};
  return {
    ...normalizedProfileAppearance(u),
    status_kind: u.status_kind || "online",
    custom_status: u.custom_status || "",
    bio: u.bio || "",
    banner_url: u.banner_url || "",
    badge_order: [...(state.cosmetics?.badgeOrder || [])],
    hidden_badges: [...(state.cosmetics?.hiddenBadges || [])],
  };
}

// Rascunho do editor = campos do perfil + mural. Salvar/Redefinir/Descartar tratam os dois juntos.
function isProfileDraftDirty() {
  return isProfileFieldsDirty() || (typeof boardIsDirty === "function" && boardIsDirty());
}

function isProfileFieldsDirty() {
  if (!state.selfUser) return false;
  const saved = getNormalizedSavedProfile();
  const socialFields = collectSocialProfileFields();
  const expiry = document.getElementById("settings-status-expiry")?.value;
  return (
    Object.keys(profileDraft.media || {}).length > 0 ||
    socialFields.display_name !== (state.selfUser.display_name || "") ||
    socialFields.pronouns !== (state.selfUser.pronouns || "") ||
    socialFields.custom_status_emoji !== (state.selfUser.custom_status_emoji || "") ||
    expiry !== (state.selfUser.custom_status_expires_at ? "keep" : "0") ||
    (profileDraft.theme_highlight || "").toLowerCase() !== saved.theme_highlight ||
    profileDraft.theme_mode !== saved.theme_mode ||
    profileDraft.theme_direction !== saved.theme_direction ||
    (profileDraft.profile_frame || "none") !== saved.profile_frame ||
    (profileDraft.status_kind || "online") !== saved.status_kind ||
    (profileDraft.custom_status || "") !== saved.custom_status ||
    (profileDraft.bio || "") !== saved.bio ||
    (profileDraft.avatar_decoration || "none") !== saved.avatar_decoration ||
    (profileDraft.banner_url || "") !== saved.banner_url ||
    (profileDraft.theme_primary || "").toLowerCase() !== saved.theme_primary ||
    (profileDraft.theme_accent || "").toLowerCase() !== saved.theme_accent ||
    (profileDraft.name_style || "default") !== saved.name_style ||
    (profileDraft.name_color || "").toLowerCase() !== saved.name_color ||
    profileDraft.name_color_secondary !== saved.name_color_secondary ||
    profileDraft.name_gradient_direction !== saved.name_gradient_direction ||
    (profileDraft.nameplate_style || "none") !== saved.nameplate_style ||
    (profileDraft.profile_effect || "none") !== saved.profile_effect ||
    JSON.stringify(profileDraft.badge_order || []) !== JSON.stringify(saved.badge_order || []) ||
    JSON.stringify(profileDraft.hidden_badges || []) !== JSON.stringify(saved.hidden_badges || [])
  );
}

function updateProfileDirtyState() {
  if (!unsavedProfileBar) return;
  const profileTabEl = document.getElementById("settings-tab-profile");
  const isProfileVisible = Boolean(profileTabEl && !profileTabEl.classList.contains("hidden"));
  const choosingCosmetic = typeof peCosmeticBefore !== "undefined" && Boolean(peCosmeticBefore);
  unsavedProfileBar.classList.toggle("hidden", choosingCosmetic || !(isProfileVisible && isProfileDraftDirty()));
}

function loadAppearanceDraft(u) {
  Object.assign(profileDraft, normalizedProfileAppearance(u));
  const hl = document.getElementById("settings-theme-highlight");
  if (hl) hl.value = profileDraft.theme_highlight || "#8f7dff";
  document.querySelectorAll('input[name="theme-mode"]').forEach((r) => (r.checked = r.value === profileDraft.theme_mode));
  const dir = document.getElementById("settings-theme-direction");
  if (dir) dir.value = profileDraft.theme_direction;

  if (settingsNameStyleSelect) settingsNameStyleSelect.value = profileNameParts(profileDraft.name_style).effect;
  if (settingsNameColorInput) settingsNameColorInput.value = profileDraft.name_color || "#ffffff";
  if (settingsNameColorSecondary) settingsNameColorSecondary.value = profileDraft.name_color_secondary || "#42beae";
  if (settingsNameGradientDirection) settingsNameGradientDirection.value = profileDraft.name_gradient_direction;
  if (settingsThemePrimary) settingsThemePrimary.value = profileDraft.theme_primary || "#5c1726";
  if (settingsThemeAccent) settingsThemeAccent.value = profileDraft.theme_accent || "#111214";
}

function loadDraftFromSelfUser() {
  const u = state.selfUser || {};
  profileDraft.status_kind = u.status_kind || "online";
  profileDraft.custom_status = u.custom_status || "";
  profileDraft.bio = u.bio || "";
  profileDraft.banner_url = u.banner_url || "";
  profileDraft.badge_order = [...(state.cosmetics?.badgeOrder || [])];
  profileDraft.hidden_badges = [...(state.cosmetics?.hiddenBadges || [])];
  discardPendingProfileMedia();
  loadAppearanceDraft(u);
  if (settingsStatusSelect) settingsStatusSelect.value = profileDraft.status_kind;
  if (settingsCustomStatus) settingsCustomStatus.value = profileDraft.custom_status;
  if (settingsBioInput) settingsBioInput.value = profileDraft.bio;
  refreshLiveProfilePreview();
}

function syncSettingsModalFields() {
  if (state.selfUser) {
    updateSelfProfileUI();
    if (typeof fillSocialProfileFields === "function") fillSocialProfileFields(state.selfUser);
    loadDraftFromSelfUser();
  }
  if (typeof renderPrivacySettings === "function") renderPrivacySettings();

  const s = state.audioSettings;
  if (showProfileNameStyles) showProfileNameStyles.checked = s.showProfileNameStyles !== false;
  if (cameraQualitySelect) cameraQualitySelect.value = ["480", "720", "1080"].includes(s.cameraQuality) ? s.cameraQuality : "720";
  if (micGainSlider) micGainSlider.value = s.micGain;
  if (micGainValue) micGainValue.textContent = `${s.micGain}%`;
  if (masterSpeakerSlider) masterSpeakerSlider.value = s.speakerVolume ?? 100;
  if (masterSpeakerValue) masterSpeakerValue.textContent = `${s.speakerVolume ?? 100}%`;
  if (gateThresholdSlider) gateThresholdSlider.value = s.gateThreshold;
  if (gateThresholdValue) gateThresholdValue.textContent = `${s.gateThreshold} dB`;
  if (micMeterThreshold) {
    const pct = Math.max(0, Math.min(100, ((s.gateThreshold + 80) / 80) * 100));
    micMeterThreshold.style.left = `${pct}%`;
  }
  document.querySelectorAll('input[name="voice-profile"]').forEach((r) => {
    r.checked = r.value === (s.voiceProfile || "isolation");
  });
  document.querySelectorAll('input[name="input-mode"]').forEach((r) => {
    r.checked = r.value === s.inputMode;
  });
  pttKeyRow?.classList.toggle("hidden", s.inputMode !== "ptt");
  if (pttKeyDisplay) pttKeyDisplay.textContent = s.pttKey || "Space";
  if (dspNoiseGateToggle) dspNoiseGateToggle.checked = Boolean(s.noiseGate);
  if (dspHighpassToggle) dspHighpassToggle.checked = Boolean(s.highpass);
  if (dspCompressorToggle) dspCompressorToggle.checked = Boolean(s.compressor);
  if (dspAecToggle) dspAecToggle.checked = Boolean(s.aec);
  const dspAgcEl = document.getElementById("dsp-agc");
  if (dspAgcEl) dspAgcEl.checked = s.agc !== false;
  if (dspOpusHdToggle) dspOpusHdToggle.checked = Boolean(s.opusHd);
  updateNoiseSuppressionUi();
  if (notifSoundMessagesToggle) notifSoundMessagesToggle.checked = s.soundMessages !== false;
  if (notifSoundVoiceToggle) notifSoundVoiceToggle.checked = s.soundVoice !== false;
  if (notifDesktopToggle) notifDesktopToggle.checked = Boolean(s.desktopNotif);
  const notifTaskbarEl = document.getElementById("notif-taskbar-badge");
  if (notifTaskbarEl) notifTaskbarEl.checked = s.notifTaskbarBadge !== false;
  const notifDmRailEl = document.getElementById("notif-dm-rail-badge");
  if (notifDmRailEl) notifDmRailEl.checked = s.notifDmBadges !== false;
  if (notifUiVolumeSlider) notifUiVolumeSlider.value = s.uiVolume ?? 100;
  if (notifUiVolumeValue) notifUiVolumeValue.textContent = `${s.uiVolume ?? 100}%`;

  if (privacyTypingToggle) privacyTypingToggle.checked = s.showTyping !== false;
  if (privacyAutoEmbedsToggle) privacyAutoEmbedsToggle.checked = s.autoEmbeds !== false;

  const familyFocusEl = document.getElementById("family-focus-mode");
  const familyLinkEl = document.getElementById("family-link-guard");
  if (familyFocusEl) familyFocusEl.checked = Boolean(s.familyFocus);
  if (familyLinkEl) familyLinkEl.checked = s.linkGuard !== false;
  if (shortcutsPttBadge) shortcutsPttBadge.textContent = s.pttKey || "Space";

  if (appearanceCompactToggle) appearanceCompactToggle.checked = Boolean(s.compactMode);
  if (appearanceAutoDeviceToggle) appearanceAutoDeviceToggle.checked = Boolean(s.autoDeviceTheme);
  if (appearanceFontSlider) appearanceFontSlider.value = Number(s.chatFontSize) || 14;
  if (appearanceFontValue) appearanceFontValue.textContent = `${Number(s.chatFontSize) || 14}px`;
  if (appearanceStreamerToggle) appearanceStreamerToggle.checked = Boolean(s.streamerMode);
  if (appearanceGlassSlider) appearanceGlassSlider.value = s.glassIntensity ?? 60;
  if (appearanceGlassValue) appearanceGlassValue.textContent = `${s.glassIntensity ?? 60}%`;
  if (appearanceAmbientFxSelect) appearanceAmbientFxSelect.value = s.ambientFx || "none";
  if (appearanceRadiusSelect) appearanceRadiusSelect.value = s.uiRadius || "discord";
  if (appearanceVoiceGlowToggle) appearanceVoiceGlowToggle.checked = s.voiceGlow !== false;

  const selectedTheme = s.autoDeviceTheme ? "auto" : s.appTheme || "dark";
  document.querySelectorAll(".theme-swatch-tile[data-app-theme]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.appTheme === selectedTheme);
  });
  document.querySelectorAll(".accent-swatch-tile[data-accent-theme]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.accentTheme === (s.customAccentTheme || "none"));
  });
  document.querySelectorAll(".density-choice-card[data-msg-density]").forEach((btn) => {
    const isComp = btn.dataset.msgDensity === "compact";
    btn.classList.toggle("active", Boolean(s.compactMode) === isComp);
  });

  // Atualiza painel Minha Conta (Hero + Estatísticas + Uptime)
  if (state.selfUser) {
    const heroAv = document.getElementById("account-hero-avatar");
    const heroDeco = document.getElementById("account-hero-deco-wrap");
    const heroBanner = document.getElementById("account-hero-banner");
    const heroName = document.getElementById("account-hero-name");
    const heroSub = document.getElementById("account-hero-sub");
    const infoUser = document.getElementById("account-info-username");
    const infoId = document.getElementById("account-info-id");
    if (heroAv) {
      heroAv.style.background = state.selfUser.avatar_color;
      heroAv.innerHTML = renderAvatarInner(state.selfUser.username, state.selfUser.avatar_url);
    }
    applyDecoToElement(heroDeco, state.selfUser.avatar_decoration);
    if (heroBanner) {
      heroBanner.style.backgroundImage = state.selfUser.banner_url ? `url("${cachedMediaUrl(state.selfUser.banner_url)}")` : "";
      heroBanner.style.backgroundColor = state.selfUser.theme_primary || "#5865f2";
    }
    if (heroName) heroName.textContent = state.selfUser.display_name || state.selfUser.username;
    if (heroSub) heroSub.textContent = `@${state.selfUser.username.toLowerCase().replace(/\s+/g, "")} • ${STATUS_LABELS[state.selfUser.status_kind || "online"] || "Online"}`;
    const dispEl = document.getElementById("account-info-display-name");
    if (dispEl) dispEl.textContent = state.selfUser.display_name || state.selfUser.username;
    if (infoUser) infoUser.textContent = `@${state.selfUser.username}`;
    if (infoId) infoId.textContent = state.selfUser.id || "—";
  }
  const stSrv = document.getElementById("stat-servers-count");
  const stFr = document.getElementById("stat-friends-count");
  const stStar = document.getElementById("stat-starred-count");
  const upEl = document.getElementById("session-uptime-display");
  if (stSrv) stSrv.textContent = String((state.servers || []).length || 1);
  if (stFr) stFr.textContent = String((state.friends || []).length);
  if (stStar) stStar.textContent = String(state.starredMsgIds?.size || 0);
  if (typeof renderAccountStanding === "function") renderAccountStanding();
  if (upEl) {
    const mins = Math.max(1, Math.floor((Date.now() - (state.sessionStartedAt || Date.now())) / 60000));
    upEl.textContent = `${mins} min conectado nesta sessão`;
  }

  applyAppThemeSettings();
  if (typeof syncSettingsCenterFields === "function") syncSettingsCenterFields();
  refreshAudioDeviceLists();
}

function openSettingsModal(tab = "account") {
  if (!settingsModal) return;
  if (settingsSearchInput) {
    settingsSearchInput.value = "";
    document.querySelectorAll(".settings-nav-item[data-settings-tab]").forEach((btn) => {
      btn.classList.remove("hidden");
    });
  }
  syncSettingsModalFields();
  switchSettingsTab(tab);
  settingsModal.classList.remove("hidden");
}

let confirmingProfileDiscard = false;
async function closeSettingsModal() {
  if (typeof peCosmeticBefore !== "undefined" && peCosmeticBefore) closePeSubeditor();
  if (settingsModal && !settingsModal.classList.contains("hidden") && isProfileDraftDirty()) {
    if (confirmingProfileDiscard) return;
    confirmingProfileDiscard = true;
    const discard = await SancordUI.formDialog({
      title: "Descartar alterações de perfil?",
      submitLabel: "Descartar",
      cancelLabel: "Continuar editando",
      danger: true,
    }).finally(() => { confirmingProfileDiscard = false; });
    if (!discard) return;
    loadDraftFromSelfUser();
    fillSocialProfileFields(state.selfUser);
    if (typeof boardIsDirty === "function" && boardIsDirty()) requestBoardEditorState(true);
  }
  if (typeof closePeSubeditor === "function") closePeSubeditor();
  if (state.micTestActive) {
    state.micTestActive = false;
    if (micTestBtn) micTestBtn.textContent = "Teste do microfone";
    applyDspParametersRealtime();
  }
  if (typeof stopSettingsCameraTest === "function") stopSettingsCameraTest();
  state.recordingPttKey = false;
  if (pttRecordBtn) pttRecordBtn.textContent = "Alterar tecla";
  unsavedProfileBar?.classList.add("hidden");
  settingsModal?.classList.add("hidden");
  if (!state.currentVoiceChannel) releaseLocalAudioStream();
}

function switchAccountSubTab(subKey) {
  if (subKey === "security") switchSettingsTab("security");
  else if (subKey === "family") switchSettingsTab("social");
  else switchSettingsTab("account");
}

for (const id of ["settings-display-name", "settings-pronouns", "settings-status-emoji", "settings-status-expiry"]) {
  document.getElementById(id)?.addEventListener("input", refreshLiveProfilePreview);
}

function switchSettingsTab(tabName) {
  if (tabName !== "profile" && typeof peCosmeticBefore !== "undefined" && peCosmeticBefore) closePeSubeditor();
  if (tabName !== "voice" && typeof stopSettingsCameraTest === "function") stopSettingsCameraTest();
  if (tabName === "privacy" || tabName === "connections" || tabName === "activity") requestProfileSharing();
  if (tabName === "activity" && typeof SancordActivity !== "undefined") SancordActivity.onSettingsOpened();
  if (tabName === "devices" || tabName === "security") sendWs("ListSessions");
  document.querySelectorAll(".settings-nav-item[data-settings-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsTab === tabName);
  });
  settingsNavProfileCard?.classList.toggle("active", tabName === "profile");
  Object.keys(SETTINGS_TAB_TITLES).forEach((key) => {
    document.getElementById(`settings-tab-${key}`)?.classList.toggle("hidden", key !== tabName);
  });
  if (settingsTopbarTitle) {
    settingsTopbarTitle.textContent = SETTINGS_TAB_TITLES[tabName] || "Configurações";
  }
  if (tabName === "voice") {
    refreshAudioDeviceLists();
  }
  const scrollArea = document.getElementById("settings-content-scroll");
  if (scrollArea) scrollArea.scrollTop = 0;
  if (typeof onSettingsCenterTabShown === "function") onSettingsCenterTabShown(tabName);
  if (tabName === "profile" && typeof onProfileEditorShown === "function") onProfileEditorShown();
  updateProfileDirtyState();
}

settingsNavProfileCard?.addEventListener("click", () => switchSettingsTab("profile"));

settingsSearchInput?.addEventListener("input", (e) => {
  const q = (e.target.value || "").trim().toLowerCase();
  document.querySelectorAll(".settings-nav-item[data-settings-tab]").forEach((btn) => {
    const label = (btn.dataset.navLabel || btn.textContent || "").toLowerCase();
    btn.classList.toggle("hidden", Boolean(q) && !label.includes(q));
  });
});

document.querySelectorAll(".settings-nav-item[data-settings-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchSettingsTab(btn.dataset.settingsTab));
});

openSettingsBtn?.addEventListener("click", () => {
  if (typeof closeSelfProfileMenu === "function") closeSelfProfileMenu();
  openSettingsModal("account");
});
selfProfileTrigger?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (typeof toggleSelfProfileMenu === "function") toggleSelfProfileMenu();
});
selfProfileTrigger?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (typeof toggleSelfProfileMenu === "function") toggleSelfProfileMenu();
  }
});
closeSettingsBtn?.addEventListener("click", closeSettingsModal);
settingsModal?.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

settingsStatusSelect?.addEventListener("change", (e) => {
  profileDraft.status_kind = e.target.value;
  refreshLiveProfilePreview();
});
settingsCustomStatus?.addEventListener("input", (e) => {
  profileDraft.custom_status = e.target.value;
  refreshLiveProfilePreview();
});
settingsBioInput?.addEventListener("input", (e) => {
  profileDraft.bio = e.target.value;
  refreshLiveProfilePreview();
});
settingsNameStyleSelect?.addEventListener("change", (e) => {
  const option = e.target.value;
  profileDraft.name_style = previewProfileNameOption(profileDraft.name_style, PROFILE_NAME_FONTS.has(option) ? "font" : "effect", option);
  refreshLiveProfilePreview();
});
settingsNameColorInput?.addEventListener("input", (e) => {
  profileDraft.name_color = e.target.value;
  refreshLiveProfilePreview();
});
settingsNameColorSecondary?.addEventListener("input", (e) => {
  profileDraft.name_color_secondary = e.target.value;
  refreshLiveProfilePreview();
});
settingsNameGradientDirection?.addEventListener("change", (e) => {
  profileDraft.name_gradient_direction = e.target.value;
  refreshLiveProfilePreview();
});
settingsThemePrimary?.addEventListener("input", (e) => {
  profileDraft.theme_primary = e.target.value;
  if (profileDraft.theme_mode === "gradient" && !profileDraft.theme_accent) profileDraft.theme_accent = settingsThemeAccent.value;
  refreshLiveProfilePreview();
});
settingsThemeAccent?.addEventListener("input", (e) => {
  profileDraft.theme_accent = e.target.value;
  if (!profileDraft.theme_primary) profileDraft.theme_primary = settingsThemePrimary.value;
  refreshLiveProfilePreview();
});

settingsChangeBannerBtn?.addEventListener("click", () => bannerFileInput?.click());
settingsRemoveBannerBtn?.addEventListener("click", () => {
  setPendingProfileMedia("banner", "remove");
});

// Perfil P1: banner passa pelo mesmo editor de recorte (formato faixa) e só vai ao
// servidor ao clicar em Salvar. GIF mantém a animação (sem recorte).
bannerFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  bannerFileInput.value = "";
  if (!file || !file.type.startsWith("image/")) return;
  openAvatarCropModal(file, "banner");
});

// Modal Seletor de Decorações / Molduras (Animadas e Estáticas)
function renderDecorationGrid() {
  if (!decoGrid || !state.selfUser) return;
  const avHtml = renderAvatarInner(state.selfUser.username, state.selfUser.avatar_url);
  const items =
    pendingDecoFilter === "all"
      ? AVATAR_DECORATIONS
      : AVATAR_DECORATIONS.filter((d) => d.kind === pendingDecoFilter || d.id === "none");

  decoGrid.innerHTML = "";
  for (const deco of items) {
    const card = document.createElement("button");
    card.type = "button";
    const isSel = tempPickedDeco === deco.id;
    card.className = `deco-choice-card ${isSel ? "selected" : ""}`;
    card.innerHTML = `
      <div class="avatar-deco-wrap ${getDecoClass(deco.id)}" style="width: 52px; height: 52px;">
        <div class="avatar" style="background: ${state.selfUser.avatar_color}; width: 52px; height: 52px; font-size: 18px;">
          ${avHtml}
        </div>
        ${getDecoSvgHtml(deco.id)}
      </div>
      <span class="deco-choice-name">${escapeHtml(deco.name)}</span>
      ${deco.id !== "none" ? `<span class="deco-kind-pill">${deco.kind === "animated" ? "✨ Animada" : "Estática"}</span>` : ""}
    `;
    card.addEventListener("click", () => {
      tempPickedDeco = deco.id;
      renderDecorationGrid();
    });
    decoGrid.appendChild(card);
  }
}

function openDecorationPickerModal() {
  if (!decorationPickerModal) return;
  tempPickedDeco = profileDraft.avatar_decoration || "none";
  pendingDecoFilter = "all";
  document.querySelectorAll(".deco-filter-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.decoFilter === "all");
  });
  renderDecorationGrid();
  decorationPickerModal.classList.remove("hidden");
}

document.querySelectorAll(".deco-filter-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    pendingDecoFilter = btn.dataset.decoFilter || "all";
    document.querySelectorAll(".deco-filter-tab").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    renderDecorationGrid();
  });
});

// Perfil P2: decoração (avatar) e moldura (cartão) têm seletores separados, ambos do catálogo.
// Editor de perfil: decoração, moldura, efeito e placa abrem subeditores na lateral
// (static/js/profile-editor.js), com o perfil completo visível ao lado.
openDecorationPickerBtn?.addEventListener("click", e => openPeView("decoration", e.currentTarget));
openDecoQuickBtn?.addEventListener("click", e => openPeView("frame", e.currentTarget));
closeDecoPickerBtn?.addEventListener("click", () => decorationPickerModal?.classList.add("hidden"));
cancelDecoPickerBtn?.addEventListener("click", () => decorationPickerModal?.classList.add("hidden"));
decorationPickerModal?.addEventListener("click", (e) => {
  if (e.target === decorationPickerModal) decorationPickerModal.classList.add("hidden");
});
applyDecoPickerBtn?.addEventListener("click", () => {
  profileDraft.avatar_decoration = tempPickedDeco;
  decorationPickerModal?.classList.add("hidden");
  refreshLiveProfilePreview();
});

// Modal Seletor de Efeito de Perfil & Placa de Identificação
function openEffectOrNameplatePicker(mode) {
  if (!effectPickerModal || !effectGrid) return;
  stopProfileEffect();
  if (effectPickerTitle) {
    effectPickerTitle.textContent =
      mode === "effect" ? "Efeito de Perfil Animado" : "Placa de Identificação";
  }

  const kind = mode === "effect" ? "profile_effect" : "nameplate";
  const list = (mode === "effect" ? PROFILE_EFFECTS : NAMEPLATES)
    .filter(item => !item.requiresCatalog || cosmeticInfo(kind, item.id));
  const activeId =
    mode === "effect" ? profileDraft.profile_effect : profileDraft.nameplate_style;

  effectGrid.innerHTML = "";
  const preview = document.getElementById("effect-picker-preview");
  const previewCard = document.getElementById("effect-picker-card");
  buildCompactProfile(previewCard);
  const layer = compactProfileSlots(previewCard).effect;
  layer.id = "picker-effect-layer";
  function renderEffectSample(id) {
    const user = { ...draftPreviewUser(), profile_effect: id };
    const username = user.username || state.selfUser?.username || "Sanvo";
    renderCompactProfile(previewCard, user, user.display_name || username, username, true);
  }
  preview?.classList.toggle("hidden", mode !== "effect");
  const platePreview = document.getElementById("nameplate-picker-preview");
  platePreview?.classList.toggle("hidden", mode !== "nameplate");
  if (mode === "nameplate" && platePreview) {
    platePreview.textContent = draftPreviewUser().display_name || state.selfUser?.username || "Prévia da placa";
    applyNameplateChip(platePreview, activeId);
  }
  if (mode === "effect") renderEffectSample(activeId);
  for (const item of list) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `effect-choice-btn ${activeId === item.id ? "selected" : ""}`;
    btn.setAttribute("aria-pressed", String(activeId === item.id));
    const catalogItem = cosmeticInfo(kind, item.id);
    btn.disabled = !ownsCosmetic(kind, item.id);
    if (mode === "nameplate") {
      const swatch = document.createElement("span");
      swatch.className = `nameplate-option-swatch ${getNameplateClass(item.id)}`;
      swatch.setAttribute("aria-hidden", "true");
      btn.appendChild(swatch);
    } else {
      const sample = document.createElement("span");
      sample.className = "effect-option-preview";
      const effect = document.createElement("span");
      effect.className = "profile-effect-layer";
      sample.append(effect);
      btn.append(sample);
      configureProfileEffect(effect, item.id);
      const preview = () => playProfileEffect(effect);
      btn.addEventListener("pointerenter", preview);
      btn.addEventListener("focus", preview);
      btn.addEventListener("pointerleave", () => stopProfileEffect(effect));
    }
    btn.insertAdjacentHTML("beforeend", `<strong>${escapeHtml(catalogItem?.name || item.name)}</strong><span>${escapeHtml(item.desc)}</span>`);
    btn.addEventListener("click", () => {
      if (mode === "effect") profileDraft.profile_effect = item.id;
      else profileDraft.nameplate_style = item.id;
      for (const choice of effectGrid.querySelectorAll("button")) {
        choice.classList.toggle("selected", choice === btn);
        choice.setAttribute("aria-pressed", String(choice === btn));
      }
      refreshLiveProfilePreview();
      if (mode === "effect") {
        renderEffectSample(item.id);
        playProfileEffect(layer);
      } else applyNameplateChip(platePreview, item.id);
    });
    effectGrid.appendChild(btn);
  }
  effectPickerModal.classList.remove("hidden");
}

openEffectPickerBtn?.addEventListener("click", e => openPeView("effect", e.currentTarget));
openNameplatePickerBtn?.addEventListener("click", e => openPeView("nameplate", e.currentTarget));
closeEffectPickerBtn?.addEventListener("click", () => effectPickerModal?.classList.add("hidden"));
closeEffectDoneBtn?.addEventListener("click", () => {
  effectPickerModal?.classList.add("hidden");
  if (!document.getElementById("effect-picker-preview")?.classList.contains("hidden")) replayCurrentProfilePreview();
});
effectPickerModal?.addEventListener("click", (e) => {
  if (e.target === effectPickerModal) effectPickerModal.classList.add("hidden");
});

resetProfileDraftBtn?.addEventListener("click", () => {
  loadDraftFromSelfUser();
  if (state.selfUser) fillSocialProfileFields(state.selfUser);
  if (typeof boardIsDirty === "function" && boardIsDirty()) requestBoardEditorState(true);
  refreshLiveProfilePreview();
  showUiToast("Alterações não salvas redefinidas.");
});

saveProfileBtn?.addEventListener("click", async () => {
  // O mural tem fila própria no servidor (SaveProfileBoard); sai junto do mesmo botão.
  if (typeof boardIsDirty === "function" && boardIsDirty()) document.getElementById("board-save")?.click();
  if (!isProfileFieldsDirty()) {
    updateProfileDirtyState();
    return;
  }
  // Perfil P1: avatar/banner pendentes sobem antes (anexo + SetProfileMedia).
  if (Object.keys(profileDraft.media || {}).length) {
    saveProfileBtn.disabled = true;
    const ok = await flushPendingProfileMedia().finally(() => (saveProfileBtn.disabled = false));
    if (!ok) return;
  }
  const statusKind = settingsStatusSelect?.value || "online";
  const customStatus = settingsCustomStatus?.value.trim() || null;
  const bio = settingsBioInput?.value.trim() || null;

  profileDraft.status_kind = statusKind;
  profileDraft.custom_status = customStatus || "";
  profileDraft.bio = bio || "";

  const socialFields = collectSocialProfileFields();
  const sent = sendWs("UpdateProfile", {
    status_kind: statusKind,
    custom_status: customStatus,
    bio,
    avatar_decoration: profileDraft.avatar_decoration || "none",
    theme_highlight: profileDraft.theme_highlight || "",
    theme_mode: profileDraft.theme_mode || "gradient",
    theme_direction: profileDraft.theme_direction || "vertical",
    profile_frame: profileDraft.profile_frame || "none",
    theme_primary: profileDraft.theme_primary || "",
    theme_accent: profileDraft.theme_accent || "",
    name_style: profileDraft.name_style || "default",
    name_color: profileDraft.name_color || "",
    name_color_secondary: profileDraft.name_color_secondary,
    name_gradient_direction: profileDraft.name_gradient_direction,
    nameplate_style: profileDraft.nameplate_style || "none",
    profile_effect: profileDraft.profile_effect || "none",
    badge_order: [...(profileDraft.badge_order || [])],
    hidden_badges: [...(profileDraft.hidden_badges || [])],
    ...socialFields,
  });
  if (!sent) {
    showErrorToast("Sem conexão para salvar o perfil. Tente novamente quando reconectar.");
    return;
  }

  if (state.selfUser) {
    state.selfUser.display_name = socialFields.display_name || null;
    state.selfUser.pronouns = socialFields.pronouns || null;
    state.selfUser.custom_status_emoji = socialFields.custom_status_emoji || null;
    if (socialFields.custom_status_expires_in !== undefined) {
      const seconds = socialFields.custom_status_expires_in;
      state.selfUser.custom_status_expires_at = seconds > 0 ? Date.now() + seconds * 1000 : null;
    }
    state.selfUser.status_kind = statusKind;
    state.selfUser.custom_status = customStatus;
    state.selfUser.bio = bio;
    state.selfUser.avatar_decoration =
      profileDraft.avatar_decoration === "none" ? null : profileDraft.avatar_decoration;
    state.selfUser.theme_highlight = profileDraft.theme_highlight || null;
    state.selfUser.theme_mode = profileDraft.theme_mode;
    state.selfUser.theme_direction = profileDraft.theme_direction;
    state.selfUser.profile_frame = profileDraft.profile_frame === "none" ? null : profileDraft.profile_frame;
    state.selfUser.theme_primary = profileDraft.theme_primary;
    state.selfUser.theme_accent = profileDraft.theme_accent;
    state.selfUser.name_style = profileDraft.name_style;
    state.selfUser.name_color = profileDraft.name_color;
    state.selfUser.name_color_secondary = profileDraft.name_color_secondary || null;
    state.selfUser.name_gradient_direction = profileDraft.name_gradient_direction;
    state.selfUser.nameplate_style =
      profileDraft.nameplate_style === "none" ? null : profileDraft.nameplate_style;
    state.selfUser.profile_effect =
      profileDraft.profile_effect === "none" ? null : profileDraft.profile_effect;
    if (state.cosmetics) {
      state.cosmetics.badgeOrder = [...(profileDraft.badge_order || [])];
      state.cosmetics.hiddenBadges = [...(profileDraft.hidden_badges || [])];
    }
    if (typeof computeVisibleBadges === "function") {
      state.selfUser.badges = computeVisibleBadges(
        getOwnedBadgesList(),
        profileDraft.badge_order,
        profileDraft.hidden_badges,
        getMaxVisibleBadges()
      );
    }
    fillSocialProfileFields(state.selfUser);
    updateSelfProfileUI();
    renderChatMessages();
    renderMembersSidebar();
  }

  updateProfileDirtyState();
  showUiToast("Alterações de perfil enviadas.");
});

micDeviceSelect?.addEventListener("change", (e) => {
  state.audioSettings.micDeviceId = e.target.value;
  saveAudioSettings();
  ensureLocalAudioStream(true);
});

cameraDeviceSelect?.addEventListener("change", (e) => {
  state.audioSettings.cameraDeviceId = e.target.value;
  saveAudioSettings();
});
cameraQualitySelect?.addEventListener("change", (e) => {
  state.audioSettings.cameraQuality = e.target.value;
  saveAudioSettings();
});

speakerDeviceSelect?.addEventListener("change", (e) => {
  state.audioSettings.speakerDeviceId = e.target.value;
  saveAudioSettings();
  if (typeof SancordSoundManager !== "undefined") {
    SancordSoundManager.applyOutputDevice(state.audioSettings.speakerDeviceId || "");
  }
  document.querySelectorAll("#remote-audio-container audio").forEach((el) => {
    if (typeof el.setSinkId === "function") {
      el.setSinkId(state.audioSettings.speakerDeviceId || "").catch(() => {});
    }
  });
});

micGainSlider?.addEventListener("input", (e) => {
  state.audioSettings.micGain = Number(e.target.value);
  if (micGainValue) micGainValue.textContent = `${state.audioSettings.micGain}%`;
  saveAudioSettings();
  applyDspParametersRealtime();
});

masterSpeakerSlider?.addEventListener("input", (e) => {
  state.audioSettings.speakerVolume = Number(e.target.value);
  if (masterSpeakerValue) masterSpeakerValue.textContent = `${state.audioSettings.speakerVolume}%`;
  saveAudioSettings();
  for (const entry of state.audioGainNodes.values()) {
    applyVolumeToEntry(entry, getPeerVolume(entry.peerId));
  }
});

gateThresholdSlider?.addEventListener("input", (e) => {
  state.audioSettings.gateThreshold = Number(e.target.value);
  if (gateThresholdValue) gateThresholdValue.textContent = `${state.audioSettings.gateThreshold} dB`;
  if (micMeterThreshold) {
    const pct = Math.max(0, Math.min(100, ((state.audioSettings.gateThreshold + 80) / 80) * 100));
    micMeterThreshold.style.left = `${pct}%`;
  }
  saveAudioSettings();
});

document.querySelectorAll('input[name="voice-profile"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    const val = e.target.value;
    state.audioSettings.voiceProfile = val;
    if (val === "isolation") {
      state.audioSettings.noiseSuppressionMode = "auto";
      state.audioSettings.noiseGate = false;
      state.audioSettings.highpass = true;
      state.audioSettings.compressor = true;
      state.audioSettings.aec = true;
      state.audioSettings.agc = true;
    } else if (val === "studio") {
      state.audioSettings.noiseSuppressionMode = "off";
      state.audioSettings.noiseGate = false;
      state.audioSettings.highpass = false;
      state.audioSettings.compressor = false;
    }
    saveAudioSettings();
    syncSettingsModalFields();
    updateQuickKrispBtnUI();
    applyDspParametersRealtime();
  });
});

document.getElementById("dsp-ns-mode")?.addEventListener("change", (e) => {
  const next = typeof SancordVoiceDspCore !== "undefined"
    ? SancordVoiceDspCore.sanitizeMode(e.target.value, "auto")
    : e.target.value;
  state.audioSettings.noiseSuppressionMode = next;
  if (next !== "off") state.audioSettings.lastActiveNsMode = next;
  state.audioSettings.voiceProfile = "custom";
  saveAudioSettings();
  updateQuickKrispBtnUI();
  applyDspParametersRealtime();
});

document.getElementById("mic-test-ab-btn")?.addEventListener("click", () => {
  if (!state.micTestActive) return;
  state.micTestAbRaw = !state.micTestAbRaw;
  applyDspParametersRealtime();
});

document.querySelectorAll('input[name="input-mode"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    state.audioSettings.inputMode = e.target.value;
    pttKeyRow?.classList.toggle("hidden", state.audioSettings.inputMode !== "ptt");
    saveAudioSettings();
  });
});

pttRecordBtn?.addEventListener("click", () => {
  state.recordingPttKey = true;
  pttRecordBtn.textContent = "Pressione uma tecla...";
});

async function toggleMicrophoneTest() {
  if (state.micTestActive) {
    state.micTestActive = false;
    state.micTestAbRaw = false;
    micTestBtn.textContent = "Teste do microfone";
    applyDspParametersRealtime();
    if (!state.currentVoiceChannel) releaseLocalAudioStream();
    return;
  }
  state.micTestActive = true;
  state.micTestAbRaw = false;
  const stream = await ensureLocalAudioStream();
  if (!stream) state.micTestActive = false;
  if (!state.micTestActive) return;
  micTestBtn.textContent = state.micTestActive ? "Parar teste" : "Teste do microfone";
  applyDspParametersRealtime();
}
micTestBtn?.addEventListener("click", toggleMicrophoneTest);

[
  [dspNoiseGateToggle, "noiseGate", false],
  [dspHighpassToggle, "highpass", false],
  [dspCompressorToggle, "compressor", false],
  [dspAecToggle, "aec", true],
  [document.getElementById("dsp-agc"), "agc", true],
  [dspOpusHdToggle, "opusHd", false],
].forEach(([el, key, needsRebuild]) => {
  el?.addEventListener("change", () => {
    state.audioSettings[key] = Boolean(el.checked);
    state.audioSettings.voiceProfile = "custom";
    saveAudioSettings();
    syncSettingsModalFields();
    updateQuickKrispBtnUI();
    if (needsRebuild && state.dsp) {
      ensureLocalAudioStream(true);
    } else {
      applyDspParametersRealtime();
    }
  });
});

notifSoundMessagesToggle?.addEventListener("change", (e) => {
  state.audioSettings.soundMessages = Boolean(e.target.checked);
  saveAudioSettings();
});

notifSoundVoiceToggle?.addEventListener("change", (e) => {
  state.audioSettings.soundVoice = Boolean(e.target.checked);
  saveAudioSettings();
});

appearanceCompactToggle?.addEventListener("change", (e) => {
  state.audioSettings.compactMode = Boolean(e.target.checked);
  saveAudioSettings();
  syncSettingsModalFields();
});

appearanceAutoDeviceToggle?.addEventListener("change", (e) => {
  state.audioSettings.autoDeviceTheme = Boolean(e.target.checked);
  if (state.audioSettings.autoDeviceTheme) {
    state.audioSettings.appTheme = "auto";
  } else if (state.audioSettings.appTheme === "auto") {
    state.audioSettings.appTheme = "dark";
  }
  saveAudioSettings();
  syncSettingsModalFields();
});

document.querySelectorAll(".theme-swatch-tile[data-app-theme]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.appTheme;
    state.audioSettings.appTheme = theme;
    state.audioSettings.autoDeviceTheme = theme === "auto";
    saveAudioSettings();
    syncSettingsModalFields();
  });
});

toggleAccentPaletteBtn?.addEventListener("click", () => {
  appearanceAccentSection?.scrollIntoView({ behavior: "smooth", block: "center" });
  appearanceAccentSection?.classList.toggle("accent-pulse");
});

document.querySelectorAll(".accent-swatch-tile[data-accent-theme]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.audioSettings.customAccentTheme = btn.dataset.accentTheme || "none";
    saveAudioSettings();
    syncSettingsModalFields();
  });
});

document.querySelectorAll(".density-choice-card[data-msg-density]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.audioSettings.compactMode = btn.dataset.msgDensity === "compact";
    saveAudioSettings();
    syncSettingsModalFields();
  });
});

appearanceFontSlider?.addEventListener("input", (e) => {
  const px = Number(e.target.value) || 14;
  state.audioSettings.chatFontSize = px;
  if (appearanceFontValue) appearanceFontValue.textContent = `${px}px`;
  saveAudioSettings();
  applyAppThemeSettings();
});

appearanceStreamerToggle?.addEventListener("change", (e) => {
  state.audioSettings.streamerMode = Boolean(e.target.checked);
  saveAudioSettings();
  applyAppThemeSettings();
});

resetLocalAudioBtn?.addEventListener("click", () => {
  state.audioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  saveAudioSettings();
  syncSettingsModalFields();
  applyProfileVisualSettings();
  updateQuickKrispBtnUI();
  ensureLocalAudioStream(true);
});

// Bloqueia menu de contexto nativo do navegador em áreas em branco (mantém em campos de texto e mensagens)
document.addEventListener("contextmenu", (e) => {
  const t = e.target;
  const isEditable =
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    Boolean(t?.closest?.("input, textarea, [contenteditable='true']"));
  if (isEditable) return;
  e.preventDefault();
});

// Atalhos globais Estilo Discord (ESC, Ctrl+Shift+M, Ctrl+Shift+D, Push-to-Talk)
window.addEventListener("keydown", (e) => {
  if (state.recordingPttKey) {
    e.preventDefault();
    state.audioSettings.pttKey = e.code || e.key;
    state.recordingPttKey = false;
    if (pttKeyDisplay) pttKeyDisplay.textContent = state.audioSettings.pttKey;
    if (pttRecordBtn) pttRecordBtn.textContent = "Alterar Tecla";
    saveAudioSettings();
    return;
  }

  if (e.key === "Escape") {
    if (changePasswordModal && !changePasswordModal.classList.contains("hidden")) {
      changePasswordModal.classList.add("hidden");
      return;
    }
    if (msgContextMenu && !msgContextMenu.classList.contains("hidden")) {
      closeMessageContextMenu();
      return;
    }
    if (forwardMsgModal && !forwardMsgModal.classList.contains("hidden")) {
      forwardMsgModal.classList.add("hidden");
      forwardSourceMsg = null;
      return;
    }
    if (avatarCropModal && !avatarCropModal.classList.contains("hidden")) {
      closeAvatarCropModal();
      return;
    }
    if (decorationPickerModal && !decorationPickerModal.classList.contains("hidden")) {
      decorationPickerModal.classList.add("hidden");
      return;
    }
    if (effectPickerModal && !effectPickerModal.classList.contains("hidden")) {
      effectPickerModal.classList.add("hidden");
      return;
    }
    // Editor de perfil: Esc fecha o menu de prévia, depois volta do subeditor; só então fecha.
    if (settingsModal && !settingsModal.classList.contains("hidden") && typeof handlePeEscape === "function" && handlePeEscape()) return;
    if (settingsModal && !settingsModal.classList.contains("hidden")) closeSettingsModal();
    profilePopoverModal?.classList.add("hidden");
    imageLightboxModal?.classList.add("hidden");
    createChannelModal?.classList.add("hidden");
    emojiPopover?.classList.add("hidden");
    pinnedPopover?.classList.add("hidden");
    quickDevicePopover?.classList.add("hidden");
    return;
  }

  if (e.ctrlKey && e.shiftKey && (e.key === "M" || e.key === "m")) {
    e.preventDefault();
    toggleMuteBtn?.click();
    return;
  }

  if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
    e.preventDefault();
    toggleDeafenBtn?.click();
    return;
  }

  const tag = (document.activeElement?.tagName || "").toLowerCase();
  const inInput = tag === "input" || tag === "textarea" || tag === "select";
  if (!inInput && state.audioSettings.inputMode === "ptt") {
    const keyMatch = e.code === state.audioSettings.pttKey || e.key === state.audioSettings.pttKey;
    if (keyMatch && !state.pttHeld) {
      state.pttHeld = true;
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (state.audioSettings.inputMode === "ptt") {
    const keyMatch = e.code === state.audioSettings.pttKey || e.key === state.audioSettings.pttKey;
    if (keyMatch) {
      const delay = Math.max(0, Math.min(1000, Number(state.audioSettings.pttReleaseDelayMs) || 0));
      clearTimeout(state.pttReleaseTimer);
      if (delay > 0) {
        state.pttReleaseTimer = setTimeout(() => { state.pttHeld = false; }, delay);
      } else {
        state.pttHeld = false;
      }
    }
  }
});

// ============================================================================
// 8. Sistema de Amigos, Mensagens Diretas (DMs) & Chamadas Privadas
// ============================================================================

function friendsTabIsAdd() {
  return state.friendsTab === "add";
}

function getDmVoiceIdFromDmId(dmId) {
  if (!dmId) return null;
  if (dmId.startsWith("gdm:")) return dmId.replace(/^gdm:/, "gdmvoice:");
  return dmId.replace(/^dm:/, "dmvoice:");
}

function switchToServerView() {
  window.Sanoted?.hide();
  state.activeView = "server";
  state.activeDmId = null;

  railHomeWrap?.classList.remove("active");
  navHomeBtn?.classList.remove("active");
  renderGuildRail();

  sidebarServerView?.classList.remove("hidden");
  sidebarHomeView?.classList.add("hidden");

  friendsMainView?.classList.add("hidden");
  chatMainView?.classList.remove("hidden");
  dmCallBtn?.classList.add("hidden");
  document.getElementById("dm-video-call-btn")?.classList.add("hidden");

  serverMembersPanel?.classList.remove("hidden");
  dmPeerPanel?.classList.add("hidden");
  appLayout?.classList.toggle("hide-members", !toggleMembersBtn?.classList.contains("active"));

  const srv = getActiveServer();
  const ch = state.textChannels.find((c) => c.id === state.currentTextChannel) ||
    state.voiceChannels.find((c) => c.id === state.currentTextChannel);
  const chName = ch ? ch.name : "Sem canais acessíveis";
  currentTextChannelTitle.textContent = chName;
  // Ícone por tipo, descrição do canal e bloqueio de escrita em anúncios.
  applyChannelHeader(srv, ch);
  // Thread aberta no lugar do canal / fecha a visão de fórum (static/js/threads.js).
  if (typeof onServerViewShown === "function") onServerViewShown(ch);

  state.searchQuery = "";
  if (chatSearchInput) chatSearchInput.value = "";
  pinnedPopover?.classList.add("hidden");
  clearReplyingTo();

  onChannelOpened(getActiveTextChannelId());
  renderTextChannels();
  renderVoiceChannels();
  renderChatMessages();
  updatePinnedBadge();
  renderTypingIndicator();
  renderMessageRequestBanner();
  syncVoiceStageContext();
}

function switchToHomeFriendsView(tabName = null) {
  window.Sanoted?.hide();
  state.activeView = "home";
  state.homeSection = "friends";
  state.activeDmId = null;
  onChannelOpened(null);
  if (tabName) state.friendsTab = tabName;

  railHomeWrap?.classList.add("active");
  navHomeBtn?.classList.add("active");
  renderGuildRail();

  sidebarHomeView?.classList.remove("hidden");
  sidebarServerView?.classList.add("hidden");

  friendsMainView?.classList.remove("hidden");
  chatMainView?.classList.add("hidden");
  openFriendsTabBtn?.classList.add("active");
  document.getElementById("open-starred-tab-btn")?.classList.remove("active");
  document.getElementById("friends-tabs-bar")?.classList.remove("hidden");
  const topHeading = document.getElementById("friends-topbar-heading");
  if (topHeading) topHeading.textContent = "Amigos";
  document.getElementById("home-starred-pane")?.classList.add("hidden");

  // Na aba Amigos escondemos a barra lateral direita para dar amplitude total estilo Discord
  appLayout?.classList.add("hide-members");

  renderDmList();
  renderFriendsView();
  updateHomeStarredBadge();
  renderMessageRequestBanner();
}

function switchToHomeStarredView() {
  window.Sanoted?.hide();
  state.activeView = "home";
  state.homeSection = "starred";
  state.activeDmId = null;
  onChannelOpened(null);

  railHomeWrap?.classList.add("active");
  navHomeBtn?.classList.add("active");
  renderGuildRail();

  sidebarHomeView?.classList.remove("hidden");
  sidebarServerView?.classList.add("hidden");
  friendsMainView?.classList.remove("hidden");
  chatMainView?.classList.add("hidden");

  openFriendsTabBtn?.classList.remove("active");
  document.getElementById("open-starred-tab-btn")?.classList.add("active");
  document.getElementById("friends-tabs-bar")?.classList.add("hidden");
  const topHeading = document.getElementById("friends-topbar-heading");
  if (topHeading) topHeading.textContent = "Mensagens Favoritas";

  appLayout?.classList.add("hide-members");
  renderDmList();
  renderHomeStarredView();
}

function renderHomeStarredView() {
  friendsAddPane?.classList.add("hidden");
  friendsListPane?.classList.add("hidden");
  const starredPane = document.getElementById("home-starred-pane");
  const starredList = document.getElementById("home-starred-list");
  const starredCountEl = document.getElementById("home-starred-count");
  starredPane?.classList.remove("hidden");
  renderActiveNowPanel();
  updateHomeStarredBadge();

  if (!starredList) return;
  starredList.innerHTML = "";

  const favDmIds = Array.isArray(state.prefs?.favorite_dms) ? state.prefs.favorite_dms : [];
  const favConvs = favDmIds
    .map((id) => (state.dmConversations || []).find((c) => c.dm_id === id))
    .filter(Boolean);

  const matches = [];
  for (const [chId, list] of Object.entries(state.chatHistory || {})) {
    for (const msg of list || []) {
      if (state.starredMsgIds.has(msg.id)) {
        matches.push({ chId, msg });
      }
    }
  }
  if (starredCountEl) {
    const total = favConvs.length + matches.length;
    starredCountEl.textContent = `FAVORITOS — ${total}`;
  }

  if (favConvs.length === 0 && matches.length === 0) {
    starredList.innerHTML = SancordUI.emptyHTML({icon:"star",title:"Nenhum favorito ainda",description:"Favorite conversas pelo menu de botão direito ou marque mensagens com estrela."});
    return;
  }

  for (const conv of favConvs) {
    const p = conv.peer;
    const li = document.createElement("li");
    li.className = "starred-home-card is-favorite-dm";
    li.innerHTML = `
      <div class="starred-home-meta">
        <div class="starred-home-author">${escapeHtml(p.display_name || p.username)} • <span style="opacity:0.65;font-weight:500;">Conversa direta</span></div>
        <div class="starred-home-text">${escapeHtml(conv.last_message || (p.online ? "Online" : "Offline"))}</div>
      </div>
      <div class="starred-home-actions">
        <button type="button" class="btn-primary small-btn" data-fav-open="1">Abrir</button>
        <button type="button" class="btn-secondary small-btn" data-fav-remove="1">Remover</button>
      </div>
    `;
    li.querySelector("[data-fav-open]")?.addEventListener("click", () => {
      sendWs("OpenDm", { target_username: p.username });
    });
    li.querySelector("[data-fav-remove]")?.addEventListener("click", () => {
      if (typeof DmContextMenu !== "undefined") DmContextMenu.toggleFavoriteDm(conv.dm_id, p.display_name || p.username);
    });
    starredList.appendChild(li);
  }

  for (const { chId, msg } of matches) {
    const li = document.createElement("li");
    li.className = "starred-home-card";
    li.innerHTML = `
      <div class="starred-home-meta">
        <div class="starred-home-author">${escapeHtml(msg.author_name || "Usuário")} • <span style="opacity:0.65;font-weight:500;">${escapeHtml(chId)}</span></div>
        <div class="starred-home-text">${escapeHtml(msg.content || (msg.image_url ? "[Imagem anexada]" : "Mensagem"))}</div>
      </div>
      <button type="button" class="btn-secondary small-btn">Remover</button>
    `;
    li.querySelector("button")?.addEventListener("click", () => {
      state.starredMsgIds.delete(msg.id);
      saveStarredMessages();
      renderHomeStarredView();
      renderChatMessages();
    });
    starredList.appendChild(li);
  }
}

function openDmConversation(dmId, peerObj = null) {
  window.Sanoted?.hide();
  state.activeView = "home";
  state.activeDmId = dmId;
  const attach = document.getElementById("attach-image-btn");
  if (attach) attach.disabled = false;
  if (pinnedMsgsBtn) pinnedMsgsBtn.disabled = false;

  if (peerObj && !state.dmConversations.some((c) => c.dm_id === dmId)) {
    state.dmConversations.unshift({ dm_id: dmId, peer: peerObj, last_message: null, last_timestamp: null });
  }

  railHomeWrap?.classList.add("active");
  navHomeBtn?.classList.add("active");
  renderGuildRail();
  chatInput.disabled = false;

  sidebarHomeView?.classList.remove("hidden");
  sidebarServerView?.classList.add("hidden");

  friendsMainView?.classList.add("hidden");
  chatMainView?.classList.remove("hidden");
  openFriendsTabBtn?.classList.remove("active");

  appLayout?.classList.toggle("hide-members", !toggleMembersBtn?.classList.contains("active"));
  serverMembersPanel?.classList.add("hidden");
  dmPeerPanel?.classList.remove("hidden");

  state.searchQuery = "";
  if (chatSearchInput) chatSearchInput.value = "";
  pinnedPopover?.classList.add("hidden");
  clearReplyingTo();

  onChannelOpened(dmId);
  updateHomeNotificationBadges();
  updateActiveDmHeaderAndSidebar();
  renderDmList();
  renderChatMessages();
  updatePinnedBadge();
  renderTypingIndicator();
  updateDmCallButtonUI();
  syncVoiceStageContext();
  chatInput?.focus();
}

function updateActiveDmHeaderAndSidebar() {
  if (state.activeView !== "home" || !state.activeDmId) return;
  if (state.activeDmId.startsWith("gdm:")) {
    updateActiveGroupHeader();
    return;
  }
  const conv = findPrivateConv(state.activeDmId);
  if (!conv) return;
  const peer = conv.peer;
  renderMessageRequestBanner(conv);
  const sk = peer.online ? peer.status_kind || "online" : "invisible";

  if (chatHeaderIcon) {
    chatHeaderIcon.innerHTML = `
      <div class="avatar-small" style="background: ${peer.avatar_color}; width: 26px; height: 26px; font-size: 11px;">
        ${renderAvatarInner(peer.username, peer.avatar_url)}
      </div>
    `;
  }
  currentTextChannelTitle.textContent = `@ ${peer.display_name || peer.username}`;
  if (chatChannelTopic) {
    chatChannelTopic.textContent = peer.online
      ? customStatusText(peer) || STATUS_LABELS[sk] || "Online"
      : "Offline • Conversa Privada";
  }
  chatInput.placeholder = `Conversar com @${peer.username} (mensagem privada)`;
  renderDmPeerPanel(peer);
}

function renderDmPeerPanel(peerParam = null) {
  if (!dmPeerPanel) return;
  if (state.activeDmId?.startsWith("gdm:")) {
    renderGroupMembersPanel();
    return;
  }
  const conv = findPrivateConv(state.activeDmId);
  const peer = peerParam || conv?.peer;
  if (!peer) {
    dmPeerPanel.innerHTML = "";
    return;
  }
  const sk = peer.online ? peer.status_kind || "online" : "invisible";
  const statusLabel = peer.online ? customStatusText(peer) || STATUS_LABELS[sk] || "Online" : "Offline";
  const rel = getRelationshipWith(peer.username);

  const decoCls = getDecoClass(peer.avatar_decoration);
  const cardBgStyle =
    peer.theme_primary || peer.theme_accent
      ? `width: 100%; box-shadow: none; background: linear-gradient(180deg, ${peer.theme_primary || "#1e1f22"} 0%, ${peer.theme_accent || "#111214"} 100%);`
      : `width: 100%; box-shadow: none;`;
  dmPeerPanel.innerHTML = `
    <div class="profile-card" style="${cardBgStyle}">
      <div class="profile-card-banner" style="height: 76px;"></div>
      <div class="profile-card-body">
        <div class="profile-card-avatar-wrap ${decoCls}">
          <div class="avatar large-avatar" style="background: ${peer.avatar_color}">
            ${renderAvatarInner(peer.username, peer.avatar_url, peer.avatar_animated)}
          </div>
          <span class="status-badge ${sk}" style="width: 16px; height: 16px;"></span>
        </div>
        <div class="profile-nameplate-wrap"><h3 class="dm-peer-name">${escapeHtml(peer.display_name || peer.username)}</h3></div>
        <div class="profile-card-handle">@${escapeHtml(peer.username.toLowerCase())}${peer.pronouns ? ` • ${escapeHtml(peer.pronouns)}` : ""}</div>
        <div class="profile-card-custom-status">${escapeHtml(statusLabel)}</div>
        <div class="profile-card-section">
          <label>SOBRE MIM</label>
          <p>${escapeHtml(peer.bio || "Nenhuma biografia definida.")}</p>
        </div>
        <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
          ${
            rel === "none"
              ? `<button type="button" class="btn-primary small-btn" id="dm-panel-add-friend">👥 Adicionar Amigo</button>`
              : rel === "incoming"
                ? `<button type="button" class="btn-primary small-btn" id="dm-panel-accept-friend">✓ Aceitar Amizade</button>`
                : rel === "outgoing"
                  ? `<button type="button" class="btn-secondary small-btn" disabled>⏳ Pedido Enviado</button>`
                  : `<button type="button" class="btn-secondary small-btn" id="dm-panel-remove-friend">✓ Amigos (Remover)</button>`
          }
          <button type="button" class="btn-secondary small-btn danger-text" id="dm-panel-block">🚫 Bloquear</button>
        </div>
      </div>
    </div>
  `;

  applyNameStyleToEl(dmPeerPanel.querySelector(".dm-peer-name"), peer);
  applyNameplateChip(dmPeerPanel.querySelector(".profile-nameplate-wrap"), peer.nameplate_style);
  applyDecoToElement(dmPeerPanel.querySelector(".profile-card-avatar-wrap"), peer.avatar_decoration);
  setProfileBanner(dmPeerPanel.querySelector(".profile-card-banner"), peer);

  dmPeerPanel.querySelector("#dm-panel-add-friend")?.addEventListener("click", () => {
    sendWs("SendFriendRequest", { target_username: peer.username });
  });
  dmPeerPanel.querySelector("#dm-panel-accept-friend")?.addEventListener("click", () => {
    sendWs("RespondFriendRequest", { from_username: peer.username, accept: true });
  });
  dmPeerPanel.querySelector("#dm-panel-remove-friend")?.addEventListener("click", async () => {
    if (await SancordUI.confirm({title:"Remover amizade?",message:`Remover ${peer.username} dos amigos?`,confirmLabel:"Remover",danger:true})) {
      sendWs("RemoveFriend", { target_username: peer.username });
    }
  });
  dmPeerPanel.querySelector("#dm-panel-block")?.addEventListener("click", () => confirmBlockUser(peer.username));
}

function updateDmCallButtonUI() {
  if (!dmCallBtn) return;
  const inDmView = state.activeView === "home" && Boolean(state.activeDmId);
  dmCallBtn.classList.toggle("hidden", !inDmView);
  const videoBtn = document.getElementById("dm-video-call-btn");
  // Chamada de vídeo: só aparece fora da chamada; dentro dela a câmera fica no painel de voz.
  videoBtn?.classList.toggle(
    "hidden",
    !inDmView || state.currentVoiceChannel === getDmVoiceIdFromDmId(state.activeDmId)
  );
  if (!inDmView) {
    if (typeof renderPrivateCallBanner === "function") renderPrivateCallBanner();
    return;
  }

  const dmVoiceId = getDmVoiceIdFromDmId(state.activeDmId);
  const inThisCall = state.currentVoiceChannel === dmVoiceId;
  const membersInCall = state.voiceMembers[dmVoiceId] || [];
  const activeCall = state.activeCalls?.get?.(dmVoiceId);
  const joinableCall = membersInCall.length > 0 || Boolean(activeCall && activeCall.state !== "ENDED");

  dmCallBtn.classList.toggle("in-call", inThisCall);
  if (dmCallBtnLabel) {
    if (inThisCall) {
      dmCallBtnLabel.textContent = "Desligar";
    } else if (joinableCall) {
      dmCallBtnLabel.textContent = "Entrar na Call";
    } else {
      dmCallBtnLabel.textContent = "Ligar";
    }
  }
  if (typeof renderPrivateCallBanner === "function") renderPrivateCallBanner();
}

dmCallBtn?.addEventListener("click", () => {
  if (!state.activeDmId) return;
  const dmVoiceId = getDmVoiceIdFromDmId(state.activeDmId);
  if (state.currentVoiceChannel === dmVoiceId) {
    leaveVoiceChannel();
  } else {
    joinVoiceChannel(dmVoiceId, getFriendlyVoiceName(dmVoiceId));
  }
});

// Seção 33: chamada de vídeo em DM/grupo = entrar na chamada e ligar a câmera.
document.getElementById("dm-video-call-btn")?.addEventListener("click", async () => {
  if (!state.activeDmId) return;
  const dmVoiceId = getDmVoiceIdFromDmId(state.activeDmId);
  if (state.currentVoiceChannel !== dmVoiceId) {
    await joinVoiceChannel(dmVoiceId, getFriendlyVoiceName(dmVoiceId));
  }
  // A entrada pode ter sido recusada ou cancelada no meio do caminho.
  if (state.currentVoiceChannel === dmVoiceId && !state.cameraOn && !state.cameraStarting) {
    toggleCamera();
  }
});

dmCallAcceptBtn?.addEventListener("click", () => {
  const pending = state.pendingIncomingCall;
  if (typeof answerIncomingCall === "function") {
    answerIncomingCall(pending);
    return;
  }
  dmCallToast?.classList.add("hidden");
  state.pendingIncomingCall = null;
  stopIncomingRing();
  if (!pending) return;
  if (pending.dm_id?.startsWith("gdm:")) {
    openGroupConversation(pending.dm_id);
    joinVoiceChannel(pending.voice_channel_id, getFriendlyVoiceName(pending.voice_channel_id));
    return;
  }
  sendWs("OpenDm", { target_username: pending.from_username });
  joinVoiceChannel(pending.voice_channel_id, `Call privada: @${pending.from_username}`);
});

dmCallDismissBtn?.addEventListener("click", () => {
  const pending = state.pendingIncomingCall;
  if (typeof declineIncomingCall === "function") {
    declineIncomingCall(pending);
    return;
  }
  dmCallToast?.classList.add("hidden");
  state.pendingIncomingCall = null;
  stopIncomingRing();
  if (pending?.voice_channel_id) sendWs("DeclineCall", { channel_id: pending.voice_channel_id });
});

function updateHomeNotificationBadges() {
  const pendingCount = state.incomingRequests.length;
  let unreadTotal = 0;
  for (const cnt of state.unreadDms.values()) {
    unreadTotal += cnt;
  }
  const railBadgesOn = state.audioSettings?.notifDmBadges !== false;
  const fmt = typeof SancordNotifications !== "undefined"
    ? SancordNotifications.formatUnreadCount
    : (n) => (n > 99 ? "99+" : String(n));

  if (typeof SancordNotifications !== "undefined") {
    SancordNotifications.renderRailUnreadDms();
  }

  // Quando os avatares de DM não lidas aparecem logo abaixo do botão Início,
  // a badge do próprio botão Início exibe apenas solicitações pendentes (sem duplicar).
  const homeCount = railBadgesOn ? pendingCount : (pendingCount + unreadTotal);
  if (homeNotifBadge) {
    homeNotifBadge.textContent = fmt(homeCount);
    homeNotifBadge.classList.toggle("hidden", homeCount === 0);
  }
  if (friendsPendingBadge) {
    friendsPendingBadge.textContent = fmt(pendingCount);
    friendsPendingBadge.classList.toggle("hidden", pendingCount === 0);
  }
  if (friendsPendingPill) {
    friendsPendingPill.textContent = fmt(pendingCount);
    friendsPendingPill.classList.toggle("hidden", pendingCount === 0);
  }
}

function renderDmList() {
  if (!dmListEl) return;
  const q = (state.dmFilterQuery || "").trim().toLowerCase();
  const matches = (p) => p.username.toLowerCase().includes(q) || (p.display_name || "").toLowerCase().includes(q);
  const list = q ? state.dmConversations.filter((c) => matches(c.peer)) : state.dmConversations;
  const groups = (state.groupDms || []).filter(
    (g) => !q || groupDisplayName(g).toLowerCase().includes(q) || (g.members || []).some(matches)
  );

  dmListEl.innerHTML = "";
  const requestsEntry = buildMessageRequestsEntry();
  if (requestsEntry) dmListEl.appendChild(requestsEntry);
  if (list.length === 0 && groups.length === 0) {
    dmListEl.insertAdjacentHTML("beforeend", `<li class="ui-empty-compact">${SancordUI.emptyHTML({icon:q ? "search" : "chat",title:q ? "Nenhuma conversa encontrada" : "Suas conversas",description:q ? "Tente outro nome." : "Escolha um amigo para começar."})}</li>`);
    return;
  }

  for (const g of groups) dmListEl.appendChild(buildGroupDmItem(g));

  const pinnedOrder = Array.isArray(state.prefs?.pinned_dms) ? state.prefs.pinned_dms : [];
  const pinnedSet = new Set(pinnedOrder);
  const pinnedConvs = [];
  const regularConvs = [];
  for (const conv of list) {
    if (pinnedSet.has(conv.dm_id)) pinnedConvs.push(conv);
    else regularConvs.push(conv);
  }
  pinnedConvs.sort((a, b) => pinnedOrder.indexOf(a.dm_id) - pinnedOrder.indexOf(b.dm_id));

  const fmtUnread = typeof SancordNotifications !== "undefined"
    ? SancordNotifications.formatUnreadCount
    : (n) => (n > 99 ? "99+" : String(n));

  const renderDmRow = (conv, isPinnedRow) => {
    const p = conv.peer;
    const sk = p.online ? p.status_kind || "online" : "invisible";
    const unread = state.unreadDms.get(conv.dm_id) || 0;
    const isActive = state.activeView === "home" && state.activeDmId === conv.dm_id;
    const isFav = Array.isArray(state.prefs?.favorite_dms) && state.prefs.favorite_dms.includes(conv.dm_id);
    const isBot = Boolean(p.is_bot || p.username === "Sanvo Bot" || p.username === "Sancord Bot" || (Array.isArray(p.badges) && p.badges.includes("verified_bot")));

    const li = document.createElement("li");
    const dmMuted = typeof isMutedId === "function" && isMutedId(conv.dm_id);
    li.className = `dm-item ${isActive ? "active" : ""}${unread > 0 ? " is-unread" : ""}${dmMuted ? " is-muted" : ""}${isPinnedRow ? " is-pinned" : ""} ${getNameplateClass(p.nameplate_style)}`;
    const markers = [
      isPinnedRow && typeof SancordIcons !== "undefined" ? `<span class="dm-marker-icon" title="Fixada">${SancordIcons.html("pin")}</span>` : "",
      isFav && typeof SancordIcons !== "undefined" ? `<span class="dm-marker-icon is-fav" title="Favorita">${SancordIcons.html("star")}</span>` : "",
    ].join("");
    const subText = conv.last_message || (isBot ? "App" : (p.online ? customStatusText(p) || STATUS_LABELS[sk] || "Online" : "Offline"));
    li.innerHTML = `
      <div class="dm-item-left">
        <div class="user-avatar-wrap dm-avatar-wrap">
          <div class="avatar dm-avatar" style="background: ${p.avatar_color};">
            ${renderAvatarInner(p.username, p.avatar_url, p.avatar_animated)}
          </div>
          <span class="status-badge ${sk} dm-status-dot"></span>
        </div>
        <div class="dm-item-meta">
          <div class="dm-item-name-row">
            <div class="dm-item-name">${escapeHtml(p.display_name || p.username)}</div>
            ${isBot ? `<span class="dm-role-chip">APP</span>` : ""}
          </div>
          <div class="dm-item-sub">${escapeHtml(subText)}</div>
        </div>
      </div>
      <div class="dm-item-trailing">
        ${markers}
        ${unread > 0 ? `<span class="dm-count-badge">${fmtUnread(unread)}</span>` : ""}
      </div>
    `;
    applyNameStyleToEl(li.querySelector(".dm-item-name"), p);
    applyDecoToElement(li.querySelector(".user-avatar-wrap"), p.avatar_decoration);
    if (typeof SancordCosmetics !== "undefined" && p.nameplate_style) SancordCosmetics.renderNameplateArt(li, p.nameplate_style);
    li.addEventListener("click", () => {
      sendWs("OpenDm", { target_username: p.username });
    });
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (typeof DmContextMenu !== "undefined") {
        DmContextMenu.open(e.clientX, e.clientY, { conv, peer: p });
      }
    });
    dmListEl.appendChild(li);
  };

  if (pinnedConvs.length > 0) {
    const hdr = document.createElement("li");
    hdr.className = "dm-section-label";
    hdr.setAttribute("role", "presentation");
    hdr.textContent = `FIXADAS — ${pinnedConvs.length}`;
    dmListEl.appendChild(hdr);
    for (const conv of pinnedConvs) renderDmRow(conv, true);
    if (regularConvs.length > 0) {
      const hdr2 = document.createElement("li");
      hdr2.className = "dm-section-label";
      hdr2.setAttribute("role", "presentation");
      hdr2.textContent = "MENSAGENS DIRETAS";
      dmListEl.appendChild(hdr2);
    }
  }
  for (const conv of regularConvs) renderDmRow(conv, false);
}

function renderActiveNowPanel() {
  const listEl = document.getElementById("active-now-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const cards = [];

  // 1. Salas de voz ativas com membros conectados agora
  for (const [chId, members] of Object.entries(state.voiceMembers || {})) {
    if (!Array.isArray(members) || members.length === 0) continue;
    const chUsers = members
      .map((uid) => state.users.get(uid))
      .filter(Boolean);
    if (chUsers.length === 0) continue;

    const namesTitle = chUsers.map((u) => u.username).slice(0, 2).join(" e ") +
      (chUsers.length > 2 ? ` +${chUsers.length - 2}` : "");
    const friendlyCh = getFriendlyVoiceName(chId) || chId;
    const leadUser = chUsers[0];

    const card = document.createElement("div");
    card.className = "active-now-card";
    card.innerHTML = `
      <div class="active-now-card-head">
        <div class="avatar" style="background:${leadUser.avatar_color};width:34px;height:34px;">
          ${renderAvatarInner(leadUser.username, leadUser.avatar_url)}
        </div>
        <div class="active-now-card-meta">
          <div class="active-now-card-title">${escapeHtml(namesTitle)}</div>
          <div class="active-now-card-sub">Em um canal de voz</div>
        </div>
      </div>
      <div class="active-now-inner-box">
        <div class="active-now-ch-info">
          <span style="color:#4ade80;">🔊</span>
          <div>
            <div class="active-now-ch-name">${escapeHtml(friendlyCh)}</div>
            <div class="active-now-ch-type">CALL • ${chUsers.length} conectado${chUsers.length > 1 ? "s" : ""}</div>
          </div>
        </div>
        <span class="role-chip-pill">Entrar</span>
      </div>
    `;
    card.addEventListener("click", () => {
      if (!isPrivateVoiceId(chId)) {
        joinVoiceChannel(chId, friendlyCh);
      } else {
        openMemberProfilePopover(leadUser.id);
      }
    });
    cards.push(card);
  }

  // 2. Amigos online jogando ou com status personalizado
  const activeFriends = (state.friends || []).filter(
    (f) => f.online && !f.voice_channel_id && (f.activity?.name || f.custom_status)
  );
  for (const f of activeFriends) {
    const card = document.createElement("div");
    card.className = "active-now-card";
    const activitySub = f.activity?.name
      ? `${typeof SancordActivity !== "undefined" ? SancordActivity.formatSummarySentence(f.activity) : `Jogando ${f.activity.name}`}${f.activity.started_at && typeof SancordActivity !== "undefined" ? ` · ${SancordActivity.formatElapsed(f.activity.started_at)}` : ""}`
      : f.custom_status;
    card.innerHTML = `
      <div class="active-now-card-head">
        <div class="avatar" style="background:${f.avatar_color};width:34px;height:34px;">
          ${renderAvatarInner(f.username, f.avatar_url)}
        </div>
        <div class="active-now-card-meta">
          <div class="active-now-card-title">${escapeHtml(f.username)}</div>
          <div class="active-now-card-sub">${escapeHtml(activitySub)}</div>
        </div>
      </div>
    `;
    card.addEventListener("click", () => openMemberProfilePopover(null, { author_name: f.username, author_color: f.avatar_color, author_avatar: f.avatar_url }));
    cards.push(card);
  }

  if (cards.length === 0) {
    listEl.innerHTML = SancordUI.emptyHTML({icon:"voice",title:"Por enquanto está tudo quieto",description:"As chamadas e atividades compartilhadas dos seus amigos aparecerão aqui."});
    return;
  }

  cards.forEach((c) => listEl.appendChild(c));
}

function renderHomeFirstSteps() {
  const visible = Boolean(state.selfUser && state.servers.length === 0 &&
    state.homeSection === "friends" && ["online", "all"].includes(state.friendsTab) &&
    !(state.friendsSearchQuery || "").trim());
  document.getElementById("home-first-steps")?.classList.toggle("hidden", !visible);
  return visible;
}

function renderFriendsView() {
  if (state.homeSection === "sanoted") return;
  if (!friendsMainView) return;
  renderActiveNowPanel();
  const showFirstSteps = renderHomeFirstSteps();
  if (state.homeSection === "starred") {
    renderHomeStarredView();
    return;
  }
  document.getElementById("home-starred-pane")?.classList.add("hidden");
  document.querySelectorAll(".friends-tab-btn[data-friends-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.friendsTab === state.friendsTab);
  });

  const isAdd = state.friendsTab === "add";
  friendsAddPane?.classList.toggle("hidden", !isAdd);
  friendsListPane?.classList.toggle("hidden", isAdd);

  if (isAdd) {
    renderQuickAddMembers();
    return;
  }

  const q = (state.friendsSearchQuery || "").trim().toLowerCase();
  if (!friendsItemsList) return;
  friendsItemsList.innerHTML = "";

  if (state.friendsTab === "blocked" || state.friendsTab === "requests") {
    renderSocialFriendsTab(state.friendsTab, q);
    return;
  }

  if (state.friendsTab === "pending") {
    const incoming = state.incomingRequests.filter((u) => u.username.toLowerCase().includes(q));
    const outgoing = state.outgoingRequests.filter((u) => u.username.toLowerCase().includes(q));
    const total = incoming.length + outgoing.length;
    if (friendsListCount) friendsListCount.textContent = `PENDENTES — ${total}`;

    if (total === 0) {
      friendsItemsList.innerHTML = SancordUI.emptyHTML({icon:"users",title:"Nenhuma solicitação pendente",description:"Novos pedidos de amizade aparecem aqui."});
      return;
    }

    for (const u of incoming) {
      friendsItemsList.appendChild(buildPendingFriendRow(u, "incoming"));
    }
    for (const u of outgoing) {
      friendsItemsList.appendChild(buildPendingFriendRow(u, "outgoing"));
    }
    return;
  }

  const baseList =
    state.friendsTab === "online" ? state.friends.filter((f) => f.online) : state.friends;
  const filtered = q
    ? baseList.filter((f) => f.username.toLowerCase().includes(q) || (f.display_name || "").toLowerCase().includes(q))
    : baseList;

  const showList = !showFirstSteps || filtered.length > 0;
  friendsListPane?.classList.toggle("hidden", !showList);
  if (friendsListCount) {
    friendsListCount.textContent = `${state.friendsTab === "online" ? "ONLINE" : "TODOS OS AMIGOS"} — ${filtered.length}`;
  }

  if (filtered.length === 0) {
    const offline = state.friends.length && state.friendsTab === "online";
    friendsItemsList.innerHTML = `<li>${SancordUI.emptyHTML({icon:q ? "search" : "users",title:q ? "Nenhum amigo encontrado" : offline ? "Nenhum amigo disponível" : "Comece uma amizade",description:q ? "Tente outro nome." : offline ? "Veja seus contatos na aba Todos." : "Use Adicionar amigo para enviar uma solicitação."})}</li>`;
    return;
  }

  for (const f of filtered) {
    friendsItemsList.appendChild(buildFriendRow(f));
  }
}

function buildFriendRow(f) {
  const sk = f.online ? f.status_kind || "online" : "invisible";
  const statusText = f.online
    ? customStatusText(f) || STATUS_LABELS[sk] || "Online"
    : "Offline";

  const li = document.createElement("li");
  li.className = `friend-row ${getNameplateClass(f.nameplate_style)}`;
  li.innerHTML = `
    <div class="friend-row-left">
      <div class="user-avatar-wrap">
        <div class="avatar" style="background: ${f.avatar_color}; width: 38px; height: 38px;">
          ${renderAvatarInner(f.username, f.avatar_url)}
        </div>
        <span class="status-badge ${sk}"></span>
      </div>
      <div>
        <div class="friend-row-name"><span class="friend-display-name">${escapeHtml(f.display_name || f.username)}</span>${f.display_name ? ` <span class="friend-row-handle">@${escapeHtml(f.username.toLowerCase())}</span>` : ""}</div>
        <div class="friend-row-sub">${escapeHtml(statusText)}</div>
      </div>
    </div>
    <div class="friend-row-actions">
      <button type="button" class="friend-circle-btn" data-act="dm" title="Enviar Mensagem Privada">💬</button>
      <button type="button" class="friend-circle-btn accept" data-act="call" title="Iniciar Chamada de Voz Privada">📞</button>
      <button type="button" class="friend-circle-btn" data-act="more" title="Mais opções">⋯</button>
    </div>
  `;
  applyNameStyleToEl(li.querySelector(".friend-display-name"), f);
  applyDecoToElement(li.querySelector(".user-avatar-wrap"), f.avatar_decoration);
  if (typeof SancordCosmetics !== "undefined" && f.nameplate_style) SancordCosmetics.renderNameplateArt(li, f.nameplate_style);
  const openFriendMenu = (x, y, anchor = null) => {
    const existingConv = (state.dmConversations || []).find(
      (c) => c?.peer?.username?.toLowerCase() === f.username.toLowerCase()
    ) || null;
    if (typeof DmContextMenu !== "undefined") {
      DmContextMenu.open(x, y, { conv: existingConv, peer: f }, anchor ? { anchor } : {});
    }
  };
  li.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openFriendMenu(e.clientX, e.clientY);
  });
  li.querySelector('[data-act="more"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openFriendMenu(r.left, r.bottom + 4, e.currentTarget);
  });

  li.querySelector('[data-act="dm"]')?.addEventListener("click", () => {
    sendWs("OpenDm", { target_username: f.username });
  });
  li.querySelector('[data-act="call"]')?.addEventListener("click", () => {
    const meLower = (state.selfUser?.username || "").toLowerCase();
    const otherLower = f.username.toLowerCase();
    const pair = meLower <= otherLower ? `${meLower}__${otherLower}` : `${otherLower}__${meLower}`;
    sendWs("OpenDm", { target_username: f.username });
    joinVoiceChannel(`dmvoice:${pair}`, `Call privada: @${f.username}`);
  });
  li.querySelector('[data-act="remove"]')?.addEventListener("click", async () => {
    if (await SancordUI.confirm({title:"Remover amizade?",message:`Remover ${f.username} da sua lista de amigos?`,confirmLabel:"Remover",danger:true})) {
      sendWs("RemoveFriend", { target_username: f.username });
    }
  });
  return li;
}

function buildPendingFriendRow(u, direction) {
  const li = document.createElement("li");
  li.className = "friend-row";
  const sub =
    direction === "incoming"
      ? "Solicitação de amizade recebida"
      : "Solicitação de amizade enviada";

  li.innerHTML = `
    <div class="friend-row-left">
      <div class="avatar" style="background: ${u.avatar_color}; width: 38px; height: 38px;">
        ${renderAvatarInner(u.username, u.avatar_url)}
      </div>
      <div>
        <div class="friend-row-name">${escapeHtml(u.username)}</div>
        <div class="friend-row-sub">${sub}</div>
      </div>
    </div>
    <div class="friend-row-actions">
      ${
        direction === "incoming"
          ? `<button type="button" class="friend-circle-btn accept" data-act="accept" title="Aceitar">✓</button>
             <button type="button" class="friend-circle-btn danger" data-act="decline" title="Recusar">✕</button>`
          : `<button type="button" class="friend-circle-btn danger" data-act="cancel" title="Cancelar pedido">✕</button>`
      }
    </div>
  `;

  li.querySelector('[data-act="accept"]')?.addEventListener("click", () => {
    sendWs("RespondFriendRequest", { from_username: u.username, accept: true });
  });
  li.querySelector('[data-act="decline"]')?.addEventListener("click", () => {
    sendWs("RespondFriendRequest", { from_username: u.username, accept: false });
  });
  li.querySelector('[data-act="cancel"]')?.addEventListener("click", () => {
    sendWs("CancelFriendRequest", { target_username: u.username });
  });
  return li;
}

function renderQuickAddMembers() {
  if (!quickAddMembersList) return;
  quickAddMembersList.innerHTML = "";

  const seen = new Set();
  const meLower = (state.selfUser?.username || "").toLowerCase();
  const others = [];
  for (const u of state.users.values()) {
    const low = u.username.toLowerCase();
    if (low !== meLower && !seen.has(low)) {
      seen.add(low);
      others.push(u);
    }
  }

  if (others.length === 0) {
    quickAddMembersList.innerHTML = `<li class="ui-empty-compact">${SancordUI.emptyHTML({icon:"users",title:"Nenhum usuário disponível",description:"Você ainda pode enviar um pedido pelo nome de usuário."})}</li>`;
    return;
  }

  for (const u of others) {
    const rel = getRelationshipWith(u.username);
    const li = document.createElement("li");
    li.className = "friend-row";
    li.innerHTML = `
      <div class="friend-row-left">
        <div class="avatar" style="background: ${u.avatar_color}; width: 34px; height: 34px;">
          ${renderAvatarInner(u.username, u.avatar_url)}
        </div>
        <div>
          <div class="friend-row-name">${escapeHtml(u.username)}</div>
          <div class="friend-row-sub">Online no servidor</div>
        </div>
      </div>
      <div class="friend-row-actions">
        ${
          rel === "friend"
            ? `<button type="button" class="btn-secondary small-btn" data-act="msg">💬 Mensagem</button>`
            : rel === "outgoing"
              ? `<button type="button" class="btn-secondary small-btn" disabled>⏳ Enviado</button>`
              : rel === "incoming"
                ? `<button type="button" class="btn-primary small-btn" data-act="acc">✓ Aceitar</button>`
                : `<button type="button" class="btn-primary small-btn" data-act="add">+ Adicionar</button>`
        }
      </div>
    `;

    li.querySelector('[data-act="add"]')?.addEventListener("click", () => {
      sendWs("SendFriendRequest", { target_username: u.username });
    });
    li.querySelector('[data-act="acc"]')?.addEventListener("click", () => {
      sendWs("RespondFriendRequest", { from_username: u.username, accept: true });
    });
    li.querySelector('[data-act="msg"]')?.addEventListener("click", () => {
      sendWs("OpenDm", { target_username: u.username });
    });

    quickAddMembersList.appendChild(li);
  }
}

navHomeBtn?.addEventListener("click", () => switchToHomeFriendsView());
navServerBtn?.addEventListener("click", () => switchToServerView());
document.getElementById("stage-open-voice-chat-btn")?.addEventListener("click", () => {
  if (state.currentVoiceChannel && !isPrivateVoiceId(state.currentVoiceChannel) && typeof openVoiceTextChat === "function") {
    openVoiceTextChat(state.currentVoiceChannel);
  }
});
openFriendsTabBtn?.addEventListener("click", () => switchToHomeFriendsView());
document.getElementById("open-starred-tab-btn")?.addEventListener("click", () => switchToHomeStarredView());
document.getElementById("open-discover-servers-btn")?.addEventListener("click", () => openAddServerWizard("join"));
dmNewAddBtn?.addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  SancordUI.contextMenu(r.left, r.bottom + 4, [
    { label: "Criar grupo", icon: "👥", onSelect: () => openCreateGroupDialog() },
    { label: "Adicionar amigo", icon: "➕", onSelect: () => switchToHomeFriendsView("add") },
  ]);
});

document.querySelectorAll(".friends-tab-btn[data-friends-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.friendsTab = btn.dataset.friendsTab;
    renderFriendsView();
  });
});

dmFilterInput?.addEventListener("input", (e) => {
  state.dmFilterQuery = e.target.value || "";
  renderDmList();
});

friendsSearchInput?.addEventListener("input", (e) => {
  state.friendsSearchQuery = e.target.value || "";
  renderFriendsView();
});

addFriendForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const target = addFriendInput?.value.trim();
  if (!target) return;
  if (addFriendFeedback) addFriendFeedback.className = "add-friend-feedback hidden";
  sendWs("SendFriendRequest", { target_username: target });
});

// ============================================================================
// 9. Aba Conta, Privacidade, Notificações, Aparência Exclusiva & Multi-Servidor
// ============================================================================

document.getElementById("account-goto-edit-profile-btn")?.addEventListener("click", () => {
  switchSettingsTab("profile");
});

const accountRenameForm = document.getElementById("account-rename-form");
const accountRenameInput = document.getElementById("account-rename-input");
document.getElementById("account-toggle-rename-btn")?.addEventListener("click", () => {
  if (!accountRenameForm) return;
  accountRenameForm.classList.toggle("hidden");
  if (!accountRenameForm.classList.contains("hidden") && accountRenameInput) {
    accountRenameInput.value = state.selfUser?.username || "";
    accountRenameInput.focus();
  }
});
document.getElementById("account-rename-cancel-btn")?.addEventListener("click", () => {
  accountRenameForm?.classList.add("hidden");
});
accountRenameForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const next = accountRenameInput?.value.trim();
  if (!next || next.length < 2) return;
  sendWs("UpdateUsername", { new_username: next });
  accountRenameForm.classList.add("hidden");
});

document.getElementById("account-copy-id-btn")?.addEventListener("click", () => {
  copyTextSafe(state.selfUser?.id || "", "ID da conta copiado!");
});

function maskEmailAddress(email) {
  if (!email || !email.includes("@")) return email || "Não cadastrado";
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function renderAccountEmailUI() {
  const el = document.getElementById("account-info-email");
  const revealBtn = document.getElementById("account-reveal-email-btn");
  if (!el) return;
  if (!state.accountEmail) {
    el.textContent = "Não cadastrado";
    revealBtn?.classList.add("hidden");
    return;
  }
  el.textContent = state.accountEmailRevealed ? state.accountEmail : maskEmailAddress(state.accountEmail);
  if (revealBtn) {
    revealBtn.classList.remove("hidden");
    revealBtn.textContent = state.accountEmailRevealed ? "Ocultar" : "Revelar";
  }
}

function renderAccountSessionsUI() {
  const listEl = document.getElementById("account-sessions-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sessions = state.activeSessions || [];
  if (sessions.length === 0) {
    listEl.innerHTML = `<div class="settings-hint-text">Nenhuma sessão encontrada.</div>`;
    return;
  }
  const fmt = (ms) => {
    try {
      return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (_) {
      return "";
    }
  };
  for (const s of sessions) {
    const row = document.createElement("div");
    row.className = "srv-manage-row";
    const info = document.createElement("div");
    const statusBadge = s.current
      ? `<span class="security-pill ok" style="margin-left:6px;">Este dispositivo</span>`
      : s.connected
      ? `<span class="security-pill" style="margin-left:6px;">Ativo agora</span>`
      : "";
    info.innerHTML = `
      <div>
        <strong>💻 Sanvo (${escapeHtml(s.id.slice(0, 8))})</strong>${statusBadge}
      </div>
      <div class="settings-hint-text">
        Criada em ${escapeHtml(fmt(s.created_at))} • Última atividade: ${escapeHtml(fmt(s.last_seen_at))} • ${s.remember ? "Sessão longa (30 dias)" : "Sessão temporária (24 h)"}
      </div>
    `;
    const actions = document.createElement("div");
    if (!s.current) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary small-btn danger-text";
      btn.textContent = "Sair";
      btn.addEventListener("click", async () => {
        if (await SancordUI.confirm({ title: "Encerrar sessão?", message: "Desconectar este dispositivo imediatamente?", confirmLabel: "Encerrar sessão", danger: true })) {
          sendWs("RevokeSession", { session_id: s.id });
        }
      });
      actions.appendChild(btn);
    }
    row.append(info, actions);
    listEl.appendChild(row);
  }
}

document.getElementById("account-edit-email-btn")?.addEventListener("click", async () => {
  const values = await SancordUI.formDialog({
    title: "E-mail da conta",
    description: "O e-mail é obrigatório e fica visível só para você. Ao trocar, enviamos um código para o novo endereço; o atual continua valendo até você confirmar.",
    fields: [
      { name: "email", label: "NOVO E-MAIL", value: state.accountEmail || "", maxlength: 120, placeholder: "voce@exemplo.com", required: true },
      { name: "current_password", label: "SENHA ATUAL PARA CONFIRMAR", type: "password", value: "", required: true, maxlength: 128 },
    ],
    submitLabel: "Enviar código",
  });
  if (!values || !values.current_password || !(values.email || "").trim()) return;
  sendWs("UpdateAccountEmail", {
    email: values.email.trim(),
    current_password: values.current_password,
  });
});

/** Troca de e-mail nas Configurações: o servidor enviou o código; pede para digitá-lo. */
async function promptAccountEmailCode(message) {
  for (;;) {
    const values = await SancordUI.formDialog({
      title: "Confirme o novo e-mail",
      description: message,
      fields: [{ name: "code", label: "CÓDIGO DE 6 DÍGITOS", value: "", maxlength: 7, required: true, placeholder: "000000" }],
      submitLabel: "Confirmar e-mail",
    });
    if (!values) return;
    try {
      const response = await SancordNet.fetch("/api/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getStoredToken(), code: String(values.code || "").replace(/\D/g, "") }),
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.ok) {
        showUiToast("E-mail confirmado ✓");
        return;
      }
      showErrorToast(data?.message || "Não foi possível confirmar o código.");
      if (!["code_wrong"].includes(data?.code)) return;
    } catch (_) {
      showErrorToast("Sem conexão com o Sanvo. Tente novamente.");
      return;
    }
  }
}

document.getElementById("generate-recovery-code-btn")?.addEventListener("click", async () => {
  const values = await SancordUI.formDialog({
    title: "🔑 Gerar código de recuperação de senha",
    description: "O código gerado permite redefinir sua senha na tela de login caso você a esqueça. Ele funciona uma única vez e invalida qualquer código gerado anteriormente.",
    fields: [
      { name: "current_password", label: "CONFIRME SUA SENHA ATUAL", type: "password", value: "", required: true, maxlength: 128 },
    ],
    submitLabel: "Gerar código único",
  });
  if (!values || !values.current_password) return;
  sendWs("GenerateRecoveryCode", { current_password: values.current_password });
});

document.getElementById("refresh-sessions-btn")?.addEventListener("click", () => {
  sendWs("ListSessions");
});

document.getElementById("revoke-other-sessions-btn")?.addEventListener("click", async () => {
  const ok = await SancordUI.confirm({
    title: "Encerrar todas as outras sessões?",
    message: "Todos os outros dispositivos conectados à sua conta serão desconectados imediatamente. Sua sessão atual continuará ativa.",
    confirmLabel: "Encerrar outras sessões",
    danger: true,
  });
  if (ok) sendWs("RevokeSession", { session_id: "others" });
});

document.getElementById("delete-own-account-btn")?.addEventListener("click", async () => {
  const myUsername = state.selfUser?.username || "";
  const values = await SancordUI.formDialog({
    title: "Excluir sua conta permanentemente?",
    description: `Esta ação não pode ser desfeita. Digite seu nome de usuário (${myUsername}) e sua senha atual para excluir definitivamente sua conta.`,
    fields: [
      { name: "confirm_user", label: `DIGITE "${myUsername}" PARA CONFIRMAR`, value: "", required: true, maxlength: 24 },
      { name: "current_password", label: "SENHA ATUAL", type: "password", value: "", required: true, maxlength: 128 },
    ],
    submitLabel: "Excluir conta permanentemente",
    danger: true,
  });
  if (!values || !values.current_password) return;
  if ((values.confirm_user || "").trim().toLowerCase() !== myUsername.toLowerCase()) {
    showUiToast("O nome de usuário digitado não confere.");
    return;
  }
  sendWs("DeleteAccount", { current_password: values.current_password });
});

document.getElementById("open-change-pw-modal-btn")?.addEventListener("click", () => {
  const form = document.getElementById("account-password-form");
  const fb = document.getElementById("account-pw-feedback");
  form?.reset();
  if (fb) fb.className = "add-friend-feedback hidden";
  document.querySelectorAll("#change-password-modal .pw-input-wrap input").forEach((inp) => {
    inp.type = "password";
  });
  document.querySelectorAll("#change-password-modal .pw-eye-btn").forEach((btn) => {
    btn.classList.remove("visible");
  });
  changePasswordModal?.classList.remove("hidden");
  document.getElementById("account-cur-pw")?.focus();
});

document.getElementById("close-change-pw-btn")?.addEventListener("click", () => {
  changePasswordModal?.classList.add("hidden");
});
document.getElementById("cancel-change-pw-btn")?.addEventListener("click", () => {
  changePasswordModal?.classList.add("hidden");
});
changePasswordModal?.addEventListener("click", (e) => {
  if (e.target === changePasswordModal) changePasswordModal.classList.add("hidden");
});

document.querySelectorAll(".pw-eye-btn[data-toggle-pw]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inp = document.getElementById(btn.dataset.togglePw);
    if (!inp) return;
    const nextType = inp.type === "password" ? "text" : "password";
    inp.type = nextType;
    btn.classList.toggle("visible", nextType === "text");
  });
});

document.getElementById("account-password-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const cur = document.getElementById("account-cur-pw")?.value || "";
  const next = document.getElementById("account-new-pw")?.value || "";
  const conf = document.getElementById("account-confirm-pw")?.value || "";
  const fb = document.getElementById("account-pw-feedback");
  if (next.length < 4) {
    if (fb) {
      fb.textContent = "A nova senha precisa ter pelo menos 4 caracteres.";
      fb.className = "add-friend-feedback err";
      fb.classList.remove("hidden");
    }
    return;
  }
  if (next !== conf) {
    if (fb) {
      fb.textContent = "As novas senhas não coincidem.";
      fb.className = "add-friend-feedback err";
      fb.classList.remove("hidden");
    }
    return;
  }
  sendWs("ChangePassword", { current_password: cur, new_password: next });
});

document.getElementById("family-focus-mode")?.addEventListener("change", (e) => {
  state.audioSettings.familyFocus = Boolean(e.target.checked);
  saveAudioSettings();
});
document.getElementById("family-link-guard")?.addEventListener("change", (e) => {
  state.audioSettings.linkGuard = Boolean(e.target.checked);
  saveAudioSettings();
});

privacyTypingToggle?.addEventListener("change", (e) => {
  state.audioSettings.showTyping = Boolean(e.target.checked);
  saveAudioSettings();
});
privacyAutoEmbedsToggle?.addEventListener("change", (e) => {
  state.audioSettings.autoEmbeds = Boolean(e.target.checked);
  saveAudioSettings();
  renderChatMessages();
});

exportSettingsBtn?.addEventListener("click", () => {
  const json = JSON.stringify(state.audioSettings, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sanvo-preferencias-${state.selfUser?.username || "usuario"}.json`;
  a.click();
  showUiToast("Backup JSON exportado!");
});

clearLocalNotesBtn?.addEventListener("click", async () => {
  if (!await SancordUI.confirm({title:"Limpar notas e favoritas?",message:"Remover todas as notas pessoais e mensagens favoritas da sua conta?",confirmLabel:"Limpar",danger:true})) return;
  localStorage.removeItem("sancord_user_notes");
  localStorage.removeItem("sancord_starred_msgs");
  state.starredMsgIds.clear();
  if (state.prefs) {
    state.prefs.user_notes = {};
    state.prefs.starred_messages = [];
    sendWs("UpdateUserPrefs", { user_notes: {}, starred_messages: [] });
  }
  updateHomeStarredBadge();
  renderChatMessages();
  showUiToast("Notas e favoritas limpas!");
});

notifDesktopToggle?.addEventListener("change", async (e) => {
  const checked = Boolean(e.target.checked);
  if (checked && typeof Notification !== "undefined" && Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch (_) {}
  }
  state.audioSettings.desktopNotif = checked;
  saveAudioSettings();
});
notifUiVolumeSlider?.addEventListener("input", (e) => {
  const val = Number(e.target.value) || 0;
  state.audioSettings.uiVolume = val;
  if (notifUiVolumeValue) notifUiVolumeValue.textContent = `${val}%`;
  saveAudioSettings();
});
notifTestSoundBtn?.addEventListener("click", () => {
  playUiSound("dm-message", { forcePreview: true });
});

appearanceGlassSlider?.addEventListener("input", (e) => {
  const val = Number(e.target.value) || 0;
  state.audioSettings.glassIntensity = val;
  if (appearanceGlassValue) appearanceGlassValue.textContent = `${val}%`;
  saveAudioSettings();
  applyAppThemeSettings();
});
appearanceAmbientFxSelect?.addEventListener("change", (e) => {
  state.audioSettings.ambientFx = e.target.value || "none";
  saveAudioSettings();
  applyAppThemeSettings();
});
appearanceRadiusSelect?.addEventListener("change", (e) => {
  state.audioSettings.uiRadius = e.target.value || "discord";
  saveAudioSettings();
  applyAppThemeSettings();
});
appearanceVoiceGlowToggle?.addEventListener("change", (e) => {
  state.audioSettings.voiceGlow = Boolean(e.target.checked);
  saveAudioSettings();
  applyAppThemeSettings();
});

shortcutsGotoVoiceBtn?.addEventListener("click", () => {
  switchSettingsTab("voice");
});

// ----------------------------------------------------------------------------
// Wizard Criar / Entrar em Servidor (Multi-Servidor)
// ----------------------------------------------------------------------------
const addServerWizardModal = document.getElementById("create-or-join-server-modal");
const srvCreatePane = document.getElementById("srv-create-pane");
const srvJoinPane = document.getElementById("srv-join-pane");
const srvModeCreateBtn = document.getElementById("srv-modal-mode-create");
const srvModeJoinBtn = document.getElementById("srv-modal-mode-join");
const createSrvNameInput = document.getElementById("create-srv-name-input");
const createSrvDescInput = document.getElementById("create-srv-desc-input");
const createSrvColorInput = document.getElementById("create-srv-color-input");
const createSrvIconInput = document.getElementById("create-srv-icon-input");
const createSrvIconPreview = document.getElementById("create-srv-icon-preview");
const joinSrvCodeInput = document.getElementById("join-srv-code-input");
const joinSrvPreviewCard = document.getElementById("join-srv-preview-card");

let wizardSelectedTemplate = "blank";
let wizardUploadedIcon = "";
let serverWizardTrigger = null;

function setAddServerWizardMode(mode) {
  const isCreate = mode === "create";
  srvModeCreateBtn?.classList.toggle("active", isCreate);
  srvModeJoinBtn?.classList.toggle("active", !isCreate);
  srvCreatePane?.classList.toggle("hidden", !isCreate);
  srvJoinPane?.classList.toggle("hidden", isCreate);
}

function openAddServerWizard(mode = "create", prefillCode = "") {
  if (!addServerWizardModal) return;
  if (addServerWizardModal.classList.contains("hidden")) serverWizardTrigger = document.activeElement;
  wizardSelectedTemplate = "blank";
  wizardUploadedIcon = "";
  if (createSrvIconPreview) createSrvIconPreview.innerHTML = `📷<small>ÍCONE</small>`;
  if (createSrvNameInput) {
    createSrvNameInput.value = state.selfUser ? `Servidor de ${state.selfUser.username}` : "";
  }
  if (createSrvDescInput) createSrvDescInput.value = "";
  if (joinSrvCodeInput) joinSrvCodeInput.value = prefillCode || "";
  joinSrvPreviewCard?.classList.add("hidden");
  document.getElementById("create-srv-feedback")?.classList.add("hidden");
  document.getElementById("join-srv-feedback")?.classList.add("hidden");
  document.querySelectorAll(".srv-template-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.srvTemplate === "blank");
  });
  setAddServerWizardMode(mode);
  addServerWizardModal.classList.remove("hidden");
  (mode === "join" ? joinSrvCodeInput : createSrvNameInput)?.focus({ preventScroll: true });
  if (mode === "join" && prefillCode) {
    fetchInvitePreview(prefillCode);
  }
}

function closeAddServerWizard() {
  if (!addServerWizardModal || addServerWizardModal.classList.contains("hidden")) return;
  addServerWizardModal.classList.add("hidden");
  serverWizardTrigger?.focus({ preventScroll: true });
  serverWizardTrigger = null;
}

openAddServerBtn?.addEventListener("click", () => openAddServerWizard("create"));
document.getElementById("first-create-server")?.addEventListener("click", () => openAddServerWizard("create"));
document.getElementById("first-join-server")?.addEventListener("click", () => openAddServerWizard("join"));
document.getElementById("first-add-friend")?.addEventListener("click", () => {
  switchToHomeFriendsView("add");
  document.getElementById("add-friend-input")?.focus();
});
document.getElementById("close-server-wizard-btn")?.addEventListener("click", closeAddServerWizard);
document.getElementById("create-srv-cancel-btn")?.addEventListener("click", closeAddServerWizard);
document.getElementById("join-srv-cancel-btn")?.addEventListener("click", closeAddServerWizard);
addServerWizardModal?.addEventListener("click", (e) => {
  if (e.target === addServerWizardModal) closeAddServerWizard();
});
srvModeCreateBtn?.addEventListener("click", () => setAddServerWizardMode("create"));
srvModeJoinBtn?.addEventListener("click", () => setAddServerWizardMode("join"));

document.querySelectorAll(".srv-template-btn[data-srv-template]").forEach((btn) => {
  btn.addEventListener("click", () => {
    wizardSelectedTemplate = btn.dataset.srvTemplate || "blank";
    document.querySelectorAll(".srv-template-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

document.getElementById("create-srv-upload-icon-btn")?.addEventListener("click", () => {
  createSrvIconInput?.click();
});

function readSmallImageOrGif(file, maxW, maxH, cb) {
  if (!file || !file.type.startsWith("image/")) return;
  const isGif = file.type === "image/gif" || file.name?.toLowerCase().endsWith(".gif");
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target?.result;
    if (!dataUrl) return;
    if (isGif) {
      if (file.size > 4 * 1024 * 1024) {
        showUiToast("GIF muito pesado (máx 4MB).");
        return;
      }
      cb(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

createSrvIconInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  createSrvIconInput.value = "";
  readSmallImageOrGif(file, 256, 256, (dataUrl) => {
    wizardUploadedIcon = dataUrl;
    if (createSrvIconPreview) {
      createSrvIconPreview.innerHTML = `<img src="${dataUrl}" alt="Ícone" />`;
    }
  });
});

document.getElementById("create-srv-submit-btn")?.addEventListener("click", () => {
  const name = createSrvNameInput?.value.trim() || "";
  const fb = document.getElementById("create-srv-feedback");
  if (name.length < 2) {
    if (fb) {
      fb.textContent = "Escolha um nome com pelo menos 2 caracteres.";
      fb.className = "add-friend-feedback err";
      fb.classList.remove("hidden");
    }
    return;
  }
  const srvType = document.querySelector('input[name="create-srv-type"]:checked')?.value || "private";
  sendWs("CreateServer", {
    name,
    description: createSrvDescInput?.value.trim() || null,
    icon_url: wizardUploadedIcon || null,
    icon_color: createSrvColorInput?.value || "#5865f2",
    template: wizardSelectedTemplate,
    is_community: srvType === "community",
  });
  addServerWizardModal?.classList.add("hidden");
});

function extractInviteCodeFromRaw(raw) {
  if (typeof SancordNet !== "undefined" && typeof SancordNet.extractInviteCode === "function") {
    return SancordNet.extractInviteCode(raw);
  }
  const txt = (raw || "").trim();
  const idx = txt.indexOf("invite=");
  if (idx !== -1) {
    return txt.slice(idx + 7).split("&")[0].trim();
  }
  return txt;
}

let invitePreviewDebounce = null;
async function fetchInvitePreview(rawInput) {
  const code = extractInviteCodeFromRaw(rawInput);
  const errEl = document.getElementById("join-srv-error");
  errEl?.classList.add("hidden");
  if (!code || code.length < 3) {
    joinSrvPreviewCard?.classList.add("hidden");
    return;
  }
  try {
    const res = await SancordNet.fetch(`/api/invite/${encodeURIComponent(code)}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) {
      joinSrvPreviewCard?.classList.add("hidden");
      if (errEl) {
        errEl.textContent = data.message || "Convite inválido ou expirado.";
        errEl.classList.remove("hidden");
      }
      return;
    }
    const bn = document.getElementById("join-srv-preview-banner");
    const ic = document.getElementById("join-srv-preview-icon");
    const nm = document.getElementById("join-srv-preview-name");
    const mt = document.getElementById("join-srv-preview-meta");
    if (bn) {
      bn.style.backgroundImage = data.banner_url ? `url("${data.banner_url}")` : "";
      bn.style.backgroundColor = data.icon_color || "#5865f2";
    }
    if (ic) {
      ic.style.background = data.icon_color || "#5865f2";
      ic.innerHTML = data.icon_url
        ? `<img src="${cachedMediaUrl(data.icon_url)}" alt="S" />`
        : escapeHtml((data.name || "S").slice(0, 2).toUpperCase());
    }
    if (nm) nm.textContent = data.name || "Servidor";
    if (mt) {
      const parts = [
        `🟢 ${data.online_count || 0} online`,
        `${data.member_count || 1} membro${(data.member_count || 1) === 1 ? "" : "s"}`,
        data.is_community ? "Comunidade" : "Privado",
      ];
      if (data.expires_at) {
        parts.push(`convite expira ${new Date(data.expires_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
      }
      mt.textContent = parts.join(" • ") + (data.description ? ` — ${data.description}` : "");
    }
    joinSrvPreviewCard?.classList.remove("hidden");
  } catch (err) {
    console.warn("[Sancord] Falha ao buscar prévia do convite:", err);
    if (errEl) {
      errEl.textContent = "Não foi possível verificar o convite. Verifique sua conexão.";
      errEl.classList.remove("hidden");
    }
  }
}

joinSrvCodeInput?.addEventListener("input", (e) => {
  clearTimeout(invitePreviewDebounce);
  invitePreviewDebounce = setTimeout(() => fetchInvitePreview(e.target.value), 250);
});

document.getElementById("join-srv-submit-btn")?.addEventListener("click", () => {
  const code = extractInviteCodeFromRaw(joinSrvCodeInput?.value || "");
  const fb = document.getElementById("join-srv-feedback");
  if (!code) {
    if (fb) {
      fb.textContent = "Informe o código ou link do convite.";
      fb.className = "add-friend-feedback err";
      fb.classList.remove("hidden");
    }
    return;
  }
  addServerWizardModal?.classList.add("hidden");
  if (window.SancordInvites?.openInvitePreview) {
    window.SancordInvites.openInvitePreview(code);
  } else {
    sendWs("JoinServerByInvite", { invite_code: code });
  }
});

// ----------------------------------------------------------------------------
// Modal Convidar Amigos para o Servidor (delegado para static/js/invites.js)
// ----------------------------------------------------------------------------
const inviteServerModal = document.getElementById("invite-server-modal");

async function openInviteServerModal(serverId = null, channelId = null) {
  if (window.SancordInvites?.openInviteModal) {
    return window.SancordInvites.openInviteModal(serverId, channelId);
  }
}

leaveServerBtn?.addEventListener("click", async () => {
  const srv = getActiveServer();
  if (!srv || srv.id === "sancord") return;
  if (await SancordUI.confirm({title:"Sair do servidor?",message:`Deseja sair do servidor "${srv.name}"?`,confirmLabel:"Sair",danger:true})) {
    sendWs("LeaveServer", { server_id: srv.id });
  }
});

// ----------------------------------------------------------------------------
// Configurações Fullscreen do Servidor + Sistema Complexo de Cargos & Moderação
// ----------------------------------------------------------------------------
const serverSettingsModal = document.getElementById("server-settings-modal");
let editingServerId = null;
let selectedRoleId = "everyone";
let srvEditIconDraft = null;
let srvEditBannerDraft = null;

function switchServerSettingsTab(tabKey) {
  document.querySelectorAll(".settings-nav-item[data-srv-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.srvTab === tabKey);
  });
  ["overview", "roles", "channels", "members", "invites", "emojis", "automod", "audit", "integrations"].forEach((k) => {
    document.getElementById(`srv-tab-${k}`)?.classList.toggle("hidden", k !== tabKey);
  });
  const titles = {
    overview: "Visão Geral",
    roles: "Cargos & Permissões",
    channels: "Canais",
    members: "Membros & Moderação",
    invites: "Convites",
    emojis: "Emojis",
    automod: "AutoMod",
    audit: "Registro de auditoria",
    integrations: t("server.integrations"),
  };
  const hdr = document.getElementById("srv-settings-topbar-title");
  if (hdr) hdr.textContent = titles[tabKey] || "Servidor";
  // AutoMod e auditoria carregam do servidor ao abrir (static/js/advanced.js).
  if (typeof onServerSettingsTabOpened === "function") onServerSettingsTabOpened(tabKey);
}

document.querySelectorAll(".settings-nav-item[data-srv-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchServerSettingsTab(btn.dataset.srvTab));
});

function switchRoleEditorSubTab(subKey) {
  document.querySelectorAll(".picker-tab[data-role-sub]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.roleSub === subKey);
  });
  ["display", "perms", "members"].forEach((k) => {
    document.getElementById(`role-sub-${k}`)?.classList.toggle("hidden", k !== subKey);
  });
}

document.querySelectorAll(".picker-tab[data-role-sub]").forEach((btn) => {
  btn.addEventListener("click", () => switchRoleEditorSubTab(btn.dataset.roleSub));
});

function refreshServerSettingsModalIfOpen() {
  if (!serverSettingsModal || serverSettingsModal.classList.contains("hidden")) return;
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv) {
    serverSettingsModal.classList.add("hidden");
    return;
  }
  populateServerSettingsUI(srv);
  if (typeof renderEmojiSettings === "function") renderEmojiSettings(srv);
}

function renderRoleEditorPanel(srv) {
  const roles = [...(srv.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const role = roles.find((r) => r.id === selectedRoleId) || roles[0];
  if (!role) return;
  selectedRoleId = role.id;

  const listEl = document.getElementById("srv-roles-list");
  if (listEl) {
    listEl.innerHTML = "";
    for (const r of roles) {
      const count = r.id === "everyone"
        ? (srv.members?.length || 1)
        : Object.values(srv.member_roles || {}).filter((arr) => arr.includes(r.id)).length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `srv-role-list-item ${r.id === role.id ? "active" : ""}`;
      if (r.id !== "everyone" && canEditRole(srv, r)) {
        btn.draggable = true;
        btn.title = "Arraste para reorganizar a hierarquia";
        btn.addEventListener("dragstart", e => {
          state.dragRoleId = r.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", r.id);
          btn.classList.add("is-dragging");
        });
        btn.addEventListener("dragend", () => { state.dragRoleId = null; btn.classList.remove("is-dragging"); });
        btn.addEventListener("dragover", e => {
          if (!state.dragRoleId || state.dragRoleId === r.id) return;
          e.preventDefault();
          btn.classList.add("drop-before");
        });
        btn.addEventListener("dragleave", () => btn.classList.remove("drop-before"));
        btn.addEventListener("drop", e => {
          e.preventDefault();
          btn.classList.remove("drop-before");
          const source = state.dragRoleId;
          state.dragRoleId = null;
          if (!source || source === r.id) return;
          const ids = roles.filter(item => item.id !== "everyone" && item.id !== source).map(item => item.id);
          ids.splice(ids.indexOf(r.id), 0, source);
          sendWs("ReorderRoles", { server_id: srv.id, role_ids: ids });
        });
      }
      btn.innerHTML = `
        <span style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span class="srv-role-dot" style="background:${r.color || "#b5bac1"}"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.badge_emoji ? `${escapeHtml(r.badge_emoji)} ` : ""}${escapeHtml(r.name)}</span>
        </span>
        <span class="badge">${count}</span>
      `;
      btn.addEventListener("click", () => {
        selectedRoleId = r.id;
        renderRoleEditorPanel(srv);
      });
      listEl.appendChild(btn);
    }
  }

  const isEveryone = role.id === "everyone";
  const editable = canEditRole(srv, role);
  const heading = document.getElementById("role-editor-heading");
  const nameIn = document.getElementById("role-edit-name");
  const emojiIn = document.getElementById("role-edit-badge-emoji");
  const colIn = document.getElementById("role-edit-color-custom");
  const hoistIn = document.getElementById("role-edit-hoist");
  const mentIn = document.getElementById("role-edit-mentionable");
  const delBtn = document.getElementById("role-edit-delete-btn");
  const upBtn = document.getElementById("role-edit-pos-up");
  const dnBtn = document.getElementById("role-edit-pos-down");

  if (heading) heading.textContent = `Editar Cargo — ${role.name}`;
  if (nameIn) {
    nameIn.value = role.name;
    nameIn.disabled = isEveryone || !editable;
  }
  if (emojiIn) {
    emojiIn.value = role.badge_emoji || "";
    emojiIn.disabled = isEveryone || !editable;
  }
  if (colIn) {
    colIn.value = role.color || "#5865f2";
    colIn.disabled = isEveryone || !editable;
  }
  document.querySelectorAll(".role-col-swatch").forEach((sw) => {
    sw.classList.toggle("active", (sw.dataset.roleColor || "").toLowerCase() === (role.color || "").toLowerCase());
  });
  if (hoistIn) {
    hoistIn.checked = Boolean(role.hoist);
    hoistIn.disabled = isEveryone || !editable;
  }
  if (mentIn) {
    mentIn.checked = Boolean(role.mentionable);
    mentIn.disabled = isEveryone || !editable;
  }
  delBtn?.classList.toggle("hidden", isEveryone);
  upBtn?.classList.toggle("hidden", isEveryone);
  dnBtn?.classList.toggle("hidden", isEveryone);
  for (const btn of [delBtn, upBtn, dnBtn, document.getElementById("role-edit-save-btn")]) if (btn) btn.disabled = !editable;

  const perms = role.permissions || {};
  document.querySelectorAll("[data-role-perm]").forEach((cb) => {
    cb.checked = Boolean(perms[cb.dataset.rolePerm]);
    const mine = getServerPermissionsFor(srv, state.selfUser?.username);
    cb.disabled = !editable || (!isServerOwner(srv, state.selfUser?.username) && !mine.administrator && !mine[cb.dataset.rolePerm] && !cb.checked);
  });

  // Sub-aba Membros neste Cargo
  const assignEl = document.getElementById("role-members-assign-list");
  if (assignEl) {
    assignEl.innerHTML = "";
    if (isEveryone) {
      assignEl.innerHTML = `<div class="pinned-empty">Todos os membros deste servidor possuem @everyone automaticamente.</div>`;
    } else {
      const members = [...new Set([...(srv.members || []), srv.owner_username].filter(Boolean))].sort();
      for (const mLow of members) {
        const has = (srv.member_roles?.[mLow] || []).includes(role.id);
        const liveU = Array.from(state.users.values()).find((u) => u.username.toLowerCase() === mLow);
        const displayName = liveU?.username || mLow;
        const row = document.createElement("label");
        row.className = "dsp-toggle-row";
        row.innerHTML = `
          <div>
            <div class="dsp-title">${escapeHtml(displayName)}${srv.owner_username === mLow ? " 👑" : ""}</div>
            <div class="dsp-sub">${liveU ? "Online agora" : "Membro do servidor"}</div>
          </div>
          <input type="checkbox" ${has ? "checked" : ""} />
        `;
        row.querySelector("input")?.addEventListener("change", (ev) => {
          const cur = [...(srv.member_roles?.[mLow] || [])];
          const next = ev.target.checked
            ? Array.from(new Set([...cur, role.id]))
            : cur.filter((x) => x !== role.id);
          sendWs("AssignUserRoles", {
            server_id: srv.id,
            target_username: mLow,
            role_ids: next,
          });
        });
        row.querySelector("input").disabled = !canAssignRole(srv, role, mLow);
        assignEl.appendChild(row);
      }
    }
  }
}

function populateServerSettingsUI(srv) {
  const isOwner = isServerOwner(srv, state.selfUser?.username);
  const perms = getServerPermissionsFor(srv, state.selfUser?.username);

  const navBadge = document.getElementById("srv-settings-name-badge");
  const navIcon = document.getElementById("srv-settings-nav-icon");
  const delSrvBtn = document.getElementById("srv-settings-delete-btn");
  if (navBadge) navBadge.textContent = srv.name;
  if (navIcon) {
    navIcon.style.background = srv.icon_color || "#5865f2";
    navIcon.innerHTML = srv.icon_url
      ? `<img src="${cachedMediaUrl(srv.icon_url)}" alt="S" />`
      : escapeHtml((srv.name || "S").slice(0, 2).toUpperCase());
  }
  delSrvBtn?.classList.toggle("hidden", !isOwner || srv.id === "sancord");

  // Visão Geral
  const icPrev = document.getElementById("srv-edit-icon-preview");
  const bnPrev = document.getElementById("srv-edit-banner-preview");
  const nameIn = document.getElementById("srv-edit-name-input");
  const descIn = document.getElementById("srv-edit-desc-input");
  const rulesIn = document.getElementById("srv-edit-rules-input");
  const colIn = document.getElementById("srv-edit-color-input");
  const chosenIcon = srvEditIconDraft !== null ? srvEditIconDraft : (srv.icon_url || "");
  const chosenBanner = srvEditBannerDraft !== null ? srvEditBannerDraft : (srv.banner_url || "");

  if (icPrev) {
    icPrev.style.background = colIn?.value || srv.icon_color || "#5865f2";
    icPrev.innerHTML = chosenIcon
      ? `<img src="${chosenIcon}" alt="Ícone" />`
      : escapeHtml((srv.name || "S").slice(0, 2).toUpperCase());
  }
  if (bnPrev) {
    bnPrev.style.backgroundImage = chosenBanner ? `url("${chosenBanner}")` : "";
    bnPrev.textContent = chosenBanner ? "" : "Sem banner";
  }
  if (nameIn && nameIn !== document.activeElement) nameIn.value = srv.name || "";
  if (descIn && descIn !== document.activeElement) descIn.value = srv.description || "";
  if (rulesIn && rulesIn !== document.activeElement) rulesIn.value = srv.rules_text || "";
  if (colIn) colIn.value = srv.icon_color || "#5865f2";

  // Cargos
  renderRoleEditorPanel(srv);

  // Canais
  const chList = document.getElementById("srv-channels-manage-list");
  if (chList) {
    chList.innerHTML = "";
    const textCount = (srv.text_channels || []).length;
    for (const group of channelGroups(srv)) {
      const head = document.createElement("div");
      head.className = "appearance-section-label srv-manage-cat";
      head.textContent = group.category ? group.category.name : "Sem categoria";
      chList.appendChild(head);
      if (group.channels.length === 0) {
        const empty = document.createElement("div");
        empty.className = "settings-hint-text";
        empty.textContent = "Nenhum canal nesta categoria.";
        chList.appendChild(empty);
      }
      for (const c of group.channels) {
        const row = document.createElement("div");
        row.className = "srv-manage-row";
        const locked = c.id === "geral" || c.id === "voice-geral" || (c.kind !== "voice" && textCount <= 1);
        const label = document.createElement("span");
        label.className = "srv-manage-channel";
        label.innerHTML = `<span class="channel-svg-icon">${channelIconSvg(c.kind)}</span>`;
        const nm = document.createElement("strong");
        nm.textContent = c.name;
        const kind = document.createElement("small");
        kind.className = "settings-hint-text";
        kind.textContent = ` ${KIND_LABELS[c.kind] || c.kind}${c.topic ? ` — ${c.topic.slice(0, 60)}` : ""}`;
        label.append(nm, kind);
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:6px;";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn-secondary small-btn";
        edit.textContent = "Editar";
        edit.addEventListener("click", () => openEditChannelDialog(srv, c));
        actions.appendChild(edit);
        if (!locked) {
          const del = document.createElement("button");
          del.type = "button";
          del.className = "btn-secondary small-btn danger-text";
          del.textContent = "Excluir";
          del.addEventListener("click", () => confirmDeleteChannel(srv, c));
          actions.appendChild(del);
        }
        row.append(label, actions);
        chList.appendChild(row);
      }
    }
  }

  // Membros & Moderação
  const memList = document.getElementById("srv-members-manage-list");
  const q = (document.getElementById("srv-members-search-input")?.value || "").trim().toLowerCase();
  if (memList) {
    memList.innerHTML = "";
    const members = [...new Set([...(srv.members || []), srv.owner_username].filter(Boolean))].sort();
    const filtered = q ? members.filter((m) => m.includes(q)) : members;
    for (const mLow of filtered) {
      const liveU = Array.from(state.users.values()).find((u) => u.username.toLowerCase() === mLow);
      const displayName = liveU?.username || mLow;
      const mRoles = getUserServerRoles(srv, mLow);
      const isTargetOwner = srv.owner_username === mLow;
      const canModThis = !isTargetOwner && mLow !== state.selfUser?.username?.toLowerCase();
      const timeoutUntil = memberTimeoutUntil(srv, mLow);
      const canTimeout = canTimeoutMember(srv, mLow);

      const row = document.createElement("div");
      row.className = "srv-manage-row";
      row.innerHTML = `
        <div>
          <strong style="font-size:14px;">${escapeHtml(displayName)}${isTargetOwner ? " 👑 (Criador)" : ""}</strong>
          ${srv.member_joined_at?.[mLow] ? `<span class="settings-hint-text"> • entrou em ${new Date(srv.member_joined_at[mLow]).toLocaleDateString("pt-BR")}</span>` : ""}
          ${timeoutUntil ? `<span class="member-timeout-tag">⏱️ de castigo até ${escapeHtml(formatTimeoutEnd(timeoutUntil))}</span>` : ""}
          <div class="profile-roles-chips" style="margin-top:4px;">
            ${mRoles.map((r) => `<span class="role-chip-pill" style="border-color:${r.color};color:${r.color};">${escapeHtml(r.name)}</span>`).join("") || `<span class="settings-hint-text">Sem cargos extras</span>`}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${canTimeout ? `<button type="button" class="btn-secondary small-btn" data-act="timeout">${timeoutUntil ? "Remover castigo" : "Castigo"}</button>` : ""}
          ${canModThis && (isOwner || perms.kick_members || perms.administrator) ? `<button type="button" class="btn-secondary small-btn" data-act="kick">Expulsar</button>` : ""}
          ${canModThis && (isOwner || perms.ban_members || perms.administrator) ? `<button type="button" class="btn-secondary small-btn danger-text" data-act="ban">Banir</button>` : ""}
          ${canModThis && isOwner && srv.id !== "sancord" ? `<button type="button" class="btn-secondary small-btn" data-act="transfer" title="Transferir posse do servidor para este membro">👑 Transferir posse</button>` : ""}
        </div>
      `;
      row.querySelector('[data-act="timeout"]')?.addEventListener("click", () => {
        if (timeoutUntil) removeMemberTimeout(srv, mLow, displayName);
        else openTimeoutDialog(srv, mLow, displayName);
      });
      row.querySelector('[data-act="kick"]')?.addEventListener("click", () => {
        if (typeof openKickDialog === "function") openKickDialog(srv, mLow, displayName);
      });
      row.querySelector('[data-act="ban"]')?.addEventListener("click", () => {
        if (typeof openBanDialog === "function") openBanDialog(srv, mLow, displayName);
      });
      row.querySelector('[data-act="transfer"]')?.addEventListener("click", () => {
        if (typeof openTransferOwnershipDialog === "function") openTransferOwnershipDialog(srv, mLow, displayName);
      });
      memList.appendChild(row);
    }
  }

  const banWrap = document.getElementById("srv-banned-list-wrap");
  const banList = document.getElementById("srv-banned-list");
  const banned = srv.banned_usernames || [];
  banWrap?.classList.toggle("hidden", banned.length === 0);
  if (banList) {
    banList.innerHTML = "";
    for (const bLow of banned) {
      const reason = srv.ban_reasons?.[bLow];
      const row = document.createElement("div");
      row.className = "srv-manage-row";
      row.innerHTML = `
        <div>
          <span>🔨 <strong>${escapeHtml(bLow)}</strong></span>
          ${reason ? `<div class="settings-hint-text">Motivo: ${escapeHtml(reason)}</div>` : ""}
        </div>
        <button type="button" class="btn-secondary small-btn">Desbanir</button>
      `;
      row.querySelector("button")?.addEventListener("click", () => {
        sendWs("UnbanServerMember", { server_id: srv.id, target_username: bLow });
      });
      banList.appendChild(row);
    }
  }

  // Convites
  const invCodeEl = document.getElementById("srv-invite-code-display");
  const invLinkEl = document.getElementById("srv-invite-link-display");
  if (invCodeEl) invCodeEl.value = srv.invite_code || "";
  if (invLinkEl) {
    resolvePublicOriginUrl().then((orig) => {
      invLinkEl.value = SancordNet.link({ invite: srv.invite_code }, orig);
    });
  }
  window.SancordInvites?.syncCustomSlugUI?.(srv);
}

function openServerSettingsModal() {
  const srv = getActiveServer();
  if (!serverSettingsModal || !srv || !canUserEditServer(srv, state.selfUser?.username)) return;
  editingServerId = srv.id;
  srvEditIconDraft = null;
  srvEditBannerDraft = null;
  selectedRoleId = srv.roles?.[0]?.id || "everyone";
  document.getElementById("srv-edit-feedback")?.classList.add("hidden");
  populateServerSettingsUI(srv);
  switchServerSettingsTab("overview");
  switchRoleEditorSubTab("display");
  serverSettingsModal.classList.remove("hidden");
}

openServerSettingsBtn?.addEventListener("click", openServerSettingsModal);
document.getElementById("close-srv-settings-btn")?.addEventListener("click", () => serverSettingsModal?.classList.add("hidden"));

document.getElementById("srv-edit-upload-icon-btn")?.addEventListener("click", () => {
  document.getElementById("srv-icon-file-input")?.click();
});
document.getElementById("srv-edit-clear-icon-btn")?.addEventListener("click", () => {
  srvEditIconDraft = "";
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (srv) populateServerSettingsUI(srv);
});
document.getElementById("srv-icon-file-input")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  readSmallImageOrGif(file, 256, 256, (dataUrl) => {
    srvEditIconDraft = dataUrl;
    const srv = (state.servers || []).find((s) => s.id === editingServerId);
    if (srv) populateServerSettingsUI(srv);
  });
});

document.getElementById("srv-edit-upload-banner-btn")?.addEventListener("click", () => {
  document.getElementById("srv-banner-file-input")?.click();
});
document.getElementById("srv-edit-clear-banner-btn")?.addEventListener("click", () => {
  srvEditBannerDraft = "";
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (srv) populateServerSettingsUI(srv);
});
document.getElementById("srv-banner-file-input")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  readSmallImageOrGif(file, 900, 320, (dataUrl) => {
    srvEditBannerDraft = dataUrl;
    const srv = (state.servers || []).find((s) => s.id === editingServerId);
    if (srv) populateServerSettingsUI(srv);
  });
});

document.getElementById("srv-edit-save-btn")?.addEventListener("click", () => {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv) return;
  const name = document.getElementById("srv-edit-name-input")?.value.trim() || srv.name;
  const description = document.getElementById("srv-edit-desc-input")?.value.trim() || null;
  const rules_text = document.getElementById("srv-edit-rules-input")?.value.trim() ?? "";
  const icon_color = document.getElementById("srv-edit-color-input")?.value || srv.icon_color;
  sendWs("UpdateServer", {
    server_id: srv.id,
    name,
    description,
    icon_url: srvEditIconDraft,
    banner_url: srvEditBannerDraft,
    icon_color,
    regenerate_invite: false,
    rules_text,
  });
});

document.getElementById("srv-settings-delete-btn")?.addEventListener("click", () => {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv || srv.id === "sancord") return;
  const typed = prompt(`Para EXCLUIR definitivamente "${srv.name}", digite o nome exato do servidor abaixo:`);
  if (typed === srv.name) {
    if (sendWs("DeleteServer", { server_id: srv.id })) serverSettingsModal?.classList.add("hidden");
  }
});

// Ações do Editor Complexo de Cargos
document.getElementById("srv-add-role-btn")?.addEventListener("click", () => {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv) return;
  const rName = prompt("Nome do novo cargo (ex: VIP, Recrutador, Dev):", "Novo Cargo");
  if (!rName || !rName.trim()) return;
  sendWs("CreateRole", {
    server_id: srv.id,
    name: rName.trim(),
    color: "#5865f2",
    hoist: false,
    mentionable: true,
    badge_emoji: null,
    permissions: {
      administrator: false, manage_server: false, manage_roles: false, manage_channels: false,
      kick_members: false, ban_members: false, manage_messages: false, mention_everyone: false,
      send_messages: true, attach_files: true, connect_voice: true, speak_voice: true,
      stream_video: true, create_invites: true, manage_invites: false,
    },
  });
});

document.querySelectorAll(".role-col-swatch[data-role-color]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const col = btn.dataset.roleColor;
    const colIn = document.getElementById("role-edit-color-custom");
    if (colIn) colIn.value = col;
    document.querySelectorAll(".role-col-swatch").forEach((s) => s.classList.toggle("active", s === btn));
  });
});

function applyRolePreset(kind) {
  const admin = kind === "admin";
  const mod = kind === "mod";
  const map = {
    administrator: admin,
    manage_server: admin,
    manage_roles: admin,
    manage_channels: admin || mod,
    kick_members: admin || mod,
    moderate_members: admin || mod,
    manage_nicknames: admin || mod,
    manage_expressions: admin || mod,
    change_nickname: true,
    ban_members: admin,
    manage_messages: admin || mod,
    mention_everyone: admin || mod,
    create_invites: true,
    manage_invites: admin || mod,
    send_messages: true,
    attach_files: true,
    connect_voice: true,
    speak_voice: true,
    stream_video: true,
  };
  document.querySelectorAll("[data-role-perm]").forEach((cb) => {
    cb.checked = Boolean(map[cb.dataset.rolePerm]);
  });
}

document.getElementById("role-preset-member")?.addEventListener("click", () => applyRolePreset("member"));
document.getElementById("role-preset-mod")?.addEventListener("click", () => applyRolePreset("mod"));
document.getElementById("role-preset-admin")?.addEventListener("click", () => applyRolePreset("admin"));

function saveCurrentRoleEdits(posDelta = 0) {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv) return;
  const role = (srv.roles || []).find((r) => r.id === selectedRoleId);
  if (!role) return;
  const perms = {};
  document.querySelectorAll("[data-role-perm]").forEach((cb) => {
    perms[cb.dataset.rolePerm] = Boolean(cb.checked);
  });
  if (sendWs("UpdateRole", {
    server_id: srv.id,
    role_id: role.id,
    name: document.getElementById("role-edit-name")?.value.trim() || role.name,
    color: document.getElementById("role-edit-color-custom")?.value || role.color,
    position: Math.max(1, (role.position || 1) + posDelta),
    hoist: Boolean(document.getElementById("role-edit-hoist")?.checked),
    mentionable: Boolean(document.getElementById("role-edit-mentionable")?.checked),
    badge_emoji: document.getElementById("role-edit-badge-emoji")?.value.trim() || null,
    permissions: perms,
  })) showUiToast(`Salvando cargo "${role.name}"…`);
}

document.getElementById("role-edit-save-btn")?.addEventListener("click", () => saveCurrentRoleEdits(0));
document.getElementById("role-edit-pos-up")?.addEventListener("click", () => saveCurrentRoleEdits(2));
document.getElementById("role-edit-pos-down")?.addEventListener("click", () => saveCurrentRoleEdits(-1));
document.getElementById("role-edit-delete-btn")?.addEventListener("click", async () => {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv || selectedRoleId === "everyone") return;
  const roleToDelete = selectedRoleId;
  if (await SancordUI.confirm({title:"Excluir cargo?",message:"Excluir este cargo permanentemente?",confirmLabel:"Excluir",danger:true})) {
    sendWs("DeleteRole", { server_id: srv.id, role_id: roleToDelete });
    selectedRoleId = "everyone";
  }
});

document.getElementById("srv-quick-add-text-btn")?.addEventListener("click", () => openCreateChannelModal("text"));
document.getElementById("srv-quick-add-voice-btn")?.addEventListener("click", () => openCreateChannelModal("voice"));
document.getElementById("srv-members-search-input")?.addEventListener("input", () => {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (srv) populateServerSettingsUI(srv);
});
document.getElementById("srv-regen-invite-btn")?.addEventListener("click", () => {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv) return;
  sendWs("UpdateServer", {
    server_id: srv.id, name: srv.name, description: srv.description || null,
    icon_url: null, banner_url: null, icon_color: null, regenerate_invite: true,
  });
});
document.getElementById("srv-copy-invite-btn2")?.addEventListener("click", () => {
  const val = document.getElementById("srv-invite-link-display")?.value || "";
  copyTextSafe(val, "Link de convite copiado!");
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAddServerWizard();
    inviteServerModal?.classList.add("hidden");
    serverSettingsModal?.classList.add("hidden");
  }
});
