// ============================================================================
// Sancord — Voz (Fase 6)
//   Volume e silêncio por pessoa (só neste aparelho), menu de botão direito
//   dos participantes, moderação de voz do servidor, toque/recusa/fim de
//   chamadas privadas e retomada da chamada após reconexão do WebSocket.
// Depende de globais do app.js (state, sendWs, joinVoiceChannel...).
// ============================================================================

const VOLUME_KEY = "sancord_voice_volumes";
const LOCAL_MUTE_KEY = "sancord_voice_local_mutes";
const RING_TIMEOUT_MS = 30000;
const CALL_RING_DURATION_MS = 30000;

function readJsonStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

state.voiceVolumes = readJsonStore(VOLUME_KEY, {});
state.localVoiceMutes = new Set(readJsonStore(LOCAL_MUTE_KEY, []));

/** Volume e silêncio local ficam pelo nome: o id muda a cada conexão. */
function voiceKeyOf(peerId) {
  return state.users.get(peerId)?.username?.toLowerCase() || null;
}

function getStoredVolume(peerId) {
  const key = voiceKeyOf(peerId);
  if (key && typeof state.voiceVolumes[key] === "number") return state.voiceVolumes[key];
  return state.userVolumes.has(peerId) ? state.userVolumes.get(peerId) : 100;
}

function storeVolume(peerId, pct) {
  const key = voiceKeyOf(peerId);
  if (!key) return;
  if (pct === 100) delete state.voiceVolumes[key];
  else state.voiceVolumes[key] = pct;
  writeJsonStore(VOLUME_KEY, state.voiceVolumes);
}

function isLocallyMuted(peerId) {
  const key = voiceKeyOf(peerId);
  return Boolean(key && state.localVoiceMutes.has(key));
}

function toggleLocalMute(peerId) {
  const key = voiceKeyOf(peerId);
  if (!key) return;
  if (state.localVoiceMutes.has(key)) state.localVoiceMutes.delete(key);
  else state.localVoiceMutes.add(key);
  writeJsonStore(LOCAL_MUTE_KEY, [...state.localVoiceMutes]);
  setPeerVolume(peerId, getPeerVolume(peerId));
  renderVoiceChannels();
  renderVoiceStage();
}

/** O áudio desta pessoa não deve tocar aqui (silêncio local ou do servidor). */
function isPeerSilenced(peerId) {
  const u = state.users.get(peerId);
  return isLocallyMuted(peerId) || Boolean(u?.server_muted || u?.server_deafened);
}

function selfServerMuted() {
  const u = state.selfUser;
  return Boolean(u?.voice_channel_id && (u.server_muted || u.server_deafened));
}

function selfServerDeafened() {
  const u = state.selfUser;
  return Boolean(u?.voice_channel_id && u.server_deafened);
}

/** Avisa quando um moderador muda meu estado e marca o botão do microfone. */
function updateServerModerationUI() {
  const muted = selfServerMuted();
  const deaf = selfServerDeafened();
  const prev = state.lastServerModeration || { muted: false, deaf: false };
  if (state.currentVoiceChannel) {
    if (deaf && !prev.deaf) showUiToast("Um moderador ensurdeceu você neste servidor.");
    else if (muted && !prev.muted) showUiToast("Um moderador silenciou seu microfone neste servidor.");
    else if (!muted && prev.muted) showUiToast("Seu microfone foi liberado pelo servidor.");
  }
  state.lastServerModeration = { muted, deaf };
  if (typeof toggleMuteBtn !== "undefined" && toggleMuteBtn) {
    toggleMuteBtn.classList.toggle("server-locked", muted);
    toggleMuteBtn.title = muted ? "Silenciado pelo servidor" : "Silenciar microfone";
  }
}

function serverOfVoiceChannel(channelId) {
  return (state.servers || []).find((s) => (s.voice_channels || []).some((c) => c.id === channelId)) || null;
}

const voiceDetails = document.getElementById("voice-connection-details");
let voiceStatsGeneration = 0;

function closeVoiceDetails() {
  if (voiceDetails.classList.contains("hidden")) return false;
  voiceDetails.classList.add("hidden");
  voiceSignalBox.setAttribute("aria-expanded", "false");
  return true;
}

function updateVoiceDockContext(channelId) {
  voiceStatsGeneration++;
  closeVoiceDetails();
  document.getElementById("voice-connection-scope").textContent = isPrivateVoiceId(channelId)
    ? "Chamada privada" : serverOfVoiceChannel(channelId)?.name || "Canal de voz";
}

function summarizeVoiceStats(reports) {
  const records = [...reports.values()];
  const pair = records.map(r => r.selectedCandidatePairId && reports.get(r.selectedCandidatePairId)).find(Boolean) ||
    records.find(r => r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected));
  const audio = records.find(r => r.type === "inbound-rtp" && (r.kind || r.mediaType) === "audio");
  const codec = reports.get(audio?.codecId)?.mimeType;
  const candidate = reports.get(pair?.localCandidateId);
  const remote = reports.get(pair?.remoteCandidateId);
  const total = audio ? audio.packetsReceived + Math.max(0, audio.packetsLost || 0) : 0;
  return {
    rtt: Number.isFinite(pair?.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1000) : null,
    jitter: Number.isFinite(audio?.jitter) ? Math.round(audio.jitter * 1000) : null,
    loss: total > 0 ? Math.max(0, audio.packetsLost || 0) * 100 / total : null,
    codec: codec?.split("/").at(-1) || null,
    transport: candidate?.protocol ? `${candidate.protocol.toUpperCase()} · ${[candidate.candidateType, remote?.candidateType].includes("relay") ? "TURN" : "Direto"}` : null,
    capacity: Number.isFinite(pair?.availableOutgoingBitrate) ? Math.round(pair.availableOutgoingBitrate / 1000) : null,
  };
}

async function refreshVoiceConnectionDetails() {
  const channelId = state.currentVoiceChannel;
  if (!channelId || isVisualWindowHidden()) return;
  const generation = ++voiceStatsGeneration;
  const replies = await Promise.allSettled([...state.peers.values()].map(async ({ pc }) => summarizeVoiceStats(await pc.getStats())));
  if (generation !== voiceStatsGeneration || channelId !== state.currentVoiceChannel || isVisualWindowHidden()) return;
  const samples = replies.filter(result => result.status === "fulfilled").map(result => result.value);
  const measured = samples.filter(sample => sample.rtt != null).sort((a, b) => b.rtt - a.rtt);
  const sample = measured[0] || samples[0];
  const quality = measured.some(s => s.rtt >= 180 || s.loss >= 5) ? ["Instável", "sig-bad"] :
    measured.some(s => s.rtt >= 80 || s.loss >= 2) ? ["Boa", "sig-warn"] :
      measured.length ? ["Excelente", "sig-good"] : [state.peers.size ? "Medindo conexão" : "Aguardando participantes", ""];
  voiceSignalBox.className = `voice-signal-box ${quality[1]}`.trim();
  voiceSignalBox.title = `${quality[0]} · Detalhes da conexão`;
  voiceSignalBox.setAttribute("aria-label", voiceSignalBox.title);
  const heading = document.createElement("strong");
  heading.textContent = quality[0];
  voiceDetails.replaceChildren(heading);
  const details = [
    ["Ping", sample?.rtt, " ms"], ["Jitter", sample?.jitter, " ms"],
    ["Perda acumulada", sample?.loss?.toFixed(1), "%"], ["Codec", sample?.codec, ""],
    ["Transporte", sample?.transport, ""], ["Capacidade estimada", sample?.capacity, " kbps"],
  ].filter(([, value]) => value != null);
  if (details.length) {
    const list = document.createElement("dl");
    for (const [name, value, unit] of details) {
      const label = document.createElement("dt");
      label.textContent = name;
      const text = document.createElement("dd");
      text.textContent = `${value}${unit}`;
      list.append(label, text);
    }
    voiceDetails.append(list);
  }
}

function syncPrivateStageControls() {
  const controls = document.getElementById("private-stage-controls");
  const privateCall = isPrivateVoiceId(state.currentVoiceChannel);
  controls.classList.toggle("hidden", !privateCall);
  document.getElementById("stage-open-voice-chat-btn")?.classList.toggle("hidden", privateCall);
  if (!privateCall) return;
  const actions = [
    ["mute", state.muted ? "mic-off" : "mic", state.muted ? "Ativar microfone" : "Silenciar microfone", toggleMuteBtn, state.muted],
    ["deafen", state.deafened ? "headphones-off" : "headphones", state.deafened ? "Ativar som" : "Desativar som", toggleDeafenBtn, state.deafened],
    ["video", "camera", "Vídeo", toggleCameraBtn, Boolean(state.localCameraStream)],
    ["screen", "screen", "Compartilhar tela", shareScreenBtn, Boolean(state.localScreenStream)],
    ["leave", "disconnect", "Encerrar chamada", leaveVoiceBtn, null],
  ];
  for (const [key, icon, label, action, pressed] of actions) {
    let button = controls.querySelector(`[data-call-control="${key}"]`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = `voice-action-btn${key === "leave" ? " voice-disconnect" : ""}`;
      button.dataset.callControl = key;
      button.addEventListener("click", () => action.click());
      controls.append(button);
    }
    button.disabled = action.disabled;
    button.title = label;
    button.setAttribute("aria-label", label);
    if (pressed !== null) button.setAttribute("aria-pressed", String(pressed));
    if (button.dataset.icon !== icon) {
      button.replaceChildren(SancordIcons.node(icon));
      button.dataset.icon = icon;
    }
  }
}

voiceSignalBox?.addEventListener("click", () => {
  if (closeVoiceDetails()) return;
  voiceDetails.classList.remove("hidden");
  voiceSignalBox.setAttribute("aria-expanded", "true");
  refreshVoiceConnectionDetails();
});
activeVoiceChannelName?.addEventListener("click", () => voiceStage.classList.toggle("hidden"));
document.addEventListener("mousedown", e => {
  if (!voiceSignalBox?.contains(e.target) && !voiceDetails.contains(e.target)) closeVoiceDetails();
});

function watchUserScreenShare(uid) {
  const user = state.users.get(uid);
  if (!user || !user.voice_channel_id) return;
  const openStage = () => {
    if (typeof voiceStage !== "undefined" && voiceStage) {
      voiceStage.classList.remove("hidden");
    }
    state.spotlightCardId = `screen-${uid}`;
    if (typeof syncVoiceStageContext === "function") syncVoiceStageContext();
    if (typeof renderVoiceStage === "function") renderVoiceStage();
  };
  if (state.currentVoiceChannel === user.voice_channel_id) {
    openStage();
  } else if (typeof joinVoiceChannel === "function") {
    Promise.resolve(joinVoiceChannel(user.voice_channel_id)).then(openStage).catch(() => {});
  }
}

function voiceUserIndicators(user) {
  return [
    ["noise", "Falando", "voice-speaking-glyph"],
    user.camera_on && ["camera", "Câmera ligada"],
    user.screen_sharing && [null, "Ao vivo", "voice-live-label"],
    (user.server_muted || user.muted) && ["mic-off", user.server_muted ? "Silenciado pelo servidor" : "Microfone silenciado"],
    (user.server_deafened || user.deafened) && ["headphones-off", user.server_deafened ? "Ensurdecido pelo servidor" : "Som desativado"],
    isLocallyMuted(user.id) && ["bell-off", "Silenciado só para você"],
  ].filter(Boolean).map(([icon, label, cls]) => {
    const el = document.createElement("span");
    el.className = cls || "voice-user-state";
    el.title = cls === "voice-live-label" ? "Assistir transmissão" : label;
    if (icon) {
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", label);
      el.append(SancordIcons.node(icon));
    } else {
      el.textContent = label;
      if (cls === "voice-live-label" && user?.id) {
        el.style.cursor = "pointer";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          watchUserScreenShare(user.id);
        });
      }
    }
    return el;
  });
}

function buildVoiceUserItem(srv, user) {
  const row = document.createElement("li");
  row.className = "voice-member-row voice-user-row";
  row.dataset.speakingUser = user.id;
  row.classList.toggle("speaking", state.speakingUsers.has(user.id));
  const name = memberNickname(srv, user.username) || user.display_name || user.username;
  const profile = document.createElement("button");
  profile.type = "button";
  profile.className = "voice-user-main";
  profile.title = `${name} · @${user.username}`;
  profile.setAttribute("aria-label", `Abrir perfil de ${name}`);
  const avatar = document.createElement("span");
  avatar.className = "avatar-small";
  avatar.style.background = user.avatar_color || "var(--accent)";
  avatar.innerHTML = renderAvatarInner(user.username, user.avatar_url, user.avatar_animated);
  const label = document.createElement("span");
  label.className = "voice-user-name";
  label.textContent = name;
  const flags = document.createElement("span");
  flags.className = "voice-user-flags";
  flags.append(...voiceUserIndicators(user));
  profile.append(avatar, label, flags);
  profile.addEventListener("click", () => openCompactProfile(user.id, { author_name: user.username, channel_id: user.voice_channel_id }, profile));
  const more = document.createElement("button");
  more.type = "button";
  more.className = "voice-user-more";
  more.setAttribute("aria-label", `Opções de ${name}`);
  more.setAttribute("aria-haspopup", "menu");
  more.append(SancordIcons.node("more"));
  SancordUI.tooltip(more, "Opções de voz", "top");
  more.addEventListener("click", () => {
    const rect = more.getBoundingClientRect();
    openVoiceUserMenu({ clientX: rect.right, clientY: rect.top }, user.id);
  });
  row.addEventListener("contextmenu", e => {
    e.preventDefault();
    e.stopPropagation();
    openVoiceUserMenu(e, user.id);
  });
  row.append(profile, more);
  return row;
}

/** Menu de botão direito de um participante da voz. */
function openVoiceUserMenu(e, uid) {
  const user = state.users.get(uid);
  if (!user) return;
  const isSelf = uid === state.selfUser?.id;
  const name = user.display_name || user.username;
  const items = [{ header: name }];
  if (user.screen_sharing) {
    items.push({
      label: "Assistir transmissão",
      icon: "screen",
      onSelect: () => watchUserScreenShare(uid),
    });
  }
  items.push({
    label: "Ver perfil",
    icon: "user",
    onSelect: () => openCompactProfile(uid, { author_name: user.username, channel_id: user.voice_channel_id }),
  });

  if (!isSelf) {
    const vol = getPeerVolume(uid);
    items.push({ label: "Mensagem", icon: "chat", onSelect: () => sendWs("OpenDm", { target_username: user.username }) });
    const volume = document.createElement("label");
    volume.className = "voice-menu-volume";
    const title = document.createElement("span");
    title.textContent = `Volume para você · ${vol}%`;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 200;
    slider.value = vol;
    slider.addEventListener("input", () => {
      setPeerVolume(uid, slider.value);
      title.textContent = `Volume para você · ${slider.value}%`;
    });
    volume.append(title, slider);
    items.push({ separator: true }, { control: volume });
    items.push({
      label: isLocallyMuted(uid) ? "Ouvir novamente" : "Silenciar para mim",
      icon: "bell-off",
      hint: "só neste aparelho",
      onSelect: () => toggleLocalMute(uid),
    });
  }

  // Moderação (só em canais de servidor e com a permissão correspondente).
  const srv = serverOfVoiceChannel(user.voice_channel_id);
  if (srv && !isSelf) {
    const perms = getServerPermissionsFor(srv, state.selfUser?.username);
    const act = (action, extra = {}) =>
      sendWs("ModerateVoice", { server_id: srv.id, target_username: user.username, action, ...extra });
    const mod = [];
    if (perms.mute_members) {
      mod.push({ label: user.server_muted ? "Remover silêncio do servidor" : "Silenciar no servidor", icon: "🔇", danger: !user.server_muted, onSelect: () => act(user.server_muted ? "unmute" : "mute") });
    }
    if (perms.deafen_members) {
      mod.push({ label: user.server_deafened ? "Remover surdez do servidor" : "Ensurdecer no servidor", icon: "🎧", danger: !user.server_deafened, onSelect: () => act(user.server_deafened ? "undeafen" : "deafen") });
    }
    if (perms.move_members) {
      const targets = (srv.voice_channels || []).filter((c) => c.id !== user.voice_channel_id);
      for (const c of targets) {
        mod.push({ label: `Mover para ${c.name}`, icon: "↔️", onSelect: () => act("move", { channel_id: c.id }) });
      }
      mod.push({ label: "Desconectar da voz", icon: "⏏️", danger: true, onSelect: () => act("disconnect") });
    }
    mod.push(...(typeof memberModerationMenuItems === "function" ? memberModerationMenuItems(srv, user.username, name) : timeoutMenuItems(srv, user.username, name)));
    if (mod.length) items.push({ separator: true }, { header: "Moderação do servidor" }, ...mod);
  }
  SancordUI.contextMenu(e.clientX, e.clientY, items);
}

// ---------------------------------------------------------------------------
// Movido/desconectado por moderador e recusa de entrada
// ---------------------------------------------------------------------------

function onVoiceMoved({ channel_id, by }) {
  state.voiceJoinRequestId = (state.voiceJoinRequestId || 0) + 1;
  if (!channel_id) {
    leaveVoiceChannel();
    showUiToast(`${by} desconectou você da voz.`);
    return;
  }
  // O servidor já nos colocou no destino: só refaz as conexões e a interface.
  stopScreenSharing(false);
  stopCamera(false);
  cleanupAllPeers();
  state.currentVoiceChannel = channel_id;
  const name = getFriendlyVoiceName(channel_id);
  activeVoiceChannelName.textContent = `CALL / ${name}`;
  stageTitle.textContent = `🔊 Em chamada: ${name}`;
  syncVoiceStateWithServer();
  renderVoiceChannels();
  renderVoiceStage();
  showUiToast(`${by} moveu você para ${name}.`);
}

/** O servidor recusou a entrada (sem permissão, canal cheio...): desfaz a interface. */
function onJoinVoiceRejected() {
  if (state.voiceRecovery) {
    leaveVoiceChannel({ silent: true });
    return;
  }
  setTimeout(() => {
    if (state.currentVoiceChannel && state.selfUser?.voice_channel_id !== state.currentVoiceChannel) {
      leaveVoiceChannel();
    }
  }, 0);
}

function setVoiceRecovery(status) {
  const node = document.getElementById("voice-reconnect-status");
  node?.classList.toggle("hidden", !status);
  if (node) node.textContent = status || "";
}

function cancelVoiceRecovery() {
  clearTimeout(state.voiceRecovery?.timer);
  state.voiceRecovery = null;
  setVoiceRecovery("");
}

function suspendVoiceForReconnect() {
  state.voiceJoinRequestId = (state.voiceJoinRequestId || 0) + 1;
  const channel = state.currentVoiceChannel;
  if (!channel) return;
  cancelVoiceRecovery();
  state.voiceRecovery = { channel, joining: false };
  setVoiceRecovery("Conexão de voz interrompida · Reconectando…");
  stopScreenSharing(false);
  stopCamera(false);
  stopVoicePingMonitor();
  clearUnansweredCallTimer();
  cleanupAllPeers();
  applyLocalMuteState();
  renderVoiceStage();
}

function resumeVoiceAfterReconnect() {
  const recovery = state.voiceRecovery;
  if (!recovery || recovery.joining || recovery.channel !== state.currentVoiceChannel) return;
  const channel = recovery.channel;
  const privateCall = isPrivateVoiceId(channel);
  if (privateCall ? !state.voiceMembers[channel]?.length : !voicePermissions().connect_voice) {
    leaveVoiceChannel({ silent: true });
    showUiToast(privateCall ? "A chamada privada terminou." : "O canal de voz não está mais disponível.");
    return;
  }
  if (!sendWs("JoinVoice", { channel_id: channel, resume: true })) return;
  recovery.joining = true;
  recovery.timer = setTimeout(() => {
    if (state.voiceRecovery !== recovery) return;
    leaveVoiceChannel({ silent: true });
    if (typeof SancordVoiceSounds !== "undefined") SancordVoiceSounds.playLocal("voice_error");
    showUiToast("Não foi possível recuperar a chamada. Você pode entrar novamente.");
  }, 8000);
}

function confirmVoiceRecovery() {
  const recovery = state.voiceRecovery;
  if (!recovery?.joining || state.selfUser?.voice_channel_id !== recovery.channel) return;
  cancelVoiceRecovery();
  syncVoiceStateWithServer();
  startVoicePingMonitor();
  if (typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.onEnteredVoiceSession(recovery.channel, { isReconnect: true });
  }
}

// ---------------------------------------------------------------------------
// Chamadas privadas: máquina de estados autoritativa (RINGING ≠ CALL SESSION),
// toque real, ringback, recusa, cancelamento, entrada tardia e multi-dispositivo
// ---------------------------------------------------------------------------

function ensureActiveCallsMap() {
  if (!(state.activeCalls instanceof Map)) {
    state.activeCalls = new Map();
  }
  return state.activeCalls;
}

function computeRemainingRingMs(ringExpiresAt, serverNow) {
  if (typeof ringExpiresAt === "number" && Number.isFinite(ringExpiresAt)) {
    const base = typeof serverNow === "number" && Number.isFinite(serverNow) ? serverNow : Date.now();
    return Math.max(0, ringExpiresAt - base);
  }
  return CALL_RING_DURATION_MS;
}

function startIncomingRing(channelId, { timeoutMs = RING_TIMEOUT_MS, dmId = null } = {}) {
  stopIncomingRing();
  const safeTimeout = Math.max(250, Number(timeoutMs) || RING_TIMEOUT_MS);
  const expire = () => {
    if (state.pendingIncomingCall?.voice_channel_id === channelId) {
      dmCallToast?.classList.add("hidden");
      state.pendingIncomingCall = null;
    }
    stopIncomingRing();
    if (typeof renderPrivateCallBanner === "function") renderPrivateCallBanner();
  };
  if (typeof SancordVoiceSounds !== "undefined") {
    const started = SancordVoiceSounds.startIncomingRing(channelId, {
      timeoutMs: safeTimeout,
      onTimeout: expire,
      dmId,
    });
    // Mesmo quando o som está silenciado (ex.: DND), ainda encerramos o toast visual no fim do timeout.
    if (!started) {
      state.ringTimeout = setTimeout(expire, safeTimeout);
    }
    return;
  }
  playUiSound("mention");
  state.ringInterval = setInterval(() => playUiSound("mention"), 2200);
  state.ringTimeout = setTimeout(expire, safeTimeout);
}

function stopIncomingRing() {
  if (typeof SancordVoiceSounds !== "undefined") SancordVoiceSounds.stopIncomingRing();
  if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.clearIncomingCallAttention === "function") {
    SancordNotifications.clearIncomingCallAttention();
  }
  clearInterval(state.ringInterval);
  clearTimeout(state.ringTimeout);
  state.ringInterval = null;
  state.ringTimeout = null;
}

function clearIncomingCallToast(channelId = null) {
  if (channelId && state.pendingIncomingCall?.voice_channel_id !== channelId) return;
  dmCallToast?.classList.add("hidden");
  state.pendingIncomingCall = null;
  stopIncomingRing();
}

function showIncomingCallToast(info) {
  if (!info || !info.voice_channel_id) return;
  if (state.currentVoiceChannel === info.voice_channel_id) {
    clearIncomingCallToast(info.voice_channel_id);
    return;
  }
  const remainingMs = computeRemainingRingMs(info.ring_expires_at, info.server_now);
  if (remainingMs <= 0) {
    clearIncomingCallToast(info.voice_channel_id);
    return;
  }

  const prev = state.pendingIncomingCall;
  const sameRing =
    prev &&
    prev.voice_channel_id === info.voice_channel_id &&
    prev.call_id &&
    prev.call_id === info.call_id &&
    prev.ring_started_at === info.ring_started_at;

  const callGroup = info.dm_id?.startsWith("gdm:") && typeof findGroupDm === "function" ? findGroupDm(info.dm_id) : null;
  const groupName = callGroup && typeof groupDisplayName === "function" ? groupDisplayName(callGroup) : null;
  const displayFrom = info.from_display_name || info.from_username || "Alguém";

  state.pendingIncomingCall = {
    call_id: info.call_id || null,
    dm_id: info.dm_id,
    voice_channel_id: info.voice_channel_id,
    from_username: info.from_username,
    from_display_name: displayFrom,
    from_color: info.from_color,
    from_avatar: info.from_avatar,
    ring_started_at: info.ring_started_at || null,
    ring_expires_at: info.ring_expires_at || null,
    server_now: info.server_now || Date.now(),
  };

  if (typeof dmCallToastAvatar !== "undefined" && dmCallToastAvatar) {
    dmCallToastAvatar.style.background = info.from_color || "#5865f2";
    dmCallToastAvatar.innerHTML = renderAvatarInner(info.from_username, info.from_avatar);
  }
  if (typeof dmCallToastName !== "undefined" && dmCallToastName) {
    dmCallToastName.textContent = groupName ? `${displayFrom} • ${groupName}` : displayFrom;
  }
  const subEl = document.getElementById("dm-call-toast-sub");
  if (subEl) {
    subEl.textContent = groupName ? "está ligando no grupo..." : "está ligando...";
  }
  const warnEl = document.getElementById("dm-call-toast-warn");
  if (warnEl) {
    const inOtherCall = Boolean(state.currentVoiceChannel && state.currentVoiceChannel !== info.voice_channel_id);
    const streaming = Boolean(state.localScreenStream || state.localCameraStream);
    if (inOtherCall && streaming) {
      warnEl.textContent = "Você está transmitindo — atender vai trocar de chamada.";
      warnEl.classList.remove("hidden");
    } else if (inOtherCall) {
      warnEl.textContent = "Você está em outra chamada — atender vai trocar de sala.";
      warnEl.classList.remove("hidden");
    } else {
      warnEl.textContent = "";
      warnEl.classList.add("hidden");
    }
  }
  dmCallToast?.classList.remove("hidden");

  if (!sameRing) {
    startIncomingRing(info.voice_channel_id, { timeoutMs: remainingMs, dmId: info.dm_id });
    if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.notifyIncomingCall === "function") {
      SancordNotifications.notifyIncomingCall({
        call_id: info.call_id,
        dm_id: info.dm_id,
        voice_channel_id: info.voice_channel_id,
        from_username: info.from_username,
        caller_display_name: displayFrom,
        group_name: groupName,
      });
    }
  }
}

async function answerIncomingCall(pending) {
  if (!pending || !pending.voice_channel_id) return;
  const inOtherCall = Boolean(state.currentVoiceChannel && state.currentVoiceChannel !== pending.voice_channel_id);
  const streaming = Boolean(state.localScreenStream || state.localCameraStream);
  if (inOtherCall && streaming && typeof SancordUI !== "undefined" && typeof SancordUI.confirm === "function") {
    const ok = await SancordUI.confirm({
      title: "Trocar de chamada?",
      message: "Você está com câmera ou compartilhamento de tela ativo em outra chamada. Deseja encerrá-la e atender esta ligação?",
      confirmLabel: "Atender e trocar",
    });
    if (!ok) return;
  }

  clearIncomingCallToast(pending.voice_channel_id);
  try {
    window.ipc?.postMessage("window:focus");
  } catch (_) {}

  if (pending.dm_id?.startsWith("gdm:")) {
    if (typeof openGroupConversation === "function") openGroupConversation(pending.dm_id);
    joinVoiceChannel(pending.voice_channel_id, getFriendlyVoiceName(pending.voice_channel_id));
    return;
  }
  sendWs("OpenDm", { target_username: pending.from_username });
  joinVoiceChannel(pending.voice_channel_id, `Call privada: @${pending.from_username}`);
}

function declineIncomingCall(pending) {
  const target = pending || state.pendingIncomingCall;
  clearIncomingCallToast(target?.voice_channel_id || null);
  if (target?.voice_channel_id) {
    sendWs("DeclineCall", { channel_id: target.voice_channel_id });
  }
  renderPrivateCallBanner();
}

function onCallStateUpdated({ call }) {
  if (!call || !call.voice_channel_id) return;
  const map = ensureActiveCallsMap();
  const chId = call.voice_channel_id;
  const meLower = state.selfUser?.username?.toLowerCase() || "";

  if (call.state === "ENDED") {
    map.delete(chId);
    clearIncomingCallToast(chId);
    if (state.currentVoiceChannel === chId && typeof SancordVoiceSounds !== "undefined") {
      SancordVoiceSounds.stopOutgoingRing();
    }
    renderPrivateCallBanner();
    if (typeof updateDmCallButtonUI === "function") updateDmCallButtonUI();
    return;
  }

  map.set(chId, call);
  const amInCall = state.currentVoiceChannel === chId;
  const ringingTargets = Array.isArray(call.ringing_targets) ? call.ringing_targets : [];
  const amRingingTarget = Boolean(meLower && !amInCall && ringingTargets.some((u) => String(u).toLowerCase() === meLower));

  if (amRingingTarget) {
    showIncomingCallToast({
      call_id: call.call_id,
      dm_id: call.dm_id,
      voice_channel_id: chId,
      from_username: call.caller_username,
      from_display_name: call.caller_display_name,
      from_color: call.caller_color,
      from_avatar: call.caller_avatar,
      ring_started_at: call.ring_started_at,
      ring_expires_at: call.ring_expires_at,
      server_now: call.server_now,
    });
  } else if (state.pendingIncomingCall?.voice_channel_id === chId) {
    clearIncomingCallToast(chId);
  }

  if (amInCall) {
    if (typeof SancordVoiceSounds !== "undefined") {
      const remaining = computeRemainingRingMs(call.ring_expires_at, call.server_now);
      if (call.state === "RINGING" && ringingTargets.length > 0 && remaining > 0) {
        if (typeof SancordSoundManager === "undefined" || !SancordSoundManager.isLoopActive("outgoing")) {
          SancordVoiceSounds.startOutgoingRing(chId, { timeoutMs: remaining });
        }
      } else {
        SancordVoiceSounds.stopOutgoingRing();
      }
    }
    if (call.state === "CONNECTED" && typeof call.connected_at === "number") {
      const skew = typeof call.server_now === "number" ? Date.now() - call.server_now : 0;
      state.voiceCallStartedAt = call.connected_at + skew;
    }
    if (typeof updateVoiceCallTimer === "function") updateVoiceCallTimer();
  }

  renderPrivateCallBanner();
  if (typeof updateDmCallButtonUI === "function") updateDmCallButtonUI();
}

function onActiveCallsSync({ calls }) {
  const map = ensureActiveCallsMap();
  const nextIds = new Set();
  for (const call of Array.isArray(calls) ? calls : []) {
    if (call?.voice_channel_id) nextIds.add(call.voice_channel_id);
  }
  for (const prevId of [...map.keys()]) {
    if (!nextIds.has(prevId)) {
      map.delete(prevId);
      clearIncomingCallToast(prevId);
    }
  }
  for (const call of Array.isArray(calls) ? calls : []) {
    onCallStateUpdated({ call });
  }
  renderPrivateCallBanner();
  if (typeof updateDmCallButtonUI === "function") updateDmCallButtonUI();
}

function onCallAnswered({ channel_id, by_username }) {
  // Multi-device: se minha conta atendeu em outro aparelho, para imediatamente o ringtone aqui.
  clearIncomingCallToast(channel_id);
  if (state.currentVoiceChannel === channel_id && typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.stopOutgoingRing();
  }
  renderPrivateCallBanner();
  if (typeof updateDmCallButtonUI === "function") updateDmCallButtonUI();
}

function onCallRingTimeout({ channel_id }) {
  clearIncomingCallToast(channel_id);
  if (state.currentVoiceChannel === channel_id && typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.stopOutgoingRing();
  }
  const call = ensureActiveCallsMap().get(channel_id);
  if (call) {
    call.ringing_targets = [];
    call.ring_expires_at = null;
    if (call.state === "RINGING") call.state = "WAITING_ACTIVE";
  }
  renderPrivateCallBanner();
  if (typeof updateDmCallButtonUI === "function") updateDmCallButtonUI();
}

function onCallCanceled({ channel_id }) {
  clearIncomingCallToast(channel_id);
  if (state.currentVoiceChannel === channel_id && typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.stopOutgoingRing();
  }
  const call = ensureActiveCallsMap().get(channel_id);
  if (call) {
    call.ringing_targets = [];
    call.ring_expires_at = null;
    if (call.state === "RINGING") call.state = "WAITING_ACTIVE";
  }
  renderPrivateCallBanner();
  if (typeof updateDmCallButtonUI === "function") updateDmCallButtonUI();
}

function onCallEnded({ channel_id }) {
  ensureActiveCallsMap().delete(channel_id);
  clearIncomingCallToast(channel_id);
  if (state.currentVoiceChannel === channel_id && typeof SancordVoiceSounds !== "undefined") {
    SancordVoiceSounds.stopOutgoingRing();
  }
  renderPrivateCallBanner();
  if (typeof updateDmCallButtonUI === "function") updateDmCallButtonUI();
}

function aloneInCall(channelId) {
  const members = state.voiceMembers?.[channelId] || [];
  return members.every((id) => id === state.selfUser?.id);
}

function onCallDeclined({ channel_id, by_username }) {
  const meLower = state.selfUser?.username?.toLowerCase() || "";
  if (by_username && by_username.toLowerCase() === meLower) {
    // Recusado em outro dispositivo da mesma conta: silencia o toque imediatamente aqui.
    clearIncomingCallToast(channel_id);
    renderPrivateCallBanner();
    return;
  }
  if (typeof SancordVoiceSounds !== "undefined") SancordVoiceSounds.stopOutgoingRing();
  // O chamador recebe feedback claro, mas a sessão continua aberta (WAITING_ACTIVE) se ele quiser permanecer.
  showUiToast(`${by_username} recusou a chamada.`);
  renderPrivateCallBanner();
}

function renderPrivateCallBanner() {
  const banner = document.getElementById("dm-active-call-banner");
  if (!banner) return;
  const inDm = state.activeView === "home" && Boolean(state.activeDmId);
  if (!inDm) {
    banner.classList.add("hidden");
    banner.replaceChildren();
    return;
  }
  const voiceId = typeof getDmVoiceIdFromDmId === "function" ? getDmVoiceIdFromDmId(state.activeDmId) : null;
  const call = voiceId ? ensureActiveCallsMap().get(voiceId) : null;
  if (!call || call.state === "ENDED") {
    banner.classList.add("hidden");
    banner.replaceChildren();
    return;
  }

  const meLower = state.selfUser?.username?.toLowerCase() || "";
  const amInCall = state.currentVoiceChannel === voiceId;
  const ringingTargets = Array.isArray(call.ringing_targets) ? call.ringing_targets : [];
  const activeNames = Array.isArray(call.active_participants) ? call.active_participants : [];
  const declinedNames = Array.isArray(call.declined_by) ? call.declined_by : [];
  const amRingingTarget = Boolean(meLower && !amInCall && ringingTargets.some((u) => String(u).toLowerCase() === meLower));

  // Se já estamos na call e conectados com outras pessoas sem toque pendente, o palco já exibe tudo.
  if (amInCall && call.state === "CONNECTED" && ringingTargets.length === 0) {
    banner.classList.add("hidden");
    banner.replaceChildren();
    return;
  }

  const info = document.createElement("div");
  info.className = "dm-call-banner-info";
  const dot = document.createElement("span");
  dot.className = `dm-call-banner-dot${call.state === "RINGING" ? " is-ringing" : ""}`;
  const textWrap = document.createElement("div");
  textWrap.className = "dm-call-banner-text";
  const title = document.createElement("strong");
  const sub = document.createElement("span");

  const actions = document.createElement("div");
  actions.className = "dm-call-banner-actions";

  if (amInCall) {
    if (ringingTargets.length > 0) {
      title.textContent = `Chamando ${ringingTargets.join(", ")}...`;
      sub.textContent = "Aguardando resposta · você pode cancelar o toque e manter a sala aberta.";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn-secondary small-btn";
      cancelBtn.dataset.callAction = "cancel-ring";
      cancelBtn.textContent = "Cancelar toque";
      cancelBtn.addEventListener("click", () => sendWs("CancelCall", { channel_id: voiceId }));
      actions.append(cancelBtn);
    } else {
      if (declinedNames.length > 0) {
        title.textContent = `${declinedNames.join(", ")} recusou a chamada`;
      } else {
        title.textContent = "Sem resposta no momento";
      }
      sub.textContent = "A chamada continua aberta — a outra pessoa ainda pode entrar.";
      const reRingBtn = document.createElement("button");
      reRingBtn.type = "button";
      reRingBtn.className = "btn-secondary small-btn";
      reRingBtn.dataset.callAction = "re-ring";
      reRingBtn.textContent = "Chamar novamente";
      reRingBtn.addEventListener("click", () => sendWs("RingCall", { channel_id: voiceId }));
      actions.append(reRingBtn);
    }
    const leaveBtn = document.createElement("button");
    leaveBtn.type = "button";
    leaveBtn.className = "btn-decline-call small-btn";
    leaveBtn.dataset.callAction = "leave";
    leaveBtn.textContent = "Desligar";
    leaveBtn.addEventListener("click", () => leaveVoiceChannel());
    actions.append(leaveBtn);
  } else if (amRingingTarget) {
    title.textContent = `${call.caller_display_name || call.caller_username} está ligando...`;
    sub.textContent = "Chamada privada recebida";
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn-accept-call small-btn";
    acceptBtn.dataset.callAction = "answer";
    acceptBtn.textContent = "📞 Atender";
    acceptBtn.addEventListener("click", () =>
      answerIncomingCall({
        call_id: call.call_id,
        dm_id: call.dm_id,
        voice_channel_id: voiceId,
        from_username: call.caller_username,
        from_display_name: call.caller_display_name,
      })
    );
    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "btn-decline-call small-btn";
    declineBtn.dataset.callAction = "decline";
    declineBtn.textContent = "Recusar";
    declineBtn.addEventListener("click", () => declineIncomingCall({ voice_channel_id: voiceId }));
    actions.append(acceptBtn, declineBtn);
  } else {
    // Entrada tardia (WAITING_ACTIVE após timeout ou CONNECTED em grupo/DM)
    title.textContent = activeNames.length > 0 ? "Chamada em andamento" : "Chamada disponível";
    sub.textContent =
      activeNames.length > 0
        ? `${activeNames.join(", ")} ${activeNames.length === 1 ? "está" : "estão"} na chamada`
        : `${call.caller_display_name || call.caller_username} iniciou uma chamada recentemente`;
    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "btn-accept-call small-btn";
    joinBtn.dataset.callAction = "late-join";
    joinBtn.textContent = "Entrar na chamada";
    joinBtn.addEventListener("click", () => joinVoiceChannel(voiceId, getFriendlyVoiceName(voiceId)));
    actions.append(joinBtn);
  }

  textWrap.append(title, sub);
  info.append(dot, textWrap);
  banner.replaceChildren(info, actions);
  banner.classList.remove("hidden");
}

/** Mantida por compatibilidade: timeouts agora são autoritativos no servidor (RINGING ≠ CALL SESSION). */
function startUnansweredCallTimer(_channelId) {
  clearUnansweredCallTimer();
}

function clearUnansweredCallTimer() {
  clearTimeout(state.unansweredTimer);
  state.unansweredTimer = null;
}
