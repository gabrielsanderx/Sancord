// Receitas locais, por ID do catálogo. Os SVGs e efeitos CSS vêm embutidos no desktop.
const PROFILE_ART_VERSION = 2;
const profileCardArt = {
  avatar: {
    "core-orbit": { theme: "core", mode: "hover-loop", safeArea: 18,
      back: '<path class="avatar-art-band" d="M3 67C12 53 33 35 60 28c16-4 30-3 36 5l-8 7c-4-5-15-7-28-4C36 41 17 53 3 71Z"/><path class="avatar-art-line" d="M3 67C20 44 70 17 96 33M11 49l7-7m56-18 11 1"/><path class="avatar-art-facet" d="m24 42 9-8 10 1-13 7zm49-22 12 1-6 6-12 1z"/>',
      front: '<path class="avatar-art-band" d="M3 66c-5 11 5 23 25 23 24 1 56-13 69-41l-1-10C84 62 52 77 26 79 13 80 4 75 3 66Z"/><path class="avatar-art-line" d="M3 69C4 87 29 91 58 79c17-7 32-20 38-37"/><path class="avatar-art-highlight" d="M10 79C20 85 38 84 50 81m12-5 8-5m8-5 13-14"/><g class="avatar-art-motes"><path class="avatar-art-facet" d="m18 90 8-5 10 5-12 4zm57-15 7-12 12 3-11 9z"/><path class="avatar-art-spark" d="m86 58 3-6 3 6-3 5zm-32 29 2-4 2 4-2 4z"/><circle cx="37" cy="93" r="1.5" class="avatar-art-spark"/></g>' },
    "galaxy-portal": { theme: "cosmic", mode: "hover-loop", safeArea: 21,
      back: '<path class="avatar-art-band" d="M5 60C8 21 43 9 65 12c20 4 32 17 33 32-9-23-25-25-40-25C40 16 15 29 5 60Z"/><path d="M7 57C14 28 42 10 69 16l10 3 12 9" class="avatar-art-line"/><path class="avatar-art-highlight" d="M73 9v10m-5-5h10m8 5 4-5m-70 19 6-6"/><circle cx="92" cy="34" r="2" class="avatar-art-facet"/>',
      front: '<path class="avatar-art-band" d="M6 61c6 18 21 31 38 32 25 2 44-14 53-42l-9 13C74 89 53 85 39 83 26 81 12 75 6 61Z"/><path d="M9 72Q31 99 61 88Q89 76 96 44" class="avatar-art-line"/><path d="M13 81Q35 96 56 93m9-5Q78 81 86 73" class="avatar-art-highlight"/><g class="avatar-art-motes"><path class="avatar-art-facet" d="m86 46 6 8-2 10-5-7zm-64 35 9 5-3 6-6-6z"/><path class="avatar-art-spark" d="m76 78 2-6 2 6 6 2-6 2-2 6-2-6-6-2z"/><circle cx="36" cy="94" r="1.8" class="avatar-art-spark"/><circle cx="91" cy="66" r="1.4" class="avatar-art-spark"/></g>' },
    "sakura-glow": { theme: "sakura", mode: "hover-loop", safeArea: 20,
      back: '<path class="avatar-art-band" d="M5 62C8 39 17 31 35 20l18-5C41 9 22 15 14 26 7 36 4 50 5 62Zm58-46c16 3 28 18 33 35C98 32 81 13 63 16Z"/><path d="M8 54Q9 19 46 13M68 14Q93 24 96 53" class="avatar-art-line"/><path class="avatar-art-petal" d="M28 21c-11-3-10-11-5-13 2 3 5 2 7 0 4 3 3 10-2 13Zm45 2c-1-7 3-12 8-11l-1 4 4 1c0 5-6 9-11 6Z"/>',
      front: '<path d="M7 58C14 91 40 100 65 89c14-6 24-17 30-34M9 65C18 84 36 94 57 92" class="avatar-art-line"/><g class="avatar-art-petal"><path d="M18 80C7 81 4 71 8 67l3 4 4-3c5 1 7 9 3 12Zm2 0c0-10 10-15 15-10l-4 3 2 3c-2 6-8 8-13 4Z"/><path d="M84 81c-8-3-8-12-3-15l3 4 4-2c4 5 2 12-4 13Zm2 2c5-10 10-9 13-7l-1 5 2 1c-2 6-9 7-14 1Z"/></g><path class="avatar-art-highlight" d="m11 75 7 5 9-5m52 0 6 7 9-2"/><g class="avatar-art-motes"><path class="avatar-art-facet" d="M38 90q7-11 12-4-4 8-12 4Zm25-4q4-8 10-5-1 7-10 5Z"/><circle cx="34" cy="95" r="1.7" class="avatar-art-spark"/><circle cx="62" cy="94" r="2" class="avatar-art-spark"/></g>' },
  },
  frame: {
    "core-pulse": { theme: "core", mode: "loop" },
    "cosmic-drift": { theme: "cosmic", mode: "loop" },
    "sakura-wind": { theme: "sakura", mode: "hover-loop" },
  },
  effect: {
    "core-signal": { theme: "core", duration: 1900, paths: '<path d="M1 30h18l13-13h25l15-13h20M9 67h20l11-12h27l18-21h11M4 86h26l17-15h26l11-11h13"/><path class="effect-art-ink" d="m12 30 8-4 4 4-4 4zm51 25 7-5 5 5-5 5zm15 15 9-6 4 6-4 5z"/><circle cx="32" cy="17" r="2"/><circle cx="42" cy="55" r="2"/>' },
    "star-trail": { theme: "cosmic", duration: 2100, paths: '<path d="M-6 78C18 24 60 6 106 16M-4 84C34 46 68 8 107 35M25 99C41 50 71 34 103 37"/><path class="effect-art-ink" d="m75 30 2-8 2 8 8 2-8 2-2 8-2-8-8-2zm-27 26 2-6 2 6 6 2-6 2-2 6-2-6-6-2zm45-14 1-4 1 4 4 1-4 1-1 4-1-4-4-1z"/><circle cx="36" cy="63" r="1.2"/><circle cx="62" cy="39" r="1.6"/><circle cx="13" cy="69" r="1.1"/>' },
    "petal-drift": { theme: "sakura", duration: 1850, paths: '<path d="M-2 24C24 6 51 64 72 45s20-24 31-17M3 57c23-10 39 21 63 12 14-6 26-19 43-14"/><path class="effect-art-ink" d="M17 30c-6-8-1-15 3-14l1 5 5-1c1 7-4 11-9 10Zm26 27c-5-6-2-12 2-13l3 5 4-2c1 7-5 11-9 10Zm37-21c-6-2-9-8-6-12l4 3 4-3c6 5 4 11-2 12Zm-5 41c-7 0-11-5-9-9l4 1 3-3c5 2 7 7 2 11Z"/>' },
  },
};

function profileAvatarArtLayer(id, depth) {
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.avatarArtLayerHtml === "function") {
    const v3 = SancordCosmetics.avatarArtLayerHtml(id, depth);
    if (v3) return v3;
  }
  const art = profileCardArt.avatar[id];
  if (!Object.hasOwn(profileCardArt.avatar, id)) return "";
  return `<span class="deco-svg-layer avatar-art-${depth} profile-art-${art.theme}" data-art-version="${PROFILE_ART_VERSION}" data-animation-mode="${art.mode}" style="--avatar-art-bleed:${art.safeArea}%" aria-hidden="true"><svg viewBox="0 0 100 100">${art[depth]}</svg></span>`;
}

function profileFrameArt(id) {
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.profileFrameArtHtml === "function") {
    const v3 = SancordCosmetics.profileFrameArtHtml(id);
    if (v3) return v3;
  }
  const art = profileCardArt.frame[id];
  if (!Object.hasOwn(profileCardArt.frame, id)) return "";
  const designs = {
    core: '<path class="frame-inlay" d="M2 32V9l8-7h45l-9 8H21L11 21v22z"/><path d="M2 45V9l8-7h40M11 36V20l9-9h24M18 43V28l10-10h9"/><path class="frame-detail" d="m30 21 6-4 5 2-5 5zm-20 22 3-5 3 5-3 5z"/>',
    cosmic: '<path class="frame-inlay" d="M2 40C3 12 18 4 48 3 28 8 17 18 12 34l-8 14z"/><path d="M2 44C1 16 17 4 51 2M6 41C11 17 20 12 39 9M11 47q8-20 18-24"/><path class="frame-detail" d="m23 17 2-6 2 6 6 2-6 2-2 6-2-6-6-2zm17-9 2-5 2 5-2 4z"/>',
    sakura: '<path class="frame-inlay" d="M2 35C11 13 22 6 52 3 27 14 18 24 9 46Z"/><path d="M3 48C4 18 24 7 51 3M8 37q7-15 24-22"/><path class="frame-detail" d="M18 25C9 25 9 16 14 14l3 4 4-3c6 4 3 8-3 10Zm8-8c-3-7 3-13 8-11l-1 4 5 1c0 6-7 7-12 6Zm-15 23c0-8 6-10 10-7-1 5-6 9-10 7Z"/>',
  };
  const corner = `<svg viewBox="0 0 56 56" aria-hidden="true">${designs[art.theme]}</svg>`;
  const corners = ["top-left", "top-right", "bottom-left", "bottom-right"].map(side =>
    `<span class="frame-art-corner ${side}">${corner}</span>`).join("");
  return `<span class="profile-frame-art profile-art-${art.theme}" data-art-version="${PROFILE_ART_VERSION}" data-animation-mode="${art.mode}">
    <span class="frame-art-under"></span>
    ${corners}
    <span class="frame-art-rail left"></span><span class="frame-art-rail right"></span>
    <span class="frame-art-crest"></span><span class="frame-art-accent"></span>
  </span>`;
}

function profileEffectArt(id) {
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.profileEffectArtHtml === "function") {
    const v3 = SancordCosmetics.profileEffectArtHtml(id);
    if (v3) return v3;
  }
  const art = Object.hasOwn(profileCardArt.effect, id) && profileCardArt.effect[id];
  return art ? `<svg class="profile-effect-art profile-art-${art.theme}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g>${art.paths}</g></svg>` : "";
}

const profileAvatarSources = new WeakMap();
const profileTextSources = new WeakMap();
function renderDecoratedAvatar(avatar, wrap, user) {
  if (!avatar) return;
  const label = user.username || user.display_name || "Perfil";
  const previous = profileAvatarSources.get(avatar);
  if (!previous || previous.label !== label || previous.url !== user.avatar_url || previous.animated !== user.avatar_animated) {
    avatar.innerHTML = renderAvatarInner(label, user.avatar_url, user.avatar_animated);
    profileAvatarSources.set(avatar, { label, url: user.avatar_url, animated: user.avatar_animated });
  }
  avatar.style.background = user.avatar_color || "var(--brand)";
  applyDecoToElement(wrap, user.avatar_decoration);
}

function renderProfileCardIdentity(card, slots, user, context, displayName, handle) {
  if (!card) return;
  card.dataset.profileRenderContext = context;
  const available = user.status_kind || (user.online ? "online" : "offline");
  const status = user.online === false ? "offline" : available;
  renderDecoratedAvatar(slots.avatar, slots.avatarWrap, user);
  if (slots.dot) {
    slots.dot.className = `status-badge ${status}`;
    slots.dot.setAttribute("role", "img");
    slots.dot.setAttribute("aria-label", STATUS_LABELS[status] || "Offline");
  }
  if (slots.name) slots.name.textContent = displayName || user.display_name || user.username || "Perfil";
  if (slots.handle) {
    const username = handle || `@${(user.username || "").toLowerCase()}`;
    slots.handle.textContent = !slots.pronouns && user.pronouns ? `${username} • ${user.pronouns}` : username;
  }
  if (slots.pronouns) {
    slots.pronouns.textContent = user.pronouns || "";
    slots.pronouns.hidden = !user.pronouns;
  }
  if (slots.status) {
    const customStatus = customStatusText(user);
    slots.status.textContent = customStatus || (slots.status.hasAttribute("data-custom-status-only") ? "" : STATUS_LABELS[status] || "Offline");
    slots.status.hidden = !slots.status.textContent;
  }
  if (slots.activity) {
    slots.activity.replaceChildren();
    const act = status !== "offline" && user.activity && typeof user.activity === "object" && user.activity.name ? user.activity : null;
    if (act && typeof SancordActivity !== "undefined" && typeof SancordActivity.createRichActivityCard === "function") {
      const cardEl = SancordActivity.createRichActivityCard(act, { compact: true, document: card.ownerDocument });
      if (cardEl) slots.activity.appendChild(cardEl);
    }
    slots.activity.classList.toggle("hidden", !slots.activity.childElementCount);
  }
  if (slots.bio && profileTextSources.get(slots.bio) !== (user.bio || "")) {
    renderProfileBio(slots.bio, user.bio);
    profileTextSources.set(slots.bio, user.bio || "");
  }
  if (slots.badges) {
    const badges = JSON.stringify(user.badges || []);
    if (profileTextSources.get(slots.badges) !== badges) {
      renderProfileBadges(slots.badges, user.badges);
      profileTextSources.set(slots.badges, badges);
    }
  }
  const since = card.querySelector("[data-profile-since]");
  if (since) {
    const date = user.created_at || "";
    since.querySelector("dd").textContent = date;
    since.hidden = !date;
  }
  applyProfileCardVisuals(card, slots.banner, slots.effect, null, slots.name, user);
  applyProfileFrame(card, user.profile_frame);
  setFrameReactiveState(card, user);
  refreshAnimatedMedia(card);
}

function renderProfileRoles(roleRow, roles) {
  if (!roleRow) return;
  roleRow.replaceChildren();
  for (const role of roles || []) {
    const chip = document.createElement("span");
    chip.className = "compact-profile-role";
    chip.textContent = [role.badge_emoji, role.name].filter(Boolean).join(" ");
    if (/^#[a-f0-9]{6}$/i.test(role.color || "")) chip.style.setProperty("--role-ink", role.color);
    roleRow.append(chip);
  }
  const container = roleRow.closest("[data-profile-roles]") || roleRow;
  container.classList.toggle("hidden", !roleRow.childElementCount);
}

function fillCompactProfileDetails(host, roles, links) {
  renderProfileRoles(host.querySelector(".compact-profile-roles"), roles);
  renderVisitedProfileLinks(links, host.querySelector("[data-compact-links]"), host.querySelector(".compact-profile-links"));
}

function compactProfileSlots(host) {
  const query = name => host.querySelector(`[data-profile-slot="${name}"]`);
  return { banner: query("banner"), avatar: query("avatar"), avatarWrap: query("avatar-wrap"),
    dot: query("dot"), name: query("name"), handle: query("handle"), status: query("status"), pronouns: query("pronouns"),
    activity: query("activity"), bio: query("bio"), badges: query("badges"), effect: query("effect") };
}

function buildCompactProfile(host) {
  if (host.querySelector('[data-profile-slot="banner"]')) return;
  host.innerHTML = `
    <div class="profile-card-banner" data-profile-slot="banner"></div>
    <div class="compact-profile-identity">
      <div class="profile-card-avatar-wrap" data-profile-slot="avatar-wrap">
        <div class="avatar large-avatar" data-profile-slot="avatar"></div><span class="status-badge" data-profile-slot="dot"></span>
      </div>
      <div class="compact-profile-heading"><div class="profile-nameplate-wrap"><h2 class="styled-name" data-profile-slot="name"></h2></div></div>
      <div class="compact-profile-byline">
        <small class="compact-profile-handle" data-profile-slot="handle"></small>
        <div class="profile-badges hidden" data-profile-slot="badges" aria-label="Selos"></div>
        <small class="compact-profile-pronouns" data-profile-slot="pronouns" hidden></small>
      </div>
      <p class="compact-profile-status" data-profile-slot="status" data-custom-status-only hidden></p>
      <div class="compact-profile-activity hidden" data-profile-slot="activity"></div>
      <p class="compact-profile-bio" data-profile-slot="bio"></p>
      <section class="compact-profile-section hidden" data-profile-roles>
        <h3>Cargos</h3><div class="compact-profile-roles"></div>
      </section>
      <section class="compact-profile-section hidden" data-compact-links>
        <h3>Conexões</h3><ul class="profile-public-links compact-profile-links"></ul>
      </section>
      <dl class="compact-profile-section compact-profile-since" data-profile-since hidden><dt>Membro desde</dt><dd></dd></dl>
      <label class="compact-profile-section compact-profile-note hidden">
        <span>Nota privada</span>
        <textarea class="profile-note-textarea" rows="1" maxlength="160" placeholder="Adicionar nota"></textarea>
      </label>
    </div>
    <div class="profile-effect-layer" data-profile-slot="effect" aria-hidden="true"></div>`;
}
