// Ações e rascunhos do compositor. O envio e as permissões continuam em chat.js.
const composerActionButton = document.getElementById("attach-image-btn");
const composerReadonly = document.getElementById("composer-readonly");
const composerSend = chatForm.querySelector('.send-btn');
const composerDrafts = new Map();
let composerDraftOwner = null;

function composerContext() {
  const channelId = getActiveTextChannelId();
  const permissions = messagePermissions({ channel_id: channelId });
  const available = Boolean(channelId && !chatInput.disabled);
  const capabilities = state.composerCapabilities;
  const text = state.activeView === "server" && state.textChannels.find(ch => ch.id === channelId);
  return {
    channelId, available,
    attach: available && Boolean(permissions.attach_files),
    thread: available && Boolean(text && text.kind !== "forum" && permissions.read_history && permissions.send_messages),
    richMedia: Boolean(capabilities?.has("media_v1")),
    scheduling: Boolean(capabilities?.has("scheduling_v1")),
  };
}

function composerActions(context) {
  const { channelId, available, attach, thread } = context;
  return [
    attach && { label: "Anexar arquivos", icon: "file", onSelect: () => imageFileInput.click() },
    thread && { label: "Criar tópico", icon: "thread", onSelect: () => openTopicComposer(channelId) },
    available && { label: "Criar enquete", icon: "poll", onSelect: openPollDialog },
    attach && context.richMedia && typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia && { label: "Gravar mensagem de voz", icon: "mic", onSelect: openVoiceRecorder },
    ...(available && context.scheduling && typeof scheduleOptions === "function" ? scheduleOptions(context) : []),
  ];
}

function composerCommands() {
  const context = composerContext();
  if (!context.available) return [];
  return [
    context.attach && { label: "anexar", icon: "file", hint: "Escolher arquivos", run: () => imageFileInput.click() },
    { label: "enquete", icon: "poll", hint: "Criar uma enquete", run: openPollDialog },
    context.thread && { label: "topico", icon: "thread", hint: "Criar um tópico", run: () => openTopicComposer(context.channelId) },
    context.scheduling && { label: "agendadas", icon: "calendar", hint: "Ver mensagens agendadas", run: openScheduledPanel },
  ].filter(Boolean);
}

async function openTopicComposer(channelId) {
  const values = await SancordUI.formDialog({
    title: "Criar tópico", submitLabel: "Criar tópico",
    fields: [{ name: "name", label: "Nome do tópico", maxlength: 100, required: true }],
  });
  if (!values?.name.trim() || getActiveTextChannelId() !== channelId || !composerContext().thread) return;
  if (!sendWs("CreateThread", { channel_id: channelId, name: values.name.trim(), message_id: null })) {
    showErrorToast("Sem conexão para criar o tópico.");
  }
}

function closeComposerPickers() {
  const actionOpen = composerActionButton.getAttribute("aria-expanded") === "true";
  const gifOpen = !gifPopoverEl()?.classList.contains("hidden");
  const emojiOpen = !emojiPopover?.classList.contains("hidden");
  const stickerOpen = typeof closeStickerPicker === "function" && closeStickerPicker();
  const scheduleOpen = typeof closeScheduledPanel === "function" && closeScheduledPanel();
  if (actionOpen) SancordUI.closeContextMenu();
  if (gifOpen) closeGifPicker();
  if (emojiOpen) {
    emojiPopover.classList.add("hidden");
    emojiPopover.style.cssText = "";
    emojiPickerBtn?.setAttribute("aria-expanded", "false");
  }
  return actionOpen || gifOpen || emojiOpen || stickerOpen || scheduleOpen;
}

function syncComposerChrome() {
  const context = composerContext();
  const { available, attach } = context;
  const offline = SancordConnection.isInterrupted();
  document.getElementById("composer-offline")?.classList.toggle("hidden", !offline || !available);
  composerSend.setAttribute("aria-label", offline ? "Adicionar mensagem à fila" : "Enviar mensagem");
  if ((!attach || !context.richMedia) && typeof cancelVoiceRecording === "function") cancelVoiceRecording(false);
  chatForm.classList.toggle("hidden", chatInput.disabled);
  composerReadonly.classList.toggle("hidden", !chatInput.disabled);
  composerReadonly.textContent = chatInput.disabled ? chatInput.placeholder : "";
  composerActionButton.disabled = !available || !composerActions(context).some(Boolean);
  const gifs = document.getElementById("gif-picker-btn");
  if (gifs) gifs.disabled = !attach;
  const stickers = document.getElementById("sticker-picker-btn");
  if (stickers) {
    stickers.disabled = !attach;
    stickers.closest(".emoji-picker-anchor").classList.toggle("hidden", !context.richMedia);
  }
  composerSend.classList.toggle("composer-send-idle", !chatInput.value.trim() && state.composerFiles.length === 0);
  updateComposerSendButton();
}

function updateComposerSendButton() {
  const offline = SancordConnection.isInterrupted();
  composerSend.disabled = chatInput.disabled || (!offline && currentSlowmodeWait(getActiveTextChannelId()) > 0) ||
    (!chatInput.value.trim() && state.composerFiles.length === 0);
}

function switchComposerDraft(previousChannelId, nextChannelId) {
  const owner = state.selfUser?.username?.toLowerCase();
  if (composerDraftOwner !== owner) {
    for (const draft of composerDrafts.values()) discardComposerFileList(draft.files);
    composerDrafts.clear();
    if (typeof resetScheduledPanel === "function") resetScheduledPanel();
    if (composerDraftOwner != null) {
      discardComposerFileList(state.composerFiles);
      chatInput.value = "";
      state.composerFiles = [];
    }
    composerDraftOwner = owner;
    previousChannelId = null;
  }
  if (previousChannelId === nextChannelId) return;
  if (typeof cancelVoiceRecording === "function") cancelVoiceRecording(false);
  if (previousChannelId && (chatInput.value || state.composerFiles.length)) {
    composerDrafts.set(previousChannelId, { text: chatInput.value, files: state.composerFiles });
  }
  const restored = composerDrafts.get(nextChannelId);
  composerDrafts.delete(nextChannelId);
  chatInput.value = restored?.text || "";
  state.composerFiles = restored?.files || [];
  closeComposerPickers();
  closeAutocomplete();
  autosizeTextarea(chatInput);
  renderComposerTray();
}

composerActionButton.addEventListener("click", () => {
  const wasOpen = composerActionButton.getAttribute("aria-expanded") === "true";
  closeComposerPickers();
  if (wasOpen) return;
  const actions = composerActions(composerContext());
  if (!actions.some(Boolean)) return;
  composerActionButton.setAttribute("aria-expanded", "true");
  SancordUI.contextMenu(0, 0, actions, {
    anchor: composerActionButton, above: true, label: "Ações da mensagem",
    onClose: () => composerActionButton.setAttribute("aria-expanded", "false"),
  });
});

replyPreviewText?.addEventListener("click", () => {
  const reply = state.replyingTo;
  if (reply) jumpToMessage(reply.channel_id, reply.id);
});
chatInput.addEventListener("input", () => {
  state.sendWhenUploaded = false;
  syncComposerChrome();
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (composerActionButton.getAttribute("aria-expanded") === "true") return;
  if (event.target.closest?.(".sancord-dialog-backdrop")) return;
  if (closeComposerPickers()) chatInput.focus();
  else if (typeof cancelVoiceRecording === "function" && cancelVoiceRecording()) { /* gravação ativa */ }
  else if (typeof closeVoiceDetails === "function" && closeVoiceDetails()) voiceSignalBox.focus();
  else return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
