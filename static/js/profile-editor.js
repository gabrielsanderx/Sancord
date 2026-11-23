// ============================================================================
// Sancord — Editor visual de perfil
//   • Lateral compacta: cada item abre um subeditor no lugar (← Voltar / Esc)
//   • Centro e direita: o mesmo cartão de perfil completo que os outros abrem
//     (renderProfileCardIdentity), atualizado ao vivo com o rascunho
//   • Mural: widgets do rascunho do mural; salvar/redefinir pela barra única
// Depende de app.js, profile.js, profile-card.js, profile-board.js e profile-sharing.js.
// ============================================================================

const peSidebar = document.querySelector(".pe-sidebar");
const peContextPopover = document.getElementById("pe-context-popover");
const peContextToggle = document.getElementById("pe-context-toggle");
let peView = "home";
let peViewOpener = null;
let peCosmeticBefore = null;
const PE_COSMETIC_FIELDS = {
  name: ["name_style", "name_color", "name_color_secondary", "name_gradient_direction"],
  theme: ["theme_primary", "theme_accent", "theme_highlight", "theme_mode", "theme_direction"],
  decoration: ["avatar_decoration"],
  frame: ["profile_frame"],
  effect: ["profile_effect"],
  nameplate: ["nameplate_style"],
  badges: ["badge_order", "hidden_badges"],
};
const peGalleryFilter = { avatar_decoration: "all", profile_frame: "all" };
let peShowAllWidgets = false;

// ---------------------------------------------------------------------------
// Navegação entre a tela inicial do editor e os subeditores
// ---------------------------------------------------------------------------
function peViewEl(name) {
  return peSidebar?.querySelector(`[data-pe-view="${name}"]`) || null;
}

function ensurePeHeader(view) {
  if (view.dataset.peView === "home" || view.querySelector(":scope > .pe-sub-head")) return;
  const head = document.createElement("div");
  head.className = "pe-sub-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "pe-back";
  back.textContent = "← Voltar";
  back.addEventListener("click", () => closePeSubeditor());
  const title = document.createElement("h3");
  title.textContent = view.dataset.peTitle || "";
  head.append(back, title);
  if (!Object.hasOwn(PE_COSMETIC_FIELDS, view.dataset.peView)) {
    view.prepend(head);
    return;
  }
  const body = document.createElement("div");
  body.className = "pe-chooser-content";
  body.append(...view.childNodes);
  view.classList.add("pe-chooser-view");
  const actions = document.createElement("div");
  actions.className = "pe-chooser-actions";
  for (const [label, apply] of [["Cancelar", false], ["Aplicar", true]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = apply ? "btn-primary small-btn" : "btn-secondary small-btn";
    button.textContent = label;
    button.addEventListener("click", () => closePeSubeditor(apply));
    actions.append(button);
  }
  view.append(head, body, actions);
}

function openPeView(name, opener = document.activeElement) {
  const target = peViewEl(name);
  if (!target || peView === name) return;
  if (peView !== "home") closePeSubeditor();
  if (document.getElementById("profile-subtab-global")?.classList.contains("hidden")) {
    document.querySelector('[data-profile-subtab="global"]')?.click();
  }
  peViewOpener = opener;
  peView = name;
  const fields = PE_COSMETIC_FIELDS[name];
  peCosmeticBefore = fields
    ? Object.fromEntries(fields.map(field => [field, Array.isArray(profileDraft[field]) ? [...profileDraft[field]] : profileDraft[field]]))
    : null;
  peSidebar.classList.toggle("pe-choosing", Boolean(fields));
  for (const view of peSidebar.querySelectorAll("[data-pe-view]")) view.classList.toggle("hidden", view !== target);
  ensurePeHeader(target);
  renderPeView(name);
  peSidebar.scrollTop = 0;
  target.querySelector(".pe-back")?.focus({ preventScroll: true });
  updateProfileDirtyState();
}

/** Volta para a tela inicial do editor. Devolve false se já estava nela. */
function closePeSubeditor(apply = false) {
  if (peView === "home" || !peSidebar) return false;
  const before = peCosmeticBefore;
  peCosmeticBefore = null;
  peView = "home";
  peSidebar.classList.remove("pe-choosing");
  for (const view of peSidebar.querySelectorAll("[data-pe-view]")) {
    view.classList.toggle("hidden", view.dataset.peView !== "home");
  }
  if (before && !apply) {
    stopProfileEffect(document.getElementById("preview-effect-layer"));
    if (Array.isArray(before.badge_order)) profileDraft.badge_order = [...before.badge_order];
    if (Array.isArray(before.hidden_badges)) profileDraft.hidden_badges = [...before.hidden_badges];
    loadAppearanceDraft({ ...profileDraft, ...before });
    refreshLiveProfilePreview();
  } else {
    restorePreviewName();
    updateProfileDirtyState();
  }
  if (peViewOpener?.isConnected && !peViewOpener.closest(".hidden,[hidden]")) peViewOpener.focus({ preventScroll: true });
  peViewOpener = null;
  return true;
}

/** Esc dentro do editor: fecha o menu de prévia, depois o mural em modo compacto, depois sai do subeditor. */
function handlePeEscape() {
  if (profileContextPopoverOpen()) {
    closePeContext();
    return true;
  }
  if (peCosmeticBefore) return closePeSubeditor();
  const card = document.getElementById("live-profile-preview-card");
  if (card?.classList.contains("pe-mural-open")) {
    card.classList.remove("pe-mural-open");
    syncPeMuralToggleUI();
    return true;
  }
  const tab = document.getElementById("settings-tab-profile");
  if (!tab || tab.classList.contains("hidden")) return false;
  return closePeSubeditor();
}

function renderPeView(name) {
  if (name === "decoration") renderPeGallery("avatar_decoration");
  else if (name === "frame") renderPeGallery("profile_frame");
  else if (name === "effect") renderPeList("effect");
  else if (name === "nameplate") renderPeList("nameplate");
  else if (name === "badges") renderPeBadgesEditor();
  else if (name === "banner") renderPeBannerPreview();
  else if (name === "board") {
    const panel = document.getElementById("board-editor");
    if (panel?.classList.contains("hidden")) document.getElementById("open-board-editor")?.click();
  } else if (name === "collection") {
    const panel = document.getElementById("profile-collection-panel");
    if (panel?.classList.contains("hidden")) document.getElementById("open-profile-collection")?.click();
  }
}

document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-pe-open]");
  if (opener && opener.closest("#settings-tab-profile")) {
    e.preventDefault();
    openPeView(opener.dataset.peOpen, opener);
  }
});

// ---------------------------------------------------------------------------
// Galerias de decoração e moldura (catálogo do servidor)
// ---------------------------------------------------------------------------
const PE_GALLERY_FILTERS = [["all", "Todas"], ["animated", "Animadas"], ["static", "Estáticas"], ["owned", "Minha coleção"]];

function peChoice(id, label, selected, owned) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pe-choice${selected ? " selected" : ""}${owned ? "" : " locked"}`;
  button.dataset.id = id;
  button.setAttribute("aria-pressed", String(selected));
  const saved = PE_COSMETIC_FIELDS[peView]?.[0];
  if (saved && (state.selfUser?.[saved] || "none") === id) {
    button.dataset.equipped = "true";
    button.setAttribute("aria-description", "Equipado no perfil salvo");
  }
  const preview = document.createElement("span");
  preview.className = "pe-choice-preview";
  const name = document.createElement("span");
  name.className = "pe-choice-name";
  name.textContent = label;
  button.append(preview, name);
  if (!owned) {
    const lock = document.createElement("span");
    lock.className = "cosmetic-lock";
    lock.textContent = "🔒";
    lock.setAttribute("aria-hidden", "true");
    button.append(lock);
  }
  return button;
}

function renderPeGallery(kind) {
  const host = document.querySelector(`[data-pe-gallery="${kind}"]`);
  if (!host) return;
  const field = PICKER_KINDS[kind].field;
  const current = profileDraft[field] || "none";
  const filter = peGalleryFilter[kind];
  host.replaceChildren();

  const chips = document.createElement("div");
  chips.className = "pe-chips";
  for (const [key, label] of PE_GALLERY_FILTERS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `pe-chip${filter === key ? " active" : ""}`;
    chip.textContent = label;
    chip.setAttribute("aria-pressed", String(filter === key));
    chip.addEventListener("click", () => {
      peGalleryFilter[kind] = key;
      renderPeGallery(kind);
    });
    chips.append(chip);
  }

  const grid = document.createElement("div");
  grid.className = "pe-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", PICKER_KINDS[kind].title);
  const hint = document.createElement("p");
  hint.className = "pe-hint pe-gallery-hint";
  hint.setAttribute("role", "status");

  const none = peChoice("none", "Nenhuma", current === "none", true);
  none.querySelector(".pe-choice-preview").textContent = "∅";
  grid.append(none);

  const items = pickerItems(kind).filter((item) =>
    filter === "animated" ? item.animated : filter === "static" ? !item.animated :
    filter === "owned" ? ownsCosmetic(item.kind, item.id) : true);
  for (const item of items) {
    const owned = ownsCosmetic(item.kind, item.id);
    const choice = peChoice(item.id, item.name, current === item.id, owned);
    choice.title = [item.name, COLLECTION_LABELS[item.collection] || item.collection, owned ? "" : pickerUnlockHint(item)]
      .filter(Boolean).join(" · ");
    choice.querySelector(".pe-choice-preview").append(buildPickerPreview(kind, item.id));
    grid.append(choice);
  }
  if (!items.length) {
    hint.textContent = state.cosmetics?.loaded ? "Nenhum item neste filtro." : "Carregando catálogo…";
  }

  grid.addEventListener("click", (e) => {
    const choice = e.target.closest(".pe-choice");
    if (!choice) return;
    if (choice.classList.contains("locked")) {
      const item = cosmeticInfo(kind, choice.dataset.id);
      hint.textContent = `🔒 ${pickerUnlockHint(item) || "Item exclusivo"}. Concedido pelo Sanvo, não dá para equipar por aqui.`;
      return;
    }
    profileDraft[field] = choice.dataset.id;
    for (const option of grid.querySelectorAll(".pe-choice")) {
      option.classList.toggle("selected", option === choice);
      option.setAttribute("aria-pressed", String(option === choice));
    }
    hint.textContent = "";
    refreshLiveProfilePreview();
  });
  host.append(chips, grid, hint);
  refreshAnimatedMedia(host);
}

// ---------------------------------------------------------------------------
// Efeitos e placas (listas com amostra real; hover reproduz, clique aplica)
// ---------------------------------------------------------------------------
function renderPeList(mode) {
  const host = document.querySelector(`[data-pe-list="${mode}"]`);
  if (!host) return;
  const kind = mode === "effect" ? "profile_effect" : "nameplate";
  const field = mode === "effect" ? "profile_effect" : "nameplate_style";
  const baseList = (mode === "effect" ? PROFILE_EFFECTS : NAMEPLATES)
    .filter((item) => !item.requiresCatalog || cosmeticInfo(kind, item.id));
  const seenIds = new Set(baseList.map((item) => item.id));
  const catalogExtras = (state.cosmetics?.catalog || [])
    .filter((item) => item.kind === kind && !seenIds.has(item.id))
    .map((item) => ({ id: item.id, name: item.name, desc: item.description || "" }));
  const list = [...baseList, ...catalogExtras];
  const active = profileDraft[field] || "none";
  const user = draftPreviewUser();
  const displayName = user.display_name || user.username || "Você";
  host.replaceChildren();
  for (const item of list) {
    const owned = ownsCosmetic(kind, item.id);
    const catalogItem = cosmeticInfo(kind, item.id);
    const choice = peChoice(item.id, catalogItem?.name || item.name, active === item.id, owned);
    choice.classList.add("pe-list-item");
    choice.disabled = !owned;
    const preview = choice.querySelector(".pe-choice-preview");
    if (mode === "nameplate") {
      const plate = document.createElement("span");
      plate.className = "pe-plate-sample";
      plate.textContent = displayName;
      applyNameplateChip(plate, item.id);
      preview.append(plate);
    } else {
      const sample = document.createElement("span");
      sample.className = "effect-option-preview";
      const effect = document.createElement("span");
      effect.className = "profile-effect-layer";
      sample.append(effect);
      preview.append(sample);
      configureProfileEffect(effect, item.id);
      choice.addEventListener("pointerenter", () => playProfileEffect(effect));
      choice.addEventListener("focus", () => playProfileEffect(effect));
      choice.addEventListener("pointerleave", () => stopProfileEffect(effect));
      choice.addEventListener("blur", () => stopProfileEffect(effect));
    }
    const desc = document.createElement("small");
    desc.className = "pe-choice-desc";
    desc.textContent = item.desc || "";
    choice.querySelector(".pe-choice-name").after(desc);
    choice.addEventListener("click", () => {
      profileDraft[field] = item.id;
      for (const option of host.querySelectorAll(".pe-choice")) {
        option.classList.toggle("selected", option === choice);
        option.setAttribute("aria-pressed", String(option === choice));
      }
      refreshLiveProfilePreview();
      // Ao escolher, o efeito toca uma vez no perfil completo.
      if (mode === "effect") playProfileEffect(document.getElementById("preview-effect-layer"));
    });
    host.append(choice);
  }
}

document.querySelector("[data-pe-replay]")?.addEventListener("click", () => {
  playProfileEffect(document.getElementById("preview-effect-layer"));
});

// ---------------------------------------------------------------------------
// Estilo do nome: abas Fontes / Efeitos / Cores e prévia no hover
// ---------------------------------------------------------------------------
const peNameSamples = document.getElementById("settings-name-style-samples");

function setPeNameTab(tab) {
  document.querySelectorAll("[data-pe-name-tab]").forEach((button) => {
    const on = button.dataset.peNameTab === tab;
    button.classList.toggle("active", on);
    button.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll("[data-pe-name-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", !panel.dataset.peNamePanel.split(" ").includes(tab));
  });
  if (peNameSamples) peNameSamples.dataset.group = tab;
}
document.querySelectorAll("[data-pe-name-tab]").forEach((button) =>
  button.addEventListener("click", () => setPeNameTab(button.dataset.peNameTab)));
setPeNameTab("fonts");

function restorePreviewName() {
  const name = document.getElementById("preview-card-name");
  if (name && state.selfUser) applyNameStyleToEl(name, draftPreviewUser(), "#ffffff");
}

function previewPeNameSample(e) {
  const sample = e.target.closest("[data-style-sample]");
  const name = document.getElementById("preview-card-name");
  if (!sample || sample.disabled || !name || !state.selfUser) return;
  const user = draftPreviewUser();
  applyNameStyleToEl(name, { ...user, name_style: previewProfileNameOption(user.name_style, sample.dataset.stylePart, sample.dataset.styleSample) }, "#ffffff");
}

peNameSamples?.addEventListener("pointerover", previewPeNameSample);
peNameSamples?.addEventListener("focusin", previewPeNameSample);
peNameSamples?.addEventListener("pointerleave", restorePreviewName);
peNameSamples?.addEventListener("focusout", restorePreviewName);

// ---------------------------------------------------------------------------
// Faixa: prévia no subeditor e reposicionar/zoom com o editor de recorte
// ---------------------------------------------------------------------------
function renderPeBannerPreview() {
  const box = document.getElementById("pe-banner-preview");
  if (box && state.selfUser) setProfileBanner(box, draftPreviewUser());
}

document.getElementById("pe-banner-reposition")?.addEventListener("click", async () => {
  const user = draftPreviewUser();
  if (!user.banner_url) {
    document.getElementById("settings-change-banner-btn")?.click();
    return;
  }
  if (user.banner_animated || isAnimatedMediaUrl(user.banner_url)) {
    showUiToast("GIFs animados não podem ser recortados. Envie a imagem de novo para trocar.");
    return;
  }
  try {
    const blob = await (await fetch(cachedMediaUrl(user.banner_url))).blob();
    openAvatarCropModal(new File([blob], "banner.png", { type: blob.type || "image/png" }), "banner");
  } catch (_) {
    showErrorToast("Não foi possível abrir a faixa atual. Envie a imagem de novo.");
  }
});

// ---------------------------------------------------------------------------
// Prévia: partes do perfil completo além da identidade, e as miniaturas da lateral
// ---------------------------------------------------------------------------
function renderPeTileThumbnails(user) {
  const effectTile = document.querySelector("#open-effect-picker-btn .pe-tile-visual");
  const effect = user.profile_effect && user.profile_effect !== "none" ? user.profile_effect : "";
  if (effectTile && effectTile.dataset.effect !== effect) {
    effectTile.dataset.effect = effect;
    effectTile.replaceChildren();
    if (effect) {
      const sample = document.createElement("span");
      sample.className = "effect-option-preview";
      const layer = document.createElement("span");
      layer.className = "profile-effect-layer";
      sample.append(layer);
      effectTile.append(sample);
      configureProfileEffect(layer, effect);
      effectTile.parentElement.onpointerenter = () => playProfileEffect(layer);
    } else {
      effectTile.innerHTML = '<span class="cust-plus-circle" aria-hidden="true">+</span>';
      effectTile.parentElement.onpointerenter = null;
    }
  }
  const frameTile = document.querySelector("#open-deco-quick-btn .pe-tile-visual");
  const frame = user.profile_frame && user.profile_frame !== "none" ? user.profile_frame : "";
  if (frameTile && frameTile.dataset.frame !== frame) {
    frameTile.dataset.frame = frame;
    frameTile.replaceChildren();
    if (frame) frameTile.append(buildPickerPreview("profile_frame", frame));
    else frameTile.innerHTML = '<span class="cust-plus-circle" aria-hidden="true">+</span>';
  }
}

function renderPeActivity(user) {
  const host = document.getElementById("pe-activity-list");
  if (!host) return;
  const status = user.status_kind || "online";
  const cards = [];
  const liveActivity = user.activity || (typeof SancordActivity !== "undefined" ? SancordActivity.resolveActiveActivity() : null);
  const voice = state.currentVoiceChannel && (state.voiceChannels || []).find((c) => c.id === state.currentVoiceChannel);
  if (state.currentVoiceChannel) cards.push(["🔊", `Em chamada de voz — ${voice?.name || "Chamada privada"}`, "Visível para quem pode ver sua atividade"]);
  if (customStatusText(user)) cards.push(["💬", "Status personalizado", customStatusText(user)]);
  cards.push(["🟢", STATUS_LABELS[status] || "Online", "Seu status atual"]);
  host.replaceChildren();
  if (liveActivity && liveActivity.name && typeof SancordActivity !== "undefined") {
    const richCard = SancordActivity.createRichActivityCard(liveActivity);
    if (richCard) host.append(richCard);
  }
  for (const [icon, title, sub] of cards) {
    const row = document.createElement("div");
    row.className = "profile-activity-card";
    row.innerHTML = '<div class="profile-activity-left"><div class="profile-activity-icon"></div><div class="profile-activity-meta"><strong></strong><span></span></div></div>';
    row.querySelector(".profile-activity-icon").textContent = icon;
    row.querySelector("strong").textContent = title;
    row.querySelector(".profile-activity-meta span").textContent = sub;
    host.append(row);
  }
}

// ---------------------------------------------------------------------------
// Insígnias: visibilidade, ordenação (botões + arrastar) e prévia ao vivo
// ---------------------------------------------------------------------------
let peDraggingBadgeId = null;

function renderPeBadgesHomeSummary() {
  const preview = document.getElementById("pe-badges-home-preview");
  const label = document.getElementById("pe-badges-home-label");
  if (!preview && !label) return;
  const owned = typeof getOwnedBadgesList === "function" ? getOwnedBadgesList() : (state.selfUser?.badges || []);
  const maxVisible = typeof getMaxVisibleBadges === "function" ? getMaxVisibleBadges() : 6;
  const visible = typeof computeVisibleBadges === "function"
    ? computeVisibleBadges(owned, profileDraft.badge_order, profileDraft.hidden_badges, maxVisible)
    : owned;
  if (preview && typeof renderProfileBadges === "function") {
    renderProfileBadges(preview, visible);
  }
  if (label) {
    if (!owned.length) label.textContent = "Nenhuma insígnia";
    else if (!visible.length) label.textContent = `Ocultas (0 de ${owned.length})`;
    else label.textContent = `${visible.length} de ${owned.length} visíve${visible.length === 1 ? "l" : "is"}`;
  }
}

function renderPeBadgesEditor() {
  const host = document.getElementById("pe-badges-editor");
  if (!host) return;
  host.replaceChildren();

  const owned = typeof getOwnedBadgesList === "function" ? getOwnedBadgesList() : [];
  const maxVisible = typeof getMaxVisibleBadges === "function" ? getMaxVisibleBadges() : 6;
  const ordered = typeof computeOrderedOwnedBadges === "function"
    ? computeOrderedOwnedBadges(owned, profileDraft.badge_order)
    : [...owned];
  const hiddenSet = new Set(profileDraft.hidden_badges || []);
  const visible = typeof computeVisibleBadges === "function"
    ? computeVisibleBadges(owned, profileDraft.badge_order, profileDraft.hidden_badges, maxVisible)
    : ordered.slice(0, maxVisible);
  const visibleSet = new Set(visible);

  if (!owned.length) {
    const empty = document.createElement("div");
    empty.className = "pe-badges-empty";
    empty.innerHTML =
      `<strong>Nenhuma insígnia disponível</strong>` +
      `<p class="pe-hint">Esta conta ainda não possui insígnias. Insígnias são concedidas automaticamente ou pela equipe do Sanvo.</p>`;
    host.append(empty);
    return;
  }

  const topBar = document.createElement("div");
  topBar.className = "pe-badges-topbar";
  const countEl = document.createElement("span");
  countEl.className = "pe-badges-count";
  countEl.textContent = `${visible.length} de ${maxVisible} visíveis`;

  const isDefault = !(profileDraft.badge_order?.length) && !(profileDraft.hidden_badges?.length);
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.id = "pe-badges-reset-btn";
  resetBtn.className = "btn-secondary small-btn";
  resetBtn.textContent = "Restaurar padrão";
  resetBtn.disabled = isDefault;
  resetBtn.addEventListener("click", () => {
    profileDraft.badge_order = [];
    profileDraft.hidden_badges = [];
    renderPeBadgesEditor();
    refreshLiveProfilePreview();
  });
  topBar.append(countEl, resetBtn);

  const previewBox = document.createElement("div");
  previewBox.className = "pe-badges-live-box";
  const previewLabel = document.createElement("span");
  previewLabel.className = "pe-badges-live-label";
  previewLabel.textContent = "Prévia no perfil";
  const previewStrip = document.createElement("div");
  previewStrip.className = "profile-badges pe-badges-live-strip";
  if (visible.length && typeof renderProfileBadges === "function") {
    renderProfileBadges(previewStrip, visible);
  } else {
    previewStrip.classList.remove("hidden");
    const noneSpan = document.createElement("span");
    noneSpan.className = "pe-hint";
    noneSpan.textContent = "Todas as insígnias ocultas";
    previewStrip.append(noneSpan);
  }
  previewBox.append(previewLabel, previewStrip);

  const hint = document.createElement("p");
  hint.className = "pe-hint";
  hint.textContent = owned.length > maxVisible
    ? `Ative ou reordene suas insígnias. As ${maxVisible} primeiras ativas aparecem no perfil.`
    : "Ative, oculte ou reordene as insígnias exibidas no seu perfil.";

  const list = document.createElement("div");
  list.className = "pe-badges-list";
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "Insígnias da conta");

  const moveBadge = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= ordered.length || fromIdx === toIdx) return;
    const next = [...ordered];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    profileDraft.badge_order = next;
    renderPeBadgesEditor();
    refreshLiveProfilePreview();
  };

  ordered.forEach((id, idx) => {
    const def = typeof badgeDef === "function" ? badgeDef(id) : null;
    const canHide = typeof badgeCanHide === "function" ? badgeCanHide(id) : true;
    const isHidden = canHide && hiddenSet.has(id);
    const isShown = visibleSet.has(id);
    const cappedOut = !isHidden && !isShown;

    const row = document.createElement("div");
    row.className = `pe-badge-row${isHidden ? " is-hidden" : ""}${cappedOut ? " is-capped" : ""}`;
    row.setAttribute("role", "listitem");
    row.dataset.badgeId = id;
    row.draggable = ordered.length > 1;

    const handle = document.createElement("span");
    handle.className = "pe-badge-drag";
    handle.setAttribute("aria-hidden", "true");
    handle.title = "Arrastar para reordenar";
    handle.textContent = "⋮⋮";

    const iconWrap = document.createElement("span");
    iconWrap.className = `profile-badge ${def?.category === "trust" ? "badge-trust" : "badge-cosmetic"}`;
    iconWrap.setAttribute("aria-hidden", "true");
    iconWrap.innerHTML = `<svg viewBox="0 0 24 24">${(typeof BADGE_ICONS !== "undefined" && BADGE_ICONS[id]) || ""}</svg>`;

    const meta = document.createElement("div");
    meta.className = "pe-badge-meta";
    const nameRow = document.createElement("div");
    nameRow.className = "pe-badge-name-row";
    const nameEl = document.createElement("strong");
    nameEl.textContent = def?.name || id;
    nameRow.append(nameEl);
    if (!canHide) {
      const tag = document.createElement("span");
      tag.className = "pe-badge-tag";
      tag.textContent = "Obrigatória";
      nameRow.append(tag);
    } else if (cappedOut) {
      const tag = document.createElement("span");
      tag.className = "pe-badge-tag is-muted";
      tag.textContent = "Fora do limite";
      nameRow.append(tag);
    }
    const descEl = document.createElement("small");
    descEl.textContent = def?.description || "Insígnia da conta";
    meta.append(nameRow, descEl);

    const controls = document.createElement("div");
    controls.className = "pe-badge-controls";

    if (ordered.length > 1) {
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "pe-badge-move-btn";
      upBtn.dataset.badgeMove = "up";
      upBtn.textContent = "↑";
      upBtn.title = "Mover para cima";
      upBtn.setAttribute("aria-label", `Mover ${def?.name || id} para cima`);
      upBtn.disabled = idx === 0;
      upBtn.addEventListener("click", () => moveBadge(idx, idx - 1));

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "pe-badge-move-btn";
      downBtn.dataset.badgeMove = "down";
      downBtn.textContent = "↓";
      downBtn.title = "Mover para baixo";
      downBtn.setAttribute("aria-label", `Mover ${def?.name || id} para baixo`);
      downBtn.disabled = idx === ordered.length - 1;
      downBtn.addEventListener("click", () => moveBadge(idx, idx + 1));

      controls.append(upBtn, downBtn);
    }

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "pe-badge-toggle";
    toggleLabel.title = canHide
      ? (isHidden ? "Mostrar insígnia no perfil" : "Ocultar insígnia do perfil")
      : "Esta insígnia do sistema não pode ser ocultada.";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "pe-badge-checkbox";
    checkbox.checked = !isHidden;
    checkbox.disabled = !canHide;
    checkbox.setAttribute("aria-label", `Exibir insígnia ${def?.name || id}`);
    checkbox.addEventListener("change", () => {
      if (!canHide) {
        checkbox.checked = true;
        return;
      }
      const nextHidden = new Set(profileDraft.hidden_badges || []);
      if (checkbox.checked) nextHidden.delete(id);
      else nextHidden.add(id);
      profileDraft.hidden_badges = [...nextHidden];
      renderPeBadgesEditor();
      refreshLiveProfilePreview();
    });
    toggleLabel.append(checkbox);
    controls.append(toggleLabel);

    row.addEventListener("dragstart", (e) => {
      peDraggingBadgeId = id;
      row.classList.add("is-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      }
    });
    row.addEventListener("dragover", (e) => {
      if (!peDraggingBadgeId || peDraggingBadgeId === id) return;
      e.preventDefault();
      row.classList.add("is-drag-over");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("is-drag-over");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("is-drag-over");
      const fromId = peDraggingBadgeId || e.dataTransfer?.getData("text/plain");
      peDraggingBadgeId = null;
      if (!fromId || fromId === id) return;
      const fromIdx = ordered.indexOf(fromId);
      const toIdx = ordered.indexOf(id);
      if (fromIdx >= 0 && toIdx >= 0) moveBadge(fromIdx, toIdx);
    });
    row.addEventListener("dragend", () => {
      peDraggingBadgeId = null;
      row.classList.remove("is-dragging");
      list.querySelectorAll(".is-drag-over").forEach((el) => el.classList.remove("is-drag-over"));
    });

    row.append(handle, iconWrap, meta, controls);
    list.append(row);
  });

  host.append(topBar, previewBox, hint, list);
}

function peAfterRefresh() {
  if (!state.selfUser) return;
  const user = draftPreviewUser();
  document.getElementById("pe-add-pronouns")?.classList.toggle("hidden", Boolean(user.pronouns));
  document.getElementById("pe-add-bio")?.classList.toggle("hidden", Boolean((user.bio || "").trim()));
  const links = (selfProfileLinks || []).filter((link) => link.visible !== false);
  const linksWrap = document.getElementById("pe-links-wrap");
  if (linksWrap) renderVisitedProfileLinks(links, linksWrap, document.getElementById("pe-links"));
  renderPeTileThumbnails(user);
  renderPeBadgesHomeSummary();
  renderPeActivity(user);
  if (peView === "banner") renderPeBannerPreview();
  for (const cap of document.querySelectorAll(".pe-sidebar .pe-tile-caption")) {
    const txt = (cap.textContent || "").trim();
    if (txt) cap.title = txt;
  }
}


// ---------------------------------------------------------------------------
// Mural: widgets do rascunho, atalhos para adicionar e catálogo completo
// ---------------------------------------------------------------------------
const PE_WIDGET_SHORTCUTS = ["favorite_game", "want_to_play", "playing", "link", "about", "achievements", "custom"];

function onBoardEditorChanged() {
  const root = document.getElementById("pe-board-widgets");
  const status = document.getElementById("pe-board-status");
  if (!root) return;
  const { draft, latest } = boardEditor;
  if (status) status.textContent = document.getElementById("board-editor-status")?.textContent || "";
  const liveActivity = (typeof SancordActivity !== "undefined" && typeof SancordActivity.getDetectedGame === "function"
    ? SancordActivity.getDetectedGame()
    : null) || state.selfUser?.activity || null;
  const boardOpts = {
    editable: true,
    activity: liveActivity,
    activityVisible: true,
    onEdit: (widget) => {
      const idx = draft?.widgets ? draft.widgets.indexOf(widget) : -1;
      if (idx >= 0) editBoardWidget(widget.kind, idx);
    },
    onRemove: (widget) => {
      const idx = draft?.widgets ? draft.widgets.indexOf(widget) : -1;
      if (idx >= 0) {
        draft.widgets.splice(idx, 1);
        renderBoardEditor();
      }
    },
  };
  if (draft) {
    renderVisitedBoard({ ...draft, achievements: latest?.achievements || [] }, "Seu mural está vazio. Adicione um widget abaixo.", root, boardOpts);
  } else {
    root.replaceChildren();
  }
  renderProfileWishlist(draft, document.getElementById("pe-wishlist-widgets"), boardOpts);
  const addWish = document.getElementById("pe-add-wishlist");
  if (addWish) addWish.disabled = !draft || draft.widgets.length >= 8 || Boolean(boardEditor.saving || boardEditor.uploading);
  const grid = document.getElementById("pe-widget-shortcuts");
  if (grid) {
    grid.replaceChildren();
    const used = new Set((draft?.widgets || []).map((w) => w.kind));
    const kinds = PE_WIDGET_SHORTCUTS.filter((kind) => kind !== "achievements" || !used.has(kind));
    const full = Boolean(draft && draft.widgets.length >= 8);
    for (const kind of peShowAllWidgets ? kinds : kinds.slice(0, 6)) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "pe-widget-tile";
      tile.dataset.widgetKind = kind;
      tile.disabled = !draft || full || Boolean(boardEditor.saving || boardEditor.uploading);
      tile.innerHTML = '<span class="pe-widget-plus" aria-hidden="true">+</span><span></span>';
      tile.lastElementChild.textContent = boardWidgetNames[kind];
      tile.addEventListener("click", () => editBoardWidget(kind));
      grid.append(tile);
    }
  }
  const all = document.getElementById("pe-all-widgets");
  if (all) all.textContent = peShowAllWidgets ? "Mostrar menos" : "Ver todos os widgets";
  updateProfileDirtyState();
}

document.getElementById("pe-all-widgets")?.addEventListener("click", () => {
  peShowAllWidgets = !peShowAllWidgets;
  onBoardEditorChanged();
});

document.getElementById("pe-add-wishlist")?.addEventListener("click", () => editBoardWidget("want_to_play"));

const peTabs = [...document.querySelectorAll("[data-pe-tab]")];
peTabs.forEach((button) => {
  button.addEventListener("click", () => {
    peTabs.forEach((b) => {
      const on = b === button;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll("[data-pe-panel]").forEach((panel) =>
      panel.classList.toggle("hidden", panel.dataset.pePanel !== button.dataset.peTab));
  });
  button.addEventListener("keydown", e => {
    const at = peTabs.indexOf(button);
    const target = { ArrowLeft: peTabs.at(at - 1), ArrowRight: peTabs[(at + 1) % peTabs.length], Home: peTabs[0], End: peTabs.at(-1) }[e.key];
    if (!target) return;
    e.preventDefault();
    target.click();
    target.focus();
  });
});

// ---------------------------------------------------------------------------
// "Pré-visualizar em": cartão rápido, mensagem, membros, DM e painel inferior
// ---------------------------------------------------------------------------
function openPeContext() {
  peContextPopover?.classList.remove("hidden");
  peContextToggle?.setAttribute("aria-expanded", "true");
  renderProfileContextPreview();
  if (typeof queueProfileMotion === "function") queueProfileMotion();
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.reconcileIdleBudget === "function") {
    SancordCosmetics.reconcileIdleBudget();
  }
}

function closePeContext() {
  peContextPopover?.classList.add("hidden");
  peContextToggle?.setAttribute("aria-expanded", "false");
}

peContextToggle?.addEventListener("click", () => (profileContextPopoverOpen() ? closePeContext() : openPeContext()));
document.getElementById("pe-context-close")?.addEventListener("click", () => {
  closePeContext();
  peContextToggle?.focus({ preventScroll: true });
});

// ---------------------------------------------------------------------------
// Seletor "Perfil principal ▾": perfis por servidor usam a página própria
// ---------------------------------------------------------------------------
const peTarget = document.getElementById("pe-profile-target");

function syncPeTargetOptions() {
  if (!peTarget) return;
  peTarget.replaceChildren(new Option("Perfil principal", "global"));
  for (const server of state.servers || []) {
    if (server.id === "sancord") continue;
    peTarget.add(new Option(`Perfil em ${server.name}`, server.id));
  }
  peTarget.value = "global";
}

peTarget?.addEventListener("change", () => {
  const serverId = peTarget.value;
  peTarget.value = "global";
  if (serverId === "global") return;
  document.querySelector('[data-profile-subtab="server"]')?.click();
  const select = document.getElementById("settings-server-profile-select");
  if (select) {
    select.value = serverId;
    select.dispatchEvent(new Event("change"));
  }
});

// ---------------------------------------------------------------------------
// Mural recolhível e menu compacto em janelas menores
// ---------------------------------------------------------------------------
const PE_MURAL_COMPACT_MAX_WIDTH = 1060;
const peMuralToggle = document.getElementById("pe-mural-toggle");
const peMuralClose = document.getElementById("pe-mural-close");
const peNavToggle = document.getElementById("pe-nav-toggle");

function peIsCompactMuralViewport() {
  const panel = document.getElementById("settings-tab-profile");
  const w = panel?.clientWidth || window.innerWidth || 0;
  return w > 0 && w <= PE_MURAL_COMPACT_MAX_WIDTH;
}

function syncPeMuralToggleUI() {
  const card = document.getElementById("live-profile-preview-card");
  if (!card || !peMuralToggle) return;
  const compact = peIsCompactMuralViewport();
  const visible = compact ? card.classList.contains("pe-mural-open") : !card.classList.contains("pe-mural-hidden");
  peMuralToggle.setAttribute("aria-pressed", String(visible));
  peMuralToggle.classList.toggle("active", visible);
  peMuralToggle.title = visible ? "Ocultar mural" : "Mostrar mural";
}

function togglePeMural() {
  const card = document.getElementById("live-profile-preview-card");
  if (!card) return;
  if (peIsCompactMuralViewport()) {
    card.classList.toggle("pe-mural-open");
    card.classList.remove("pe-mural-hidden");
  } else {
    card.classList.toggle("pe-mural-hidden");
    card.classList.remove("pe-mural-open");
  }
  syncPeMuralToggleUI();
}

peMuralToggle?.addEventListener("click", togglePeMural);
peMuralClose?.addEventListener("click", () => {
  const card = document.getElementById("live-profile-preview-card");
  if (!card) return;
  if (peIsCompactMuralViewport()) card.classList.remove("pe-mural-open");
  else card.classList.add("pe-mural-hidden");
  syncPeMuralToggleUI();
  peMuralToggle?.focus({ preventScroll: true });
});

function syncPeNavToggleUI() {
  const shell = document.querySelector(".settings-shell");
  if (!shell || !peNavToggle) return;
  if ((window.innerWidth || 0) > 1040 && shell.classList.contains("pe-nav-collapsed")) {
    shell.classList.remove("pe-nav-collapsed");
  }
  const expanded = !shell.classList.contains("pe-nav-collapsed");
  peNavToggle.setAttribute("aria-expanded", String(expanded));
}

peNavToggle?.addEventListener("click", () => {
  const shell = document.querySelector(".settings-shell");
  if (!shell) return;
  shell.classList.toggle("pe-nav-collapsed");
  syncPeNavToggleUI();
});

window.addEventListener("resize", () => {
  syncPeMuralToggleUI();
  syncPeNavToggleUI();
});

// Ao abrir a página de perfil (chamado por switchSettingsTab): tela inicial do editor,
// mural e conexões carregados.
function onProfileEditorShown() {
  closePeSubeditor();
  closePeContext();
  document.getElementById("live-profile-preview-card")?.classList.remove("pe-mural-open");
  syncPeTargetOptions();
  syncPeMuralToggleUI();
  syncPeNavToggleUI();
  if (state.selfUser) {
    resetBoardEditorOnAccountChange();
    if (!boardEditor.draft && !boardEditor.saving) requestBoardEditorState();
    if (selfProfileLinks === null) requestProfileSharing();
  }
  onBoardEditorChanged();
  peAfterRefresh();
  if (typeof queueProfileMotion === "function") queueProfileMotion();
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.reconcileIdleBudget === "function") {
    SancordCosmetics.reconcileIdleBudget();
  }
};

if (typeof SancordActivity !== "undefined" && typeof SancordActivity.subscribe === "function") {
  SancordActivity.subscribe(() => {
    if (!state.selfUser) return;
    if (boardEditor?.draft) onBoardEditorChanged();
    const tab = document.getElementById("settings-tab-profile");
    if (tab && !tab.classList.contains("hidden") && typeof renderPeActivity === "function") {
      renderPeActivity(draftPreviewUser());
    }
  });
}
