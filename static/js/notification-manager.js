/**
 * SancordNotifications (NotificationManager) — Decisão centralizada de:
 *  - unread state / read state para DMs e Group DMs
 *  - efeito sonoro original do Sancord (Web Audio com cooldown e anti-clipping)
 *  - notificações desktop (Windows/sistema)
 *  - avatares com badge numerada na barra lateral (rail)
 *
 * Reutiliza integralmente: `state.readStates`, `state.unreadDms`, `state.dmConversations`,
 * `state.groupDms`, `notificationPolicy`, `isMutedId`, `DmContextMenu`, `groupContextMenu`
 * e `AckChannel` / `ReadStateUpdated`.
 */
const SancordNotifications = (() => {
  const CHANNEL_SOUND_COOLDOWN_MS = 1100;
  const GLOBAL_SOUND_COOLDOWN_MS = 450;
  const TASKBAR_FLASH_COOLDOWN_MS = 15000;
  const MAX_PROCESSED_IDS = 1000;

  let lastSoundAt = 0;
  let lastFlashAt = 0;
  const lastSoundByChannel = new Map();
  const lastActivityAtByDm = new Map();
  const prevRailCounts = new Map();
  const processedMessageIds = new Set();
  const processedMessageOrder = [];
  const unreadMessageIdsByChannel = new Map(); // channelId -> Set<messageId>
  let hadInitialWelcome = false;

  function formatUnreadCount(count) {
    const n = Number(count) || 0;
    if (n <= 0) return "";
    return n > 99 ? "99+" : String(n);
  }

  function rememberProcessedId(msgId) {
    if (!msgId) return false;
    const key = String(msgId);
    if (processedMessageIds.has(key)) return true;
    processedMessageIds.add(key);
    processedMessageOrder.push(key);
    while (processedMessageOrder.length > MAX_PROCESSED_IDS) {
      const oldest = processedMessageOrder.shift();
      if (oldest) processedMessageIds.delete(oldest);
    }
    return false;
  }

  function hasProcessedMessage(msgId) {
    if (!msgId) return false;
    return processedMessageIds.has(String(msgId));
  }

  function trackUnreadMessageId(channelId, msgId) {
    if (!channelId || !msgId) return;
    let set = unreadMessageIdsByChannel.get(channelId);
    if (!set) {
      set = new Set();
      unreadMessageIdsByChannel.set(channelId, set);
    }
    set.add(String(msgId));
  }

  function clearTrackedUnreadForChannel(channelId) {
    if (!channelId) return;
    unreadMessageIdsByChannel.delete(channelId);
  }

  function myLowerSafe() {
    return String((typeof state !== "undefined" && state.selfUser?.username) || "").toLowerCase();
  }

  function isBlockedAuthor(authorName) {
    const lower = String(authorName || "").toLowerCase();
    if (!lower || typeof state === "undefined") return false;
    return Boolean(state.blockedUsers && state.blockedUsers.has(lower));
  }

  function isBlockedDmChannel(channelId) {
    if (!channelId || !channelId.startsWith("dm:") || typeof state === "undefined") return false;
    const peer = resolvePeerFromDmId(channelId);
    return Boolean(peer && isBlockedAuthor(peer.username));
  }

  /**
   * Fonte única de verdade para o contador global de notificações acionáveis:
   * - DMs 1:1 não lidas relevantes (exclui solicitações de mensagem e usuários bloqueados)
   * - Group DMs não lidas
   * - Menções diretas (@user, @cargo, @everyone, @online) e respostas em canais de servidor
   * - Retorna 0 antes de autenticar ou após logout.
   */
  function getGlobalUnreadNotificationCount() {
    if (typeof state === "undefined" || !state.selfUser?.username) return 0;
    let total = 0;
    const countedChannels = new Set();

    if (state.readStates && typeof state.readStates.entries === "function") {
      for (const [chId, rs] of state.readStates.entries()) {
        const cnt = Math.max(0, Number(rs?.mention_count) || 0);
        if (cnt <= 0) continue;
        const isDm = typeof isPrivateTextId === "function" ? isPrivateTextId(chId) : /^g?dm:/.test(chId);
        if (isDm && typeof isMessageRequest === "function" && isMessageRequest(chId)) continue;
        if (chId.startsWith("dm:") && isBlockedDmChannel(chId)) continue;
        total += cnt;
        countedChannels.add(chId);
      }
    }

    if (state.unreadDms && typeof state.unreadDms.entries === "function") {
      for (const [chId, rawCnt] of state.unreadDms.entries()) {
        if (countedChannels.has(chId)) continue;
        const cnt = Math.max(0, Number(rawCnt) || 0);
        if (cnt <= 0) continue;
        if (typeof isMessageRequest === "function" && isMessageRequest(chId)) continue;
        if (chId.startsWith("dm:") && isBlockedDmChannel(chId)) continue;
        total += cnt;
      }
    }

    return total;
  }

  function isConversationOpenAndViewed(channelId) {
    if (!channelId || typeof state === "undefined") return false;
    const activeId = typeof getActiveTextChannelId === "function" ? getActiveTextChannelId() : null;
    const viewingChannel = channelId === activeId && !(state.activeView === "home" && !state.activeDmId);
    if (!viewingChannel) return false;
    if (typeof document !== "undefined" && (document.hidden || !document.hasFocus())) return false;
    const hs = typeof getHistoryState === "function" ? getHistoryState(channelId) : { hasNewer: false };
    const nearBottom = typeof isNearBottom === "function" ? isNearBottom(160) : true;
    return Boolean(nearBottom && !hs.hasNewer && state.suppressAckFor !== channelId);
  }

  function shouldIncrementUnread(message, opts = {}) {
    if (!message || opts.isHistoryLoad) return false;
    if (message.id && hasProcessedMessage(message.id)) return false;
    if (typeof isOwnMessage === "function" && isOwnMessage(message)) return false;
    if (isBlockedAuthor(message.author_name)) return false;
    const chId = message.channel_id;
    const isDm = typeof isPrivateTextId === "function" && isPrivateTextId(chId);
    if (isDm && typeof isMessageRequest === "function" && isMessageRequest(chId)) return false;
    if (isConversationOpenAndViewed(chId)) return false;
    if (isDm) return true;
    return typeof messageMentionsMe === "function" ? Boolean(messageMentionsMe(message)) : false;
  }

  function shouldPlaySound(message, opts = {}) {
    if (!message || opts.isHistoryLoad || opts.isReconnectSync) return false;
    if (typeof isOwnMessage === "function" && isOwnMessage(message)) return false;
    if (isBlockedAuthor(message.author_name)) return false;
    if (typeof state === "undefined") return false;
    if (state.deafened || state.selfUser?.status_kind === "dnd") return false;
    if (state.audioSettings?.soundMessages === false || state.audioSettings?.streamerMode) return false;

    const chId = message.channel_id;
    const isDm = typeof isPrivateTextId === "function" && isPrivateTextId(chId);
    if (isDm && typeof isMessageRequest === "function" && isMessageRequest(chId)) return false;
    if (typeof isMutedId === "function" && isMutedId(chId)) return false;
    if (!isDm && typeof isChannelMuted === "function" && isChannelMuted(chId)) return false;
    if (isConversationOpenAndViewed(chId)) return false;

    const mentioned = isDm || (typeof messageMentionsMe === "function" && Boolean(messageMentionsMe(message)));
    if (!isDm) {
      // Servidores: respeita a preferência do canal/servidor ("all" = todas, "mentions"/"default" = menções, "none" = nada).
      const level = typeof notifyLevelFor === "function" ? notifyLevelFor(chId) : "default";
      if (level === "none") return false;
      if (level !== "all" && !mentioned) return false;
    }

    const policy = typeof notificationPolicy === "function"
      ? notificationPolicy(message)
      : { sound: true, notify: mentioned, mention: mentioned };
    if (!policy.sound) return false;

    const soundKind = isDm ? "dm-message" : (policy.mention ? "mention" : "message");
    const eventKey = soundKind === "dm-message" ? "message" : soundKind;
    if (state.audioSettings?.soundEvents && state.audioSettings.soundEvents[eventKey] === false) return false;

    const now = typeof opts.now === "number" ? opts.now : Date.now();
    if (!opts.ignoreCooldown) {
      if (now - lastSoundAt < GLOBAL_SOUND_COOLDOWN_MS) return false;
      const lastCh = lastSoundByChannel.get(chId) || 0;
      if (now - lastCh < CHANNEL_SOUND_COOLDOWN_MS) return false;
    }
    return true;
  }

  function shouldFlashTaskbar(now = Date.now()) {
    if (typeof state === "undefined") return false;
    if (state.selfUser?.status_kind === "dnd" || state.audioSettings?.streamerMode) return false;
    if (state.audioSettings?.notifFlashTaskbar === false) return false;
    if (typeof document !== "undefined" && !document.hidden && document.hasFocus()) return false;
    if (now - lastFlashAt < TASKBAR_FLASH_COOLDOWN_MS) return false;
    lastFlashAt = now;
    return true;
  }

  function shouldShowDesktopNotification(message, opts = {}) {
    if (!message || opts.isHistoryLoad || opts.isReconnectSync) return false;
    if (typeof state === "undefined") return false;
    if (!state.audioSettings?.desktopNotif || state.audioSettings?.streamerMode) return false;
    if (state.selfUser?.status_kind === "dnd") return false;
    if (typeof isOwnMessage === "function" && isOwnMessage(message)) return false;
    if (isBlockedAuthor(message.author_name)) return false;
    const chId = message.channel_id;
    const isDm = typeof isPrivateTextId === "function" && isPrivateTextId(chId);
    if (isDm && typeof isMessageRequest === "function" && isMessageRequest(chId)) return false;
    if (isDm && typeof isMutedId === "function" && isMutedId(chId)) return false;
    if (isConversationOpenAndViewed(chId)) return false;
    const policy = typeof notificationPolicy === "function"
      ? notificationPolicy(message)
      : { sound: true, notify: isDm, mention: isDm };
    return Boolean(policy.notify);
  }

  function shouldShowDmBadge(channelId) {
    if (typeof state === "undefined") return false;
    if (state.audioSettings?.notifDmBadges === false) return false;
    if (typeof isPrivateTextId === "function" && !isPrivateTextId(channelId)) return false;
    if (typeof isMessageRequest === "function" && isMessageRequest(channelId)) return false;
    return (state.unreadDms?.get(channelId) || 0) > 0;
  }

  function recordSoundPlayed(channelId, now = Date.now()) {
    lastSoundAt = now;
    if (channelId) lastSoundByChannel.set(channelId, now);
  }

  function noteDmActivity(channelId, ts = Date.now()) {
    if (!channelId) return;
    const prev = lastActivityAtByDm.get(channelId) || 0;
    if (ts >= prev) lastActivityAtByDm.set(channelId, ts);
  }

  /**
   * Som original de nova mensagem direta do Sancord (Web Audio API):
   * acorde curto e caloroso em duas notas suaves (E5 → A5) com filtro lowpass
   * e envelope orgânico anti-clipping (~240ms). Nenhum asset proprietário de terceiros.
   */
  function synthesizeSancordDmChime(ctx, effectiveVol = 1) {
    const now = ctx.currentTime;
    const master = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, now);
    filter.Q.setValueAtTime(0.7, now);

    const safeLevel = Math.max(0.01, Math.min(0.16, 0.11 * effectiveVol));
    master.gain.setValueAtTime(safeLevel, now);
    filter.connect(master);
    master.connect(ctx.destination);

    const notes = [
      { freq: 659.25, overtone: 1318.5, start: 0.0, dur: 0.125, gain: 0.85 },
      { freq: 880.0, overtone: 1760.0, start: 0.068, dur: 0.175, gain: 1.0 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      env.gain.setValueAtTime(0.0001, now + n.start);
      env.gain.linearRampToValueAtTime(n.gain, now + n.start + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0008, now + n.start + n.dur);
      osc.connect(env);
      env.connect(filter);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.01);

      const over = ctx.createOscillator();
      const overEnv = ctx.createGain();
      over.type = "triangle";
      over.frequency.setValueAtTime(n.overtone, now + n.start);
      overEnv.gain.setValueAtTime(0.0001, now + n.start);
      overEnv.gain.linearRampToValueAtTime(n.gain * 0.16, now + n.start + 0.005);
      overEnv.gain.exponentialRampToValueAtTime(0.0005, now + n.start + n.dur * 0.65);
      over.connect(overEnv);
      overEnv.connect(filter);
      over.start(now + n.start);
      over.stop(now + n.start + n.dur * 0.7);
    }
  }

  function getNotificationVolumePct() {
    if (typeof state === "undefined") return 100;
    const v = state.audioSettings?.uiVolume;
    return Number.isFinite(v) ? Math.max(0, Math.min(150, v)) : 100;
  }

  function handleIncomingSound(message, opts = {}) {
    if (!shouldPlaySound(message, opts)) return false;
    const chId = message.channel_id;
    const isDm = typeof isPrivateTextId === "function" && isPrivateTextId(chId);
    const policy = typeof notificationPolicy === "function" ? notificationPolicy(message) : { mention: isDm };
    const kind = isDm ? "dm-message" : (policy.mention ? "mention" : "message");
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    recordSoundPlayed(chId, now);
    if (typeof SancordSoundManager !== "undefined" && typeof SancordSoundManager.play === "function") {
      SancordSoundManager.play("message_received", {
        volume: getNotificationVolumePct(),
        ignoreCooldown: true,
        now,
      });
    }
    if (typeof playUiSound === "function") {
      playUiSound(kind, { viaNotificationManager: true });
    }
    return true;
  }

  /**
   * Chamado em `onWelcomeReadStates`: sincroniza unread após login ou reconexão.
   * NÃO toca efeitos sonoros retroativos para mensagens antigas ou recebidas offline (#4, #30, #59).
   */
  function onWelcomeSync(_prevUnreadMap, _nextUnreadMap) {
    hadInitialWelcome = true;
    unreadMessageIdsByChannel.clear();
  }

  /**
   * Recalcula o contador quando uma mensagem não lida relevante é apagada antes da leitura (#54).
   */
  function onMessageDeleted(channelId, messageId, deletedMessage = null) {
    if (!channelId || typeof state === "undefined") return false;
    const rs = typeof getReadState === "function" ? getReadState(channelId) : state.readStates?.get(channelId);
    if (!rs || !(rs.mention_count > 0)) return false;

    const trackedSet = unreadMessageIdsByChannel.get(channelId);
    const wasTracked = Boolean(messageId && trackedSet && trackedSet.delete(String(messageId)));
    let wasRelevantUnread = wasTracked;

    if (!wasRelevantUnread && deletedMessage) {
      const msgTs = Number(deletedMessage.created_at) || 0;
      const own = typeof isOwnMessage === "function" && isOwnMessage(deletedMessage);
      const isDm = typeof isPrivateTextId === "function" && isPrivateTextId(channelId);
      const mentioned = isDm || (typeof messageMentionsMe === "function" && Boolean(messageMentionsMe(deletedMessage)));
      if (!own && msgTs > (rs.last_read_at || 0) && mentioned) {
        wasRelevantUnread = true;
      }
    }

    if (!wasRelevantUnread) return false;
    rs.mention_count = Math.max(0, (Number(rs.mention_count) || 0) - 1);
    if (typeof isPrivateTextId === "function" && isPrivateTextId(channelId)) {
      if (rs.mention_count > 0) state.unreadDms?.set(channelId, rs.mention_count);
      else state.unreadDms?.delete(channelId);
      if (typeof renderDmList === "function") renderDmList();
      if (typeof updateHomeNotificationBadges === "function") updateHomeNotificationBadges();
    }
    if (typeof updateDocumentTitle === "function") updateDocumentTitle();
    if (typeof refreshUnreadIndicators === "function") refreshUnreadIndicators();
    return true;
  }

  /**
   * Marca todas as conversas e canais com notificações pendentes como lidos (#27).
   */
  function markAllAsRead() {
    if (typeof state === "undefined") return 0;
    let cleared = 0;
    const now = Date.now();
    if (state.readStates && typeof state.readStates.entries === "function") {
      for (const [chId, rs] of state.readStates.entries()) {
        if ((rs?.mention_count || 0) > 0) {
          rs.mention_count = 0;
          rs.last_read_at = Math.max(rs.last_read_at || 0, now);
          const list = state.chatHistory?.[chId] || [];
          const last = list[list.length - 1];
          if (last?.id && typeof sendWs === "function") {
            sendWs("AckChannel", { channel_id: chId, message_id: last.id });
          }
          cleared++;
        }
      }
    }
    state.unreadDms?.clear();
    unreadMessageIdsByChannel.clear();
    if (typeof renderDmList === "function") renderDmList();
    if (typeof updateHomeNotificationBadges === "function") updateHomeNotificationBadges();
    if (typeof refreshUnreadIndicators === "function") refreshUnreadIndicators();
    if (typeof updateDocumentTitle === "function") updateDocumentTitle();
    return cleared;
  }

  /**
   * Limpa imediatamente contadores e remove a badge da barra de tarefas ao deslogar ou trocar de conta (#42, #43, #44).
   */
  function clearSessionState() {
    lastSoundAt = 0;
    lastFlashAt = 0;
    lastSoundByChannel.clear();
    lastActivityAtByDm.clear();
    prevRailCounts.clear();
    processedMessageIds.clear();
    processedMessageOrder.length = 0;
    unreadMessageIdsByChannel.clear();
    hadInitialWelcome = false;
    if (typeof state !== "undefined") {
      state.readStates?.clear?.();
      state.unreadDms?.clear?.();
      state.lastBadgeSent = -1;
      state.lastTaskbarBadgeSent = -1;
    }
    const host = typeof document !== "undefined" ? document.getElementById("rail-unread-dms") : null;
    if (host) {
      host.replaceChildren();
      host.classList.add("hidden");
    }
    if (typeof updateHomeNotificationBadges === "function") updateHomeNotificationBadges();
    if (typeof updateDocumentTitle === "function") updateDocumentTitle();
  }

  function resolveLivePeer(conv) {
    const peer = conv?.peer;
    if (!peer) return null;
    const lower = String(peer.username || "").toLowerCase();
    const liveUser = typeof state !== "undefined"
      ? Array.from(state.users?.values?.() || []).find((u) => String(u.username || "").toLowerCase() === lower)
      : null;
    const friend = typeof state !== "undefined"
      ? (state.friends || []).find((f) => String(f.username || "").toLowerCase() === lower)
      : null;
    return { ...peer, ...friend, ...liveUser };
  }

  function resolveUnreadDmEntries() {
    if (typeof state === "undefined" || !state.unreadDms) return [];
    if (state.audioSettings?.notifDmBadges === false) return [];

    const dmById = new Map((state.dmConversations || []).map((c) => [c.dm_id, c]));
    const groupById = new Map((state.groupDms || []).map((g) => [g.id, g]));
    const entries = [];

    for (const [chId, rawCount] of state.unreadDms.entries()) {
      const count = Number(rawCount) || 0;
      if (count <= 0) continue;
      if (typeof isPrivateTextId === "function" && !isPrivateTextId(chId)) continue;
      if (typeof isMessageRequest === "function" && isMessageRequest(chId)) continue;

      if (chId.startsWith("gdm:")) {
        const g = groupById.get(chId);
        if (!g) continue;
        const name = typeof groupDisplayName === "function" ? groupDisplayName(g) : (g.name || "Grupo");
        const hist = state.chatHistory?.[chId] || [];
        const lastHistTs = hist.length ? (hist[hist.length - 1].created_at || 0) : 0;
        entries.push({
          kind: "group",
          channelId: chId,
          count,
          name,
          group: g,
          sortTs: Math.max(lastActivityAtByDm.get(chId) || 0, lastHistTs),
        });
      } else {
        const conv = dmById.get(chId);
        const peer = conv ? resolveLivePeer(conv) : resolvePeerFromDmId(chId);
        if (!peer) continue;
        if (isBlockedAuthor(peer.username)) continue;
        const hist = state.chatHistory?.[chId] || [];
        const lastHistTs = hist.length ? (hist[hist.length - 1].created_at || 0) : 0;
        entries.push({
          kind: "dm",
          channelId: chId,
          count,
          name: peer.display_name || peer.username,
          peer,
          conv: conv || { dm_id: chId, peer },
          sortTs: Math.max(lastActivityAtByDm.get(chId) || 0, lastHistTs),
        });
      }
    }

    entries.sort((a, b) => b.sortTs - a.sortTs || a.name.localeCompare(b.name));
    return entries;
  }

  function resolvePeerFromDmId(dmId) {
    if (!dmId || !dmId.startsWith("dm:")) return null;
    const parts = dmId.slice(3).split(":");
    const me = myLowerSafe();
    const otherLower = parts.find((p) => p && p.toLowerCase() !== me) || parts[0];
    if (!otherLower) return null;
    const fromUsers = Array.from(state.users?.values?.() || []).find((u) => String(u.username || "").toLowerCase() === otherLower.toLowerCase());
    if (fromUsers) return fromUsers;
    const fromFriends = (state.friends || []).find((f) => String(f.username || "").toLowerCase() === otherLower.toLowerCase());
    if (fromFriends) return fromFriends;
    const hist = state.chatHistory?.[dmId] || [];
    for (let i = hist.length - 1; i >= 0; i--) {
      if (String(hist[i].author_name || "").toLowerCase() === otherLower.toLowerCase()) {
        return {
          username: hist[i].author_name,
          avatar_color: hist[i].author_color || "#5865f2",
          avatar_url: hist[i].author_avatar || null,
        };
      }
    }
    return { username: otherLower, avatar_color: "#5865f2", avatar_url: null };
  }

  function renderRailUnreadDms() {
    const host = document.getElementById("rail-unread-dms");
    if (!host) return;
    const entries = resolveUnreadDmEntries();
    const nextCounts = new Map();

    host.replaceChildren();
    host.classList.toggle("hidden", entries.length === 0);

    for (const entry of entries) {
      nextCounts.set(entry.channelId, entry.count);
      const prevCount = prevRailCounts.get(entry.channelId) || 0;
      const isEntering = prevCount === 0 && entry.count > 0;
      const isBumping = prevCount > 0 && entry.count > prevCount;

      const wrap = document.createElement("div");
      wrap.className = `guild-item-wrap rail-dm-item${isEntering ? " is-entering" : ""}`;
      wrap.dataset.dmId = entry.channelId;

      const pill = document.createElement("div");
      pill.className = "guild-pill is-unread";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "guild-icon rail-dm-btn";
      const unreadLabel = entry.count === 1 ? "1 mensagem não lida" : `${entry.count} mensagens não lidas`;
      const tooltipText = `${entry.name}\n${unreadLabel}`;
      btn.title = `${entry.name} — ${unreadLabel}`;
      btn.setAttribute("aria-label", `${entry.name}: ${unreadLabel}`);

      if (entry.kind === "group") {
        btn.classList.add("is-group");
        if (entry.group.icon_url) {
          const img = document.createElement("img");
          img.src = typeof cachedMediaUrl === "function" ? cachedMediaUrl(entry.group.icon_url) : entry.group.icon_url;
          img.alt = entry.name;
          img.className = "guild-logo-img";
          btn.append(img);
        } else {
          const grpSpan = document.createElement("span");
          grpSpan.className = "rail-dm-group-glyph";
          grpSpan.setAttribute("aria-hidden", "true");
          grpSpan.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;
          btn.append(grpSpan);
        }
      } else {
        btn.style.background = entry.peer.avatar_color || "#5865f2";
        if (entry.peer.avatar_url) {
          const img = document.createElement("img");
          img.src = typeof cachedMediaUrl === "function" ? cachedMediaUrl(entry.peer.avatar_url) : entry.peer.avatar_url;
          img.alt = entry.name;
          img.className = "guild-logo-img";
          btn.append(img);
        } else {
          const initials = document.createElement("span");
          initials.className = "guild-initials";
          initials.textContent = String(entry.name || "?").trim().charAt(0).toUpperCase();
          btn.append(initials);
        }
      }

      const badge = document.createElement("span");
      badge.className = `rail-notif-badge rail-dm-badge${isBumping ? " is-bumping" : ""}`;
      badge.textContent = formatUnreadCount(entry.count);
      badge.dataset.unreadCount = String(entry.count);

      btn.addEventListener("click", () => {
        if (entry.kind === "group") {
          if (typeof openGroupConversation === "function") openGroupConversation(entry.channelId);
        } else if (typeof sendWs === "function") {
          sendWs("OpenDm", { target_username: entry.peer.username });
        }
      });

      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (entry.kind === "group") {
          if (typeof groupContextMenu === "function") groupContextMenu(entry.group, e.clientX, e.clientY);
        } else if (typeof DmContextMenu !== "undefined") {
          DmContextMenu.open(e.clientX, e.clientY, { conv: entry.conv, peer: entry.peer });
        }
      });

      if (typeof SancordUI !== "undefined" && typeof SancordUI.tooltip === "function") {
        SancordUI.tooltip(btn, tooltipText.replace("\n", " · "), "right");
      }

      wrap.append(pill, btn, badge);
      host.append(wrap);
    }

    prevRailCounts.clear();
    for (const [k, v] of nextCounts.entries()) prevRailCounts.set(k, v);
  }

  let activeCallNotification = null;

  /**
   * Notificação nativa discreta + atenção na barra de tarefas quando uma chamada privada chega
   * com a janela minimizada ou sem foco. Clicar na notificação restaura e foca o app.
   */
  function notifyIncomingCall(call) {
    if (!call) return false;
    const from = call.caller_display_name || call.from_username || "Alguém";
    if (isBlockedAuthor(call.caller_username || call.from_username)) return false;
    if (typeof state !== "undefined" && state.audioSettings?.streamerMode) return false;

    const unfocused = typeof document !== "undefined" && (document.hidden || !document.hasFocus());
    if (unfocused && typeof window !== "undefined") {
      try {
        window.ipc?.postMessage("call-attention:start");
      } catch (_) {}
    }

    const dnd = typeof state !== "undefined" && state.selfUser?.status_kind === "dnd";
    const muted = Boolean(call.dm_id && typeof isMutedId === "function" && isMutedId(call.dm_id));
    if (dnd || muted || !unfocused) return unfocused;

    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return true;
    }
    try {
      activeCallNotification?.close?.();
      const body = call.group_name
        ? `Chamada em grupo (${call.group_name}) · Clique para atender ou recusar`
        : "Chamada privada no Sanvo · Clique para atender ou recusar";
      const notif = new Notification(`${from} está ligando...`, {
        body,
        icon: "/logo.png",
        tag: `sanvo-call:${call.call_id || call.voice_channel_id || from}`,
        requireInteraction: true,
        silent: true, // O ringtone oficial do SoundManager já é o áudio autoritativo.
      });
      notif.onclick = () => {
        try {
          window.ipc?.postMessage("window:focus");
        } catch (_) {}
        try {
          window.focus?.();
        } catch (_) {}
        notif.close();
      };
      activeCallNotification = notif;
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearIncomingCallAttention() {
    try {
      activeCallNotification?.close?.();
    } catch (_) {}
    activeCallNotification = null;
    if (typeof window !== "undefined") {
      try {
        window.ipc?.postMessage("call-attention:stop");
      } catch (_) {}
    }
  }

  function resetForTests() {
    clearIncomingCallAttention();
    lastSoundAt = 0;
    lastFlashAt = 0;
    lastSoundByChannel.clear();
    lastActivityAtByDm.clear();
    prevRailCounts.clear();
    processedMessageIds.clear();
    processedMessageOrder.length = 0;
    unreadMessageIdsByChannel.clear();
    hadInitialWelcome = false;
  }

  return {
    formatUnreadCount,
    getGlobalUnreadNotificationCount,
    globalUnreadNotificationCount: getGlobalUnreadNotificationCount,
    getNotificationVolumePct,
    rememberProcessedId,
    hasProcessedMessage,
    trackUnreadMessageId,
    clearTrackedUnreadForChannel,
    isBlockedAuthor,
    isConversationOpenAndViewed,
    shouldIncrementUnread,
    shouldPlaySound,
    shouldShowDesktopNotification,
    shouldShowDmBadge,
    shouldFlashTaskbar,
    recordSoundPlayed,
    noteDmActivity,
    synthesizeSancordDmChime,
    synthesizeSanvoDmChime: synthesizeSancordDmChime,
    handleIncomingSound,
    notifyIncomingCall,
    clearIncomingCallAttention,
    onWelcomeSync,
    onMessageDeleted,
    markAllAsRead,
    clearSessionState,
    resolveUnreadDmEntries,
    renderRailUnreadDms,
    resetForTests,
  };
})();
const SanvoNotifications = SancordNotifications;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoNotifications = SancordNotifications;
  globalThis.SancordNotifications = SancordNotifications; // LEGACY COMPATIBILITY
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SancordNotifications, SanvoNotifications };
}
