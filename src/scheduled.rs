use crate::auth::now_ms;
use crate::db::WriteOp;
use crate::models::{ChannelKind, ClientMessage, ServerMessage};
use crate::state::{ServerState, SharedState};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_SCHEDULED: usize = 20;
const SCHEDULE_WINDOW_MS: i64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledMessage {
    pub id: String,
    #[serde(skip)]
    pub account_id: String,
    pub channel_id: String,
    pub content: String,
    pub send_at: i64,
    pub error: Option<String>,
}

fn snapshot(st: &ServerState, account_id: &str) -> ServerMessage {
    let mut messages: Vec<_> = st
        .scheduled_messages
        .values()
        .filter(|job| job.account_id == account_id)
        .cloned()
        .collect();
    messages.sort_by(|a, b| (a.send_at, &a.id).cmp(&(b.send_at, &b.id)));
    ServerMessage::ScheduledMessages { messages }
}

pub fn notify_account(st: &ServerState, account_id: &str) {
    let Some(account) = st.account_by_id(account_id) else {
        return;
    };
    let update = snapshot(st, account_id);
    for (id, user) in &st.users {
        if user.username.eq_ignore_ascii_case(&account.username) {
            st.send_to(id, update.clone());
        }
    }
}

fn can_schedule(st: &ServerState, username: &str, channel_id: &str) -> bool {
    if ServerState::is_private_text(channel_id) {
        if !st.is_private_participant(channel_id, username) {
            return false;
        }
        return ServerState::parse_dm_participants(channel_id).is_none_or(|(a, b)| {
            st.dm_delivery(username, if a == username { &b } else { &a }, channel_id)
                .is_ok()
        });
    }
    let Some(server) = st.find_server_by_text_channel(channel_id) else {
        return false;
    };
    if !server.is_member(username) {
        return false;
    }
    let perms = server.channel_permissions(username, channel_id);
    let channel = server.find_channel(channel_id);
    perms.view_channel
        && perms.send_messages
        && channel.is_none_or(|ch| {
            ch.kind.accepts_messages()
                && (ch.kind != ChannelKind::Announcement
                    || perms.manage_messages
                    || perms.administrator)
        })
}

pub async fn handle(state: &SharedState, user_id: &str, message: ClientMessage) {
    let mut st = state.write().await;
    let Some(username) = st
        .users
        .get(user_id)
        .map(|user| user.username.to_lowercase())
    else {
        return;
    };
    let Some(account_id) = st.account_id_for(&username) else {
        return;
    };
    match message {
        ClientMessage::ListScheduledMessages => st.send_to(user_id, snapshot(&st, &account_id)),
        ClientMessage::ScheduleMessage {
            channel_id,
            content,
            send_at,
        } => {
            let now = now_ms();
            let content = content.trim();
            let reason = if send_at <= now || send_at > now.saturating_add(SCHEDULE_WINDOW_MS) {
                Some("Escolha um horário futuro dentro dos próximos 30 dias.")
            } else if content.is_empty() || content.chars().count() > 2000 {
                Some("Escreva uma mensagem de até 2.000 caracteres.")
            } else if !can_schedule(&st, &username, &channel_id) {
                Some("Você não tem permissão para agendar mensagens nesta conversa.")
            } else if st
                .scheduled_messages
                .values()
                .filter(|job| job.account_id == account_id)
                .count()
                >= MAX_SCHEDULED
            {
                Some("Você já tem 20 mensagens na lista de agendamentos.")
            } else {
                None
            };
            if let Some(reason) = reason {
                st.feedback(user_id, false, "schedule_message", reason);
                return;
            }
            let job = ScheduledMessage {
                id: Uuid::new_v4().to_string(),
                account_id: account_id.clone(),
                channel_id,
                content: content.to_string(),
                send_at,
                error: None,
            };
            st.db.write(WriteOp::UpsertScheduled(job.clone()));
            st.scheduled_messages.insert(job.id.clone(), job);
            notify_account(&st, &account_id);
            st.feedback(user_id, true, "schedule_message", "Mensagem agendada.");
        }
        ClientMessage::CancelScheduledMessage { id } => {
            if !st
                .scheduled_messages
                .get(&id)
                .is_some_and(|job| job.account_id == account_id)
            {
                st.feedback(
                    user_id,
                    false,
                    "cancel_scheduled_message",
                    "O agendamento já foi removido ou não existe.",
                );
                return;
            }
            st.db.write(WriteOp::DeleteScheduled { id: id.clone() });
            st.scheduled_messages.remove(&id);
            notify_account(&st, &account_id);
        }
        _ => {}
    }
}

pub async fn publish_due(state: &SharedState, now: i64) {
    let mut due: Vec<_> = state
        .read()
        .await
        .scheduled_messages
        .values()
        .filter(|job| job.error.is_none() && job.send_at <= now)
        .map(|job| (job.send_at, job.id.clone()))
        .collect();
    due.sort_unstable();
    for (_, id) in due.into_iter().take(32) {
        if let Err(error) = crate::ws::deliver_scheduled(state, &id).await {
            let mut st = state.write().await;
            if let Some(job) = st
                .scheduled_messages
                .get_mut(&id)
                .filter(|job| job.error.is_none())
            {
                job.error = Some(error);
                let job = job.clone();
                st.db.write(WriteOp::UpsertScheduled(job.clone()));
                notify_account(&st, &job.account_id);
            }
        }
    }
}
