//! Autenticação: hash de senha, tokens de sessão e validação de credenciais.
//!
//! Decisões:
//! - Senhas usam Argon2id (parâmetros padrão do crate, ~19 MiB / 2 iterações).
//!   O cálculo é caro de propósito, então deve rodar em `spawn_blocking` e
//!   NUNCA com o lock global do estado segurado.
//! - Contas antigas usam um hash caseiro (`legacy_hash`). Ele só é aceito para
//!   verificar o login; após um login bem-sucedido a senha é re-hasheada com
//!   Argon2id (migração transparente).
//! - O token de sessão é 256 bits aleatórios do SO. O banco guarda apenas o
//!   SHA-256 do token, então um vazamento do banco não entrega sessões válidas.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use sha2::{Digest, Sha256};

pub const MIN_PASSWORD_LEN: usize = 8;
pub const MAX_PASSWORD_LEN: usize = 128;
pub const MIN_USERNAME_LEN: usize = 2;
pub const MAX_USERNAME_LEN: usize = 24;

/// Gera o hash Argon2id (formato PHC: `$argon2id$v=19$...`).
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("falha ao gerar hash de senha: {e}"))
}

pub fn is_legacy_hash(stored: &str) -> bool {
    !stored.starts_with("$argon2")
}

/// Resultado da verificação de senha.
#[derive(Debug, PartialEq, Eq)]
pub enum PasswordCheck {
    Invalid,
    Valid,
    /// Senha correta, mas armazenada no formato antigo: deve ser re-hasheada.
    ValidNeedsRehash,
}

/// Verifica a senha contra o hash armazenado (Argon2 ou formato legado).
/// `legacy_salt_key` é o `password_salt_key` da conta antiga (username em minúsculas).
pub fn verify_password(stored: &str, password: &str, legacy_salt_key: &str) -> PasswordCheck {
    if is_legacy_hash(stored) {
        if constant_time_eq(stored.as_bytes(), legacy_hash(legacy_salt_key, password).as_bytes()) {
            PasswordCheck::ValidNeedsRehash
        } else {
            PasswordCheck::Invalid
        }
    } else {
        match PasswordHash::new(stored) {
            Ok(parsed) if Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok() => {
                PasswordCheck::Valid
            }
            _ => PasswordCheck::Invalid,
        }
    }
}

/// Hash usado pelas versões antigas do Sancord. Mantido apenas para migração.
pub fn legacy_hash(username_lower: &str, password: &str) -> String {
    let input = format!("sancord_salt_v1:{}:{}", username_lower, password);
    let mut h1: u64 = 0xcbf29ce484222325;
    let mut h2: u64 = 0x84222325cbf29ce4;
    for _round in 0..10_000 {
        for b in input.bytes() {
            h1 ^= b as u64;
            h1 = h1.wrapping_mul(0x100000001b3);
            h2 = h2.wrapping_add(h1 ^ (b as u64));
            h2 = h2.rotate_left(13).wrapping_mul(0x9e3779b97f4a7c15);
        }
    }
    format!("{:016x}{:016x}", h1, h2)
}

/// Novo token de sessão: 32 bytes aleatórios em hexadecimal (64 caracteres).
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// SHA-256 do token — é isso que fica no banco e no mapa de sessões.
pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.trim().as_bytes()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Normaliza e valida um nome de usuário novo. Retorna o nome limpo.
///
/// `__` e `:` são proibidos porque os IDs de DM atuais têm o formato
/// `dm:usuarioA__usuarioB`; permitir esses caracteres quebraria o parsing.
pub fn validate_new_username(raw: &str) -> Result<String, &'static str> {
    let name: String = raw.trim().chars().filter(|c| !c.is_control()).collect();
    let len = name.chars().count();
    if len < MIN_USERNAME_LEN {
        return Err("O nome de usuário deve ter pelo menos 2 caracteres.");
    }
    if len > MAX_USERNAME_LEN {
        return Err("O nome de usuário deve ter no máximo 24 caracteres.");
    }
    if name.contains("__") || name.contains(':') {
        return Err("O nome de usuário não pode conter ':' nem '__'.");
    }
    if name.contains('<') || name.contains('>') || name.contains('"') || name.contains('`') {
        return Err("O nome de usuário contém caracteres não permitidos.");
    }
    Ok(name)
}

pub fn validate_new_password(password: &str) -> Result<(), &'static str> {
    let len = password.chars().count();
    if len < MIN_PASSWORD_LEN {
        return Err("A senha deve ter pelo menos 8 caracteres.");
    }
    if len > MAX_PASSWORD_LEN {
        return Err("A senha deve ter no máximo 128 caracteres.");
    }
    Ok(())
}

/// Valida e normaliza um endereço de e-mail opcional (`""` remove o e-mail).
pub fn validate_email(raw: &str) -> Result<Option<String>, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 120 || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Informe um endereço de e-mail válido.");
    }
    let Some((local, domain)) = trimmed.split_once('@') else {
        return Err("Informe um endereço de e-mail válido.");
    };
    if local.is_empty()
        || domain.len() < 3
        || domain.contains('@')
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
    {
        return Err("Informe um endereço de e-mail válido.");
    }
    Ok(Some(trimmed.to_lowercase()))
}

/// Gera um código de recuperação de uso único no formato `SANC-XXXX-XXXX-XXXX`.
pub fn generate_recovery_code() -> String {
    const ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let mut bytes = [0u8; 12];
    OsRng.fill_bytes(&mut bytes);
    let chars: Vec<char> = bytes
        .iter()
        .map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char)
        .collect();
    format!(
        "SANC-{}-{}-{}",
        chars[0..4].iter().collect::<String>(),
        chars[4..8].iter().collect::<String>(),
        chars[8..12].iter().collect::<String>(),
    )
}

/// Normaliza o código de recuperação para comparação (maiúsculas, sem traços/espaços).
pub fn normalize_recovery_code(raw: &str) -> String {
    raw.trim()
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Limitador simples de tentativas de login por nome de usuário.
/// Por IP não funciona aqui: atrás do túnel Cloudflare todos chegam como 127.0.0.1.
#[derive(Default)]
pub struct LoginRateLimiter {
    failures: std::collections::HashMap<String, (u32, i64)>,
}

impl LoginRateLimiter {
    const MAX_FAILURES: u32 = 8;
    const WINDOW_MS: i64 = 10 * 60 * 1000;

    pub fn is_blocked(&self, key: &str, now_ms: i64) -> bool {
        match self.failures.get(key) {
            Some((count, start)) => now_ms - start < Self::WINDOW_MS && *count >= Self::MAX_FAILURES,
            None => false,
        }
    }

    pub fn record_failure(&mut self, key: &str, now_ms: i64) {
        let entry = self.failures.entry(key.to_string()).or_insert((0, now_ms));
        if now_ms - entry.1 >= Self::WINDOW_MS {
            *entry = (0, now_ms);
        }
        entry.0 += 1;
        // Evita crescimento ilimitado do mapa.
        if self.failures.len() > 10_000 {
            self.failures.retain(|_, (_, start)| now_ms - *start < Self::WINDOW_MS);
        }
    }

    pub fn clear(&mut self, key: &str) {
        self.failures.remove(key);
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_roundtrip() {
        let h = hash_password("senha-forte-123").unwrap();
        assert!(h.starts_with("$argon2id$"));
        assert_eq!(verify_password(&h, "senha-forte-123", "x"), PasswordCheck::Valid);
        assert_eq!(verify_password(&h, "errada", "x"), PasswordCheck::Invalid);
    }

    #[test]
    fn legacy_hash_is_accepted_and_flagged_for_rehash() {
        let legacy = legacy_hash("gabriel", "1234");
        assert_eq!(verify_password(&legacy, "1234", "gabriel"), PasswordCheck::ValidNeedsRehash);
        assert_eq!(verify_password(&legacy, "12345", "gabriel"), PasswordCheck::Invalid);
        assert_eq!(verify_password(&legacy, "1234", "outro"), PasswordCheck::Invalid);
    }

    #[test]
    fn tokens_are_random_and_hashed() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert_eq!(hash_token(&a), hash_token(&a));
        assert_ne!(hash_token(&a), a);
    }

    #[test]
    fn username_rules() {
        assert_eq!(validate_new_username("  Gabriel ").unwrap(), "Gabriel");
        assert!(validate_new_username("a").is_err());
        assert!(validate_new_username("a__b").is_err());
        assert!(validate_new_username("a:b").is_err());
        assert!(validate_new_username("<script>").is_err());
        assert!(validate_new_username(&"x".repeat(25)).is_err());
        assert!(validate_new_username("João Silva").is_ok());
    }

    #[test]
    fn password_rules() {
        assert!(validate_new_password("1234567").is_err());
        assert!(validate_new_password("12345678").is_ok());
    }

    #[test]
    fn rate_limiter_blocks_after_failures_and_resets() {
        let mut rl = LoginRateLimiter::default();
        for _ in 0..8 {
            rl.record_failure("ana", 1000);
        }
        assert!(rl.is_blocked("ana", 2000));
        assert!(!rl.is_blocked("bia", 2000));
        assert!(!rl.is_blocked("ana", 1000 + 11 * 60 * 1000));
        rl.clear("ana");
        assert!(!rl.is_blocked("ana", 2000));
    }
}
