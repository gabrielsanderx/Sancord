/**
 * SancordActivity — Detecção de jogos + Rich Presence + Privacidade de Atividade.
 *
 * Arquitetura extensível por fonte (prioridade: `rpc` > `game_detector` > `manual`),
 * desacoplada do detector de processos do Windows para suportar integrações futuras
 * de Rich Presence via API/SDK local sem reescrever presença nem UI.
 */
const SancordActivity = (() => {
  const LS_KEY = "sancord_activity_prefs_v1";
  const SOURCE_PRIORITY = { rpc: 3, game_detector: 2, manual: 1 };
  const KIND_HEADERS = {
    playing: "JOGANDO UM JOGO",
    listening: "OUVINDO",
    watching: "ASSISTINDO",
    competing: "COMPETINDO EM",
  };
  const KIND_VERBS = {
    playing: "Jogando",
    listening: "Ouvindo",
    watching: "Assistindo",
    competing: "Competindo em",
  };

  let config = loadLocalConfig();
  let detected = null;
  let registered = [];
  let candidates = [];
  let steamCount = 0;
  let epicCount = 0;
  let nativeSupported = Boolean(window.__SANCORD_ACTIVITY_NATIVE && window.ipc?.postMessage);
  const sources = new Map();
  let lastPublishedJson = "__init__";
  let initialized = false;
  let timerId = null;
  const listeners = new Set();

  function notifyListeners() {
    const active = resolveActiveActivity();
    for (const fn of listeners) {
      try { fn(active); } catch (_) {}
    }
    try {
      if (typeof onBoardEditorChanged === "function" && typeof boardEditor !== "undefined" && boardEditor?.draft) {
        onBoardEditorChanged();
      }
      const tab = document.getElementById("settings-tab-profile");
      if (tab && !tab.classList.contains("hidden") && typeof renderPeActivity === "function" && typeof draftPreviewUser === "function") {
        renderPeActivity(draftPreviewUser());
      }
    } catch (_) {}
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getDetectedGame() {
    const active = resolveActiveActivity();
    if (active && active.name) return { ...active };
    if (detected && detected.name) {
      return {
        kind: detected.kind || "playing",
        application_id: detected.application_id || null,
        name: detected.name,
        started_at: detected.started_at || null,
        exe_name: detected.exe_name || null,
        source: "game_detector",
      };
    }
    return null;
  }

  function getLocalGames() {
    const out = [];
    const seen = new Set();
    const push = (name, meta = {}) => {
      const clean = String(name || "").trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name: clean, ...meta });
    };
    const active = getDetectedGame();
    if (active) push(active.name, { detectedNow: true, started_at: active.started_at, exe_name: active.exe_name });
    for (const g of registered) {
      if (g && g.display_name && g.enabled !== false) {
        push(g.display_name, { detectedNow: Boolean(detected && detected.exe_name === g.exe_name), registered: true, exe_name: g.exe_name });
      }
    }
    return out;
  }

  function loadLocalConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (raw && typeof raw === "object") {
        return {
          detect_games: raw.detect_games !== false,
          share_activity: raw.share_activity !== false,
        };
      }
    } catch (_) {}
    return { detect_games: true, share_activity: true };
  }

  function saveLocalConfig() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(config));
    } catch (_) {}
  }

  function postNative(action, payload) {
    if (!window.ipc?.postMessage || !window.__SANCORD_ACTIVITY_NATIVE) return false;
    try {
      const msg = payload !== undefined ? `activity:${action}:${JSON.stringify(payload)}` : `activity:${action}`;
      window.ipc.postMessage(msg);
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatElapsed(startedAt, now = Date.now()) {
    if (!Number.isFinite(startedAt) || startedAt <= 0) return "";
    const diffSec = Math.max(0, Math.floor((now - startedAt) / 1000));
    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    if (hours >= 1) {
      return mins > 0 ? `há ${hours}h ${mins}min` : `há ${hours}h`;
    }
    if (mins >= 1) {
      return mins === 1 ? "há 1 minuto" : `há ${mins} minutos`;
    }
    return "agora mesmo";
  }

  function formatRemaining(endsAt, now = Date.now()) {
    if (!Number.isFinite(endsAt) || endsAt <= now) return "";
    const diffSec = Math.max(0, Math.floor((endsAt - now) / 1000));
    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    if (hours >= 1) return `${hours}h ${mins}min restantes`;
    if (mins >= 1) return `${mins} min restantes`;
    return `${diffSec}s restantes`;
  }

  function formatParty(activity) {
    if (!activity || !Number.isFinite(activity.party_size)) return "";
    if (Number.isFinite(activity.party_max) && activity.party_max >= activity.party_size) {
      return `${activity.party_size} de ${activity.party_max} jogadores`;
    }
    return `${activity.party_size} jogador${activity.party_size === 1 ? "" : "es"}`;
  }

  function formatCompactLine(activity) {
    if (!activity || !activity.name) return "";
    const kind = String(activity.kind || "playing").toLowerCase();
    const icon = kind === "listening" ? "🎧" : kind === "watching" ? "📺" : kind === "competing" ? "🏆" : "🎮";
    return `${icon} ${activity.name}`;
  }

  function formatSummarySentence(activity) {
    if (!activity || !activity.name) return "";
    const kind = String(activity.kind || "playing").toLowerCase();
    const verb = KIND_VERBS[kind] || "Jogando";
    return `${verb} ${activity.name}`;
  }

  function kindHeader(activity) {
    const kind = String(activity?.kind || "playing").toLowerCase();
    return KIND_HEADERS[kind] || "JOGANDO UM JOGO";
  }

  function safeHref(url) {
    if (typeof url !== "string") return null;
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "http:") return u.href;
    } catch (_) {}
    return null;
  }

  function safeImageUrl(raw) {
    if (typeof raw !== "string") return null;
    try {
      const u = new URL(raw);
      if (u.protocol === "https:") return u.href;
    } catch (_) {}
    return null;
  }

  /**
   * Renderiza cartão estruturado de atividade / Rich Presence sem inventar
   * campos ausentes. Reutilizado no Popout, Perfil Completo e Prévia.
   */
  function createRichActivityCard(activity, opts = {}) {
    if (!activity || !activity.name) return null;
    const doc = opts.document || document;
    const compact = Boolean(opts.compact);
    const card = doc.createElement("div");
    card.className = compact ? "rich-activity-card is-compact" : "rich-activity-card";
    card.dataset.activityCard = "1";
    if (activity.started_at) card.dataset.startedAt = String(activity.started_at);
    if (activity.ends_at) card.dataset.endsAt = String(activity.ends_at);

    const header = doc.createElement("div");
    header.className = "rich-activity-header";
    header.textContent = kindHeader(activity);
    card.appendChild(header);

    const body = doc.createElement("div");
    body.className = "rich-activity-body";

    const artWrap = doc.createElement("div");
    artWrap.className = "rich-activity-art";
    const largeUrl = safeImageUrl(activity.large_image);
    if (largeUrl) {
      const img = doc.createElement("img");
      img.className = "rich-activity-large-img";
      img.src = largeUrl;
      img.alt = activity.large_text || activity.name;
      if (activity.large_text) img.title = activity.large_text;
      artWrap.appendChild(img);
    } else {
      const fallback = doc.createElement("div");
      fallback.className = "rich-activity-fallback-icon";
      fallback.setAttribute("aria-hidden", "true");
      fallback.textContent = activity.kind === "listening" ? "🎧" : activity.kind === "watching" ? "📺" : "🎮";
      artWrap.appendChild(fallback);
    }
    const smallUrl = safeImageUrl(activity.small_image);
    if (smallUrl) {
      const small = doc.createElement("img");
      small.className = "rich-activity-small-img";
      small.src = smallUrl;
      small.alt = activity.small_text || "";
      if (activity.small_text) small.title = activity.small_text;
      artWrap.appendChild(small);
    }
    body.appendChild(artWrap);

    const meta = doc.createElement("div");
    meta.className = "rich-activity-meta";

    const title = doc.createElement("strong");
    title.className = "rich-activity-name";
    title.textContent = activity.name;
    meta.appendChild(title);

    if (activity.details) {
      const det = doc.createElement("div");
      det.className = "rich-activity-line";
      det.textContent = activity.details;
      meta.appendChild(det);
    }

    const partyText = formatParty(activity);
    if (activity.state || partyText) {
      const stLine = doc.createElement("div");
      stLine.className = "rich-activity-line";
      stLine.textContent = [activity.state, partyText].filter(Boolean).join(" · ");
      meta.appendChild(stLine);
    }

    const timeText = activity.ends_at
      ? formatRemaining(activity.ends_at)
      : activity.started_at
        ? formatElapsed(activity.started_at)
        : "";
    if (timeText) {
      const timeEl = doc.createElement("div");
      timeEl.className = "rich-activity-time";
      timeEl.dataset.activityTime = "1";
      timeEl.textContent = timeText;
      meta.appendChild(timeEl);
    }

    body.appendChild(meta);
    card.appendChild(body);

    const validButtons = (Array.isArray(activity.buttons) ? activity.buttons : [])
      .slice(0, 2)
      .map((b) => ({ label: b?.label, href: safeHref(b?.url) }))
      .filter((b) => b.label && b.href);
    if (validButtons.length) {
      const actions = doc.createElement("div");
      actions.className = "rich-activity-buttons";
      for (const b of validButtons) {
        const a = doc.createElement("a");
        a.className = "rich-activity-btn";
        a.href = b.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = b.label;
        actions.appendChild(a);
      }
      card.appendChild(actions);
    }

    return card;
  }

  function resolveActiveActivity() {
    let best = null;
    let bestPrio = -1;
    for (const [sourceName, payload] of sources.entries()) {
      if (!payload || !payload.name) continue;
      const prio = SOURCE_PRIORITY[sourceName] || 1;
      if (prio > bestPrio) {
        bestPrio = prio;
        best = payload;
      }
    }
    return best;
  }

  function shouldPublish() {
    if (!config.share_activity) return false;
    if (typeof state !== "undefined" && state.selfUser?.status_kind === "invisible") return false;
    return true;
  }

  function syncToServer(force = false) {
    const active = shouldPublish() ? resolveActiveActivity() : null;
    const serialized = JSON.stringify(active);
    if (!force && serialized === lastPublishedJson) return;
    if (typeof state === "undefined" || !state.selfUser) return;
    const connected = typeof SancordConnection !== "undefined"
      ? SancordConnection.canWrite()
      : state.ws?.readyState === WebSocket.OPEN;
    if (!connected) return;
    lastPublishedJson = serialized;
    if (typeof sendWs === "function") {
      sendWs("UpdateActivity", { activity: active });
    }
  }

  /**
   * Ponto de entrada extensível para fontes futuras (ex.: RPC local de jogos/apps).
   */
  function setSourceActivity(sourceName, activity) {
    if (!sourceName) return;
    if (activity && activity.name) {
      sources.set(sourceName, { ...activity, source: sourceName });
    } else {
      sources.delete(sourceName);
    }
    syncToServer();
    renderSettingsPanel();
    notifyListeners();
  }

  function applyNativeSnapshot(detail) {
    if (!detail || typeof detail !== "object") return;
    nativeSupported = Boolean(detail.supported);
    if (detail.config) {
      config = {
        detect_games: detail.config.detect_games !== false,
        share_activity: detail.config.share_activity !== false,
      };
      saveLocalConfig();
    }
    detected = detail.detected || null;
    registered = Array.isArray(detail.registered) ? detail.registered : [];
    candidates = Array.isArray(detail.candidates) ? detail.candidates : [];
    steamCount = Number(detail.steamCount || 0);
    epicCount = Number(detail.epicCount || 0);

    if (detail.error && typeof showUiToast === "function") {
      showUiToast(detail.error);
    }

    if (detected && detected.name) {
      sources.set("game_detector", {
        kind: detected.kind || "playing",
        application_id: detected.application_id || null,
        name: detected.name,
        started_at: detected.started_at || Date.now(),
        source: "game_detector",
      });
    } else {
      sources.delete("game_detector");
    }

    syncToServer();
    renderSettingsPanel();
    notifyListeners();
  }

  function setConfig(patch) {
    config = { ...config, ...patch };
    saveLocalConfig();
    if (!config.detect_games) {
      detected = null;
      sources.delete("game_detector");
    }
    postNative("set-config", config);
    syncToServer(true);
    renderSettingsPanel();
    notifyListeners();
  }

  function registerGame(exeName, displayName) {
    if (!exeName || !displayName) return;
    postNative("register-game", { exe_name: exeName, display_name: displayName });
  }

  function updateGame(exeName, patch) {
    if (!exeName) return;
    postNative("update-game", { exe_name: exeName, ...patch });
  }

  function removeGame(exeName) {
    if (!exeName) return;
    postNative("remove-game", { exe_name: exeName });
  }

  function refreshLiveTimers() {
    if (isVisualWindowHidden()) return;
    const now = Date.now();
    for (const card of document.querySelectorAll("[data-activity-card='1']")) {
      const el = card.querySelector("[data-activity-time='1']");
      if (!el) continue;
      const endsAt = Number(card.dataset.endsAt || 0);
      const startedAt = Number(card.dataset.startedAt || 0);
      const text = endsAt ? formatRemaining(endsAt, now) : startedAt ? formatElapsed(startedAt, now) : "";
      if (text && el.textContent !== text) el.textContent = text;
    }
    const settingsTimer = document.getElementById("activity-current-timer");
    const active = resolveActiveActivity();
    if (settingsTimer && active?.started_at) {
      settingsTimer.textContent = formatElapsed(active.started_at, now);
    }
  }

  function syncActivityClock() {
    if (isVisualWindowHidden()) {
      clearInterval(timerId);
      timerId = null;
    } else if (timerId === null) {
      refreshLiveTimers();
      timerId = setInterval(refreshLiveTimers, 30000);
    }
  }

  function renderSettingsPanel() {
    const shareToggle = document.getElementById("activity-share-toggle");
    const detectToggle = document.getElementById("activity-detect-toggle");
    const banner = document.getElementById("activity-detected-banner");
    const regList = document.getElementById("activity-registered-list");
    const candSelect = document.getElementById("activity-candidate-select");
    const desktopNotice = document.getElementById("activity-desktop-only-note");
    const catalogHint = document.getElementById("activity-catalog-hint");

    if (shareToggle) shareToggle.checked = config.share_activity;
    if (detectToggle) {
      detectToggle.checked = config.detect_games;
      detectToggle.disabled = !nativeSupported;
    }
    if (desktopNotice) {
      desktopNotice.classList.toggle("hidden", nativeSupported);
    }
    if (catalogHint) {
      const extras = [];
      if (steamCount > 0) extras.push(`${steamCount} jogo${steamCount === 1 ? "" : "s"} Steam`);
      if (epicCount > 0) extras.push(`${epicCount} Epic`);
      catalogHint.textContent = extras.length
        ? `Catálogo local + detecção automática (${extras.join(" e ")}).`
        : "Catálogo local de jogos populares + jogos adicionados por você.";
    }

    if (banner) {
      const active = resolveActiveActivity();
      banner.replaceChildren();
      if (active) {
        banner.className = "activity-status-banner is-active";
        const left = document.createElement("div");
        left.className = "activity-status-banner-main";
        const badge = document.createElement("span");
        badge.className = "activity-status-pill";
        badge.textContent = shouldPublish() ? "Detectado e visível" : "Detectado (privado)";
        const title = document.createElement("strong");
        title.textContent = formatSummarySentence(active);
        const sub = document.createElement("div");
        sub.className = "settings-hint-text";
        const timeSpan = document.createElement("span");
        timeSpan.id = "activity-current-timer";
        timeSpan.textContent = active.started_at ? formatElapsed(active.started_at) : "ativo";
        sub.append(
          document.createTextNode(shouldPublish() ? "Compartilhando no perfil · " : "Compartilhamento desligado · "),
          timeSpan
        );
        left.append(badge, title, sub);
        banner.appendChild(left);
      } else {
        banner.className = "activity-status-banner";
        const title = document.createElement("strong");
        title.textContent = config.detect_games
          ? "Nenhum jogo detectado no momento"
          : "Detecção automática desativada";
        const sub = document.createElement("div");
        sub.className = "settings-hint-text";
        sub.textContent = config.detect_games
          ? "Abra um jogo reconhecido ou adicione um aplicativo abaixo para exibir sua atividade."
          : "Ative a detecção automática para reconhecer jogos abertos no Windows.";
        banner.append(title, sub);
      }
    }

    if (candSelect) {
      const prev = candSelect.value;
      candSelect.replaceChildren();
      const first = document.createElement("option");
      first.value = "";
      first.textContent = candidates.length
        ? "Selecionar aplicativo aberto agora…"
        : "Nenhum outro aplicativo detectado agora";
      candSelect.appendChild(first);
      for (const c of candidates) {
        const opt = document.createElement("option");
        opt.value = c.exe_name;
        opt.dataset.suggested = c.suggested_name;
        opt.textContent = `${c.suggested_name} (${c.exe_name})`;
        candSelect.appendChild(opt);
      }
      if (prev && [...candSelect.options].some((o) => o.value === prev)) {
        candSelect.value = prev;
      }
    }

    if (regList) {
      regList.replaceChildren();
      const items = [];
      if (detected && !registered.some((g) => g.exe_name === detected.exe_name)) {
        items.push({
          exe_name: detected.exe_name,
          display_name: detected.name,
          detectedNow: true,
          registered: false,
          enabled: true,
        });
      }
      for (const g of registered) {
        items.push({
          ...g,
          detectedNow: Boolean(detected && detected.exe_name === g.exe_name),
          registered: true,
        });
      }

      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "settings-hint-text";
        empty.textContent = "Nenhum jogo registrado manualmente ainda. Jogos do catálogo, Steam e Epic são detectados automaticamente.";
        regList.appendChild(empty);
      } else {
        for (const item of items) {
          const row = document.createElement("div");
          row.className = "activity-game-row";
          const info = document.createElement("div");
          info.className = "activity-game-info";
          const nameEl = document.createElement("strong");
          nameEl.textContent = item.display_name;
          const metaEl = document.createElement("div");
          metaEl.className = "settings-hint-text";
          metaEl.textContent = `${item.exe_name}${item.detectedNow ? " · Detectado agora" : item.enabled === false ? " · Oculto" : " · Registrado"}`;
          info.append(nameEl, metaEl);

          const actions = document.createElement("div");
          actions.className = "activity-game-actions";

          const renameBtn = document.createElement("button");
          renameBtn.type = "button";
          renameBtn.className = "btn-secondary small-btn";
          renameBtn.textContent = "Renomear";
          renameBtn.addEventListener("click", () => {
            const next = window.prompt("Nome de exibição local do jogo:", item.display_name);
            if (!next || !next.trim()) return;
            if (item.registered) updateGame(item.exe_name, { display_name: next.trim() });
            else registerGame(item.exe_name, next.trim());
          });
          actions.appendChild(renameBtn);

          if (item.registered) {
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "btn-danger small-btn";
            removeBtn.textContent = "Remover";
            removeBtn.addEventListener("click", () => removeGame(item.exe_name));
            actions.appendChild(removeBtn);
          }

          row.append(info, actions);
          regList.appendChild(row);
        }
      }
    }
  }

  function wireSettingsControls() {
    const shareToggle = document.getElementById("activity-share-toggle");
    const detectToggle = document.getElementById("activity-detect-toggle");
    const scanBtn = document.getElementById("activity-scan-now-btn");
    const candSelect = document.getElementById("activity-candidate-select");
    const exeInput = document.getElementById("activity-manual-exe");
    const nameInput = document.getElementById("activity-manual-name");
    const addBtn = document.getElementById("activity-add-game-btn");

    shareToggle?.addEventListener("change", () => setConfig({ share_activity: shareToggle.checked }));
    detectToggle?.addEventListener("change", () => setConfig({ detect_games: detectToggle.checked }));
    scanBtn?.addEventListener("click", () => postNative("scan-now"));

    candSelect?.addEventListener("change", () => {
      const opt = candSelect.selectedOptions[0];
      if (!opt || !opt.value) return;
      if (exeInput) exeInput.value = opt.value;
      if (nameInput) nameInput.value = opt.dataset.suggested || "";
    });

    addBtn?.addEventListener("click", () => {
      const exe = (exeInput?.value || "").trim();
      const name = (nameInput?.value || "").trim();
      if (!exe || !name) {
        if (typeof showUiToast === "function") showUiToast("Informe o executável (.exe) e o nome do jogo.");
        return;
      }
      registerGame(exe, name);
      if (exeInput) exeInput.value = "";
      if (nameInput) nameInput.value = "";
      if (candSelect) candSelect.value = "";
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    wireSettingsControls();
    window.addEventListener("sancord-activity-state", (e) => applyNativeSnapshot(e.detail));
    document.addEventListener("sancord:connection", (e) => {
      if (e.detail?.phase === "CONNECTED") {
        lastPublishedJson = "__reconnect__";
        syncToServer(true);
      }
    });
    if (nativeSupported) {
      postNative("get-state");
    }
    renderSettingsPanel();
    document.addEventListener("sanvo:visual-visibility", syncActivityClock);
    syncActivityClock();
  }

  function onSelfStatusChanged() {
    syncToServer(true);
    renderSettingsPanel();
    notifyListeners();
  }

  function onSettingsOpened() {
    if (nativeSupported) postNative("scan-now");
    renderSettingsPanel();
  }

  return {
    init,
    setConfig,
    setSourceActivity,
    applyNativeSnapshot,
    registerGame,
    updateGame,
    removeGame,
    syncToServer,
    onSelfStatusChanged,
    onSettingsOpened,
    formatElapsed,
    formatRemaining,
    formatParty,
    formatCompactLine,
    formatSummarySentence,
    kindHeader,
    createRichActivityCard,
    resolveActiveActivity,
    getDetectedGame,
    getLocalGames,
    subscribe,
    refreshLiveTimers,
    getConfig: () => ({ ...config }),
  };
})();
const SanvoActivity = SancordActivity;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoActivity = SancordActivity;
  globalThis.SancordActivity = SancordActivity; // LEGACY COMPATIBILITY
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SancordActivity, SanvoActivity };
}
