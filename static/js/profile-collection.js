// Coleção privada e prévia usando as mesmas camadas do editor de perfil.
const collectionKinds = {
  avatar_decoration: { field: "avatar_decoration", label: "Decoração" },
  profile_frame: { field: "profile_frame", label: "Moldura" },
  profile_effect: { field: "profile_effect", label: "Efeito" },
  nameplate: { field: "nameplate_style", label: "Placa de nome" },
  name_style: { field: "name_style", label: "Estilo de nome" },
};
const collectionAppearanceFields = [
  ...Object.values(collectionKinds).map(kind => kind.field),
  "name_color", "name_color_secondary", "name_gradient_direction",
  "theme_primary", "theme_accent", "theme_highlight", "theme_mode", "theme_direction",
];
const collectionToggle = document.getElementById("open-profile-collection");
const collectionPanel = document.getElementById("profile-collection-panel");
const collectionStatus = document.getElementById("collection-status");
const collectionCategory = document.getElementById("collection-category");
const collectionSet = document.getElementById("collection-set");
const collectionFavorites = document.getElementById("collection-favorites");
const collectionItems = document.getElementById("collection-items");
const collectionSeenAll = document.getElementById("collection-seen-all");
const collectionRandom = document.getElementById("collection-random");
const collectionPreview = document.getElementById("collection-preview");
const collectionPreviewTitle = document.getElementById("collection-preview-title");
const collectionUse = document.getElementById("collection-use-look");
const collectionEffect = document.getElementById("collection-effect-layer");
const collectionPresets = document.getElementById("collection-presets");
const collectionSavePreset = document.getElementById("collection-save-preset");
let collectionOwner = null;
let collectionPreferences;
let collectionLook = null;

function profileAppearanceForWire(profile) {
  return Object.fromEntries(collectionAppearanceFields.map(field => [field, profile[field] || null]));
}

function onCosmeticCollectionUpdated(collection) {
  collectionPreferences = {
    favorites: new Set(collection?.favorites || []),
    seen: new Set(collection?.seen || []),
    presets: collection?.presets || [],
  };
  if (state.cosmetics.loaded) collectionStatus.textContent = "";
  renderCollectionInventory();
  renderCollectionPresets();
}

function resetCollectionOnAccountChange() {
  const owner = state.selfUser?.username?.toLowerCase();
  if (collectionOwner === owner) return;
  collectionOwner = owner;
  state.cosmetics = { catalog: [], owned: new Set(), badges: [], loaded: false };
  collectionPanel.classList.add("hidden");
  collectionToggle.setAttribute("aria-expanded", "false");
  collectionCategory.value = "all";
  collectionFavorites.checked = false;
  closeCollectionPreview();
  collectionItems.replaceChildren();
  collectionPresets.replaceChildren();
  onCosmeticCollectionUpdated();
}

function collectionCommand(type, payload) {
  if (!sendWs(type, payload)) {
    collectionStatus.textContent = "Conecte-se para atualizar sua coleção.";
    return false;
  }
  return true;
}

function collectionText(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function collectionButton(text, label, onClick) {
  const button = collectionText("button", text, "btn-secondary small-btn");
  button.type = "button";
  if (label) button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function cosmeticKey(item) {
  return `${item.kind}:${item.id}`;
}

function ownedCollectionItems() {
  if (!state.cosmetics.loaded) return [];
  return state.cosmetics.catalog.filter(item => Object.hasOwn(collectionKinds, item.kind) && state.cosmetics.owned.has(cosmeticKey(item)));
}

function renderCollectionInventory() {
  if (collectionPanel.classList.contains("hidden")) return;
  const owned = ownedCollectionItems();
  const { favorites, seen } = collectionPreferences;
  const active = collectionItems.contains(document.activeElement) ? document.activeElement.dataset : null;
  const scroll = collectionItems.scrollTop;
  const activeSet = collectionSet.value;
  const groups = new Map();
  for (const item of owned) {
    if (!groups.has(item.collection)) groups.set(item.collection, []);
    groups.get(item.collection).push(item);
  }
  collectionSet.replaceChildren(new Option("Todas as coleções", "all"));
  for (const group of groups.keys()) collectionSet.add(new Option(COLLECTION_LABELS[group] || group, group));
  collectionSet.value = groups.has(activeSet) ? activeSet : "all";

  const content = document.createDocumentFragment();
  for (const [group, items] of groups) {
    if (collectionSet.value !== "all" && collectionSet.value !== group) continue;
    const matching = items.filter(item => (collectionCategory.value === "all" || item.kind === collectionCategory.value) &&
      (!collectionFavorites.checked || favorites.has(cosmeticKey(item))));
    if (!matching.length) continue;
    const section = document.createElement("section");
    section.className = "collection-group";
    section.append(collectionText("h4", COLLECTION_LABELS[group] || group));
    for (const item of matching) {
      const key = cosmeticKey(item);
      const title = collectionText("span", item.name);
      const equipped = state.selfUser?.[collectionKinds[item.kind].field] === item.id;
      const labels = [collectionKinds[item.kind].label];
      if (equipped) labels.push("Equipado");
      if (!seen.has(key)) labels.push("Novo");
      const preview = collectionButton("", null, () => {
        const appearance = profileAppearanceForWire(profileDraft);
        appearance[collectionKinds[item.kind].field] = item.id;
        showCollectionPreview({ item, appearance });
        if (!seen.has(key)) collectionCommand("MarkCosmeticsSeen", { key });
      });
      preview.className = "collection-item-preview";
      preview.dataset.key = key;
      preview.dataset.action = "preview";
      preview.append(title, collectionText("small", labels.join(" · ")));
      const favorite = favorites.has(key);
      const star = collectionButton(favorite ? "★" : "☆", `Favorito: ${item.name}`, () => {
        collectionCommand("SetCosmeticFavorite", { key, favorite: !favorite });
      });
      star.classList.add("collection-star");
      star.dataset.key = key;
      star.dataset.action = "favorite";
      star.setAttribute("aria-pressed", String(favorite));
      const row = document.createElement("div");
      row.className = "collection-item";
      row.append(preview, star);
      section.append(row);
    }
    content.append(section);
  }
  if (!content.childElementCount) {
    content.append(collectionText("p", state.cosmetics.loaded ? "Nenhum item para esses filtros." : "Aguardando catálogo…", "pinned-empty"));
  }
  collectionItems.replaceChildren(content);
  collectionItems.scrollTop = scroll;
  if (active?.key) {
    const replacement = [...collectionItems.querySelectorAll("button")].find(button =>
      button.dataset.key === active.key && button.dataset.action === active.action);
    (replacement || collectionItems).focus({ preventScroll: true });
  }
  collectionSeenAll.disabled = owned.every(item => seen.has(cosmeticKey(item)));
  collectionRandom.disabled = owned.length === 0;
  if (collectionLook) {
    collectionUse.disabled = !ownsCollectionAppearance(collectionLook.appearance);
  }
}

function ownsCollectionAppearance(appearance) {
  return state.cosmetics.loaded && Object.entries(collectionKinds).every(([kind, { field }]) =>
    ownsCosmetic(kind, appearance[field]));
}

function showCollectionPreview(look) {
  collectionLook = look;
  const user = { ...draftPreviewUser(), ...look.appearance };
  const card = document.getElementById("collection-preview-card");
  const avatar = document.getElementById("collection-preview-avatar");
  avatar.style.background = user.avatar_color || "#5865f2";
  avatar.innerHTML = renderAvatarInner(user.username, user.avatar_url, user.avatar_animated);
  const name = document.getElementById("collection-preview-name");
  name.textContent = user.display_name || user.username || "Você";
  applyProfileCardVisuals(card, document.getElementById("collection-preview-banner"), collectionEffect,
    document.getElementById("collection-preview-deco"), name, user);
  applyProfileFrame(card, user.profile_frame);
  setFrameReactiveState(card, user);
  collectionPreviewTitle.textContent = look.item ? look.item.name : "Prévia da combinação";
  document.getElementById("collection-preview-items").textContent = Object.entries(collectionKinds)
    .map(([kind, { field }]) => cosmeticInfo(kind, look.appearance[field])?.name)
    .filter(Boolean).join(" · ");
  collectionUse.textContent = look.item ? "Usar no editor" : "Aplicar combinação";
  collectionUse.disabled = !ownsCollectionAppearance(look.appearance);
  collectionPreview.classList.remove("hidden");
  collectionPreviewTitle.focus();
  refreshAnimatedMedia(card);
}

function closeCollectionPreview(restoreFocus = false) {
  collectionLook = null;
  collectionPreview.classList.add("hidden");
  stopProfileEffect(collectionEffect);
  if (restoreFocus) collectionRandom.focus();
}

function randomizeCollectionLook() {
  const owned = ownedCollectionItems();
  if (!owned.length) return;
  const appearance = profileAppearanceForWire(profileDraft);
  for (const [kind, { field }] of Object.entries(collectionKinds)) {
    const pool = owned.filter(item => item.kind === kind);
    const alternatives = pool.filter(item => item.id !== appearance[field]);
    const candidates = alternatives.length ? alternatives : pool;
    appearance[field] = candidates[Math.floor(Math.random() * candidates.length)]?.id ?? null;
  }
  showCollectionPreview({ appearance });
}

function renderCollectionPresets() {
  if (collectionPanel.classList.contains("hidden")) return;
  const { presets } = collectionPreferences;
  collectionSavePreset.disabled = !state.cosmetics.loaded || presets.length >= 12;
  collectionPresets.replaceChildren();
  if (!presets.length) collectionPresets.append(collectionText("li", "Nenhum preset salvo.", "settings-hint-text"));
  for (const preset of presets) {
    const row = document.createElement("li");
    row.className = "collection-preset";
    const apply = collectionButton("Aplicar", `Aplicar preset ${preset.name}`, () => {
      collectionCommand("EquipProfileLook", { choice: { kind: "preset", id: preset.id } });
    });
    apply.disabled = !ownsCollectionAppearance(preset.appearance);
    if (apply.disabled) apply.title = "Este preset usa itens indisponíveis.";
    const remove = collectionButton("Excluir", `Excluir preset ${preset.name}`, async () => {
      const confirmed = await SancordUI.confirm({ title: `Excluir ${preset.name}?`, confirmLabel: "Excluir preset", danger: true });
      if (confirmed) collectionCommand("DeleteProfilePreset", { id: preset.id });
    });
    row.append(collectionText("span", preset.name), apply, remove);
    collectionPresets.append(row);
  }
}

function onProfileLookApplied(appearance) {
  if (!state.selfUser || !appearance) return;
  const equipped = profileAppearanceForWire(appearance);
  Object.assign(state.selfUser, equipped);
  loadAppearanceDraft(state.selfUser);
  updateSelfProfileUI();
  refreshLiveProfilePreview();
  closeCollectionPreview();
  renderCollectionInventory();
  collectionStatus.textContent = "Visual aplicado.";
}

onCosmeticCollectionUpdated();
collectionToggle.addEventListener("click", () => {
  const open = !collectionPanel.classList.toggle("hidden");
  collectionToggle.setAttribute("aria-expanded", String(open));
  if (open) {
    renderCollectionInventory();
    renderCollectionPresets();
  } else {
    closeCollectionPreview();
  }
});
for (const input of [collectionFavorites, collectionCategory, collectionSet]) {
  input.addEventListener("change", renderCollectionInventory);
}
collectionSeenAll.addEventListener("click", () => collectionCommand("MarkCosmeticsSeen", {}));
collectionRandom.addEventListener("click", randomizeCollectionLook);
document.getElementById("collection-dismiss-look").addEventListener("click", () => closeCollectionPreview(true));
collectionUse.addEventListener("click", () => {
  if (!collectionLook || !ownsCollectionAppearance(collectionLook.appearance)) return;
  const { item, appearance } = collectionLook;
  if (!item) {
    collectionCommand("EquipProfileLook", { choice: { kind: "custom", appearance } });
    return;
  }
  profileDraft[collectionKinds[item.kind].field] = item.id;
  loadAppearanceDraft({ ...state.selfUser, ...profileDraft });
  refreshLiveProfilePreview();
  closeCollectionPreview(true);
  collectionStatus.textContent = "Item no editor. Salve as alterações do perfil para equipá-lo.";
});
collectionSavePreset.addEventListener("click", async () => {
  const appearance = profileAppearanceForWire(profileDraft);
  const values = await SancordUI.formDialog({
    title: "Salvar visual como preset",
    fields: [{ name: "name", label: "Nome do preset", maxlength: 32, required: true }],
  });
  if (values) collectionCommand("SaveProfilePreset", { name: values.name.trim(), appearance });
});
