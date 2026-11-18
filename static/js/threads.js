// ============================================================================
// Sancord — Threads e fóruns (Fase 8)
//   Uma thread abre na área de mensagens como um canal (id "thr-…"); as
//   permissões vêm do canal-pai (o servidor decide; aqui só exibimos).
//   Fórum: a área de mensagens dá lugar à lista de postagens.
// Depende de globais do app.js/servers.js/chat.js.
// ============================================================================

state.threadIndex = state.threadIndex || new Map(); // id -> thread
state.forumViewChannel = null;
state.pendingForumPost = null; // { parentId, content }

function isThreadId(id) {
  return typeof id === "string" && id.startsWith("thr-");
}

function threadById(id) {
  return state.threadIndex.get(id) || null;
}

function threadsOf(parentId) {
  return [...state.threadIndex.values()].filter((t) => t.parent_id === parentId);
}

/** Ativas primeiro, mais recentes primeiro. */
function sortThreads(list) {
  return [...list].sort((a, b) => (a.archived - b.archived) || (b.last_message_at || 0) - (a.last_message_at || 0));
}

function serverOfThread(t) {
  return (state.servers || []).find((s) => s.id === t?.server_id) || null;
}

function parentChannelOf(t) {
  return (serverOfThread(t)?.text_channels || []).find((c) => c.id === t?.parent_id) || null;
}

function requestServerThreads(serverId) {
  if (serverId) sendWs("ListThreads", { server_id: serverId });
}

function timeAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}

function refreshThreadViews(thread) {
  if (typeof renderChannelTree === "function") renderChannelTree();
  if (state.forumViewChannel) renderForumPosts();
  if (thread && state.currentTextChannel === thread.id && state.activeView !== "home") applyThreadHeader(thread);
  // O link "🧵" fica sob a mensagem inicial: redesenha o canal-pai se estiver aberto.
  if (thread?.starter_message_id && state.currentTextChannel === thread.parent_id) renderChatMessages();
}

function onThreadList({ server_id, threads }) {
  for (const [id, t] of state.threadIndex) {
    if (t.server_id === server_id) state.threadIndex.delete(id);
  }
  for (const t of threads || []) state.threadIndex.set(t.id, t);
  refreshThreadViews(null);
  if (state.currentTextChannel && isThreadId(state.currentTextChannel)) {
    const t = threadById(state.currentTextChannel);
    if (t) applyThreadHeader(t);
  }
}

function onThreadUpdated({ thread }) {
  state.threadIndex.set(thread.id, thread);
  refreshThreadViews(thread);
}

function onThreadCreated({ thread }) {
  state.threadIndex.set(thread.id, thread);
  const post = state.pendingForumPost;
  state.pendingForumPost = null;
  openThread(thread.id);
  // Postagem de fórum: a primeira mensagem vai logo após criar a thread.
  if (post && post.parentId === thread.parent_id && post.content) {
    sendWs("SendChat", { channel_id: thread.id, content: post.content });
  }
}

function onThreadDeleted({ thread_id, parent_id }) {
  const t = threadById(thread_id);
  state.threadIndex.delete(thread_id);
  if (state.currentTextChannel === thread_id) {
    showUiToast("Esta thread foi excluída.");
    const parent = parentChannelOf(t || { parent_id, server_id: getActiveServer()?.id });
    if (parent?.kind === "forum") openForumView(getActiveServer(), parent);
    else {
      state.currentTextChannel = parent_id;
      switchToServerView();
    }
  }
  refreshThreadViews(null);
}

// ---------------------------------------------------------------------------
// Árvore de canais e link sob a mensagem inicial
// ---------------------------------------------------------------------------

function buildNestedThreadRows(srv, ch) {
  const active = sortThreads(threadsOf(ch.id)).filter((t) => !t.archived || t.id === state.currentTextChannel).slice(0, 5);
  return active.map((t) => {
    const li = document.createElement("li");
    li.className = `channel-item thread-item${t.id === state.currentTextChannel ? " active" : ""}`;
    li.dataset.channelId = t.id;
    li.setAttribute("role", "treeitem");
    li.tabIndex = 0;
    const left = document.createElement("span");
    left.className = "channel-item-left";
    const icon = document.createElement("span");
    icon.className = "channel-svg-icon";
    icon.innerHTML = channelIconSvg("thread");
    const name = document.createElement("span");
    name.className = "channel-name";
    name.textContent = `${t.locked ? "🔒 " : ""}${t.name}`;
    left.append(icon, name);
    li.appendChild(left);
    const unread = typeof channelUnreadInfo === "function" ? channelUnreadInfo(t.id) : { unread: false, mentions: 0 };
    if (unread.unread && t.id !== state.currentTextChannel) li.classList.add("unread");
    if (unread.mentions > 0) {
      const badge = document.createElement("span");
      badge.className = "mention-badge";
      badge.textContent = unread.mentions > 99 ? "99+" : unread.mentions;
      li.appendChild(badge);
    }
    li.addEventListener("click", () => openThread(t.id));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openThread(t.id);
    });
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openThreadMenu(e, t);
    });
    return li;
  });
}

function buildThreadLinkNode(msg) {
  const t = [...state.threadIndex.values()].find((x) => x.starter_message_id === msg.id);
  if (!t) return null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "thread-link";
  btn.innerHTML = channelIconSvg("thread");
  const text = document.createElement("span");
  text.textContent = `${t.name} • ${t.message_count} ${t.message_count === 1 ? "mensagem" : "mensagens"}${t.archived ? " • arquivada" : ""}`;
  btn.appendChild(text);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openThread(t.id);
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Abrir thread e cabeçalho
// ---------------------------------------------------------------------------

function openThread(threadId) {
  const t = threadById(threadId);
  if (!t) {
    showUiToast("Thread não encontrada ou sem acesso.");
    return;
  }
  if (getActiveServer()?.id !== t.server_id || state.activeView === "home") {
    switchToServerId(t.server_id, t.parent_id);
  }
  state.forumViewChannel = null;
  state.currentTextChannel = t.id;
  switchToServerView();
  if (!(state.chatHistory[t.id] || []).length) {
    sendWs("LoadMessages", { channel_id: t.id });
  }
}

/** Chamado pelo switchToServerView: thread no lugar do canal; fecha o fórum. */
function onServerViewShown(ch) {
  if (!state.forumViewChannel || ch?.id !== state.forumViewChannel) closeForumView();
  const t = isThreadId(state.currentTextChannel) ? threadById(state.currentTextChannel) : null;
  if (t) applyThreadHeader(t);
}

function threadPermissions(t) {
  const parent = parentChannelOf(t);
  return parent ? getChannelPermissions(serverOfThread(t), parent) : {};
}

function applyThreadHeader(t) {
  const parent = parentChannelOf(t);
  const perms = threadPermissions(t);
  if (chatHeaderIcon) chatHeaderIcon.innerHTML = channelIconSvg("thread");
  currentTextChannelTitle.textContent = t.name;
  if (chatChannelTopic) {
    const flags = [t.archived && "arquivada", t.locked && "trancada"].filter(Boolean).join(" • ");
    const where = parent ? `${parent.kind === "forum" ? "Postagem em" : "Thread em"} #${parent.name}` : "Thread";
    chatChannelTopic.textContent = `← ${where} • ${t.message_count} ${t.message_count === 1 ? "mensagem" : "mensagens"}${flags ? ` • ${flags}` : ""}`;
    chatChannelTopic.title = "Voltar ao canal";
    chatChannelTopic.style.cursor = "pointer";
    chatChannelTopic.onclick = () => {
      chatChannelTopic.onclick = null;
      chatChannelTopic.style.cursor = "";
      if (parent?.kind === "forum") openForumView(serverOfThread(t), parent);
      else if (parent) {
        state.currentTextChannel = parent.id;
        switchToServerView();
      }
    };
  }
  chatMessagesEl?.classList.remove("is-announcement-channel");
  const canPost = Boolean(perms.send_messages) && (!t.locked || perms.manage_messages);
  chatInput.disabled = !canPost;
  chatInput.placeholder = canPost ? `Conversar em 🧵 ${t.name}` : t.locked ? "Thread trancada pela moderação" : "Você não pode enviar mensagens aqui";
  const attach = document.getElementById("attach-image-btn");
  if (attach) attach.disabled = !canPost || !perms.attach_files;
  const pins = document.getElementById("pinned-msgs-btn");
  if (pins) pins.disabled = !perms.read_history;
}

// ---------------------------------------------------------------------------
// Criar, gerenciar
// ---------------------------------------------------------------------------

async function openCreateThreadDialog(msg) {
  const suggested = (msg.content || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const values = await SancordUI.formDialog({
    title: "Criar thread",
    description: "A conversa continua numa thread ligada a esta mensagem, com as mesmas permissões do canal.",
    submitLabel: "Criar thread",
    fields: [{ name: "name", label: "NOME DA THREAD", value: suggested, maxlength: 100, required: true }],
  });
  if (values) sendWs("CreateThread", { channel_id: msg.channel_id, name: values.name.trim(), message_id: msg.id });
}

function openThreadMenu(e, t) {
  const me = (state.selfUser?.username || "").toLowerCase();
  const perms = threadPermissions(t);
  const mod = Boolean(perms.manage_messages);
  const own = t.owner === me;
  const items = [{ header: t.name }];
  if (own || mod) {
    items.push({
      label: "Renomear",
      icon: "✏️",
      onSelect: async () => {
        const v = await SancordUI.formDialog({ title: "Renomear thread", fields: [{ name: "name", label: "NOME", value: t.name, maxlength: 100, required: true }] });
        if (v) sendWs("UpdateThread", { thread_id: t.id, name: v.name.trim() });
      },
    });
    items.push({ label: t.archived ? "Desarquivar" : "Arquivar", icon: "📦", onSelect: () => sendWs("UpdateThread", { thread_id: t.id, archived: !t.archived }) });
  }
  if (mod) items.push({ label: t.locked ? "Destrancar" : "Trancar", icon: "🔒", onSelect: () => sendWs("UpdateThread", { thread_id: t.id, locked: !t.locked }) });
  if (own || mod) {
    items.push({ separator: true });
    items.push({
      label: "Excluir thread",
      icon: "🗑️",
      danger: true,
      onSelect: async () => {
        const ok = await SancordUI.confirm({ title: "Excluir thread?", message: `"${t.name}" e todas as mensagens dela serão apagadas.`, confirmLabel: "Excluir", danger: true });
        if (ok) sendWs("DeleteThread", { thread_id: t.id });
      },
    });
  }
  if (items.length === 1) items.push({ label: "Abrir", icon: "🧵", onSelect: () => openThread(t.id) });
  if (typeof notifyMenuItems === "function") items.push(...notifyMenuItems(t.id));
  SancordUI.contextMenu(e.clientX, e.clientY, items);
}

// ---------------------------------------------------------------------------
// Fórum
// ---------------------------------------------------------------------------

function forumElements() {
  return {
    view: document.getElementById("forum-view"),
    messages: document.getElementById("chat-messages"),
    composer: document.getElementById("chat-form")?.parentElement,
  };
}

function openForumView(srv, ch) {
  if (!srv || !ch) return;
  if (getActiveServer()?.id !== srv.id || state.activeView === "home") switchToServerId(srv.id, null);
  state.forumViewChannel = ch.id;
  state.currentTextChannel = ch.id;
  switchToServerView(); // aplica cabeçalho e chama onServerViewShown (mantém o fórum)
  const { view, messages } = forumElements();
  view?.classList.remove("hidden");
  messages?.classList.add("hidden");
  document.getElementById("chat-form")?.classList.add("hidden");
  if (chatChannelTopic) chatChannelTopic.textContent = ch.topic || "Cada postagem tem a própria conversa.";
  const perms = getChannelPermissions(srv, ch);
  document.getElementById("forum-new-post-btn")?.classList.toggle("hidden", !perms.send_messages);
  renderForumPosts();
  renderChannelTree();
}

function closeForumView() {
  state.forumViewChannel = null;
  const { view, messages } = forumElements();
  view?.classList.add("hidden");
  messages?.classList.remove("hidden");
  document.getElementById("chat-form")?.classList.remove("hidden");
}

function renderForumPosts() {
  const list = document.getElementById("forum-posts");
  if (!list || !state.forumViewChannel) return;
  const q = (document.getElementById("forum-filter")?.value || "").trim().toLowerCase();
  const posts = sortThreads(threadsOf(state.forumViewChannel)).filter((t) => !q || t.name.toLowerCase().includes(q));
  list.innerHTML = "";
  if (posts.length === 0) {
    list.innerHTML = `<div class="pinned-empty">${q ? "Nenhuma postagem encontrada." : "Nenhuma postagem ainda. Comece o primeiro assunto!"}</div>`;
    return;
  }
  for (const t of posts) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `forum-post${t.archived ? " archived" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${t.locked ? "🔒 " : ""}${t.name}`;
    const meta = document.createElement("span");
    meta.className = "forum-post-meta";
    meta.textContent = `por ${t.owner} • ${t.message_count} ${t.message_count === 1 ? "mensagem" : "mensagens"} • ${timeAgo(t.last_message_at || t.created_at)}${t.archived ? " • arquivada" : ""}`;
    card.append(title, meta);
    card.addEventListener("click", () => openThread(t.id));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openThreadMenu(e, t);
    });
    list.appendChild(card);
  }
}

async function openNewForumPostDialog() {
  const parentId = state.forumViewChannel;
  if (!parentId) return;
  const values = await SancordUI.formDialog({
    title: "Nova postagem",
    submitLabel: "Publicar",
    fields: [
      { name: "title", label: "TÍTULO", maxlength: 100, required: true, placeholder: "Sobre o que você quer falar?" },
      { name: "content", label: "MENSAGEM", type: "textarea", rows: 5, maxlength: 2000, required: true },
    ],
  });
  if (!values) return;
  state.pendingForumPost = { parentId, content: values.content.trim() };
  sendWs("CreateThread", { channel_id: parentId, name: values.title.trim() });
}

document.getElementById("forum-new-post-btn")?.addEventListener("click", openNewForumPostDialog);
document.getElementById("forum-filter")?.addEventListener("input", renderForumPosts);
