//! Etapa C1 — prévia de links: extração, proteção contra SSRF e fluxo completo.
use super::*;
use crate::link_preview::{extract_urls, fetch_limited, is_public_ip, parse_html, TEST_LOOPBACK_PORTS};
use std::net::IpAddr;

#[test]
fn urls_are_extracted_with_limits_and_suppression() {
    let urls = extract_urls("veja https://exemplo.com/a, http://teste.org/b?x=1) e https://exemplo.com/a de novo");
    assert_eq!(urls, vec!["https://exemplo.com/a", "http://teste.org/b?x=1"]);
    assert!(extract_urls("sem prévia <https://exemplo.com/escondido>").is_empty(), "<url> suprime");
    assert!(extract_urls("`https://exemplo.com/code` e ```\nhttps://exemplo.com/bloco\n```").is_empty(), "código não gera prévia");
    assert!(extract_urls("ftp://exemplo.com/x javascript:alert(1)").is_empty());
    assert!(extract_urls("https://usuario:senha@exemplo.com/").is_empty(), "credencial na URL é recusada");
    let many = extract_urls("https://a.com/1 https://b.com/2 https://c.com/3 https://d.com/4");
    assert_eq!(many.len(), crate::link_preview::MAX_LINKS);
}

#[test]
fn only_public_addresses_are_allowed() {
    for ip in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.1.1", "64:ff9b::7f00:1", "2001:db8::1"] {
        assert!(!is_public_ip(ip.parse::<IpAddr>().unwrap()), "{ip} deveria ser bloqueado");
    }
    for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
        assert!(is_public_ip(ip.parse::<IpAddr>().unwrap()), "{ip} deveria ser permitido");
    }
}

#[test]
fn html_metadata_is_read_cleaned_and_resolved() {
    let url = reqwest::Url::parse("https://www.exemplo.com/artigo").unwrap();
    let html = r#"<html><head><title>Título &amp; reserva</title>
        <META property="og:title" content="Notícia &quot;boa&quot;">
        <meta content='Descrição    com   espaços' name="description">
        <meta property="og:image" content="/img/capa.png">
        <meta property="og:site_name" content="Exemplo">
        </head><body>…</body></html>"#;
    let e = parse_html(&url, html).unwrap();
    assert_eq!(e.title.as_deref(), Some("Notícia \"boa\""));
    assert_eq!(e.description.as_deref(), Some("Descrição com espaços"));
    assert_eq!(e.site_name.as_deref(), Some("Exemplo"));
    assert_eq!(e.image_url.as_deref(), Some("https://www.exemplo.com/img/capa.png"));
    // og:title vazio (caso real) cai para o <title>.
    let empty_og = parse_html(&url, r#"<meta property="og:title" content="" /><title>
            Título real
        </title>"#).unwrap();
    assert_eq!(empty_og.title.as_deref(), Some("Título real"));
    // Sem og: usa <title> e o domínio; sem título nem descrição não há prévia.
    let only_title = parse_html(&url, "<title>Só título</title>").unwrap();
    assert_eq!(only_title.site_name.as_deref(), Some("exemplo.com"));
    assert!(parse_html(&url, "<html><body>nada</body></html>").is_none());
    // Imagem com esquema perigoso é ignorada; entidade cortada não derruba.
    let bad = parse_html(&url, r#"<title>x &#12</title><meta property="og:image" content="javascript:alert(1)">"#).unwrap();
    assert!(bad.image_url.is_none());
}

#[tokio::test]
async fn internal_addresses_are_refused_even_after_redirect() {
    for url in ["http://127.0.0.1:9/", "http://localhost:9/", "http://169.254.169.254/latest/meta-data/", "http://[::1]:9/", "http://10.0.0.1/"] {
        assert_eq!(fetch_limited(url, false, 1024).await.err(), Some("endereço não público"), "{url} deveria ser recusado antes de conectar");
    }
    // Um site "liberado" (porta registrada só no teste) que redireciona para um endereço interno.
    let app = axum::Router::new().route("/", axum::routing::get(|| async {
        (axum::http::StatusCode::FOUND, [(axum::http::header::LOCATION, "http://127.0.0.1:9/segredo")], "")
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { let _ = axum::serve(listener, app).await; });
    TEST_LOOPBACK_PORTS.lock().unwrap().push(port);
    let r = fetch_limited(&format!("http://127.0.0.1:{port}/"), false, 1024).await;
    assert_eq!(r.err(), Some("endereço não público"), "o primeiro salto passa; o redirecionamento interno é que é barrado");
}

/// PNG 1x1 válido.
fn png() -> Vec<u8> {
    vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89, 0, 0, 0, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0D, 0x0A, 0x2D, 0xB4, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]
}

#[tokio::test]
async fn message_gets_embed_and_image_goes_through_proxy() {
    // "Site" de teste: página com Open Graph (via redirecionamento) e imagem.
    let site = axum::Router::new()
        .route("/curto", axum::routing::get(|| async { (axum::http::StatusCode::MOVED_PERMANENTLY, [(axum::http::header::LOCATION, "/artigo")], "") }))
        .route("/artigo", axum::routing::get(|| async {
            ([(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
             r#"<html><head><meta property="og:title" content="Torneio de sábado"><meta property="og:description" content="Inscrições abertas"><meta property="og:image" content="/capa.png"></head></html>"#)
        }))
        .route("/capa.png", axum::routing::get(|| async { ([(axum::http::header::CONTENT_TYPE, "image/png")], png()) }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { let _ = axum::serve(listener, site).await; });
    TEST_LOOPBACK_PORTS.lock().unwrap().push(port);

    let srv = start_server().await;
    let (mut dona, server, _sid) = owner_with_server(&srv, "DonaLinks", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let link = format!("http://127.0.0.1:{port}/curto");
    send(&mut dona, json!({"type":"SendChat","payload":{"channel_id":geral,"content":format!("olha {link}")}})).await;
    let msg_id = loop {
        let m = wait_for(&mut dona, "NewChatMessage").await;
        if m["message"]["content"].as_str().unwrap_or("").contains("olha") {
            assert!(m["message"].get("embeds").is_none(), "a prévia chega depois, como atualização");
            break m["message"]["id"].as_str().unwrap().to_string();
        }
    };
    let embed = loop {
        let m = wait_for(&mut dona, "MessageUpdated").await;
        if m["message"]["id"] == msg_id.as_str() {
            break m["message"]["embeds"][0].clone();
        }
    };
    assert_eq!(embed["title"], "Torneio de sábado");
    assert_eq!(embed["description"], "Inscrições abertas");
    assert_eq!(embed["url"], link.as_str(), "o link original continua sendo o do usuário");
    assert_eq!(embed["image_url"], format!("http://127.0.0.1:{port}/capa.png"));

    // Imagem pelo proxy do Sancord: presa à mensagem, tipo verificado.
    let get = |path: String| {
        let router = srv.router.clone();
        async move {
            let res = router.oneshot(axum::http::Request::get(path).body(axum::body::Body::empty()).unwrap()).await.unwrap();
            let status = res.status().as_u16();
            let ct = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            let body = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
            (status, ct, body.to_vec())
        }
    };
    let (status, ct, body) = get(format!("/api/link-preview/{geral}/{msg_id}/0")).await;
    assert_eq!(status, 200);
    assert_eq!(ct, "image/png");
    assert_eq!(body, png());
    assert_eq!(get(format!("/api/link-preview/{geral}/{msg_id}/1")).await.0, 404, "índice sem embed");
    assert_eq!(get(format!("/api/link-preview/{geral}/inexistente/0")).await.0, 404, "não é proxy aberto");

    // Editar para texto sem link remove a prévia; persistido no banco.
    send(&mut dona, json!({"type":"EditChat","payload":{"channel_id":geral,"message_id":msg_id,"content":"mudei de ideia"}})).await;
    loop {
        let m = wait_for(&mut dona, "MessageUpdated").await;
        if m["message"]["id"] == msg_id.as_str() && m["message"]["content"] == "mudei de ideia" && m["message"].get("embeds").is_none() {
            break;
        }
    }
}
