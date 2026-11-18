// ============================================================================
// Sancord — Polimento (Fase 9)
//   • Nível de notificação por servidor/canal (sincronizado nas preferências)
//   • Aviso nativo do Windows (piscar na barra de tarefas) via IPC do .exe
//   • Navegação rápida (Ctrl+K) e atalhos de navegação entre canais
//   • Reduzir animações
// Depende de globais do app.js/chat.js/servers.js/threads.js.
// ============================================================================

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------

/** Nome do nível de notificação no idioma atual (static/js/i18n.js). */
function notifyLabel(level) {
  return typeof t === "function" ? t(`notify.${level || "default"}`) : level;
}

/** Nível explícito do canal → thread (canal-pai) → servidor; senão "default". */
function notifyLevelFor(channelId) {
  const levels = state.prefs?.notify_levels || {};
  if (levels[channelId]) return levels[channelId];
  const thread = state.threadIndex?.get(channelId);
  if (thread && levels[thread.parent_id]) return levels[thread.parent_id];
  if (!isPrivateTextId(channelId)) {
    const srv = typeof serverForChannel === "function" ? serverForChannel(channelId) : null;
    if (srv && levels[srv.id]) return levels[srv.id];
  }
  return "default";
}

function isFriendName(name) {
  const lower = String(name || "").toLowerCase();
  return (state.friends || []).some((f) => String(f.username || "").toLowerCase() === lower);
}

/**
 * O que fazer com uma mensagem recebida:
 *  sound  — tocar som; notify — notificação + piscar a janela; mention — é menção/DM.
 * "default" mantém o comportamento anterior: som em tudo (exceto servidor silenciado)
 * e notificação só para menções e DMs. Modo Foco silencia conversas privadas de não amigos.
 */
function notificationPolicy(message) {
  const silent = { sound: false, notify: false, mention: false };
  if (!message || isOwnMessage(message)) return silent;
  const chId = message.channel_id;
  const isDm = isPrivateTextId(chId);
  if (isDm && typeof isMessageRequest === "function" && isMessageRequest(chId)) return silent;
  // Modo Foco: conversa privada com quem não é amigo chega e conta como não lida, mas sem som nem aviso.
  if (isDm && state.audioSettings?.familyFocus && !isFriendName(message.author_name)) return { ...silent, mention: true };
  const mention = isDm || messageMentionsMe(message);
  const level = notifyLevelFor(chId);
  if (level === "none") return { ...silent, mention };
  if (level === "mentions") return { sound: mention, notify: mention, mention };
  if (level === "all") return { sound: true, notify: true, mention };
  const srv = isDm ? null : serverForChannel(chId);
  const muted = srv && isServerMuted(srv.id);
  const direct = (message.mentions?.users || []).includes((state.selfUser?.username || "").toLowerCase());
  return { sound: !muted || direct, notify: mention && (!muted || direct), mention };
}

function setNotifyLevel(id, level) {
  const levels = { ...(state.prefs?.notify_levels || {}) };
  if (!level || level === "default") delete levels[id];
  else levels[id] = level;
  state.prefs = { ...(state.prefs || {}), notify_levels: levels };
  sendWs("UpdateUserPrefs", { notify_levels: levels });
  showUiToast(t("notify.saved", { level: notifyLabel(level) }));
  if (typeof renderChannelTree === "function") renderChannelTree();
}

/** Itens de menu "Notificações" para um servidor, canal ou thread. */
function notifyMenuItems(id) {
  const current = state.prefs?.notify_levels?.[id] || "default";
  return [
    { separator: true },
    { header: t("notify.title") },
    ...["default", "all", "mentions", "none"].map((level) => ({
      label: notifyLabel(level),
      icon: current === level ? "✓" : level === "none" ? "🔕" : level === "mentions" ? "@" : "🔔",
      onSelect: () => setNotifyLevel(id, level),
    })),
  ];
}

/** Pisca a janela na barra de tarefas (o .exe ignora se a janela estiver em foco). */
function requestWindowAttention() {
  try {
    window.ipc?.postMessage("attention");
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Navegação rápida (Ctrl+K)
// ---------------------------------------------------------------------------

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Pontuação: começo do nome > começo de palavra > contém. 0 = não serve. */
function matchScore(name, query) {
  const n = normalizeText(name);
  const q = normalizeText(query);
  if (!q) return 1;
  if (n.startsWith(q)) return 3;
  if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

function quickSwitcherItems() {
  const items = [];
  for (const srv of state.servers || []) {
    items.push({ kind: "server", label: srv.name, sub: t("quick.server"), go: () => switchToServerId(srv.id) });
    for (const ch of srv.text_channels || []) {
      const unread = typeof channelUnreadInfo === "function" ? channelUnreadInfo(ch.id) : {};
      items.push({
        kind: "channel",
        label: ch.name,
        prefix: ch.kind === "forum" ? "💬 " : "# ",
        sub: srv.name,
        unread: Boolean(unread.unread || unread.mentions),
        go: () => {
          if (ch.kind === "forum" && typeof openForumView === "function") openForumView(srv, ch);
          else switchToServerId(srv.id, ch.id);
        },
      });
    }
    for (const ch of srv.voice_channels || []) {
      items.push({ kind: "channel", label: ch.name, prefix: "🔊 ", sub: `${srv.name} • ${t("quick.voice")}`, go: () => joinVoiceChannel(ch.id) });
    }
  }
  for (const thread of state.threadIndex?.values?.() || []) {
    if (thread.archived) continue;
    const srv = (state.servers || []).find((s) => s.id === thread.server_id);
    items.push({ kind: "channel", label: thread.name, prefix: "🧵 ", sub: srv?.name || t("quick.thread"), go: () => openThread(thread.id) });
  }
  const seenPeople = new Set();
  for (const c of state.dmConversations || []) {
    seenPeople.add(c.peer.username.toLowerCase());
    items.push({
      kind: "person",
      label: c.peer.display_name || c.peer.username,
      alt: c.peer.username,
      prefix: "@ ",
      sub: t("quick.dm"),
      unread: (state.unreadDms?.get(c.dm_id) || 0) > 0,
      go: () => sendWs("OpenDm", { target_username: c.peer.username }),
    });
  }
  for (const g of state.groupDms || []) {
    items.push({ kind: "person", label: groupDisplayName(g), prefix: "👥 ", sub: t("quick.group"), go: () => openGroupConversation(g.id) });
  }
  for (const f of state.friends || []) {
    if (seenPeople.has(f.username.toLowerCase())) continue;
    items.push({ kind: "person", label: f.display_name || f.username, alt: f.username, prefix: "@ ", sub: t("quick.friend"), go: () => sendWs("OpenDm", { target_username: f.username }) });
  }
  return items;
}

/** Filtra e ordena. Prefixos: "#" canais, "@" pessoas, "*" servidores. */
function rankQuickItems(items, rawQuery, limit = 12) {
  let query = String(rawQuery || "").trim();
  let kind = null;
  if (query.startsWith("#")) kind = "channel";
  else if (query.startsWith("@")) kind = "person";
  else if (query.startsWith("*")) kind = "server";
  if (kind) query = query.slice(1).trim();
  return items
    .filter((it) => !kind || it.kind === kind)
    .map((it) => ({ it, score: Math.max(matchScore(it.label, query), matchScore(it.alt || "", query)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.it.unread || 0) - Number(a.it.unread || 0) || a.it.label.localeCompare(b.it.label))
    .slice(0, limit)
    .map((x) => x.it);
}

const quick = { items: [], shown: [], index: 0 };

function renderQuickSwitcher() {
  const list = document.getElementById("quick-switcher-list");
  const input = document.getElementById("quick-switcher-input");
  if (!list || !input) return;
  quick.shown = rankQuickItems(quick.items, input.value);
  quick.index = Math.min(quick.index, Math.max(0, quick.shown.length - 1));
  list.innerHTML = "";
  if (quick.shown.length === 0) {
    list.innerHTML = `<li class="quick-empty">${SancordUI.emptyHTML({icon:"search",title:t("quick.empty"),description:"Tente outro nome de canal, servidor ou conversa."})}</li>`;
    return;
  }
  quick.shown.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = `quick-item${i === quick.index ? " selected" : ""}${it.unread ? " unread" : ""}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === quick.index));
    const name = document.createElement("span");
    name.className = "quick-name";
    name.textContent = `${it.prefix || ""}${it.label}`;
    const sub = document.createElement("span");
    sub.className = "quick-sub";
    sub.textContent = it.sub || "";
    li.append(name, sub);
    li.addEventListener("mousemove", () => {
      if (quick.index !== i) {
        quick.index = i;
        renderQuickSwitcher();
      }
    });
    li.addEventListener("click", () => chooseQuickItem(i));
    list.appendChild(li);
  });
}

function openQuickSwitcher() {
  const modal = document.getElementById("quick-switcher");
  const input = document.getElementById("quick-switcher-input");
  if (!modal || !input) return;
  quick.items = quickSwitcherItems();
  quick.index = 0;
  input.value = "";
  modal.classList.remove("hidden");
  renderQuickSwitcher();
  setTimeout(() => input.focus(), 0);
}

function closeQuickSwitcher() {
  document.getElementById("quick-switcher")?.classList.add("hidden");
}

function chooseQuickItem(i) {
  const it = quick.shown[i];
  closeQuickSwitcher();
  if (it) it.go();
}

document.getElementById("quick-switcher-input")?.addEventListener("input", () => {
  quick.index = 0;
  renderQuickSwitcher();
});
document.getElementById("quick-switcher-input")?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = quick.shown.length || 1;
    quick.index = (quick.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    renderQuickSwitcher();
    document.querySelector("#quick-switcher-list .selected")?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    chooseQuickItem(quick.index);
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeQuickSwitcher();
  }
});
document.getElementById("quick-switcher")?.addEventListener("mousedown", (e) => {
  if (e.target.id === "quick-switcher") closeQuickSwitcher();
});

// ---------------------------------------------------------------------------
// Atalhos de navegação
// ---------------------------------------------------------------------------

const EXTRA_SHORTCUTS = [
  ["shortcut.quick", "Ctrl + K"],
  ["shortcut.channel", "Alt + ↑ / ↓"],
  ["shortcut.unread", "Alt + Shift + ↑ / ↓"],
  ["shortcut.read", "Esc"],
  ["shortcut.search", "Ctrl + F"],
  ["shortcut.help", "Ctrl + /"],
];

/** Linhas de canal (texto, fórum e threads) na ordem da tela; `onlyUnread` filtra. */
function channelRowsInOrder(onlyUnread) {
  return Array.from(document.querySelectorAll("#channel-tree .channel-item[data-channel-id]")).filter(
    (el) => !el.classList.contains("kind-voice") && (!onlyUnread || el.classList.contains("unread") || el.querySelector(".mention-badge"))
  );
}

function stepChannel(delta, onlyUnread) {
  if (state.activeView === "home") return false;
  const all = channelRowsInOrder(false);
  const current = state.forumViewChannel || state.currentTextChannel;
  const pos = all.findIndex((el) => el.dataset.channelId === current);
  const candidates = onlyUnread ? channelRowsInOrder(true) : all;
  if (candidates.length === 0) {
    if (onlyUnread) showUiToast(t("quick.noUnread"));
    return false;
  }
  let target;
  if (delta > 0) target = candidates.find((el) => all.indexOf(el) > pos) || (onlyUnread ? candidates[0] : null);
  else target = [...candidates].reverse().find((el) => all.indexOf(el) < pos) || (onlyUnread ? candidates[candidates.length - 1] : null);
  if (!target || target.dataset.channelId === current) return false;
  target.click();
  target.scrollIntoView({ block: "nearest" });
  return true;
}

function openShortcutsHelp() {
  if (typeof openSettingsModal === "function") openSettingsModal();
  if (typeof switchSettingsTab === "function") switchSettingsTab("shortcuts");
}

function renderExtraShortcuts() {
  const box = document.getElementById("shortcuts-extra-rows");
  if (!box) return;
  box.innerHTML = "";
  for (const [label, keys] of EXTRA_SHORTCUTS) {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    const span = document.createElement("span");
    span.textContent = t(label);
    const kbd = document.createElement("kbd");
    kbd.textContent = keys;
    row.append(span, kbd);
    box.appendChild(row);
  }
}
renderExtraShortcuts();

/** Esc sem nada aberto: marca o canal atual como lido (como o Discord). */
function markActiveChannelRead() {
  const chId = getActiveTextChannelId();
  if (!chId || (state.activeView === "home" && !state.activeDmId)) return false;
  const list = state.chatHistory[chId] || [];
  const last = list[list.length - 1];
  if (!last) return false;
  const rs = getReadState(chId);
  if ((last.created_at || 0) <= rs.last_read_at && !rs.mention_count) return false;
  if (!sendWs("AckChannel", { channel_id: chId, message_id: last.id })) return false;
  state.suppressAckFor = null;
  rs.last_read_at = Math.max(rs.last_read_at, last.created_at || 0);
  rs.mention_count = 0;
  if (isPrivateTextId(chId)) {
    state.unreadDms.delete(chId);
    renderDmList();
  }
  refreshUnreadIndicators();
  return true;
}

function somethingOpen() {
  return Boolean(
    document.querySelector(
      ".modal-backdrop:not(.hidden), .sancord-dialog-backdrop, .sancord-menu, .msg-context-menu:not(.hidden), .pinned-popover:not(.hidden), .emoji-popover:not(.hidden), .settings-fullscreen:not(.hidden)"
    )
  );
}

function typingInField(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || Boolean(target?.isContentEditable);
}

window.addEventListener(
  "keydown",
  (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      const modal = document.getElementById("quick-switcher");
      if (modal && !modal.classList.contains("hidden")) closeQuickSwitcher();
      else openQuickSwitcher();
      return;
    }
    if (ctrl && e.key === "/") {
      e.preventDefault();
      openShortcutsHelp();
      return;
    }
    if (ctrl && !e.shiftKey && (e.key === "f" || e.key === "F") && typeof chatSearchInput !== "undefined" && chatSearchInput) {
      // Substitui a busca da página do WebView pela busca do Sancord.
      e.preventDefault();
      chatSearchInput.focus();
      chatSearchInput.select();
      return;
    }
    if (e.key === "Escape" && !ctrl && !e.altKey && !somethingOpen()) {
      const t = e.target;
      if (!typingInField(t) || t === chatInput) markActiveChannelRead();
      return;
    }
    if (e.altKey && !ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (typingInField(e.target) && e.target !== chatInput) return;
      e.preventDefault();
      stepChannel(e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
    }
  },
  true
);

// ---------------------------------------------------------------------------
// Reduzir animações
// ---------------------------------------------------------------------------

function applyReduceMotion() {
  const on = Boolean(state.audioSettings?.reduceMotion);
  document.body.classList.toggle("reduce-motion", on);
  const box = document.getElementById("appearance-reduce-motion");
  if (box) box.checked = on;
}

document.getElementById("appearance-reduce-motion")?.addEventListener("change", (e) => {
  state.audioSettings.reduceMotion = Boolean(e.target.checked);
  if (typeof saveAudioSettings === "function") saveAudioSettings();
  applyReduceMotion();
});
applyReduceMotion();

// ---------------------------------------------------------------------------
// Responsividade (seção 56): em janela estreita o painel de membros sai da grade
// e o botão de membros passa a abrir/fechar um painel flutuante.
// ---------------------------------------------------------------------------

const NARROW_QUERY = window.matchMedia ? window.matchMedia("(max-width: 1100px)") : null;

// Se o painel estava aberto antes de a janela estreitar, ele volta ao alargar.
let membersOpenBeforeNarrow = null;

function syncNarrowLayout() {
  if (!NARROW_QUERY || typeof appLayout === "undefined" || !appLayout) return;
  const narrow = NARROW_QUERY.matches;
  const wasNarrow = document.body.classList.contains("narrow-window");
  document.body.classList.toggle("narrow-window", narrow);
  if (narrow && !wasNarrow) {
    membersOpenBeforeNarrow = !appLayout.classList.contains("hide-members");
  }
  if (narrow && !appLayout.classList.contains("force-members")) {
    appLayout.classList.add("hide-members");
    toggleMembersBtn?.classList.remove("active");
  }
  if (!narrow && wasNarrow) {
    appLayout.classList.remove("force-members");
    const homeWithoutDm = state.activeView === "home" && !state.activeDmId;
    if (membersOpenBeforeNarrow && !homeWithoutDm) {
      appLayout.classList.remove("hide-members");
      toggleMembersBtn?.classList.add("active");
    }
    membersOpenBeforeNarrow = null;
  }
}

NARROW_QUERY?.addEventListener?.("change", syncNarrowLayout);
// Algumas mudanças de tamanho não disparam "change": confere também no resize.
let narrowResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(narrowResizeTimer);
  narrowResizeTimer = setTimeout(syncNarrowLayout, 120);
});
syncNarrowLayout();

// Clique fora fecha o painel flutuante de membros (só na janela estreita).
document.addEventListener("mousedown", (e) => {
  if (!NARROW_QUERY?.matches || !appLayout?.classList.contains("force-members")) return;
  const panel = document.querySelector(".members-sidebar");
  if (panel?.contains(e.target) || toggleMembersBtn?.contains(e.target)) return;
  appLayout.classList.remove("force-members");
  appLayout.classList.add("hide-members");
  toggleMembersBtn?.classList.remove("active");
});

// ---------------------------------------------------------------------------
// Idioma (seção 70): seletor em Aparência; textos marcados mudam na hora.
// ---------------------------------------------------------------------------

const languageSelect = document.getElementById("settings-language");
if (languageSelect && typeof currentLanguage === "function") {
  languageSelect.value = currentLanguage();
  languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));
}
document.addEventListener("sancord:language", () => {
  // Textos montados por código que usam t().
  if (typeof setAuthMode === "function" && typeof authMode !== "undefined") setAuthMode(authMode);
  renderExtraShortcuts();
  const modal = document.getElementById("quick-switcher");
  if (modal && !modal.classList.contains("hidden")) {
    quick.items = quickSwitcherItems();
    renderQuickSwitcher();
  }
});

// ---------------------------------------------------------------------------
// Proteção de links externos — confirmação antes de sair do Sancord por um
// link de mensagem. Domínios confirmados com "confiar" ficam só neste aparelho.
// ---------------------------------------------------------------------------
const LINK_TRUST_KEY = "sancord_trusted_domains";

function linkHost(href) {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch (_) {
    return null;
  }
}

function trustedLinkDomains() {
  try {
    const list = JSON.parse(localStorage.getItem(LINK_TRUST_KEY) || "[]");
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

/** Pede confirmação? Só para http(s) com a proteção ligada e domínio ainda não confiável. */
function linkNeedsConfirmation(href, guardOn, trusted) {
  const host = linkHost(href);
  if (!guardOn || !host) return false;
  return !trusted.has(host);
}

function trustLinkDomain(host) {
  const set = trustedLinkDomains();
  set.add(host);
  try {
    localStorage.setItem(LINK_TRUST_KEY, JSON.stringify([...set].slice(-200)));
  } catch (_) {}
}

document.addEventListener(
  "click",
  async (e) => {
    const a = e.target?.closest?.("a.chat-link");
    if (!a || e.button !== 0) return;
    const href = a.href;
    if (!linkNeedsConfirmation(href, state.audioSettings?.linkGuard !== false, trustedLinkDomains())) return;
    e.preventDefault();
    e.stopPropagation();
    const host = linkHost(href);
    const values = await SancordUI.formDialog({
      title: "Sair do Sancord?",
      description: `Este link leva para ${host} (${href.slice(0, 200)}). Confira se é o site que você espera antes de continuar.`,
      fields: [{ name: "trust", type: "checklist", value: [], options: [{ value: "yes", label: `Confiar em ${host} a partir de agora` }] }],
      submitLabel: "Abrir link",
    });
    if (!values) return;
    if ((values.trust || []).includes("yes")) trustLinkDomain(host);
    window.open(href, "_blank", "noopener,noreferrer");
  },
  true,
);
