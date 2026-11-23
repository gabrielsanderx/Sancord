//! Fase 6 — voz. Ponto único para entrar/sair de canais de voz, registro das
//! chamadas privadas (iniciada, perdida, encerrada), recusa de chamada,
//! moderação de voz do servidor e limite de pessoas por canal.
//!
//! A mídia trafega P2P (WebRTC mesh); o servidor decide quem pode estar em
//! cada canal e quem pode sinalizar com quem (ver `access.rs`). Silenciar pelo
//! servidor não tem como cortar um fluxo P2P na origem: o estado é distribuído
//! a todos e cada cliente receptor deixa de reproduzir o áudio de quem está
//! silenciado. Um cliente adulterado só conseguiria "falar" para si mesmo.
use crate::models::{
    CallSnapshot, CallState, ChatMessage, GuildServer, MessageMentions, ServerMessage, UserInfo,
    VoiceModeration,
};
use crate::state::{ServerState, SharedState};
use chrono::Local;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use uuid::Uuid;

/// Limite máximo configurável de pessoas num canal de voz.
pub const MAX_USER_LIMIT: u32 = 99;

/// Duração padrão do toque (ringing) em chamadas privadas antes de transitar para WAITING_ACTIVE.
pub const DEFAULT_CALL_RING_DURATION_MS: i64 = 30_000;
/// Janela de disponibilidade (grace period) quando a sessão privada fica vazia sem atendimento.
pub const DEFAULT_CALL_IDLE_GRACE_MS: i64 = 5 * 60 * 1000;
/// Cooldown mínimo entre re-toques ("Chamar novamente") no mesmo canal pelo mesmo usuário.
pub const DEFAULT_CALL_RING_COOLDOWN_MS: i64 = 5_000;
/// Janela deslizante anti-spam para criação/disparo repetido de toques no mesmo canal.
pub const DEFAULT_CALL_SPAM_WINDOW_MS: i64 = 60_000;
/// Máximo de disparos de toque por usuário/canal na janela anti-spam.
pub const DEFAULT_CALL_SPAM_MAX: usize = 6;

#[derive(Debug, Clone, Copy)]
pub struct CallTimingConfig {
    pub ring_duration_ms: i64,
    pub idle_grace_ms: i64,
    pub ring_cooldown_ms: i64,
    pub spam_window_ms: i64,
    pub spam_max_per_window: usize,
}

impl Default for CallTimingConfig {
    fn default() -> Self {
        Self {
            ring_duration_ms: DEFAULT_CALL_RING_DURATION_MS,
            idle_grace_ms: DEFAULT_CALL_IDLE_GRACE_MS,
            ring_cooldown_ms: DEFAULT_CALL_RING_COOLDOWN_MS,
            spam_window_ms: DEFAULT_CALL_SPAM_WINDOW_MS,
            spam_max_per_window: DEFAULT_CALL_SPAM_MAX,
        }
    }
}

#[derive(Debug, Clone)]
pub enum CallTimerAction {
    RingTimeout {
        channel_id: String,
        call_id: String,
        generation: u64,
        delay_ms: i64,
    },
    IdleExpiry {
        channel_id: String,
        call_id: String,
        generation: u64,
        delay_ms: i64,
    },
}

#[derive(Debug, Clone)]
pub struct ActiveCall {
    pub call_id: String,
    pub dm_id: String,
    pub voice_channel_id: String,
    pub state: CallState,
    pub started_at: i64,
    /// username_lower de quem iniciou
    pub starter: String,
    pub starter_username: String,
    pub starter_color: String,
    pub starter_avatar: Option<String>,
    /// Alguém além de quem ligou entrou?
    pub answered: bool,
    pub connected_at: Option<i64>,
    pub ring_started_at: Option<i64>,
    pub ring_expires_at: Option<i64>,
    pub session_expires_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub ringing_targets: HashSet<String>,
    pub declined_by: HashSet<String>,
    pub ring_generation: u64,
    pub idle_generation: u64,
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
        author_name: "Sanvo".into(),
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

/// Intervalo mínimo (ms) no servidor para toggles repetidos de stream/câmera por ator.
const VOICE_CUE_TOGGLE_COOLDOWN_MS: i64 = 850;

fn cue_rate_category(event_type: &str) -> Option<&'static str> {
    match event_type {
        "stream_start" | "stream_stop" => Some("stream"),
        "camera_on" | "camera_off" => Some("camera"),
        _ => None,
    }
}

/// Publica um evento sonoro compartilhado EXCLUSIVAMENTE para participantes atualmente
/// conectados na mesma `channel_id` (canal de voz, DM Call ou Group DM Call).
pub fn emit_voice_cue(
    st: &mut ServerState,
    channel_id: &str,
    actor_user_id: &str,
    event_type: &str,
    include_actor: bool,
) -> bool {
    let now = crate::auth::now_ms();
    if let Some(cat) = cue_rate_category(event_type) {
        let key = (actor_user_id.to_string(), cat.to_string());
        if let Some(&last) = st.voice_cue_rates.get(&key) {
            if now - last < VOICE_CUE_TOGGLE_COOLDOWN_MS {
                return false;
            }
        }
        st.voice_cue_rates.insert(key, now);
        if st.voice_cue_rates.len() > 2048 {
            st.voice_cue_rates.retain(|_, &mut ts| now - ts < 60_000);
        }
    }
    let msg = ServerMessage::VoiceCueEvent {
        event_id: Uuid::new_v4().to_string(),
        event_type: event_type.to_string(),
        voice_session_id: channel_id.to_string(),
        actor_user_id: actor_user_id.to_string(),
        timestamp: now,
    };
    let recipients: Vec<String> = st
        .users
        .iter()
        .filter(|(uid, u)| {
            u.voice_channel_id.as_deref() == Some(channel_id)
                && (include_actor || uid.as_str() != actor_user_id)
        })
        .map(|(uid, _)| uid.clone())
        .collect();
    for uid in recipients {
        st.send_to(&uid, msg.clone());
    }
    true
}

fn active_participant_usernames(st: &ServerState, channel_id: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for u in st.users.values() {
        if u.voice_channel_id.as_deref() == Some(channel_id) {
            let lower = u.username.to_lowercase();
            if seen.insert(lower) {
                out.push(u.username.clone());
            }
        }
    }
    out.sort_by_key(|n| n.to_lowercase());
    out
}

fn eligible_ring_targets(
    st: &ServerState,
    channel_id: &str,
    caller_lower: &str,
    specific_target: Option<&str>,
) -> Vec<String> {
    let connected_lowers: HashSet<String> = st
        .users
        .values()
        .filter(|u| u.voice_channel_id.as_deref() == Some(channel_id))
        .map(|u| u.username.to_lowercase())
        .collect();
    let filter_lower = specific_target.map(|s| s.trim().to_lowercase());
    st.private_participants(channel_id)
        .into_iter()
        .filter(|p| {
            p != caller_lower
                && !connected_lowers.contains(p)
                && !st.friends_store.blocked_either(p, caller_lower)
                && filter_lower.as_deref().map_or(true, |t| t == p.as_str())
        })
        .collect()
}

fn username_of(st: &ServerState, lower: &str) -> String {
    st.resolve_friend_info(lower)
        .map(|f| f.username)
        .unwrap_or_else(|| lower.to_string())
}

pub fn call_snapshot(st: &ServerState, call: &ActiveCall, end_reason: Option<&str>) -> CallSnapshot {
    let mut ringing_targets: Vec<String> = call
        .ringing_targets
        .iter()
        .map(|l| username_of(st, l))
        .collect();
    ringing_targets.sort_by_key(|n| n.to_lowercase());
    let mut declined_by: Vec<String> = call
        .declined_by
        .iter()
        .map(|l| username_of(st, l))
        .collect();
    declined_by.sort_by_key(|n| n.to_lowercase());
    CallSnapshot {
        call_id: call.call_id.clone(),
        dm_id: call.dm_id.clone(),
        voice_channel_id: call.voice_channel_id.clone(),
        state: call.state,
        caller_username: call.starter_username.clone(),
        caller_display_name: display_of(st, &call.starter),
        caller_color: call.starter_color.clone(),
        caller_avatar: call.starter_avatar.clone(),
        active_participants: active_participant_usernames(st, &call.voice_channel_id),
        ringing_targets,
        declined_by,
        created_at: call.started_at,
        ring_started_at: call.ring_started_at,
        ring_expires_at: call.ring_expires_at,
        connected_at: call.connected_at,
        session_expires_at: call.session_expires_at,
        ended_at: call.ended_at,
        end_reason: end_reason.map(|s| s.to_string()),
        server_now: crate::auth::now_ms(),
    }
}

fn send_to_private_participants(
    st: &ServerState,
    channel_id: &str,
    caller_lower: Option<&str>,
    msg: ServerMessage,
) {
    let participants: HashSet<String> = st.private_participants(channel_id).into_iter().collect();
    for (uid, u) in &st.users {
        let lower = u.username.to_lowercase();
        if !participants.contains(&lower) {
            continue;
        }
        if let Some(caller) = caller_lower {
            if lower != caller && st.friends_store.blocked_either(&lower, caller) {
                continue;
            }
        }
        st.send_to(uid, msg.clone());
    }
}

fn broadcast_call_state(st: &ServerState, call: &ActiveCall, end_reason: Option<&str>) {
    let snap = call_snapshot(st, call, end_reason);
    send_to_private_participants(
        st,
        &call.voice_channel_id,
        Some(&call.starter),
        ServerMessage::CallStateUpdated { call: snap },
    );
}

fn send_incoming_rings(st: &ServerState, call: &ActiveCall) {
    if call.ringing_targets.is_empty() {
        return;
    }
    let ring = ServerMessage::DmCallIncoming {
        dm_id: call.dm_id.clone(),
        voice_channel_id: call.voice_channel_id.clone(),
        from_username: call.starter_username.clone(),
        from_color: call.starter_color.clone(),
        from_avatar: call.starter_avatar.clone(),
        call_id: Some(call.call_id.clone()),
        ring_started_at: call.ring_started_at,
        ring_expires_at: call.ring_expires_at,
        server_now: Some(crate::auth::now_ms()),
    };
    for (uid, u) in &st.users {
        let lower = u.username.to_lowercase();
        if call.ringing_targets.contains(&lower)
            && u.voice_channel_id.as_deref() != Some(call.voice_channel_id.as_str())
            && !st.friends_store.blocked_either(&lower, &call.starter)
        {
            st.send_to(uid, ring.clone());
        }
    }
}

fn record_ring_rate(st: &mut ServerState, caller_lower: &str, channel_id: &str, now: i64) -> Result<(), &'static str> {
    let key = (caller_lower.to_string(), channel_id.to_string());
    let win = st.call_ring_windows.entry(key.clone()).or_default();
    let cutoff = now - st.call_timing.spam_window_ms;
    win.retain(|&ts| ts >= cutoff);
    if win.len() >= st.call_timing.spam_max_per_window {
        return Err("Muitas tentativas de chamada seguidas. Aguarde um instante.");
    }
    win.push(now);
    st.call_ring_rates.insert(key, now);
    if st.call_ring_windows.len() > 2048 {
        st.call_ring_windows.retain(|_, v| !v.is_empty());
    }
    Ok(())
}

/// Retorna todas as chamadas privadas ativas/disponíveis para `user_lower` (usado no Welcome/reconexão).
/// Também expira preguiçosamente timers já vencidos caso algum atraso de agendador tenha ocorrido.
pub fn active_calls_for_user(st: &mut ServerState, user_lower: &str) -> Vec<CallSnapshot> {
    let now = crate::auth::now_ms();
    let expired_rings: Vec<(String, String, u64)> = st
        .active_calls
        .values()
        .filter(|c| c.ring_expires_at.is_some_and(|exp| now >= exp))
        .map(|c| (c.voice_channel_id.clone(), c.call_id.clone(), c.ring_generation))
        .collect();
    for (ch, cid, gen) in expired_rings {
        handle_ring_timeout(st, &ch, &cid, gen);
    }
    let expired_idles: Vec<(String, String, u64)> = st
        .active_calls
        .values()
        .filter(|c| c.session_expires_at.is_some_and(|exp| now >= exp) && members_in(st, &c.voice_channel_id, None) == 0)
        .map(|c| (c.voice_channel_id.clone(), c.call_id.clone(), c.idle_generation))
        .collect();
    for (ch, cid, gen) in expired_idles {
        handle_idle_expiry(st, &ch, &cid, gen);
    }

    st.active_calls
        .values()
        .filter(|c| {
            st.is_private_participant(&c.voice_channel_id, user_lower)
                && (c.starter == user_lower || !st.friends_store.blocked_either(user_lower, &c.starter))
        })
        .map(|c| call_snapshot(st, c, None))
        .collect()
}

/// Checa anti-spam de disparo de chamada privada antes de criar uma nova sessão.
pub fn check_call_ring_spam(st: &ServerState, caller_lower: &str, channel_id: &str) -> Result<(), &'static str> {
    if st.active_calls.contains_key(channel_id) {
        return Ok(());
    }
    let now = crate::auth::now_ms();
    let key = (caller_lower.to_string(), channel_id.to_string());
    if let Some(win) = st.call_ring_windows.get(&key) {
        let cutoff = now - st.call_timing.spam_window_ms;
        let recent = win.iter().filter(|&&ts| ts >= cutoff).count();
        if recent >= st.call_timing.spam_max_per_window {
            return Err("Muitas tentativas de chamada seguidas. Aguarde um instante.");
        }
    }
    Ok(())
}

fn call_joined(st: &mut ServerState, channel_id: &str, lower: &str, info: &UserInfo, resume: bool) -> bool {
    let now = crate::auth::now_ms();
    if st.active_calls.contains_key(channel_id) {
        let mut first_answer = false;
        let mut answered_call_id = None;
        let mut should_broadcast_answer = false;
        {
            let call = st.active_calls.get_mut(channel_id).unwrap();
            call.ringing_targets.remove(lower);
            call.declined_by.remove(lower);
            // Há participante conectado: cancela qualquer contagem de expiração ociosa.
            call.session_expires_at = None;
            call.idle_generation = call.idle_generation.wrapping_add(1);

            if call.starter != lower {
                first_answer = !call.answered;
                call.answered = true;
                call.state = CallState::Connected;
                if call.connected_at.is_none() {
                    call.connected_at = Some(now);
                }
                if call.ringing_targets.is_empty() {
                    call.ring_expires_at = None;
                    call.ring_generation = call.ring_generation.wrapping_add(1);
                }
                answered_call_id = Some(call.call_id.clone());
                should_broadcast_answer = true;
            }
        }
        if should_broadcast_answer {
            if let Some(call_id) = answered_call_id {
                let caller_lower = st.active_calls.get(channel_id).map(|c| c.starter.clone());
                send_to_private_participants(
                    st,
                    channel_id,
                    caller_lower.as_deref(),
                    ServerMessage::CallAnswered {
                        call_id,
                        channel_id: channel_id.to_string(),
                        by_username: info.username.clone(),
                    },
                );
            }
        }
        if let Some(call) = st.active_calls.get(channel_id).cloned() {
            broadcast_call_state(st, &call, None);
        }
        return first_answer;
    }

    // Nova sessão de chamada privada: separa RINGING da CALL SESSION.
    let dm_id = conversation_of(channel_id).unwrap_or_default();
    let targets = if resume {
        Vec::new()
    } else {
        eligible_ring_targets(st, channel_id, lower, None)
    };
    let should_ring = !resume && !targets.is_empty();
    let ring_duration_ms = st.call_timing.ring_duration_ms.max(100);
    if should_ring {
        let _ = record_ring_rate(st, lower, channel_id, now);
    }
    let call_id = Uuid::new_v4().to_string();
    let call = ActiveCall {
        call_id: call_id.clone(),
        dm_id: dm_id.clone(),
        voice_channel_id: channel_id.to_string(),
        state: if should_ring { CallState::Ringing } else { CallState::WaitingActive },
        started_at: now,
        starter: lower.to_string(),
        starter_username: info.username.clone(),
        starter_color: info.avatar_color.clone(),
        starter_avatar: info.avatar_url.clone(),
        answered: false,
        connected_at: None,
        ring_started_at: if should_ring { Some(now) } else { None },
        ring_expires_at: if should_ring { Some(now + ring_duration_ms) } else { None },
        session_expires_at: None,
        ended_at: None,
        ringing_targets: targets.into_iter().collect(),
        declined_by: HashSet::new(),
        ring_generation: 1,
        idle_generation: 0,
    };
    st.active_calls.insert(channel_id.to_string(), call.clone());
    if !dm_id.is_empty() {
        let name = display_of(st, lower);
        private_system_message(st, &dm_id, format!("📞 **{name}** iniciou uma chamada."), Some(lower));
    }
    if should_ring {
        send_incoming_rings(st, &call);
        st.pending_call_timers.push(CallTimerAction::RingTimeout {
            channel_id: channel_id.to_string(),
            call_id,
            generation: call.ring_generation,
            delay_ms: ring_duration_ms,
        });
    }
    broadcast_call_state(st, &call, None);
    false
}

/// Encerra definitivamente a sessão de chamada privada, grava o evento de histórico e notifica participantes.
pub fn finalize_call_end(st: &mut ServerState, channel_id: &str, reason: &str) {
    let Some(mut call) = st.active_calls.remove(channel_id) else {
        return;
    };
    let now = crate::auth::now_ms();
    call.state = CallState::Ended;
    call.ended_at = Some(now);
    call.ringing_targets.clear();
    call.ring_expires_at = None;
    call.session_expires_at = None;

    if let Some(conv) = conversation_of(channel_id) {
        let starter = display_of(st, &call.starter);
        if call.answered {
            let talk_start = call.connected_at.unwrap_or(call.started_at);
            let dur = format_duration((now - talk_start).max(1000));
            private_system_message(st, &conv, format!("📞 Chamada encerrada • durou {dur}."), None);
        } else {
            private_system_message(st, &conv, format!("📞 Chamada perdida de **{starter}**."), Some(&call.starter));
        }
    }

    broadcast_call_state(st, &call, Some(reason));
    send_to_private_participants(
        st,
        channel_id,
        Some(&call.starter),
        ServerMessage::CallEnded {
            channel_id: channel_id.to_string(),
            call_id: Some(call.call_id),
            reason: Some(reason.to_string()),
        },
    );
}

/// Depois que alguém sai de um canal:
/// - Se ainda há participantes: mantém a sessão ativa e atualiza o snapshot.
/// - Se ficou vazia: para qualquer toque ativo imediatamente; encerra se já havia sido atendida ou se todos recusaram;
///   caso contrário, entra em `WAITING_ACTIVE` com `CALL_IDLE_GRACE_PERIOD` para permitir entrada tardia.
pub fn after_leave(st: &mut ServerState, channel_id: &str) {
    if !is_private_voice(channel_id) {
        return;
    }
    if members_in(st, channel_id, None) > 0 {
        if let Some(call) = st.active_calls.get(channel_id).cloned() {
            broadcast_call_state(st, &call, None);
        }
        return;
    }

    let Some(existing) = st.active_calls.get(channel_id).cloned() else {
        // Sem ActiveCall registrado, garante que nenhum cliente fique preso em toast antigo.
        send_to_private_participants(
            st,
            channel_id,
            None,
            ServerMessage::CallEnded {
                channel_id: channel_id.to_string(),
                call_id: None,
                reason: Some("ended".to_string()),
            },
        );
        return;
    };

    let was_ringing = !existing.ringing_targets.is_empty();
    let eligible: Vec<String> = st
        .private_participants(channel_id)
        .into_iter()
        .filter(|p| p != &existing.starter && !st.friends_store.blocked_either(p, &existing.starter))
        .collect();
    let all_declined = !eligible.is_empty() && eligible.iter().all(|p| existing.declined_by.contains(p));

    if existing.answered || all_declined || st.call_timing.idle_grace_ms <= 0 {
        let reason = if existing.answered {
            "answered_ended"
        } else if all_declined {
            "declined"
        } else {
            "missed"
        };
        finalize_call_end(st, channel_id, reason);
        return;
    }

    // Sessão sem atendimento e sem recusa unânime: para o toque imediatamente (não tocar sala vazia),
    // mas mantém a sessão disponível em WAITING_ACTIVE durante `CALL_IDLE_GRACE_PERIOD`.
    let now = crate::auth::now_ms();
    let grace_ms = st.call_timing.idle_grace_ms.max(100);
    let (updated_call, idle_gen) = {
        let call = st.active_calls.get_mut(channel_id).unwrap();
        call.ringing_targets.clear();
        call.ring_expires_at = None;
        call.ring_generation = call.ring_generation.wrapping_add(1);
        call.state = CallState::WaitingActive;
        call.session_expires_at = Some(now + grace_ms);
        call.idle_generation = call.idle_generation.wrapping_add(1);
        (call.clone(), call.idle_generation)
    };
    if was_ringing {
        send_to_private_participants(
            st,
            channel_id,
            Some(&updated_call.starter),
            ServerMessage::CallCanceled {
                call_id: updated_call.call_id.clone(),
                channel_id: channel_id.to_string(),
                by_username: updated_call.starter_username.clone(),
            },
        );
    }
    broadcast_call_state(st, &updated_call, None);
    st.pending_call_timers.push(CallTimerAction::IdleExpiry {
        channel_id: channel_id.to_string(),
        call_id: updated_call.call_id,
        generation: idle_gen,
        delay_ms: grace_ms,
    });
}

/// Timeout autoritativo de ringing (ex.: após 30s): para o toque nos destinatários sem encerrar a sessão ativa!
pub fn handle_ring_timeout(st: &mut ServerState, channel_id: &str, call_id: &str, generation: u64) {
    let matches = st.active_calls.get(channel_id).is_some_and(|c| {
        c.call_id == call_id && c.ring_generation == generation && !c.ringing_targets.is_empty()
    });
    if !matches {
        return;
    }
    let now = crate::auth::now_ms();
    let has_participants = members_in(st, channel_id, None) > 0;
    let grace_ms = st.call_timing.idle_grace_ms;
    let mut schedule_idle = None;

    let updated = {
        let call = st.active_calls.get_mut(channel_id).unwrap();
        call.ringing_targets.clear();
        call.ring_expires_at = None;
        call.ring_generation = call.ring_generation.wrapping_add(1);
        if call.state == CallState::Ringing {
            call.state = CallState::WaitingActive;
        }
        if !has_participants && call.session_expires_at.is_none() && grace_ms > 0 {
            call.session_expires_at = Some(now + grace_ms);
            call.idle_generation = call.idle_generation.wrapping_add(1);
            schedule_idle = Some((call.call_id.clone(), call.idle_generation, grace_ms));
        }
        call.clone()
    };

    send_to_private_participants(
        st,
        channel_id,
        Some(&updated.starter),
        ServerMessage::CallRingTimeout {
            call_id: updated.call_id.clone(),
            channel_id: channel_id.to_string(),
        },
    );
    broadcast_call_state(st, &updated, None);

    if let Some((cid, gen, delay_ms)) = schedule_idle {
        st.pending_call_timers.push(CallTimerAction::IdleExpiry {
            channel_id: channel_id.to_string(),
            call_id: cid,
            generation: gen,
            delay_ms,
        });
    }
}

/// Expiração autoritativa de sessão ociosa após `CALL_IDLE_GRACE_PERIOD` (nunca expira se houver participante conectado).
pub fn handle_idle_expiry(st: &mut ServerState, channel_id: &str, call_id: &str, generation: u64) {
    let should_expire = st.active_calls.get(channel_id).is_some_and(|c| {
        c.call_id == call_id
            && c.idle_generation == generation
            && members_in(st, channel_id, None) == 0
    });
    if !should_expire {
        return;
    }
    finalize_call_end(st, channel_id, "expired");
}

/// Dispara timers pendentes fora do write lock de `ServerState`.
pub fn spawn_call_timers(state: SharedState, timers: Vec<CallTimerAction>) {
    for action in timers {
        let st_arc = state.clone();
        tokio::spawn(async move {
            match action {
                CallTimerAction::RingTimeout {
                    channel_id,
                    call_id,
                    generation,
                    delay_ms,
                } => {
                    tokio::time::sleep(Duration::from_millis(delay_ms.max(1) as u64)).await;
                    let follow_up = {
                        let mut st = st_arc.write().await;
                        handle_ring_timeout(&mut st, &channel_id, &call_id, generation);
                        std::mem::take(&mut st.pending_call_timers)
                    };
                    if !follow_up.is_empty() {
                        spawn_call_timers(st_arc, follow_up);
                    }
                }
                CallTimerAction::IdleExpiry {
                    channel_id,
                    call_id,
                    generation,
                    delay_ms,
                } => {
                    tokio::time::sleep(Duration::from_millis(delay_ms.max(1) as u64)).await;
                    let mut st = st_arc.write().await;
                    handle_idle_expiry(&mut st, &channel_id, &call_id, generation);
                }
            }
        });
    }
}

/// Coloca a conexão no canal (a autorização já foi feita). Devolve o usuário atualizado.
pub fn place_in_voice(st: &mut ServerState, uid: &str, channel_id: &str) -> Option<UserInfo> {
    place_in_voice_with_options(st, uid, channel_id, false)
}

/// Igual a `place_in_voice`, permitindo suprimir o cue sonoro de entrada em retomada de reconexão.
pub fn place_in_voice_with_options(
    st: &mut ServerState,
    uid: &str,
    channel_id: &str,
    silent_resume: bool,
) -> Option<UserInfo> {
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
        emit_voice_cue(st, prev, uid, "voice_leave", false);
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
    let just_answered = if is_private_voice(channel_id) {
        call_joined(st, channel_id, &lower, &info, silent_resume)
    } else {
        false
    };
    if !silent_resume {
        if just_answered {
            emit_voice_cue(st, channel_id, uid, "call_connected", true);
        } else {
            emit_voice_cue(st, channel_id, uid, "voice_join", false);
        }
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
    emit_voice_cue(st, &prev, uid, "voice_leave", false);
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
        .any(|u| u.username.to_lowercase() == peer && u.voice_channel_id.as_deref() == Some(channel_id))
        || st.active_calls.contains_key(channel_id);
    if peer_in_call && !st.friends_store.blocked_either(lower, &peer) {
        return Ok(());
    }
    let dm_id = ServerState::make_dm_id(lower, &peer);
    match st.dm_delivery(lower, &peer, &dm_id) {
        Ok(false) => Ok(()),
        Ok(true) => Err("Você só pode ligar depois que esta pessoa aceitar a conversa."),
        Err(msg) => Err(msg),
    }
}

/// Recusar uma chamada privada: para o toque em todos os dispositivos do destinatário,
/// notifica participantes conectados e mantém a sessão aberta (`WAITING_ACTIVE`) caso quem ligou queira continuar.
pub fn decline_call(st: &mut ServerState, uid: &str, channel_id: &str) {
    let Some(me) = st.users.get(uid).cloned() else {
        return;
    };
    let lower = me.username.to_lowercase();
    if !is_private_voice(channel_id) || !st.is_private_participant(channel_id, &lower) {
        return;
    }
    let mut call_id_opt = None;
    let mut updated_call = None;
    if let Some(call) = st.active_calls.get_mut(channel_id) {
        call.ringing_targets.remove(&lower);
        call.declined_by.insert(lower.clone());
        if call.ringing_targets.is_empty() {
            call.ring_expires_at = None;
            call.ring_generation = call.ring_generation.wrapping_add(1);
            if call.state == CallState::Ringing {
                call.state = CallState::WaitingActive;
            }
        }
        call_id_opt = Some(call.call_id.clone());
        updated_call = Some(call.clone());
    }
    let msg = ServerMessage::CallDeclined {
        channel_id: channel_id.to_string(),
        by_username: me.username.clone(),
        call_id: call_id_opt,
    };
    for (id, u) in &st.users {
        // Envia para quem está na chamada E para outros dispositivos da própria conta (multi-device stop ring).
        if u.voice_channel_id.as_deref() == Some(channel_id) || u.username.to_lowercase() == lower {
            st.send_to(id, msg.clone());
        }
    }
    if let Some(call) = updated_call {
        broadcast_call_state(st, &call, None);
    }
}

/// Cancela o toque (ringing) ativo sem desconectar automaticamente quem está na sala.
pub fn cancel_call_ringing(st: &mut ServerState, uid: &str, channel_id: &str) -> Result<(), &'static str> {
    let me = st.users.get(uid).cloned().ok_or("Sessão inválida.")?;
    let lower = me.username.to_lowercase();
    if !is_private_voice(channel_id) || !st.is_private_participant(channel_id, &lower) {
        return Err("Chamada não encontrada.");
    }
    let in_call = me.voice_channel_id.as_deref() == Some(channel_id);
    let Some(call) = st.active_calls.get_mut(channel_id) else {
        return Err("Nenhuma chamada ativa neste canal.");
    };
    if !in_call && call.starter != lower {
        return Err("Apenas participantes da chamada podem cancelar o toque.");
    }
    if call.ringing_targets.is_empty() {
        return Ok(());
    }
    call.ringing_targets.clear();
    call.ring_expires_at = None;
    call.ring_generation = call.ring_generation.wrapping_add(1);
    if call.state == CallState::Ringing {
        call.state = CallState::WaitingActive;
    }
    let updated = call.clone();
    send_to_private_participants(
        st,
        channel_id,
        Some(&updated.starter),
        ServerMessage::CallCanceled {
            call_id: updated.call_id.clone(),
            channel_id: channel_id.to_string(),
            by_username: me.username,
        },
    );
    broadcast_call_state(st, &updated, None);
    Ok(())
}

/// Re-chamar ("Chamar novamente") em uma sessão privada já aberta, com cooldown anti-spam.
pub fn re_ring_call(
    st: &mut ServerState,
    uid: &str,
    channel_id: &str,
    target_username: Option<&str>,
) -> Result<(), &'static str> {
    let me = st.users.get(uid).cloned().ok_or("Sessão inválida.")?;
    let lower = me.username.to_lowercase();
    if !is_private_voice(channel_id) || !st.is_private_participant(channel_id, &lower) {
        return Err("Chamada não encontrada.");
    }
    if me.voice_channel_id.as_deref() != Some(channel_id) {
        return Err("Entre na chamada antes de chamar novamente.");
    }
    if !st.active_calls.contains_key(channel_id) {
        return Err("Nenhuma chamada ativa neste canal.");
    }
    let now = crate::auth::now_ms();
    let key = (lower.clone(), channel_id.to_string());
    if let Some(&last) = st.call_ring_rates.get(&key) {
        if now - last < st.call_timing.ring_cooldown_ms {
            return Err("Aguarde alguns segundos antes de chamar novamente.");
        }
    }
    let targets = eligible_ring_targets(st, channel_id, &lower, target_username);
    if targets.is_empty() {
        return Err("Ninguém disponível para chamar agora.");
    }
    record_ring_rate(st, &lower, channel_id, now)?;

    let ring_duration_ms = st.call_timing.ring_duration_ms.max(100);
    let updated = {
        let call = st.active_calls.get_mut(channel_id).unwrap();
        for t in &targets {
            call.declined_by.remove(t);
            call.ringing_targets.insert(t.clone());
        }
        if !call.answered {
            call.state = CallState::Ringing;
        }
        call.ring_started_at = Some(now);
        call.ring_expires_at = Some(now + ring_duration_ms);
        call.ring_generation = call.ring_generation.wrapping_add(1);
        call.clone()
    };
    send_incoming_rings(st, &updated);
    broadcast_call_state(st, &updated, None);
    st.pending_call_timers.push(CallTimerAction::RingTimeout {
        channel_id: channel_id.to_string(),
        call_id: updated.call_id,
        generation: updated.ring_generation,
        delay_ms: ring_duration_ms,
    });
    Ok(())
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
