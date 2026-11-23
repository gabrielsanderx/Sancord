// Fase 4: o backend calcula acesso; o cliente apenas apresenta o resultado.
const CHANNEL_PERMISSION_LABELS = {
  view_channel: "Visualizar canal", read_history: "Visualizar histórico",
  send_messages: "Enviar mensagens", attach_files: "Anexar arquivos",
  add_reactions: "Adicionar reações", manage_messages: "Gerenciar mensagens", pin_messages: "Fixar mensagens",
  mention_everyone: "Mencionar todos", create_invites: "Criar convites", connect_voice: "Conectar à voz",
  speak_voice: "Falar na voz", stream_video: "Transmitir tela e câmera",
};

function getChannelPermissions(srv, ch) {
  if (ch?.effective_permissions) return ch.effective_permissions;
  if (!ch) return {};
  return { view_channel: true, read_history: true, add_reactions: true, pin_messages: true, ...getServerPermissionsFor(srv, state.selfUser?.username) };
}

/** Conversa privada de texto: DM 1:1 (`dm:`) ou grupo (`gdm:`). */
function isPrivateTextId(id) {
  return typeof id === "string" && (id.startsWith("dm:") || id.startsWith("gdm:"));
}

/** Chamada privada: DM 1:1 (`dmvoice:`) ou grupo (`gdmvoice:`). */
function isPrivateVoiceId(id) {
  return typeof id === "string" && (id.startsWith("dmvoice:") || id.startsWith("gdmvoice:"));
}

function voicePermissions() {
  const id = state.currentVoiceChannel;
  if (isPrivateVoiceId(id)) return { view_channel: true, connect_voice: true, speak_voice: true, stream_video: true };
  const srv = (state.servers || []).find(s => s.voice_channels?.some(c => c.id === id));
  return getChannelPermissions(srv, srv?.voice_channels.find(c => c.id === id));
}

function messagePermissions(message) {
  if (isPrivateTextId(message.channel_id)) return { send_messages: true, add_reactions: true, pin_messages: true, attach_files: true };
  // Mensagem de thread: vale o canal-pai (como no servidor).
  const channelId = state.threadIndex?.get(message.channel_id)?.parent_id || message.channel_id;
  const srv = state.servers.find(s => s.text_channels?.some(c => c.id === channelId) || s.voice_channels?.some(c => c.id === channelId));
  const ch = srv?.text_channels?.find(c => c.id === channelId) || srv?.voice_channels?.find(c => c.id === channelId);
  return getChannelPermissions(srv, ch);
}

function canEditRole(srv, role) {
  const lower = state.selfUser?.username?.toLowerCase();
  const mine = getServerPermissionsFor(srv, lower);
  if (isServerOwner(srv, lower)) return true;
  if (!(mine.manage_roles || mine.administrator)) return false;
  const high = Math.max(0, ...getUserServerRoles(srv, lower).map(r => r.position || 0));
  return role.id === "everyone" || role.position < high;
}

function canAssignRole(srv, role, target) {
  const lower = state.selfUser?.username?.toLowerCase();
  if (isServerOwner(srv, lower)) return true;
  if (!canEditRole(srv, role) || target === lower || target === srv.owner_username) return false;
  const mine = getServerPermissionsFor(srv, lower);
  const high = Math.max(0, ...getUserServerRoles(srv, lower).map(r => r.position || 0));
  const targetHigh = Math.max(0, ...getUserServerRoles(srv, target).map(r => r.position || 0));
  return targetHigh < high && (mine.administrator || Object.entries(role.permissions || {}).every(([key, value]) => !value || mine[key]));
}

async function openPermissionsDialog(srv, target, isCategory = false) {
  const live = state.servers.find(s => s.id === srv.id);
  if (!live) return;
  const item = isCategory ? live.categories?.find(c => c.id === target.id)
    : [...(live.text_channels || []), ...(live.voice_channels || [])].find(c => c.id === target.id);
  if (!item) return;
  const options = [
    ...(live.roles || []).map(r => ({ value: `role:${r.id}`, label: `Cargo: ${r.name}` })),
    ...[...new Set([...(live.members || []), live.owner_username].filter(Boolean))].map(m => ({ value: `member:${m}`, label: `Membro: ${m}` })),
  ];
  const canSync = !isCategory && item.category_id;
  const selection = await SancordUI.formDialog({
    title: `Permissões — ${item.name}`,
    description: "Herdar mantém a decisão do servidor/categoria. Negar visualização torna o canal privado para o alvo. Proprietário e administradores mantêm acesso.",
    fields: [
      canSync && { name: "mode", label: "PERMISSÕES DO CANAL", type: "select", value: item.permissions_synced ? "sync" : "custom", options: [
        { value: "sync", label: "Sincronizar com a categoria" }, { value: "custom", label: "Personalizar exceções deste canal" },
      ] },
      { name: "target", label: "CARGO OU MEMBRO", type: "select", value: "role:everyone", options,
        visibleWhen: v => v.mode !== "sync" },
    ].filter(Boolean),
    submitLabel: "Continuar",
  });
  if (!selection) return;
  if (selection.mode === "sync") {
    const ok = await SancordUI.confirm({ title: "Sincronizar permissões?", message: "As exceções próprias deste canal serão removidas e ele seguirá a categoria.", confirmLabel: "Sincronizar" });
    if (ok) sendWs("UpdateChannelPermissions", { server_id: srv.id, channel_id: item.id, sync_category: true, overwrites: [] });
    return;
  }
  const separator = selection.target.indexOf(":");
  const target_type = selection.target.slice(0, separator);
  const target_id = selection.target.slice(separator + 1);
  const old = (item.permission_overwrites || []).find(r => r.target_type === target_type && r.target_id === target_id)?.permissions || {};
  const values = await SancordUI.formDialog({
    title: `Permissões — ${options.find(o => o.value === selection.target)?.label || target_id}`,
    description: `${item.name}: as alterações se aplicam imediatamente a todos os dispositivos. ${canSync ? "Herdar usa a categoria e o servidor." : "Herdar usa as permissões dos cargos no servidor."}`,
    fields: Object.entries(CHANNEL_PERMISSION_LABELS).map(([key, label]) => ({
      name: key, label, type: "select", value: old[key] === undefined ? "inherit" : old[key] ? "allow" : "deny",
      options: [{ value: "inherit", label: "Herdar" }, { value: "allow", label: "Permitir" }, { value: "deny", label: "Negar" }],
    })),
    submitLabel: "Salvar permissões",
  });
  if (!values) return;
  // Preserva exceções de outros alvos recebidas enquanto o diálogo estava aberto.
  const latest = state.servers.find(s => s.id === srv.id);
  const current = isCategory ? latest?.categories?.find(c => c.id === item.id)
    : [...(latest?.text_channels || []), ...(latest?.voice_channels || [])].find(c => c.id === item.id);
  if (!current) return;
  const overwrites = (current.permission_overwrites || []).filter(r => !(r.target_type === target_type && r.target_id === target_id));
  const permissions = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "inherit").map(([key, value]) => [key, value === "allow"]));
  if (Object.keys(permissions).length) overwrites.push({ target_type, target_id, permissions });
  sendWs(isCategory ? "UpdateCategoryPermissions" : "UpdateChannelPermissions", {
    server_id: srv.id, ...(isCategory ? { category_id: item.id } : { channel_id: item.id, sync_category: false }), overwrites,
  });
}

function reconcileServerAccess(previous, server) {
  const allowed = new Map([...(server.text_channels || []), ...(server.voice_channels || [])].map(c => [c.id, c]));
  for (const ch of [...(previous?.text_channels || []), ...(previous?.voice_channels || [])]) {
    const current = allowed.get(ch.id);
    if (!current || current.effective_permissions?.read_history === false) {
      delete state.chatHistory[ch.id];
      state.historyState?.delete(ch.id);
      state.readStates?.delete(ch.id);
      state.unreadDividerByChannel?.delete(ch.id);
      if (state.pendingJump?.channelId === ch.id) state.pendingJump = null;
      if (ch.id === getActiveTextChannelId()) chatMessagesEl?.replaceChildren();
      if (state.replyingTo?.channel_id === ch.id) clearReplyingTo();
      pinnedPopover?.classList.add("hidden");
    }
  }
  if (state.currentVoiceChannel && previous?.voice_channels?.some(c => c.id === state.currentVoiceChannel)) {
    const ch = allowed.get(state.currentVoiceChannel);
    const p = ch?.effective_permissions || {};
    if (!ch || !p.connect_voice) leaveVoiceChannel();
    else {
      if (!p.speak_voice) {
        for (const track of state.localAudioStream?.getAudioTracks() || []) track.enabled = false;
      }
      if (!p.stream_video) { stopCamera(); stopScreenSharing(); }
    }
  }
  refreshUnreadIndicators();
}
