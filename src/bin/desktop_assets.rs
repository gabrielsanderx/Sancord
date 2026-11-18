//! Recursos compilados no cliente. Nenhuma leitura da pasta static em execução.
use std::borrow::Cow;
use wry::http::{Method, Request, Response, StatusCode};

pub const APP_URL: &str = "sancord://localhost/index.html";
pub const CONNECT_URL: &str = "sancord://localhost/connect.html";
pub const APP_ORIGIN: &str = "http://sancord.localhost";

pub fn is_app_page(url: &str) -> bool {
    ["sancord://localhost/", "http://sancord.localhost/"].iter().any(|base| url.starts_with(base))
}

pub fn response(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let (bytes, mime): (&'static [u8], &str) = match request.uri().path() {
        "/" | "/index.html" => (include_bytes!("../../static/index.html"), "text/html; charset=utf-8"),
        "/connect.html" => (super::LOADER_HTML.as_bytes(), "text/html; charset=utf-8"),
        "/styles.css" => (include_bytes!("../../static/styles.css"), "text/css; charset=utf-8"),
        "/ui.css" => (include_bytes!("../../static/ui.css"), "text/css; charset=utf-8"),
        "/app.js" => (include_bytes!("../../static/app.js"), "text/javascript; charset=utf-8"),
        "/js/transport.js" => (include_bytes!("../../static/js/transport.js"), "text/javascript; charset=utf-8"),
        "/js/i18n.js" => (include_bytes!("../../static/js/i18n.js"), "text/javascript; charset=utf-8"),
        "/js/ui-kit.js" => (include_bytes!("../../static/js/ui-kit.js"), "text/javascript; charset=utf-8"),
        "/js/icons.js" => (include_bytes!("../../static/js/icons.js"), "text/javascript; charset=utf-8"),
        "/js/servers.js" => (include_bytes!("../../static/js/servers.js"), "text/javascript; charset=utf-8"),
        "/js/permissions.js" => (include_bytes!("../../static/js/permissions.js"), "text/javascript; charset=utf-8"),
        "/js/chat.js" => (include_bytes!("../../static/js/chat.js"), "text/javascript; charset=utf-8"),
        "/js/social.js" => (include_bytes!("../../static/js/social.js"), "text/javascript; charset=utf-8"),
        "/js/voice.js" => (include_bytes!("../../static/js/voice.js"), "text/javascript; charset=utf-8"),
        "/js/advanced.js" => (include_bytes!("../../static/js/advanced.js"), "text/javascript; charset=utf-8"),
        "/js/integrations.js" => (include_bytes!("../../static/js/integrations.js"), "text/javascript; charset=utf-8"),
        "/js/community.js" => (include_bytes!("../../static/js/community.js"), "text/javascript; charset=utf-8"),
        "/js/threads.js" => (include_bytes!("../../static/js/threads.js"), "text/javascript; charset=utf-8"),
        "/js/polish.js" => (include_bytes!("../../static/js/polish.js"), "text/javascript; charset=utf-8"),
        "/js/updater.js" => (include_bytes!("../../static/js/updater.js"), "text/javascript; charset=utf-8"),
        "/logo.png" => (include_bytes!("../../static/logo.png"), "image/png"),
        "/sancord-icon.svg" => (include_bytes!("../../static/sancord-icon.svg"), "image/svg+xml"),
        _ => return Response::builder().status(StatusCode::NOT_FOUND).body(Cow::Borrowed(&b"Recurso interno inexistente"[..])).unwrap_or_default(),
    };
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return Response::builder().status(StatusCode::METHOD_NOT_ALLOWED).body(Cow::Borrowed(&b""[..])).unwrap_or_default();
    }
    Response::builder()
        .header("Content-Type", mime)
        .header("Cache-Control", "no-cache")
        .header("X-Content-Type-Options", "nosniff")
        .body(if request.method() == Method::HEAD { Cow::Borrowed(&b""[..]) } else { Cow::Borrowed(bytes) })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assets_are_embedded_and_routes_are_closed() {
        let res = response(Request::get("sancord://localhost/index.html").body(vec![]).unwrap());
        assert_eq!(res.status(), StatusCode::OK);
        assert!(String::from_utf8_lossy(res.body()).contains("transport.js"));
        for line in String::from_utf8_lossy(res.body()).lines().filter(|l| l.contains("<script src=\"")) {
            let src = line.split("src=\"").nth(1).unwrap().split('"').next().unwrap();
            let asset = response(Request::get(src).body(vec![]).unwrap());
            assert_eq!(asset.status(), StatusCode::OK, "Script sem recurso embutido: {src}");
        }
        for line in String::from_utf8_lossy(res.body()).lines().filter(|l| l.contains("rel=\"stylesheet\"")) {
            let href = line.split("href=\"").nth(1).unwrap().split('"').next().unwrap();
            let sheet = response(Request::get(href).body(vec![]).unwrap());
            assert_eq!(sheet.status(), StatusCode::OK, "Estilo sem recurso embutido: {href}");
            assert_eq!(sheet.headers()["Content-Type"], "text/css; charset=utf-8");
        }
        for path in ["/../Cargo.toml", "/api/login", "/data/sancord.db"] {
            assert_eq!(response(Request::get(path).body(vec![]).unwrap()).status(), StatusCode::NOT_FOUND);
        }
    }
    #[test]
    fn updater_is_available_before_backend_connection() {
        let page = response(Request::get(CONNECT_URL).body(vec![]).unwrap());
        let html = String::from_utf8_lossy(page.body());
        assert!(html.contains("src=\"/js/updater.js\""));
        assert!(html.contains("href=\"/styles.css\""));
        assert_eq!(response(Request::get("/js/updater.js").body(vec![]).unwrap()).status(), StatusCode::OK);
    }
    #[test]
    fn remote_pages_never_become_app_pages() {
        assert!(is_app_page(APP_URL));
        assert!(is_app_page("http://sancord.localhost/index.html?endpoint=http%3A%2F%2Flocalhost%3A3000"));
        assert!(!is_app_page("https://remote.trycloudflare.com/"));
        assert!(!is_app_page("http://sancord.localhost.evil/index.html"));
    }
}
