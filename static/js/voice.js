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

/** Menu de botão direito de um participante da voz. */
function openVoiceUserMenu(e, uid) {
  const user = state.users.get(uid);
  if (!user) return;
  const isSelf = uid === state.selfUser?.id;
  const name = user.display_name || user.username;
  const items = [{ header: name }];
  items.push({
    label: "Ver perfil",
    icon: "👤",
    onSelect: () => openMemberProfilePopover(uid, { author_name: user.username, author_color: user.avatar_color, author_avatar: user.avatar_url }),
  });

  if (!isSelf) {
    const vol = getPeerVolume(uid);
    items.push({ separator: true }, { header: `Volume para você — ${vol}%` });
    for (const pct of [50, 100, 150, 200]) {
      items.push({ label: `${pct}%`, icon: pct === vol ? "✓" : "🔊", onSelect: () => setPeerVolume(uid, pct) });
    }
    items.push({
      label: isLocallyMuted(uid) ? "Ouvir novamente" : "Silenciar para mim",
      icon: "🔕",
      hint: "só neste aparelho",
      onSelect: () => toggleLocalMute(uid),
    });
  }

  // Moderação (só em canais de servidor e com a permissão correspondente).
  const srv = serverOfVoiceChannel(user.voice_channel_id);
  if (srv) {
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
