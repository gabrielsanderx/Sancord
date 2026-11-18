//! Endpoints HTTP (operações pontuais e persistentes): cadastro, login,
//! validação de sessão, logout, preview de convite e saúde do servidor.
//!
//! O corpo das respostas mantém o formato antigo (`{ ok, message, token, ... }`)
//! para compatibilidade com o frontend, mas agora com códigos HTTP corretos.

use crate::auth::{self, PasswordCheck};
use crate::models::{Account, AuthRequest, AuthResponse, InvitePreviewResponse, SessionRequest};
use crate::state::{ServerState, SharedState, PROTOCOL_VERSION};
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use tracing::{error, info, warn};
use uuid::Uuid;

type AuthReply = (StatusCode, Json<AuthResponse>);

fn auth_err(status: StatusCode, msg: impl Into<String>) -> AuthReply {
    (
        status,
        Json(AuthResponse {
            ok: false,
            message: Some(msg.into()),
            token: None,
            username: None,
            avatar_color: None,
            avatar_url: None,
        }),
    )
}

fn auth_ok(token: String, acc: &Account) -> AuthReply {
    (
        StatusCode::OK,
        Json(AuthResponse {
            ok: true,
            message: None,
            token: Some(token),
            username: Some(acc.username.clone()),
            avatar_color: Some(acc.avatar_color.clone()),
            avatar_url: acc.avatar_url.clone(),
        }),
    )
}

pub fn format_pt_date_now() -> String {
    use chrono::Datelike;
    let now = chrono::Local::now();
    let months = [
        "jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez.",
    ];
    let m = months.get(now.month0() as usize).copied().unwrap_or("jan.");
    format!("{} de {} de {}", now.day(), m, now.year())
}

pub async fn register_handler(State(state): State<SharedState>, Json(req): Json<AuthRequest>) -> AuthReply {
    let username = match auth::validate_new_username(&req.username) {
        Ok(u) => u,
        Err(msg) => return auth_err(StatusCode::BAD_REQUEST, msg),
    };
    if let Err(msg) = auth::validate_new_password(&req.password) {
        return auth_err(StatusCode::BAD_REQUEST, msg);
    }
    let key = username.to_lowercase();

    // Checagem rápida antes do hash caro (a definitiva é feita de novo abaixo).
    if state.read().await.accounts.contains_key(&key) {
        return auth_err(
            StatusCode::CONFLICT,
            "Este nome de usuário já está em uso. Escolha outro ou faça login.",
        );
    }

    let password = req.password.clone();
    let hash = match tokio::task::spawn_blocking(move || auth::hash_password(&password)).await {
        Ok(Ok(h)) => h,
        other => {
            error!("Falha ao gerar hash de senha no cadastro: {other:?}");
            return auth_err(StatusCode::INTERNAL_SERVER_ERROR, "Não foi possível criar a conta. Tente novamente.");
        }
    };

    let mut st = state.write().await;
    if st.accounts.contains_key(&key) {
        return auth_err(
            StatusCode::CONFLICT,
            "Este nome de usuário já está em uso. Escolha outro ou faça login.",
        );
    }
    let account = Account {
        id: Uuid::new_v4().to_string(),
        username: username.clone(),
        password_hash: hash,
        avatar_color: ServerState::pick_avatar_color(&username),
        avatar_url: None,
        status_kind: "online".to_string(),
        custom_status: None,
        display_name: None,
        pronouns: None,
        custom_status_emoji: None,
        custom_status_expires_at: None,
        bio: None,
        avatar_decoration: None,
        banner_url: None,
        theme_primary: None,
        theme_accent: None,
        name_style: None,
        name_color: None,
        nameplate_style: None,
        profile_effect: None,
        password_salt_key: None,
        created_at: Some(format_pt_date_now()),
        token: String::new(),
    };
    st.accounts.insert(key, account.clone());
    st.save_accounts();
    let token = st.create_session(&account.id, req.remember);
    info!("Nova conta criada: {}", username);
    auth_ok(token, &account)
}

pub async fn login_handler(State(state): State<SharedState>, Json(req): Json<AuthRequest>) -> AuthReply {
    let key = req.username.trim().to_lowercase();
    let now = auth::now_ms();

    let (account_id, stored_hash, salt_key) = {
        let st = state.read().await;
        if st.login_limiter.is_blocked(&key, now) {
            return auth_err(
                StatusCode::TOO_MANY_REQUESTS,
                "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
            );
        }
        let Some(acc) = st.accounts.get(&key) else {
            return auth_err(
                StatusCode::UNAUTHORIZED,
                "Usuário não encontrado. Clique em 'Criar Conta' se for sua primeira vez.",
            );
        };
        (
            acc.id.clone(),
            acc.password_hash.clone(),
            acc.password_salt_key.clone().unwrap_or_else(|| key.clone()),
        )
    };

    // Verificação (e eventual re-hash) fora do lock.
    // Contas antigas aceitavam senha com espaços removidos nas pontas; mantém isso
    // só para o formato legado.
    let password = req.password.clone();
    let check = tokio::task::spawn_blocking(move || {
        let legacy = auth::is_legacy_hash(&stored_hash);
        let pw = if legacy { password.trim().to_string() } else { password };
        match auth::verify_password(&stored_hash, &pw, &salt_key) {
            PasswordCheck::ValidNeedsRehash => (true, auth::hash_password(&pw).ok()),
            PasswordCheck::Valid => (true, None),
            PasswordCheck::Invalid => (false, None),
        }
    })
    .await;
    let (valid, rehash) = match check {
        Ok(v) => v,
        Err(e) => {
            error!("Falha na verificação de senha: {e}");
            return auth_err(StatusCode::INTERNAL_SERVER_ERROR, "Erro interno ao entrar. Tente novamente.");
        }
    };

    let mut st = state.write().await;
    if !valid {
        st.login_limiter.record_failure(&key, now);
        warn!("Senha incorreta para '{key}'");
        return auth_err(StatusCode::UNAUTHORIZED, "Senha incorreta.");
    }
    st.login_limiter.clear(&key);
    if let Some(new_hash) = rehash {
        if let Some(acc) = st.accounts.get_mut(&key) {
            acc.password_hash = new_hash;
            info!("Senha de '{key}' migrada para Argon2id.");
        }
        st.save_accounts();
    }
    let Some(acc) = st.account_by_id(&account_id).cloned() else {
        return auth_err(StatusCode::UNAUTHORIZED, "Conta não encontrada.");
    };
    let token = st.create_session(&account_id, req.remember);
    auth_ok(token, &acc)
}

pub async fn session_handler(State(state): State<SharedState>, Json(req): Json<SessionRequest>) -> AuthReply {
    let mut st = state.write().await;
    match st.validate_session(&req.token) {
        Some((_, acc)) => auth_ok(req.token.trim().to_string(), &acc),
        None => auth_err(StatusCode::UNAUTHORIZED, "Sessão expirada. Entre novamente."),
    }
}

/// Revoga a sessão do token informado e desconecta os sockets que a usam.
pub async fn logout_handler(State(state): State<SharedState>, Json(req): Json<SessionRequest>) -> StatusCode {
    let hash = auth::hash_token(&req.token);
    let mut st = state.write().await;
    st.revoke_session(&hash);
    let conns: Vec<String> = st
        .conn_sessions
        .iter()
        .filter(|(_, h)| **h == hash)
        .map(|(c, _)| c.clone())
        .collect();
    for c in conns {
        if let Some(peer) = st.peers.get(&c) {
            peer.kick.notify_one();
        }
    }
    StatusCode::NO_CONTENT
}

pub async fn health_handler(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let st = state.read().await;
    Json(serde_json::json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "protocol_version": PROTOCOL_VERSION,
        "client_delivery": "embedded-desktop",
        "connections": st.peers.len(),
        "server_time": auth::now_ms(),
    }))
}

pub async fn public_url_handler(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let log = state.read().await.config.data_dir.join("tunnel.log");
    let found_url = tokio::task::spawn_blocking(move || {
        let content = std::fs::read_to_string(log).ok()?;
        content
            .split_whitespace()
            .filter(|w| w.starts_with("https://") && w.ends_with(".trycloudflare.com"))
            .last()
            .map(|s| s.to_string())
    })
    .await
    .ok()
    .flatten();
    Json(serde_json::json!({ "url": found_url }))
}

pub async fn invite_preview_handler(
    State(state): State<SharedState>,
    AxumPath(code): AxumPath<String>,
) -> (StatusCode, Json<InvitePreviewResponse>) {
    let st = state.read().await;
    match st.resolve_invite(&code) {
        Ok((invite, srv)) => {
            let member_count = if srv.id == "sancord" {
                st.accounts.len().max(srv.members.len())
            } else {
                srv.members.len().max(1)
            };
            (
                StatusCode::OK,
                Json(InvitePreviewResponse {
                    ok: true,
                    server_id: Some(srv.id.clone()),
                    name: Some(srv.name.clone()),
                    description: srv.description.clone(),
                    icon_url: srv.icon_url.clone(),
                    icon_color: Some(srv.icon_color.clone()),
                    banner_url: srv.banner_url.clone(),
                    member_count,
                    online_count: st.online_member_count(srv),
                    is_community: srv.is_community,
                    expires_at: invite.expires_at,
                    message: None,
                }),
            )
        }
        Err(msg) => (
            StatusCode::NOT_FOUND,
            Json(InvitePreviewResponse {
                ok: false,
                server_id: None,
                name: None,
                description: None,
                icon_url: None,
                icon_color: None,
                banner_url: None,
                member_count: 0,
                online_count: 0,
                is_community: false,
                expires_at: None,
                message: Some(msg.to_string()),
            }),
        ),
    }
}
