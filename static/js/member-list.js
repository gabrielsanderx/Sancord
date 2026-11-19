// ============================================================================
// Sancord — Lista Lateral de Membros (Agrupamento por Cargo Destacado / Presença)
//
// Regra central (buildMemberGroups):
//   1. Cargos destacados (hoist / display_separately) ordenados por hierarquia
//      (position decrescente), apenas para membros disponíveis (não offline).
//   2. Disponível — membros online / ausente / não perturbe sem cargo destacado.
//   3. Offline — membros offline / invisíveis.
//
// Garantias:
//   • Nenhum membro aparece duplicado.
//   • Nenhuma seção vazia é exibida.
//   • Nenhum cargo ("FUNDADOR", "BOT'S", "OWNER") é hardcoded.
//   • Cor do nome (cargo mais alto com cor) é independente de agrupamento.
// ============================================================================

(function (global) {
  "use strict";

  const OFFLINE_STATUSES = new Set(["offline", "invisible"]);
  const OWNER_CROWN_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">' +
    '<path d="M2.2 12.2h11.6l.8-6.4-3.3 2.5L8 3.2 4.7 8.3 1.4 5.8l.8 6.4Zm0 1.6h11.6a.6.6 0 0 0 .6-.6v-.5H1.6v.5c0 .33.27.6.6.6Z"/>' +
    "</svg>";

  function normalizeStatusKind(user) {
    const raw = String(user?.status_kind || "online").trim().toLowerCase();
    if (raw === "away") return "idle";
    if (raw === "online" || raw === "idle" || raw === "dnd" || raw === "offline" || raw === "invisible") {
      return raw;
    }
    return "online";
  }

  function isMemberOffline(user) {
    return OFFLINE_STATUSES.has(normalizeStatusKind(user));
  }

  function isMemberBot(user) {
    if (!user || typeof user !== "object") return false;
    return Boolean(
      user.is_bot ||
      user.bot ||
      user.is_app ||
      user.account_type === "bot" ||
      user.account_type === "app" ||
      user.author_kind === "bot"
    );
  }

  function isRoleHoisted(role) {
    if (!role || role.id === "everyone") return false;
    return Boolean(role.hoist === true || role.display_separately === true);
  }

  function sortRolesByHierarchy(roles) {
    return [...(roles || [])]
      .filter((r) => r && r.id && r.id !== "everyone")
      .sort((a, b) => {
        const diff = (Number(b.position) || 0) - (Number(a.position) || 0);
        if (diff !== 0) return diff;
        const byName = String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" });
        if (byName !== 0) return byName;
        return String(a.id).localeCompare(String(b.id));
      });
  }

  function isExplicitRoleColor(color) {
    if (typeof color !== "string") return false;
    const c = color.trim().toLowerCase();
    return Boolean(c && c !== "default" && c !== "transparent" && c !== "inherit" && c !== "none");
  }

  function resolveMemberRoleColor(sortedRoles) {
    for (const role of sortedRoles || []) {
      if (!role || role.id === "everyone") continue;
      if (isExplicitRoleColor(role.color)) return role.color.trim();
    }
    return null;
  }

  function collectMemberRoleIds(user, lowerUsername, options) {
    const out = [];
    const seen = new Set();
    const push = (id) => {
      const s = typeof id === "string" ? id : id?.id;
      if (!s || s === "everyone" || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    if (typeof options.getMemberRoleIds === "function") {
      for (const id of options.getMemberRoleIds(user, lowerUsername) || []) push(id);
    } else if (options.memberRoles && typeof options.memberRoles === "object") {
      const map = options.memberRoles;
      const list = map instanceof Map ? map.get(lowerUsername) : map[lowerUsername];
      for (const id of list || []) push(id);
    }
    if (Array.isArray(user?.role_ids)) {
      for (const id of user.role_ids) push(id);
    }
    if (Array.isArray(user?.roles)) {
      for (const item of user.roles) push(item);
    }
    return out;
  }

  function compareEntries(a, b) {
    const byDisplay = String(a.displayName || "").localeCompare(String(b.displayName || ""), "pt-BR", {
      sensitivity: "base",
    });
    if (byDisplay !== 0) return byDisplay;
    return String(a.username || "").localeCompare(String(b.username || ""), "pt-BR", {
      sensitivity: "base",
    });
  }

  /**
   * Função central de agrupamento da lista de membros.
   * Retorna: [ RoleGroup..., Available?, Offline? ] sem seções vazias e sem duplicatas.
   */
  function buildMemberGroups(members, roles, options = {}) {
    const availableLabel = options.availableLabel || "Disponível";
    const offlineLabel = options.offlineLabel || "Offline";
    const ownerLower = options.ownerUsername ? String(options.ownerUsername).trim().toLowerCase() : "";
    const roleMap = new Map();
    for (const role of roles || []) {
      if (role && role.id && role.id !== "everyone") roleMap.set(role.id, role);
    }

    const seenMembers = new Set();
    const roleBuckets = new Map();
    const availableBucket = [];
    const offlineBucket = [];

    for (const user of members || []) {
      if (!user || !user.username) continue;
      const lower = String(user.username).trim().toLowerCase();
      if (!lower || seenMembers.has(lower)) continue;
      seenMembers.add(lower);

      const roleIds = collectMemberRoleIds(user, lower, options);
      const assignedRoles = sortRolesByHierarchy(roleIds.map((id) => roleMap.get(id)).filter(Boolean));
      const topRole = assignedRoles[0] || null;
      const hoistedRole = assignedRoles.find(isRoleHoisted) || null;
      const roleColor = resolveMemberRoleColor(assignedRoles);
      const status = normalizeStatusKind(user);
      const offline = isMemberOffline(user);
      const displayName =
        (typeof options.getDisplayName === "function" ? options.getDisplayName(user, lower) : null) ||
        user.nickname ||
        user.display_name ||
        user.username;

      const entry = {
        user,
        username: user.username,
        lowerUsername: lower,
        displayName,
        status,
        offline,
        isOwner: Boolean(ownerLower && lower === ownerLower),
        isBot: isMemberBot(user),
        roles: assignedRoles,
        topRole,
        hoistedRole,
        roleColor,
      };

      if (offline) {
        offlineBucket.push(entry);
      } else if (hoistedRole) {
        if (!roleBuckets.has(hoistedRole.id)) {
          roleBuckets.set(hoistedRole.id, { role: hoistedRole, members: [] });
        }
        roleBuckets.get(hoistedRole.id).members.push(entry);
      } else {
        availableBucket.push(entry);
      }
    }

    const groups = [];

    const sortedRoleBuckets = [...roleBuckets.values()].sort((a, b) => {
      const diff = (Number(b.role.position) || 0) - (Number(a.role.position) || 0);
      if (diff !== 0) return diff;
      const byName = String(a.role.name || "").localeCompare(String(b.role.name || ""), "pt-BR", {
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
      return String(a.role.id).localeCompare(String(b.role.id));
    });

    for (const bucket of sortedRoleBuckets) {
      if (!bucket.members.length) continue;
      bucket.members.sort(compareEntries);
      groups.push({
        kind: "role",
        id: bucket.role.id,
        label: bucket.role.name,
        role: bucket.role,
        count: bucket.members.length,
        members: bucket.members,
      });
    }

    if (availableBucket.length > 0) {
      availableBucket.sort(compareEntries);
      groups.push({
        kind: "available",
        id: "available",
        label: availableLabel,
        role: null,
        count: availableBucket.length,
        members: availableBucket,
      });
    }

    if (offlineBucket.length > 0) {
      offlineBucket.sort(compareEntries);
      groups.push({
        kind: "offline",
        id: "offline",
        label: offlineLabel,
        role: null,
        count: offlineBucket.length,
        members: offlineBucket,
      });
    }

    return groups;
  }

  function resolveMemberVoiceActivity(server, user, options = {}) {
    const channelId = user?.voice_channel_id;
    if (!channelId) return "";
    const isPrivateVoice =
      typeof options.isPrivateVoiceId === "function"
        ? options.isPrivateVoiceId(channelId)
        : String(channelId).startsWith("dmvoice:") || String(channelId).startsWith("gdmvoice:");
    if (isPrivateVoice) return "";

    const channels = server?.voice_channels || options.voiceChannels || [];
    const vc = channels.find((c) => c && c.id === channelId);
    if (!vc) return "";
    if (vc.effective_permissions && vc.effective_permissions.view_channel === false) return "";
    if (typeof options.canViewChannel === "function" && !options.canViewChannel(server, vc)) return "";

    const name = vc.name || "Voz";
    if (user.screen_sharing && user.camera_on) return `🖥️📹 Tela + Câm · ${name}`;
    if (user.screen_sharing) return `🖥️ ${name}`;
    if (user.camera_on) return `📹 ${name}`;
    return `🔊 ${name}`;
  }

  function resolveMemberActivity(server, user, options = {}) {
    if (options.timeoutText) return options.timeoutText;
    if (isMemberOffline(user)) return "";
    const voiceText = resolveMemberVoiceActivity(server, user, options);
    if (voiceText) return voiceText;
    const rich = typeof user?.activity_text === "string"
      ? user.activity_text.trim()
      : typeof user?.activity === "string"
        ? user.activity.trim()
        : "";
    if (rich) return rich;
    const custom = typeof options.customStatus === "string" ? options.customStatus.trim() : "";
    if (custom) return custom;
    return "";
  }

  function MemberGroupHeader(group, doc = document) {
    const li = doc.createElement("li");
    li.className = "member-group-header member-role-group-title";
    li.dataset.groupKind = group.kind;
    li.dataset.groupId = group.id;
    li.setAttribute("role", "presentation");
    li.textContent = `${group.label} — ${group.count}`;
    return li;
  }

  function MemberItem(entry, ctx) {
    const doc = ctx.document || document;
    const u = entry.user;
    const srv = ctx.server;
    const appearance = ctx.resolveAppearance ? ctx.resolveAppearance(srv, u) : u;
    const plateCls = ctx.getNameplateClass ? ctx.getNameplateClass(appearance.nameplate_style) : "";
    const decoCls = ctx.getDecoClass ? ctx.getDecoClass(appearance.avatar_decoration) : "";
    const decoSvg = ctx.getDecoSvgHtml ? ctx.getDecoSvgHtml(appearance.avatar_decoration) : "";
    const esc = ctx.escapeHtml || ((s) => String(s ?? ""));
    const avatarInner = ctx.renderAvatarInner
      ? ctx.renderAvatarInner(u.username, appearance.avatar_url, appearance.avatar_animated)
      : esc(String(u.username || "?").slice(0, 2).toUpperCase());

    const timeoutUntil = ctx.getTimeoutUntil ? ctx.getTimeoutUntil(srv, u.username) : null;
    const timeoutText = timeoutUntil && ctx.formatTimeoutEnd
      ? `⏱️ De castigo até ${ctx.formatTimeoutEnd(timeoutUntil)}`
      : "";
    const customStatus = ctx.getCustomStatus ? ctx.getCustomStatus(u) : (u.custom_status || "");
    const activity = resolveMemberActivity(srv, u, {
      voiceChannels: ctx.voiceChannels,
      isPrivateVoiceId: ctx.isPrivateVoiceId,
      canViewChannel: ctx.canViewChannel,
      timeoutText,
      customStatus,
    });

    const li = doc.createElement("li");
    li.className = plateCls ? `member-item ${plateCls}` : "member-item";
    li.dataset.memberUsername = entry.lowerUsername;
    li.dataset.memberStatus = entry.status;
    if (entry.offline) li.classList.add("offline");
    if (timeoutUntil) li.classList.add("is-timed-out");

    const ownerBadgeHtml = entry.isOwner
      ? `<span class="member-owner-crown" title="Proprietário do servidor" aria-label="Proprietário do servidor">${OWNER_CROWN_SVG}</span>`
      : "";
    const appBadgeHtml = entry.isBot
      ? `<span class="member-app-badge" title="Aplicação / Bot">APP</span>`
      : "";
    const activityHtml = activity
      ? `<div class="member-activity">${esc(activity)}</div>`
      : "";
    const nameTitleAttr = entry.displayName !== u.username ? ` title="@${esc(u.username)}"` : "";

    li.innerHTML =
      `<div class="user-avatar-wrap member-avatar-compact ${decoCls}">` +
        `<div class="avatar" style="background: ${u.avatar_color || "var(--bg-active)"}">${avatarInner}</div>` +
        `${decoSvg}` +
        `<span class="status-badge ${entry.status}" aria-hidden="true"></span>` +
      `</div>` +
      `<div class="member-details">` +
        `<div class="member-name-row">` +
          `<div class="member-name"${nameTitleAttr}><span class="member-display-name">${esc(entry.displayName)}</span></div>` +
          `${ownerBadgeHtml}${appBadgeHtml}` +
        `</div>` +
        `${activityHtml}` +
      `</div>`;

    const nameEl = li.querySelector(".member-display-name");
    if (ctx.applyNameStyle && nameEl) {
      ctx.applyNameStyle(nameEl, appearance, entry.roleColor);
    } else if (nameEl && entry.roleColor && !entry.offline) {
      nameEl.style.color = entry.roleColor;
    }

    const statusLabel = entry.offline
      ? "Offline"
      : (ctx.statusLabels && ctx.statusLabels[entry.status]) || "Online";
    const namePart = entry.displayName !== u.username
      ? `${entry.displayName} (${u.username})`
      : u.username;
    const extraLabel = [
      entry.isOwner ? "Proprietário" : "",
      entry.isBot ? "App" : "",
      activity || statusLabel,
    ].filter(Boolean).join(", ");

    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `${namePart}, ${extraLabel}`);
    if (ctx.onOpenCompact) {
      li.addEventListener("click", () => ctx.onOpenCompact(u, li));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ctx.onOpenCompact(u, li);
        }
      });
    }
    if (ctx.onContextMenu) {
      li.addEventListener("contextmenu", (e) => ctx.onContextMenu(e, u, li));
    }
    return li;
  }

  function MemberGroup(group, ctx) {
    const doc = ctx.document || document;
    const frag = doc.createDocumentFragment();
    frag.appendChild(MemberGroupHeader(group, doc));
    for (const entry of group.members) {
      frag.appendChild(MemberItem(entry, ctx));
    }
    return frag;
  }

  function buildRenderSignature(groups, ctx) {
    const parts = [
      ctx.server?.id || "",
      ctx.threadId || "",
      ctx.emptyMode || "",
    ];
    for (const group of groups) {
      parts.push(`G:${group.kind}:${group.id}:${group.label}:${group.count}`);
      for (const entry of group.members) {
        const u = entry.user;
        const app = ctx.resolveAppearance ? ctx.resolveAppearance(ctx.server, u) : u;
        const timeoutUntil = ctx.getTimeoutUntil ? ctx.getTimeoutUntil(ctx.server, u.username) : null;
        const customStatus = ctx.getCustomStatus ? ctx.getCustomStatus(u) : (u.custom_status || "");
        const voiceText = resolveMemberVoiceActivity(ctx.server, u, {
          voiceChannels: ctx.voiceChannels,
          isPrivateVoiceId: ctx.isPrivateVoiceId,
          canViewChannel: ctx.canViewChannel,
        });
        parts.push([
          entry.lowerUsername,
          entry.displayName,
          entry.status,
          entry.isOwner ? "1" : "0",
          entry.isBot ? "1" : "0",
          entry.roleColor || "",
          u.avatar_color || "",
          app.avatar_url || "",
          app.avatar_animated ? "1" : "0",
          app.avatar_decoration || "",
          app.nameplate_style || "",
          app.name_style || "",
          app.name_color || "",
          app.name_font || "",
          app.name_effect || "",
          timeoutUntil || "",
          voiceText,
          customStatus,
          u.activity_text || u.activity || "",
        ].join("\u001f"));
      }
    }
    return parts.join("\u001e");
  }

  function MemberList(container, groups, ctx) {
    if (!container) return false;
    const sig = buildRenderSignature(groups, ctx);
    if (!ctx.force && container.dataset.renderSig === sig && container.childNodes.length > 0) {
      return false;
    }
    container.dataset.renderSig = sig;
    const doc = ctx.document || document;
    if (!groups.length) {
      container.innerHTML = ctx.emptyHtml || "";
      return true;
    }
    const frag = doc.createDocumentFragment();
    for (const group of groups) {
      frag.appendChild(MemberGroup(group, ctx));
    }
    container.replaceChildren(frag);
    return true;
  }

  const api = {
    normalizeStatusKind,
    isMemberOffline,
    isMemberBot,
    isRoleHoisted,
    sortRolesByHierarchy,
    resolveMemberRoleColor,
    resolveMemberVoiceActivity,
    resolveMemberActivity,
    buildMemberGroups,
    buildRenderSignature,
    MemberGroupHeader,
    MemberItem,
    MemberGroup,
    MemberList,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SancordMemberList = api;
    global.buildMemberGroups = buildMemberGroups;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
