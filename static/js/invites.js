// ============================================================================
// Sistema completo de Convites de Servidores do Sancord
// Componentes reutilizáveis:
// - InviteModal (Página 1: amigos + link; Página 2: configurações do convite)
// - InvitePreviewModal (prévia completa antes de entrar + regras + erros)
// - InviteCard (hidratação ao vivo de cartões de convite nas DMs)
// - InviteManagementPage (Configurações do Servidor > Convites)
// ============================================================================
(() => {
  const inviteState = {
    serverId: null,
    channelId: null,
    currentInvite: null,
    origin: null,
    sentTo: new Set(),
    page: "main", // "main" | "settings"
    awaitingCreateFor: null,
    previewCache: new Map(), // code -> { ts, data }
    previewCode: "",
    previewData: null,
    managementInvites: [],
    managementPaused: false,
  };

  function getAuthTokenSafe() {
    try {
      if (typeof state !== "undefined" && state.authToken) return state.authToken;
      if (typeof SancordNet !== "undefined") {
        return localStorage.getItem(SancordNet.sessionKey("sancord_auth_token")) || "";
      }
    } catch (_) {}
    return "";
  }

  function extractCode(raw) {
    if (typeof SancordNet !== "undefined" && typeof SancordNet.extractInviteCode === "function") {
      return SancordNet.extractInviteCode(raw);
    }
    const txt = String(raw || "").trim();
    const idx = txt.indexOf("invite=");
    if (idx !== -1) return txt.slice(idx + 7).split(/[&#\s]/)[0].trim();
    return txt;
  }

  function buildInviteUrl(code, origin) {
    if (typeof SancordNet !== "undefined" && typeof SancordNet.inviteUrl === "function") {
      return SancordNet.inviteUrl(code, origin || SancordNet.origin);
    }
    if (typeof SancordNet !== "undefined" && typeof SancordNet.link === "function") {
      return SancordNet.link({ invite: code }, origin || SancordNet.origin);
    }
    return `sancord://open/?invite=${encodeURIComponent(code || "")}`;
  }

  function formatRemainingTime(expiresAt) {
    if (!expiresAt) return "Nunca";
    const diffMs = expiresAt - Date.now();
    if (diffMs <= 0) return "Expirado";
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `Em ${Math.max(1, mins)} min`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `Em ${hours}h`;
    const days = Math.round(hours / 24);
    return `Em ${days} dia${days === 1 ? "" : "s"}`;
  }

  function describeInviteSummary(inv) {
    if (!inv) return "Este link de convite não expira.";
    const parts = [];
    if (inv.expires_at) {
      const rem = formatRemainingTime(inv.expires_at);
      parts.push(rem === "Expirado" ? "Este link expirou." : `Seu link de convite expira ${rem.toLowerCase()}.`);
    } else {
      parts.push("Este link de convite não expira.");
    }
    if (inv.max_uses) {
      parts.push(`Máximo de ${inv.max_uses} uso${inv.max_uses === 1 ? "" : "s"} (${inv.uses || 0} usado${inv.uses === 1 ? "" : "s"}).`);
    }
    if (inv.temporary) {
      parts.push("Associação temporária ativa.");
    }
    if (inv.channel_name) {
      parts.push(`Destino: #${inv.channel_name}.`);
    }
    return parts.join(" ");
  }

  function formatDateTimePt(ts) {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "—";
    }
  }

  function statusDotClass(statusKind) {
    const k = String(statusKind || "offline").toLowerCase();
    if (k === "online" || k === "idle" || k === "dnd") return k;
    return "offline";
  }

  function collectInvitableContacts(srv) {
    const map = new Map();
    const selfLower = (state.selfUser?.username || "").toLowerCase();

    const addCandidate = (username, displayName, avatarUrl, avatarColor, statusKind, isFriend) => {
      const clean = String(username || "").trim();
      const lower = clean.toLowerCase();
      if (!lower || lower === selfLower) return;
      const existing = map.get(lower);
      if (existing) {
        if (isFriend) existing.isFriend = true;
        if (displayName && !existing.displayName) existing.displayName = displayName;
        if (avatarUrl && !existing.avatarUrl) existing.avatarUrl = avatarUrl;
        if (statusKind && statusKind !== "offline") existing.statusKind = statusKind;
        return;
      }
      map.set(lower, {
        username: clean,
        lower,
        displayName: displayName || clean,
        avatarUrl: avatarUrl || null,
        avatarColor: avatarColor || "#5865f2",
        statusKind: statusKind || "offline",
        isFriend: Boolean(isFriend),
      });
    };

    for (const f of state.friends || []) {
      const live = [...(state.users?.values?.() || [])].find(
        (u) => u.username?.toLowerCase() === (f.username || "").toLowerCase()
      );
      addCandidate(
        f.username,
        f.display_name || live?.display_name || f.username,
        f.avatar_url || live?.avatar_url,
        f.avatar_color || live?.avatar_color,
        live?.status_kind || f.status_kind || (f.online ? "online" : "offline"),
        true
      );
    }

    // Inclui contatos recentes de DMs (mesmo se ainda não forem amigos).
    for (const dm of state.dmConversations || []) {
      const uname = dm.peer_username || dm.username || dm.other_username;
      if (!uname) continue;
      const live = [...(state.users?.values?.() || [])].find(
        (u) => u.username?.toLowerCase() === uname.toLowerCase()
      );
      addCandidate(
        uname,
        dm.peer_display_name || live?.display_name || uname,
        dm.peer_avatar_url || live?.avatar_url,
        dm.peer_avatar_color || live?.avatar_color,
        live?.status_kind || "offline",
        false
      );
    }

    const memberSet = new Set(
      [...(srv?.members || []), srv?.owner_username || ""].map((m) => String(m).toLowerCase()).filter(Boolean)
    );
    const list = [...map.values()].map((c) => ({
      ...c,
      alreadyMember: memberSet.has(c.lower),
    }));

    // Online primeiro, depois amigos, depois alfabético; já-membros ao final.
    const statusOrder = { online: 0, idle: 1, dnd: 2, offline: 3 };
    list.sort((a, b) => {
      if (a.alreadyMember !== b.alreadyMember) return a.alreadyMember ? 1 : -1;
      const sa = statusOrder[statusDotClass(a.statusKind)] ?? 3;
      const sb = statusOrder[statusDotClass(b.statusKind)] ?? 3;
      if (sa !== sb) return sa - sb;
      if (a.isFriend !== b.isFriend) return a.isFriend ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, "pt-BR");
    });
    return list;
  }

  function renderInviteModalContacts(filterQuery = "") {
    const listEl = document.getElementById("invite-modal-friends-list");
    if (!listEl) return;
    const srv = (state.servers || []).find((s) => s.id === inviteState.serverId);
    listEl.innerHTML = "";
    const q = String(filterQuery || "").trim().toLowerCase();
    const contacts = collectInvitableContacts(srv).filter((c) => {
      if (!q) return true;
      return c.displayName.toLowerCase().includes(q) || c.lower.includes(q);
    });

    if (contacts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "invite-empty-state";
      const title = document.createElement("strong");
      title.textContent = q ? "Nenhum contato encontrado" : "Nenhum amigo disponível para convidar";
      const sub = document.createElement("span");
      sub.textContent = "Você ainda pode compartilhar o link abaixo.";
      empty.append(title, sub);
      listEl.appendChild(empty);
      return;
    }

    for (const c of contacts) {
      const row = document.createElement("div");
      row.className = "invite-friend-row";

      const left = document.createElement("div");
      left.className = "invite-friend-identity";
      const avatarWrap = document.createElement("div");
      avatarWrap.className = "invite-friend-avatar-wrap";
      const avatar = document.createElement("div");
      avatar.className = "avatar small-avatar";
      avatar.style.background = c.avatarColor;
      avatar.innerHTML = typeof renderAvatarInner === "function"
        ? renderAvatarInner(c.displayName, c.avatarUrl)
        : escapeHtml(c.displayName.slice(0, 2).toUpperCase());
      const dot = document.createElement("span");
      dot.className = `invite-status-dot status-${statusDotClass(c.statusKind)}`;
      avatarWrap.append(avatar, dot);

      const names = document.createElement("div");
      names.className = "invite-friend-names";
      const dn = document.createElement("strong");
      dn.textContent = c.displayName;
      const un = document.createElement("span");
      un.className = "invite-friend-handle";
      un.textContent = `@${c.username}`;
      names.append(dn, un);
      left.append(avatarWrap, names);
      row.appendChild(left);

      if (c.alreadyMember) {
        const badge = document.createElement("span");
        badge.className = "invite-member-pill";
        badge.textContent = "Já está no servidor";
        row.appendChild(badge);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        const alreadySent = inviteState.sentTo.has(c.lower);
        btn.className = alreadySent ? "btn-secondary small-btn invite-sent-btn" : "btn-primary small-btn invite-send-btn";
        btn.textContent = alreadySent ? "Enviado ✓" : "Convidar";
        btn.disabled = alreadySent;
        btn.dataset.inviteTarget = c.username;
        btn.addEventListener("click", () => {
          if (inviteState.sentTo.has(c.lower)) return;
          inviteState.sentTo.add(c.lower);
          const activeCode = inviteState.currentInvite?.code || srv?.invite_code || null;
          sendWs("InviteFriendToServer", {
            server_id: srv.id,
            target_username: c.username,
            invite_code: activeCode,
            channel_id: inviteState.channelId || null,
          });
          btn.textContent = "Enviado ✓";
          btn.disabled = true;
          btn.className = "btn-secondary small-btn invite-sent-btn";
        });
        row.appendChild(btn);
      }
      listEl.appendChild(row);
    }
  }

  function setInviteModalPage(page) {
    inviteState.page = page === "settings" ? "settings" : "main";
    document.getElementById("invite-modal-page-main")?.classList.toggle("hidden", inviteState.page !== "main");
    document.getElementById("invite-modal-page-settings")?.classList.toggle("hidden", inviteState.page !== "settings");
  }

  function updateInviteModalLinkUI() {
    const srv = (state.servers || []).find((s) => s.id === inviteState.serverId);
    const inv = inviteState.currentInvite;
    const code = inv?.code || srv?.invite_code || "";
    const link = buildInviteUrl(code, inviteState.origin);
    const linkInput = document.getElementById("invite-modal-link-input");
    const codeBadge = document.getElementById("invite-modal-code-badge");
    const note = document.getElementById("invite-modal-expiry-note");
    if (linkInput) linkInput.value = link;
    if (codeBadge) codeBadge.textContent = code;
    if (note) note.textContent = describeInviteSummary(inv);
  }

  async function openInviteServerModal(serverId = null, channelId = null) {
    const modal = document.getElementById("invite-server-modal");
    const srv = serverId
      ? (state.servers || []).find((s) => s.id === serverId)
      : (typeof getActiveServer === "function" ? getActiveServer() : null);
    if (!modal || !srv) return;

    const origin = typeof resolvePublicOriginUrl === "function"
      ? await resolvePublicOriginUrl()
      : (typeof SancordNet !== "undefined" ? SancordNet.origin : "");

    const targetChannel = channelId
      ? [...(srv.text_channels || []), ...(srv.voice_channels || [])].find((c) => c.id === channelId)
      : null;

    inviteState.serverId = srv.id;
    inviteState.channelId = targetChannel?.id || null;
    inviteState.origin = origin;
    inviteState.sentTo = new Set();
    inviteState.currentInvite = {
      code: srv.invite_code,
      server_id: srv.id,
      expires_at: null,
      max_uses: null,
      uses: 0,
      temporary: false,
      channel_id: targetChannel?.id || null,
      channel_name: targetChannel?.name || null,
      is_default: true,
    };

    const title = document.getElementById("invite-modal-title");
    const sub = document.getElementById("invite-modal-channel-pill");
    const pausedBanner = document.getElementById("invite-modal-paused-banner");
    const searchInput = document.getElementById("invite-friend-search");
    const editLinkBtn = document.getElementById("invite-modal-edit-link-btn");
    const regenBtn = document.getElementById("invite-modal-regen-btn");
    const channelSelect = document.getElementById("invite-modal-channel");
    const expirySelect = document.getElementById("invite-modal-expiry");
    const usesSelect = document.getElementById("invite-modal-max-uses");
    const tempCheck = document.getElementById("invite-modal-temporary");

    if (title) title.textContent = `Convidar amigos para ${srv.name}`;
    if (sub) {
      if (targetChannel) {
        sub.textContent = `${targetChannel.kind === "voice" ? "🔊" : "#"} ${targetChannel.name}`;
        sub.classList.remove("hidden");
      } else {
        sub.textContent = "";
        sub.classList.add("hidden");
      }
    }
    if (pausedBanner) {
      pausedBanner.classList.toggle("hidden", !srv.invites_paused);
    }

    const perms = typeof getServerPermissionsFor === "function"
      ? getServerPermissionsFor(srv, state.selfUser?.username)
      : { create_invites: true };
    const canCreate = targetChannel
      ? Boolean(typeof getChannelPermissions === "function" ? getChannelPermissions(srv, targetChannel).create_invites : perms.create_invites)
      : Boolean(perms.create_invites);
    const canEditSrv = typeof canUserEditServer === "function"
      ? canUserEditServer(srv, state.selfUser?.username)
      : false;

    editLinkBtn?.classList.toggle("hidden", !canCreate);
    regenBtn?.classList.toggle("hidden", !canEditSrv);

    if (channelSelect) {
      channelSelect.innerHTML = "";
      const defOpt = document.createElement("option");
      defOpt.value = "";
      defOpt.textContent = "Canal padrão do servidor";
      channelSelect.appendChild(defOpt);
      for (const ch of [...(srv.text_channels || []), ...(srv.voice_channels || [])]) {
        const cp = typeof getChannelPermissions === "function" ? getChannelPermissions(srv, ch) : perms;
        if (!cp.view_channel || !cp.create_invites) continue;
        const opt = document.createElement("option");
        opt.value = ch.id;
        opt.textContent = `${ch.kind === "voice" ? "🔊 " : "#"}${ch.name}`;
        if (ch.id === inviteState.channelId) opt.selected = true;
        channelSelect.appendChild(opt);
      }
    }
    if (expirySelect) expirySelect.value = "604800"; // 7 dias padrão
    if (usesSelect) usesSelect.value = "0";
    if (tempCheck) tempCheck.checked = false;
    if (searchInput) searchInput.value = "";

    updateInviteModalLinkUI();
    renderInviteModalContacts("");
    setInviteModalPage("main");
    modal.classList.remove("hidden");
    setTimeout(() => searchInput?.focus(), 30);

    // Quando aberto diretamente de um canal específico, cria automaticamente um convite de 7 dias vinculado ao canal.
    if (targetChannel && canCreate) {
      inviteState.awaitingCreateFor = srv.id;
      sendWs("CreateInvite", {
        server_id: srv.id,
        max_age_secs: 604800,
        max_uses: 0,
        channel_id: targetChannel.id,
        temporary: false,
      });
    }
  }

  function closeInviteServerModal() {
    document.getElementById("invite-server-modal")?.classList.add("hidden");
    setInviteModalPage("main");
  }

  async function onInviteCreatedV2(payload) {
    const inv = payload?.invite;
    if (!inv) return;
    const origin = typeof resolvePublicOriginUrl === "function"
      ? await resolvePublicOriginUrl()
      : (typeof SancordNet !== "undefined" ? SancordNet.origin : "");
    const modal = document.getElementById("invite-server-modal");
    const waiting = inviteState.awaitingCreateFor === inv.server_id || state.awaitingInviteFor === inv.server_id;
    if (modal && !modal.classList.contains("hidden") && waiting) {
      inviteState.origin = origin;
      inviteState.currentInvite = inv;
      inviteState.channelId = inv.channel_id || null;
      updateInviteModalLinkUI();
      setInviteModalPage("main");
      document.getElementById("invite-modal-link-input")?.select();
    }
    inviteState.awaitingCreateFor = null;
    state.awaitingInviteFor = null;
    if (typeof showUiToast === "function") showUiToast("Novo link de convite gerado!");
    if (typeof editingServerId !== "undefined" && editingServerId === inv.server_id) {
      requestServerInvitesV2(inv.server_id);
    }
  }

  // --------------------------------------------------------------------------
  // Prévia de Convite (InvitePreviewModal) + Hidratação de Cartões DM
  // --------------------------------------------------------------------------
  async function fetchInvitePreviewData(rawInput, { bypassCache = false } = {}) {
    const code = extractCode(rawInput);
    if (!code || code.length < 3) {
      return { ok: false, error_kind: "invalid", message: "Informe um código ou link de convite válido." };
    }
    const key = code.toUpperCase();
    const cached = inviteState.previewCache.get(key);
    if (!bypassCache && cached && Date.now() - cached.ts < 20_000) {
      return cached.data;
    }
    const headers = {};
    const token = getAuthTokenSafe();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await SancordNet.fetch(`/api/invites/${encodeURIComponent(code)}`, {
        cache: "no-store",
        headers,
      });
      const data = await res.json();
      inviteState.previewCache.set(key, { ts: Date.now(), data });
      return data;
    } catch (err) {
      return {
        ok: false,
        error_kind: "network",
        message: "Não foi possível verificar o convite. Verifique sua conexão.",
      };
    }
  }

  function friendlyPreviewError(data) {
    const map = {
      expired: { title: "Convite expirado", body: data?.message || "Este convite expirou." },
      revoked: { title: "Convite inválido", body: data?.message || "Este convite não é mais válido." },
      paused: { title: "Convites pausados", body: data?.message || "Convites temporariamente pausados." },
      max_uses: { title: "Limite de usos atingido", body: data?.message || "Este convite atingiu o limite de usos." },
      banned: { title: "Entrada bloqueada", body: "Você não pode entrar neste servidor." },
      unavailable: { title: "Servidor indisponível", body: data?.message || "Este servidor não está mais disponível." },
      rate_limited: { title: "Muitas tentativas", body: data?.message || "Aguarde um momento antes de tentar novamente." },
      invalid: { title: "Convite inválido", body: data?.message || "Este convite não existe ou não é mais válido." },
    };
    return map[data?.error_kind] || map.invalid;
  }

  function closeInvitePreviewModal() {
    document.getElementById("invite-preview-modal")?.classList.add("hidden");
  }

  async function openInvitePreviewModal(rawCodeOrLink) {
    const modal = document.getElementById("invite-preview-modal");
    if (!modal) return;
    const code = extractCode(rawCodeOrLink);
    inviteState.previewCode = code;
    inviteState.previewData = null;

    const loadingEl = document.getElementById("invite-preview-loading");
    const contentEl = document.getElementById("invite-preview-content");
    const errorEl = document.getElementById("invite-preview-error");
    const rulesWrap = document.getElementById("invite-preview-rules-wrap");
    const rulesText = document.getElementById("invite-preview-rules-text");
    const rulesCheck = document.getElementById("invite-preview-rules-check");
    const joinBtn = document.getElementById("invite-preview-join-btn");

    loadingEl?.classList.remove("hidden");
    contentEl?.classList.add("hidden");
    errorEl?.classList.add("hidden");
    modal.classList.remove("hidden");

    const data = await fetchInvitePreviewData(code, { bypassCache: true });
    inviteState.previewData = data;
    loadingEl?.classList.add("hidden");

    if (!data || !data.ok) {
      const err = friendlyPreviewError(data);
      const errTitle = document.getElementById("invite-preview-error-title");
      const errMsg = document.getElementById("invite-preview-error-msg");
      if (errTitle) errTitle.textContent = err.title;
      if (errMsg) errMsg.textContent = err.body;
      errorEl?.classList.remove("hidden");
      return;
    }

    const banner = document.getElementById("invite-preview-banner");
    const icon = document.getElementById("invite-preview-icon");
    const inviterEl = document.getElementById("invite-preview-inviter");
    const nameEl = document.getElementById("invite-preview-name");
    const descEl = document.getElementById("invite-preview-desc");
    const countsEl = document.getElementById("invite-preview-counts");
    const badgesEl = document.getElementById("invite-preview-badges");
    const alreadyEl = document.getElementById("invite-preview-already");

    if (banner) {
      banner.style.backgroundImage = data.banner_url ? `url("${cachedMediaUrl(data.banner_url)}")` : "";
      banner.style.backgroundColor = data.icon_color || "#5865f2";
    }
    if (icon) {
      icon.style.background = data.icon_color || "#5865f2";
      icon.innerHTML = data.icon_url
        ? `<img src="${cachedMediaUrl(data.icon_url)}" alt="${escapeHtml(data.name || "Servidor")}" />`
        : escapeHtml((data.name || "S").slice(0, 2).toUpperCase());
    }
    if (inviterEl) {
      inviterEl.textContent = data.inviter_name
        ? `${data.inviter_name} convidou você para entrar em`
        : "Você foi convidado para entrar em";
    }
    if (nameEl) nameEl.textContent = data.name || "Servidor";
    if (descEl) {
      descEl.textContent = data.description || "";
      descEl.classList.toggle("hidden", !data.description);
    }
    if (countsEl) {
      const m = data.member_count || 1;
      countsEl.innerHTML = `<span class="invite-count-pill"><span class="invite-dot-online"></span>${data.online_count || 0} online</span><span class="invite-count-pill"><span class="invite-dot-total"></span>${m} membro${m === 1 ? "" : "s"}</span>`;
    }
    if (badgesEl) {
      badgesEl.innerHTML = "";
      if (data.channel_name) {
        const chPill = document.createElement("span");
        chPill.className = "invite-meta-tag";
        chPill.textContent = `Canal: #${data.channel_name}`;
        badgesEl.appendChild(chPill);
      }
      if (data.temporary) {
        const tmpPill = document.createElement("span");
        tmpPill.className = "invite-meta-tag invite-meta-warn";
        tmpPill.textContent = "Associação temporária";
        badgesEl.appendChild(tmpPill);
      }
      if (data.expires_at) {
        const expPill = document.createElement("span");
        expPill.className = "invite-meta-tag";
        expPill.textContent = `Expira ${formatRemainingTime(data.expires_at).toLowerCase()}`;
        badgesEl.appendChild(expPill);
      }
      badgesEl.classList.toggle("hidden", !badgesEl.children.length);
    }

    const alreadyLocal = Boolean(
      data.already_member || (state.servers || []).some((s) => s.id === data.server_id)
    );
    alreadyEl?.classList.toggle("hidden", !alreadyLocal);

    const hasRules = Boolean(!alreadyLocal && data.rules_text && data.rules_text.trim());
    if (rulesWrap && rulesText && rulesCheck) {
      rulesText.textContent = data.rules_text || "";
      rulesCheck.checked = false;
      rulesWrap.classList.toggle("hidden", !hasRules);
    }

    if (joinBtn) {
      joinBtn.textContent = alreadyLocal ? "Abrir servidor" : "Entrar no servidor";
      joinBtn.disabled = hasRules;
    }

    contentEl?.classList.remove("hidden");
  }

  async function hydrateInviteCards(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    const cards = [...root.querySelectorAll(".dm-server-invite-card[data-invite-code]")];
    for (const card of cards) {
      if (card.dataset.hydrated === "1") continue;
      card.dataset.hydrated = "1";
      const code = card.dataset.inviteCode;
      if (!code) continue;
      const data = await fetchInvitePreviewData(code);
      if (!card.isConnected) continue;
      const iconEl = card.querySelector(".dm-invite-icon");
      const nameEl = card.querySelector(".dm-invite-name");
      const statsEl = card.querySelector(".dm-invite-stats");
      const btnEl = card.querySelector(".dm-join-invite-btn");
      if (!data || !data.ok) {
        card.classList.add("is-invalid");
        if (statsEl) statsEl.textContent = friendlyPreviewError(data).body;
        if (btnEl) {
          btnEl.textContent = "Indisponível";
          btnEl.disabled = true;
          btnEl.classList.remove("btn-primary");
          btnEl.classList.add("btn-secondary");
        }
        continue;
      }
      if (nameEl && data.name) nameEl.textContent = data.name;
      if (iconEl) {
        iconEl.style.background = data.icon_color || "#5865f2";
        iconEl.innerHTML = data.icon_url
          ? `<img src="${cachedMediaUrl(data.icon_url)}" alt="${escapeHtml(data.name || "S")}" />`
          : escapeHtml((data.name || "S").slice(0, 2).toUpperCase());
      }
      const m = data.member_count || 1;
      if (statsEl) {
        statsEl.textContent = `${data.online_count || 0} online • ${m} membro${m === 1 ? "" : "s"}${data.channel_name ? ` • #${data.channel_name}` : ""}`;
      }
      const already = Boolean(data.already_member || (state.servers || []).some((s) => s.id === data.server_id));
      if (btnEl) {
        btnEl.textContent = already ? "Abrir servidor" : "Entrar no servidor";
      }
    }
  }

  // --------------------------------------------------------------------------
  // Gerenciamento de Convites (Configurações do Servidor > Convites)
  // --------------------------------------------------------------------------
  function requestServerInvitesV2(serverId) {
    const list = document.getElementById("srv-invites-list");
    if (list && !list.children.length) {
      list.innerHTML = `<div class="pinned-empty">Carregando convites...</div>`;
    }
    sendWs("ListInvites", { server_id: serverId });
  }

  function showInviteDetailsDialog(inv, origin) {
    const link = buildInviteUrl(inv.code, origin);
    const lines = [
      `Código: ${inv.code}${inv.is_default ? " (Convite padrão)" : ""}`,
      `Link: ${link}`,
      `Criado por: ${inv.creator_name || inv.creator}`,
      `Criado em: ${formatDateTimePt(inv.created_at)}`,
      `Canal vinculado: ${inv.channel_name ? `#${inv.channel_name}` : "Canal padrão do servidor"}`,
      `Usos: ${inv.max_uses ? `${inv.uses || 0} / ${inv.max_uses}` : `${inv.uses || 0} / ilimitado`}`,
      `Expira em: ${inv.expires_at ? `${formatDateTimePt(inv.expires_at)} (${formatRemainingTime(inv.expires_at)})` : "Nunca"}`,
      `Associação temporária: ${inv.temporary ? "Sim" : "Não"}`,
      `Último uso: ${inv.last_used_at ? formatDateTimePt(inv.last_used_at) : "Ainda não utilizado"}`,
    ];
    if (typeof SancordUI !== "undefined" && typeof SancordUI.confirm === "function") {
      SancordUI.confirm({
        title: `Detalhes do convite ${inv.code}`,
        message: lines.join("\n"),
        confirmLabel: "Copiar link",
        cancelLabel: "Fechar",
      }).then((copy) => {
        if (copy && typeof copyTextSafe === "function") copyTextSafe(link, "Link de convite copiado!");
      });
    }
  }

  function updatePauseControlsUI(serverId, paused) {
    inviteState.managementPaused = Boolean(paused);
    const banner = document.getElementById("srv-invites-paused-banner");
    const toggleBtn = document.getElementById("srv-invites-pause-btn");
    banner?.classList.toggle("hidden", !paused);
    if (toggleBtn) {
      toggleBtn.textContent = paused ? "Retomar convites" : "Pausar convites";
      toggleBtn.classList.toggle("btn-primary", Boolean(paused));
      toggleBtn.classList.toggle("btn-secondary", !paused);
      toggleBtn.dataset.serverId = serverId || "";
    }
  }

  async function onInvitesListV2(payload) {
    const list = document.getElementById("srv-invites-list");
    if (!list || (typeof editingServerId !== "undefined" && editingServerId !== payload.server_id)) return;
    const origin = typeof resolvePublicOriginUrl === "function"
      ? await resolvePublicOriginUrl()
      : (typeof SancordNet !== "undefined" ? SancordNet.origin : "");
    const invites = payload.invites || [];
    inviteState.managementInvites = invites;
    updatePauseControlsUI(payload.server_id, Boolean(payload.invites_paused));

    list.innerHTML = "";
    if (invites.length === 0) {
      list.innerHTML = `<div class="pinned-empty">Nenhum convite ativo no momento.</div>`;
      return;
    }

    const table = document.createElement("div");
    table.className = "invite-mgmt-table";
    table.setAttribute("role", "table");

    const head = document.createElement("div");
    head.className = "invite-mgmt-head";
    head.setAttribute("role", "row");
    for (const label of ["CÓDIGO", "CRIADO POR", "CANAL", "USOS", "EXPIRAÇÃO", "AÇÕES"]) {
      const th = document.createElement("div");
      th.className = "invite-mgmt-cell";
      th.setAttribute("role", "columnheader");
      th.textContent = label;
      head.appendChild(th);
    }
    table.appendChild(head);

    for (const inv of invites) {
      const row = document.createElement("div");
      row.className = "invite-mgmt-row";
      row.setAttribute("role", "row");
      row.dataset.inviteCode = inv.code;

      const codeCell = document.createElement("div");
      codeCell.className = "invite-mgmt-cell invite-mgmt-code-cell";
      const codeStrong = document.createElement("code");
      codeStrong.className = "invite-code-text";
      codeStrong.textContent = inv.code;
      codeCell.appendChild(codeStrong);
      if (inv.is_default) {
        const tag = document.createElement("span");
        tag.className = "invite-row-badge";
        tag.textContent = "Padrão";
        codeCell.appendChild(tag);
      }
      if (inv.temporary) {
        const tag = document.createElement("span");
        tag.className = "invite-row-badge invite-row-badge-warn";
        tag.textContent = "Temp.";
        codeCell.appendChild(tag);
      }

      const creatorCell = document.createElement("div");
      creatorCell.className = "invite-mgmt-cell";
      creatorCell.textContent = inv.creator_name || inv.creator || "Sistema";

      const chCell = document.createElement("div");
      chCell.className = "invite-mgmt-cell";
      chCell.textContent = inv.channel_name ? `#${inv.channel_name}` : "Geral";

      const usesCell = document.createElement("div");
      usesCell.className = "invite-mgmt-cell";
      usesCell.textContent = inv.max_uses ? `${inv.uses || 0} / ${inv.max_uses}` : `${inv.uses || 0} / ∞`;

      const expCell = document.createElement("div");
      expCell.className = "invite-mgmt-cell";
      expCell.textContent = formatRemainingTime(inv.expires_at);
      if (inv.expires_at) expCell.title = formatDateTimePt(inv.expires_at);

      const actCell = document.createElement("div");
      actCell.className = "invite-mgmt-cell invite-mgmt-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-secondary small-btn";
      copyBtn.textContent = "Copiar";
      copyBtn.addEventListener("click", () => {
        if (typeof copyTextSafe === "function") {
          copyTextSafe(buildInviteUrl(inv.code, origin), "Link de convite copiado!");
        }
      });

      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "btn-secondary small-btn invite-more-btn";
      moreBtn.innerHTML = typeof SancordIcons !== "undefined" ? SancordIcons.html("more") : "⋯";
      moreBtn.setAttribute("aria-label", `Mais ações para convite ${inv.code}`);
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = moreBtn.getBoundingClientRect();
        const items = [
          {
            label: "Copiar link",
            icon: "🔗",
            onSelect: () => copyTextSafe(buildInviteUrl(inv.code, origin), "Link de convite copiado!"),
          },
          {
            label: "Ver detalhes",
            icon: "📄",
            onSelect: () => showInviteDetailsDialog(inv, origin),
          },
        ];
        if (!inv.is_default) {
          items.push({ separator: true });
          items.push({
            label: "Revogar convite",
            icon: "🗑️",
            danger: true,
            onSelect: async () => {
              const ok = await SancordUI.confirm({
                title: `Revogar o convite ${inv.code}?`,
                message: "Quem tiver este link não conseguirá mais entrar por ele e o código nunca será reutilizado.",
                confirmLabel: "Revogar convite",
                danger: true,
              });
              if (ok) sendWs("RevokeInvite", { server_id: payload.server_id, code: inv.code });
            },
          });
        }
        if (typeof SancordUI !== "undefined" && typeof SancordUI.contextMenu === "function") {
          SancordUI.contextMenu(rect.left, rect.bottom + 4, items, { anchor: moreBtn });
        }
      });

      actCell.append(copyBtn, moreBtn);
      row.append(codeCell, creatorCell, chCell, usesCell, expCell, actCell);
      table.appendChild(row);
    }

    list.appendChild(table);
  }

  let inviteEventsWired = false;
  function wireInviteEvents() {
    if (inviteEventsWired) return;
    inviteEventsWired = true;
    document.getElementById("close-invite-modal-btn")?.addEventListener("click", closeInviteServerModal);
    document.getElementById("close-invite-settings-btn")?.addEventListener("click", closeInviteServerModal);
    document.getElementById("invite-server-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "invite-server-modal") closeInviteServerModal();
    });

    document.getElementById("invite-friend-search")?.addEventListener("input", (e) => {
      renderInviteModalContacts(e.target.value);
    });

    document.getElementById("invite-modal-edit-link-btn")?.addEventListener("click", () => {
      setInviteModalPage("settings");
    });
    document.getElementById("invite-modal-back-btn")?.addEventListener("click", () => {
      setInviteModalPage("main");
    });
    document.getElementById("invite-modal-cancel-settings-btn")?.addEventListener("click", () => {
      setInviteModalPage("main");
    });

    document.getElementById("invite-modal-create-btn")?.addEventListener("click", () => {
      const srv = (state.servers || []).find((s) => s.id === inviteState.serverId);
      if (!srv) return;
      const maxAge = Number(document.getElementById("invite-modal-expiry")?.value || 0);
      const maxUses = Number(document.getElementById("invite-modal-max-uses")?.value || 0);
      const channelId = document.getElementById("invite-modal-channel")?.value || null;
      const temporary = Boolean(document.getElementById("invite-modal-temporary")?.checked);
      inviteState.awaitingCreateFor = srv.id;
      state.awaitingInviteFor = srv.id;
      sendWs("CreateInvite", {
        server_id: srv.id,
        max_age_secs: maxAge,
        max_uses: maxUses,
        channel_id: channelId || null,
        temporary,
      });
    });

    const copyLinkBtn = document.getElementById("invite-modal-copy-link-btn");
    copyLinkBtn?.addEventListener("click", () => {
      const val = document.getElementById("invite-modal-link-input")?.value || "";
      if (typeof copyTextSafe === "function") copyTextSafe(val, "Link de convite copiado!");
      const prev = copyLinkBtn.textContent;
      copyLinkBtn.textContent = "Copiado ✓";
      copyLinkBtn.classList.add("invite-copied");
      setTimeout(() => {
        copyLinkBtn.textContent = prev || "Copiar";
        copyLinkBtn.classList.remove("invite-copied");
      }, 1500);
    });

    document.getElementById("invite-modal-copy-code-btn")?.addEventListener("click", () => {
      const val = document.getElementById("invite-modal-code-badge")?.textContent || "";
      if (typeof copyTextSafe === "function") copyTextSafe(val, "Código copiado!");
    });

    document.getElementById("invite-modal-regen-btn")?.addEventListener("click", () => {
      const srv = (state.servers || []).find((s) => s.id === inviteState.serverId);
      if (!srv) return;
      sendWs("UpdateServer", {
        server_id: srv.id,
        name: srv.name,
        description: srv.description || null,
        icon_url: null,
        banner_url: null,
        icon_color: null,
        regenerate_invite: true,
      });
      setTimeout(() => openInviteServerModal(srv.id, inviteState.channelId), 250);
    });

    // Prévia de convite
    document.getElementById("close-invite-preview-btn")?.addEventListener("click", closeInvitePreviewModal);
    document.getElementById("invite-preview-cancel-btn")?.addEventListener("click", closeInvitePreviewModal);
    document.getElementById("invite-preview-error-close-btn")?.addEventListener("click", closeInvitePreviewModal);
    document.getElementById("invite-preview-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "invite-preview-modal") closeInvitePreviewModal();
    });
    document.getElementById("invite-preview-rules-check")?.addEventListener("change", (e) => {
      const joinBtn = document.getElementById("invite-preview-join-btn");
      if (joinBtn) joinBtn.disabled = !e.target.checked;
    });
    document.getElementById("invite-preview-join-btn")?.addEventListener("click", () => {
      const data = inviteState.previewData;
      if (!data || !data.ok) return;
      const already = Boolean(data.already_member || (state.servers || []).some((s) => s.id === data.server_id));
      if (already) {
        if (typeof switchToServerId === "function") {
          switchToServerId(data.server_id, data.channel_id || null);
        }
        closeInvitePreviewModal();
        return;
      }
      const acceptedRules = Boolean(document.getElementById("invite-preview-rules-check")?.checked);
      sendWs("JoinServerByInvite", {
        invite_code: data.code || inviteState.previewCode,
        accepted_rules: acceptedRules,
      });
      closeInvitePreviewModal();
    });

    // Gerenciamento (Configurações do Servidor > Convites)
    document.getElementById("srv-invites-create-btn")?.addEventListener("click", () => {
      const sid = typeof editingServerId !== "undefined" ? editingServerId : state.activeServerId;
      if (sid) openInviteServerModal(sid, null);
    });
    const togglePause = () => {
      const sid = typeof editingServerId !== "undefined" ? editingServerId : state.activeServerId;
      if (!sid) return;
      sendWs("SetInvitesPaused", { server_id: sid, paused: !inviteState.managementPaused });
    };
    document.getElementById("srv-invites-pause-btn")?.addEventListener("click", togglePause);
    document.getElementById("srv-invites-resume-btn")?.addEventListener("click", () => {
      const sid = typeof editingServerId !== "undefined" ? editingServerId : state.activeServerId;
      if (sid) sendWs("SetInvitesPaused", { server_id: sid, paused: false });
    });

    // Link personalizado (slug)
    const slugInput = document.getElementById("srv-custom-slug-input");
    const updateSlugPreview = () => {
      const prevEl = document.getElementById("srv-custom-slug-preview");
      const copyBtn = document.getElementById("srv-custom-slug-copy-btn");
      const clearBtn = document.getElementById("srv-custom-slug-clear-btn");
      const val = String(slugInput?.value || "").trim().toLowerCase();
      if (!val) {
        if (prevEl) prevEl.textContent = "3 a 32 caracteres: letras sem acento, números e hífen (-).";
        copyBtn?.classList.add("hidden");
        clearBtn?.classList.add("hidden");
        return;
      }
      const fallbackOrigin = inviteState.origin || (typeof SancordNet !== "undefined" ? SancordNet.origin : "");
      if (prevEl) prevEl.textContent = `Endereço: ${buildInviteUrl(val, fallbackOrigin)}`;
      copyBtn?.classList.remove("hidden");
      clearBtn?.classList.remove("hidden");
      if (typeof resolvePublicOriginUrl === "function") {
        Promise.resolve(resolvePublicOriginUrl()).then((origin) => {
          if (origin && String(slugInput?.value || "").trim().toLowerCase() === val && prevEl) {
            prevEl.textContent = `Endereço: ${buildInviteUrl(val, origin)}`;
          }
        }).catch(() => {});
      }
    };
    slugInput?.addEventListener("input", () => { updateSlugPreview(); });
    document.getElementById("srv-custom-slug-save-btn")?.addEventListener("click", () => {
      const sid = typeof editingServerId !== "undefined" ? editingServerId : state.activeServerId;
      if (!sid) return;
      const slug = String(slugInput?.value || "").trim();
      sendWs("SetCustomInviteSlug", { server_id: sid, slug: slug || null });
    });
    document.getElementById("srv-custom-slug-copy-btn")?.addEventListener("click", async () => {
      const val = String(slugInput?.value || "").trim().toLowerCase();
      if (!val) return;
      const origin = typeof resolvePublicOriginUrl === "function"
        ? await resolvePublicOriginUrl()
        : (typeof SancordNet !== "undefined" ? SancordNet.origin : "");
      if (typeof copyTextSafe === "function") copyTextSafe(buildInviteUrl(val, origin), "Link personalizado copiado!");
    });
    document.getElementById("srv-custom-slug-clear-btn")?.addEventListener("click", () => {
      const sid = typeof editingServerId !== "undefined" ? editingServerId : state.activeServerId;
      if (!sid) return;
      if (slugInput) slugInput.value = "";
      updateSlugPreview();
      sendWs("SetCustomInviteSlug", { server_id: sid, slug: null });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const invModal = document.getElementById("invite-server-modal");
      if (invModal && !invModal.classList.contains("hidden")) {
        e.stopPropagation();
        closeInviteServerModal();
        return;
      }
      const prevModal = document.getElementById("invite-preview-modal");
      if (prevModal && !prevModal.classList.contains("hidden")) {
        e.stopPropagation();
        closeInvitePreviewModal();
      }
    });
  }

  if (typeof document !== "undefined") {
    if (document.getElementById("invite-server-modal") || document.readyState !== "loading") {
      wireInviteEvents();
    } else {
      document.addEventListener("DOMContentLoaded", wireInviteEvents);
    }
  }

  function syncCustomSlugUI(srv) {
    const section = document.getElementById("srv-custom-slug-section");
    const slugInput = document.getElementById("srv-custom-slug-input");
    const prevEl = document.getElementById("srv-custom-slug-preview");
    const copyBtn = document.getElementById("srv-custom-slug-copy-btn");
    const clearBtn = document.getElementById("srv-custom-slug-clear-btn");
    if (!section || !srv) return;
    section.classList.toggle("hidden", srv.id === "sancord");
    const val = srv.custom_invite_slug || "";
    if (slugInput && slugInput !== document.activeElement) slugInput.value = val;
    copyBtn?.classList.toggle("hidden", !val);
    clearBtn?.classList.toggle("hidden", !val);
    if (prevEl) {
      if (val) {
        Promise.resolve(typeof resolvePublicOriginUrl === "function" ? resolvePublicOriginUrl() : (typeof SancordNet !== "undefined" ? SancordNet.origin : ""))
          .then((orig) => { prevEl.textContent = `Endereço: ${buildInviteUrl(val, orig)}`; });
      } else {
        prevEl.textContent = "3 a 32 caracteres: letras sem acento, números e hífen (-).";
      }
    }
  }

  window.SancordInvites = {
    openInviteModal: openInviteServerModal,
    closeInviteModal: closeInviteServerModal,
    openInvitePreview: openInvitePreviewModal,
    closeInvitePreview: closeInvitePreviewModal,
    onInviteCreated: onInviteCreatedV2,
    onInvitesList: onInvitesListV2,
    requestServerInvites: requestServerInvitesV2,
    syncCustomSlugUI,
    hydrateInviteCards,
    fetchInvitePreviewData,
    extractCode,
    buildInviteUrl,
    formatRemainingTime,
    describeInviteSummary,
    _state: inviteState,
  };
})();
