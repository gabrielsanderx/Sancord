use super::*;

async fn privacy_profile(ws: &mut Ws, sid: &str) -> Value {
    send(
        ws,
        json!({"type":"GetUserProfile","payload":{"username":"DonaPrivada","server_id":sid}}),
    )
    .await;
    wait_for(ws, "UserProfile").await
}

#[tokio::test]
async fn profile_privacy_filters_realtime_server_profiles_rosters_and_card() {
    let srv = start_server().await;
    let token = register(&srv, "DonaPrivada").await;
    let mut owner = connect(&srv, &token).await;
    wait_for(&mut owner, "Welcome").await;
    let mut second = connect(&srv, &token).await;
    wait_for(&mut second, "Welcome").await;
    send(
        &mut owner,
        json!({"type":"CreateServer","payload":{"name":"Perfil privado","template":"friends"}}),
    )
    .await;
    let server = wait_for(&mut owner, "ServerCreated").await["server"].clone();
    let sid = server["id"].as_str().unwrap();
    let (mut member, reply) = join_with(
        &srv,
        "ColegaPrivado",
        server["invite_code"].as_str().unwrap(),
    )
    .await;
    assert_eq!(reply["type"], "ServerCreated");
    send(
        &mut owner,
        json!({"type":"UpdateProfile","payload":{
            "display_name":"Meu nome", "bio":"Minha bio", "pronouns":"ela",
            "profile_frame":"core-pulse","custom_status":"Meu status"
        }}),
    )
    .await;
    send(&mut owner, json!({"type":"SaveProfileBoard","payload":{"board":{
        "revision":0,"audience":"everyone","widgets":[{"kind":"about","visible":true,"text":"Meu mural"}]
    }}})).await;
    wait_for(&mut owner, "ProfileBoardSaved").await;
    send(
        &mut owner,
        json!({"type":"SetProfileLink","payload":{
            "label":"Link público","url":"https://example.org/","visible":true
        }}),
    )
    .await;
    let links = wait_for(&mut owner, "ProfileSharingState").await;
    assert_eq!(links["links"][0]["visible"], true);
    send(
        &mut owner,
        json!({"type":"SetProfileLink","payload":{
            "label":"Link oculto","url":"https://example.net/","visible":false
        }}),
    )
    .await;
    wait_for(&mut owner, "ProfileSharingState").await;
    assert_eq!(
        privacy_profile(&mut member, sid).await["links"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    send(
        &mut owner,
        json!({"type":"SetProfilePrivacy","payload":{"privacy":{
            "audience":"shared_spaces","bio":"only_me","pronouns":"friends","banner":"only_me",
            "activity":"only_me","status":"friends","board":"friends","connections":"only_me"
        }}}),
    )
    .await;
    let private = wait_for(&mut owner, "ProfileSharingState").await;
    loop {
        if wait_for(&mut second, "ProfileSharingState").await == private {
            break;
        }
    }
    send(&mut owner, json!({"type":"SetServerProfile","payload":{"server_id":sid,"bio":"Bio secreta do servidor"}})).await;
    assert!(wait_for(&mut member, "ServerProfileUpdated").await["profile"]["bio"].is_null());
    let guest_token = register(&srv, "LeitorExterno").await;
    let mut guest = connect(&srv, &guest_token).await;
    let welcome = wait_for(&mut guest, "Welcome").await;
    let identity = welcome["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["username"] == "DonaPrivada")
        .unwrap();
    assert_eq!(identity["display_name"], "Meu nome");
    for field in [
        "bio",
        "pronouns",
        "banner_url",
        "custom_status",
        "profile_frame",
        "created_at",
    ] {
        assert!(
            identity[field].is_null(),
            "campo revelou informação: {field}"
        );
    }
    let peer_card = privacy_profile(&mut member, sid).await;
    assert_eq!(peer_card["details_visible"], true);
    assert_eq!(peer_card["bio_visible"], false);
    assert_eq!(peer_card["banner_visible"], false);
    assert_eq!(peer_card["activity_visible"], false);
    assert_eq!(peer_card["user"]["profile_frame"], "core-pulse");
    assert!(peer_card["board"].is_null() && peer_card["links"].is_null());
    let outsider = privacy_profile(&mut guest, sid).await;
    assert_eq!(outsider["details_visible"], false);
    assert!(outsider["joined_server_at"].is_null() && outsider["links"].is_null());
    let own = privacy_profile(&mut second, sid).await;
    assert_eq!(own["user"]["bio"], "Minha bio");
    assert_eq!(own["board"]["widgets"][0]["text"], "Meu mural");
    assert_eq!(own["links"].as_array().unwrap().len(), 1);

    send(
        &mut guest,
        json!({"type":"OpenDm","payload":{"target_username":"DonaPrivada"}}),
    )
    .await;
    let dm = wait_for(&mut guest, "DmOpened").await;
    assert!(dm["peer"]["bio"].is_null() && dm["peer"]["profile_frame"].is_null());
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let sharing = &st.accounts["donaprivada"].profile_sharing;
    assert_eq!(
        serde_json::to_value(&sharing.privacy).unwrap(),
        private["privacy"]
    );
    assert!(sharing
        .links
        .iter()
        .any(|link| link.label == "Link oculto" && !link.visible));
}

#[tokio::test]
async fn manual_links_cannot_forge_verification_and_challenges_stay_private() {
    let srv = start_server().await;
    let token = register(&srv, "ConexaoDona").await;
    let mut owner = connect(&srv, &token).await;
    wait_for(&mut owner, "Welcome").await;
    send(
        &mut owner,
        json!({"type":"SetProfileLink","payload":{
            "label":"GitHub","url":"javascript:alert(1)","visible":true
        }}),
    )
    .await;
    assert_eq!(wait_for(&mut owner, "ServerFeedback").await["ok"], false);
    send(&mut owner, json!({"type":"SetProfileLink","payload":{
        "label":"GitHub","url":"https://github.com/octocat","visible":true,"verified_github":true
    }})).await;
    let result = wait_for(&mut owner, "ProfileSharingState").await;
    let id = result["links"][0]["id"].as_str().unwrap();
    assert_eq!(result["links"][0]["verified_github"], false);
    send(
        &mut owner,
        json!({"type":"StartGitHubProfileVerification","payload":{"id":id}}),
    )
    .await;
    let challenge = wait_for(&mut owner, "ProfileSharingState").await;
    assert!(challenge["links"][0]["challenge"]["code"]
        .as_str()
        .unwrap()
        .starts_with("sancord-"));
    let (mut outsider, _, _) = owner_with_server(&srv, "VisitaLink", "friends").await;
    send(
        &mut outsider,
        json!({"type":"GetUserProfile","payload":{"username":"ConexaoDona"}}),
    )
    .await;
    let view = wait_for(&mut outsider, "UserProfile").await;
    assert_eq!(view["links"][0]["verified_github"], false);
    assert!(view["links"][0].get("challenge").is_none());
    send(
        &mut outsider,
        json!({"type":"RemoveProfileLink","payload":{"id":id}}),
    )
    .await;
    assert_eq!(wait_for(&mut outsider, "ServerFeedback").await["ok"], false);
    send(
        &mut owner,
        json!({"type":"SetProfileLink","payload":{
            "id":id,"label":"GitHub","url":"https://github.com/monalisa","visible":true
        }}),
    )
    .await;
    assert!(wait_for(&mut owner, "ProfileSharingState").await["links"][0]["challenge"].is_null());
}

#[tokio::test]
async fn social_platforms_detect_and_validate_and_badge_admin_enforces_operator_auth() {
    let srv = start_server().await;
    let op_token = register(&srv, "OperadorSelos").await;
    let user_token = register(&srv, "MembroComum").await;
    // Concede selo founder via badge_grants para o operador antes da conexão.
    {
        let mut st = srv.state.write().await;
        st.badge_grants
            .insert("operadorselos".into(), vec!["founder".into()]);
        if let Some(acc) = st.accounts.get_mut("operadorselos") {
            acc.profile.badges = crate::cosmetics::effective_badges(acc, &["founder".into()]);
        }
    }
    let mut op = connect(&srv, &op_token).await;
    wait_for(&mut op, "Welcome").await;
    let mut user = connect(&srv, &user_token).await;
    wait_for(&mut user, "Welcome").await;

    // 1. Detecção automática e validação de plataformas sociais.
    send(
        &mut user,
        json!({"type":"SetProfileLink","payload":{
            "label":"Minha Steam","url":"https://steamcommunity.com/id/teste","visible":true
        }}),
    )
    .await;
    let state = wait_for(&mut user, "ProfileSharingState").await;
    assert_eq!(state["links"][0]["platform"], "steam");
    assert_eq!(state["links"][0]["verified_github"], false);

    send(
        &mut user,
        json!({"type":"SetProfileLink","payload":{
            "label":"Canal","url":"https://twitch.tv/sancord","visible":true,"platform":"plataforma_invalida"
        }}),
    )
    .await;
    assert_eq!(wait_for(&mut user, "ServerFeedback").await["ok"], false);

    // 2. Usuário comum não vê contas nem pode conceder selos.
    send(&mut user, json!({"type":"GetBadgeAdminState"})).await;
    let denied = wait_for(&mut user, "BadgeAdminState").await;
    assert_eq!(denied["can_manage"], false);
    assert_eq!(denied["accounts"], json!([]));

    send(
        &mut user,
        json!({"type":"SetUserBadges","payload":{"target_username":"MembroComum","badges":["founder"]}}),
    )
    .await;
    assert_eq!(wait_for(&mut user, "ServerFeedback").await["ok"], false);

    // 3. Operador vê contas, concede selos válidos, persiste em badges.json e evita auto-bloqueio.
    send(&mut op, json!({"type":"GetBadgeAdminState"})).await;
    let admin = wait_for(&mut op, "BadgeAdminState").await;
    assert_eq!(admin["can_manage"], true);
    assert!(admin["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == "MembroComum"));

    // Impede remover o próprio selo de operador quando é o único operador.
    send(
        &mut op,
        json!({"type":"SetUserBadges","payload":{"target_username":"OperadorSelos","badges":[]}}),
    )
    .await;
    assert_eq!(wait_for(&mut op, "ServerFeedback").await["ok"], false);

    // Recusa selo desconhecido.
    send(
        &mut op,
        json!({"type":"SetUserBadges","payload":{"target_username":"MembroComum","badges":["inexistente"]}}),
    )
    .await;
    assert_eq!(wait_for(&mut op, "ServerFeedback").await["ok"], false);

    // Concede bug_hunter e event_winner para MembroComum.
    send(
        &mut op,
        json!({"type":"SetUserBadges","payload":{"target_username":"MembroComum","badges":["bug_hunter","event_winner"]}}),
    )
    .await;
    let updated_admin = wait_for(&mut op, "BadgeAdminState").await;
    assert_eq!(
        updated_admin["grants"]["membrocomum"],
        json!(["bug_hunter", "event_winner"])
    );
    let fb = wait_for(&mut op, "ServerFeedback").await;
    assert_eq!(fb["ok"], true, "{fb}");

    // Verifica persistência em badges.json e atualização imediata de CosmeticsState/badges do alvo.
    let loaded_grants = crate::cosmetics::load_badge_grants(&srv.dir);
    assert_eq!(
        loaded_grants.get("membrocomum").cloned(),
        Some(vec!["bug_hunter".to_string(), "event_winner".to_string()])
    );
    let self_upd = wait_for(&mut user, "SelfUpdated").await;
    let user_badges: Vec<&str> = self_upd["user"]["badges"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert!(user_badges.contains(&"bug_hunter"), "{user_badges:?}");
    assert!(user_badges.contains(&"event_winner"), "{user_badges:?}");
}
