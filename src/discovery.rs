//! Descoberta do servidor pelo app desktop, com anúncios **assinados**.
//!
//! Problema anterior: o host publicava a URL do túnel em texto puro num tópico
//! público do ntfy.sh, e o app desktop abria a primeira URL `https://` que
//! encontrasse ali. Qualquer pessoa podia publicar no tópico e fazer o app dos
//! seus amigos abrir uma página arbitrária (phishing de senha, abuso da ponte
//! local de captura de tela).
//!
//! Agora:
//! - O servidor do host gera uma chave Ed25519 (`data/discovery.key`, privada,
//!   nunca sai da máquina) e grava a pública em `data/discovery_public.key`.
//! - O `build.rs` embute essa chave pública no SancordApp ao compilar.
//! - O servidor publica `v1|<url>|<unix_ts>|<assinatura_hex>`.
//! - O app só aceita anúncios com assinatura válida, recentes e cuja URL seja
//!   exatamente `https://<sub>.trycloudflare.com`.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use std::path::Path;
use std::time::Duration;
use tracing::{info, warn};

const CONTEXT: &str = "sancord-discovery-v1";
pub const DEFAULT_TOPIC: &str = "sancord_srv_8f92a1b4c7";
/// Anúncios mais antigos que isso são ignorados (limita replay de URLs antigas).
pub const MAX_AGE_SECS: i64 = 48 * 60 * 60;

fn signed_bytes(url: &str, ts: i64) -> Vec<u8> {
    format!("{CONTEXT}|{url}|{ts}").into_bytes()
}

/// URL de túnel aceitável: `https://<rótulo>.trycloudflare.com` sem caminho/porta/credenciais.
pub fn is_valid_tunnel_url(url: &str) -> bool {
    let Some(host) = url.strip_prefix("https://") else {
        return false;
    };
    let Some(sub) = host.strip_suffix(".trycloudflare.com") else {
        return false;
    };
    !sub.is_empty()
        && sub.len() <= 128
        && sub
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn sign_announcement(key: &SigningKey, url: &str, ts: i64) -> String {
    let sig = key.sign(&signed_bytes(url, ts));
    format!("v1|{url}|{ts}|{}", hex::encode(sig.to_bytes()))
}

/// Verifica um anúncio. Retorna a URL somente se tudo for válido.
pub fn verify_announcement(public_key_hex: &str, message: &str, now_secs: i64) -> Option<String> {
    let pk_bytes: [u8; 32] = hex::decode(public_key_hex.trim()).ok()?.try_into().ok()?;
    let key = VerifyingKey::from_bytes(&pk_bytes).ok()?;
    let mut parts = message.trim().split('|');
    if parts.next()? != "v1" {
        return None;
    }
    let url = parts.next()?;
    let ts: i64 = parts.next()?.parse().ok()?;
    let sig_bytes: [u8; 64] = hex::decode(parts.next()?).ok()?.try_into().ok()?;
    if parts.next().is_some() || !is_valid_tunnel_url(url) {
        return None;
    }
    // Aceita até 5 min de relógio adiantado no host.
    if ts > now_secs + 300 || now_secs - ts > MAX_AGE_SECS {
        return None;
    }
    key.verify_strict(&signed_bytes(url, ts), &Signature::from_bytes(&sig_bytes))
        .ok()?;
    Some(url.to_string())
}

/// Carrega a chave do host ou cria uma nova. Também (re)grava a chave pública.
pub fn load_or_create_key(data_dir: &Path) -> std::io::Result<SigningKey> {
    let priv_path = data_dir.join("discovery.key");
    let pub_path = data_dir.join("discovery_public.key");
    let key = match std::fs::read_to_string(&priv_path)
        .ok()
        .and_then(|s| hex::decode(s.trim()).ok())
        .and_then(|b| <[u8; 32]>::try_from(b).ok())
    {
        Some(bytes) => SigningKey::from_bytes(&bytes),
        None => {
            use argon2::password_hash::rand_core::{OsRng, RngCore};
            let mut bytes = [0u8; 32];
            OsRng.fill_bytes(&mut bytes);
            std::fs::create_dir_all(data_dir)?;
            std::fs::write(&priv_path, hex::encode(bytes))?;
            info!(
                "Nova chave de descoberta criada em {}. Recompile o SancordApp para embutir a chave pública.",
                priv_path.display()
            );
            SigningKey::from_bytes(&bytes)
        }
    };
    let pub_hex = hex::encode(key.verifying_key().to_bytes());
    if std::fs::read_to_string(&pub_path).ok().as_deref().map(str::trim) != Some(pub_hex.as_str()) {
        std::fs::write(&pub_path, &pub_hex)?;
    }
    Ok(key)
}

/// Última URL de túnel do Cloudflare encontrada no log do `cloudflared`.
pub fn find_tunnel_url(log: &str) -> Option<String> {
    log.split(|c: char| c.is_whitespace() || c == '|' || c == '"')
        .filter(|w| is_valid_tunnel_url(w))
        .last()
        .map(|s| s.to_string())
}

fn publish(topic: &str, body: &str) -> bool {
    let mut cmd = std::process::Command::new("curl");
    cmd.args(["-s", "-f", "-m", "10", "-d", body])
        .arg(format!("https://ntfy.sh/{topic}"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    matches!(cmd.output(), Ok(out) if out.status.success())
}

/// Observa `tunnel.log` e publica a URL do túnel (assinada) sempre que ela mudar.
///
/// Variáveis: `SANCORD_DISCOVERY=0` desliga; `SANCORD_DISCOVERY_TOPIC` troca o tópico;
/// `SANCORD_DISCOVERY_LEGACY=0` deixa de publicar também a URL crua (formato
/// antigo, só necessário enquanto houver amigos com o Sancord.exe antigo).
pub fn spawn_publisher(data_dir: std::path::PathBuf) {
    use crate::legacy_sancord_migration::env_var_compat;
    if env_var_compat("SANVO_DISCOVERY", "SANCORD_DISCOVERY").as_deref() == Some("0") {
        info!("Publicação de descoberta desativada (SANVO_DISCOVERY=0).");
        return;
    }
    let key = match load_or_create_key(&data_dir) {
        Ok(k) => k,
        Err(e) => {
            warn!("Não foi possível preparar a chave de descoberta: {e}");
            return;
        }
    };
    let topic = env_var_compat("SANVO_DISCOVERY_TOPIC", "SANCORD_DISCOVERY_TOPIC")
        .unwrap_or_else(|| DEFAULT_TOPIC.to_string());
    let legacy = env_var_compat("SANVO_DISCOVERY_LEGACY", "SANCORD_DISCOVERY_LEGACY").as_deref() != Some("0");
    let log_path = data_dir.join("tunnel.log");

    tokio::spawn(async move {
        let mut last_published: Option<String> = None;
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        loop {
            interval.tick().await;
            let path = log_path.clone();
            let found = tokio::task::spawn_blocking(move || {
                std::fs::read_to_string(path).ok().and_then(|s| find_tunnel_url(&s))
            })
            .await
            .ok()
            .flatten();
            let Some(url) = found else { continue };
            if last_published.as_deref() == Some(url.as_str()) {
                continue;
            }
            let ts = chrono::Utc::now().timestamp();
            let signed = sign_announcement(&key, &url, ts);
            let (topic2, url2) = (topic.clone(), url.clone());
            let ok = tokio::task::spawn_blocking(move || {
                let signed_ok = publish(&topic2, &signed);
                if legacy {
                    publish(&topic2, &url2);
                }
                signed_ok
            })
            .await
            .unwrap_or(false);
            if ok {
                info!("URL pública anunciada (assinada): {url}");
                last_published = Some(url);
            } else {
                warn!("Falha ao anunciar a URL pública; nova tentativa em instantes.");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    #[test]
    fn valid_announcement_roundtrip() {
        let k = key();
        let pk = hex::encode(k.verifying_key().to_bytes());
        let url = "https://abc-def-123.trycloudflare.com";
        let msg = sign_announcement(&k, url, 1_000_000);
        assert_eq!(verify_announcement(&pk, &msg, 1_000_100).as_deref(), Some(url));
    }

    #[test]
    fn rejects_forged_tampered_old_and_unsigned() {
        let k = key();
        let pk = hex::encode(k.verifying_key().to_bytes());
        let attacker = SigningKey::from_bytes(&[9u8; 32]);
        let url = "https://abc.trycloudflare.com";

        // URL crua (formato antigo) e assinatura de outra chave.
        assert!(verify_announcement(&pk, url, 1_000_000).is_none());
        let forged = sign_announcement(&attacker, url, 1_000_000);
        assert!(verify_announcement(&pk, &forged, 1_000_000).is_none());

        // Troca de URL mantendo a assinatura original.
        let good = sign_announcement(&k, url, 1_000_000);
        let tampered = good.replace("abc", "evil");
        assert!(verify_announcement(&pk, &tampered, 1_000_000).is_none());

        // Antigo demais ou do futuro.
        assert!(verify_announcement(&pk, &good, 1_000_000 + MAX_AGE_SECS + 1).is_none());
        assert!(verify_announcement(&pk, &good, 1_000_000 - 1000).is_none());

        // Mesmo assinada, só URLs de túnel no formato esperado.
        let bad_url = sign_announcement(&k, "https://evil.com", 1_000_000);
        assert!(verify_announcement(&pk, &bad_url, 1_000_000).is_none());
    }

    #[test]
    fn tunnel_url_rules() {
        assert!(is_valid_tunnel_url("https://a-b-c.trycloudflare.com"));
        assert!(!is_valid_tunnel_url("http://a.trycloudflare.com"));
        assert!(!is_valid_tunnel_url("https://a.trycloudflare.com.evil.com"));
        assert!(!is_valid_tunnel_url("https://evil.com/.trycloudflare.com"));
        assert!(!is_valid_tunnel_url("https://user@a.trycloudflare.com"));
        assert!(!is_valid_tunnel_url("https://.trycloudflare.com"));
    }

    #[test]
    fn finds_url_in_cloudflared_log() {
        let log = "INF |  https://old-one.trycloudflare.com  |\nINF | https://new-one.trycloudflare.com |";
        assert_eq!(find_tunnel_url(log).as_deref(), Some("https://new-one.trycloudflare.com"));
        assert!(find_tunnel_url("nada aqui").is_none());
    }

    #[test]
    fn key_is_persisted_and_public_key_written() {
        let dir = std::env::temp_dir().join(format!("sancord-disc-{}", uuid::Uuid::new_v4()));
        let k1 = load_or_create_key(&dir).unwrap();
        let k2 = load_or_create_key(&dir).unwrap();
        assert_eq!(k1.to_bytes(), k2.to_bytes());
        let pub_hex = std::fs::read_to_string(dir.join("discovery_public.key")).unwrap();
        assert_eq!(pub_hex, hex::encode(k1.verifying_key().to_bytes()));
    }
}
