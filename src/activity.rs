//! Validação, sanitização e distribuição em tempo real de atividade / Rich Presence.

use std::collections::HashMap;
use crate::models::{ActivityButton, ServerMessage, UserActivity};
use crate::state::SharedState;

const MAX_NAME: usize = 80;
const MAX_APP_ID: usize = 64;
const MAX_DETAIL: usize = 128;
const MAX_ASSET_TEXT: usize = 80;
const MAX_URL: usize = 300;
const MAX_SECRET: usize = 128;
const MAX_BUTTONS: usize = 2;
const MAX_BUTTON_LABEL: usize = 32;
const MAX_METADATA_ITEMS: usize = 8;
const MAX_METADATA_KEY: usize = 32;
const MAX_METADATA_VAL: usize = 128;
const TWO_YEARS_MS: i64 = 2 * 366 * 24 * 60 * 60 * 1000;

fn clean_text(raw: Option<String>, max_len: usize) -> Option<String> {
    let raw = raw?;
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(max_len)
        .collect();
    if cleaned.is_empty() { None } else { Some(cleaned) }
}

fn clean_id(raw: Option<String>, max_len: usize) -> Option<String> {
    let raw = raw?;
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        .take(max_len)
        .collect();
    if cleaned.is_empty() { None } else { Some(cleaned) }
}

fn is_safe_http_url(url: &str, https_only: bool) -> bool {
    if url.len() > MAX_URL || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let scheme_ok = if https_only {
        parsed.scheme() == "https"
    } else {
        matches!(parsed.scheme(), "https" | "http")
    };
    scheme_ok && parsed.host_str().is_some()
}

fn clean_asset(raw: Option<String>) -> Option<String> {
    let s = clean_text(raw, MAX_URL)?;
    if s.contains("://") {
        if is_safe_http_url(&s, true) {
            Some(s)
        } else {
            None
        }
    } else if s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
    {
        Some(s)
    } else {
        None
    }
}

fn clean_timestamp(ts: Option<i64>, now_ms: i64) -> Option<i64> {
    let ts = ts?;
    if ts <= 0 || (ts - now_ms).abs() > TWO_YEARS_MS {
        return None;
    }
    Some(ts)
}

/// Valida e normaliza o payload de atividade enviado pelo cliente.
/// Nunca confia em strings, URLs, timestamps ou contagens arbitrárias.
pub fn sanitize_activity(raw: UserActivity, now_ms: i64) -> Result<UserActivity, &'static str> {
    let Some(name) = clean_text(Some(raw.name), MAX_NAME) else {
        return Err("Nome da atividade inválido.");
    };

    let kind = match raw.kind.trim().to_ascii_lowercase().as_str() {
        "" | "playing" => "playing".to_string(),
        "listening" => "listening".to_string(),
        "watching" => "watching".to_string(),
        "competing" => "competing".to_string(),
        _ => "playing".to_string(),
    };

    let source = raw
        .source
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| matches!(s.as_str(), "game_detector" | "rpc" | "manual"));

    let started_at = clean_timestamp(raw.started_at, now_ms);
    let mut ends_at = clean_timestamp(raw.ends_at, now_ms);
    if let (Some(start), Some(end)) = (started_at, ends_at) {
        if end < start {
            ends_at = None;
        }
    }

    let (party_size, party_max) = match (raw.party_size, raw.party_max) {
        (Some(size), Some(max)) if size >= 1 && max >= size && max <= 999 => (Some(size), Some(max)),
        (Some(size), None) if (1..=999).contains(&size) => (Some(size), None),
        _ => (None, None),
    };

    let mut buttons = Vec::new();
    for b in raw.buttons.into_iter().take(MAX_BUTTONS) {
        if let (Some(label), Some(url)) = (
            clean_text(Some(b.label), MAX_BUTTON_LABEL),
            clean_text(Some(b.url), MAX_URL),
        ) {
            if is_safe_http_url(&url, false) {
                buttons.push(ActivityButton { label, url });
            }
        }
    }

    let mut metadata = HashMap::new();
    for (k, v) in raw.metadata.into_iter().take(MAX_METADATA_ITEMS) {
        if let (Some(ck), Some(cv)) = (clean_id(Some(k), MAX_METADATA_KEY), clean_text(Some(v), MAX_METADATA_VAL)) {
            metadata.insert(ck, cv);
        }
    }

    Ok(UserActivity {
        kind,
        application_id: clean_id(raw.application_id, MAX_APP_ID),
        name,
        details: clean_text(raw.details, MAX_DETAIL),
        state: clean_text(raw.state, MAX_DETAIL),
        started_at,
        ends_at,
        large_image: clean_asset(raw.large_image),
        large_text: clean_text(raw.large_text, MAX_ASSET_TEXT),
        small_image: clean_asset(raw.small_image),
        small_text: clean_text(raw.small_text, MAX_ASSET_TEXT),
        party_id: clean_id(raw.party_id, MAX_APP_ID),
        party_size,
        party_max,
        buttons,
        join_secret: clean_id(raw.join_secret, MAX_SECRET),
        spectate_secret: clean_id(raw.spectate_secret, MAX_SECRET),
        source,
        metadata,
    })
}

/// Atualiza a atividade em tempo real do usuário conectado e propaga para
/// todos os clientes respeitando privacidade (via `access.rs`).
pub async fn update_activity(state: &SharedState, user_id: &str, raw: Option<UserActivity>) {
    let now = crate::auth::now_ms();
    let cleaned = match raw {
        Some(act) => match sanitize_activity(act, now) {
            Ok(valid) => Some(valid),
            Err(msg) => {
                state.read().await.feedback(user_id, false, "activity", msg);
                return;
            }
        },
        None => None,
    };

    let mut st = state.write().await;
    if !st.rates.entry(user_id.to_string()).or_default().allow_activity(now) {
        return;
    }

    let Some((username, changed)) = st.users.get(user_id).map(|u| {
        (u.username.clone(), u.activity != cleaned)
    }) else {
        return;
    };
    if !changed {
        return;
    }

    let key = username.to_lowercase();
    for user in st.users.values_mut().filter(|u| u.username.to_lowercase() == key) {
        user.activity = cleaned.clone();
    }

    st.broadcast(ServerMessage::UserActivityUpdated {
        user_id: user_id.to_string(),
        username,
        activity: cleaned,
    });
    st.broadcast_friends_sync_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> UserActivity {
        UserActivity {
            kind: "playing".into(),
            application_id: Some("steam:1091500".into()),
            name: "Cyberpunk 2077".into(),
            details: Some("Night City".into()),
            state: Some("Em missão".into()),
            started_at: Some(1_700_000_000_000),
            ends_at: None,
            large_image: Some("https://cdn.example.com/cp2077.png".into()),
            large_text: Some("Cyberpunk 2077".into()),
            small_image: Some("badge_icon".into()),
            small_text: None,
            party_id: Some("party-1".into()),
            party_size: Some(2),
            party_max: Some(4),
            buttons: vec![ActivityButton {
                label: "Ver site".into(),
                url: "https://example.com/game".into(),
            }],
            join_secret: None,
            spectate_secret: None,
            source: Some("rpc".into()),
            metadata: HashMap::from([("map".into(), "Watson".into())]),
        }
    }

    #[test]
    fn accepts_valid_rich_presence_and_strips_unsafe_fields() {
        let now = 1_700_000_100_000;
        let mut act = sample();
        act.large_image = Some("javascript:alert(1)".into());
        act.buttons.push(ActivityButton { label: "Bad".into(), url: "file:///C:/Windows".into() });
        act.buttons.push(ActivityButton { label: "Third".into(), url: "https://third.example.com".into() });
        let out = sanitize_activity(act, now).unwrap();
        assert_eq!(out.name, "Cyberpunk 2077");
        assert!(out.large_image.is_none());
        assert_eq!(out.small_image.as_deref(), Some("badge_icon"));
        assert_eq!(out.buttons.len(), 1);
        assert_eq!(out.party_size, Some(2));
        assert_eq!(out.party_max, Some(4));
    }

    #[test]
    fn rejects_empty_name_and_fixes_invalid_party_or_timestamps() {
        let now = 1_700_000_100_000;
        let mut empty = sample();
        empty.name = "   \n\t ".into();
        assert!(sanitize_activity(empty, now).is_err());

        let mut weird = sample();
        weird.party_size = Some(10);
        weird.party_max = Some(4);
        weird.started_at = Some(now + 10_000);
        weird.ends_at = Some(now + 1_000);
        let out = sanitize_activity(weird, now).unwrap();
        assert!(out.party_size.is_none());
        assert!(out.party_max.is_none());
        assert!(out.ends_at.is_none());
    }
}
