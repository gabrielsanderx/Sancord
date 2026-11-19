//! Microfone e câmera nas páginas do próprio app.
//!
//! O WebView2 guarda no perfil a resposta a pedidos de permissão. Um "bloquear" salvo para
//! `http://sancord.localhost` (por um prompt fechado, por exemplo) deixava as chamadas sem
//! microfone mesmo com o Windows liberando. Aqui o app reafirma a permissão das próprias
//! páginas ao abrir e responde aos pedidos delas. Páginas externas continuam com o padrão.

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND,
    COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
};
use webview2_com::{take_pwstr, PermissionRequestedEventHandler, SetPermissionStateCompletedHandler};
use windows::core::{Interface, HSTRING, PWSTR};
use wry::WebViewExtWindows;

const MEDIA_KINDS: [COREWEBVIEW2_PERMISSION_KIND; 2] =
    [COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_KIND_CAMERA];

/// Só microfone e câmera, e só para páginas servidas pelo próprio executável.
pub fn should_allow_media(uri: &str, kind: COREWEBVIEW2_PERMISSION_KIND) -> bool {
    MEDIA_KINDS.contains(&kind) && crate::desktop_assets::is_app_page(uri)
}

pub fn grant_app_media(webview: &wry::WebView) {
    unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };

        // 1. Estado salvo no perfil (runtime 1.0.1823+). Sobrescreve um "bloquear" antigo.
        if let Some(profile) = core
            .cast::<ICoreWebView2_13>()
            .and_then(|c| c.Profile())
            .and_then(|p| p.cast::<ICoreWebView2Profile4>())
            .ok()
        {
            let origin = HSTRING::from(crate::desktop_assets::APP_ORIGIN);
            for kind in MEDIA_KINDS {
                let done = SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(())));
                let _ = profile.SetPermissionState(kind, &origin, COREWEBVIEW2_PERMISSION_STATE_ALLOW, &done);
            }
        }

        // 2. Pedidos feitos agora (também cobre runtimes sem a API de perfil).
        let mut token = Default::default();
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if should_allow_media(&take_pwstr(uri), kind) {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut token,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION;

    #[test]
    fn libera_microfone_e_camera_so_nas_paginas_do_app() {
        let app = "http://sancord.localhost/index.html?endpoint=http%3A%2F%2Flocalhost%3A3000";
        assert!(should_allow_media(app, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE));
        assert!(should_allow_media(app, COREWEBVIEW2_PERMISSION_KIND_CAMERA));
        assert!(!should_allow_media(app, COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION));
        assert!(!should_allow_media("https://exemplo.com/", COREWEBVIEW2_PERMISSION_KIND_MICROPHONE));
        assert!(!should_allow_media("http://sancord.localhost.evil/", COREWEBVIEW2_PERMISSION_KIND_MICROPHONE));
    }
}
