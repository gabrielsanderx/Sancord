//! Etapa C3 — silenciar por tempo (preferências) e caixa de menções.
use super::*;

async fn create_role(ws: &mut Ws, sid: &str, name: &str) -> String {
    send(ws, json!({"type":"CreateRole","payload":{"server_id":sid,"name":name,"color":"#123456","mentionable":true,"permissions":{}}})).await;
    loop {
        let up = wait_for(ws, "ServerUpdated").await;
        if let Some(r) = up["server"]["roles"].as_array().unwrap().iter().find(|r| r["name"] == name) {
            return r["id"].as_str().unwrap().to_string();
        }
    }
}

async fn assign(owner: &mut Ws, sid: &str, user: &str, role: &str) {
    send(owner, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":user,"role_ids":[role]}})).await;
    let lower = user.to_lowercase();
    loop {
        let up = wait_for(owner, "ServerUpdated").await;
        if up["server"]["member_roles"][&lower].as_array().is_some_and(|r| r.iter().any(|id| id == role)) {
            return;
        }
    }
}

async fn send_chat(ws: &mut Ws, channel: &str, content: &str) -> Value {
    let nonce = uuid::Uuid::new_v4().to_string();
    send(ws, json!({"type":"SendChat","payload":{"channel_id":channel,"content":content,"nonce":nonce}})).await;
    loop {
        let v = wait_for_any(ws, &["NewChatMessage", "SendFailed"]).await;
        let pl = &v["payload"];
        if pl["nonce"] == nonce.as_str() || pl["message"]["nonce"] == nonce.as_str() {
            return v;
        }
    }
}

async fn inbox(ws: &mut Ws, extra: Value) -> Vec<String> {
    let mut payload = json!({"query":"","mentions_me":true,"request_id":"inbox1"});
    if let (Some(p), Some(e)) = (payload.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            p.insert(k.clone(), v.clone());
        }
    }
    send(ws, json!({"type":"SearchMessages","payload":payload})).await;
    let r = wait_for(ws, "SearchResults").await;
    assert_eq!(r["request_id"], "inbox1");
    r["hits"].as_array().unwrap().iter().map(|h| h["message"]["content"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn timed_mutes_are_sanitized_synced_and_persisted() {
    let srv = start_server().await;
    let token = register(&srv, "Silenciosa").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    let now = chrono::Utc::now().timestamp_millis();
    let mut mutes = serde_json::Map::new();
    mutes.insert("canal-1h".into(), json!(now + 3_600_000));
    mutes.insert("cat-sempre".into(), json!(0));
    mutes.insert("vencido".into(), json!(now - 1000));
    mutes.insert("negativo".into(), json!(-5));
    mutes.insert("".into(), json!(0));
    mutes.insert("x".repeat(200), json!(0));
    send(&mut a, json!({"type":"UpdateUserPrefs","payload":{"mutes":mutes}})).await;
    let prefs = wait_for(&mut a, "UserPrefsUpdated").await["prefs"]["mutes"].clone();
    assert_eq!(prefs, json!({"canal-1h": now + 3_600_000, "cat-sempre": 0}));

    // Outros campos não apagam; outra conexão recebe no Welcome; sobrevive a reinício.
    send(&mut a, json!({"type":"UpdateUserPrefs","payload":{"notify_levels":{}}})).await;
    assert_eq!(wait_for(&mut a, "UserPrefsUpdated").await["prefs"]["mutes"]["cat-sempre"], 0);
    let mut b = connect(&srv, &token).await;
    assert_eq!(wait_for(&mut b, "Welcome").await["prefs"]["mutes"]["canal-1h"], now + 3_600_000);
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let acc = st.accounts.get("silenciosa").unwrap().id.clone();
    assert_eq!(st.user_prefs[&acc].mutes.len(), 2);

    // Um silêncio que venceu depois de salvo não volta mais para o cliente.
    drop(st);
    {
        let mut st = srv.state.write().await;
        let acc = st.accounts.get("silenciosa").unwrap().id.clone();
        let mut p = st.user_prefs[&acc].clone();
        p.mutes.insert("acabou".into(), now - 1);
        st.set_prefs(&acc, p);
        let seen = st.prefs_for(&acc, "silenciosa");
        assert!(!seen.mutes.contains_key("acabou"));
        assert!(seen.mutes.contains_key("cat-sempre"));
    }
}

#[test]
fn sanitize_mutes_caps_entries() {
    let now = 1_000;
    let many: std::collections::HashMap<String, i64> = (0..800).map(|i| (format!("id-{i}"), 0)).collect();
    assert_eq!(crate::models::UserPrefs::sanitize_mutes(many, now).len(), crate::models::UserPrefs::MAX_MUTES);
}

#[tokio::test]
async fn mentions_inbox_lists_direct_everyone_and_role_mentions_only_where_readable() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaInbox", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let (mut ana, _) = join_with(&srv, "AnaInbox", server["invite_code"].as_str().unwrap()).await;
    let turma = create_role(&mut dona, &sid, "Turma").await;
    let outro = create_role(&mut dona, &sid, "Outros").await;
    assign(&mut dona, &sid, "AnaInbox", &turma).await;

    // Canal que a Ana não vê.
    send(&mut dona, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"diretoria","kind":"text",
        "overwrites":[{"target_type":"role","target_id":"everyone","permissions":{"view_channel":false}}],"permissions_synced":false}})).await;
    let secreto = wait_for(&mut dona, "ChannelCreated").await["channel"]["id"].as_str().unwrap().to_string();

    send_chat(&mut dona, &geral, "oi @AnaInbox tudo bem?").await;
    send_chat(&mut dona, &geral, "@everyone reunião às 18h").await;
    send_chat(&mut dona, &geral, "@Turma tragam o material").await;
    send_chat(&mut dona, &geral, "@Outros não é com a Ana").await;
    send_chat(&mut dona, &geral, "mensagem comum").await;
    send_chat(&mut dona, &secreto, "@AnaInbox segredo").await;
    send_chat(&mut ana, &geral, "eu mesma falando @AnaInbox").await;
    let _ = outro;

    let got = inbox(&mut ana, json!({})).await;
    assert_eq!(
        got,
        vec!["@Turma tragam o material".to_string(), "@everyone reunião às 18h".to_string(), "oi @AnaInbox tudo bem?".to_string()],
        "mais recentes primeiro; sem canal privado, sem as próprias e sem cargo alheio"
    );
    // Recorte por servidor também funciona.
    assert_eq!(inbox(&mut ana, json!({"server_id": sid})).await.len(), 3);
    // A dona não tem menções para si (escreveu tudo).
    assert!(inbox(&mut dona, json!({})).await.is_empty());
}
