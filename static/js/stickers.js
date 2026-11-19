// Figurinhas usam o mesmo upload e a mesma entrega das mensagens com anexos.
const stickerButton = document.getElementById("sticker-picker-btn");
const stickerPopover = document.getElementById("sticker-popover");
const stickerCollection = [
  ["core-orbita", "Órbita", "#4d427c", "#9be7df", '<circle cx="64" cy="52" r="24" fill="#bb9deb"/><ellipse cx="64" cy="52" rx="42" ry="12" transform="rotate(-25 64 52)" stroke="currentColor" stroke-width="4" fill="none"/><circle cx="94" cy="29" r="5" fill="currentColor"/>'],
  ["core-pulso", "Pulso", "#2c5661", "#aef5d9", '<path d="M26 53h18l9-18 13 35 12-25 6 8h18" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'],
  ["core-lua", "Lua de plantão", "#443b6a", "#f7ccac", '<path d="M84 70C60 80 37 59 49 36a26 26 0 1 0 35 34" fill="currentColor"/><path d="M86 29v17m-8-8h16M99 53v8m-4-4h8" stroke="#dfcbff" stroke-width="2.5" stroke-linecap="round"/>'],
  ["core-rede", "Sinal recebido", "#513a59", "#fbd2a5", '<path d="M30 39q34-27 68 0M41 50q23-17 46 0M52 62q12-9 24 0" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="64" cy="74" r="5" fill="currentColor"/>'],
];
let stickerTab = "collection";

function stickerSvg([, name, color, ink, shape]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128"><path d="M27 13h74a15 15 0 0 1 15 15v72a15 15 0 0 1-15 15H27a15 15 0 0 1-15-15V28a15 15 0 0 1 15-15Z" fill="${color}" stroke="${ink}" stroke-opacity=".7" stroke-width="3"/><g color="${ink}">${shape}</g><text x="64" y="101" fill="${ink}" font-family="sans-serif" font-size="10" font-weight="700" text-anchor="middle">${name}</text></svg>`;
}

function stickerImage(item) {
  return item.recipe ? `data:image/svg+xml,${encodeURIComponent(stickerSvg(item.recipe))}` : SancordNet.imageUrl(`/api/attachments/${item.id}/sticker`);
}

function stickerFavoriteKey() {
  return `sancord_sticker_favorites:${state.selfUser?.username?.toLowerCase() || "local"}`;
}

function savedStickerFavorites() {
  try {
    const entries = JSON.parse(localStorage.getItem(stickerFavoriteKey()) || "[]");
    return Array.isArray(entries) ? entries.filter(s => GIF_ID.test(s?.id || "") || stickerCollection.some(([id]) => id === s?.id)).slice(0, 100) : [];
  } catch { return []; }
}

function conversationStickers(serverId = null, mine = false) {
  const items = new Map();
  for (const [channel, messages] of Object.entries(state.chatHistory || {})) {
    if (serverId && serverForChannel(channel)?.id !== serverId) continue;
    for (const message of messages || []) {
      if (mine && !isOwnMessage(message)) continue;
      for (const att of [...(message.attachments || []), ...(message.forward?.attachments || [])]) {
        if (att.kind !== "sticker" || !GIF_ID.test(att.id || "")) continue;
        const at = message.created_at || 0;
        if (!items.has(att.id) || at > items.get(att.id).at) items.set(att.id, { id: att.id, name: att.filename, at });
      }
    }
  }
  return [...items.values()].sort((a, b) => b.at - a.at).slice(0, 48);
}

async function prepareSticker(item) {
  const { channelId, attach } = composerContext();
  if (!attach || currentSlowmodeWait(channelId) > 0) return;
  if (!item.recipe) {
    if (sendChatPayload({ channel_id: channelId, content: "", attachment_ids: [item.id],
      reply_to_id: state.replyingTo?.id || null, reply_mention: replyMentionEnabled() })) {
      clearReplyingTo();
      closeStickerPicker();
      chatInput.focus();
    }
    return;
  }
  try {
    const image = new Image();
    image.src = stickerImage(item);
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    canvas.getContext("2d").drawImage(image, 0, 0, 256, 256);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw Error("PNG");
    if (getActiveTextChannelId() !== channelId || !composerContext().attach) return;
    if (addComposerFiles([new File([blob], `${item.name}.png`, { type: "image/png" })], "sticker")) closeStickerPicker();
  } catch { showErrorToast("Não foi possível preparar a figurinha."); }
}

function renderStickerPicker() {
  const collection = stickerCollection.map(recipe => ({ id: recipe[0], name: recipe[1], recipe }));
  const favorites = savedStickerFavorites();
  const activeServer = state.activeView === "server" ? getActiveServer() : null;
  const items = stickerTab === "collection" ? collection : stickerTab === "favorites"
    ? favorites.map(s => collection.find(c => c.id === s.id) || s)
    : stickerTab === "recent" ? conversationStickers(null, true) : conversationStickers(activeServer?.id);
  const grid = stickerPopover.querySelector(".sticker-grid");
  const query = normalizeSearch(stickerPopover.querySelector(".emoji-search").value);
  for (const tab of stickerPopover.querySelectorAll("[data-sticker-tab]")) {
    tab.hidden = tab.dataset.stickerTab === "server" && !activeServer;
    tab.setAttribute("aria-selected", String(tab.dataset.stickerTab === stickerTab));
    tab.classList.toggle("active", tab.dataset.stickerTab === stickerTab);
  }
  grid.replaceChildren();
  for (const item of items.filter(s => normalizeSearch(s.name || "").includes(query))) {
    const cell = document.createElement("div");
    cell.className = "gif-cell";
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "sticker-pick";
    pick.title = item.recipe ? `Preparar ${item.name}` : `Enviar ${item.name}`;
    const image = new Image();
    image.alt = item.name;
    image.loading = "lazy";
    image.src = stickerImage(item);
    pick.append(image);
    pick.addEventListener("click", () => prepareSticker(item));
    const star = document.createElement("button");
    const isFavorite = favorites.some(s => s.id === item.id);
    star.type = "button";
    star.className = `gif-fav-btn${isFavorite ? " is-fav" : ""}`;
    star.setAttribute("aria-label", isFavorite ? "Remover dos favoritos" : "Favoritar figurinha");
    star.append(SancordIcons.node("star"));
    star.addEventListener("click", () => {
      const next = isFavorite ? favorites.filter(s => s.id !== item.id) : [{ id: item.id, name: item.name }, ...favorites].slice(0, 100);
      try { localStorage.setItem(stickerFavoriteKey(), JSON.stringify(next)); } catch { return; }
      renderStickerPicker();
    });
    cell.append(pick, star);
    grid.append(cell);
  }
  if (!grid.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "pinned-empty";
    empty.textContent = query ? "Nenhuma figurinha com esse nome." : "Nenhuma figurinha nesta lista ainda.";
    grid.append(empty);
  }
}

function closeStickerPicker() {
  const open = !stickerPopover.classList.contains("hidden");
  stickerPopover.classList.add("hidden");
  stickerButton.setAttribute("aria-expanded", "false");
  return open;
}

stickerButton.addEventListener("click", () => {
  if (closeStickerPicker()) return;
  closeComposerPickers();
  if (!stickerPopover.childElementCount) {
    stickerPopover.innerHTML = `<input type="search" class="emoji-search" placeholder="Buscar figurinhas" aria-label="Buscar figurinhas">
      <div class="gif-picker-head" role="tablist" aria-label="Listas de figurinhas">
        <button type="button" class="gif-tab" data-sticker-tab="recent" role="tab">Recentes</button>
        <button type="button" class="gif-tab" data-sticker-tab="favorites" role="tab">Favoritos</button>
        <button type="button" class="gif-tab" data-sticker-tab="server" role="tab">Servidor</button>
        <button type="button" class="gif-tab" data-sticker-tab="collection" role="tab">Coleções</button>
      </div><div class="sticker-grid"></div>
      <button type="button" class="btn-secondary small-btn" data-sticker-upload>Adicionar figurinha do computador</button>
      <input type="file" accept="image/png,image/webp,image/gif" hidden>`;
    const input = stickerPopover.querySelector('input[type="file"]');
    let channel;
    stickerPopover.querySelector("[data-sticker-upload]").addEventListener("click", () => {
      channel = getActiveTextChannelId();
      input.click();
    });
    input.addEventListener("change", () => {
      if (getActiveTextChannelId() === channel && addComposerFiles(input.files, "sticker")) closeStickerPicker();
      input.value = "";
    });
    stickerPopover.querySelector(".emoji-search").addEventListener("input", renderStickerPicker);
    for (const tab of stickerPopover.querySelectorAll("[data-sticker-tab]")) tab.addEventListener("click", () => {
      stickerTab = tab.dataset.stickerTab;
      renderStickerPicker();
    });
  }
  if (stickerTab === "server" && state.activeView !== "server") stickerTab = "collection";
  stickerPopover.classList.remove("hidden");
  stickerButton.setAttribute("aria-expanded", "true");
  renderStickerPicker();
  stickerPopover.querySelector(".emoji-search").focus();
});

document.addEventListener("mousedown", event => {
  if (!stickerPopover.contains(event.target) && !stickerButton.contains(event.target)) closeStickerPicker();
});
