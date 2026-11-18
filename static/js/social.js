// ============================================================================
// Sancord — Social (Fase 5)
//   Bloqueio, solicitações de mensagem, grupos privados, privacidade,
//   perfil completo (servidor) e denúncias.
// Toda regra é aplicada no servidor; aqui só exibimos o estado recebido.
// Depende de globais do app.js (state, sendWs, escapeHtml, renderAvatarInner...).
// ============================================================================

state.blockedList = state.blockedList || [];
state.messageRequests = state.messageRequests || [];
state.groupDms = state.groupDms || [];
state.pendingGroupOpen = null;
state.fullProfiles = new Map();

function myLowerName() {
  return (state.selfUser?.username || "").toLowerCase();
}

/** Recebe a parte social do FriendsSync. */
function applySocialSync(payload) {
  state.blockedList = payload.blocked || [];
  // O bloqueio agora é do servidor: a lista local antiga é substituída.
  state.blockedUsers = new Set(state.blockedList.map((u) => u.username.toLowerCase()));
  state.messageRequests = payload.message_requests || [];
  state.groupDms = payload.groups || [];

  const pill = document.getElementById("friends-requests-pill");
  if (pill) {
    pill.textContent = state.messageRequests.length;
    pill.classList.toggle("hidden", state.messageRequests.length === 0);
  }

  // Grupo que deixei/fui removido enquanto estava aberto.
  if (state.activeDmId?.startsWith("gdm:") && !findGroupDm(state.activeDmId)) {
    showUiToast("Você não participa mais deste grupo.");
    switchToHomeFriendsView();
  }
  if (state.pendingGroupOpen && findGroupDm(state.pendingGroupOpen)) {
    const gid = state.pendingGroupOpen;
    state.pendingGroupOpen = null;
    setTimeout(() => openGroupConversation(gid), 0);
  }
  renderPrivacySettings();
  renderMessageRequestBanner();
  if (state.activeDmId?.startsWith("gdm:")) {
    updateActiveGroupHeader();
  }
}

function isMessageRequest(channelId) {
  return (state.messageRequests || []).some((c) => c.dm_id === channelId);
}

function findPrivateConv(dmId) {
  if (!dmId) return null;
  return (
    (state.dmConversations || []).find((c) => c.dm_id === dmId) ||
    (state.messageRequests || []).find((c) => c.dm_id === dmId) ||
    null
  );
}

function findGroupDm(groupId) {
  return (state.groupDms || []).find((g) => g.id === groupId) || null;
}

function groupDisplayName(g) {
  if (!g) return "Grupo";
  if (g.name) return g.name;
  const me = myLowerName();
  const others = (g.members || []).filter((m) => m.username.toLowerCase() !== me);
  if (others.length === 0) return "Grupo vazio";
  return others.map((m) => m.display_name || m.username).join(", ");
}

/** Pessoas da conversa privada aberta (para @menções no composer). */
function privateConversationPeople(channelId) {
  if (channelId?.startsWith("gdm:")) {
    const me = myLowerName();
    return (findGroupDm(channelId)?.members || []).filter((m) => m.username.toLowerCase() !== me);
  }
  const conv = findPrivateConv(channelId);
  return conv ? [conv.peer] : [];
}

/** "🎮 Jogando" — respeita o prazo do status personalizado. */
function customStatusText(u) {
  if (!u?.custom_status) return "";
  if (u.custom_status_expires_at && u.custom_status_expires_at <= Date.now()) return "";
  return u.custom_status_emoji ? `${u.custom_status_emoji} ${u.custom_status}` : u.custom_status;
}

function avatarEl(user, size = 32) {
  const wrap = document.createElement("div");
  wrap.className = "avatar";
  wrap.style.cssText = `background:${user?.avatar_color || "#5865f2"};width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px;`;
  wrap.innerHTML = renderAvatarInner(user?.username || "?", user?.avatar_url);
  return wrap;
}

function groupIconEl(g, size = 32) {
  const el = document.createElement("div");
  el.className = "avatar group-dm-icon";
  el.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size / 2.4)}px;`;
  if (g?.icon_url) {
    const img = document.createElement("img");
    img.src = cachedMediaUrl(g.icon_url);
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";
    el.appendChild(img);
  } else {
    el.textContent = "👥";
  }
  return el;
}

// ---------------------------------------------------------------------------
// Lista lateral: solicitações e grupos
// ---------------------------------------------------------------------------

function buildMessageRequestsEntry() {
  const n = (state.messageRequests || []).length;
  if (n === 0) return null;
  const li = document.createElement("li");
  li.className = `dm-item dm-requests-entry${state.friendsTab === "requests" && !state.activeDmId && state.activeView === "home" ? " active" : ""}`;
  const left = document.createElement("div");
  left.className = "dm-item-left";
  const icon = document.createElement("div");
  icon.className = "avatar group-dm-icon";
  icon.style.cssText = "width:32px;height:32px;font-size:15px;";
  icon.textContent = "✉️";
  const meta = document.createElement("div");
  meta.className = "dm-item-meta";
  const name = document.createElement("div");
  name.className = "dm-item-name";
  name.textContent = "Solicitações de mensagem";
  const sub = document.createElement("div");
  sub.className = "dm-item-sub";
  sub.textContent = n === 1 ? "1 pessoa quer conversar" : `${n} pessoas querem conversar`;
  meta.append(name, sub);
  left.append(icon, meta);
  const badge = document.createElement("span");
  badge.className = "dm-count-badge";
  badge.textContent = n;
  li.append(left, badge);
  li.addEventListener("click", () => switchToHomeFriendsView("requests"));
  return li;
}

function buildGroupDmItem(g) {
  const unread = state.unreadDms.get(g.id) || 0;
  const isActive = state.activeView === "home" && state.activeDmId === g.id;
  const li = document.createElement("li");
  li.className = `dm-item ${isActive ? "active" : ""}`;
  const left = document.createElement("div");
  left.className = "dm-item-left";
  const meta = document.createElement("div");
  meta.className = "dm-item-meta";
  const name = document.createElement("div");
  name.className = "dm-item-name";
  name.textContent = groupDisplayName(g);
  const sub = document.createElement("div");
  sub.className = "dm-item-sub";
  const n = (g.members || []).length;
  sub.textContent = g.last_message || `${n} membro${n === 1 ? "" : "s"}`;
  meta.append(name, sub);
  left.append(groupIconEl(g), meta);
  li.appendChild(left);
  if (unread > 0) {
    const badge = document.createElement("span");
    badge.className = "dm-count-badge";
    badge.textContent = unread;
    li.appendChild(badge);
  }
  li.addEventListener("click", () => openGroupConversation(g.id));
  li.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    groupContextMenu(g, e.clientX, e.clientY);
  });
  return li;
}

function groupContextMenu(g, x, y) {
  const owner = g.owner === myLowerName();
  SancordUI.contextMenu(x, y, [
    { header: groupDisplayName(g) },
    { label: "Abrir", icon: "💬", onSelect: () => openGroupConversation(g.id) },
    { label: "Adicionar amigos", icon: "➕", onSelect: () => openAddGroupMembersDialog(g) },
    { label: "Editar grupo", icon: "✏️", onSelect: () => openEditGroupDialog(g) },
    { separator: true },
    { label: owner ? "Sair do grupo (posse passa a outro membro)" : "Sair do grupo", icon: "🚪", danger: true, onSelect: () => confirmLeaveGroup(g) },
  ]);
}

// ---------------------------------------------------------------------------
// Abas "Solicitações" e "Bloqueados" na tela de amigos
// ---------------------------------------------------------------------------

function socialRow(user, subText, actions) {
  const li = document.createElement("li");
  li.className = "friend-row social-row";
  const left = document.createElement("div");
  left.className = "friend-row-left";
  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "friend-row-name";
  name.textContent = user.display_name || user.username;
  const sub = document.createElement("div");
  sub.className = "friend-row-sub";
  sub.textContent = subText;
  info.append(name, sub);
  left.append(avatarEl(user, 38), info);
  const acts = document.createElement("div");
  acts.className = "friend-row-actions";
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = a.className || "btn-secondary small-btn";
    b.textContent = a.label;
    if (a.title) b.title = a.title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      a.onClick();
    });
    acts.appendChild(b);
  }
  li.append(left, acts);
  return li;
}

function renderSocialFriendsTab(tab, q) {
  const match = (u) =>
    !q || u.username.toLowerCase().includes(q) || (u.display_name || "").toLowerCase().includes(q);
  if (tab === "blocked") {
    const list = (state.blockedList || []).filter(match);
    if (friendsListCount) friendsListCount.textContent = `BLOQUEADOS — ${list.length}`;
    if (list.length === 0) {
      friendsItemsList.innerHTML = SancordUI.emptyHTML({icon:"shield",title:"Nenhuma pessoa bloqueada",description:"Pessoas que você bloquear aparecerão aqui."});
      return;
    }
    for (const u of list) {
      friendsItemsList.appendChild(
        socialRow(u, "Bloqueado — não pode te enviar mensagens, pedidos nem ligar", [
          { label: "Desbloquear", onClick: () => sendWs("UnblockUser", { target_username: u.username }) },
        ])
      );
    }
    return;
  }

  const list = (state.messageRequests || []).filter((c) => match(c.peer));
  if (friendsListCount) friendsListCount.textContent = `SOLICITAÇÕES DE MENSAGEM — ${list.length}`;
  if (list.length === 0) {
    friendsItemsList.innerHTML = SancordUI.emptyHTML({icon:"chat",title:"Nenhuma solicitação de mensagem",description:"Mensagens de quem não é seu amigo aparecem aqui antes de chegar às suas DMs."});
    return;
  }
  for (const c of list) {
    const row = socialRow(c.peer, c.last_message ? `“${c.last_message}”` : "Quer conversar com você", [
      { label: "Ver", onClick: () => sendWs("OpenDm", { target_username: c.peer.username }) },
      { label: "Aceitar", className: "btn-primary small-btn", onClick: () => sendWs("AcceptMessageRequest", { dm_id: c.dm_id }) },
      { label: "Ignorar", onClick: () => sendWs("IgnoreMessageRequest", { dm_id: c.dm_id }) },
      { label: "Bloquear", className: "btn-secondary small-btn danger-text", onClick: () => confirmBlockUser(c.peer.username) },
    ]);
    row.style.cursor = "pointer";
    row.addEventListener("click", () => sendWs("OpenDm", { target_username: c.peer.username }));
    friendsItemsList.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Faixa de solicitação dentro da DM
// ---------------------------------------------------------------------------

function renderMessageRequestBanner() {
  const form = document.getElementById("chat-form");
  if (!form) return;
  let banner = document.getElementById("dm-request-banner");
  const dmId = state.activeView === "home" ? state.activeDmId : null;
  const conv = dmId && isMessageRequest(dmId) ? findPrivateConv(dmId) : null;
  if (!conv) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "dm-request-banner";
    banner.className = "dm-request-banner";
    form.parentElement?.insertBefore(banner, form);
  }
  banner.innerHTML = "";
  const text = document.createElement("div");
  text.className = "dm-request-text";
  const strong = document.createElement("strong");
  strong.textContent = conv.peer.display_name || conv.peer.username;
  text.append(strong, document.createTextNode(" não é seu amigo. Aceite para mover a conversa para suas DMs e receber notificações — ou responda para aceitar."));
  const actions = document.createElement("div");
  actions.className = "dm-request-actions";
  const mk = (label, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", fn);
    actions.appendChild(b);
  };
  mk("Aceitar", "btn-primary small-btn", () => sendWs("AcceptMessageRequest", { dm_id: conv.dm_id }));
  mk("Ignorar", "btn-secondary small-btn", () => {
    sendWs("IgnoreMessageRequest", { dm_id: conv.dm_id });
    switchToHomeFriendsView("requests");
  });
  mk("Bloquear", "btn-secondary small-btn danger-text", () => confirmBlockUser(conv.peer.username));
  mk("Denunciar", "btn-secondary small-btn danger-text", () => openReportUserDialog(conv.peer.username));
  banner.append(text, actions);
}

// ---------------------------------------------------------------------------
// Grupos privados
// ---------------------------------------------------------------------------

function openGroupConversation(groupId) {
  if (!findGroupDm(groupId)) {
    // O FriendsSync com o grupo pode chegar logo depois.
    state.pendingGroupOpen = groupId;
    return;
  }
  openDmConversation(groupId);
}

function updateActiveGroupHeader() {
  const g = findGroupDm(state.activeDmId);
  if (!g) return;
  if (chatHeaderIcon) {
    chatHeaderIcon.innerHTML = "";
    chatHeaderIcon.appendChild(groupIconEl(g, 26));
  }
  currentTextChannelTitle.textContent = groupDisplayName(g);
  if (chatChannelTopic) {
    const online = (g.members || []).filter((m) => m.online).length;
    chatChannelTopic.textContent = `Grupo • ${g.members.length} membros • ${online} online`;
  }
  chatInput.placeholder = `Conversar em ${groupDisplayName(g)}`;
  renderGroupMembersPanel();
}

function renderGroupMembersPanel() {
  if (!dmPeerPanel) return;
  const g = findGroupDm(state.activeDmId);
  dmPeerPanel.innerHTML = "";
  if (!g) return;
  const me = myLowerName();
  const iOwn = g.owner === me;

  const head = document.createElement("div");
  head.className = "group-panel-head";
  const title = document.createElement("h3");
  title.textContent = groupDisplayName(g);
  head.append(groupIconEl(g, 56), title);
  dmPeerPanel.appendChild(head);

  const actions = document.createElement("div");
  actions.className = "group-panel-actions";
  const mk = (label, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", fn);
    actions.appendChild(b);
  };
  mk("➕ Adicionar amigos", "btn-primary small-btn", () => openAddGroupMembersDialog(g));
  mk("✏️ Editar grupo", "btn-secondary small-btn", () => openEditGroupDialog(g));
  mk("🚪 Sair do grupo", "btn-secondary small-btn danger-text", () => confirmLeaveGroup(g));
  dmPeerPanel.appendChild(actions);

  const label = document.createElement("div");
  label.className = "section-title";
  label.textContent = `MEMBROS — ${g.members.length}/10`;
  dmPeerPanel.appendChild(label);

  const ul = document.createElement("ul");
  ul.className = "group-member-list";
  for (const m of g.members) {
    const lower = m.username.toLowerCase();
    const li = document.createElement("li");
    li.className = "group-member-row";
    const wrap = document.createElement("div");
    wrap.className = "user-avatar-wrap";
    wrap.appendChild(avatarEl(m, 30));
    const dot = document.createElement("span");
    dot.className = `status-badge ${m.online ? m.status_kind || "online" : "invisible"}`;
    wrap.appendChild(dot);
    const name = document.createElement("span");
    name.className = "group-member-name";
    name.textContent = `${m.display_name || m.username}${lower === g.owner ? " 👑" : ""}${lower === me ? " (você)" : ""}`;
    li.append(wrap, name);
    li.addEventListener("click", () =>
      openMemberProfilePopover(m.live_id || null, { author_name: m.username, author_color: m.avatar_color, author_avatar: m.avatar_url })
    );
    if (iOwn && lower !== me) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "icon-btn danger";
      rm.title = `Remover ${m.username} do grupo`;
      rm.textContent = "✕";
      rm.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await SancordUI.confirm({
          title: "Remover do grupo?",
          message: `${m.display_name || m.username} deixará de ver as novas mensagens do grupo.`,
          confirmLabel: "Remover",
          danger: true,
        });
        if (ok) sendWs("RemoveGroupDmMember", { group_id: g.id, username: m.username });
      });
      li.appendChild(rm);
    }
    ul.appendChild(li);
  }
  dmPeerPanel.appendChild(ul);
}

function friendOptions(exclude = []) {
  const skip = new Set(exclude.map((u) => u.toLowerCase()));
  return (state.friends || [])
    .filter((f) => !skip.has(f.username.toLowerCase()))
    .map((f) => ({
      value: f.username.toLowerCase(),
      label: f.display_name ? `${f.display_name} (@${f.username})` : f.username,
      hint: f.online ? "online" : "offline",
    }));
}

async function openCreateGroupDialog(preselected = []) {
  const options = friendOptions();
  const values = await SancordUI.formDialog({
    title: "Criar grupo",
    description: "Escolha até 9 amigos. Grupos têm chat e chamada próprios.",
    submitLabel: "Criar grupo",
    fields: [
      { name: "name", label: "NOME DO GRUPO (OPCIONAL)", maxlength: 32, placeholder: "Ex: Turma do jogo" },
      {
        name: "members",
        label: "AMIGOS",
        type: "checklist",
        options,
        value: preselected,
        max: 9,
        required: true,
        emptyText: "Você ainda não tem amigos para adicionar a um grupo.",
      },
    ],
  });
  if (!values) return;
  if (values.members.length === 1 && !values.name.trim()) {
    // Um amigo só: abre a DM normal.
    sendWs("OpenDm", { target_username: values.members[0] });
    return;
  }
  sendWs("CreateGroupDm", { usernames: values.members, name: values.name.trim() || null });
}

async function openAddGroupMembersDialog(g) {
  const current = (g.members || []).map((m) => m.username);
  const free = 10 - current.length;
  if (free <= 0) {
    showUiToast("Este grupo já tem 10 pessoas (o máximo).");
    return;
  }
  const values = await SancordUI.formDialog({
    title: "Adicionar ao grupo",
    description: `Você pode adicionar mais ${free} pessoa${free === 1 ? "" : "s"}.`,
    submitLabel: "Adicionar",
    fields: [
      {
        name: "members",
        label: "AMIGOS",
        type: "checklist",
        options: friendOptions(current),
        max: free,
        required: true,
        emptyText: "Todos os seus amigos já estão neste grupo.",
      },
    ],
  });
  if (values?.members?.length) {
    sendWs("AddGroupDmMembers", { group_id: g.id, usernames: values.members });
  }
}

function resizeIconFile(file, size = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas
          .getContext("2d")
          .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function openEditGroupDialog(g) {
  const values = await SancordUI.formDialog({
    title: "Editar grupo",
    submitLabel: "Salvar",
    fields: [
      { name: "name", label: "NOME DO GRUPO", value: g.name || "", maxlength: 32, placeholder: groupDisplayName(g) },
      {
        name: "icon",
        label: "ÍCONE",
        type: "select",
        value: "keep",
        options: [
          { value: "keep", label: g.icon_url ? "Manter o ícone atual" : "Sem ícone" },
          { value: "upload", label: "Escolher imagem…" },
          ...(g.icon_url ? [{ value: "remove", label: "Remover ícone" }] : []),
        ],
      },
    ],
  });
  if (!values) return;
  const payload = { group_id: g.id, name: values.name, icon_url: null };
  if (values.icon === "remove") payload.icon_url = "";
  if (values.icon === "upload") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        payload.icon_url = await resizeIconFile(file);
        sendWs("UpdateGroupDm", payload);
      } catch (_) {
        showUiToast("Não foi possível ler esta imagem.");
      }
    });
    input.click();
    return;
  }
  sendWs("UpdateGroupDm", payload);
}

async function confirmLeaveGroup(g) {
  const ok = await SancordUI.confirm({
    title: `Sair de "${groupDisplayName(g)}"?`,
    message: "Você não verá mais as mensagens deste grupo, a menos que alguém te adicione de novo.",
    confirmLabel: "Sair do grupo",
    danger: true,
  });
  if (!ok) return;
  if (state.currentVoiceChannel === getDmVoiceIdFromDmId(g.id)) leaveVoiceChannel();
  sendWs("LeaveGroupDm", { group_id: g.id });
}

// ---------------------------------------------------------------------------
// Bloquear e denunciar
// ---------------------------------------------------------------------------

async function confirmBlockUser(username) {
  const ok = await SancordUI.confirm({
    title: `Bloquear ${username}?`,
    message:
      "A amizade e os pedidos pendentes serão desfeitos. Essa pessoa não poderá te enviar mensagens, pedidos de amizade nem te ligar, e as mensagens dela ficarão ocultas para você.",
    confirmLabel: "Bloquear",
    danger: true,
  });
  if (ok) sendWs("BlockUser", { target_username: username });
}

async function openReportUserDialog(username, messageId = null) {
  const values = await SancordUI.formDialog({
    title: `Denunciar ${username}`,
    description: "A denúncia fica registrada no servidor para análise da moderação.",
    submitLabel: "Enviar denúncia",
    danger: true,
    fields: [
      {
        name: "kind",
        label: "MOTIVO",
        type: "select",
        value: "Spam ou golpe",
        options: [
          { value: "Spam ou golpe", label: "Spam ou golpe" },
          { value: "Assédio ou ameaça", label: "Assédio ou ameaça" },
          { value: "Conteúdo impróprio", label: "Conteúdo impróprio" },
          { value: "Conta falsa / se passando por alguém", label: "Conta falsa / se passando por alguém" },
          { value: "Outro", label: "Outro" },
        ],
      },
      { name: "details", label: "DETALHES (OPCIONAL)", type: "textarea", maxlength: 400, rows: 3 },
    ],
  });
  if (!values) return;
  const reason = [values.kind, values.details.trim()].filter(Boolean).join(" — ");
  sendWs("ReportUser", { username, reason, message_id: messageId });
}

// ---------------------------------------------------------------------------
// Perfil completo (vem do servidor)
// ---------------------------------------------------------------------------

function requestFullProfile(username) {
  if (!username || username === "Sancord Bot") return;
  const srv = state.activeView === "server" ? getActiveServer() : null;
  sendWs("GetUserProfile", { username, server_id: srv && srv.id !== "sancord" ? srv.id : null });
}

function formatProfileDate(ms) {
  try {
    return new Date(ms).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
  } catch (_) {
    return "";
  }
}

function onUserProfile(p) {
  const u = p.user;
  if (!u) return;
  state.fullProfiles.set(u.username.toLowerCase(), p);
  // Só atualiza o cartão se ele ainda mostra esta pessoa.
  if ((currentPopoverUsername || "").toLowerCase() !== u.username.toLowerCase()) return;

  if (profileCardMemberSince) {
    const parts = [`Sancord: ${u.created_at || "—"}`];
    if (p.joined_server_at) {
      const srv = state.servers.find((s) => s.id === p.server_id);
      parts.push(`${srv?.name || "Servidor"}: ${formatProfileDate(p.joined_server_at)}`);
    }
    profileCardMemberSince.textContent = parts.join(" • ");
  }
  if (profileCardName && u.display_name) profileCardName.textContent = u.display_name;
  const moreBlockLabel = document.getElementById("profile-more-block-label");
  if (moreBlockLabel) moreBlockLabel.textContent = p.relationship === "blocked" ? "Desbloquear" : "Bloquear";
  if (profileCardActions && p.relationship === "blocked") {
    profileCardFriendBtn && (profileCardFriendBtn.disabled = true);
  }

  // Amigos em comum (calculado no servidor).
  const friends = p.mutual_friends || [];
  if (profileMutualFriendsLabel) {
    profileMutualFriendsLabel.textContent = friends.length === 1 ? "1 amigo em comum" : `${friends.length} amigos em comum`;
  }
  if (profileMutualFriendsList) {
    profileMutualFriendsList.innerHTML = "";
    if (friends.length === 0) {
      profileMutualFriendsList.innerHTML = `<div class="pinned-empty">Nenhum amigo em comum.</div>`;
    }
    for (const f of friends) {
      const row = document.createElement("div");
      row.className = "profile-mutual-row";
      const left = document.createElement("div");
      left.className = "profile-mutual-row-left";
      const info = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = f.display_name || f.username;
      const sub = document.createElement("div");
      sub.className = "profile-mutual-sub";
      sub.textContent = f.online ? "Online" : "Offline";
      info.append(strong, sub);
      left.append(avatarEl(f, 32), info);
      row.appendChild(left);
      row.addEventListener("click", () =>
        openMemberProfilePopover(f.live_id || null, { author_name: f.username, author_color: f.avatar_color, author_avatar: f.avatar_url })
      );
      profileMutualFriendsList.appendChild(row);
    }
  }

  // Servidores em comum (sem o hub público).
  const servers = p.mutual_servers || [];
  if (profileMutualServersLabel) {
    profileMutualServersLabel.textContent = servers.length === 1 ? "1 servidor em comum" : `${servers.length} servidores em comum`;
  }
  if (profileMutualServersList) {
    profileMutualServersList.innerHTML = "";
    if (servers.length === 0) {
      profileMutualServersList.innerHTML = `<div class="pinned-empty">Nenhum servidor em comum.</div>`;
    }
    for (const s of servers) {
      const row = document.createElement("div");
      row.className = "profile-mutual-row";
      const left = document.createElement("div");
      left.className = "profile-mutual-row-left";
      const icon = document.createElement("div");
      icon.className = "avatar small-avatar";
      icon.style.cssText = `background:${s.icon_color || "#5865f2"};border-radius:12px;`;
      if (s.icon_url) {
        const img = document.createElement("img");
        img.src = cachedMediaUrl(s.icon_url);
        img.alt = "";
        img.style.cssText = "width:100%;height:100%;object-fit:cover;";
        icon.appendChild(img);
      } else {
        icon.textContent = (s.name || "S").slice(0, 2).toUpperCase();
      }
      const strong = document.createElement("strong");
      strong.textContent = s.name;
      left.append(icon, strong);
      row.appendChild(left);
      row.addEventListener("click", () => {
        profilePopoverModal?.classList.add("hidden");
        switchToServerId(s.id);
      });
      profileMutualServersList.appendChild(row);
    }
  }
}

// ---------------------------------------------------------------------------
// Editor de perfil: nome de exibição, pronomes, emoji e prazo do status
// ---------------------------------------------------------------------------

function fillSocialProfileFields(u) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };
  set("settings-display-name", u.display_name);
  set("settings-pronouns", u.pronouns);
  set("settings-status-emoji", u.custom_status_emoji);
  const exp = document.getElementById("settings-status-expiry");
  if (exp) exp.value = u.custom_status_expires_at ? "keep" : "0";
}

function collectSocialProfileFields() {
  const val = (id) => document.getElementById(id)?.value ?? "";
  const out = {
    display_name: val("settings-display-name").trim(),
    pronouns: val("settings-pronouns").trim(),
    custom_status_emoji: val("settings-status-emoji").trim(),
  };
  const exp = val("settings-status-expiry");
  if (exp && exp !== "keep") out.custom_status_expires_in = Number(exp) || 0;
  return out;
}

// ---------------------------------------------------------------------------
// Configurações → Dados e privacidade (aplicado no servidor)
// ---------------------------------------------------------------------------

function renderPrivacySettings() {
  const privacy = state.prefs?.privacy || { dm_policy: "requests", friend_requests: "everyone" };
  const dm = document.getElementById("privacy-dm-policy");
  const fr = document.getElementById("privacy-friend-requests");
  if (dm && document.activeElement !== dm) dm.value = privacy.dm_policy || "requests";
  if (fr && document.activeElement !== fr) fr.value = privacy.friend_requests || "everyone";

  const ul = document.getElementById("privacy-blocked-list");
  if (!ul) return;
  ul.innerHTML = "";
  if ((state.blockedList || []).length === 0) {
    ul.innerHTML = `<div class="settings-hint-text">Ninguém bloqueado.</div>`;
    return;
  }
  for (const u of state.blockedList) {
    ul.appendChild(
      socialRow(u, "Bloqueado", [
        { label: "Desbloquear", onClick: () => sendWs("UnblockUser", { target_username: u.username }) },
      ])
    );
  }
}

function savePrivacySettings() {
  const privacy = {
    dm_policy: document.getElementById("privacy-dm-policy")?.value || "requests",
    friend_requests: document.getElementById("privacy-friend-requests")?.value || "everyone",
  };
  sendWs("UpdateUserPrefs", { privacy });
  const fb = document.getElementById("privacy-feedback");
  if (fb) fb.textContent = "✓ Privacidade salva no servidor.";
}

document.getElementById("privacy-dm-policy")?.addEventListener("change", savePrivacySettings);
document.getElementById("privacy-friend-requests")?.addEventListener("change", savePrivacySettings);
