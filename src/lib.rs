//! Núcleo do servidor Sancord.
//!
//! - HTTP (`http.rs`): cadastro, login, sessão, logout, convites, saúde.
//! - WebSocket (`ws.rs`): eventos em tempo real (mensagens, presença, voz/sinalização).
//! - Persistência (`db.rs`): SQLite com thread de escrita dedicada.
//! - Estado (`state.rs`): cache em memória + fan-out de eventos.
//! - WebRTC: mídia P2P entre clientes; o servidor só repassa a sinalização.

pub mod activity;
pub mod auth;
mod access;
pub mod chat;
pub mod scheduled;
pub mod community;
pub mod config;
pub mod db;
pub mod discovery;
pub mod http;
pub mod integrations;
pub mod link_preview;
pub mod models;
pub mod moderation;
pub mod permissions;
pub mod slowmode;
pub mod social;
pub mod state;
pub mod threads;
pub mod cosmetics;
mod cosmetic_collection;
pub mod emojis;
pub mod profile;
mod profile_board;
mod profile_sharing;
pub mod nicknames;
pub mod timeouts;
pub mod uploads;
pub mod updates;
pub mod validate;
pub mod voice;
pub mod ws;

#[cfg(test)]
mod tests;

use axum::http::{header, HeaderValue, Method, Request};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use state::SharedState;
use tower_http::cors::CorsLayer;

async fn response_headers(req: Request<axum::body::Body>, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    // Respostas que já definem a própria política (anexos e imagens de perfil, imutáveis
    // por ID) mantêm o cache; todo o resto da API continua sem cache.
    if !headers.contains_key(header::CACHE_CONTROL) {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, no-cache, must-revalidate"),
        );
        headers.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    }
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    res
}

/// Monta o roteador completo (usado pelo binário e pelos testes de integração).
pub fn build_router(state: SharedState) -> Router {
    Router::new()
        .route("/api/register", post(http::register_handler))
        .route("/api/login", post(http::login_handler))
        .route("/api/recover-password", post(http::recover_password_handler))
        .route("/api/session", post(http::session_handler))
        .route("/api/logout", post(http::logout_handler))
        .route("/api/health", get(http::health_handler))
        .route("/api/public-url", get(http::public_url_handler))
        .route("/api/invite/:code", get(http::invite_preview_handler))
        .route("/api/invites/:code", get(http::invite_preview_handler))
        .route("/api/channels/:channel/integrations", get(integrations::list).post(integrations::create))
        .route("/api/integrations/:id/rotate", post(integrations::rotate))
        .route("/api/integrations/:id/revoke", post(integrations::revoke))
        .route("/api/integrations/:id/messages", post(integrations::publish).layer(axum::extract::DefaultBodyLimit::max(64 * 1024)))
        .route(
            "/api/attachments",
            post(uploads::upload_handler)
                .layer(axum::extract::DefaultBodyLimit::max(uploads::MAX_UPLOAD_BYTES + 1024)),
        )
        .route("/api/attachments/:id/:name", get(uploads::download_handler))
        .route("/api/link-preview/:channel/:message/:index", get(link_preview::image_handler))
        .route("/ws", get(ws::ws_handler))
        .layer(middleware::from_fn(response_headers))
        .layer(CorsLayer::new()
            .allow_origin(HeaderValue::from_static("http://sancord.localhost"))
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]))
        .with_state(state)
}
