// O editor conserva um rascunho por conta. O mural visitado usa a projeção recebida do servidor.
const boardWidgetNames = {
  favorite_game: "Jogo favorito", playing: "Jogando agora", want_to_play: "Quero jogar",
  about: "Sobre mim", link: "Link", achievements: "Conquistas", custom: "Bloco personalizado",
};
const BOARD_MILESTONES = {
  milestone_first_server: { name: "Criador de comunidade", description: "Criou seu primeiro servidor no Sancord." },
  milestone_5_friends: { name: "Círculo de amigos", description: "Fez 5 ou mais amigos no Sancord." },
  milestone_100_messages: { name: "100 mensagens", description: "Enviou 100 mensagens nas conversas." },
  milestone_500_messages: { name: "500 mensagens", description: "Enviou 500 mensagens nas conversas." },
};
const boardEditorPanel = document.getElementById("board-editor");
const boardToggle = document.getElementById("open-board-editor");
const boardControls = document.getElementById("board-editor-controls");
const boardStatus = document.getElementById("board-editor-status");
const boardAudience = document.getElementById("board-audience");
const boardList = document.getElementById("board-editor-widgets");
const boardKind = document.getElementById("board-widget-kind");
const boardAdd = document.getElementById("board-add-widget");
const boardSave = document.getElementById("board-save");
const boardReload = document.getElementById("board-reload");
let boardEditor = {};

function resetBoardEditorOnAccountChange() {
  const owner = state.selfUser?.username?.toLowerCase();
  if (owner === boardEditor.owner) return;
  clearTimeout(boardEditor.saveTimer);
  clearTimeout(boardEditor.loadTimer);
  boardEditor = { owner };
  boardEditorPanel.classList.add("hidden");
  boardToggle.setAttribute("aria-expanded", "false");
  boardStatus.textContent = "";
  renderBoardEditor();
}

function cloneBoard(board) {
  return { ...board, widgets: board.widgets.map(widget => ({ ...widget })) };
}

function boardIsDirty() {
  const { draft, base } = boardEditor;
  return Boolean(draft && (draft.audience !== base.audience ||
    JSON.stringify(draft.widgets) !== JSON.stringify(base.widgets)));
}

function receiveBoardEditorState(board, saved = false) {
  resetBoardEditorOnAccountChange();
  if (!boardEditor.owner || !Array.isArray(board?.widgets)) return;
  const savedDraft = saved && JSON.stringify(boardEditor.draft) === boardEditor.submitted;
  const replaceDraft = savedDraft || boardEditor.discardOnLoad || !boardIsDirty();
  clearTimeout(boardEditor.loadTimer);
  boardEditor.latest = board;
  if (replaceDraft) {
    boardEditor.base = board;
    boardEditor.draft = cloneBoard(board);
  }
  if (saved) {
    clearTimeout(boardEditor.saveTimer);
    boardEditor.saving = false;
    boardEditor.submitted = null;
  }
  boardEditor.discardOnLoad = false;
  boardStatus.textContent = replaceDraft ? (saved ? "Mural salvo." : "") : "Rascunho mantido.";
  renderBoardEditor();
}

function handleBoardSaveFailure(message) {
  clearTimeout(boardEditor.saveTimer);
  boardEditor.saving = false;
  boardStatus.textContent = message;
  renderBoardEditor();
}

function requestBoardEditorState(discard = false) {
  clearTimeout(boardEditor.loadTimer);
  boardEditor.discardOnLoad = discard;
  if (!sendWs("GetProfileBoard")) {
    boardEditor.discardOnLoad = false;
    boardStatus.textContent = "Conecte-se para carregar seu mural.";
    return;
  }
  boardStatus.textContent = "Carregando mural…";
  boardEditor.loadTimer = setTimeout(() => {
    boardEditor.discardOnLoad = false;
    boardStatus.textContent = "O servidor ainda não respondeu. Tente recarregar o mural.";
  }, 8000);
}

function boardText(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function renderVisitedBoard(board, emptyMessage) {
  const root = document.getElementById("profile-board-widgets");
  root.replaceChildren();
  const widgets = (board?.widgets || []).filter(widget => widget.visible && Object.hasOwn(boardWidgetNames, widget.kind));
  if (!widgets.length) {
    root.append(boardText("p", emptyMessage || (board ? "Este mural está vazio." : "Mural indisponível."), "pinned-empty"));
    return;
  }
  for (const widget of widgets) {
    const card = document.createElement("article");
    card.className = "profile-board-card";
    const heading = widget.kind === "custom"
      ? `${widget.emoji ? `${widget.emoji} ` : ""}${widget.title || boardWidgetNames.custom}`
      : boardWidgetNames[widget.kind];
    card.append(boardText("h3", heading));
    if (widget.kind === "achievements") {
      const list = document.createElement("ul");
      list.className = "profile-board-achievements";
      for (const id of board.achievements || []) {
        const badge = badgeDef(id) || BOARD_MILESTONES[id];
        if (badge) {
          const chip = boardText("li", badge.name);
          chip.title = badge.description || "";
          list.append(chip);
        }
      }
      card.append(list.childElementCount ? list : boardText("p", "Nenhuma conquista registrada."));
    } else if (widget.kind === "link") {
      const url = parseBoardLink(widget.url);
      if (!url) continue;
      const link = boardText("a", widget.label, "chat-link");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link, boardText("p", url.hostname, "settings-hint-text"));
    } else if (widget.kind === "custom") {
      if (/^[0-9a-f]{32}$/.test(widget.image_id || "")) {
        const img = document.createElement("img");
        img.className = "profile-board-cover";
        img.src = cachedMediaUrl(`/api/attachments/${widget.image_id}/imagem`);
        img.alt = widget.title ? `Imagem de ${widget.title}` : "Imagem do bloco personalizado";
        img.loading = "lazy";
        img.decoding = "async";
        card.append(img);
      }
      card.append(boardText("p", widget.text || ""));
    } else {
      if (widget.kind === "favorite_game" && /^[0-9a-f]{32}$/.test(widget.cover_id || "")) {
        const img = document.createElement("img");
        img.className = "profile-board-cover";
        img.src = cachedMediaUrl(`/api/attachments/${widget.cover_id}/capa`);
        img.alt = `Capa de ${widget.name}`;
        img.loading = "lazy";
        img.decoding = "async";
        card.append(img);
      }
      card.append(boardText(widget.kind === "about" ? "p" : "strong", widget.text || widget.name));
      if (widget.description) card.append(boardText("p", widget.description));
    }
    root.append(card);
  }
}

function parseBoardLink(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url : null;
  } catch (_) {
    return null;
  }
}

function moveBoardWidget(from, to, focusAction) {
  const widgets = boardEditor.draft?.widgets;
  if (!widgets || boardEditor.saving || from === to || from < 0 || from >= widgets.length || to < 0 || to >= widgets.length) return;
  const [widget] = widgets.splice(from, 1);
  widgets.splice(to, 0, widget);
  renderBoardEditor();
  if (focusAction) {
    const row = boardList.children[to];
    const next = row.querySelector(`[data-action="${focusAction}"]:not(:disabled)`) || row.querySelector("button:not(:disabled)");
    next?.focus();
  }
}

function renderBoardEditor() {
  const { draft, latest } = boardEditor;
  const saving = boardEditor.saving || boardEditor.uploading;
  boardEditor.dragIndex = null;
  const conflict = draft && draft.revision !== latest?.revision;
  boardControls.classList.toggle("hidden", !draft);
  boardSave.disabled = Boolean(saving || conflict || !boardIsDirty());
  boardReload.disabled = Boolean(saving);
  boardList.replaceChildren();
  if (!draft) return;
  boardAudience.value = draft.audience;
  boardAudience.disabled = Boolean(saving);
  boardKind.disabled = Boolean(saving || draft.widgets.length >= 8);
  boardAdd.disabled = boardKind.disabled;
  const badgeOption = boardKind.querySelector('[value="achievements"]');
  badgeOption.disabled = draft.widgets.some(widget => widget.kind === "achievements");
  if (badgeOption.disabled && boardKind.value === "achievements") boardKind.value = "favorite_game";
  for (const [index, widget] of draft.widgets.entries()) {
    const kind = boardWidgetNames[widget.kind];
    const title = widget.title || widget.name || widget.label || kind;
    const row = document.createElement("li");
    row.className = "profile-board-editor-row";
    const grip = boardText("span", "⠿", "profile-board-grip");
    grip.draggable = !saving;
    grip.setAttribute("aria-hidden", "true");
    grip.addEventListener("dragstart", e => {
      boardEditor.dragIndex = index;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-sancord-widget", String(index));
    });
    row.addEventListener("dragover", e => {
      if (boardEditor.dragIndex == null || saving) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.toggle("drop-target", boardEditor.dragIndex !== index);
    });
    row.addEventListener("dragleave", e => {
      if (!row.contains(e.relatedTarget)) row.classList.remove("drop-target");
    });
    row.addEventListener("drop", e => {
      if (boardEditor.dragIndex == null) return;
      e.preventDefault();
      const from = boardEditor.dragIndex;
      boardEditor.dragIndex = null;
      row.classList.remove("drop-target");
      moveBoardWidget(from, index);
    });
    grip.addEventListener("dragend", () => {
      boardEditor.dragIndex = null;
      boardList.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
    });
    const label = boardText("span", title, "profile-board-editor-label");
    if (title !== kind) label.append(boardText("small", kind));
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = widget.visible;
    check.disabled = Boolean(saving);
    check.setAttribute("aria-label", `Mostrar ${title} no mural`);
    check.addEventListener("change", () => {
      widget.visible = check.checked;
      boardSave.disabled = Boolean(conflict || !boardIsDirty());
    });
    const visible = boardText("label", "Visível", "profile-board-visibility");
    visible.prepend(check);
    const actions = document.createElement("div");
    actions.className = "profile-board-row-actions";
    const buttons = [
      ["up", "↑", "Subir", index === 0, () => moveBoardWidget(index, index - 1, "up")],
      ["down", "↓", "Descer", index === draft.widgets.length - 1, () => moveBoardWidget(index, index + 1, "down")],
      ["edit", "Editar", "Editar", widget.kind === "achievements", () => editBoardWidget(widget.kind, index)],
      ["remove", "Remover", "Remover", false, () => {
        draft.widgets.splice(index, 1);
        renderBoardEditor();
        boardAdd.focus();
      }],
    ];
    for (const [action, text, name, disabled, handler] of buttons) {
      const button = boardText("button", text, "btn-secondary small-btn");
      button.type = "button";
      button.dataset.action = action;
      button.disabled = Boolean(disabled || saving);
      button.setAttribute("aria-label", `${name} ${title}`);
      button.addEventListener("click", handler);
      actions.append(button);
    }
    row.append(grip, label, visible, actions);
    boardList.append(row);
  }
}

async function editBoardWidget(kind, index = null) {
  const editor = boardEditor;
  const draft = editor.draft;
  if (!draft || editor.saving || editor.uploading || !Object.hasOwn(boardWidgetNames, kind)) return;
  const existing = draft.widgets[index];
  const widget = { visible: existing?.visible ?? true, kind };
  const field = (name, label, maxlength, options) => ({
    name, label, maxlength, value: existing?.[name] || "", required: true, ...options,
  });
  const fields = [];
  if (["favorite_game", "playing", "want_to_play"].includes(kind)) fields.push(field("name", "Nome do jogo", 60));
  if (kind === "favorite_game") fields.push(
    field("description", "Descrição", 160, { required: false, type: "textarea" }),
    { name: "cover_action", label: "Capa", type: "select", value: "keep", options: [
      { value: "keep", label: existing?.cover_id ? "Manter capa atual" : "Sem capa" },
      { value: "upload", label: "Enviar capa" },
      ...(existing?.cover_id ? [{ value: "remove", label: "Remover capa" }] : []),
    ] },
    { name: "cover", label: "Arquivo da capa", type: "file", required: true,
      accept: "image/png,image/jpeg,image/webp", hint: "PNG, JPG ou WebP. Até 4 MB.",
      visibleWhen: v => v.cover_action === "upload" },
  );
  if (kind === "about") fields.push(field("text", "Texto", 400, { type: "textarea", rows: 4 }));
  if (kind === "link") fields.push(field("label", "Título do link", 60), field("url", "Endereço HTTP ou HTTPS", 500));
  if (kind === "custom") fields.push(
    field("title", "Título do bloco", 60),
    field("emoji", "Emoji (opcional)", 8, { required: false, placeholder: "✨" }),
    field("text", "Texto", 300, { type: "textarea", rows: 4 }),
    { name: "image_action", label: "Imagem (opcional)", type: "select", value: "keep", options: [
      { value: "keep", label: existing?.image_id ? "Manter imagem atual" : "Sem imagem" },
      { value: "upload", label: "Enviar imagem" },
      ...(existing?.image_id ? [{ value: "remove", label: "Remover imagem" }] : []),
    ] },
    { name: "image", label: "Arquivo da imagem", type: "file", required: true,
      accept: "image/png,image/jpeg,image/webp", hint: "PNG, JPG ou WebP. Até 4 MB.",
      visibleWhen: v => v.image_action === "upload" },
  );
  if (fields.length) {
    const values = await SancordUI.formDialog({ title: boardWidgetNames[kind], fields });
    if (!values || boardEditor.draft !== draft || boardEditor.saving) return;
    for (const f of fields) {
      if (f.name !== "cover_action" && f.name !== "image_action" && f.type !== "file") {
        const clean = values[f.name].trim();
        if (f.name === "emoji") {
          if (clean) widget.emoji = clean;
        } else {
          widget[f.name] = clean;
        }
      }
    }
    if (kind === "link" && !parseBoardLink(widget.url)) {
      showErrorToast("Use um link HTTP ou HTTPS sem credenciais.");
      return;
    }
    if (kind === "favorite_game" || kind === "custom") {
      const isCustom = kind === "custom";
      const actionKey = isCustom ? "image_action" : "cover_action";
      const fileKey = isCustom ? "image" : "cover";
      const idKey = isCustom ? "image_id" : "cover_id";
      const label = isCustom ? "imagem" : "capa";
      const prevId = existing?.[idKey] || null;
      const nextId = values[actionKey] === "keep" ? prevId : null;
      if (nextId) widget[idKey] = nextId;
      else if (!isCustom) widget[idKey] = null;
      if (values[actionKey] === "upload") {
        const file = values[fileKey];
        if (file.size > 4 * 1024 * 1024) {
          showErrorToast(`A ${label} pode ter no máximo 4 MB.`);
          return;
        }
        editor.uploading = true;
        const progress = isCustom ? "Enviando imagem…" : "Enviando capa…";
        boardStatus.textContent = progress;
        renderBoardEditor();
        try {
          widget[idKey] = await uploadProfileImage(file, file.name);
        } catch (err) {
          showErrorToast(err.message || `Não foi possível enviar a ${label}.`);
          return;
        } finally {
          if (boardEditor === editor) {
            editor.uploading = false;
            if (boardStatus.textContent === progress) boardStatus.textContent = "";
            renderBoardEditor();
          }
        }
      }
    }
  }
  if (boardEditor.draft !== draft || boardEditor.saving) return;
  if (index === null) {
    if (draft.widgets.length >= 8 || (kind === "achievements" && draft.widgets.some(w => w.kind === kind))) return;
    draft.widgets.push(widget);
  } else {
    const currentIndex = draft.widgets.indexOf(existing);
    if (currentIndex < 0) return;
    draft.widgets[currentIndex] = { ...widget, visible: existing.visible };
  }
  renderBoardEditor();
}

boardToggle.addEventListener("click", () => {
  resetBoardEditorOnAccountChange();
  const open = boardEditorPanel.classList.toggle("hidden") === false;
  boardToggle.setAttribute("aria-expanded", String(open));
  if (open && !boardEditor.saving && !boardEditor.uploading) requestBoardEditorState();
});
boardAudience.addEventListener("change", () => {
  if (!boardEditor.draft || boardEditor.saving) return;
  boardEditor.draft.audience = boardAudience.value;
  renderBoardEditor();
});
boardAdd.addEventListener("click", () => editBoardWidget(boardKind.value));
boardSave.addEventListener("click", () => {
  const { draft, latest, saving } = boardEditor;
  if (!draft || saving || boardEditor.uploading || draft.revision !== latest?.revision || !boardIsDirty()) return;
  if (!sendWs("SaveProfileBoard", { board: draft })) {
    boardStatus.textContent = "Sem conexão. O rascunho foi mantido.";
    return;
  }
  boardEditor.submitted = JSON.stringify(draft);
  boardEditor.saving = true;
  boardStatus.textContent = "Salvando mural…";
  boardEditor.saveTimer = setTimeout(() => handleBoardSaveFailure("Sem confirmação. Recarregue o mural para conferir a versão salva."), 8000);
  renderBoardEditor();
});
boardReload.addEventListener("click", async () => {
  if (boardIsDirty() && !(await SancordUI.confirm({
    title: "Recarregar mural?", message: "As alterações locais serão descartadas quando o mural for carregado.",
    confirmLabel: "Recarregar mural",
  }))) return;
  requestBoardEditorState(true);
});
