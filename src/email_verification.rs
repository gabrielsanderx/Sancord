//! E-mail obrigatório e confirmado por código.
//!
//! - Cadastro exige e-mail único; o código de 6 dígitos vai para a caixa de entrada.
//! - Login aceita e-mail ou nome de usuário.
//! - Contas antigas sem e-mail entram, mas antes de usar o app cadastram (`add`) e
//!   confirmam (`verify`) o e-mail. O WebSocket recusa a conexão até isso acontecer.
//! - Códigos ficam só em memória (hash), valem 15 minutos e aceitam 5 tentativas.

use crate::auth;
use crate::models::{Account, AuthResponse, EmailStartRequest, EmailVerifyRequest};
use crate::state::{ServerState, SharedState};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::{extract::State, http::StatusCode, Json};
use sha2::{Digest, Sha256};

pub const CODE_TTL_MS: i64 = 15 * 60 * 1000;
pub const RESEND_COOLDOWN_MS: i64 = 60 * 1000;
pub const MAX_SENDS_PER_HOUR: usize = 6;
pub const MAX_ATTEMPTS: u32 = 5;

#[derive(Debug, Clone)]
pub struct PendingCode {
    pub email: String,
    pub code_hash: String,
    pub expires_at: i64,
    pub attempts: u32,
    /// Envios recentes (ms), para o intervalo mínimo e o limite por hora.
    pub sends: Vec<i64>,
}

/// `g***@gmail.com`: mostra onde o código foi sem expor o endereço inteiro.
pub fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let first: String = local.chars().take(1).collect();
            format!("{first}***@{domain}")
        }
        None => "***".into(),
    }
}

/// Passo de e-mail pendente para esta conta (`None` = pode usar o app).
pub fn email_step(require_verified: bool, acc: &Account) -> Option<&'static str> {
    if !require_verified || (acc.email.is_some() && acc.email_verified && acc.pending_email.is_none()) {
        return None;
    }
    if acc.email.is_some() && acc.email_verified {
        // Troca de e-mail em andamento: a conta continua usável com o e-mail confirmado.
        return None;
    }
    if acc.pending_email.is_some() || acc.email.is_some() {
        Some("verify")
    } else {
        Some("add")
    }
}

/// Endereço que ainda precisa de código: o novo (troca) ou o atual não confirmado.
pub fn target_email(acc: &Account) -> Option<String> {
    acc.pending_email.clone().or_else(|| acc.email.clone().filter(|_| !acc.email_verified))
}

/// Outra conta já usa (ou reservou) este e-mail?
pub fn email_in_use(st: &ServerState, email: &str, except_account_id: &str) -> bool {
    st.accounts.values().any(|a| {
        a.id != except_account_id && (a.email.as_deref() == Some(email) || a.pending_email.as_deref() == Some(email))
    })
}

/// Chave (username_lower) da conta com este e-mail.
pub fn account_key_by_email(st: &ServerState, email: &str) -> Option<String> {
    st.accounts.iter().find(|(_, a)| a.email.as_deref() == Some(email)).map(|(k, _)| k.clone())
}

fn generate_code() -> String {
    // Rejeição para não enviesar: aceita só valores abaixo do maior múltiplo de 1_000_000.
    const LIMIT: u32 = u32::MAX - (u32::MAX % 1_000_000);
    loop {
        let n = OsRng.next_u32();
        if n < LIMIT {
            return format!("{:06}", n % 1_000_000);
        }
    }
}

fn hash_code(account_id: &str, code: &str) -> String {
    hex::encode(Sha256::digest(format!("sanvo-email-code:{account_id}:{code}").as_bytes()))
}

pub struct CodeRequest {
    pub to: String,
    pub username: String,
    pub code: String,
}

pub enum CodeError {
    NoTarget,
    Cooldown(u64),
}

/// Gera um código novo para o e-mail pendente da conta. O envio é feito fora do lock.
pub fn prepare_code(st: &mut ServerState, account_key: &str, now: i64) -> Result<CodeRequest, CodeError> {
    let acc = st.accounts.get(account_key).ok_or(CodeError::NoTarget)?;
    let to = target_email(acc).ok_or(CodeError::NoTarget)?;
    let (account_id, username) = (acc.id.clone(), acc.username.clone());
    let entry = st.email_codes.entry(account_id.clone()).or_insert_with(|| PendingCode {
        email: to.clone(),
        code_hash: String::new(),
        expires_at: 0,
        attempts: 0,
        sends: Vec::new(),
    });
    entry.sends.retain(|t| now - *t < 60 * 60 * 1000);
    if let Some(last) = entry.sends.last() {
        // O intervalo só vale para o mesmo endereço; trocar o e-mail pode pedir na hora.
        if entry.email == to && now - last < RESEND_COOLDOWN_MS {
            return Err(CodeError::Cooldown(((RESEND_COOLDOWN_MS - (now - last)) / 1000 + 1) as u64));
        }
    }
    if entry.sends.len() >= MAX_SENDS_PER_HOUR {
        let oldest = entry.sends[0];
        return Err(CodeError::Cooldown(((60 * 60 * 1000 - (now - oldest)) / 1000 + 1) as u64));
    }
    let code = generate_code();
    entry.email = to.clone();
    entry.code_hash = hash_code(&account_id, &code);
    entry.expires_at = now + CODE_TTL_MS;
    entry.attempts = 0;
    entry.sends.push(now);
    Ok(CodeRequest { to, username, code })
}

pub enum VerifyError {
    NoCode,
    Expired,
    TooManyAttempts,
    Wrong(u32),
    Taken,
}

/// Confere o código e, se certo, confirma o e-mail da conta.
pub fn verify_code(st: &mut ServerState, account_key: &str, code: &str, now: i64) -> Result<(), VerifyError> {
    let acc = st.accounts.get(account_key).ok_or(VerifyError::NoCode)?.clone();
    let digits: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    let pending = st.email_codes.get_mut(&acc.id).ok_or(VerifyError::NoCode)?;
    if pending.code_hash.is_empty() || target_email(&acc).as_deref() != Some(pending.email.as_str()) {
        return Err(VerifyError::NoCode);
    }
    if now > pending.expires_at {
        return Err(VerifyError::Expired);
    }
    if pending.attempts >= MAX_ATTEMPTS {
        return Err(VerifyError::TooManyAttempts);
    }
    if !auth::constant_time_eq(pending.code_hash.as_bytes(), hash_code(&acc.id, &digits).as_bytes()) {
        pending.attempts += 1;
        return Err(VerifyError::Wrong(MAX_ATTEMPTS - pending.attempts));
    }
    let email = pending.email.clone();
    if email_in_use(st, &email, &acc.id) {
        return Err(VerifyError::Taken);
    }
    st.email_codes.remove(&acc.id);
    if let Some(stored) = st.accounts.get_mut(account_key) {
        stored.email = Some(email);
        stored.email_verified = true;
        stored.pending_email = None;
    }
    st.save_accounts();
    Ok(())
}

/// Envia o código (SMTP bloqueante) fora do lock do estado.
pub async fn deliver(state: &SharedState, request: CodeRequest) -> Result<(), String> {
    let mailer = state.read().await.mailer.clone();
    tokio::task::spawn_blocking(move || mailer.send_code(&request.to, &request.username, &request.code))
        .await
        .unwrap_or_else(|_| Err("Falha interna no envio do e-mail.".into()))
}

type Reply = (StatusCode, Json<AuthResponse>);

fn reply(status: StatusCode, ok: bool, message: Option<String>, code: Option<&str>, acc: Option<&Account>, require: bool) -> Reply {
    let step = acc.and_then(|a| email_step(require, a)).map(str::to_string);
    let hint = acc.and_then(target_email).as_deref().map(mask_email);
    (
        status,
        Json(AuthResponse {
            ok,
            message,
            code: code.map(str::to_string),
            email_step: step,
            email_hint: hint,
            ..Default::default()
        }),
    )
}

fn cooldown_reply(secs: u64, acc: &Account, require: bool) -> Reply {
    let (status, mut json) = reply(
        StatusCode::TOO_MANY_REQUESTS,
        false,
        Some(format!("Aguarde {secs} s para pedir outro código.")),
        Some("cooldown"),
        Some(acc),
        require,
    );
    json.0.retry_after = Some(secs);
    (status, json)
}

/// `POST /api/email/start`: cadastra/troca o e-mail pendente e envia o código
/// (sem `email`, reenvia para o pendente).
pub async fn start_handler(State(state): State<SharedState>, Json(req): Json<EmailStartRequest>) -> Reply {
    let now = auth::now_ms();
    let (key, request, acc, require) = {
        let mut st = state.write().await;
        let require = st.config.require_verified_email;
        let Some((_, acc)) = st.validate_session(&req.token) else {
            return reply(StatusCode::UNAUTHORIZED, false, Some("Sessão expirada. Entre novamente.".into()), Some("session"), None, require);
        };
        let key = acc.username.to_lowercase();
        if let Some(raw) = req.email.as_deref() {
            let email = match auth::validate_email(raw) {
                Ok(Some(e)) => e,
                _ => return reply(StatusCode::BAD_REQUEST, false, Some("Informe um endereço de e-mail válido.".into()), Some("email_invalid"), Some(&acc), require),
            };
            if acc.email.as_deref() == Some(email.as_str()) && acc.email_verified {
                // Já é o e-mail confirmado: cancela uma troca pendente.
                if let Some(stored) = st.accounts.get_mut(&key) {
                    stored.pending_email = None;
                }
                st.email_codes.remove(&acc.id);
                st.save_accounts();
                let acc = st.accounts.get(&key).cloned().unwrap_or(acc);
                return reply(StatusCode::OK, true, None, None, Some(&acc), require);
            }
            if email_in_use(&st, &email, &acc.id) {
                return reply(StatusCode::CONFLICT, false, Some("Este e-mail já está em uso em outra conta.".into()), Some("email_taken"), Some(&acc), require);
            }
            if let Some(stored) = st.accounts.get_mut(&key) {
                if stored.email_verified {
                    stored.pending_email = Some(email);
                } else {
                    stored.email = Some(email);
                    stored.pending_email = None;
                }
            }
            st.save_accounts();
        }
        let acc = st.accounts.get(&key).cloned().unwrap_or(acc);
        match prepare_code(&mut st, &key, now) {
            Ok(r) => (key, r, acc, require),
            Err(CodeError::Cooldown(secs)) => return cooldown_reply(secs, &acc, require),
            Err(CodeError::NoTarget) => {
                return reply(StatusCode::BAD_REQUEST, false, Some("Informe o e-mail da conta.".into()), Some("email_missing"), Some(&acc), require)
            }
        }
    };
    if let Err(message) = deliver(&state, request).await {
        // Falhou: libera um novo pedido imediato.
        let mut st = state.write().await;
        if let Some(pending) = st.email_codes.get_mut(&acc.id) {
            pending.sends.pop();
            pending.code_hash.clear();
        }
        let acc = st.accounts.get(&key).cloned().unwrap_or(acc);
        return reply(StatusCode::BAD_GATEWAY, false, Some(message), Some("send_failed"), Some(&acc), require);
    }
    let (status, mut json) = reply(StatusCode::OK, true, None, None, Some(&acc), require);
    json.0.retry_after = Some((RESEND_COOLDOWN_MS / 1000) as u64);
    (status, json)
}

/// `POST /api/email/verify`: confirma o e-mail com o código recebido.
pub async fn verify_handler(State(state): State<SharedState>, Json(req): Json<EmailVerifyRequest>) -> Reply {
    let now = auth::now_ms();
    let mut st = state.write().await;
    let require = st.config.require_verified_email;
    let Some((_, acc)) = st.validate_session(&req.token) else {
        return reply(StatusCode::UNAUTHORIZED, false, Some("Sessão expirada. Entre novamente.".into()), Some("session"), None, require);
    };
    let key = acc.username.to_lowercase();
    let result = verify_code(&mut st, &key, &req.code, now);
    let acc = st.accounts.get(&key).cloned().unwrap_or(acc);
    match result {
        Ok(()) => {
            tracing::info!("E-mail confirmado para '{key}'.");
            // Conexões abertas da conta (troca feita nas Configurações) recebem o novo e-mail.
            let update = crate::models::ServerMessage::AccountEmailUpdated { email: acc.email.clone() };
            for (uid, u) in &st.users {
                if u.username.to_lowercase() == key {
                    st.send_to(uid, update.clone());
                }
            }
            reply(StatusCode::OK, true, None, None, Some(&acc), require)
        }
        Err(VerifyError::Wrong(left)) => reply(
            StatusCode::UNAUTHORIZED,
            false,
            Some(if left > 0 { format!("Código incorreto. Restam {left} tentativas.") } else { "Código incorreto. Peça um novo código.".into() }),
            Some("code_wrong"),
            Some(&acc),
            require,
        ),
        Err(VerifyError::Expired) => reply(StatusCode::GONE, false, Some("O código expirou. Peça um novo.".into()), Some("code_expired"), Some(&acc), require),
        Err(VerifyError::TooManyAttempts) => reply(StatusCode::TOO_MANY_REQUESTS, false, Some("Muitas tentativas. Peça um novo código.".into()), Some("code_attempts"), Some(&acc), require),
        Err(VerifyError::NoCode) => reply(StatusCode::BAD_REQUEST, false, Some("Peça um código primeiro.".into()), Some("code_missing"), Some(&acc), require),
        Err(VerifyError::Taken) => reply(StatusCode::CONFLICT, false, Some("Este e-mail já está em uso em outra conta.".into()), Some("email_taken"), Some(&acc), require),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mascara_e_codigo() {
        assert_eq!(mask_email("gabriel@gmail.com"), "g***@gmail.com");
        for _ in 0..200 {
            let c = generate_code();
            assert_eq!(c.len(), 6);
            assert!(c.chars().all(|ch| ch.is_ascii_digit()));
        }
        assert_ne!(hash_code("a", "123456"), hash_code("b", "123456"), "hash depende da conta");
    }
}
