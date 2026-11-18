use super::*;
async fn api(srv: &TestServer, method: &str, path: &str, token: &str, body: Value) -> (u16, Value) {
    let req = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body.to_string()))
        .unwrap();
    let res = srv.router.clone().oneshot(req).await.unwrap();
    let status = res.status().as_u16();
    assert!(res.headers()["cache-control"]
        .to_str()
        .unwrap()
        .contains("no-store"));
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
async fn owner_token(srv: &TestServer, name: &str) -> String {
    let (status, body) = post(
        srv,
        "/api/login",
        json!({"username":name,"password":"senha-segura-1"}),
    )
    .await;
    assert_eq!(status, 200);
    body["token"].as_str().unwrap().to_owned()
}
#[tokio::test]
async fn integration_publishes_realtime_persists_rotates_and_revokes() {
    let srv = start_server().await;
    let (mut ws, server, _) = owner_with_server(&srv, "IntegraDona", "friends").await;
    let channel = server["text_channels"][0]["id"].as_str().unwrap();
    let owner = owner_token(&srv, "IntegraDona").await;
    for kind in ["bot", "webhook"] {
        let path = format!("/api/channels/{channel}/integrations");
        let (status, created) = api(
            &srv,
            "POST",
            &path,
            &owner,
            json!({"kind":kind,"name":"Avisos"}),
        )
        .await;
        assert_eq!(status, 201);
        let id = created["integration"]["id"].as_str().unwrap();
        let secret = created["token"].as_str().unwrap();
        assert_ne!(srv.state.read().await.integrations[id].token_hash, secret);
        let (_, list) = api(&srv, "GET", &path, &owner, json!(null)).await;
        assert!(!list.to_string().contains(secret));
        assert!(!list.to_string().contains("token_hash"));
        let endpoint = format!("/api/integrations/{id}/messages");
        let (status, message) = api(
            &srv,
            "POST",
            &endpoint,
            secret,
            json!({"content":format!("Aviso {kind}"),"channel_id":"outro","author_kind":"system"}),
        )
        .await;
        assert_eq!(status, 201);
        assert_eq!(message["message"]["author_kind"], kind);
        assert_eq!(message["message"]["channel_id"], channel);
        loop {
            let event = wait_for(&mut ws, "NewChatMessage").await;
            if event["message"]["id"] == message["message"]["id"] {
                break;
            }
        }
        let db = srv.state.read().await.db.clone();
        db.flush();
        let reopened = ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
        assert_eq!(
            reopened.read().await.integrations[id].token_hash,
            crate::auth::hash_token(secret)
        );
        assert!(db.load_recent_messages(100).unwrap()[channel]
            .iter()
            .any(|m| m.id == message["message"]["id"].as_str().unwrap()));
        let (status, rotated) = api(
            &srv,
            "POST",
            &format!("/api/integrations/{id}/rotate"),
            &owner,
            json!({}),
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(
            api(&srv, "POST", &endpoint, secret, json!({"content":"antigo"}))
                .await
                .0,
            401
        );
        let next = rotated["token"].as_str().unwrap();
        assert_eq!(
            api(&srv, "POST", &endpoint, next, json!({"content":"renovado"}))
                .await
                .0,
            201
        );
        assert_eq!(
            api(
                &srv,
                "POST",
                &format!("/api/integrations/{id}/revoke"),
                &owner,
                json!({})
            )
            .await
            .0,
            200
        );
        assert_eq!(
            api(&srv, "POST", &endpoint, next, json!({"content":"revogado"}))
                .await
                .0,
            401
        );
    }
}
#[tokio::test]
async fn integration_permissions_automod_rate_limit_and_channel_deletion() {
    let srv = start_server().await;
    let (mut ws, server, sid) = owner_with_server(&srv, "DonaHooks", "friends").await;
    let channel = server["text_channels"][0]["id"].as_str().unwrap();
    let owner = owner_token(&srv, "DonaHooks").await;
    let (mut member_ws, _) =
        join_with(&srv, "SemHooks", server["invite_code"].as_str().unwrap()).await;
    let member = owner_token(&srv, "SemHooks").await;
    let path = format!("/api/channels/{channel}/integrations");
    assert_eq!(
        api(
            &srv,
            "POST",
            &path,
            "invalido",
            json!({"kind":"bot","name":"X"})
        )
        .await
        .0,
        401
    );
    assert_eq!(
        api(
            &srv,
            "POST",
            &path,
            &member,
            json!({"kind":"bot","name":"X"})
        )
        .await
        .0,
        403
    );
    let (_, created) = api(
        &srv,
        "POST",
        &path,
        &owner,
        json!({"kind":"webhook","name":"SemHooks"}),
    )
    .await;
    let id = created["integration"]["id"].as_str().unwrap();
    let secret = created["token"].as_str().unwrap();
    let endpoint = format!("/api/integrations/{id}/messages");
    assert_eq!(
        api(
            &srv,
            "POST",
            &format!("/api/integrations/{id}/rotate"),
            &member,
            json!({})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        api(
            &srv,
            "POST",
            &endpoint,
            &member,
            json!({"content":"impostor"})
        )
        .await
        .0,
        401
    );
    let (status, message) = api(
        &srv,
        "POST",
        &endpoint,
        secret,
        json!({"content":"original"}),
    )
    .await;
    assert_eq!(status, 201);
    let mid = message["message"]["id"].as_str().unwrap();
    send(&mut member_ws,json!({"type":"EditChat","payload":{"channel_id":channel,"message_id":mid,"content":"alterada"}})).await;
    send(
        &mut member_ws,
        json!({"type":"DeleteChat","payload":{"channel_id":channel,"message_id":mid}}),
    )
    .await;
    loop {
        let feedback = wait_for(&mut member_ws, "ServerFeedback").await;
        if feedback["action"] == "delete_chat" {
            assert_eq!(feedback["ok"], false);
            break;
        }
    }
    assert_eq!(
        srv.state.read().await.chat_history[channel]
            .iter()
            .find(|m| m.id == mid)
            .unwrap()
            .content,
        "original"
    );
    {
        let mut st = srv.state.write().await;
        st.find_server_mut(&sid).unwrap().automod.enabled = true;
        st.find_server_mut(&sid).unwrap().automod.blocked_words = vec!["bloqueada".into()];
    }
    assert_eq!(
        api(
            &srv,
            "POST",
            &endpoint,
            secret,
            json!({"content":"bloqueada"})
        )
        .await
        .0,
        422
    );
    assert_eq!(
        api(&srv, "POST", &endpoint, secret, json!({"content":""}))
            .await
            .0,
        400
    );
    {
        let mut st = srv.state.write().await;
        st.find_server_mut(&sid).unwrap().automod.enabled = false;
    }
    let mut limited = false;
    for _ in 0..15 {
        if api(
            &srv,
            "POST",
            &endpoint,
            secret,
            json!({"content":"Mensagem"}),
        )
        .await
        .0 == 429
        {
            limited = true;
            break;
        }
    }
    assert!(limited);
    send(
        &mut ws,
        json!({"type":"DeleteChannel","payload":{"server_id":sid,"channel_id":channel}}),
    )
    .await;
    wait_for(&mut ws, "ChannelDeleted").await;
    assert_eq!(
        api(&srv, "POST", &endpoint, secret, json!({"content":"depois"}))
            .await
            .0,
        401
    );
    let db = srv.state.read().await.db.clone();
    db.flush();
    assert!(!db.load_integrations().unwrap().iter().any(|i| i.id == id));
}
