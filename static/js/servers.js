// ============================================================================
// Sancord — Servidores, categorias, canais, barra de servidores e convites
// Usa o estado global e helpers definidos em app.js (state, sendWs, ...) apenas
// em tempo de execução; este arquivo só define funções e listeners.
// ============================================================================

const CHANNEL_KIND_ICONS = {
  // Megafone: ícone próprio do canal de anúncios (texto e voz usam SVG_ICONS do app.js).
  announcement: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z"/></svg>`,
};

function channelIconSvg(kind) {
  if (kind === "announcement") return CHANNEL_KIND_ICONS.announcement;
  if (kind === "voice") return SVG_ICONS.speaker;
  return SVG_ICONS.hash;
}

const KIND_LABELS = { text: "Texto", voice: "Voz", announcement: "Anúncios" };

// ---------------------------------------------------------------------------
// Preferências sincronizadas (barra de servidores, pastas, silenciados)
// ---------------------------------------------------------------------------
function getPrefs() {
  if (!state.prefs) state.prefs = { guild_layout: [], muted_servers: [], collapsed_categories: [] };
  return state.prefs;
}

function updatePrefs(partial) {
  Object.assign(getPrefs(), partial);
  sendWs("UpdateUserPrefs", partial);
}

function onUserPrefsUpdated(payload) {
  state.prefs = payload?.prefs || state.prefs;
  renderGuildRailV2();
  renderChannelTree();
}

function isServerMuted(serverId) {
  return getPrefs().muted_servers.includes(serverId);
}

function toggleServerMuted(srv) {
  const muted = new Set(getPrefs().muted_servers);
  if (muted.has(srv.id)) muted.delete(srv.id);
  else muted.add(srv.id);
  updatePrefs({ muted_servers: [...muted] });
  showUiToast(muted.has(srv.id) ? `${srv.name} silenciado.` : `Notificações de ${srv.name} reativadas.`);
  renderGuildRailV2();
}

function myPerms(srv) {
  return getServerPermissionsFor(srv, state.selfUser?.username);
}

function canPostIn(srv, ch) {
  const p = getChannelPermissions(srv, ch);
  if (!ch || p.view_channel === false || !p.send_messages) return false;
  if (ch?.kind === "announcement") return Boolean(p.manage_messages || p.administrator);
  return true;
}

// ---------------------------------------------------------------------------
// Estrutura de categorias e canais
// ---------------------------------------------------------------------------
const byPosition = (a, b) => (a.position || 0) - (b.position || 0);

/** Grupos na ordem de exibição: sem categoria primeiro, depois as categorias. */
function channelGroups(srv) {
  const all = [...(srv?.text_channels || []), ...(srv?.voice_channels || [])];
  const cats = [...(srv?.categories || [])].sort(byPosition);
  const known = new Set(cats.map((c) => c.id));
  const order = (list) => [
    ...list.filter((c) => c.kind !== "voice").sort(byPosition),
    ...list.filter((c) => c.kind === "voice").sort(byPosition),
  ];
  const groups = [];
  const loose = all.filter((c) => !c.category_id || !known.has(c.category_id));
  if (loose.length) groups.push({ category: null, channels: order(loose) });
  for (const cat of cats) {
    groups.push({ category: cat, channels: order(all.filter((c) => c.category_id === cat.id)) });
  }
  return groups;
}

/** Primeiro canal de texto na ordem exibida (prefere texto comum a anúncios). */
function firstTextChannelId(srv) {
  const ordered = channelGroups(srv).flatMap((g) => g.channels).filter((c) => c.kind !== "voice");
  return (ordered.find((c) => c.kind === "text") || ordered[0])?.id || null;
}

function findChannel(srv, id) {
  return [...(srv?.text_channels || []), ...(srv?.voice_channels || [])].find((c) => c.id === id);
}

/** Envia a nova ordem e aplica localmente (o servidor confirma com ServerUpdated). */
function commitLayout(srv, groups, { categoriesOnly = false } = {}) {
  const categories = groups.filter((g) => g.category).map((g) => g.category.id);
  const placements = [];
  for (const g of groups) {
    g.channels.forEach((ch, i) => {
      ch.category_id = g.category ? g.category.id : null;
      ch.position = i;
      placements.push({ id: ch.id, category_id: ch.category_id });
    });
  }
  (srv.categories || []).forEach((c) => {
    const idx = categories.indexOf(c.id);
    if (idx >= 0) c.position = idx;
  });
  sendWs("ReorderServerLayout", {
    server_id: srv.id,
    categories,
    channels: categoriesOnly ? [] : placements,
  });
  renderChannelTree();
}

/** Move um canal: { beforeId } | { afterId } | { intoCategory: id|null } */
function moveChannel(srv, channelId, target) {
  const groups = channelGroups(srv);
  let dragged = null;
  for (const g of groups) {
    const i = g.channels.findIndex((c) => c.id === channelId);
    if (i >= 0) dragged = g.channels.splice(i, 1)[0];
  }
  if (!dragged) return;
  if ("intoCategory" in target) {
    let g = groups.find((x) => (x.category?.id || null) === target.intoCategory);
    if (!g) {
      g = { category: null, channels: [] };
      groups.unshift(g);
    }
    g.channels.push(dragged);
  } else {
    const refId = target.beforeId || target.afterId;
    const g = groups.find((x) => x.channels.some((c) => c.id === refId));
    if (!g) return;
    const idx = g.channels.findIndex((c) => c.id === refId);
    g.channels.splice(target.beforeId ? idx : idx + 1, 0, dragged);
  }
  commitLayout(srv, groups);
}

function moveChannelStep(srv, ch, delta) {
  const g = channelGroups(srv).find((x) => x.channels.some((c) => c.id === ch.id));
  if (!g) return;
  const same = g.channels.filter((c) => (c.kind === "voice") === (ch.kind === "voice"));
  const i = same.findIndex((c) => c.id === ch.id);
  const neighbor = same[i + delta];
  if (!neighbor) return;
  moveChannel(srv, ch.id, delta < 0 ? { beforeId: neighbor.id } : { afterId: neighbor.id });
}

function moveCategory(srv, categoryId, target) {
  const groups = channelGroups(srv);
  const loose = groups.filter((g) => !g.category);
  const cats = groups.filter((g) => g.category);
  const from = cats.findIndex((g) => g.category.id === categoryId);
  if (from < 0) return;
  const [moved] = cats.splice(from, 1);
  const refId = target.beforeId || target.afterId;
  let idx = cats.findIndex((g) => g.category.id === refId);
  if (idx < 0) idx = cats.length;
  else if (target.afterId) idx += 1;
  cats.splice(idx, 0, moved);
  commitLayout(srv, [...loose, ...cats], { categoriesOnly: true });
}

// ---------------------------------------------------------------------------
// Renderização da árvore de canais
// ---------------------------------------------------------------------------
let channelDrag = null; // { type: "channel" | "category", id }

function clearDropMarks(root = document) {
  root.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((el) => {
    el.classList.remove("drop-before", "drop-after", "drop-into");
  });
}

function renderChannelTree() {
  const tree = document.getElementById("channel-tree");
  if (!tree) return;
  const srv = getActiveServer();
  tree.innerHTML = "";
  if (!srv) return;
  const perms = myPerms(srv);
  const canManage = Boolean(perms.manage_channels);
  const collapsed = new Set(getPrefs().collapsed_categories);

  for (const group of channelGroups(srv)) {
    const section = document.createElement("div");
    section.className = "channel-group";
    if (group.category) {
      const cat = group.category;
      const isCollapsed = collapsed.has(cat.id);
      section.classList.toggle("collapsed", isCollapsed);
      section.appendChild(buildCategoryHeader(srv, cat, isCollapsed, canManage));
    }
    const list = document.createElement("ul");
    list.className = "channel-list";
    list.setAttribute("role", "group");
    for (const ch of group.channels) {
      const isActive = ch.id === state.currentTextChannel || ch.id === state.currentVoiceChannel;
      const hasVoiceMembers = ch.kind === "voice" && (state.voiceMembers?.[ch.id] || []).length > 0;
      // Categoria recolhida ainda mostra o canal ativo e salas de voz ocupadas.
      if (group.category && collapsed.has(group.category.id) && !isActive && !hasVoiceMembers) continue;
      list.appendChild(ch.kind === "voice" ? buildVoiceChannelNode(srv, ch, canManage) : buildTextChannelRow(srv, ch, canManage));
    }
    section.appendChild(list);
    tree.appendChild(section);
  }

  if (canManage && (srv.text_channels || []).length + (srv.voice_channels || []).length === 0) {
    const empty = document.createElement("div");
    empty.className = "pinned-empty";
    empty.textContent = "Nenhum canal ainda.";
    tree.appendChild(empty);
  }
}

function buildCategoryHeader(srv, cat, isCollapsed, canManage) {
  const head = document.createElement("div");
  head.className = "category-header";
  head.dataset.categoryId = cat.id;
  head.setAttribute("role", "treeitem");
  head.setAttribute("aria-expanded", String(!isCollapsed));
  head.tabIndex = 0;

  const toggle = document.createElement("span");
  toggle.className = "category-toggle";
  toggle.innerHTML = `<svg class="category-caret" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>`;
  const name = document.createElement("span");
  name.className = "category-name";
  name.textContent = cat.name;
  toggle.appendChild(name);
  head.appendChild(toggle);

  if (canManage) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-channel-btn category-add-btn";
    add.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
    SancordUI.tooltip(add, `Criar canal em ${cat.name}`, "top");
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      openCreateChannelDialog({ categoryId: cat.id });
    });
    head.appendChild(add);
  }

  const toggleCollapse = () => {
    const set = new Set(getPrefs().collapsed_categories);
    if (set.has(cat.id)) set.delete(cat.id);
    else set.add(cat.id);
    updatePrefs({ collapsed_categories: [...set] });
    renderChannelTree();
  };
  head.addEventListener("click", toggleCollapse);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleCollapse();
    }
  });
  head.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openCategoryMenu(e, srv, cat, isCollapsed);
  });

  if (canManage) {
    head.draggable = true;
    head.addEventListener("dragstart", (e) => {
      channelDrag = { type: "category", id: cat.id };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", cat.id);
      head.classList.add("is-dragging");
    });
    head.addEventListener("dragend", () => {
      channelDrag = null;
      head.classList.remove("is-dragging");
      clearDropMarks();
    });
    head.addEventListener("dragover", (e) => {
      if (!channelDrag || channelDrag.id === cat.id) return;
      e.preventDefault();
      clearDropMarks();
      if (channelDrag.type === "channel") {
        head.classList.add("drop-into");
      } else {
        const r = head.getBoundingClientRect();
        head.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
      }
    });
    head.addEventListener("dragleave", () => head.classList.remove("drop-before", "drop-after", "drop-into"));
    head.addEventListener("drop", (e) => {
      if (!channelDrag) return;
      e.preventDefault();
      const r = head.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      const drag = channelDrag;
      clearDropMarks();
      if (drag.type === "channel") moveChannel(srv, drag.id, { intoCategory: cat.id });
      else moveCategory(srv, drag.id, before ? { beforeId: cat.id } : { afterId: cat.id });
    });
  }
  return head;
}

function attachChannelDnD(el, srv, ch) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    channelDrag = { type: "channel", id: ch.id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ch.id);
    el.classList.add("is-dragging");
  });
  el.addEventListener("dragend", () => {
    channelDrag = null;
    el.classList.remove("is-dragging");
    clearDropMarks();
  });
  el.addEventListener("dragover", (e) => {
    if (channelDrag?.type !== "channel" || channelDrag.id === ch.id) return;
    e.preventDefault();
    clearDropMarks();
    const r = el.getBoundingClientRect();
    el.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
  el.addEventListener("drop", (e) => {
    if (channelDrag?.type !== "channel") return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    const id = channelDrag.id;
    clearDropMarks();
    moveChannel(srv, id, before ? { beforeId: ch.id } : { afterId: ch.id });
  });
}

function buildChannelLabel(ch) {
  const left = document.createElement("span");
  left.className = "channel-item-left";
  const icon = document.createElement("span");
  icon.className = "channel-svg-icon";
  icon.innerHTML = channelIconSvg(ch.kind);
  const name = document.createElement("span");
  name.className = "channel-name";
  name.textContent = ch.name;
  left.append(icon, name);
  return left;
}

function buildEditButton(srv, ch) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "channel-del-btn channel-edit-btn";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.92 2h-3.84a.5.5 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.73 8.47a.5.5 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>`;
  SancordUI.tooltip(btn, "Editar canal", "top");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditChannelDialog(srv, ch);
  });
  return btn;
}

function buildTextChannelRow(srv, ch, canManage) {
  const li = document.createElement("li");
  li.className = `channel-item ${ch.id === state.currentTextChannel ? "active" : ""} kind-${ch.kind}`;
  li.dataset.channelId = ch.id;
  li.setAttribute("role", "treeitem");
  li.tabIndex = 0;
  if (ch.id === state.currentTextChannel) li.setAttribute("aria-current", "page");
  li.appendChild(buildChannelLabel(ch));
  if (ch.topic) li.title = ch.topic;
  // Não lidas (negrito + marcador) e menções (contador vermelho).
  const unread = typeof channelUnreadInfo === "function" ? channelUnreadInfo(ch.id) : { unread: false, mentions: 0 };
  if (unread.unread && ch.id !== state.currentTextChannel) li.classList.add("unread");
  if (unread.mentions > 0) {
    const badge = document.createElement("span");
    badge.className = "mention-badge";
    badge.textContent = unread.mentions > 99 ? "99+" : unread.mentions;
    badge.setAttribute("aria-label", `${unread.mentions} menções`);
    li.appendChild(badge);
  }
  if (canManage) li.appendChild(buildEditButton(srv, ch));
  const open = () => {
    state.currentTextChannel = ch.id;
    switchToServerView();
  };
  li.addEventListener("click", open);
  li.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });
  li.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openChannelMenu(e, srv, ch);
  });
  if (canManage) attachChannelDnD(li, srv, ch);
  return li;
}

function buildVoiceChannelNode(srv, ch, canManage) {
  const wrapper = document.createElement("li");
  wrapper.className = "voice-channel-node";
  wrapper.setAttribute("role", "treeitem");

  const row = document.createElement("div");
  row.className = `channel-item ${ch.id === state.currentVoiceChannel ? "active" : ""} kind-voice`;
  row.dataset.channelId = ch.id;
  row.tabIndex = 0;
  row.appendChild(buildChannelLabel(ch));
  if (ch.user_limit > 0) {
    const count = document.createElement("span");
    count.className = "voice-limit-pill";
    const n = (state.voiceMembers?.[ch.id] || []).length;
    count.textContent = `${String(n).padStart(2, "0")}/${String(ch.user_limit).padStart(2, "0")}`;
    count.title = `Limite de ${ch.user_limit} pessoa(s)`;
    row.appendChild(count);
  }
  if (canManage) row.appendChild(buildEditButton(srv, ch));
  row.addEventListener("click", () => joinVoiceChannel(ch.id));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinVoiceChannel(ch.id);
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openChannelMenu(e, srv, ch);
  });
  if (canManage) attachChannelDnD(row, srv, ch);
  wrapper.appendChild(row);

  const memberIds = state.voiceMembers?.[ch.id] || [];
  if (memberIds.length > 0) {
    const subList = document.createElement("ul");
    subList.className = "voice-Nested-members";
    for (const uid of memberIds) {
      const u = state.users.get(uid);
      if (!u) continue;
      const memberLi = document.createElement("li");
      memberLi.className = "voice-member-row";
      const isSpeaking = state.speakingUsers?.has(u.id);
      memberLi.innerHTML = `
        <div class="voice-member-left">
          <div class="avatar-small ${isSpeaking ? "speaking" : ""}" data-speaking-user="${escapeHtml(u.id)}" style="background: ${escapeHtml(u.avatar_color)}">
            ${renderAvatarInner(u.username, u.avatar_url)}
          </div>
          <span>${escapeHtml(u.username)}</span>
        </div>
        <div class="voice-badges">
          ${u.camera_on ? `<span class="cam-badge">CÂM</span>` : ""}
          ${u.screen_sharing ? `<span class="live-badge">AO VIVO</span>` : ""}
          ${u.server_muted ? `<span class="server-mod-badge" title="Silenciado pelo servidor">${SVG_ICONS.micOffTiny}</span>` : u.muted ? `<span title="Mutado">${SVG_ICONS.micOffTiny}</span>` : ""}
          ${u.server_deafened ? `<span class="server-mod-badge" title="Ensurdecido pelo servidor">${SVG_ICONS.headOffTiny}</span>` : u.deafened ? `<span title="Áudio desativado">${SVG_ICONS.headOffTiny}</span>` : ""}
          ${isLocallyMuted(u.id) ? `<span title="Silenciado só para você">🔕</span>` : ""}
        </div>
      `;
      memberLi.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openVoiceUserMenu(e, u.id);
      });
      subList.appendChild(memberLi);
    }
    wrapper.appendChild(subList);
  }
  return wrapper;
}

// ---------------------------------------------------------------------------
// Menus de contexto
// ---------------------------------------------------------------------------
async function channelLink(srv, ch) {
  const origin = await resolvePublicOriginUrl();
  return SancordNet.link({ server: srv.id, channel: ch.id }, origin);
}

function openChannelMenu(e, srv, ch) {
  const perms = myPerms(srv);
  const isVoice = ch.kind === "voice";
  const inVoice = state.currentVoiceChannel === ch.id;
  SancordUI.contextMenu(e.clientX, e.clientY, [
    isVoice
      ? { label: inVoice ? "Sair da chamada" : "Entrar no canal de voz", icon: "🔊", onSelect: () => (inVoice ? leaveVoiceChannel() : joinVoiceChannel(ch.id)) }
      : { label: "Abrir canal", icon: "#", onSelect: () => { state.currentTextChannel = ch.id; switchToServerView(); } },
    !isVoice && {
      label: "Marcar como lido",
      icon: "✔️",
      disabled: !channelUnreadInfo(ch.id).unread && !channelUnreadInfo(ch.id).mentions,
      onSelect: () => {
        const list = state.chatHistory?.[ch.id] || [];
        const last = list[list.length - 1];
        if (last) sendWs("AckChannel", { channel_id: ch.id, message_id: last.id });
      },
    },
    { label: "Copiar link do canal", icon: "🔗", onSelect: async () => copyTextSafe(await channelLink(srv, ch), "Link do canal copiado!") },
    perms.manage_channels && { separator: true },
    perms.manage_channels && { label: "Editar canal", icon: "⚙️", onSelect: () => openEditChannelDialog(srv, ch) },
    perms.manage_channels && { label: "Permissões do canal", icon: "🔒", onSelect: () => openPermissionsDialog(srv, ch) },
    perms.manage_channels && { label: "Mover para cima", icon: "↑", onSelect: () => moveChannelStep(srv, ch, -1) },
    perms.manage_channels && { label: "Mover para baixo", icon: "↓", onSelect: () => moveChannelStep(srv, ch, 1) },
    perms.manage_channels && { separator: true },
    perms.manage_channels && { label: "Excluir canal", icon: "🗑️", danger: true, onSelect: () => confirmDeleteChannel(srv, ch) },
  ]);
}

function openCategoryMenu(e, srv, cat, isCollapsed) {
  const perms = myPerms(srv);
  const cats = [...(srv.categories || [])].sort(byPosition);
  const idx = cats.findIndex((c) => c.id === cat.id);
  SancordUI.contextMenu(e.clientX, e.clientY, [
    {
      label: isCollapsed ? "Expandir categoria" : "Recolher categoria",
      icon: isCollapsed ? "▸" : "▾",
      onSelect: () => {
        const set = new Set(getPrefs().collapsed_categories);
        if (set.has(cat.id)) set.delete(cat.id);
        else set.add(cat.id);
        updatePrefs({ collapsed_categories: [...set] });
        renderChannelTree();
      },
    },
    perms.manage_channels && { separator: true },
    perms.manage_channels && { label: "Criar canal aqui", icon: "＋", onSelect: () => openCreateChannelDialog({ categoryId: cat.id }) },
    perms.manage_channels && { label: "Renomear categoria", icon: "✏️", onSelect: () => openRenameCategoryDialog(srv, cat) },
    perms.manage_channels && { label: "Permissões da categoria", icon: "🔒", onSelect: () => openPermissionsDialog(srv, cat, true) },
    perms.manage_channels && idx > 0 && { label: "Mover para cima", icon: "↑", onSelect: () => moveCategory(srv, cat.id, { beforeId: cats[idx - 1].id }) },
    perms.manage_channels && idx < cats.length - 1 && { label: "Mover para baixo", icon: "↓", onSelect: () => moveCategory(srv, cat.id, { afterId: cats[idx + 1].id }) },
    perms.manage_channels && { separator: true },
    perms.manage_channels && {
      label: "Excluir categoria",
      icon: "🗑️",
      danger: true,
      onSelect: async () => {
        const ok = await SancordUI.confirm({
          title: `Excluir a categoria "${cat.name}"?`,
          message: "Os canais dela não serão apagados: eles ficam sem categoria, no topo da lista.",
          confirmLabel: "Excluir categoria",
          danger: true,
        });
        if (ok) sendWs("DeleteCategory", { server_id: srv.id, category_id: cat.id });
      },
    },
  ]);
}

/** Menu do servidor (cabeçalho e botão direito na barra). */
function openServerMenu(e, srv, { anchor = null } = {}) {
  if (!srv) return;
  const me = state.selfUser?.username;
  const perms = myPerms(srv);
  const isOwner = isServerOwner(srv, me);
  const canEdit = canUserEditServer(srv, me) && Boolean(srv.owner_username || srv.id !== "sancord");
  const muted = isServerMuted(srv.id);
  const ensureActive = () => {
    if (state.activeServerId !== srv.id || state.activeView !== "server") switchToServerId(srv.id);
  };
  SancordUI.contextMenu(e?.clientX || 0, e?.clientY || 0, [
    { header: srv.name },
    {
      label: "Marcar como lido",
      icon: "✔️",
      disabled: !serverUnreadInfo(srv).unread && !serverUnreadInfo(srv).mentions,
      onSelect: () => sendWs("AckServer", { server_id: srv.id }),
    },
    perms.create_invites && { label: "Convidar pessoas", icon: "👥", onSelect: () => { ensureActive(); openInviteServerModal(); } },
    canEdit && { label: "Configurações do servidor", icon: "⚙️", onSelect: () => { ensureActive(); openServerSettingsModal(); } },
    perms.manage_channels && { label: "Criar canal", icon: "＋", onSelect: () => { ensureActive(); openCreateChannelDialog({}); } },
    perms.manage_channels && { label: "Criar categoria", icon: "📁", onSelect: () => { ensureActive(); openCreateCategoryDialog(); } },
    { separator: true },
    { label: muted ? "Reativar notificações" : "Silenciar servidor", icon: muted ? "🔔" : "🔕", onSelect: () => toggleServerMuted(srv) },
    { label: "Copiar ID do servidor", icon: "🆔", onSelect: () => copyTextSafe(srv.id, "ID do servidor copiado!") },
    (!isOwner && srv.id !== "sancord") && { separator: true },
    (!isOwner && srv.id !== "sancord") && {
      label: "Sair do servidor",
      icon: "🚪",
      danger: true,
      onSelect: async () => {
        const ok = await SancordUI.confirm({
          title: `Sair de "${srv.name}"?`,
          message: "Você só poderá voltar com um novo convite.",
          confirmLabel: "Sair do servidor",
          danger: true,
        });
        if (ok) sendWs("LeaveServer", { server_id: srv.id });
      },
    },
    (isOwner && srv.id !== "sancord") && { separator: true },
    (isOwner && srv.id !== "sancord") && {
      label: "Excluir servidor",
      icon: "🗑️",
      danger: true,
      onSelect: () => { ensureActive(); openServerSettingsModal(); document.getElementById("srv-settings-delete-btn")?.click(); },
    },
  ], { anchor });
}

// ---------------------------------------------------------------------------
// Diálogos de canal e categoria
// ---------------------------------------------------------------------------
function categoryOptions(srv) {
  return [
    { value: "", label: "Sem categoria" },
    ...[...(srv.categories || [])].sort(byPosition).map((c) => ({ value: c.id, label: c.name })),
  ];
}

async function openCreateChannelDialog({ kind = "text", categoryId = null } = {}) {
  const srv = getActiveServer();
  if (!srv) return;
  const values = await SancordUI.formDialog({
    title: "Criar canal",
    fields: [
      {
        name: "kind",
        label: "TIPO DE CANAL",
        type: "cards",
        value: kind,
        options: [
          { value: "text", label: "Texto", icon: "#", hint: "Mensagens, imagens, links e opiniões." },
          { value: "voice", label: "Voz", icon: "🔊", hint: "Conversar por voz, vídeo e compartilhar a tela." },
          { value: "announcement", label: "Anúncios", icon: "📢", hint: "Avisos importantes: todos leem, só moderadores publicam." },
        ],
      },
      { name: "name", label: "NOME DO CANAL", value: "", placeholder: "novo-canal", maxlength: 28, required: true },
      { name: "category_id", label: "CATEGORIA", type: "select", value: categoryId || "", options: categoryOptions(srv) },
      { name: "visibility", label: "ACESSO", type: "select", value: "inherit", options: [
        { value: "inherit", label: "Seguir permissões da categoria/servidor" },
        { value: "private", label: "Canal privado" },
      ] },
      { name: "private_role", label: "CARGO COM ACESSO", type: "select", value: "", visibleWhen: v => v.visibility === "private",
        options: [{ value: "", label: "Somente proprietário e administradores" }, ...(srv.roles || []).filter(r => r.id !== "everyone").map(r => ({ value: r.id, label: r.name }))] },
      {
        name: "topic",
        label: "DESCRIÇÃO (OPCIONAL)",
        type: "textarea",
        maxlength: 1024,
        placeholder: "Sobre o que é este canal?",
        visibleWhen: (v) => v.kind !== "voice",
      },
    ],
    submitLabel: "Criar canal",
  });
  if (!values) return;
  sendWs("CreateChannel", {
    server_id: srv.id,
    name: values.name.trim(),
    kind: values.kind,
    category_id: values.category_id || null,
    topic: values.kind !== "voice" ? values.topic.trim() || null : null,
    permissions_synced: values.visibility !== "private",
    overwrites: values.visibility === "private" ? [
      { target_type: "role", target_id: "everyone", permissions: { view_channel: false } },
      ...(values.private_role ? [{ target_type: "role", target_id: values.private_role, permissions: { view_channel: true } }] : []),
    ] : [],
  });
}

function confirmDeleteChannel(srv, ch) {
  SancordUI.confirm({
    title: `Excluir ${ch.kind === "voice" ? "o canal de voz" : "o canal"} "${ch.name}"?`,
    message: ch.kind === "voice" ? "Esta ação não pode ser desfeita." : "Todas as mensagens deste canal serão apagadas. Esta ação não pode ser desfeita.",
    confirmLabel: "Excluir canal",
    danger: true,
  }).then((ok) => {
    if (ok) sendWs("DeleteChannel", { server_id: srv.id, channel_id: ch.id });
  });
}

async function openEditChannelDialog(srv, ch) {
  const isVoice = ch.kind === "voice";
  const values = await SancordUI.formDialog({
    title: `Editar ${isVoice ? "canal de voz" : "canal"}`,
    fields: [
      { name: "name", label: "NOME DO CANAL", value: ch.name, maxlength: 28, required: true },
      !isVoice && {
        name: "kind",
        label: "TIPO",
        type: "cards",
        value: ch.kind,
        options: [
          { value: "text", label: "Texto", icon: "#", hint: "Todos com permissão podem conversar." },
          { value: "announcement", label: "Anúncios", icon: "📢", hint: "Só moderadores publicam." },
        ],
      },
      !isVoice && { name: "topic", label: "DESCRIÇÃO", type: "textarea", value: ch.topic || "", maxlength: 1024, placeholder: "Sobre o que é este canal?" },
      isVoice && {
        name: "user_limit",
        label: "LIMITE DE PESSOAS",
        type: "number",
        value: String(ch.user_limit || 0),
        hint: "0 = sem limite (máximo 99). Quem pode mover membros entra mesmo com o canal cheio.",
      },
      { name: "category_id", label: "CATEGORIA", type: "select", value: ch.category_id || "", options: categoryOptions(srv) },
    ].filter(Boolean),
    submitLabel: "Salvar alterações",
    extraAction: { label: "Excluir canal", danger: true, onSelect: () => confirmDeleteChannel(srv, ch) },
  });
  if (!values) return;
  sendWs("UpdateChannel", {
    server_id: srv.id,
    channel_id: ch.id,
    name: values.name.trim(),
    topic: isVoice ? null : values.topic.trim(),
    kind: isVoice ? null : values.kind,
    user_limit: isVoice ? Math.max(0, Math.min(99, parseInt(values.user_limit, 10) || 0)) : null,
  });
  const newCat = values.category_id || null;
  if (newCat !== (ch.category_id || null)) moveChannel(srv, ch.id, { intoCategory: newCat });
}

async function openCreateCategoryDialog() {
  const srv = getActiveServer();
  if (!srv) return;
  const values = await SancordUI.formDialog({
    title: "Criar categoria",
    description: "Categorias agrupam canais (ex.: Informações, Comunidade, Voz).",
    fields: [{ name: "name", label: "NOME DA CATEGORIA", value: "", maxlength: 32, required: true, placeholder: "Nova categoria" }],
    submitLabel: "Criar categoria",
  });
  if (values) sendWs("CreateCategory", { server_id: srv.id, name: values.name.trim() });
}

async function openRenameCategoryDialog(srv, cat) {
  const values = await SancordUI.formDialog({
    title: "Renomear categoria",
    fields: [{ name: "name", label: "NOME DA CATEGORIA", value: cat.name, maxlength: 32, required: true }],
    submitLabel: "Salvar",
  });
  if (values) sendWs("UpdateCategory", { server_id: srv.id, category_id: cat.id, name: values.name.trim() });
}

// ---------------------------------------------------------------------------
// Barra de servidores: ordem, pastas, arrastar e soltar, menus e tooltips
// ---------------------------------------------------------------------------
/** Layout efetivo: só servidores existentes, sem duplicatas, novos no fim. */
function effectiveGuildLayout() {
  const servers = state.servers || [];
  const valid = new Set(servers.map((s) => s.id));
  const seen = new Set();
  const out = [];
  for (const item of getPrefs().guild_layout || []) {
    if (item.type === "server") {
      if (valid.has(item.id) && !seen.has(item.id)) {
        seen.add(item.id);
        out.push({ type: "server", id: item.id });
      }
    } else if (item.type === "folder") {
      const ids = (item.server_ids || []).filter((id) => valid.has(id) && !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (ids.length) out.push({ ...item, server_ids: ids });
    }
  }
  for (const s of servers) {
    if (!seen.has(s.id)) out.push({ type: "server", id: s.id });
  }
  return out;
}

function saveGuildLayout(layout) {
  updatePrefs({ guild_layout: layout });
  renderGuildRailV2();
}

function serverInitials(name) {
  return (name || "S").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}

function buildServerIconInner(srv) {
  const holder = document.createElement("span");
  holder.className = "guild-icon-inner";
  if (srv.icon_url) {
    const img = document.createElement("img");
    img.src = srv.icon_url;
    img.alt = "";
    img.className = "guild-logo-img";
    img.draggable = false;
    holder.appendChild(img);
  } else {
    const ini = document.createElement("span");
    ini.className = "guild-icon-initial";
    ini.textContent = serverInitials(srv.name);
    holder.appendChild(ini);
  }
  return holder;
}

let railDrag = null; // { kind: "server" | "folder", id }

function railDropZone(e, el, allowInto) {
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (allowInto && y > 0.28 && y < 0.72) return "into";
  return y < 0.5 ? "before" : "after";
}

function removeFromLayout(layout, kind, id) {
  let removed = null;
  for (let i = layout.length - 1; i >= 0; i--) {
    const item = layout[i];
    if (kind === "folder" && item.type === "folder" && item.id === id) {
      removed = layout.splice(i, 1)[0];
    } else if (kind === "server") {
      if (item.type === "server" && item.id === id) {
        removed = layout.splice(i, 1)[0];
      } else if (item.type === "folder" && item.server_ids.includes(id)) {
        item.server_ids = item.server_ids.filter((s) => s !== id);
        removed = { type: "server", id };
        if (item.server_ids.length === 0) layout.splice(i, 1);
      }
    }
  }
  return removed;
}

/** target: { kind: "server"|"folder", id, folderId? (servidor dentro de pasta) } */
function applyRailDrop(drag, target, zone) {
  if (drag.kind === target.kind && drag.id === target.id) return;
  const layout = effectiveGuildLayout().map((i) => (i.type === "folder" ? { ...i, server_ids: [...i.server_ids] } : { ...i }));
  if (drag.kind === "folder" && target.folderId === drag.id) return;
  const item = removeFromLayout(layout, drag.kind, drag.id);
  if (!item) return;

  const rootIndexOf = (kind, id) => layout.findIndex((i) => (kind === "folder" ? i.type === "folder" && i.id === id : i.type === "server" && i.id === id));
  const folderOf = (fid) => layout.find((i) => i.type === "folder" && i.id === fid);

  if (drag.kind === "server" && zone === "into") {
    if (target.kind === "folder") {
      folderOf(target.id)?.server_ids.push(drag.id);
    } else if (target.folderId) {
      const f = folderOf(target.folderId);
      if (f) f.server_ids.splice(f.server_ids.indexOf(target.id) + 1, 0, drag.id);
    } else {
      const idx = rootIndexOf("server", target.id);
      if (idx < 0) return;
      layout.splice(idx, 1, {
        type: "folder",
        id: `folder-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: "",
        color: null,
        server_ids: [target.id, drag.id],
        collapsed: false,
      });
    }
  } else if (drag.kind === "server" && target.folderId) {
    const f = folderOf(target.folderId);
    if (!f) return;
    const idx = f.server_ids.indexOf(target.id);
    f.server_ids.splice(zone === "before" ? idx : idx + 1, 0, drag.id);
  } else {
    // Posição na raiz (pastas soltas em itens de dentro de outra pasta usam a posição da pasta).
    const refKind = target.folderId ? "folder" : target.kind;
    const refId = target.folderId || target.id;
    let idx = rootIndexOf(refKind, refId);
    if (idx < 0) idx = layout.length;
    else if (zone === "after") idx += 1;
    layout.splice(idx, 0, item);
  }
  saveGuildLayout(layout);
}

function attachRailDnD(el, dragInfo, targetInfo, { allowInto }) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    railDrag = dragInfo;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragInfo.id);
    el.classList.add("is-dragging");
    SancordUI.hideTooltip();
  });
  el.addEventListener("dragend", () => {
    railDrag = null;
    el.classList.remove("is-dragging");
    clearDropMarks(document.querySelector(".guild-rail") || document);
  });
  el.addEventListener("dragover", (e) => {
    if (!railDrag || (railDrag.kind === targetInfo.kind && railDrag.id === targetInfo.id)) return;
    e.preventDefault();
    const zone = railDropZone(e, el, allowInto && railDrag.kind === "server");
    clearDropMarks(document.querySelector(".guild-rail") || document);
    el.classList.add(zone === "into" ? "drop-into" : zone === "before" ? "drop-before" : "drop-after");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after", "drop-into"));
  el.addEventListener("drop", (e) => {
    if (!railDrag) return;
    e.preventDefault();
    const zone = railDropZone(e, el, allowInto && railDrag.kind === "server");
    const drag = railDrag;
    clearDropMarks(document.querySelector(".guild-rail") || document);
    applyRailDrop(drag, targetInfo, zone);
  });
}

function buildRailServerItem(srv, folderId = null) {
  const isActive = state.activeView === "server" && state.activeServerId === srv.id;
  const info = typeof serverUnreadInfo === "function" ? serverUnreadInfo(srv) : { unread: false, mentions: 0 };
  const wrap = document.createElement("div");
  wrap.className = `guild-item-wrap ${isActive ? "active" : ""} ${isServerMuted(srv.id) ? "is-muted" : ""} ${info.unread && !isActive ? "has-unread" : ""}`;
  wrap.dataset.serverId = srv.id;
  const pill = document.createElement("div");
  pill.className = "guild-pill";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `guild-icon ${isActive ? "active" : ""}`;
  if (!srv.icon_url) btn.style.background = srv.icon_color || "#5865f2";
  btn.appendChild(buildServerIconInner(srv));
  if (info.mentions > 0) {
    const badge = document.createElement("span");
    badge.className = "rail-notif-badge rail-mention-badge";
    badge.textContent = info.mentions > 99 ? "99+" : info.mentions;
    wrap.appendChild(badge);
  }
  if (isActive) btn.setAttribute("aria-current", "page");
  const owner = isServerOwner(srv, state.selfUser?.username);
  SancordUI.tooltip(btn, `${srv.name}${owner ? " (seu servidor)" : ""}${isServerMuted(srv.id) ? " • silenciado" : ""}`, "right");
  btn.addEventListener("click", () => switchToServerId(srv.id));
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    SancordUI.hideTooltip();
    openServerMenu(e, srv);
  });
  wrap.append(pill, btn);
  attachRailDnD(wrap, { kind: "server", id: srv.id }, { kind: "server", id: srv.id, folderId }, { allowInto: true });
  return wrap;
}

function buildRailFolder(folder, serversById) {
  const servers = folder.server_ids.map((id) => serversById.get(id)).filter(Boolean);
  const open = !folder.collapsed;
  const hasActive = servers.some((s) => state.activeView === "server" && state.activeServerId === s.id);
  const box = document.createElement("div");
  box.className = `guild-folder ${open ? "open" : ""}`;
  box.dataset.folderId = folder.id;
  if (folder.color) box.style.setProperty("--folder-color", folder.color);

  const head = document.createElement("div");
  head.className = `guild-item-wrap guild-folder-head ${!open && hasActive ? "active" : ""}`;
  const pill = document.createElement("div");
  pill.className = "guild-pill";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "guild-icon guild-folder-icon";
  btn.setAttribute("aria-expanded", String(open));
  if (open) {
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
  } else {
    const grid = document.createElement("span");
    grid.className = "guild-folder-grid";
    for (const s of servers.slice(0, 4)) {
      const mini = document.createElement("span");
      mini.className = "guild-folder-mini";
      if (!s.icon_url) mini.style.background = s.icon_color || "#5865f2";
      mini.appendChild(buildServerIconInner(s));
      grid.appendChild(mini);
    }
    btn.appendChild(grid);
  }
  // Pasta fechada soma as menções e mostra não lidas dos servidores dentro dela.
  if (!open && typeof serverUnreadInfo === "function") {
    const totals = servers.map(serverUnreadInfo);
    const mentions = totals.reduce((n, t) => n + t.mentions, 0);
    if (totals.some((t) => t.unread) && !hasActive) head.classList.add("has-unread");
    if (mentions > 0) {
      const badge = document.createElement("span");
      badge.className = "rail-notif-badge rail-mention-badge";
      badge.textContent = mentions > 99 ? "99+" : mentions;
      head.appendChild(badge);
    }
  }
  const label = folder.name || servers.map((s) => s.name).slice(0, 3).join(", ");
  SancordUI.tooltip(btn, `${folder.name ? `${folder.name} — ` : "Pasta: "}${label}`, "right");
  btn.addEventListener("click", () => {
    const layout = effectiveGuildLayout().map((i) => (i.type === "folder" && i.id === folder.id ? { ...i, collapsed: !i.collapsed } : i));
    saveGuildLayout(layout);
  });
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    SancordUI.hideTooltip();
    openFolderMenu(e, folder);
  });
  head.append(pill, btn);
  attachRailDnD(head, { kind: "folder", id: folder.id }, { kind: "folder", id: folder.id }, { allowInto: true });
  box.appendChild(head);

  if (open) {
    const items = document.createElement("div");
    items.className = "guild-folder-items";
    for (const s of servers) items.appendChild(buildRailServerItem(s, folder.id));
    box.appendChild(items);
  }
  return box;
}

function openFolderMenu(e, folder) {
  const updateFolder = (patch) => {
    saveGuildLayout(effectiveGuildLayout().map((i) => (i.type === "folder" && i.id === folder.id ? { ...i, ...patch } : i)));
  };
  SancordUI.contextMenu(e.clientX, e.clientY, [
    { header: folder.name || "Pasta de servidores" },
    { label: folder.collapsed ? "Abrir pasta" : "Fechar pasta", icon: "📂", onSelect: () => updateFolder({ collapsed: !folder.collapsed }) },
    {
      label: "Configurar pasta",
      icon: "🎨",
      onSelect: async () => {
        const v = await SancordUI.formDialog({
          title: "Configurações da pasta",
          fields: [
            { name: "name", label: "NOME DA PASTA", value: folder.name || "", maxlength: 32, placeholder: "Sem nome" },
            { name: "color", label: "COR", type: "color", value: folder.color || "#5865f2" },
          ],
          submitLabel: "Salvar",
        });
        if (v) updateFolder({ name: v.name.trim(), color: v.color });
      },
    },
    { separator: true },
    {
      label: "Desfazer pasta",
      icon: "🗂️",
      onSelect: () => {
        const layout = [];
        for (const i of effectiveGuildLayout()) {
          if (i.type === "folder" && i.id === folder.id) i.server_ids.forEach((id) => layout.push({ type: "server", id }));
          else layout.push(i);
        }
        saveGuildLayout(layout);
      },
    },
  ]);
}

function renderGuildRailV2() {
  const list = document.getElementById("guild-rail-list");
  if (!list) return;
  const servers = state.servers || [];
  list.innerHTML = "";
  if (servers.length === 0) return;
  const byId = new Map(servers.map((s) => [s.id, s]));
  for (const item of effectiveGuildLayout()) {
    if (item.type === "server") {
      const srv = byId.get(item.id);
      if (srv) list.appendChild(buildRailServerItem(srv));
    } else {
      list.appendChild(buildRailFolder(item, byId));
    }
  }
}

// ---------------------------------------------------------------------------
// Cabeçalho do servidor e do canal
// ---------------------------------------------------------------------------
document.getElementById("server-menu-btn")?.addEventListener("click", (e) => {
  const btn = e.currentTarget;
  openServerMenu(null, getActiveServer(), { anchor: btn });
});
// Botões do cabeçalho viram só ícone (com tooltip) para o nome do servidor caber.
(() => {
  const invite = document.getElementById("copy-invite-btn");
  if (invite) SancordUI.tooltip(invite, "Convidar pessoas", "top");
  const gear = document.getElementById("open-server-settings-btn");
  if (gear) SancordUI.tooltip(gear, "Configurações do servidor", "top");
  const leave = document.getElementById("leave-server-btn");
  if (leave) SancordUI.tooltip(leave, "Sair do servidor", "top");
})();

/** Atualiza ícone, descrição e permissão de escrita conforme o tipo do canal. */
function applyChannelHeader(srv, ch) {
  const isAnn = ch?.kind === "announcement";
  if (chatHeaderIcon) chatHeaderIcon.innerHTML = channelIconSvg(ch?.kind || "text");
  if (chatChannelTopic) {
    chatChannelTopic.textContent = ch?.topic || srv?.description || "Converse em tempo real com o servidor.";
    chatChannelTopic.title = chatChannelTopic.textContent;
  }
  chatMessagesEl?.classList.toggle("is-announcement-channel", isAnn);
  const name = ch?.name || "geral";
  const canPost = canPostIn(srv, ch);
  const permissions = getChannelPermissions(srv, ch);
  const pins = document.getElementById("pinned-msgs-btn");
  if (pins) pins.disabled = !ch || !permissions.read_history;
  const attach = document.getElementById("attach-image-btn");
  if (attach) attach.disabled = !canPost || !permissions.attach_files;
  chatInput.disabled = !canPost;
  chatInput.placeholder = canPost
    ? `Conversar em #${name}`
    : isAnn
      ? `Somente moderadores publicam em #${name}`
      : ch ? `Você não tem permissão para enviar mensagens em #${name}` : "Nenhum canal acessível neste servidor";
}

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------
function formatInviteExpiry(inv) {
  const parts = [];
  if (inv.expires_at) {
    const d = new Date(inv.expires_at);
    parts.push(`expira ${d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
  } else {
    parts.push("não expira");
  }
  parts.push(inv.max_uses ? `${inv.uses}/${inv.max_uses} usos` : `${inv.uses} uso${inv.uses === 1 ? "" : "s"}`);
  return parts.join(" • ");
}

document.getElementById("invite-modal-create-btn")?.addEventListener("click", () => {
  const srv = getActiveServer();
  if (!srv) return;
  const maxAge = Number(document.getElementById("invite-modal-expiry")?.value || 0);
  const maxUses = Number(document.getElementById("invite-modal-max-uses")?.value || 0);
  state.awaitingInviteFor = srv.id;
  sendWs("CreateInvite", { server_id: srv.id, max_age_secs: maxAge, max_uses: maxUses });
});

async function onInviteCreated(payload) {
  const inv = payload?.invite;
  if (!inv) return;
  const origin = await resolvePublicOriginUrl();
  const link = SancordNet.link({ invite: inv.code }, origin);
  const modal = document.getElementById("invite-server-modal");
  if (modal && !modal.classList.contains("hidden") && state.awaitingInviteFor === inv.server_id) {
    const linkInput = document.getElementById("invite-modal-link-input");
    const badge = document.getElementById("invite-modal-code-badge");
    const note = document.getElementById("invite-modal-expiry-note");
    if (linkInput) linkInput.value = link;
    if (badge) badge.textContent = inv.code;
    if (note) note.textContent = `Convite personalizado: ${formatInviteExpiry(inv)}.`;
    linkInput?.select();
  }
  state.awaitingInviteFor = null;
  showUiToast("Convite criado!");
  if (typeof editingServerId !== "undefined" && editingServerId === inv.server_id) requestServerInvites(inv.server_id);
}

function requestServerInvites(serverId) {
  const list = document.getElementById("srv-invites-list");
  if (list && !list.children.length) list.innerHTML = `<div class="pinned-empty">Carregando convites...</div>`;
  sendWs("ListInvites", { server_id: serverId });
}

async function onInvitesList(payload) {
  const list = document.getElementById("srv-invites-list");
  if (!list || (typeof editingServerId !== "undefined" && editingServerId !== payload.server_id)) return;
  const origin = await resolvePublicOriginUrl();
  list.innerHTML = "";
  const invites = payload.invites || [];
  if (invites.length === 0) {
    list.innerHTML = `<div class="pinned-empty">Nenhum convite ativo.</div>`;
    return;
  }
  for (const inv of invites) {
    const row = document.createElement("div");
    row.className = "srv-manage-row invite-row";
    const info = document.createElement("div");
    const code = document.createElement("strong");
    code.className = "invite-code-text";
    code.textContent = inv.code;
    const meta = document.createElement("div");
    meta.className = "settings-hint-text";
    meta.textContent = `${inv.is_default ? "Padrão • " : ""}criado por ${inv.creator_name} • ${formatInviteExpiry(inv)}`;
    info.append(code, meta);
    const actions = document.createElement("div");
    actions.className = "invite-row-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn-secondary small-btn";
    copy.textContent = "Copiar link";
    copy.addEventListener("click", () => copyTextSafe(SancordNet.link({ invite: inv.code }, origin), "Link de convite copiado!"));
    actions.appendChild(copy);
    if (!inv.is_default) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "btn-secondary small-btn danger-text";
      revoke.textContent = "Revogar";
      revoke.addEventListener("click", async () => {
        const ok = await SancordUI.confirm({
          title: `Revogar o convite ${inv.code}?`,
          message: "Quem tiver este link não conseguirá mais entrar por ele.",
          confirmLabel: "Revogar",
          danger: true,
        });
        if (ok) sendWs("RevokeInvite", { server_id: payload.server_id, code: inv.code });
      });
      actions.appendChild(revoke);
    }
    row.append(info, actions);
    list.appendChild(row);
  }
}

document.querySelector('.settings-nav-item[data-srv-tab="invites"]')?.addEventListener("click", () => {
  if (typeof editingServerId !== "undefined" && editingServerId) requestServerInvites(editingServerId);
});
document.getElementById("srv-invites-refresh-btn")?.addEventListener("click", () => {
  if (typeof editingServerId !== "undefined" && editingServerId) requestServerInvites(editingServerId);
});

// ---------------------------------------------------------------------------
// Link direto para canal (?server=...&channel=...)
// ---------------------------------------------------------------------------
function applyDeepLinkFromUrl() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (_) {
    return;
  }
  const sid = params.get("server");
  const dm = params.get("dm");
  const mid = params.get("message");
  if (!sid && !dm) return;
  const cid = params.get("channel");
  const srv = sid && (state.servers || []).find((s) => s.id === sid);
  if (srv) {
    switchToServerId(srv.id, cid);
    if (cid && mid) jumpToMessage(cid, mid);
  } else if (dm && mid) {
    jumpToMessage(dm, mid);
  } else {
    showUiToast("Você não participa do servidor deste link.");
  }
  params.delete("server");
  params.delete("channel");
  params.delete("dm");
  params.delete("message");
  const rest = params.toString();
  try {
    history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  } catch (_) {}
}
