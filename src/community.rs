//! Fase 8 — enquetes (dentro da mensagem) e eventos agendados de servidor.
//! As regras de acesso reutilizam as de leitura de canal e de gerenciamento.
use crate::db::WriteOp;
use crate::models::{Poll, PollInput, PollOption, ServerEvent, ServerMessage};
use crate::state::{ServerState, SharedState};
use crate::ws::{fetch_message_for_mutation, mutate_message};
use std::collections::HashMap;
use uuid::Uuid;

const QUESTION_MAX: usize = 300;
const OPTION_MAX: usize = 80;
const POLL_MAX_HOURS: u32 = 24 * 7;
pub const MAX_EVENTS_PER_SERVER: usize = 100;

fn clean(text: &str, max: usize) -> String {
    text.trim().chars().filter(|c| !c.is_control()).take(max).collect()
}

/// Valida o pedido e monta a enquete (ids curtos e estáveis por opção).
pub fn build_poll(input: PollInput, now: i64) -> Result<Poll, &'static str> {
    let question = clean(&input.question, QUESTION_MAX);
    if question.is_empty() {
        return Err("A enquete precisa de uma pergunta.");
    }
    let mut options: Vec<PollOption> = Vec::new();
    for raw in input.options {
        let text = clean(&raw, OPTION_MAX);
        if text.is_empty() || options.iter().any(|o| o.text.eq_ignore_ascii_case(&text)) {
            continue;
        }
        options.push(PollOption { id: format!("o{}", options.len() + 1), text });
    }
    if options.len() < 2 {
        return Err("A enquete precisa de pelo menos 2 opções diferentes.");
    }
    if options.len() > Poll::MAX_OPTIONS {
        return Err("A enquete pode ter no máximo 10 opções.");
    }
    let hours = input.duration_hours.min(POLL_MAX_HOURS);
    Ok(Poll {
        question,
        options,
        votes: HashMap::new(),
        multiple: input.multiple,
        expires_at: (hours > 0).then(|| now + i64::from(hours) * 3_600_000),
        closed: false,
    })
}

/// Texto da enquete para o AutoMod e para a busca.
pub fn poll_text(p: &Poll) -> String {
    let opts: Vec<&str> = p.options.iter().map(|o| o.text.as_str()).collect();
    format!("{} {}", p.question, opts.join(" "))
}

fn distribute(st: &ServerState, channel_id: &str, message: crate::models::ChatMessage) {
    if ServerState::is_private_text(channel_id) {
        st.send_to_dm_participants(channel_id, ServerMessage::MessageUpdated { message });
    } else if let Some(srv) = st.find_server_by_text_channel(channel_id) {
        let sid = srv.id.clone();
        st.broadcast_to_server(&sid, ServerMessage::MessageUpdated { message });
    }
}

pub async fn vote(state: &SharedState, user_id: &str, channel_id: String, message_id: String, option_ids: Vec<String>) {
    let fallback = fetch_message_for_mutation(state, &channel_id, &message_id).await;
    let mut st = state.write().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    if !st.can_read_text_channel(&lower, &channel_id) {
        return;
    }
    if !st.rates.entry(user_id.to_string()).or_default().allow_reaction(crate::auth::now_ms()) {
        return;
    }
    let now = crate::auth::now_ms();
    let mut error: Option<&'static str> = None;
    let updated = mutate_message(&mut st, &channel_id, &message_id, fallback, |msg| {
        let Some(poll) = msg.poll.as_mut() else {
            error = Some("Esta mensagem não tem enquete.");
            return false;
        };
        if !poll.is_open(now) {
            error = Some("Esta enquete já foi encerrada.");
            return false;
        }
        let mut chosen: Vec<String> = Vec::new();
        for id in option_ids {
            if poll.options.iter().any(|o| o.id == id) && !chosen.contains(&id) {
                chosen.push(id);
            }
        }
        if chosen.len() > 1 && !poll.multiple {
            error = Some("Esta enquete aceita só uma opção.");
            return false;
        }
        for voters in poll.votes.values_mut() {
            voters.retain(|v| v != &lower);
        }
        for id in chosen {
            poll.votes.entry(id).or_default().push(lower.clone());
        }
        poll.votes.retain(|_, v| !v.is_empty());
        true
    });
    match updated {
        Some(message) => distribute(&st, &channel_id, message),
        None => st.feedback(user_id, false, "vote_poll", error.unwrap_or("Não foi possível votar.")),
    }
}

pub async fn close(state: &SharedState, user_id: &str, channel_id: String, message_id: String) {
    let fallback = fetch_message_for_mutation(state, &channel_id, &message_id).await;
    let mut st = state.write().await;
    let Some(user) = st.users.get(user_id).cloned() else { return };
    let lower = user.username.to_lowercase();
    if !st.can_read_text_channel(&lower, &channel_id) {
        return;
    }
    let moderator = st
        .find_server_by_text_channel(&channel_id)
        .is_some_and(|s| s.channel_permissions(&lower, &channel_id).manage_messages);
    let updated = mutate_message(&mut st, &channel_id, &message_id, fallback, |msg| {
        let own = msg.author_id == user_id || msg.author_name.eq_ignore_ascii_case(&user.username);
        match msg.poll.as_mut() {
            Some(p) if (own || moderator) && !p.closed => {
                p.closed = true;
                true
            }
            _ => false,
        }
    });
    match updated {
        Some(message) => distribute(&st, &channel_id, message),
        None => st.feedback(user_id, false, "close_poll", "Só o autor ou a moderação podem encerrar esta enquete."),
    }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

fn can_manage_events(st: &ServerState, server_id: &str, lower: &str) -> bool {
    st.find_server(server_id).is_some_and(|s| {
        let p = s.effective_permissions(lower);
        s.is_member(lower) && (p.manage_server || p.manage_channels)
    })
}

fn is_member(st: &ServerState, server_id: &str, lower: &str) -> bool {
    st.find_server(server_id).is_some_and(|s| s.is_member(lower))
}

/// Eventos visíveis para quem pergunta: canais privados não vazam pelo evento.
fn events_for(st: &ServerState, server_id: &str, lower: &str) -> Vec<ServerEvent> {
    let now = crate::auth::now_ms();
    st.events
        .get(server_id)
        .map(|list| {
            list.iter()
                // Eventos encerrados há mais de um dia somem da lista.
                .filter(|e| e.ends_at.unwrap_or(e.starts_at + 3_600_000) + 86_400_000 > now)
                .map(|e| {
                    let mut e = e.clone();
                    if e.channel_id.as_ref().is_some_and(|c| !st.can_view_channel(lower, c)) {
                        e.channel_id = None;
                    }
                    e
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Envia a lista atualizada para todos os membros conectados do servidor.
pub fn broadcast_events(st: &ServerState, server_id: &str) {
    for (uid, u) in &st.users {
        let lower = u.username.to_lowercase();
        if is_member(st, server_id, &lower) {
            st.send_to(uid, ServerMessage::ServerEvents { server_id: server_id.to_string(), events: events_for(st, server_id, &lower) });
        }
    }
}

pub async fn list(state: &SharedState, user_id: &str, server_id: String) {
    let st = state.read().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    if !is_member(&st, &server_id, &lower) {
        return;
    }
    let events = events_for(&st, &server_id, &lower);
    st.send_to(user_id, ServerMessage::ServerEvents { server_id, events });
}

#[allow(clippy::too_many_arguments)]
pub async fn save(
    state: &SharedState,
    user_id: &str,
    server_id: String,
    event_id: Option<String>,
    title: String,
    description: Option<String>,
    channel_id: Option<String>,
    location: Option<String>,
    starts_at: i64,
    ends_at: Option<i64>,
) {
    let mut st = state.write().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    let result: Result<ServerEvent, &'static str> = (|| {
        let srv = st.find_server(&server_id).ok_or("Servidor não encontrado.")?;
        if !srv.is_member(&lower) {
            return Err("Você não é membro deste servidor.");
        }
        let title = clean(&title, 100);
        if title.chars().count() < 2 {
            return Err("Dê um título ao evento.");
        }
        let now = crate::auth::now_ms();
        let existing = event_id
            .as_ref()
            .and_then(|id| st.events.get(&server_id).and_then(|l| l.iter().find(|e| &e.id == id)).cloned());
        if event_id.is_some() && existing.is_none() {
            return Err("Evento não encontrado.");
        }
        let creator = existing.as_ref().map(|e| e.creator.clone()).unwrap_or_else(|| lower.clone());
        if !(can_manage_events(&st, &server_id, &lower) || (existing.is_some() && creator == lower)) {
            return Err("Você não tem permissão para gerenciar eventos neste servidor.");
        }
        if existing.is_none() && starts_at < now - 60_000 {
            return Err("O evento precisa começar no futuro.");
        }
        if starts_at > now + 365 * 86_400_000 {
            return Err("O evento pode ser marcado com até um ano de antecedência.");
        }
        if ends_at.is_some_and(|e| e <= starts_at) {
            return Err("O fim precisa ser depois do início.");
        }
        let channel_id = channel_id.filter(|c| !c.is_empty());
        if let Some(c) = &channel_id {
            if srv.find_channel(c).is_none() {
                return Err("Canal do evento inválido.");
            }
        }
        if existing.is_none() && st.events.get(&server_id).map_or(0, Vec::len) >= MAX_EVENTS_PER_SERVER {
            return Err("Este servidor atingiu o limite de eventos.");
        }
        Ok(ServerEvent {
            id: existing.as_ref().map(|e| e.id.clone()).unwrap_or_else(|| format!("evt-{}", Uuid::new_v4().simple())),
            server_id: server_id.clone(),
            title,
            description: description.map(|d| clean(&d, 1000)).filter(|d| !d.is_empty()),
            channel_id,
            location: location.map(|l| clean(&l, 100)).filter(|l| !l.is_empty()),
            starts_at,
            ends_at,
            creator,
            interested: existing.as_ref().map(|e| e.interested.clone()).unwrap_or_else(|| vec![lower.clone()]),
            created_at: existing.as_ref().map_or(now, |e| e.created_at),
        })
    })();
    match result {
        Ok(event) => {
            let created = event_id.is_none();
            let list = st.events.entry(server_id.clone()).or_default();
            list.retain(|e| e.id != event.id);
            list.push(event.clone());
            list.sort_by_key(|e| e.starts_at);
            st.db.write(WriteOp::UpsertEvent(Box::new(event.clone())));
            crate::moderation::audit(&st, &server_id, &lower, if created { "event_create" } else { "event_update" }, Some(&event.title), None);
            st.feedback(user_id, true, "save_event", if created { "Evento criado." } else { "Evento atualizado." });
            broadcast_events(&st, &server_id);
        }
        Err(msg) => st.feedback(user_id, false, "save_event", msg),
    }
}

pub async fn delete(state: &SharedState, user_id: &str, server_id: String, event_id: String) {
    let mut st = state.write().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    let Some(event) = st.events.get(&server_id).and_then(|l| l.iter().find(|e| e.id == event_id)).cloned() else {
        return;
    };
    if !(can_manage_events(&st, &server_id, &lower) || event.creator == lower) {
        st.feedback(user_id, false, "delete_event", "Você não pode excluir este evento.");
        return;
    }
    if let Some(list) = st.events.get_mut(&server_id) {
        list.retain(|e| e.id != event_id);
    }
    st.db.write(WriteOp::DeleteEvent { id: event_id });
    crate::moderation::audit(&st, &server_id, &lower, "event_delete", Some(&event.title), None);
    broadcast_events(&st, &server_id);
}

pub async fn set_interest(state: &SharedState, user_id: &str, server_id: String, event_id: String, interested: bool) {
    let mut st = state.write().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    if !is_member(&st, &server_id, &lower) {
        return;
    }
    let Some(event) = st.events.get_mut(&server_id).and_then(|l| l.iter_mut().find(|e| e.id == event_id)) else {
        return;
    };
    event.interested.retain(|u| u != &lower);
    if interested {
        event.interested.push(lower);
    }
    let snapshot = event.clone();
    st.db.write(WriteOp::UpsertEvent(Box::new(snapshot)));
    broadcast_events(&st, &server_id);
}
