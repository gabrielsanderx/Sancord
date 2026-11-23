//! Envio dos e-mails do Sanvo (códigos de confirmação).
//!
//! A configuração SMTP fica em `data/smtp.json` (fora do Git) e pode ser sobrescrita por
//! variáveis de ambiente `SANVO_SMTP_*`. Exemplo de `data/smtp.json`:
//!
//! ```json
//! { "host": "smtp.gmail.com", "port": 587, "security": "starttls",
//!   "username": "voce@gmail.com", "password": "senha-de-app",
//!   "from": "Sanvo <voce@gmail.com>" }
//! ```
//!
//! Sem configuração, o código vai só para o log do servidor (útil para testes locais).
//! A senha nunca é registrada no log.

use serde::Deserialize;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Deserialize)]
pub struct SmtpConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// `starttls` (porta 587, padrão) ou `tls` (porta 465, TLS implícito).
    #[serde(default = "default_security")]
    pub security: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    pub from: String,
}

fn default_port() -> u16 {
    587
}

fn default_security() -> String {
    "starttls".into()
}

/// E-mail gravado pelo mailer de testes.
#[derive(Debug, Clone)]
pub struct SentMail {
    pub to: String,
    pub subject: String,
    pub body: String,
}

#[derive(Clone)]
pub enum Mailer {
    Smtp(Arc<SmtpConfig>),
    /// Sem SMTP configurado: o código aparece no log do servidor.
    Log,
    /// Testes: guarda os e-mails em memória.
    Memory(Arc<Mutex<Vec<SentMail>>>),
}

impl std::fmt::Debug for Mailer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Mailer::Smtp(c) => write!(f, "Mailer::Smtp({}:{})", c.host, c.port),
            Mailer::Log => write!(f, "Mailer::Log"),
            Mailer::Memory(_) => write!(f, "Mailer::Memory"),
        }
    }
}

impl Mailer {
    /// Lê `data/smtp.json` e as variáveis `SANVO_SMTP_*` (que têm prioridade).
    pub fn from_data_dir(data_dir: &Path) -> Self {
        let mut cfg: Option<SmtpConfig> = std::fs::read_to_string(data_dir.join("smtp.json"))
            .ok()
            .and_then(|raw| match serde_json::from_str(&raw) {
                Ok(c) => Some(c),
                Err(e) => {
                    // Mostra só linha e coluna; o texto do arquivo (com a senha) nunca vai para o log.
                    tracing::error!(
                        "data/smtp.json inválido (linha {}, coluna {}). Confira se cada valor está numa linha só, entre aspas. E-mails irão só para o log.",
                        e.line(),
                        e.column()
                    );
                    None
                }
            });
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        if let Some(host) = env("SANVO_SMTP_HOST") {
            cfg = Some(SmtpConfig {
                host,
                port: env("SANVO_SMTP_PORT").and_then(|p| p.parse().ok()).unwrap_or(587),
                security: env("SANVO_SMTP_SECURITY").unwrap_or_else(default_security),
                username: env("SANVO_SMTP_USERNAME").unwrap_or_default(),
                password: env("SANVO_SMTP_PASSWORD").unwrap_or_default(),
                from: env("SANVO_SMTP_FROM").unwrap_or_default(),
            });
        }
        // Senhas de app do Google vêm em blocos ("abcd efgh ijkl mnop"); os espaços não fazem
        // parte da senha. Em outros provedores, só tira espaços das pontas.
        if let Some(c) = cfg.as_mut() {
            c.host = c.host.trim().to_string();
            c.password = if c.host.eq_ignore_ascii_case("smtp.gmail.com") {
                c.password.split_whitespace().collect()
            } else {
                c.password.trim().to_string()
            };
        }
        match cfg.filter(|c| !c.host.is_empty() && !c.from.trim().is_empty()) {
            Some(c) => {
                tracing::info!("E-mail: SMTP configurado ({}:{}, {}).", c.host, c.port, c.security);
                Mailer::Smtp(Arc::new(c))
            }
            None => {
                tracing::warn!("E-mail: SMTP não configurado (data/smtp.json). Os códigos de confirmação vão só para o log.");
                Mailer::Log
            }
        }
    }

    pub fn memory() -> (Self, Arc<Mutex<Vec<SentMail>>>) {
        let outbox = Arc::new(Mutex::new(Vec::new()));
        (Mailer::Memory(outbox.clone()), outbox)
    }

    pub fn is_configured(&self) -> bool {
        !matches!(self, Mailer::Log)
    }

    /// Envia o código de confirmação. Bloqueante (SMTP): chamar fora do lock do estado.
    pub fn send_code(&self, to: &str, username: &str, code: &str) -> Result<(), String> {
        let subject = format!("{code} é o seu código do Sanvo");
        let body = format!(
            "Olá, {username}!\n\n\
             Use este código para confirmar seu e-mail no Sanvo:\n\n    {code}\n\n\
             Ele vale por 15 minutos. Se não foi você, ignore este e-mail; ninguém entra na sua conta só com ele.\n\n\
             — Sanvo"
        );
        match self {
            Mailer::Log => {
                tracing::warn!("[e-mail não enviado: SMTP não configurado] código para {to}: {code}");
                Ok(())
            }
            Mailer::Memory(outbox) => {
                outbox.lock().unwrap_or_else(|e| e.into_inner()).push(SentMail { to: to.into(), subject, body });
                Ok(())
            }
            Mailer::Smtp(cfg) => send_smtp(cfg, to, &subject, &body),
        }
    }
}

fn send_smtp(cfg: &SmtpConfig, to: &str, subject: &str, body: &str) -> Result<(), String> {
    use lettre::message::{header::ContentType, Mailbox};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let from: Mailbox = cfg.from.parse().map_err(|_| "Remetente (from) inválido em smtp.json.".to_string())?;
    let to_box: Mailbox = to.parse().map_err(|_| "E-mail de destino inválido.".to_string())?;
    let message = Message::builder()
        .from(from)
        .to(to_box)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| format!("Falha ao montar o e-mail: {e}"))?;
    let builder = if cfg.security.eq_ignore_ascii_case("tls") {
        SmtpTransport::relay(&cfg.host)
    } else {
        SmtpTransport::starttls_relay(&cfg.host)
    }
    .map_err(|e| format!("Servidor SMTP inválido: {e}"))?
    .port(cfg.port)
    .timeout(Some(std::time::Duration::from_secs(15)));
    let transport = if cfg.username.is_empty() {
        builder.build()
    } else {
        builder.credentials(Credentials::new(cfg.username.clone(), cfg.password.clone())).build()
    };
    transport.send(&message).map(|_| ()).map_err(|e| {
        tracing::error!("Falha no envio SMTP para {}: {e}", mask_for_log(to));
        "Não foi possível enviar o e-mail agora. Tente de novo em instantes.".to_string()
    })
}

fn mask_for_log(email: &str) -> String {
    crate::email_verification::mask_email(email)
}
