//! E-mail obrigatório: cadastro com e-mail único, login por e-mail ou nome,
//! confirmação por código e contas antigas sem e-mail.
use super::*;
use crate::mailer::{Mailer, SentMail};
use std::sync::{Arc, Mutex};

async fn start_with_email() -> (TestServer, Arc<Mutex<Vec<SentMail>>>) {
    let dir = std::env::temp_dir().join(format!("sanvo-email-{}", uuid::Uuid::new_v4()));
    let state = ServerState::load(Config::for_tests_with_email_verification(dir.clone())).expect("estado");
    let (mailer, outbox) = Mailer::memory();
    state.write().await.mailer = mailer;
    let router = crate::build_router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (TestServer { addr, router, state, dir }, outbox)
}

fn last_code(outbox: &Arc<Mutex<Vec<SentMail>>>, to: &str) -> String {
    let mails = outbox.lock().unwrap();
    let mail = mails.iter().rev().find(|m| m.to == to).expect("e-mail enviado");
    mail.subject.chars().take(6).collect()
}

async fn ws_first(srv: &TestServer, token: &str) -> Value {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", srv.addr)).await.unwrap();
    send(&mut ws, json!({"type": "JoinServer", "payload": {"token": token}})).await;
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(5), ws.next()).await.unwrap().unwrap().unwrap();
        if let WsMsg::Text(t) = msg {
            return serde_json::from_str(&t).unwrap();
        }
    }
}

#[tokio::test]
async fn cadastro_exige_email_unico_e_confirmado() {
    let (srv, outbox) = start_with_email().await;
    let (s, b) = post(&srv, "/api/register", json!({"username": "Ana", "password": "senha-segura-1"})).await;
    assert_eq!((s, b["code"].as_str()), (400, Some("email_missing")));
    let (s, b) = post(&srv, "/api/register", json!({"username": "Ana", "email": "sem-arroba", "password": "senha-segura-1"})).await;
    assert_eq!((s, b["code"].as_str()), (400, Some("email_invalid")));

    let (s, b) = post(&srv, "/api/register", json!({"username": "Ana", "email": "Ana@Exemplo.com", "password": "senha-segura-1"})).await;
    assert_eq!(s, 200, "{b}");
    assert_eq!(b["email_step"], "verify");
    assert_eq!(b["email_hint"], "a***@exemplo.com");
    let token = b["token"].as_str().unwrap().to_string();

    // Mesmo e-mail em outra conta (sem diferenciar maiúsculas): recusado.
    let (s, b) = post(&srv, "/api/register", json!({"username": "Bia", "email": "ana@EXEMPLO.com", "password": "senha-segura-1"})).await;
    assert_eq!((s, b["code"].as_str()), (409, Some("email_taken")));

    // Sem confirmar, o app não abre.
    let first = ws_first(&srv, &token).await;
    assert_eq!(first["type"], "EmailVerificationRequired");
    assert_eq!(first["payload"]["step"], "verify");

    // Código errado conta tentativa; o certo confirma.
    let code = last_code(&outbox, "ana@exemplo.com");
    let wrong = if code == "000000" { "111111" } else { "000000" };
    let (s, b) = post(&srv, "/api/email/verify", json!({"token": token, "code": wrong})).await;
    assert_eq!((s, b["code"].as_str()), (401, Some("code_wrong")));
    let (s, b) = post(&srv, "/api/email/verify", json!({"token": token, "code": code})).await;
    assert_eq!(s, 200, "{b}");
    assert!(b["email_step"].is_null());
    assert_eq!(ws_first(&srv, &token).await["type"], "Welcome");

    // O código é de uso único.
    let (s, _) = post(&srv, "/api/email/verify", json!({"token": token, "code": code})).await;
    assert_eq!(s, 400);
}

#[tokio::test]
async fn login_por_email_ou_nome_e_reenvio_com_intervalo() {
    let (srv, outbox) = start_with_email().await;
    let (_, b) = post(&srv, "/api/register", json!({"username": "Caio", "email": "caio@exemplo.com", "password": "senha-segura-1"})).await;
    let token = b["token"].as_str().unwrap().to_string();

    // Reenvio imediato respeita o intervalo mínimo.
    let (s, b) = post(&srv, "/api/email/start", json!({"token": token})).await;
    assert_eq!((s, b["code"].as_str()), (429, Some("cooldown")));
    assert!(b["retry_after"].as_u64().unwrap() > 0);

    for ident in ["CAIO@exemplo.com", "caio"] {
        let (s, b) = post(&srv, "/api/login", json!({"username": ident, "password": "senha-segura-1"})).await;
        assert_eq!(s, 200, "login com {ident}");
        assert_eq!(b["email_step"], "verify", "ainda não confirmou");
    }
    let (s, _) = post(&srv, "/api/login", json!({"username": "ninguem@exemplo.com", "password": "senha-segura-1"})).await;
    assert_eq!(s, 401);

    let code = last_code(&outbox, "caio@exemplo.com");
    let (s, _) = post(&srv, "/api/email/verify", json!({"token": token, "code": code})).await;
    assert_eq!(s, 200);
    let (s, b) = post(&srv, "/api/login", json!({"username": "caio@exemplo.com", "password": "senha-segura-1"})).await;
    assert_eq!(s, 200);
    assert!(b["email_step"].is_null());
}

#[tokio::test]
async fn conta_antiga_sem_email_cadastra_e_confirma_no_proximo_login() {
    let (srv, outbox) = start_with_email().await;
    let (_, b) = post(&srv, "/api/register", json!({"username": "Velha", "email": "temp@exemplo.com", "password": "senha-segura-1"})).await;
    let _ = b;
    post(&srv, "/api/register", json!({"username": "Outra", "email": "ocupado@exemplo.com", "password": "senha-segura-1"})).await;
    {
        // Simula uma conta de versão antiga: sem e-mail.
        let mut st = srv.state.write().await;
        let acc = st.accounts.get_mut("velha").unwrap();
        acc.email = None;
        acc.email_verified = false;
        st.email_codes.clear();
    }
    let (s, b) = post(&srv, "/api/login", json!({"username": "velha", "password": "senha-segura-1"})).await;
    assert_eq!(s, 200);
    assert_eq!(b["email_step"], "add");
    let token = b["token"].as_str().unwrap().to_string();
    let first = ws_first(&srv, &token).await;
    assert_eq!((first["type"].as_str(), first["payload"]["step"].as_str()), (Some("EmailVerificationRequired"), Some("add")));

    let (s, b) = post(&srv, "/api/email/start", json!({"token": token, "email": "OCUPADO@exemplo.com"})).await;
    assert_eq!((s, b["code"].as_str()), (409, Some("email_taken")));
    let (s, b) = post(&srv, "/api/email/start", json!({"token": token, "email": "velha@exemplo.com"})).await;
    assert_eq!(s, 200, "{b}");
    assert_eq!(b["email_step"], "verify");
    let code = last_code(&outbox, "velha@exemplo.com");
    let (s, _) = post(&srv, "/api/email/verify", json!({"token": token, "code": code})).await;
    assert_eq!(s, 200);
    assert_eq!(ws_first(&srv, &token).await["type"], "Welcome");
    let st = srv.state.read().await;
    let acc = st.accounts.get("velha").unwrap();
    assert_eq!((acc.email.as_deref(), acc.email_verified), (Some("velha@exemplo.com"), true));
}

#[tokio::test]
async fn trocar_email_nas_configuracoes_so_vale_depois_do_codigo() {
    let (srv, outbox) = start_with_email().await;
    let (_, b) = post(&srv, "/api/register", json!({"username": "Duda", "email": "duda@exemplo.com", "password": "senha-segura-1"})).await;
    let token = b["token"].as_str().unwrap().to_string();
    let code = last_code(&outbox, "duda@exemplo.com");
    post(&srv, "/api/email/verify", json!({"token": token, "code": code})).await;

    let mut ws = connect(&srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    send(&mut ws, json!({"type": "UpdateAccountEmail", "payload": {"email": "", "current_password": "senha-segura-1"}})).await;
    let fb = wait_for(&mut ws, "ServerFeedback").await;
    assert_eq!((fb["ok"].as_bool(), fb["action"].as_str()), (Some(false), Some("update_email")), "não remove o e-mail");

    send(&mut ws, json!({"type": "UpdateAccountEmail", "payload": {"email": "nova.duda@exemplo.com", "current_password": "senha-segura-1"}})).await;
    let fb = wait_for(&mut ws, "ServerFeedback").await;
    assert_eq!((fb["ok"].as_bool(), fb["action"].as_str()), (Some(true), Some("update_email_code")));
    {
        let st = srv.state.read().await;
        let acc = st.accounts.get("duda").unwrap();
        assert_eq!(acc.email.as_deref(), Some("duda@exemplo.com"), "o antigo vale até confirmar");
        assert_eq!(acc.pending_email.as_deref(), Some("nova.duda@exemplo.com"));
    }
    let code = last_code(&outbox, "nova.duda@exemplo.com");
    let (s, _) = post(&srv, "/api/email/verify", json!({"token": token, "code": code})).await;
    assert_eq!(s, 200);
    let st = srv.state.read().await;
    let acc = st.accounts.get("duda").unwrap();
    assert_eq!((acc.email.as_deref(), acc.pending_email.as_deref()), (Some("nova.duda@exemplo.com"), None));
}
