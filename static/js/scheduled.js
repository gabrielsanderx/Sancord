const schedulePanel = document.getElementById("composer-schedule-panel");
const scheduleSummary = document.getElementById("composer-schedule-summary");
let queuedMessages = [];
let pendingScheduledDraft = null;

function scheduleOptions(context) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(18, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const writableText = Boolean(chatInput.value.trim() && !state.composerFiles.length && !state.replyingTo);
  return [
    { label: "Agendar mensagem", icon: "calendar", disabled: !writableText,
      hint: writableText ? "" : "Escreva uma mensagem de texto", submenu: [
        today > now && { label: "Hoje às 18:00", onSelect: () => scheduleCurrentDraft(context.channelId, Number(today)) },
        { label: "Amanhã às 09:00", onSelect: () => scheduleCurrentDraft(context.channelId, Number(tomorrow)) },
        { label: "Escolher data e hora…", onSelect: () => pickScheduleTime(context.channelId) },
      ] },
    { label: "Mensagens agendadas", icon: "clock", onSelect: openScheduledPanel },
  ];
}

async function pickScheduleTime(channelId) {
  const result = await SancordUI.formDialog({ title: "Agendar mensagem", submitLabel: "Agendar",
    fields: [{ name: "when", label: "Data e hora local", type: "datetime-local", required: true }] });
  if (result) scheduleCurrentDraft(channelId, new Date(result.when).getTime());
}

function scheduleCurrentDraft(channelId, when) {
  const context = composerContext();
  const text = chatInput.value;
  if (!context.available || context.channelId !== channelId || !text.trim() || state.composerFiles.length || state.replyingTo) return;
  if (!Number.isFinite(when) || when <= Date.now() || when > Date.now() + 30 * 86400000) {
    showErrorToast("Escolha um horário futuro dentro dos próximos 30 dias.");
    return;
  }
  if (pendingScheduledDraft) return;
  if (!sendWs("ScheduleMessage", { channel_id: channelId, content: encodeCustomEmojis(convertBasicEmoticons(text.trim())), send_at: when })) {
    showErrorToast("Sem conexão para agendar a mensagem.");
    return;
  }
  pendingScheduledDraft = { channelId, text, timer: setTimeout(() => { pendingScheduledDraft = null; }, 15000) };
}

function receiveScheduleResult(success) {
  const request = pendingScheduledDraft;
  if (!request) return;
  clearTimeout(request.timer);
  pendingScheduledDraft = null;
  if (!success) return;
  if (request.channelId === getActiveTextChannelId() && chatInput.value === request.text) {
    chatInput.value = "";
    autosizeTextarea(chatInput);
    syncComposerChrome();
  } else {
    const draft = composerDrafts.get(request.channelId);
    if (draft?.text === request.text) {
      if (draft.files.length) draft.text = "";
      else composerDrafts.delete(request.channelId);
    }
  }
}

function receiveScheduledMessages(payload) {
  queuedMessages = payload.messages || [];
  renderScheduledPanel();
}

function resetScheduledPanel() {
  receiveScheduleResult(false);
  queuedMessages = [];
  renderScheduledPanel();
  closeScheduledPanel();
}

function closeScheduledPanel() {
  const open = !schedulePanel.classList.contains("hidden");
  schedulePanel.classList.add("hidden");
  scheduleSummary.setAttribute("aria-expanded", "false");
  return open;
}

function openScheduledPanel() {
  closeComposerPickers();
  schedulePanel.classList.remove("hidden");
  scheduleSummary.setAttribute("aria-expanded", "true");
  if (!sendWs("ListScheduledMessages")) showErrorToast("Sem conexão para consultar a fila.");
  renderScheduledPanel();
  schedulePanel.querySelector("[data-close-schedule]").focus();
}

function renderScheduledPanel() {
  const count = queuedMessages.length;
  scheduleSummary.textContent = count === 1 ? "1 mensagem agendada" : `${count} mensagens agendadas`;
  scheduleSummary.classList.toggle("hidden", !count);
  if (schedulePanel.classList.contains("hidden")) return;
  const list = schedulePanel.querySelector("ul");
  list.replaceChildren();
  for (const message of queuedMessages) {
    const row = document.createElement("li");
    const text = document.createElement("strong");
    text.textContent = decodeCustomEmojis(message.content);
    const date = document.createElement("span");
    const server = serverForChannel(message.channel_id);
    const channel = [...(server?.text_channels || []), ...(server?.voice_channels || [])].find(c => c.id === message.channel_id);
    const scope = channel ? `#${channel.name}` : threadById(message.channel_id)?.name || (isPrivateTextId(message.channel_id) ? "Conversa privada" : "Canal indisponível");
    date.textContent = `${scope} · ${new Date(message.send_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
    if (message.error) {
      const error = document.createElement("p");
      error.textContent = message.error;
      error.className = "schedule-error";
      row.append(text, date, error);
    } else row.append(text, date);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-secondary small-btn";
    cancel.textContent = message.error ? "Remover da lista" : "Cancelar envio";
    cancel.addEventListener("click", () => {
      if (!sendWs("CancelScheduledMessage", { id: message.id })) showErrorToast("Sem conexão para remover o agendamento.");
    });
    row.append(cancel);
    list.append(row);
  }
  schedulePanel.querySelector("[data-empty-schedule]").classList.toggle("hidden", count > 0);
}

scheduleSummary.addEventListener("click", () => { if (!closeScheduledPanel()) openScheduledPanel(); });
schedulePanel.querySelector("[data-close-schedule]").addEventListener("click", () => { closeScheduledPanel(); chatInput.focus(); });
document.addEventListener("mousedown", event => {
  if (!schedulePanel.contains(event.target) && !scheduleSummary.contains(event.target)) closeScheduledPanel();
});
