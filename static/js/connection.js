const SancordConnection = (() => {
  const delays = [1000, 2000, 4000, 8000, 15000, 30000];
  const titles = {
    network: "Parece que você está offline",
    server: "Não conseguimos conectar ao Sancord",
    realtime: "A conexão em tempo real foi interrompida",
    maintenance: "O Sancord está temporariamente em manutenção",
  };
  let phase = "OFFLINE", reason = null, ready = false, stopped = true;
  let everConnected = false, loaded = false, anonymous = false, attempt = 0, lostAt = 0, lastHeartbeat = 0;
  let retryTimer, handshakeTimer, heartbeatTimer, successTimer, longTimer, probe;
  let nextAt = 0, disconnectedNotice = 0;

  const canWrite = () => ready && state.ws?.readyState === WebSocket.OPEN;
  const banner = () => document.getElementById("connection-banner");
  const offlineScreen = () => document.getElementById("offline-screen");
  const cold = () => !loaded && !stopped;

  function render() {
    const live = phase === "CONNECTED";
    const showBanner = !stopped && loaded && (!live || Boolean(successTimer));
    const notice = banner();
    const screen = offlineScreen();
    const long = lostAt > 0 && Date.now() - lostAt >= 12000;
    document.body.dataset.connection = phase;
    notice.classList.toggle("hidden", !showBanner);
    notice.classList.toggle("is-online", live);
    notice.classList.toggle("is-reconnecting", !live);
    notice.querySelector(".connection-banner-text").textContent = live
      ? "Conectado novamente ✓"
      : reason && reason !== "realtime" ? titles[reason] : "Reconectando…";
    notice.querySelector(".connection-banner-detail").textContent = live ? "" : long
      ? "Ainda estamos tentando. Você está vendo dados carregados anteriormente."
      : reason === "realtime" ? "A conexão em tempo real caiu. Você pode consultar o que já foi carregado."
      : "Você pode consultar o que já foi carregado.";
    notice.querySelector("[data-connection-retry]").classList.toggle("hidden", live);
    notice.querySelector("[data-connection-diagnostics]").classList.toggle("hidden", live || !long);
    screen.classList.toggle("hidden", !cold() || (!lostAt && !document.body.hasAttribute("data-auth-pending")));
    screen.querySelector("h1").textContent = titles[reason] || "Conectando ao Sancord";
    screen.querySelector("[data-offline-status]").textContent = retryTimer ? "Aguardando nova tentativa…" : "Reconectando…";
    for (const button of document.querySelectorAll("[data-connection-retry]")) button.disabled = Boolean(state.ws || (anonymous && probe));
    const dot = document.getElementById("ws-status-dot");
    dot?.classList.toggle("connected", live);
    if (dot) dot.title = live ? "Conectado ao Sancord" : notice.querySelector(".connection-banner-text").textContent;
    if (typeof syncComposerChrome === "function") syncComposerChrome();
    if (typeof SancordOutbox !== "undefined") SancordOutbox.render();
    document.dispatchEvent(new CustomEvent("sancord:connection", { detail: { phase, reason } }));
  }

  function clearTimers() {
    clearTimeout(retryTimer);
    clearTimeout(handshakeTimer);
    clearTimeout(heartbeatTimer);
    clearTimeout(successTimer);
    clearTimeout(longTimer);
    retryTimer = handshakeTimer = heartbeatTimer = successTimer = longTimer = null;
    probe?.abort();
    probe = null;
    nextAt = 0;
  }

  function stop(expired = false) {
    stopped = true;
    ready = everConnected = loaded = anonymous = false;
    attempt = lostAt = lastHeartbeat = 0;
    reason = null;
    phase = expired ? "AUTH_EXPIRED" : "OFFLINE";
    clearTimers();
    SancordNet.interruptUploads();
    interruptAttachmentUploads();
    const socket = state.ws;
    state.ws = null;
    try { socket?.close(1000); } catch (_) {}
    render();
  }

  function reject(message) {
    if (stopped && !getStoredToken()) return;
    const username = getStoredUsername();
    if (username) SancordSelfProfileMenu.removeSavedAccount(username);
    SancordOfflineCache.clear();
    SancordOutbox.suspend();
    stop(true);
    leaveVoiceChannel({ silent: true });
    clearStoredSession();
    authRejected(message);
  }

  function rawSend(ws, type, payload) {
    try {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch (_) {
      lost(ws, "send");
      return false;
    }
  }

  function markBlocked() {
    if (!loaded || stopped || Date.now() - disconnectedNotice < 3000) return;
    disconnectedNotice = Date.now();
    showUiToast("Esta ação fica disponível quando a conexão voltar.");
  }

  // Pedidos de leitura e eventos efêmeros falham silenciosamente. Mutações nunca ficam na fila do transporte.
  const quietOffline = /^(?:Typing$|Ack|Load|List|Get|Search|Ping$|VoiceSignal$|Signal$|LeaveVoice$|UpdateVoiceState$)/;
  function send(type, payload) {
    if (!canWrite()) {
      if (!quietOffline.test(type)) markBlocked();
      return false;
    }
    return rawSend(state.ws, type, payload);
  }

  async function diagnose(checkingLogin = false) {
    probe?.abort();
    const controller = probe = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 4500);
    let cause;
    try {
      const response = await SancordNet.fetch("/api/health", { cache: "no-store", signal: controller.signal });
      const health = response.ok ? await response.json() : null;
      cause = health?.maintenance_mode ? "maintenance" : health?.ok ? "realtime" : "server";
      if (response.headers?.get("Retry-After") && response.status === 503) cause = "maintenance";
    } catch (_) {
      cause = navigator.onLine === false ? "network" : "server";
    } finally {
      clearTimeout(deadline);
    }
    if (probe !== controller || stopped || ready) return;
    probe = null;
    if (checkingLogin) {
      if (!anonymous) return;
      if (cause === "realtime") { stop(); return; }
      lostAt ||= Date.now();
      attempt++;
      schedule();
    }
    reason = cause;
    phase = cause === "network" ? "OFFLINE" : "DEGRADED";
    render();
  }

  function schedule() {
    if (stopped || retryTimer || state.ws) return;
    const base = delays[Math.min(attempt, delays.length - 1)];
    const delay = Math.round(base * (0.8 + Math.random() * 0.2));
    nextAt = Date.now() + delay;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
  }

  function lost(ws, cause) {
    if (stopped || state.ws !== ws) return;
    state.ws = null;
    ready = false;
    const first = !lostAt;
    lostAt ||= Date.now();
    clearTimeout(handshakeTimer);
    clearTimeout(heartbeatTimer);
    clearTimeout(successTimer);
    successTimer = null;
    try { ws?.close(); } catch (_) {}
    phase = "RECONNECTING";
    if (first) {
      console.info("[Sancord] Conexão interrompida", { motivo: cause });
      longTimer = setTimeout(render, 12000);
      suspendVoiceForReconnect();
      interruptAttachmentUploads();
      SancordNet.interruptUploads();
    }
    resetHistoryRequests();
    SancordOutbox.suspend();
    schedule();
    render();
    void diagnose();
  }

  function heartbeat(ws, delay = 20000) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      if (state.ws !== ws || !ready || !rawSend(ws, "Ping")) return;
      if (!state.composerCapabilities?.has("connection_v1")) {
        heartbeat(ws);
        return;
      }
      heartbeatTimer = setTimeout(() => lost(ws, "heartbeat"), 12000);
    }, delay);
  }

  function synchronize(ws) {
    const returning = Boolean(lostAt || (loaded && !everConnected));
    if (lostAt) console.info("[Sancord] Conexão restabelecida", { duracaoMs: Date.now() - lostAt, tentativas: attempt });
    clearTimers();
    attempt = lostAt = 0;
    lastHeartbeat = Date.now();
    phase = "CONNECTED";
    loaded = everConnected = true;
    finishAuthScreen();
    if (returning) successTimer = setTimeout(() => { successTimer = null; render(); }, 2200);
    render();
    heartbeat(ws);
    SancordOutbox.drain();
    resumeVoiceAfterReconnect();
    refreshChatAfterReconnect();
  }

  function connect(credential = getStoredToken()) {
    if (stopped || state.ws || !SancordNet.secureForAuth) return;
    if (!credential && (!anonymous || probe)) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    nextAt = 0;
    if (!credential) {
      void diagnose(true);
      render();
      return;
    }
    if (lostAt) console.info("[Sancord] Tentativa de reconexão", { tentativa: ++attempt });
    phase = lostAt ? "RECONNECTING" : "CONNECTING";
    let ws;
    try { ws = new WebSocket(SancordNet.websocketUrl()); }
    catch (_) { lost(null, "socket"); return; }
    state.ws = ws;
    render();
    handshakeTimer = setTimeout(() => lost(ws, "handshake"), 10000);
    ws.addEventListener("open", () => {
      if (state.ws === ws) rawSend(ws, "JoinServer", { token: credential });
    });
    ws.addEventListener("message", event => {
      wsMessageQueue = wsMessageQueue.then(async () => {
        if (state.ws !== ws) return;
        const { type, payload } = JSON.parse(event.data);
        if (type === "AuthFailed") { reject(payload?.message); return; }
        if (type === "Pong") {
          if (ready) { lastHeartbeat = Date.now(); heartbeat(ws); }
          return;
        }
        if (type === "Welcome") ready = true;
        await handleServerMessage({ type, payload });
        if (state.ws !== ws) return;
        if (type === "FriendsSync" && ready && handshakeTimer) synchronize(ws);
        SancordOfflineCache.updated(type, payload);
      }).catch(() => {
        console.warn("[Sancord] Falha ao aplicar evento em tempo real.");
        if (handshakeTimer) lost(ws, "sync");
      });
    });
    ws.addEventListener("close", event => {
      if (state.ws !== ws) return;
      if (event.code === 4001) reject();
      else lost(ws, "close");
    });
  }

  function start(token, cached = false) {
    if (state.ws && !stopped) return;
    stopped = false;
    if (anonymous) clearTimers();
    anonymous = false;
    loaded = cached;
    connect(token);
  }

  function checkLoginAvailability() {
    if (!stopped || window.__SANCORD_AUTH_DPAPI !== true) return;
    stopped = false;
    anonymous = true;
    connect();
  }

  document.querySelectorAll("[data-connection-retry]").forEach(button => button.addEventListener("click", () => connect()));
  document.querySelector("[data-connection-diagnostics]").addEventListener("click", () => openSettingsModal("diagnostics"));
  const remoteControl = "#create-srv-submit-btn, #join-srv-submit-btn, #invite-preview-join-btn, #leave-server-btn, " +
    "#srv-edit-save-btn, #role-edit-save-btn, #role-edit-delete-btn, #role-edit-pos-up, #role-edit-pos-down, [data-quick-react], [data-act=react], .reaction-pill";
  document.addEventListener("click", event => {
    if (!SancordConnection.isInterrupted() || !event.target.closest(remoteControl)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    markBlocked();
  }, true);
  window.addEventListener("online", () => { if (!canWrite()) connect(); });
  window.addEventListener("offline", () => { if (!stopped && !anonymous && !ready) void diagnose(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && canWrite() && Date.now() - lastHeartbeat > 25000) heartbeat(state.ws, 0);
  });
  return {
    start, stop, reject, send, canWrite, markBlocked, checkLoginAvailability,
    isInterrupted: () => !stopped && loaded && !canWrite(),
    restoredView: () => loaded,
    status: () => ({ phase, reason, attempt, nextAt, lastHeartbeat, lostAt, socket: state.ws?.readyState ?? null }),
  };
})();
