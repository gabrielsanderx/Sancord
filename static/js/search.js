/**
 * SancordSearch — Pesquisa avançada de mensagens do Sancord Desktop.
 *
 * Componentes cobertos:
 * - SearchBar + debounce + cancelamento de requisições antigas
 * - SearchPopover (sugestões dinâmicas para de:, em:, tem:, menciona:, datas e histórico local)
 * - SearchFilterChip (chips removíveis + botões rápidos)
 * - SearchResults + SearchResultItem (avatar, canal/thread, highlight seguro, anexos, Ir para mensagem)
 * - SearchContextPreview (Ver contexto com mensagens antes/depois via GetMessageContext)
 * - Paginação real (25/página), ordenação (recent/oldest/relevance), skeleton, vazio e erro com retry.
 */
const SancordSearch = (() => {
  const PAGE_SIZE = 25;
  const HISTORY_KEY = "sancord_search_history_v1";
  const MAX_HISTORY = 8;
  const DEBOUNCE_MS = 320;

  const HAS_SUGGESTIONS = [
    { value: "imagem", label: "tem:imagem", desc: "Mensagens com imagens" },
    { value: "vídeo", label: "tem:vídeo", desc: "Mensagens com vídeos" },
    { value: "áudio", label: "tem:áudio", desc: "Mensagens com áudio ou nota de voz" },
    { value: "arquivo", label: "tem:arquivo", desc: "Mensagens com anexos" },
    { value: "link", label: "tem:link", desc: "Mensagens com URLs" },
    { value: "embed", label: "tem:embed", desc: "Mensagens com prévia de link" },
    { value: "reação", label: "tem:reação", desc: "Mensagens com reações" },
    { value: "enquete", label: "tem:enquete", desc: "Mensagens com enquete" },
  ];

  const FILTER_HINTS = [
    { insert: "de:", title: "de:usuário", desc: "Mensagens de um autor específico" },
    { insert: "em:", title: "em:#canal", desc: "Pesquisar em um canal específico" },
    { insert: "tem:", title: "tem:tipo", desc: "imagem, vídeo, áudio, arquivo, link, embed, reação, enquete" },
    { insert: "menciona:", title: "menciona:@usuário", desc: "Mensagens que mencionam alguém" },
    { insert: "antes:", title: "antes:AAAA-MM-DD", desc: "Mensagens anteriores a uma data" },
    { insert: "depois:", title: "depois:AAAA-MM-DD", desc: "Mensagens posteriores a uma data" },
    { insert: "durante:", title: "durante:AAAA-MM-DD", desc: "Mensagens de um dia específico" },
    { insert: "fixadas:sim ", title: "fixadas:sim", desc: "Somente mensagens fixadas" },
  ];

  const st = {
    seq: 0,
    ctxSeq: 0,
    lastRequest: null,
    lastPayload: null,
    lastText: "",
    terms: [],
    offset: 0,
    totalCount: 0,
    hasMore: false,
    sort: "recent",
    debounceTimer: null,
    activeSuggestion: -1,
    suggestions: [],
    contextRequests: new Map(), // request_id -> { hostEl, messageId }
    initialized: false,
  };

  const panelEl = () => document.getElementById("search-results-panel");
  const inputEl = () => document.getElementById("chat-search-input");
  const clearBtnEl = () => document.getElementById("chat-search-clear-btn");
  const chipsEl = () => document.getElementById("search-filter-chips");
  const suggestionsEl = () => document.getElementById("search-suggestions-box");
  const headerEl = () => document.getElementById("search-results-header");
  const titleEl = () => document.getElementById("search-results-title");
  const listEl = () => document.getElementById("search-results-list");
  const scopeEl = () => document.getElementById("search-scope");
  const sortEl = () => document.getElementById("search-sort");
  const paginationEl = () => document.getElementById("search-pagination");
  const prevBtnEl = () => document.getElementById("search-prev-page");
  const nextBtnEl = () => document.getElementById("search-next-page");
  const pageInfoEl = () => document.getElementById("search-page-info");

  function loadHistory() {
    try {
      const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()).slice(0, MAX_HISTORY) : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory(query) {
    const clean = String(query || "").trim();
    if (!clean || clean.length > 160) return;
    const prev = loadHistory().filter((q) => q.toLowerCase() !== clean.toLowerCase());
    prev.unshift(clean);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(prev.slice(0, MAX_HISTORY)));
    } catch (_) {}
  }

  function removeHistoryItem(query) {
    const next = loadHistory().filter((q) => q !== query);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch (_) {}
  }

  function clearHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (_) {}
  }

  function fold(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function esc(str) {
    return typeof escapeHtml === "function"
      ? escapeHtml(String(str ?? ""))
      : String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /**
   * Destaca termos encontrados no trecho de forma segura (sem quebrar HTML/markdown/links).
   */
  function highlightSnippet(text, terms) {
    const raw = String(text || "");
    const cleanTerms = (terms || [])
      .map((t) => String(t || "").trim())
      .filter((t) => t.length >= 2)
      .slice(0, 8);
    if (!cleanTerms.length) return esc(raw);

    const foldedRaw = fold(raw);
    const ranges = [];
    for (const term of cleanTerms) {
      const needle = fold(term);
      if (!needle) continue;
      let idx = 0;
      while ((idx = foldedRaw.indexOf(needle, idx)) !== -1) {
        ranges.push([idx, idx + needle.length]);
        idx += needle.length;
        if (ranges.length >= 24) break;
      }
    }
    if (!ranges.length) return esc(raw);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const prev = merged[merged.length - 1];
      if (ranges[i][0] <= prev[1]) prev[1] = Math.max(prev[1], ranges[i][1]);
      else merged.push(ranges[i]);
    }
    let html = "";
    let cursor = 0;
    for (const [start, end] of merged) {
      if (start > cursor) html += esc(raw.slice(cursor, start));
      html += `<mark class="search-hl">${esc(raw.slice(start, end))}</mark>`;
      cursor = end;
    }
    if (cursor < raw.length) html += esc(raw.slice(cursor));
    return html;
  }

  function resolveChannelByName(rawName) {
    const needle = fold(String(rawName || "").replace(/^#/, ""));
    if (!needle || typeof getActiveServer !== "function") return null;
    const srv = getActiveServer();
    if (!srv) return null;
    const textChannels = srv.text_channels || [];
    const threads = srv.threads || [];
    const exactCh = textChannels.find((c) => fold(c.name) === needle || c.id === rawName);
    if (exactCh) return exactCh.id;
    const exactTh = threads.find((t) => fold(t.name) === needle || t.id === rawName);
    if (exactTh) return exactTh.id;
    const partialCh = textChannels.find((c) => fold(c.name).includes(needle));
    if (partialCh) return partialCh.id;
    const partialTh = threads.find((t) => fold(t.name).includes(needle));
    return partialTh ? partialTh.id : null;
  }

  function collectUsersForAutocomplete() {
    const map = new Map();
    const add = (u) => {
      if (!u || !u.username) return;
      const key = u.username.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          username: u.username,
          display_name: u.display_name || u.username,
          avatar_color: u.avatar_color || "#5865F2",
        });
      }
    };
    if (typeof state !== "undefined") {
      if (state.selfUser) add(state.selfUser);
      for (const u of state.users?.values?.() || []) add(u);
      for (const f of state.friends || []) add(f);
      const srv = typeof getActiveServer === "function" ? getActiveServer() : null;
      for (const member of srv?.members || []) {
        const key = String(member || "").toLowerCase();
        if (key && !map.has(key)) {
          map.set(key, { username: member, display_name: member, avatar_color: "#5865F2" });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
  }

  function collectChannelsForAutocomplete() {
    const out = [];
    const srv = typeof getActiveServer === "function" ? getActiveServer() : null;
    if (!srv) return out;
    for (const ch of srv.text_channels || []) {
      if (ch.effective_permissions?.view_channel === false) continue;
      out.push({ id: ch.id, name: ch.name, label: `#${ch.name}`, desc: ch.kind === "forum" ? "Fórum" : "Canal de texto" });
    }
    for (const th of srv.threads || []) {
      out.push({ id: th.id, name: th.name, label: `🧵 ${th.name}`, desc: "Tópico" });
    }
    return out;
  }

  function replaceLastToken(text, replacement) {
    const src = String(text || "");
    const trailingSpace = /\s$/.test(src);
    if (trailingSpace || !src.trim()) {
      return `${src}${replacement}`;
    }
    const lastSpace = src.search(/\S+$/);
    return `${src.slice(0, lastSpace)}${replacement}`;
  }

  function removeFilterFromInput(rawToken) {
    const input = inputEl();
    if (!input) return;
    const escaped = rawToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = input.value
      .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "i"), " ")
      .replace(/\s+/g, " ")
      .trim();
    input.value = next;
    if (typeof state !== "undefined") state.searchQuery = next;
    updateClearBtn();
    renderChips(parseSearchQuery(next));
    if (hasActiveCriteria(parseSearchQuery(next))) {
      run(next, { offset: 0, recordHistory: false });
    } else {
      showSuggestions(next);
    }
  }

  function hasActiveCriteria(parsed) {
    return Boolean(
      parsed.query ||
      parsed.author ||
      parsed.in_channel ||
      parsed.has ||
      (parsed.has_list && parsed.has_list.length > 0) ||
      parsed.before !== null ||
      parsed.after !== null ||
      parsed.pinned ||
      parsed.mentions_me ||
      parsed.mentions_user
    );
  }

  function renderChips(parsed) {
    const host = chipsEl();
    if (!host) return;
    host.replaceChildren();
    const filters = parsed?.filters || [];
    host.classList.toggle("hidden", filters.length === 0);
    for (const f of filters) {
      const chip = document.createElement("span");
      chip.className = "search-chip";
      const lbl = document.createElement("span");
      lbl.textContent = f.label;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-chip-remove";
      btn.setAttribute("aria-label", `Remover filtro ${f.label}`);
      btn.textContent = "×";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFilterFromInput(f.raw);
      });
      chip.append(lbl, btn);
      host.appendChild(chip);
    }
  }

  function buildSuggestions(text) {
    const src = String(text || "");
    const trailingSpace = /\s$/.test(src);
    const trimmed = src.trim();
    if (!trimmed) {
      const history = loadHistory().map((q) => ({
        kind: "history",
        title: q,
        desc: "Busca recente",
        apply: () => {
          const inp = inputEl();
          if (inp) inp.value = q;
          run(q, { offset: 0, recordHistory: true });
        },
        remove: () => {
          removeHistoryItem(q);
          showSuggestions(inputEl()?.value || "");
        },
      }));
      const hints = FILTER_HINTS.map((h) => ({
        kind: "hint",
        title: h.title,
        desc: h.desc,
        apply: () => insertToken(h.insert, h.insert.endsWith(" ")),
      }));
      return { history, items: hints, heading: "Filtros disponíveis" };
    }

    if (trailingSpace) {
      return {
        history: [],
        items: FILTER_HINTS.slice(0, 6).map((h) => ({
          kind: "hint",
          title: h.title,
          desc: h.desc,
          apply: () => insertToken(h.insert, h.insert.endsWith(" ")),
        })),
        heading: "Adicionar outro filtro",
      };
    }

    const lastToken = trimmed.split(/\s+/).pop() || "";
    const lower = lastToken.toLowerCase();

    if (/^(de|from):/i.test(lower)) {
      const q = fold(lastToken.split(":").slice(1).join(":").replace(/^@/, ""));
      const users = collectUsersForAutocomplete()
        .filter((u) => !q || fold(u.username).includes(q) || fold(u.display_name).includes(q))
        .slice(0, 8);
      return {
        history: [],
        heading: "Filtrar por autor",
        items: users.map((u) => ({
          kind: "user",
          title: u.display_name !== u.username ? `${u.display_name} (@${u.username})` : `@${u.username}`,
          desc: "Autor",
          color: u.avatar_color,
          initials: u.username.slice(0, 2).toUpperCase(),
          apply: () => applyReplacement(`de:${u.username} `, true),
        })),
      };
    }

    if (/^(menciona|menções|mencoes|mentions):/i.test(lower)) {
      const q = fold(lastToken.split(":").slice(1).join(":").replace(/^@/, ""));
      const items = [];
      if (!q || "eu".includes(q) || "voce".includes(q)) {
        items.push({
          kind: "hint",
          title: "menciona:eu",
          desc: "Mensagens que mencionam você ou seus cargos",
          apply: () => applyReplacement("menciona:eu ", true),
        });
      }
      const users = collectUsersForAutocomplete()
        .filter((u) => !q || fold(u.username).includes(q) || fold(u.display_name).includes(q))
        .slice(0, 7);
      for (const u of users) {
        items.push({
          kind: "user",
          title: `@${u.username}`,
          desc: "Menção direta",
          color: u.avatar_color,
          initials: u.username.slice(0, 2).toUpperCase(),
          apply: () => applyReplacement(`menciona:@${u.username} `, true),
        });
      }
      return { history: [], heading: "Filtrar por menção", items };
    }

    if (/^(em|in):/i.test(lower)) {
      const q = fold(lastToken.split(":").slice(1).join(":").replace(/^#/, ""));
      const channels = collectChannelsForAutocomplete()
        .filter((c) => !q || fold(c.name).includes(q))
        .slice(0, 8);
      return {
        history: [],
        heading: "Filtrar por canal",
        items: channels.map((c) => ({
          kind: "channel",
          title: c.label,
          desc: c.desc,
          apply: () => applyReplacement(`em:#${c.name.includes(" ") ? `"${c.name}"` : c.name} `, true),
        })),
      };
    }

    if (/^(tem|has):/i.test(lower)) {
      const q = fold(lastToken.split(":").slice(1).join(":"));
      const matches = HAS_SUGGESTIONS.filter((h) => !q || fold(h.value).includes(q) || fold(h.desc).includes(q));
      return {
        history: [],
        heading: "Tipo de conteúdo",
        items: matches.map((h) => ({
          kind: "hint",
          title: h.label,
          desc: h.desc,
          apply: () => applyReplacement(`tem:${h.value} `, true),
        })),
      };
    }

    if (/^(antes|before|depois|after|durante|during|data):$/i.test(lower)) {
      const key = lastToken.split(":")[0];
      const today = new Date();
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const d7 = new Date(today.getTime() - 7 * 86400000);
      const d30 = new Date(today.getTime() - 30 * 86400000);
      return {
        history: [],
        heading: "Sugestões de data",
        items: [
          { kind: "hint", title: `${key}:${fmt(today)}`, desc: "Hoje", apply: () => applyReplacement(`${key}:${fmt(today)} `, true) },
          { kind: "hint", title: `${key}:${fmt(d7)}`, desc: "7 dias atrás", apply: () => applyReplacement(`${key}:${fmt(d7)} `, true) },
          { kind: "hint", title: `${key}:${fmt(d30)}`, desc: "30 dias atrás", apply: () => applyReplacement(`${key}:${fmt(d30)} `, true) },
        ],
      };
    }

    return { history: [], items: [], heading: "" };
  }

  function applyReplacement(replacement, runAfter = false) {
    const inp = inputEl();
    if (!inp) return;
    inp.value = replaceLastToken(inp.value, replacement);
    inp.focus();
    updateClearBtn();
    const parsed = parseSearchQuery(inp.value);
    renderChips(parsed);
    if (runAfter && hasActiveCriteria(parsed)) {
      run(inp.value, { offset: 0, recordHistory: false });
    } else {
      showSuggestions(inp.value);
    }
  }

  function insertToken(prefix, runAfter = false) {
    const inp = inputEl();
    if (!inp) return;
    const cur = inp.value;
    const sep = cur && !/\s$/.test(cur) ? " " : "";
    inp.value = `${cur}${sep}${prefix}`;
    inp.focus();
    updateClearBtn();
    const parsed = parseSearchQuery(inp.value);
    renderChips(parsed);
    if (runAfter && hasActiveCriteria(parsed)) {
      run(inp.value, { offset: 0, recordHistory: false });
    } else {
      showSuggestions(inp.value);
    }
  }

  function renderSuggestions(text) {
    const box = suggestionsEl();
    if (!box) return;
    const { history, items, heading } = buildSuggestions(text);
    st.suggestions = [...history, ...items];
    st.activeSuggestion = -1;
    box.replaceChildren();
    if (!st.suggestions.length) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");

    if (history.length) {
      const hHead = document.createElement("div");
      hHead.className = "search-sugg-head";
      const lbl = document.createElement("span");
      lbl.textContent = "Buscas recentes";
      const clearAll = document.createElement("button");
      clearAll.type = "button";
      clearAll.className = "search-sugg-clear";
      clearAll.textContent = "Limpar";
      clearAll.addEventListener("click", (e) => {
        e.stopPropagation();
        clearHistory();
        showSuggestions(inputEl()?.value || "");
      });
      hHead.append(lbl, clearAll);
      box.appendChild(hHead);
      history.forEach((item, idx) => box.appendChild(renderSuggestionRow(item, idx)));
    }

    if (items.length) {
      const head = document.createElement("div");
      head.className = "search-sugg-head";
      head.textContent = heading || "Sugestões";
      box.appendChild(head);
      items.forEach((item, i) => box.appendChild(renderSuggestionRow(item, history.length + i)));
    }
  }

  function renderSuggestionRow(item, idx) {
    const row = document.createElement("div");
    row.className = "search-suggestion-item";
    row.dataset.suggIdx = String(idx);
    row.setAttribute("role", "option");

    const main = document.createElement("button");
    main.type = "button";
    main.className = "search-suggestion-main";
    if (item.kind === "user") {
      const av = document.createElement("span");
      av.className = "search-sugg-avatar";
      av.style.background = item.color || "#5865F2";
      av.textContent = item.initials || "?";
      main.appendChild(av);
    }
    const textWrap = document.createElement("span");
    textWrap.className = "search-sugg-text";
    const strong = document.createElement("strong");
    strong.textContent = item.title;
    const sub = document.createElement("small");
    sub.textContent = item.desc || "";
    textWrap.append(strong, sub);
    main.appendChild(textWrap);
    main.addEventListener("mousedown", (e) => {
      e.preventDefault();
      item.apply();
    });
    row.appendChild(main);

    if (item.remove) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "search-sugg-remove";
      del.setAttribute("aria-label", "Remover do histórico");
      del.textContent = "×";
      del.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.remove();
      });
      row.appendChild(del);
    }
    return row;
  }

  function highlightActiveSuggestion() {
    const box = suggestionsEl();
    if (!box) return;
    for (const el of box.querySelectorAll(".search-suggestion-item")) {
      el.classList.toggle("is-active", Number(el.dataset.suggIdx) === st.activeSuggestion);
    }
  }

  function showSuggestions(text) {
    panelEl()?.classList.remove("hidden");
    renderChips(parseSearchQuery(text));
    renderSuggestions(text);
    const hasQuery = hasActiveCriteria(parseSearchQuery(text));
    if (!hasQuery) {
      headerEl()?.classList.add("hidden");
      paginationEl()?.classList.add("hidden");
      const list = listEl();
      if (list) list.replaceChildren();
    }
  }

  function renderLoadingSkeleton() {
    const list = listEl();
    if (!list) return;
    list.innerHTML = Array.from({ length: 3 }, () => `
      <div class="search-skeleton" aria-hidden="true">
        <div class="search-skel-line w-40"></div>
        <div class="search-skel-line w-85"></div>
        <div class="search-skel-line w-65"></div>
      </div>
    `).join("");
  }

  function updateScopeLabels() {
    const sel = scopeEl();
    if (!sel || typeof state === "undefined") return;
    const optHere = sel.querySelector('option[value="here"]');
    const optChan = sel.querySelector('option[value="channel"]');
    if (state.activeView === "home") {
      if (optHere) optHere.textContent = state.activeDmId ? "Nesta conversa" : "Mensagens diretas";
      if (optChan) optChan.hidden = true;
      if (sel.value === "channel") sel.value = "here";
    } else {
      if (optHere) optHere.textContent = "Neste servidor";
      if (optChan) optChan.hidden = false;
    }
  }

  function run(text, opts = {}) {
    clearTimeout(st.debounceTimer);
    st.debounceTimer = null;
    const rawText = String(text ?? inputEl()?.value ?? "");
    const parsed = parseSearchQuery(rawText);
    renderChips(parsed);
    updateScopeLabels();
    updateClearBtn();

    if (!hasActiveCriteria(parsed)) {
      showSuggestions(rawText);
      return;
    }

    const offset = Number.isFinite(opts.offset) ? Math.max(0, opts.offset) : 0;
    const sort = opts.sort || sortEl()?.value || st.sort || "recent";
    const scope = scopeEl()?.value || "here";
    st.offset = offset;
    st.sort = sort;
    st.lastText = rawText;

    const payload = {
      request_id: `s${++st.seq}`,
      query: parsed.query,
      author: parsed.author,
      has: parsed.has,
      has_list: parsed.has_list,
      before: parsed.before,
      after: parsed.after,
      pinned: parsed.pinned,
      mentions_me: parsed.mentions_me,
      mentions_user: parsed.mentions_user,
      sort,
      offset,
    };

    if (parsed.in_channel) {
      const resolvedId = resolveChannelByName(parsed.in_channel);
      if (resolvedId) {
        payload.channel_id = resolvedId;
      } else {
        // Canal não existe / sem permissão -> força lista vazia sem vazar outros canais
        payload.channel_id = `__inexistente__:${parsed.in_channel}`;
      }
    } else if (scope === "channel" && typeof getActiveTextChannelId === "function" && getActiveTextChannelId()) {
      payload.channel_id = getActiveTextChannelId();
    } else if (scope === "here") {
      if (typeof state !== "undefined" && state.activeView === "home" && state.activeDmId) {
        payload.channel_id = state.activeDmId;
      } else if (typeof state !== "undefined" && state.activeView !== "home") {
        payload.server_id = typeof getActiveServer === "function" ? (getActiveServer()?.id || null) : null;
      } else {
        payload.private_only = true;
      }
    }

    if (opts.recordHistory !== false) saveHistory(rawText);
    st.lastRequest = payload.request_id;
    st.lastPayload = payload;
    st.terms = parsed.query.split(/\s+/).filter(Boolean);

    panelEl()?.classList.remove("hidden");
    suggestionsEl()?.classList.add("hidden");
    headerEl()?.classList.remove("hidden");
    paginationEl()?.classList.add("hidden");
    if (titleEl()) titleEl().textContent = "Buscando…";
    renderLoadingSkeleton();

    if (typeof sendWs === "function") {
      sendWs("SearchMessages", payload);
    }
  }

  function renderAttachmentsSummary(m) {
    const badges = [];
    if (m.attachments?.length) {
      for (const a of m.attachments.slice(0, 3)) {
        const icon = a.kind === "image" ? "🖼️" : a.kind === "video" ? "🎬" : a.kind === "audio" ? "🎵" : "📎";
        badges.push(`${icon} ${a.filename}`);
      }
      if (m.attachments.length > 3) badges.push(`+${m.attachments.length - 3}`);
    } else if (m.image_url) {
      badges.push("🖼️ Imagem");
    }
    if (m.poll) badges.push(`📊 Enquete: ${m.poll.question}`);
    const rxCount = Object.values(m.reactions || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0);
    if (rxCount > 0) badges.push(`✨ ${rxCount} reaç${rxCount === 1 ? "ão" : "ões"}`);
    if (m.pinned) badges.push("📌 Fixada");
    return badges;
  }

  function formatLocation(hit) {
    const srv = hit.server_name ? `${hit.server_name} • ` : "";
    if (hit.is_thread && hit.parent_channel_name) {
      return `${srv}#${hit.parent_channel_name} → ${hit.channel_name}`;
    }
    if (hit.channel_name?.startsWith("@")) return `${srv}${hit.channel_name}`;
    return `${srv}${hit.server_id && !hit.channel_name?.startsWith("🧵") ? `#${hit.channel_name}` : hit.channel_name}`;
  }

  function onResults({ request_id, hits, has_more, total_count, offset, sort, error }) {
    if (request_id && request_id !== st.lastRequest) return;
    const list = listEl();
    const title = titleEl();
    const pag = paginationEl();
    if (!list) return;

    headerEl()?.classList.remove("hidden");
    list.replaceChildren();

    if (error) {
      if (title) title.textContent = "Erro na busca";
      pag?.classList.add("hidden");
      const box = document.createElement("div");
      box.className = "search-error-state";
      const msg = document.createElement("p");
      msg.textContent = error || "Não foi possível pesquisar agora.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn-primary small-btn";
      retry.textContent = "Tentar novamente";
      retry.addEventListener("click", () => run(st.lastText, { offset: st.offset, sort: st.sort, recordHistory: false }));
      box.append(msg, retry);
      list.appendChild(box);
      return;
    }

    const items = Array.isArray(hits) ? hits : [];
    const total = Number.isFinite(total_count) && total_count >= items.length ? total_count : items.length;
    st.totalCount = total;
    st.hasMore = Boolean(has_more);
    st.offset = Number.isFinite(offset) ? offset : st.offset;
    if (sort && sortEl()) sortEl().value = sort;

    if (title) {
      title.textContent = `${total} resultado${total === 1 ? "" : "s"}`;
    }

    if (items.length === 0) {
      pag?.classList.add("hidden");
      const parsed = parseSearchQuery(st.lastText);
      const wrap = document.createElement("div");
      wrap.className = "search-empty-wrap";
      wrap.innerHTML = typeof SancordUI !== "undefined"
        ? SancordUI.emptyHTML({
            icon: "search",
            title: "Nenhum resultado encontrado",
            description: parsed.filters.length
              ? "Tente remover alguns filtros ou ajustar os termos da busca."
              : "Experimente outros termos ou filtre por autor, canal, data ou tipo de anexo.",
          })
        : `<div class="pinned-empty">Nenhum resultado encontrado.</div>`;
      if (parsed.filters.length) {
        const clearFilters = document.createElement("button");
        clearFilters.type = "button";
        clearFilters.className = "btn-secondary small-btn";
        clearFilters.textContent = "Remover filtros";
        clearFilters.addEventListener("click", () => {
          const inp = inputEl();
          if (inp) {
            inp.value = parsed.query;
            run(parsed.query, { offset: 0, recordHistory: false });
          }
        });
        wrap.appendChild(clearFilters);
      }
      list.appendChild(wrap);
      return;
    }

    for (const hit of items) {
      const m = hit.message;
      const card = document.createElement("div");
      card.className = "search-hit";

      const where = document.createElement("div");
      where.className = "search-hit-where";
      where.textContent = formatLocation(hit);

      const head = document.createElement("div");
      head.className = "search-hit-head";
      const authorWrap = document.createElement("div");
      authorWrap.className = "search-hit-author";
      const av = document.createElement("div");
      av.className = "search-hit-avatar";
      av.style.background = m.author_color || "#5865F2";
      if (typeof renderAvatarInner === "function") {
        av.innerHTML = renderAvatarInner(m.author_name, m.author_avatar);
      } else {
        av.textContent = String(m.author_name || "?").slice(0, 2).toUpperCase();
      }
      const author = document.createElement("strong");
      author.textContent = m.author_name;
      authorWrap.append(av, author);
      const when = document.createElement("span");
      when.className = "search-hit-when";
      when.textContent = typeof formatDateTime === "function" ? formatDateTime(m.created_at) : (m.timestamp || "");
      head.append(authorWrap, when);

      const body = document.createElement("div");
      body.className = "search-hit-body";
      const decoded = typeof decodeCustomEmojis === "function" ? decodeCustomEmojis(m.content || "") : (m.content || "");
      const snippet = decoded.length > 260 ? `${decoded.slice(0, 260)}…` : decoded;
      if (snippet) {
        body.innerHTML = highlightSnippet(snippet, st.terms);
      } else {
        body.textContent = m.attachments?.length ? "Anexo enviado" : m.image_url ? "Imagem enviada" : m.poll ? "Enquete" : "(sem texto)";
      }

      const badges = renderAttachmentsSummary(m);
      let badgeRow = null;
      if (badges.length) {
        badgeRow = document.createElement("div");
        badgeRow.className = "search-hit-badges";
        for (const b of badges) {
          const pill = document.createElement("span");
          pill.className = "search-hit-pill";
          pill.innerHTML = highlightSnippet(b, st.terms);
          badgeRow.appendChild(pill);
        }
      }

      const actions = document.createElement("div");
      actions.className = "search-hit-actions";
      const jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.className = "btn-secondary small-btn";
      jumpBtn.textContent = "Ir para mensagem";
      jumpBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        hide();
        if (typeof jumpToMessage === "function") jumpToMessage(m.channel_id, m.id);
      });

      const ctxBtn = document.createElement("button");
      ctxBtn.type = "button";
      ctxBtn.className = "btn-secondary small-btn";
      ctxBtn.textContent = "Ver contexto";
      const ctxHost = document.createElement("div");
      ctxHost.className = "search-context-box hidden";
      ctxBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!ctxHost.classList.contains("hidden")) {
          ctxHost.classList.add("hidden");
          ctxBtn.textContent = "Ver contexto";
          return;
        }
        ctxBtn.textContent = "Ocultar contexto";
        ctxHost.classList.remove("hidden");
        ctxHost.innerHTML = `<div class="search-context-loading">Carregando contexto…</div>`;
        const reqId = `ctx${++st.ctxSeq}`;
        st.contextRequests.set(reqId, { hostEl: ctxHost, messageId: m.id, channelId: m.channel_id });
        if (typeof sendWs === "function") {
          sendWs("GetMessageContext", { request_id: reqId, channel_id: m.channel_id, message_id: m.id });
        }
      });

      actions.append(jumpBtn, ctxBtn);
      card.append(where, head, body);
      if (badgeRow) card.appendChild(badgeRow);
      card.append(actions, ctxHost);
      card.addEventListener("click", () => {
        hide();
        if (typeof jumpToMessage === "function") jumpToMessage(m.channel_id, m.id);
      });
      list.appendChild(card);
    }

    // Paginação
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.floor(st.offset / PAGE_SIZE) + 1;
    if (pag) {
      pag.classList.toggle("hidden", totalPages <= 1 && !st.hasMore);
      if (pageInfoEl()) pageInfoEl().textContent = `Página ${currentPage} de ${totalPages}`;
      if (prevBtnEl()) prevBtnEl().disabled = st.offset <= 0;
      if (nextBtnEl()) nextBtnEl().disabled = !st.hasMore && currentPage >= totalPages;
    }
  }

  function onContext({ request_id, messages, message_id, channel_id }) {
    const entry = request_id ? st.contextRequests.get(request_id) : null;
    if (!entry) return;
    st.contextRequests.delete(request_id);
    const host = entry.hostEl;
    host.replaceChildren();
    if (!Array.isArray(messages) || messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-context-loading";
      empty.textContent = "Contexto indisponível para esta mensagem.";
      host.appendChild(empty);
      return;
    }
    for (const msg of messages) {
      const row = document.createElement("div");
      row.className = msg.id === message_id ? "search-context-row is-target" : "search-context-row";
      const author = document.createElement("strong");
      author.textContent = `${msg.author_name}: `;
      const text = document.createElement("span");
      const raw = typeof decodeCustomEmojis === "function" ? decodeCustomEmojis(msg.content || "") : (msg.content || "");
      text.textContent = raw || (msg.attachments?.length ? `📎 ${msg.attachments[0].filename}` : "(mídia)");
      row.append(author, text);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        hide();
        if (typeof jumpToMessage === "function") jumpToMessage(channel_id, msg.id);
      });
      host.appendChild(row);
    }
  }

  function updateClearBtn() {
    const btn = clearBtnEl();
    const inp = inputEl();
    if (btn && inp) btn.classList.toggle("hidden", !inp.value.length);
  }

  function hide() {
    clearTimeout(st.debounceTimer);
    st.debounceTimer = null;
    panelEl()?.classList.add("hidden");
  }

  function onFocus() {
    init();
    const val = inputEl()?.value || "";
    updateScopeLabels();
    if (!hasActiveCriteria(parseSearchQuery(val))) {
      showSuggestions(val);
    } else {
      panelEl()?.classList.remove("hidden");
      renderChips(parseSearchQuery(val));
      renderSuggestions(val);
    }
  }

  function onInput(value) {
    init();
    updateClearBtn();
    const parsed = parseSearchQuery(value);
    renderChips(parsed);
    renderSuggestions(value);
    clearTimeout(st.debounceTimer);
    if (!hasActiveCriteria(parsed)) {
      showSuggestions(value);
      return;
    }
    // Se o usuário estiver no meio de digitar um prefixo de filtro (`de:`, `em:`, `tem:`), espera escolher.
    const lastToken = String(value || "").trim().split(/\s+/).pop() || "";
    if (/^(de|from|em|in|tem|has|menciona|menções|mencoes|mentions|antes|before|depois|after|durante|during|data):$/i.test(lastToken)) {
      return;
    }
    st.debounceTimer = setTimeout(() => {
      run(value, { offset: 0, recordHistory: false });
    }, DEBOUNCE_MS);
  }

  function onKeyDown(e) {
    const suggOpen = suggestionsEl() && !suggestionsEl().classList.contains("hidden") && st.suggestions.length > 0;
    if (e.key === "ArrowDown" && suggOpen) {
      e.preventDefault();
      st.activeSuggestion = (st.activeSuggestion + 1) % st.suggestions.length;
      highlightActiveSuggestion();
      return true;
    }
    if (e.key === "ArrowUp" && suggOpen) {
      e.preventDefault();
      st.activeSuggestion = st.activeSuggestion <= 0 ? st.suggestions.length - 1 : st.activeSuggestion - 1;
      highlightActiveSuggestion();
      return true;
    }
    if ((e.key === "Tab" || (e.key === "Enter" && st.activeSuggestion >= 0)) && suggOpen) {
      e.preventDefault();
      const idx = st.activeSuggestion >= 0 ? st.activeSuggestion : 0;
      st.suggestions[idx]?.apply?.();
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      run(inputEl()?.value || "", { offset: 0, recordHistory: true });
      return true;
    }
    if (e.key === "Escape") {
      hide();
      return true;
    }
    return false;
  }

  function init() {
    if (st.initialized) return;
    st.initialized = true;

    scopeEl()?.addEventListener("change", () => {
      if (hasActiveCriteria(parseSearchQuery(inputEl()?.value || ""))) {
        run(inputEl()?.value || "", { offset: 0, recordHistory: false });
      }
    });
    sortEl()?.addEventListener("change", () => {
      if (hasActiveCriteria(parseSearchQuery(inputEl()?.value || ""))) {
        run(inputEl()?.value || "", { offset: 0, sort: sortEl().value, recordHistory: false });
      }
    });
    prevBtnEl()?.addEventListener("click", () => {
      run(st.lastText, { offset: Math.max(0, st.offset - PAGE_SIZE), sort: st.sort, recordHistory: false });
    });
    nextBtnEl()?.addEventListener("click", () => {
      run(st.lastText, { offset: st.offset + PAGE_SIZE, sort: st.sort, recordHistory: false });
    });
    clearBtnEl()?.addEventListener("click", () => {
      const inp = inputEl();
      if (inp) {
        inp.value = "";
        inp.focus();
      }
      if (typeof state !== "undefined") state.searchQuery = "";
      updateClearBtn();
      showSuggestions("");
    });

    for (const btn of document.querySelectorAll("[data-search-insert]")) {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        insertToken(btn.dataset.searchInsert, false);
      });
    }
    for (const btn of document.querySelectorAll("[data-search-toggle-pinned]")) {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const inp = inputEl();
        if (!inp) return;
        const parsed = parseSearchQuery(inp.value);
        if (parsed.pinned) {
          const tok = parsed.filters.find((f) => f.kind === "pinned")?.raw || "fixadas";
          removeFilterFromInput(tok);
        } else {
          insertToken("fixadas:sim ", true);
        }
      });
    }

    document.addEventListener("mousedown", (e) => {
      const panel = panelEl();
      const wrap = inputEl()?.closest(".chat-search-wrap");
      if (panel && !panel.classList.contains("hidden") && wrap && !wrap.contains(e.target)) {
        hide();
      }
    });
  }

  return {
    init,
    run,
    onResults,
    onContext,
    onFocus,
    onInput,
    onKeyDown,
    hide,
    highlightSnippet,
    buildSuggestions,
    loadHistory,
    saveHistory,
    clearHistory,
  };
})();

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => SancordSearch.init());
  } else {
    SancordSearch.init();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SancordSearch, SanvoSearch: SancordSearch };
}
const SanvoSearch = SancordSearch;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoSearch = SancordSearch;
  globalThis.SancordSearch = SancordSearch; // LEGACY COMPATIBILITY
}
