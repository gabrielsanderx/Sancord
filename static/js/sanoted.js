const Sanoted = (() => {
  const get = name => document.getElementById(`sanoted-${name}`);
  const root = document.getElementById("sanoted");
  const editor = get("editor");
  const api = "/api/sanoted";
  const assetLimit = 10 * 1024 * 1024;
  const objectUrls = new Set();
  const indexedBlocks = new WeakMap();
  let account = null, listTimer, searchTimer, savedRange, dragNote;
  const open = () => !root.classList.contains("hidden");
  const current = ctx => ctx && ctx === account;
  const online = ctx => Boolean(current(ctx) && SancordConnection.canWrite() && state.composerCapabilities?.has("sanoted_v1"));
  const selected = () => account?.notes.get(account.selected);
  const metadata = entry => entry.dirty ? entry.value : entry.meta || entry.value;
  const titleOf = value => value?.title?.trim() || "Sem título";
  const normalize = value => String(value || "").trim().toLocaleLowerCase("pt-BR");
  const pathFor = entry => `${api}/${entry.kind}/${entry.id}`;
  const assetPath = (note, asset) => `${api}/notes/${note}/assets/${asset}`;

  class RequestError extends Error {
    constructor(status, data) { super(data?.message || "O Sanoted não está disponível agora."); this.status = status; this.data = data; }
  }

  async function request(ctx, path, options = {}) {
    const token = getStoredToken();
    if (!online(ctx) || !token) throw Error("Sem conexão com o Sanoted.");
    return SancordNet.fetch(path, { ...options, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  }

  async function jsonRequest(ctx, path, options) {
    const response = await request(ctx, path, options);
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new RequestError(response.status, value);
    return value;
  }

  function bind(id) {
    if ((account?.id ?? null) === id) return;
    if (account) {
      clearTimeout(account.syncTimer);
      clearTimeout(account.refreshTimer);
      account.upload?.abort();
      account.io.abort();
    }
    account = id ? { id, notes: new Map(), folders: new Map(), writes: new Map(), fileWrites: new Set(),
      selected: null, folder: null, filter: "all", query: "", hits: null, sort: "updated", io: new AbortController() } : null;
    clearTimeout(listTimer);
    clearTimeout(searchTimer);
    releaseAssets();
    editor.replaceChildren();
    get("title").value = get("search").value = "";
    get("notes").replaceChildren();
    get("folders").replaceChildren();
    get("conflict").replaceChildren();
    if (open()) {
      render();
      if (account) void load(account);
    }
  }

  async function load(ctx) {
    if (ctx.load) return ctx.load;
    ctx.load = (async () => {
      try {
        const storage = await SanotedStorage.open(ctx.id);
        const cached = await storage.records();
        if (!current(ctx)) return;
        ctx.storage = storage;
        ctx.connected = online(ctx);
        for (const entry of cached) ctx[entry.kind].set(entry.id, entry);
        if (open()) render();
        if (online(ctx)) { await refresh(ctx); scheduleSync(ctx, 0); }
      } catch (err) {
        if (!current(ctx)) return;
        ctx.failure = err.message;
        ctx.load = null;
        if (open()) render();
      }
    })();
    return ctx.load;
  }

  function persist(ctx, entry) {
    const key = `${entry.kind}:${entry.id}`;
    const copy = JSON.parse(JSON.stringify(entry));
    delete copy.sending;
    const pending = (ctx.writes.get(key) || Promise.resolve()).catch(() => {}).then(() => ctx.storage.putDocument(key, copy));
    ctx.writes.set(key, pending);
    pending.then(() => {
      if (ctx.writes.get(key) !== pending) return;
      ctx.writes.delete(key);
      ctx.localFailures?.delete(key);
      if (current(ctx) && selected() === entry) renderStatus(entry);
    }, () => {
      if (ctx.writes.get(key) === pending) {
        ctx.localFailures ||= new Set();
        ctx.localFailures.add(key);
        if (current(ctx) && selected() === entry) renderStatus(entry);
      }
    });
    return pending;
  }

  function removeLocal(ctx, entry) {
    const key = `${entry.kind}:${entry.id}`;
    const pending = (ctx.writes.get(key) || Promise.resolve()).catch(() => {}).then(() => ctx.storage.removeDocument(key));
    ctx.writes.set(key, pending);
    const forget = () => {
      if (ctx.writes.get(key) === pending) ctx.writes.delete(key);
    };
    pending.then(forget, forget);
    return pending;
  }

  async function flushLocal() {
    const ctx = account;
    if (!ctx?.storage) return;
    while (ctx.writes.size || ctx.fileWrites.size) await Promise.all([...ctx.writes.values(), ...ctx.fileWrites]);
  }

  function changed(entry, value) {
    const ctx = account;
    entry.value = value;
    entry.dirty = true;
    entry.operation = crypto.randomUUID();
    if (entry.kind === "notes" && value) value.updated_at = Date.now();
    delete entry.error;
    persist(ctx, entry);
    scheduleSync(ctx);
    if (entry === selected()) renderStatus(entry);
    clearTimeout(listTimer);
    listTimer = setTimeout(() => { if (current(ctx) && open()) renderList(); }, 120);
  }

  function scheduleSync(ctx, delay = 650) {
    clearTimeout(ctx?.syncTimer);
    if (!online(ctx) || !ctx.storage || ![...ctx.folders.values(), ...ctx.notes.values()].some(entry => entry.dirty && !entry.conflict && !entry.error)) return;
    ctx.syncTimer = setTimeout(() => void sync(ctx), delay);
  }

  async function sync(ctx) {
    if (ctx.syncing || !online(ctx)) return;
    ctx.syncing = true;
    try {
      const depth = entry => {
        const visited = new Set([entry.id]);
        let parent = entry.value?.parent_id;
        while (parent && !visited.has(parent)) {
          visited.add(parent);
          parent = ctx.folders.get(parent)?.value?.parent_id;
        }
        return visited.size;
      };
      const folders = [...ctx.folders.values()].sort((a, b) => depth(a) - depth(b));
      // Pastas novas são criadas antes das notas; uma exclusão só é enviada depois dos movimentos locais.
      for (const entry of [...folders.filter(item => !item.purge), ...ctx.notes.values(), ...folders.filter(item => item.purge).reverse()]) {
        if (!online(ctx)) break;
        if (entry.dirty && !entry.conflict && !entry.error) await sendEntry(ctx, entry);
      }
    } finally {
      ctx.syncing = false;
      if (current(ctx)) { renderStatus(selected()); scheduleSync(ctx); }
    }
  }

  function payload(entry, value) {
    if (entry.purge || !value) return null;
    if (entry.kind === "folders") return { name: value.name, parent_id: value.parent_id };
    return { title: value.title, folder_id: value.folder_id, pinned: value.pinned, favorite: value.favorite,
      deleted: value.deleted_at != null, blocks: value.blocks };
  }

  async function sendEntry(ctx, entry) {
    const sent = entry.operation;
    const value = entry.value;
    entry.sending = true;
    try {
      await ctx.writes.get(`${entry.kind}:${entry.id}`);
      if (!online(ctx) || sent !== entry.operation) return;
      const uploads = entry.purge ? [] : (value?.blocks || []).filter(item => item.type === "asset" && entry.uploads?.includes(item.asset_id));
      for (const asset of uploads) await uploadAsset(ctx, entry, asset);
      if (!online(ctx) || sent !== entry.operation) return;
      const result = await jsonRequest(ctx, pathFor(entry), { method: "POST", signal: ctx.io.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_version: entry.base, operation_id: sent, item: payload(entry, value) }) });
      ctx.writeEpoch = (ctx.writeEpoch || 0) + 1;
      entry.base = result?.version || 0;
      if (entry.operation === sent) {
        entry.dirty = false;
        entry.meta = null;
        entry.value = result;
        if (!result) {
          ctx[entry.kind].delete(entry.id);
          if (entry.kind === "notes" && ctx.selected === entry.id) {
            ctx.selected = null;
            if (current(ctx) && open()) paintEditor(null);
          }
          await removeLocal(ctx, entry);
          if (entry.kind === "notes") await ctx.storage.removeFiles(entry.id);
          return;
        }
      }
      await persist(ctx, entry);
    } catch (err) {
      if (!current(ctx)) return;
      if (err.status === 409) entry.conflict = { remote: err.data.current };
      else if (online(ctx)) entry.error = err.message || "O envio foi interrompido.";
      await persist(ctx, entry).catch(() => {});
    } finally {
      delete entry.sending;
      if (current(ctx) && open()) { renderList(); renderStatus(selected()); }
    }
  }

  async function uploadAsset(ctx, entry, asset) {
    const file = await ctx.storage.getFile(entry.id, asset.asset_id);
    if (!file) throw Error(`O arquivo ${asset.filename} está indisponível neste dispositivo.`);
    const controller = new AbortController();
    ctx.upload = controller;
    try {
      await jsonRequest(ctx, `${assetPath(entry.id, asset.asset_id)}?${new URLSearchParams({ filename: asset.filename })}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, signal: controller.signal,
      });
      entry.uploads = entry.uploads.filter(id => id !== asset.asset_id);
    } finally { if (ctx.upload === controller) ctx.upload = null; }
  }

  async function refresh(ctx) {
    if (!online(ctx)) return;
    if (ctx.refreshing) { ctx.wantsRefresh = true; return; }
    ctx.refreshing = true;
    const writeEpoch = ctx.writeEpoch;
    try {
      const snapshot = await jsonRequest(ctx, api, { signal: ctx.io.signal });
      if (!current(ctx)) return;
      if (writeEpoch !== ctx.writeEpoch) { ctx.wantsRefresh = true; return; }
      for (const kind of ["folders", "notes"]) {
        const serverIds = new Set();
        for (const value of snapshot[kind]) {
          serverIds.add(value.id);
          const entry = ctx[kind].get(value.id);
          if (entry?.dirty || entry?.sending || Math.max(entry?.base || 0, entry?.meta?.version || 0) >= value.version) continue;
          const next = entry || { kind, id: value.id, uploads: [] };
          if (kind === "folders" || !next.value?.blocks) {
            next.value = value;
            next.base = value.version;
          } else next.meta = value;
          ctx[kind].set(value.id, next);
          persist(ctx, next);
        }
        for (const entry of ctx[kind].values()) {
          if (entry.dirty || entry.sending || serverIds.has(entry.id)) continue;
          ctx[kind].delete(entry.id);
          void removeLocal(ctx, entry).catch(() => {});
          if (entry.kind === "notes") void ctx.storage.removeFiles(entry.id).catch(() => {});
        }
      }
      if (open()) {
        renderList();
        const entry = selected();
        if (!entry) paintEditor(null);
        else if (!entry.dirty && (!entry.value?.blocks || (entry.meta && entry.meta.version !== entry.value.version))) {
          const before = entry.value;
          const value = await fullNote(ctx, entry).catch(() => null);
          if (current(ctx) && selected() === entry && value && before !== value && !entry.dirty) paintEditor(entry);
        }
      }
      if (ctx.query) void searchOnServer(ctx);
    } catch (_) {
      if (current(ctx) && open()) renderStatus(selected());
    } finally {
      ctx.refreshing = false;
      if (ctx.wantsRefresh && current(ctx)) { ctx.wantsRefresh = false; remoteChanged(); }
    }
  }

  function remoteChanged() {
    const ctx = account;
    if (!ctx?.storage) return;
    clearTimeout(ctx.refreshTimer);
    ctx.refreshTimer = setTimeout(() => void refresh(ctx), 180);
  }

  function hide() {
    if (!open()) return;
    root.classList.add("hidden");
    releaseAssets();
    editor.replaceChildren();
    savedRange = null;
    document.getElementById("open-sanoted-btn").classList.remove("active");
    document.getElementById("open-sanoted-btn").removeAttribute("aria-current");
  }

  async function show() {
    switchToHomeFriendsView();
    state.homeSection = "sanoted";
    friendsMainView.classList.add("hidden");
    openFriendsTabBtn.classList.remove("active");
    const button = document.getElementById("open-sanoted-btn");
    button.classList.add("active");
    button.setAttribute("aria-current", "page");
    root.classList.remove("hidden");
    bind(state.sanotedAccountId || null);
    render();
    if (account) await load(account);
  }

  // A apresentação fica nas funções abaixo; apenas o modelo é sincronizado.
  function iconButton(icon, label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "header-tool-btn";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(SancordIcons.node(icon));
    button.addEventListener("click", action);
    return button;
  }

  function emptyState(title, description, action) {
    const host = get("empty");
    host.innerHTML = SancordUI.emptyHTML({ icon: "file", title, description });
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-primary";
      button.append(SancordIcons.node("plus"), document.createTextNode("Nova nota"));
      button.addEventListener("click", () => newNote());
      host.append(button);
    }
    host.classList.remove("hidden");
  }

  function render() {
    renderList();
    paintEditor(selected());
  }

  function folderName(id) { return account?.folders.get(id)?.value?.name || "Sem pasta"; }

  function renderList() {
    const ctx = account;
    get("new").disabled = !ctx?.storage;
    get("folder-new").disabled = !ctx?.storage;
    if (!ctx) return;
    root.querySelectorAll("[data-note-filter]").forEach(button => button.setAttribute("aria-pressed", String(!ctx.folder && button.dataset.noteFilter === ctx.filter)));
    renderFolders(ctx);
    const notes = [...ctx.notes.values()].filter(entry => {
      const note = metadata(entry);
      if (!note || (note.deleted_at != null) !== (ctx.filter === "trash")) return false;
      if (ctx.filter === "favorite" && !note.favorite) return false;
      if (ctx.filter === "recent" && Date.now() - note.updated_at > 7 * 86400000) return false;
      if (!ctx.query) return !ctx.folder || note.folder_id === ctx.folder;
      const blocks = entry.value?.blocks;
      if (blocks && !indexedBlocks.has(blocks)) indexedBlocks.set(blocks, normalize(SanotedEditor.preview(blocks)));
      const body = blocks ? indexedBlocks.get(blocks) : normalize(note.preview);
      return `${normalize(note.title)} ${body} ${normalize(folderName(note.folder_id))}`.includes(ctx.query) ||
        (!entry.dirty && ctx.hits?.has(note.id));
    });
    notes.sort((a, b) => {
      const left = metadata(a), right = metadata(b);
      const pinned = Number(right.pinned) - Number(left.pinned);
      if (pinned) return pinned;
      if (ctx.sort === "title") return titleOf(left).localeCompare(titleOf(right), "pt-BR");
      return ctx.sort === "created" ? right.created_at - left.created_at : right.updated_at - left.updated_at;
    });
    const host = get("notes");
    host.replaceChildren();
    for (const entry of notes) {
      const note = metadata(entry);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sanoted-note-row";
      row.dataset.noteId = note.id;
      row.draggable = note.deleted_at == null;
      row.setAttribute("aria-current", note.id === ctx.selected ? "true" : "false");
      const heading = document.createElement("strong");
      if (note.pinned) heading.append(SancordIcons.node("pin"));
      heading.append(document.createTextNode(titleOf(note)));
      if (note.favorite) heading.append(SancordIcons.node("star"));
      const excerpt = document.createElement("span");
      excerpt.textContent = note.preview || "Nota vazia";
      const date = document.createElement("time");
      date.textContent = new Date(note.updated_at).toLocaleDateString("pt-BR");
      date.dateTime = new Date(note.updated_at).toISOString();
      row.append(heading, excerpt, date);
      row.addEventListener("click", () => void selectNote(note.id));
      row.addEventListener("contextmenu", event => { event.preventDefault(); noteMenu(entry, event.clientX, event.clientY); });
      row.addEventListener("dragstart", event => {
        dragNote = entry.id;
        event.dataTransfer.setData("application/x-sanoted-note", entry.id);
        event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => { dragNote = null; });
      host.append(row);
    }
    if (!notes.length && ctx.storage) {
      const text = document.createElement("p");
      text.className = "sanoted-list-empty";
      text.textContent = ctx.query ? "Nenhum resultado" : ctx.filter === "trash" ? "Lixeira vazia" : "Nenhuma nota nesta lista";
      host.append(text);
    }
  }

  function renderFolders(ctx) {
    const host = get("folders");
    const rows = [...ctx.folders.values()].filter(item => item.value).sort((a,b) => a.value.name.localeCompare(b.value.name, "pt-BR"));
    host.replaceChildren();
    const placed = new Set();
    function draw(parent, depth) {
      for (const entry of rows) {
        const folder = entry.value;
        const effectiveParent = ctx.folders.get(folder.parent_id)?.value ? folder.parent_id : null;
        if (placed.has(folder.id) || effectiveParent !== parent) continue;
        placed.add(folder.id);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "sanoted-folder-row";
        row.dataset.folderId = folder.id;
        row.style.setProperty("--folder-indent", `${Math.min(depth, 6) * 10}px`);
        row.setAttribute("aria-pressed", String(ctx.folder === folder.id));
        row.append(SancordIcons.node("folder"), document.createTextNode(folder.name));
        if (entry.conflict) row.append(document.createTextNode(" · conflito"));
        else if (entry.error || entry.purge) row.append(document.createTextNode(" · pendente"));
        row.addEventListener("click", () => { if (!entry.purge) { ctx.folder = folder.id; ctx.filter = "all"; renderList(); } });
        row.addEventListener("contextmenu", event => { event.preventDefault(); folderMenu(entry, event.clientX, event.clientY); });
        row.addEventListener("dragover", event => { if (dragNote) { event.preventDefault(); row.classList.add("drop-target"); } });
        row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
        row.addEventListener("drop", event => {
          row.classList.remove("drop-target");
          if (!dragNote || entry.purge) return;
          event.preventDefault();
          const note = ctx.notes.get(dragNote);
          dragNote = null;
          if (note) void patchNote(note, { folder_id: folder.id });
        });
        host.append(row);
        draw(folder.id, depth + 1);
      }
    }
    draw(null, 0);
  }

  function paintEditor(entry) {
    releaseAssets();
    savedRange = null;
    const note = entry?.value;
    get("document").classList.toggle("hidden", !Array.isArray(note?.blocks));
    editor.replaceChildren();
    get("empty").classList.add("hidden");
    if (!note?.blocks) {
      if (entry) emptyState("Abrindo a nota", "Se a conexão estiver indisponível, abra uma nota já carregada neste dispositivo.");
      else if (account?.failure) emptyState("Não foi possível abrir o Sanoted", account.failure);
      else if (!account) emptyState("Sanoted indisponível", "Entre em uma conta em um servidor compatível.");
      else if (!account.storage) emptyState("Abrindo o Sanoted", "Carregando suas notas privadas.");
      else if (!account.notes.size) emptyState("Nenhuma nota ainda", "Crie sua primeira nota no Sanoted.", true);
      else emptyState("Escolha uma nota", "Abra uma nota na lista ou crie uma nova.", true);
      return;
    }
    get("title").value = note.title;
    get("title").readOnly = note.deleted_at != null;
    editor.contentEditable = note.deleted_at == null ? "true" : "false";
    get("toolbar").classList.toggle("hidden", note.deleted_at != null);
    get("location").textContent = note.deleted_at != null ? "Lixeira" : folderName(note.folder_id);
    const ctx = account;
    SanotedEditor.draw(editor, note.blocks, block => assetFigure(ctx, entry, block));
    renderStatus(entry);
  }

  function renderStatus(entry) {
    if (!entry || !account || !open()) return;
    const key = `notes:${entry.id}`;
    const badLocal = account.localFailures?.has(key);
    const pending = account.writes.has(key);
    get("status").textContent = badLocal ? "Falha ao salvar neste PC" : entry.conflict ? "Conflito"
      : pending ? "Salvando…" : entry.error ? `Salvo localmente · ${entry.error}`
      : !online(account) ? (entry.purge ? "Offline · Aguardando exclusão" : "Offline · Salvo localmente")
      : entry.dirty ? "Sincronizando…" : "Salvo ✓";
    get("retry").classList.toggle("hidden", !(badLocal || entry.error));
    const panel = get("conflict");
    panel.classList.toggle("hidden", !entry.conflict);
    panel.replaceChildren();
    if (entry.conflict) {
      const text = document.createElement("span");
      text.textContent = entry.conflict.remote ? "Esta nota foi alterada em outro dispositivo." : "Esta nota foi apagada em outro dispositivo.";
      panel.append(text);
      for (const [label, keep] of [[entry.purge ? "Confirmar exclusão" : "Manter minha versão", true], ["Usar versão do servidor", false]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = keep ? "btn-primary small-btn" : "btn-secondary small-btn";
        button.textContent = label;
        button.addEventListener("click", () => void resolveConflict(entry, keep));
        panel.append(button);
      }
    }
  }

  async function fullNote(ctx, entry) {
    if (entry.dirty || (entry.value?.blocks && (!entry.meta || entry.meta.version === entry.value.version))) return entry.value;
    if (!online(ctx)) return entry.value?.blocks ? entry.value : null;
    const value = await jsonRequest(ctx, pathFor(entry), { signal: ctx.io.signal });
    if (!current(ctx) || entry.dirty || value.version < Math.max(entry.base, entry.meta?.version || 0)) return entry.value;
    entry.value = value;
    entry.meta = null;
    entry.base = value.version;
    persist(ctx, entry);
    return value;
  }

  async function selectNote(id, pageFocus = true) {
    const ctx = account;
    const entry = ctx?.notes.get(id);
    if (!entry) return;
    ctx.selected = id;
    renderList();
    paintEditor(entry);
    try {
      const before = entry.value;
      const value = await fullNote(ctx, entry);
      if (!current(ctx) || ctx.selected !== id) return;
      if (!value?.blocks) emptyState("Nota ainda indisponível offline", "Ela será carregada quando a conexão voltar.");
      if (value && before !== value) paintEditor(entry);
      if (pageFocus && matchMedia("(max-width: 1050px)").matches) setLibrary(false);
    } catch (err) {
      if (current(ctx) && ctx.selected === id && !entry.value?.blocks) emptyState("Não foi possível abrir a nota", err.message);
    }
  }

  function newNote(folder = account?.folder || null) {
    const ctx = account;
    if (!ctx?.storage) return;
    if (ctx.notes.size >= 500) { showErrorToast("Limite de 500 notas, incluindo a lixeira."); return; }
    ctx.filter = "all";
    ctx.folder = folder;
    ctx.query = "";
    get("search").value = "";
    const id = crypto.randomUUID();
    const entry = { kind: "notes", id, base: 0, uploads: [] };
    ctx.notes.set(id, entry);
    ctx.selected = id;
    changed(entry, { id, title: "", folder_id: folder, pinned: false, favorite: false, blocks: [], preview: "", created_at: Date.now(), deleted_at: null });
    render();
    get("title").focus();
  }

  async function patchNote(entry, patch) {
    const ctx = account;
    try {
      const note = await fullNote(ctx, entry);
      if (!current(ctx)) return;
      if (!note) throw Error("Abra esta nota com conexão uma vez antes de editá-la offline.");
      changed(entry, { ...note, ...patch });
      renderList();
      if (selected() === entry && Object.hasOwn(patch, "deleted_at")) paintEditor(entry);
      else if (selected() === entry && Object.hasOwn(patch, "folder_id")) get("location").textContent = folderName(patch.folder_id);
    } catch (err) { if (current(ctx)) showErrorToast(err.message); }
  }

  function captureEditor() {
    const entry = selected();
    if (!entry?.value?.blocks || entry.value.deleted_at != null) return;
    SanotedEditor.normalizeChecks(editor);
    const blocks = SanotedEditor.read(editor);
    const title = get("title").value;
    if (title === entry.value.title && JSON.stringify(blocks) === JSON.stringify(entry.value.blocks)) return;
    const preview = SanotedEditor.preview(blocks).replace(/\s+/g, " ").trim().slice(0, 140);
    changed(entry, { ...entry.value, title, blocks, preview });
  }

  const objUrl = blob => { const url = URL.createObjectURL(blob); objectUrls.add(url); return url; };
  const imageObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      imageObserver.unobserve(entry.target);
      entry.target.loadSanotedImage();
    }
  }) : null;

  function releaseAssets() {
    editor.querySelectorAll("img[data-sanoted-preview]").forEach(img => imageObserver?.unobserve(img));
    if (objectUrls.has(lightboxImg?.getAttribute("src"))) {
      lightboxImg.removeAttribute("src");
      imageLightboxModal.classList.add("hidden");
    }
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  async function readAsset(ctx, entry, block) {
    const cached = await ctx.storage.getFile(entry.id, block.asset_id);
    if (cached) return cached;
    const response = await request(ctx, assetPath(entry.id, block.asset_id), { signal: ctx.io.signal });
    if (!response.ok) throw Error("Arquivo indisponível neste momento.");
    const blob = await response.blob();
    void ctx.storage.putFile(entry.id, block.asset_id, blob).catch(() => {});
    return blob;
  }

  function assetFigure(ctx, entry, block) {
    const figure = document.createElement("figure");
    figure.dataset.sanotedAsset = JSON.stringify(block);
    figure.dataset.assetSize = block.size;
    figure.className = "sanoted-asset";
    figure.setAttribute("contenteditable", "false");
    const caption = document.createElement("figcaption");
    caption.textContent = block.caption || `${block.filename} · ${Math.max(1, Math.round(block.bytes / 1024))} KiB`;
    if (block.image) {
      const inspect = document.createElement("button");
      inspect.type = "button";
      inspect.className = "sanoted-image-button";
      inspect.setAttribute("aria-label", `Ampliar ${block.filename}`);
      const img = document.createElement("img");
      img.dataset.sanotedPreview = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = block.caption || block.filename;
      const load = async () => {
        try {
          const blob = await readAsset(ctx, entry, block);
          if (img.isConnected && current(ctx)) img.src = objUrl(blob);
        } catch (_) { if (img.isConnected) img.alt = `${block.filename} · imagem indisponível`; }
      };
      img.loadSanotedImage = load;
      img.addEventListener("error", () => { img.alt = `${block.filename} · imagem inválida ou indisponível`; });
      inspect.append(img);
      inspect.addEventListener("click", async () => {
        try {
          const url = img.getAttribute("src") || objUrl(await readAsset(ctx, entry, block));
          if (!current(ctx) || !figure.isConnected) return;
          lightboxImg.src = url;
          imageLightboxModal.classList.remove("hidden");
        } catch (_) { showErrorToast("Imagem indisponível neste momento."); }
      });
      figure.append(inspect);
      if (imageObserver) imageObserver.observe(img);
      else void load();
    } else {
      const download = iconButton("download", `Baixar ${block.filename}`, async () => {
        try {
          const blob = await readAsset(ctx, entry, block);
          if (!current(ctx)) return;
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = block.filename;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (_) { showErrorToast("Arquivo indisponível neste momento."); }
      });
      figure.append(download);
    }
    figure.append(caption);
    if (entry.value.deleted_at == null) {
      const more = iconButton("more", "Opções do anexo", event => assetMenu(figure, event));
      figure.append(more);
      figure.addEventListener("contextmenu", event => { event.preventDefault(); assetMenu(figure, event); });
    }
    return figure;
  }

  function addFiles(files) {
    const ctx = account;
    const entry = selected();
    if (!ctx?.storage || !entry?.value || entry.value.deleted_at != null) return;
    const task = (async () => {
      for (const file of files) {
        if (!current(ctx) || entry.value?.deleted_at != null) break;
        const imageType = /^image\/(png|jpeg|webp|gif)$/.exec(file.type);
        const image = Boolean(imageType || /\.(?:png|jpe?g|webp|gif)$/i.test(file.name));
        const fileName = file.name || (image ? `Imagem colada.${imageType?.[1] || "png"}` : "Anexo.txt");
        if (!image && !/\.(?:pdf|txt|md)$/i.test(fileName)) { showErrorToast("Use PNG, JPEG, WebP, GIF, PDF ou texto."); continue; }
        if (!file.size || file.size > assetLimit) { showErrorToast("Cada anexo pode ter até 10 MiB."); continue; }
        if (entry.value.blocks.filter(block => block.type === "asset").length >= 24) { showErrorToast("A nota já tem 24 anexos."); break; }
        const asset_id = crypto.randomUUID();
        await ctx.storage.putFile(entry.id, asset_id, file);
        if (!current(ctx) || !entry.value) break;
        const block = { type: "asset", asset_id, image, size: "medium", caption: "", filename: fileName.slice(0, 160), bytes: file.size };
        entry.uploads.push(asset_id);
        changed(entry, { ...entry.value, blocks: [...entry.value.blocks, block] });
        if (selected() === entry) {
          editor.append(assetFigure(ctx, entry, block));
          const next = document.createElement("p");
          next.append(document.createElement("br"));
          editor.append(next);
          next.scrollIntoView({ block: "nearest" });
        }
      }
    })();
    ctx.fileWrites.add(task);
    task.then(() => ctx.fileWrites.delete(task), () => {
      ctx.fileWrites.delete(task);
      if (current(ctx)) showErrorToast("Não foi possível salvar o anexo neste dispositivo.");
    });
  }

  function setLibrary(visible) {
    root.classList.toggle("sanoted-library-hidden", !visible);
    get("toggle-list").setAttribute("aria-expanded", String(visible));
  }

  function itemButton(icon, label, onSelect) { return { icon, label, onSelect }; }

  function noteMenu(entry, x, y) {
    const note = metadata(entry);
    if (!note) return;
    const actions = [itemButton("file", "Abrir", () => selectNote(entry.id))];
    if (entry.purge) {
      if (entry.error) actions.push(itemButton("rotate", "Tentar sincronizar novamente", () => changed(entry, entry.value)));
    } else if (note.deleted_at != null) {
      actions.push(itemButton("rotate", "Restaurar", () => patchNote(entry, { deleted_at: null })), {
        ...itemButton("trash", "Excluir permanentemente", () => purge(entry)), danger: true,
      });
    } else {
      actions.push(itemButton("edit", "Renomear", async () => { await selectNote(entry.id); get("title").select(); }),
        itemButton("pin", note.pinned ? "Desafixar" : "Fixar", () => patchNote(entry, { pinned: !note.pinned })),
        itemButton("star", note.favorite ? "Remover das favoritas" : "Favoritar", () => patchNote(entry, { favorite: !note.favorite })),
        itemButton("folder", "Mover para pasta…", () => move(entry)), { separator: true },
        { ...itemButton("trash", "Mover para a lixeira", () => patchNote(entry, { deleted_at: Date.now() })), danger: true });
    }
    SancordUI.contextMenu(x, y, actions);
  }

  async function purge(entry) {
    const ctx = account;
    if (!await SancordUI.confirm({ title: "Apagar esta nota permanentemente?", message: "A nota e seus anexos serão apagados.", confirmLabel: "Apagar nota", danger: true }) || !current(ctx)) return;
    const note = await fullNote(ctx, entry).catch(() => null);
    if (note) { entry.purge = true; changed(entry, note); }
    else showErrorToast("Abra esta nota antes de apagar.");
  }

  async function folderDialog(entry, parent = null) {
    const ctx = account;
    const result = await SancordUI.formDialog({ title: entry ? "Renomear pasta" : "Nova pasta", submitLabel: entry ? "Renomear" : "Criar pasta",
      fields: [{ name: "name", label: "Nome da pasta", required: true, maxlength: 80, value: entry?.value?.name || "" }] });
    if (!current(ctx) || !result?.name.trim()) return;
    if (!entry && ctx.folders.size >= 100) { showErrorToast("Limite de 100 pastas."); return; }
    const id = entry?.id || crypto.randomUUID();
    const record = entry || { id, kind: "folders", base: 0 };
    ctx.folders.set(id, record);
    changed(record, { ...record.value, id, name: result.name.trim(), parent_id: record.value?.parent_id ?? parent });
    if (!entry) { ctx.filter = "all"; ctx.folder = id; }
    renderList();
  }

  function folderOptions(blocked) {
    const choices = [{ value: "root", label: "Sem pasta" }];
    for (const entry of account.folders.values()) {
      if (!entry.value || entry.purge || entry.id === blocked) continue;
      const path = [entry.value.name];
      const visited = new Set([entry.id]);
      let parent = entry.value.parent_id;
      let allowed = true;
      while (parent && !visited.has(parent)) {
        if (parent === blocked) { allowed = false; break; }
        const folder = account.folders.get(parent)?.value;
        if (!folder) break;
        path.unshift(folder.name);
        visited.add(parent);
        parent = folder.parent_id;
      }
      if (allowed) choices.push({ value: entry.id, label: path.join(" / ") });
    }
    return choices;
  }

  async function move(entry) {
    const ctx = account;
    const folder = entry.kind === "folders";
    const result = await SancordUI.formDialog({ title: folder ? "Mover pasta" : "Mover nota", submitLabel: "Mover",
      fields: [{ name: "destination", label: "Destino", type: "select", options: folderOptions(folder ? entry.id : null),
        value: (folder ? entry.value.parent_id : metadata(entry).folder_id) || "root" }] });
    if (!current(ctx) || !result) return;
    const destination = result.destination === "root" ? null : result.destination;
    if (folder) { changed(entry, { ...entry.value, parent_id: destination }); renderList(); }
    else await patchNote(entry, { folder_id: destination });
  }

  function folderMenu(entry, x, y) {
    const ctx = account;
    const actions = entry.purge ? [] : [itemButton("plus", "Nova nota nesta pasta", () => newNote(entry.id)),
      itemButton("folder", "Nova subpasta", () => folderDialog(null, entry.id)),
      itemButton("edit", "Renomear", () => folderDialog(entry)), itemButton("folder", "Mover pasta…", () => move(entry))];
    if (entry.conflict) actions.push({ separator: true },
      itemButton("edit", "Manter alterações locais", () => resolveConflict(entry, true)),
      itemButton("rotate", "Usar pasta do servidor", () => resolveConflict(entry, false)));
    else if (entry.error) actions.push(itemButton("rotate", "Tentar sincronizar novamente", () => changed(entry, entry.value)));
    if (!entry.purge) actions.push({ separator: true }, { ...itemButton("trash", "Excluir pasta", async () => {
      if (!await SancordUI.confirm({ title: "Excluir pasta?", message: "As notas e subpastas serão movidas para a pasta acima.", confirmLabel: "Excluir pasta", danger: true }) || !current(ctx)) return;
      const parent = entry.value.parent_id;
      for (const note of ctx.notes.values()) if (note.dirty && note.value?.folder_id === entry.id) changed(note, { ...note.value, folder_id: parent });
      for (const child of ctx.folders.values()) if (child.dirty && child.value?.parent_id === entry.id) changed(child, { ...child.value, parent_id: parent });
      if (ctx.folder === entry.id) ctx.folder = parent;
      entry.purge = true;
      changed(entry, entry.value);
      renderList();
    }), danger: true });
    SancordUI.contextMenu(x, y, actions);
  }

  async function resolveConflict(entry, keep) {
    const ctx = account;
    const remote = entry.conflict?.remote;
    delete entry.conflict;
    entry.base = remote?.version || 0;
    entry.meta = null;
    if (keep) {
      if (entry.kind === "notes" && !remote) entry.uploads = entry.value?.blocks.filter(block => block.type === "asset").map(block => block.asset_id) || [];
      changed(entry, entry.value);
    } else if (remote) {
      entry.dirty = false;
      entry.purge = false;
      entry.error = null;
      entry.value = remote;
      entry.uploads = [];
      await persist(ctx, entry).catch(() => {});
    } else {
      ctx[entry.kind].delete(entry.id);
      await removeLocal(ctx, entry).catch(() => {});
    }
    if (current(ctx)) render();
  }

  function assetMenu(figure, event) {
    const entry = selected();
    if (!entry?.value?.blocks || !figure.isConnected) return;
    const block = JSON.parse(figure.dataset.sanotedAsset);
    const update = patch => {
      if (!figure.isConnected || selected() !== entry) return;
      figure.dataset.sanotedAsset = JSON.stringify({ ...block, ...patch });
      figure.dataset.assetSize = patch.size || block.size;
      if (Object.hasOwn(patch, "caption")) figure.querySelector("figcaption").textContent = patch.caption || block.filename;
      captureEditor();
    };
    const actions = [];
    if (block.image) {
      for (const [size, name] of [["small", "Pequena"], ["medium", "Média"], ["large", "Grande"], ["full", "Largura completa"]]) actions.push(itemButton("image", name, () => update({ size })));
      actions.push(itemButton("edit", "Editar legenda…", async () => {
        const values = await SancordUI.formDialog({ title: "Legenda da imagem", submitLabel: "Aplicar", fields: [{ name: "caption", label: "Legenda", maxlength: 250, value: block.caption }] });
        if (values) update({ caption: values.caption || "" });
      }));
    }
    actions.push({ ...itemButton("trash", "Remover da nota", () => { figure.remove(); captureEditor(); }), danger: true });
    const anchor = event.currentTarget.getBoundingClientRect();
    SancordUI.contextMenu(event.clientX || anchor.left, event.clientY || anchor.bottom, actions);
  }

  async function searchOnServer(ctx) {
    if (!online(ctx) || !ctx.query) return;
    const term = ctx.query;
    try {
      const results = await jsonRequest(ctx, `${api}?${new URLSearchParams({ q: term })}`, { signal: ctx.io.signal });
      if (!current(ctx) || ctx.query !== term) return;
      ctx.hits = new Set(results.notes.map(note => note.id));
      if (open()) renderList();
    } catch (_) {}
  }

  async function insertLink() {
    const entry = selected();
    const cursor = savedRange || SanotedEditor.selection(editor).cloneRange();
    const values = await SancordUI.formDialog({ title: "Inserir link", submitLabel: "Inserir", fields: [
      { name: "url", label: "Endereço", required: true, maxlength: 2048, placeholder: "https://" },
      { name: "text", label: "Texto do link", maxlength: 200, value: cursor.toString().slice(0, 200) },
    ] });
    if (!values || selected() !== entry || !editor.contains(cursor.startContainer)) return;
    const url = SanotedEditor.safeLink(values.url);
    if (!url) { showErrorToast("Informe um endereço HTTP ou HTTPS válido."); return; }
    const anchor = document.createElement("a");
    anchor.className = "chat-link";
    anchor.href = url;
    anchor.rel = "noopener noreferrer";
    anchor.target = "_blank";
    anchor.textContent = values.text || url;
    cursor.deleteContents();
    cursor.insertNode(anchor);
    cursor.setStartAfter(anchor);
    cursor.collapse(true);
    editor.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(cursor);
    captureEditor();
  }

  function command(name) {
    if (!selected()?.value || selected().value.deleted_at != null) return;
    if (name === "link") { void insertLink(); return; }
    if (name === "image" || name === "file") {
      const input = get("file");
      input.accept = name === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md";
      input.click();
      return;
    }
    SanotedEditor.format(editor, name, savedRange);
    captureEditor();
  }

  function clipboardFiles(transfer) {
    if (!transfer) return [];
    if (transfer.files.length) return [...transfer.files];
    return [...transfer.items].filter(item => item.kind === "file").map(item => item.getAsFile()).filter(Boolean);
  }

  document.getElementById("open-sanoted-btn").addEventListener("click", () => void show());
  get("toggle-list").addEventListener("click", () => setLibrary(root.classList.contains("sanoted-library-hidden")));
  get("new").addEventListener("click", () => newNote());
  get("folder-new").addEventListener("click", () => void folderDialog(null, account?.folder));
  get("order").addEventListener("change", event => { if (account) { account.sort = event.target.value; renderList(); } });
  root.querySelector(".sanoted-filters").addEventListener("click", event => {
    const filter = event.target.closest("[data-note-filter]")?.dataset.noteFilter;
    if (!filter || !account) return;
    account.filter = filter;
    account.folder = null;
    renderList();
  });
  get("search").addEventListener("input", event => {
    const ctx = account;
    if (!ctx) return;
    clearTimeout(searchTimer);
    ctx.query = normalize(event.target.value);
    ctx.hits = null;
    searchTimer = setTimeout(() => { if (current(ctx)) { renderList(); void searchOnServer(ctx); } }, 180);
  });
  get("more").addEventListener("click", event => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (selected()) noteMenu(selected(), rect.left, rect.bottom);
  });
  get("retry").addEventListener("click", () => { if (selected()) changed(selected(), selected().value); });
  get("file").addEventListener("change", event => { addFiles([...event.target.files]); event.target.value = ""; });
  get("title").addEventListener("input", captureEditor);
  get("title").addEventListener("paste", event => {
    const files = clipboardFiles(event.clipboardData);
    if (!editor.isContentEditable || !files.length) return;
    event.preventDefault();
    editor.focus();
    addFiles(files);
  });
  editor.addEventListener("input", captureEditor);
  editor.addEventListener("paste", event => {
    if (!editor.isContentEditable) return;
    event.preventDefault();
    const transfer = event.clipboardData;
    if (!transfer) return;
    const files = clipboardFiles(transfer);
    if (files.length) addFiles(files);
    else { SanotedEditor.pasteText(editor, transfer.getData("text/plain")); captureEditor(); }
  });
  editor.addEventListener("dragover", event => {
    if (editor.isContentEditable && Array.from(event.dataTransfer?.types || []).includes("Files")) {
      event.preventDefault();
      editor.classList.add("is-file-drop");
      event.dataTransfer.dropEffect = "copy";
    }
  });
  editor.addEventListener("dragleave", event => { if (!editor.contains(event.relatedTarget)) editor.classList.remove("is-file-drop"); });
  editor.addEventListener("drop", event => {
    editor.classList.remove("is-file-drop");
    event.preventDefault();
    if (!editor.isContentEditable) return;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) { addFiles(files); return; }
    const text = event.dataTransfer?.getData("text/plain");
    if (text) { SanotedEditor.pasteText(editor, text); captureEditor(); }
  });
  editor.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (link && event.button === 0 && !event.defaultPrevented && window.getSelection()?.isCollapsed) {
      const href = SanotedEditor.safeLink(link.href);
      if (href) { event.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); }
      return;
    }
    const check = event.target.closest("button[data-note-check]");
    if (!check || !editor.isContentEditable) return;
    const item = check.closest("li");
    item.dataset.checked = String(item.dataset.checked !== "true");
    captureEditor();
  });
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (open() && selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) savedRange = selection.getRangeAt(0).cloneRange();
  });
  get("toolbar").addEventListener("mousedown", event => { if (event.target.closest("button")) event.preventDefault(); });
  get("toolbar").addEventListener("click", event => { const key = event.target.closest("[data-note-command]")?.dataset.noteCommand; if (key) command(key); });
  document.addEventListener("keydown", event => {
    if (!open() || !event.ctrlKey || event.altKey || event.metaKey || document.querySelector(".modal-backdrop:not(.hidden), .settings-fullscreen:not(.hidden)")) return;
    const key = event.key.toLowerCase();
    if (!event.shiftKey && key === "n") { event.preventDefault(); newNote(); }
    else if (!event.shiftKey && key === "f") { event.preventDefault(); setLibrary(true); get("search").focus(); }
    else if (editor.contains(event.target) && ((!event.shiftKey && ["b", "i"].includes(key)) || (event.shiftKey && event.code === "Digit7"))) {
      event.preventDefault();
      command(event.shiftKey ? "insertOrderedList" : key === "b" ? "bold" : "italic");
    }
  });
  document.addEventListener("sancord:connection", () => {
    const ctx = account;
    if (!ctx?.storage) return;
    const connected = online(ctx);
    if (ctx.connected === connected) return;
    ctx.connected = connected;
    if (connected) {
      for (const entry of [...ctx.notes.values(), ...ctx.folders.values()]) if (entry.dirty && entry.error) delete entry.error;
      if (open()) editor.querySelectorAll("img[data-sanoted-preview]:not([src])").forEach(img => {
        if (imageObserver) imageObserver.observe(img);
        else void img.loadSanotedImage();
      });
      remoteChanged();
      scheduleSync(ctx, 30);
    } else ctx.upload?.abort();
    if (open()) renderStatus(selected());
  });
  return { bind, hide, remoteChanged, flushLocal };
})();
window.Sanoted = Sanoted;
