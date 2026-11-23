const SancordOutbox = (() => {
  const entries = new Map();
  let owner = null, timeout, wake, nextAt = 0;

  function bind(username) {
    const account = username?.toLowerCase() || null;
    if (owner === account) return;
    clearTimeout(timeout);
    clearTimeout(wake);
    wake = null;
    nextAt = 0;
    entries.clear();
    owner = account;
    render();
  }

  function enqueue(payload) {
    if (!owner || !payload.channel_id || entries.size >= 30) {
      showErrorToast("A fila de mensagens está indisponível ou cheia. O rascunho foi mantido.");
      return false;
    }
    const nonce = `delivery:${crypto.randomUUID()}`;
    entries.set(nonce, { payload, nonce, status: "queued", tries: 0, mode: null, detail: "" });
    render();
    drain();
    return true;
  }

  function drain() {
    if (!SancordConnection.canWrite() || wake || [...entries.values()].some(entry => entry.status === "sending")) return;
    const entry = [...entries.values()].find(entry => entry.status === "queued");
    if (!entry) return;
    if (Date.now() < nextAt) {
      wake = setTimeout(() => { wake = null; drain(); }, nextAt - Date.now());
      return;
    }
    const mode = state.composerCapabilities?.has("connection_v1") ? "durable" : "legacy";
    if (entry.mode === "durable" && mode === "legacy") {
      fail(entry, "O servidor atual não pode verificar este envio. Confira no histórico.", true);
      return;
    }
    entry.mode = mode;
    entry.status = "sending";
    entry.tries++;
    if (!SancordConnection.send("SendChat", { ...entry.payload, nonce: entry.nonce })) {
      if (entry.status === "sending") entry.status = "queued";
      return;
    }
    nextAt = Date.now() + 700;
    render();
    timeout = setTimeout(() => {
      if (entry.status !== "sending") return;
      if (entry.mode === "legacy" || entry.tries >= 3) {
        fail(entry, "O servidor não confirmou o envio.", entry.mode === "legacy");
      } else {
        entry.status = "queued";
        drain();
      }
    }, 12000);
  }

  function acknowledge(nonce, durable = false) {
    const entry = entries.get(nonce);
    if (!entry || (!durable && entry.mode !== "legacy")) return;
    if (entry.status === "sending") clearTimeout(timeout);
    entries.delete(nonce);
    render();
    drain();
  }

  function fail(entry, reason, ambiguous = false) {
    if (entry.status === "sending") clearTimeout(timeout);
    entry.status = "failed";
    entry.detail = reason;
    entry.ambiguous = ambiguous;
    render();
    drain();
  }

  function reject(nonce, reason) {
    const entry = entries.get(nonce);
    if (!entry) return false;
    fail(entry, reason || "O servidor recusou o envio.");
    return true;
  }

  function suspend() {
    clearTimeout(timeout);
    clearTimeout(wake);
    wake = null;
    for (const entry of entries.values()) {
      if (entry.status !== "sending") continue;
      if (entry.mode === "legacy") fail(entry, "Confira a conversa antes de enviar novamente.", true);
      else { entry.status = "queued"; entry.tries = 0; }
    }
    render();
  }

  function render() {
    const tray = document.getElementById("pending-chat-messages");
    const channel = state.composerChannelId;
    if (!tray) return;
    tray.replaceChildren();
    const visible = [...entries.values()].filter(entry => entry.payload.channel_id === channel);
    tray.classList.toggle("hidden", !visible.length);
    for (const entry of visible) {
      const row = document.createElement("div");
      row.className = "pending-chat-row";
      row.dataset.sendState = entry.status;
      const copy = document.createElement("div");
      const text = document.createElement("div");
      text.className = "pending-chat-content";
      text.textContent = entry.payload.content || (entry.payload.forward ? "Mensagem encaminhada" : "Mensagem com anexo");
      const status = document.createElement("small");
      status.textContent = entry.status === "failed" ? `Falha ao enviar. ${entry.detail}`
        : entry.status === "sending" ? "Enviando…"
        : SancordConnection.canWrite() ? "Na fila de envio…" : "Aguardando conexão…";
      copy.append(text, status);
      row.appendChild(copy);
      if (entry.status === "failed" && !entry.ambiguous) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "btn-secondary";
        retry.textContent = "Tentar novamente";
        retry.addEventListener("click", () => { entry.status = "queued"; entry.tries = 0; render(); drain(); });
        row.appendChild(retry);
      }
      if (entry.status !== "sending") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn-secondary";
        remove.textContent = "Remover";
        remove.addEventListener("click", () => { entries.delete(entry.nonce); render(); drain(); });
        row.appendChild(remove);
      }
      tray.appendChild(row);
    }
  }

  return { bind, enqueue, drain, suspend, acknowledge, reject, render };
})();
const SanvoOutbox = SancordOutbox;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoOutbox = SancordOutbox;
  globalThis.SancordOutbox = SancordOutbox; // LEGACY COMPATIBILITY
}
