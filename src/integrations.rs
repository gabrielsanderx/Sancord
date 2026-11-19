//! Bots de envio e webhooks: credenciais revogáveis, limitadas a um canal.
use crate::{
    auth,
    db::WriteOp,
    models::{AuthorKind, ChatMessage, MessageMentions, ServerMessage},
    state::{ServerState, SharedState},
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Integration {
    pub id: String,
    pub server_id: String,
    pub channel_id: String,
    pub name: String,
    pub kind: String,
    pub creator_id: String,
    pub token_hash: String,
    pub created_at: i64,
}
type Reply = (StatusCode, Json<Value>);
pub fn remove_channel(st: &mut ServerState, channel: &str) {
    let ids: Vec<_> = st
        .integrations
        .values()
        .filter(|i| i.channel_id == channel)
        .map(|i| i.id.clone())
        .collect();
    for id in ids {
        st.integrations.remove(&id);
        st.rates.remove(&format!("integration:{id}"));
        st.db.write(WriteOp::DeleteIntegration { id });
    }
}
fn error(status: StatusCode, message: &str) -> Reply {
    (status, Json(json!({"ok":false,"message":message})))
}
fn info(i: &Integration) -> Value {
    json!({"id":i.id,"server_id":i.server_id,"channel_id":i.channel_id,"name":i.name,"kind":i.kind,"created_at":i.created_at})
}
fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn manager(st: &ServerState, lower: &str, channel: &str) -> bool {
    st.find_server_by_text_channel(channel).is_some_and(|srv| {
        let p = srv.channel_permissions(lower, channel);
        srv.is_member(lower)
            && p.view_channel
            && p.send_messages
            && (p.manage_channels || p.manage_server || p.administrator)
            && srv.find_channel(channel).is_some_and(|ch| {
                ch.kind.accepts_messages()
                    && (ch.kind != crate::models::ChannelKind::Announcement
                        || p.manage_messages
                        || p.administrator)
            })
    })
}
fn user(st: &mut ServerState, headers: &HeaderMap) -> Option<crate::models::Account> {
    st.validate_session(bearer(headers)?)
        .map(|(_, account)| account)
}
pub async fn list(
    State(state): State<SharedState>,
    Path(channel): Path<String>,
    headers: HeaderMap,
) -> Reply {
    let mut st = state.write().await;
    let Some(account) = user(&mut st, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "Sessão inválida.");
    };
    if !manager(&st, &account.username.to_lowercase(), &channel) {
        return error(
            StatusCode::FORBIDDEN,
            "Sem permissão para gerenciar integrações neste canal.",
        );
    }
    let mut items: Vec<_> = st
        .integrations
        .values()
        .filter(|i| i.channel_id == channel)
        .map(info)
        .collect();
    items.sort_by_key(|i| i["created_at"].as_i64().unwrap_or(0));
    (
        StatusCode::OK,
        Json(json!({"ok":true,"integrations":items})),
    )
}
#[derive(Deserialize)]
pub struct Create {
    name: String,
    kind: String,
}
pub async fn create(
    State(state): State<SharedState>,
    Path(channel): Path<String>,
    headers: HeaderMap,
    Json(input): Json<Create>,
) -> Reply {
    let mut st = state.write().await;
    let Some(account) = user(&mut st, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "Sessão inválida.");
    };
    let lower = account.username.to_lowercase();
    if !manager(&st, &lower, &channel) {
        return error(
            StatusCode::FORBIDDEN,
            "Sem permissão para gerenciar integrações neste canal.",
        );
    }
    let name = input.name.trim();
    if name.is_empty()
        || name.chars().count() > 40
        || name.chars().any(char::is_control)
        || !matches!(input.kind.as_str(), "bot" | "webhook")
    {
        return error(
            StatusCode::BAD_REQUEST,
            "Nome ou tipo de integração inválido.",
        );
    }
    if st
        .integrations
        .values()
        .filter(|i| i.channel_id == channel)
        .count()
        >= 20
    {
        return error(StatusCode::CONFLICT, "Limite de 20 integrações por canal.");
    }
    let server_id = st
        .find_server_by_text_channel(&channel)
        .map(|s| s.id.clone())
        .unwrap_or_default();
    let token = auth::generate_token();
    let record = Integration {
        id: uuid::Uuid::new_v4().to_string(),
        server_id,
        channel_id: channel,
        name: name.to_owned(),
        kind: input.kind,
        creator_id: account.id,
        token_hash: auth::hash_token(&token),
        created_at: auth::now_ms(),
    };
    st.db
        .write(WriteOp::UpsertIntegration(Box::new(record.clone())));
    crate::moderation::audit(
        &st,
        &record.server_id,
        &lower,
        "integration_create",
        Some(&record.name),
        None,
    );
    st.integrations.insert(record.id.clone(), record.clone());
    (
        StatusCode::CREATED,
        Json(json!({"ok":true,"integration":info(&record),"token":token})),
    )
}
pub async fn rotate(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Reply {
    let mut st = state.write().await;
    let Some(account) = user(&mut st, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "Sessão inválida.");
    };
    let Some(mut record) = st.integrations.get(&id).cloned() else {
        return error(StatusCode::NOT_FOUND, "Integração não encontrada.");
    };
    let lower = account.username.to_lowercase();
    if !manager(&st, &lower, &record.channel_id) {
        return error(StatusCode::FORBIDDEN, "Sem permissão para esta integração.");
    }
    let token = auth::generate_token();
    record.token_hash = auth::hash_token(&token);
    record.creator_id = account.id;
    st.db
        .write(WriteOp::UpsertIntegration(Box::new(record.clone())));
    st.integrations.insert(id, record.clone());
    crate::moderation::audit(
        &st,
        &record.server_id,
        &lower,
        "integration_rotate",
        Some(&record.name),
        None,
    );
    (
        StatusCode::OK,
        Json(json!({"ok":true,"integration":info(&record),"token":token})),
    )
}
pub async fn revoke(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Reply {
    let mut st = state.write().await;
    let Some(account) = user(&mut st, &headers) else {
        return error(StatusCode::UNAUTHORIZED, "Sessão inválida.");
    };
    let Some(record) = st.integrations.get(&id).cloned() else {
        return error(StatusCode::NOT_FOUND, "Integração não encontrada.");
    };
    let lower = account.username.to_lowercase();
    if !manager(&st, &lower, &record.channel_id) {
        return error(StatusCode::FORBIDDEN, "Sem permissão para esta integração.");
    }
    st.integrations.remove(&id);
    st.rates.remove(&format!("integration:{id}"));
    st.db.write(WriteOp::DeleteIntegration { id });
    crate::moderation::audit(
        &st,
        &record.server_id,
        &lower,
        "integration_revoke",
        Some(&record.name),
        None,
    );
    (StatusCode::OK, Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Publish {
    content: String,
}
pub async fn publish(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<Publish>,
) -> Reply {
    let Some(token) = bearer(&headers) else {
        return error(StatusCode::UNAUTHORIZED, "Credencial inválida.");
    };
    let mut st = state.write().await;
    let Some(record) = st.integrations.get(&id).cloned() else {
        return error(StatusCode::UNAUTHORIZED, "Credencial inválida.");
    };
    let actual = auth::hash_token(token);
    let same = actual.len() == record.token_hash.len()
        && actual
            .bytes()
            .zip(record.token_hash.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0;
    if !same {
        return error(StatusCode::UNAUTHORIZED, "Credencial inválida.");
    }
    let allowed = st
        .account_by_id(&record.creator_id)
        .is_some_and(|a| manager(&st, &a.username.to_lowercase(), &record.channel_id));
    if !allowed {
        return error(StatusCode::FORBIDDEN, "A autorização desta integração foi revogada. Um administrador deve renovar a credencial.");
    }
    let text = input.content.trim();
    if text.is_empty() || text.chars().count() > 4000 {
        return error(
            StatusCode::BAD_REQUEST,
            "Envie texto entre 1 e 4000 caracteres.",
        );
    }
    let author = format!("integration:{id}");
    if !st
        .rates
        .entry(author.clone())
        .or_default()
        .allow_message(auth::now_ms())
    {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Aguarde antes de enviar novamente.",
        );
    }
    let mentions = MessageMentions::default();
    if let Err((rule, reason)) =
        crate::moderation::check_message(&mut st, &record.server_id, &author, text, &mentions)
    {
        crate::moderation::report_violation(
            &mut st,
            &record.server_id,
            &author,
            &record.channel_id,
            rule,
            text,
        );
        return error(StatusCode::UNPROCESSABLE_ENTITY, reason);
    }
    let message = ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        channel_id: record.channel_id.clone(),
        author_id: author,
        author_name: record.name.clone(),
        author_color: "#5865f2".into(),
        author_avatar: None,
        content: text.into(),
        image_url: None,
        reply_to: None,
        reactions: Default::default(),
        edited: false,
        pinned: false,
        timestamp: chrono::Local::now().format("%H:%M").to_string(),
        created_at: st.next_message_ts(),
        nonce: None,
        attachments: Vec::new(),
        mentions,
        poll: None,
        author_kind: if record.kind == "bot" {
            AuthorKind::Bot
        } else {
            AuthorKind::Webhook
        },
        embeds: Vec::new(),
        forward: None,
    };
    st.insert_message(message.clone());
    st.broadcast_to_server(
        &record.server_id,
        ServerMessage::NewChatMessage {
            message: message.clone(),
        },
    );
    crate::link_preview::spawn_for_message(state.clone(), &message);
    (
        StatusCode::CREATED,
        Json(json!({"ok":true,"message":message})),
    )
}
