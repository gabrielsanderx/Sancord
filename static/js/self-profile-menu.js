// ============================================================================
// Sancord — Self Profile Menu (Menu rápido do próprio usuário no canto inferior)
//
// Comportamento:
//   • Clicar no avatar/nome/status no painel inferior abre/fecha este menu
//     ancorado imediatamente acima do dock (NUNCA abre Configurações direto).
//   • Engrenagem (⚙), Microfone (🎙) e Fone (🎧) continuam 100% independentes.
//   • Reutiliza renderProfileCardIdentity(..., "SELF_PROFILE_MENU") com dados
//     em cache (abertura instantânea, zero request de rede ao clicar).
//   • Ações reais: Editar perfil, Status + Status personalizado, Insígnias
//     (quando a conta possui), Minha coleção, Mudar de conta (sessões isoladas
//     por origem) e Copiar ID do usuário (apenas com Modo Desenvolvedor ON).
// ============================================================================

(function (global) {
  "use strict";

  const ACCOUNTS_STORAGE_BASE = "sancord_accounts";
  const STATUS_OPTIONS = [
    { id: "online", label: "Online", sub: "Visível como disponível" },
    { id: "idle", label: "Ausente", sub: "Inativo temporariamente" },
    { id: "dnd", label: "Não perturbe", sub: "Silencia alertas e sons de notificação" },
    { id: "invisible", label: "Invisível", sub: "Aparece offline para outras pessoas" },
  ];

  let menuEl = null;
  let submenuEl = null;
  let isOpen = false;
  let activeSubmenu = null;
  let submenuPinned = false;
  let submenuIntentTimer = null;
  let previousAccountBeforeAdd = null;

  function cancelSubmenuIntent() {
    if (submenuIntentTimer) {
      clearTimeout(submenuIntentTimer);
      submenuIntentTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Sessões multi-conta isoladas por origem (nunca mistura tokens entre contas)
  // ---------------------------------------------------------------------------
  function readBucket(storage) {
    try {
      const raw = SancordSessions.get(storage, ACCOUNTS_STORAGE_BASE);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((a) => a && typeof a.token === "string" && a.token.length > 0 && typeof a.username === "string" && a.username.trim().length > 0)
        : [];
    } catch (_) {
      return [];
    }
  }

  function writeBucket(storage, list) {
    if (!list.length) return SancordSessions.remove(storage, ACCOUNTS_STORAGE_BASE);
    return SancordSessions.set(storage, ACCOUNTS_STORAGE_BASE, JSON.stringify(list));
  }

  function listSavedAccounts() {
    const map = new Map();
    const put = (item, remember) => {
      const key = String(item.username || "").trim().toLowerCase();
      if (!key) return;
      map.set(key, {
        id: item.id || null,
        username: item.username,
        display_name: item.display_name || null,
        avatar_color: item.avatar_color || "var(--brand)",
        avatar_url: item.avatar_url || null,
        token: item.token,
        remember: Boolean(remember),
      });
    };
    for (const item of readBucket(localStorage)) put(item, true);
    for (const item of readBucket(sessionStorage)) put(item, false);

    // Garante que a conta ativa atual conste na lista mesmo se veio de sessão prévia.
    const activeToken = typeof getStoredToken === "function" ? getStoredToken() : null;
    if (activeToken && state?.selfUser?.username) {
      const lower = state.selfUser.username.toLowerCase();
      const remembered = remembersActiveSession();
      put({
        id: state.selfUser.id || null,
        username: state.selfUser.username,
        display_name: state.selfUser.display_name || null,
        avatar_color: state.selfUser.avatar_color || "var(--brand)",
        avatar_url: state.selfUser.avatar_url || null,
        token: activeToken,
      }, remembered);
    }
    return [...map.values()];
  }

  function registerSavedAccount(entry) {
    if (!entry || !entry.token || !entry.username) return;
    const lower = String(entry.username).trim().toLowerCase();
    if (!lower) return;
    const remember = entry.remember !== undefined
      ? Boolean(entry.remember)
      : remembersActiveSession();

    // Remove eventual duplicata na outra camada para evitar tokens concorrentes da mesma conta.
    const otherStore = remember ? sessionStorage : localStorage;
    const clearDuplicate = writeBucket(otherStore, readBucket(otherStore).filter((a) => a.username.toLowerCase() !== lower));

    const targetStore = remember ? localStorage : sessionStorage;
    const existing = readBucket(targetStore);
    const prev = existing.find((a) => a.username.toLowerCase() === lower) || {};
    const merged = {
      id: entry.id || prev.id || null,
      username: entry.username || prev.username,
      display_name: entry.display_name !== undefined ? entry.display_name : (prev.display_name || null),
      avatar_color: entry.avatar_color || prev.avatar_color || "var(--brand)",
      avatar_url: entry.avatar_url !== undefined ? entry.avatar_url : (prev.avatar_url || null),
      token: entry.token,
      remember,
    };
    const next = [...existing.filter((a) => a.username.toLowerCase() !== lower), merged];
    return Promise.all([clearDuplicate, writeBucket(targetStore, next)]);
  }

  function removeSavedAccount(username) {
    const lower = String(username || "").trim().toLowerCase();
    if (!lower) return;
    writeBucket(localStorage, readBucket(localStorage).filter((a) => a.username.toLowerCase() !== lower));
    writeBucket(sessionStorage, readBucket(sessionStorage).filter((a) => a.username.toLowerCase() !== lower));
  }

  function clearAllSavedAccounts() {
    SancordSessions.remove(localStorage, ACCOUNTS_STORAGE_BASE);
    SancordSessions.remove(sessionStorage, ACCOUNTS_STORAGE_BASE);
  }

  async function switchToSavedAccount(account) {
    if (!account?.token || !SancordNet.secureForAuth) return false;
    closeSelfProfileMenu();
    try {
      const res = await requestAuth("/api/session", { token: account.token });
      if (res.status === 401) {
        removeSavedAccount(account.username);
        if (typeof showErrorToast === "function") {
          showErrorToast(`A sessão de @${account.username} expirou. Faça login novamente.`);
        }
        beginAddAccountFlow(account.username, "auth.error.session");
        return false;
      }
      const data = await res.json();
      if (!data?.ok || !data?.token) {
        if (typeof showErrorToast === "function") showErrorToast("Não foi possível trocar para esta conta.");
        return false;
      }
      if (typeof leaveVoiceChannel === "function") leaveVoiceChannel();
      if (typeof closeSettingsModal === "function") closeSettingsModal();
      previousAccountBeforeAdd = null;
      if (state.selfUser?.username?.toLowerCase() !== account.username.toLowerCase()) {
        state.selfUser = null;
        if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.clearSessionState === "function") {
          SancordNotifications.clearSessionState();
        }
        SancordOutbox.bind(null);
        SancordOfflineCache.clear();
      } else SancordOutbox.suspend();
      SancordConnection.stop();
      await storeSession(data.token, data.username || account.username, account.remember);
      startAuthConnection(data.token);
      if (typeof showUiToast === "function") showUiToast(`Conta alternada para ${account.display_name || account.username}`);
      return true;
    } catch (_) {
      if (typeof showErrorToast === "function") showErrorToast("Erro de conexão ao trocar de conta.");
      return false;
    }
  }

  function beginAddAccountFlow(prefillUsername = "", error) {
    closeSelfProfileMenu();
    const curToken = typeof getStoredToken === "function" ? getStoredToken() : null;
    if (curToken && state?.selfUser?.username) {
      const remembered = remembersActiveSession();
      registerSavedAccount({
        id: state.selfUser.id,
        username: state.selfUser.username,
        display_name: state.selfUser.display_name,
        avatar_color: state.selfUser.avatar_color,
        avatar_url: state.selfUser.avatar_url,
        token: curToken,
        remember: remembered,
      });
      previousAccountBeforeAdd = {
        username: state.selfUser.username,
        token: curToken,
        remember: remembered,
      };
    }
    if (typeof leaveVoiceChannel === "function") leaveVoiceChannel();
    if (typeof closeSettingsModal === "function") closeSettingsModal();
    if (typeof state !== "undefined") state.selfUser = null;
    if (typeof SancordNotifications !== "undefined" && typeof SancordNotifications.clearSessionState === "function") {
      SancordNotifications.clearSessionState();
    }
    SancordOutbox.bind(null);
    SancordOfflineCache.clear();
    SancordConnection.stop();
    if (typeof clearStoredSession === "function") clearStoredSession();
    showAuthScreen({ username: prefillUsername, error });
    if (typeof showUiToast === "function") showUiToast("Entre com outra conta para adicioná-la ao seletor.");
  }

  async function logoutAllAccounts() {
    closeSelfProfileMenu();
    const saved = listSavedAccounts();
    const curToken = typeof getStoredToken === "function" ? getStoredToken() : null;
    const tokens = new Set(saved.map((a) => a.token).filter(Boolean));
    if (curToken) tokens.add(curToken);
    for (const token of tokens) {
      SancordNet.fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    }
    clearAllSavedAccounts();
    previousAccountBeforeAdd = null;
    if (typeof logoutAccount === "function") logoutAccount();
  }

  // ---------------------------------------------------------------------------
  // Ações de Status e Status Personalizado (realtime via UpdateProfile)
  // ---------------------------------------------------------------------------
  function applyQuickStatus(statusKind) {
    if (!state?.selfUser) return false;
    const clean = STATUS_OPTIONS.some((o) => o.id === statusKind) ? statusKind : "online";
    const sent = typeof sendWs === "function" ? sendWs("UpdateProfile", { status_kind: clean }) : false;
    if (!sent) {
      if (typeof showErrorToast === "function") showErrorToast("Sem conexão para atualizar o status.");
      return false;
    }
    state.selfUser.status_kind = clean;
    if (state.users && state.selfUser.id && state.users.has(state.selfUser.id)) {
      state.users.get(state.selfUser.id).status_kind = clean;
    }
    if (typeof profileDraft !== "undefined" && profileDraft) profileDraft.status_kind = clean;
    if (typeof updateSelfProfileUI === "function") updateSelfProfileUI();
    if (typeof renderMembersSidebar === "function") renderMembersSidebar();
    if (typeof syncSettingsModalFields === "function") syncSettingsModalFields();
    if (state.activeView === "home" && !state.activeDmId && typeof renderFriendsView === "function") {
      renderFriendsView();
    }
    closeSelfProfileMenu();
    return true;
  }

  function clearQuickCustomStatus() {
    if (!state?.selfUser) return false;
    const sent = typeof sendWs === "function"
      ? sendWs("UpdateProfile", { custom_status: "", custom_status_emoji: "", custom_status_expires_in: 0 })
      : false;
    if (!sent) {
      if (typeof showErrorToast === "function") showErrorToast("Sem conexão para limpar o status personalizado.");
      return false;
    }
    state.selfUser.custom_status = null;
    state.selfUser.custom_status_emoji = null;
    state.selfUser.custom_status_expires_at = null;
    if (state.users && state.selfUser.id && state.users.has(state.selfUser.id)) {
      const live = state.users.get(state.selfUser.id);
      live.custom_status = null;
      live.custom_status_emoji = null;
      live.custom_status_expires_at = null;
    }
    if (typeof updateSelfProfileUI === "function") updateSelfProfileUI();
    if (typeof renderMembersSidebar === "function") renderMembersSidebar();
    if (typeof syncSettingsModalFields === "function") syncSettingsModalFields();
    closeSelfProfileMenu();
    if (typeof showUiToast === "function") showUiToast("Status personalizado limpo.");
    return true;
  }

  async function openQuickCustomStatusModal() {
    if (!state?.selfUser || typeof SancordUI === "undefined" || !SancordUI.formDialog) return;
    closeSelfProfileMenu();
    const curText = typeof customStatusText === "function" && customStatusText(state.selfUser)
      ? (state.selfUser.custom_status || "")
      : "";
    const curEmoji = curText ? (state.selfUser.custom_status_emoji || "") : "";
    const values = await SancordUI.formDialog({
      title: "Definir status personalizado",
      description: "Mostre rapidamente o que você está fazendo no painel inferior e na lista de membros.",
      fields: [
        { name: "emoji", label: "EMOJI (OPCIONAL)", value: curEmoji, maxlength: 8, placeholder: "Ex: 🎮" },
        { name: "text", label: "STATUS PERSONALIZADO", value: curText, maxlength: 60, placeholder: "Ex: Jogando, Ouvindo música..." },
        {
          name: "expires_in",
          label: "LIMPAR DEPOIS DE",
          type: "select",
          value: "14400",
          options: [
            { value: "1800", label: "30 minutos" },
            { value: "3600", label: "1 hora" },
            { value: "14400", label: "4 horas" },
            { value: "86400", label: "Hoje (24 horas)" },
            { value: "0", label: "Nunca" },
          ],
        },
      ],
      submitLabel: "Salvar status",
    });
    if (!values) return;
    const text = String(values.text || "").trim().slice(0, 60);
    const emoji = text ? String(values.emoji || "").trim().slice(0, 8) : "";
    const expiresIn = text ? Math.max(0, Number(values.expires_in) || 0) : 0;
    const sent = typeof sendWs === "function"
      ? sendWs("UpdateProfile", {
          custom_status: text,
          custom_status_emoji: emoji,
          custom_status_expires_in: expiresIn,
        })
      : false;
    if (!sent) {
      if (typeof showErrorToast === "function") showErrorToast("Sem conexão para salvar o status personalizado.");
      return;
    }
    state.selfUser.custom_status = text || null;
    state.selfUser.custom_status_emoji = emoji || null;
    state.selfUser.custom_status_expires_at = text && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;
    if (state.users && state.selfUser.id && state.users.has(state.selfUser.id)) {
      const live = state.users.get(state.selfUser.id);
      live.custom_status = state.selfUser.custom_status;
      live.custom_status_emoji = state.selfUser.custom_status_emoji;
      live.custom_status_expires_at = state.selfUser.custom_status_expires_at;
    }
    if (typeof updateSelfProfileUI === "function") updateSelfProfileUI();
    if (typeof renderMembersSidebar === "function") renderMembersSidebar();
    if (typeof syncSettingsModalFields === "function") syncSettingsModalFields();
    if (typeof showUiToast === "function") showUiToast(text ? "Status personalizado atualizado!" : "Status personalizado limpo.");
  }

  // ---------------------------------------------------------------------------
  // Helpers de ícone e cópia
  // ---------------------------------------------------------------------------
  function iconHtml(name) {
    if (typeof SancordIcons !== "undefined" && SancordIcons.html) {
      return SancordIcons.html(name);
    }
    return "";
  }

  function chevronRightHtml() {
    return `<span class="spm-chevron" aria-hidden="true">${iconHtml("chevron")}</span>`;
  }

  function openProfileEditorAt(subview = null) {
    closeSelfProfileMenu();
    if (typeof openSettingsModal === "function") openSettingsModal("profile");
    if (subview && typeof openPeView === "function") {
      setTimeout(() => openPeView(subview), 0);
    }
  }

  async function copyOwnUserId(btn) {
    const id = state?.selfUser?.id;
    if (!id) return;
    if (typeof copyTextSafe === "function") {
      await copyTextSafe(id, "ID copiado ✓");
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(id).catch(() => {});
      if (typeof showUiToast === "function") showUiToast("ID copiado ✓");
    }
    if (btn) {
      const label = btn.querySelector(".spm-row-label");
      if (label) label.textContent = "ID copiado ✓";
      setTimeout(() => closeSelfProfileMenu(), 320);
    } else {
      closeSelfProfileMenu();
    }
  }

  // ---------------------------------------------------------------------------
  // Construção do Menu Principal e Submenus
  // ---------------------------------------------------------------------------
  function ensureDom() {
    if (menuEl && submenuEl) return;
    menuEl = document.createElement("div");
    menuEl.id = "self-profile-menu";
    menuEl.className = "self-profile-menu profile-card hidden";
    menuEl.setAttribute("role", "dialog");
    menuEl.setAttribute("aria-label", "Menu do seu perfil");
    menuEl.dataset.profileRenderContext = "SELF_PROFILE_MENU";
    menuEl.innerHTML =
      `<div class="spm-header">` +
        `<div class="profile-card-banner spm-banner" data-profile-slot="banner"></div>` +
        `<div class="spm-identity">` +
          `<button type="button" class="profile-card-avatar-wrap spm-avatar-wrap" data-profile-slot="avatar-wrap" aria-label="Abrir meu perfil completo">` +
            `<span class="avatar large-avatar spm-avatar" data-profile-slot="avatar">?</span>` +
            `<span class="status-badge online" data-profile-slot="dot"></span>` +
          `</button>` +
          `<div class="spm-name-block">` +
            `<div class="profile-nameplate-wrap"><strong class="styled-name spm-display-name" data-profile-slot="name">Usuário</strong></div>` +
            `<div class="spm-subline">` +
              `<span class="spm-handle" data-profile-slot="handle">@usuario</span>` +
              `<div class="profile-badges spm-badges hidden" data-profile-slot="badges" aria-label="Insígnias"></div>` +
            `</div>` +
            `<div class="spm-custom-status" data-profile-slot="status" data-custom-status-only hidden></div>` +
          `</div>` +
        `</div>` +
      `</div>` +
      `<div class="spm-body" role="menu" aria-label="Ações rápidas do perfil"></div>`;

    submenuEl = document.createElement("div");
    submenuEl.id = "self-profile-submenu";
    submenuEl.className = "self-profile-submenu hidden";
    submenuEl.setAttribute("role", "menu");

    document.body.append(menuEl, submenuEl);
    menuEl.querySelector(".spm-avatar-wrap").addEventListener("click", () => {
      const u = state.selfUser;
      if (!u) return;
      closeSelfProfileMenu();
      openMemberProfilePopover(u.id, { author_name: u.username }, { global: true });
    });
    menuEl.addEventListener("keydown", onMenuKeyDown);
    submenuEl.addEventListener("keydown", onSubmenuKeyDown);
    submenuEl.addEventListener("pointerenter", cancelSubmenuIntent);
  }

  function makeMenuRow({ id, icon, dotStatus, label, meta, hasSubmenu, action, onHoverSubmenu, danger = false, inSubmenu = false }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `spm-row${danger ? " is-danger" : ""}`;
    if (id) btn.id = id;
    btn.setAttribute("role", "menuitem");
    if (hasSubmenu) {
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", String(activeSubmenu === hasSubmenu));
      btn.dataset.spmSubmenu = hasSubmenu;
    }
    const leading = dotStatus
      ? `<span class="spm-status-dot status-badge ${dotStatus}" aria-hidden="true"></span>`
      : `<span class="spm-row-icon" aria-hidden="true">${iconHtml(icon)}</span>`;
    const metaHtml = meta ? `<span class="spm-row-meta">${escapeHtml(meta)}</span>` : "";
    const trail = hasSubmenu ? chevronRightHtml() : "";
    btn.innerHTML = `${leading}<span class="spm-row-label">${escapeHtml(label)}</span>${metaHtml}${trail}`;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelSubmenuIntent();
      if (hasSubmenu) {
        if (activeSubmenu === hasSubmenu && submenuPinned) {
          closeSubmenu();
        } else {
          submenuPinned = true;
          openSubmenu(hasSubmenu, btn);
        }
      } else if (action) {
        action(btn);
      }
    });
    if (!inSubmenu) {
      if (hasSubmenu && onHoverSubmenu) {
        btn.addEventListener("pointerenter", () => {
          cancelSubmenuIntent();
          if (activeSubmenu === hasSubmenu) return;
          if (activeSubmenu) {
            submenuIntentTimer = setTimeout(() => {
              submenuPinned = false;
              openSubmenu(hasSubmenu, btn);
            }, 220);
          } else {
            submenuPinned = false;
            openSubmenu(hasSubmenu, btn);
          }
        });
      } else {
        btn.addEventListener("pointerenter", () => {
          if (!activeSubmenu || submenuPinned) return;
          cancelSubmenuIntent();
          submenuIntentTimer = setTimeout(() => closeSubmenu(), 240);
        });
      }
    }
    return btn;
  }

  function renderSelfProfileMenuContent() {
    ensureDom();
    const u = state?.selfUser;
    if (!u) return;

    const slots = typeof compactProfileSlots === "function" ? compactProfileSlots(menuEl) : {};
    // Contexto dedicado SELF_PROFILE_MENU: reutiliza o perfil real sem disparar efeito pesado.
    if (typeof renderProfileCardIdentity === "function") {
      const noHeavyEffect = { ...u, profile_effect: "none" };
      renderProfileCardIdentity(menuEl, { ...slots, effect: null }, noHeavyEffect, "SELF_PROFILE_MENU", u.display_name || u.username);
    }

    const body = menuEl.querySelector(".spm-body");
    body.replaceChildren();

    const sk = u.status_kind || "online";
    const statusLabel = (typeof STATUS_LABELS !== "undefined" && STATUS_LABELS[sk]) || "Online";
    const devMode = Boolean(state?.audioSettings?.developerMode);

    // Card 1: Editar perfil + Status atual
    const card1 = document.createElement("div");
    card1.className = "spm-card";
    card1.append(
      makeMenuRow({
        id: "spm-edit-profile",
        icon: "edit",
        label: "Editar perfil",
        action: () => openProfileEditorAt(null),
      }),
      cardDividerEl(),
      makeMenuRow({
        id: "spm-status-trigger",
        dotStatus: sk,
        label: statusLabel,
        hasSubmenu: "status",
        onHoverSubmenu: true,
      })
    );
    body.append(card1);

    // Card 2: Mudar de conta + Copiar ID (somente com Modo Desenvolvedor ligado)
    const card2 = document.createElement("div");
    card2.className = "spm-card";
    const savedAccounts = listSavedAccounts();
    card2.append(
      makeMenuRow({
        id: "spm-accounts-trigger",
        icon: "users",
        label: "Mudar de conta",
        meta: savedAccounts.length > 1 ? String(savedAccounts.length) : "",
        hasSubmenu: "accounts",
        onHoverSubmenu: true,
      })
    );
    if (devMode) {
      card2.append(
        cardDividerEl(),
        makeMenuRow({
          id: "spm-copy-id",
          icon: "copy",
          label: "Copiar ID do usuário",
          action: (btn) => copyOwnUserId(btn),
        })
      );
    }
    body.append(card2);
  }

  function dividerEl() {
    const hr = document.createElement("div");
    hr.className = "spm-divider";
    hr.setAttribute("role", "separator");
    return hr;
  }

  function cardDividerEl() {
    const hr = document.createElement("div");
    hr.className = "spm-card-divider";
    hr.setAttribute("role", "separator");
    return hr;
  }

  // ---------------------------------------------------------------------------
  // Submenus (Status, Mudar de conta)
  // ---------------------------------------------------------------------------
  function openSubmenu(kind, anchorRow) {
    ensureDom();
    if (kind !== "status" && kind !== "accounts") {
      closeSubmenu();
      return;
    }
    activeSubmenu = kind;
    for (const row of menuEl.querySelectorAll("[data-spm-submenu]")) {
      row.setAttribute("aria-expanded", String(row.dataset.spmSubmenu === kind));
      row.classList.toggle("is-active", row.dataset.spmSubmenu === kind);
    }
    submenuEl.replaceChildren();
    submenuEl.dataset.submenuKind = kind;

    if (kind === "status") renderStatusSubmenu(submenuEl);
    else if (kind === "accounts") renderAccountsSubmenu(submenuEl);

    submenuEl.classList.remove("hidden");
    positionSubmenu(anchorRow);
  }

  function closeSubmenu() {
    cancelSubmenuIntent();
    activeSubmenu = null;
    submenuPinned = false;
    if (submenuEl) submenuEl.classList.add("hidden");
    if (menuEl) {
      for (const row of menuEl.querySelectorAll("[data-spm-submenu]")) {
        row.setAttribute("aria-expanded", "false");
        row.classList.remove("is-active");
      }
    }
  }

  function renderStatusSubmenu(host) {
    const cur = state?.selfUser?.status_kind || "online";
    for (const opt of STATUS_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `spm-row spm-status-opt${cur === opt.id ? " is-selected" : ""}`;
      btn.dataset.statusOption = opt.id;
      btn.setAttribute("role", "menuitemradio");
      btn.setAttribute("aria-checked", String(cur === opt.id));
      btn.innerHTML =
        `<span class="spm-status-dot status-badge ${opt.id}" aria-hidden="true"></span>` +
        `<span class="spm-row-stack">` +
          `<span class="spm-row-label">${escapeHtml(opt.label)}</span>` +
          `<span class="spm-row-sub">${escapeHtml(opt.sub)}</span>` +
        `</span>` +
        (cur === opt.id ? `<span class="spm-check" aria-hidden="true">${iconHtml("check")}</span>` : "");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        applyQuickStatus(opt.id);
      });
      host.append(btn);
    }
    host.append(dividerEl());

    const hasCustom = Boolean(
      typeof customStatusText === "function" ? customStatusText(state?.selfUser) : state?.selfUser?.custom_status
    );
    const setBtn = makeMenuRow({
      id: "spm-set-custom-status",
      icon: "smile",
      label: hasCustom ? "Editar status personalizado" : "Definir status personalizado",
      inSubmenu: true,
      action: () => openQuickCustomStatusModal(),
    });
    host.append(setBtn);

    if (hasCustom) {
      host.append(
        makeMenuRow({
          id: "spm-clear-custom-status",
          icon: "close",
          label: "Limpar status personalizado",
          danger: true,
          inSubmenu: true,
          action: () => clearQuickCustomStatus(),
        })
      );
    }
  }

  function renderAccountsSubmenu(host) {
    const curLower = String(state?.selfUser?.username || "").toLowerCase();
    const accounts = listSavedAccounts();
    const current = accounts.find((a) => a.username.toLowerCase() === curLower);
    const others = accounts.filter((a) => a.username.toLowerCase() !== curLower);

    const curTitle = document.createElement("div");
    curTitle.className = "spm-submenu-title";
    curTitle.textContent = "Conta atual";
    host.append(curTitle);

    if (current || state?.selfUser) {
      const a = current || state.selfUser;
      const row = document.createElement("div");
      row.className = "spm-account-row is-current";
      const avatarInner = typeof renderAvatarInner === "function"
        ? renderAvatarInner(a.username, a.avatar_url)
        : escapeHtml(String(a.username || "?").slice(0, 2).toUpperCase());
      row.innerHTML =
        `<div class="avatar spm-acct-avatar" style="background:${a.avatar_color || "var(--brand)"}">${avatarInner}</div>` +
        `<div class="spm-row-stack">` +
          `<span class="spm-row-label">${escapeHtml(a.display_name || a.username)}</span>` +
          `<span class="spm-row-sub">@${escapeHtml(String(a.username || "").toLowerCase())}</span>` +
        `</div>` +
        `<span class="spm-check" aria-hidden="true">${iconHtml("check")}</span>`;
      host.append(row);
    }

    if (others.length > 0) {
      const otherTitle = document.createElement("div");
      otherTitle.className = "spm-submenu-title";
      otherTitle.textContent = "Outras contas";
      host.append(otherTitle);

      for (const acc of others) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "spm-row spm-account-row";
        btn.setAttribute("role", "menuitem");
        const avatarInner = typeof renderAvatarInner === "function"
          ? renderAvatarInner(acc.username, acc.avatar_url)
          : escapeHtml(String(acc.username || "?").slice(0, 2).toUpperCase());
        btn.innerHTML =
          `<div class="avatar spm-acct-avatar" style="background:${acc.avatar_color || "var(--brand)"}">${avatarInner}</div>` +
          `<div class="spm-row-stack">` +
            `<span class="spm-row-label">${escapeHtml(acc.display_name || acc.username)}</span>` +
            `<span class="spm-row-sub">@${escapeHtml(String(acc.username || "").toLowerCase())}</span>` +
          `</div>`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          switchToSavedAccount(acc);
        });
        host.append(btn);
      }
    }

    host.append(dividerEl());
    host.append(
      makeMenuRow({
        id: "spm-add-account",
        icon: "user-plus",
        label: "Adicionar conta",
        inSubmenu: true,
        action: () => beginAddAccountFlow(),
      }),
      makeMenuRow({
        id: "spm-logout-all",
        icon: "logout",
        label: others.length > 0 ? "Sair de todas as contas" : "Sair da conta",
        danger: true,
        inSubmenu: true,
        action: () => logoutAllAccounts(),
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Posicionamento ancorado ao painel inferior (reposiciona no resize)
  // ---------------------------------------------------------------------------
  function positionSelfProfileMenu() {
    if (!menuEl || !isOpen) return;
    const dock = document.getElementById("self-user-profile-bar") || document.getElementById("self-profile-trigger");
    if (!dock) return;
    const rect = dock.getBoundingClientRect();
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const margin = 8;
    const minTop = typeof SancordUI?.getTopbarSafeTop === "function" ? SancordUI.getTopbarSafeTop(margin) : (document.getElementById("sancord-native-titlebar") ? 38 : margin);

    menuEl.style.left = `${margin}px`;
    menuEl.style.bottom = `${Math.max(margin, vh - rect.top + 10)}px`;
    const menuRect = menuEl.getBoundingClientRect();
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, vw - menuRect.width - margin));
    const maxBottom = Math.max(margin, vh - menuRect.height - minTop);
    const bottom = Math.min(Math.max(margin, vh - rect.top + 10), maxBottom);
    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.bottom = `${Math.round(bottom)}px`;

    if (activeSubmenu && submenuEl && !submenuEl.classList.contains("hidden")) {
      const anchor = menuEl.querySelector(`[data-spm-submenu="${activeSubmenu}"]`);
      if (anchor) positionSubmenu(anchor);
    }
  }

  function positionSubmenu(anchorRow) {
    if (!submenuEl || !menuEl || !anchorRow) return;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const margin = 8;
    const minTop = typeof SancordUI?.getTopbarSafeTop === "function" ? SancordUI.getTopbarSafeTop(margin) : (document.getElementById("sancord-native-titlebar") ? 38 : margin);
    const menuRect = menuEl.getBoundingClientRect();
    const rowRect = anchorRow.getBoundingClientRect();
    const subRect = submenuEl.getBoundingClientRect();

    let left = menuRect.right + 4;
    if (left + subRect.width + margin > vw) {
      left = Math.max(margin, menuRect.left - subRect.width - 4);
    }
    let top = rowRect.top - 8;
    if (top + subRect.height + margin > vh) {
      top = Math.max(minTop, vh - subRect.height - margin);
    }
    submenuEl.style.left = `${Math.round(left)}px`;
    submenuEl.style.top = `${Math.round(Math.max(minTop, top))}px`;
  }

  // ---------------------------------------------------------------------------
  // Abrir / Fechar / Alternar + Teclado (↑ ↓ Enter → ← Esc)
  // ---------------------------------------------------------------------------
  function openSelfProfileMenu() {
    if (!state?.selfUser) return false;
    ensureDom();
    renderSelfProfileMenuContent();
    isOpen = true;
    activeSubmenu = null;
    submenuEl.classList.add("hidden");
    menuEl.classList.remove("hidden");
    menuEl.classList.add("is-open");
    document.getElementById("self-profile-trigger")?.setAttribute("aria-expanded", "true");
    positionSelfProfileMenu();
    if (typeof queueProfileMotion === "function") queueProfileMotion();
    if (typeof SancordCosmetics !== "undefined" && typeof SancordCosmetics.reconcileIdleBudget === "function") {
      SancordCosmetics.reconcileIdleBudget();
    }
    const firstItem = menuEl.querySelector('[role="menuitem"]');
    firstItem?.focus({ preventScroll: true });
    return true;
  }

  function closeSelfProfileMenu(opts = {}) {
    if (!isOpen && (!menuEl || menuEl.classList.contains("hidden"))) return false;
    isOpen = false;
    closeSubmenu();
    if (menuEl) {
      menuEl.classList.remove("is-open");
      menuEl.classList.add("hidden");
    }
    const trigger = document.getElementById("self-profile-trigger");
    trigger?.setAttribute("aria-expanded", "false");
    if (opts.restoreFocus) trigger?.focus({ preventScroll: true });
    return true;
  }

  function toggleSelfProfileMenu() {
    return isOpen ? closeSelfProfileMenu({ restoreFocus: true }) : openSelfProfileMenu();
  }

  function isSelfProfileMenuOpen() {
    return Boolean(isOpen && menuEl && !menuEl.classList.contains("hidden"));
  }

  function refreshSelfProfileMenuIfOpen() {
    if (!isSelfProfileMenuOpen()) return;
    const prevSub = activeSubmenu;
    renderSelfProfileMenuContent();
    positionSelfProfileMenu();
    if (prevSub) {
      const anchor = menuEl.querySelector(`[data-spm-submenu="${prevSub}"]`);
      if (anchor) openSubmenu(prevSub, anchor);
      else closeSubmenu();
    }
  }

  function moveFocus(container, delta) {
    const items = [...container.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].filter((el) => !el.disabled);
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    const next = idx < 0 ? 0 : (idx + delta + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  function onMenuKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(menuEl, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(menuEl, -1);
    } else if (e.key === "ArrowRight") {
      const cur = document.activeElement?.closest?.("[data-spm-submenu]");
      if (cur) {
        e.preventDefault();
        openSubmenu(cur.dataset.spmSubmenu, cur);
        const firstSub = submenuEl.querySelector('[role="menuitem"], [role="menuitemradio"]');
        firstSub?.focus({ preventScroll: true });
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (activeSubmenu) closeSubmenu();
      else closeSelfProfileMenu({ restoreFocus: true });
    }
  }

  function onSubmenuKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(submenuEl, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(submenuEl, -1);
    } else if (e.key === "ArrowLeft" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      const prev = activeSubmenu;
      closeSubmenu();
      if (prev) menuEl.querySelector(`[data-spm-submenu="${prev}"]`)?.focus({ preventScroll: true });
    }
  }

  // Clique fora fecha o menu
  document.addEventListener("pointerdown", (e) => {
    if (!isOpen) return;
    const trigger = document.getElementById("self-profile-trigger");
    if (menuEl?.contains(e.target) || submenuEl?.contains(e.target) || trigger?.contains(e.target)) return;
    closeSelfProfileMenu();
  });

  // Esc global fecha o menu (caso o foco esteja fora dos itens)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isSelfProfileMenuOpen()) {
      e.preventDefault();
      e.stopPropagation();
      if (activeSubmenu) closeSubmenu();
      else closeSelfProfileMenu({ restoreFocus: true });
    }
  }, true);

  window.addEventListener("resize", () => {
    if (isSelfProfileMenuOpen()) positionSelfProfileMenu();
  });

  const api = {
    open: openSelfProfileMenu,
    close: closeSelfProfileMenu,
    toggle: toggleSelfProfileMenu,
    isOpen: isSelfProfileMenuOpen,
    refreshIfOpen: refreshSelfProfileMenuIfOpen,
    applyQuickStatus,
    clearQuickCustomStatus,
    openQuickCustomStatusModal,
    listSavedAccounts,
    registerSavedAccount,
    removeSavedAccount,
    clearAllSavedAccounts,
    switchToSavedAccount,
    beginAddAccountFlow,
    logoutAllAccounts,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) {
    global.SanvoSelfProfileMenu = api;
    global.SancordSelfProfileMenu = api; // LEGACY COMPATIBILITY
    global.toggleSelfProfileMenu = toggleSelfProfileMenu;
    global.closeSelfProfileMenu = closeSelfProfileMenu;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
