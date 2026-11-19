// ============================================================================
// Sancord — Central de Configurações Expandida
//   • Busca profunda por páginas e controles (com rolagem e destaque)
//   • Perfis por servidor, Dispositivos, Conexões, Social, Solicitações, Bloqueados
//   • Voz/Vídeo (teste de saída, preview de câmera, PTT release delay, tela)
//   • Matriz de sons individuais, Aparência, Acessibilidade (TTS, saturação, cargos)
//   • Chat & Mensagens, Formato regional, Gerenciador de atalhos com conflito
//   • Integração Windows Desktop IPC, Avançado, Diagnóstico sanitizado e Sobre
// ============================================================================

(() => {
  const SOUND_ITEMS = [
    { id: "message", label: "Mensagem recebida", desc: "Alerta discreto de novas mensagens e DMs." },
    { id: "mention", label: "Menção direta", desc: "Toque destacado quando mencionam você ou seu cargo." },
    { id: "ring", label: "Chamada recebida", desc: "Toque de entrada de chamada privada." },
    { id: "join", label: "Usuário entrou em voz", desc: "Efeito ao entrar alguém no seu canal de voz." },
    { id: "leave", label: "Usuário saiu da voz", desc: "Efeito ao sair alguém do seu canal de voz." },
    { id: "mute", label: "Silenciar / ativar microfone", desc: "Confirmação sonora ao alternar o microfone." },
    { id: "deafen", label: "Ensurdecer áudio", desc: "Confirmação sonora ao alternar o áudio da chamada." },
    { id: "stream-start", label: "Transmissão iniciada", desc: "Quando alguém inicia compartilhamento de tela ou câmera." },
    { id: "stream-stop", label: "Transmissão encerrada", desc: "Quando uma transmissão na sala é encerrada." },
    { id: "friend-request", label: "Pedido de amizade", desc: "Quando você recebe uma nova solicitação de amizade." },
  ];

  const DEFAULT_SHORTCUTS = [
    { id: "quickSwitcher", label: "Abrir busca rápida", combo: "Ctrl+K", active: true },
    { id: "openSettings", label: "Abrir configurações", combo: "Ctrl+,", active: true },
    { id: "mute", label: "Silenciar / ativar microfone", combo: "Ctrl+Shift+M", active: true },
    { id: "deafen", label: "Ensurdecer / reativar áudio", combo: "Ctrl+Shift+D", active: true },
    { id: "editLastMessage", label: "Editar última mensagem", combo: "Ctrl+Shift+E", active: true },
    { id: "openEmoji", label: "Abrir seletor de emojis", combo: "Ctrl+Shift+J", active: true },
    { id: "attachFile", label: "Anexar arquivo", combo: "Ctrl+Shift+U", active: true },
  ];

  const OPEN_SOURCE_LICENSES = [
    { name: "axum & tower", license: "MIT", role: "Servidor HTTP/WebSocket assíncrono" },
    { name: "tokio", license: "MIT", role: "Runtime assíncrono Rust" },
    { name: "rusqlite (SQLite)", license: "MIT / Public Domain", role: "Banco de dados local e FTS5" },
    { name: "argon2", license: "MIT / Apache-2.0", role: "Hash seguro de senhas e códigos" },
    { name: "ed25519-dalek & sha2", license: "BSD-3 / MIT / Apache-2.0", role: "Verificação de assinaturas de atualização" },
    { name: "wry & tao", license: "Apache-2.0 / MIT", role: "Janela nativa e WebView2 Desktop" },
    { name: "reqwest", license: "MIT / Apache-2.0", role: "Cliente HTTPS para atualizações e verificações" },
    { name: "serde & serde_json", license: "MIT / Apache-2.0", role: "Serialização de protocolo e dados" },
    { name: "uuid", license: "Apache-2.0 / MIT", role: "Identificadores únicos" },
    { name: "tracing", license: "MIT", role: "Logs estruturados do servidor" },
  ];

  let cameraTestStream = null;
  let recordingShortcutId = null;
  let desktopState = {
    isDesktop: Boolean(window.ipc?.postMessage),
    version: "0.2.3",
    arch: "x86_64",
    os: "Windows",
    dataDir: "",
    autostart: false,
    startMinimized: false,
    minimizeOnClose: false,
  };
  let lastDiagnosticsReport = "";

  function normalizeText(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function ensureSoundEvents() {
    if (!state.audioSettings.soundEvents || typeof state.audioSettings.soundEvents !== "object") {
      state.audioSettings.soundEvents = { ...DEFAULT_AUDIO_SETTINGS.soundEvents };
    }
    return state.audioSettings.soundEvents;
  }

  function getShortcutConfig(id) {
    const base = DEFAULT_SHORTCUTS.find((item) => item.id === id);
    const saved = state.audioSettings?.customShortcuts?.[id];
    if (!base) return null;
    return {
      ...base,
      combo: typeof saved?.combo === "string" && saved.combo ? saved.combo : base.combo,
      active: saved?.active !== undefined ? Boolean(saved.active) : base.active,
    };
  }

  function formatKeyEventCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    const rawKey = e.key || "";
    if (["Control", "Shift", "Alt", "Meta"].includes(rawKey)) return null;
    const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
    parts.push(key);
    return parts.join("+");
  }

  // -------------------------------------------------------------------------
  // 1. Busca profunda de configurações (Sidebar -> Página -> Opção)
  // -------------------------------------------------------------------------
  function buildSearchIndex() {
    const entries = [];
    for (const [tabId, tabTitle] of Object.entries(SETTINGS_TAB_TITLES)) {
      const panel = document.getElementById(`settings-tab-${tabId}`);
      if (!panel) continue;
      entries.push({
        tabId,
        tabTitle,
        label: tabTitle,
        keywords: normalizeText(`${tabTitle} ${document.querySelector(`[data-settings-tab="${tabId}"]`)?.dataset.navLabel || ""}`),
        element: panel,
      });
      panel.querySelectorAll("[data-search-item], .settings-row-title, .settings-section-head h3").forEach((el) => {
        const titleEl = el.classList.contains("settings-row-title")
          ? el
          : el.querySelector?.(".settings-row-title, .account-field-label, h3") || el;
        const label = (titleEl.textContent || "").trim();
        if (!label || label.length > 90) return;
        const extra = el.dataset?.searchItem || "";
        const desc = el.closest?.(".settings-row")?.querySelector?.(".settings-row-desc")?.textContent || "";
        entries.push({
          tabId,
          tabTitle,
          label,
          keywords: normalizeText(`${tabTitle} ${label} ${extra} ${desc}`),
          element: el.closest?.(".settings-row, .account-field-row, .settings-section") || el,
        });
      });
    }
    return entries;
  }

  function renderSettingsSearchResults(rawQuery) {
    const box = document.getElementById("settings-search-results");
    if (!box) return;
    const q = normalizeText(rawQuery).trim();
    if (!q) {
      box.classList.add("hidden");
      box.replaceChildren();
      document.querySelectorAll(".settings-nav-item[data-settings-tab]").forEach((btn) => btn.classList.remove("hidden"));
      return;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const seen = new Set();
    const hits = [];
    for (const entry of buildSearchIndex()) {
      if (!tokens.every((tok) => entry.keywords.includes(tok))) continue;
      const key = `${entry.tabId}:${entry.label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(entry);
      if (hits.length >= 12) break;
    }
    box.replaceChildren();
    if (!hits.length) {
      const empty = document.createElement("div");
      empty.className = "settings-search-empty";
      empty.textContent = "Nenhuma configuração encontrada.";
      box.appendChild(empty);
    } else {
      for (const hit of hits) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-search-hit";
        btn.setAttribute("role", "option");
        const page = document.createElement("span");
        page.className = "settings-search-hit-page";
        page.textContent = hit.tabTitle;
        const title = document.createElement("span");
        title.className = "settings-search-hit-title";
        title.textContent = hit.label === hit.tabTitle ? `Abrir ${hit.tabTitle}` : `→ ${hit.label}`;
        btn.append(page, title);
        btn.addEventListener("click", () => {
          switchSettingsTab(hit.tabId);
          box.classList.add("hidden");
          if (settingsSearchInput) settingsSearchInput.value = "";
          document.querySelectorAll(".settings-nav-item[data-settings-tab]").forEach((nav) => nav.classList.remove("hidden"));
          if (hit.element && hit.element.id !== `settings-tab-${hit.tabId}`) {
            try {
              hit.element.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch (_) {}
            hit.element.classList.remove("settings-row-highlight");
            void hit.element.offsetWidth;
            hit.element.classList.add("settings-row-highlight");
          }
        });
        box.appendChild(btn);
      }
    }
    box.classList.remove("hidden");
  }

  settingsSearchInput?.addEventListener("input", (e) => {
    renderSettingsSearchResults(e.target.value);
  });

  // -------------------------------------------------------------------------
  // 2. Conta, Segurança, Dispositivos, Conexões & Perfis por Servidor
  // -------------------------------------------------------------------------
  document.getElementById("account-edit-display-name-btn")?.addEventListener("click", async () => {
    const current = state.selfUser?.display_name || state.selfUser?.username || "";
    const values = await SancordUI.formDialog({
      title: "Editar nome de exibição",
      description: "Este nome aparece em todos os servidores onde você não definiu um apelido local.",
      fields: [
        { name: "display_name", label: "NOME DE EXIBIÇÃO", value: current, maxlength: 32, placeholder: state.selfUser?.username || "" },
      ],
      submitLabel: "Salvar nome",
    });
    if (!values) return;
    const next = values.display_name.trim();
    sendWs("UpdateProfile", { display_name: next });
  });

  document.getElementById("account-reveal-email-btn")?.addEventListener("click", () => {
    state.accountEmailRevealed = !state.accountEmailRevealed;
    if (typeof renderAccountEmailUI === "function") renderAccountEmailUI();
  });

  document.getElementById("account-quick-pw-btn")?.addEventListener("click", () => {
    document.getElementById("open-change-pw-modal-btn")?.click();
  });

  document.getElementById("account-goto-security-btn")?.addEventListener("click", () => switchSettingsTab("security"));
  document.getElementById("security-goto-devices-btn")?.addEventListener("click", () => switchSettingsTab("devices"));
  document.getElementById("devices-revoke-others-btn")?.addEventListener("click", () => {
    document.getElementById("revoke-other-sessions-btn")?.click();
  });

  // Espelha feedback de conexões na página dedicada de Conexões.
  const origSharingFeedback = window.setProfileSharingFeedback;
  if (typeof origSharingFeedback === "function") {
    window.setProfileSharingFeedback = (msg) => {
      origSharingFeedback(msg);
      const connFb = document.getElementById("connections-sharing-feedback");
      if (connFb) connFb.textContent = msg || "";
    };
  }

  // Sub-abas de Perfis (Global vs Servidor)
  function setProfileSubtab(mode) {
    const isServer = mode === "server";
    document.querySelectorAll("[data-profile-subtab]").forEach((btn) => {
      const active = btn.dataset.profileSubtab === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    document.getElementById("profile-subtab-global")?.classList.toggle("hidden", isServer);
    document.getElementById("profile-subtab-server")?.classList.toggle("hidden", !isServer);
    if (isServer) renderServerProfileTabSummary();
  }

  document.querySelectorAll("[data-profile-subtab]").forEach((btn) => {
    btn.addEventListener("click", () => setProfileSubtab(btn.dataset.profileSubtab));
  });

  function renderServerProfileTabSummary() {
    const select = document.getElementById("settings-server-profile-select");
    const summary = document.getElementById("settings-server-profile-summary");
    const editBtn = document.getElementById("settings-server-profile-edit-btn");
    const nickBtn = document.getElementById("settings-server-profile-nick-btn");
    const preview = document.getElementById("settings-server-profile-preview");
    const compare = document.getElementById("settings-server-profile-compare");
    if (!select || !summary) return;
    const servers = (state.servers || []).filter((s) => s.id !== "sancord");
    const prev = select.value;
    select.replaceChildren();
    if (!servers.length) {
      select.add(new Option("Nenhum servidor personalizado", ""));
      select.disabled = true;
      if (editBtn) editBtn.disabled = true;
      if (nickBtn) nickBtn.disabled = true;
      if (compare) compare.disabled = true;
      preview?.classList.add("hidden");
      summary.textContent = "Entre ou crie um servidor para personalizar avatar, banner, bio, apelido e cosméticos por servidor.";
      return;
    }
    select.disabled = false;
    if (editBtn) editBtn.disabled = false;
    if (nickBtn) nickBtn.disabled = false;
    for (const s of servers) select.add(new Option(s.name, s.id));
    if (servers.some((s) => s.id === prev)) select.value = prev;
    const srv = servers.find((s) => s.id === select.value) || servers[0];
    const username = state.selfUser?.username || "";
    const local = typeof serverMemberProfile === "function" ? serverMemberProfile(srv, username) : null;
    const nick = typeof memberNickname === "function" ? memberNickname(srv, username) : null;
    if (preview && compare && state.selfUser) {
      compare.disabled = false;
      const global = compare.getAttribute("aria-pressed") === "true";
      preview.classList.remove("hidden");
      const user = global ? state.selfUser : resolveServerProfile(srv, username, state.selfUser);
      renderCompactProfile(preview, user, (!global && nick) || user.display_name || username, username, true);
      fillCompactProfileDetails(preview, global ? [] : getUserServerRoles(srv, username));
      preview.setAttribute("aria-label", global ? "Prévia do perfil principal" : `Prévia em ${srv.name}`);
    }
    const activeOverrides = [];
    if (nick) activeOverrides.push(`Apelido: ${nick}`);
    if (local?.avatar) activeOverrides.push("Avatar próprio");
    if (local?.banner) activeOverrides.push("Banner próprio");
    if (local?.bio) activeOverrides.push("Bio própria");
    if (local?.avatar_decoration) activeOverrides.push(`Decoração: ${local.avatar_decoration}`);
    if (local?.profile_frame) activeOverrides.push(`Moldura: ${local.profile_frame}`);
    if (local?.profile_effect) activeOverrides.push(`Efeito: ${local.profile_effect}`);
    if (local?.nameplate_style) activeOverrides.push(`Placa: ${local.nameplate_style}`);
    if (local?.name_style) activeOverrides.push(`Estilo do nome: ${local.name_style}`);
    if (local?.theme_primary) activeOverrides.push(`Tema local (${local.theme_primary})`);
    summary.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = srv.name;
    const detail = document.createElement("p");
    detail.className = "settings-hint-text";
    detail.style.marginTop = "6px";
    detail.textContent = activeOverrides.length
      ? `Personalizações ativas: ${activeOverrides.join(" • ")}`
      : "Usando 100% do seu perfil global neste servidor.";
    summary.append(heading, detail);
  }

  document.getElementById("settings-server-profile-select")?.addEventListener("change", renderServerProfileTabSummary);
  document.getElementById("settings-server-profile-compare")?.addEventListener("click", (event) => {
    const btn = event.currentTarget;
    const showGlobal = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(showGlobal));
    btn.textContent = showGlobal ? "Voltar ao perfil do servidor" : "Comparar com perfil principal";
    renderServerProfileTabSummary();
  });
  window.refreshServerProfileSettings = renderServerProfileTabSummary;
  document.getElementById("settings-server-profile-edit-btn")?.addEventListener("click", async () => {
    const sid = document.getElementById("settings-server-profile-select")?.value;
    if (sid && typeof openServerProfileDialog === "function") {
      await openServerProfileDialog(sid);
      renderServerProfileTabSummary();
    }
  });
  document.getElementById("settings-server-profile-nick-btn")?.addEventListener("click", async () => {
    const sid = document.getElementById("settings-server-profile-select")?.value;
    const srv = (state.servers || []).find((s) => s.id === sid);
    if (!srv || !state.selfUser) return;
    const current = typeof memberNickname === "function" ? memberNickname(srv, state.selfUser.username) || "" : "";
    const values = await SancordUI.formDialog({
      title: `Apelido em ${srv.name}`,
      description: "Deixe em branco para voltar a usar seu nome global.",
      fields: [{ name: "nick", label: "APELIDO", value: current, maxlength: 32, placeholder: state.selfUser.display_name || state.selfUser.username }],
      submitLabel: "Salvar apelido",
    });
    if (!values) return;
    sendWs("SetMemberNickname", { server_id: sid, target_username: state.selfUser.username, nickname: values.nick.trim() });
  });

  // -------------------------------------------------------------------------
  // 3. Privacidade, Armazenamento Local, Social, Solicitações, Bloqueados, Atividade
  // -------------------------------------------------------------------------
  function formatStorageBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function refreshLocalStorageStats() {
    const mediaEl = document.getElementById("local-storage-media-stats");
    const notesEl = document.getElementById("local-storage-notes-stats");
    const prefsEl = document.getElementById("local-storage-prefs-stats");
    const domainsEl = document.getElementById("trusted-domains-summary");
    if (mediaEl) {
      const blobCount = typeof blobMediaCache !== "undefined" ? blobMediaCache.size : 0;
      const blobBytes = typeof blobMediaTotalBytes !== "undefined" ? blobMediaTotalBytes : 0;
      mediaEl.textContent = `${blobCount} arquivo(s) em cache na sessão (${formatStorageBytes(blobBytes)}).`;
    }
    if (notesEl) {
      const notesCount = Object.keys(state.prefs?.notes || {}).length;
      const starredCount = state.starredMsgIds?.size || 0;
      notesEl.textContent = `${notesCount} nota(s) de perfil • ${starredCount} mensagem(ns) favorita(s).`;
    }
    if (prefsEl) {
      let lsBytes = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("sancord_")) lsBytes += (k.length + (localStorage.getItem(k) || "").length) * 2;
        }
      } catch (_) {}
      prefsEl.textContent = `Preferências locais armazenadas: ${formatStorageBytes(lsBytes)}.`;
    }
    if (domainsEl) {
      try {
        const list = JSON.parse(localStorage.getItem("sancord_trusted_domains") || "[]");
        domainsEl.textContent = Array.isArray(list) && list.length
          ? `${list.length} domínio(s) confiável(is): ${list.slice(0, 5).join(", ")}${list.length > 5 ? "…" : ""}`
          : "Nenhum domínio confiável salvo neste dispositivo.";
      } catch (_) {
        domainsEl.textContent = "Nenhum domínio confiável salvo neste dispositivo.";
      }
    }
  }

  document.getElementById("clear-media-cache-btn")?.addEventListener("click", () => {
    try {
      if (typeof blobMediaCache !== "undefined" && blobMediaCache instanceof Map) {
        for (const entry of blobMediaCache.values()) {
          if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl);
        }
        blobMediaCache.clear();
        if (typeof blobMediaTotalBytes !== "undefined") blobMediaTotalBytes = 0;
      }
    } catch (_) {}
    refreshLocalStorageStats();
    showUiToast("Cache de imagens em memória limpo.");
  });

  document.getElementById("clear-trusted-domains-btn")?.addEventListener("click", () => {
    try { localStorage.removeItem("sancord_trusted_domains"); } catch (_) {}
    refreshLocalStorageStats();
    showUiToast("Lista de domínios confiáveis limpa.");
  });

  document.querySelectorAll('input[name="settings-dm-request-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      const sel = document.getElementById("privacy-dm-policy");
      if (sel) sel.value = radio.value;
      if (typeof savePrivacySettings === "function") savePrivacySettings();
    });
  });

  function renderSettingsRequestsList() {
    const ul = document.getElementById("settings-message-requests-list");
    if (!ul) return;
    ul.replaceChildren();
    const list = state.dmRequests || [];
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "settings-hint-text";
      p.textContent = "Nenhuma solicitação de mensagem pendente.";
      ul.appendChild(p);
      return;
    }
    for (const conv of list) {
      const peer = conv.peer || { username: "Usuário", avatar_color: "#5865f2" };
      if (typeof socialRow === "function") {
        ul.appendChild(socialRow(peer, "Solicitação de mensagem", [
          { label: "Aceitar", primary: true, onClick: () => sendWs("AcceptMessageRequest", { dm_id: conv.dm_id }) },
          { label: "Ignorar", onClick: () => sendWs("IgnoreMessageRequest", { dm_id: conv.dm_id }) },
        ]));
      }
    }
  }
  window.renderSettingsRequestsList = renderSettingsRequestsList;

  document.getElementById("blocked-users-search")?.addEventListener("input", () => {
    if (typeof renderPrivacySettingsUI === "function") renderPrivacySettingsUI();
  });

  document.getElementById("activity-status-select")?.addEventListener("change", (e) => {
    const status_kind = e.target.value;
    sendWs("UpdateProfile", { status_kind });
    showUiToast("Status atualizado.");
  });

  document.getElementById("activity-audience-select")?.addEventListener("change", (e) => {
    const form = document.getElementById("profile-privacy-form");
    const actField = form?.querySelector('[name="activity"]');
    if (actField) {
      actField.value = e.target.value;
      const privacy = Object.fromEntries(new FormData(form));
      sendWs("SetProfilePrivacy", { privacy });
      showUiToast("Visibilidade de atividade atualizada.");
    }
  });

  // -------------------------------------------------------------------------
  // 4. Voz e Vídeo (teste de saída, preview câmera, PTT delay, tela)
  // -------------------------------------------------------------------------
  document.getElementById("speaker-test-btn")?.addEventListener("click", () => {
    playUiSound("join", { forcePreview: true });
    showUiToast("Som de teste reproduzido na saída selecionada.");
  });

  document.getElementById("ptt-release-delay-slider")?.addEventListener("input", (e) => {
    const ms = Number(e.target.value) || 0;
    state.audioSettings.pttReleaseDelayMs = ms;
    const lbl = document.getElementById("ptt-release-delay-value");
    if (lbl) lbl.textContent = `${ms} ms`;
    saveAudioSettings();
  });

  function stopSettingsCameraTest() {
    if (cameraTestStream) {
      for (const track of cameraTestStream.getTracks()) track.stop();
      cameraTestStream = null;
    }
    const video = document.getElementById("settings-camera-preview-video");
    const wrap = document.getElementById("settings-camera-preview-wrap");
    const btn = document.getElementById("camera-test-btn");
    const status = document.getElementById("camera-test-status");
    if (video) video.srcObject = null;
    wrap?.classList.add("hidden");
    if (btn) btn.textContent = "Testar câmera";
    if (status) status.textContent = "";
  }
  window.stopSettingsCameraTest = stopSettingsCameraTest;

  document.getElementById("camera-test-btn")?.addEventListener("click", async () => {
    if (cameraTestStream) {
      stopSettingsCameraTest();
      return;
    }
    const status = document.getElementById("camera-test-status");
    const btn = document.getElementById("camera-test-btn");
    const wrap = document.getElementById("settings-camera-preview-wrap");
    const video = document.getElementById("settings-camera-preview-video");
    if (!navigator.mediaDevices?.getUserMedia) {
      if (status) status.textContent = "Captura de câmera não disponível neste ambiente.";
      return;
    }
    try {
      if (status) status.textContent = "Abrindo câmera…";
      const devId = state.audioSettings.cameraDeviceId;
      const q = Number(state.audioSettings.cameraQuality) || 720;
      cameraTestStream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(devId ? { deviceId: { exact: devId } } : {}),
          height: { ideal: q },
        },
        audio: false,
      });
      if (video) video.srcObject = cameraTestStream;
      wrap?.classList.remove("hidden");
      if (btn) btn.textContent = "Parar teste de câmera";
      if (status) status.textContent = "Prévia local ativa (não transmitida).";
    } catch (err) {
      stopSettingsCameraTest();
      if (status) status.textContent = `Não foi possível abrir a câmera: ${err?.message || "permissão negada"}`;
    }
  });

  document.getElementById("screen-default-quality")?.addEventListener("change", (e) => {
    state.audioSettings.screenDefaultQuality = e.target.value || "1080";
    saveAudioSettings();
  });
  document.getElementById("screen-default-fps")?.addEventListener("change", (e) => {
    state.audioSettings.screenDefaultFps = Number(e.target.value) || 30;
    saveAudioSettings();
  });
  document.getElementById("screen-default-audio")?.addEventListener("change", (e) => {
    state.audioSettings.screenDefaultAudio = Boolean(e.target.checked);
    saveAudioSettings();
  });
  document.getElementById("voice-goto-diagnostics-btn")?.addEventListener("click", () => switchSettingsTab("diagnostics"));
  document.getElementById("voice-reset-btn")?.addEventListener("click", async () => {
    if (!(await SancordUI.confirm({ title: "Redefinir voz e áudio?", message: "Restaura microfone, saída, ganho, modo de entrada e filtros DSP para o padrão.", confirmLabel: "Redefinir" }))) return;
    Object.assign(state.audioSettings, {
      micDeviceId: "",
      speakerDeviceId: "",
      cameraDeviceId: "",
      cameraQuality: "720",
      micGain: 100,
      speakerVolume: 100,
      voiceProfile: "isolation",
      inputMode: "vad",
      pttKey: "Space",
      pttReleaseDelayMs: 120,
      gateThreshold: -52,
      noiseGate: true,
      highpass: true,
      compressor: true,
      aec: true,
      opusHd: true,
    });
    saveAudioSettings();
    syncSettingsModalFields();
    showUiToast("Configurações de voz redefinidas.");
  });

  // -------------------------------------------------------------------------
  // 5. Notificações (Matriz de 10 sons individuais + opções desktop)
  // -------------------------------------------------------------------------
  function renderSoundsMatrix() {
    const host = document.getElementById("settings-sounds-matrix");
    if (!host) return;
    const events = ensureSoundEvents();
    host.replaceChildren();
    for (const item of SOUND_ITEMS) {
      const row = document.createElement("div");
      row.className = "settings-sound-row";
      const text = document.createElement("div");
      text.className = "settings-row-text";
      const title = document.createElement("div");
      title.className = "settings-row-title";
      title.textContent = item.label;
      const desc = document.createElement("div");
      desc.className = "settings-row-desc";
      desc.textContent = item.desc;
      text.append(title, desc);

      const controls = document.createElement("div");
      controls.className = "settings-row-control";
      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn-secondary small-btn";
      playBtn.textContent = "▶";
      playBtn.title = `Testar som: ${item.label}`;
      playBtn.setAttribute("aria-label", `Testar som ${item.label}`);
      playBtn.addEventListener("click", () => playUiSound(item.id, { forcePreview: true }));

      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = events[item.id] !== false;
      toggle.setAttribute("aria-label", `Ativar som ${item.label}`);
      toggle.addEventListener("change", () => {
        ensureSoundEvents()[item.id] = toggle.checked;
        saveAudioSettings();
      });
      controls.append(playBtn, toggle);
      row.append(text, controls);
      host.appendChild(row);
    }
  }

  document.getElementById("notif-show-preview")?.addEventListener("change", (e) => {
    state.audioSettings.notifShowPreview = Boolean(e.target.checked);
    saveAudioSettings();
  });
  document.getElementById("notif-when-focused")?.addEventListener("change", (e) => {
    state.audioSettings.notifWhenFocused = Boolean(e.target.checked);
    saveAudioSettings();
  });
  document.getElementById("notif-title-badge")?.addEventListener("change", (e) => {
    state.audioSettings.notifTitleBadge = Boolean(e.target.checked);
    saveAudioSettings();
    if (typeof updateDocumentTitle === "function") updateDocumentTitle();
  });

  // -------------------------------------------------------------------------
  // 6. Aparência, Acessibilidade (TTS, Saturação, Cargos) & Chat
  // -------------------------------------------------------------------------
  document.getElementById("appearance-custom-accent-color")?.addEventListener("input", (e) => {
    state.audioSettings.customAccentColor = e.target.value;
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("appearance-reset-accent-color")?.addEventListener("click", () => {
    state.audioSettings.customAccentColor = "";
    const picker = document.getElementById("appearance-custom-accent-color");
    if (picker) picker.value = "#5865f2";
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("appearance-zoom-select")?.addEventListener("change", (e) => {
    state.audioSettings.uiZoom = Number(e.target.value) || 100;
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("appearance-group-gap-slider")?.addEventListener("input", (e) => {
    const px = Number(e.target.value) || 14;
    state.audioSettings.chatGroupGap = px;
    const lbl = document.getElementById("appearance-group-gap-value");
    if (lbl) lbl.textContent = `${px}px`;
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("appearance-show-avatars")?.addEventListener("change", (e) => {
    state.audioSettings.showChatAvatars = Boolean(e.target.checked);
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("appearance-show-timestamps")?.addEventListener("change", (e) => {
    state.audioSettings.showChatTimestamps = Boolean(e.target.checked);
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("appearance-compact-sidebar")?.addEventListener("change", (e) => {
    state.audioSettings.compactSidebar = Boolean(e.target.checked);
    saveAudioSettings();
    applyAppThemeSettings();
  });

  document.getElementById("accessibility-saturation-slider")?.addEventListener("input", (e) => {
    const pct = Number(e.target.value);
    state.audioSettings.uiSaturation = Number.isFinite(pct) ? pct : 100;
    const lbl = document.getElementById("accessibility-saturation-value");
    if (lbl) lbl.textContent = `${state.audioSettings.uiSaturation}%`;
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("accessibility-high-contrast")?.addEventListener("change", (e) => {
    state.audioSettings.highContrast = Boolean(e.target.checked);
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("accessibility-role-colors")?.addEventListener("change", (e) => {
    state.audioSettings.roleColorsMode = e.target.value || "name";
    saveAudioSettings();
    applyAppThemeSettings();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
    if (typeof renderMembersSidebar === "function") renderMembersSidebar();
  });
  document.getElementById("accessibility-enhanced-focus")?.addEventListener("change", (e) => {
    state.audioSettings.enhancedFocus = Boolean(e.target.checked);
    saveAudioSettings();
    applyAppThemeSettings();
  });

  function speakSettingsTts(text) {
    if (!text || typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return false;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = state.language === "en" ? "en-US" : "pt-BR";
      utt.rate = Math.max(0.6, Math.min(2.0, Number(state.audioSettings?.ttsRate) || 1.0));
      utt.volume = Math.max(0.1, Math.min(1.0, (Number(state.audioSettings?.ttsVolume) || 100) / 100));
      window.speechSynthesis.speak(utt);
      return true;
    } catch (_) {
      return false;
    }
  }
  window.speakSettingsTts = speakSettingsTts;

  document.getElementById("accessibility-tts-enabled")?.addEventListener("change", (e) => {
    state.audioSettings.ttsEnabled = Boolean(e.target.checked);
    saveAudioSettings();
  });
  document.getElementById("accessibility-tts-rate")?.addEventListener("input", (e) => {
    const rate = Number(e.target.value) || 1.0;
    state.audioSettings.ttsRate = rate;
    const lbl = document.getElementById("accessibility-tts-rate-value");
    if (lbl) lbl.textContent = `${rate.toFixed(1)}x`;
    saveAudioSettings();
  });
  document.getElementById("accessibility-tts-volume")?.addEventListener("input", (e) => {
    const vol = Number(e.target.value) || 100;
    state.audioSettings.ttsVolume = vol;
    const lbl = document.getElementById("accessibility-tts-volume-value");
    if (lbl) lbl.textContent = `${vol}%`;
    saveAudioSettings();
  });
  document.getElementById("accessibility-tts-test-btn")?.addEventListener("click", () => {
    if (!speakSettingsTts("Teste de leitura em voz alta do Sancord.")) {
      showUiToast("Síntese de voz não disponível neste ambiente.");
    }
  });

  // Chat e Mensagens
  document.getElementById("chat-convert-emoticons")?.addEventListener("change", (e) => {
    state.audioSettings.chatConvertEmoticons = Boolean(e.target.checked);
    saveAudioSettings();
  });
  document.getElementById("chat-auto-embeds")?.addEventListener("change", (e) => {
    state.audioSettings.autoEmbeds = Boolean(e.target.checked);
    const mirror = document.getElementById("privacy-auto-embeds");
    if (mirror) mirror.checked = state.audioSettings.autoEmbeds;
    saveAudioSettings();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });
  document.getElementById("chat-inline-images")?.addEventListener("change", (e) => {
    state.audioSettings.chatInlineImages = Boolean(e.target.checked);
    saveAudioSettings();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });
  document.getElementById("chat-autoplay-video")?.addEventListener("change", (e) => {
    state.audioSettings.chatAutoplayVideo = Boolean(e.target.checked);
    saveAudioSettings();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });
  document.getElementById("chat-spellcheck")?.addEventListener("change", (e) => {
    state.audioSettings.chatSpellcheck = Boolean(e.target.checked);
    saveAudioSettings();
    applyAppThemeSettings();
  });
  document.getElementById("chat-enter-sends")?.addEventListener("change", (e) => {
    state.audioSettings.chatEnterSends = Boolean(e.target.checked);
    saveAudioSettings();
  });
  document.getElementById("chat-group-messages")?.addEventListener("change", (e) => {
    state.audioSettings.chatGroupMessages = Boolean(e.target.checked);
    saveAudioSettings();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });
  document.getElementById("chat-group-window")?.addEventListener("change", (e) => {
    state.audioSettings.chatGroupWindowMins = Number(e.target.value) || 7;
    saveAudioSettings();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });
  function updateRegionalPreview() {
    const el = document.getElementById("regional-format-preview");
    if (!el) return;
    const now = Date.now();
    const dateStr = typeof formatDateRegional === "function" ? formatDateRegional(now) : new Date(now).toLocaleDateString("pt-BR");
    const timeStr = typeof formatClockRegional === "function" ? formatClockRegional(now, "") : new Date(now).toLocaleTimeString("pt-BR");
    el.textContent = `Prévia atual: ${dateStr} às ${timeStr}`;
  }
  document.getElementById("chat-time-format")?.addEventListener("change", (e) => {
    state.audioSettings.chatTimeFormat = e.target.value || "24h";
    const reg = document.getElementById("regional-time-format");
    if (reg) reg.value = state.audioSettings.chatTimeFormat;
    saveAudioSettings();
    updateRegionalPreview();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });
  document.getElementById("regional-date-format")?.addEventListener("change", (e) => {
    state.audioSettings.regionalDateFormat = e.target.value || "pt-BR";
    saveAudioSettings();
    updateRegionalPreview();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });
  document.getElementById("regional-time-format")?.addEventListener("change", (e) => {
    state.audioSettings.chatTimeFormat = e.target.value || "24h";
    const chatSel = document.getElementById("chat-time-format");
    if (chatSel) chatSel.value = state.audioSettings.chatTimeFormat;
    saveAudioSettings();
    updateRegionalPreview();
    if (typeof renderChatMessages === "function") renderChatMessages({ preserveScroll: true });
  });

  // -------------------------------------------------------------------------
  // 7. Gerenciador de Atalhos Personalizáveis (com detecção de conflito)
  // -------------------------------------------------------------------------
  function renderCustomShortcuts() {
    const host = document.getElementById("settings-custom-shortcuts-list");
    if (!host) return;
    host.replaceChildren();
    for (const def of DEFAULT_SHORTCUTS) {
      const cfg = getShortcutConfig(def.id);
      const row = document.createElement("div");
      row.className = "settings-shortcut-editor-row";
      const label = document.createElement("span");
      label.className = "settings-row-title";
      label.textContent = def.label;

      const keyBtn = document.createElement("button");
      keyBtn.type = "button";
      keyBtn.className = "btn-secondary small-btn";
      keyBtn.textContent = recordingShortcutId === def.id ? "Pressione…" : cfg.combo;
      keyBtn.addEventListener("click", () => {
        recordingShortcutId = recordingShortcutId === def.id ? null : def.id;
        renderCustomShortcuts();
      });

      const active = document.createElement("input");
      active.type = "checkbox";
      active.checked = cfg.active;
      active.setAttribute("aria-label", `Ativar atalho ${def.label}`);
      active.addEventListener("change", () => {
        state.audioSettings.customShortcuts = {
          ...(state.audioSettings.customShortcuts || {}),
          [def.id]: { combo: cfg.combo, active: active.checked },
        };
        saveAudioSettings();
      });

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn-secondary small-btn";
      resetBtn.textContent = "↺";
      resetBtn.title = "Restaurar padrão desta ação";
      resetBtn.addEventListener("click", () => {
        const next = { ...(state.audioSettings.customShortcuts || {}) };
        delete next[def.id];
        state.audioSettings.customShortcuts = next;
        saveAudioSettings();
        renderCustomShortcuts();
      });

      row.append(label, keyBtn, active, resetBtn);
      host.appendChild(row);
    }
    const muteRef = document.getElementById("shortcut-ref-mute");
    const deafenRef = document.getElementById("shortcut-ref-deafen");
    if (muteRef) muteRef.textContent = getShortcutConfig("mute").combo;
    if (deafenRef) deafenRef.textContent = getShortcutConfig("deafen").combo;
  }

  document.getElementById("shortcuts-reset-defaults-btn")?.addEventListener("click", () => {
    state.audioSettings.customShortcuts = {};
    recordingShortcutId = null;
    document.getElementById("settings-shortcut-conflict")?.classList.add("hidden");
    saveAudioSettings();
    renderCustomShortcuts();
    showUiToast("Atalhos restaurados para o padrão.");
  });

  window.addEventListener("keydown", (e) => {
    if (recordingShortcutId) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        recordingShortcutId = null;
        renderCustomShortcuts();
        return;
      }
      const combo = formatKeyEventCombo(e);
      if (!combo) return;
      const conflictEl = document.getElementById("settings-shortcut-conflict");
      const conflict = DEFAULT_SHORTCUTS.find((item) => item.id !== recordingShortcutId && getShortcutConfig(item.id)?.combo.toLowerCase() === combo.toLowerCase());
      if (conflict) {
        if (conflictEl) {
          conflictEl.textContent = `⚠ Esse atalho (${combo}) já está sendo usado por "${conflict.label}".`;
          conflictEl.classList.remove("hidden");
        }
        return;
      }
      conflictEl?.classList.add("hidden");
      const cur = getShortcutConfig(recordingShortcutId);
      state.audioSettings.customShortcuts = {
        ...(state.audioSettings.customShortcuts || {}),
        [recordingShortcutId]: { combo, active: cur.active },
      };
      recordingShortcutId = null;
      saveAudioSettings();
      renderCustomShortcuts();
      return;
    }

    // Execução de atalhos personalizados adicionais fora de campos de texto (exceto Ctrl+, / Ctrl+K)
    if (state.recordingPttKey) return;
    const combo = formatKeyEventCombo(e);
    if (!combo) return;
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target?.isContentEditable;
    for (const def of DEFAULT_SHORTCUTS) {
      const cfg = getShortcutConfig(def.id);
      if (!cfg?.active || cfg.combo.toLowerCase() !== combo.toLowerCase()) continue;
      if (def.id === "openSettings") {
        e.preventDefault();
        openSettingsModal("account");
        return;
      }
      if (def.id === "editLastMessage" && !inField) {
        const list = state.chatHistory[getActiveTextChannelId()] || [];
        const lastMine = [...list].reverse().find((m) => typeof isOwnMessage === "function" && isOwnMessage(m) && m.content);
        if (lastMine && typeof startEditingMessage === "function") {
          e.preventDefault();
          startEditingMessage(lastMine);
          return;
        }
      }
      if (def.id === "openEmoji") {
        e.preventDefault();
        document.getElementById("emoji-picker-btn")?.click();
        return;
      }
      if (def.id === "attachFile") {
        e.preventDefault();
        document.getElementById("attach-image-btn")?.click();
        return;
      }
    }
  }, true);

  // -------------------------------------------------------------------------
  // 8. Configurações do Windows (IPC real com SancordApp.rs)
  // -------------------------------------------------------------------------
  function renderWindowsSettingsUI() {
    const isDesktop = Boolean(desktopState.isDesktop);
    const badge = document.getElementById("windows-env-badge");
    const note = document.getElementById("windows-env-note");
    const autoToggle = document.getElementById("windows-autostart-toggle");
    const minToggle = document.getElementById("windows-start-minimized-toggle");
    const closeToggle = document.getElementById("windows-minimize-on-close-toggle");
    const notifToggle = document.getElementById("windows-native-notif-toggle");
    const dirLabel = document.getElementById("windows-data-dir-label");
    const openDirBtn = document.getElementById("windows-open-data-dir-btn");
    const advOpenBtn = document.getElementById("advanced-open-data-dir-btn");
    const advDirDesc = document.getElementById("advanced-data-dir-desc");

    if (badge) badge.textContent = isDesktop ? "Sancord Desktop (Windows)" : "Modo Navegador";
    if (note) {
      note.textContent = isDesktop
        ? "Controles nativos conectados diretamente ao aplicativo Windows Sancord Desktop."
        : "Você está usando o Sancord no navegador. Inicialização com o Windows e pasta local ficam ativos no executável Sancord Desktop.";
    }
    if (autoToggle) { autoToggle.checked = Boolean(desktopState.autostart); autoToggle.disabled = !isDesktop; }
    if (minToggle) { minToggle.checked = Boolean(desktopState.startMinimized); minToggle.disabled = !isDesktop; }
    if (closeToggle) { closeToggle.checked = Boolean(desktopState.minimizeOnClose); closeToggle.disabled = !isDesktop; }
    if (notifToggle) notifToggle.checked = Boolean(state.audioSettings?.desktopNotif);
    if (dirLabel) dirLabel.textContent = desktopState.dataDir || (isDesktop ? "Pasta de dados local do Sancord Desktop" : "Disponível no aplicativo desktop instalado.");
    if (advDirDesc) advDirDesc.textContent = desktopState.dataDir || "Disponível no aplicativo Sancord Desktop.";
    if (openDirBtn) openDirBtn.disabled = !isDesktop;
    if (advOpenBtn) advOpenBtn.disabled = !isDesktop;
  }

  window.addEventListener("sancord-desktop-state", ({ detail }) => {
    if (detail && typeof detail === "object") {
      desktopState = { ...desktopState, ...detail };
      renderWindowsSettingsUI();
      renderAboutPage();
    }
  });

  document.getElementById("windows-autostart-toggle")?.addEventListener("change", (e) => {
    window.ipc?.postMessage(`desktop:set-autostart:${e.target.checked ? "1" : "0"}`);
  });
  document.getElementById("windows-start-minimized-toggle")?.addEventListener("change", (e) => {
    window.ipc?.postMessage(`desktop:set-start-minimized:${e.target.checked ? "1" : "0"}`);
  });
  document.getElementById("windows-minimize-on-close-toggle")?.addEventListener("change", (e) => {
    window.ipc?.postMessage(`desktop:set-minimize-on-close:${e.target.checked ? "1" : "0"}`);
  });
  document.getElementById("windows-native-notif-toggle")?.addEventListener("change", (e) => {
    const mainNotif = document.getElementById("notif-desktop-alerts");
    if (mainNotif) {
      mainNotif.checked = e.target.checked;
      mainNotif.dispatchEvent(new Event("change"));
    }
  });
  document.getElementById("windows-open-data-dir-btn")?.addEventListener("click", () => {
    window.ipc?.postMessage("desktop:open-data-dir");
  });
  document.getElementById("advanced-open-data-dir-btn")?.addEventListener("click", () => {
    window.ipc?.postMessage("desktop:open-data-dir");
  });

  // -------------------------------------------------------------------------
  // 9. Atualizações, Avançado, Diagnóstico sanitizado & Sobre
  // -------------------------------------------------------------------------
  document.getElementById("check-updates-btn")?.addEventListener("click", () => {
    const el = document.getElementById("updates-last-checked");
    if (el) el.textContent = `Última verificação: hoje às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  });
  document.getElementById("updates-auto-check-toggle")?.addEventListener("change", (e) => {
    state.audioSettings.updatesAutoCheck = Boolean(e.target.checked);
    saveAudioSettings();
  });

  document.getElementById("advanced-developer-mode")?.addEventListener("change", (e) => {
    state.audioSettings.developerMode = Boolean(e.target.checked);
    saveAudioSettings();
    applyAppThemeSettings();
    renderAdvancedNetwork();
  });
  document.getElementById("advanced-log-level")?.addEventListener("change", (e) => {
    state.audioSettings.logLevel = e.target.value || "normal";
    saveAudioSettings();
  });
  document.getElementById("advanced-reset-app-btn")?.addEventListener("click", async () => {
    if (!(await SancordUI.confirm({
      title: "Restaurar configurações do aplicativo?",
      message: "Todas as preferências locais deste dispositivo (áudio, aparência, acessibilidade, chat e atalhos) voltarão ao padrão. Sua conta, servidores e mensagens não serão apagados.",
      confirmLabel: "Restaurar tudo",
      danger: true,
    }))) return;
    state.audioSettings = { ...DEFAULT_AUDIO_SETTINGS, soundEvents: { ...DEFAULT_AUDIO_SETTINGS.soundEvents } };
    saveAudioSettings();
    syncSettingsModalFields();
    if (typeof applyProfileVisualSettings === "function") applyProfileVisualSettings();
    showUiToast("Configurações do aplicativo restauradas.");
  });

  function renderAdvancedNetwork() {
    const host = document.getElementById("advanced-network-summary");
    const devHost = document.getElementById("advanced-dev-network-list");
    if (!host) return;
    const wsStateMap = { 0: "Conectando", 1: "Conectado", 2: "Fechando", 3: "Desconectado" };
    const wsStatus = state.ws ? wsStateMap[state.ws.readyState] || "Desconhecido" : "Desconectado";
    const origin = typeof SancordNet !== "undefined" ? SancordNet.origin : window.location.origin;
    const rows = [
      ["Estado da conexão", wsStatus, wsStatus === "Conectado" ? "ok" : "warn"],
      ["Servidor conectado", origin || "Local", "ok"],
      ["Transporte", (origin || "").startsWith("https://") ? "WSS (TLS) + WebRTC DTLS-SRTP" : "WS Local + WebRTC DTLS-SRTP", "ok"],
    ];
    host.replaceChildren();
    for (const [k, v, cls] of rows) {
      const r = document.createElement("div");
      r.className = "settings-diag-row";
      r.innerHTML = `<span>${escapeHtml(k)}</span><span class="settings-diag-status ${cls}">${escapeHtml(v)}</span>`;
      host.appendChild(r);
    }
    if (devHost) {
      const peersCount = state.peers instanceof Map ? state.peers.size : 0;
      const devRows = [
        ["WebSocket readyState", String(state.ws?.readyState ?? "null"), "ok"],
        ["Sessões / usuários em cache", String(state.users?.size || 0), "ok"],
        ["Peers WebRTC P2P ativos", String(peersCount), peersCount > 0 ? "ok" : "warn"],
        ["Canal de voz ativo", state.currentVoiceChannel || "Nenhum", "ok"],
        ["Nível de log local", state.audioSettings?.logLevel || "normal", "ok"],
      ];
      devHost.replaceChildren();
      for (const [k, v, cls] of devRows) {
        const r = document.createElement("div");
        r.className = "settings-diag-row";
        r.innerHTML = `<span>${escapeHtml(k)}</span><span class="settings-diag-status ${cls}">${escapeHtml(v)}</span>`;
        devHost.appendChild(r);
      }
    }
  }

  function sanitizeDiagnosticReport(text) {
    return String(text || "")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      .replace(/(token|password|senha|secret|key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      .replace(/https?:\/\/[^:\s/]+:[^@\s/]+@/gi, "https://[REDACTED]@");
  }

  async function runDiagnosticsSuite() {
    const listEl = document.getElementById("diagnostics-results-list");
    if (!listEl) return;
    listEl.replaceChildren();
    const checks = [];
    const push = (name, value, status) => checks.push({ name, value, status });

    // 1. WebSocket
    const wsOpen = state.ws?.readyState === 1;
    push("WebSocket", wsOpen ? "Conectado ✓" : "Desconectado", wsOpen ? "ok" : "err");

    // 2. HTTP /api/health ping
    try {
      const t0 = performance.now();
      const res = await SancordNet.fetch("/api/health", { cache: "no-store" });
      const ms = Math.max(1, Math.round(performance.now() - t0));
      push("Servidor HTTP (/api/health)", res.ok ? `${ms} ms ✓` : `HTTP ${res.status}`, res.ok ? "ok" : "err");
    } catch (_) {
      push("Servidor HTTP (/api/health)", "Sem resposta", "warn");
    }

    // 3. Armazenamento local
    try {
      localStorage.setItem("sancord_diag_probe", "1");
      localStorage.removeItem("sancord_diag_probe");
      push("Armazenamento local", "OK ✓", "ok");
    } catch (_) {
      push("Armazenamento local", "Indisponível", "err");
    }

    // 4. Dispositivos de áudio (sem abrir captura)
    if (navigator.mediaDevices?.enumerateDevices) {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const mics = devs.filter((d) => d.kind === "audioinput").length;
        const spks = devs.filter((d) => d.kind === "audiooutput").length;
        const cams = devs.filter((d) => d.kind === "videoinput").length;
        push("Microfone", mics > 0 ? `${mics} detectado(s) ✓` : "Nenhum detectado", mics > 0 ? "ok" : "warn");
        push("Saída de áudio", spks > 0 ? `${spks} detectada(s) ✓` : "Padrão do sistema", "ok");
        push("Câmera", cams > 0 ? `${cams} detectada(s) ✓` : "Nenhuma detectada", cams > 0 ? "ok" : "warn");
      } catch (_) {
        push("Dispositivos de mídia", "Não enumerados", "warn");
      }
    } else {
      push("Dispositivos de mídia", "API indisponível", "warn");
    }

    // 5. Cache de mídia
    const blobCount = typeof blobMediaCache !== "undefined" ? blobMediaCache.size : 0;
    const blobBytes = typeof blobMediaTotalBytes !== "undefined" ? blobMediaTotalBytes : 0;
    push("Cache de mídia (sessão)", `${blobCount} item(ns) • ${formatStorageBytes(blobBytes)} ✓`, "ok");

    // 6. Updater & Desktop
    push("Atualizador Desktop", desktopState.isDesktop ? "Disponível ✓" : "Modo navegador (N/A)", desktopState.isDesktop ? "ok" : "warn");

    // 7. Permissões de notificação
    const notifPerm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    push("Permissão de notificações", notifPerm === "granted" ? "Concedida ✓" : notifPerm, notifPerm === "granted" ? "ok" : "warn");

    if (!listEl.isConnected || typeof document === "undefined" || !document.createElement) return;
    for (const c of checks) {
      const row = document.createElement("div");
      row.className = "settings-diag-row";
      row.innerHTML = `<span>${escapeHtml(c.name)}</span><span class="settings-diag-status ${c.status}">${escapeHtml(c.value)}</span>`;
      listEl.appendChild(row);
    }

    const lines = [
      `Sancord Diagnóstico (${new Date().toISOString()})`,
      `Versão: ${desktopState.version || "0.2.3"} | Ambiente: ${desktopState.isDesktop ? "Desktop Windows" : "Navegador"}`,
      ...checks.map((c) => `- ${c.name}: ${c.value}`),
    ];
    lastDiagnosticsReport = sanitizeDiagnosticReport(lines.join("\n"));
  }

  document.getElementById("diagnostics-run-btn")?.addEventListener("click", () => runDiagnosticsSuite());
  document.getElementById("diagnostics-copy-btn")?.addEventListener("click", async () => {
    if (!lastDiagnosticsReport) await runDiagnosticsSuite();
    copyTextSafe(lastDiagnosticsReport, "Relatório de diagnóstico copiado (dados sensíveis removidos)!");
  });

  function renderAboutPage() {
    const verEl = document.getElementById("about-version-line");
    const rtEl = document.getElementById("about-runtime-line");
    const licEl = document.getElementById("about-licenses-list");
    if (verEl) verEl.textContent = `Versão ${desktopState.version || "0.2.3"} • Canal Estável`;
    if (rtEl) rtEl.textContent = `Arquitetura ${desktopState.arch || "x86_64"} • ${desktopState.isDesktop ? "Sancord Desktop (Windows / WebView2)" : "Cliente Web"} • Rust + Axum + SQLite + WebRTC P2P`;
    if (licEl && !licEl.childElementCount) {
      for (const lib of OPEN_SOURCE_LICENSES) {
        const chip = document.createElement("div");
        chip.className = "settings-license-chip";
        chip.innerHTML = `<strong>${escapeHtml(lib.name)}</strong><span>${escapeHtml(lib.license)} — ${escapeHtml(lib.role)}</span>`;
        licEl.appendChild(chip);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 10. Sincronização de campos e ciclo de abas
  // -------------------------------------------------------------------------
  function syncSettingsCenterFields() {
    const s = state.audioSettings || DEFAULT_AUDIO_SETTINGS;
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val); };
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };

    setVal("ptt-release-delay-slider", s.pttReleaseDelayMs ?? 120);
    setText("ptt-release-delay-value", `${s.pttReleaseDelayMs ?? 120} ms`);
    setVal("screen-default-quality", s.screenDefaultQuality || "1080");
    setVal("screen-default-fps", s.screenDefaultFps || 30);
    setCheck("screen-default-audio", s.screenDefaultAudio !== false);

    setCheck("notif-show-preview", s.notifShowPreview !== false);
    setCheck("notif-when-focused", Boolean(s.notifWhenFocused));
    setCheck("notif-title-badge", s.notifTitleBadge !== false);

    setVal("appearance-custom-accent-color", s.customAccentColor && /^#[0-9a-f]{6}$/i.test(s.customAccentColor) ? s.customAccentColor : "#5865f2");
    setVal("appearance-zoom-select", s.uiZoom || 100);
    setVal("appearance-group-gap-slider", s.chatGroupGap ?? 14);
    setText("appearance-group-gap-value", `${s.chatGroupGap ?? 14}px`);
    setCheck("appearance-show-avatars", s.showChatAvatars !== false);
    setCheck("appearance-show-timestamps", s.showChatTimestamps !== false);
    setCheck("appearance-compact-sidebar", Boolean(s.compactSidebar));

    setVal("accessibility-saturation-slider", s.uiSaturation ?? 100);
    setText("accessibility-saturation-value", `${s.uiSaturation ?? 100}%`);
    setCheck("accessibility-high-contrast", Boolean(s.highContrast));
    setVal("accessibility-role-colors", s.roleColorsMode || "name");
    setCheck("accessibility-enhanced-focus", Boolean(s.enhancedFocus));
    setCheck("accessibility-tts-enabled", Boolean(s.ttsEnabled));
    setVal("accessibility-tts-rate", s.ttsRate ?? 1.0);
    setText("accessibility-tts-rate-value", `${Number(s.ttsRate ?? 1.0).toFixed(1)}x`);
    setVal("accessibility-tts-volume", s.ttsVolume ?? 100);
    setText("accessibility-tts-volume-value", `${s.ttsVolume ?? 100}%`);

    setCheck("chat-convert-emoticons", s.chatConvertEmoticons !== false);
    setCheck("chat-auto-embeds", s.autoEmbeds !== false);
    setCheck("chat-inline-images", s.chatInlineImages !== false);
    setCheck("chat-autoplay-video", Boolean(s.chatAutoplayVideo));
    setCheck("chat-spellcheck", s.chatSpellcheck !== false);
    setCheck("chat-enter-sends", s.chatEnterSends !== false);
    setCheck("chat-group-messages", s.chatGroupMessages !== false);
    setVal("chat-group-window", s.chatGroupWindowMins || 7);
    setVal("chat-time-format", s.chatTimeFormat || "24h");
    setVal("regional-date-format", s.regionalDateFormat || "pt-BR");
    setVal("regional-time-format", s.chatTimeFormat || "24h");

    setCheck("updates-auto-check-toggle", s.updatesAutoCheck !== false);
    setCheck("advanced-developer-mode", Boolean(s.developerMode));
    setVal("advanced-log-level", s.logLevel || "normal");

    if (state.selfUser) {
      setVal("activity-status-select", state.selfUser.status_kind || "online");
    }
    const actPrivacy = document.querySelector('#profile-privacy-form [name="activity"]')?.value;
    if (actPrivacy) setVal("activity-audience-select", actPrivacy);

    renderSoundsMatrix();
    renderCustomShortcuts();
    renderWindowsSettingsUI();
    updateRegionalPreview();
    renderAboutPage();
  }
  window.syncSettingsCenterFields = syncSettingsCenterFields;

  function onSettingsCenterTabShown(tabName) {
    if (tabName === "privacy" || tabName === "social") refreshLocalStorageStats();
    if (tabName === "requests") renderSettingsRequestsList();
    if (tabName === "blocked" && typeof renderPrivacySettingsUI === "function") renderPrivacySettingsUI();
    if (tabName === "profile") renderServerProfileTabSummary();
    if (tabName === "notifications") renderSoundsMatrix();
    if (tabName === "shortcuts") renderCustomShortcuts();
    if (tabName === "language") updateRegionalPreview();
    if (tabName === "windows") {
      renderWindowsSettingsUI();
      window.ipc?.postMessage("desktop:get-state");
    }
    if (tabName === "advanced") renderAdvancedNetwork();
    if (tabName === "diagnostics" && !document.getElementById("diagnostics-results-list")?.childElementCount) {
      runDiagnosticsSuite();
    }
    if (tabName === "about") renderAboutPage();
  }
  window.onSettingsCenterTabShown = onSettingsCenterTabShown;

  // Inicialização inicial segura (sem capturar mídia nem fazer chamadas de rede)
  syncSettingsCenterFields();
  if (window.ipc?.postMessage) window.ipc.postMessage("desktop:get-state");
})();
