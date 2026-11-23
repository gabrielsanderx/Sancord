//! Endpoints HTTP (operações pontuais e persistentes): cadastro, login,
//! validação de sessão, logout, preview de convite e saúde do servidor.
//!
//! O corpo das respostas mantém o formato antigo (`{ ok, message, token, ... }`)
//! para compatibilidade com o frontend, mas agora com códigos HTTP corretos.

use crate::auth::{self, PasswordCheck};
use crate::email_verification;
use crate::models::{
    Account, AuthRequest, AuthResponse, InvitePreviewResponse, RecoverPasswordRequest,
    SessionRequest,
};
use crate::state::{ServerState, SharedState, PROTOCOL_VERSION};
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use tracing::{error, info, warn};
use uuid::Uuid;

type AuthReply = (StatusCode, Json<AuthResponse>);
const INVALID_LOGIN: &str = "E-mail, nome de usuário ou senha incorretos.";
const INVALID_RECOVERY: &str = "Nome de usuário ou código de recuperação inválido.";

fn auth_err(status: StatusCode, msg: impl Into<String>) -> AuthReply {
    (status, Json(AuthResponse { ok: false, message: Some(msg.into()), ..Default::default() }))
}

fn auth_err_code(status: StatusCode, msg: impl Into<String>, code: &str) -> AuthReply {
    (status, Json(AuthResponse { ok: false, message: Some(msg.into()), code: Some(code.into()), ..Default::default() }))
}

/// Login aceito. Se a conta ainda precisa cadastrar/confirmar o e-mail, a resposta
/// diz o passo (`email_step`) e o app mostra essa etapa antes de conectar.
fn auth_ok(token: String, acc: &Account, require_verified_email: bool) -> AuthReply {
    (
        StatusCode::OK,
        Json(AuthResponse {
            ok: true,
            token: Some(token),
            username: Some(acc.username.clone()),
            avatar_color: Some(acc.avatar_color.clone()),
            avatar_url: acc.avatar_url.clone(),
            email_step: email_verification::email_step(require_verified_email, acc).map(str::to_string),
            email_hint: email_verification::target_email(acc).as_deref().map(email_verification::mask_email),
            ..Default::default()
        }),
    )
}

/// Chave da conta (username_lower) a partir do que a pessoa digitou: e-mail ou nome.
fn account_key_for_identifier(st: &ServerState, identifier: &str) -> String {
    let ident = identifier.trim().to_lowercase();
    if ident.contains('@') {
        email_verification::account_key_by_email(st, &ident).unwrap_or(ident)
    } else {
        ident
    }
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
    let email = match req.email.as_deref().map(auth::validate_email) {
        Some(Ok(Some(e))) => e,
        Some(Err(msg)) => return auth_err_code(StatusCode::BAD_REQUEST, msg, "email_invalid"),
        _ => return auth_err_code(StatusCode::BAD_REQUEST, "Informe seu e-mail.", "email_missing"),
    };
    if let Err(msg) = auth::validate_new_password(&req.password) {
        return auth_err(StatusCode::BAD_REQUEST, msg);
    }
    let key = username.to_lowercase();
    const USERNAME_TAKEN: &str = "Este nome de usuário já está em uso. Escolha outro ou faça login.";
    const EMAIL_TAKEN: &str = "Este e-mail já está em uso em outra conta. Entre com ele ou use outro.";

    // Checagem rápida antes do hash caro (a definitiva é feita de novo abaixo).
    {
        let st = state.read().await;
        if st.accounts.contains_key(&key) {
            return auth_err_code(StatusCode::CONFLICT, USERNAME_TAKEN, "username_taken");
        }
        if email_verification::email_in_use(&st, &email, "") {
            return auth_err_code(StatusCode::CONFLICT, EMAIL_TAKEN, "email_taken");
        }
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
        return auth_err_code(StatusCode::CONFLICT, USERNAME_TAKEN, "username_taken");
    }
    if email_verification::email_in_use(&st, &email, "") {
        return auth_err_code(StatusCode::CONFLICT, EMAIL_TAKEN, "email_taken");
    }
    let require = st.config.require_verified_email;
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
        email: Some(email),
        // Sem a exigência (modo de testes antigo), o e-mail informado já vale.
        email_verified: !require,
        pending_email: None,
        recovery_code_hash: None,
        inventory: Vec::new(),
        cosmetic_collection: Default::default(),
        profile_board: Default::default(),
        created_community: false,
        profile_sharing: Default::default(),
        badge_order: Vec::new(),
        hidden_badges: Vec::new(),
        owned_badges: Vec::new(),
        profile: Default::default(),
        token: String::new(),
    };
    st.accounts.insert(key.clone(), account.clone());
    st.save_accounts();
    let token = st.create_session(&account.id, req.remember);
    info!("Nova conta criada: {}", username);
    // Código de confirmação já sai no cadastro; o envio (SMTP) acontece fora do lock.
    let code = if require { email_verification::prepare_code(&mut st, &key, auth::now_ms()).ok() } else { None };
    drop(st);
    let (status, mut reply) = auth_ok(token, &account, require);
    if let Some(request) = code {
        if let Err(message) = email_verification::deliver(&state, request).await {
            let mut st = state.write().await;
            if let Some(pending) = st.email_codes.get_mut(&account.id) {
                pending.sends.pop();
                pending.code_hash.clear();
            }
            reply.0.message = Some(message);
            reply.0.code = Some("send_failed".into());
        } else {
            reply.0.retry_after = Some((email_verification::RESEND_COOLDOWN_MS / 1000) as u64);
        }
    }
    (status, reply)
}

pub async fn login_handler(State(state): State<SharedState>, Json(req): Json<AuthRequest>) -> AuthReply {
    let now = auth::now_ms();

    let (key, account_id, stored_hash, salt_key) = {
        let st = state.read().await;
        // O campo aceita e-mail ou nome de usuário; o limite de tentativas vale para a conta.
        let key = account_key_for_identifier(&st, &req.username);
        if st.login_limiter.is_blocked(&key, now) {
            return auth_err(
                StatusCode::TOO_MANY_REQUESTS,
                "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
            );
        }
        let Some(acc) = st.accounts.get(&key) else {
            drop(st);
            state.write().await.login_limiter.record_failure(&key, now);
            return auth_err(StatusCode::UNAUTHORIZED, INVALID_LOGIN);
        };
        (
            key.clone(),
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
        return auth_err(StatusCode::UNAUTHORIZED, INVALID_LOGIN);
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
        return auth_err(StatusCode::UNAUTHORIZED, INVALID_LOGIN);
    };
    let token = st.create_session(&account_id, req.remember);
    let require = st.config.require_verified_email;
    auth_ok(token, &acc, require)
}

pub async fn session_handler(State(state): State<SharedState>, Json(req): Json<SessionRequest>) -> AuthReply {
    let mut st = state.write().await;
    let require = st.config.require_verified_email;
    match st.validate_session(&req.token) {
        Some((_, acc)) => auth_ok(req.token.trim().to_string(), &acc, require),
        None => auth_err(StatusCode::UNAUTHORIZED, "Sessão expirada. Entre novamente."),
    }
}

/// Revoga a sessão do token informado e desconecta os sockets que a usam.
pub async fn logout_handler(State(state): State<SharedState>, Json(req): Json<SessionRequest>) -> StatusCode {
    let hash = auth::hash_token(&req.token);
    let mut st = state.write().await;
    st.revoke_session(&hash);
    StatusCode::NO_CONTENT
}

/// Redefine a senha usando o código único de recuperação gerado pelo titular da conta.
pub async fn recover_password_handler(
    State(state): State<SharedState>,
    Json(req): Json<RecoverPasswordRequest>,
) -> AuthReply {
    if req.username.trim().is_empty() {
        return auth_err(StatusCode::BAD_REQUEST, "Informe seu e-mail ou nome de usuário.");
    }
    let key = account_key_for_identifier(&*state.read().await, &req.username);
    let code_norm = auth::normalize_recovery_code(&req.recovery_code);
    if code_norm.is_empty() {
        return auth_err(StatusCode::BAD_REQUEST, "Informe o código de recuperação.");
    }
    if let Err(msg) = auth::validate_new_password(&req.new_password) {
        return auth_err(StatusCode::BAD_REQUEST, msg);
    }
    let now = auth::now_ms();

    let (account_id, stored_code_hash) = {
        let mut st = state.write().await;
        if st.login_limiter.is_blocked(&key, now) {
            return auth_err(
                StatusCode::TOO_MANY_REQUESTS,
                "Muitas tentativas falhas. Aguarde alguns minutos e tente novamente.",
            );
        }
        let Some(acc) = st.accounts.get(&key) else {
            st.login_limiter.record_failure(&key, now);
            return auth_err(StatusCode::UNAUTHORIZED, INVALID_RECOVERY);
        };
        let Some(code_hash) = acc.recovery_code_hash.clone() else {
            st.login_limiter.record_failure(&key, now);
            return auth_err(StatusCode::UNAUTHORIZED, INVALID_RECOVERY);
        };
        (acc.id.clone(), code_hash)
    };

    let new_pw = req.new_password.clone();
    let hash_for_check = stored_code_hash.clone();
    let salt_for_check = key.clone();
    let check = tokio::task::spawn_blocking(move || {
        if auth::verify_password(&hash_for_check, &code_norm, &salt_for_check) == PasswordCheck::Invalid {
            return Ok(None);
        }
        auth::hash_password(&new_pw).map(Some)
    })
    .await;

    let new_pw_hash = match check {
        Ok(Ok(Some(h))) => h,
        Ok(Ok(None)) => {
            let mut st = state.write().await;
            st.login_limiter.record_failure(&key, now);
            warn!("Código de recuperação incorreto para '{key}'");
            return auth_err(StatusCode::UNAUTHORIZED, INVALID_RECOVERY);
        }
        other => {
            error!("Falha na recuperação de senha: {other:?}");
            return auth_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Erro interno ao redefinir senha. Tente novamente.",
            );
        }
    };

    let mut st = state.write().await;
    let Some(acc) = st.accounts.get_mut(&key) else {
        return auth_err(StatusCode::UNAUTHORIZED, INVALID_RECOVERY);
    };
    if acc.recovery_code_hash.as_deref() != Some(stored_code_hash.as_str()) {
        return auth_err(StatusCode::UNAUTHORIZED, INVALID_RECOVERY);
    }
    acc.password_hash = new_pw_hash;
    acc.recovery_code_hash = None;
    let updated_acc = acc.clone();
    st.login_limiter.clear(&key);
    st.save_accounts();
    st.revoke_other_sessions(&account_id, None);
    let token = st.create_session(&account_id, req.remember);
    info!("Senha de '{key}' redefinida via código de recuperação (uso único consumido).");
    let require = st.config.require_verified_email;
    auth_ok(token, &updated_acc, require)
}

pub async fn health_handler(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let st = state.read().await;
    Json(serde_json::json!({
        "ok": true,
        "maintenance_mode": st.config.maintenance_mode,
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

fn invite_preview_err(
    status: StatusCode,
    kind: &str,
    msg: impl Into<String>,
) -> (StatusCode, Json<InvitePreviewResponse>) {
    (
        status,
        Json(InvitePreviewResponse {
            ok: false,
            code: None,
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
            inviter_name: None,
            inviter_avatar: None,
            channel_id: None,
            channel_name: None,
            temporary: false,
            already_member: false,
            invites_paused: kind == "paused",
            rules_text: None,
            error_kind: Some(kind.to_string()),
            message: Some(msg.into()),
        }),
    )
}

pub async fn invite_preview_handler(
    State(state): State<SharedState>,
    headers: axum::http::HeaderMap,
    AxumPath(code): AxumPath<String>,
) -> (StatusCode, Json<InvitePreviewResponse>) {
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")))
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let rate_key = if let Some(tok) = bearer {
        format!("tok:{}", auth::hash_token(tok))
    } else if let Some(ip) = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        format!("ip:{ip}")
    } else {
        "anon".to_string()
    };

    let mut st = state.write().await;
    let now = auth::now_ms();
    if st.invite_preview_rates.len() > 2048 {
        st.invite_preview_rates.clear();
    }
    let allowed = st
        .invite_preview_rates
        .entry(rate_key)
        .or_default()
        .allow(now, 60, 60_000);
    if !allowed {
        return invite_preview_err(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Muitas tentativas de consulta de convite. Aguarde um momento.",
        );
    }

    let requester_lower: Option<String> = bearer
        .and_then(|tok| st.validate_session(tok))
        .map(|(_, acc)| acc.username.to_lowercase());

    match st.resolve_invite_detailed(&code) {
        Ok((invite, srv)) => {
            if let Some(ref req_lower) = requester_lower {
                if srv.is_banned(req_lower) {
                    return invite_preview_err(
                        StatusCode::FORBIDDEN,
                        "banned",
                        "Você não pode entrar neste servidor.",
                    );
                }
            }
            let already_member = requester_lower
                .as_deref()
                .is_some_and(|u| srv.is_member(u));
            let member_count = if srv.id == "sancord" {
                st.accounts.len().max(srv.members.len())
            } else {
                srv.members.len().max(1)
            };
            let inviter_acc = st.accounts.get(&invite.creator);
            let inviter_name = inviter_acc
                .map(|a| a.display_name.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| a.username.clone()))
                .filter(|n| !n.is_empty());
            let inviter_avatar = inviter_acc.and_then(|a| a.avatar_url.clone());

            // Só expõe o nome do canal se @everyone puder visualizá-lo (ou se o usuário já for membro com acesso).
            let (channel_id, channel_name) = invite
                .channel_id
                .as_deref()
                .and_then(|cid| srv.find_channel(cid))
                .filter(|ch| {
                    let probe = requester_lower.as_deref().filter(|u| srv.is_member(u)).unwrap_or("");
                    srv.channel_permissions(probe, &ch.id).view_channel
                })
                .map(|ch| (Some(ch.id.clone()), Some(ch.name.clone())))
                .unwrap_or((None, None));

            (
                StatusCode::OK,
                Json(InvitePreviewResponse {
                    ok: true,
                    code: Some(invite.code.clone()),
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
                    inviter_name,
                    inviter_avatar,
                    channel_id,
                    channel_name,
                    temporary: invite.temporary,
                    already_member,
                    invites_paused: srv.invites_paused,
                    rules_text: srv.rules_text.clone(),
                    error_kind: None,
                    message: None,
                }),
            )
        }
        Err((kind, msg)) => {
            let status = match kind {
                "paused" => StatusCode::FORBIDDEN,
                "expired" | "revoked" | "max_uses" => StatusCode::GONE,
                _ => StatusCode::NOT_FOUND,
            };
            invite_preview_err(status, kind, msg)
        }
    }
}
