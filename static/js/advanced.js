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
  member_nick: "alterou o apelido de",
  emoji_create: "adicionou um emoji",
  emoji_update: "renomeou um emoji",
  emoji_delete: "excluiu um emoji",
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
  server_transfer_ownership: "transferiu a posse do servidor para",
  message_bulk_delete: "limpou mensagens em",
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
  } else if (tab === "emojis") {
    renderEmojiSettings(srv);
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
    list.innerHTML = SancordUI.emptyHTML({icon:"shield",title:"Nenhuma ação registrada",description:"As ações de moderação deste servidor aparecerão aqui."});
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
// Busca no histórico — parser compartilhado (a UI completa está em search.js)
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

/**
 * Interpreta texto livre e filtros em português/inglês:
 * "minecraft de:Gabriel em:#geral tem:imagem depois:2026-01-01 menciona:@Ana fixadas"
 */
function parseSearchQuery(text) {
  const tokens = [];
  const src = String(text || "").trim();
  let cur = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);

  const out = {
    query: "",
    author: null,
    in_channel: null,
    has: null,
    has_list: [],
    before: null,
    before_raw: null,
    after: null,
    after_raw: null,
    during_raw: null,
    pinned: false,
    mentions_me: false,
    mentions_user: null,
    filters: [],
  };
  const words = [];
  const hasMap = {
    link: "link", links: "link",
    arquivo: "file", arquivos: "file", file: "file",
    imagem: "image", imagens: "image", image: "image",
    video: "video", vídeo: "video", videos: "video", vídeos: "video",
    audio: "audio", áudio: "audio", audios: "audio", áudios: "audio", voz: "audio",
    embed: "embed", embeds: "embed",
    reacao: "reaction", reação: "reaction", reacoes: "reaction", reações: "reaction", reaction: "reaction",
    enquete: "poll", enquetes: "poll", poll: "poll",
  };
  for (const token of tokens) {
    const colon = token.indexOf(":");
    const hasColon = colon > 0;
    const key = (hasColon ? token.slice(0, colon) : token).toLowerCase();
    const value = hasColon ? token.slice(colon + 1) : "";

    if (hasColon && (key === "de" || key === "from") && value) {
      out.author = value.replace(/^@/, "");
      out.filters.push({ kind: "author", label: `De: ${out.author}`, raw: token });
    } else if (hasColon && (key === "em" || key === "in") && value) {
      out.in_channel = value.replace(/^#/, "");
      out.filters.push({ kind: "in_channel", label: `Em: #${out.in_channel}`, raw: token });
    } else if (hasColon && (key === "tem" || key === "has") && hasMap[value.toLowerCase()]) {
      const norm = hasMap[value.toLowerCase()];
      if (!out.has_list.includes(norm)) {
        out.has_list.push(norm);
        out.filters.push({ kind: "has", value: norm, label: `Tem: ${value.toLowerCase()}`, raw: token });
      }
      out.has = out.has_list[0] || null;
    } else if (hasColon && (key === "antes" || key === "before") && parseSearchDate(value, false) !== null) {
      out.before = parseSearchDate(value, false);
      out.before_raw = value;
      out.filters.push({ kind: "before", label: `Antes: ${value}`, raw: token });
    } else if (hasColon && (key === "depois" || key === "after") && parseSearchDate(value, true) !== null) {
      out.after = parseSearchDate(value, true);
      out.after_raw = value;
      out.filters.push({ kind: "after", label: `Depois: ${value}`, raw: token });
    } else if (hasColon && (key === "durante" || key === "during" || key === "data") && parseSearchDate(value, false) !== null) {
      const start = parseSearchDate(value, false);
      const end = parseSearchDate(value, true);
      out.after = start - 1;
      out.before = end + 1;
      out.during_raw = value;
      out.filters.push({ kind: "during", label: `Em: ${value}`, raw: token });
    } else if (hasColon && ["menciona", "menções", "mencoes", "mentions"].includes(key) && value) {
      const clean = value.replace(/^@/, "");
      if (/^(eu|me|mim)$/i.test(clean)) {
        out.mentions_me = true;
        out.filters.push({ kind: "mentions_me", label: "Menciona: você", raw: token });
      } else if (clean) {
        out.mentions_user = clean;
        out.filters.push({ kind: "mentions_user", label: `Menciona: @${clean}`, raw: token });
      }
    } else if (["fixadas", "fixada", "pinned"].includes(key) && (!hasColon || /^(sim|true|1)$/i.test(value))) {
      out.pinned = true;
      out.filters.push({ kind: "pinned", label: "Fixadas", raw: token });
    } else {
      words.push(token);
    }
  }
  out.query = words.join(" ");
  return out;
}

function hideSearchResults() {
  if (typeof SancordSearch !== "undefined") SancordSearch.hide();
  else document.getElementById("search-results-panel")?.classList.add("hidden");
}

function runServerSearch(text, opts) {
  if (typeof SancordSearch !== "undefined") SancordSearch.run(text, opts);
}

function onSearchResults(payload) {
  if (typeof SancordSearch !== "undefined") SancordSearch.onResults(payload);
}

function onMessageContext(payload) {
  if (typeof SancordSearch !== "undefined") SancordSearch.onContext(payload);
}

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

const BAN_DELETE_CHOICES = [
  [0, "Não apagar nenhuma mensagem"],
  [3600, "Última 1 hora"],
  [86400, "Últimas 24 horas"],
  [604800, "Últimos 7 dias"],
];

function canKickMember(srv, target) {
  const me = state.selfUser?.username?.toLowerCase();
  const who = String(target || "").toLowerCase();
  if (!srv || srv.id === "sancord" || !me || !who || who === me || isServerOwner(srv, who)) return false;
  if (!(srv.members || []).includes(who)) return false;
  if (isServerOwner(srv, me)) return true;
  const mine = getServerPermissionsFor(srv, me);
  if (!mine.kick_members && !mine.administrator) return false;
  const top = (name) => Math.max(0, ...getUserServerRoles(srv, name).map((r) => r.position || 0));
  return top(who) < top(me);
}

function canBanMember(srv, target) {
  const me = state.selfUser?.username?.toLowerCase();
  const who = String(target || "").toLowerCase();
  if (!srv || srv.id === "sancord" || !me || !who || who === me || isServerOwner(srv, who)) return false;
  if (isServerOwner(srv, me)) return true;
  const mine = getServerPermissionsFor(srv, me);
  if (!mine.ban_members && !mine.administrator) return false;
  const top = (name) => Math.max(0, ...getUserServerRoles(srv, name).map((r) => r.position || 0));
  return top(who) < top(me);
}

function canTransferOwnership(srv, target) {
  const me = state.selfUser?.username?.toLowerCase();
  const who = String(target || "").toLowerCase();
  if (!srv || srv.id === "sancord" || !me || !who || who === me) return false;
  return isServerOwner(srv, me) && (srv.members || []).includes(who);
}

async function openKickDialog(srv, target, displayName) {
  const values = await SancordUI.formDialog({
    title: `Expulsar ${displayName} de ${srv.name}?`,
    description: "A pessoa será removida do servidor, mas poderá entrar novamente se receber um novo convite.",
    fields: [
      { name: "reason", label: "MOTIVO DA EXPULSÃO (OPCIONAL, VAI PARA A AUDITORIA)", type: "textarea", rows: 2, maxlength: 240, placeholder: "Ex: Violação das regras do canal" },
    ],
    submitLabel: "Expulsar",
    danger: true,
  });
  if (!values) return;
  sendWs("KickServerMember", {
    server_id: srv.id,
    target_username: String(target || "").toLowerCase(),
    reason: (values.reason || "").trim() || null,
  });
}

async function openBanDialog(srv, target, displayName) {
  const values = await SancordUI.formDialog({
    title: `Banir ${displayName} de ${srv.name}?`,
    description: "A pessoa será removida permanentemente e não poderá voltar com convites até ser desbanida.",
    fields: [
      {
        name: "delete_secs",
        label: "HISTÓRICO DE MENSAGENS A APAGAR",
        type: "select",
        value: "0",
        options: BAN_DELETE_CHOICES.map(([secs, label]) => ({ value: String(secs), label })),
      },
      { name: "reason", label: "MOTIVO DO BANIMENTO (OPCIONAL, VAI PARA A AUDITORIA)", type: "textarea", rows: 2, maxlength: 240, placeholder: "Ex: Spam / links maliciosos" },
    ],
    submitLabel: "Banir membro",
    danger: true,
  });
  if (!values) return;
  sendWs("BanServerMember", {
    server_id: srv.id,
    target_username: String(target || "").toLowerCase(),
    reason: (values.reason || "").trim() || null,
    delete_message_seconds: Number(values.delete_secs) || 0,
  });
}

async function openTransferOwnershipDialog(srv, target, displayName) {
  const values = await SancordUI.formDialog({
    title: `Transferir posse de "${srv.name}"?`,
    description: `Você está prestes a transferir a posse definitiva de "${srv.name}" para ${displayName}. Digite o nome exato do servidor para confirmar.`,
    fields: [
      { name: "confirm_name", label: `DIGITE "${srv.name}" PARA CONFIRMAR`, value: "", required: true, maxlength: 60 },
    ],
    submitLabel: "Transferir posse",
    danger: true,
  });
  if (!values) return;
  if ((values.confirm_name || "").trim() !== srv.name) {
    showUiToast("O nome digitado não corresponde ao nome do servidor.");
    return;
  }
  sendWs("TransferServerOwnership", {
    server_id: srv.id,
    new_owner_username: String(target || "").toLowerCase(),
  });
}

async function openBulkDeleteDialog(srv, ch) {
  const values = await SancordUI.formDialog({
    title: `Limpar mensagens em #${ch.name}`,
    description: "Apaga em lote as mensagens mais recentes deste canal (mensagens fixadas são preservadas).",
    fields: [
      {
        name: "count",
        label: "QUANTIDADE DE MENSAGENS RECENTES",
        type: "select",
        value: "10",
        options: [
          { value: "10", label: "Últimas 10 mensagens" },
          { value: "25", label: "Últimas 25 mensagens" },
          { value: "50", label: "Últimas 50 mensagens" },
          { value: "100", label: "Últimas 100 mensagens" },
        ],
      },
      { name: "author", label: "FILTRAR POR AUTOR (OPCIONAL)", value: "", maxlength: 24, placeholder: "Deixe em branco para todos os autores" },
    ],
    submitLabel: "Apagar mensagens",
    danger: true,
  });
  if (!values) return;
  sendWs("BulkDeleteMessages", {
    channel_id: ch.id,
    count: Number(values.count) || 10,
    author_username: (values.author || "").trim() || null,
  });
}

/** Todos os itens de moderação de membro (castigo, expulsar, banir, transferir posse). */
function memberModerationMenuItems(srv, target, displayName) {
  const out = [...timeoutMenuItems(srv, target, displayName)];
  if (canKickMember(srv, target)) {
    out.push({ label: "Expulsar do servidor…", icon: "👢", danger: true, onSelect: () => openKickDialog(srv, target, displayName) });
  }
  if (canBanMember(srv, target)) {
    out.push({ label: "Banir do servidor…", icon: "🔨", danger: true, onSelect: () => openBanDialog(srv, target, displayName) });
  }
  if (canTransferOwnership(srv, target)) {
    out.push({ label: "Transferir posse do servidor…", icon: "👑", danger: true, onSelect: () => openTransferOwnershipDialog(srv, target, displayName) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Etapa C4: menu completo do usuário (lista de membros) e apelido por servidor.
// O servidor decide tudo; aqui só escondemos o que certamente seria recusado.
// ---------------------------------------------------------------------------
function memberTopPosition(srv, name) {
  return Math.max(0, ...getUserServerRoles(srv, name).map((r) => r.position || 0));
}

/** Pode mudar o apelido de `target`? (o próprio: change_nickname; outros: manage_nicknames + hierarquia) */
function canChangeNickname(srv, target) {
  const me = state.selfUser?.username?.toLowerCase();
  const who = String(target || "").toLowerCase();
  if (!srv || srv.id === "sancord" || !me || !who || !(srv.members || []).includes(who)) return false;
  if (isServerOwner(srv, me)) return true;
  const mine = getServerPermissionsFor(srv, me);
  if (who === me) {
    if (memberTimeoutUntil(srv, me)) return false;
    return mine.change_nickname !== false || Boolean(mine.manage_nicknames);
  }
  if (!mine.manage_nicknames || isServerOwner(srv, who)) return false;
  return memberTopPosition(srv, who) < memberTopPosition(srv, me);
}

/** Pode editar os cargos de `target`? Espelha `authorize_assignment` do servidor. */
function canEditMemberRoles(srv, target) {
  const me = state.selfUser?.username?.toLowerCase();
  const who = String(target || "").toLowerCase();
  if (!srv || srv.id === "sancord" || !me || !who || !(srv.members || []).includes(who)) return false;
  if (isServerOwner(srv, me)) return true;
  const mine = getServerPermissionsFor(srv, me);
  if (!mine.manage_roles && !mine.administrator) return false;
  if (who === me || isServerOwner(srv, who)) return false;
  return memberTopPosition(srv, who) < memberTopPosition(srv, me);
}

async function openNicknameDialog(srv, target, username) {
  const current = memberNickname(srv, target) || "";
  const self = String(target).toLowerCase() === state.selfUser?.username?.toLowerCase();
  const values = await SancordUI.formDialog({
    title: self ? `Seu apelido em ${srv.name}` : `Apelido de ${username} em ${srv.name}`,
    description: "O apelido só vale neste servidor. Deixe vazio para usar o nome de usuário.",
    fields: [{ name: "nickname", label: "APELIDO", value: current, maxlength: 32, placeholder: username }],
    submitLabel: "Salvar",
    extraAction: current ? { label: "Remover apelido", onSelect: () => sendWs("SetMemberNickname", { server_id: srv.id, target_username: target, nickname: null }) } : null,
  });
  if (!values) return;
  const nickname = values.nickname.trim();
  if (nickname === current) return;
  sendWs("SetMemberNickname", { server_id: srv.id, target_username: target, nickname: nickname || null });
}

async function openMemberRolesDialog(srv, target, displayName) {
  const me = state.selfUser?.username?.toLowerCase();
  const owner = isServerOwner(srv, me);
  const myTop = memberTopPosition(srv, me);
  const current = srv.member_roles?.[String(target).toLowerCase()] || [];
  const options = [...(srv.roles || [])]
    .filter((r) => r.id !== "everyone")
    .sort((a, b) => (b.position || 0) - (a.position || 0))
    .map((r) => ({
      value: r.id,
      label: `${r.badge_emoji ? `${r.badge_emoji} ` : ""}${r.name}`,
      disabled: !owner && (r.position || 0) >= myTop,
      hint: !owner && (r.position || 0) >= myTop ? "Acima do seu cargo mais alto" : "",
    }));
  const values = await SancordUI.formDialog({
    title: `Cargos de ${displayName}`,
    fields: [{ name: "roles", label: "CARGOS", type: "checklist", value: current, options, emptyText: "Este servidor ainda não tem cargos além de @everyone." }],
    submitLabel: "Salvar cargos",
  });
  if (!values) return;
  // Caixas desativadas continuam marcadas: cargos superiores não são removidos sem querer.
  const next = values.roles;
  const same = next.length === current.length && next.every((id) => current.includes(id));
  if (!same) sendWs("AssignUserRoles", { server_id: srv.id, target_username: target, role_ids: next });
}

/** Insere "@nome " no campo de mensagem (mesmo formato do autocompletar). */
function mentionInComposer(username) {
  const input = document.getElementById("chat-input");
  if (!input) return;
  const sep = input.value && !/\s$/.test(input.value) ? " " : "";
  input.value = `${input.value}${sep}@${username} `;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

/**
 * Menu do usuário na lista de membros: perfil, mensagem, chamar, amizade, mencionar,
 * apelido, cargos, copiar, bloquear e a moderação (castigo, expulsar, banir, posse).
 */
function memberUserMenuItems(srv, u, openProfile) {
  const me = state.selfUser?.username?.toLowerCase();
  const lower = String(u.username || "").toLowerCase();
  const self = lower === me;
  const nick = memberNickname(srv, lower);
  const shown = nick || u.display_name || u.username;
  const rel = typeof getRelationshipWith === "function" ? getRelationshipWith(u.username) : "none";
  const blocked = state.blockedUsers?.has?.(lower);
  const inServerChat = state.activeView === "server" && Boolean(state.currentTextChannel);
  const items = [
    { header: nick ? `${nick} (@${u.username})` : shown },
    { label: "Ver perfil", icon: "👤", onSelect: openProfile },
    !self && !blocked && { label: "Mensagem", icon: "💬", onSelect: () => sendWs("OpenDm", { target_username: u.username }) },
    !self && !blocked && {
      label: "Ligar",
      icon: "📞",
      onSelect: () => {
        state.pendingCallPeer = lower;
        sendWs("OpenDm", { target_username: u.username });
      },
    },
    inServerChat && { label: "Mencionar", icon: "@", onSelect: () => mentionInComposer(u.username) },
    !self && rel === "none" && !blocked && { label: "Adicionar amigo", icon: "➕", onSelect: () => { sendWs("SendFriendRequest", { target_username: u.username }); showUiToast(`Pedido de amizade enviado para ${u.username}.`); } },
    !self && rel === "outgoing" && { label: "Pedido de amizade enviado", icon: "⏳", disabled: true },
    !self && rel === "incoming" && { label: "Aceitar pedido de amizade", icon: "✓", onSelect: () => sendWs("RespondFriendRequest", { from_username: u.username, accept: true }) },
  ];
  const manage = [
    canChangeNickname(srv, lower) && { label: self ? "Editar meu apelido…" : "Mudar apelido…", icon: "🏷️", onSelect: () => openNicknameDialog(srv, lower, u.username) },
    canEditMemberRoles(srv, lower) && { label: "Cargos…", icon: "🛡️", onSelect: () => openMemberRolesDialog(srv, lower, shown) },
  ].filter(Boolean);
  if (manage.length) items.push({ separator: true }, ...manage);
  items.push(
    { separator: true },
    { label: "Copiar nome de usuário", icon: "📋", onSelect: () => copyTextSafe(u.username, "Nome de usuário copiado!") },
    u.id && { label: "Copiar ID do usuário", icon: "🆔", onSelect: () => copyTextSafe(u.id, "ID do usuário copiado!") },
    !self && !blocked && typeof confirmBlockUser === "function" && { label: "Bloquear", icon: "🚫", danger: true, onSelect: () => confirmBlockUser(u.username) },
  );
  const mod = memberModerationMenuItems(srv, u.username, shown);
  if (mod.length) items.push({ separator: true }, { header: "Moderação do servidor" }, ...mod);
  return items.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Etapa C5: aba "Emojis" das configurações do servidor. A imagem sobe como anexo
// (POST /api/attachments) e o servidor valida tipo, tamanho, nome e permissão.
// ---------------------------------------------------------------------------
const EMOJI_MAX_BYTES = 256 * 1024;
const EMOJI_MAX_PER_SERVER = 50;

function canManageEmojis(srv) {
  const me = state.selfUser?.username;
  if (!srv || srv.id === "sancord" || !me) return false;
  if (isServerOwner(srv, me)) return true;
  const p = getServerPermissionsFor(srv, me);
  return Boolean(p.administrator || p.manage_expressions);
}

/** Sugestão de nome a partir do arquivo: "Festa Junina!.png" → "Festa_Junina". */
function emojiNameFromFile(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const name = base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  return name.length >= 2 ? name : "emoji";
}

function renderEmojiSettings(srv) {
  const list = document.getElementById("emoji-list");
  if (!list || !srv) return;
  const manage = canManageEmojis(srv);
  const emojis = srv.emojis || [];
  const count = document.getElementById("emoji-count");
  if (count) count.textContent = `${emojis.length} de ${EMOJI_MAX_PER_SERVER}`;
  const upload = document.getElementById("emoji-upload-btn");
  if (upload) {
    upload.disabled = !manage || emojis.length >= EMOJI_MAX_PER_SERVER;
    upload.title = !manage ? "Precisa da permissão Gerenciar expressões." : emojis.length >= EMOJI_MAX_PER_SERVER ? "Limite de 50 emojis atingido." : "";
  }
  list.innerHTML = "";
  if (!emojis.length) {
    list.innerHTML = SancordUI.emptyHTML({ icon: "smile", title: "Nenhum emoji ainda", description: manage ? "Envie uma imagem para criar o primeiro emoji do servidor." : "Quem gerencia expressões pode enviar emojis." });
    return;
  }
  for (const e of emojis) {
    const row = document.createElement("div");
    row.className = "srv-manage-row emoji-row";
    row.dataset.emojiId = e.id;
    const img = document.createElement("span");
    img.className = "emoji-row-img";
    img.innerHTML = customEmojiHtml(e.name, e.id);
    const main = document.createElement("div");
    main.className = "emoji-row-main";
    const name = document.createElement("strong");
    name.textContent = `:${e.name}:`;
    const sub = document.createElement("div");
    sub.className = "settings-hint-text";
    sub.textContent = `${e.animated ? "Animado • " : ""}enviado por ${e.creator || "?"}`;
    main.append(name, sub);
    row.append(img, main);
    if (manage) {
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "btn-secondary small-btn";
      rename.textContent = "Renomear";
      rename.addEventListener("click", async () => {
        const values = await SancordUI.formDialog({
          title: `Renomear :${e.name}:`,
          fields: [{ name: "name", label: "NOME", value: e.name, maxlength: 32, hint: "2 a 32 letras, números ou _." }],
          submitLabel: "Salvar",
        });
        const next = values?.name?.trim().replace(/^:|:$/g, "");
        if (next && next !== e.name) sendWs("RenameServerEmoji", { server_id: srv.id, emoji_id: e.id, name: next });
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-secondary small-btn danger-text";
      del.textContent = "Excluir";
      del.addEventListener("click", async () => {
        const ok = await SancordUI.confirm({
          title: `Excluir :${e.name}:?`,
          message: "Ninguém mais poderá usar este emoji. Mensagens antigas continuam mostrando a imagem.",
          confirmLabel: "Excluir",
          danger: true,
        });
        if (ok) sendWs("DeleteServerEmoji", { server_id: srv.id, emoji_id: e.id });
      });
      row.append(rename, del);
    }
    list.appendChild(row);
  }
}

async function uploadServerEmoji(srv, file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    showErrorToast("O emoji precisa ser PNG, JPG, GIF ou WebP.");
    return;
  }
  if (file.size > EMOJI_MAX_BYTES) {
    showErrorToast("A imagem do emoji pode ter no máximo 256 KB.");
    return;
  }
  const values = await SancordUI.formDialog({
    title: "Novo emoji",
    description: `${file.name} • ${Math.ceil(file.size / 1024)} KB`,
    fields: [{ name: "name", label: "NOME", value: emojiNameFromFile(file.name), maxlength: 32, hint: "Use depois com :nome:. 2 a 32 letras, números ou _." }],
    submitLabel: "Enviar emoji",
  });
  const name = values?.name?.trim().replace(/^:|:$/g, "");
  if (!name) return;
  if (!/^[A-Za-z0-9_]{2,32}$/.test(name)) {
    showErrorToast("O nome do emoji deve ter de 2 a 32 letras, números ou _.");
    return;
  }
  try {
    const res = await SancordNet.fetch(`/api/attachments?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getStoredToken() || ""}`, "Content-Type": "application/octet-stream" },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      showErrorToast(data?.message || `Falha no envio (${res.status}).`);
      return;
    }
    sendWs("CreateServerEmoji", { server_id: srv.id, name, attachment_id: data.attachment.id });
  } catch (_) {
    showErrorToast("Não foi possível enviar a imagem. Verifique a conexão.");
  }
}

document.getElementById("emoji-upload-btn")?.addEventListener("click", () => {
  document.getElementById("emoji-file-input")?.click();
});
document.getElementById("emoji-file-input")?.addEventListener("change", (e) => {
  const input = e.target;
  const file = input.files?.[0];
  input.value = "";
  const srv = (state.servers || []).find((s) => s.id === editingServerId);
  if (srv) uploadServerEmoji(srv, file);
});

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
