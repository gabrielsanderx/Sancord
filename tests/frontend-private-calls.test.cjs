const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const soundMgrSrc = fs.readFileSync(path.join(ROOT, "static/js/sound-manager.js"), "utf8");
const voiceSoundsSrc = fs.readFileSync(path.join(ROOT, "static/js/voice-event-sounds.js"), "utf8");
const notifSrc = fs.readFileSync(path.join(ROOT, "static/js/notification-manager.js"), "utf8");
const voiceSrc = fs.readFileSync(path.join(ROOT, "static/js/voice.js"), "utf8");

function buildCallRuntime({ selfUsername = "Swag", statusKind = "online" } = {}) {
  const sent = [];
  const toasts = [];
  const ipcPosts = [];
  const joined = [];
  const leftCalls = [];
  const played = [];
  let audioStoppedCount = 0;

  function makeEl(tag, id = "") {
    const classes = new Set(["hidden"]);
    const listeners = new Map();
    const attrs = new Map();
    const el = {
      tagName: String(tag || "DIV").toUpperCase(),
      id,
      textContent: "",
      innerHTML: "",
      dataset: {},
      style: {},
      children: [],
      classList: {
        add(...n) { n.forEach((x) => classes.add(x)); },
        remove(...n) { n.forEach((x) => classes.delete(x)); },
        contains(x) { return classes.has(x); },
        toggle(x, f) {
          const next = f !== undefined ? Boolean(f) : !classes.has(x);
          if (next) classes.add(x); else classes.delete(x);
          return next;
        },
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      addEventListener(t, fn) {
        if (!listeners.has(t)) listeners.set(t, []);
        listeners.get(t).push(fn);
      },
      click() {
        for (const fn of listeners.get("click") || []) fn({ target: el, currentTarget: el });
      },
      append(...nodes) { el.children.push(...nodes); },
      replaceChildren(...nodes) { el.children = [...nodes]; },
      querySelector(sel) {
        const m = sel.match(/\[data-call-action="([^"]+)"\]/);
        const walk = (node) => {
          for (const ch of node.children || []) {
            if (m && ch.dataset?.callAction === m[1]) return ch;
            const hit = walk(ch);
            if (hit) return hit;
          }
          return null;
        };
        return walk(el);
      },
    };
    return el;
  }

  const els = new Map([
    ["dm-call-toast", makeEl("DIV", "dm-call-toast")],
    ["dm-call-toast-avatar", makeEl("DIV", "dm-call-toast-avatar")],
    ["dm-call-toast-name", makeEl("STRONG", "dm-call-toast-name")],
    ["dm-call-toast-sub", makeEl("SPAN", "dm-call-toast-sub")],
    ["dm-call-toast-warn", makeEl("SMALL", "dm-call-toast-warn")],
    ["dm-active-call-banner", makeEl("SECTION", "dm-active-call-banner")],
    ["voice-connection-details", makeEl("SECTION", "voice-connection-details")],
  ]);

  const state = {
    selfUser: { id: "u-self", username: selfUsername, status_kind: statusKind },
    users: new Map(),
    voiceMembers: {},
    activeView: "home",
    activeDmId: "dm:gabriel__swag",
    currentVoiceChannel: null,
    pendingIncomingCall: null,
    activeCalls: new Map(),
    audioSettings: {
      callSounds: { enabled: true, volume: 85, ringtoneVolume: 80, incoming: true },
    },
    deafened: false,
    muted: false,
    localScreenStream: null,
    localCameraStream: null,
    userVolumes: new Map(),
    speakingUsers: new Set(),
    servers: [],
    blockedUsers: new Set(),
  };

  class FakeAudio {
    constructor(url) {
      this.url = url;
      this.volume = 1;
      this.currentTime = 0;
    }
    play() { return Promise.resolve(); }
    pause() { audioStoppedCount += 1; }
  }

  const document = {
    hidden: false,
    hasFocus: () => true,
    getElementById: (id) => els.get(id) || null,
    createElement: (tag) => makeEl(tag),
    addEventListener: () => {},
  };

  const window = {
    document,
    ipc: { postMessage: (m) => ipcPosts.push(m) },
    focus: () => {},
  };

  const ctx = vm.createContext({
    window,
    document,
    Audio: FakeAudio,
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    state,
    dmCallToast: els.get("dm-call-toast"),
    dmCallToastAvatar: els.get("dm-call-toast-avatar"),
    dmCallToastName: els.get("dm-call-toast-name"),
    voiceSignalBox: null,
    activeVoiceChannelName: null,
    toggleMuteBtn: null,
    sendWs: (type, payload) => { sent.push({ type, payload }); return true; },
    showUiToast: (msg) => toasts.push(msg),
    playUiSound: () => {},
    renderAvatarInner: (u) => u,
    isPrivateVoiceId: (id) => Boolean(id && (id.startsWith("dmvoice:") || id.startsWith("gdmvoice:"))),
    getDmVoiceIdFromDmId: (dm) => dm ? dm.replace(/^dm:/, "dmvoice:").replace(/^gdm:/, "gdmvoice:") : null,
    getFriendlyVoiceName: (id) => `Call ${id}`,
    joinVoiceChannel: (id, label) => { joined.push({ id, label }); state.currentVoiceChannel = id; },
    leaveVoiceChannel: () => { leftCalls.push(state.currentVoiceChannel); state.currentVoiceChannel = null; },
    updateDmCallButtonUI: () => {},
    updateVoiceCallTimer: () => {},
    saveAudioSettings: () => {},
    isMutedId: () => false,
    SancordUI: { confirm: async () => true },
  });

  vm.runInContext(
    `${soundMgrSrc}\n${voiceSoundsSrc}\n${notifSrc}\n${voiceSrc}\n` +
      `this.SancordSoundManager = SancordSoundManager;\n` +
      `this.SancordVoiceSounds = SancordVoiceSounds;\n` +
      `this.SancordNotifications = SancordNotifications;\n` +
      `this.onCallStateUpdated = onCallStateUpdated;\n` +
      `this.onActiveCallsSync = onActiveCallsSync;\n` +
      `this.onCallAnswered = onCallAnswered;\n` +
      `this.onCallRingTimeout = onCallRingTimeout;\n` +
      `this.onCallCanceled = onCallCanceled;\n` +
      `this.onCallDeclined = onCallDeclined;\n` +
      `this.onCallEnded = onCallEnded;\n` +
      `this.answerIncomingCall = answerIncomingCall;\n` +
      `this.declineIncomingCall = declineIncomingCall;\n` +
      `this.renderPrivateCallBanner = renderPrivateCallBanner;\n`,
    ctx
  );

  ctx.SancordSoundManager.setTestPlayHook((ev) => played.push(ev));

  return {
    ctx,
    state,
    els,
    sent,
    toasts,
    ipcPosts,
    joined,
    leftCalls,
    played,
    getAudioStoppedCount: () => audioStoppedCount,
  };
}

test("ringtone toca no destinatário, para imediatamente ao atender (sem sobrepor áudio) e respeita ringtoneVolume", async () => {
  const rt = buildCallRuntime({ selfUsername: "Swag" });
  const now = Date.now();
  rt.ctx.onCallStateUpdated({
    call: {
      call_id: "c1",
      dm_id: "dm:gabriel__swag",
      voice_channel_id: "dmvoice:gabriel__swag",
      state: "RINGING",
      caller_username: "Gabriel",
      caller_display_name: "Gabriel",
      caller_color: "#5865f2",
      active_participants: ["Gabriel"],
      ringing_targets: ["Swag"],
      declined_by: [],
      created_at: now,
      ring_started_at: now,
      ring_expires_at: now + 25000,
      server_now: now,
    },
  });

  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("incoming"), true);
  assert.equal(rt.played[0].cueId, "incoming_call_loop");
  assert.equal(rt.played[0].volume, 80);
  assert.equal(rt.els.get("dm-call-toast").classList.contains("hidden"), false);

  await rt.ctx.answerIncomingCall(rt.state.pendingIncomingCall);
  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("incoming"), false, "ringtone deve parar imediatamente ao atender");
  assert.ok(rt.getAudioStoppedCount() >= 1, "reprodução ativa de áudio deve ser interrompida imediatamente");
  assert.equal(rt.els.get("dm-call-toast").classList.contains("hidden"), true);
  assert.equal(rt.joined.length, 1);
  assert.equal(rt.joined[0].id, "dmvoice:gabriel__swag");
  assert.ok(rt.ipcPosts.includes("window:focus"));
  rt.ctx.SancordVoiceSounds.resetForTests();
});

test("DND silencia ringtone sonoro mas mantém aviso visual da chamada", () => {
  const rt = buildCallRuntime({ selfUsername: "Swag", statusKind: "dnd" });
  const now = Date.now();
  rt.ctx.onCallStateUpdated({
    call: {
      call_id: "c-dnd",
      dm_id: "dm:gabriel__swag",
      voice_channel_id: "dmvoice:gabriel__swag",
      state: "RINGING",
      caller_username: "Gabriel",
      caller_display_name: "Gabriel",
      active_participants: ["Gabriel"],
      ringing_targets: ["Swag"],
      declined_by: [],
      ring_started_at: now,
      ring_expires_at: now + 20000,
      server_now: now,
    },
  });

  assert.equal(rt.played.length, 0, "não deve tocar ringtone sonoro em DND");
  assert.equal(rt.els.get("dm-call-toast").classList.contains("hidden"), false, "aviso visual continua visível em DND");
  rt.ctx.onCallEnded({ channel_id: "dmvoice:gabriel__swag" });
  rt.ctx.SancordVoiceSounds.resetForTests();
});

test("timeout do ringing para toque e muda banner para 'Chamada em andamento' com botão Entrar (entrada tardia)", () => {
  const rt = buildCallRuntime({ selfUsername: "Swag" });
  const now = Date.now();
  rt.ctx.onCallStateUpdated({
    call: {
      call_id: "c-late",
      dm_id: "dm:gabriel__swag",
      voice_channel_id: "dmvoice:gabriel__swag",
      state: "RINGING",
      caller_username: "Gabriel",
      caller_display_name: "Gabriel",
      active_participants: ["Gabriel"],
      ringing_targets: ["Swag"],
      declined_by: [],
      ring_started_at: now,
      ring_expires_at: now + 30000,
      server_now: now,
    },
  });
  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("incoming"), true);

  // Timeout chega do servidor: ringtone para, toast some, banner vira "Chamada em andamento" + [Entrar na chamada]
  rt.ctx.onCallRingTimeout({ call_id: "c-late", channel_id: "dmvoice:gabriel__swag" });
  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("incoming"), false);
  assert.equal(rt.els.get("dm-call-toast").classList.contains("hidden"), true);

  const banner = rt.els.get("dm-active-call-banner");
  assert.equal(banner.classList.contains("hidden"), false);
  const lateJoinBtn = banner.querySelector('[data-call-action="late-join"]');
  assert.ok(lateJoinBtn, "destinatário deve ver botão Entrar na chamada após o timeout");
  lateJoinBtn.click();
  assert.equal(rt.joined[0].id, "dmvoice:gabriel__swag");
  rt.ctx.SancordVoiceSounds.resetForTests();
});

test("chamador mantém sessão aberta após recusa/timeout, pode Cancelar toque ou Chamar novamente", (t) => {
  const rt = buildCallRuntime({ selfUsername: "Gabriel" });
  t.after(() => rt.ctx.SancordVoiceSounds.resetForTests());
  rt.state.currentVoiceChannel = "dmvoice:gabriel__swag";
  const now = Date.now();

  rt.ctx.onCallStateUpdated({
    call: {
      call_id: "c-caller",
      dm_id: "dm:gabriel__swag",
      voice_channel_id: "dmvoice:gabriel__swag",
      state: "RINGING",
      caller_username: "Gabriel",
      caller_display_name: "Gabriel",
      active_participants: ["Gabriel"],
      ringing_targets: ["Swag"],
      declined_by: [],
      ring_started_at: now,
      ring_expires_at: now + 30000,
      server_now: now,
    },
  });
  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("outgoing"), true, "chamador ouve ringback durante RINGING");
  const cancelBtn = rt.els.get("dm-active-call-banner").querySelector('[data-call-action="cancel-ring"]');
  assert.ok(cancelBtn, "chamador deve ter botão Cancelar toque");
  cancelBtn.click();
  assert.equal(rt.sent[0].type, "CancelCall");
  assert.equal(rt.sent[0].payload.channel_id, "dmvoice:gabriel__swag");

  // Swag recusa -> ringback para, toast avisa, MAS Gabriel NÃO é expulso da call!
  rt.ctx.onCallDeclined({ channel_id: "dmvoice:gabriel__swag", by_username: "Swag" });
  assert.equal(rt.leftCalls.length, 0, "recusa não deve expulsar o chamador automaticamente");
  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("outgoing"), false);
  assert.ok(rt.toasts.some((t) => t.includes("Swag recusou")));

  // Transição para WAITING_ACTIVE exibe botão Chamar novamente
  rt.ctx.onCallStateUpdated({
    call: {
      call_id: "c-caller",
      dm_id: "dm:gabriel__swag",
      voice_channel_id: "dmvoice:gabriel__swag",
      state: "WAITING_ACTIVE",
      caller_username: "Gabriel",
      caller_display_name: "Gabriel",
      active_participants: ["Gabriel"],
      ringing_targets: [],
      declined_by: ["Swag"],
      server_now: now + 5000,
    },
  });
  const reRingBtn = rt.els.get("dm-active-call-banner").querySelector('[data-call-action="re-ring"]');
  assert.ok(reRingBtn, "chamador deve poder Chamar novamente em WAITING_ACTIVE");
  reRingBtn.click();
  assert.equal(rt.sent[1].type, "RingCall");
  assert.equal(rt.sent[1].payload.channel_id, "dmvoice:gabriel__swag");
});

test("reconexão após ring timeout via ActiveCallsSync NÃO reinicia ringtone e exibe entrada tardia", () => {
  const rt = buildCallRuntime({ selfUsername: "Swag" });
  const now = Date.now();
  rt.ctx.onActiveCallsSync({
    calls: [
      {
        call_id: "c-rec",
        dm_id: "dm:gabriel__swag",
        voice_channel_id: "dmvoice:gabriel__swag",
        state: "WAITING_ACTIVE",
        caller_username: "Gabriel",
        caller_display_name: "Gabriel",
        active_participants: ["Gabriel"],
        ringing_targets: [],
        declined_by: [],
        ring_expires_at: null,
        server_now: now,
      },
    ],
  });

  assert.equal(rt.played.length, 0, "não pode tocar ringtone após timeout ao reconectar");
  assert.equal(rt.els.get("dm-call-toast").classList.contains("hidden"), true);
  assert.ok(rt.els.get("dm-active-call-banner").querySelector('[data-call-action="late-join"]'));
  rt.ctx.SancordVoiceSounds.resetForTests();
});

test("multi-dispositivo: CallAnswered ou CallDeclined em outro aparelho para ringtone imediatamente", () => {
  const rt = buildCallRuntime({ selfUsername: "Swag" });
  const now = Date.now();
  rt.ctx.onCallStateUpdated({
    call: {
      call_id: "c-md",
      dm_id: "dm:gabriel__swag",
      voice_channel_id: "dmvoice:gabriel__swag",
      state: "RINGING",
      caller_username: "Gabriel",
      caller_display_name: "Gabriel",
      active_participants: ["Gabriel"],
      ringing_targets: ["Swag"],
      declined_by: [],
      ring_started_at: now,
      ring_expires_at: now + 30000,
      server_now: now,
    },
  });
  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("incoming"), true);

  rt.ctx.onCallAnswered({ call_id: "c-md", channel_id: "dmvoice:gabriel__swag", by_username: "Swag" });
  assert.equal(rt.ctx.SancordSoundManager.isLoopActive("incoming"), false);
  assert.equal(rt.els.get("dm-call-toast").classList.contains("hidden"), true);
  rt.ctx.SancordVoiceSounds.resetForTests();
});
