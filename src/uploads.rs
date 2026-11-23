//! Anexos: upload por HTTP e download seguro.
//!
//! Por que HTTP e não WebSocket: arquivos grandes em base64 pelo WebSocket
//! inflavam 33%, bloqueavam a fila de eventos e não permitiam progresso.
//! Agora o cliente faz `POST /api/attachments?filename=...` com o corpo cru
//! (o XHR informa o progresso) e manda só o ID na mensagem.
//!
//! Segurança:
//! - O tipo do arquivo é identificado pelos primeiros bytes (assinatura), não
//!   pelo nome/Content-Type enviados. Só imagens/vídeos/áudios conhecidos são
//!   exibidos "inline"; todo o resto é servido como download
//!   (`application/octet-stream` + `Content-Disposition: attachment`).
//! - Nunca servimos HTML/SVG/JS inline; respostas levam `nosniff` e
//!   `Content-Security-Policy: sandbox` como defesa extra.
//! - O caminho em disco é derivado só do ID (UUID) e da extensão detectada:
//!   o nome enviado pelo usuário nunca vira caminho (sem path traversal).
//! - IDs são UUIDv4 (122 bits aleatórios): funcionam como URL de capacidade.

use crate::db::{AttachmentRecord, WriteOp};
use crate::state::SharedState;
use axum::body::{Body, Bytes};
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tower::ServiceExt;
use tracing::{error, warn};

pub const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;
const UPLOADS_PER_MINUTE: usize = 30;

/// Tipo detectado: (content-type, kind, extensão em disco).
pub fn sniff(bytes: &[u8]) -> (&'static str, &'static str, &'static str) {
    let starts = |sig: &[u8]| bytes.starts_with(sig);
    let at = |off: usize, sig: &[u8]| bytes.len() >= off + sig.len() && &bytes[off..off + sig.len()] == sig;
    if starts(b"\x89PNG\r\n\x1a\n") {
        ("image/png", "image", "png")
    } else if starts(&[0xFF, 0xD8, 0xFF]) {
        ("image/jpeg", "image", "jpg")
    } else if starts(b"GIF87a") || starts(b"GIF89a") {
        ("image/gif", "image", "gif")
    } else if starts(b"RIFF") && at(8, b"WEBP") {
        ("image/webp", "image", "webp")
    } else if starts(b"BM") && bytes.len() > 26 {
        ("image/bmp", "image", "bmp")
    } else if at(4, b"ftyp") {
        // MP4/MOV/M4A: a "marca" diz se é áudio.
        if at(8, b"M4A ") || at(8, b"M4B ") {
            ("audio/mp4", "audio", "m4a")
        } else if at(8, b"qt  ") {
            ("video/quicktime", "video", "mov")
        } else {
            ("video/mp4", "video", "mp4")
        }
    } else if starts(&[0x1A, 0x45, 0xDF, 0xA3]) {
        ("video/webm", "video", "webm")
    } else if starts(b"OggS") {
        ("audio/ogg", "audio", "ogg")
    } else if starts(b"ID3") || (bytes.len() > 1 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0) {
        ("audio/mpeg", "audio", "mp3")
    } else if starts(b"RIFF") && at(8, b"WAVE") {
        ("audio/wav", "audio", "wav")
    } else if starts(b"fLaC") {
        ("audio/flac", "audio", "flac")
    } else if starts(b"%PDF-") {
        ("application/pdf", "file", "pdf")
    } else if starts(b"PK\x03\x04") {
        ("application/zip", "file", "zip")
    } else if starts(b"Rar!\x1a\x07") {
        ("application/vnd.rar", "file", "rar")
    } else if starts(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
        ("application/x-7z-compressed", "file", "7z")
    } else if starts(&[0x1F, 0x8B]) {
        ("application/gzip", "file", "gz")
    } else if looks_like_text(bytes) {
        // Texto é baixado como arquivo (nunca renderizado como HTML).
        ("text/plain; charset=utf-8", "file", "txt")
    } else {
        ("application/octet-stream", "file", "bin")
    }
}

fn looks_like_text(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(4096)];
    !sample.is_empty() && std::str::from_utf8(sample).is_ok() && !sample.contains(&0)
}

/// Dimensões de PNG, GIF, JPEG e WebP sem decodificar a imagem.
pub fn image_dimensions(bytes: &[u8], content_type: &str) -> Option<(u32, u32)> {
    let be16 = |o: usize| bytes.get(o..o + 2).map(|b| u16::from_be_bytes([b[0], b[1]]) as u32);
    let le16 = |o: usize| bytes.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as u32);
    let be32 = |o: usize| bytes.get(o..o + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]));
    match content_type {
        "image/png" => Some((be32(16)?, be32(20)?)),
        "image/gif" => Some((le16(6)?, le16(8)?)),
        "image/webp" => match bytes.get(12..16)? {
            b"VP8X" => {
                let w = 1 + (bytes.get(24..27)?.iter().rev().fold(0u32, |a, b| (a << 8) | *b as u32));
                let h = 1 + (bytes.get(27..30)?.iter().rev().fold(0u32, |a, b| (a << 8) | *b as u32));
                Some((w, h))
            }
            b"VP8 " => Some((le16(26)? & 0x3FFF, le16(28)? & 0x3FFF)),
            b"VP8L" => {
                let b = bytes.get(21..25)?;
                let bits = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                Some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
            }
            _ => None,
        },
        "image/jpeg" => {
            // Percorre os segmentos até o SOFn.
            let mut i = 2;
            while i + 9 < bytes.len() {
                if bytes[i] != 0xFF {
                    i += 1;
                    continue;
                }
                let marker = bytes[i + 1];
                if (0xC0..=0xCF).contains(&marker) && ![0xC4, 0xC8, 0xCC].contains(&marker) {
                    return Some((be16(i + 7)?, be16(i + 5)?));
                }
                let len = be16(i + 2)? as usize;
                i += 2 + len;
            }
            None
        }
        _ => None,
    }
}

/// Nome de arquivo seguro para exibição/download (sem caminhos nem caracteres de controle).
pub fn sanitize_filename(raw: &str, ext: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let mut name: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .chars()
        .take(120)
        .collect();
    if name.is_empty() {
        name = format!("arquivo.{ext}");
    }
    name
}

/// Codificação percentual (RFC 3986) para usar o nome do arquivo na URL.
pub fn url_encode_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn disk_path(data_dir: &Path, id: &str, ext: &str) -> PathBuf {
    let shard: String = id.chars().take(2).collect();
    data_dir.join("uploads").join(shard).join(format!("{id}.{ext}"))
}

pub(crate) fn write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "ok": false, "message": message }))).into_response()
}

#[derive(serde::Deserialize)]
pub struct UploadQuery {
    #[serde(default)]
    filename: Option<String>,
    presentation: Option<String>,
}

/// `POST /api/attachments?filename=nome.ext` com `Authorization: Bearer <token>`.
pub async fn upload_handler(
    State(state): State<SharedState>,
    Query(q): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("")
        .to_string();
    let now = crate::auth::now_ms();
    let (account, data_dir) = {
        let mut st = state.write().await;
        let Some((_, acc)) = st.validate_session(&token) else {
            return json_error(StatusCode::UNAUTHORIZED, "Sessão inválida. Entre novamente.");
        };
        let recent = st
            .upload_times
            .entry(acc.id.clone())
            .or_default();
        recent.retain(|t| now - *t < 60_000);
        if recent.len() >= UPLOADS_PER_MINUTE {
            return json_error(StatusCode::TOO_MANY_REQUESTS, "Muitos envios seguidos. Aguarde um minuto.");
        }
        recent.push(now);
        (acc, st.config.data_dir.clone())
    };
    if body.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "Arquivo vazio.");
    }
    if body.len() > MAX_UPLOAD_BYTES {
        return json_error(StatusCode::PAYLOAD_TOO_LARGE, "O arquivo passa do limite de 25 MB.");
    }

    let (detected_type, detected_kind, ext) = sniff(&body);
    let dims = if detected_kind == "image" { image_dimensions(&body, detected_type) } else { None };
    let (content_type, kind) = match q.presentation.as_deref() {
        None => (detected_type, detected_kind),
        Some("sticker") if matches!(detected_type, "image/png" | "image/webp" | "image/gif")
            && dims.is_some_and(|(w, h)| w > 0 && h > 0 && w <= 512 && h <= 512)
            && body.len() <= 2 * 1024 * 1024 => (detected_type, "sticker"),
        Some("sticker") => return json_error(StatusCode::BAD_REQUEST, "Use PNG, WebP ou GIF de até 512 × 512 pixels e 2 MB."),
        Some("voice") if detected_kind == "audio" => (detected_type, "voice"),
        Some("voice") if detected_type == "video/webm" => ("audio/webm", "voice"),
        Some("voice") => return json_error(StatusCode::BAD_REQUEST, "Formato de gravação incompatível."),
        Some(_) => return json_error(StatusCode::BAD_REQUEST, "Formato de anexo desconhecido."),
    };
    let id = uuid::Uuid::new_v4().simple().to_string();
    let filename = sanitize_filename(q.filename.as_deref().unwrap_or(""), ext);
    let path = disk_path(&data_dir, &id, ext);

    // Hash + gravação fora do runtime async (arquivo pode ter dezenas de MB).
    let data = body.clone();
    let write_path = path.clone();
    let written = tokio::task::spawn_blocking(move || -> std::io::Result<String> {
        let digest = hex::encode(Sha256::digest(&data));
        write_file(&write_path, &data)?;
        Ok(digest)
    })
    .await;
    let sha256 = match written {
        Ok(Ok(d)) => d,
        other => {
            error!("Falha ao gravar anexo {}: {other:?}", path.display());
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Não foi possível salvar o arquivo.");
        }
    };

    let record = AttachmentRecord {
        id,
        uploader_id: account.id.clone(),
        uploader_lower: account.username.to_lowercase(),
        filename,
        content_type: content_type.to_string(),
        kind: kind.to_string(),
        size: body.len() as u64,
        width: dims.map(|d| d.0),
        height: dims.map(|d| d.1),
        sha256,
        ext: ext.to_string(),
        created_at: now,
    };
    let public = record.to_public();
    {
        let mut st = state.write().await;
        st.db.write(WriteOp::InsertAttachment(Box::new(record.clone())));
        st.attachments.insert(record.id.clone(), record);
    }
    (StatusCode::OK, Json(serde_json::json!({ "ok": true, "attachment": public }))).into_response()
}

/// `GET /api/attachments/:id/:filename` — serve o arquivo (com suporte a Range).
pub async fn download_handler(
    State(state): State<SharedState>,
    AxumPath((id, _name)): AxumPath<(String, String)>,
    req: Request<Body>,
) -> Response {
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let (record, data_dir) = {
        let st = state.read().await;
        match st.attachments.get(&id) {
            Some(r) => (r.clone(), st.config.data_dir.clone()),
            None => return StatusCode::NOT_FOUND.into_response(),
        }
    };
    let path = disk_path(&data_dir, &record.id, &record.ext);
    let inline = matches!(record.kind.as_str(), "image" | "video" | "audio" | "sticker" | "voice");
    serve_file(path, req, &record.filename, &record.content_type, inline, false).await
}

pub(crate) async fn serve_file(
    path: PathBuf, req: Request<Body>, filename: &str, mime: &str, inline: bool, authenticated: bool,
) -> Response {
    let mut res = match tower_http::services::ServeFile::new(&path).oneshot(req).await {
        Ok(r) => r.into_response(),
        Err(e) => {
            warn!("Falha ao servir anexo: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    if !res.status().is_success() && res.status() != StatusCode::PARTIAL_CONTENT && res.status() != StatusCode::NOT_MODIFIED {
        return res;
    }
    let headers = res.headers_mut();
    let ct = if inline { mime } else { "application/octet-stream" };
    if let Ok(v) = HeaderValue::from_str(ct) {
        headers.insert(header::CONTENT_TYPE, v);
    }
    let disposition = format!(
        "{}; filename*=UTF-8''{}",
        if inline { "inline" } else { "attachment" },
        url_encode_component(filename)
    );
    if let Ok(v) = HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    // O conteúdo de um ID nunca muda: o cliente pode guardar em cache para sempre.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if authenticated { "private, no-store" } else { "private, max-age=31536000, immutable" }),
    );
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_by_content_not_name() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n....").0, "image/png");
        assert_eq!(sniff(b"GIF89a....").1, "image");
        assert_eq!(sniff(b"%PDF-1.7").0, "application/pdf");
        assert_eq!(sniff(b"PK\x03\x04rest").2, "zip");
        // HTML nunca é tratado como algo exibível.
        let (ct, kind, _) = sniff(b"<html><script>alert(1)</script></html>");
        assert_eq!(kind, "file");
        assert!(ct.starts_with("text/plain"));
        assert_eq!(sniff(&[0u8, 1, 2, 3, 0]).0, "application/octet-stream");
        let svg = sniff(b"<svg xmlns='http://www.w3.org/2000/svg' onload='x'/>");
        assert_eq!(svg.1, "file", "SVG não é exibido inline");
    }

    #[test]
    fn png_and_gif_dimensions() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&640u32.to_be_bytes());
        png.extend_from_slice(&480u32.to_be_bytes());
        assert_eq!(image_dimensions(&png, "image/png"), Some((640, 480)));
        let mut gif = b"GIF89a".to_vec();
        gif.extend_from_slice(&320u16.to_le_bytes());
        gif.extend_from_slice(&200u16.to_le_bytes());
        assert_eq!(image_dimensions(&gif, "image/gif"), Some((320, 200)));
    }

    #[test]
    fn filenames_are_sanitized() {
        assert_eq!(sanitize_filename("../../etc/passwd", "txt"), "passwd");
        assert_eq!(sanitize_filename("C:\\Users\\x\\foto.png", "png"), "foto.png");
        assert_eq!(sanitize_filename("<script>.html", "txt"), "script.html");
        assert_eq!(sanitize_filename("", "pdf"), "arquivo.pdf");
        assert_eq!(url_encode_component("relatório final.pdf"), "relat%C3%B3rio%20final.pdf");
    }
}
