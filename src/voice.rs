//! Fase 6 — voz. Ponto único para entrar/sair de canais de voz, registro das
//! chamadas privadas (iniciada, perdida, encerrada), recusa de chamada,
//! moderação de voz do servidor e limite de pessoas por canal.
//!
//! A mídia trafega P2P (WebRTC mesh); o servidor decide quem pode estar em
//! cada canal e quem pode sinalizar com quem (ver `access.rs`). Silenciar pelo
//! servidor não tem como cortar um fluxo P2P na origem: o estado é distribuído
//! a todos e cada cliente receptor deixa de reproduzir o áudio de quem está
//! silenciado. Um cliente adulterado só conseguiria "falar" para si mesmo.
use crate::models::{ChatMessage, GuildServer, MessageMentions, ServerMessage, UserInfo, VoiceModeration};
use crate::state::ServerState;
use chrono::Local;
use std::collections::HashMap;
use uuid::Uuid;

/// Limite máximo configurável de pessoas num canal de voz.
pub const MAX_USER_LIMIT: u32 = 99;

#[derive(Debug, Clone)]
pub struct ActiveCall {
    pub started_at: i64,
    /// username_lower de quem iniciou
    pub starter: String,
    /// Alguém além de quem ligou entrou?
    pub answered: bool,
}

pub fn is_private_voice(channel_id: &str) -> bool {
    channel_id.starts_with("dmvoice:") || channel_id.starts_with("gdmvoice:")
}

/// Conversa de texto associada a uma chamada privada.
pub fn conversation_of(channel_id: &str) -> Option<String> {
    if let Some(rest) = channel_id.strip_prefix("dmvoice:") {
        return Some(format!("dm:{rest}"));
    }
    channel_id.strip_prefix("gdmvoice:").map(|rest| format!("gdm:{rest}"))
}

fn server_of_voice<'a>(st: &'a ServerState, channel_id: &str) -> Option<&'a GuildServer> {
    st.servers.iter().find(|s| s.voice_channels.iter().any(|c| c.id == channel_id))
}

fn display_of(st: &ServerState, lower: &str) -> String {
    st.resolve_friend_info(lower)
        .map(|f| f.display_name.unwrap_or(f.username))
        .unwrap_or_else(|| lower.to_string())
}

fn members_in(st: &ServerState, channel_id: &str, except_uid: Option<&str>) -> usize {
    st.users
        .iter()
        .filter(|(id, u)| Some(id.as_str()) != except_uid && u.voice_channel_id.as_deref() == Some(channel_id))
        .count()
}

fn sync_voice(st: &ServerState) {
    st.broadcast(ServerMessage::VoiceStateSync {
        voice_members: st.voice_members_map(),
        users: st.users_list(),
    });
}

/// Mensagem de sistema numa conversa privada; `notify_except` soma não lida aos demais.
pub(crate) fn private_system_message(st: &mut ServerState, conversation: &str, content: String, notify_except: Option<&str>) {
    let msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        channel_id: conversation.to_string(),
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
        embeds: Vec::new(),
        forward: None,
    };
    st.insert_message(msg.clone());
    if let Some(author) = notify_except {
        st.bump_mentions(conversation, author, &MessageMentions::default());
    }
    st.send_to_dm_participants(conversation, ServerMessage::NewChatMessage { message: msg });
}

fn format_duration(ms: i64) -> String {
    let secs = (ms / 1000).max(1);
    if secs < 60 {
        format!("{secs} s")
    } else if secs < 3600 {
        format!("{} min", secs / 60)
    } else {
        format!("{} h {} min", secs / 3600, (secs % 3600) / 60)
    }
}

fn call_joined(st: &mut ServerState, channel_id: &str, lower: &str) {
    match st.active_calls.get_mut(channel_id) {
        Some(call) => {
            if call.starter != lower {
                call.answered = true;
            }
        }
        None => {
            st.active_calls.insert(
                channel_id.to_string(),
                ActiveCall { started_at: crate::auth::now_ms(), starter: lower.to_string(), answered: false },
            );
            if let Some(conv) = conversation_of(channel_id) {
                let name = display_of(st, lower);
                private_system_message(st, &conv, format!("📞 **{name}** iniciou uma chamada."), Some(lower));
            }
        }
    }
}

/// Depois que alguém sai de um canal: encerra a chamada privada se ficou vazia.
pub fn after_leave(st: &mut ServerState, channel_id: &str) {
    if !is_private_voice(channel_id) || members_in(st, channel_id, None) > 0 {
        return;
    }
    if let Some(call) = st.active_calls.remove(channel_id) {
        if let Some(conv) = conversation_of(channel_id) {
            let starter = display_of(st, &call.starter);
            if call.answered {
                let dur = format_duration(crate::auth::now_ms() - call.started_at);
                private_system_message(st, &conv, format!("📞 Chamada encerrada • durou {dur}."), None);
            } else {
                private_system_message(st, &conv, format!("📞 Chamada perdida de **{starter}**."), Some(&call.starter));
            }
        }
    }
    // Para de tocar em quem ainda não tinha atendido.
    for p in st.private_participants(channel_id) {
        for (uid, u) in &st.users {
            if u.username.to_lowercase() == p {
                st.send_to(uid, ServerMessage::CallEnded { channel_id: channel_id.to_string() });
            }
        }
    }
}

/// Coloca a conexão no canal (a autorização já foi feita). Devolve o usuário atualizado.
pub fn place_in_voice(st: &mut ServerState, uid: &str, channel_id: &str) -> Option<UserInfo> {
    let prev = st.users.get(uid)?.voice_channel_id.clone();
    if prev.as_deref() == Some(channel_id) {
        return None;
    }
    if let Some(prev) = &prev {
        st.broadcast_to_voice_channel_except(
            prev,
            uid,
            ServerMessage::PeerLeftVoice { channel_id: prev.clone(), peer_id: uid.to_string() },
        );
    }
    let lower = st.users.get(uid)?.username.to_lowercase();
    let vm = server_of_voice(st, channel_id)
        .and_then(|s| s.voice_moderation.get(&lower).copied())
        .unwrap_or_default();
    let info = {
        let user = st.users.get_mut(uid)?;
        user.voice_channel_id = Some(channel_id.to_string());
        user.screen_sharing = false;
        user.camera_on = false;
        user.camera_stream_id = None;
        user.screen_stream_id = None;
        user.stream_quality = None;
        user.server_muted = vm.muted;
        user.server_deafened = vm.deafened;
        user.clone()
    };
    let grants = st.voice_media_permissions(uid);
    st.voice_grants.insert(uid.to_string(), grants);
    if let Some(prev) = prev {
        after_leave(st, &prev);
    }
    sync_voice(st);
    st.broadcast_to_voice_channel_except(
        channel_id,
        uid,
        ServerMessage::PeerJoinedVoice { channel_id: channel_id.to_string(), peer: info.clone() },
    );
    if is_private_voice(channel_id) {
        call_joined(st, channel_id, &lower);
    }
    Some(info)
}

/// Tira a conexão da voz. Devolve o canal de onde saiu.
pub fn remove_from_voice(st: &mut ServerState, uid: &str) -> Option<String> {
    let prev = {
        let user = st.users.get_mut(uid)?;
        let prev = user.voice_channel_id.take()?;
        user.screen_sharing = false;
        user.camera_on = false;
        user.camera_stream_id = None;
        user.screen_stream_id = None;
        user.stream_quality = None;
        user.server_muted = false;
        user.server_deafened = false;
        prev
    };
    st.voice_grants.remove(uid);
    st.broadcast_to_voice_channel_except(
        &prev,
        uid,
        ServerMessage::PeerLeftVoice { channel_id: prev.clone(), peer_id: uid.to_string() },
    );
    sync_voice(st);
    after_leave(st, &prev);
    Some(prev)
}

/// Limite de pessoas do canal (quem pode mover membros entra mesmo cheio).
pub fn check_user_limit(st: &ServerState, uid: &str, lower: &str, channel_id: &str) -> Result<(), &'static str> {
    let Some(srv) = server_of_voice(st, channel_id) else {
        return Ok(());
    };
    let limit = srv.find_channel(channel_id).map(|c| c.user_limit).unwrap_or(0);
    if limit == 0 || members_in(st, channel_id, Some(uid)) < limit as usize {
        return Ok(());
    }
    if srv.effective_permissions(lower).move_members {
        return Ok(());
    }
    Err("Este canal de voz está cheio.")
}

/// Ligar numa DM 1:1 segue as mesmas regras de mandar mensagem: sem bloqueio,
/// respeitando a privacidade, e não vale para solicitação ainda não aceita.
/// Entrar numa chamada que a outra pessoa já iniciou é sempre permitido.
pub fn check_private_call(st: &ServerState, lower: &str, channel_id: &str) -> Result<(), &'static str> {
    let Some((a, b)) = ServerState::parse_dm_participants(channel_id) else {
        return Ok(());
    };
    let peer = if a == lower { b } else { a };
    let peer_in_call = st
        .users
        .values()
        .any(|u| u.username.to_lowercase() == peer && u.voice_channel_id.as_deref() == Some(channel_id));
    if peer_in_call {
        return Ok(());
    }
    let dm_id = ServerState::make_dm_id(lower, &peer);
    match st.dm_delivery(lower, &peer, &dm_id) {
        Ok(false) => Ok(()),
        Ok(true) => Err("Você só pode ligar depois que esta pessoa aceitar a conversa."),
        Err(msg) => Err(msg),
    }
}

pub fn decline_call(st: &ServerState, uid: &str, channel_id: &str) {
    let Some(me) = st.users.get(uid) else {
        return;
    };
    let lower = me.username.to_lowercase();
    if !is_private_voice(channel_id) || !st.is_private_participant(channel_id, &lower) {
        return;
    }
    let msg = ServerMessage::CallDeclined { channel_id: channel_id.to_string(), by_username: me.username.clone() };
    for (id, u) in &st.users {
        if u.voice_channel_id.as_deref() == Some(channel_id) {
            st.send_to(id, msg.clone());
        }
    }
}

/// Moderação de voz num servidor. Devolve a mensagem de sucesso para quem agiu.
pub fn moderate(
    st: &mut ServerState,
    actor_uid: &str,
    server_id: &str,
    target_username: &str,
    action: &str,
    dest: Option<String>,
) -> Result<String, &'static str> {
    let actor = st.users.get(actor_uid).ok_or("Sessão inválida.")?;
    let actor_lower = actor.username.to_lowercase();
    let actor_name = actor.username.clone();
    let target = target_username.trim().to_lowercase();
    let srv = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
    if !srv.is_member(&actor_lower) {
        return Err("Você não é membro deste servidor.");
    }
    if !srv.is_member(&target) {
        return Err("Este usuário não é membro do servidor.");
    }
    let perms = srv.effective_permissions(&actor_lower);
    let allowed = match action {
        "mute" | "unmute" => perms.mute_members,
        "deafen" | "undeafen" => perms.deafen_members,
        "disconnect" | "move" => perms.move_members,
        _ => return Err("Ação de voz desconhecida."),
    };
    if !allowed {
        return Err("Você não tem permissão para esta ação de voz.");
    }
    if actor_lower != target
        && !srv.is_owner(&actor_lower)
        && (srv.is_owner(&target) || srv.highest_position(&target) >= srv.highest_position(&actor_lower))
    {
        return Err("Você só pode moderar membros abaixo da sua hierarquia.");
    }
    let server_channels: Vec<String> = srv.voice_channels.iter().map(|c| c.id.clone()).collect();
    // Conexões do alvo que estão na voz deste servidor.
    let sessions: Vec<String> = st
        .users
        .iter()
        .filter(|(_, u)| {
            u.username.to_lowercase() == target
                && u.voice_channel_id.as_ref().is_some_and(|c| server_channels.contains(c))
        })
        .map(|(id, _)| id.clone())
        .collect();
    let target_name = display_of(st, &target);

    match action {
        "mute" | "unmute" | "deafen" | "undeafen" => {
            let srv = st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?;
            let mut vm = srv.voice_moderation.get(&target).copied().unwrap_or_default();
            match action {
                "mute" => vm.muted = true,
                "unmute" => vm.muted = false,
                "deafen" => vm.deafened = true,
                _ => vm.deafened = false,
            }
            if vm == VoiceModeration::default() {
                srv.voice_moderation.remove(&target);
            } else {
                srv.voice_moderation.insert(target.clone(), vm);
            }
            st.db.write(crate::db::WriteOp::SetVoiceModeration {
                server_id: server_id.to_string(),
                user_lower: target.clone(),
                muted: vm.muted,
                deafened: vm.deafened,
            });
            for uid in &sessions {
                if let Some(u) = st.users.get_mut(uid) {
                    u.server_muted = vm.muted;
                    u.server_deafened = vm.deafened;
                }
            }
            sync_voice(st);
            Ok(match action {
                "mute" => format!("{target_name} foi silenciado no servidor."),
                "unmute" => format!("{target_name} não está mais silenciado no servidor."),
                "deafen" => format!("{target_name} foi ensurdecido no servidor."),
                _ => format!("{target_name} não está mais ensurdecido no servidor."),
            })
        }
        "disconnect" => {
            if sessions.is_empty() {
                return Err("Este usuário não está em um canal de voz deste servidor.");
            }
            for uid in &sessions {
                st.send_to(uid, ServerMessage::VoiceMoved { channel_id: None, by: actor_name.clone() });
                remove_from_voice(st, uid);
            }
            Ok(format!("{target_name} foi desconectado da voz."))
        }
        _ => {
            let dest = dest.ok_or("Escolha o canal de destino.")?;
            if !server_channels.contains(&dest) {
                return Err("Canal de destino inválido.");
            }
            if sessions.is_empty() {
                return Err("Este usuário não está em um canal de voz deste servidor.");
            }
            let srv = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
            let mine = srv.channel_permissions(&actor_lower, &dest);
            if !mine.view_channel || !mine.connect_voice {
                return Err("Você não tem acesso ao canal de destino.");
            }
            if !st.can_join_voice(&target, &dest) {
                return Err("Este usuário não tem acesso ao canal de destino.");
            }
            for uid in &sessions {
                if st.users.get(uid).and_then(|u| u.voice_channel_id.as_deref()) == Some(dest.as_str()) {
                    continue;
                }
                // Avisa antes de anunciar a entrada: as ofertas WebRTC dos membros do
                // destino chegam depois, já com o cliente apontando para o canal novo.
                st.send_to(uid, ServerMessage::VoiceMoved { channel_id: Some(dest.clone()), by: actor_name.clone() });
                place_in_voice(st, uid, &dest);
            }
            Ok(format!("{target_name} foi movido de canal."))
        }
    }
}
