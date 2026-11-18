//! Fase 9 — preferências de notificação por servidor/canal.
use super::*;

#[tokio::test]
async fn notify_levels_are_sanitized_synced_and_persisted() {
    let srv = start_server().await;
    let token = register(&srv, "Notificada").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    let mut levels = serde_json::Map::new();
    levels.insert("srv-x".into(), json!("mentions"));
    levels.insert("canal-y".into(), json!("none"));
    levels.insert("canal-z".into(), json!("barulho"));
    levels.insert("".into(), json!("all"));
    levels.insert("x".repeat(200), json!("all"));
    send(&mut a, json!({"type":"UpdateUserPrefs","payload":{"notify_levels":levels}})).await;
    let prefs = wait_for(&mut a, "UserPrefsUpdated").await["prefs"]["notify_levels"].clone();
    assert_eq!(prefs, json!({"srv-x":"mentions","canal-y":"none"}));

    // Outra conexão da mesma conta recebe no Welcome; sobrevive a reinício.
    let mut b = connect(&srv, &token).await;
    assert_eq!(wait_for(&mut b, "Welcome").await["prefs"]["notify_levels"]["canal-y"], "none");
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let acc = st.accounts.get("notificada").unwrap().id.clone();
    assert_eq!(st.user_prefs[&acc].notify_levels["srv-x"], "mentions");

    // Outros campos de preferência não apagam os níveis.
    drop(st);
    send(&mut a, json!({"type":"UpdateUserPrefs","payload":{"muted_servers":[]}})).await;
    let prefs = wait_for(&mut a, "UserPrefsUpdated").await["prefs"]["notify_levels"].clone();
    assert_eq!(prefs["srv-x"], "mentions");
}
#[tokio::test]
async fn author_kind_marks_system_messages_and_users_cannot_spoof() {
    let srv = start_server().await;
    let (mut dono, server, _sid) = owner_with_server(&srv, "DonaAutor", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    // Mensagem de boas-vindas do servidor recém-criado é de sistema.
    let st = srv.state.read().await;
    let welcome = st.chat_history.values().flatten().find(|m| m.author_id == "system").cloned().unwrap();
    assert_eq!(welcome.author_kind, crate::models::AuthorKind::System);
    drop(st);
    assert_eq!(serde_json::to_value(&welcome).unwrap()["author_kind"], "system");

    // O cliente não escolhe o tipo: campo extra é ignorado e a mensagem é de usuário.
    send(&mut dono, json!({"type":"SendChat","payload":{"channel_id":geral,"content":"sou um bot?","author_kind":"bot"}})).await;
    let m = loop {
        let m = wait_for(&mut dono, "NewChatMessage").await;
        if m["message"]["content"] == "sou um bot?" { break m; }
    };
    assert!(m["message"].get("author_kind").is_none(), "usuário não serializa o campo");

    // Mensagem antiga (sem o campo) com author_id "system" continua sendo sistema.
    let legacy: crate::models::ChatMessage = serde_json::from_value(json!({
        "id":"x","channel_id":"c","author_id":"system","author_name":"Sancord","author_color":"#fff",
        "content":"oi","timestamp":"10:00"
    })).unwrap();
    assert_eq!(legacy.author_kind(), crate::models::AuthorKind::System);
}