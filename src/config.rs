//! Configuração do servidor lida de variáveis de ambiente.
//!
//! Todos os valores têm padrões que reproduzem o comportamento antigo
//! (porta 3000 e pasta `data/`). A interface é embutida no cliente desktop;
//! este processo fornece somente API, WebSocket e mídia.

use crate::models::IceServer;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    /// Endereço de escuta HTTP/WebSocket (`SANCORD_BIND`, padrão `0.0.0.0:3000`).
    pub bind: SocketAddr,
    /// Pasta de dados persistentes: banco SQLite e backups dos JSON antigos (`SANCORD_DATA_DIR`).
    pub data_dir: PathBuf,
    /// Pasta de logs técnicos (`SANCORD_LOG_DIR`, padrão `logs/`).
    pub log_dir: PathBuf,
    /// Validade de sessões com "manter conectado" (`SANCORD_SESSION_DAYS`, padrão 30).
    pub session_days_remember: i64,
    /// Validade de sessões sem "manter conectado", em horas (`SANCORD_SESSION_HOURS`, padrão 24).
    pub session_hours_short: i64,
    /// Servidores ICE das chamadas, enviados aos clientes autenticados no Welcome.
    /// `SANCORD_STUN_URLS` substitui a lista STUN padrão; `SANCORD_TURN_URLS` +
    /// `SANCORD_TURN_USERNAME` + `SANCORD_TURN_CREDENTIAL` acrescentam um TURN (relay),
    /// necessário quando os dois lados estão atrás de NAT restritivo.
    pub ice_servers: Vec<IceServer>,
}

pub const DEFAULT_STUN_URLS: &[&str] = &[
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun.cloudflare.com:3478",
];

fn split_urls(raw: &str) -> Vec<String> {
    raw.split([',', ';', ' '])
        .map(str::trim)
        .filter(|u| u.starts_with("stun:") || u.starts_with("turn:") || u.starts_with("turns:"))
        .map(String::from)
        .collect()
}

/// Monta a lista ICE a partir das variáveis (função pura para facilitar testes).
pub fn ice_servers_from(
    stun: Option<&str>,
    turn: Option<&str>,
    turn_user: Option<&str>,
    turn_credential: Option<&str>,
) -> Vec<IceServer> {
    let stun_urls = stun
        .map(split_urls)
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| DEFAULT_STUN_URLS.iter().map(|s| s.to_string()).collect());
    let mut out = vec![IceServer { urls: stun_urls, username: None, credential: None }];
    let turn_urls = turn.map(split_urls).unwrap_or_default();
    let user = turn_user.map(str::trim).filter(|s| !s.is_empty());
    let cred = turn_credential.map(str::trim).filter(|s| !s.is_empty());
    if !turn_urls.is_empty() {
        if let (Some(u), Some(c)) = (user, cred) {
            out.push(IceServer { urls: turn_urls, username: Some(u.to_string()), credential: Some(c.to_string()) });
        } else {
            tracing::warn!("SANCORD_TURN_URLS definido sem usuário/senha: TURN ignorado.");
        }
    }
    out
}

impl Config {
    pub fn from_env() -> Self {
        let bind = std::env::var("SANCORD_BIND")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| SocketAddr::from(([0, 0, 0, 0], 3000)));
        let data_dir = env_path("SANCORD_DATA_DIR", "data");
        let log_dir = env_path("SANCORD_LOG_DIR", "logs");
        let session_days_remember = env_num("SANCORD_SESSION_DAYS", 30).clamp(1, 365);
        let session_hours_short = env_num("SANCORD_SESSION_HOURS", 24).clamp(1, 24 * 30);
        let var = |k: &str| std::env::var(k).ok();
        let ice_servers = ice_servers_from(
            var("SANCORD_STUN_URLS").as_deref(),
            var("SANCORD_TURN_URLS").as_deref(),
            var("SANCORD_TURN_USERNAME").as_deref(),
            var("SANCORD_TURN_CREDENTIAL").as_deref(),
        );
        Self {
            bind,
            data_dir,
            log_dir,
            session_days_remember,
            session_hours_short,
            ice_servers,
        }
    }

    /// Configuração isolada para testes (pasta temporária própria).
    pub fn for_tests(data_dir: PathBuf) -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], 0)),
            log_dir: data_dir.join("logs"),
            data_dir,
            session_days_remember: 30,
            session_hours_short: 24,
            ice_servers: ice_servers_from(None, None, None, None),
        }
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("sancord.db")
    }

    pub fn session_ttl_ms(&self, remember: bool) -> i64 {
        if remember {
            self.session_days_remember * 24 * 60 * 60 * 1000
        } else {
            self.session_hours_short * 60 * 60 * 1000
        }
    }
}

fn env_path(key: &str, default: &str) -> PathBuf {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default))
}

fn env_num(key: &str, default: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}
