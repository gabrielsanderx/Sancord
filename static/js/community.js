// ============================================================================
// Sancord — Enquetes e eventos do servidor (Fase 8)
//   As regras (quem vota, quem encerra, quem cria eventos) são do servidor.
// Depende de globais do app.js/chat.js (state, sendWs, SancordUI, getActiveServer...).
// ============================================================================

state.serverEvents = state.serverEvents || new Map();

function communityMe() {
  return (state.selfUser?.username || "").toLowerCase();
}

function formatWhen(ms) {
  try {
    return new Date(ms).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

function formatRemaining(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} dias`;
}

// ---------------------------------------------------------------------------
// Enquetes
// ---------------------------------------------------------------------------

/** Contagem por opção, total de votantes e meus votos. */
function pollTally(poll, me) {
  const counts = {};
  const voters = new Set();
  const mine = new Set();
  for (const opt of poll.options || []) {
    const list = poll.votes?.[opt.id] || [];
    counts[opt.id] = list.length;
    for (const v of list) voters.add(v);
    if (list.includes(me)) mine.add(opt.id);
  }
  return { counts, voters: voters.size, mine };
}

function pollIsOpen(poll, now = Date.now()) {
  return !poll.closed && !(poll.expires_at && poll.expires_at <= now);
}

/** Nova seleção ao clicar numa opção (única: troca/retira; múltipla: alterna). */
function nextPollSelection(poll, mine, optionId) {
  const set = new Set(mine);
  if (poll.multiple) {
    if (set.has(optionId)) set.delete(optionId);
    else set.add(optionId);
    return [...set];
  }
  return set.has(optionId) ? [] : [optionId];
}

function buildPollNode(msg) {
  const poll = msg.poll;
  const me = communityMe();
  const { counts, voters, mine } = pollTally(poll, me);
  const open = pollIsOpen(poll);
  const card = document.createElement("div");
  card.className = `poll-card${open ? "" : " closed"}`;

  const head = document.createElement("div");
  head.className = "poll-head";
  head.textContent = `📊 Enquete${poll.multiple ? " • escolha várias" : ""}`;
  card.appendChild(head);
  if ((msg.content || "").trim() !== poll.question) {
    const q = document.createElement("div");
    q.className = "poll-question";
    q.textContent = poll.question;
    card.appendChild(q);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const opt of poll.options || []) {
    const n = counts[opt.id] || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = `poll-option${mine.has(opt.id) ? " voted" : ""}`;
    row.disabled = !open;
    row.title = (poll.votes?.[opt.id] || []).join(", ") || "Sem votos";
    const bar = document.createElement("span");
    bar.className = "poll-bar";
    bar.style.width = `${pct}%`;
    const label = document.createElement("span");
    label.className = "poll-label";
    label.textContent = `${mine.has(opt.id) ? "✓ " : ""}${opt.text}`;
    const count = document.createElement("span");
    count.className = "poll-count";
    count.textContent = `${n} • ${pct}%`;
    row.append(bar, label, count);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      sendWs("VotePoll", { channel_id: msg.channel_id, message_id: msg.id, option_ids: nextPollSelection(poll, mine, opt.id) });
    });
    card.appendChild(row);
  }

  const foot = document.createElement("div");
  foot.className = "poll-foot";
  const status = document.createElement("span");
  status.textContent = `${voters} ${voters === 1 ? "pessoa votou" : "pessoas votaram"} • ${
    open ? (poll.expires_at ? `termina em ${formatRemaining(poll.expires_at - Date.now())}` : "sem prazo") : "encerrada"
  }`;
  foot.appendChild(status);
  const own = msg.author_id === state.selfUser?.id || (msg.author_name || "").toLowerCase() === me;
  const canModerate = typeof messagePermissions === "function" && messagePermissions(msg).manage_messages;
  if (open && (own || canModerate)) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-secondary small-btn";
    close.textContent = "Encerrar";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      sendWs("ClosePoll", { channel_id: msg.channel_id, message_id: msg.id });
    });
    foot.appendChild(close);
  }
  card.appendChild(foot);
  return card;
}

async function openPollDialog() {
  const channelId = getActiveTextChannelId();
  if (!channelId) return;
  const values = await SancordUI.formDialog({
    title: "Criar enquete",
    submitLabel: "Publicar",
    fields: [
      { name: "question", label: "PERGUNTA", maxlength: 300, required: true, placeholder: "Ex.: Onde jogamos sábado?" },
      { name: "options", label: "OPÇÕES (UMA POR LINHA, 2 A 10)", type: "textarea", rows: 4, required: true, placeholder: "Casa da Ana\nOnline" },
      {
        name: "multiple",
        label: "TIPO",
        type: "select",
        value: "single",
        options: [
          { value: "single", label: "Uma escolha por pessoa" },
          { value: "multiple", label: "Várias escolhas por pessoa" },
        ],
      },
      {
        name: "duration",
        label: "DURAÇÃO",
        type: "select",
        value: "24",
        options: [
          { value: "1", label: "1 hora" },
          { value: "4", label: "4 horas" },
          { value: "24", label: "1 dia" },
          { value: "72", label: "3 dias" },
          { value: "168", label: "7 dias" },
          { value: "0", label: "Sem prazo" },
        ],
      },
    ],
  });
  if (!values) return;
  const options = values.options.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (options.length < 2) {
    showUiToast("A enquete precisa de pelo menos 2 opções.");
    return;
  }
  sendWs("SendChat", {
    channel_id: channelId,
    content: "",
    poll: {
      question: values.question.trim(),
      options: options.slice(0, 10),
      multiple: values.multiple === "multiple",
      duration_hours: Number(values.duration) || 0,
    },
  });
}

document.getElementById("poll-create-btn")?.addEventListener("click", openPollDialog);

// ---------------------------------------------------------------------------
// Eventos do servidor
// ---------------------------------------------------------------------------

function requestServerEvents(serverId) {
  if (serverId) sendWs("ListEvents", { server_id: serverId });
}

function upcomingEvents(list, now = Date.now()) {
  return (list || []).filter((e) => (e.ends_at || e.starts_at + 3600000) > now);
}

function eventIsLive(e, now = Date.now()) {
  return e.starts_at <= now && now < (e.ends_at || e.starts_at + 3600000);
}

function canManageEvents(srv) {
  const p = getServerPermissionsFor(srv, state.selfUser?.username);
  return Boolean(p.manage_server || p.manage_channels || p.administrator);
}

function onServerEvents({ server_id, events }) {
  state.serverEvents.set(server_id, events || []);
  const srv = getActiveServer();
  if (srv?.id === server_id) {
    const badge = document.getElementById("server-events-badge");
    const n = upcomingEvents(events).length;
    if (badge) {
      badge.textContent = n;
      badge.classList.toggle("hidden", n === 0);
    }
    if (!document.getElementById("events-modal")?.classList.contains("hidden")) renderEventsModal();
  }
}

function channelLabel(srv, id) {
  const ch = (srv?.text_channels || []).concat(srv?.voice_channels || []).find((c) => c.id === id);
  if (!ch) return null;
  return ch.kind === "voice" ? `🔊 ${ch.name}` : `#${ch.name}`;
}

function renderEventsModal() {
  const srv = getActiveServer();
  const list = document.getElementById("events-list");
  if (!srv || !list) return;
  document.getElementById("events-modal-title").textContent = `📅 Eventos — ${srv.name}`;
  document.getElementById("events-create-btn")?.classList.toggle("hidden", !canManageEvents(srv));
  const events = upcomingEvents(state.serverEvents.get(srv.id));
  list.innerHTML = "";
  if (events.length === 0) {
    list.innerHTML = `<div class="pinned-empty">Nenhum evento marcado. ${canManageEvents(srv) ? "Crie o primeiro!" : ""}</div>`;
    return;
  }
  const me = communityMe();
  for (const e of events) {
    const card = document.createElement("div");
    card.className = `event-card${eventIsLive(e) ? " live" : ""}`;
    const when = document.createElement("div");
    when.className = "event-when";
    when.textContent = eventIsLive(e) ? "🔴 Acontecendo agora" : `🗓️ ${formatWhen(e.starts_at)}${e.ends_at ? ` – ${formatWhen(e.ends_at)}` : ""}`;
    const title = document.createElement("h3");
    title.textContent = e.title;
    card.append(when, title);
    const where = channelLabel(srv, e.channel_id) || e.location;
    if (where) {
      const w = document.createElement("div");
      w.className = "event-where";
      w.textContent = where;
      card.appendChild(w);
    }
    if (e.description) {
      const d = document.createElement("p");
      d.className = "event-desc";
      d.textContent = e.description;
      card.appendChild(d);
    }
    const actions = document.createElement("div");
    actions.className = "event-actions";
    const interested = (e.interested || []).includes(me);
    const rsvp = document.createElement("button");
    rsvp.type = "button";
    rsvp.className = interested ? "btn-secondary small-btn" : "btn-primary small-btn";
    rsvp.textContent = `${interested ? "✓ Interessado" : "⭐ Tenho interesse"} (${(e.interested || []).length})`;
    rsvp.addEventListener("click", () => sendWs("SetEventInterest", { server_id: srv.id, event_id: e.id, interested: !interested }));
    actions.appendChild(rsvp);
    const voice = (srv.voice_channels || []).find((c) => c.id === e.channel_id);
    if (voice && eventIsLive(e)) {
      const join = document.createElement("button");
      join.type = "button";
      join.className = "btn-primary small-btn";
      join.textContent = "Entrar na call";
      join.addEventListener("click", () => {
        closeEventsModal();
        joinVoiceChannel(voice.id);
      });
      actions.appendChild(join);
    }
    if (canManageEvents(srv) || e.creator === me) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-secondary small-btn";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => openEventDialog(srv, e));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-secondary small-btn danger-text";
      del.textContent = "Excluir";
      del.addEventListener("click", async () => {
        const ok = await SancordUI.confirm({ title: "Excluir evento?", message: `"${e.title}" será removido para todos.`, confirmLabel: "Excluir", danger: true });
        if (ok) sendWs("DeleteEvent", { server_id: srv.id, event_id: e.id });
      });
      actions.append(edit, del);
    }
    card.appendChild(actions);
    list.appendChild(card);
  }
}

/** ms -> valor de <input type="datetime-local"> no fuso local. */
function toLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

async function openEventDialog(srv, event = null) {
  const channels = [{ value: "", label: "Nenhum (usar local abaixo)" }].concat(
    (srv.voice_channels || []).map((c) => ({ value: c.id, label: `🔊 ${c.name}` })),
    (srv.text_channels || []).map((c) => ({ value: c.id, label: `#${c.name}` }))
  );
  const defaultStart = Date.now() + 3600000;
  const values = await SancordUI.formDialog({
    title: event ? "Editar evento" : "Criar evento",
    submitLabel: event ? "Salvar" : "Criar evento",
    fields: [
      { name: "title", label: "TÍTULO", value: event?.title || "", maxlength: 100, required: true, placeholder: "Ex.: Noite de jogos" },
      { name: "starts_at", label: "INÍCIO", type: "datetime-local", value: toLocalInput(event?.starts_at || defaultStart), required: true },
      { name: "ends_at", label: "FIM (OPCIONAL)", type: "datetime-local", value: toLocalInput(event?.ends_at) },
      { name: "channel_id", label: "ONDE", type: "select", value: event?.channel_id || "", options: channels },
      { name: "location", label: "LOCAL (SE NÃO FOR UM CANAL)", value: event?.location || "", maxlength: 100, visibleWhen: (v) => !v.channel_id },
      { name: "description", label: "DESCRIÇÃO", type: "textarea", value: event?.description || "", maxlength: 1000, rows: 3 },
    ],
  });
  if (!values) return;
  const starts = fromLocalInput(values.starts_at);
  if (!starts) {
    showUiToast("Informe a data e hora de início.");
    return;
  }
  sendWs("SaveEvent", {
    server_id: srv.id,
    event_id: event?.id || null,
    title: values.title.trim(),
    description: values.description.trim() || null,
    channel_id: values.channel_id || null,
    location: values.channel_id ? null : values.location.trim() || null,
    starts_at: starts,
    ends_at: fromLocalInput(values.ends_at),
  });
}

function openEventsModal() {
  const srv = getActiveServer();
  if (!srv) return;
  requestServerEvents(srv.id);
  renderEventsModal();
  document.getElementById("events-modal")?.classList.remove("hidden");
}

function closeEventsModal() {
  document.getElementById("events-modal")?.classList.add("hidden");
}

document.getElementById("open-events-btn")?.addEventListener("click", openEventsModal);
document.getElementById("events-close-btn")?.addEventListener("click", closeEventsModal);
document.getElementById("events-modal")?.addEventListener("mousedown", (e) => {
  if (e.target.id === "events-modal") closeEventsModal();
});
document.getElementById("events-create-btn")?.addEventListener("click", () => {
  const srv = getActiveServer();
  if (srv) openEventDialog(srv);
});
