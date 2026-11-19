//! Testes de integração ponta a ponta: servidor real numa porta aleatória,
//! clientes WebSocket reais (tokio-tungstenite) e HTTP via `tower::oneshot`.

use crate::config::Config;
use crate::state::ServerState;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message as WsMsg;
use tower::ServiceExt;

#[path = "phase4_tests.rs"]
mod phase4;
#[path = "phase5_tests.rs"]
mod phase5;
#[path = "phase9_tests.rs"]
mod phase9;
#[path = "integrations_tests.rs"]
mod integrations;
#[path = "phase8_tests.rs"]
mod phase8;
#[path = "phase6_tests.rs"]
mod phase6;
#[path = "phase7_tests.rs"]
mod phase7;
#[path = "timeout_tests.rs"]
mod timeouts;
#[path = "slowmode_tests.rs"]
mod slowmode;
#[path = "forum_tag_tests.rs"]
mod forum_tags;
#[path = "stage_ab_tests.rs"]
mod stage_ab;
#[path = "link_preview_tests.rs"]
mod link_preview;
#[path = "forward_tests.rs"]
mod forward;
#[path = "inbox_mute_tests.rs"]
mod inbox_mute;
#[path = "nickname_tests.rs"]
mod nickname;
#[path = "emoji_tests.rs"]
mod emoji;
#[path = "thread_c6_tests.rs"]
mod thread_c6;
#[path = "invites_tests.rs"]
mod invites_tests;
#[path = "gif_tests.rs"]
mod gif;
#[path = "profile_p1_tests.rs"]
mod profile_p1;
#[path = "profile_p2_tests.rs"]
mod profile_p2;
#[path = "profile_p5_tests.rs"]
mod profile_p5;
#[path = "profile_board_tests.rs"]
mod profile_board;
#[path = "profile_sharing_tests.rs"]
mod profile_sharing;
#[path = "cosmetic_collection_tests.rs"]
mod cosmetic_collection;
#[path = "voice_chat_tests.rs"]
mod voice_chat;

struct TestServer {
    addr: std::net::SocketAddr,
    router: axum::Router,
    state: crate::state::SharedState,
    dir: std::path::PathBuf,
}

async fn start_server_in(dir: std::path::PathBuf) -> TestServer {
    let state = ServerState::load(Config::for_tests(dir.clone())).expect("estado");
    let router = crate::build_router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    TestServer { addr, router, state, dir }
}

async fn start_server() -> TestServer {
    let dir = std::env::temp_dir().join(format!("sancord-it-{}", uuid::Uuid::new_v4()));
    start_server_in(dir).await
}

async fn post(srv: &TestServer, path: &str, body: Value) -> (u16, Value) {
    let req = axum::http::Request::post(path)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body.to_string()))
        .unwrap();
    let res = srv.router.clone().oneshot(req).await.unwrap();
    let status = res.status().as_u16();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
    let v = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() };
    (status, v)
}

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(srv: &TestServer, token: &str) -> Ws {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", srv.addr))
        .await
        .expect("conectar ws");
    send(&mut ws, json!({"type": "JoinServer", "payload": {"token": token, "username": null}})).await;
    ws
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(WsMsg::Text(v.to_string())).await.unwrap();
}

/// Lê eventos até achar um do tipo pedido (ignora os outros).
async fn wait_for(ws: &mut Ws, kind: &str) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let msg = tokio::time::timeout(remaining, ws.next())
            .await
            .unwrap_or_else(|_| panic!("timeout esperando {kind}"))
            .expect("stream fechou")
            .expect("erro ws");
        if let WsMsg::Text(t) = msg {
            let v: Value = serde_json::from_str(&t).unwrap();
            if v["type"] == kind {
                return v["payload"].clone();
            }
        }
    }
}

async fn register(srv: &TestServer, name: &str) -> String {
    let (status, body) = post(srv, "/api/register", json!({"username": name, "password": "senha-segura-1"})).await;
    assert_eq!(status, 200, "cadastro falhou: {body}");
    body["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn desktop_backend_has_no_website_and_allows_embedded_origin() {
    let srv = start_server().await;
    for path in ["/", "/index.html", "/app.js", "/styles.css", "/js/chat.js"] {
        let response = srv.router.clone().oneshot(axum::http::Request::get(path)
            .body(axum::body::Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), 404, "interface publicada em {path}");
    }
    for origin in ["http://sancord.localhost", "https://other.example"] {
        let response = srv.router.clone().oneshot(axum::http::Request::options("/api/login")
            .header("origin", origin).header("access-control-request-method", "POST")
            .header("access-control-request-headers", "content-type")
            .body(axum::body::Body::empty()).unwrap()).await.unwrap();
        // A origem permitida é fixa; navegadores não aceitam outra origem.
        assert_eq!(response.headers()["access-control-allow-origin"], "http://sancord.localhost");
    }
    let response = srv.router.clone().oneshot(axum::http::Request::get("/api/health")
        .body(axum::body::Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), 200);
}

#[tokio::test]
async fn auth_http_rules() {
    let srv = start_server().await;
    let (s, b) = post(&srv, "/api/register", json!({"username": "ana", "password": "curta"})).await;
    assert_eq!(s, 400);
    assert_eq!(b["ok"], false);

    let token = register(&srv, "Ana").await;
    let (s, _) = post(&srv, "/api/register", json!({"username": "ana", "password": "senha-segura-1"})).await;
    assert_eq!(s, 409, "nome duplicado (sem diferenciar maiúsculas)");

    let (s, _) = post(&srv, "/api/login", json!({"username": "ana", "password": "errada-123"})).await;
    assert_eq!(s, 401);
    let (s, b) = post(&srv, "/api/login", json!({"username": "ANA", "password": "senha-segura-1"})).await;
    assert_eq!(s, 200);
    let token2 = b["token"].as_str().unwrap().to_string();
    assert_ne!(token, token2, "cada login gera uma sessão nova");

    let (s, _) = post(&srv, "/api/session", json!({"token": token})).await;
    assert_eq!(s, 200);
    let (s, _) = post(&srv, "/api/logout", json!({"token": token})).await;
    assert_eq!(s, 204);
    let (s, _) = post(&srv, "/api/session", json!({"token": token})).await;
    assert_eq!(s, 401, "token revogado não pode mais ser usado");
    let (s, _) = post(&srv, "/api/session", json!({"token": token2})).await;
    assert_eq!(s, 200, "outra sessão continua válida");

    // Senha nunca fica em texto puro.
    let st = srv.state.read().await;
    let acc = st.accounts.get("ana").unwrap();
    assert!(acc.password_hash.starts_with("$argon2id$"));
    assert!(!st.sessions.contains_key(&token2), "mapa guarda só o hash do token");
}

#[tokio::test]
async fn rate_limit_blocks_bruteforce() {
    let srv = start_server().await;
    register(&srv, "bia").await;
    for _ in 0..8 {
        post(&srv, "/api/login", json!({"username": "bia", "password": "errada-123"})).await;
    }
    let (s, _) = post(&srv, "/api/login", json!({"username": "bia", "password": "senha-segura-1"})).await;
    assert_eq!(s, 429);
}

#[tokio::test]
async fn websocket_rejects_missing_or_fake_token() {
    let srv = start_server().await;
    register(&srv, "dono").await;

    // Antes era possível entrar só com o nome e se passar pelo dono.
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", srv.addr)).await.unwrap();
    send(&mut ws, json!({"type": "JoinServer", "payload": {"token": null, "username": "dono"}})).await;
    let p = wait_for(&mut ws, "AuthFailed").await;
    assert!(p["message"].as_str().unwrap().contains("Sessão"));

    let mut ws2 = connect(&srv, "token-inventado").await;
    wait_for(&mut ws2, "AuthFailed").await;
    assert!(srv.state.read().await.users.is_empty());
}

/// Fluxo A (parcial) + D: conta → servidor → convite → outro usuário entra → conversam → reação.
#[tokio::test]
async fn flow_create_server_invite_chat_and_react() {
    let srv = start_server().await;
    let t1 = register(&srv, "Gabriel").await;
    let t2 = register(&srv, "Joao").await;

    let mut a = connect(&srv, &t1).await;
    let welcome = wait_for(&mut a, "Welcome").await;
    assert_eq!(welcome["user"]["username"], "Gabriel");
    assert_eq!(welcome["protocol_version"], 2);

    send(&mut a, json!({"type": "CreateServer", "payload": {"name": "Rustaceos", "template": null}})).await;
    let created = wait_for(&mut a, "ServerCreated").await;
    let server = &created["server"];
    let invite = server["invite_code"].as_str().unwrap().to_string();
    assert!(invite.starts_with("SANC-"), "novo formato de convite: {invite}");
    let channel = server["text_channels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == "text")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(server["owner_username"], "gabriel");

    // Cria um canal novo.
    let sid = server["id"].as_str().unwrap().to_string();
    send(&mut a, json!({"type": "CreateChannel", "payload": {"name": "Off Topic", "kind": "text", "server_id": sid}})).await;
    let ch = wait_for(&mut a, "ChannelCreated").await;
    assert_eq!(ch["channel"]["name"], "off-topic");

    let mut b = connect(&srv, &t2).await;
    wait_for(&mut b, "Welcome").await;
    send(&mut b, json!({"type": "JoinServerByInvite", "payload": {"invite_code": invite}})).await;
    wait_for(&mut b, "ServerCreated").await;

    send(&mut a, json!({"type": "SendChat", "payload": {
        "channel_id": channel, "content": "Olá João!", "image_url": null, "reply_to_id": null, "nonce": "n-1"
    }})).await;
    let got_b = wait_for(&mut b, "NewChatMessage").await;
    assert_eq!(got_b["message"]["content"], "Olá João!");
    let echo_a = wait_for(&mut a, "NewChatMessage").await;
    assert_eq!(echo_a["message"]["nonce"], "n-1", "remetente recebe o nonce para confirmar o envio");
    assert!(echo_a["message"]["created_at"].as_i64().unwrap() > 0);
    let msg_id = got_b["message"]["id"].as_str().unwrap().to_string();

    send(&mut b, json!({"type": "ToggleReaction", "payload": {"channel_id": channel, "message_id": msg_id, "emoji": "👍"}})).await;
    let upd = wait_for(&mut a, "MessageUpdated").await;
    assert_eq!(upd["message"]["reactions"]["👍"][0], "Joao");

    // João não pode editar a mensagem do Gabriel.
    send(&mut b, json!({"type": "EditChat", "payload": {"channel_id": channel, "message_id": msg_id, "content": "hack"}})).await;
    let fb = wait_for(&mut b, "ServerFeedback").await;
    assert_eq!(fb["ok"], false);

    // Imagem com injeção de atributo é recusada com erro explícito.
    send(&mut a, json!({"type": "SendChat", "payload": {
        "channel_id": channel, "content": "", "image_url": "data:image/png;base64,AA\" onerror=\"x", "nonce": "n-2"
    }})).await;
    let failed = wait_for(&mut a, "SendFailed").await;
    assert_eq!(failed["nonce"], "n-2");
}

/// Fluxo E: histórico persiste após reiniciar o servidor e é paginado.
#[tokio::test]
async fn flow_history_survives_restart_and_paginates() {
    let dir = std::env::temp_dir().join(format!("sancord-it-{}", uuid::Uuid::new_v4()));
    let channel;
    let token;
    {
        let srv = start_server_in(dir.clone()).await;
        token = register(&srv, "Carla").await;
        let mut a = connect(&srv, &token).await;
        wait_for(&mut a, "Welcome").await;
        channel = "geral".to_string();
        for i in 0..130 {
            // O anti-spam (8 msgs / 5 s) barraria o lote; o teste libera o limitador a cada envio.
            srv.state.write().await.rates.clear();
            send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": channel, "content": format!("mensagem {i}")}})).await;
            wait_for(&mut a, "NewChatMessage").await;
        }
        let db = srv.state.read().await.db.clone();
        db.flush();
        assert_eq!(db.count_messages(&channel).unwrap(), 131, "130 + boas-vindas");
        db.shutdown();
    }

    // "Reinicia": novo estado em cima do mesmo banco.
    let srv = start_server_in(dir).await;
    assert_eq!(srv.dir.join("sancord.db").exists(), true);
    let mut a = connect(&srv, &token).await;
    let welcome = wait_for(&mut a, "Welcome").await;
    let recent = welcome["chat_history"][&channel].as_array().unwrap();
    assert_eq!(recent.len(), 50, "Welcome só traz a última página");
    assert_eq!(recent.last().unwrap()["content"], "mensagem 129");

    let oldest_id = recent[0]["id"].as_str().unwrap().to_string();
    send(&mut a, json!({"type": "LoadMessages", "payload": {"channel_id": channel, "before_id": oldest_id, "limit": 100}})).await;
    let page = wait_for(&mut a, "MessagesPage").await;
    let msgs = page["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 81, "restante do histórico (80 + boas-vindas)");
    assert_eq!(page["has_more"], false);
    assert_eq!(msgs.last().unwrap()["content"], "mensagem 79");

    // Editar uma mensagem antiga (fora do cache em memória) também funciona.
    let old = msgs.iter().find(|m| m["content"] == "mensagem 0").unwrap();
    let old_id = old["id"].as_str().unwrap();
    send(&mut a, json!({"type": "EditChat", "payload": {"channel_id": channel, "message_id": old_id, "content": "editada"}})).await;
    let upd = wait_for(&mut a, "MessageUpdated").await;
    assert_eq!(upd["message"]["content"], "editada");
    assert_eq!(upd["message"]["edited"], true);
}

#[tokio::test]
async fn reconnect_gets_fresh_state() {
    let srv = start_server().await;
    let t1 = register(&srv, "Davi").await;
    let t2 = register(&srv, "Eva").await;
    let mut a = connect(&srv, &t1).await;
    wait_for(&mut a, "Welcome").await;
    let mut b = connect(&srv, &t2).await;
    wait_for(&mut b, "Welcome").await;

    // Eva cai; Davi manda mensagem enquanto ela está offline.
    drop(b);
    tokio::time::sleep(Duration::from_millis(100)).await;
    send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": "geral", "content": "você perdeu isso"}})).await;
    wait_for(&mut a, "NewChatMessage").await;

    // Ao reconectar, o Welcome traz a mensagem perdida.
    let mut b2 = connect(&srv, &t2).await;
    let w = wait_for(&mut b2, "Welcome").await;
    let geral = w["chat_history"]["geral"].as_array().unwrap();
    assert_eq!(geral.last().unwrap()["content"], "você perdeu isso");
}

/// Cria servidor e devolve (ws do dono, server json, server_id).
async fn owner_with_server(srv: &TestServer, name: &str, template: &str) -> (Ws, Value, String) {
    let token = register(srv, name).await;
    let mut ws = connect(srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    send(&mut ws, json!({"type": "CreateServer", "payload": {"name": format!("Servidor de {name}"), "template": template}})).await;
    let created = wait_for(&mut ws, "ServerCreated").await;
    let sid = created["server"]["id"].as_str().unwrap().to_string();
    (ws, created["server"].clone(), sid)
}

async fn join_with(srv: &TestServer, name: &str, code: &str) -> (Ws, Value) {
    let token = register(srv, name).await;
    let mut ws = connect(srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    send(&mut ws, json!({"type": "JoinServerByInvite", "payload": {"invite_code": code}})).await;
    let reply = wait_for_any(&mut ws, &["ServerCreated", "ServerFeedback"]).await;
    (ws, reply)
}

async fn wait_for_any(ws: &mut Ws, kinds: &[&str]) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let msg = tokio::time::timeout(remaining, ws.next())
            .await
            .unwrap_or_else(|_| panic!("timeout esperando {kinds:?}"))
            .unwrap()
            .unwrap();
        if let WsMsg::Text(t) = msg {
            let v: Value = serde_json::from_str(&t).unwrap();
            if kinds.iter().any(|k| v["type"] == *k) {
                return v;
            }
        }
    }
}

fn channel_by_name<'a>(server: &'a Value, name: &str) -> &'a Value {
    server["text_channels"]
        .as_array()
        .unwrap()
        .iter()
        .chain(server["voice_channels"].as_array().unwrap().iter())
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("canal {name} não encontrado"))
}

/// Fase 2: categorias, canais com categoria/posição, reordenação, edição e exclusão.
#[tokio::test]
async fn categories_and_channel_layout() {
    let srv = start_server().await;
    let (mut a, server, sid) = owner_with_server(&srv, "Dona", "blank").await;
    assert_eq!(server["categories"].as_array().unwrap().len(), 3, "modelo padrão tem 3 categorias");
    assert_eq!(channel_by_name(&server, "anuncios")["kind"], "announcement");

    send(&mut a, json!({"type": "CreateCategory", "payload": {"server_id": sid, "name": "Jogos"}})).await;
    let upd = wait_for(&mut a, "ServerUpdated").await;
    let cat = upd["server"]["categories"].as_array().unwrap().iter().find(|c| c["name"] == "Jogos").unwrap().clone();
    let cat_id = cat["id"].as_str().unwrap().to_string();
    assert_eq!(cat["position"], 3);

    send(&mut a, json!({"type": "CreateChannel", "payload": {
        "server_id": sid, "name": "Minecraft", "kind": "text", "category_id": cat_id, "topic": "Servidor survival"
    }})).await;
    let created = wait_for(&mut a, "ChannelCreated").await;
    assert_eq!(created["channel"]["name"], "minecraft");
    assert_eq!(created["channel"]["category_id"], cat_id.as_str());
    assert_eq!(created["channel"]["topic"], "Servidor survival");
    let mc_id = created["channel"]["id"].as_str().unwrap().to_string();
    wait_for(&mut a, "ServerUpdated").await;

    // Move "geral" para a categoria Jogos, antes de minecraft, e coloca Jogos primeiro.
    let geral_id = channel_by_name(&server, "geral")["id"].as_str().unwrap().to_string();
    send(&mut a, json!({"type": "ReorderServerLayout", "payload": {
        "server_id": sid,
        "categories": [cat_id],
        "channels": [{"id": geral_id, "category_id": cat_id}, {"id": mc_id, "category_id": cat_id}]
    }})).await;
    let upd = wait_for(&mut a, "ServerUpdated").await;
    let s = &upd["server"];
    assert_eq!(s["categories"][0]["id"], cat_id.as_str());
    let geral = channel_by_name(s, "geral");
    let mc = channel_by_name(s, "minecraft");
    assert_eq!(geral["category_id"], cat_id.as_str());
    assert_eq!(geral["position"], 0);
    assert_eq!(mc["position"], 1);

    // Edita canal: nome, descrição e tipo texto -> anúncios.
    send(&mut a, json!({"type": "UpdateChannel", "payload": {
        "server_id": sid, "channel_id": mc_id, "name": "Mine Craft", "topic": "", "kind": "announcement"
    }})).await;
    let upd = wait_for(&mut a, "ServerUpdated").await;
    let mc = channel_by_name(&upd["server"], "mine-craft");
    assert_eq!(mc["kind"], "announcement");
    assert!(mc["topic"].is_null(), "tópico vazio limpa a descrição");

    // Voz não vira anúncio.
    let voice_id = upd["server"]["voice_channels"][0]["id"].as_str().unwrap().to_string();
    send(&mut a, json!({"type": "UpdateChannel", "payload": {"server_id": sid, "channel_id": voice_id, "kind": "text"}})).await;
    assert_eq!(wait_for(&mut a, "ServerFeedback").await["ok"], false);

    // Excluir a categoria deixa os canais sem categoria.
    send(&mut a, json!({"type": "DeleteCategory", "payload": {"server_id": sid, "category_id": cat_id}})).await;
    let upd = wait_for(&mut a, "ServerUpdated").await;
    assert!(channel_by_name(&upd["server"], "geral")["category_id"].is_null());
    assert!(upd["server"]["categories"].as_array().unwrap().iter().all(|c| c["id"] != cat_id.as_str()));

    // Membro sem permissão não mexe na estrutura.
    let (mut b, _) = join_with(&srv, "Membro", server["invite_code"].as_str().unwrap()).await;
    send(&mut b, json!({"type": "CreateCategory", "payload": {"server_id": sid, "name": "Hack"}})).await;
    let fb = wait_for(&mut b, "ServerFeedback").await;
    assert_eq!(fb["ok"], false);
    assert_eq!(fb["action"], "create_category");
}

/// Fase 2: canal de anúncios — todos leem, só moderadores publicam.
#[tokio::test]
async fn announcement_channel_permissions() {
    let srv = start_server().await;
    let (mut a, server, _sid) = owner_with_server(&srv, "Admin", "blank").await;
    let ann = channel_by_name(&server, "anuncios")["id"].as_str().unwrap().to_string();
    let (mut b, _) = join_with(&srv, "Leitor", server["invite_code"].as_str().unwrap()).await;

    send(&mut b, json!({"type": "SendChat", "payload": {"channel_id": ann, "content": "posso?", "nonce": "x"}})).await;
    let failed = wait_for(&mut b, "SendFailed").await;
    assert!(failed["message"].as_str().unwrap().contains("anúncios"));

    send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": ann, "content": "Novidade!"}})).await;
    let got = wait_for(&mut b, "NewChatMessage").await;
    assert_eq!(got["message"]["content"], "Novidade!");
}

/// Fase 2: convites com limite de usos, validade, revogação e lista.
#[tokio::test]
async fn invites_limits_expiry_and_revoke() {
    let srv = start_server().await;
    let (mut a, server, sid) = owner_with_server(&srv, "Host", "friends").await;

    send(&mut a, json!({"type": "CreateInvite", "payload": {"server_id": sid, "max_uses": 1, "max_age_secs": 3600}})).await;
    let inv = wait_for(&mut a, "InviteCreated").await["invite"].clone();
    let code = inv["code"].as_str().unwrap().to_string();
    assert!(code.starts_with("SANC-"));
    assert_eq!(inv["max_uses"], 1);
    assert!(inv["expires_at"].as_i64().unwrap() > crate::auth::now_ms());

    // Prévia HTTP mostra o servidor e quantos estão online.
    let req = axum::http::Request::get(format!("/api/invite/{}", code.to_lowercase()))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = srv.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), 200);
    let body: Value = serde_json::from_slice(&axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap()).unwrap();
    assert_eq!(body["name"], "Servidor de Host");
    assert_eq!(body["online_count"], 1);

    let (_b, reply) = join_with(&srv, "Primeiro", &code).await;
    assert_eq!(reply["type"], "ServerCreated");
    let (_c, reply) = join_with(&srv, "Segundo", &code).await;
    assert_eq!(reply["type"], "ServerFeedback");
    assert!(reply["payload"]["message"].as_str().unwrap().contains("limite"));

    // Convite vencido.
    send(&mut a, json!({"type": "CreateInvite", "payload": {"server_id": sid}})).await;
    let code2 = wait_for(&mut a, "InviteCreated").await["invite"]["code"].as_str().unwrap().to_string();
    srv.state.write().await.invites.get_mut(&code2).unwrap().expires_at = Some(1);
    let (_d, reply) = join_with(&srv, "Atrasado", &code2).await;
    assert!(reply["payload"]["message"].as_str().unwrap().contains("expirou"));

    // Lista e revogação.
    send(&mut a, json!({"type": "CreateInvite", "payload": {"server_id": sid}})).await;
    let code3 = wait_for(&mut a, "InviteCreated").await["invite"]["code"].as_str().unwrap().to_string();
    send(&mut a, json!({"type": "ListInvites", "payload": {"server_id": sid}})).await;
    let list = wait_for(&mut a, "InvitesList").await;
    let codes: Vec<&str> = list["invites"].as_array().unwrap().iter().map(|i| i["code"].as_str().unwrap()).collect();
    assert!(codes.contains(&code3.as_str()));
    assert!(!codes.contains(&code2.as_str()), "vencidos somem da lista");
    assert!(list["invites"].as_array().unwrap().iter().any(|i| i["is_default"] == true));

    send(&mut a, json!({"type": "RevokeInvite", "payload": {"server_id": sid, "code": code3}})).await;
    let list = wait_for(&mut a, "InvitesList").await;
    assert!(list["invites"].as_array().unwrap().iter().all(|i| i["code"] != code3.as_str()));
    let (_e, reply) = join_with(&srv, "Tarde", &code3).await;
    assert_eq!(reply["type"], "ServerFeedback");

    // O convite padrão não é revogável (deve ser trocado por "gerar novo").
    let default_code = server["invite_code"].as_str().unwrap();
    send(&mut a, json!({"type": "RevokeInvite", "payload": {"server_id": sid, "code": default_code}})).await;
    assert_eq!(wait_for(&mut a, "ServerFeedback").await["ok"], false);
}

/// Fase 2: barra de servidores (pastas/ordem) persistida e sincronizada; dados sobrevivem a reinício.
#[tokio::test]
async fn guild_layout_prefs_and_persistence() {
    let dir = std::env::temp_dir().join(format!("sancord-it-{}", uuid::Uuid::new_v4()));
    let token;
    let sid;
    let cat_count;
    {
        let srv = start_server_in(dir.clone()).await;
        let (mut a, server, s) = owner_with_server(&srv, "Organizada", "community").await;
        sid = s;
        cat_count = server["categories"].as_array().unwrap().len();
        token = post(&srv, "/api/login", json!({"username": "Organizada", "password": "senha-segura-1"})).await.1["token"]
            .as_str()
            .unwrap()
            .to_string();
        send(&mut a, json!({"type": "UpdateUserPrefs", "payload": {
            "guild_layout": [
                {"type": "folder", "id": "f1", "name": "Meus", "color": "#ff0000", "server_ids": [sid, "srv-inexistente"]},
                {"type": "server", "id": "srv-de-outro"}
            ],
            "muted_servers": [sid],
            "collapsed_categories": ["x"]
        }})).await;
        let prefs = wait_for(&mut a, "UserPrefsUpdated").await["prefs"].clone();
        let layout = prefs["guild_layout"].as_array().unwrap();
        assert_eq!(layout[0]["type"], "folder");
        assert_eq!(layout[0]["server_ids"], json!([sid]), "IDs desconhecidos são removidos");
        assert!(layout.iter().any(|i| i["type"] == "server" && i["id"] == "sancord"), "servidores ausentes entram no fim");
        assert!(layout.iter().all(|i| i["id"] != "srv-de-outro"));
        assert_eq!(prefs["muted_servers"], json!([sid]));

        // Cria convite com limite para conferir persistência.
        send(&mut a, json!({"type": "CreateInvite", "payload": {"server_id": sid, "max_uses": 7}})).await;
        wait_for(&mut a, "InviteCreated").await;
        let db = srv.state.read().await.db.clone();
        db.flush();
        db.shutdown();
    }

    let srv = start_server_in(dir).await;
    let mut a = connect(&srv, &token).await;
    let w = wait_for(&mut a, "Welcome").await;
    assert_eq!(w["prefs"]["guild_layout"][0]["name"], "Meus");
    assert_eq!(w["prefs"]["muted_servers"], json!([sid]));
    let s = w["servers"].as_array().unwrap().iter().find(|s| s["id"] == sid.as_str()).unwrap();
    assert_eq!(s["categories"].as_array().unwrap().len(), cat_count);
    assert!(s["member_joined_at"]["organizada"].as_i64().unwrap() > 0);
    let st = srv.state.read().await;
    assert!(st.invites.values().any(|i| i.server_id == sid && i.max_uses == Some(7)));
}

async fn upload(srv: &TestServer, token: &str, filename: &str, bytes: Vec<u8>) -> (u16, Value) {
    let req = axum::http::Request::post(format!("/api/attachments?filename={filename}"))
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/octet-stream")
        .body(axum::body::Body::from(bytes))
        .unwrap();
    let res = srv.router.clone().oneshot(req).await.unwrap();
    let status = res.status().as_u16();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn tiny_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    png.extend_from_slice(&64u32.to_be_bytes());
    png.extend_from_slice(&32u32.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    png
}

/// Fase 3: anexos por HTTP (tipo detectado pelo conteúdo) e envio na mensagem.
#[tokio::test]
async fn attachments_upload_send_and_download() {
    let srv = start_server().await;
    let token = register(&srv, "Fotografa").await;

    let (s, _) = upload(&srv, "token-falso", "x.png", tiny_png()).await;
    assert_eq!(s, 401, "upload exige sessão");

    let (s, body) = upload(&srv, &token, "foto%20praia.png", tiny_png()).await;
    assert_eq!(s, 200, "{body}");
    let att = &body["attachment"];
    assert_eq!(att["kind"], "image");
    assert_eq!(att["width"], 64);
    assert_eq!(att["height"], 32);
    assert_eq!(att["filename"], "foto praia.png");
    let att_id = att["id"].as_str().unwrap().to_string();

    // HTML disfarçado de imagem vira download comum, nunca conteúdo exibível.
    let (_, evil) = upload(&srv, &token, "gato.png", b"<html><script>alert(1)</script>".to_vec()).await;
    assert_eq!(evil["attachment"]["kind"], "file");
    let evil_url = evil["attachment"]["url"].as_str().unwrap().to_string();
    let res = srv
        .router
        .clone()
        .oneshot(axum::http::Request::get(&evil_url).body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "application/octet-stream");
    assert!(res.headers()["content-disposition"].to_str().unwrap().starts_with("attachment"));
    assert_eq!(res.headers()["x-content-type-options"], "nosniff");

    let img_url = att["url"].as_str().unwrap().to_string();
    let res = srv
        .router
        .clone()
        .oneshot(axum::http::Request::get(&img_url).body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.headers()["content-type"], "image/png");
    assert!(res.headers()["content-disposition"].to_str().unwrap().starts_with("inline"));

    let mut ws = connect(&srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    send(&mut ws, json!({"type": "SendChat", "payload": {
        "channel_id": "geral", "content": "", "attachment_ids": [att_id], "nonce": "a1"
    }})).await;
    let m = wait_for(&mut ws, "NewChatMessage").await;
    assert_eq!(m["message"]["attachments"][0]["kind"], "image");
    assert_eq!(m["message"]["attachments"][0]["url"], img_url.as_str());

    send(&mut ws, json!({"type": "SendChat", "payload": {
        "channel_id": "geral", "content": "x", "attachment_ids": ["0123456789abcdef0123456789abcdef"], "nonce": "a2"
    }})).await;
    assert_eq!(wait_for(&mut ws, "SendFailed").await["nonce"], "a2");
}

/// Fase 3: menções resolvidas no servidor, contagem de não lidas, ack e "marcar como não lida".
#[tokio::test]
async fn mentions_unread_ack_and_mark_unread() {
    let srv = start_server().await;
    let (mut a, server, _sid) = owner_with_server(&srv, "Ana Paula", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let code = server["invite_code"].as_str().unwrap().to_string();
    let t_bia = register(&srv, "Bia").await;
    let mut b = connect(&srv, &t_bia).await;
    wait_for(&mut b, "Welcome").await;
    send(&mut b, json!({"type": "JoinServerByInvite", "payload": {"invite_code": code}})).await;
    wait_for(&mut b, "ServerCreated").await;
    drop(b);
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Ana menciona Bia (offline) duas vezes; email e código não contam.
    for text in ["oi @Bia!", "@bia veja isso", "mande para x@bia.com", "`@Bia` não conta"] {
        send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": geral, "content": text}})).await;
        let m = wait_for(&mut a, "NewChatMessage").await;
        let users = m["message"]["mentions"]["users"].as_array().cloned().unwrap_or_default();
        if text.starts_with("oi") || text.starts_with("@bia") {
            assert_eq!(users, vec![json!("bia")], "{text}");
        } else {
            assert!(users.is_empty(), "{text}");
        }
    }
    // @everyone sem permissão não marca ninguém; o dono tem permissão.
    send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": geral, "content": "@everyone reunião"}})).await;
    let last = wait_for(&mut a, "NewChatMessage").await["message"].clone();
    assert_eq!(last["mentions"]["everyone"], true);

    // Bia volta: Welcome traz 3 menções pendentes (2 diretas + everyone).
    let mut b = connect(&srv, &t_bia).await;
    let w = wait_for(&mut b, "Welcome").await;
    let rs = w["read_states"].as_array().unwrap().iter().find(|r| r["channel_id"] == geral.as_str()).unwrap().clone();
    assert_eq!(rs["mention_count"], 3);
    let last_id = last["id"].as_str().unwrap().to_string();
    assert!(rs["last_read_at"].as_i64().unwrap() < last["created_at"].as_i64().unwrap(), "canal está não lido");

    // Ack zera menções e avança a leitura.
    send(&mut b, json!({"type": "AckChannel", "payload": {"channel_id": geral, "message_id": last_id}})).await;
    let up = wait_for(&mut b, "ReadStateUpdated").await["state"].clone();
    assert_eq!(up["mention_count"], 0);
    assert_eq!(up["last_read_at"], last["created_at"]);

    // Marcar como não lida volta a posição para antes da mensagem.
    send(&mut b, json!({"type": "MarkUnread", "payload": {"channel_id": geral, "message_id": last_id}})).await;
    let up = wait_for(&mut b, "ReadStateUpdated").await["state"].clone();
    assert_eq!(up["last_read_at"].as_i64().unwrap(), last["created_at"].as_i64().unwrap() - 1);

    // O próprio autor não acumula menções nem não lidas.
    let t_ana = post(&srv, "/api/login", json!({"username": "Ana Paula", "password": "senha-segura-1"})).await.1["token"]
        .as_str()
        .unwrap()
        .to_string();
    let mut a2 = connect(&srv, &t_ana).await;
    let w = wait_for(&mut a2, "Welcome").await;
    let rs = w["read_states"].as_array().unwrap().iter().find(|r| r["channel_id"] == geral.as_str()).unwrap().clone();
    assert_eq!(rs["mention_count"], 0);
    assert_eq!(rs["last_read_at"], last["created_at"]);
}

/// Fase 3: pular para mensagem antiga (janela ao redor), carregar mais novas e fixadas fora do cache.
#[tokio::test]
async fn jump_around_load_after_and_pins() {
    let srv = start_server().await;
    let token = register(&srv, "Historiadora").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    let mut first_id = String::new();
    for i in 0..160 {
        // Respeita o limite de ritmo (8 mensagens / 5 s) adiantando o relógio do limitador.
        srv.state.write().await.rates.clear();
        send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": "geral", "content": format!("msg {i}")}})).await;
        let m = wait_for(&mut a, "NewChatMessage").await;
        if i == 5 {
            first_id = m["message"]["id"].as_str().unwrap().to_string();
        }
    }
    send(&mut a, json!({"type": "TogglePinChat", "payload": {"channel_id": "geral", "message_id": first_id}})).await;
    wait_for(&mut a, "MessageUpdated").await;

    send(&mut a, json!({"type": "LoadMessages", "payload": {"channel_id": "geral", "around_id": first_id, "limit": 20}})).await;
    let page = wait_for(&mut a, "MessagesPage").await;
    let msgs = page["messages"].as_array().unwrap();
    assert!(msgs.iter().any(|m| m["id"] == first_id.as_str()));
    assert_eq!(page["has_more_after"], true);
    let newest = msgs.last().unwrap()["id"].as_str().unwrap().to_string();

    send(&mut a, json!({"type": "LoadMessages", "payload": {"channel_id": "geral", "after_id": newest, "limit": 50}})).await;
    let page = wait_for(&mut a, "MessagesPage").await;
    assert_eq!(page["messages"].as_array().unwrap().len(), 50);
    assert_eq!(page["has_more_after"], true);

    // A mensagem fixada é antiga (fora das 100 do cache) e ainda aparece na lista.
    send(&mut a, json!({"type": "ListPins", "payload": {"channel_id": "geral"}})).await;
    let pins = wait_for(&mut a, "PinnedMessages").await;
    assert_eq!(pins["messages"][0]["id"], first_id.as_str());

    // Responder a uma mensagem antiga (fora do cache) gera a referência.
    send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": "geral", "content": "lembra disso?", "reply_to_id": first_id}})).await;
    let m = wait_for(&mut a, "NewChatMessage").await;
    assert_eq!(m["message"]["reply_to"]["id"], first_id.as_str());
}

/// Fase 3: anti-spam (ritmo de mensagens) e reações só com emoji.
#[tokio::test]
async fn rate_limit_and_reaction_validation() {
    let srv = start_server().await;
    let token = register(&srv, "Apressado").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    for i in 0..9 {
        send(&mut a, json!({"type": "SendChat", "payload": {"channel_id": "geral", "content": format!("{i}"), "nonce": format!("n{i}")}})).await;
    }
    let failed = wait_for(&mut a, "SendFailed").await;
    assert_eq!(failed["nonce"], "n8");
    assert!(failed["message"].as_str().unwrap().contains("rápido"));

    let msg_id = srv.state.read().await.chat_history["geral"].last().unwrap().id.clone();
    send(&mut a, json!({"type": "ToggleReaction", "payload": {"channel_id": "geral", "message_id": msg_id, "emoji": "<b>oi</b>"}})).await;
    let fb = wait_for(&mut a, "ServerFeedback").await;
    assert_eq!(fb["action"], "reaction");
    send(&mut a, json!({"type": "ToggleReaction", "payload": {"channel_id": "geral", "message_id": msg_id, "emoji": "🔥"}})).await;
    let up = wait_for(&mut a, "MessageUpdated").await;
    assert_eq!(up["message"]["reactions"]["🔥"][0], "Apressado");
}

#[test]
fn protocol_serialization_shapes() {
    // O frontend depende destes formatos { type, payload }.
    let m: crate::models::ClientMessage = serde_json::from_value(json!({
        "type": "SendChat", "payload": {"channel_id": "geral", "content": "oi"}
    }))
    .unwrap();
    assert!(matches!(m, crate::models::ClientMessage::SendChat { nonce: None, .. }));
    let ping: crate::models::ClientMessage = serde_json::from_value(json!({"type": "Ping"})).unwrap();
    assert!(matches!(ping, crate::models::ClientMessage::Ping));

    let out = serde_json::to_value(crate::models::ServerMessage::AuthFailed { message: "x".into() }).unwrap();
    assert_eq!(out, json!({"type": "AuthFailed", "payload": {"message": "x"}}));
}
