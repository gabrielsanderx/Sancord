/**
 * SancordGamePicker — Seletor central de jogos reutilizável pelo Mural de Perfil
 * (Jogo favorito, Quero jogar, Jogando agora, Lista de desejos) e recursos futuros.
 *
 * Reutiliza:
 * - Backend `/api/games/*` (catálogo curado + busca ao vivo com cache)
 * - `SancordActivity` (detecção de jogo aberto no PC + jogos registrados)
 * - Cache local em `localStorage` para funcionamento offline e recentes por conta.
 */
const SancordGamePicker = (() => {
  const CACHE_KEY = "sancord_game_cache_v1";
  const RECENTS_PREFIX = "sancord_recent_games_v1:";
  const MAX_CACHE = 160;
  const MAX_RECENTS = 12;
  const DEBOUNCE_MS = 250;

  const ALLOWED_COVER_HOSTS = new Set([
    "shared.fastly.steamstatic.com",
    "shared.akamai.steamstatic.com",
    "cdn.cloudflare.steamstatic.com",
    "cdn.akamai.steamstatic.com",
    "store.steampowered.com",
    "steamcdn-a.akamaihd.net",
    "media.rawg.io",
    "images.igdb.com",
  ]);

  const KIND_META = {
    favorite_game: {
      dialogTitle: "Escolher jogo favorito",
      badge: "★ Jogo favorito",
      subtitle: "Escolha um jogo do catálogo para destacar no seu Mural.",
      notePlaceholder: "Adicionar uma nota curta (opcional) — ex.: Zerei 3 vezes!",
    },
    want_to_play: {
      dialogTitle: "Adicionar em Quero jogar",
      badge: "Quero jogar",
      subtitle: "Escolha um jogo para sua lista de desejos e Mural.",
      notePlaceholder: "Adicionar uma nota curta (opcional) — ex.: Próximo da fila!",
    },
    playing: {
      dialogTitle: "Configurar Jogando agora",
      badge: "Jogando agora",
      subtitle: "Mostre automaticamente o jogo aberto no seu PC ou escolha um jogo fixo.",
      notePlaceholder: "Adicionar uma nota curta (opcional) — ex.: Campanha co-op",
    },
  };

  // Fallback compacto para busca offline / sem backend conectado.
  const FALLBACK_GAMES = [
    { id: "sancord:minecraft", title: "Minecraft", aliases: ["mine", "mc"], cover_url: null, release_year: 2011, developer: "Mojang Studios", platforms: ["PC", "Console", "Mobile"] },
    { id: "steam:730", title: "Counter-Strike 2", aliases: ["cs2", "csgo", "cs"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg", release_year: 2023, developer: "Valve", platforms: ["PC"] },
    { id: "sancord:valorant", title: "VALORANT", aliases: ["val", "vava"], cover_url: null, release_year: 2020, developer: "Riot Games", platforms: ["PC", "Console"] },
    { id: "sancord:league-of-legends", title: "League of Legends", aliases: ["lol", "league"], cover_url: null, release_year: 2009, developer: "Riot Games", platforms: ["PC"] },
    { id: "steam:271590", title: "Grand Theft Auto V", aliases: ["gta 5", "gta v", "gtav"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/271590/header.jpg", release_year: 2015, developer: "Rockstar Games", platforms: ["PC", "PlayStation", "Xbox"] },
    { id: "steam:1245620", title: "ELDEN RING", aliases: ["elden"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg", release_year: 2022, developer: "FromSoftware", platforms: ["PC", "PlayStation", "Xbox"] },
    { id: "steam:1091500", title: "Cyberpunk 2077", aliases: ["cp2077", "cyberpunk"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg", release_year: 2020, developer: "CD PROJEKT RED", platforms: ["PC", "PlayStation", "Xbox"] },
    { id: "steam:1174180", title: "Red Dead Redemption 2", aliases: ["rdr2", "red dead"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1174180/header.jpg", release_year: 2019, developer: "Rockstar Games", platforms: ["PC", "PlayStation", "Xbox"] },
    { id: "sancord:fortnite", title: "Fortnite", aliases: ["fort", "fn"], cover_url: null, release_year: 2017, developer: "Epic Games", platforms: ["PC", "PlayStation", "Xbox", "Switch", "Mobile"] },
    { id: "sancord:roblox", title: "Roblox", aliases: ["rbx"], cover_url: null, release_year: 2006, developer: "Roblox Corporation", platforms: ["PC", "Console", "Mobile"] },
    { id: "steam:1086940", title: "Baldur's Gate 3", aliases: ["bg3", "baldurs gate"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1086940/header.jpg", release_year: 2023, developer: "Larian Studios", platforms: ["PC", "PlayStation", "Xbox"] },
    { id: "steam:367520", title: "Hollow Knight", aliases: ["hk", "hollow"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/367520/header.jpg", release_year: 2017, developer: "Team Cherry", platforms: ["PC", "Switch", "PlayStation", "Xbox"] },
    { id: "steam:105600", title: "Terraria", aliases: [], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/105600/header.jpg", release_year: 2011, developer: "Re-Logic", platforms: ["PC", "Console", "Mobile"] },
    { id: "steam:413150", title: "Stardew Valley", aliases: ["stardew"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg", release_year: 2016, developer: "ConcernedApe", platforms: ["PC", "Switch", "PlayStation", "Xbox", "Mobile"] },
    { id: "steam:292030", title: "The Witcher 3: Wild Hunt", aliases: ["witcher 3", "tw3"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/292030/header.jpg", release_year: 2015, developer: "CD PROJEKT RED", platforms: ["PC", "PlayStation", "Xbox", "Switch"] },
    { id: "steam:570", title: "Dota 2", aliases: ["dota"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/header.jpg", release_year: 2013, developer: "Valve", platforms: ["PC"] },
    { id: "steam:1172470", title: "Apex Legends", aliases: ["apex"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1172470/header.jpg", release_year: 2019, developer: "Respawn Entertainment", platforms: ["PC", "PlayStation", "Xbox", "Switch"] },
    { id: "steam:1623730", title: "Palworld", aliases: [], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1623730/header.jpg", release_year: 2024, developer: "Pocketpair", platforms: ["PC", "Xbox", "PlayStation"] },
    { id: "steam:553850", title: "HELLDIVERS 2", aliases: ["hd2", "helldivers"], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/553850/header.jpg", release_year: 2024, developer: "Arrowhead Game Studios", platforms: ["PC", "PlayStation"] },
    { id: "steam:1145360", title: "Hades", aliases: [], cover_url: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1145360/header.jpg", release_year: 2020, developer: "Supergiant Games", platforms: ["PC", "Switch", "PlayStation", "Xbox"] },
  ];

  const memById = new Map();
  let popularCache = null;
  let activeOverlay = null;

  function normalizeKey(raw) {
    return String(raw || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isSafeCoverUrl(raw) {
    if (typeof raw !== "string") return false;
    const clean = raw.trim();
    if (!clean || clean.length > 500) return false;
    if (/^\/api\/attachments\/[0-9a-f]{32}\/[^/?#]+$/i.test(clean)) return true;
    try {
      const u = new URL(clean);
      return u.protocol === "https:" && !u.username && !u.password && ALLOWED_COVER_HOSTS.has(u.hostname.toLowerCase());
    } catch (_) {
      return false;
    }
  }

  function sanitizeGame(raw) {
    if (!raw || typeof raw !== "object") return null;
    const title = String(raw.title || raw.name || "").trim().slice(0, 80);
    if (!title) return null;
    const id = String(raw.id || raw.game_id || `custom:${normalizeKey(title).replace(/\s+/g, "-")}`).trim().slice(0, 80);
    const cover_url = isSafeCoverUrl(raw.cover_url) ? raw.cover_url.trim() : null;
    const yearNum = Number(raw.release_year);
    const release_year = Number.isInteger(yearNum) && yearNum >= 1970 && yearNum <= 2100 ? yearNum : null;
    const platforms = Array.isArray(raw.platforms)
      ? raw.platforms.map((p) => String(p || "").trim().slice(0, 24)).filter(Boolean).slice(0, 6)
      : [];
    return {
      id,
      title,
      cover_url,
      release_year,
      developer: raw.developer ? String(raw.developer).trim().slice(0, 60) : null,
      platforms,
      source: raw.source || null,
    };
  }

  function seedMemoryCache() {
    if (memById.size > 0) return;
    for (const g of FALLBACK_GAMES) {
      const clean = sanitizeGame(g);
      if (clean) memById.set(clean.id, { ...clean, aliases: g.aliases || [] });
    }
    try {
      const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      if (Array.isArray(stored)) {
        for (const item of stored.slice(0, MAX_CACHE)) {
          const clean = sanitizeGame(item);
          if (clean && !memById.has(clean.id)) memById.set(clean.id, clean);
        }
      }
    } catch (_) {}
  }

  function rememberGames(games) {
    seedMemoryCache();
    let changed = false;
    for (const raw of games || []) {
      const g = sanitizeGame(raw);
      if (!g) continue;
      const existing = memById.get(g.id);
      if (!existing || (!existing.cover_url && g.cover_url)) {
        memById.set(g.id, { ...existing, ...g });
        changed = true;
      }
    }
    if (!changed) return;
    try {
      const list = [...memById.values()]
        .filter((g) => !FALLBACK_GAMES.some((f) => f.id === g.id))
        .slice(-MAX_CACHE)
        .map(({ aliases, ...rest }) => rest);
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function currentAccountKey() {
    const u = typeof state !== "undefined" ? state.selfUser?.username : null;
    return String(u || "guest").toLowerCase();
  }

  function loadRecents() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENTS_PREFIX + currentAccountKey()) || "[]");
      return Array.isArray(raw) ? raw.map(sanitizeGame).filter(Boolean).slice(0, MAX_RECENTS) : [];
    } catch (_) {
      return [];
    }
  }

  function saveRecent(game) {
    const clean = sanitizeGame(game);
    if (!clean) return;
    const prev = loadRecents().filter((g) => g.id !== clean.id && normalizeKey(g.title) !== normalizeKey(clean.title));
    const next = [clean, ...prev].slice(0, MAX_RECENTS);
    try {
      localStorage.setItem(RECENTS_PREFIX + currentAccountKey(), JSON.stringify(next));
    } catch (_) {}
  }

  function apiBaseUrl(path) {
    if (typeof apiUrl === "function") return apiUrl(path);
    return path;
  }

  function resolveKnownGame(name) {
    seedMemoryCache();
    const needle = normalizeKey(name);
    if (!needle) return null;
    for (const g of memById.values()) {
      if (normalizeKey(g.title) === needle) return g;
      if (Array.isArray(g.aliases) && g.aliases.some((a) => normalizeKey(a) === needle)) return g;
    }
    if (needle.length >= 4) {
      for (const g of memById.values()) {
        const t = normalizeKey(g.title);
        if (t.startsWith(needle) || needle.startsWith(t)) return g;
      }
    }
    return null;
  }

  const pendingResolves = new Map();
  async function resolveGameAsync(name) {
    const local = resolveKnownGame(name);
    if (local) return local;
    const key = normalizeKey(name);
    if (!key) return null;
    if (pendingResolves.has(key)) return pendingResolves.get(key);
    const p = (async () => {
      try {
        const res = await fetch(apiBaseUrl(`/api/games/resolve?name=${encodeURIComponent(name)}`));
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.game) {
          rememberGames([data.game]);
          return sanitizeGame(data.game);
        }
      } catch (_) {}
      return null;
    })();
    pendingResolves.set(key, p);
    const result = await p;
    pendingResolves.delete(key);
    return result;
  }

  function searchLocalGames(query, limit = 16) {
    seedMemoryCache();
    const needle = normalizeKey(query);
    if (!needle) {
      return [...memById.values()].slice(0, limit);
    }
    const tokens = needle.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const g of memById.values()) {
      const hay = normalizeKey(g.title);
      let score = 0;
      if (hay === needle) score = 100;
      else if (hay.startsWith(needle)) score = 80;
      else if (hay.includes(needle)) score = 60;
      else if (tokens.length && tokens.every((t) => hay.includes(t))) score = 45;
      for (const alias of g.aliases || []) {
        const ah = normalizeKey(alias);
        if (ah === needle) score = Math.max(score, 95);
        else if (ah.startsWith(needle)) score = Math.max(score, 75);
        else if (ah.includes(needle)) score = Math.max(score, 55);
      }
      if (score > 0) scored.push([score, g]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title));
    return scored.slice(0, limit).map(([, g]) => g);
  }

  async function fetchPopularGames(signal) {
    if (popularCache) return { games: popularCache, offline: false };
    try {
      const res = await fetch(apiBaseUrl("/api/games/popular?limit=24"), { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data?.games) ? data.games.map(sanitizeGame).filter(Boolean) : [];
      if (list.length) {
        rememberGames(list);
        popularCache = list;
        return { games: list, offline: false };
      }
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
    seedMemoryCache();
    return { games: FALLBACK_GAMES.map(sanitizeGame).filter(Boolean), offline: true };
  }

  async function fetchSearchGames(query, signal) {
    const clean = String(query || "").trim();
    if (!clean) return fetchPopularGames(signal);
    try {
      const res = await fetch(apiBaseUrl(`/api/games/search?q=${encodeURIComponent(clean)}&limit=18`), { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data?.games) ? data.games.map(sanitizeGame).filter(Boolean) : [];
      rememberGames(list);
      return { games: list, degraded: Boolean(data?.degraded), error: false };
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const local = searchLocalGames(clean, 12);
      return { games: local, degraded: true, error: true };
    }
  }

  function coverPlaceholderEl(title) {
    const el = document.createElement("div");
    el.className = "gp-cover-fallback";
    el.setAttribute("aria-hidden", "true");
    const initial = String(title || "G").trim().charAt(0).toUpperCase() || "G";
    const hue = [...String(title || "game")].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 215);
    el.style.setProperty("--gp-fallback-hue", String(hue));
    el.innerHTML = `<svg viewBox="0 0 24 24" class="gp-fallback-icon"><path d="M6 12h4m-2-2v4m7-2h.01M18 10h.01M6.5 6h11A4.5 4.5 0 0 1 22 10.5v2.2a5.3 5.3 0 0 1-9.25 3.55l-.75-.85-.75.85A5.3 5.3 0 0 1 2 12.7v-2.2A4.5 4.5 0 0 1 6.5 6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="gp-fallback-letter"></span>`;
    el.querySelector(".gp-fallback-letter").textContent = initial;
    return el;
  }

  function createCoverNode(coverUrl, title, className = "gp-card-cover") {
    const wrap = document.createElement("div");
    wrap.className = className;
    if (coverUrl && isSafeCoverUrl(coverUrl)) {
      const img = document.createElement("img");
      img.src = coverUrl.startsWith("/api/") && typeof cachedMediaUrl === "function" ? cachedMediaUrl(coverUrl) : coverUrl;
      img.alt = `Capa de ${title}`;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.remove();
        wrap.append(coverPlaceholderEl(title));
      });
      wrap.append(img);
    } else {
      wrap.append(coverPlaceholderEl(title));
    }
    return wrap;
  }

  function getDetectedNow() {
    if (typeof SancordActivity !== "undefined" && typeof SancordActivity.getDetectedGame === "function") {
      return SancordActivity.getDetectedGame();
    }
    if (typeof state !== "undefined" && state.selfUser?.activity?.name) {
      return state.selfUser.activity;
    }
    return null;
  }

  function getPcDetectedGames() {
    if (typeof SancordActivity === "undefined" || typeof SancordActivity.getLocalGames !== "function") return [];
    return SancordActivity.getLocalGames().map((entry) => {
      const known = resolveKnownGame(entry.name);
      return known
        ? { ...known, detectedNow: entry.detectedNow, exe_name: entry.exe_name }
        : sanitizeGame({
            id: `local:${normalizeKey(entry.name).replace(/\s+/g, "-")}`,
            title: entry.name,
            platforms: ["PC"],
            source: "detected",
          });
    }).filter(Boolean);
  }

  function widgetToSelectedGame(existing) {
    if (!existing || !existing.name) return null;
    const known = existing.game_id
      ? (seedMemoryCache(), memById.get(existing.game_id) || resolveKnownGame(existing.name))
      : resolveKnownGame(existing.name);
    const cover_url = existing.cover_url
      || (/^[0-9a-f]{32}$/.test(existing.cover_id || "") ? `/api/attachments/${existing.cover_id}/capa` : null)
      || known?.cover_url
      || null;
    return sanitizeGame({
      id: existing.game_id || known?.id || `custom:${normalizeKey(existing.name).replace(/\s+/g, "-")}`,
      title: existing.name,
      cover_url,
      release_year: existing.release_year || known?.release_year || null,
      platforms: existing.platforms?.length ? existing.platforms : (known?.platforms || []),
    });
  }

  function buildWidgetFromSelection({ kind, game, note, autoActivity, existing }) {
    const cleanNote = String(note || "").trim().slice(0, 160);
    const base = { visible: existing?.visible ?? true, kind };
    if (kind === "favorite_game") {
      return {
        ...base,
        name: game.title,
        description: cleanNote,
        cover_id: game.cover_url?.startsWith("/api/attachments/") ? existing?.cover_id || null : null,
        ...(game.id && !game.id.startsWith("custom:") ? { game_id: game.id } : {}),
        ...(game.cover_url && !game.cover_url.startsWith("/api/attachments/") ? { cover_url: game.cover_url } : {}),
        ...(game.release_year ? { release_year: game.release_year } : {}),
        ...(game.platforms?.length ? { platforms: game.platforms } : {}),
      };
    }
    if (kind === "playing") {
      const useAuto = Boolean(autoActivity);
      const out = {
        ...base,
        name: game ? game.title : "",
        ...(useAuto ? { auto_activity: true } : {}),
      };
      if (game) {
        if (game.id && !game.id.startsWith("custom:") && !game.id.startsWith("local:")) out.game_id = game.id;
        if (game.cover_url) out.cover_url = game.cover_url;
        if (game.release_year) out.release_year = game.release_year;
        if (game.platforms?.length) out.platforms = game.platforms;
      }
      if (cleanNote) out.note = cleanNote;
      return out;
    }
    // want_to_play
    const out = {
      ...base,
      name: game.title,
    };
    if (game.id && !game.id.startsWith("custom:") && !game.id.startsWith("local:")) out.game_id = game.id;
    if (game.cover_url) out.cover_url = game.cover_url;
    if (game.release_year) out.release_year = game.release_year;
    if (game.platforms?.length) out.platforms = game.platforms;
    if (cleanNote) out.note = cleanNote;
    return out;
  }

  function closeActive() {
    if (activeOverlay) {
      activeOverlay.close(null);
    }
  }

  /**
   * Abre o seletor central de jogos.
   * Retorna Promise com:
   *  - `{ action: "save", widget }`
   *  - `{ action: "remove" }`
   *  - `{ action: "manual" }`
   *  - `null` (cancelado)
   */
  function open({ kind = "favorite_game", existing = null, allowRemove = false } = {}) {
    closeActive();
    seedMemoryCache();
    const meta = KIND_META[kind] || KIND_META.favorite_game;
    const isPlaying = kind === "playing";
    const opener = document.activeElement;

    return new Promise((resolve) => {
      let settled = false;
      let debounceTimer = null;
      let currentAbort = null;
      let selectedGame = widgetToSelectedGame(existing);
      let autoActivity = isPlaying ? (existing ? Boolean(existing.auto_activity) : true) : false;
      let noteValue = String(existing?.description ?? existing?.note ?? "");
      let popularGames = [];
      let searchQuery = "";
      let searchState = { loading: true, error: false, offline: false, results: [] };

      const overlay = document.createElement("div");
      overlay.className = "sancord-dialog-backdrop gp-backdrop";
      overlay.dataset.gamePicker = "1";
      overlay.innerHTML = `
        <div class="sancord-dialog gp-dialog" role="dialog" aria-modal="true" aria-labelledby="gp-title">
          <header class="gp-header">
            <div class="gp-header-copy">
              <h3 id="gp-title"></h3>
              <p class="gp-subtitle"></p>
            </div>
            <button type="button" class="gp-close-btn" aria-label="Fechar seletor de jogos">✕</button>
          </header>
          <div class="gp-detected-slot hidden"></div>
          <div class="gp-search-row">
            <span class="gp-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </span>
            <input type="search" class="gp-search-input" placeholder="Pesquisar jogo... (ex.: Minecraft, Elden Ring, CS2)" autocomplete="off" spellcheck="false" aria-label="Pesquisar jogo no catálogo" />
            <button type="button" class="gp-search-clear hidden" aria-label="Limpar busca">✕</button>
          </div>
          <div class="gp-body">
            <div class="gp-catalog-pane"></div>
            <aside class="gp-preview-pane" aria-label="Prévia do widget"></aside>
          </div>
          <footer class="gp-footer">
            <div class="gp-footer-left">
              <button type="button" class="gp-manual-link" data-gp-manual="1">Não encontrou seu jogo? Adicionar manualmente</button>
              <button type="button" class="btn-danger small-btn gp-remove-btn hidden" data-gp-remove="1">Remover do Mural</button>
            </div>
            <div class="gp-footer-actions">
              <button type="button" class="btn-secondary small-btn" data-gp-cancel="1">Cancelar</button>
              <button type="button" class="btn-primary small-btn" data-gp-save="1">Salvar</button>
            </div>
          </footer>
        </div>
      `;

      const titleEl = overlay.querySelector("#gp-title");
      const subEl = overlay.querySelector(".gp-subtitle");
      const detectedSlot = overlay.querySelector(".gp-detected-slot");
      const searchInput = overlay.querySelector(".gp-search-input");
      const searchClear = overlay.querySelector(".gp-search-clear");
      const catalogPane = overlay.querySelector(".gp-catalog-pane");
      const previewPane = overlay.querySelector(".gp-preview-pane");
      const saveBtn = overlay.querySelector("[data-gp-save]");
      const cancelBtn = overlay.querySelector("[data-gp-cancel]");
      const closeBtn = overlay.querySelector(".gp-close-btn");
      const manualBtn = overlay.querySelector("[data-gp-manual]");
      const removeBtn = overlay.querySelector("[data-gp-remove]");

      titleEl.textContent = meta.dialogTitle;
      subEl.textContent = meta.subtitle;
      if (allowRemove && existing) removeBtn.classList.remove("hidden");

      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(debounceTimer);
        if (currentAbort) currentAbort.abort();
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        if (activeOverlay?.overlay === overlay) activeOverlay = null;
        if (opener?.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
        resolve(result);
      }

      function onKeyDown(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }

      activeOverlay = { overlay, close: finish };

      function selectGame(game, { disableAuto = true } = {}) {
        selectedGame = sanitizeGame(game);
        if (isPlaying && disableAuto) autoActivity = false;
        renderDetectedBanner();
        renderCatalog();
        renderPreview();
      }

      function renderDetectedBanner() {
        const live = getDetectedNow();
        detectedSlot.replaceChildren();
        if (!isPlaying && !live) {
          detectedSlot.classList.add("hidden");
          return;
        }
        detectedSlot.classList.remove("hidden");

        if (isPlaying) {
          const autoRow = document.createElement("label");
          autoRow.className = "gp-auto-toggle";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.id = "gp-auto-activity";
          cb.checked = autoActivity;
          cb.addEventListener("change", () => {
            autoActivity = cb.checked;
            renderDetectedBanner();
            renderPreview();
          });
          const copy = document.createElement("span");
          copy.className = "gp-auto-copy";
          const strong = document.createElement("strong");
          strong.textContent = "Atualizar automaticamente com minha atividade";
          const small = document.createElement("small");
          small.textContent = autoActivity
            ? "O widget acompanha em tempo real o jogo detectado no seu PC."
            : "Modo fixo: exibe o jogo escolhido manualmente abaixo.";
          copy.append(strong, small);
          autoRow.append(cb, copy);
          detectedSlot.append(autoRow);
        }

        if (live && live.name) {
          const known = resolveKnownGame(live.name);
          const chip = document.createElement("div");
          chip.className = "gp-detected-card";
          const cover = createCoverNode(known?.cover_url || live.large_image || null, live.name, "gp-detected-thumb");
          const info = document.createElement("div");
          info.className = "gp-detected-info";
          const pill = document.createElement("span");
          pill.className = "gp-detected-pill";
          pill.textContent = "Detectado agora";
          const nameEl = document.createElement("strong");
          nameEl.textContent = live.name;
          const elapsed = live.started_at && typeof SancordActivity !== "undefined"
            ? SancordActivity.formatElapsed(live.started_at)
            : "";
          const sub = document.createElement("small");
          sub.textContent = elapsed ? `Jogando ${elapsed}` : "Jogo aberto no seu PC";
          info.append(pill, nameEl, sub);

          const useBtn = document.createElement("button");
          useBtn.type = "button";
          useBtn.className = "btn-secondary small-btn";
          useBtn.dataset.gpUseDetected = "1";
          useBtn.textContent = "Usar este jogo";
          useBtn.addEventListener("click", () => {
            const gameObj = known
              ? { ...known }
              : { id: `local:${normalizeKey(live.name).replace(/\s+/g, "-")}`, title: live.name, cover_url: live.large_image || null, platforms: ["PC"] };
            selectGame(gameObj, { disableAuto: !isPlaying || !autoActivity });
          });

          chip.append(cover, info, useBtn);
          detectedSlot.append(chip);
        } else if (isPlaying && autoActivity) {
          const hint = document.createElement("p");
          hint.className = "gp-detected-empty";
          hint.textContent = "Nenhum jogo aberto agora — assim que você iniciar um jogo, ele aparecerá automaticamente no Mural.";
          detectedSlot.append(hint);
        }
      }

      function createGameCard(game) {
        const isSelected = Boolean(
          selectedGame && (selectedGame.id === game.id || normalizeKey(selectedGame.title) === normalizeKey(game.title))
        );
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `gp-game-card${isSelected ? " is-selected" : ""}`;
        btn.dataset.gameId = game.id;
        btn.setAttribute("aria-pressed", String(isSelected));
        btn.title = game.title;

        const cover = createCoverNode(game.cover_url, game.title, "gp-card-cover");
        if (game.detectedNow) {
          const liveTag = document.createElement("span");
          liveTag.className = "gp-card-live-tag";
          liveTag.textContent = "Aberto";
          cover.append(liveTag);
        }
        const info = document.createElement("div");
        info.className = "gp-card-info";
        const nameEl = document.createElement("span");
        nameEl.className = "gp-card-title";
        nameEl.textContent = game.title;
        info.append(nameEl);

        const metaParts = [];
        if (game.release_year) metaParts.push(String(game.release_year));
        if (game.platforms?.length) metaParts.push(game.platforms.slice(0, 2).join(" · "));
        if (metaParts.length) {
          const subEl = document.createElement("span");
          subEl.className = "gp-card-meta";
          subEl.textContent = metaParts.join(" · ");
          info.append(subEl);
        }

        btn.append(cover, info);
        btn.addEventListener("click", () => selectGame(game, { disableAuto: true }));
        return btn;
      }

      function appendSection(heading, games) {
        if (!games.length) return;
        const sec = document.createElement("section");
        sec.className = "gp-section";
        const h = document.createElement("h4");
        h.className = "gp-section-title";
        h.textContent = heading;
        const grid = document.createElement("div");
        grid.className = "gp-grid";
        for (const g of games) grid.append(createGameCard(g));
        sec.append(h, grid);
        catalogPane.append(sec);
      }

      function renderSkeletons(count = 6) {
        const grid = document.createElement("div");
        grid.className = "gp-grid gp-skeleton-grid";
        grid.setAttribute("aria-busy", "true");
        for (let i = 0; i < count; i++) {
          const sk = document.createElement("div");
          sk.className = "gp-game-card is-skeleton";
          sk.innerHTML = '<div class="gp-card-cover"></div><div class="gp-card-info"><span class="gp-skel-line"></span><span class="gp-skel-line short"></span></div>';
          grid.append(sk);
        }
        catalogPane.append(grid);
      }

      function renderCatalog() {
        catalogPane.replaceChildren();
        const trimmed = searchQuery.trim();

        if (searchState.loading) {
          renderSkeletons(6);
          return;
        }

        if (trimmed) {
          if (searchState.error) {
            const errBox = document.createElement("div");
            errBox.className = "gp-status-banner is-error";
            const msg = document.createElement("span");
            msg.textContent = "Não foi possível carregar os jogos agora.";
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "btn-secondary small-btn";
            retry.dataset.gpRetry = "1";
            retry.textContent = "Tentar novamente";
            retry.addEventListener("click", () => runSearch(trimmed));
            errBox.append(msg, retry);
            catalogPane.append(errBox);
          }

          if (searchState.results.length) {
            appendSection(
              searchState.error ? "Resultados locais / em cache" : `Resultados para "${trimmed}"`,
              searchState.results
            );
          } else if (!searchState.error) {
            const empty = document.createElement("div");
            empty.className = "gp-empty";
            empty.textContent = `Nenhum jogo encontrado para "${trimmed}". Use "Adicionar manualmente" abaixo se quiser cadastrar um jogo fora do catálogo.`;
            catalogPane.append(empty);
          }
          return;
        }

        if (searchState.offline) {
          const off = document.createElement("div");
          off.className = "gp-status-banner";
          off.textContent = "Modo offline: exibindo jogos recentes, detectados e catálogo local.";
          catalogPane.append(off);
        }

        const recents = loadRecents();
        if (recents.length) appendSection("Recentes", recents.slice(0, 6));

        const pcGames = getPcDetectedGames();
        if (pcGames.length) appendSection("Jogos detectados no seu PC", pcGames.slice(0, 6));

        appendSection("Populares", popularGames);
      }

      function renderPreview() {
        previewPane.replaceChildren();
        const heading = document.createElement("h4");
        heading.className = "gp-preview-heading";
        heading.textContent = "Prévia no Mural";
        previewPane.append(heading);

        const live = isPlaying && autoActivity ? getDetectedNow() : null;
        const previewGame = isPlaying && autoActivity
          ? (live ? (resolveKnownGame(live.name) || { id: "live", title: live.name, cover_url: live.large_image || null, platforms: ["PC"] }) : null)
          : selectedGame;

        const card = document.createElement("div");
        card.className = "gp-preview-card";

        if (previewGame) {
          const cover = createCoverNode(previewGame.cover_url, previewGame.title, "gp-preview-cover");
          const overlayText = document.createElement("div");
          overlayText.className = "gp-preview-overlay";
          const badge = document.createElement("span");
          badge.className = "gp-preview-badge";
          badge.textContent = meta.badge;
          const title = document.createElement("strong");
          title.className = "gp-preview-title";
          title.textContent = previewGame.title;
          overlayText.append(badge, title);

          const metaLine = [];
          if (isPlaying && autoActivity && live?.started_at && typeof SancordActivity !== "undefined") {
            metaLine.push(`Jogando ${SancordActivity.formatElapsed(live.started_at)}`);
          } else {
            if (previewGame.release_year) metaLine.push(String(previewGame.release_year));
            if (previewGame.platforms?.length) metaLine.push(previewGame.platforms.slice(0, 2).join(" · "));
          }
          if (metaLine.length) {
            const sub = document.createElement("span");
            sub.className = "gp-preview-meta";
            sub.textContent = metaLine.join(" · ");
            overlayText.append(sub);
          }
          cover.append(overlayText);
          card.append(cover);
          if (noteValue.trim()) {
            const notePreview = document.createElement("p");
            notePreview.className = "gp-preview-note";
            notePreview.textContent = noteValue.trim();
            card.append(notePreview);
          }
        } else if (isPlaying && autoActivity) {
          card.classList.add("is-auto-idle");
          const badge = document.createElement("span");
          badge.className = "gp-preview-badge";
          badge.textContent = meta.badge;
          const title = document.createElement("strong");
          title.textContent = "Nenhum jogo no momento";
          const sub = document.createElement("small");
          sub.textContent = "Sincronizado automaticamente com sua Atividade.";
          card.append(badge, title, sub);
        } else {
          card.classList.add("is-empty");
          const msg = document.createElement("p");
          msg.textContent = "Selecione um jogo ao lado para ver como ele ficará no seu Mural.";
          card.append(msg);
        }

        previewPane.append(card);

        const noteWrap = document.createElement("label");
        noteWrap.className = "gp-note-field";
        const noteLabel = document.createElement("span");
        noteLabel.textContent = "Adicionar uma nota (opcional)";
        const noteInput = document.createElement("textarea");
        noteInput.rows = 2;
        noteInput.maxLength = 160;
        noteInput.placeholder = meta.notePlaceholder;
        noteInput.value = noteValue;
        noteInput.addEventListener("input", () => {
          noteValue = noteInput.value;
          const existingNote = card.querySelector(".gp-preview-note");
          const clean = noteValue.trim();
          if (clean && previewGame) {
            if (existingNote) existingNote.textContent = clean;
            else {
              const p = document.createElement("p");
              p.className = "gp-preview-note";
              p.textContent = clean;
              card.append(p);
            }
          } else if (existingNote) {
            existingNote.remove();
          }
        });
        noteWrap.append(noteLabel, noteInput);
        previewPane.append(noteWrap);

        saveBtn.disabled = !(selectedGame || (isPlaying && autoActivity));
      }

      async function runSearch(query) {
        if (currentAbort) currentAbort.abort();
        currentAbort = new AbortController();
        const signal = currentAbort.signal;
        const trimmed = String(query || "").trim();
        searchState = { loading: true, error: false, offline: false, results: [] };
        renderCatalog();

        try {
          if (!trimmed) {
            const res = await fetchPopularGames(signal);
            if (signal.aborted || settled) return;
            popularGames = res.games;
            searchState = { loading: false, error: false, offline: res.offline, results: [] };
          } else {
            const res = await fetchSearchGames(trimmed, signal);
            if (signal.aborted || settled) return;
            searchState = { loading: false, error: res.error, offline: false, results: res.games };
          }
          renderCatalog();
        } catch (err) {
          if (err?.name === "AbortError" || settled) return;
          searchState = { loading: false, error: true, offline: false, results: searchLocalGames(trimmed, 12) };
          renderCatalog();
        }
      }

      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        searchClear.classList.toggle("hidden", !searchQuery.length);
        clearTimeout(debounceTimer);
        if (!searchQuery.trim()) {
          searchState = { loading: false, error: false, offline: searchState.offline, results: [] };
          renderCatalog();
          return;
        }
        debounceTimer = setTimeout(() => runSearch(searchQuery), DEBOUNCE_MS);
      });

      searchClear.addEventListener("click", () => {
        searchInput.value = "";
        searchQuery = "";
        searchClear.classList.add("hidden");
        clearTimeout(debounceTimer);
        if (currentAbort) currentAbort.abort();
        searchState = { loading: false, error: false, offline: searchState.offline, results: [] };
        renderCatalog();
        searchInput.focus();
      });

      saveBtn.addEventListener("click", () => {
        if (!selectedGame && !(isPlaying && autoActivity)) return;
        const chosen = isPlaying && autoActivity && !selectedGame
          ? (() => {
              const live = getDetectedNow();
              return live ? (resolveKnownGame(live.name) || sanitizeGame({ title: live.name, platforms: ["PC"] })) : null;
            })()
          : selectedGame;
        if (chosen) {
          rememberGames([chosen]);
          saveRecent(chosen);
        }
        const widget = buildWidgetFromSelection({
          kind,
          game: chosen,
          note: noteValue,
          autoActivity,
          existing,
        });
        finish({ action: "save", widget });
      });

      cancelBtn.addEventListener("click", () => finish(null));
      closeBtn.addEventListener("click", () => finish(null));
      manualBtn.addEventListener("click", () => finish({ action: "manual" }));
      removeBtn.addEventListener("click", () => finish({ action: "remove" }));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(null);
      });
      document.addEventListener("keydown", onKeyDown, true);

      document.body.append(overlay);
      renderDetectedBanner();
      renderPreview();
      runSearch("");
      searchInput.focus();
    });
  }

  /**
   * Modal compacto de detalhes ao clicar em um widget de jogo no Mural.
   */
  function openGameDetails({ widget, liveActivity = null, isOwner = false, onSwap = null, onRemove = null } = {}) {
    if (!widget) return;
    closeActive();
    const opener = document.activeElement;
    const meta = KIND_META[widget.kind] || KIND_META.favorite_game;
    const useLive = widget.kind === "playing" && widget.auto_activity && liveActivity?.name;
    const title = useLive ? liveActivity.name : (widget.name || "Nenhum jogo no momento");
    const known = resolveKnownGame(title);
    const coverUrl = useLive
      ? (known?.cover_url || liveActivity.large_image || null)
      : (widget.cover_url
        || (/^[0-9a-f]{32}$/.test(widget.cover_id || "") ? `/api/attachments/${widget.cover_id}/capa` : null)
        || known?.cover_url
        || null);
    const year = widget.release_year || known?.release_year || null;
    const platforms = (widget.platforms?.length ? widget.platforms : known?.platforms) || [];
    const note = widget.description || widget.note || "";

    const overlay = document.createElement("div");
    overlay.className = "sancord-dialog-backdrop gp-backdrop";
    overlay.dataset.gameDetails = "1";

    const dlg = document.createElement("div");
    dlg.className = "sancord-dialog gp-details-dialog";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");

    const hero = createCoverNode(coverUrl, title, "gp-details-hero");
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gp-close-btn gp-details-close";
    closeBtn.setAttribute("aria-label", "Fechar detalhes do jogo");
    closeBtn.textContent = "✕";
    hero.append(closeBtn);

    const body = document.createElement("div");
    body.className = "gp-details-body";
    const badge = document.createElement("span");
    badge.className = "gp-preview-badge";
    badge.textContent = meta.badge;
    const h3 = document.createElement("h3");
    h3.textContent = title;
    body.append(badge, h3);

    const metaBits = [];
    if (year) metaBits.push(String(year));
    if (platforms.length) metaBits.push(platforms.join(" · "));
    if (useLive && liveActivity.started_at && typeof SancordActivity !== "undefined") {
      metaBits.push(`Jogando ${SancordActivity.formatElapsed(liveActivity.started_at)}`);
    }
    if (metaBits.length) {
      const p = document.createElement("p");
      p.className = "gp-details-meta";
      p.textContent = metaBits.join(" · ");
      body.append(p);
    }
    if (note) {
      const n = document.createElement("p");
      n.className = "gp-details-note";
      n.textContent = note;
      body.append(n);
    }

    const actions = document.createElement("div");
    actions.className = "gp-details-actions";
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (activeOverlay?.overlay === overlay) activeOverlay = null;
      if (opener?.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    activeOverlay = { overlay, close };

    if (isOwner && typeof onSwap === "function") {
      const swapBtn = document.createElement("button");
      swapBtn.type = "button";
      swapBtn.className = "btn-primary small-btn";
      swapBtn.textContent = "Trocar jogo";
      swapBtn.addEventListener("click", () => {
        close();
        onSwap();
      });
      actions.append(swapBtn);
    }
    if (isOwner && typeof onRemove === "function") {
      const remBtn = document.createElement("button");
      remBtn.type = "button";
      remBtn.className = "btn-danger small-btn";
      remBtn.textContent = "Remover do Mural";
      remBtn.addEventListener("click", () => {
        close();
        onRemove();
      });
      actions.append(remBtn);
    }
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn-secondary small-btn";
    okBtn.textContent = "Fechar";
    okBtn.addEventListener("click", close);
    actions.append(okBtn);

    body.append(actions);
    dlg.append(hero, body);
    overlay.append(dlg);

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    okBtn.focus();
  }

  function resetCacheForTests() {
    memById.clear();
    popularCache = null;
  }

  return {
    open,
    openGameDetails,
    closeActive,
    resolveKnownGame,
    resolveGameAsync,
    searchLocalGames,
    isSafeCoverUrl,
    createCoverNode,
    coverPlaceholderEl,
    loadRecents,
    saveRecent,
    resetCacheForTests,
    KIND_META,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SancordGamePicker, SanvoGamePicker: SancordGamePicker };
}
const SanvoGamePicker = SancordGamePicker;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoGamePicker = SancordGamePicker;
  globalThis.SancordGamePicker = SancordGamePicker; // LEGACY COMPATIBILITY
}
