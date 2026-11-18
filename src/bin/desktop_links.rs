use std::{env, process::Command};
use std::os::windows::process::CommandExt;

pub fn origin_of(url: &str) -> Option<String> {
    let url = url.trim();
    let uri: wry::http::Uri = url.split('#').next()?.parse().ok()?;
    let scheme = uri.scheme_str()?;
    if !matches!(scheme, "http" | "https") { return None; }
    let authority = uri.authority()?.as_str();
    if authority.contains('@') || authority.contains('\\') || authority.chars().any(char::is_whitespace) { return None; }
    Some(format!("{scheme}://{}", authority.to_ascii_lowercase()))
}

pub fn desktop_url(endpoint: &str) -> Option<String> {
    let origin = origin_of(endpoint)?;
    Some(format!("{}?endpoint={}", super::desktop_assets::APP_URL, sancord::uploads::url_encode_component(&origin)))
}

fn decode_component(raw: &str) -> Option<String> {
    let mut bytes = Vec::new();
    let mut input = raw.bytes();
    while let Some(b) = input.next() {
        bytes.push(match b {
            b'%' => { let a = (input.next()? as char).to_digit(16)?; let b = (input.next()? as char).to_digit(16)?; ((a << 4) | b) as u8 },
            b'+' => b' ', _ => b,
        });
    }
    String::from_utf8(bytes).ok()
}

pub fn open_link_page(raw: &str) -> Option<String> {
    if raw.len() > 16_384 { return None; }
    let raw = raw.strip_prefix("sancord://open/?").or_else(|| raw.strip_prefix("http://sancord.open/?"))?;
    let mut values = std::collections::HashMap::new();
    for entry in raw.split('&') {
        let (key, value) = entry.split_once('=')?;
        if !["endpoint", "invite", "server", "channel", "dm", "message"].contains(&key) || values.contains_key(key) { return None; }
        let value = decode_component(value)?;
        if value.len() > 4096 || value.chars().any(char::is_control) { return None; }
        values.insert(key, value);
    }
    let mut page = desktop_url(values.get("endpoint")?)?;
    for key in ["invite", "server", "channel", "dm", "message"] {
        if let Some(value) = values.get(key) { page.push_str(&format!("&{key}={}", sancord::uploads::url_encode_component(value))); }
    }
    Some(page)
}

/// Backend (origem) que um link `sancord://open/?endpoint=...` pede para usar.
pub fn link_endpoint(raw: &str) -> Option<String> {
    let page = open_link_page(raw)?;
    let query = page.split_once('?')?.1;
    let encoded = query.split('&').find_map(|kv| kv.strip_prefix("endpoint="))?;
    origin_of(&decode_component(encoded)?)
}

/// Servidores em que o usuário já confiou (local, descoberto com assinatura,
/// digitado por ele ou confirmado). Links para outros servidores pedem
/// confirmação: qualquer site pode abrir `sancord://`, e o servidor escolhido
/// recebe o login digitado na tela do app.
pub struct KnownEndpoints {
    path: std::path::PathBuf,
    list: Vec<String>,
}

impl KnownEndpoints {
    pub fn load(data_dir: &std::path::Path) -> Self {
        let path = data_dir.join("known_endpoints.json");
        let list = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|o| origin_of(&o))
            .collect();
        Self { path, list }
    }

    pub fn contains(&self, origin: &str) -> bool {
        origin_of(origin).is_some_and(|o| o == "http://localhost:3000" || self.list.contains(&o))
    }

    pub fn trust(&mut self, origin: &str) {
        let Some(o) = origin_of(origin) else { return };
        if !self.list.contains(&o) {
            self.list.push(o);
            if self.list.len() > 50 {
                self.list.remove(0);
            }
            if let Ok(json) = serde_json::to_string_pretty(&self.list) {
                let _ = std::fs::write(&self.path, json);
            }
        }
    }
}

/// Tela de conexão pedindo confirmação para abrir um link de servidor desconhecido.
pub fn confirm_page(link: &str, origin: &str) -> String {
    format!(
        "{}?confirm={}&link={}",
        super::desktop_assets::CONNECT_URL,
        sancord::uploads::url_encode_component(origin),
        sancord::uploads::url_encode_component(link)
    )
}

pub fn register_protocol() {
    if env::var("SANCORD_REGISTER_PROTOCOL").as_deref() == Ok("0") { return; }
    let Some(exe) = env::var_os("SANCORD_LAUNCHER_EXE").map(std::path::PathBuf::from)
        .or_else(|| env::current_exe().ok()) else { return; };
    let root = r"HKCU\Software\Classes\sancord";
    for args in [
        vec!["add".to_string(), root.into(), "/ve".into(), "/d".into(), "URL:Sancord".into(), "/f".into()],
        vec!["add".into(), root.into(), "/v".into(), "URL Protocol".into(), "/d".into(), String::new(), "/f".into()],
        vec!["add".into(), format!(r"{root}\shell\open\command"), "/ve".into(), "/d".into(), format!("\"{}\" \"%1\"", exe.display()), "/f".into()],
    ] {
        match Command::new("reg.exe").args(args).creation_flags(super::CREATE_NO_WINDOW).status() {
            Ok(status) if status.success() => {},
            _ => { eprintln!("Não foi possível registrar links do Sancord neste usuário."); break; },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_normalization_rejects_credentials_and_other_schemes() {
        assert_eq!(origin_of("https://ABC.trycloudflare.com/x?y").as_deref(), Some("https://abc.trycloudflare.com"));
        assert!(origin_of("javascript:alert(1)").is_none());
        assert!(origin_of("file:///C:/x").is_none());
        assert!(origin_of("https://user@evil.com").is_none());
        assert!(origin_of("http://localhost:3000\\evil").is_none());
    }
    #[test]
    fn unknown_link_endpoints_require_confirmation() {
        let dir = std::env::temp_dir().join(format!("sancord-known-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::remove_file(dir.join("known_endpoints.json"));
        let link = "sancord://open/?endpoint=https%3A%2F%2Fevil.example&invite=SANC-ABC123";
        assert_eq!(link_endpoint(link).as_deref(), Some("https://evil.example"));
        let mut known = KnownEndpoints::load(&dir);
        assert!(known.contains("http://localhost:3000"), "servidor local é sempre confiável");
        assert!(!known.contains("https://evil.example"));
        known.trust("https://Friend.trycloudflare.com/qualquer");
        assert!(KnownEndpoints::load(&dir).contains("https://friend.trycloudflare.com"), "confiança persiste");
        let page = confirm_page(link, "https://evil.example");
        assert!(page.starts_with(super::super::desktop_assets::CONNECT_URL));
        assert!(page.contains("confirm=https%3A%2F%2Fevil.example"));
    }

    #[test]
    fn links_only_load_embedded_interface() {
        let page = open_link_page("sancord://open/?endpoint=https%3A%2F%2Fexample.com&invite=SANC-ABC123").unwrap();
        assert!(page.starts_with(super::super::desktop_assets::APP_URL));
        assert!(page.contains("invite=SANC-ABC123"));
        assert!(open_link_page("sancord://evil/?endpoint=https%3A%2F%2Fexample.com").is_none());
        assert!(open_link_page("sancord://open/?endpoint=javascript%3Aalert(1)").is_none());
        assert!(open_link_page("sancord://open/?endpoint=https%3A%2F%2Fx&endpoint=https%3A%2F%2Fy").is_none());
    }
}
