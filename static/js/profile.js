// ============================================================================
// Sancord — Perfil (Fase P1)
//   • Catálogo de cosméticos e posse (vêm do servidor: CosmeticsState)
//   • Mídia do perfil: avatar/banner enviados como anexo + SetProfileMedia
//   • Política de animação (avatar/banner GIF): sempre, só no hover, nunca
//   • Tema do perfil: sólido ou gradiente (4 direções), destaque e contraste
//   • Bio em markdown seguro e prévia em contextos (popout, chat, membros, DM)
// Depende de globais do app.js/chat.js (state, sendWs, renderMarkdown...).
// ============================================================================

state.cosmetics = state.cosmetics || {
  catalog: [],
  owned: new Set(),
  badges: [],
  ownedBadges: null,
  badgeOrder: [],
  hiddenBadges: [],
  maxVisibleBadges: 6,
  loaded: false,
};

function onCosmeticsState({ catalog, owned, badges, owned_badges, badge_order, hidden_badges, max_visible_badges, collection }) {
  const prevDirty = typeof isProfileFieldsDirty === "function" && isProfileFieldsDirty();
  state.cosmetics = {
    catalog: catalog || [],
    owned: new Set(owned || []),
    badges: badges || [],
    ownedBadges: Array.isArray(owned_badges) ? [...owned_badges] : null,
    badgeOrder: Array.isArray(badge_order) ? [...badge_order] : [],
    hiddenBadges: Array.isArray(hidden_badges) ? [...hidden_badges] : [],
    maxVisibleBadges: Number(max_visible_badges) > 0 ? Number(max_visible_badges) : 6,
    loaded: true,
  };
  if (typeof profileDraft !== "undefined" && !prevDirty) {
    profileDraft.badge_order = [...state.cosmetics.badgeOrder];
    profileDraft.hidden_badges = [...state.cosmetics.hiddenBadges];
  }
  syncNameStyleOptions();
  if (typeof renderPeBadgesEditor === "function" && typeof peView !== "undefined" && peView === "badges") {
    renderPeBadgesEditor();
  }
  if (typeof refreshLiveProfilePreview === "function") refreshLiveProfilePreview();
  onCosmeticCollectionUpdated(collection);
}

/** A conta possui o item? Antes do catálogo chegar, não esconde nada (o servidor valida). */
function ownsCosmetic(kind, id) {
  if (!id || id === "none" || id === "default") return true;
  if (!state.cosmetics?.loaded) return true;
  if (kind === "name_style" && id.includes("+")) {
    if (id === "default+default") return true;
    const { font, effect } = profileNameParts(id);
    return font !== "default" && effect !== "default" && composeProfileNameStyle(font, effect) === id &&
      ownsCosmetic(kind, font) && ownsCosmetic(kind, effect);
  }
  return state.cosmetics.owned.has(`${kind}:${id}`);
}

function cosmeticInfo(kind, id) {
  return (state.cosmetics?.catalog || []).find((i) => i.kind === kind && i.id === id) || null;
}

// ---------------------------------------------------------------------------
// Política de animação de avatar/banner animados (GIF)
// ---------------------------------------------------------------------------
const PROFILE_ANIM_POLICIES = ["always", "hover", "never"];

function systemPrefersReducedMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (_) {
    return false;
  }
}

function effectiveReduceMotion() {
  if (state.audioSettings?.reduceMotion) return true;
  if (state.audioSettings?.syncReducedMotion && systemPrefersReducedMotion()) return true;
  return false;
}

/** "Reduzir animações" (do app ou sincronizado com o Windows quando ativado) sempre vence. */
function profileAnimPolicy() {
  if (effectiveReduceMotion() || state.audioSettings?.showProfileAnimations === false) return "never";
  const p = state.audioSettings?.profileAnimations;
  return PROFILE_ANIM_POLICIES.includes(p) ? p : "hover";
}

function isAnimatedMediaUrl(url) {
  const u = String(url || "");
  return /^data:image\/gif/i.test(u) || /\.gif(?:$|[?#])/i.test(u);
}

function applyProfileAnimPolicy() {
  const p = profileAnimPolicy();
  for (const k of PROFILE_ANIM_POLICIES) document.body.classList.toggle(`anim-policy-${k}`, p === k);
  if (p === "never") stopProfileEffect();
  updateProfileEffectButtons();
  const sel = document.getElementById("appearance-profile-animations");
  if (sel) {
    sel.value = PROFILE_ANIM_POLICIES.includes(state.audioSettings?.profileAnimations) ? state.audioSettings.profileAnimations : "hover";
    const reduced = effectiveReduceMotion();
    sel.disabled = reduced || state.audioSettings?.showProfileAnimations === false;
    sel.title = reduced ? "Reduzir animações está ativo no Sanvo." : "";
  }
  updateProfileMotion();
  if (typeof SancordCosmetics !== "undefined") SancordCosmetics.reconcileIdleBudget();
}

// Uma camada de efeito por vez. Re-renderizações do perfil preservam a execução atual.
const PROFILE_EFFECT_DURATION_MS = 1500;
let activeProfileEffect = null;

function configureProfileEffect(layer, id) {
  if (!layer) return;
  const resolved = typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.resolveCosmeticId === "function"
    ? SancordCosmetics.resolveCosmeticId("profile_effect", id)
    : id;
  const isKnown = Boolean(
    id && id !== "none" && (
      PROFILE_EFFECTS.some(item => item.id === id) ||
      (resolved && PROFILE_EFFECTS.some(item => item.id === resolved))
    )
  );
  const effect = isKnown ? id : "";
  if (layer.dataset.profileEffect !== effect) {
    stopProfileEffect(layer);
    layer.dataset.profileEffect = effect;
    layer.innerHTML = profileEffectArt(effect);
  }
  updateProfileEffectButtons();
}

function updateProfileEffectButtons() {
  const reduced = profileAnimPolicy() === "never" || state.audioSettings?.showProfileEffects === false;
  document.querySelectorAll("[data-replay-profile-effect]").forEach(button => {
    const layer = document.getElementById(button.dataset.replayProfileEffect);
    button.disabled = reduced || !layer?.dataset.profileEffect;
    button.title = reduced ? "Animações de perfil desativadas." : button.disabled ? "Escolha um efeito." : "";
  });
  const editorReplay = document.getElementById("profile-preview-replay");
  if (editorReplay) {
    const effect = profileDraft.profile_effect;
    editorReplay.disabled = reduced || !effect || effect === "none";
  }
}

function stopProfileEffect(layer = activeProfileEffect?.layer) {
  const playing = activeProfileEffect;
  if (!playing || playing.layer !== layer) return;
  activeProfileEffect = null;
  clearTimeout(playing.timer);
  playing.observer.disconnect();
  layer.removeEventListener("animationend", playing.onEnd);
  layer.classList.remove("is-playing", `effect-${playing.id}`);
  if (typeof SancordCosmetics !== "undefined") SancordCosmetics.clearEffectTimeline(layer);
  playing.card.classList.remove("profile-effect-running");
}

function playProfileEffect(layer) {
  const id = layer?.dataset.profileEffect;
  const card = layer?.closest(".profile-card") || layer?.parentElement;
  if (!id || !card || !layer.isConnected || layer.closest(".hidden, [hidden]") ||
      !profileMotionAvailable() || state.audioSettings?.showProfileEffects === false) return false;
  stopProfileEffect();
  const onEnd = event => {
    if (event.target === layer && !event.pseudoElement && event.animationName === "profileEffectEntrance") stopProfileEffect(layer);
  };
  const observer = new MutationObserver(() => {
    if (layer.closest(".hidden, [hidden]")) stopProfileEffect(layer);
  });
  // Observa só os ancestrais desta camada, incluindo o separador de contexto e o modal.
  for (let el = card; el; el = el.parentElement) {
    observer.observe(el, { attributes: true, attributeFilter: ["class", "hidden"] });
  }
  const v3Duration = typeof SancordCosmetics !== "undefined" ? SancordCosmetics.getProfileEffectDuration(id) : null;
  const duration = v3Duration || profileCardArt.effect[id]?.duration || PROFILE_EFFECT_DURATION_MS;
  const timer = setTimeout(() => stopProfileEffect(layer), duration + 100);
  activeProfileEffect = { layer, card, id, timer, observer, onEnd };
  layer.style.setProperty("--profile-effect-duration", `${duration}ms`);
  // Recalcular o estilo após limpar a classe permite replay inclusive durante o efeito.
  void layer.offsetWidth;
  layer.addEventListener("animationend", onEnd);
  layer.classList.add("is-playing", `effect-${id}`);
  if (typeof SancordCosmetics !== "undefined") SancordCosmetics.startEffectTimeline(layer, id);
  card.classList.add("profile-effect-running");
  return true;
}

document.querySelectorAll("[data-replay-profile-effect]").forEach(button => {
  button.addEventListener("click", () => playProfileEffect(document.getElementById(button.dataset.replayProfileEffect)));
});
document.addEventListener("sanvo:visual-visibility", () => {
  if (isVisualWindowHidden()) stopProfileEffect();
});
window.addEventListener("blur", () => stopProfileEffect());
window.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener?.("change", () => {
  if (typeof applyReduceMotion === "function") applyReduceMotion();
  else applyProfileAnimPolicy();
});

document.getElementById("appearance-profile-animations")?.addEventListener("change", (e) => {
  state.audioSettings.profileAnimations = PROFILE_ANIM_POLICIES.includes(e.target.value) ? e.target.value : "hover";
  if (typeof saveAudioSettings === "function") saveAudioSettings();
  applyProfileAnimPolicy();
});
document.getElementById("appearance-reduce-motion")?.addEventListener("change", () => setTimeout(applyProfileAnimPolicy, 0));

const profileVisualToggles = {
  decorations: "showProfileDecorations",
  frames: "showProfileFrames",
  effects: "showProfileEffects",
  nameplates: "showProfileNameplates",
  animations: "showProfileAnimations",
};
const cosmeticMotionToggles = {
  decorations: "animateProfileDecorations",
  frames: "animateProfileFrames",
  names: "animateProfileNameStyles",
};
function applyProfileVisualSettings() {
  for (const [type, key] of Object.entries(profileVisualToggles)) {
    const visible = state.audioSettings[key] !== false;
    document.body.classList.toggle(`profile-hide-${type}`, !visible);
    const input = document.getElementById(`appearance-show-profile-${type}`);
    if (input) input.checked = visible;
  }
  for (const [type, key] of Object.entries(cosmeticMotionToggles)) {
    const animate = state.audioSettings[key] !== false;
    document.body.classList.toggle(`profile-static-${type}`, !animate);
    document.getElementById(`appearance-animate-profile-${type}`).checked = animate;
  }
  if (state.audioSettings.showProfileEffects === false) stopProfileEffect();
  applyProfileAnimPolicy();
}
for (const [type, key] of Object.entries(profileVisualToggles)) {
  document.getElementById(`appearance-show-profile-${type}`)?.addEventListener("change", e => {
    state.audioSettings[key] = e.target.checked;
    saveAudioSettings();
    applyProfileVisualSettings();
  });
}
for (const [type, key] of Object.entries(cosmeticMotionToggles)) {
  document.getElementById(`appearance-animate-profile-${type}`).addEventListener("change", e => {
    state.audioSettings[key] = e.target.checked;
    saveAudioSettings();
    applyProfileVisualSettings();
  });
}
applyProfileVisualSettings();

// ---------------------------------------------------------------------------
// Tema do perfil
// ---------------------------------------------------------------------------
const THEME_DIRECTIONS = {
  vertical: "180deg",
  horizontal: "90deg",
  diagonal: "135deg",
};

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Luminância relativa (WCAG) de 0 a 1. */
function colorLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Cores e modo do tema; perfis antigos (2 cores, sem modo) seguem como gradiente vertical. */
function profileTheme(u) {
  const primary = hexToRgb(u?.theme_primary) ? u.theme_primary : null;
  const secondary = hexToRgb(u?.theme_accent) ? u.theme_accent : null;
  const highlight = hexToRgb(u?.theme_highlight) ? u.theme_highlight : null;
  const mode = u?.theme_mode === "solid" ? "solid" : u?.theme_mode === "gradient" || (primary && secondary) ? "gradient" : "solid";
  const direction = ["vertical", "horizontal", "diagonal", "radial"].includes(u?.theme_direction) ? u.theme_direction : "vertical";
  return { primary, secondary, highlight, mode, direction };
}

/** Fundo CSS do cartão (ou null = fundo padrão do tema do app). Preparado para N cores. */
function profileThemeBackground(u) {
  const t = profileTheme(u);
  const stops = [t.primary, t.secondary].filter(Boolean);
  if (!stops.length) return null;
  if (t.mode === "solid" || stops.length === 1) return stops[0];
  if (t.direction === "radial") return `radial-gradient(circle at 30% 20%, ${stops.join(", ")})`;
  return `linear-gradient(${THEME_DIRECTIONS[t.direction]}, ${stops.join(", ")})`;
}

/** Texto escuro sobre fundos claros (contraste automático). */
function profileTextTone(u) {
  const t = profileTheme(u);
  const colors = (t.mode === "solid" ? [t.primary] : [t.primary, t.secondary]).filter(Boolean);
  if (!colors.length) return "auto";
  const lum = colors.map(colorLuminance).filter((v) => v !== null);
  const avg = lum.reduce((a, b) => a + b, 0) / lum.length;
  return avg > 0.45 ? "dark" : "light";
}

function applyProfileTheme(cardEl, u) {
  if (!cardEl) return;
  const t = profileTheme(u);
  const bg = profileThemeBackground(u);
  cardEl.style.background = bg || "var(--bg-floating)";
  if (t.primary) cardEl.style.setProperty("--profile-surface", t.primary);
  else cardEl.style.removeProperty("--profile-surface");
  const tone = profileTextTone(u);
  cardEl.classList.toggle("profile-text-dark", tone === "dark");
  cardEl.classList.toggle("profile-text-light", tone === "light");
  const hl = t.highlight;
  if (hl) cardEl.style.setProperty("--profile-highlight", hl);
  else cardEl.style.removeProperty("--profile-highlight");
}

/** Banner como <img> (permite quadro parado para GIF) sobre a cor do tema. */
function setProfileBanner(bannerEl, u, overrideUrl) {
  if (!bannerEl) return;
  const url = overrideUrl !== undefined ? overrideUrl : u?.banner_url;
  bannerEl.style.backgroundImage = "";
  bannerEl.style.backgroundColor = profileTheme(u).primary || u?.avatar_color || "var(--brand)";
  const old = bannerEl.querySelector(":scope > .profile-banner-img");
  const src = url ? cachedMediaUrl(url) : "";
  if (!src) {
    old?.remove();
    return;
  }
  const animated = u?.banner_animated || isAnimatedMediaUrl(url);
  if (old && (animated ? old.dataset.profileSrc : old.getAttribute("src")) === src) return;
  old?.remove();
  const img = document.createElement("img");
  img.className = "profile-banner-img";
  img.alt = "";
  img.decoding = "async";
  if (animated) {
    img.dataset.anim = "1";
    img.dataset.profileSrc = src;
  } else {
    img.src = src;
  }
  bannerEl.prepend(img);
}

// ---------------------------------------------------------------------------
// Bio (markdown seguro: o texto é escapado antes; sem HTML do usuário)
// ---------------------------------------------------------------------------
const PROFILE_BIO_MAX = 300;

function renderProfileBio(el, text, empty = "Nenhuma biografia definida.") {
  if (!el) return;
  const bio = String(text || "").trim();
  if (!bio) {
    el.textContent = empty;
    el.classList.add("is-empty");
    return;
  }
  el.classList.remove("is-empty");
  el.innerHTML = typeof renderMarkdown === "function" ? renderMarkdown(bio, null) : "";
  if (typeof renderMarkdown !== "function") el.textContent = bio;
}

function updateBioCounter() {
  const input = document.getElementById("settings-bio-input");
  const counter = document.getElementById("settings-bio-counter");
  if (!input || !counter) return;
  const n = [...input.value].length;
  counter.textContent = `${n} / ${PROFILE_BIO_MAX}`;
  counter.classList.toggle("near-limit", n >= PROFILE_BIO_MAX - 20);
}

// ---------------------------------------------------------------------------
// Mídia do perfil (avatar/banner) + Avatares Predefinidos Pintados V5
// ---------------------------------------------------------------------------
const SANVO_PRESET_AVATARS = [
  { id: "kitsune",  name: "Kitsune Cyber",       collection: "Holográfico & Cyber", url: "/cosmetics/assets/preset_avatar_kitsune.webp" },
  { id: "astral",   name: "Guardião Astral",     collection: "Astral & Cósmico",    url: "/cosmetics/assets/preset_avatar_astral.webp" },
  { id: "sakura",   name: "Espírito Hanami",     collection: "Sakura & Floral",     url: "/cosmetics/assets/preset_avatar_sakura.webp" },
  { id: "frost",    name: "Drakon Glacial",      collection: "Gelo & Cristal",      url: "/cosmetics/assets/preset_avatar_frost.webp" },
  { id: "infernal", name: "Fênix Dracônica",     collection: "Forja Dracônica",     url: "/cosmetics/assets/preset_avatar_infernal.webp" },
  { id: "arcane",   name: "Oráculo do Eclipse",  collection: "Magia & Arcano",      url: "/cosmetics/assets/preset_avatar_arcane.webp" },
  { id: "abyssal",  name: "Guardião Abissal",    collection: "Abissal & Oceânico",  url: "/cosmetics/assets/preset_avatar_abyssal.webp" },
  { id: "seraph",   name: "Valquíria Celestial", collection: "Celestial & Serafim", url: "/cosmetics/assets/preset_avatar_seraph.webp" },
  { id: "dream",    name: "Borboleta Onírica",   collection: "Bosque Onírico",      url: "/cosmetics/assets/preset_avatar_dream.webp" },
  { id: "storm",    name: "Lobo Raijin",         collection: "Templo do Trovão",    url: "/cosmetics/assets/preset_avatar_storm.webp" },
  { id: "arcade",   name: "Pixel-Bot 16-Bit",    collection: "Horizonte Arcade",    url: "/cosmetics/assets/preset_avatar_arcade.webp" },
  { id: "jade",     name: "Lótus de Jade",       collection: "Lagoa de Jade",       url: "/cosmetics/assets/preset_avatar_jade.webp" },
];

function findPresetAvatar(idOrUrl) {
  if (!idOrUrl) return null;
  const str = String(idOrUrl);
  return SANVO_PRESET_AVATARS.find((p) => p.id === str || p.url === str || str.includes(`preset_avatar_${p.id}.webp`)) || null;
}

async function fetchPresetAvatarBlob(preset) {
  const res = await fetch(preset.url);
  if (!res.ok) throw new Error(`Não foi possível carregar o avatar predefinido (${res.status}).`);
  return res.blob();
}
async function uploadProfileImage(blob, filename) {
  const res = await SancordNet.fetch(`/api/attachments?filename=${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getStoredToken() || ""}`, "Content-Type": "application/octet-stream" },
    body: blob,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.message || `Falha no envio (${res.status}).`);
  return data.attachment.id;
}

/** Envia e aplica (avatar/banner); `blob` nulo remove e volta ao padrão. */
async function applyProfileMedia(kind, blob, filename) {
  if (!blob) {
    sendWs("SetProfileMedia", { kind });
    return true;
  }
  const id = await uploadProfileImage(blob, filename);
  sendWs("SetProfileMedia", { kind, attachment_id: id });
  return true;
}

function serverMemberProfile(server, username) {
  const profiles = server?.member_profiles;
  const lower = username?.toLowerCase();
  return profiles && Object.hasOwn(profiles, lower) ? profiles[lower] : null;
}

const SERVER_PROFILE_OVERRIDE_FIELDS = [
  "avatar_decoration",
  "profile_frame",
  "profile_effect",
  "nameplate_style",
  "name_style",
  "name_color",
  "name_color_secondary",
  "name_gradient_direction",
  "theme_primary",
  "theme_accent",
  "theme_highlight",
  "theme_mode",
  "theme_direction",
];

function resolveServerProfile(server, username, globalProfile) {
  return mergeServerProfile(globalProfile, serverMemberProfile(server, username));
}

function mergeServerProfile(globalProfile, local) {
  if (!local) return globalProfile;
  const user = { ...(globalProfile || {}) };
  if (local.avatar) {
    user.avatar_url = local.avatar.url;
    user.avatar_animated = local.avatar.animated;
  }
  if (local.banner) {
    user.banner_url = local.banner.url;
    user.banner_animated = local.banner.animated;
  }
  if (local.bio != null) user.bio = local.bio;
  for (const field of SERVER_PROFILE_OVERRIDE_FIELDS) {
    if (local[field] != null) user[field] = local[field];
  }
  return user;
}

function serverCosmeticOptions(kind, current) {
  const opts = [{ value: "", label: "Usar do perfil global" }];
  const catalog = (state.cosmetics?.catalog || []).filter(
    (item) => item.kind === kind && (ownsCosmetic(kind, item.id) || item.id === current)
  );
  const seen = new Set([""]);
  for (const item of catalog) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    opts.push({ value: item.id, label: item.name });
  }
  if (current && !seen.has(current)) {
    opts.push({ value: current, label: current });
  }
  return opts;
}

async function openServerProfileDialog(serverId) {
  const srv = state.servers.find(s => s.id === serverId);
  const username = state.selfUser?.username;
  if (!srv || srv.id === "sancord" || !username) return;
  const local = serverMemberProfile(srv, username);
  const bio = local?.bio || "";
  const media = [
    { kind: "avatar", label: "Avatar", limit: MAX_AVATAR_GIF_BYTES, maxMB: 6 },
    { kind: "banner", label: "Banner", limit: MAX_BANNER_BYTES, maxMB: 8 },
  ];
  const cosmeticFields = [
    { name: "avatar_decoration", kind: "avatar_decoration", label: "Decoração de avatar" },
    { name: "profile_frame", kind: "profile_frame", label: "Moldura de perfil" },
    { name: "profile_effect", kind: "profile_effect", label: "Efeito de perfil" },
    { name: "nameplate_style", kind: "nameplate", label: "Placa de nome" },
  ];
  const nameParts = profileNameParts(local?.name_style || state.selfUser.name_style);
  const nameStyleItems = serverCosmeticOptions("name_style", "").slice(1);
  const fontOptions = [{ value: "default", label: "Padrão" }, ...nameStyleItems.filter(({ value }) => PROFILE_NAME_FONTS.has(value))];
  const effectOptions = [{ value: "default", label: "Sólido" }, ...nameStyleItems.filter(({ value }) => !PROFILE_NAME_FONTS.has(value))];
  if (!fontOptions.some(({ value }) => value === nameParts.font)) fontOptions.push({ value: nameParts.font, label: nameParts.font });
  if (!effectOptions.some(({ value }) => value === nameParts.effect)) effectOptions.push({ value: nameParts.effect, label: nameParts.effect });
  const usesNameGradient = values => (values.name_style_mode === "custom" ? values.name_effect : profileNameParts(state.selfUser.name_style).effect) === "custom-gradient";
  const hasNameColors = Boolean(local?.name_color || local?.name_color_secondary || local?.name_gradient_direction);
  const hasTheme = Boolean(local?.theme_primary || local?.theme_accent || local?.theme_highlight || local?.theme_mode || local?.theme_direction);
  const directionOptions = [
    { value: "vertical", label: "Vertical" },
    { value: "horizontal", label: "Horizontal" },
    { value: "diagonal", label: "Diagonal" },
    { value: "radial", label: "Radial" },
  ];
  const preview = document.createElement("aside");
  preview.className = "compact-profile-preview profile-card server-profile-dialog-preview";
  preview.setAttribute("aria-label", "Prévia do perfil neste servidor");
  const mediaPreviews = new Map();
  function draftOverrides(values) {
    const overrides = Object.fromEntries(SERVER_PROFILE_OVERRIDE_FIELDS.map(field => [field, null]));
    overrides.bio = values.bio.trim() || null;
    for (const { name } of cosmeticFields) overrides[name] = values[name] || null;
    if (values.name_style_mode === "custom") {
      const style = composeProfileNameStyle(values.name_font, values.name_effect);
      overrides.name_style = style === "default" ? "default+default" : style;
    }
    if (values.name_color_mode === "custom") {
      overrides.name_color = values.name_color;
      if (usesNameGradient(values)) {
        overrides.name_color_secondary = values.name_color_secondary;
        overrides.name_gradient_direction = values.name_gradient_direction;
      }
    }
    if (values.theme_override === "custom") {
      overrides.theme_mode = values.theme_mode;
      overrides.theme_primary = values.theme_primary;
      overrides.theme_highlight = values.theme_highlight;
      if (values.theme_mode === "gradient") {
        overrides.theme_accent = values.theme_accent;
        overrides.theme_direction = values.theme_direction;
      }
    }
    return overrides;
  }
  const values = await SancordUI.formDialog({
    title: "Editar perfil do servidor",
    description: `Personalize como seu perfil aparece em ${srv.name}. Campos sem personalização usam seu perfil global.`,
    preview,
    onPreview(form) {
      const overrides = draftOverrides(form);
      for (const { kind, limit } of media) {
        const file = form[kind] === "upload" ? form[`${kind}_file`] : null;
        const previous = mediaPreviews.get(kind);
        if (previous && previous.file !== file) {
          URL.revokeObjectURL(previous.url);
          mediaPreviews.delete(kind);
        }
        if (file && file.size <= limit && typeof URL.createObjectURL === "function" && !mediaPreviews.has(kind)) {
          mediaPreviews.set(kind, { file, url: URL.createObjectURL(file), animated: file.type === "image/gif" });
        }
        if (form[kind] === "keep") overrides[kind] = local?.[kind];
        else if (form[kind] === "preset" && kind === "avatar") {
          const p = findPresetAvatar(form.avatar_preset) || SANVO_PRESET_AVATARS[0];
          overrides.avatar = { url: p.url, animated: false };
        }
        else if (form[kind] === "upload") overrides[kind] = mediaPreviews.get(kind);
      }
      const profile = mergeServerProfile(state.selfUser, overrides);
      const name = memberNickname(srv, username) || profile.display_name || username;
      renderCompactProfile(preview, profile, name, username, true);
      fillCompactProfileDetails(preview, getUserServerRoles(srv, username));
    },
    fields: [
      { name: "bio", label: "Bio", type: "textarea", value: bio, rows: 3, maxlength: 300, placeholder: "Usar a bio do perfil global", hint: "Apague o texto para voltar a usar a bio global." },
      ...media.flatMap(({ kind, label, maxMB }) => [
        { name: kind, label, type: "select", value: "keep", options: [
          { value: "keep", label: local?.[kind] ? "Manter imagem deste servidor" : "Usar imagem do perfil global" },
          ...(kind === "avatar" ? [{ value: "preset", label: "Escolher um avatar predefinido" }] : []),
          { value: "upload", label: "Enviar uma imagem para este servidor" },
          ...(local?.[kind] ? [{ value: "inherit", label: "Voltar a usar imagem do perfil global" }] : []),
        ] },
        ...(kind === "avatar" ? [{
          name: "avatar_preset",
          label: "Avatar predefinido",
          type: "select",
          value: SANVO_PRESET_AVATARS[0].id,
          options: SANVO_PRESET_AVATARS.map((p) => ({ value: p.id, label: `${p.name} (${p.collection})` })),
          visibleWhen: (v) => v.avatar === "preset",
        }] : []),
        { name: `${kind}_file`, label: `Arquivo de ${label.toLowerCase()}`, type: "file", required: true,
          accept: "image/png,image/jpeg,image/webp,image/gif", hint: `PNG, JPG, WebP ou GIF. Até ${maxMB} MB.`,
          visibleWhen: (v) => v[kind] === "upload" },
      ]),
      ...cosmeticFields.map(({ name, kind, label }) => ({
        name,
        label,
        type: "select",
        value: local?.[name] || "",
        options: serverCosmeticOptions(kind, local?.[name] || ""),
      })),
      { name: "name_style_mode", label: "Estilo do nome neste servidor", type: "select", value: local?.name_style ? "custom" : "inherit", options: [
        { value: "inherit", label: "Usar estilo do perfil global" },
        { value: "custom", label: "Personalizar estilo neste servidor" },
      ] },
      { name: "name_font", label: "Fonte", type: "select", value: nameParts.font, options: fontOptions, visibleWhen: v => v.name_style_mode === "custom" },
      { name: "name_effect", label: "Efeito do nome", type: "select", value: nameParts.effect, options: effectOptions, visibleWhen: v => v.name_style_mode === "custom" },
      { name: "name_color_mode", label: "Cor do nome neste servidor", type: "select", value: hasNameColors ? "custom" : "inherit", options: [
        { value: "inherit", label: "Usar cor do perfil global" },
        { value: "custom", label: "Personalizar cor neste servidor" },
      ] },
      { name: "name_color", label: "Cor principal do nome", type: "color", value: local?.name_color || state.selfUser?.name_color || "#ffffff", visibleWhen: (v) => v.name_color_mode === "custom" },
      { name: "name_color_secondary", label: "Segunda cor do nome (gradiente)", type: "color", value: local?.name_color_secondary || state.selfUser?.name_color_secondary || "#5865f2", visibleWhen: v => v.name_color_mode === "custom" && usesNameGradient(v) },
      { name: "name_gradient_direction", label: "Direção do gradiente do nome", type: "select", value: local?.name_gradient_direction || state.selfUser?.name_gradient_direction || "horizontal", options: directionOptions, visibleWhen: v => v.name_color_mode === "custom" && usesNameGradient(v) },
      { name: "theme_override", label: "Tema do cartão neste servidor", type: "select", value: hasTheme ? "custom" : "inherit", options: [
        { value: "inherit", label: "Usar tema do perfil global" },
        { value: "custom", label: "Personalizar tema neste servidor" },
      ] },
      { name: "theme_mode", label: "Modo do tema", type: "select", value: local?.theme_mode || state.selfUser?.theme_mode || "gradient", options: [
        { value: "gradient", label: "Gradiente" },
        { value: "solid", label: "Sólido" },
      ], visibleWhen: (v) => v.theme_override === "custom" },
      { name: "theme_primary", label: "Cor primária do cartão", type: "color", value: local?.theme_primary || state.selfUser?.theme_primary || "#2b2d31", visibleWhen: (v) => v.theme_override === "custom" },
      { name: "theme_accent", label: "Cor secundária do cartão", type: "color", value: local?.theme_accent || state.selfUser?.theme_accent || "#5865f2", visibleWhen: (v) => v.theme_override === "custom" && v.theme_mode !== "solid" },
      { name: "theme_highlight", label: "Cor de destaque", type: "color", value: local?.theme_highlight || state.selfUser?.theme_highlight || "#5865f2", visibleWhen: (v) => v.theme_override === "custom" },
      { name: "theme_direction", label: "Direção do gradiente do tema", type: "select", value: local?.theme_direction || state.selfUser?.theme_direction || "vertical", options: directionOptions, visibleWhen: (v) => v.theme_override === "custom" && v.theme_mode !== "solid" },
    ],
  }).finally(() => {
    for (const { url } of mediaPreviews.values()) URL.revokeObjectURL(url);
  });
  if (!values) return;
  const changes = {};
  for (const [field, value] of Object.entries(draftOverrides(values))) {
    if ((value || "") !== (local?.[field] || "")) changes[field] = value || "";
  }
  for (const { kind, label, limit, maxMB } of media) {
    if (values[kind] === "upload" && values[`${kind}_file`].size > limit) {
      showErrorToast(`${label}: selecione uma imagem de até ${maxMB} MB.`);
      return;
    }
  }
  try {
    const uploads = media.filter(({ kind }) => values[kind] === "upload");
    if (uploads.length || values.avatar === "preset") showUiToast("Enviando imagens do perfil…");
    if (values.avatar === "preset") {
      const p = findPresetAvatar(values.avatar_preset) || SANVO_PRESET_AVATARS[0];
      const blob = await fetchPresetAvatarBlob(p);
      changes.avatar_attachment_id = await uploadProfileImage(blob, `preset_avatar_${p.id}.webp`);
    }
    for (const { kind } of uploads) {
      const file = values[`${kind}_file`];
      changes[`${kind}_attachment_id`] = await uploadProfileImage(file, file.name);
    }
    for (const { kind } of media) {
      if (values[kind] === "inherit") changes[`${kind}_attachment_id`] = "";
    }
    if (Object.keys(changes).length && !sendWs("SetServerProfile", { server_id: serverId, ...changes })) {
      showErrorToast("Sem conexão para salvar o perfil do servidor.");
    }
  } catch (err) {
    showErrorToast(err.message || "Não foi possível enviar a imagem.");
  }
}

// ---------------------------------------------------------------------------
// Prévia em contextos (popout, chat, lista de membros, DM)
// ---------------------------------------------------------------------------
let profilePreviewContext = "compact";

function draftPreviewUser() {
  const u = state.selfUser || {};
  const media = (typeof profileDraft !== "undefined" && profileDraft.media) || {};
  const pick = (k, field) => (media[k] === "remove" ? null : media[k]?.url || u[field]);
  const socials = collectSocialProfileFields();
  const ownedBadges = typeof getOwnedBadgesList === "function" ? getOwnedBadgesList() : (u.badges || []);
  const previewBadges = typeof computeVisibleBadges === "function" && typeof profileDraft !== "undefined"
    ? computeVisibleBadges(ownedBadges, profileDraft.badge_order, profileDraft.hidden_badges, getMaxVisibleBadges())
    : (u.badges || []);
  return {
    ...u,
    ...(typeof profileDraft !== "undefined" ? profileDraft : {}),
    badges: previewBadges,
    avatar_url: pick("avatar", "avatar_url"),
    banner_url: pick("banner", "banner_url"),
    avatar_animated: Boolean(media.avatar ? media.avatar.animated : u.avatar_animated),
    banner_animated: Boolean(media.banner ? media.banner.animated : u.banner_animated),
    display_name: socials.display_name,
    pronouns: socials.pronouns,
    custom_status_emoji: socials.custom_status_emoji,
    custom_status_expires_at: socials.custom_status_expires_in === undefined ? u.custom_status_expires_at : null,
  };
}

// O perfil completo é sempre a prévia principal do editor. Os outros contextos aparecem no
// menu "Pré-visualizar em", sem esconder o perfil.
function profileContextPopoverOpen() {
  return !document.getElementById("pe-context-popover")?.classList.contains("hidden");
}

function renderProfileContextPreview() {
  const host = document.getElementById("profile-context-preview");
  const card = document.getElementById("live-profile-preview-card");
  document.querySelectorAll("[data-profile-context]").forEach((b) => {
    const on = b.dataset.profileContext === profilePreviewContext;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  if (!host || !card) return;
  const replay = document.getElementById("profile-preview-replay");
  replay.disabled = !profileMotionAvailable() || state.audioSettings.showProfileEffects === false ||
    !profileDraft.profile_effect || profileDraft.profile_effect === "none";
  const u = draftPreviewUser();
  const name = u.display_name || u.username || "Você";
  const avatar = (size) => `
    <div class="avatar-status-wrap" style="width:${size}px;height:${size}px">
      <div class="avatar" style="width:${size}px;height:${size}px"></div>
    </div>`;
  const nameSpan = `<span class="styled-name ctx-name">${escapeHtml(name)}</span>`;
  const plate = typeof getNameplateClass === "function" ? getNameplateClass(u.nameplate_style) : "";
  if (profilePreviewContext === "compact") {
    if (!host.firstElementChild?.classList.contains("compact-profile-preview")) {
      host.innerHTML = '<div class="compact-profile-preview profile-card"></div>';
    }
    renderCompactProfile(host.firstElementChild, u, name, u.username || "voce", true);
  } else if (profilePreviewContext === "panel") {
    host.innerHTML = `<div class="ctx-dm-row profile-panel-preview">${avatar(34)}<div>${nameSpan}
      <div class="ctx-sub">${escapeHtml(customStatusText(u) || STATUS_LABELS[u.status_kind] || "Online")}</div></div>
      <span aria-hidden="true" class="profile-panel-preview-gear">⚙</span></div>`;
  } else if (profilePreviewContext === "chat") {
    host.innerHTML = `
      <div class="ctx-label">Assim você aparece numa mensagem</div>
      <div class="ctx-chat-row">${avatar(40)}<div><div>${nameSpan} <span class="ctx-time">Hoje às 12:00</span></div><div class="ctx-text">Olá! Esta é uma prévia do seu perfil.</div></div></div>`;
  } else if (profilePreviewContext === "members") {
    host.innerHTML = `
      <div class="ctx-label">Na lista de membros</div>
      <div class="ctx-member-row">${avatar(32)}<div>${nameSpan}<div class="ctx-sub">${escapeHtml(u.custom_status || "Online")}</div></div></div>`;
  } else {
    host.innerHTML = `
      <div class="ctx-label">Na lista de conversas (DM)</div>
      <div class="ctx-dm-row ${plate}">${avatar(32)}<div>${nameSpan}<div class="ctx-sub">${escapeHtml(u.custom_status || "Online")}</div></div></div>`;
  }
  const nameEl = host.querySelector(".ctx-name");
  if (nameEl && typeof applyNameStyleToEl === "function") applyNameStyleToEl(nameEl, u, "#ffffff");
  const plateRow = host.querySelector(".ctx-dm-row:not(.profile-panel-preview)");
  if (plateRow && typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.renderNameplateArt === "function") {
    SancordCosmetics.renderNameplateArt(plateRow, plate ? u.nameplate_style : null);
  }
  const avatarEl = host.querySelector(".ctx-name") ? host.querySelector(".avatar-status-wrap") : null;
  if (avatarEl) renderDecoratedAvatar(avatarEl.firstElementChild, avatarEl, u);
  refreshAnimatedMedia(host);
}

document.querySelectorAll("[data-profile-context]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.profileContext !== profilePreviewContext) stopProfileEffect();
    profilePreviewContext = b.dataset.profileContext;
    renderProfileContextPreview();
  })
);

function replayCurrentProfilePreview() {
  const inPopover = profileContextPopoverOpen() && profilePreviewContext === "compact";
  const layer = inPopover ? document.querySelector("#profile-context-preview [data-profile-slot=effect]") :
    document.getElementById("preview-effect-layer");
  playProfileEffect(layer);
}
document.getElementById("profile-preview-replay").addEventListener("click", replayCurrentProfilePreview);
document.getElementById("profile-preview-theme").addEventListener("change", e => {
  document.querySelector("#pe-context-popover").dataset.previewTheme = e.target.value;
});

// ---------------------------------------------------------------------------
// Rascunho de mídia (avatar/banner): prévia imediata, envio só em "Salvar"
// ---------------------------------------------------------------------------
function discardPendingProfileMedia() {
  if (typeof profileDraft === "undefined") return;
  for (const v of Object.values(profileDraft.media || {})) {
    if (v && v.url && String(v.url).startsWith("blob:")) URL.revokeObjectURL(v.url);
  }
  profileDraft.media = {};
}

/** `value`: { blob, name, animated } ou { presetId, presetUrl, name } para trocar, ou "remove" para voltar ao padrão. */
function setPendingProfileMedia(kind, value) {
  if (typeof profileDraft === "undefined") return;
  const prev = profileDraft.media?.[kind];
  if (prev?.url?.startsWith?.("blob:")) URL.revokeObjectURL(prev.url);
  profileDraft.media = { ...(profileDraft.media || {}) };
  if (value === "remove") {
    const saved = kind === "avatar" ? state.selfUser?.avatar_url : state.selfUser?.banner_url;
    if (saved) profileDraft.media[kind] = "remove";
    else delete profileDraft.media[kind];
  } else if (value && value.presetUrl) {
    profileDraft.media[kind] = {
      presetId: value.presetId,
      presetUrl: value.presetUrl,
      name: value.name || `preset_avatar_${value.presetId || "default"}.webp`,
      animated: false,
      url: value.presetUrl,
      blob: value.blob || null,
    };
  } else {
    profileDraft.media[kind] = { blob: value.blob, name: value.name, animated: Boolean(value.animated), url: URL.createObjectURL(value.blob) };
  }
  if (typeof refreshLiveProfilePreview === "function") refreshLiveProfilePreview();
}

/** Envia a mídia pendente. Devolve false se algo falhou (o rascunho fica para tentar de novo). */
async function flushPendingProfileMedia() {
  const pending = { ...(profileDraft.media || {}) };
  for (const kind of ["avatar", "banner"]) {
    const v = pending[kind];
    if (!v) continue;
    try {
      if (v === "remove") {
        await applyProfileMedia(kind, null);
      } else {
        let blob = v.blob;
        if (!blob && v.presetUrl) {
          const res = await fetch(v.presetUrl);
          if (!res.ok) throw new Error(`Não foi possível carregar o avatar predefinido (${res.status}).`);
          blob = await res.blob();
        }
        await applyProfileMedia(kind, blob, v.name);
      }
      if (v.url?.startsWith?.("blob:")) URL.revokeObjectURL(v.url);
      delete profileDraft.media[kind];
    } catch (err) {
      showErrorToast(`Não foi possível enviar o ${kind === "avatar" ? "avatar" : "banner"}. ${err?.message || ""}`.trim());
      return false;
    }
  }
  return true;
}

// Controles novos do tema e da bio no editor.
document.getElementById("settings-theme-highlight")?.addEventListener("input", (e) => {
  profileDraft.theme_highlight = e.target.value;
  refreshLiveProfilePreview();
});
document.querySelectorAll('input[name="theme-mode"]').forEach((r) =>
  r.addEventListener("change", () => {
    if (r.checked) {
      profileDraft.theme_mode = r.value === "solid" ? "solid" : "gradient";
      if (r.value === "gradient") {
        profileDraft.theme_primary ||= document.getElementById("settings-theme-primary").value;
        profileDraft.theme_accent ||= document.getElementById("settings-theme-accent").value;
      }
      refreshLiveProfilePreview();
    }
  })
);
document.getElementById("settings-theme-direction")?.addEventListener("change", (e) => {
  profileDraft.theme_direction = e.target.value;
  refreshLiveProfilePreview();
});
document.getElementById("settings-remove-avatar-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  setPendingProfileMedia("avatar", "remove");
});
document.getElementById("settings-bio-input")?.addEventListener("input", updateBioCounter);
// ===========================================================================
// Fase 2 — Decorações de avatar (arte própria) e molduras de perfil
// Camadas do avatar: avatar (1) < partículas da decoração (2) < anel/arte (4) < status (5+).
// A decoração nunca é gravada na imagem: trocar o avatar mantém a decoração.
// ===========================================================================

/** Arte SVG (viewBox 0..100, avatar com raio ~42) das decorações novas do Sancord. */
const SANCORD_DECORATION_ART = {
  "core-orbit": `
    <circle cx="50" cy="50" r="46" fill="none" stroke="#8f7dff" stroke-width="1.6" stroke-dasharray="3 5" opacity=".8"/>
    <g class="deco-spin-slow"><circle cx="50" cy="4" r="3" fill="#b9adff"/><circle cx="96" cy="50" r="2" fill="#6ee7f9"/></g>`,
  "nebula-orbit": `
    <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(167,139,250,.45)" stroke-width="1.2"/>
    <g class="deco-spin-slow">
      <circle cx="50" cy="3" r="2.6" fill="#c4b5fd" class="deco-twinkle"/>
      <circle cx="91" cy="28" r="1.8" fill="#93c5fd" class="deco-twinkle" style="animation-delay:-1.2s"/>
      <circle cx="80" cy="88" r="2.2" fill="#f0abfc" class="deco-twinkle" style="animation-delay:-2.1s"/>
      <circle cx="12" cy="74" r="1.6" fill="#a5b4fc" class="deco-twinkle" style="animation-delay:-.6s"/>
      <circle cx="10" cy="22" r="2" fill="#e9d5ff" class="deco-twinkle" style="animation-delay:-2.7s"/>
    </g>`,
  "sakura-fall": `
    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(244,114,182,.55)" stroke-width="1.6"/>
    <ellipse cx="8" cy="10" rx="3.2" ry="1.9" fill="#fbcfe8" class="deco-fall" style="--dx:6px;animation-delay:-0.4s"/>
    <ellipse cx="90" cy="6" rx="2.8" ry="1.7" fill="#f9a8d4" class="deco-fall" style="--dx:-5px;animation-delay:-2.2s"/>
    <ellipse cx="22" cy="2" rx="2.4" ry="1.5" fill="#fce7f3" class="deco-fall" style="--dx:4px;animation-delay:-3.6s"/>
    <ellipse cx="78" cy="14" rx="3" ry="1.8" fill="#fbcfe8" class="deco-fall" style="--dx:-3px;animation-delay:-5s"/>`,
  "cyber-ring": `
    <g class="deco-spin-slow"><circle cx="50" cy="50" r="45.5" fill="none" stroke="#22d3ee" stroke-width="2.4" stroke-dasharray="14 4 2 4"/></g>
    <g class="deco-spin-reverse"><circle cx="50" cy="50" r="48.5" fill="none" stroke="rgba(56,189,248,.5)" stroke-width="1" stroke-dasharray="1 3"/></g>
    <path d="M50 0v6M50 94v6M0 50h6M94 50h6" stroke="#67e8f9" stroke-width="2"/>`,
  "electric-pulse": `
    <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(125,211,252,.35)" stroke-width="1.6"/>
    <circle cx="50" cy="50" r="45" fill="none" stroke="#e0f2fe" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="10 273" class="deco-dash"/>
    <circle cx="50" cy="50" r="45" fill="none" stroke="#7dd3fc" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="6 277" class="deco-dash" style="animation-delay:-1.7s"/>`,
  lunar: `
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="rgba(203,213,225,.45)" stroke-width="1.2"/>
    <path d="M86 10a11 11 0 1 0 6 18a9 9 0 1 1 -6 -18z" fill="#fde68a"/>
    <path d="M14 18l1.2 2.6 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z" fill="#fef9c3" class="deco-twinkle"/>
    <circle cx="8" cy="62" r="1.4" fill="#fef3c7" class="deco-twinkle" style="animation-delay:-1.5s"/>
    <circle cx="92" cy="74" r="1.2" fill="#fef3c7" class="deco-twinkle" style="animation-delay:-2.4s"/>`,
  ember: `
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="rgba(251,146,60,.5)" stroke-width="1.6"/>
    <circle cx="20" cy="96" r="1.8" fill="#fb923c" class="deco-rise" style="--dx:-3px"/>
    <circle cx="50" cy="98" r="1.4" fill="#fdba74" class="deco-rise" style="--dx:2px;animation-delay:-1.3s"/>
    <circle cx="80" cy="95" r="2" fill="#f97316" class="deco-rise" style="--dx:4px;animation-delay:-2.6s"/>
    <circle cx="66" cy="99" r="1.2" fill="#fed7aa" class="deco-rise" style="--dx:-2px;animation-delay:-3.4s"/>`,
  snowfall: `
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="rgba(226,232,240,.4)" stroke-width="1.2"/>
    <circle cx="12" cy="4" r="1.6" fill="#f8fafc" class="deco-fall" style="--dx:3px;animation-duration:7s"/>
    <circle cx="88" cy="2" r="1.3" fill="#e2e8f0" class="deco-fall" style="--dx:-3px;animation-duration:8s;animation-delay:-3s"/>
    <circle cx="30" cy="0" r="1.1" fill="#f1f5f9" class="deco-fall" style="--dx:2px;animation-duration:9s;animation-delay:-5s"/>
    <circle cx="70" cy="6" r="1.5" fill="#f8fafc" class="deco-fall" style="--dx:-2px;animation-duration:7.5s;animation-delay:-1.5s"/>`,
  "ocean-bubbles": `
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="rgba(56,189,248,.45)" stroke-width="1.4"/>
    <circle cx="6" cy="90" r="2.4" fill="none" stroke="#7dd3fc" stroke-width=".9" class="deco-rise" style="--dx:2px;animation-duration:6s"/>
    <circle cx="94" cy="92" r="1.8" fill="none" stroke="#bae6fd" stroke-width=".9" class="deco-rise" style="--dx:-2px;animation-duration:7s;animation-delay:-2.5s"/>
    <circle cx="14" cy="96" r="1.4" fill="none" stroke="#e0f2fe" stroke-width=".8" class="deco-rise" style="--dx:3px;animation-duration:6.5s;animation-delay:-4s"/>`,
  "digital-rain": `
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="rgba(74,222,128,.4)" stroke-width="1.2"/>
    <rect x="6" y="0" width="1.4" height="6" fill="#4ade80" class="deco-fall" style="--dx:0px;animation-duration:3s"/>
    <rect x="92" y="0" width="1.4" height="8" fill="#86efac" class="deco-fall" style="--dx:0px;animation-duration:3.6s;animation-delay:-1.4s"/>
    <rect x="16" y="0" width="1.2" height="5" fill="#bbf7d0" class="deco-fall" style="--dx:0px;animation-duration:4.2s;animation-delay:-2.6s"/>
    <rect x="84" y="0" width="1.2" height="5" fill="#4ade80" class="deco-fall" style="--dx:0px;animation-duration:3.3s;animation-delay:-.7s"/>`,
  "retro-pixels": `
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="rgba(244,114,182,.45)" stroke-width="1.2" stroke-dasharray="4 4"/>
    <rect x="47" y="0" width="5" height="5" fill="#f472b6" class="deco-pixel"/>
    <rect x="95" y="46" width="5" height="5" fill="#a78bfa" class="deco-pixel" style="animation-delay:-.8s"/>
    <rect x="46" y="95" width="5" height="5" fill="#22d3ee" class="deco-pixel" style="animation-delay:-1.6s"/>
    <rect x="0" y="47" width="5" height="5" fill="#facc15" class="deco-pixel" style="animation-delay:-2.4s"/>`,
};

function sancordDecorationArt(id) {
  return SANCORD_DECORATION_ART[id] || null;
}

// ---------------------------------------------------------------------------
// Molduras de perfil: camada sobre o cartão inteiro (não aparece nas mensagens).
// A pintura é CSS (ui.css, classes pf-<id>); ornamentos são SVG próprios.
// ---------------------------------------------------------------------------
const FRAME_ORNAMENTS = {
  "cyber-corners": `<svg class="pf-orn pf-corners" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M1 12V1h11M88 1h11v11M99 88v11H88M12 99H1V88" fill="none" stroke="currentColor" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>`,
  "sakura-corners": `<span class="pf-orn pf-flower tl"></span><span class="pf-orn pf-flower tr"></span><span class="pf-orn pf-flower bl"></span><span class="pf-orn pf-flower br"></span>`,
  royal: `<span class="pf-orn pf-gem top"></span><span class="pf-orn pf-gem bottom"></span>`,
  frost: `<span class="pf-orn pf-crystal tl"></span><span class="pf-orn pf-crystal br"></span>`,
  "frost-glint": `<span class="pf-orn pf-crystal tl"></span><span class="pf-orn pf-crystal tr"></span><span class="pf-orn pf-crystal bl"></span><span class="pf-orn pf-crystal br"></span>`,
  "sakura-wind": `<span class="pf-orn pf-petal p1"></span><span class="pf-orn pf-petal p2"></span><span class="pf-orn pf-petal p3"></span>`,
  founder: `<span class="pf-orn pf-gem top"></span>`,
  developer: `<svg class="pf-orn pf-corners" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M8 2Q2 2 2 8V20Q2 24-1 25Q2 26 2 30V42M92 2Q98 2 98 8V20Q98 24 101 25Q98 26 98 30V42" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`,
  "early-user": `<span class="pf-orn pf-spark top"></span>`,
  "winter-2026": `<span class="pf-orn pf-crystal tl"></span><span class="pf-orn pf-crystal tr"></span>`,
};

/** Aplica (ou tira) a moldura num cartão de perfil. */
function applyProfileFrame(cardEl, frameId) {
  if (!cardEl) return;
  const nextClass = frameId && frameId !== "none" ? `pf-${frameId}` : "";
  if ((cardEl.dataset.frameClass || "") === nextClass) return;
  // Remove só a classe da moldura anterior (outras "pf-*" do elemento continuam).
  if (cardEl.dataset.frameClass) cardEl.classList.remove(cardEl.dataset.frameClass);
  cardEl.classList.remove("has-frame");
  delete cardEl.dataset.frameClass;
  cardEl.querySelector(":scope > .pf-layer")?.remove();
  if (!nextClass) {
    if (typeof SancordCosmetics !== "undefined") SancordCosmetics.attachFrameIdle(cardEl, null);
    return;
  }
  cardEl.dataset.frameClass = nextClass;
  cardEl.classList.add("has-frame", nextClass);
  const layer = document.createElement("div");
  layer.className = "pf-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = `<div class="pf-ring"></div>${profileFrameArt(frameId) || FRAME_ORNAMENTS[frameId] || ""}`;
  cardEl.appendChild(layer);
  if (typeof SancordCosmetics !== "undefined") SancordCosmetics.attachFrameIdle(cardEl, frameId);
}

// Molduras reativas: presença e voz viram atributos; o CSS reage. Só cosmético
// (o indicador oficial de status continua no avatar).
const FRAME_VOICE_UPDATE_MS = 150;
let frameVoiceTimer = null;

function setFrameReactiveState(cardEl, user) {
  if (!cardEl) return;
  const id = user?.id || "";
  cardEl.dataset.frameUser = id;
  const presence = user?.online === false || user?.status_kind === "invisible" ? "offline" : user?.status_kind || "online";
  cardEl.dataset.presence = presence;
  let voice = "none";
  if (user?.voice_channel_id) {
    voice = user.screen_sharing || user.camera_on ? "streaming" : user.muted || user.server_muted ? "muted" : "connected";
    if (state.speakingUsers?.has(id)) voice = "speaking";
  }
  cardEl.dataset.voice = voice;
}

/** Chamado quando alguém começa/para de falar; agrupa atualizações (no máximo a cada 150 ms). */
function onFrameVoiceState(userId) {
  if (frameVoiceTimer || state.audioSettings.showProfileFrames === false) return;
  frameVoiceTimer = setTimeout(() => {
    frameVoiceTimer = null;
    document.querySelectorAll(".profile-card.has-frame[data-frame-user]").forEach((card) => {
      if (card.closest(".hidden,[hidden]")) return;
      const u = state.users?.get(card.dataset.frameUser) || (state.selfUser?.id === card.dataset.frameUser ? state.selfUser : null);
      if (u) setFrameReactiveState(card, u);
    });
  }, FRAME_VOICE_UPDATE_MS);
}

// ---------------------------------------------------------------------------
// Badges (concedidas pelo servidor). Confiança sempre visível; cosméticas à parte.
// Ícones desenhados para o Sancord.
// ---------------------------------------------------------------------------
const BADGE_ICONS = {
  founder: '<path d="M4 18h16l-1.5-9-4.5 4-2-7-2 7-4.5-4z" fill="#fbbf24" stroke="#fef3c7" stroke-width="1.3"/><circle cx="12" cy="14" r="1.5" fill="#e11d48" stroke="none"/>',
  architect: '<polygon points="12,2 21,9 17.5,21 6.5,21 3,9" fill="#0284c7" stroke="#bae6fd" stroke-width="1.2"/><polygon points="12,2 17,9 12,15 7,9" fill="#38bdf8" stroke="none"/><polygon points="12,5 14.8,9 12,12 9.2,9" fill="#e0f2fe" stroke="none"/>',
  developer: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>',
  moderator: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>',
  verified_bot: '<path d="M12 2l2.6 2.2 3.4-.4.9 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-.9 3.3-3.4-.4L12 22l-2.6-2.2-3.4.4-.9-3.3-3-1.7L3.4 12 2.1 8.8l3-1.7.9-3.3 3.4.4zM8 12l3 3 5-6"/>',
  verified_developer: '<path d="M12 2l2.6 2.2 3.4-.4.9 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-.9 3.3-3.4-.4L12 22l-2.6-2.2-3.4.4-.9-3.3-3-1.7L3.4 12 2.1 8.8l3-1.7.9-3.3 3.4.4zM9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5"/>',
  contributor: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>',
  bug_hunter: '<path d="M8 8a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0zM12 8v12M4 10h4M16 10h4M4 16h4M16 16h4M9 4l1.5 2M15 4l-1.5 2"/>',
  event_winner: '<path d="M7 4h10v4a5 5 0 0 1-10 0zM12 13v4M8 21h8M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  sovereign: '<path d="M3.5 18.5h17l-1.4-9.5-3.8 3.6L12 4.5l-3.3 8.1-3.8-3.6z" fill="#d97706" stroke="#fef08a" stroke-width="1.2"/><polygon points="12,11 14.6,14.5 12,17.4 9.4,14.5" fill="#e11d48" stroke="#ffe4e6" stroke-width="0.9"/><circle cx="12" cy="3.8" r="1.4" fill="#fef9c3" stroke="none"/>',
  astral_guardian: '<path d="M15.8 4.2a8.2 8.2 0 1 0 4.4 12.6A6.5 6.5 0 1 1 15.8 4.2z" fill="#a855f7" stroke="#f3e8ff" stroke-width="1.1"/><polygon points="16.5,5 17.6,8.2 21,9.2 17.6,10.2 16.5,13.5 15.4,10.2 12,9.2 15.4,8.2" fill="#fde68a" stroke="none"/>',
  dragon_forged: '<path d="M12 2.2c3.8 3.5 7 7.2 7 11.4a7 7 0 0 1-14 0c0-3.2 2-6.1 4.2-8.2.4 2 1.6 3.1 2.8 3.1 0-2.5-.6-4.5 0-6.3z" fill="#ea580c" stroke="#fed7aa" stroke-width="1.1"/><path d="M12 9.5c2 2 3.4 3.8 3.4 6a3.4 3.4 0 0 1-6.8 0c0-1.9 1.2-3.9 3.4-6z" fill="#fef08a" stroke="none"/>',
  prism_collector: '<polygon points="12,2 20.5,12 12,22 3.5,12" fill="#a855f7" stroke="#e0f2fe" stroke-width="1.1"/><polygon points="12,2 20.5,12 12,12" fill="#22d3ee" stroke="none"/><polygon points="12,12 20.5,12 12,22" fill="#f472b6" stroke="none"/><polygon points="12,6 15.5,12 12,18 8.5,12" fill="#ffffff" fill-opacity="0.72" stroke="none"/>',
  obsidian_vip: '<polygon points="12,2.2 20.5,7.1 20.5,16.9 12,21.8 3.5,16.9 3.5,7.1" fill="#064e3b" stroke="#fde047" stroke-width="1.3"/><polygon points="12,6.2 16.8,12 12,17.8 7.2,12" fill="#10b981" stroke="#d1fae5" stroke-width="0.9"/><circle cx="12" cy="12" r="1.8" fill="#fef08a" stroke="none"/>',
  early_user: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z"/>',
  alpha: '<path d="M18 7c-1.5 5-2.5 10-1 11M17 12c-1.4 3.5-3.5 6-6.5 6S6 15.5 6 12.5 8 6 11 6s5 4 6 6z"/>',
  beta: '<path d="M8 21V7a4 4 0 0 1 8 0c0 2-1.5 3.5-3.5 3.5 2.5 0 4.5 1.6 4.5 4s-2 4.5-4.5 4.5c-1.6 0-3.2-.8-4.5-2"/>',
  community: '<path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M12 20c0-3.3 1.8-6 4-6 3.3 0 6 2.7 6 6"/>',
  supporter: '<path d="M12 20l-7-7a4.5 4.5 0 0 1 7-5.6A4.5 4.5 0 0 1 19 13z"/>',
};
const EXCLUSIVE_JEWEL_BADGES = new Set(["founder", "architect", "sovereign", "astral_guardian", "dragon_forged", "prism_collector", "obsidian_vip"]);

function badgeDef(id) {
  return (state.cosmetics?.badges || []).find((b) => b.id === id) || null;
}

function getOwnedBadgesList() {
  if (Array.isArray(state.cosmetics?.ownedBadges)) {
    return state.cosmetics.ownedBadges.filter((id) => BADGE_ICONS[id]);
  }
  return (state.selfUser?.badges || []).filter((id) => BADGE_ICONS[id]);
}

function getMaxVisibleBadges() {
  const n = Number(state.cosmetics?.maxVisibleBadges);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

function badgeCanHide(id) {
  const def = badgeDef(id);
  return def ? def.can_hide !== false : true;
}

function computeOrderedOwnedBadges(owned, badgeOrder) {
  const ownedList = (owned || []).filter((id) => BADGE_ICONS[id]);
  const ownedSet = new Set(ownedList);
  const ordered = [];
  const seen = new Set();
  for (const id of badgeOrder || []) {
    if (ownedSet.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  for (const id of ownedList) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

function computeVisibleBadges(owned, badgeOrder, hiddenBadges, maxVisible = getMaxVisibleBadges()) {
  const ordered = computeOrderedOwnedBadges(owned, badgeOrder);
  const hiddenSet = new Set(hiddenBadges || []);
  const mandatory = [];
  const optional = [];
  for (const id of ordered) {
    if (!badgeCanHide(id)) mandatory.push(id);
    else if (!hiddenSet.has(id)) optional.push(id);
  }
  const remainingSlots = Math.max(0, maxVisible - mandatory.length);
  const allowedOptional = new Set(optional.slice(0, remainingSlots));
  const mandatorySet = new Set(mandatory);
  return ordered.filter((id) => mandatorySet.has(id) || allowedOptional.has(id));
}

function renderProfileBadges(host, badgeIds) {
  if (!host) return;
  host.innerHTML = "";
  const ids = (badgeIds || []).filter((id) => BADGE_ICONS[id]);
  host.classList.toggle("hidden", !ids.length);
  for (const id of ids) {
    const def = badgeDef(id);
    const el = document.createElement("span");
    el.className = `profile-badge ${def?.category === "trust" ? "badge-trust" : "badge-cosmetic"}${EXCLUSIVE_JEWEL_BADGES.has(id) ? " badge-jewel" : ""}`;
    el.dataset.badge = id;
    el.setAttribute("role", "img");
    const label = def ? `${def.name} — ${def.description}` : id;
    el.setAttribute("aria-label", label);
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${BADGE_ICONS[id]}</svg>`;
    if (typeof SancordUI !== "undefined") SancordUI.tooltip(el, label, "top");
    else el.title = label;
    host.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Seletor de cosméticos (decorações e molduras): painel interno, não janela.
// Grade com prévias; hover anima; clique mostra prévia grande; Aplicar equipa no rascunho.
// ---------------------------------------------------------------------------
const PICKER_KINDS = {
  avatar_decoration: { title: "Decorações de avatar", field: "avatar_decoration" },
  profile_frame: { title: "Molduras de perfil", field: "profile_frame" },
};
const PICKER_TABS = [
  ["all", "Todas"],
  ["animated", "Animadas"],
  ["static", "Estáticas"],
  ["achievement", "Conquistas"],
  ["event", "Evento"],
];
const RARITY_LABELS = { common: "Comum", rare: "Rara", epic: "Épica", legendary: "Lendária", event: "Evento", founder: "Fundação" };
const COLLECTION_LABELS = {
  classicos: "Clássicos", "sancord-core": "Sanvo Core", "sanvo-core": "Sanvo Core",
  cosmic: "Astral & Cósmico", sakura: "Sakura & Floral", cyber: "Holográfico & Cyber",
  synth: "Neon Synthwave", arcane: "Magia & Arcano", seraphim: "Celestial & Serafim",
  eclipse: "Sombra & Eclipse", dream: "Sonho & Etéreo", midnight: "Midnight",
  inferno: "Forja Dracônica", frost: "Gelo & Cristal", ocean: "Água & Oceano", abyssal: "Abissal & Oceânico",
  retro: "Retrô", royal: "Joalheria Real", conquistas: "Conquistas", "temporada-inverno": "Temporada de inverno",
};
const picker = { kind: null, tab: "all", selected: null, el: null };

function pickerItems(kind) {
  return (state.cosmetics?.catalog || []).filter((i) => i.kind === kind);
}

function pickerUnlockHint(item) {
  const badge = String(item.availability || "").startsWith("badge:") ? badgeDef(item.availability.slice(6)) : null;
  if (badge) return `Conquista: ${badge.name}`;
  if (item.availability === "grant") return "Item de evento ou presente";
  return "";
}

function buildPickerPreview(kind, id, size = "small") {
  const u = draftPreviewUser();
  const wrap = document.createElement("div");
  if (kind === "profile_frame") {
    wrap.className = `profile-card ${size === "large" ? "compact-profile-preview" : "pf-mini profile-picker-thumbnail"}`;
    const view = size === "large" ? u : { ...u, avatar_url: null, banner_url: null, bio: null, badges: [], created_at: null, pronouns: null, custom_status: null };
    renderCompactProfile(wrap, { ...view, profile_frame: id, profile_effect: null }, u.display_name || u.username || "Perfil", u.username || "perfil", true);
  } else {
    const px = size === "large" ? 96 : 52;
    wrap.className = "avatar-deco-wrap";
    wrap.style.cssText = `width:${px}px;height:${px}px`;
    wrap.innerHTML = `<div class="avatar" style="width:${px}px;height:${px}px;font-size:${Math.round(px / 3)}px"></div>`;
    renderDecoratedAvatar(wrap.firstElementChild, wrap, { ...u, avatar_decoration: id, avatar_url: size === "large" ? u.avatar_url : null });
  }
  return wrap;
}

function ensurePickerEl() {
  if (picker.el) return picker.el;
  const el = document.createElement("div");
  el.className = "modal-backdrop cosmetic-picker hidden";
  el.innerHTML = `
    <div class="cosmetic-picker-card" role="dialog" aria-modal="true" aria-labelledby="cosmetic-picker-title">
      <div class="cosmetic-picker-head">
        <h2 id="cosmetic-picker-title"></h2>
        <button type="button" class="avatar-crop-x" data-picker-close aria-label="Fechar">✕</button>
      </div>
      <div class="cosmetic-picker-tabs" role="tablist"></div>
      <div class="cosmetic-picker-filters">
        <input type="search" class="settings-select" data-cosmetic-search aria-label="Buscar cosméticos" placeholder="Buscar cosméticos…" />
        <label><input type="checkbox" data-cosmetic-owned /> Minha coleção</label>
      </div>
      <div class="cosmetic-picker-body">
        <div class="cosmetic-picker-grid" role="listbox"></div>
        <aside class="cosmetic-picker-detail" aria-live="polite"></aside>
      </div>
      <div class="cosmetic-picker-foot">
        <button type="button" class="btn-secondary" data-picker-none>Remover</button>
        <span class="cosmetic-picker-spacer"></span>
        <button type="button" class="btn-secondary" data-picker-close>Cancelar</button>
        <button type="button" class="btn-primary" data-picker-apply>Aplicar</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("[data-cosmetic-search]").addEventListener("input", renderCosmeticPicker);
  el.querySelector("[data-cosmetic-owned]").addEventListener("change", renderCosmeticPicker);
  el.addEventListener("click", (e) => {
    if (e.target === el || e.target.closest("[data-picker-close]")) closeCosmeticPicker();
    else if (e.target.closest("[data-picker-none]")) {
      picker.selected = null;
      applyCosmeticPicker();
    } else if (e.target.closest("[data-picker-apply]")) applyCosmeticPicker();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeCosmeticPicker();
    } else if (e.target.matches(".cosmetic-choice") && ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) {
      const options = [...el.querySelectorAll(".cosmetic-choice")];
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const index = options.indexOf(e.target);
      e.preventDefault();
      options[(index + step + options.length) % options.length]?.focus();
    } else if (e.key === "Tab") {
      const focusable = [...el.querySelectorAll("button:not(:disabled), input")];
      const at = focusable.indexOf(document.activeElement);
      if (e.shiftKey ? at <= 0 : at === focusable.length - 1) {
        e.preventDefault();
        (e.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
      }
    }
  });
  picker.el = el;
  return el;
}

function openCosmeticPicker(kind) {
  if (!PICKER_KINDS[kind]) return;
  const el = ensurePickerEl();
  picker.kind = kind;
  picker.trigger = document.activeElement;
  picker.tab = "all";
  const current = profileDraft[PICKER_KINDS[kind].field];
  picker.selected = current && current !== "none" ? current : null;
  el.querySelector("#cosmetic-picker-title").textContent = PICKER_KINDS[kind].title;
  el.querySelector("[data-cosmetic-search]").value = "";
  el.querySelector("[data-cosmetic-owned]").checked = false;
  renderCosmeticPicker();
  el.classList.remove("hidden");
  if (typeof queueProfileMotion === "function") queueProfileMotion();
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.reconcileIdleBudget === "function") {
    SancordCosmetics.reconcileIdleBudget();
  }
  setTimeout(() => el.querySelector(".cosmetic-choice.selected, .cosmetic-choice")?.focus(), 0);
}

function closeCosmeticPicker() {
  picker.el?.classList.add("hidden");
  picker.trigger?.focus?.({ preventScroll: true });
}

function applyCosmeticPicker() {
  const field = PICKER_KINDS[picker.kind]?.field;
  if (!field) return;
  profileDraft[field] = picker.selected || "none";
  closeCosmeticPicker();
  if (typeof refreshLiveProfilePreview === "function") refreshLiveProfilePreview();
}

function pickerTabMatches(item, tab) {
  const ach = String(item.availability || "").startsWith("badge:");
  if (tab === "animated") return item.animated;
  if (tab === "static") return !item.animated;
  if (tab === "achievement") return ach;
  if (tab === "event") return item.rarity === "event" || item.availability === "grant";
  return true;
}

function renderCosmeticPicker() {
  const el = picker.el;
  if (!el) return;
  const items = pickerItems(picker.kind);
  const tabs = el.querySelector(".cosmetic-picker-tabs");
  tabs.innerHTML = "";
  for (const [key, label] of PICKER_TABS) {
    const count = items.filter((i) => pickerTabMatches(i, key)).length;
    if (!count && key !== "all") continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = `cosmetic-tab${picker.tab === key ? " active" : ""}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(picker.tab === key));
    b.textContent = `${label} (${count})`;
    b.addEventListener("click", () => {
      picker.tab = key;
      renderCosmeticPicker();
    });
    tabs.appendChild(b);
  }
  const grid = el.querySelector(".cosmetic-picker-grid");
  grid.innerHTML = "";
  // Agrupa por coleção, mantendo a ordem do catálogo.
  const groups = new Map();
  const query = el.querySelector("[data-cosmetic-search]").value.trim().toLocaleLowerCase();
  const ownedOnly = el.querySelector("[data-cosmetic-owned]").checked;
  for (const item of items.filter(i => pickerTabMatches(i, picker.tab) &&
      (!ownedOnly || ownsCosmetic(i.kind, i.id)) &&
      `${i.name} ${COLLECTION_LABELS[i.collection] || i.collection}`.toLocaleLowerCase().includes(query))) {
    if (!groups.has(item.collection)) groups.set(item.collection, []);
    groups.get(item.collection).push(item);
  }
  for (const [collection, list] of groups) {
    const h = document.createElement("div");
    h.className = "cosmetic-collection-title";
    h.textContent = COLLECTION_LABELS[collection] || collection;
    grid.appendChild(h);
    for (const item of list) {
      const owned = ownsCosmetic(item.kind, item.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `cosmetic-choice${picker.selected === item.id ? " selected" : ""}${owned ? "" : " locked"}`;
      b.dataset.id = item.id;
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(picker.selected === item.id));
      b.title = [item.name, PICKER_KINDS[item.kind].title, COLLECTION_LABELS[collection] || collection,
        owned ? "" : pickerUnlockHint(item)].filter(Boolean).join(" · ");
      const prev = document.createElement("div");
      prev.className = "cosmetic-choice-preview";
      prev.appendChild(buildPickerPreview(item.kind, item.id));
      const name = document.createElement("span");
      name.className = "cosmetic-choice-name";
      name.textContent = item.name;
      b.append(prev, name);
      if (!owned) {
        const lock = document.createElement("span");
        lock.className = "cosmetic-lock";
        lock.textContent = "🔒";
        b.appendChild(lock);
      }
      b.addEventListener("click", () => {
        if (!owned) {
          renderPickerDetail(item);
          return;
        }
        picker.selected = item.id;
        for (const option of grid.querySelectorAll(".cosmetic-choice")) {
          option.classList.toggle("selected", option === b);
          option.setAttribute("aria-selected", String(option === b));
        }
        renderPickerDetail(item);
      });
      grid.appendChild(b);
    }
  }
  if (!groups.size) grid.textContent = "Nenhum cosmético encontrado.";
  const sel = items.find((i) => i.id === picker.selected);
  renderPickerDetail(sel || null);
  refreshAnimatedMedia(grid);
}

function renderPickerDetail(item) {
  const box = picker.el?.querySelector(".cosmetic-picker-detail");
  if (!box) return;
  box.innerHTML = "";
  if (!item) {
    box.innerHTML = `<p class="settings-hint-text">Escolha um item para ver a prévia grande. Passe o mouse sobre a grade para ver a animação.</p>`;
    return;
  }
  box.appendChild(buildPickerPreview(item.kind, item.id, "large"));
  const title = document.createElement("strong");
  title.textContent = item.name;
  const meta = document.createElement("div");
  meta.className = "settings-hint-text";
  meta.textContent = [COLLECTION_LABELS[item.collection] || item.collection, RARITY_LABELS[item.rarity] || item.rarity, item.animated ? "Animada" : "Estática"].join(" • ");
  box.append(title, meta);
  const hint = pickerUnlockHint(item);
  if (!ownsCosmetic(item.kind, item.id)) {
    const lock = document.createElement("div");
    lock.className = "cosmetic-locked-hint";
    lock.textContent = `🔒 ${hint}. Concedido pelo Sanvo — não dá para equipar por aqui.`;
    box.appendChild(lock);
  }
  refreshAnimatedMedia(box);
}
