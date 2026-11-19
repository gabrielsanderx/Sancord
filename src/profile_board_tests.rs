use super::*;

async fn request_board(ws: &mut Ws) -> Value {
    send(ws, json!({"type":"GetProfileBoard"})).await;
    wait_for(ws, "ProfileBoardState").await["board"].clone()
}

async fn visit(ws: &mut Ws, username: &str) -> Value {
    send(
        ws,
        json!({"type":"GetUserProfile","payload":{"username":username}}),
    )
    .await;
    wait_for(ws, "UserProfile").await
}

async fn save(ws: &mut Ws, board: &Value) {
    send(
        ws,
        json!({"type":"SaveProfileBoard","payload":{"board":board}}),
    )
    .await;
}

#[tokio::test]
async fn creator_milestone_survives_transfer_and_legacy_recovery() {
    let srv = start_server().await;
    let token = register(&srv, "CriadoraMural").await;
    let mut creator = connect(&srv, &token).await;
    wait_for(&mut creator, "Welcome").await;
    send(&mut creator, json!({"type":"CreateServer","payload":{"name":"Clube Mural","template":"friends"}})).await;
    let community = wait_for(&mut creator, "ServerCreated").await["server"].clone();
    let (mut successor, _) = join_with(&srv, "HerdeiroMural", community["invite_code"].as_str().unwrap()).await;
    let board = json!({"revision":0,"audience":"everyone","widgets":[{"kind":"achievements","visible":true}]});
    for owner in [&mut creator, &mut successor] {
        save(owner, &board).await;
        wait_for(owner, "ProfileBoardSaved").await;
    }
    send(&mut creator, json!({"type":"TransferServerOwnership","payload":{"server_id":community["id"],"new_owner_username":"HerdeiroMural"}})).await;
    assert_eq!(wait_for(&mut creator, "ServerFeedback").await["ok"], true);
    assert_eq!(visit(&mut successor, "CriadoraMural").await["board"]["achievements"],
        json!(["early_user", "milestone_first_server"]));
    assert_eq!(visit(&mut creator, "HerdeiroMural").await["board"]["achievements"], json!(["early_user"]));

    let mut state = srv.state.write().await;
    state.accounts.get_mut("criadoramural").unwrap().created_community = false;
    crate::profile_board::restore_first_creation(&mut state);
    assert!(state.accounts["criadoramural"].created_community);
    assert!(!state.accounts["herdeiromural"].created_community);
    state.db.flush();
    let stored = state.db.load_accounts().unwrap();
    assert_eq!(stored.iter().filter(|account| account.created_community).count(), 1);
}

#[tokio::test]
async fn profile_board_filters_audience_and_hidden_widgets_and_syncs_edits() {
    let srv = start_server().await;
    let token = register(&srv, "DonaMural").await;
    let mut owner = connect(&srv, &token).await;
    wait_for(&mut owner, "Welcome").await;
    let mut second = connect(&srv, &token).await;
    let welcome = wait_for(&mut second, "Welcome").await;
    assert!(welcome["user"]["profile_board"].is_null());
    let board = request_board(&mut owner).await;
    assert_eq!(
        board,
        json!({"revision":0,"audience":"everyone","widgets":[]})
    );

    send(
        &mut owner,
        json!({"type":"CreateServer","payload":{"name":"Turma Mural","template":"friends"}}),
    )
    .await;
    let server = wait_for(&mut owner, "ServerCreated").await["server"].clone();
    let (mut member, reply) =
        join_with(&srv, "ColegaMural", server["invite_code"].as_str().unwrap()).await;
    assert_eq!(reply["type"], "ServerCreated");
    let outside_token = register(&srv, "ForaMural").await;
    let mut outside = connect(&srv, &outside_token).await;
    wait_for(&mut outside, "Welcome").await;
    let (code, cover) = upload(&srv, &token, "capa.png", tiny_png()).await;
    assert_eq!(code, 200);
    let cover = &cover["attachment"]["id"];

    let mut board = json!({"revision":0,"audience":"shared_spaces","widgets":[
        {"kind":"favorite_game","visible":true,"name":" Jogo A ","description":"","cover_id":cover},
        {"kind":"about","visible":false,"text":"Rascunho privado"},
        {"kind":"achievements","visible":true}
    ]});
    save(&mut owner, &board).await;
    let saved = wait_for(&mut owner, "ProfileBoardSaved").await["board"].clone();
    assert_eq!(saved["revision"], 1);
    assert_eq!(saved["widgets"][0]["name"], "Jogo A");
    assert_eq!(
        wait_for(&mut second, "ProfileBoardState").await["board"],
        saved
    );
    let visible = visit(&mut member, "DonaMural").await;
    assert_eq!(visible["board"]["widgets"].as_array().unwrap().len(), 2);
    assert_eq!(visible["board"]["widgets"][0]["cover_id"], *cover);
    assert_eq!(visible["board"]["widgets"][1]["kind"], "achievements");
    assert_eq!(
        visible["board"]["achievements"],
        json!(["early_user", "milestone_first_server"])
    );
    assert!(visit(&mut outside, "DonaMural")
        .await
        .get("board")
        .is_none());

    // Rev 0 não sobrescreve a ordem e a visibilidade da rev 1.
    board["widgets"] = json!([]);
    save(&mut second, &board).await;
    assert_eq!(
        wait_for(&mut second, "ProfileBoardState").await["board"],
        saved
    );
    assert_eq!(wait_for(&mut second, "ServerFeedback").await["ok"], false);
    board = saved;
    board["widgets"].as_array_mut().unwrap().rotate_right(1);
    board["widgets"][2]["visible"] = json!(true);
    board["audience"] = json!("friends");
    save(&mut owner, &board).await;
    board = wait_for(&mut owner, "ProfileBoardSaved").await["board"].clone();
    assert!(visit(&mut member, "DonaMural").await.get("board").is_none());
    send(
        &mut owner,
        json!({"type":"SendFriendRequest","payload":{"target_username":"ColegaMural"}}),
    )
    .await;
    loop {
        let sync = wait_for(&mut member, "FriendsSync").await;
        if sync["incoming_requests"]
            .as_array()
            .unwrap()
            .iter()
            .any(|u| u["username"] == "DonaMural")
        {
            break;
        }
    }
    send(&mut member, json!({"type":"RespondFriendRequest","payload":{"from_username":"DonaMural","accept":true}})).await;
    let visible = visit(&mut member, "DonaMural").await;
    assert_eq!(visible["board"]["widgets"], board["widgets"]);

    board["audience"] = json!("everyone");
    save(&mut owner, &board).await;
    board = wait_for(&mut owner, "ProfileBoardSaved").await["board"].clone();
    assert!(visit(&mut outside, "DonaMural").await["board"]["widgets"].is_array());
    send(
        &mut outside,
        json!({"type":"BlockUser","payload":{"target_username":"DonaMural"}}),
    )
    .await;
    assert!(visit(&mut outside, "DonaMural")
        .await
        .get("board")
        .is_none());

    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let state = reopened.read().await;
    assert_eq!(
        serde_json::to_value(&state.accounts["donamural"].profile_board).unwrap(),
        board
    );
}

#[tokio::test]
async fn profile_board_rejects_unsafe_links_foreign_covers_and_invalid_limits() {
    let srv = start_server().await;
    let token = register(&srv, "PerfilMural").await;
    let mut owner = connect(&srv, &token).await;
    wait_for(&mut owner, "Welcome").await;
    let other = register(&srv, "CapaAlheia").await;
    let (code, image) = upload(&srv, &other, "capa.png", tiny_png()).await;
    assert_eq!(code, 200);
    for widgets in [
        json!([{"kind":"link","visible":true,"label":"Link","url":"javascript:void(0)"}]),
        json!([{"kind":"link","visible":true,"label":"Link","url":"https://usuario@example.org/"}]),
        json!([{"kind":"favorite_game","visible":true,"name":"Jogo","description":"","cover_id":image["attachment"]["id"]}]),
        json!([{"kind":"about","visible":true,"text":"á".repeat(401)}]),
        json!(vec![
            json!({"kind":"playing","visible":true,"name":"Jogo"});
            9
        ]),
        json!(vec![json!({"kind":"achievements","visible":true}); 2]),
    ] {
        save(
            &mut owner,
            &json!({"revision":0,"audience":"everyone","widgets":widgets}),
        )
        .await;
        let feedback = wait_for(&mut owner, "ServerFeedback").await;
        assert_eq!(feedback["action"], "profile_board");
        assert_eq!(feedback["ok"], false, "{feedback}");
    }
    assert_eq!(request_board(&mut owner).await["widgets"], json!([]));
}

#[tokio::test]
async fn profile_board_supports_custom_widget_and_automatic_milestones() {
    let srv = start_server().await;
    let token = register(&srv, "MestreMural").await;
    let mut owner = connect(&srv, &token).await;
    wait_for(&mut owner, "Welcome").await;
    let (code, img) = upload(&srv, &token, "bloco.png", tiny_png()).await;
    assert_eq!(code, 200);
    let image_id = img["attachment"]["id"].as_str().unwrap();

    // Valida limites do bloco personalizado.
    for bad in [
        json!([{"kind":"custom","visible":true,"title":"","text":"ok"}]),
        json!([{"kind":"custom","visible":true,"title":"Título","text":"á".repeat(301)}]),
        json!([{"kind":"custom","visible":true,"title":"Título","text":"ok","emoji":"123456789"}]),
    ] {
        save(
            &mut owner,
            &json!({"revision":0,"audience":"everyone","widgets":bad}),
        )
        .await;
        let fb = wait_for(&mut owner, "ServerFeedback").await;
        assert_eq!(fb["ok"], false, "{fb}");
    }

    // Salva bloco personalizado válido + conquistas.
    let board = json!({
        "revision": 0,
        "audience": "everyone",
        "widgets": [
            {"kind":"custom","visible":true,"title":" Setup ","text":" Meu espaço no Sancord ","emoji":" ✨ ","image_id":image_id},
            {"kind":"achievements","visible":true}
        ]
    });
    save(&mut owner, &board).await;
    let saved = wait_for(&mut owner, "ProfileBoardSaved").await["board"].clone();
    assert_eq!(saved["widgets"][0]["title"], "Setup");
    assert_eq!(saved["widgets"][0]["text"], "Meu espaço no Sancord");
    assert_eq!(saved["widgets"][0]["emoji"], "✨");
    assert_eq!(saved["widgets"][0]["image_id"], image_id);

    // Simula 5 amigos e 100 mensagens + 1 servidor próprio para verificar marcos automáticos.
    send(
        &mut owner,
        json!({"type":"CreateServer","payload":{"name":"Comunidade Marcos","template":"friends"}}),
    )
    .await;
    wait_for(&mut owner, "ServerCreated").await;
    {
        let mut st = srv.state.write().await;
        st.friends_store.friends.insert(
            "mestremural".to_string(),
            vec![
                "a1".into(),
                "a2".into(),
                "a3".into(),
                "a4".into(),
                "a5".into(),
            ],
        );
        for i in 0..100 {
            st.insert_message(crate::models::ChatMessage {
                id: format!("m-{i}"),
                channel_id: "geral".into(),
                author_id: "u".into(),
                author_name: "MestreMural".into(),
                author_color: "#5865f2".into(),
                author_avatar: None,
                content: "oi".into(),
                image_url: None,
                reply_to: None,
                reactions: std::collections::HashMap::new(),
                edited: false,
                pinned: false,
                timestamp: "12:00".into(),
                created_at: 1000 + i as i64,
                nonce: None,
                attachments: Vec::new(),
                mentions: Default::default(),
                poll: None,
                author_kind: Default::default(),
                embeds: Vec::new(),
                forward: None,
            });
        }
    }
    let db = srv.state.read().await.db.clone();
    tokio::task::spawn_blocking(move || db.flush()).await.unwrap();

    let viewed = visit(&mut owner, "MestreMural").await;
    let achs: Vec<&str> = viewed["board"]["achievements"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert!(achs.contains(&"milestone_first_server"), "{achs:?}");
    assert!(achs.contains(&"milestone_5_friends"), "{achs:?}");
    assert!(achs.contains(&"milestone_100_messages"), "{achs:?}");
}
