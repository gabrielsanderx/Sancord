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
const UNANSWERED_TIMEOUT_MS = 45000;

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
  if (!channelId) return;
  const generation = ++voiceStatsGeneration;
  const replies = await Promise.allSettled([...state.peers.values()].map(async ({ pc }) => summarizeVoiceStats(await pc.getStats())));
  if (generation !== voiceStatsGeneration || channelId !== state.currentVoiceChannel) return;
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
    el.title = label;
    if (icon) {
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", label);
      el.append(SancordIcons.node(icon));
    } else el.textContent = label;
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
  setTimeout(() => {
    if (state.currentVoiceChannel && state.selfUser?.voice_channel_id !== state.currentVoiceChannel) {
      leaveVoiceChannel();
    }
  }, 0);
}

/** Reconexão do WebSocket: volta para a mesma chamada com o estado de mídia atual. */
function resumeVoiceAfterReconnect() {
  const channel = state.currentVoiceChannel;
  if (!channel) return;
  cleanupAllPeers();
  sendWs("JoinVoice", { channel_id: channel });
  syncVoiceStateWithServer();
  renderVoiceStage();
  showUiToast("Conexão restabelecida — voltando para a chamada.");
}

// ---------------------------------------------------------------------------
// Chamadas privadas: toque, recusa, fim e "ninguém atendeu"
// ---------------------------------------------------------------------------

function startIncomingRing(channelId) {
  stopIncomingRing();
  playUiSound("mention");
  state.ringInterval = setInterval(() => playUiSound("mention"), 2500);
  state.ringTimeout = setTimeout(() => {
    if (state.pendingIncomingCall?.voice_channel_id === channelId) {
      dmCallToast?.classList.add("hidden");
      state.pendingIncomingCall = null;
    }
    stopIncomingRing();
  }, RING_TIMEOUT_MS);
}

function stopIncomingRing() {
  clearInterval(state.ringInterval);
  clearTimeout(state.ringTimeout);
  state.ringInterval = null;
  state.ringTimeout = null;
}

function onCallEnded({ channel_id }) {
  if (state.pendingIncomingCall?.voice_channel_id === channel_id) {
    dmCallToast?.classList.add("hidden");
    state.pendingIncomingCall = null;
    stopIncomingRing();
  }
}

function aloneInCall(channelId) {
  const members = state.voiceMembers?.[channelId] || [];
  return members.every((id) => id === state.selfUser?.id);
}

function onCallDeclined({ channel_id, by_username }) {
  showUiToast(`${by_username} recusou a chamada.`);
  // Numa DM 1:1, se ninguém mais está na chamada, encerra.
  if (state.currentVoiceChannel === channel_id && channel_id.startsWith("dmvoice:") && aloneInCall(channel_id)) {
    leaveVoiceChannel();
  }
}

/** Quem liga numa DM 1:1 desiste sozinho se ninguém atender. */
function startUnansweredCallTimer(channelId) {
  clearUnansweredCallTimer();
  if (!channelId.startsWith("dmvoice:")) return;
  state.unansweredTimer = setTimeout(() => {
    if (state.currentVoiceChannel === channelId && aloneInCall(channelId)) {
      leaveVoiceChannel();
      showUiToast("Ninguém atendeu a chamada.");
    }
  }, UNANSWERED_TIMEOUT_MS);
}

function clearUnansweredCallTimer() {
  clearTimeout(state.unansweredTimer);
  state.unansweredTimer = null;
}
