//! Recursos compilados no cliente. Nenhuma leitura da pasta static em execução.
use std::borrow::Cow;
use wry::http::{Method, Request, Response, StatusCode};

// LEGACY COMPATIBILITY: partição interna de origin do WebView2 preservada para não invalidar
// o localStorage existente de usuários migrados do Sancord para o Sanvo.
pub const APP_URL: &str = "sancord://localhost/index.html";
pub const CONNECT_URL: &str = "sancord://localhost/connect.html";
pub const APP_ORIGIN: &str = "http://sancord.localhost";

pub fn is_app_page(url: &str) -> bool {
    [
        "sancord://localhost/",
        "http://sancord.localhost/",
        "sanvo://localhost/",
        "http://sanvo.localhost/",
    ]
    .iter()
    .any(|base| url.starts_with(base))
}

pub fn response(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let (bytes, mime): (&'static [u8], &str) = match request.uri().path() {
        "/" | "/index.html" => (include_bytes!("../../static/index.html"), "text/html; charset=utf-8"),
        "/connect.html" => (super::LOADER_HTML.as_bytes(), "text/html; charset=utf-8"),
        "/styles.css" => (include_bytes!("../../static/styles.css"), "text/css; charset=utf-8"),
        "/ui.css" => (include_bytes!("../../static/ui.css"), "text/css; charset=utf-8"),
        "/cosmetics/cosmetics.css" => (include_bytes!("../../static/cosmetics/cosmetics.css"), "text/css; charset=utf-8"),
        "/cosmetics/cosmetics-vfx.js" => (include_bytes!("../../static/cosmetics/cosmetics-vfx.js"), "text/javascript; charset=utf-8"),
        "/cosmetics/cosmetics-engine.js" => (include_bytes!("../../static/cosmetics/cosmetics-engine.js"), "text/javascript; charset=utf-8"),
        "/app.js" => (include_bytes!("../../static/app.js"), "text/javascript; charset=utf-8"),
        "/js/transport.js" => (include_bytes!("../../static/js/transport.js"), "text/javascript; charset=utf-8"),
        "/js/connection.js" => (include_bytes!("../../static/js/connection.js"), "text/javascript; charset=utf-8"),
        "/js/outbox.js" => (include_bytes!("../../static/js/outbox.js"), "text/javascript; charset=utf-8"),
        "/js/offline-cache.js" => (include_bytes!("../../static/js/offline-cache.js"), "text/javascript; charset=utf-8"),
        "/js/auth-storage.js" => (include_bytes!("../../static/js/auth-storage.js"), "text/javascript; charset=utf-8"),
        "/js/auth-screen.js" => (include_bytes!("../../static/js/auth-screen.js"), "text/javascript; charset=utf-8"),
        "/js/i18n.js" => (include_bytes!("../../static/js/i18n.js"), "text/javascript; charset=utf-8"),
        "/js/ui-kit.js" => (include_bytes!("../../static/js/ui-kit.js"), "text/javascript; charset=utf-8"),
        "/js/icons.js" => (include_bytes!("../../static/js/icons.js"), "text/javascript; charset=utf-8"),
        "/js/servers.js" => (include_bytes!("../../static/js/servers.js"), "text/javascript; charset=utf-8"),
        "/js/invites.js" => (include_bytes!("../../static/js/invites.js"), "text/javascript; charset=utf-8"),
        "/js/member-list.js" => (include_bytes!("../../static/js/member-list.js"), "text/javascript; charset=utf-8"),
        "/js/permissions.js" => (include_bytes!("../../static/js/permissions.js"), "text/javascript; charset=utf-8"),
        "/js/chat.js" => (include_bytes!("../../static/js/chat.js"), "text/javascript; charset=utf-8"),
        "/js/notification-manager.js" => (include_bytes!("../../static/js/notification-manager.js"), "text/javascript; charset=utf-8"),
        "/js/composer.js" => (include_bytes!("../../static/js/composer.js"), "text/javascript; charset=utf-8"),
        "/js/stickers.js" => (include_bytes!("../../static/js/stickers.js"), "text/javascript; charset=utf-8"),
        "/js/voice-recorder.js" => (include_bytes!("../../static/js/voice-recorder.js"), "text/javascript; charset=utf-8"),
        "/js/scheduled.js" => (include_bytes!("../../static/js/scheduled.js"), "text/javascript; charset=utf-8"),
        "/js/sanoted-storage.js" => (include_bytes!("../../static/js/sanoted-storage.js"), "text/javascript; charset=utf-8"),
        "/js/sanoted-editor.js" => (include_bytes!("../../static/js/sanoted-editor.js"), "text/javascript; charset=utf-8"),
        "/js/sanoted.js" => (include_bytes!("../../static/js/sanoted.js"), "text/javascript; charset=utf-8"),
        "/js/social.js" => (include_bytes!("../../static/js/social.js"), "text/javascript; charset=utf-8"),
        "/js/sound-manager.js" => (include_bytes!("../../static/js/sound-manager.js"), "text/javascript; charset=utf-8"),
        "/js/voice-event-sounds.js" => (include_bytes!("../../static/js/voice-event-sounds.js"), "text/javascript; charset=utf-8"),
        "/js/voice-dsp-core.js" => (include_bytes!("../../static/js/voice-dsp-core.js"), "text/javascript; charset=utf-8"),
        "/js/voice-dsp-worklet.js" => (include_bytes!("../../static/js/voice-dsp-worklet.js"), "text/javascript; charset=utf-8"),
        "/js/voice.js" => (include_bytes!("../../static/js/voice.js"), "text/javascript; charset=utf-8"),
        "/js/advanced.js" => (include_bytes!("../../static/js/advanced.js"), "text/javascript; charset=utf-8"),
        "/js/search.js" => (include_bytes!("../../static/js/search.js"), "text/javascript; charset=utf-8"),
        "/js/integrations.js" => (include_bytes!("../../static/js/integrations.js"), "text/javascript; charset=utf-8"),
        "/js/community.js" => (include_bytes!("../../static/js/community.js"), "text/javascript; charset=utf-8"),
        "/js/threads.js" => (include_bytes!("../../static/js/threads.js"), "text/javascript; charset=utf-8"),
        "/js/polish.js" => (include_bytes!("../../static/js/polish.js"), "text/javascript; charset=utf-8"),
        "/js/profile.js" => (include_bytes!("../../static/js/profile.js"), "text/javascript; charset=utf-8"),
        "/js/profile-card.js" => (include_bytes!("../../static/js/profile-card.js"), "text/javascript; charset=utf-8"),
        "/js/profile-motion.js" => (include_bytes!("../../static/js/profile-motion.js"), "text/javascript; charset=utf-8"),
        "/js/game-picker.js" => (include_bytes!("../../static/js/game-picker.js"), "text/javascript; charset=utf-8"),
        "/js/profile-board.js" => (include_bytes!("../../static/js/profile-board.js"), "text/javascript; charset=utf-8"),
        "/js/profile-collection.js" => (include_bytes!("../../static/js/profile-collection.js"), "text/javascript; charset=utf-8"),
        "/js/profile-sharing.js" => (include_bytes!("../../static/js/profile-sharing.js"), "text/javascript; charset=utf-8"),
        "/js/settings-center.js" => (include_bytes!("../../static/js/settings-center.js"), "text/javascript; charset=utf-8"),
        "/js/profile-editor.js" => (include_bytes!("../../static/js/profile-editor.js"), "text/javascript; charset=utf-8"),
        "/js/self-profile-menu.js" => (include_bytes!("../../static/js/self-profile-menu.js"), "text/javascript; charset=utf-8"),
        "/js/dm-context-menu.js" => (include_bytes!("../../static/js/dm-context-menu.js"), "text/javascript; charset=utf-8"),
        "/js/activity.js" => (include_bytes!("../../static/js/activity.js"), "text/javascript; charset=utf-8"),
        "/js/updater.js" => (include_bytes!("../../static/js/updater.js"), "text/javascript; charset=utf-8"),
        "/logo.png" => (include_bytes!("../../static/logo.png"), "image/png"),
        "/sanvo-icon.svg" | "/sancord-icon.svg" => (include_bytes!("../../static/sanvo-icon.svg"), "image/svg+xml"),
        "/assets/sounds/voice/join.wav" => (include_bytes!("../../static/assets/sounds/voice/join.wav"), "audio/wav"),
        "/assets/sounds/voice/leave.wav" => (include_bytes!("../../static/assets/sounds/voice/leave.wav"), "audio/wav"),
        "/assets/sounds/voice/connected.wav" => (include_bytes!("../../static/assets/sounds/voice/connected.wav"), "audio/wav"),
        "/assets/sounds/voice/disconnected.wav" => (include_bytes!("../../static/assets/sounds/voice/disconnected.wav"), "audio/wav"),
        "/assets/sounds/voice/reconnected.wav" => (include_bytes!("../../static/assets/sounds/voice/reconnected.wav"), "audio/wav"),
        "/assets/sounds/stream/start.wav" => (include_bytes!("../../static/assets/sounds/stream/start.wav"), "audio/wav"),
        "/assets/sounds/stream/stop.wav" => (include_bytes!("../../static/assets/sounds/stream/stop.wav"), "audio/wav"),
        "/assets/sounds/camera/on.wav" => (include_bytes!("../../static/assets/sounds/camera/on.wav"), "audio/wav"),
        "/assets/sounds/camera/off.wav" => (include_bytes!("../../static/assets/sounds/camera/off.wav"), "audio/wav"),
        "/assets/sounds/controls/mute.wav" => (include_bytes!("../../static/assets/sounds/controls/mute.wav"), "audio/wav"),
        "/assets/sounds/controls/unmute.wav" => (include_bytes!("../../static/assets/sounds/controls/unmute.wav"), "audio/wav"),
        "/assets/sounds/controls/deafen.wav" => (include_bytes!("../../static/assets/sounds/controls/deafen.wav"), "audio/wav"),
        "/assets/sounds/controls/undeafen.wav" => (include_bytes!("../../static/assets/sounds/controls/undeafen.wav"), "audio/wav"),
        "/assets/sounds/calls/incoming.wav" => (include_bytes!("../../static/assets/sounds/calls/incoming.wav"), "audio/wav"),
        "/assets/sounds/calls/outgoing.wav" => (include_bytes!("../../static/assets/sounds/calls/outgoing.wav"), "audio/wav"),
        "/assets/sounds/errors/voice_error.wav" => (include_bytes!("../../static/assets/sounds/errors/voice_error.wav"), "audio/wav"),
        "/assets/sounds/notifications/message_received.wav" => (include_bytes!("../../static/assets/sounds/notifications/message_received.wav"), "audio/wav"),
        "/cosmetics/assets/deco_astral_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_astral_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_astral_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_astral_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_sakura_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_sakura_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_sakura_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_sakura_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_frost_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_frost_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_frost_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_frost_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_cyber_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_cyber_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_cyber_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_cyber_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_cyber_blink.webp" => (include_bytes!("../../static/cosmetics/assets/deco_cyber_blink.webp"), "image/webp"),
        "/cosmetics/assets/frame_astral_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_astral_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_astral_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_astral_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_astral_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_astral_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_sakura_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_sakura_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_sakura_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_sakura_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_sakura_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_sakura_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_frost_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_frost_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_frost_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_frost_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_frost_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_frost_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_cyber_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_cyber_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_cyber_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_cyber_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_cyber_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_cyber_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_founder_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_founder_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_dev_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_dev_tl.webp"), "image/webp"),
        "/cosmetics/assets/fx_astral_comet.webp" => (include_bytes!("../../static/cosmetics/assets/fx_astral_comet.webp"), "image/webp"),
        "/cosmetics/assets/fx_sakura_petal.webp" => (include_bytes!("../../static/cosmetics/assets/fx_sakura_petal.webp"), "image/webp"),
        "/cosmetics/assets/fx_sakura_blossom.webp" => (include_bytes!("../../static/cosmetics/assets/fx_sakura_blossom.webp"), "image/webp"),
        "/cosmetics/assets/fx_frost_crystal.webp" => (include_bytes!("../../static/cosmetics/assets/fx_frost_crystal.webp"), "image/webp"),
        "/cosmetics/assets/fx_cyber_prism.webp" => (include_bytes!("../../static/cosmetics/assets/fx_cyber_prism.webp"), "image/webp"),
        "/cosmetics/assets/deco_infernal_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_infernal_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_infernal_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_infernal_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_arcane_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_arcane_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_arcane_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_arcane_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_abyssal_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_abyssal_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_abyssal_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_abyssal_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_seraph_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_seraph_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_seraph_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_seraph_front.webp"), "image/webp"),
        "/cosmetics/assets/deco_sovereign_back.webp" => (include_bytes!("../../static/cosmetics/assets/deco_sovereign_back.webp"), "image/webp"),
        "/cosmetics/assets/deco_sovereign_front.webp" => (include_bytes!("../../static/cosmetics/assets/deco_sovereign_front.webp"), "image/webp"),
        "/cosmetics/assets/frame_infernal_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_infernal_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_infernal_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_infernal_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_infernal_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_infernal_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_arcane_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_arcane_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_arcane_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_arcane_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_arcane_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_arcane_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_abyssal_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_abyssal_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_abyssal_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_abyssal_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_abyssal_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_abyssal_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_seraph_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_seraph_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_seraph_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_seraph_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_seraph_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_seraph_br.webp"), "image/webp"),
        "/cosmetics/assets/frame_sovereign_tl.webp" => (include_bytes!("../../static/cosmetics/assets/frame_sovereign_tl.webp"), "image/webp"),
        "/cosmetics/assets/frame_sovereign_tr.webp" => (include_bytes!("../../static/cosmetics/assets/frame_sovereign_tr.webp"), "image/webp"),
        "/cosmetics/assets/frame_sovereign_br.webp" => (include_bytes!("../../static/cosmetics/assets/frame_sovereign_br.webp"), "image/webp"),
        "/cosmetics/assets/fx_infernal_ember.webp" => (include_bytes!("../../static/cosmetics/assets/fx_infernal_ember.webp"), "image/webp"),
        "/cosmetics/assets/fx_infernal_flame.webp" => (include_bytes!("../../static/cosmetics/assets/fx_infernal_flame.webp"), "image/webp"),
        "/cosmetics/assets/fx_arcane_sigil.webp" => (include_bytes!("../../static/cosmetics/assets/fx_arcane_sigil.webp"), "image/webp"),
        "/cosmetics/assets/fx_arcane_rune.webp" => (include_bytes!("../../static/cosmetics/assets/fx_arcane_rune.webp"), "image/webp"),
        "/cosmetics/assets/fx_abyssal_jelly.webp" => (include_bytes!("../../static/cosmetics/assets/fx_abyssal_jelly.webp"), "image/webp"),
        "/cosmetics/assets/fx_abyssal_bubble.webp" => (include_bytes!("../../static/cosmetics/assets/fx_abyssal_bubble.webp"), "image/webp"),
        "/cosmetics/assets/fx_seraph_feather.webp" => (include_bytes!("../../static/cosmetics/assets/fx_seraph_feather.webp"), "image/webp"),
        "/cosmetics/assets/fx_seraph_star.webp" => (include_bytes!("../../static/cosmetics/assets/fx_seraph_star.webp"), "image/webp"),
        _ => return Response::builder().status(StatusCode::NOT_FOUND).body(Cow::Borrowed(&b"Recurso interno inexistente"[..])).unwrap_or_default(),
    };
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return Response::builder().status(StatusCode::METHOD_NOT_ALLOWED).body(Cow::Borrowed(&b""[..])).unwrap_or_default();
    }
    let cache_ctrl = if mime == "image/webp" { "public, max-age=31536000, immutable" } else { "no-cache" };
    Response::builder()
        .header("Content-Type", mime)
        .header("Cache-Control", cache_ctrl)
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
