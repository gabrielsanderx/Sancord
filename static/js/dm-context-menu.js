/**
 * DmContextMenu — Menu contextual completo para conversas diretas (DM) e amigos.
 *
 * Reutiliza integralmente `SancordUI` (ContextMenu* genérico), `SancordIcons`
 * (sem emojis na chrome do menu), `UserPrefs` (`pinned_dms`, `favorite_dms`,
 * `user_notes`, `ignored_users`, `mutes`, `notify_levels`) e os eventos WS
 * existentes (`AckChannel`, `CloseDm`, `InviteFriendToServer`, `SendFriendRequest`,
 * `RemoveFriend`, `CancelFriendRequest`, `RespondFriendRequest`, `BlockUser`,
 * `UnblockUser`, `OpenDm`, `JoinVoice`).
 *
 * Propositalmente SEM a opção "Apps".
 */
const DmContextMenu = (() => {
  const inflight = new Set();

  function dmIdForUsers(a, b) {
    const x = String(a || "").toLowerCase();
    const y = String(b || "").toLowerCase();
    if (!x || !y) return "";
    return x <= y ? `dm:${x}__${y}` : `dm:${y}__${x}`;
  }

  function voiceIdForDm(dmId) {
    return String(dmId || "").replace(/^dm:/, "dmvoice:");
  }

  function getPinnedDms() {
    return Array.isArray(state?.prefs?.pinned_dms) ? state.prefs.pinned_dms : [];
  }

  function getFavoriteDms() {
    return Array.isArray(state?.prefs?.favorite_dms) ? state.prefs.favorite_dms : [];
  }

  function isPinnedDm(dmId) {
    return Boolean(dmId && getPinnedDms().includes(dmId));
  }

  function isFavoriteDm(dmId) {
    return Boolean(dmId && getFavoriteDms().includes(dmId));
  }

  function togglePinnedDm(dmId, label) {
    if (!dmId) return;
    const prev = getPinnedDms();
    const already = prev.includes(dmId);
    const next = already ? prev.filter((id) => id !== dmId) : [dmId, ...prev.filter((id) => id !== dmId)];
    state.prefs = { ...(state.prefs || {}), pinned_dms: next };
    if (typeof sendWs === "function") sendWs("UpdateUserPrefs", { pinned_dms: next });
    if (typeof renderDmList === "function") renderDmList();
    if (typeof showUiToast === "function") {
      showUiToast(already ? `${label || "Conversa"} desafixada.` : `${label || "Conversa"} fixada no topo.`);
    }
  }

  function toggleFavoriteDm(dmId, label) {
    if (!dmId) return;
    const prev = getFavoriteDms();
    const already = prev.includes(dmId);
    const next = already ? prev.filter((id) => id !== dmId) : [dmId, ...prev.filter((id) => id !== dmId)];
    state.prefs = { ...(state.prefs || {}), favorite_dms: next };
    if (typeof sendWs === "function") sendWs("UpdateUserPrefs", { favorite_dms: next });
    if (typeof renderDmList === "function") renderDmList();
    if (typeof updateHomeStarredBadge === "function") updateHomeStarredBadge();
    if (state.homeSection === "starred" && typeof renderHomeStarredView === "function") renderHomeStarredView();
    if (typeof showUiToast === "function") {
      showUiToast(already ? `${label || "Conversa"} removida dos favoritos.` : `${label || "Conversa"} adicionada aos favoritos.`);
    }
  }

  function markDmAsRead(dmId) {
    if (!dmId) return;
    const hist = state.chatHistory?.[dmId] || [];
    const last = hist[hist.length - 1];
    if (typeof sendWs === "function") {
      sendWs("AckChannel", { channel_id: dmId, message_id: last?.id || "" });
    }
    state.unreadDms?.delete?.(dmId);
    if (typeof renderDmList === "function") renderDmList();
    if (typeof refreshUnreadIndicators === "function") refreshUnreadIndicators();
  }

  async function openPrivateNoteDialog(peer) {
    const username = peer?.username;
    if (!username || typeof SancordUI?.formDialog !== "function") return;
    const current = typeof getUserProfileNote === "function" ? getUserProfileNote(username) : "";
    const displayName = peer.display_name || username;
    const res = await SancordUI.formDialog({
      title: current ? `Editar nota sobre ${displayName}` : `Adicionar nota sobre ${displayName}`,
      description: "Visível apenas para você. Nunca é enviada nem exibida para a outra pessoa.",
      submitLabel: "Salvar nota",
      extraAction: current
        ? {
            label: "Remover nota",
            danger: true,
            onClick: () => {
              if (typeof setUserProfileNote === "function") setUserProfileNote(username, "");
              if (typeof showUiToast === "function") showUiToast("Nota removida.");
            },
          }
        : null,
      fields: [
        {
          name: "note",
          label: "Nota privada",
          type: "textarea",
          value: current,
          maxlength: 256,
          placeholder: "Ex.: Conheci no servidor Minecraft",
        },
      ],
    });
    if (!res) return;
    const clean = String(res.note || "").trim();
    if (typeof setUserProfileNote === "function") setUserProfileNote(username, clean);
    if (typeof showUiToast === "function") {
      showUiToast(clean ? "Nota privada salva." : "Nota removida.");
    }
  }

  function closeDmConversation(dmId) {
    if (!dmId) return;
    if (typeof sendWs === "function") sendWs("CloseDm", { dm_id: dmId });
    if (Array.isArray(state.dmConversations)) {
      state.dmConversations = state.dmConversations.filter((c) => c.dm_id !== dmId);
    }
    if (state.activeView === "home" && state.activeDmId === dmId && typeof switchToHomeFriendsView === "function") {
      switchToHomeFriendsView();
    } else if (typeof renderDmList === "function") {
      renderDmList();
    }
  }

  function getInvitableServers(targetLower) {
    const servers = Array.isArray(state?.servers) ? state.servers : [];
    const meLower = (state?.selfUser?.username || "").toLowerCase();
    return servers.filter((srv) => {
      if (!srv || !srv.id || srv.id === "sancord") return false;
      if (srv.invites_paused) return false;
      const members = (srv.members || []).map((m) => String(m).toLowerCase());
      if (members.includes(targetLower) || String(srv.owner_username || "").toLowerCase() === targetLower) return false;
      const banned = (srv.banned_usernames || []).map((b) => String(b).toLowerCase());
      if (banned.includes(targetLower)) return false;
      if (typeof hasServerPerm === "function") {
        return hasServerPerm(srv, "create_invites");
      }
      if (String(srv.owner_username || "").toLowerCase() === meLower) return true;
      return Boolean(srv.effective_permissions?.create_invites);
    });
  }

  function getRelationship(targetLower) {
    const selfLower = (state?.selfUser?.username || "").toLowerCase();
    if (!targetLower || targetLower === selfLower) return "self";
    if ((state?.blocked || []).some((u) => u?.username?.toLowerCase() === targetLower)) return "blocked";
    if ((state?.friends || []).some((u) => u?.username?.toLowerCase() === targetLower)) return "friend";
    if ((state?.outgoingRequests || []).some((u) => u?.username?.toLowerCase() === targetLower)) return "outgoing";
    if ((state?.incomingRequests || []).some((u) => u?.username?.toLowerCase() === targetLower)) return "incoming";
    return "none";
  }

  function copyTextWithFeedback(text, label) {
    if (!text) return;
    const ok = () => { if (typeof showUiToast === "function") showUiToast(`${label} copiado.`); };
    if (typeof copyTextSafe === "function") {
      Promise.resolve(copyTextSafe(text)).then(ok).catch(() => {
        if (typeof showUiToast === "function") showUiToast("Não foi possível copiar o ID.");
      });
      return;
    }
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(() => {
        if (typeof showUiToast === "function") showUiToast("Não foi possível copiar o ID.");
      });
    }
  }

  function runGuarded(key, fn) {
    if (inflight.has(key)) return;
    inflight.add(key);
    Promise.resolve()
      .then(fn)
      .catch((err) => {
        console.error("[Sancord] Erro na ação do menu DM:", err);
        if (typeof showUiToast === "function") showUiToast("Não foi possível concluir esta ação agora.");
      })
      .finally(() => {
        setTimeout(() => inflight.delete(key), 600);
      });
  }

  function resolvePeerAccountId(peer) {
    if (peer?.id) return peer.id;
    const lower = String(peer?.username || "").toLowerCase();
    if (!lower) return null;
    const fromFriends = (state?.friends || []).find((f) => f?.username?.toLowerCase() === lower);
    if (fromFriends?.id) return fromFriends.id;
    for (const srv of state?.servers || []) {
      const fromRoster = srv?.member_roster?.[lower];
      if (fromRoster?.id) return fromRoster.id;
    }
    for (const u of state?.users?.values?.() || []) {
      if (u?.username?.toLowerCase() === lower && u.id) return u.id;
    }
    return null;
  }

  function buildMuteSubmenu(dmId, peerHandle, peerName) {
    const { ContextMenuItem, ContextMenuSeparator, ContextMenuLabel } = SancordUI;
    const until = typeof muteUntil === "function" ? muteUntil(dmId) : null;
    const choices = typeof MUTE_CHOICES !== "undefined"
      ? MUTE_CHOICES
      : [
          [15, "Por 15 minutos"],
          [60, "Por 1 hora"],
          [180, "Por 3 horas"],
          [480, "Por 8 horas"],
          [1440, "Por 24 horas"],
          [0, "Até eu reativar"],
        ];
    const items = [];
    if (until !== null) {
      const hint = typeof muteUntilLabel === "function" ? muteUntilLabel(until) : "";
      items.push(ContextMenuItem({
        id: "unmute-dm",
        label: `Reativar som de ${peerHandle}`,
        icon: "bell",
        hint,
        onSelect: () => { if (typeof setMute === "function") setMute(dmId, null, peerName); },
      }));
      items.push(ContextMenuSeparator());
    }
    for (const [minutes, label] of choices) {
      items.push(ContextMenuItem({
        id: `mute-${minutes}`,
        label,
        icon: "clock",
        onSelect: () => { if (typeof setMute === "function") setMute(dmId, minutes, peerName); },
      }));
    }

    // Reorganiza as preferências de notificação da DM dentro do submenu (sem poluir o menu principal).
    if (typeof channelNotifyLevel === "function" && typeof setChannelNotifyLevel === "function") {
      const cur = channelNotifyLevel(dmId) || "default";
      const levels = [
        ["default", "Padrão"],
        ["all", "Todas as mensagens"],
        ["mentions", "Só @menções"],
        ["none", "Nada"],
      ];
      items.push(ContextMenuSeparator());
      items.push(ContextMenuLabel("Notificações"));
      for (const [val, lbl] of levels) {
        items.push(ContextMenuItem({
          id: `notify-${val}`,
          label: lbl,
          checked: cur === val,
          onSelect: () => setChannelNotifyLevel(dmId, val),
        }));
      }
    }
    return items;
  }

  /**
   * Constrói os itens do menu contextual de DM/Amigo (testável sem DOM).
   */
  function buildItems({ conv = null, peer = null } = {}) {
    const p = peer || conv?.peer;
    if (!p || !p.username) return [];
    const {
      ContextMenuItem,
      ContextMenuDangerItem,
      ContextMenuSubmenu,
      ContextMenuSeparator,
    } = SancordUI;

    const meLower = (state?.selfUser?.username || "").toLowerCase();
    const targetLower = p.username.toLowerCase();
    const dmId = conv?.dm_id || dmIdForUsers(meLower, targetLower);
    const displayName = p.display_name || p.username;
    const handle = `@${p.username}`;
    const unread = dmId ? (state?.unreadDms?.get?.(dmId) || 0) : 0;
    const rel = getRelationship(targetLower);
    const isSelf = rel === "self";
    const isBlocked = rel === "blocked";
    const isIgnored = Boolean(state?.ignoredUsers?.has?.(targetLower));
    const hasOpenDm = Boolean(dmId && (state?.dmConversations || []).some((c) => c.dm_id === dmId));
    const note = typeof getUserProfileNote === "function" ? getUserProfileNote(p.username) : "";
    const pinned = isPinnedDm(dmId);
    const favorited = isFavoriteDm(dmId);
    const dmVoiceId = voiceIdForDm(dmId);
    const inThisCall = Boolean(state?.currentVoiceChannel && state.currentVoiceChannel === dmVoiceId);
    const mutedUntil = dmId && typeof muteUntil === "function" ? muteUntil(dmId) : null;
    const devMode = Boolean(state?.uiSettings?.developerMode);

    const items = [];

    // GRUPO 1: Marcar como lida
    items.push(ContextMenuItem({
      id: "mark-read",
      label: "Marcar como lida",
      icon: "check",
      disabled: !unread,
      onSelect: () => markDmAsRead(dmId),
    }));

    // GRUPO 2: Fixar + Favoritos
    if (dmId) {
      items.push(ContextMenuSeparator());
      items.push(ContextMenuItem({
        id: "toggle-pin",
        label: pinned ? "Desafixar" : "Fixar",
        icon: "pin",
        onSelect: () => togglePinnedDm(dmId, displayName),
      }));
      items.push(ContextMenuItem({
        id: "toggle-favorite",
        label: favorited ? "Remover dos favoritos" : "Adicionar aos favoritos",
        icon: "star",
        onSelect: () => toggleFavoriteDm(dmId, displayName),
      }));
    }

    // GRUPO 3: Perfil, Iniciar chamada, Adicionar nota, Fechar mensagem direta
    items.push(ContextMenuSeparator());
    items.push(ContextMenuItem({
      id: "profile",
      label: "Perfil",
      icon: "user",
      onSelect: () => {
        if (typeof openMemberProfilePopover === "function") {
          openMemberProfilePopover(p.live_id || null, {
            author_name: p.username,
            author_color: p.avatar_color,
            author_avatar: p.avatar_url,
          });
        }
      },
    }));

    if (!isSelf && !isBlocked) {
      items.push(ContextMenuItem({
        id: "call",
        label: inThisCall ? "Desconectar da chamada" : "Iniciar chamada",
        icon: inThisCall ? "disconnect" : "phone",
        onSelect: () => {
          if (inThisCall) {
            if (typeof leaveVoiceChannel === "function") leaveVoiceChannel();
            return;
          }
          if (typeof sendWs === "function") sendWs("OpenDm", { target_username: p.username });
          if (typeof joinVoiceChannel === "function") {
            joinVoiceChannel(dmVoiceId, `Call privada: ${handle}`);
          }
        },
      }));
    }

    if (!isSelf) {
      items.push(ContextMenuItem({
        id: "note",
        label: note ? "Editar nota" : "Adicionar nota",
        sublabel: "Visível apenas para você",
        icon: "edit",
        onSelect: () => openPrivateNoteDialog(p),
      }));
    }

    if (hasOpenDm) {
      items.push(ContextMenuItem({
        id: "close-dm",
        label: "Fechar mensagem direta",
        icon: "close",
        onSelect: () => closeDmConversation(dmId),
      }));
    }

    // GRUPO 4: Convidar para servidor >, Relacionamento, Ignorar, Bloquear (SEM "Apps")
    if (!isSelf) {
      items.push(ContextMenuSeparator());
      const invitable = isBlocked ? [] : getInvitableServers(targetLower);
      if (invitable.length > 0) {
        items.push(ContextMenuSubmenu({
          id: "invite-server",
          label: "Convidar para o servidor",
          icon: "user-plus",
          submenu: invitable.map((srv) => ContextMenuItem({
            id: `invite-${srv.id}`,
            label: srv.name,
            icon: "globe",
            onSelect: () => runGuarded(`invite:${srv.id}:${targetLower}`, () => {
              if (typeof sendWs === "function") {
                sendWs("InviteFriendToServer", {
                  server_id: srv.id,
                  target_username: p.username,
                });
              }
              if (typeof showUiToast === "function") {
                showUiToast(`Convite de ${srv.name} enviado para ${displayName}.`);
              }
            }),
          })),
        }));
      }

      if (rel === "friend") {
        items.push(ContextMenuItem({
          id: "remove-friend",
          label: "Remover amigo",
          icon: "users",
          onSelect: () => runGuarded(`remfriend:${targetLower}`, async () => {
            const ok = typeof SancordUI.confirm === "function"
              ? await SancordUI.confirm({
                  title: "Remover amigo?",
                  message: `Remover ${displayName} da sua lista de amigos?`,
                  confirmLabel: "Remover amigo",
                  danger: true,
                })
              : true;
            if (ok && typeof sendWs === "function") {
              sendWs("RemoveFriend", { target_username: p.username });
            }
          }),
        }));
      } else if (rel === "outgoing") {
        items.push(ContextMenuItem({
          id: "cancel-request",
          label: "Cancelar solicitação",
          icon: "close",
          onSelect: () => runGuarded(`cancelreq:${targetLower}`, () => {
            if (typeof sendWs === "function") sendWs("CancelFriendRequest", { target_username: p.username });
          }),
        }));
      } else if (rel === "incoming") {
        items.push(ContextMenuItem({
          id: "accept-request",
          label: "Aceitar amizade",
          icon: "check",
          onSelect: () => runGuarded(`acceptreq:${targetLower}`, () => {
            if (typeof sendWs === "function") {
              sendWs("RespondFriendRequest", { from_username: p.username, accept: true });
            }
          }),
        }));
      } else if (!isBlocked) {
        items.push(ContextMenuItem({
          id: "add-friend",
          label: "Adicionar amigo",
          icon: "user-plus",
          onSelect: () => runGuarded(`addfriend:${targetLower}`, () => {
            if (typeof sendWs === "function") sendWs("SendFriendRequest", { target_username: p.username });
          }),
        }));
      }

      items.push(ContextMenuItem({
        id: "toggle-ignore",
        label: isIgnored ? "Deixar de ignorar" : "Ignorar",
        icon: isIgnored ? "eye" : "eye-off",
        onSelect: () => {
          if (!state.ignoredUsers) state.ignoredUsers = new Set();
          if (state.ignoredUsers.has(targetLower)) {
            state.ignoredUsers.delete(targetLower);
            if (typeof showUiToast === "function") showUiToast(`${displayName} não está mais ignorado.`);
          } else {
            state.ignoredUsers.add(targetLower);
            if (typeof showUiToast === "function") showUiToast(`${displayName} foi ignorado.`);
          }
          if (typeof saveModerationLists === "function") saveModerationLists();
          if (typeof renderChatMessages === "function") renderChatMessages();
        },
      }));

      if (isBlocked) {
        items.push(ContextMenuItem({
          id: "unblock",
          label: "Desbloquear",
          icon: "shield",
          onSelect: () => runGuarded(`unblock:${targetLower}`, () => {
            if (typeof sendWs === "function") sendWs("UnblockUser", { target_username: p.username });
          }),
        }));
      } else {
        items.push(ContextMenuDangerItem({
          id: "block",
          label: "Bloquear",
          icon: "ban",
          onSelect: () => runGuarded(`block:${targetLower}`, async () => {
            if (typeof confirmBlockUser === "function") {
              await confirmBlockUser(p.username);
              return;
            }
            const ok = typeof SancordUI.confirm === "function"
              ? await SancordUI.confirm({
                  title: `Bloquear ${displayName}?`,
                  message: "Vocês não poderão trocar mensagens diretas nem chamadas enquanto estiver bloqueado.",
                  confirmLabel: "Bloquear",
                  danger: true,
                })
              : true;
            if (ok && typeof sendWs === "function") sendWs("BlockUser", { target_username: p.username });
          }),
        }));
      }
    }

    // GRUPO 5: Silenciar @usuário > (unifica mute + notificações em submenu único)
    if (dmId && !isSelf) {
      items.push(ContextMenuSeparator());
      items.push(ContextMenuSubmenu({
        id: "mute-user",
        label: mutedUntil !== null ? `Silenciado (${handle})` : `Silenciar ${handle}`,
        icon: mutedUntil !== null ? "bell-off" : "bell",
        hint: mutedUntil !== null && typeof muteUntilLabel === "function" ? muteUntilLabel(mutedUntil) : undefined,
        submenu: buildMuteSubmenu(dmId, handle, displayName),
      }));
    }

    // GRUPO 6: IDs (respeita Developer Mode)
    if (devMode) {
      const userIdVal = resolvePeerAccountId(p);
      if (userIdVal || dmId) {
        items.push(ContextMenuSeparator());
        if (userIdVal) {
          items.push(ContextMenuItem({
            id: "copy-user-id",
            label: "Copiar ID do usuário",
            icon: "copy",
            onSelect: () => copyTextWithFeedback(userIdVal, "ID do usuário"),
          }));
        }
        if (dmId) {
          items.push(ContextMenuItem({
            id: "copy-channel-id",
            label: "Copiar ID do canal",
            icon: "copy",
            onSelect: () => copyTextWithFeedback(dmId, "ID do canal"),
          }));
        }
      }
    }

    return items;
  }

  function open(x, y, ctx, uiOpts = {}) {
    const items = buildItems(ctx);
    if (!items.length) return;
    const name = ctx?.peer?.display_name || ctx?.peer?.username || ctx?.conv?.peer?.display_name || ctx?.conv?.peer?.username || "Conversa";
    SancordUI.ContextMenu(x, y, items, {
      compact: true,
      className: "dm-context-menu",
      label: `Ações para ${name}`,
      ...uiOpts,
    });
  }

  return {
    open,
    buildItems,
    isPinnedDm,
    isFavoriteDm,
    togglePinnedDm,
    toggleFavoriteDm,
    markDmAsRead,
    closeDmConversation,
    getInvitableServers,
    getRelationship,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DmContextMenu };
}
