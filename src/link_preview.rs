//! Etapa C1 — prévia de links (embeds) gerada no servidor.
//!
//! Depois que uma mensagem é aceita, o servidor busca as páginas dos primeiros
//! links, extrai título, descrição, site e imagem (Open Graph / <title>) e
//! atualiza a mensagem para todos. O cliente nunca acessa o site diretamente:
//! a imagem passa por `/api/link-preview/...`, presa a uma mensagem existente
//! (não é um proxy aberto) e sem expor o IP de quem lê.
//!
//! Segurança (o servidor vai buscar URLs digitadas por qualquer pessoa):
//! - só http/https, sem usuário/senha na URL;
//! - todo IP resolvido precisa ser público (bloqueia loopback, rede privada,
//!   link-local, CGNAT, multicast, reservados, IPv4 mapeado em IPv6...);
//! - a conexão é presa ao IP já verificado (`resolve`), contra DNS rebinding;
//! - redirecionamentos seguidos à mão (no máximo 3), cada um revalidado;
//! - tempo limite, corpo limitado (HTML 512 KiB, imagem 5 MiB) e só tipos esperados.
//!
//! `SANCORD_LINK_PREVIEWS=0` desliga tudo no servidor.
use crate::models::{ChatMessage, ServerMessage};
use crate::state::{ServerState, SharedState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub const MAX_LINKS: usize = 3;
/// No proxy de imagem, índices a partir daqui apontam para as prévias da cópia encaminhada.
pub const FORWARD_INDEX_BASE: usize = 100;
const MAX_HTML_BYTES: usize = 512 * 1024;
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const TIMEOUT: Duration = Duration::from_secs(6);
const CACHE_TTL_MS: i64 = 60 * 60 * 1000;
const CACHE_ENTRIES: usize = 500;
const IMAGE_CACHE_BYTES: usize = 32 * 1024 * 1024;
const USER_AGENT: &str = "SancordLinkPreview/1.0 (+self-hosted chat preview)";

/// Prévia anexada a uma mensagem. `image_url` fica guardada no servidor; o
/// cliente busca a imagem pelo proxy, usando o índice do embed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct LinkEmbed {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
}

pub fn enabled() -> bool {
    std::env::var("SANCORD_LINK_PREVIEWS").map_or(true, |v| v.trim() != "0")
}

// ---------------------------------------------------------------------------
// Links da mensagem
// ---------------------------------------------------------------------------

/// Remove blocos ``` ``` e trechos `inline`: links em código não viram prévia.
fn strip_code(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find("```") {
        out.push_str(&rest[..start]);
        match rest[start + 3..].find("```") {
            Some(end) => rest = &rest[start + 3 + end + 3..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    let mut clean = String::with_capacity(out.len());
    let mut inside = false;
    for c in out.chars() {
        if c == '`' {
            inside = !inside;
            clean.push(' ');
        } else if !inside {
            clean.push(c);
        }
    }
    clean
}

/// Primeiros links http(s) da mensagem, sem repetição. `<https://…>` (entre
/// sinais de menor/maior) não gera prévia, como em outros mensageiros.
pub fn extract_urls(content: &str) -> Vec<String> {
    let text = strip_code(content);
    let mut out: Vec<String> = Vec::new();
    for token in text.split_whitespace() {
        let Some(pos) = token.find("http://").or_else(|| token.find("https://")) else { continue };
        if token[..pos].ends_with('<') {
            continue;
        }
        let candidate = token[pos..].trim_end_matches(|c: char| ")]}>.,!?;:'\"*_~|".contains(c));
        if candidate.len() > 2000 || candidate.len() < 12 {
            continue;
        }
        let Ok(url) = reqwest::Url::parse(candidate) else { continue };
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
            continue;
        }
        let s = url.to_string();
        if !out.contains(&s) {
            out.push(s);
        }
        if out.len() == MAX_LINKS {
            break;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Proteção contra SSRF
// ---------------------------------------------------------------------------

/// Endereço roteável na internet pública? (Tudo que é local, privado ou reservado é recusado.)
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let seg = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // fc00::/7 local único
                || (seg[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
                || (seg[0] & 0xffc0) == 0xfec0 // fec0::/10 site-local (obsoleto)
                || (seg[0] == 0x2001 && seg[1] == 0x0db8) // documentação
                || (seg[0] == 0x0064 && seg[1] == 0xff9b) // NAT64 (pode apontar para IPv4 interno)
                || (seg[0..6] == [0, 0, 0, 0, 0, 0])) // IPv4 compatível (obsoleto)
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10 CGNAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // 198.18.0.0/15
        || o[0] >= 240) // reservado
}

#[cfg(test)]
pub(crate) static TEST_LOOPBACK_PORTS: Mutex<Vec<u16>> = Mutex::new(Vec::new());

fn address_allowed(addr: SocketAddr) -> bool {
    #[cfg(test)]
    if addr.ip().is_loopback() && TEST_LOOPBACK_PORTS.lock().unwrap().contains(&addr.port()) {
        return true;
    }
    is_public_ip(addr.ip())
}

/// Resolve o nome e devolve um endereço só se TODOS os resolvidos forem permitidos.
async fn resolve_checked(url: &reqwest::Url) -> Result<SocketAddr, &'static str> {
    let host = url.host_str().ok_or("sem host")?;
    let port = url.port_or_known_default().ok_or("sem porta")?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let addrs: Vec<SocketAddr> = tokio::time::timeout(TIMEOUT, tokio::net::lookup_host((host, port)))
        .await
        .map_err(|_| "DNS demorou demais")?
        .map_err(|_| "DNS falhou")?
        .collect();
    if addrs.is_empty() || !addrs.iter().all(|a| address_allowed(*a)) {
        return Err("endereço não público");
    }
    Ok(addrs[0])
}

pub struct Fetched {
    pub final_url: reqwest::Url,
    pub content_type: String,
    pub body: Vec<u8>,
}

/// GET com as travas acima. `accept_image` = só aceita imagem; senão HTML ou imagem.
pub async fn fetch_limited(start: &str, accept_image: bool, max_bytes: usize) -> Result<Fetched, &'static str> {
    let mut url = reqwest::Url::parse(start).map_err(|_| "URL inválida")?;
    for _ in 0..=MAX_REDIRECTS {
        if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
            return Err("esquema não permitido");
        }
        let addr = resolve_checked(&url).await?;
        let host = url.host_str().ok_or("sem host")?.to_string();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(TIMEOUT)
            .connect_timeout(TIMEOUT)
            .user_agent(USER_AGENT)
            .resolve(&host, addr)
            .build()
            .map_err(|_| "cliente HTTP")?;
        let accept = if accept_image { "image/png,image/jpeg,image/gif,image/webp" } else { "text/html,application/xhtml+xml,image/*;q=0.8" };
        let mut resp = client.get(url.clone()).header("Accept", accept).send().await.map_err(|_| "falha de rede")?;
        if resp.status().is_redirection() {
            let loc = resp.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or("redirecionamento sem destino")?;
            url = url.join(loc).map_err(|_| "redirecionamento inválido")?;
            continue;
        }
        if !resp.status().is_success() {
            return Err("resposta sem sucesso");
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let is_image = is_allowed_image_type(&content_type);
        let is_html = content_type == "text/html" || content_type == "application/xhtml+xml";
        if (accept_image && !is_image) || (!accept_image && !(is_html || is_image)) {
            return Err("tipo de conteúdo não aceito");
        }
        if resp.content_length().is_some_and(|n| n as usize > max_bytes) && (accept_image || is_image) {
            return Err("arquivo grande demais");
        }
        let mut body = Vec::new();
        if !(is_image && !accept_image) {
            // Página: lê só o começo (as tags <meta> ficam no <head>). Imagem: inteira, com teto.
            while let Some(chunk) = resp.chunk().await.map_err(|_| "falha ao ler")? {
                body.extend_from_slice(&chunk);
                if body.len() > max_bytes {
                    if accept_image {
                        return Err("arquivo grande demais");
                    }
                    body.truncate(max_bytes);
                    break;
                }
            }
        }
        return Ok(Fetched { final_url: url, content_type, body });
    }
    Err("redirecionamentos demais")
}

pub fn is_allowed_image_type(ct: &str) -> bool {
    matches!(ct, "image/png" | "image/jpeg" | "image/gif" | "image/webp")
}

// ---------------------------------------------------------------------------
// Leitura do HTML (sem dependências: só as tags <meta> e <title>)
// ---------------------------------------------------------------------------

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        // Procura o ';' nos primeiros caracteres (nunca corta um caractere UTF-8 ao meio).
        let Some(end) = rest.char_indices().take(12).find(|(_, c)| *c == ';').map(|(i, _)| i) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let decoded = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Atributos de uma tag (`<meta a="b" c='d' e=f>`), nomes em minúsculas.
fn tag_attributes(tag: &str) -> HashMap<String, String> {
    let mut attrs = HashMap::new();
    let bytes: Vec<char> = tag.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && !bytes[i].is_alphabetic() {
            i += 1;
        }
        let start = i;
        while i < bytes.len() && (bytes[i].is_alphanumeric() || bytes[i] == '-' || bytes[i] == ':' || bytes[i] == '_') {
            i += 1;
        }
        let name: String = bytes[start..i].iter().collect::<String>().to_ascii_lowercase();
        while i < bytes.len() && bytes[i].is_whitespace() {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == '=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_whitespace() {
                i += 1;
            }
            let value: String = if i < bytes.len() && (bytes[i] == '"' || bytes[i] == '\'') {
                let q = bytes[i];
                i += 1;
                let s = i;
                while i < bytes.len() && bytes[i] != q {
                    i += 1;
                }
                let v = bytes[s..i].iter().collect();
                i += 1;
                v
            } else {
                let s = i;
                while i < bytes.len() && !bytes[i].is_whitespace() && bytes[i] != '>' {
                    i += 1;
                }
                bytes[s..i].iter().collect()
            };
            if !name.is_empty() {
                attrs.entry(name).or_insert(value);
            }
        } else if name.is_empty() {
            i += 1;
        }
    }
    attrs
}

fn clean_text(s: &str, max: usize) -> Option<String> {
    let t: String = decode_entities(s).split_whitespace().collect::<Vec<_>>().join(" ").chars().filter(|c| !c.is_control()).collect();
    if t.is_empty() {
        return None;
    }
    if t.chars().count() > max {
        let cut: String = t.chars().take(max.saturating_sub(1)).collect();
        return Some(format!("{}…", cut.trim_end()));
    }
    Some(t)
}

/// Extrai a prévia de uma página. `None` quando não há nada útil para mostrar.
pub fn parse_html(page_url: &reqwest::Url, html: &str) -> Option<LinkEmbed> {
    let lower = html.to_ascii_lowercase();
    let mut meta: HashMap<String, String> = HashMap::new();
    let mut pos = 0;
    while let Some(i) = lower[pos..].find("<meta") {
        let start = pos + i;
        let Some(end) = lower[start..].find('>') else { break };
        let attrs = tag_attributes(&html[start + 5..start + end]);
        let key = attrs.get("property").or_else(|| attrs.get("name")).map(|k| k.to_ascii_lowercase());
        if let (Some(k), Some(v)) = (key, attrs.get("content")) {
            meta.entry(k).or_insert_with(|| v.clone());
        }
        pos = start + end;
    }
    let title_tag = lower.find("<title").and_then(|i| {
        let open_end = i + lower[i..].find('>')? + 1;
        let close = open_end + lower[open_end..].find("</title")?;
        Some(html[open_end..close].to_string())
    });
    // Ignora metadados vazios (há sites com og:title="") e segue para o próximo candidato.
    let pick = |keys: &[&str]| keys.iter().find_map(|k| meta.get(*k).filter(|v| !v.trim().is_empty()).cloned());
    let title = pick(&["og:title", "twitter:title"]).or(title_tag).and_then(|t| clean_text(&t, 200));
    let description = pick(&["og:description", "twitter:description", "description"]).and_then(|t| clean_text(&t, 300));
    let site_name = pick(&["og:site_name"]).and_then(|t| clean_text(&t, 60)).or_else(|| page_url.host_str().map(|h| h.trim_start_matches("www.").to_string()));
    let image_url = pick(&["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"])
        .map(|s| decode_entities(s.trim()))
        .and_then(|s| page_url.join(&s).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https"))
        .map(|u| u.to_string());
    if title.is_none() && description.is_none() {
        return None;
    }
    Some(LinkEmbed { url: page_url.to_string(), site_name, title, description, image_url })
}

// ---------------------------------------------------------------------------
// Cache e geração
// ---------------------------------------------------------------------------

fn preview_cache() -> &'static Mutex<HashMap<String, (i64, Option<LinkEmbed>)>> {
    static C: OnceLock<Mutex<HashMap<String, (i64, Option<LinkEmbed>)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Prévia de um link (com cache de 1 h, inclusive dos que falharam).
pub async fn preview(url: &str) -> Option<LinkEmbed> {
    let now = crate::auth::now_ms();
    if let Some((at, hit)) = preview_cache().lock().unwrap().get(url) {
        if now - at < CACHE_TTL_MS {
            return hit.clone();
        }
    }
    let result = match fetch_limited(url, false, MAX_HTML_BYTES).await {
        Ok(f) if is_allowed_image_type(&f.content_type) => Some(LinkEmbed { url: url.to_string(), image_url: Some(f.final_url.to_string()), ..Default::default() }),
        Ok(f) => parse_html(&f.final_url, &String::from_utf8_lossy(&f.body)).map(|mut e| {
            e.url = url.to_string();
            e
        }),
        Err(_) => None,
    };
    let mut cache = preview_cache().lock().unwrap();
    if cache.len() >= CACHE_ENTRIES {
        cache.retain(|_, (at, _)| now - *at < CACHE_TTL_MS);
        if cache.len() >= CACHE_ENTRIES {
            cache.clear();
        }
    }
    cache.insert(url.to_string(), (now, result.clone()));
    result
}

fn fan_out_update(st: &ServerState, channel_id: &str, message: ChatMessage) {
    if ServerState::is_private_text(channel_id) {
        st.send_to_dm_participants(channel_id, ServerMessage::MessageUpdated { message });
    } else if let Some(sid) = st.find_server_by_text_channel(channel_id).map(|s| s.id.clone()) {
        st.broadcast_to_server(&sid, ServerMessage::MessageUpdated { message });
    }
}

/// Depois de enviar ou editar: calcula as prévias em segundo plano e atualiza a
/// mensagem (só se o texto ainda for o mesmo e o resultado mudou).
pub fn spawn_for_message(state: SharedState, msg: &ChatMessage) {
    if !enabled() {
        return;
    }
    let urls = extract_urls(&msg.content);
    if urls.is_empty() && msg.embeds.is_empty() {
        return;
    }
    let (channel_id, message_id, content) = (msg.channel_id.clone(), msg.id.clone(), msg.content.clone());
    tokio::spawn(async move {
        let mut embeds = Vec::new();
        for url in &urls {
            if let Some(e) = preview(url).await {
                embeds.push(e);
            }
        }
        let fallback = crate::ws::fetch_message_for_mutation(&state, &channel_id, &message_id).await;
        let mut st = state.write().await;
        let updated = crate::ws::mutate_message(&mut st, &channel_id, &message_id, fallback, |m| {
            if m.content != content || m.embeds == embeds {
                return false;
            }
            m.embeds = embeds;
            true
        });
        if let Some(message) = updated {
            fan_out_update(&st, &channel_id, message);
        }
    });
}

// ---------------------------------------------------------------------------
// Proxy de imagem: GET /api/link-preview/:channel/:message/:index
// ---------------------------------------------------------------------------

fn image_cache() -> &'static Mutex<(usize, HashMap<String, (String, Vec<u8>)>)> {
    static C: OnceLock<Mutex<(usize, HashMap<String, (String, Vec<u8>)>)>> = OnceLock::new();
    C.get_or_init(|| Mutex::new((0, HashMap::new())))
}

pub async fn image_handler(
    axum::extract::State(state): axum::extract::State<SharedState>,
    axum::extract::Path((channel_id, message_id, index)): axum::extract::Path<(String, String, usize)>,
) -> axum::response::Response {
    use axum::http::{header, StatusCode};
    use axum::response::IntoResponse;
    let not_found = || (StatusCode::NOT_FOUND, "Imagem indisponível").into_response();
    // Índices 0..3: prévias da mensagem; 100..103: prévias da cópia encaminhada.
    let in_forward = index >= FORWARD_INDEX_BASE;
    let slot = if in_forward { index - FORWARD_INDEX_BASE } else { index };
    if !enabled() || slot >= MAX_LINKS {
        return not_found();
    }
    // Só URLs que o próprio servidor gravou numa mensagem: não é um proxy aberto.
    let Some(msg) = crate::ws::fetch_message_for_mutation(&state, &channel_id, &message_id).await else { return not_found() };
    let list = if in_forward { msg.forward.as_ref().map(|f| f.embeds.clone()).unwrap_or_default() } else { msg.embeds.clone() };
    let Some(src) = list.get(slot).and_then(|e| e.image_url.clone()) else { return not_found() };
    let cached = image_cache().lock().unwrap().1.get(&src).cloned();
    let (ct, bytes) = match cached {
        Some(hit) => hit,
        None => match fetch_limited(&src, true, MAX_IMAGE_BYTES).await {
            Ok(f) => {
                let entry = (f.content_type.clone(), f.body);
                let mut cache = image_cache().lock().unwrap();
                if cache.0 + entry.1.len() > IMAGE_CACHE_BYTES {
                    cache.1.clear();
                    cache.0 = 0;
                }
                cache.0 += entry.1.len();
                cache.1.insert(src.clone(), entry.clone());
                entry
            }
            Err(_) => return not_found(),
        },
    };
    ([(header::CONTENT_TYPE, ct)], bytes).into_response()
}
