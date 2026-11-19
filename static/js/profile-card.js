// Receitas locais, por ID do catálogo. Os SVGs e efeitos CSS vêm embutidos no desktop.
const PROFILE_ART_VERSION = 1;
const profileCardArt = {
  avatar: {
    "core-orbit": { theme: "core", mode: "hover-loop", safeArea: 18,
      back: '<path d="M4 68C9 56 30 41 54 34s38-2 42 4" class="avatar-art-shadow"/><path d="M7 64C23 48 62 27 90 36" class="avatar-art-line"/>',
      front: '<path d="M5 67C1 78 19 86 46 79s48-20 50-37" class="avatar-art-shadow"/><path d="M7 72C12 95 87 70 96 45" class="avatar-art-line"/><path d="M11 77C25 84 48 78 60 73" class="avatar-art-highlight"/><circle cx="79" cy="63" r="2.2" class="avatar-art-spark"/>' },
    "galaxy-portal": { theme: "cosmic", mode: "hover-loop", safeArea: 21,
      back: '<path d="M11 66A43 40 0 0 1 90 31" class="avatar-art-shadow"/><path d="M11 63A43 43 0 0 1 85 25" class="avatar-art-line"/><path d="M76 10v8m-4-4h8" class="avatar-art-highlight"/>',
      front: '<path d="M9 72Q30 100 61 88Q87 78 95 42" class="avatar-art-shadow"/><path d="M12 73Q38 98 66 83Q84 71 91 52" class="avatar-art-line"/><circle cx="89" cy="57" r="2.7" class="avatar-art-spark"/><circle cx="35" cy="93" r="1.5" class="avatar-art-spark"/>' },
    "sakura-glow": { theme: "sakura", mode: "hover-loop", safeArea: 20,
      back: '<path d="M9 55Q8 20 46 13M68 14Q91 22 94 49" class="avatar-art-line"/>',
      front: '<path d="M9 62Q21 91 56 91Q80 87 95 57" class="avatar-art-line"/><path d="M15 79Q4 67 7 65Q19 62 20 74Q28 65 33 70Q33 82 20 84Z" class="avatar-art-petal"/><path d="M83 84Q75 76 81 72Q91 72 90 81Q94 72 100 76Q101 86 88 88Z" class="avatar-art-petal"/><circle cx="62" cy="94" r="2" class="avatar-art-spark"/>' },
  },
  frame: {
    "core-pulse": { theme: "core", mode: "loop" },
    "cosmic-drift": { theme: "cosmic", mode: "loop" },
    "sakura-wind": { theme: "sakura", mode: "hover-loop" },
  },
  effect: {
    "core-signal": { theme: "core", mode: "play-on-open", duration: 1500 },
    "star-trail": { theme: "cosmic", mode: "play-on-open", duration: 1500 },
    "petal-drift": { theme: "sakura", mode: "play-on-open", duration: 1500 },
  },
};

function profileAvatarArtLayer(id, depth) {
  const art = profileCardArt.avatar[id];
  if (!Object.hasOwn(profileCardArt.avatar, id)) return "";
  return `<span class="deco-svg-layer avatar-art-${depth} profile-art-${art.theme}" data-art-version="${PROFILE_ART_VERSION}" data-animation-mode="${art.mode}" style="--avatar-art-bleed:${art.safeArea}%" aria-hidden="true"><svg viewBox="0 0 100 100">${art[depth]}</svg></span>`;
}

function profileFrameArt(id) {
  const art = profileCardArt.frame[id];
  if (!Object.hasOwn(profileCardArt.frame, id)) return "";
  return `<span class="profile-frame-art profile-art-${art.theme}" data-art-version="${PROFILE_ART_VERSION}" data-animation-mode="${art.mode}">
    <span class="frame-art-under"></span>
    <span class="frame-art-corner top-left"></span><span class="frame-art-corner top-right"></span>
    <span class="frame-art-corner bottom-left"></span><span class="frame-art-corner bottom-right"></span>
    <span class="frame-art-crest"></span><span class="frame-art-accent"></span>
  </span>`;
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
  if (slots.dot) slots.dot.className = `status-badge ${status}`;
  if (slots.name) slots.name.textContent = displayName || user.display_name || user.username || "Perfil";
  if (slots.handle) {
    const username = handle || `@${(user.username || "").toLowerCase()}`;
    slots.handle.textContent = user.pronouns ? `${username} • ${user.pronouns}` : username;
  }
  if (slots.status) slots.status.textContent = customStatusText(user) || STATUS_LABELS[status] || "Offline";
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
  applyProfileCardVisuals(card, slots.banner, slots.effect, null, slots.name, user);
  applyProfileFrame(card, user.profile_frame);
  setFrameReactiveState(card, user);
  refreshAnimatedMedia(card);
}

function fillCompactProfileDetails(host, roles, links) {
  const roleRow = host.querySelector(".compact-profile-roles");
  roleRow.replaceChildren();
  for (const role of roles || []) {
    const chip = document.createElement("span");
    chip.className = "compact-profile-role";
    chip.textContent = role.name;
    if (/^#[a-f0-9]{6}$/i.test(role.color || "")) chip.style.setProperty("--role-ink", role.color);
    roleRow.append(chip);
  }
  roleRow.classList.toggle("hidden", !roleRow.childElementCount);
  const connections = host.querySelector(".compact-profile-links");
  connections.replaceChildren();
  for (const link of links || []) {
    const url = parseBoardLink(link.url);
    if (!url) continue;
    const el = document.createElement("a");
    el.textContent = link.label;
    el.href = url.href;
    el.rel = "noopener noreferrer";
    el.target = "_blank";
    connections.append(el);
  }
  connections.classList.toggle("hidden", !connections.childElementCount);
}

function compactProfileSlots(host) {
  const query = name => host.querySelector(`[data-profile-slot="${name}"]`);
  return { banner: query("banner"), avatar: query("avatar"), avatarWrap: query("avatar-wrap"),
    dot: query("dot"), name: query("name"), handle: query("handle"), status: query("status"),
    bio: query("bio"), badges: query("badges"), effect: query("effect") };
}

function buildCompactProfile(host) {
  if (host.querySelector('[data-profile-slot="banner"]')) return;
  host.innerHTML = `
    <div class="profile-card-banner" data-profile-slot="banner"></div>
    <div class="compact-profile-identity">
      <div class="profile-card-avatar-wrap" data-profile-slot="avatar-wrap">
        <div class="avatar large-avatar" data-profile-slot="avatar"></div><span class="status-badge" data-profile-slot="dot"></span>
      </div>
      <div class="compact-profile-heading">
        <div class="profile-nameplate-wrap"><h2 data-profile-slot="name"></h2></div>
        <div class="profile-badges hidden" data-profile-slot="badges" aria-label="Selos"></div>
      </div>
      <div class="compact-profile-byline">
        <small class="compact-profile-handle" data-profile-slot="handle"></small>
        <small class="compact-profile-status" data-profile-slot="status"></small>
      </div>
      <p class="compact-profile-bio" data-profile-slot="bio"></p>
      <div class="compact-profile-roles hidden" aria-label="Cargos"></div>
      <div class="compact-profile-links hidden" aria-label="Conexões"></div>
    </div>
    <div class="profile-effect-layer" data-profile-slot="effect" aria-hidden="true"></div>`;
}
