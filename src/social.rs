//! Fase 5 — recursos sociais: bloqueio, solicitações de mensagem, grupos
//! privados, perfil completo e denúncias. Toda regra é aplicada no servidor.
use crate::models::{
    ChatMessage, ClientMessage, FriendsStore, GroupDm, MessageMentions, MutualServer,
    ServerMessage,
};
use crate::state::{ServerState, SharedState};
use crate::validate::{validate_image_data_url, MAX_PROFILE_IMAGE_BYTES};
use chrono::Local;
use std::collections::HashMap;
use uuid::Uuid;

const GROUP_NAME_MAX: usize = 32;
const REPORT_REASON_MAX: usize = 500;

fn me_lower(st: &ServerState, user_id: &str) -> Option<String> {
    st.users.get(user_id).map(|u| u.username.to_lowercase())
}

fn clean_group_name(name: Option<String>) -> Option<String> {
    name.map(|n| n.trim().chars().take(GROUP_NAME_MAX).collect::<String>())
        .filter(|n| !n.is_empty())
}

fn normalized_usernames(list: Vec<String>, me: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for u in list.into_iter().map(|u| u.trim().to_lowercase()).take(20) {
        if !u.is_empty() && u != me && !out.contains(&u) {
            out.push(u);
        }
    }
    out
}

/// Mensagem de sistema dentro de um grupo (entrou, saiu, renomeou...).
fn group_system_message(st: &mut ServerState, group_id: &str, content: String) {
    let msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        channel_id: group_id.to_string(),
        author_id: "system".into(),
        author_name: "Sancord".into(),
        author_color: "#5865F2".into(),
        author_avatar: Some("/logo.png".into()),
        content,
        image_url: None,
        reply_to: None,
        reactions: HashMap::new(),
        edited: false,
        pinned: false,
        timestamp: Local::now().format("%H:%M").to_string(),
        created_at: st.next_message_ts(),
        nonce: None,
        attachments: Vec::new(),
        mentions: MessageMentions::default(),
        poll: None,
        author_kind: crate::models::AuthorKind::System,
    };
    st.insert_message(msg.clone());
    st.send_to_dm_participants(group_id, ServerMessage::NewChatMessage { message: msg });
}

fn sync_all(st: &ServerState, users: &[String]) {
    for u in users {
        st.send_friends_sync_to_username(u);
    }
}

/// Quem pode entrar num grupo junto com `me`: amigo, sem bloqueio entre eles
/// nem com nenhum membro atual.
fn can_add_to_group(st: &ServerState, me: &str, target: &str, members: &[String]) -> Result<(), String> {
    let display = st
        .resolve_friend_info(target)
        .map(|f| f.username)
        .unwrap_or_else(|| target.to_string());
    if !st.target_exists(target) {
        return Err(format!("Usuário '{display}' não encontrado."));
    }
    if !st.friends_store.are_friends(me, target) {
        return Err(format!("Só é possível adicionar amigos ao grupo ({display} não é seu amigo)."));
    }
    if members.iter().any(|m| st.friends_store.blocked_either(m, target)) {
        return Err(format!("Não é possível adicionar {display} a este grupo."));
    }
    Ok(())
}

fn display_of(st: &ServerState, lower: &str) -> String {
    st.resolve_friend_info(lower)
        .map(|f| f.display_name.unwrap_or(f.username))
        .unwrap_or_else(|| lower.to_string())
}

pub(crate) async fn handle(user_id: &str, msg: ClientMessage, state: &SharedState) {
    let mut st = state.write().await;
    let Some(me) = me_lower(&st, user_id) else {
        return;
    };
    match msg {
        ClientMessage::BlockUser { target_username } => {
            let target = target_username.trim().to_lowercase();
            if target.is_empty() || target == me || !st.target_exists(&target) {
                st.feedback(user_id, false, "block_user", "Usuário não encontrado.");
                return;
            }
            let fs = &mut st.friends_store;
            FriendsStore::remove_from(&mut fs.friends, &me, &target);
            FriendsStore::remove_from(&mut fs.friends, &target, &me);
            FriendsStore::remove_from(&mut fs.incoming_requests, &me, &target);
            FriendsStore::remove_from(&mut fs.incoming_requests, &target, &me);
            FriendsStore::remove_from(&mut fs.outgoing_requests, &me, &target);
            FriendsStore::remove_from(&mut fs.outgoing_requests, &target, &me);
            // A conversa some da minha lista de solicitações.
            let dm_id = ServerState::make_dm_id(&me, &target);
            FriendsStore::remove_from(&mut fs.dm_requests, &me, &dm_id);
            FriendsStore::push_unique(&mut fs.blocked, &me, &target);
            st.save_friends();
            st.enforce_voice_access();
            st.feedback(user_id, true, "block_user", "Usuário bloqueado.");
            sync_all(&st, &[me, target]);
        }

        ClientMessage::UnblockUser { target_username } => {
            let target = target_username.trim().to_lowercase();
            FriendsStore::remove_from(&mut st.friends_store.blocked, &me, &target);
            st.save_friends();
            st.feedback(user_id, true, "unblock_user", "Usuário desbloqueado.");
            sync_all(&st, &[me, target]);
        }

        ClientMessage::AcceptMessageRequest { dm_id } => {
            if !st.friends_store.is_request(&me, &dm_id) {
                return;
            }
            FriendsStore::remove_from(&mut st.friends_store.dm_requests, &me, &dm_id);
            FriendsStore::push_unique(&mut st.friends_store.open_dms, &me, &dm_id);
            st.save_friends();
            st.send_friends_sync_to_username(&me);
        }

        ClientMessage::IgnoreMessageRequest { dm_id } => {
            if !st.friends_store.is_request(&me, &dm_id) {
                return;
            }
            FriendsStore::remove_from(&mut st.friends_store.dm_requests, &me, &dm_id);
            FriendsStore::remove_from(&mut st.friends_store.open_dms, &me, &dm_id);
            FriendsStore::push_unique(&mut st.friends_store.ignored_dms, &me, &dm_id);
            st.save_friends();
            st.send_friends_sync_to_username(&me);
        }

        ClientMessage::CreateGroupDm { usernames, name } => {
            let others = normalized_usernames(usernames, &me);
            if others.is_empty() {
                st.feedback(user_id, false, "create_group", "Escolha pelo menos um amigo.");
                return;
            }
            if others.len() + 1 > GroupDm::MAX_MEMBERS {
                st.feedback(
                    user_id,
                    false,
                    "create_group",
                    format!("Um grupo pode ter no máximo {} pessoas.", GroupDm::MAX_MEMBERS),
                );
                return;
            }
            let mut members = vec![me.clone()];
            for o in &others {
                if let Err(e) = can_add_to_group(&st, &me, o, &members) {
                    st.feedback(user_id, false, "create_group", e);
                    return;
                }
                members.push(o.clone());
            }
            let group = GroupDm {
                id: format!("gdm:{}", Uuid::new_v4()),
                name: clean_group_name(name),
                icon_url: None,
                owner: me.clone(),
                members: members.clone(),
                created_at: crate::auth::now_ms(),
            };
            let gid = group.id.clone();
            st.group_dms.insert(gid.clone(), group);
            st.chat_history.entry(gid.clone()).or_default();
            st.save_group(&gid);
            let me_name = display_of(&st, &me);
            group_system_message(&mut st, &gid, format!("**{me_name}** criou o grupo."));
            sync_all(&st, &members);
            st.send_to(user_id, ServerMessage::GroupDmOpened { group_id: gid });
        }

        ClientMessage::UpdateGroupDm { group_id, name, icon_url } => {
            let Some(g) = st.group_dms.get(&group_id).filter(|g| g.members.contains(&me)).cloned() else {
                return;
            };
            let mut changed = g.clone();
            let mut notes = Vec::new();
            let me_name = display_of(&st, &me);
            if let Some(n) = name {
                let clean = clean_group_name(Some(n));
                if clean != g.name {
                    notes.push(match &clean {
                        Some(n) => format!("**{me_name}** renomeou o grupo para **{n}**."),
                        None => format!("**{me_name}** removeu o nome do grupo."),
                    });
                    changed.name = clean;
                }
            }
            if let Some(icon) = icon_url {
                let icon = icon.trim().to_string();
                if icon.is_empty() {
                    changed.icon_url = None;
                } else if let Err(e) = validate_image_data_url(&icon, MAX_PROFILE_IMAGE_BYTES) {
                    st.feedback(user_id, false, "update_group", e.user_message());
                    return;
                } else {
                    changed.icon_url = Some(icon);
                }
                if changed.icon_url != g.icon_url {
                    notes.push(format!("**{me_name}** alterou o ícone do grupo."));
                }
            }
            st.group_dms.insert(group_id.clone(), changed.clone());
            st.save_group(&group_id);
            for n in notes {
                group_system_message(&mut st, &group_id, n);
            }
            sync_all(&st, &changed.members);
        }

        ClientMessage::AddGroupDmMembers { group_id, usernames } => {
            let Some(g) = st.group_dms.get(&group_id).filter(|g| g.members.contains(&me)).cloned() else {
                return;
            };
            let new: Vec<String> = normalized_usernames(usernames, &me)
                .into_iter()
                .filter(|u| !g.members.contains(u))
                .collect();
            if new.is_empty() {
                return;
            }
            if g.members.len() + new.len() > GroupDm::MAX_MEMBERS {
                st.feedback(
                    user_id,
                    false,
                    "add_group_member",
                    format!("Um grupo pode ter no máximo {} pessoas.", GroupDm::MAX_MEMBERS),
                );
                return;
            }
            let mut members = g.members.clone();
            for u in &new {
                if let Err(e) = can_add_to_group(&st, &me, u, &members) {
                    st.feedback(user_id, false, "add_group_member", e);
                    return;
                }
                members.push(u.clone());
            }
            if let Some(gm) = st.group_dms.get_mut(&group_id) {
                gm.members = members.clone();
            }
            st.save_group(&group_id);
            let me_name = display_of(&st, &me);
            for u in &new {
                let name = display_of(&st, u);
                group_system_message(&mut st, &group_id, format!("**{me_name}** adicionou **{name}** ao grupo."));
            }
            sync_all(&st, &members);
        }

        ClientMessage::RemoveGroupDmMember { group_id, username } => {
            let target = username.trim().to_lowercase();
            let Some(g) = st.group_dms.get(&group_id).cloned() else {
                return;
            };
            if g.owner != me {
                st.feedback(user_id, false, "remove_group_member", "Só o dono do grupo pode remover membros.");
                return;
            }
            if target == me || !g.members.contains(&target) {
                return;
            }
            if let Some(gm) = st.group_dms.get_mut(&group_id) {
                gm.members.retain(|m| m != &target);
            }
            st.save_group(&group_id);
            let (me_name, name) = (display_of(&st, &me), display_of(&st, &target));
            group_system_message(&mut st, &group_id, format!("**{me_name}** removeu **{name}** do grupo."));
            st.enforce_voice_access();
            sync_all(&st, &g.members);
        }

        ClientMessage::LeaveGroupDm { group_id } => {
            let Some(g) = st.group_dms.get(&group_id).filter(|g| g.members.contains(&me)).cloned() else {
                return;
            };
            let remaining: Vec<String> = g.members.iter().filter(|m| **m != me).cloned().collect();
            if remaining.is_empty() {
                st.group_dms.remove(&group_id);
                st.db.write(crate::db::WriteOp::DeleteGroupDm { id: group_id.clone() });
                st.delete_channel_history(&group_id);
            } else {
                if let Some(gm) = st.group_dms.get_mut(&group_id) {
                    gm.members = remaining.clone();
                    if gm.owner == me {
                        gm.owner = remaining[0].clone();
                    }
                }
                st.save_group(&group_id);
                let me_name = display_of(&st, &me);
                group_system_message(&mut st, &group_id, format!("**{me_name}** saiu do grupo."));
            }
            st.enforce_voice_access();
            sync_all(&st, &g.members);
        }

        ClientMessage::GetUserProfile { username, server_id } => {
            let target = username.trim().to_lowercase();
            let Some(user) = st.resolve_friend_info(&target) else {
                st.feedback(user_id, false, "user_profile", "Usuário não encontrado.");
                return;
            };
            let fs = &st.friends_store;
            let relationship = if target == me {
                "self"
            } else if fs.has_blocked(&me, &target) {
                "blocked"
            } else if fs.are_friends(&me, &target) {
                "friend"
            } else if fs.incoming_requests.get(&me).is_some_and(|l| l.contains(&target)) {
                "incoming"
            } else if fs.outgoing_requests.get(&me).is_some_and(|l| l.contains(&target)) {
                "outgoing"
            } else {
                "none"
            };
            let (mutual_servers, mutual_friends) = if target == me {
                (Vec::new(), Vec::new())
            } else {
                let servers = st
                    .servers
                    .iter()
                    .filter(|s| s.id != "sancord" && s.is_member(&me) && s.is_member(&target))
                    .map(|s| MutualServer {
                        id: s.id.clone(),
                        name: s.name.clone(),
                        icon_url: s.icon_url.clone(),
                        icon_color: s.icon_color.clone(),
                    })
                    .collect();
                let friends = fs
                    .friends
                    .get(&me)
                    .map(|l| {
                        l.iter()
                            .filter(|f| fs.are_friends(f, &target))
                            .filter_map(|f| st.resolve_friend_info(f))
                            .collect()
                    })
                    .unwrap_or_default();
                (servers, friends)
            };
            // Só revela a data de entrada num servidor do qual quem pergunta também é membro.
            let joined_server_at = server_id.as_deref().and_then(|sid| {
                st.find_server(sid)
                    .filter(|s| s.is_member(&me) && s.is_member(&target))
                    .and_then(|s| s.member_joined_at.get(&target).copied())
            });
            st.send_to(
                user_id,
                ServerMessage::UserProfile {
                    user,
                    relationship: relationship.to_string(),
                    mutual_servers,
                    mutual_friends,
                    joined_server_at,
                    server_id,
                },
            );
        }

        ClientMessage::ReportUser { username, reason, message_id } => {
            let target = username.trim().to_lowercase();
            let reason: String = reason.trim().chars().take(REPORT_REASON_MAX).collect();
            if target.is_empty() || target == me || !st.target_exists(&target) {
                st.feedback(user_id, false, "report_user", "Usuário não encontrado.");
                return;
            }
            if reason.is_empty() {
                st.feedback(user_id, false, "report_user", "Descreva o motivo da denúncia.");
                return;
            }
            let message_id = message_id.map(|m| m.chars().take(64).collect::<String>()).filter(|m| !m.is_empty());
            st.db.write(crate::db::WriteOp::InsertReport {
                id: Uuid::new_v4().to_string(),
                reporter: me.clone(),
                target,
                message_id,
                reason,
                created_at: crate::auth::now_ms(),
            });
            st.feedback(user_id, true, "report_user", "Denúncia enviada. Obrigado por ajudar a manter o Sancord seguro.");
        }

        _ => {}
    }
}

/// Remove status personalizados vencidos e avisa todo mundo.
pub async fn expire_statuses(state: &SharedState) {
    let mut st = state.write().await;
    let changed = st.clear_expired_statuses(crate::auth::now_ms());
    if changed.is_empty() {
        return;
    }
    for lower in &changed {
        let uids: Vec<String> = st
            .users
            .iter()
            .filter(|(_, u)| u.username.to_lowercase() == *lower)
            .map(|(id, _)| id.clone())
            .collect();
        for uid in uids {
            if let Some(user) = st.users.get(&uid).cloned() {
                st.send_to(&uid, ServerMessage::SelfUpdated { user });
            }
        }
    }
    st.broadcast(ServerMessage::VoiceStateSync {
        voice_members: st.voice_members_map(),
        users: st.users_list(),
    });
    st.broadcast_friends_sync_all();
}
