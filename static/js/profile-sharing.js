const profilePrivacyLabels = {
  audience: "Perfil completo", bio: "Bio", pronouns: "Pronomes", banner: "Banner",
  status: "Status personalizado", activity: "Atividade no perfil", badges: "Selos cosméticos",
  board: "Mural", connections: "Conexões",
};
const profileAudiences = {
  everyone: "Todos", shared_spaces: "Amigos e pessoas com servidor em comum",
  friends: "Somente amigos", only_me: "Somente eu",
};
const profilePrivacyForm = document.getElementById("profile-privacy-form");
const profilePrivacyFields = document.getElementById("profile-privacy-fields");
const profileOwnLinks = document.getElementById("profile-own-links");
const profileAddLink = document.getElementById("add-profile-link");
const compactProfileModal = document.getElementById("compact-profile-modal");
const compactProfileContent = document.getElementById("compact-profile-content");
const compactFullProfile = document.getElementById("compact-full-profile");
const compactMessage = document.getElementById("compact-message-profile");
let profileSharingOwner = null;
let currentCompactProfile = null;

function setProfileSharingFeedback(message) {
  document.getElementById("profile-sharing-feedback").textContent = message;
}

function sendProfileSharing(type, payload) {
  if (sendWs(type, payload)) return true;
  setProfileSharingFeedback("Conecte-se para atualizar o perfil.");
  return false;
}

const SOCIAL_PLATFORMS = {
  github: { icon: "🐙", name: "GitHub" },
  steam: { icon: "🎮", name: "Steam" },
  twitch: { icon: "📺", name: "Twitch" },
  youtube: { icon: "▶️", name: "YouTube" },
  spotify: { icon: "🎵", name: "Spotify" },
  x: { icon: "𝕏", name: "X / Twitter" },
  instagram: { icon: "📷", name: "Instagram" },
  xbox: { icon: "🎯", name: "Xbox" },
  playstation: { icon: "🕹️", name: "PlayStation" },
  tiktok: { icon: "🎬", name: "TikTok" },
  linkedin: { icon: "💼", name: "LinkedIn" },
  reddit: { icon: "💬", name: "Reddit" },
  website: { icon: "🔗", name: "Site" },
};

function cleanConnectionHost(url) {
  return (url?.hostname || "").toLowerCase().replace(/^www\./, "");
}

function resolveConnectionDisplayLabel(link, url, platKey) {
  const custom = String(link?.display_name || link?.label || "").trim();
  if (custom) return custom;
  const plat = SOCIAL_PLATFORMS[platKey];
  if (plat && platKey !== "website") return plat.name;
  return cleanConnectionHost(url) || "Link";
}

function formatConnectionTooltip(url, displayLabel) {
  const host = cleanConnectionHost(url);
  if (!host) return displayLabel;
  const rawPath = url?.pathname && url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : "";
  const compactUrl = rawPath && (host.length + rawPath.length) <= 44 ? `${host}${rawPath}` : host;
  return displayLabel && displayLabel.length > 26 ? `${displayLabel} · ${compactUrl}` : compactUrl;
}

function detectSocialPlatform(url, explicit) {
  if (explicit && Object.hasOwn(SOCIAL_PLATFORMS, explicit)) return explicit;
  const host = (url?.hostname || "").toLowerCase().replace(/^www\./, "");
  if (host === "github.com") return "github";
  if (host === "steamcommunity.com" || host === "store.steampowered.com") return "steam";
  if (host === "twitch.tv") return "twitch";
  if (host === "youtube.com" || host === "youtu.be") return "youtube";
  if (host === "open.spotify.com" || host === "spotify.com") return "spotify";
  if (host === "x.com" || host === "twitter.com") return "x";
  if (host === "instagram.com") return "instagram";
  if (host === "xbox.com" || host === "account.xbox.com") return "xbox";
  if (host === "psnprofiles.com" || host === "playstation.com") return "playstation";
  if (host === "tiktok.com") return "tiktok";
  if (host === "linkedin.com") return "linkedin";
  if (host === "reddit.com" || host === "old.reddit.com") return "reddit";
  return "website";
}

function resetProfileSharing() {
  const username = state.selfUser?.username?.toLowerCase();
  if (profileSharingOwner === username) return;
  profileSharingOwner = username;
  profilePrivacyForm.classList.add("hidden");
  profilePrivacyFields.replaceChildren();
  profileOwnLinks.replaceChildren();
  selfProfileLinks = null;
  profileAddLink.disabled = true;
  setProfileSharingFeedback("");
  resetBadgeAdminPanel();
}

function requestProfileSharing() {
  resetProfileSharing();
  if (sendProfileSharing("GetProfileSharing")) {
    setProfileSharingFeedback("Carregando preferências…");
    sendWs("GetBadgeAdminState");
  }
}

function sharingText(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function sharingButton(text, action) {
  const button = sharingText("button", text, "btn-secondary small-btn");
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

// Conexões da própria conta, para a prévia do editor mostrar só as visíveis.
let selfProfileLinks = null;

function receiveProfileSharing({ privacy, links = [] }) {
  resetProfileSharing();
  if (!privacy) return;
  selfProfileLinks = links;
  if (typeof refreshLiveProfilePreview === "function") refreshLiveProfilePreview();
  if (!profilePrivacyFields.childElementCount) {
    for (const [name, label] of Object.entries(profilePrivacyLabels)) {
      const wrapper = sharingText("label", label);
      const select = document.createElement("select");
      select.name = name;
      select.className = "settings-select";
      for (const [id, title] of Object.entries(profileAudiences)) select.add(new Option(title, id));
      wrapper.append(select);
      profilePrivacyFields.append(wrapper);
    }
  }
  for (const select of profilePrivacyFields.querySelectorAll("select")) {
    select.value = privacy[select.name] || "everyone";
  }
  profilePrivacyForm.classList.remove("hidden");
  profileAddLink.disabled = links.length >= 8;
  profileOwnLinks.replaceChildren();
  if (!links.length) profileOwnLinks.append(sharingText("li", "Nenhuma conexão cadastrada.", "settings-hint-text"));
  for (const link of links) {
    const row = document.createElement("li");
    const url = parseBoardLink(link.url);
    const platKey = detectSocialPlatform(url, link.platform);
    const plat = SOCIAL_PLATFORMS[platKey] || SOCIAL_PLATFORMS.website;
    const description = sharingText("div", `${plat.icon} ${link.label}`, "profile-link-name");
    const statusLabel = link.verified_github ? "GitHub verificado" : `${plat.name} · Link manual`;
    description.append(sharingText("small", `${url?.hostname || ""} · ${statusLabel} · ${link.visible ? "Visível" : "Oculto"}`));
    const actions = document.createElement("div");
    actions.className = "profile-link-actions";
    actions.append(
      sharingButton("Editar", () => editProfileLink(link)),
      sharingButton("Remover", async () => {
        const yes = await SancordUI.confirm({ title: "Remover conexão?", message: link.label, confirmLabel: "Remover", danger: true });
        if (yes) sendProfileSharing("RemoveProfileLink", { id: link.id });
      }),
    );
    if (url?.protocol === "https:" && url.hostname === "github.com" && /^\/[a-z0-9-]+\/?$/i.test(url.pathname) && !link.verified_github) {
      actions.append(sharingButton(link.challenge ? "Ver código" : "Verificar GitHub", () => {
        if (!link.challenge || link.challenge.expires_at <= Date.now()) {
          if (sendProfileSharing("StartGitHubProfileVerification", { id: link.id })) setProfileSharingFeedback("Gerando código de verificação…");
        } else {
          showGitHubChallenge(link, url.href);
        }
      }));
    }
    row.append(description, actions);
    profileOwnLinks.append(row);
  }
  setProfileSharingFeedback("Preferências do perfil sincronizadas.");
}

async function showGitHubChallenge(link, url) {
  const confirm = await SancordUI.formDialog({
    title: "Verificar conexão GitHub",
    description: "Coloque este código como uma palavra separada na bio pública do seu perfil GitHub. Depois de confirmar a verificação, você pode remover o código da bio.",
    fields: [
      { name: "url", label: "Perfil a verificar", value: url, readOnly: true },
      { name: "code", label: "Código válido por 20 minutos", value: link.challenge.code, readOnly: true },
    ],
    submitLabel: "Já coloquei o código",
  });
  if (confirm && sendProfileSharing("CheckGitHubProfileVerification", { id: link.id })) {
    setProfileSharingFeedback("Consultando o GitHub…");
  }
}

async function editProfileLink(link) {
  const platformOptions = [
    { value: "", label: "Detectar automaticamente" },
    ...Object.entries(SOCIAL_PLATFORMS).map(([id, info]) => ({ value: id, label: `${info.icon} ${info.name}` })),
  ];
  const values = await SancordUI.formDialog({
    title: link ? "Editar conexão" : "Adicionar link ao perfil",
    fields: [
      { name: "platform", label: "Plataforma", type: "select", value: link?.platform || "", options: platformOptions },
      { name: "label", label: "Nome exibido no perfil", placeholder: "Ex: Meu GitHub, Meu portfólio", maxlength: 60, value: link?.label, required: true },
      { name: "url", label: "Endereço HTTP ou HTTPS", maxlength: 500, value: link?.url, required: true },
      { name: "visibility", label: "Exibição", type: "select", value: link?.visible ? "show" : "hide",
        options: [{value:"hide", label:"Ocultar do perfil"}, {value:"show", label:"Mostrar conforme a privacidade do perfil"}] },
    ],
  });
  if (!values) return;
  const url = parseBoardLink(values.url.trim());
  if (!url) {
    setProfileSharingFeedback("Use um endereço HTTP ou HTTPS válido e sem credenciais.");
    return;
  }
  const payload = { id: link?.id || null, label: values.label.trim(), url: url.href, visible: values.visibility === "show" };
  if (values.platform) payload.platform = values.platform;
  sendProfileSharing("SetProfileLink", payload);
}

profileAddLink.addEventListener("click", () => editProfileLink());
profilePrivacyForm.addEventListener("submit", e => {
  e.preventDefault();
  const privacy = Object.fromEntries(new FormData(profilePrivacyForm));
  if (sendProfileSharing("SetProfilePrivacy", { privacy })) setProfileSharingFeedback("Salvando privacidade…");
});

function renderVisitedProfileLinks(links, wrap = document.getElementById("profile-card-links-wrap"),
  list = document.getElementById("profile-card-links")) {
  if (!wrap || !list) return;
  list.replaceChildren();
  for (const link of links || []) {
    if (link?.visible === false) continue;
    const url = parseBoardLink(link.url);
    if (!url) continue;
    const platKey = detectSocialPlatform(url, link.platform);
    const plat = SOCIAL_PLATFORMS[platKey] || SOCIAL_PLATFORMS.website;
    const displayLabel = resolveConnectionDisplayLabel(link, url, platKey);
    const tipText = formatConnectionTooltip(url, displayLabel);

    const row = document.createElement("li");
    row.className = "profile-connection-row";

    const anchor = document.createElement("a");
    anchor.className = "chat-link profile-connection-link";
    anchor.href = url.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.dataset.uiTooltip = tipText;
    anchor.setAttribute("aria-label", `${displayLabel} (${cleanConnectionHost(url) || url.href})`);

    const iconEl = sharingText("span", plat.icon, "profile-connection-icon");
    iconEl.setAttribute("aria-hidden", "true");
    const labelEl = sharingText("span", displayLabel, "profile-connection-label");
    anchor.append(iconEl, labelEl);

    if (link.verified_github) {
      const badge = sharingText("span", "✓", "profile-connection-verified");
      badge.setAttribute("aria-label", "GitHub verificado");
      badge.dataset.uiTooltip = "GitHub verificado";
      anchor.append(badge);
    }

    row.append(anchor);
    list.append(row);
  }
  wrap.classList.toggle("hidden", !list.childElementCount);
}

// ---------------------------------------------------------------------------
// Painel administrativo de selos (visível apenas para operadores autorizados)
// ---------------------------------------------------------------------------
const badgeAdminPanel = document.getElementById("badge-admin-panel");
const badgeAdminUser = document.getElementById("badge-admin-user");
const badgeAdminList = document.getElementById("badge-admin-list");
const badgeAdminSave = document.getElementById("badge-admin-save");
const badgeAdminFeedback = document.getElementById("badge-admin-feedback");
let badgeAdminState = { can_manage: false, grants: {}, accounts: [] };

function setBadgeAdminFeedback(msg) {
  if (badgeAdminFeedback) badgeAdminFeedback.textContent = msg || "";
}

function resetBadgeAdminPanel() {
  badgeAdminState = { can_manage: false, grants: {}, accounts: [] };
  badgeAdminPanel?.classList.add("hidden");
  badgeAdminUser?.replaceChildren();
  badgeAdminList?.replaceChildren();
  setBadgeAdminFeedback("");
}

function renderBadgeAdminSelection() {
  if (!badgeAdminUser || !badgeAdminList) return;
  const username = badgeAdminUser.value;
  const lower = username.toLowerCase();
  const granted = new Set(badgeAdminState.grants?.[lower] || []);
  const defs = state.cosmetics?.badges || [];
  badgeAdminList.replaceChildren();
  for (const def of defs) {
    const label = document.createElement("label");
    label.className = "sancord-check-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = def.id;
    cb.checked = granted.has(def.id);
    const text = document.createElement("span");
    text.textContent = `${def.name}${def.category === "trust" ? " (oficial)" : ""}`;
    label.title = def.description || "";
    label.append(cb, text);
    badgeAdminList.append(label);
  }
}

function receiveBadgeAdminState({ can_manage = false, grants = {}, accounts = [] }) {
  badgeAdminState = { can_manage: Boolean(can_manage), grants: grants || {}, accounts: accounts || [] };
  if (!badgeAdminPanel) return;
  badgeAdminPanel.classList.toggle("hidden", !badgeAdminState.can_manage);
  if (!badgeAdminState.can_manage) return;
  const previous = badgeAdminUser?.value || state.selfUser?.username || "";
  badgeAdminUser.replaceChildren();
  for (const name of badgeAdminState.accounts) {
    badgeAdminUser.add(new Option(name, name));
  }
  if (badgeAdminState.accounts.includes(previous)) badgeAdminUser.value = previous;
  renderBadgeAdminSelection();
}

badgeAdminUser?.addEventListener("change", () => {
  setBadgeAdminFeedback("");
  renderBadgeAdminSelection();
});

badgeAdminSave?.addEventListener("click", () => {
  if (!badgeAdminState.can_manage || !badgeAdminUser?.value) return;
  const badges = [...badgeAdminList.querySelectorAll("input:checked")].map((cb) => cb.value);
  if (sendWs("SetUserBadges", { target_username: badgeAdminUser.value, badges })) {
    setBadgeAdminFeedback("Salvando selos…");
  }
});

function renderCompactProfile(host, user, name, handle, preview = false) {
  buildCompactProfile(host);
  const shell = host.closest(".profile-card") || host;
  const slots = compactProfileSlots(host);
  if (!preview) slots.name.id = "compact-profile-title";
  slots.bio.classList.toggle("hidden", !user.bio);
  renderProfileCardIdentity(shell, slots, user, preview ? "editor" : "popout", name, `@${handle.toLowerCase()}`);
}

function compactServerId(fallback) {
  const server = fallback?.channel_id ? serverForChannel(fallback.channel_id) :
    state.activeView === "server" ? getActiveServer() : null;
  return server && server.id !== "sancord" ? server.id : null;
}

function drawCompactVisit(global, scope = {}) {
  const target = currentCompactProfile;
  if (!target) return;
  const server = state.servers.find(s => s.id === target.serverId);
  const user = resolveServerProfile(server, target.username, global);
  const name = memberNickname(server, target.username) || user.display_name || target.username;
  renderCompactProfile(compactProfileContent, {
    ...user,
    bio: scope.bio_visible === false ? null : user.bio,
    banner_url: scope.banner_visible === false ? null : user.banner_url,
  }, name, target.username);
  fillCompactProfileDetails(compactProfileContent, getUserServerRoles(server, target.username), scope.links);
  positionCompactProfile();
}

function positionCompactProfile() {
  const card = compactProfileModal.querySelector(".compact-profile-dialog");
  const anchor = currentCompactProfile?.anchor?.getBoundingClientRect();
  const bounds = card.getBoundingClientRect();
  card.classList.toggle("compact-profile-anchored", Boolean(anchor?.width && bounds.width));
  if (!anchor?.width || !bounds.width) return;
  const roomRight = window.innerWidth - anchor.right;
  const left = roomRight > bounds.width + 20 ? anchor.right + 12 : anchor.left - bounds.width - 12;
  card.style.setProperty("--compact-left", `${Math.max(10, Math.min(left, window.innerWidth - bounds.width - 10))}px`);
  card.style.setProperty("--compact-top", `${Math.max(40, Math.min(anchor.top - 15, window.innerHeight - bounds.height - 12))}px`);
}

function openCompactProfile(userId, fallback, anchor = document.activeElement) {
  const srvId = compactServerId(fallback);
  const srv = srvId ? (state.servers || []).find((s) => s.id === srvId) : null;
  const lower = fallback?.author_name?.toLowerCase();
  const cached = state.users.get(userId) ||
    (typeof findKnownUserByName === "function" ? findKnownUserByName(lower, srv) : findLiveUserByName(lower));
  const username = cached?.username || fallback?.author_name;
  if (!username || username === "Sanvo Bot" || username === "Sancord Bot") return;
  currentCompactProfile = { userId, username, fallback, serverId: compactServerId(fallback), trigger: document.activeElement, anchor, effectPlayed: false };
  profilePopoverModal?.classList.add("hidden");
  compactProfileModal.classList.remove("hidden");
  drawCompactVisit({ ...cached, bio: null, banner_url: null, custom_status: null, custom_status_emoji: null, pronouns: null, badges: [],
    avatar_url: cached?.avatar_url || fallback?.author_avatar,
    avatar_color: cached?.avatar_color || fallback?.author_color }, { bio_visible: false, banner_visible: false });
  const self = username.toLowerCase() === state.selfUser?.username?.toLowerCase();
  compactMessage.classList.toggle("hidden", self);
  document.getElementById("compact-edit-profile").classList.toggle("hidden", !self);
  const note = compactProfileContent.querySelector(".compact-profile-note");
  note.classList.toggle("hidden", self);
  note.querySelector("textarea").value = self ? "" : getUserProfileNote(username);
  positionCompactProfile();
  compactFullProfile.focus({ preventScroll: true });
  if (typeof queueProfileMotion === "function") queueProfileMotion();
  if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.reconcileIdleBudget === "function") {
    SancordCosmetics.reconcileIdleBudget();
  }
  sendWs("GetUserProfile", { username, server_id: currentCompactProfile.serverId });
}

function renderCompactProfileReply(p) {
  if (currentCompactProfile?.username.toLowerCase() !== p.user.username.toLowerCase() ||
      currentCompactProfile.serverId !== (p.server_id ?? null)) return;
  drawCompactVisit(p.user, p);
  if (!currentCompactProfile.effectPlayed) {
    currentCompactProfile.effectPlayed = playProfileEffect(compactProfileSlots(compactProfileContent).effect);
  }
}

function closeCompactProfile(restoreFocus = true) {
  const target = currentCompactProfile;
  currentCompactProfile = null;
  compactProfileModal.classList.add("hidden");
  stopProfileEffect(compactProfileSlots(compactProfileContent).effect);
  if (restoreFocus) target?.trigger?.focus?.({ preventScroll: true });
  return target;
}

function refreshVisibleProfiles(username) {
  const lower = username?.toLowerCase();
  if (currentCompactProfile?.username.toLowerCase() === lower) {
    sendWs("GetUserProfile", { username, server_id: currentCompactProfile.serverId });
  }
  if (currentPopoverUsername?.toLowerCase() === lower && !profilePopoverModal?.classList.contains("hidden")) requestFullProfile(username);
}

compactFullProfile.addEventListener("click", () => {
  const target = closeCompactProfile(false);
  if (target) openMemberProfilePopover(target.userId, target.fallback);
});
compactMessage.addEventListener("click", () => {
  const target = closeCompactProfile();
  if (target) sendWs("OpenDm", { target_username: target.username });
});
compactProfileContent.addEventListener("input", e => {
  if (currentCompactProfile && e.target.matches(".compact-profile-note textarea")) {
    setUserProfileNote(currentCompactProfile.username, e.target.value);
  }
});
document.getElementById("compact-close-profile").addEventListener("click", () => closeCompactProfile());
document.getElementById("compact-edit-profile").addEventListener("click", () => {
  closeCompactProfile(false);
  openSettingsModal("profile");
});
window.addEventListener("resize", () => { if (currentCompactProfile) positionCompactProfile(); });
compactProfileModal.addEventListener("click", e => { if (e.target === compactProfileModal) closeCompactProfile(); });
compactProfileModal.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeCompactProfile();
  } else if (e.key === "Tab") {
    const items = [...compactProfileModal.querySelectorAll("button, a[href], textarea")]
      .filter(item => !item.disabled && !item.closest(".hidden,[hidden]"));
    const at = items.indexOf(document.activeElement);
    if (e.shiftKey ? at <= 0 : at === items.length - 1) {
      e.preventDefault();
      (e.shiftKey ? items.at(-1) : items[0])?.focus();
    }
  }
});
