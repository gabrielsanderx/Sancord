//! O hub público "sancord" saiu do produto: contas novas não entram em servidor nenhum
//! sozinhas e um hub antigo é apagado de vez (canais, mensagens) ao iniciar.
use super::*;

async fn start_without_hub(dir: std::path::PathBuf) -> TestServer {
    let state = ServerState::load(Config::for_tests_without_hub(dir.clone())).expect("estado");
    let router = crate::build_router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    TestServer { addr, router, state, dir }
}

#[tokio::test]
async fn nova_conta_nao_entra_em_hub_nenhum() {
    let dir = std::env::temp_dir().join(format!("sancord-nohub-{}", uuid::Uuid::new_v4()));
    let srv = start_without_hub(dir).await;
    let token = register(&srv, "Nova").await;
    let mut ws = connect(&srv, &token).await;
    let welcome = wait_for(&mut ws, "Welcome").await;
    assert_eq!(welcome["servers"], json!([]), "sem servidor automático");
    assert_eq!(welcome["text_channels"], json!([]));
    assert_eq!(welcome["voice_channels"], json!([]));
    let st = srv.state.read().await;
    assert!(st.find_server("sancord").is_none());
    assert!(!st.chat_history.contains_key("geral"));
}

#[tokio::test]
async fn hub_antigo_e_apagado_ao_iniciar_e_servidores_proprios_ficam() {
    // Banco de uma versão antiga: hub com mensagem e um servidor criado pela pessoa.
    let srv = start_server().await;
    let token = register(&srv, "Antiga").await;
    let mut ws = connect(&srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    send(&mut ws, json!({"type": "SendChat", "payload": {"channel_id": "geral", "content": "mensagem no hub"}})).await;
    wait_for(&mut ws, "NewChatMessage").await;
    send(&mut ws, json!({"type": "CreateServer", "payload": {"name": "Meu servidor", "template": "friends"}})).await;
    let own = wait_for(&mut ws, "ServerCreated").await["server"].clone();
    let own_id = own["id"].as_str().unwrap().to_string();
    let own_channel = own["text_channels"][0]["id"].as_str().unwrap().to_string();
    send(&mut ws, json!({"type": "SendChat", "payload": {"channel_id": own_channel, "content": "fica"}})).await;
    wait_for(&mut ws, "NewChatMessage").await;
    let db = srv.state.read().await.db.clone();
    db.flush();
    drop(ws);

    // Versão nova sobre o mesmo banco: o hub some com o histórico dele.
    {
        let reopened = ServerState::load(Config::for_tests_without_hub(srv.dir.clone())).unwrap();
        let st = reopened.read().await;
        assert!(st.find_server("sancord").is_none());
        assert!(!st.chat_history.contains_key("geral"));
        assert!(!st.invites.contains_key("SANCORD"));
        assert!(st.find_server(&own_id).is_some(), "servidor da pessoa continua");
        assert!(st.chat_history[&own_channel].iter().any(|m| m.content == "fica"), "mensagens do servidor próprio ficam");
        st.db.flush();
    }
    // E continua apagado depois de reiniciar de novo (saiu do banco, não só da memória).
    let again = ServerState::load(Config::for_tests_without_hub(srv.dir.clone())).unwrap();
    let st = again.read().await;
    assert!(st.find_server("sancord").is_none());
    assert!(!st.chat_history.contains_key("geral"));
    assert_eq!(st.servers.len(), 1);
    assert_eq!(st.db.count_messages("geral").unwrap(), 0, "mensagens do hub apagadas do banco");
}
