use super::*;

async fn save_profile(ws: &mut Ws, sid: &str, fields: Value) -> Value {
    let mut payload = fields;
    payload["server_id"] = json!(sid);
    send(ws, json!({"type":"SetServerProfile","payload":payload})).await;
    loop {
        let feedback = wait_for(ws, "ServerFeedback").await;
        if feedback["action"] == "server_profile" {
            return feedback;
        }
    }
}

#[tokio::test]
async fn server_profiles_validate_persist_sync_and_clear_per_member() {
    let srv = start_server().await;
    let (_owner, server, sid) = owner_with_server(&srv, "DonaP5", "friends").await;
    let invite = server["invite_code"].as_str().unwrap();
    let (mut member, joined) = join_with(&srv, "MembroP5", invite).await;
    assert_eq!(joined["type"], "ServerCreated");
    let viewer_token = register(&srv, "VisitaP5").await;
    let mut viewer = connect(&srv, &viewer_token).await;
    wait_for(&mut viewer, "Welcome").await;
    let outsider_token = register(&srv, "ForaP5").await;
    let mut outsider = connect(&srv, &outsider_token).await;
    wait_for(&mut outsider, "Welcome").await;
    let (status, image) = upload(&srv, &viewer_token, "perfil.png", tiny_png()).await;
    assert_eq!(status, 200, "{image}");
    let attachment = image["attachment"]["id"].as_str().unwrap();

    assert_eq!(
        save_profile(&mut viewer, &sid, json!({"bio":"Sem acesso"})).await["ok"],
        false
    );
    assert_eq!(
        save_profile(&mut viewer, "sancord", json!({"bio":"Hub"})).await["ok"],
        false
    );
    send(
        &mut viewer,
        json!({"type":"JoinServerByInvite","payload":{"invite_code":invite}}),
    )
    .await;
    wait_for(&mut viewer, "ServerCreated").await;
    assert_eq!(
        save_profile(
            &mut member,
            &sid,
            json!({"avatar_attachment_id":attachment,"bio":"Inválida"})
        )
        .await["ok"],
        false
    );
    assert!(!srv
        .state
        .read()
        .await
        .find_server(&sid)
        .unwrap()
        .member_profiles
        .contains_key("membrop5"));
    assert_eq!(
        save_profile(
            &mut viewer,
            &sid,
            json!({"avatar_attachment_id":attachment,"bio":"á".repeat(301)})
        )
        .await["ok"],
        false
    );
    assert!(!srv
        .state
        .read()
        .await
        .find_server(&sid)
        .unwrap()
        .member_profiles
        .contains_key("visitap5"));

    let feedback = save_profile(
        &mut viewer,
        &sid,
        json!({
            "avatar_attachment_id":attachment,
            "banner_attachment_id":attachment,
            "bio":" Minha bio local ",
        }),
    )
    .await;
    assert_eq!(feedback["ok"], true, "{feedback}");
    let event = wait_for(&mut member, "ServerProfileUpdated").await;
    assert_eq!(event["server_id"], sid);
    assert_eq!(event["username"], "visitap5");
    assert_eq!(event["profile"]["bio"], "Minha bio local");
    let url = format!("/api/attachments/{attachment}/perfil.png");
    assert_eq!(event["profile"]["avatar"]["url"], url);
    assert_eq!(event["profile"]["banner"]["url"], url);
    assert_eq!(event["profile"]["avatar"]["animated"], false);

    // Outra conexão recebe os mesmos dados no snapshot, após se tornar membro.
    let (mut late, joined) = join_with(&srv, "ChegouP5", invite).await;
    assert_eq!(
        joined["payload"]["server"]["member_profiles"]["visitap5"],
        event["profile"]
    );
    send(
        &mut outsider,
        json!({"type":"GetUserProfile","payload":{"username":"VisitaP5","server_id":sid}}),
    )
    .await;
    let outsider_response =
        wait_for_any(&mut outsider, &["ServerProfileUpdated", "UserProfile"]).await;
    assert_eq!(outsider_response["type"], "UserProfile");
    assert!(outsider_response["payload"]["user"]["bio"].is_null());
    assert!(outsider_response["payload"]["user"]["avatar_url"].is_null());
    assert!(outsider_response["payload"]["joined_server_at"].is_null());

    let db = srv.state.read().await.db.clone();
    db.flush();
    {
        let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
        let state = reopened.read().await;
        let profile = &state.find_server(&sid).unwrap().member_profiles["visitap5"];
        assert_eq!(serde_json::to_value(profile).unwrap(), event["profile"]);
        assert!(state.accounts["visitap5"].bio.is_none());
        assert!(state.accounts["visitap5"].avatar_url.is_none());
    }

    assert_eq!(
        save_profile(&mut viewer, &sid, json!({"bio":""})).await["ok"],
        true
    );
    let changed = wait_for(&mut late, "ServerProfileUpdated").await;
    assert!(changed["profile"]["bio"].is_null());
    assert_eq!(changed["profile"]["avatar"]["url"], url);
    assert_eq!(
        save_profile(
            &mut viewer,
            &sid,
            json!({"avatar_attachment_id":"","banner_attachment_id":""})
        )
        .await["ok"],
        true
    );
    assert!(wait_for(&mut late, "ServerProfileUpdated").await["profile"].is_null());
    assert_eq!(
        save_profile(&mut viewer, &sid, json!({"bio":"Bio para apagar ao sair"})).await["ok"],
        true
    );
    send(
        &mut viewer,
        json!({"type":"LeaveServer","payload":{"server_id":sid}}),
    )
    .await;
    wait_for(&mut viewer, "ServerRemoved").await;
    db.flush();
    let reloaded = db.load_servers().unwrap();
    assert!(!reloaded
        .iter()
        .find(|s| s.id == sid)
        .unwrap()
        .member_profiles
        .contains_key("visitap5"));
}

#[tokio::test]
async fn server_profile_cosmetics_and_theme_validate_persist_redact_and_clear() {
    let srv = start_server().await;
    let (_owner, server, sid) = owner_with_server(&srv, "DonaCosm", "friends").await;
    let invite = server["invite_code"].as_str().unwrap();
    let (mut member, _) = join_with(&srv, "MembroCosm", invite).await;
    let (mut viewer, _) = join_with(&srv, "LeitorCosm", invite).await;

    // Cosmético bloqueado (founder) deve ser recusado sem gravar nada.
    let locked = save_profile(
        &mut member,
        &sid,
        json!({ "profile_frame": "founder", "avatar_decoration": "nebula-orbit" }),
    )
    .await;
    assert_eq!(locked["ok"], false, "{locked}");
    assert!(!srv
        .state
        .read()
        .await
        .find_server(&sid)
        .unwrap()
        .member_profiles
        .contains_key("membrocosm"));

    // Cor inválida deve ser recusada.
    let bad_color = save_profile(
        &mut member,
        &sid,
        json!({ "theme_primary": "red;background:url(x)" }),
    )
    .await;
    assert_eq!(bad_color["ok"], false, "{bad_color}");

    // Cosméticos gratuitos e tema válidos são salvos e difundidos.
    let saved = save_profile(
        &mut member,
        &sid,
        json!({
            "avatar_decoration": "nebula-orbit",
            "profile_frame": "minimal",
            "profile_effect": "aurora",
            "nameplate_style": "core-stripe",
            "name_style": "custom-gradient",
            "name_color": "#C984ED",
            "name_color_secondary": "#4CCFBE",
            "name_gradient_direction": "diagonal",
            "theme_mode": "gradient",
            "theme_primary": "#1E1F29",
            "theme_accent": "#5865F2",
            "theme_highlight": "#22D3EE",
            "theme_direction": "radial"
        }),
    )
    .await;
    assert_eq!(saved["ok"], true, "{saved}");
    let event = wait_for(&mut viewer, "ServerProfileUpdated").await;
    assert_eq!(event["profile"]["avatar_decoration"], "nebula-orbit");
    assert_eq!(event["profile"]["profile_frame"], "minimal");
    assert_eq!(event["profile"]["profile_effect"], "aurora");
    assert_eq!(event["profile"]["nameplate_style"], "core-stripe");
    assert_eq!(event["profile"]["name_style"], "custom-gradient");
    assert_eq!(event["profile"]["name_color"], "#c984ed");
    assert_eq!(event["profile"]["name_color_secondary"], "#4ccfbe");
    assert_eq!(event["profile"]["name_gradient_direction"], "diagonal");
    assert_eq!(event["profile"]["theme_mode"], "gradient");
    assert_eq!(event["profile"]["theme_primary"], "#1e1f29");
    assert_eq!(event["profile"]["theme_accent"], "#5865f2");
    assert_eq!(event["profile"]["theme_highlight"], "#22d3ee");
    assert_eq!(event["profile"]["theme_direction"], "radial");

    // Persistência após reabrir banco.
    let db = srv.state.read().await.db.clone();
    db.flush();
    {
        let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
        let state = reopened.read().await;
        let profile = &state.find_server(&sid).unwrap().member_profiles["membrocosm"];
        assert_eq!(profile.avatar_decoration.as_deref(), Some("nebula-orbit"));
        assert_eq!(profile.profile_frame.as_deref(), Some("minimal"));
        assert_eq!(profile.theme_primary.as_deref(), Some("#1e1f29"));
    }

    // Privacidade "only_me" oculta os cosméticos locais para terceiros na projeção.
    send(
        &mut member,
        json!({"type":"SetProfilePrivacy","payload":{"privacy":{"audience":"only_me"}}}),
    )
    .await;
    let redacted_event = loop {
        let ev = wait_for(&mut viewer, "ServerProfileUpdated").await;
        if ev["username"] == "membrocosm" {
            break ev;
        }
    };
    assert!(redacted_event["profile"]["avatar_decoration"].is_null());
    assert!(redacted_event["profile"]["profile_frame"].is_null());
    assert!(redacted_event["profile"]["theme_primary"].is_null());

    // Limpar tudo com texto vazio volta a herdar do perfil global.
    let cleared = save_profile(
        &mut member,
        &sid,
        json!({
            "avatar_decoration": "",
            "profile_frame": "",
            "profile_effect": "",
            "nameplate_style": "",
            "name_style": "",
            "name_color": "",
            "name_color_secondary": "",
            "name_gradient_direction": "",
            "theme_mode": "",
            "theme_primary": "",
            "theme_accent": "",
            "theme_highlight": "",
            "theme_direction": ""
        }),
    )
    .await;
    assert_eq!(cleared["ok"], true, "{cleared}");
    assert!(!srv
        .state
        .read()
        .await
        .find_server(&sid)
        .unwrap()
        .member_profiles
        .contains_key("membrocosm"));
}
