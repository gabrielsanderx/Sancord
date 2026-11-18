// ============================================================================
// Sancord — Recursos avançados (Fase 8)
//   Busca no histórico completo (com filtros), AutoMod e registro de auditoria.
//   Toda decisão de acesso é do servidor; aqui só montamos pedidos e exibimos.
// Depende de globais do app.js (state, sendWs, escapeHtml, editingServerId...).
// ============================================================================

const AUDIT_LABELS = {
  integration_create: "criou a integração",
  integration_rotate: "renovou a credencial de",
  integration_revoke: "revogou a integração",
  member_kick: "expulsou",
  member_timeout: "aplicou castigo em",
  member_timeout_removed: "removeu o castigo de",
  member_ban: "baniu",
  member_unban: "desbaniu",
  member_roles: "alterou os cargos de",
  role_create: "criou o cargo",
  role_update: "editou o cargo",
  role_delete: "excluiu o cargo",
  role_reorder: "reordenou os cargos",
  channel_create: "criou o canal",
  channel_update: "editou o canal",
  channel_delete: "excluiu o canal",
  channel_permissions: "alterou permissões do canal",
  category_create: "criou a categoria",
  category_delete: "excluiu a categoria",
  category_permissions: "alterou permissões da categoria",
  invite_create: "criou o convite",
  invite_revoke: "revogou o convite",
  server_update: "editou o servidor",
  message_delete: "excluiu uma mensagem de",
  message_pin: "fixou uma mensagem de",
  message_unpin: "desafixou uma mensagem de",
  voice_mute: "silenciou na voz",
  voice_unmute: "removeu o silêncio de",
  voice_deafen: "ensurdeceu na voz",
  voice_undeafen: "removeu a surdez de",
  voice_move: "moveu de canal de voz",
  voice_disconnect: "desconectou da voz",
  automod_update: "alterou o AutoMod",
  automod_block: "bloqueou uma mensagem de",
};

const auditState = { serverId: null, entries: [], hasMore: false, loading: false };

function onServerSettingsTabOpened(tab) {
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (!srv) return;
  if (tab === "integrations") {
    openIntegrationsPanel(srv);
  } else if (tab === "automod") {
    fillAutoModForm(srv, null);
    sendWs("GetAutoMod", { server_id: srv.id });
  } else if (tab === "audit") {
    fillAuditFilter();
    loadAuditLog(true);
  }
}

// ---------------------------------------------------------------------------
// AutoMod
// ---------------------------------------------------------------------------

function fillAutoModForm(srv, cfg) {
  const c = cfg || {};
  const set = (id, prop, v) => {
    const el = document.getElementById(id);
    if (el) el[prop] = v;
  };
  if (cfg) {
    set("automod-enabled", "checked", Boolean(c.enabled));
    set("automod-words", "value", (c.blocked_words || []).join("\n"));
    set("automod-links", "checked", Boolean(c.block_links));
    set("automod-invites", "checked", Boolean(c.block_invites));
    set("automod-repeats", "checked", Boolean(c.block_repeats));
    set("automod-domains", "value", (c.allowed_domains || []).join("\n"));
    set("automod-mentions", "value", String(c.max_mentions || 0));
  }
  const select = document.getElementById("automod-alert-channel");
  if (select) {
    select.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Sem canal de alertas";
    select.appendChild(none);
    for (const ch of srv.text_channels || []) {
      const o = document.createElement("option");
      o.value = ch.id;
      o.textContent = `#${ch.name}`;
      select.appendChild(o);
    }
    select.value = c.alert_channel_id || "";
  }
  const roles = document.getElementById("automod-exempt-roles");
  if (roles) {
    roles.innerHTML = "";
    const exempt = new Set(c.exempt_roles || []);
    const list = (srv.roles || []).filter((r) => r.id !== "everyone");
    if (list.length === 0) roles.innerHTML = `<div class="settings-hint-text">Nenhum cargo criado.</div>`;
    for (const r of list) {
      const lab = document.createElement("label");
      lab.className = "sancord-check-option";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = r.id;
      box.checked = exempt.has(r.id);
      const name = document.createElement("span");
      name.textContent = r.name;
      lab.append(box, name);
      roles.appendChild(lab);
    }
  }
}

function onAutoModSettings({ server_id, config }) {
  if (server_id !== editingServerId) return;
  const srv = (state.servers || []).find((s) => s.id === server_id);
  if (srv) fillAutoModForm(srv, config);
  const fb = document.getElementById("automod-feedback");
  if (fb) fb.textContent = config.enabled ? "AutoMod ativo." : "AutoMod desligado.";
}

function collectAutoModForm() {
  const val = (id) => document.getElementById(id)?.value || "";
  const checked = (id) => Boolean(document.getElementById(id)?.checked);
  const lines = (id) => val(id).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    enabled: checked("automod-enabled"),
    blocked_words: lines("automod-words"),
    block_links: checked("automod-links"),
    allowed_domains: lines("automod-domains"),
    block_invites: checked("automod-invites"),
    block_repeats: checked("automod-repeats"),
    max_mentions: Math.max(0, Math.min(50, parseInt(val("automod-mentions"), 10) || 0)),
    exempt_roles: Array.from(document.querySelectorAll("#automod-exempt-roles input:checked")).map((b) => b.value),
    alert_channel_id: val("automod-alert-channel") || null,
  };
}

document.getElementById("automod-save-btn")?.addEventListener("click", () => {
  if (!editingServerId) return;
  sendWs("UpdateAutoMod", { server_id: editingServerId, config: collectAutoModForm() });
});

// ---------------------------------------------------------------------------
// Registro de auditoria
// ---------------------------------------------------------------------------

function fillAuditFilter() {
  const sel = document.getElementById("audit-action-filter");
  if (!sel || sel.options.length > 1) return;
  for (const [key, label] of Object.entries(AUDIT_LABELS)) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    sel.appendChild(o);
  }
}

function loadAuditLog(reset) {
  if (!editingServerId || auditState.loading) return;
  if (reset) {
    auditState.serverId = editingServerId;
    auditState.entries = [];
    auditState.hasMore = false;
    const list = document.getElementById("audit-list");
    if (list) list.innerHTML = `<div class="pinned-empty">Carregando…</div>`;
  }
  const last = auditState.entries[auditState.entries.length - 1];
  auditState.loading = true;
  sendWs("GetAuditLog", {
    server_id: editingServerId,
    before: reset || !last ? null : last.created_at,
    action: document.getElementById("audit-action-filter")?.value || null,
  });
}

function formatDateTime(ms) {
  try {
    return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

function auditSentence(e) {
  const verb = AUDIT_LABELS[e.action] || e.action;
  return `${e.actor === "automod" ? "AutoMod" : e.actor} ${verb}${e.target ? ` ${e.target}` : ""}`;
}

function onAuditLog({ server_id, entries, has_more }) {
  auditState.loading = false;
  if (server_id !== auditState.serverId) return;
  auditState.entries.push(...(entries || []));
  auditState.hasMore = Boolean(has_more);
  const list = document.getElementById("audit-list");
  if (!list) return;
  list.innerHTML = "";
  if (auditState.entries.length === 0) {
    list.innerHTML = `<div class="pinned-empty">Nenhuma ação registrada ainda.</div>`;
  }
  for (const e of auditState.entries) {
    const row = document.createElement("div");
    row.className = "srv-manage-row audit-row";
    const main = document.createElement("div");
    main.className = "audit-main";
    const strong = document.createElement("strong");
    strong.textContent = auditSentence(e);
    main.appendChild(strong);
    if (e.details) {
      const d = document.createElement("div");
      d.className = "settings-hint-text";
      d.textContent = e.details;
      main.appendChild(d);
    }
    const when = document.createElement("span");
    when.className = "audit-when";
    when.textContent = formatDateTime(e.created_at);
    row.append(main, when);
    list.appendChild(row);
  }
  document.getElementById("audit-more-btn")?.classList.toggle("hidden", !auditState.hasMore);
}

document.getElementById("audit-refresh-btn")?.addEventListener("click", () => loadAuditLog(true));
document.getElementById("audit-action-filter")?.addEventListener("change", () => loadAuditLog(true));
document.getElementById("audit-more-btn")?.addEventListener("click", () => loadAuditLog(false));

// ---------------------------------------------------------------------------
// Busca no histórico
// ---------------------------------------------------------------------------

/** Data AAAA-MM-DD (ou DD/MM/AAAA) para ms; `endOfDay` inclui o dia inteiro. */
function parseSearchDate(raw, endOfDay) {
  let y, m, d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match) [, y, m, d] = match;
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw))) [, d, m, y] = match;
  else return null;
  const date = new Date(Number(y), Number(m) - 1, Number(d), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** "relatório de:ana tem:link antes:2026-11-01" -> pedido de busca. */
function parseSearchQuery(text) {
  const out = { query: "", author: null, has: null, before: null, after: null, pinned: false, mentions_me: false };
  const words = [];
  const hasMap = { link: "link", links: "link", arquivo: "file", arquivos: "file", file: "file", imagem: "image", imagens: "image", image: "image" };
  for (const token of String(text || "").trim().split(/\s+/).filter(Boolean)) {
    const [rawKey, ...rest] = token.split(":");
    const key = rawKey.toLowerCase();
    const value = rest.join(":");
    if (rest.length && (key === "de" || key === "from") && value) out.author = value.replace(/^@/, "");
    else if (rest.length && (key === "tem" || key === "has") && hasMap[value.toLowerCase()]) out.has = hasMap[value.toLowerCase()];
    else if (rest.length && (key === "antes" || key === "before") && parseSearchDate(value, false) !== null) out.before = parseSearchDate(value, false);
    else if (rest.length && (key === "depois" || key === "after") && parseSearchDate(value, true) !== null) out.after = parseSearchDate(value, true);
    else if (rest.length && (key === "menciona" || key === "mentions") && /^(eu|me|mim)$/i.test(value)) out.mentions_me = true;
    else if (["fixadas", "fixada", "pinned"].includes(key) && (!rest.length || /^(sim|true|1)$/i.test(value))) out.pinned = true;
    else words.push(token);
  }
  out.query = words.join(" ");
  return out;
}

const searchState = { seq: 0, lastRequest: null, terms: [] };

function searchPanel() {
  return document.getElementById("search-results-panel");
}

function hideSearchResults() {
  searchPanel()?.classList.add("hidden");
}

function runServerSearch(text) {
  const parsed = parseSearchQuery(text);
  const hasFilter = parsed.query || parsed.author || parsed.has || parsed.pinned || parsed.mentions_me;
  if (!hasFilter) {
    hideSearchResults();
    return;
  }
  const scope = document.getElementById("search-scope")?.value || "here";
  const payload = { ...parsed, request_id: `s${++searchState.seq}` };
  if (scope === "here") {
    if (state.activeView === "home" && state.activeDmId) payload.channel_id = state.activeDmId;
    else if (state.activeView !== "home") payload.server_id = getActiveServer()?.id || null;
    else payload.private_only = true;
  }
  searchState.lastRequest = payload.request_id;
  searchState.terms = parsed.query.toLowerCase().split(/\s+/).filter(Boolean);
  const panel = searchPanel();
  const list = document.getElementById("search-results-list");
  if (list) list.innerHTML = `<div class="pinned-empty">Buscando…</div>`;
  panel?.classList.remove("hidden");
  sendWs("SearchMessages", payload);
}

function onSearchResults({ request_id, hits, has_more }) {
  if (request_id && request_id !== searchState.lastRequest) return; // resposta antiga
  const list = document.getElementById("search-results-list");
  const title = document.getElementById("search-results-title");
  if (!list) return;
  const n = (hits || []).length;
  if (title) title.textContent = `🔎 ${n}${has_more ? "+" : ""} resultado${n === 1 ? "" : "s"}`;
  list.innerHTML = "";
  if (n === 0) {
    list.innerHTML = `<div class="pinned-empty">Nada encontrado. Dica: de:nome, tem:link, fixadas, antes:2026-11-01.</div>`;
    return;
  }
  for (const hit of hits) {
    const m = hit.message;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "search-hit";
    const where = document.createElement("div");
    where.className = "search-hit-where";
    where.textContent = `${hit.server_name ? `${hit.server_name} • ` : ""}${hit.channel_name.startsWith("@") ? hit.channel_name : hit.server_id ? `#${hit.channel_name}` : hit.channel_name}`;
    const head = document.createElement("div");
    head.className = "search-hit-head";
    const author = document.createElement("strong");
    author.textContent = m.author_name;
    const when = document.createElement("span");
    when.textContent = formatDateTime(m.created_at);
    head.append(author, when);
    const body = document.createElement("div");
    body.className = "search-hit-body";
    const text = m.content || (m.attachments?.length ? `📎 ${m.attachments.map((a) => a.filename).join(", ")}` : m.image_url ? "📷 Imagem" : "");
    body.textContent = text.length > 220 ? `${text.slice(0, 220)}…` : text;
    row.append(where, head, body);
    row.addEventListener("click", () => {
      hideSearchResults();
      jumpToMessage(m.channel_id, m.id);
    });
    list.appendChild(row);
  }
  if (has_more) {
    const more = document.createElement("div");
    more.className = "pinned-empty";
    more.textContent = "Mostrando os 25 mais recentes. Refine a busca para ver outros.";
    list.appendChild(more);
  }
}

document.getElementById("search-scope")?.addEventListener("change", () => {
  if (chatSearchInput?.value.trim()) runServerSearch(chatSearchInput.value);
});

document.addEventListener("mousedown", (e) => {
  const panel = searchPanel();
  if (panel && !panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== chatSearchInput) {
    hideSearchResults();
  }
});

// ---------------------------------------------------------------------------
// Castigo (timeout) de membros — o servidor autoriza e aplica; aqui só
// mostramos o estado e montamos o pedido.
// ---------------------------------------------------------------------------
const TIMEOUT_CHOICES = [
  [60, "60 segundos"], [300, "5 minutos"], [600, "10 minutos"],
  [3600, "1 hora"], [86400, "1 dia"], [604800, "1 semana"],
];

/** Fim do castigo (ms) se ainda estiver valendo; senão null. */
function memberTimeoutUntil(srv, lower, now = Date.now()) {
  const until = srv?.member_timeouts?.[String(lower || "").toLowerCase()];
  return typeof until === "number" && until > now ? until : null;
}

/** "14:30" no mesmo dia; "20/11, 14:30" em outro dia (fuso de quem lê). */
function formatTimeoutEnd(until, now = Date.now()) {
  const end = new Date(until);
  const sameDay = end.toDateString() === new Date(now).toDateString();
  return sameDay
    ? end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : end.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Espelho da regra do servidor, só para decidir se o botão aparece. */
function canTimeoutMember(srv, target) {
  const me = state.selfUser?.username?.toLowerCase();
  const who = String(target || "").toLowerCase();
  if (!srv || srv.id === "sancord" || !me || !who || who === me || isServerOwner(srv, who)) return false;
  if (!(srv.members || []).includes(who)) return false;
  if (getServerPermissionsFor(srv, who).administrator) return false;
  if (isServerOwner(srv, me)) return true;
  const mine = getServerPermissionsFor(srv, me);
  if (!mine.moderate_members && !mine.administrator) return false;
  const top = (name) => Math.max(0, ...getUserServerRoles(srv, name).map((r) => r.position || 0));
  return top(who) < top(me);
}

async function openTimeoutDialog(srv, target, displayName) {
  const values = await SancordUI.formDialog({
    title: `Castigo — ${displayName}`,
    description: "Durante o castigo a pessoa continua lendo os canais, mas não envia mensagens, não reage e não entra na voz deste servidor. Termina sozinho no fim do prazo.",
    fields: [
      { name: "duration", label: "DURAÇÃO", type: "select", value: "600", options: TIMEOUT_CHOICES.map(([secs, label]) => ({ value: String(secs), label })) },
      { name: "reason", label: "MOTIVO (OPCIONAL, VAI PARA A AUDITORIA)", type: "textarea", rows: 2, maxlength: 300 },
    ],
    submitLabel: "Aplicar castigo",
    danger: true,
  });
  if (!values) return;
  sendWs("TimeoutMember", {
    server_id: srv.id,
    target_username: target,
    duration_secs: Number(values.duration),
    reason: (values.reason || "").trim() || null,
  });
}

async function removeMemberTimeout(srv, target, displayName) {
  const ok = await SancordUI.confirm({
    title: "Remover castigo?",
    message: `${displayName} volta a enviar mensagens e a usar a voz agora.`,
    confirmLabel: "Remover castigo",
  });
  if (ok) sendWs("TimeoutMember", { server_id: srv.id, target_username: target, duration_secs: 0 });
}

/** Itens de menu de castigo para um membro (vazio se não houver permissão). */
function timeoutMenuItems(srv, target, displayName) {
  if (!canTimeoutMember(srv, target)) return [];
  const until = memberTimeoutUntil(srv, target);
  return until
    ? [{ label: `Remover castigo (até ${formatTimeoutEnd(until)})`, icon: "⏱️", onSelect: () => removeMemberTimeout(srv, target, displayName) }]
    : [{ label: "Aplicar castigo…", icon: "⏱️", danger: true, onSelect: () => openTimeoutDialog(srv, target, displayName) }];
}

/** Castigos ativos da própria pessoa: [{ server, until }], do que termina antes. */
function selfActiveTimeouts(servers, me, now = Date.now()) {
  return (servers || [])
    .map((srv) => ({ server: srv, until: memberTimeoutUntil(srv, me, now) }))
    .filter((x) => x.until)
    .sort((a, b) => a.until - b.until);
}

/** "Status da conta" com dados reais (castigos ativos nos seus servidores). */
function renderAccountStanding() {
  const card = document.getElementById("account-standing-card");
  if (!card) return;
  const list = selfActiveTimeouts(state.servers, state.selfUser?.username);
  const icon = document.getElementById("account-standing-icon");
  const title = document.getElementById("account-standing-title");
  const text = document.getElementById("account-standing-text");
  card.classList.toggle("has-restriction", list.length > 0);
  if (icon) icon.textContent = list.length ? "⏱️" : "✓";
  if (title) title.textContent = list.length ? `De castigo em ${list.length} ${list.length === 1 ? "servidor" : "servidores"}` : "Nenhuma restrição ativa";
  if (text) {
    text.textContent = list.length
      ? list.map((x) => `${x.server.name}: até ${formatTimeoutEnd(x.until)}`).join(" • ") + ". Você continua lendo, mas não envia mensagens, não reage e não entra na voz nesses servidores."
      : "Você não está de castigo em nenhum dos seus servidores.";
  }
}
