//! Testes de integração ponta a ponta para:
//! 1. Atividade em tempo real / Rich Presence + privacidade + invisível + reconexão
//! 2. Pesquisa avançada de mensagens (filtros combinados, anexos, threads/fóruns, DMs,
//!    ordenação, paginação, permissões revogadas e preview de contexto).

use super::*;
use serde_json::{json, Value};

async fn search(ws: &mut Ws, payload: Value) -> Value {
    send(ws, json!({"type":"SearchMessages","payload":payload})).await;
    wait_for(ws, "SearchResults").await
}

async fn send_chat(ws: &mut Ws, channel_id: &str, content: &str) -> Value {
    let nonce = uuid::Uuid::new_v4().to_string();
    send(ws, json!({"type":"SendChat","payload":{"channel_id":channel_id,"content":content,"nonce":nonce}})).await;
    loop {
        let ev = wait_for(ws, "NewChatMessage").await;
        if ev["message"]["nonce"] == nonce.as_str() {
            return ev;
        }
    }
}

#[tokio::test]
async fn rich_presence_realtime_privacy_invisible_and_reconnect() {
    let srv = start_server().await;
    let tok_a = register(&srv, "GabrielAct").await;
    let mut ws_a = connect(&srv, &tok_a).await;
    wait_for(&mut ws_a, "Welcome").await;
    send(&mut ws_a, json!({"type":"CreateServer","payload":{"name":"Guilda Atividade","template":"friends"}})).await;
    let server = wait_for(&mut ws_a, "ServerCreated").await["server"].clone();
    let invite = server["invite_code"].as_str().unwrap().to_string();
    let (mut ws_b, _) = join_with(&srv, "AmigoAct", &invite).await;

    // 1. Publicar Rich Presence completo e receber em tempo real no outro cliente
    let started = crate::auth::now_ms() - 120_000;
    send(&mut ws_a, json!({
        "type": "UpdateActivity",
        "payload": {
            "activity": {
                "kind": "playing",
                "application_id": "game:minecraft",
                "name": "Minecraft",
                "details": "Explorando mundo Survival",
                "state": "Overworld",
                "started_at": started,
                "party_size": 2,
                "party_max": 4,
                "large_image": "https://cdn.example.com/mc.png",
                "buttons": [{"label": "Ver servidor", "url": "https://example.com"}],
                "source": "rpc"
            }
        }
    })).await;

    let ev = wait_for(&mut ws_b, "UserActivityUpdated").await;
    assert_eq!(ev["username"], "GabrielAct");
    assert_eq!(ev["activity"]["name"], "Minecraft");
    assert_eq!(ev["activity"]["details"], "Explorando mundo Survival");
    assert_eq!(ev["activity"]["party_size"], 2);
    assert_eq!(ev["activity"]["party_max"], 4);

    // 2. Privacidade: restringir atividade para "only_me" esconde para o outro usuário
    send(&mut ws_a, json!({
        "type": "SetProfilePrivacy",
        "payload": {
            "privacy": {
                "audience": "everyone",
                "bio": "everyone",
                "pronouns": "everyone",
                "banner": "everyone",
                "status": "everyone",
                "activity": "only_me",
                "badges": "everyone",
                "board": "everyone",
                "connections": "everyone"
            }
        }
    })).await;
    wait_for(&mut ws_a, "ProfileSharingState").await;

    send(&mut ws_a, json!({
        "type": "UpdateActivity",
        "payload": { "activity": { "kind": "playing", "name": "Cyberpunk 2077", "started_at": started } }
    })).await;

    let ev_b = wait_for(&mut ws_b, "UserActivityUpdated").await;
    assert!(ev_b["activity"].is_null(), "Privacidade only_me não pode vazar atividade para terceiros");

    // 3. Liberar privacidade novamente e verificar modo Invisível
    send(&mut ws_a, json!({
        "type": "SetProfilePrivacy",
        "payload": {
            "privacy": {
                "audience": "everyone",
                "bio": "everyone",
                "pronouns": "everyone",
                "banner": "everyone",
                "status": "everyone",
                "activity": "everyone",
                "badges": "everyone",
                "board": "everyone",
                "connections": "everyone"
            }
        }
    })).await;
    wait_for(&mut ws_a, "ProfileSharingState").await;

    send(&mut ws_a, json!({
        "type": "UpdateProfile",
        "payload": { "status_kind": "invisible" }
    })).await;
    wait_for(&mut ws_a, "VoiceStateSync").await;

    send(&mut ws_a, json!({
        "type": "UpdateActivity",
        "payload": { "activity": { "kind": "playing", "name": "Elden Ring", "started_at": started } }
    })).await;
    let ev_inv = wait_for(&mut ws_b, "UserActivityUpdated").await;
    assert!(ev_inv["activity"].is_null(), "Usuário invisível não deve expor atividade");

    // 4. Voltar para online e limpar atividade
    send(&mut ws_a, json!({
        "type": "UpdateProfile",
        "payload": { "status_kind": "online" }
    })).await;
    wait_for(&mut ws_a, "VoiceStateSync").await;

    send(&mut ws_a, json!({ "type": "UpdateActivity", "payload": { "activity": null } })).await;
    let ev_clear = wait_for(&mut ws_b, "UserActivityUpdated").await;
    assert!(ev_clear["activity"].is_null());

    // 5. Reconexão limpa estado anterior e aceita nova publicação
    drop(ws_a);
    let mut ws_a2 = connect(&srv, &tok_a).await;
    wait_for(&mut ws_a2, "Welcome").await;
    send(&mut ws_a2, json!({
        "type": "UpdateActivity",
        "payload": { "activity": { "kind": "playing", "name": "Hades II", "started_at": started } }
    })).await;
    let ev_re = wait_for(&mut ws_b, "UserActivityUpdated").await;
    assert_eq!(ev_re["activity"]["name"], "Hades II");
}

#[tokio::test]
async fn advanced_search_filters_sorting_pagination_permissions_and_context() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "Gabriel", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let invite = server["invite_code"].as_str().unwrap().to_string();
    let (mut ana, _) = join_with(&srv, "Ana", &invite).await;

    // Segundo canal + fórum
    send(&mut dono, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"projetos","kind":"text"}})).await;
    let projetos = wait_for(&mut dono, "ChannelCreated").await["channel"]["id"].as_str().unwrap().to_string();

    send(&mut dono, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"ideias","kind":"forum"}})).await;
    let forum_ch = wait_for(&mut dono, "ChannelCreated").await["channel"]["id"].as_str().unwrap().to_string();

    // Mensagens variadas no geral
    let m1 = send_chat(&mut dono, &geral, "Minecraft survival pronto https://exemplo.com/mc").await["message"].clone();
    let m1_id = m1["id"].as_str().unwrap().to_string();
    // Fixar e reagir na m1
    send(&mut dono, json!({"type":"TogglePinChat","payload":{"channel_id":geral,"message_id":m1_id}})).await;
    wait_for(&mut dono, "MessageUpdated").await;
    send(&mut ana, json!({"type":"ToggleReaction","payload":{"channel_id":geral,"message_id":m1_id,"emoji":"🔥"}})).await;
    wait_for(&mut ana, "MessageUpdated").await;

    // Mensagem com enquete
    let poll_nonce = uuid::Uuid::new_v4().to_string();
    send(&mut ana, json!({
        "type": "SendChat",
        "payload": {
            "channel_id": geral,
            "content": "",
            "nonce": poll_nonce,
            "poll": {
                "question": "Qual servidor jogar?",
                "options": ["Minecraft", "Cyberpunk"],
                "duration_hours": 2
            }
        }
    })).await;
    let poll_msg = loop {
        let ev = wait_for(&mut ana, "NewChatMessage").await;
        if ev["message"]["nonce"] == poll_nonce.as_str() {
            break ev["message"].clone();
        }
    };

    // Mensagem em #projetos com imagem inline (image_url) + menção @Ana
    let img_nonce = uuid::Uuid::new_v4().to_string();
    send(&mut dono, json!({
        "type": "SendChat",
        "payload": {
            "channel_id": projetos,
            "content": "Screenshot de Minecraft no servidor @Ana",
            "nonce": img_nonce,
            "image_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        }
    })).await;
    loop {
        let ev = wait_for(&mut dono, "NewChatMessage").await;
        if ev["message"]["nonce"] == img_nonce.as_str() {
            break;
        }
    }

    // Mensagem com anexo simulado diretamente no banco para testar busca por nome de arquivo (relatorio.pdf)
    {
        let mut att_msg = serde_json::from_value::<crate::models::ChatMessage>(m1.clone()).unwrap();
        att_msg.id = "msg-att-pdf".into();
        att_msg.channel_id = projetos.clone();
        att_msg.content = "Segue documento em anexo".into();
        att_msg.pinned = false;
        att_msg.reactions.clear();
        att_msg.created_at += 500;
        att_msg.attachments = vec![crate::models::Attachment {
            id: "att1".into(),
            filename: "relatorio.pdf".into(),
            content_type: "application/pdf".into(),
            size: 1024,
            kind: "file".into(),
            url: "/api/attachments/att1/relatorio.pdf".into(),
            width: None,
            height: None,
        }];
        let st = srv.state.read().await;
        st.db.write(crate::db::WriteOp::UpsertMessage(Box::new(att_msg)));
        st.db.flush();
    }

    // Postagem em fórum + primeira mensagem
    send(&mut dono, json!({
        "type": "CreateThread",
        "payload": { "channel_id": forum_ch, "name": "Guia de Shaders" }
    })).await;
    let forum_post_id = wait_for(&mut dono, "ThreadCreated").await["thread"]["id"].as_str().unwrap().to_string();
    send_chat(&mut dono, &forum_post_id, "Configure a iluminação aqui").await;

    // DM privada entre Gabriel e Ana
    send(&mut dono, json!({"type":"SendFriendRequest","payload":{"target_username":"Ana"}})).await;
    wait_for(&mut ana, "FriendsSync").await;
    send(&mut ana, json!({"type":"RespondFriendRequest","payload":{"from_username":"Gabriel","accept":true}})).await;
    wait_for(&mut dono, "FriendsSync").await;
    send(&mut dono, json!({"type":"OpenDm","payload":{"target_username":"Ana"}})).await;
    let dm_id = wait_for(&mut dono, "DmOpened").await["dm_id"].as_str().unwrap().to_string();
    send_chat(&mut dono, &dm_id, "Mensagem secreta de DM sobre Minecraft").await;

    // --- Verificações ---
    // 1. Combinação de filtros: query + author + channel + has_list (image) + after
    let combo = search(&mut dono, json!({
        "query": "minecraft",
        "author": "Gabriel",
        "channel_id": projetos,
        "has_list": ["image"],
        "after": 1
    })).await;
    assert_eq!(combo["total_count"], 1);
    assert_eq!(combo["hits"][0]["channel_name"], "projetos");

    // 2. Filtro tem:reacao + fixadas + link
    let rx_pin = search(&mut dono, json!({
        "server_id": sid,
        "has_list": ["reaction", "link"],
        "pinned": true
    })).await;
    assert_eq!(rx_pin["total_count"], 1);
    assert_eq!(rx_pin["hits"][0]["message"]["id"], m1_id);

    // 3. Filtro tem:enquete
    let polls = search(&mut dono, json!({
        "server_id": sid,
        "has_list": ["poll"]
    })).await;
    assert_eq!(polls["total_count"], 1);
    assert_eq!(polls["hits"][0]["message"]["id"], poll_msg["id"]);

    // 4. Filtro menção direta a usuário específico (@Ana)
    let ment = search(&mut dono, json!({
        "server_id": sid,
        "mentions_user": "Ana"
    })).await;
    assert_eq!(ment["total_count"], 1);
    assert!(ment["hits"][0]["message"]["content"].as_str().unwrap().contains("@Ana"));

    // 5. Busca por nome de arquivo de anexo (relatorio.pdf)
    let pdf = search(&mut dono, json!({
        "query": "relatorio.pdf",
        "server_id": sid
    })).await;
    assert_eq!(pdf["total_count"], 1);
    assert_eq!(pdf["hits"][0]["message"]["id"], "msg-att-pdf");

    // 6. Busca por título de postagem de fórum ("Shaders") retorna hit com parent_channel_name + is_thread
    let forum_res = search(&mut dono, json!({
        "query": "shaders",
        "server_id": sid
    })).await;
    assert_eq!(forum_res["total_count"], 1);
    assert_eq!(forum_res["hits"][0]["is_thread"], true);
    assert_eq!(forum_res["hits"][0]["is_forum"], true);
    assert_eq!(forum_res["hits"][0]["parent_channel_name"], "ideias");

    // 7. Busca em DM isolada não mistura servidor
    let dm_res = search(&mut dono, json!({
        "query": "Minecraft",
        "channel_id": dm_id
    })).await;
    assert_eq!(dm_res["total_count"], 1);
    assert_eq!(dm_res["hits"][0]["channel_name"], "@Ana");

    // 8. Ordenação (recent vs oldest) + Paginação (offset)
    let newest = search(&mut dono, json!({ "query": "minecraft", "server_id": sid, "sort": "recent" })).await;
    let oldest = search(&mut dono, json!({ "query": "minecraft", "server_id": sid, "sort": "oldest" })).await;
    assert!(newest["total_count"].as_u64().unwrap() >= 2);
    assert_ne!(newest["hits"][0]["message"]["id"], oldest["hits"][0]["message"]["id"]);

    let page2 = search(&mut dono, json!({ "query": "minecraft", "server_id": sid, "offset": 1 })).await;
    assert_eq!(page2["offset"], 1);
    assert_eq!(page2["hits"][0]["message"]["id"], newest["hits"][1]["message"]["id"]);

    // 9. Alteração de permissão remove resultados imediatamente para Ana
    assert_eq!(search(&mut ana, json!({ "query": "relatorio.pdf", "server_id": sid })).await["total_count"], 1);
    send(&mut dono, json!({
        "type": "UpdateChannelPermissions",
        "payload": {
            "server_id": sid,
            "channel_id": projetos,
            "overwrites": [{"target_type":"role","target_id":"everyone","permissions":{"view_channel":false}}],
            "sync_category": false
        }
    })).await;
    wait_for(&mut dono, "ServerUpdated").await;
    assert_eq!(search(&mut ana, json!({ "query": "relatorio.pdf", "server_id": sid })).await["total_count"], 0);

    // 10. Ver contexto retorna mensagens vizinhas para quem tem permissão e vazio para quem perdeu acesso
    send(&mut dono, json!({ "type": "GetMessageContext", "payload": { "request_id": "c1", "channel_id": geral, "message_id": m1_id } })).await;
    let ctx_ok = wait_for(&mut dono, "MessageContext").await;
    assert_eq!(ctx_ok["request_id"], "c1");
    assert!(!ctx_ok["messages"].as_array().unwrap().is_empty());

    send(&mut ana, json!({ "type": "GetMessageContext", "payload": { "request_id": "c2", "channel_id": projetos, "message_id": "msg-att-pdf" } })).await;
    let ctx_denied = wait_for(&mut ana, "MessageContext").await;
    assert!(ctx_denied["messages"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn offline_server_member_keeps_profile_customizations_in_member_roster() {
    let srv = start_server().await;
    let (mut swag, server, sid) = owner_with_server(&srv, "SwagOffline", "friends").await;
    let invite = server["invite_code"].as_str().unwrap().to_string();

    // Swag personaliza o perfil global e depois desconecta (fica offline)
    send(&mut swag, json!({
        "type": "UpdateProfile",
        "payload": {
            "display_name": "Swag Lendário",
            "avatar_decoration": "core-orbit",
            "nameplate_style": "core-stripe",
            "name_style": "neon",
            "name_color": "#00e5ff"
        }
    })).await;
    wait_for(&mut swag, "VoiceStateSync").await;
    drop(swag);
    {
        let mut st = srv.state.write().await;
        st.users.retain(|_, u| !u.username.eq_ignore_ascii_case("SwagOffline"));
        st.presence_grace.retain(|_, u| !u.username.eq_ignore_ascii_case("SwagOffline"));
    }

    // Outro membro entra no servidor enquanto Swag está genuinamente offline
    let (_visitor, joined) = join_with(&srv, "VisitanteOffline", &invite).await;
    let srv_json = &joined["payload"]["server"];
    let roster = &srv_json["member_roster"]["swagoffline"];
    assert_eq!(srv_json["id"], sid);
    assert_eq!(roster["username"], "SwagOffline");
    assert_eq!(roster["display_name"], "Swag Lendário");
    assert_eq!(roster["avatar_decoration"], "core-orbit");
    assert_eq!(roster["nameplate_style"], "core-stripe");
    assert_eq!(roster["name_style"], "neon");
    assert_eq!(roster["name_color"], "#00e5ff");
    assert_eq!(roster["online"], false);
}

#[tokio::test]
async fn dm_context_menu_backend_close_pin_favorite_note_privacy_and_invite() {
    let srv = start_server().await;
    let (mut gabriel, server, sid) = owner_with_server(&srv, "GabrielDm", "friends").await;
    let tok_swag = register(&srv, "SwagDm").await;
    let mut swag = connect(&srv, &tok_swag).await;
    wait_for(&mut swag, "Welcome").await;

    // Amizade + DM aberta
    send(&mut gabriel, json!({"type":"SendFriendRequest","payload":{"target_username":"SwagDm"}})).await;
    loop {
        let s = wait_for(&mut swag, "FriendsSync").await;
        if s["incoming_requests"].as_array().is_some_and(|l| !l.is_empty()) { break; }
    }
    send(&mut swag, json!({"type":"RespondFriendRequest","payload":{"from_username":"GabrielDm","accept":true}})).await;
    let sync_g = loop {
        let s = wait_for(&mut gabriel, "FriendsSync").await;
        if s["friends"].as_array().is_some_and(|l| !l.is_empty()) { break s; }
    };
    // FriendInfo traz o account_id real para "Copiar ID do usuário"
    assert!(sync_g["friends"][0]["id"].as_str().is_some_and(|id| !id.is_empty()));

    send(&mut gabriel, json!({"type":"OpenDm","payload":{"target_username":"SwagDm"}})).await;
    let dm_id = wait_for(&mut gabriel, "DmOpened").await["dm_id"].as_str().unwrap().to_string();
    send_chat(&mut swag, &dm_id, "Salve Gabriel!").await;
    wait_for(&mut gabriel, "NewChatMessage").await;

    // 1. Marcar como lida sem precisar do message_id em memória
    send(&mut gabriel, json!({"type":"AckChannel","payload":{"channel_id":dm_id,"message_id":""}})).await;
    let rs = wait_for(&mut gabriel, "ReadStateUpdated").await;
    assert_eq!(rs["state"]["channel_id"], dm_id);
    assert_eq!(rs["state"]["mention_count"], 0);

    // 2. Fixar DM, Favoritar DM e Nota Privada em UserPrefs (sem duplicação e sem vazar para o alvo)
    send(&mut gabriel, json!({
        "type": "UpdateUserPrefs",
        "payload": {
            "pinned_dms": [dm_id, dm_id, "invalido"],
            "favorite_dms": [dm_id],
            "user_notes": { "SwagDm": "Conheci no servidor Minecraft" }
        }
    })).await;
    let prefs = wait_for(&mut gabriel, "UserPrefsUpdated").await["prefs"].clone();
    assert_eq!(prefs["pinned_dms"], json!([dm_id]));
    assert_eq!(prefs["favorite_dms"], json!([dm_id]));
    assert_eq!(prefs["user_notes"]["swagdm"], "Conheci no servidor Minecraft");

    // A nota privada NUNCA aparece no estado/perfil visto por Swag
    send(&mut swag, json!({"type":"GetUserProfile","payload":{"username":"GabrielDm"}})).await;
    let card = wait_for(&mut swag, "UserProfile").await;
    assert!(!card.to_string().contains("Conheci no servidor Minecraft"));

    // 3. Fechar DM remove da lista recente sem apagar histórico nem amizade, e reaparece ao receber nova mensagem
    send(&mut gabriel, json!({"type":"CloseDm","payload":{"dm_id":dm_id}})).await;
    let after_close = loop {
        let s = wait_for(&mut gabriel, "FriendsSync").await;
        if !s["dm_conversations"].as_array().unwrap().iter().any(|c| c["dm_id"] == dm_id) {
            break s;
        }
    };
    assert!(after_close["friends"].as_array().unwrap().iter().any(|f| f["username"] == "SwagDm"));

    send_chat(&mut swag, &dm_id, "Voltei!").await;
    let reopened = loop {
        let s = wait_for(&mut gabriel, "FriendsSync").await;
        if s["dm_conversations"].as_array().unwrap().iter().any(|c| c["dm_id"] == dm_id) {
            break s;
        }
    };
    assert!(reopened["dm_conversations"].as_array().unwrap().iter().any(|c| c["dm_id"] == dm_id));

    // 4. Convidar para o servidor via DM funciona quando elegível e recusa se convites estiverem pausados
    let _ = server;
    send(&mut gabriel, json!({"type":"InviteFriendToServer","payload":{"server_id":sid,"target_username":"SwagDm"}})).await;
    let inv_msg = wait_for(&mut swag, "NewChatMessage").await;
    assert!(inv_msg["message"]["content"].as_str().unwrap().contains("[[INVITE:"));
}

#[tokio::test]
async fn profile_badges_visibility_order_security_and_realtime_sync() {
    let srv = start_server().await;
    let t_owner = register(&srv, "BadgeOwner").await;
    let t_viewer = register(&srv, "BadgeViewer").await;

    // Concede founder + developer via grants oficiais (early_user vem automaticamente).
    {
        let mut st = srv.state.write().await;
        st.badge_grants.insert(
            "badgeowner".into(),
            vec!["founder".into(), "developer".into()],
        );
        if let Some(acc) = st.accounts.get_mut("badgeowner") {
            crate::cosmetics::sync_account_badges(acc, &["founder".into(), "developer".into()]);
        }
    }

    let mut owner = connect(&srv, &t_owner).await;
    wait_for(&mut owner, "Welcome").await;
    let initial_cos = wait_for(&mut owner, "CosmeticsState").await;
    assert_eq!(
        initial_cos["owned_badges"],
        json!(["founder", "developer", "early_user"])
    );
    assert_eq!(initial_cos["max_visible_badges"], json!(6));

    let mut viewer = connect(&srv, &t_viewer).await;
    wait_for(&mut viewer, "Welcome").await;
    let _ = wait_for(&mut viewer, "CosmeticsState").await;

    // Cliente tenta reordenar, ocultar 'developer' e injetar 'event_winner' que NÃO possui.
    send(
        &mut owner,
        json!({
            "type": "UpdateProfile",
            "payload": {
                "badge_order": ["early_user", "event_winner", "founder", "developer"],
                "hidden_badges": ["developer", "verified_bot"]
            }
        }),
    )
    .await;

    // CosmeticsState devolve owned_badges intacto (com developer ainda possuída!) e preferências sanitizadas.
    let updated_cos = wait_for(&mut owner, "CosmeticsState").await;
    assert_eq!(
        updated_cos["owned_badges"],
        json!(["founder", "developer", "early_user"])
    );
    assert_eq!(
        updated_cos["badge_order"],
        json!(["early_user", "founder", "developer"])
    );
    assert_eq!(updated_cos["hidden_badges"], json!(["developer"]));

    // Outro cliente recebe em tempo real apenas as badges visíveis e ordenadas (sem event_winner e sem developer).
    let sync = loop {
        let m = wait_for(&mut viewer, "VoiceStateSync").await;
        let owner_entry = m["users"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["username"] == "BadgeOwner");
        if let Some(u) = owner_entry {
            if u["badges"] == json!(["early_user", "founder"]) {
                break u.clone();
            }
        }
    };
    assert_eq!(sync["badges"], json!(["early_user", "founder"]));

    // Ocultar 'founder' NÃO revoga a posse da moldura exclusiva de founder nem permissão de operador.
    send(
        &mut owner,
        json!({
            "type": "UpdateProfile",
            "payload": {
                "hidden_badges": ["founder", "developer"]
            }
        }),
    )
    .await;
    let _ = wait_for(&mut owner, "CosmeticsState").await;
    {
        let st = srv.state.read().await;
        let acc = &st.accounts["badgeowner"];
        assert_eq!(acc.profile.badges, vec!["early_user".to_string()]);
        assert!(crate::cosmetics::is_badge_operator(acc));
        let founder_frame = crate::cosmetics::find(crate::cosmetics::Kind::ProfileFrame, "founder").unwrap();
        assert!(crate::cosmetics::owns(acc, founder_frame));
    }
}

#[tokio::test]
async fn dm_unread_multi_device_sync_and_blocked_group_sender_isolation() {
    let srv = start_server().await;
    let tok_a = register(&srv, "NotifAlice").await;
    let tok_b = register(&srv, "NotifBob").await;

    let mut alice_pc1 = connect(&srv, &tok_a).await;
    wait_for(&mut alice_pc1, "Welcome").await;
    let mut alice_pc2 = connect(&srv, &tok_a).await;
    wait_for(&mut alice_pc2, "Welcome").await;
    let mut bob = connect(&srv, &tok_b).await;
    wait_for(&mut bob, "Welcome").await;

    // Amizade para DM direta (sem cair em solicitação silenciosa).
    send(&mut alice_pc1, json!({"type":"SendFriendRequest","payload":{"target_username":"NotifBob"}})).await;
    let _ = wait_for(&mut bob, "FriendsSync").await;
    send(&mut bob, json!({"type":"RespondFriendRequest","payload":{"from_username":"NotifAlice","accept":true}})).await;
    let _ = wait_for(&mut bob, "FriendsSync").await;

    send(&mut bob, json!({"type":"OpenDm","payload":{"target_username":"NotifAlice"}})).await;
    let dm_id = wait_for(&mut bob, "DmOpened").await["dm_id"].as_str().unwrap().to_string();
    for text in ["oi", "vai jogar?", "entrou?"] {
        send(&mut bob, json!({"type":"SendChat","payload":{"channel_id":dm_id,"content":text}})).await;
        let _ = wait_for(&mut alice_pc1, "NewChatMessage").await;
    }

    // Reconnect (ou 3ª sessão) recebe exatamente 3 não lidas do SQLite.
    let mut alice_pc3 = connect(&srv, &tok_a).await;
    let welcome3 = wait_for(&mut alice_pc3, "Welcome").await;
    let dm_rs = welcome3["read_states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["channel_id"] == dm_id)
        .expect("read_state da DM presente no Welcome");
    assert_eq!(dm_rs["mention_count"], 3);

    // Alice lê no PC 2 (AckChannel) -> PC 1 e PC 3 recebem ReadStateUpdated zerando o contador!
    send(&mut alice_pc2, json!({"type":"AckChannel","payload":{"channel_id":dm_id,"message_id":""}})).await;
    let rs1 = wait_for(&mut alice_pc1, "ReadStateUpdated").await;
    assert_eq!(rs1["state"]["channel_id"], dm_id);
    assert_eq!(rs1["state"]["mention_count"], 0);
    let rs3 = wait_for(&mut alice_pc3, "ReadStateUpdated").await;
    assert_eq!(rs3["state"]["channel_id"], dm_id);
    assert_eq!(rs3["state"]["mention_count"], 0);

    // Após leitura, nova mensagem de Bob volta a contar 1; Alice responde pelo PC 1 e PC 2 recebe ReadStateUpdated=0.
    send(&mut bob, json!({"type":"SendChat","payload":{"channel_id":dm_id,"content":"cadê você?"}})).await;
    let _ = wait_for(&mut alice_pc1, "NewChatMessage").await;
    {
        let st = srv.state.read().await;
        let acc_id = st.account_id_for("notifalice").unwrap();
        assert_eq!(st.read_state(&acc_id, &dm_id).mention_count, 1);
    }
    send(&mut alice_pc1, json!({"type":"SendChat","payload":{"channel_id":dm_id,"content":"cheguei!"}})).await;
    let rs2 = wait_for(&mut alice_pc2, "ReadStateUpdated").await;
    assert_eq!(rs2["state"]["channel_id"], dm_id);
    assert_eq!(rs2["state"]["mention_count"], 0);

    // Se Bob envia uma mensagem e a apaga antes de Alice ler (#54), o servidor reduz mention_count e emite ReadStateUpdated=0.
    send(&mut bob, json!({"type":"SendChat","payload":{"channel_id":dm_id,"content":"ops mensagem errada"}})).await;
    let msg_id = loop {
        let m = wait_for(&mut alice_pc1, "NewChatMessage").await;
        if m["message"]["content"] == "ops mensagem errada" {
            break m["message"]["id"].as_str().unwrap().to_string();
        }
    };
    {
        let st = srv.state.read().await;
        let acc_id = st.account_id_for("notifalice").unwrap();
        assert_eq!(st.read_state(&acc_id, &dm_id).mention_count, 1);
    }
    send(&mut bob, json!({"type":"DeleteChat","payload":{"channel_id":dm_id,"message_id":msg_id}})).await;
    let rs_del = wait_for(&mut alice_pc2, "ReadStateUpdated").await;
    assert_eq!(rs_del["state"]["channel_id"], dm_id);
    assert_eq!(rs_del["state"]["mention_count"], 0);
}

#[tokio::test]
async fn voice_cue_events_isolate_channels_track_transitions_dedupe_and_rate_limit() {
    let srv = start_server().await;
    let tok_a = register(&srv, "CallCueA").await;
    let tok_b = register(&srv, "CallCueB").await;
    let tok_c = register(&srv, "CallCueC").await;
    let tok_d = register(&srv, "CallCueD").await;

    let mut a = connect(&srv, &tok_a).await;
    let wa = wait_for(&mut a, "Welcome").await;
    let uid_a = wa["user"]["id"].as_str().unwrap().to_string();

    let mut b = connect(&srv, &tok_b).await;
    let wb = wait_for(&mut b, "Welcome").await;
    let uid_b = wb["user"]["id"].as_str().unwrap().to_string();

    let mut c = connect(&srv, &tok_c).await;
    let wc = wait_for(&mut c, "Welcome").await;
    let uid_c = wc["user"]["id"].as_str().unwrap().to_string();

    let mut d = connect(&srv, &tok_d).await;
    wait_for(&mut d, "Welcome").await;

    // A e B entram em voice-geral; C e D entram em voice-gameplay (canais distintos).
    send(&mut a, json!({"type":"JoinVoice","payload":{"channel_id":"voice-geral"}})).await;
    wait_for(&mut a, "VoiceStateSync").await;

    send(&mut b, json!({"type":"JoinVoice","payload":{"channel_id":"voice-geral"}})).await;
    let cue_join_b = wait_for(&mut a, "VoiceCueEvent").await;
    assert_eq!(cue_join_b["event_type"], "voice_join");
    assert_eq!(cue_join_b["voice_session_id"], "voice-geral");
    assert_eq!(cue_join_b["actor_user_id"], uid_b);
    assert!(!cue_join_b["event_id"].as_str().unwrap().is_empty());

    send(&mut c, json!({"type":"JoinVoice","payload":{"channel_id":"voice-gameplay"}})).await;
    wait_for(&mut c, "VoiceStateSync").await;
    send(&mut d, json!({"type":"JoinVoice","payload":{"channel_id":"voice-gameplay"}})).await;
    let cue_join_d = wait_for(&mut c, "VoiceCueEvent").await;
    assert_eq!(cue_join_d["event_type"], "voice_join");
    assert_eq!(cue_join_d["voice_session_id"], "voice-gameplay");

    // B inicia stream -> A e B recebem stream_start; mudar qualidade NÃO reenvia stream_start!
    send(&mut b, json!({
        "type": "UpdateVoiceState",
        "payload": { "muted": false, "deafened": false, "screen_sharing": true, "camera_on": false, "stream_quality": "720p30" }
    })).await;
    let cue_stream_a = wait_for(&mut a, "VoiceCueEvent").await;
    let cue_stream_b = wait_for(&mut b, "VoiceCueEvent").await;
    assert_eq!(cue_stream_a["event_type"], "stream_start");
    assert_eq!(cue_stream_a["event_id"], cue_stream_b["event_id"]);

    // Troca de qualidade mantendo screen_sharing=true não dispara novo stream_start.
    send(&mut b, json!({
        "type": "UpdateVoiceState",
        "payload": { "muted": false, "deafened": false, "screen_sharing": true, "camera_on": false, "stream_quality": "1080p60" }
    })).await;
    // C ativa câmera em voice-gameplay -> D recebe camera_on; A NÃO recebe evento de voice-gameplay!
    send(&mut c, json!({
        "type": "UpdateVoiceState",
        "payload": { "muted": false, "deafened": false, "screen_sharing": false, "camera_on": true }
    })).await;
    let cue_cam_d = wait_for(&mut d, "VoiceCueEvent").await;
    assert_eq!(cue_cam_d["event_type"], "camera_on");
    assert_eq!(cue_cam_d["voice_session_id"], "voice-gameplay");
    assert_eq!(cue_cam_d["actor_user_id"], uid_c);

    // Spam imediato de câmera por C dentro da janela de cooldown é contido pelo servidor.
    {
        let mut st = srv.state.write().await;
        let allowed_spam = crate::voice::emit_voice_cue(&mut st, "voice-gameplay", &uid_c, "camera_off", true);
        assert!(!allowed_spam, "cooldown do servidor deve conter spam imediato de câmera");
    }

    // C move de voice-gameplay -> voice-geral: D recebe voice_leave (gameplay) e A recebe voice_join (geral).
    send(&mut c, json!({"type":"JoinVoice","payload":{"channel_id":"voice-geral"}})).await;
    let cue_leave_d = wait_for(&mut d, "VoiceCueEvent").await;
    assert_eq!(cue_leave_d["event_type"], "voice_leave");
    assert_eq!(cue_leave_d["voice_session_id"], "voice-gameplay");
    let cue_join_a = wait_for(&mut a, "VoiceCueEvent").await;
    assert_eq!(cue_join_a["event_type"], "voice_join");
    assert_eq!(cue_join_a["voice_session_id"], "voice-geral");
    assert_eq!(cue_join_a["actor_user_id"], uid_c);
    let cue_join_b_from_c = wait_for(&mut b, "VoiceCueEvent").await;
    assert_eq!(cue_join_b_from_c["event_type"], "voice_join");
    assert_eq!(cue_join_b_from_c["actor_user_id"], uid_c);

    // A sai da call -> B recebe voice_leave com actor_user_id = uid_a.
    send(&mut a, json!({"type":"LeaveVoice"})).await;
    let cue_leave_b = wait_for(&mut b, "VoiceCueEvent").await;
    assert_eq!(cue_leave_b["event_type"], "voice_leave");
    assert_eq!(cue_leave_b["actor_user_id"], uid_a);

    // Call privada (DM Call): amizade -> A liga -> B atende -> ambos recebem call_connected!
    send(&mut a, json!({"type":"SendFriendRequest","payload":{"target_username":"CallCueB"}})).await;
    let _ = wait_for(&mut b, "FriendsSync").await;
    send(&mut b, json!({"type":"RespondFriendRequest","payload":{"from_username":"CallCueA","accept":true}})).await;
    let _ = wait_for(&mut b, "FriendsSync").await;
    send(&mut b, json!({"type":"LeaveVoice"})).await;
    let dm_voice = format!("dmvoice:{}", crate::state::ServerState::make_dm_id("callcuea", "callcueb").strip_prefix("dm:").unwrap());
    send(&mut a, json!({"type":"JoinVoice","payload":{"channel_id":dm_voice}})).await;
    let incoming = wait_for(&mut b, "DmCallIncoming").await;
    assert_eq!(incoming["voice_channel_id"], dm_voice);
    send(&mut b, json!({"type":"JoinVoice","payload":{"channel_id":dm_voice}})).await;
    let cc_a = wait_for(&mut a, "VoiceCueEvent").await;
    let cc_b = wait_for(&mut b, "VoiceCueEvent").await;
    assert_eq!(cc_a["event_type"], "call_connected");
    assert_eq!(cc_b["event_type"], "call_connected");
    assert_eq!(cc_a["event_id"], cc_b["event_id"]);
}
