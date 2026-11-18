use crate::models::{
    Channel, ChannelKind, ChatMessage, ClientMessage, GuildServer, ReplyRef, RolePermissions,
    ServerMessage, ServerRole, UserInfo,
};
use crate::chat::{clean_reaction, parse_mentions, MentionRole, MentionUser};
use crate::models::{Account, Category, Invite, MessageMentions};
use std::collections::HashSet;
use crate::state::{
    ServerState, SharedState, HISTORY_PAGE_SIZE, OUTBOUND_QUEUE, PROTOCOL_VERSION,
};
use crate::validate::{
    is_hex_color, validate_image_data_url, validate_image_or_local_path, MAX_CHAT_IMAGE_BYTES,
    MAX_PROFILE_IMAGE_BYTES,
};
use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use chrono::Local;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Notify};
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Tamanho máximo de um frame WebSocket (imagens ainda trafegam como data URL).
const MAX_WS_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
/// Prazo para o cliente se autenticar depois de abrir o socket.
const AUTH_TIMEOUT: Duration = Duration::from_secs(15);
/// Intervalo de ping do servidor e tempo máximo sem nenhum tráfego do cliente.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const IDLE_TIMEOUT_MS: i64 = 90_000;
/// Código de fechamento usado quando a autenticação falha (o cliente não deve reconectar).
pub const CLOSE_AUTH_FAILED: u16 = 4001;

const MAX_ATTACHMENTS_PER_MESSAGE: usize = 10;
const MAX_REACTIONS_PER_MESSAGE: usize = 20;
const MAX_CHANNELS_PER_SERVER: usize = 500;
const MAX_CATEGORIES_PER_SERVER: usize = 50;
const MAX_INVITES_PER_SERVER: usize = 200;

/// Nome de canal de texto: minúsculas, letras/números/`-`/`_`, até 28 caracteres.
fn slugify_channel_name(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(28)
        .collect()
}

/// Nome livre (canal de voz, categoria, pasta): sem caracteres de controle.
fn clean_display_name(raw: &str, max: usize) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Descrição do canal. `Some("")` limpa a descrição.
fn clean_topic(topic: Option<String>) -> Option<String> {
    topic
        .map(|t| {
            t.trim()
                .chars()
                .filter(|c| !c.is_control() || *c == '\n')
                .take(1024)
                .collect::<String>()
        })
        .filter(|t| !t.is_empty())
}

/// Confere se o usuário é membro com "Gerenciar canais"; avisa o cliente se não.
fn require_manage_channels(st: &ServerState, user_id: &str, server_id: &str, action: &str) -> Option<String> {
    let me_lower = st.users.get(user_id)?.username.to_lowercase();
    let allowed = st
        .find_server(server_id)
        .is_some_and(|s| s.is_member(&me_lower) && s.effective_permissions(&me_lower).manage_channels);
    if allowed {
        Some(me_lower)
    } else {
        st.feedback(
            user_id,
            false,
            action,
            "Apenas o criador ou cargos com 'Gerenciar canais' podem fazer isso.",
        );
        None
    }
}

/// Resolve as menções de uma mensagem com base nos membros/cargos do canal.
/// Responder a alguém também conta como menção (o autor original é notificado).
fn compute_mentions(
    st: &ServerState,
    channel_id: &str,
    content: &str,
    me_lower: &str,
    reply_author_lower: Option<&str>,
) -> MessageMentions {
    let display_of = |lower: &str| {
        st.accounts
            .get(lower)
            .map(|a| a.username.clone())
            .unwrap_or_else(|| lower.to_string())
    };
    let mut mentions = if ServerState::is_private_text(channel_id) {
        // DM e grupo: os participantes são os candidatos a menção.
        let names: Vec<(String, String)> = st
            .private_participants(channel_id)
            .into_iter()
            .map(|l| {
                let d = display_of(&l);
                (l, d)
            })
            .collect();
        let users: Vec<MentionUser> = names.iter().map(|(l, d)| MentionUser { lower: l, display: d }).collect();
        parse_mentions(content, &users, &[], false)
    } else if let Some(srv) = st.find_server_by_text_channel(channel_id) {
        // O hub "sancord" aceita todas as contas (a lista `members` dele é parcial).
        let mut lowers: Vec<String> = if srv.id == "sancord" {
            st.accounts.keys().cloned().collect()
        } else {
            srv.members.clone()
        };
        if !srv.owner_username.is_empty() && !lowers.contains(&srv.owner_username) {
            lowers.push(srv.owner_username.clone());
        }
        lowers.retain(|l| st.can_view_channel(l, channel_id));
        let names: Vec<(String, String)> = lowers.iter().map(|l| (l.clone(), display_of(l))).collect();
        let users: Vec<MentionUser> = names.iter().map(|(l, d)| MentionUser { lower: l, display: d }).collect();
        let roles: Vec<MentionRole> = srv
            .roles
            .iter()
            .map(|r| MentionRole { id: &r.id, name: &r.name, mentionable: r.mentionable })
            .collect();
        let can_everyone = srv.channel_permissions(me_lower, channel_id).mention_everyone;
        parse_mentions(content, &users, &roles, can_everyone)
    } else {
        MessageMentions::default()
    };
    if let Some(r) = reply_author_lower {
        if r != me_lower && !mentions.users.iter().any(|u| u == r) {
            mentions.users.push(r.to_string());
        }
    }
    mentions
}

/// Estrutura inicial (categorias + canais) de cada modelo de servidor.
fn server_template(template: Option<&str>, srv_id: &str) -> (Vec<Category>, Vec<Channel>, Vec<Channel>) {
    let cat = |key: &str, name: &str, position: i32| Category {
        id: format!("{srv_id}-cat-{key}"),
        name: name.to_string(),
        position,
        permission_overwrites: Vec::new(),
    };
    let ch = |key: &str, name: &str, kind: ChannelKind, cat_key: &str, pos: i32| {
        Channel::new(format!("{srv_id}-{key}"), name, kind).in_category(&format!("{srv_id}-cat-{cat_key}"), pos)
    };
    use ChannelKind::{Announcement as A, Text as T, Voice as V};
    match template {
        Some("gaming") => (
            vec![cat("texto", "Canais de texto", 0), cat("voz", "Canais de voz", 1)],
            vec![
                ch("geral", "geral", T, "texto", 0),
                ch("clips", "clips-e-prints", T, "texto", 1),
                ch("duo", "procurar-duo", T, "texto", 2),
            ],
            vec![ch("v1", "🎮 Jogatina", V, "voz", 0), ch("v2", "🎙️ AFK", V, "voz", 1)],
        ),
        Some("community") => (
            vec![
                cat("info", "Informações", 0),
                cat("comunidade", "Comunidade", 1),
                cat("voz", "Voz", 2),
            ],
            vec![
                ch("boas-vindas", "boas-vindas", T, "info", 0),
                ch("regras", "regras", A, "info", 1),
                ch("anuncios", "anuncios", A, "info", 2),
                ch("geral", "bate-papo", T, "comunidade", 0),
                ch("sugestoes", "sugestões", T, "comunidade", 1),
            ],
            vec![ch("v1", "☕ Lounge", V, "voz", 0), ch("v2", "🔊 Palco", V, "voz", 1)],
        ),
        Some("friends") => (
            vec![cat("texto", "Canais de texto", 0), cat("voz", "Canais de voz", 1)],
            vec![ch("resenha", "resenha", T, "texto", 0), ch("memes", "memes", T, "texto", 1)],
            vec![ch("v1", "🛋️ Call Privada", V, "voz", 0)],
        ),
        _ => (
            vec![
                cat("info", "Informações", 0),
                cat("texto", "Canais de texto", 1),
                cat("voz", "Canais de voz", 2),
            ],
            vec![ch("anuncios", "anuncios", A, "info", 0), ch("geral", "geral", T, "texto", 0)],
            vec![ch("v1", "🔊 Call Principal", V, "voz", 0)],
        ),
    }
}

fn can_manage_server(st: &ServerState, user_id: &str, server_id: &str) -> bool {
    let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
        return false;
    };
    st.find_server(server_id).is_some_and(|s| {
        let p = s.effective_permissions(&me_lower);
        s.is_member(&me_lower) && (s.is_owner(&me_lower) || p.manage_server || p.administrator)
    })
}

/// Persiste o servidor e envia o estado novo a todos os membros conectados.
fn broadcast_server_update(st: &mut ServerState, server_id: &str) {
    st.save_servers();
    if let Some(srv) = st.find_server(server_id).cloned() {
        st.broadcast_to_server(server_id, ServerMessage::ServerUpdated { server: srv });
    }
}

fn send_to_username(st: &ServerState, username_lower: &str, msg: ServerMessage) {
    for (uid, u) in &st.users {
        if u.username.to_lowercase() == username_lower {
            st.send_to(uid, msg.clone());
        }
    }
}

fn update_channel(
    st: &mut ServerState,
    user_id: &str,
    server_id: &str,
    channel_id: &str,
    name: Option<String>,
    topic: Option<String>,
    kind: Option<ChannelKind>,
    user_limit: Option<u32>,
) {
    if require_manage_channels(st, user_id, server_id, "update_channel").is_none() {
        return;
    }
    let result: Result<(), &str> = (|| {
        let srv = st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?;
        let duplicate_name = |srv: &GuildServer, slug: &str| {
            srv.text_channels.iter().any(|c| c.id != channel_id && c.name == slug)
        };
        let ch_kind = srv.find_channel(channel_id).ok_or("Canal não encontrado.")?.kind.clone();
        let new_name = match name {
            Some(n) if ch_kind.is_text_like() => {
                let slug = slugify_channel_name(&n);
                if slug.is_empty() {
                    return Err("Nome de canal inválido.");
                }
                if duplicate_name(srv, &slug) {
                    return Err("Já existe um canal de texto com esse nome.");
                }
                Some(slug)
            }
            Some(n) => Some(clean_display_name(&n, 28)).filter(|n| !n.is_empty()),
            None => None,
        };
        if let Some(k) = &kind {
            if *k != ch_kind && !(k.is_text_like() && ch_kind.is_text_like()) {
                return Err("Só é possível alternar entre canal de texto e de anúncios.");
            }
        }
        let ch = srv.find_channel_mut(channel_id).ok_or("Canal não encontrado.")?;
        if let Some(n) = new_name {
            ch.name = n;
        }
        if topic.is_some() {
            ch.topic = clean_topic(topic);
        }
        if let Some(k) = kind {
            ch.kind = k;
        }
        if let Some(limit) = user_limit {
            if ch.kind != ChannelKind::Voice {
                return Err("Limite de pessoas só vale para canais de voz.");
            }
            ch.user_limit = limit.min(crate::voice::MAX_USER_LIMIT);
        }
        Ok(())
    })();
    match result {
        Ok(()) => broadcast_server_update(st, server_id),
        Err(msg) => st.feedback(user_id, false, "update_channel", msg),
    }
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state))
}

/// Espera o primeiro pacote `JoinServer` com um token válido.
async fn authenticate(
    ws_receiver: &mut futures::stream::SplitStream<WebSocket>,
    state: &SharedState,
) -> Result<(String, Account), &'static str> {
    let first = tokio::time::timeout(AUTH_TIMEOUT, async {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => return Some(text),
                Message::Close(_) => return None,
                _ => continue,
            }
        }
        None
    })
    .await
    .map_err(|_| "Tempo de autenticação esgotado.")?
    .ok_or("Conexão encerrada antes da autenticação.")?;

    let Ok(ClientMessage::JoinServer { token, .. }) = serde_json::from_str::<ClientMessage>(&first) else {
        return Err("O primeiro pacote deve ser JoinServer.");
    };
    let token = token.unwrap_or_default();
    let mut st = state.write().await;
    st.validate_session(&token)
        .ok_or("Sessão inválida ou expirada. Entre novamente.")
}

async fn handle_socket(socket: WebSocket, state: SharedState) {
    let conn_id = Uuid::new_v4().to_string();
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // 1) Autenticação obrigatória: nada de entrar só com um nome.
    let (token_hash, account) = match authenticate(&mut ws_receiver, &state).await {
        Ok(v) => v,
        Err(reason) => {
            debug!("WebSocket recusado ({conn_id}): {reason}");
            let msg = ServerMessage::AuthFailed { message: reason.to_string() };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = ws_sender.send(Message::Text(json)).await;
            }
            let _ = ws_sender
                .send(Message::Close(Some(CloseFrame {
                    code: CLOSE_AUTH_FAILED,
                    reason: "auth".into(),
                })))
                .await;
            return;
        }
    };

    // 2) Fila de saída limitada + task de envio com heartbeat.
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(OUTBOUND_QUEUE);
    let kick = Arc::new(Notify::new());
    let last_seen = Arc::new(AtomicI64::new(crate::auth::now_ms()));

    let kick_send = kick.clone();
    let last_seen_send = last_seen.clone();
    let mut send_task = tokio::spawn(async move {
        let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
        heartbeat.tick().await;
        loop {
            tokio::select! {
                maybe = rx.recv() => {
                    let Some(server_msg) = maybe else { break };
                    match serde_json::to_string(&server_msg) {
                        Ok(json_text) => {
                            if ws_sender.send(Message::Text(json_text)).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => warn!("Falha ao serializar evento: {e}"),
                    }
                }
                _ = heartbeat.tick() => {
                    let idle = crate::auth::now_ms() - last_seen_send.load(Ordering::Relaxed);
                    if idle > IDLE_TIMEOUT_MS {
                        debug!("Conexão sem atividade há {idle} ms; encerrando.");
                        break;
                    }
                    if ws_sender.send(Message::Ping(Vec::new())).await.is_err() {
                        break;
                    }
                }
                _ = kick_send.notified() => {
                    let _ = ws_sender.send(Message::Close(Some(CloseFrame {
                        code: 1013,
                        reason: "lagging".into(),
                    }))).await;
                    break;
                }
            }
        }
    });

    {
        let mut st = state.write().await;
        st.peers.insert(conn_id.clone(), crate::state::Peer { tx, kick });
        st.conn_sessions.insert(conn_id.clone(), token_hash);
    }
    join_authenticated(&conn_id, account, &state).await;

    // 3) Loop de leitura.
    let recv_state = state.clone();
    let recv_conn = conn_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            last_seen.store(crate::auth::now_ms(), Ordering::Relaxed);
            match msg {
                Message::Text(text) => match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => process_client_message(&recv_conn, client_msg, &recv_state).await,
                    Err(err) => warn!("Mensagem JSON inválida de {}: {}", recv_conn, err),
                },
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Quando qualquer lado termina, encerra o outro.
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    cleanup_disconnected_user(&conn_id, &state).await;
}

/// Registra a conexão autenticada e envia o estado inicial completo.
/// Como o `Welcome` contém o estado atual, uma reconexão também serve para
/// sincronizar tudo que o cliente perdeu enquanto estava offline.
async fn join_authenticated(user_id: &str, acc: Account, state: &SharedState) {
    let account_id = acc.id.clone();
    let mut st = state.write().await;
    {
        {
            let user_info = {
                UserInfo {
                    id: user_id.to_string(),
                    username: acc.username,
                    avatar_color: acc.avatar_color,
                    avatar_url: acc.avatar_url,
                    status_kind: acc.status_kind,
                    custom_status: acc.custom_status,
                    display_name: acc.display_name,
                    pronouns: acc.pronouns,
                    custom_status_emoji: acc.custom_status_emoji,
                    custom_status_expires_at: acc.custom_status_expires_at,
                    bio: acc.bio,
                    avatar_decoration: acc.avatar_decoration,
                    banner_url: acc.banner_url,
                    theme_primary: acc.theme_primary,
                    theme_accent: acc.theme_accent,
                    name_style: acc.name_style,
                    name_color: acc.name_color,
                    nameplate_style: acc.nameplate_style,
                    profile_effect: acc.profile_effect,
                    created_at: acc.created_at,
                    voice_channel_id: None,
                    muted: false,
                    deafened: false,
                    server_muted: false,
                    server_deafened: false,
                    screen_sharing: false,
                    camera_on: false,
                    stream_quality: None,
                    camera_stream_id: None,
                    screen_stream_id: None,
                }
            };

            let final_name = user_info.username.clone();
            let final_lower = final_name.to_lowercase();

            let now = crate::auth::now_ms();
            if let Some(hub) = st.find_server_mut("sancord") {
                if !hub.is_banned(&final_lower) && !hub.members.contains(&final_lower) {
                    hub.members.push(final_lower.clone());
                    hub.member_joined_at.entry(final_lower.clone()).or_insert(now);
                    st.save_servers();
                }
            }

            st.users.insert(user_id.to_string(), user_info.clone());
            info!("Usuário entrou no servidor: {} ({})", final_name, user_id);
            let prefs = st.prefs_for(&account_id, &final_lower);
            let read_states = st.read_states_for(&account_id, &final_lower);

            let welcome = ServerMessage::Welcome {
                user: user_info.clone(),
                text_channels: st.text_channels.clone(),
                voice_channels: st.voice_channels.clone(),
                servers: st.servers_for_user(&final_lower),
                users: st.users_list(),
                voice_members: st.voice_members_map(),
                chat_history: st.public_chat_history_for(&final_lower),
                protocol_version: PROTOCOL_VERSION,
                server_time: crate::auth::now_ms(),
                history_page_size: HISTORY_PAGE_SIZE,
                prefs,
                read_states,
                ice_servers: st.config.ice_servers.clone(),
            };
            st.send_to(user_id, welcome);

            st.broadcast_except(
                user_id,
                ServerMessage::UserJoined {
                    user: user_info,
                },
            );

            st.broadcast_friends_sync_all();
        }
    }
}

/// Busca uma mensagem para alteração: primeiro no cache, depois no banco
/// (mensagens antigas fora do cache). A leitura do banco acontece SEM o lock
/// do estado, em `spawn_blocking`.
async fn fetch_message_for_mutation(
    state: &SharedState,
    channel_id: &str,
    message_id: &str,
) -> Option<ChatMessage> {
    let db = {
        let st = state.read().await;
        if let Some(m) = st
            .chat_history
            .get(channel_id)
            .and_then(|l| l.iter().find(|m| m.id == message_id))
        {
            return Some(m.clone());
        }
        st.db.clone()
    };
    let ch = channel_id.to_string();
    let mid = message_id.to_string();
    tokio::task::spawn_blocking(move || db.get_message(&ch, &mid))
        .await
        .ok()
        .and_then(|r| r.map_err(|e| warn!("Falha ao ler mensagem do banco: {e}")).ok())
        .flatten()
}

/// Aplica `f` à mensagem no cache (se estiver lá) ou à cópia vinda do banco,
/// persiste e devolve a versão final. `f` retorna `false` para abortar.
fn mutate_message(
    st: &mut ServerState,
    channel_id: &str,
    message_id: &str,
    fallback: Option<ChatMessage>,
    f: impl FnOnce(&mut ChatMessage) -> bool,
) -> Option<ChatMessage> {
    let in_cache = st
        .chat_history
        .get_mut(channel_id)
        .and_then(|l| l.iter_mut().find(|m| m.id == message_id));
    let updated = match in_cache {
        Some(m) => {
            if !f(m) {
                return None;
            }
            m.clone()
        }
        None => {
            let mut m = fallback.filter(|m| m.id == message_id && m.channel_id == channel_id)?;
            if !f(&mut m) {
                return None;
            }
            m
        }
    };
    st.persist_message(&updated);
    Some(updated)
}

async fn process_client_message(user_id: &str, msg: ClientMessage, state: &SharedState) {
    let requested = match &msg {
        ClientMessage::EditChat { channel_id, .. } => Some((channel_id, "edit_chat", "send_messages")),
        ClientMessage::DeleteChat { channel_id, .. } => Some((channel_id, "delete_chat", "view_channel")),
        ClientMessage::TogglePinChat { channel_id, .. } => Some((channel_id, "pin_chat", "pin_messages")),
        ClientMessage::ToggleReaction { channel_id, .. } => Some((channel_id, "reaction", "add_reactions")),
        _ => None,
    };
    if let Some((channel, action, permission)) = requested {
        let st = state.read().await;
        let Some(user) = st.users.get(user_id) else { return; };
        let lower = user.username.to_lowercase();
        let allowed = st.can_read_text_channel(&lower, channel) && (ServerState::is_private_text(channel) ||
            st.find_server_by_text_channel(channel).is_some_and(|s| s.channel_permissions(&lower, channel).value(permission)));
        if !allowed {
            st.feedback(user_id, false, action, "Você não tem permissão para esta ação neste canal.");
            return;
        }
    }
    match msg {
        // A autenticação acontece no primeiro pacote; repetições são ignoradas.
        ClientMessage::JoinServer { .. } => {}

        ClientMessage::LoadMessages {
            channel_id,
            before_id,
            after_id,
            around_id,
            limit,
        } => {
            let db = {
                let st = state.read().await;
                let Some(me) = st.users.get(user_id) else {
                    return;
                };
                if !st.can_read_text_channel(&me.username.to_lowercase(), &channel_id) {
                    st.feedback(user_id, false, "load_messages", "Você não tem acesso a este canal.");
                    return;
                }
                st.db.clone()
            };
            let limit = limit.unwrap_or(HISTORY_PAGE_SIZE as u32).clamp(1, 100) as usize;
            let ch = channel_id.clone();
            let (b, a, r) = (before_id.clone(), after_id.clone(), around_id.clone());
            // (mensagens, há mais antigas, há mais novas)
            let result = tokio::task::spawn_blocking(move || -> Result<(Vec<ChatMessage>, bool, bool), crate::db::DbError> {
                if let Some(around) = r {
                    db.messages_around(&ch, &around, limit)
                } else if let Some(after) = a {
                    let (list, more_after) = db.messages_after(&ch, &after, limit)?;
                    Ok((list, true, more_after))
                } else {
                    let (list, more) = db.messages_before(&ch, b.as_deref(), limit)?;
                    Ok((list, more, false))
                }
            })
            .await;
            let st = state.read().await;
            match result {
                Ok(Ok((messages, has_more, has_more_after))) => st.send_to(
                    user_id,
                    ServerMessage::MessagesPage {
                        channel_id,
                        before_id,
                        after_id,
                        around_id,
                        messages,
                        has_more,
                        has_more_after,
                    },
                ),
                Ok(Err(e)) => {
                    warn!("Falha ao carregar histórico de {channel_id}: {e}");
                    st.feedback(user_id, false, "load_messages", "Não foi possível carregar o histórico.");
                }
                Err(e) => {
                    warn!("Task de histórico falhou: {e}");
                    st.feedback(user_id, false, "load_messages", "Não foi possível carregar o histórico.");
                }
            }
        }

        ClientMessage::AckChannel { channel_id, message_id } => {
            let Some(msg) = fetch_message_for_mutation(state, &channel_id, &message_id).await else {
                return;
            };
            let mut st = state.write().await;
            let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
                return;
            };
            if !st.can_read_text_channel(&me_lower, &channel_id) {
                return;
            }
            let Some(acc) = st.account_id_for(&me_lower) else {
                return;
            };
            let before = st.read_state(&acc, &channel_id);
            let info = st.mark_read(&acc, &channel_id, msg.created_at);
            if info.last_read_at != before.last_read_at || info.mention_count != before.mention_count {
                st.send_read_state(&me_lower, info);
            }
        }

        ClientMessage::AckServer { server_id } => {
            let mut st = state.write().await;
            let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
                return;
            };
            let Some(acc) = st.account_id_for(&me_lower) else {
                return;
            };
            let Some(srv) = st.find_server(&server_id).filter(|s| s.is_member(&me_lower)) else {
                return;
            };
            let latest: Vec<(String, i64)> = srv
                .text_channels
                .iter()
                .filter(|c| st.can_read_text_channel(&me_lower, &c.id))
                .map(|c| {
                    let ts = st
                        .chat_history
                        .get(&c.id)
                        .and_then(|l| l.last())
                        .map(|m| m.created_at)
                        .unwrap_or(0);
                    (c.id.clone(), ts)
                })
                .collect();
            for (ch, ts) in latest {
                let info = st.mark_read(&acc, &ch, ts);
                st.send_read_state(&me_lower, info);
            }
        }

        ClientMessage::MarkUnread { channel_id, message_id } => {
            let Some(msg) = fetch_message_for_mutation(state, &channel_id, &message_id).await else {
                return;
            };
            let mut st = state.write().await;
            let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
                return;
            };
            if !st.can_read_text_channel(&me_lower, &channel_id) {
                return;
            }
            let Some(acc) = st.account_id_for(&me_lower) else {
                return;
            };
            let info = st.mark_unread(&acc, &channel_id, msg.created_at);
            st.send_read_state(&me_lower, info);
        }

        ClientMessage::ListPins { channel_id } => {
            let db = {
                let st = state.read().await;
                let Some(me) = st.users.get(user_id) else {
                    return;
                };
                if !st.can_read_text_channel(&me.username.to_lowercase(), &channel_id) {
                    return;
                }
                st.db.clone()
            };
            let ch = channel_id.clone();
            let pins = tokio::task::spawn_blocking(move || db.pinned_messages(&ch, 50)).await;
            let st = state.read().await;
            match pins {
                Ok(Ok(messages)) => st.send_to(user_id, ServerMessage::PinnedMessages { channel_id, messages }),
                _ => st.feedback(user_id, false, "list_pins", "Não foi possível carregar as mensagens fixadas."),
            }
        }

        ClientMessage::UpdateAvatar { avatar_url } => {
            if let Err(e) = validate_image_data_url(&avatar_url, MAX_PROFILE_IMAGE_BYTES) {
                state.read().await.feedback(user_id, false, "update_avatar", e.user_message());
                return;
            }
            let mut st = state.write().await;
            let username_opt = if let Some(user) = st.users.get_mut(user_id) {
                user.avatar_url = Some(avatar_url.clone());
                Some(user.username.to_lowercase())
            } else {
                None
            };

            if let Some(key) = username_opt {
                if let Some(acc) = st.accounts.get_mut(&key) {
                    acc.avatar_url = Some(avatar_url);
                }
                st.save_accounts();
            }

            let sync_msg = ServerMessage::VoiceStateSync {
                voice_members: st.voice_members_map(),
                users: st.users_list(),
            };
            st.broadcast(sync_msg);
            st.broadcast_friends_sync_all();
        }

        ClientMessage::UpdateProfile {
            status_kind,
            custom_status,
            bio,
            avatar_decoration,
            banner_url,
            theme_primary,
            theme_accent,
            name_style,
            name_color,
            nameplate_style,
            profile_effect,
            display_name,
            pronouns,
            custom_status_emoji,
            custom_status_expires_in,
        } => {
            let mut st = state.write().await;
            // None = manter; Some("") = limpar.
            let upd_display = display_name.map(|s| Some(clean_display_name(&s, 32)).filter(|s| !s.is_empty()));
            let upd_pronouns = pronouns.map(|s| Some(clean_display_name(&s, 40)).filter(|s| !s.is_empty()));
            let upd_emoji = custom_status_emoji.map(|s| {
                let e = s.trim().to_string();
                Some(e).filter(|e| !e.is_empty() && crate::chat::clean_reaction(e).is_some())
            });
            let upd_expires = custom_status_expires_in.map(|secs| {
                (secs > 0).then(|| crate::auth::now_ms() + secs.min(30 * 24 * 3600) * 1000)
            });
            let clean_status = status_kind
                .as_deref()
                .filter(|s| matches!(*s, "online" | "idle" | "dnd" | "invisible"))
                .map(|s| s.to_string());
            let clean_custom = custom_status
                .map(|s| s.trim().chars().take(60).collect::<String>())
                .filter(|s| !s.is_empty());
            let clean_bio = bio
                .map(|s| s.trim().chars().take(200).collect::<String>())
                .filter(|s| !s.is_empty());

            fn clean_opt_token(input: Option<String>, max_len: usize) -> Option<Option<String>> {
                input.map(|s| {
                    let trimmed = s.trim();
                    if trimmed.is_empty() || trimmed == "none" {
                        None
                    } else {
                        Some(trimmed.chars().take(max_len).collect())
                    }
                })
            }

            let upd_dec = clean_opt_token(avatar_decoration, 40);
            let upd_banner = banner_url.map(|s| {
                let t = s.trim();
                if t.is_empty() {
                    None
                } else if validate_image_data_url(t, MAX_PROFILE_IMAGE_BYTES).is_ok() {
                    Some(t.to_string())
                } else {
                    None
                }
            });
            // Cores vão parar em atributos `style` no cliente: só hex válido.
            fn clean_color(input: Option<String>) -> Option<Option<String>> {
                clean_opt_token(input, 16).map(|v| v.filter(|c| is_hex_color(c)))
            }
            // Identificadores de estilo: apenas [a-z0-9-_].
            fn clean_ident(input: Option<String>, max_len: usize) -> Option<Option<String>> {
                clean_opt_token(input, max_len).map(|v| {
                    v.filter(|s| s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
                })
            }
            let upd_dec = upd_dec.map(|v| v.filter(|s| !s.contains(['<', '>', '"', '\''])));
            let upd_tp = clean_color(theme_primary);
            let upd_ta = clean_color(theme_accent);
            let upd_ns = clean_ident(name_style, 24);
            let upd_nc = clean_color(name_color);
            let upd_np = clean_ident(nameplate_style, 32);
            let upd_pe = clean_ident(profile_effect, 32);

            let username_opt = if let Some(user) = st.users.get_mut(user_id) {
                if let Some(ref sk) = clean_status {
                    user.status_kind = sk.clone();
                }
                user.custom_status = clean_custom.clone();
                user.bio = clean_bio.clone();
                if let Some(ref v) = upd_display { user.display_name = v.clone(); }
                if let Some(ref v) = upd_pronouns { user.pronouns = v.clone(); }
                if clean_custom.is_none() {
                    user.custom_status_emoji = None;
                    user.custom_status_expires_at = None;
                } else {
                    if let Some(ref v) = upd_emoji { user.custom_status_emoji = v.clone(); }
                    if let Some(v) = upd_expires { user.custom_status_expires_at = v; }
                }
                if let Some(ref v) = upd_dec { user.avatar_decoration = v.clone(); }
                if let Some(ref v) = upd_banner { user.banner_url = v.clone(); }
                if let Some(ref v) = upd_tp { user.theme_primary = v.clone(); }
                if let Some(ref v) = upd_ta { user.theme_accent = v.clone(); }
                if let Some(ref v) = upd_ns { user.name_style = v.clone(); }
                if let Some(ref v) = upd_nc { user.name_color = v.clone(); }
                if let Some(ref v) = upd_np { user.nameplate_style = v.clone(); }
                if let Some(ref v) = upd_pe { user.profile_effect = v.clone(); }
                Some(user.username.to_lowercase())
            } else {
                None
            };

            if let Some(key) = username_opt {
                if let Some(acc) = st.accounts.get_mut(&key) {
                    if let Some(sk) = clean_status {
                        acc.status_kind = sk;
                    }
                    if clean_custom.is_none() {
                        acc.custom_status_emoji = None;
                        acc.custom_status_expires_at = None;
                    } else {
                        if let Some(v) = upd_emoji { acc.custom_status_emoji = v; }
                        if let Some(v) = upd_expires { acc.custom_status_expires_at = v; }
                    }
                    acc.custom_status = clean_custom;
                    acc.bio = clean_bio;
                    if let Some(v) = upd_display { acc.display_name = v; }
                    if let Some(v) = upd_pronouns { acc.pronouns = v; }
                    if let Some(v) = upd_dec { acc.avatar_decoration = v; }
                    if let Some(v) = upd_banner { acc.banner_url = v; }
                    if let Some(v) = upd_tp { acc.theme_primary = v; }
                    if let Some(v) = upd_ta { acc.theme_accent = v; }
                    if let Some(v) = upd_ns { acc.name_style = v; }
                    if let Some(v) = upd_nc { acc.name_color = v; }
                    if let Some(v) = upd_np { acc.nameplate_style = v; }
                    if let Some(v) = upd_pe { acc.profile_effect = v; }
                }
                st.save_accounts();
            }

            let sync_msg = ServerMessage::VoiceStateSync {
                voice_members: st.voice_members_map(),
                users: st.users_list(),
            };
            st.broadcast(sync_msg);
            st.broadcast_friends_sync_all();
        }

        ClientMessage::SendChat {
            channel_id,
            content,
            image_url,
            reply_to_id,
            nonce,
            attachment_ids,
        } => {
            let nonce: Option<String> = nonce.map(|n| n.chars().take(64).collect());
            // Mensagem respondida pode estar fora do cache: busca antes de travar o estado.
            let reply_target = match &reply_to_id {
                Some(rid) => fetch_message_for_mutation(state, &channel_id, rid).await,
                None => None,
            };
            let fail = |st: &ServerState, message: &str| {
                st.send_to(
                    user_id,
                    ServerMessage::SendFailed {
                        nonce: nonce.clone(),
                        channel_id: channel_id.clone(),
                        message: message.to_string(),
                    },
                );
            };
            let trimmed = content.trim();
            let image_url = image_url.filter(|s| !s.is_empty());
            if let Some(img) = &image_url {
                if let Err(e) = validate_image_data_url(img, MAX_CHAT_IMAGE_BYTES) {
                    fail(&*state.read().await, e.user_message());
                    return;
                }
            }
            let valid_img = image_url.is_some();

            if trimmed.is_empty() && !valid_img && attachment_ids.is_empty() {
                return;
            }

            let mut st = state.write().await;
            let Some(user) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = user.username.to_lowercase();
            if !st.rates.entry(user_id.to_string()).or_default().allow_message(crate::auth::now_ms()) {
                fail(&st, "Você está enviando mensagens rápido demais. Aguarde um instante.");
                return;
            }
            if attachment_ids.len() > MAX_ATTACHMENTS_PER_MESSAGE {
                fail(&st, "No máximo 10 anexos por mensagem.");
                return;
            }
            let mut attachments = Vec::new();
            for id in &attachment_ids {
                match st.attachments.get(id) {
                    Some(rec) if !attachments.iter().any(|a: &crate::models::Attachment| &a.id == id) => {
                        attachments.push(rec.to_public())
                    }
                    Some(_) => {}
                    None => {
                        fail(&st, "Um dos anexos não foi encontrado. Envie o arquivo novamente.");
                        return;
                    }
                }
            }
            let has_files = valid_img || !attachments.is_empty();
            let is_dm = ServerState::is_private_text(&channel_id);
            let mut target_server_id: Option<String> = None;
            // DM 1:1: o outro participante e se a mensagem vira solicitação para ele.
            let mut dm_peer: Option<(String, bool)> = None;
            if is_dm {
                if !st.is_private_participant(&channel_id, &me_lower) {
                    fail(&st, "Você não participa desta conversa.");
                    return;
                }
                if let Some((a, b)) = ServerState::parse_dm_participants(&channel_id) {
                    let peer = if a == me_lower { b } else { a };
                    match st.dm_delivery(&me_lower, &peer, &channel_id) {
                        Ok(is_request) => dm_peer = Some((peer, is_request)),
                        Err(msg) => {
                            fail(&st, msg);
                            return;
                        }
                    }
                }
            } else {
                let Some(srv) = st.find_server_by_text_channel(&channel_id) else {
                    fail(&st, "Este canal não existe mais.");
                    return;
                };
                if !srv.is_member(&me_lower) {
                    fail(&st, "Você não é membro deste servidor.");
                    return;
                }
                let perms = srv.channel_permissions(&me_lower, &channel_id);
                if !perms.view_channel { fail(&st, "Você não tem acesso a este canal."); return; }
                if !perms.send_messages {
                    fail(&st, "Você não tem permissão para enviar mensagens neste servidor.");
                    return;
                }
                if has_files && !perms.attach_files {
                    fail(&st, "Seu cargo não possui permissão para enviar imagens/anexos.");
                    return;
                }
                let is_announcement = srv
                    .find_channel(&channel_id)
                    .is_some_and(|c| c.kind == ChannelKind::Announcement);
                if is_announcement && !(perms.manage_messages || perms.administrator) {
                    fail(&st, "Somente moderadores podem publicar em canais de anúncios.");
                    return;
                }
                target_server_id = Some(srv.id.clone());
            }

            let reply_to = reply_target.as_ref().filter(|t| t.channel_id == channel_id).map(|target| {
                let preview_src = if !target.content.is_empty() {
                    target.content.chars().take(70).collect()
                } else if !target.attachments.is_empty() {
                    format!("[{} anexo(s)]", target.attachments.len())
                } else {
                    "[Imagem]".to_string()
                };
                ReplyRef {
                    id: target.id.clone(),
                    author_name: target.author_name.clone(),
                    preview: preview_src,
                }
            });
            let content: String = trimmed.chars().take(2000).collect();
            let reply_author_lower = reply_target
                .as_ref()
                .filter(|t| t.author_id != "system")
                .map(|t| t.author_name.to_lowercase());
            let mentions = compute_mentions(&st, &channel_id, &content, &me_lower, reply_author_lower.as_deref());

            let chat_msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                channel_id: channel_id.clone(),
                author_id: user.id.clone(),
                author_name: user.username,
                author_color: user.avatar_color,
                author_avatar: user.avatar_url,
                content,
                image_url,
                reply_to,
                reactions: std::collections::HashMap::new(),
                edited: false,
                pinned: false,
                timestamp: Local::now().format("%H:%M").to_string(),
                created_at: st.next_message_ts(),
                nonce: nonce.clone(),
                attachments,
                mentions,
            };

            // Estado social antes de contar menções: solicitações não notificam.
            if let Some((peer, is_request)) = &dm_peer {
                use crate::models::FriendsStore as Fs;
                let fs = &mut st.friends_store;
                Fs::push_unique(&mut fs.open_dms, &me_lower, &channel_id);
                // Responder a uma solicitação recebida equivale a aceitá-la.
                Fs::remove_from(&mut fs.dm_requests, &me_lower, &channel_id);
                Fs::remove_from(&mut fs.ignored_dms, &me_lower, &channel_id);
                if *is_request {
                    // Se ele ignorou, a conversa continua oculta e silenciosa.
                    if !fs.is_ignored(peer, &channel_id) {
                        Fs::push_unique(&mut fs.dm_requests, peer, &channel_id);
                    }
                } else {
                    Fs::push_unique(&mut fs.open_dms, peer, &channel_id);
                }
                st.save_friends();
            }

            // Persiste (fila do banco) e mantém só as recentes no cache.
            // Antes, o histórico era truncado em 200 e as antigas eram perdidas.
            st.insert_message(chat_msg.clone());
            // Menções pendentes para os destinatários; o autor já leu a própria mensagem.
            st.bump_mentions(&channel_id, &me_lower, &chat_msg.mentions);
            if let Some(acc) = st.account_id_for(&me_lower) {
                st.mark_read(&acc, &channel_id, chat_msg.created_at);
            }

            if is_dm {
                st.send_to_dm_participants(&channel_id, ServerMessage::NewChatMessage { message: chat_msg });
                if let Some((peer, _)) = &dm_peer {
                    // Lista de DMs/solicitações dos dois lados (pré-visualização e classificação).
                    st.send_friends_sync_to_username(&me_lower);
                    st.send_friends_sync_to_username(peer);
                }
            } else if let Some(srv_id) = target_server_id {
                st.broadcast_to_server(&srv_id, ServerMessage::NewChatMessage { message: chat_msg });
            }
        }

        ClientMessage::EditChat {
            channel_id,
            message_id,
            content,
        } => {
            let trimmed = content.trim();
            if trimmed.is_empty() {
                return;
            }
            let fallback = fetch_message_for_mutation(state, &channel_id, &message_id).await;
            let mut st = state.write().await;
            let Some(user) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = user.username.to_lowercase();
            let is_dm = ServerState::is_private_text(&channel_id);
            let srv_id = if is_dm {
                if !st.is_private_participant(&channel_id, &me_lower) {
                    return;
                }
                None
            } else {
                let Some(srv) = st.find_server_by_text_channel(&channel_id) else {
                    return;
                };
                if !st.can_read_text_channel(&me_lower, &channel_id) || !srv.channel_permissions(&me_lower, &channel_id).send_messages {
                    return;
                }
                Some(srv.id.clone())
            };
            let new_content: String = trimmed.chars().take(2000).collect();
            // Menções recalculadas para o destaque (edição não gera nova notificação).
            let new_mentions = compute_mentions(&st, &channel_id, &new_content, &me_lower, None);
            let updated_msg = mutate_message(&mut st, &channel_id, &message_id, fallback, |msg| {
                // Só o autor edita a própria mensagem.
                if msg.author_id == user_id || msg.author_name.eq_ignore_ascii_case(&user.username) {
                    msg.content = new_content;
                    msg.edited = true;
                    let reply_author = msg.reply_to.as_ref().map(|r| r.author_name.to_lowercase());
                    msg.mentions = new_mentions;
                    if let Some(r) = reply_author.filter(|r| *r != me_lower) {
                        if !msg.mentions.users.contains(&r) {
                            msg.mentions.users.push(r);
                        }
                    }
                    true
                } else {
                    false
                }
            });
            if updated_msg.is_none() {
                st.feedback(user_id, false, "edit_chat", "Não foi possível editar esta mensagem.");
            }
            if let Some(message) = updated_msg {
                if is_dm {
                    st.send_to_dm_participants(&channel_id, ServerMessage::MessageUpdated { message });
                } else if let Some(sid) = srv_id {
                    st.broadcast_to_server(&sid, ServerMessage::MessageUpdated { message });
                }
            }
        }

        ClientMessage::DeleteChat {
            channel_id,
            message_id,
        } => {
            let fallback = fetch_message_for_mutation(state, &channel_id, &message_id).await;
            let mut st = state.write().await;
            let Some(user) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = user.username.to_lowercase();
            let is_dm = ServerState::is_private_text(&channel_id);
            let mut can_moderate = false;
            let srv_id = if is_dm {
                if !st.is_private_participant(&channel_id, &me_lower) {
                    return;
                }
                None
            } else {
                let Some(srv) = st.find_server_by_text_channel(&channel_id) else {
                    return;
                };
                if !st.can_read_text_channel(&me_lower, &channel_id) {
                    return;
                }
                can_moderate = srv.channel_permissions(&me_lower, &channel_id).manage_messages;
                Some(srv.id.clone())
            };
            let allowed = fallback
                .as_ref()
                .map(|m| {
                    m.channel_id == channel_id
                        && (can_moderate
                            || m.author_id == user_id
                            || m.author_name.eq_ignore_ascii_case(&user.username))
                })
                .unwrap_or(false);
            if !allowed {
                st.feedback(user_id, false, "delete_chat", "Você não pode excluir esta mensagem.");
            }
            if allowed {
                st.remove_message(&channel_id, &message_id);
                let ev = ServerMessage::MessageDeleted {
                    channel_id: channel_id.clone(),
                    message_id,
                };
                if is_dm {
                    st.send_to_dm_participants(&channel_id, ev);
                } else if let Some(sid) = srv_id {
                    st.broadcast_to_server(&sid, ev);
                }
            }
        }

        ClientMessage::TogglePinChat {
            channel_id,
            message_id,
        } => {
            let fallback = fetch_message_for_mutation(state, &channel_id, &message_id).await;
            let mut st = state.write().await;
            let Some(user) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = user.username.to_lowercase();
            let is_dm = ServerState::is_private_text(&channel_id);
            let srv_id = if is_dm {
                if !st.is_private_participant(&channel_id, &me_lower) {
                    return;
                }
                None
            } else {
                let Some(srv) = st.find_server_by_text_channel(&channel_id) else {
                    return;
                };
                if !st.can_read_text_channel(&me_lower, &channel_id) || !srv.channel_permissions(&me_lower, &channel_id).pin_messages {
                    return;
                }
                Some(srv.id.clone())
            };
            let updated_msg = mutate_message(&mut st, &channel_id, &message_id, fallback, |msg| {
                msg.pinned = !msg.pinned;
                true
            });
            if let Some(message) = updated_msg {
                if is_dm {
                    st.send_to_dm_participants(&channel_id, ServerMessage::MessageUpdated { message });
                } else if let Some(sid) = srv_id {
                    st.broadcast_to_server(&sid, ServerMessage::MessageUpdated { message });
                }
            }
        }

        ClientMessage::ToggleReaction {
            channel_id,
            message_id,
            emoji,
        } => {
            let Some(clean_emoji) = clean_reaction(&emoji) else {
                state.read().await.feedback(user_id, false, "reaction", "Reação inválida.");
                return;
            };
            let fallback = fetch_message_for_mutation(state, &channel_id, &message_id).await;
            let mut st = state.write().await;
            let Some(user) = st.users.get(user_id).cloned() else {
                return;
            };
            if !st.rates.entry(user_id.to_string()).or_default().allow_reaction(crate::auth::now_ms()) {
                return;
            }
            let is_dm = ServerState::is_private_text(&channel_id);
            let srv_id = if is_dm {
                if !st.is_private_participant(&channel_id, &user.username.to_lowercase()) {
                    return;
                }
                None
            } else {
                let Some(srv) = st.find_server_by_text_channel(&channel_id) else {
                    return;
                };
                if !st.can_read_text_channel(&user.username.to_lowercase(), &channel_id) || !srv.channel_permissions(&user.username.to_lowercase(), &channel_id).add_reactions {
                    return;
                }
                Some(srv.id.clone())
            };
            let username = user.username.clone();
            let updated_msg = mutate_message(&mut st, &channel_id, &message_id, fallback, |msg| {
                if !msg.reactions.contains_key(&clean_emoji) && msg.reactions.len() >= MAX_REACTIONS_PER_MESSAGE {
                    return false;
                }
                let users_vec = msg.reactions.entry(clean_emoji.clone()).or_default();
                if let Some(pos) = users_vec.iter().position(|u| u == &username) {
                    users_vec.remove(pos);
                    if users_vec.is_empty() {
                        msg.reactions.remove(&clean_emoji);
                    }
                } else {
                    users_vec.push(username);
                }
                true
            });
            if let Some(message) = updated_msg {
                if is_dm {
                    st.send_to_dm_participants(&channel_id, ServerMessage::MessageUpdated { message });
                } else if let Some(sid) = srv_id {
                    st.broadcast_to_server(&sid, ServerMessage::MessageUpdated { message });
                }
            }
        }

        ClientMessage::Typing { channel_id } => {
            {
                let mut st = state.write().await;
                if !st.rates.entry(user_id.to_string()).or_default().allow_typing(crate::auth::now_ms()) {
                    return;
                }
            }
            let st = state.read().await;
            if let Some(user) = st.users.get(user_id) {
                let is_dm = ServerState::is_private_text(&channel_id);
                if is_dm && !st.is_private_participant(&channel_id, &user.username.to_lowercase()) {
                    return;
                }
                let ev = ServerMessage::UserTyping {
                    channel_id: channel_id.clone(),
                    user_id: user.id.clone(),
                    username: user.username.clone(),
                };
                if is_dm {
                    st.send_to_dm_participants(&channel_id, ev);
                } else if let Some(srv) = st.find_server_by_text_channel(&channel_id) {
                    // Antes ia para TODOS os conectados, vazando atividade de
                    // servidores privados. Agora só para membros do servidor.
                    if srv.channel_permissions(&user.username.to_lowercase(), &channel_id).send_messages && st.can_view_channel(&user.username.to_lowercase(), &channel_id) {
                        let sid = srv.id.clone();
                        st.broadcast_to_server_except(&sid, user_id, ev);
                    }
                }
            }
        }

        ClientMessage::CreateChannel {
            name,
            kind,
            server_id,
            category_id,
            topic,
            overwrites,
            permissions_synced,
        } => {
            let raw = name.trim();
            if raw.is_empty() {
                return;
            }
            let target_srv_id = server_id.unwrap_or_else(|| "sancord".to_string());
            let mut st = state.write().await;
            let Some(me_lower) = require_manage_channels(&st, user_id, &target_srv_id, "create_channel") else { return; };
            let created: Result<Channel, &str> = (|| {
                let srv = st.find_server_mut(&target_srv_id).ok_or("Servidor não encontrado.")?;
                if srv.text_channels.len() + srv.voice_channels.len() >= MAX_CHANNELS_PER_SERVER {
                    return Err("Este servidor atingiu o limite de canais.");
                }
                let category_id = category_id.filter(|c| srv.categories.iter().any(|k| &k.id == c));
                let (id, clean_name) = if kind.is_text_like() {
                    let slug = slugify_channel_name(raw);
                    if slug.is_empty() {
                        return Err("Nome de canal inválido.");
                    }
                    if srv.text_channels.iter().any(|c| c.name == slug) {
                        return Err("Já existe um canal de texto com esse nome.");
                    }
                    let id = if target_srv_id == "sancord" && !srv.text_channels.iter().any(|c| c.id == slug) {
                        slug.clone()
                    } else {
                        format!("{}-{}-{}", target_srv_id, slug, &Uuid::new_v4().simple().to_string()[..4])
                    };
                    (id, slug)
                } else {
                    let display = clean_display_name(raw, 28);
                    if display.is_empty() {
                        return Err("Nome de canal inválido.");
                    }
                    (format!("voice-{}", Uuid::new_v4().simple()), display)
                };
                srv.validate_overwrites(&me_lower, &overwrites)?;
                let position = srv.next_position(category_id.as_deref());
                let ch = Channel {
                    id,
                    name: clean_name,
                    kind: kind.clone(),
                    category_id,
                    position,
                    topic: clean_topic(topic),
                    permission_overwrites: overwrites,
                    permissions_synced,
                    user_limit: 0,
                    effective_permissions: None,
                };
                if kind.is_text_like() {
                    srv.text_channels.push(ch.clone());
                } else {
                    srv.voice_channels.push(ch.clone());
                }
                srv.sort_layout();
                Ok(ch)
            })();

            match created {
                Ok(new_channel) => {
                    if new_channel.kind.is_text_like() {
                        st.chat_history.entry(new_channel.id.clone()).or_default();
                    }
                    st.broadcast_to_server(
                        &target_srv_id,
                        ServerMessage::ChannelCreated {
                            server_id: target_srv_id.clone(),
                            channel: new_channel,
                        },
                    );
                    broadcast_server_update(&mut st, &target_srv_id);
                }
                Err(msg) => st.feedback(user_id, false, "create_channel", msg),
            }
        }

        ClientMessage::DeleteChannel {
            channel_id,
            server_id,
        } => {
            if channel_id == "geral" || channel_id == "voice-geral" {
                state.read().await.feedback(user_id, false, "delete_channel", "Este canal principal não pode ser excluído.");
                return;
            }
            let mut st = state.write().await;
            let target_srv_id = server_id.unwrap_or_else(|| {
                st.servers
                    .iter()
                    .find(|s| s.find_channel(&channel_id).is_some())
                    .map(|s| s.id.clone())
                    .unwrap_or_else(|| "sancord".to_string())
            });
            if require_manage_channels(&st, user_id, &target_srv_id, "delete_channel").is_none() {
                return;
            }
            let removed: Result<ChannelKind, &str> = (|| {
                let srv = st.find_server_mut(&target_srv_id).ok_or("Servidor não encontrado.")?;
                if let Some(pos) = srv.text_channels.iter().position(|c| c.id == channel_id) {
                    if srv.text_channels.len() <= 1 {
                        return Err("O servidor precisa ter pelo menos um canal de texto.");
                    }
                    Ok(srv.text_channels.remove(pos).kind)
                } else if let Some(pos) = srv.voice_channels.iter().position(|c| c.id == channel_id) {
                    Ok(srv.voice_channels.remove(pos).kind)
                } else {
                    Err("Canal não encontrado.")
                }
            })();

            match removed {
                Ok(kind) => {
                    if kind.is_text_like() {
                        st.delete_channel_history(&channel_id);
                    }
                    st.broadcast_to_server(
                        &target_srv_id,
                        ServerMessage::ChannelDeleted {
                            server_id: target_srv_id.clone(),
                            channel_id,
                            kind,
                        },
                    );
                    broadcast_server_update(&mut st, &target_srv_id);
                }
                Err(msg) => st.feedback(user_id, false, "delete_channel", msg),
            }
        }

        ClientMessage::RenameChannel {
            server_id,
            channel_id,
            name,
        } => {
            // Mantido por compatibilidade; equivale a UpdateChannel só com nome.
            let mut st = state.write().await;
            update_channel(&mut st, user_id, &server_id, &channel_id, Some(name), None, None, None);
        }

        ClientMessage::UpdateChannel {
            server_id,
            channel_id,
            name,
            topic,
            kind,
            user_limit,
        } => {
            let mut st = state.write().await;
            update_channel(&mut st, user_id, &server_id, &channel_id, name, topic, kind, user_limit);
        }

        ClientMessage::UpdateChannelPermissions { server_id, channel_id, overwrites, sync_category } => {
            let mut st = state.write().await;
            let Some(actor) = require_manage_channels(&st, user_id, &server_id, "channel_permissions") else { return; };
            let result: Result<(), &str> = (|| {
                let srv = st.find_server_mut(&server_id).ok_or("Servidor não encontrado.")?;
                srv.validate_overwrites(&actor, &overwrites)?;
                let ch = srv.find_channel_mut(&channel_id).ok_or("Canal não encontrado.")?;
                if sync_category && ch.category_id.is_none() { return Err("O canal não pertence a uma categoria."); }
                ch.permissions_synced = sync_category;
                ch.permission_overwrites = if sync_category { Vec::new() } else { overwrites };
                Ok(())
            })();
            match result {
                Ok(()) => broadcast_server_update(&mut st, &server_id),
                Err(reason) => st.feedback(user_id, false, "channel_permissions", reason),
            }
        }
        ClientMessage::UpdateCategoryPermissions { server_id, category_id, overwrites } => {
            let mut st = state.write().await;
            let Some(actor) = require_manage_channels(&st, user_id, &server_id, "category_permissions") else { return; };
            let result: Result<(), &str> = (|| {
                let srv = st.find_server_mut(&server_id).ok_or("Servidor não encontrado.")?;
                srv.validate_overwrites(&actor, &overwrites)?;
                let cat = srv.categories.iter_mut().find(|c| c.id == category_id).ok_or("Categoria não encontrada.")?;
                cat.permission_overwrites = overwrites;
                Ok(())
            })();
            match result {
                Ok(()) => broadcast_server_update(&mut st, &server_id),
                Err(reason) => st.feedback(user_id, false, "category_permissions", reason),
            }
        }
        ClientMessage::CreateCategory { server_id, name } => {
            let clean = clean_display_name(&name, 32);
            let mut st = state.write().await;
            if clean.is_empty() {
                st.feedback(user_id, false, "create_category", "Dê um nome para a categoria.");
                return;
            }
            if require_manage_channels(&st, user_id, &server_id, "create_category").is_none() {
                return;
            }
            let ok = st.find_server_mut(&server_id).is_some_and(|srv| {
                if srv.categories.len() >= MAX_CATEGORIES_PER_SERVER {
                    return false;
                }
                let position = srv.categories.iter().map(|c| c.position + 1).max().unwrap_or(0);
                srv.categories.push(Category {
                    id: format!("{}-cat-{}", server_id, &Uuid::new_v4().simple().to_string()[..8]),
                    name: clean,
                    position,
                    permission_overwrites: Vec::new(),
                });
                true
            });
            if ok {
                broadcast_server_update(&mut st, &server_id);
            } else {
                st.feedback(user_id, false, "create_category", "Este servidor atingiu o limite de categorias.");
            }
        }

        ClientMessage::UpdateCategory {
            server_id,
            category_id,
            name,
        } => {
            let clean = clean_display_name(&name, 32);
            let mut st = state.write().await;
            if clean.is_empty() || require_manage_channels(&st, user_id, &server_id, "update_category").is_none() {
                return;
            }
            let found = st
                .find_server_mut(&server_id)
                .and_then(|srv| srv.categories.iter_mut().find(|c| c.id == category_id))
                .map(|cat| cat.name = clean)
                .is_some();
            if found {
                broadcast_server_update(&mut st, &server_id);
            } else {
                st.feedback(user_id, false, "update_category", "Categoria não encontrada.");
            }
        }

        ClientMessage::DeleteCategory {
            server_id,
            category_id,
        } => {
            let mut st = state.write().await;
            if require_manage_channels(&st, user_id, &server_id, "delete_category").is_none() {
                return;
            }
            let found = st.find_server_mut(&server_id).is_some_and(|srv| {
                if srv.categories.iter().any(|c| c.id == category_id && !c.permission_overwrites.is_empty()) &&
                    srv.text_channels.iter().chain(&srv.voice_channels).any(|c| c.category_id.as_deref() == Some(category_id.as_str())) {
                    return false;
                }
                let Some(pos) = srv.categories.iter().position(|c| c.id == category_id) else {
                    return false;
                };
                srv.categories.remove(pos);
                // Canais da categoria passam para "sem categoria", depois dos que já estavam lá.
                let mut next = srv.next_position(None);
                for ch in srv.text_channels.iter_mut().chain(srv.voice_channels.iter_mut()) {
                    if ch.category_id.as_deref() == Some(category_id.as_str()) {
                        ch.category_id = None;
                        ch.position = next;
                        next += 1;
                    }
                }
                srv.sort_layout();
                true
            });
            if found {
                broadcast_server_update(&mut st, &server_id);
            } else {
                st.feedback(user_id, false, "delete_category", "Categoria não encontrada ou ainda possui canais com permissões herdadas. Mova os canais antes de excluir.");
            }
        }

        ClientMessage::ReorderServerLayout {
            server_id,
            categories,
            channels,
        } => {
            let mut st = state.write().await;
            if require_manage_channels(&st, user_id, &server_id, "reorder_layout").is_none() {
                return;
            }
            let changed = st.find_server_mut(&server_id).is_some_and(|srv| {
                // Categorias: posição = índice na lista; as omitidas vão para o fim.
                let mut pos = 0;
                for cid in categories.iter().take(MAX_CATEGORIES_PER_SERVER) {
                    if let Some(cat) = srv.categories.iter_mut().find(|c| &c.id == cid) {
                        cat.position = pos;
                        pos += 1;
                    }
                }
                for cat in srv.categories.iter_mut() {
                    if !categories.contains(&cat.id) {
                        cat.position = pos;
                        pos += 1;
                    }
                }
                // Canais: posição sequencial dentro de cada categoria, na ordem recebida.
                let valid_cats: HashSet<String> = srv.categories.iter().map(|c| c.id.clone()).collect();
                let mut counters: HashMap<Option<String>, i32> = HashMap::new();
                for placement in channels.iter().take(MAX_CHANNELS_PER_SERVER) {
                    let cat = placement.category_id.clone().filter(|c| valid_cats.contains(c));
                    if let Some(ch) = srv.find_channel_mut(&placement.id) {
                        let counter = counters.entry(cat.clone()).or_insert(0);
                        ch.category_id = cat;
                        ch.position = *counter;
                        *counter += 1;
                    }
                }
                srv.sort_layout();
                true
            });
            if changed {
                broadcast_server_update(&mut st, &server_id);
            }
        }

        ClientMessage::CreateInvite {
            server_id,
            max_age_secs,
            max_uses,
        } => {
            let mut st = state.write().await;
            let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
                return;
            };
            let allowed = st
                .find_server(&server_id)
                .is_some_and(|s| s.is_member(&me_lower) && s.effective_permissions(&me_lower).create_invites);
            if !allowed {
                st.feedback(user_id, false, "create_invite", "Você não tem permissão para criar convites neste servidor.");
                return;
            }
            if st.invites.values().filter(|i| i.server_id == server_id).count() >= MAX_INVITES_PER_SERVER {
                st.server_invites(&server_id); // limpa vencidos
                if st.invites.values().filter(|i| i.server_id == server_id).count() >= MAX_INVITES_PER_SERVER {
                    st.feedback(user_id, false, "create_invite", "Limite de convites ativos atingido. Revogue alguns antes.");
                    return;
                }
            }
            let invite = st.create_invite(&server_id, &me_lower, max_age_secs, max_uses);
            let info = st.invite_info(&invite);
            st.send_to(user_id, ServerMessage::InviteCreated { invite: info });
        }

        ClientMessage::ListInvites { server_id } => {
            let mut st = state.write().await;
            if !can_manage_server(&st, user_id, &server_id) {
                st.feedback(user_id, false, "list_invites", "Você não tem permissão para ver os convites deste servidor.");
                return;
            }
            let invites = st.server_invites(&server_id);
            st.send_to(user_id, ServerMessage::InvitesList { server_id, invites });
        }

        ClientMessage::RevokeInvite { server_id, code } => {
            let mut st = state.write().await;
            let code_up = code.trim().to_uppercase();
            let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
                return;
            };
            let Some(invite) = st.invites.get(&code_up).cloned().filter(|i| i.server_id == server_id) else {
                st.feedback(user_id, false, "revoke_invite", "Convite não encontrado.");
                return;
            };
            if !(can_manage_server(&st, user_id, &server_id) || invite.creator == me_lower) {
                st.feedback(user_id, false, "revoke_invite", "Você não pode revogar este convite.");
                return;
            }
            if st
                .find_server(&server_id)
                .is_some_and(|s| s.invite_code.eq_ignore_ascii_case(&code_up))
            {
                st.feedback(
                    user_id,
                    false,
                    "revoke_invite",
                    "Este é o convite padrão do servidor. Use \"Gerar novo código\" para trocá-lo.",
                );
                return;
            }
            st.remove_invite(&code_up);
            st.feedback(user_id, true, "revoke_invite", "Convite revogado.");
            if can_manage_server(&st, user_id, &server_id) {
                let invites = st.server_invites(&server_id);
                st.send_to(user_id, ServerMessage::InvitesList { server_id, invites });
            }
        }

        ClientMessage::UpdateUserPrefs {
            guild_layout,
            muted_servers,
            collapsed_categories,
            privacy,
        } => {
            let mut st = state.write().await;
            let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
                return;
            };
            let Some(account_id) = st.accounts.get(&me_lower).map(|a| a.id.clone()) else {
                return;
            };
            let mut prefs = st.prefs_for(&account_id, &me_lower);
            if let Some(layout) = guild_layout {
                prefs.guild_layout = layout;
            }
            if let Some(muted) = muted_servers {
                let mut seen = HashSet::new();
                prefs.muted_servers = muted.into_iter().filter(|s| seen.insert(s.clone())).take(500).collect();
            }
            if let Some(collapsed) = collapsed_categories {
                let mut seen = HashSet::new();
                prefs.collapsed_categories = collapsed
                    .into_iter()
                    .filter(|s| s.len() <= 80 && seen.insert(s.clone()))
                    .take(1000)
                    .collect();
            }
            if let Some(p) = privacy {
                prefs.privacy = p.sanitized();
            }
            st.set_prefs(&account_id, prefs);
            // Revalida (remove servidores que não são do usuário) e sincroniza todas as abas.
            let clean = st.prefs_for(&account_id, &me_lower);
            st.set_prefs(&account_id, clean.clone());
            send_to_username(&st, &me_lower, ServerMessage::UserPrefsUpdated { prefs: clean });
        }

        ClientMessage::SendFriendRequest { target_username } => {
            let trimmed = target_username.trim();
            let target_lower = trimmed.to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            if target_lower.is_empty() {
                st.send_to(
                    user_id,
                    ServerMessage::FriendFeedback {
                        ok: false,
                        message: "Digite o nome de usuário do seu amigo.".to_string(),
                    },
                );
                return;
            }

            if target_lower == me_lower {
                st.send_to(
                    user_id,
                    ServerMessage::FriendFeedback {
                        ok: false,
                        message: "Você não pode adicionar a si mesmo como amigo.".to_string(),
                    },
                );
                return;
            }

            if !st.target_exists(&target_lower) {
                st.send_to(
                    user_id,
                    ServerMessage::FriendFeedback {
                        ok: false,
                        message: format!(
                            "Não encontramos '{}' no Sancord. Confira o nome exato (ele precisa já ter criado conta ou estar online).",
                            trimmed
                        ),
                    },
                );
                return;
            }

            // Bloqueio e privacidade de quem recebe (se ele já me pediu, vale aceitar).
            let they_requested = st
                .friends_store
                .incoming_requests
                .get(&me_lower)
                .is_some_and(|v| v.contains(&target_lower));
            if !they_requested {
                if let Err(msg) = st.friend_request_allowed(&me_lower, &target_lower) {
                    st.send_to(user_id, ServerMessage::FriendFeedback { ok: false, message: msg.to_string() });
                    return;
                }
            }

            let target_display = st
                .resolve_friend_info(&target_lower)
                .map(|f| f.username)
                .unwrap_or_else(|| trimmed.to_string());

            if st
                .friends_store
                .friends
                .get(&me_lower)
                .map(|v| v.contains(&target_lower))
                .unwrap_or(false)
            {
                st.send_to(
                    user_id,
                    ServerMessage::FriendFeedback {
                        ok: false,
                        message: format!("Você e {} já são amigos!", target_display),
                    },
                );
                return;
            }

            // Se a outra pessoa já havia enviado um pedido, aceita automaticamente!
            let already_incoming = st
                .friends_store
                .incoming_requests
                .get(&me_lower)
                .map(|v| v.contains(&target_lower))
                .unwrap_or(false);

            if already_incoming {
                if let Some(list) = st.friends_store.incoming_requests.get_mut(&me_lower) {
                    list.retain(|x| x != &target_lower);
                }
                if let Some(list) = st.friends_store.outgoing_requests.get_mut(&target_lower) {
                    list.retain(|x| x != &me_lower);
                }
                let my_f = st.friends_store.friends.entry(me_lower.clone()).or_default();
                if !my_f.contains(&target_lower) {
                    my_f.push(target_lower.clone());
                }
                let their_f = st.friends_store.friends.entry(target_lower.clone()).or_default();
                if !their_f.contains(&me_lower) {
                    their_f.push(me_lower.clone());
                }
                st.save_friends();
                st.send_to(
                    user_id,
                    ServerMessage::FriendFeedback {
                        ok: true,
                        message: format!("{} também havia te adicionado! Vocês agora são amigos.", target_display),
                    },
                );
                st.send_friends_sync_to_username(&me_lower);
                st.send_friends_sync_to_username(&target_lower);
                return;
            }

            if st
                .friends_store
                .outgoing_requests
                .get(&me_lower)
                .map(|v| v.contains(&target_lower))
                .unwrap_or(false)
            {
                st.send_to(
                    user_id,
                    ServerMessage::FriendFeedback {
                        ok: false,
                        message: format!("Você já enviou um pedido de amizade para {}.", target_display),
                    },
                );
                return;
            }

            st.friends_store
                .outgoing_requests
                .entry(me_lower.clone())
                .or_default()
                .push(target_lower.clone());
            st.friends_store
                .incoming_requests
                .entry(target_lower.clone())
                .or_default()
                .push(me_lower.clone());
            st.save_friends();

            st.send_to(
                user_id,
                ServerMessage::FriendFeedback {
                    ok: true,
                    message: format!("Sucesso! Pedido de amizade enviado para {}.", target_display),
                },
            );
            st.send_friends_sync_to_username(&me_lower);
            st.send_friends_sync_to_username(&target_lower);
        }

        ClientMessage::RespondFriendRequest {
            from_username,
            accept,
        } => {
            let from_lower = from_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            if let Some(list) = st.friends_store.incoming_requests.get_mut(&me_lower) {
                list.retain(|x| x != &from_lower);
            }
            if let Some(list) = st.friends_store.outgoing_requests.get_mut(&from_lower) {
                list.retain(|x| x != &me_lower);
            }

            if accept && !from_lower.is_empty() && from_lower != me_lower {
                let my_f = st.friends_store.friends.entry(me_lower.clone()).or_default();
                if !my_f.contains(&from_lower) {
                    my_f.push(from_lower.clone());
                }
                let their_f = st.friends_store.friends.entry(from_lower.clone()).or_default();
                if !their_f.contains(&me_lower) {
                    their_f.push(me_lower.clone());
                }
                // Agora são amigos: uma solicitação de mensagem pendente vira DM normal.
                let dm_id = ServerState::make_dm_id(&me_lower, &from_lower);
                for p in [&me_lower, &from_lower] {
                    crate::models::FriendsStore::remove_from(&mut st.friends_store.ignored_dms, p, &dm_id);
                    if st.friends_store.is_request(p, &dm_id) {
                        crate::models::FriendsStore::remove_from(&mut st.friends_store.dm_requests, p, &dm_id);
                        crate::models::FriendsStore::push_unique(&mut st.friends_store.open_dms, p, &dm_id);
                    }
                }
            }

            st.save_friends();
            st.send_friends_sync_to_username(&me_lower);
            st.send_friends_sync_to_username(&from_lower);
        }

        ClientMessage::CancelFriendRequest { target_username } => {
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            if let Some(list) = st.friends_store.outgoing_requests.get_mut(&me_lower) {
                list.retain(|x| x != &target_lower);
            }
            if let Some(list) = st.friends_store.incoming_requests.get_mut(&target_lower) {
                list.retain(|x| x != &me_lower);
            }

            st.save_friends();
            st.send_friends_sync_to_username(&me_lower);
            st.send_friends_sync_to_username(&target_lower);
        }

        ClientMessage::RemoveFriend { target_username } => {
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            if let Some(list) = st.friends_store.friends.get_mut(&me_lower) {
                list.retain(|x| x != &target_lower);
            }
            if let Some(list) = st.friends_store.friends.get_mut(&target_lower) {
                list.retain(|x| x != &me_lower);
            }

            st.save_friends();
            st.send_friends_sync_to_username(&me_lower);
            st.send_friends_sync_to_username(&target_lower);
        }

        ClientMessage::OpenDm { target_username } => {
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();
            if target_lower.is_empty() || target_lower == me_lower || !st.target_exists(&target_lower)
            {
                return;
            }
            if st.friends_store.has_blocked(&target_lower, &me_lower) {
                st.send_to(user_id, ServerMessage::FriendFeedback { ok: false, message: "Não é possível abrir conversa com este usuário.".into() });
                return;
            }

            let dm_id = ServerState::make_dm_id(&me_lower, &target_lower);
            // Abrir uma conversa ignorada a traz de volta (como solicitação, se ainda for uma).
            crate::models::FriendsStore::remove_from(&mut st.friends_store.ignored_dms, &me_lower, &dm_id);
            let open_list = st.friends_store.open_dms.entry(me_lower.clone()).or_default();
            if !open_list.contains(&dm_id) {
                open_list.push(dm_id.clone());
            }
            st.save_friends();

            let Some(peer) = st.resolve_friend_info(&target_lower) else {
                return;
            };
            let messages = st.chat_history.get(&dm_id).cloned().unwrap_or_default();

            st.send_to(
                user_id,
                ServerMessage::DmOpened {
                    dm_id,
                    peer,
                    messages,
                },
            );
            st.send_friends_sync_to_username(&me_lower);
        }

        m @ (ClientMessage::BlockUser { .. }
        | ClientMessage::UnblockUser { .. }
        | ClientMessage::AcceptMessageRequest { .. }
        | ClientMessage::IgnoreMessageRequest { .. }
        | ClientMessage::CreateGroupDm { .. }
        | ClientMessage::UpdateGroupDm { .. }
        | ClientMessage::AddGroupDmMembers { .. }
        | ClientMessage::RemoveGroupDmMember { .. }
        | ClientMessage::LeaveGroupDm { .. }
        | ClientMessage::GetUserProfile { .. }
        | ClientMessage::ReportUser { .. }) => crate::social::handle(user_id, m, state).await,

        ClientMessage::JoinVoice { channel_id } => {
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let is_public_voice = st.has_public_voice_channel(&channel_id);
            let is_dm_voice = (channel_id.starts_with("dmvoice:") || channel_id.starts_with("gdmvoice:"))
                && st.can_join_voice(&me_lower, &channel_id);
            if !is_public_voice && !is_dm_voice {
                st.feedback(user_id, false, "join_voice", "Não é possível entrar nesta chamada.");
                return;
            }
            if is_public_voice {
                let allowed = st
                    .servers
                    .iter()
                    .find(|s| s.voice_channels.iter().any(|c| c.id == channel_id))
                    .map(|s| s.channel_permissions(&me_lower, &channel_id).view_channel && s.channel_permissions(&me_lower, &channel_id).connect_voice)
                    .unwrap_or(false);
                if !allowed {
                    st.send_to(
                        user_id,
                        ServerMessage::ServerFeedback {
                            ok: false,
                            message: "Você não tem permissão para entrar neste canal de voz.".to_string(),
                            action: Some("join_voice".to_string()),
                        },
                    );
                    return;
                }
            }

            if let Err(msg) = crate::voice::check_user_limit(&st, user_id, &me_lower, &channel_id)
                .and_then(|_| crate::voice::check_private_call(&st, &me_lower, &channel_id))
            {
                st.feedback(user_id, false, "join_voice", msg);
                return;
            }

            let Some(peer_info) = crate::voice::place_in_voice(&mut st, user_id, &channel_id) else {
                return;
            };
            info!("Usuário {} entrou no canal de voz {}", peer_info.username, channel_id);

            if is_dm_voice {
                // Toca para os outros participantes (DM 1:1 ou grupo) que ainda não estão na chamada.
                let conversation_id = crate::voice::conversation_of(&channel_id).unwrap_or_default();
                let others: Vec<String> = st
                    .private_participants(&channel_id)
                    .into_iter()
                    .filter(|p| *p != me_lower)
                    .collect();
                let ring = ServerMessage::DmCallIncoming {
                    dm_id: conversation_id,
                    voice_channel_id: channel_id.clone(),
                    from_username: peer_info.username.clone(),
                    from_color: peer_info.avatar_color.clone(),
                    from_avatar: peer_info.avatar_url.clone(),
                };
                for (uid, u) in &st.users {
                    let lower = u.username.to_lowercase();
                    if others.contains(&lower)
                        && u.voice_channel_id.as_deref() != Some(&channel_id)
                        && !st.friends_store.blocked_either(&lower, &me_lower)
                    {
                        st.send_to(uid, ring.clone());
                    }
                }
                st.broadcast_friends_sync_all();
            }
        }
        ClientMessage::LeaveVoice => {
            let mut st = state.write().await;
            if let Some(channel_id) = crate::voice::remove_from_voice(&mut st, user_id) {
                if crate::voice::is_private_voice(&channel_id) {
                    st.broadcast_friends_sync_all();
                }
            }
        }

        ClientMessage::ModerateVoice { server_id, target_username, action, channel_id } => {
            let mut st = state.write().await;
            match crate::voice::moderate(&mut st, user_id, &server_id, &target_username, &action, channel_id) {
                Ok(msg) => st.feedback(user_id, true, "moderate_voice", msg),
                Err(msg) => st.feedback(user_id, false, "moderate_voice", msg),
            }
        }

        ClientMessage::DeclineCall { channel_id } => {
            let st = state.read().await;
            crate::voice::decline_call(&st, user_id, &channel_id);
        }
        ClientMessage::UpdateVoiceState {
            muted,
            deafened,
            screen_sharing,
            camera_on,
            stream_quality,
            camera_stream_id,
            screen_stream_id,
        } => {
            let mut st = state.write().await;
            let (can_speak, can_stream) = st.voice_media_permissions(user_id);
            if (camera_on || screen_sharing) && !can_stream {
                st.feedback(user_id, false, "voice_state", "Você não tem permissão para transmitir neste canal.");
                return;
            }
            if let Some(user) = st.users.get_mut(user_id) {
                // Ensurdecer implica silenciar o próprio microfone.
                user.muted = muted || deafened || !can_speak;
                user.deafened = deafened;
                user.screen_sharing = screen_sharing;
                user.camera_on = camera_on;
                user.stream_quality = if screen_sharing { stream_quality } else { None };
                user.camera_stream_id = if camera_on { camera_stream_id } else { None };
                user.screen_stream_id = if screen_sharing { screen_stream_id } else { None };
            }

            let sync_msg = ServerMessage::VoiceStateSync {
                voice_members: st.voice_members_map(),
                users: st.users_list(),
            };
            st.broadcast(sync_msg);
        }

        ClientMessage::WebRtcOffer { target_id, sdp } => {
            let st = state.read().await;
            if !st.can_signal_peer(user_id, &target_id) || !st.can_signal_sdp(user_id, &sdp) { return; }
            st.send_to(
                &target_id,
                ServerMessage::WebRtcOffer {
                    from_id: user_id.to_string(),
                    sdp,
                },
            );
        }

        ClientMessage::WebRtcAnswer { target_id, sdp } => {
            let st = state.read().await;
            if !st.can_signal_peer(user_id, &target_id) || !st.can_signal_sdp(user_id, &sdp) { return; }
            st.send_to(
                &target_id,
                ServerMessage::WebRtcAnswer {
                    from_id: user_id.to_string(),
                    sdp,
                },
            );
        }

        ClientMessage::WebRtcIceCandidate {
            target_id,
            candidate,
        } => {
            let st = state.read().await;
            if !st.can_signal_peer(user_id, &target_id) { return; }
            st.send_to(
                &target_id,
                ServerMessage::WebRtcIceCandidate {
                    from_id: user_id.to_string(),
                    candidate,
                },
            );
        }

        ClientMessage::CreateServer {
            name,
            description,
            icon_url,
            icon_color,
            template,
            is_community,
        } => {
            let clean_name = clean_display_name(&name, 40);
            if clean_name.chars().count() < 2 {
                state.read().await.feedback(user_id, false, "create_server", "Escolha um nome com pelo menos 2 caracteres.");
                return;
            }
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();
            let srv_id = format!("srv-{}", &Uuid::new_v4().simple().to_string()[..8]);

            let (categories, text_channels, voice_channels) = server_template(template.as_deref(), &srv_id);

            let everyone_role = ServerRole {
                id: "everyone".into(),
                name: "@everyone".into(),
                color: "#b5bac1".into(),
                position: 0,
                hoist: false,
                mentionable: false,
                badge_emoji: None,
                permissions: RolePermissions::default(),
            };
            let mod_role = ServerRole {
                id: format!("role-mod-{}", &Uuid::new_v4().simple().to_string()[..6]),
                name: "Moderador".into(),
                color: "#00B0F4".into(),
                position: 5,
                hoist: true,
                mentionable: true,
                badge_emoji: Some("🛡️".into()),
                permissions: RolePermissions {
                    kick_members: true,
                    manage_messages: true,
                    manage_channels: true,
                    mention_everyone: true,
                    ..RolePermissions::default()
                },
            };
            let owner_role_id = format!("role-owner-{}", &Uuid::new_v4().simple().to_string()[..6]);
            let owner_role = ServerRole {
                id: owner_role_id.clone(),
                name: "Fundador".into(),
                color: "#FEE75C".into(),
                position: 10,
                hoist: true,
                mentionable: true,
                badge_emoji: Some("👑".into()),
                permissions: RolePermissions::all_admin(),
            };

            let mut member_roles = HashMap::new();
            member_roles.insert(me_lower.clone(), vec![owner_role_id]);

            let valid_icon = icon_url.filter(|u| validate_image_data_url(u, MAX_PROFILE_IMAGE_BYTES).is_ok());
            let now = crate::auth::now_ms();
            let srv = GuildServer {
                id: srv_id.clone(),
                name: clean_name.clone(),
                description: description.map(|d| d.trim().chars().take(180).collect()).filter(|d: &String| !d.is_empty()),
                icon_url: valid_icon,
                icon_color: icon_color.filter(|c| is_hex_color(c)).unwrap_or_else(|| ServerState::pick_avatar_color(&clean_name)),
                banner_url: None,
                owner_username: me_lower.clone(),
                invite_code: st.generate_invite_code(),
                text_channels: text_channels.clone(),
                voice_channels,
                roles: vec![everyone_role, mod_role, owner_role],
                member_roles,
                members: vec![me_lower.clone()],
                banned_usernames: Vec::new(),
                categories,
                is_community,
                created_at: now,
                member_joined_at: HashMap::from([(me_lower.clone(), now)]),
                voice_moderation: HashMap::new(),
            };

            // Mensagem de boas-vindas no primeiro canal de texto comum (não no de anúncios).
            let first_ch_id = text_channels
                .iter()
                .find(|c| c.kind == ChannelKind::Text)
                .unwrap_or(&text_channels[0])
                .id
                .clone();
            let welcome_msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                channel_id: first_ch_id.clone(),
                author_id: "system".into(),
                author_name: "Sancord Bot".into(),
                author_color: "#5865F2".into(),
                author_avatar: Some("/logo.png".into()),
                content: format!(
                    "🎉 Bem-vindo ao servidor **{}**, criado por **{}**! Use o código `{}` ou o botão **Convidar** para chamar amigos.",
                    srv.name, me.username, srv.invite_code
                ),
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
            };

            for ch in &text_channels {
                st.chat_history.entry(ch.id.clone()).or_default();
            }
            let _ = first_ch_id;
            st.insert_message(welcome_msg);
            st.servers.push(srv.clone());
            st.save_servers();
            // Convite padrão permanente (gravado depois do servidor por causa da chave estrangeira).
            st.register_invite(Invite {
                code: srv.invite_code.clone(),
                server_id: srv.id.clone(),
                creator: me_lower.clone(),
                created_at: now,
                expires_at: None,
                max_uses: None,
                uses: 0,
            });

            let history = st.public_chat_history_for(&me_lower);
            st.send_to(user_id, ServerMessage::ServerCreated { server: srv, history });
            st.send_servers_sync_to_username(&me_lower);
        }

        ClientMessage::JoinServerByInvite { invite_code } => {
            let mut st = state.write().await;
            let Some(me_lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else {
                return;
            };
            let (invite, srv_id) = match st.resolve_invite(&invite_code) {
                Ok((inv, srv)) => {
                    if srv.is_banned(&me_lower) {
                        st.feedback(user_id, false, "join_invite", "Você foi banido deste servidor e não pode entrar novamente.");
                        return;
                    }
                    let sid = srv.id.clone();
                    (inv, sid)
                }
                Err(msg) => {
                    st.feedback(user_id, false, "join_invite", msg);
                    return;
                }
            };

            let now = crate::auth::now_ms();
            let joined_now = st.find_server_mut(&srv_id).is_some_and(|srv| {
                if srv.is_member(&me_lower) {
                    return false;
                }
                srv.members.push(me_lower.clone());
                srv.member_joined_at.insert(me_lower.clone(), now);
                true
            });
            if joined_now {
                // Só conta uso quando alguém realmente entrou.
                let mut used = invite;
                used.uses += 1;
                st.register_invite(used);
                st.save_servers();
            }

            let Some(srv) = st.find_server(&srv_id).cloned() else {
                return;
            };
            let history = st.public_chat_history_for(&me_lower);
            st.send_to(user_id, ServerMessage::ServerCreated { server: srv.clone(), history });
            st.send_servers_sync_to_username(&me_lower);
            st.broadcast_to_server(&srv_id, ServerMessage::ServerUpdated { server: srv });
        }

        ClientMessage::LeaveServer { server_id } => {
            if server_id == "sancord" {
                return;
            }
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let updated = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                if srv.is_owner(&me_lower) {
                    st.send_to(
                        user_id,
                        ServerMessage::ServerFeedback {
                            ok: false,
                            message: "O fundador não pode sair do próprio servidor — use 'Excluir Servidor' nas configurações.".to_string(),
                            action: Some("leave_server".to_string()),
                        },
                    );
                    return;
                }
                srv.members.retain(|m| m != &me_lower);
                srv.member_roles.remove(&me_lower);
                srv.member_joined_at.remove(&me_lower);
                srv.clone()
            };
            st.save_servers();
            st.send_to(
                user_id,
                ServerMessage::ServerRemoved {
                    server_id: server_id.clone(),
                    reason: None,
                },
            );
            st.send_servers_sync_to_username(&me_lower);
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated });
        }

        ClientMessage::UpdateServer {
            server_id,
            name,
            description,
            icon_url,
            banner_url,
            icon_color,
            regenerate_invite,
            is_community,
        } => {
            let clean_name = clean_display_name(&name, 40);
            if clean_name.chars().count() < 2 {
                state.read().await.feedback(user_id, false, "update_server", "O nome precisa ter pelo menos 2 caracteres.");
                return;
            }
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let updated_srv = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                let perms = srv.effective_permissions(&me_lower);
                if !srv.is_owner(&me_lower) && !perms.manage_server && !perms.administrator {
                    st.send_to(
                        user_id,
                        ServerMessage::ServerFeedback {
                            ok: false,
                            message: "Apenas o criador ou administradores autorizados podem editar este servidor.".to_string(),
                            action: Some("update_server".to_string()),
                        },
                    );
                    return;
                }

                srv.name = clean_name;
                srv.description = description
                    .map(|d| d.trim().chars().take(180).collect())
                    .filter(|d: &String| !d.is_empty());
                if let Some(ic) = icon_url {
                    if ic.is_empty() {
                        srv.icon_url = None;
                    } else if validate_image_or_local_path(&ic, MAX_PROFILE_IMAGE_BYTES).is_ok() {
                        srv.icon_url = Some(ic);
                    }
                }
                if let Some(bn) = banner_url {
                    if bn.is_empty() {
                        srv.banner_url = None;
                    } else if validate_image_data_url(&bn, MAX_PROFILE_IMAGE_BYTES).is_ok() {
                        srv.banner_url = Some(bn);
                    }
                }
                if let Some(col) = icon_color {
                    if is_hex_color(&col) {
                        srv.icon_color = col;
                    }
                }
                if let Some(c) = is_community {
                    srv.is_community = c;
                }
                srv.clone()
            };

            if regenerate_invite {
                // Troca o convite padrão: o antigo deixa de funcionar.
                let old = updated_srv.invite_code.clone();
                let new_code = st.generate_invite_code();
                if let Some(srv) = st.find_server_mut(&server_id) {
                    srv.invite_code = new_code.clone();
                }
                st.save_servers();
                st.remove_invite(&old);
                st.register_invite(Invite {
                    code: new_code,
                    server_id: server_id.clone(),
                    creator: me_lower.clone(),
                    created_at: crate::auth::now_ms(),
                    expires_at: None,
                    max_uses: None,
                    uses: 0,
                });
            }
            let updated_srv = st.find_server(&server_id).cloned().unwrap_or(updated_srv);

            st.save_servers();
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
            st.send_to(
                user_id,
                ServerMessage::ServerFeedback {
                    ok: true,
                    message: "Configurações do servidor salvas!".to_string(),
                    action: Some("update_server".to_string()),
                },
            );
        }

        ClientMessage::DeleteServer { server_id } => {
            if server_id == "sancord" {
                return;
            }
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let Some(pos) = st.servers.iter().position(|s| s.id == server_id) else {
                return;
            };
            if !st.servers[pos].is_owner(&me_lower) {
                st.send_to(
                    user_id,
                    ServerMessage::ServerFeedback {
                        ok: false,
                        message: "Somente o criador original pode excluir o servidor.".to_string(),
                        action: Some("delete_server".to_string()),
                    },
                );
                return;
            }

            let removed_srv = st.servers.remove(pos);
            for ch in &removed_srv.text_channels {
                st.delete_channel_history(&ch.id);
            }
            // No banco os convites saem por cascata; aqui limpamos o cache.
            st.invites.retain(|_, inv| inv.server_id != server_id);
            st.save_servers();

            let notify_targets: Vec<String> = st
                .users
                .iter()
                .filter(|(_, u)| removed_srv.is_member(&u.username.to_lowercase()))
                .map(|(uid, _)| uid.clone())
                .collect();
            for uid in notify_targets {
                st.send_to(
                    &uid,
                    ServerMessage::ServerRemoved {
                        server_id: server_id.clone(),
                        reason: Some(format!("O servidor '{}' foi excluído pelo criador.", removed_srv.name)),
                    },
                );
            }
        }

        ClientMessage::InviteFriendToServer {
            server_id,
            target_username,
        } => {
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();
            if target_lower.is_empty() || target_lower == me_lower || !st.target_exists(&target_lower) {
                return;
            }

            let Some(srv) = st.find_server(&server_id).cloned() else {
                return;
            };
            if !srv.is_member(&me_lower) || !srv.effective_permissions(&me_lower).create_invites {
                return;
            }

            let dm_id = ServerState::make_dm_id(&me_lower, &target_lower);
            for p in [&me_lower, &target_lower] {
                let list = st.friends_store.open_dms.entry(p.clone()).or_default();
                if !list.contains(&dm_id) {
                    list.push(dm_id.clone());
                }
            }
            st.save_friends();

            let invite_msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                channel_id: dm_id.clone(),
                author_id: me.id.clone(),
                author_name: me.username.clone(),
                author_color: me.avatar_color.clone(),
                author_avatar: me.avatar_url.clone(),
                content: format!(
                    "🎟️ Convite para entrar no servidor **{}** [[INVITE:{}:{}]]",
                    srv.name, srv.invite_code, srv.name
                ),
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
            };

            st.insert_message(invite_msg.clone());

            st.send_to_dm_participants(&dm_id, ServerMessage::NewChatMessage { message: invite_msg });
            st.send_friends_sync_to_username(&me_lower);
            st.send_friends_sync_to_username(&target_lower);
            st.send_to(
                user_id,
                ServerMessage::ServerFeedback {
                    ok: true,
                    message: format!("Convite enviado na DM de {}!", target_username),
                    action: Some("invite_dm".to_string()),
                },
            );
        }

        ClientMessage::CreateRole {
            server_id,
            name,
            color,
            hoist,
            mentionable,
            badge_emoji,
            permissions,
        } => {
            let clean_name: String = name.trim().chars().take(32).collect();
            if clean_name.is_empty() {
                return;
            }
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let updated_srv = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                if let Err(reason) = srv.authorize_grants(&me_lower, &RolePermissions::none(), &permissions) {
                    let reason = reason.to_string();
                    st.feedback(user_id, false, "create_role", reason);
                    return;
                }
                if srv.roles.len() >= 250 {
                    st.feedback(user_id, false, "create_role", "Este servidor atingiu o limite de 250 cargos.");
                    return;
                }
                let max_pos = srv.roles.iter().map(|r| r.position).max().unwrap_or(0);
                let role_pos = if srv.is_owner(&me_lower) {
                    max_pos.saturating_add(1)
                } else {
                    srv.highest_position(&me_lower) - 1
                };
                if !(1..=1_000_000).contains(&role_pos) {
                    st.feedback(user_id, false, "create_role", "Não há posição disponível abaixo do seu cargo.");
                    return;
                }
                let new_role = ServerRole {
                    id: format!("role-{}", &Uuid::new_v4().simple().to_string()[..8]),
                    name: clean_name,
                    color: if is_hex_color(&color) { color } else { "#5865F2".into() },
                    position: role_pos,
                    hoist,
                    mentionable,
                    badge_emoji: badge_emoji.map(|b| b.trim().chars().take(6).collect()).filter(|b: &String| !b.is_empty()),
                    permissions,
                };
                srv.roles.push(new_role);
                srv.clone()
            };
            st.save_servers();
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
        }

        ClientMessage::UpdateRole {
            server_id,
            role_id,
            name,
            color,
            position,
            hoist,
            mentionable,
            badge_emoji,
            permissions,
        } => {
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let updated_srv = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                let authorization = srv.authorize_role(&me_lower, &role_id, Some(position)).and_then(|_| {
                    let before = &srv.roles.iter().find(|r| r.id == role_id).ok_or("Cargo não encontrado.")?.permissions;
                    srv.authorize_grants(&me_lower, before, &permissions)
                });
                if let Err(reason) = authorization {
                    st.feedback(user_id, false, "update_role", reason);
                    return;
                }
                let Some(role) = srv.roles.iter_mut().find(|r| r.id == role_id) else {
                    return;
                };
                if role.id != "everyone" {
                    let clean_name: String = name.trim().chars().take(32).collect();
                    if !clean_name.is_empty() {
                        role.name = clean_name;
                    }
                    if is_hex_color(&color) {
                        role.color = color;
                    }
                    role.position = position.max(1);
                    role.hoist = hoist;
                    role.mentionable = mentionable;
                    role.badge_emoji = badge_emoji
                        .map(|b| b.trim().chars().take(6).collect())
                        .filter(|b: &String| !b.is_empty());
                }
                role.permissions = permissions;
                srv.clone()
            };
            st.save_servers();
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
        }

        ClientMessage::DeleteRole { server_id, role_id } => {
            if role_id == "everyone" {
                return;
            }
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let updated_srv = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                if let Err(reason) = srv.authorize_role(&me_lower, &role_id, None) {
                    st.feedback(user_id, false, "delete_role", reason);
                    return;
                }
                let Some(pos) = srv.roles.iter().position(|r| r.id == role_id) else {
                    return;
                };
                srv.roles.remove(pos);
                for rules in srv.categories.iter_mut().map(|c| &mut c.permission_overwrites)
                    .chain(srv.text_channels.iter_mut().chain(&mut srv.voice_channels).map(|c| &mut c.permission_overwrites)) {
                    rules.retain(|r| r.target_type != crate::permissions::OverwriteTarget::Role || r.target_id != role_id);
                }
                for list in srv.member_roles.values_mut() {
                    list.retain(|r| r != &role_id);
                }
                srv.clone()
            };
            st.save_servers();
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
        }

        ClientMessage::ReorderRoles { server_id, role_ids } => {
            let mut st = state.write().await;
            let Some(actor) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return; };
            let result: Result<(), &str> = (|| {
                let srv = st.find_server_mut(&server_id).ok_or("Servidor não encontrado.")?;
                srv.require_role_manager(&actor)?;
                let all: HashSet<String> = srv.roles.iter().filter(|r| r.id != "everyone").map(|r| r.id.clone()).collect();
                if role_ids.len() != all.len() || role_ids.iter().collect::<HashSet<_>>().len() != role_ids.len() || role_ids.iter().any(|id| !all.contains(id)) {
                    return Err("A ordem deve conter todos os cargos uma única vez, sem o cargo de todos.");
                }
                let high = srv.highest_position(&actor);
                if !srv.is_owner(&actor) {
                    if high <= 0 { return Err("Você não possui hierarquia para reordenar cargos."); }
                    let protected: HashSet<_> = srv.roles.iter().filter(|r| r.id != "everyone" && r.position >= high).map(|r| r.id.clone()).collect();
                    let mut current: Vec<_> = srv.roles.iter().filter(|r| protected.contains(&r.id)).collect();
                    current.sort_by_key(|r| std::cmp::Reverse(r.position));
                    let expected: Vec<_> = current.iter().map(|r| r.id.clone()).collect();
                    if role_ids[..protected.len()] != expected { return Err("Você só pode reordenar cargos abaixo da sua hierarquia."); }
                    if role_ids.len() - protected.len() >= high as usize { return Err("Não há posições disponíveis abaixo do seu cargo."); }
                    let low_count = role_ids.len() - protected.len();
                    for (i, id) in role_ids.iter().skip(protected.len()).enumerate() {
                        if let Some(role) = srv.roles.iter_mut().find(|r| &r.id == id) { role.position = (low_count - i) as i32; }
                    }
                } else {
                    for (i, id) in role_ids.iter().enumerate() {
                        if let Some(role) = srv.roles.iter_mut().find(|r| &r.id == id) { role.position = (role_ids.len() - i) as i32; }
                    }
                }
                Ok(())
            })();
            match result {
                Ok(()) => broadcast_server_update(&mut st, &server_id),
                Err(reason) => st.feedback(user_id, false, "reorder_roles", reason),
            }
        }
        ClientMessage::AssignUserRoles {
            server_id,
            target_username,
            role_ids,
        } => {
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let updated_srv = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                if let Err(reason) = srv.authorize_assignment(&me_lower, &target_lower, &role_ids) {
                    st.feedback(user_id, false, "assign_roles", reason);
                    return;
                }
                let valid_ids: Vec<String> = role_ids
                    .into_iter()
                    .filter(|rid| rid != "everyone" && srv.roles.iter().any(|r| &r.id == rid))
                    .collect();
                if valid_ids.is_empty() {
                    srv.member_roles.remove(&target_lower);
                } else {
                    srv.member_roles.insert(target_lower, valid_ids);
                }
                srv.clone()
            };
            st.save_servers();
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
        }

        ClientMessage::KickServerMember {
            server_id,
            target_username,
        } => {
            if server_id == "sancord" {
                return;
            }
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let (updated_srv, srv_name) = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                let perms = srv.effective_permissions(&me_lower);
                let is_owner = srv.is_owner(&me_lower);
                if (!is_owner && !perms.kick_members && !perms.administrator)
                    || srv.is_owner(&target_lower)
                    || target_lower == me_lower
                {
                    return;
                }
                if !is_owner && srv.highest_position(&me_lower) <= srv.highest_position(&target_lower) {
                    return;
                }
                srv.members.retain(|m| m != &target_lower);
                srv.member_roles.remove(&target_lower);
                srv.member_joined_at.remove(&target_lower);
                (srv.clone(), srv.name.clone())
            };

            st.save_servers();
            let target_uids: Vec<String> = st
                .users
                .iter()
                .filter(|(_, u)| u.username.to_lowercase() == target_lower)
                .map(|(uid, _)| uid.clone())
                .collect();
            for uid in target_uids {
                st.send_to(
                    &uid,
                    ServerMessage::ServerRemoved {
                        server_id: server_id.clone(),
                        reason: Some(format!("Você foi expulso de '{}'.", srv_name)),
                    },
                );
            }
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
        }

        ClientMessage::BanServerMember {
            server_id,
            target_username,
        } => {
            if server_id == "sancord" {
                return;
            }
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let (updated_srv, srv_name) = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                let perms = srv.effective_permissions(&me_lower);
                let is_owner = srv.is_owner(&me_lower);
                if (!is_owner && !perms.ban_members && !perms.administrator)
                    || srv.is_owner(&target_lower)
                    || target_lower == me_lower
                {
                    return;
                }
                if !is_owner && srv.highest_position(&me_lower) <= srv.highest_position(&target_lower) {
                    return;
                }
                srv.members.retain(|m| m != &target_lower);
                srv.member_roles.remove(&target_lower);
                srv.member_joined_at.remove(&target_lower);
                if !srv.banned_usernames.contains(&target_lower) {
                    srv.banned_usernames.push(target_lower.clone());
                }
                (srv.clone(), srv.name.clone())
            };

            st.save_servers();
            let target_uids: Vec<String> = st
                .users
                .iter()
                .filter(|(_, u)| u.username.to_lowercase() == target_lower)
                .map(|(uid, _)| uid.clone())
                .collect();
            for uid in target_uids {
                st.send_to(
                    &uid,
                    ServerMessage::ServerRemoved {
                        server_id: server_id.clone(),
                        reason: Some(format!("Você foi banido de '{}'.", srv_name)),
                    },
                );
            }
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
        }

        ClientMessage::UnbanServerMember {
            server_id,
            target_username,
        } => {
            let target_lower = target_username.trim().to_lowercase();
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let me_lower = me.username.to_lowercase();

            let updated_srv = {
                let Some(srv) = st.find_server_mut(&server_id) else {
                    return;
                };
                let perms = srv.effective_permissions(&me_lower);
                if !srv.is_owner(&me_lower) && !perms.ban_members && !perms.administrator {
                    return;
                }
                srv.banned_usernames.retain(|b| b != &target_lower);
                srv.clone()
            };
            st.save_servers();
            st.broadcast_to_server(&server_id, ServerMessage::ServerUpdated { server: updated_srv });
        }

        ClientMessage::ChangePassword {
            current_password,
            new_password,
        } => {
            let cur = current_password;
            let next = new_password;
            if let Err(msg) = crate::auth::validate_new_password(&next) {
                state.read().await.feedback(user_id, false, "change_password", msg);
                return;
            }
            // Copia o hash atual e solta o lock: Argon2 é lento de propósito.
            let (account_id, stored_hash, salt_key) = {
                let st = state.read().await;
                let Some(me) = st.users.get(user_id) else {
                    return;
                };
                let me_lower = me.username.to_lowercase();
                let Some(acc) = st.accounts.get(&me_lower) else {
                    return;
                };
                (
                    acc.id.clone(),
                    acc.password_hash.clone(),
                    acc.password_salt_key.clone().unwrap_or(me_lower),
                )
            };
            let outcome = tokio::task::spawn_blocking(move || {
                use crate::auth::{hash_password, verify_password, PasswordCheck};
                if verify_password(&stored_hash, &cur, &salt_key) == PasswordCheck::Invalid {
                    return Err("Senha atual incorreta.");
                }
                hash_password(&next).map_err(|_| "Não foi possível alterar a senha. Tente novamente.")
            })
            .await
            .unwrap_or(Err("Não foi possível alterar a senha. Tente novamente."));

            let mut st = state.write().await;
            match outcome {
                Ok(new_hash) => {
                    let key = st.account_by_id(&account_id).map(|a| a.username.to_lowercase());
                    if let Some(acc) = key.and_then(|k| st.accounts.get_mut(&k)) {
                        acc.password_hash = new_hash;
                    }
                    st.save_accounts();
                    // Encerra as outras sessões (outros dispositivos); mantém a atual.
                    let keep = st.conn_sessions.get(user_id).cloned();
                    st.revoke_other_sessions(&account_id, keep.as_deref());
                    st.feedback(user_id, true, "change_password", "Senha alterada com sucesso! Outras sessões foram desconectadas.");
                }
                Err(msg) => st.feedback(user_id, false, "change_password", msg),
            }
        }

        ClientMessage::UpdateUsername { new_username } => {
            let clean = match crate::auth::validate_new_username(&new_username) {
                Ok(c) => c,
                Err(msg) => {
                    state.read().await.feedback(user_id, false, "update_username", msg);
                    return;
                }
            };
            let mut st = state.write().await;
            let Some(me) = st.users.get(user_id).cloned() else {
                return;
            };
            let old_lower = me.username.to_lowercase();
            let new_lower = clean.to_lowercase();

            if new_lower != old_lower && st.accounts.contains_key(&new_lower) {
                st.send_to(
                    user_id,
                    ServerMessage::ServerFeedback {
                        ok: false,
                        message: "Esse nome de usuário já está em uso.".to_string(),
                        action: Some("update_username".to_string()),
                    },
                );
                return;
            }

            if let Some(mut acc) = st.accounts.remove(&old_lower) {
                if acc.password_salt_key.is_none() {
                    acc.password_salt_key = Some(old_lower.clone());
                }
                acc.username = clean.clone();
                st.accounts.insert(new_lower.clone(), acc);
                st.save_accounts();
            }

            if old_lower != new_lower {
                for srv in &mut st.servers {
                    if srv.owner_username == old_lower {
                        srv.owner_username = new_lower.clone();
                    }
                    for m in &mut srv.members {
                        if m == &old_lower {
                            *m = new_lower.clone();
                        }
                    }
                    if let Some(roles) = srv.member_roles.remove(&old_lower) {
                        srv.member_roles.insert(new_lower.clone(), roles);
                    }
                    if let Some(moderation) = srv.voice_moderation.remove(&old_lower) {
                        srv.voice_moderation.insert(new_lower.clone(), moderation);
                    }
                    for rules in srv.categories.iter_mut().map(|c| &mut c.permission_overwrites)
                        .chain(srv.text_channels.iter_mut().chain(&mut srv.voice_channels).map(|c| &mut c.permission_overwrites)) {
                        for rule in rules {
                            if rule.target_type == crate::permissions::OverwriteTarget::Member && rule.target_id == old_lower { rule.target_id = new_lower.clone(); }
                        }
                    }
                    for b in &mut srv.banned_usernames {
                        if b == &old_lower {
                            *b = new_lower.clone();
                        }
                    }
                    if let Some(t) = srv.member_joined_at.remove(&old_lower) {
                        srv.member_joined_at.insert(new_lower.clone(), t);
                    }
                }
                st.db.write(crate::db::WriteOp::RenameVoiceModeration {
                    from: old_lower.clone(), to: new_lower.clone(),
                });
                st.save_servers();
                let renamed: Vec<Invite> = st
                    .invites
                    .values()
                    .filter(|i| i.creator == old_lower)
                    .cloned()
                    .collect();
                for mut inv in renamed {
                    inv.creator = new_lower.clone();
                    st.register_invite(inv);
                }
                // Antes, amizades e DMs ficavam presas ao nome antigo.
                rename_user_in_social_graph(&mut st, &old_lower, &new_lower);
            }

            // Atualiza todas as conexões desta conta (vários dispositivos).
            let same_account: Vec<String> = st
                .users
                .iter()
                .filter(|(_, u)| u.username.to_lowercase() == old_lower)
                .map(|(id, _)| id.clone())
                .collect();
            let mut updated_user = None;
            for conn in same_account {
                if let Some(u) = st.users.get_mut(&conn) {
                    u.username = clean.clone();
                    if conn == user_id {
                        updated_user = Some(u.clone());
                    } else {
                        let other = u.clone();
                        st.send_to(&conn, ServerMessage::SelfUpdated { user: other });
                    }
                }
            }

            if let Some(u) = updated_user {
                st.send_to(user_id, ServerMessage::SelfUpdated { user: u.clone() });
                st.broadcast(ServerMessage::UserJoined { user: u });
                st.send_to(
                    user_id,
                    ServerMessage::ServerFeedback {
                        ok: true,
                        message: "Nome de usuário atualizado!".to_string(),
                        action: Some("update_username".to_string()),
                    },
                );
                st.send_servers_sync_to_username(&new_lower);
                st.broadcast_friends_sync_all();
            }
        }

        ClientMessage::Ping => {}
    }
}

/// Migra amizades, pedidos e DMs de `old` para `new` (IDs de DM contêm o username).
fn rename_user_in_social_graph(st: &mut ServerState, old: &str, new: &str) {
    fn rename_map(map: &mut HashMap<String, Vec<String>>, old: &str, new: &str) {
        if let Some(v) = map.remove(old) {
            map.insert(new.to_string(), v);
        }
        for list in map.values_mut() {
            for x in list.iter_mut() {
                if x == old {
                    *x = new.to_string();
                }
            }
        }
    }
    let rename_dm = |id: &str| -> Option<String> {
        let (a, b) = ServerState::parse_dm_participants(id)?;
        if !id.starts_with("dm:") {
            return None;
        }
        if a == old {
            Some(ServerState::make_dm_id(new, &b))
        } else if b == old {
            Some(ServerState::make_dm_id(&a, new))
        } else {
            None
        }
    };

    let fs = &mut st.friends_store;
    rename_map(&mut fs.friends, old, new);
    rename_map(&mut fs.incoming_requests, old, new);
    rename_map(&mut fs.outgoing_requests, old, new);
    if let Some(v) = fs.open_dms.remove(old) {
        fs.open_dms.insert(new.to_string(), v);
    }
    rename_map(&mut fs.blocked, old, new);
    for map in [&mut fs.open_dms, &mut fs.dm_requests, &mut fs.ignored_dms] {
        if let Some(v) = map.remove(old) {
            map.insert(new.to_string(), v);
        }
        for list in map.values_mut() {
            for id in list.iter_mut() {
                if let Some(n) = rename_dm(id) {
                    *id = n;
                }
            }
        }
    }
    let mut touched_groups = Vec::new();
    for g in st.group_dms.values_mut() {
        let mut touched = false;
        for m in g.members.iter_mut().filter(|m| *m == old) {
            *m = new.to_string();
            touched = true;
        }
        if g.owner == old {
            g.owner = new.to_string();
            touched = true;
        }
        if touched {
            touched_groups.push(g.id.clone());
        }
    }
    for id in touched_groups {
        st.save_group(&id);
    }

    let dm_channels: Vec<(String, String)> = st
        .chat_history
        .keys()
        .filter_map(|id| rename_dm(id).map(|n| (id.clone(), n)))
        .collect();
    for (from, to) in dm_channels {
        st.rename_channel_history(&from, &to);
    }
    st.save_friends();
}

async fn cleanup_disconnected_user(user_id: &str, state: &SharedState) {
    let mut st = state.write().await;
    st.voice_grants.remove(user_id);
    st.peers.remove(user_id);
    st.conn_sessions.remove(user_id);
    st.rates.remove(user_id);
    // Sai da voz pelo caminho comum (avisa os pares e encerra chamada privada vazia).
    crate::voice::remove_from_voice(&mut st, user_id);

    if let Some(removed_user) = st.users.remove(user_id) {
        info!(
            "Usuário desconectou: {} ({})",
            removed_user.username, user_id
        );

        if let Some(channel_id) = removed_user.voice_channel_id {
            st.broadcast_to_voice_channel_except(
                &channel_id,
                user_id,
                ServerMessage::PeerLeftVoice {
                    channel_id: channel_id.clone(),
                    peer_id: user_id.to_string(),
                },
            );
        }

        st.broadcast(ServerMessage::UserLeft {
            user_id: user_id.to_string(),
        });

        let sync_msg = ServerMessage::VoiceStateSync {
            voice_members: st.voice_members_map(),
            users: st.users_list(),
        };
        st.broadcast(sync_msg);
        st.broadcast_friends_sync_all();
    }
}
