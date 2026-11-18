//! Validação de dados enviados por clientes.
//!
//! O frontend insere URLs de imagem diretamente em atributos `src="..."`.
//! Antes, o servidor só checava `starts_with("data:image/")`, o que permitia
//! valores como `data:image/x" onerror="...` (XSS dentro do WebView do app
//! desktop). Aqui aceitamos apenas data URLs base64 bem formadas de tipos de
//! imagem conhecidos, ou caminhos locais simples.

pub const MAX_CHAT_IMAGE_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_PROFILE_IMAGE_BYTES: usize = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES: &[&str] = &["png", "jpeg", "jpg", "webp", "gif", "bmp", "avif"];

#[derive(Debug, PartialEq, Eq)]
pub enum ImageError {
    TooLarge,
    Invalid,
}

impl ImageError {
    pub fn user_message(&self) -> &'static str {
        match self {
            ImageError::TooLarge => "A imagem é grande demais.",
            ImageError::Invalid => "Formato de imagem inválido. Use PNG, JPEG, WEBP ou GIF.",
        }
    }
}

/// Valida uma data URL `data:image/<tipo>;base64,<dados>`.
pub fn validate_image_data_url(s: &str, max_len: usize) -> Result<(), ImageError> {
    if s.len() > max_len {
        return Err(ImageError::TooLarge);
    }
    let Some(rest) = s.strip_prefix("data:image/") else {
        return Err(ImageError::Invalid);
    };
    let Some((mime, data)) = rest.split_once(";base64,") else {
        return Err(ImageError::Invalid);
    };
    if !ALLOWED_IMAGE_TYPES.contains(&mime.to_ascii_lowercase().as_str()) {
        return Err(ImageError::Invalid);
    }
    if data.is_empty()
        || !data
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
    {
        return Err(ImageError::Invalid);
    }
    Ok(())
}

/// Aceita data URL válida ou um caminho estático local (ex.: `/logo.png`).
pub fn validate_image_or_local_path(s: &str, max_len: usize) -> Result<(), ImageError> {
    if is_safe_local_path(s) {
        return Ok(());
    }
    validate_image_data_url(s, max_len)
}

pub fn is_safe_local_path(s: &str) -> bool {
    s.starts_with('/')
        && !s.starts_with("//")
        && !s.contains("..")
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'-' | b'_'))
}

/// Cor hexadecimal `#rgb`, `#rrggbb` ou `#rrggbbaa` (usada em atributos `style`).
pub fn is_hex_color(s: &str) -> bool {
    let Some(hex) = s.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Sanitiza imagem opcional vinda de dados antigos: descarta valores inválidos.
pub fn sanitize_stored_image(v: Option<String>, max_len: usize) -> Option<String> {
    v.filter(|s| validate_image_or_local_path(s, max_len).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_data_urls() {
        assert!(validate_image_data_url("data:image/png;base64,iVBORw0KGgo=", 1000).is_ok());
        assert!(validate_image_data_url("data:image/jpeg;base64,/9j/4AAQ", 1000).is_ok());
    }

    #[test]
    fn rejects_attribute_injection() {
        let evil = "data:image/png;base64,AAAA\" onerror=\"alert(1)";
        assert_eq!(validate_image_data_url(evil, 1000), Err(ImageError::Invalid));
        assert_eq!(
            validate_image_data_url("data:image/svg+xml;base64,PHN2Zz4=", 1000),
            Err(ImageError::Invalid)
        );
        assert_eq!(validate_image_data_url("javascript:alert(1)", 1000), Err(ImageError::Invalid));
    }

    #[test]
    fn rejects_oversized() {
        let big = format!("data:image/png;base64,{}", "A".repeat(100));
        assert_eq!(validate_image_data_url(&big, 50), Err(ImageError::TooLarge));
    }

    #[test]
    fn local_paths() {
        assert!(is_safe_local_path("/logo.png"));
        assert!(!is_safe_local_path("/x\" onerror=\"y"));
        assert!(!is_safe_local_path("//evil.com/a.png"));
        assert!(!is_safe_local_path("/../secret"));
    }

    #[test]
    fn colors() {
        assert!(is_hex_color("#5865F2"));
        assert!(is_hex_color("#fff"));
        assert!(!is_hex_color("#zzz"));
        assert!(!is_hex_color("#fff;background:url(x)"));
    }
}
