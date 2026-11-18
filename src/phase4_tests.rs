use super::*;

async fn create_role(ws: &mut Ws, sid: &str, name: &str, permissions: Value) -> Value {
    send(ws, json!({"type":"CreateRole","payload":{"server_id":sid,"name":name,"color":"#123456","permissions":permissions}})).await;
    loop {
        let update = wait_for(ws, "ServerUpdated").await;
        if let Some(role) = update["server"]["roles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["name"] == name)
        {
            return role.clone();
        }
    }
}

#[tokio::test]
async fn role_hierarchy_blocks_escalation_and_allows_delegation() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "Proprietaria", "friends").await;
    let (mut manager, _) = join_with(&srv, "Gestor", server["invite_code"].as_str().unwrap()).await;
    let (_member, _) = join_with(&srv, "Integrante", server["invite_code"].as_str().unwrap()).await;
    let manager_role = create_role(&mut owner, &sid, "Gerente", json!({"manage_roles":true})).await;
    let admin_role = create_role(&mut owner, &sid, "Superior", json!({"administrator":true})).await;
    let lower_role = create_role(&mut owner, &sid, "Cosmetico", json!({})).await;
    // Move o cargo cosmético para baixo do gerente.
    let mut lower_payload = lower_role.clone();
    lower_payload["server_id"] = json!(sid);
    lower_payload["role_id"] = lower_payload["id"].clone();
    lower_payload["position"] = json!(1);
    send(
        &mut owner,
        json!({"type":"UpdateRole","payload":lower_payload}),
    )
    .await;
    send(&mut owner, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":"Gestor","role_ids":[manager_role["id"]]}})).await;
    // Aguarda a atribuição observada no estado real do cliente.
    loop {
        let up = wait_for(&mut manager, "ServerUpdated").await;
        if up["server"]["member_roles"]["gestor"]
            .as_array()
            .is_some_and(|r| !r.is_empty())
        {
            break;
        }
    }
    for (target, roles) in [
        ("Gestor", json!([manager_role["id"], admin_role["id"]])),
        ("Integrante", json!([admin_role["id"]])),
        ("Proprietaria", json!([lower_role["id"]])),
        ("NaoMembro", json!([lower_role["id"]])),
    ] {
        send(&mut manager, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":target,"role_ids":roles}})).await;
        let fb = wait_for(&mut manager, "ServerFeedback").await;
        assert_eq!(fb["ok"], false, "{target}");
        assert_eq!(fb["action"], "assign_roles");
    }
    send(&mut manager, json!({"type":"CreateRole","payload":{"server_id":sid,"name":"Escalada","color":"#123456","permissions":{"administrator":true}}})).await;
    assert_eq!(
        wait_for(&mut manager, "ServerFeedback").await["action"],
        "create_role"
    );
    let mut update = lower_payload.clone();
    update["position"] = admin_role["position"].clone();
    send(&mut manager, json!({"type":"UpdateRole","payload":update})).await;
    assert_eq!(
        wait_for(&mut manager, "ServerFeedback").await["action"],
        "update_role"
    );
    update["position"] = json!(1);
    update["permissions"]["ban_members"] = json!(true);
    send(&mut manager, json!({"type":"UpdateRole","payload":update})).await;
    assert_eq!(
        wait_for(&mut manager, "ServerFeedback").await["action"],
        "update_role"
    );
    send(&mut manager, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":"Integrante","role_ids":[lower_role["id"]]}})).await;
    loop {
        let up = wait_for(&mut manager, "ServerUpdated").await;
        if up["server"]["member_roles"]["integrante"]
            .as_array()
            .is_some_and(|r| r.contains(&lower_role["id"]))
        {
            break;
        }
    }
    let st = srv.state.read().await;
    let guild = st.find_server(&sid).unwrap();
    assert!(!guild.effective_permissions("gestor").administrator);
    assert!(
        guild.member_roles["integrante"].contains(&lower_role["id"].as_str().unwrap().to_string())
    );
    let mut order: Vec<_> = guild
        .roles
        .iter()
        .filter(|r| r.id != "everyone")
        .cloned()
        .collect();
    order.sort_by_key(|r| std::cmp::Reverse(r.position));
    let mut ids: Vec<_> = order.iter().map(|r| r.id.clone()).collect();
    let manager_index = ids
        .iter()
        .position(|id| id == manager_role["id"].as_str().unwrap())
        .unwrap();
    let admin_index = ids
        .iter()
        .position(|id| id == admin_role["id"].as_str().unwrap())
        .unwrap();
    ids.swap(manager_index, admin_index);
    drop(st);
    send(
        &mut manager,
        json!({"type":"ReorderRoles","payload":{"server_id":sid,"role_ids":ids}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut manager, "ServerFeedback").await["action"],
        "reorder_roles"
    );
    send(
        &mut owner,
        json!({"type":"ReorderRoles","payload":{"server_id":sid,"role_ids":ids}}),
    )
    .await;
    loop {
        let up = wait_for(&mut owner, "ServerUpdated").await;
        let roles = up["server"]["roles"].as_array().unwrap();
        if roles.iter().find(|r| r["id"] == ids[0]).unwrap()["position"] == ids.len() {
            break;
        }
    }
}

#[tokio::test]
async fn private_channels_filter_structure_events_history_and_mentions() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "DonaPrivada", "friends").await;
    let code = server["invite_code"].as_str().unwrap();
    let (mut member, _) = join_with(&srv, "Visitante", code).await;
    let channel = server["text_channels"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let public = server["text_channels"][1]["id"]
        .as_str()
        .unwrap()
        .to_string();
    send(
        &mut owner,
        json!({"type":"SendChat","payload":{"channel_id":channel,"content":"antes da restrição"}}),
    )
    .await;
    wait_for(&mut owner, "NewChatMessage").await;
    let old = wait_for(&mut member, "NewChatMessage").await["message"]["id"].clone();
    send(&mut owner, json!({"type":"UpdateChannelPermissions","payload":{"server_id":sid,"channel_id":channel,"overwrites":[{"target_type":"role","target_id":"everyone","permissions":{"view_channel":false}}]}})).await;
    loop {
        let sync = wait_for(&mut member, "ServerAccessUpdated").await;
        if sync["server"]["id"] == sid
            && !sync["server"]["text_channels"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["id"] == channel)
        {
            assert!(sync["history"].get(&channel).is_none());
            assert!(!sync["read_states"]
                .as_array()
                .unwrap()
                .iter()
                .any(|r| r["channel_id"] == channel));
            break;
        }
    }
    send(&mut owner, json!({"type":"SendChat","payload":{"channel_id":channel,"content":"segredo @Visitante @everyone"}})).await;
    let secret = wait_for(&mut owner, "NewChatMessage").await;
    assert!(!secret["message"]["mentions"]["users"]
        .as_array()
        .unwrap()
        .contains(&json!("visitante")));
    send(
        &mut owner,
        json!({"type":"Typing","payload":{"channel_id":channel}}),
    )
    .await;
    send(
        &mut owner,
        json!({"type":"SendChat","payload":{"channel_id":public,"content":"barreira pública"}}),
    )
    .await;
    loop {
        let event =
            wait_for_any(&mut member, &["NewChatMessage", "UserTyping"]).await["payload"].clone();
        assert_ne!(event["channel_id"], channel);
        if event.get("message").is_some() {
            assert_eq!(event["message"]["channel_id"], public);
            break;
        }
    }
    send(&mut member, json!({"type":"SendChat","payload":{"channel_id":channel,"content":"não pode","nonce":"bloqueada"}})).await;
    assert_eq!(
        wait_for(&mut member, "SendFailed").await["nonce"],
        "bloqueada"
    );
    send(
        &mut member,
        json!({"type":"LoadMessages","payload":{"channel_id":channel}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut member, "ServerFeedback").await["action"],
        "load_messages"
    );
    send(&mut member, json!({"type":"ToggleReaction","payload":{"channel_id":channel,"message_id":old,"emoji":"👍"}})).await;
    assert_eq!(
        wait_for(&mut member, "ServerFeedback").await["action"],
        "reaction"
    );
    // Welcome também omite canais/histórico, inclusive depois de reconectar.
    let token = post(
        &srv,
        "/api/login",
        json!({"username":"Visitante","password":"senha-segura-1"}),
    )
    .await
    .1["token"]
        .as_str()
        .unwrap()
        .to_string();
    let mut reconnect = connect(&srv, &token).await;
    let w = wait_for(&mut reconnect, "Welcome").await;
    assert!(w["chat_history"].get(&channel).is_none());
    let st = srv.state.read().await;
    assert_eq!(
        st.read_state(&st.accounts["visitante"].id, &channel)
            .mention_count,
        0
    );
    drop(st);
    // Exceção individual libera novamente sem recarregar a aplicação.
    send(&mut owner, json!({"type":"UpdateChannelPermissions","payload":{"server_id":sid,"channel_id":channel,"overwrites":[
        {"target_type":"role","target_id":"everyone","permissions":{"view_channel":false}},
        {"target_type":"member","target_id":"visitante","permissions":{"view_channel":true}}
    ]}})).await;
    let sync = wait_for(&mut member, "ServerAccessUpdated").await;
    assert!(sync["server"]["text_channels"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["id"] == channel));
    send(
        &mut member,
        json!({"type":"LoadMessages","payload":{"channel_id":channel}}),
    )
    .await;
    assert!(!wait_for(&mut member, "MessagesPage").await["messages"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn category_inheritance_channel_overrides_sync_and_persistence() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "DonaCategoria", "friends").await;
    let (mut member, _) = join_with(&srv, "Leitora", server["invite_code"].as_str().unwrap()).await;
    let ch = server["text_channels"][0]["id"].as_str().unwrap();
    let category = server["text_channels"][0]["category_id"].as_str().unwrap();
    send(&mut owner, json!({"type":"UpdateCategoryPermissions","payload":{"server_id":sid,"category_id":category,"overwrites":[
        {"target_type":"role","target_id":"everyone","permissions":{"send_messages":false,"read_history":false,"add_reactions":false}}
    ]}})).await;
    let sync = loop {
        let sync = wait_for(&mut member, "ServerAccessUpdated").await;
        if sync["server"]["text_channels"][0]["effective_permissions"]["send_messages"] == false {
            break sync;
        }
    };
    assert!(sync["history"].get(ch).is_none());
    send(
        &mut member,
        json!({"type":"SendChat","payload":{"channel_id":ch,"content":"recusada"}}),
    )
    .await;
    wait_for(&mut member, "SendFailed").await;
    send(
        &mut member,
        json!({"type":"LoadMessages","payload":{"channel_id":ch}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut member, "ServerFeedback").await["action"],
        "load_messages"
    );
    send(&mut owner, json!({"type":"UpdateChannelPermissions","payload":{"server_id":sid,"channel_id":ch,"overwrites":[
        {"target_type":"role","target_id":"everyone","permissions":{"send_messages":true,"read_history":true}}
    ]}})).await;
    let sync = wait_for(&mut member, "ServerAccessUpdated").await;
    assert_eq!(
        sync["server"]["text_channels"][0]["effective_permissions"]["send_messages"],
        true
    );
    send(
        &mut member,
        json!({"type":"SendChat","payload":{"channel_id":ch,"content":"permitida pela exceção"}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut member, "NewChatMessage").await["message"]["content"],
        "permitida pela exceção"
    );
    let db = srv.state.read().await.db.clone();
    tokio::task::spawn_blocking(move || db.flush())
        .await
        .unwrap();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let state = reopened.read().await;
    let guild = state.find_server(&sid).unwrap();
    let p = guild.channel_permissions("leitora", ch);
    assert!(p.send_messages && p.read_history);
    assert!(!p.add_reactions);
    assert!(!guild.find_channel(ch).unwrap().permissions_synced);
    drop(state);
    send(&mut owner, json!({"type":"UpdateChannelPermissions","payload":{"server_id":sid,"channel_id":ch,"sync_category":true,"overwrites":[]}})).await;
    let sync = wait_for(&mut member, "ServerAccessUpdated").await;
    assert_eq!(
        sync["server"]["text_channels"][0]["permissions_synced"],
        true
    );
    assert_eq!(
        sync["server"]["text_channels"][0]["effective_permissions"]["send_messages"],
        false
    );
}

#[tokio::test]
async fn private_channel_creation_is_atomic_and_role_union_member_deny_work() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "DonaAtomica", "friends").await;
    let (mut member, _) =
        join_with(&srv, "Convidada", server["invite_code"].as_str().unwrap()).await;
    let allowed_role = create_role(&mut owner, &sid, "Equipe", json!({})).await;
    let denied_role = create_role(&mut owner, &sid, "Restrito", json!({})).await;
    loop {
        let sync = wait_for(&mut member, "ServerAccessUpdated").await;
        if sync["server"]["roles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["name"] == "Restrito")
        {
            break;
        }
    }
    send(&mut owner, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"privado-atomico","kind":"text","permissions_synced":false,"overwrites":[
        {"target_type":"role","target_id":"everyone","permissions":{"view_channel":false}},
        {"target_type":"role","target_id":allowed_role["id"],"permissions":{"view_channel":true}},
        {"target_type":"role","target_id":denied_role["id"],"permissions":{"view_channel":false}}
    ]}})).await;
    let created = wait_for(&mut owner, "ChannelCreated").await;
    let channel = created["channel"]["id"].as_str().unwrap().to_string();
    let found_private = loop {
        let event = wait_for_any(&mut member, &["ChannelCreated", "ServerUpdated"]).await;
        if event["type"] == "ChannelCreated" {
            assert_ne!(event["payload"]["channel"]["id"], channel);
        }
        if event["type"] == "ServerUpdated" && event["payload"]["server"]["id"] == sid {
            break event["payload"]["server"]["text_channels"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["id"] == channel);
        }
    };
    assert!(!found_private);
    send(&mut owner, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":"Convidada","role_ids":[allowed_role["id"],denied_role["id"]]}})).await;
    loop {
        let sync = wait_for(&mut member, "ServerAccessUpdated").await;
        if sync["server"]["member_roles"]["convidada"]
            .as_array()
            .is_some_and(|r| r.len() == 2)
        {
            break;
        }
    }
    let st = srv.state.read().await;
    assert!(
        st.can_view_channel("convidada", &channel),
        "allow de um cargo vence deny de outro na mesma camada"
    );
    let mut guild = st.find_server(&sid).unwrap().clone();
    let ch = guild.find_channel_mut(&channel).unwrap();
    ch.permission_overwrites.push(serde_json::from_value(json!({"target_type":"member","target_id":"convidada","permissions":{"view_channel":false}})).unwrap());
    assert!(
        !guild
            .channel_permissions("convidada", &channel)
            .view_channel,
        "deny individual vence os cargos"
    );
    assert!(
        guild
            .channel_permissions("donaatomica", &channel)
            .view_channel,
        "proprietário mantém acesso"
    );
    assert!(
        !guild
            .channel_permissions("naomembro", &channel)
            .view_channel
    );
}

#[tokio::test]
async fn voice_signaling_requires_shared_channel_and_revocation_disconnects() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "DonaVoz", "friends").await;
    let (mut member, _) = join_with(&srv, "Ouvinte", server["invite_code"].as_str().unwrap()).await;
    let voice = server["voice_channels"][0]["id"].as_str().unwrap();
    send(
        &mut owner,
        json!({"type":"JoinVoice","payload":{"channel_id":voice}}),
    )
    .await;
    wait_for(&mut owner, "VoiceStateSync").await;
    let (a, b) = {
        let st = srv.state.read().await;
        let a = st
            .users
            .values()
            .find(|u| u.username == "DonaVoz")
            .unwrap()
            .id
            .clone();
        let b = st
            .users
            .values()
            .find(|u| u.username == "Ouvinte")
            .unwrap()
            .id
            .clone();
        assert!(!st.can_signal_peer(&a, &b));
        (a, b)
    };
    send(
        &mut member,
        json!({"type":"JoinVoice","payload":{"channel_id":voice}}),
    )
    .await;
    loop {
        let sync = wait_for(&mut member, "VoiceStateSync").await;
        if sync["voice_members"][voice]
            .as_array()
            .is_some_and(|m| m.len() == 2)
        {
            break;
        }
    }
    assert!(srv.state.read().await.can_signal_peer(&a, &b));
    send(&mut owner, json!({"type":"UpdateChannelPermissions","payload":{"server_id":sid,"channel_id":voice,"overwrites":[
        {"target_type":"member","target_id":"ouvinte","permissions":{"speak_voice":false,"stream_video":false}}
    ]}})).await;
    let updated = wait_for(&mut member, "SelfUpdated").await;
    assert!(updated["user"]["voice_channel_id"].is_null());
    assert!(!srv.state.read().await.can_signal_peer(&a, &b));
    // Pode voltar como ouvinte, sem autorização para publicar mídia.
    send(
        &mut member,
        json!({"type":"JoinVoice","payload":{"channel_id":voice}}),
    )
    .await;
    loop {
        let sync = wait_for(&mut member, "VoiceStateSync").await;
        if sync["voice_members"][voice]
            .as_array()
            .is_some_and(|ids| ids.contains(&json!(b)))
        {
            break;
        }
    }
    let st = srv.state.read().await;
    assert!(st.can_signal_sdp(
        &b,
        &json!({"sdp":"v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\n"})
    ));
    assert!(!st.can_signal_sdp(
        &b,
        &json!({"sdp":"v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n"})
    ));
    drop(st);
    send(&mut member, json!({"type":"UpdateVoiceState","payload":{"muted":false,"deafened":false,"screen_sharing":true,"camera_on":false}})).await;
    assert_eq!(
        wait_for(&mut member, "ServerFeedback").await["action"],
        "voice_state"
    );
}

#[test]
fn migration_v3_keeps_existing_data_and_inherits_permissions() {
    let path = std::env::temp_dir().join(format!("sancord-v3-{}.db", uuid::Uuid::new_v4()));
    let conn = rusqlite::Connection::open(&path).unwrap();
    // Banco vazio criado pelo esquema atual; depois reproduz a estrutura v3 anterior.
    drop(conn);
    let (db, _) = crate::db::Db::open(&path, None).unwrap();
    db.shutdown();
    drop(db);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("ALTER TABLE channels DROP COLUMN permission_overwrites;
        ALTER TABLE channels DROP COLUMN permissions_synced;
        ALTER TABLE categories DROP COLUMN permission_overwrites;
        INSERT INTO users(id,username_lower,data,updated_at) VALUES ('preservado','preservado','{}',42);
        PRAGMA user_version=3;").unwrap();
    drop(conn);
    let (db, _) = crate::db::Db::open(&path, None).unwrap();
    db.flush();
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        crate::db::SCHEMA_VERSION
    );
    assert_eq!(
        conn.query_row(
            "SELECT updated_at FROM users WHERE id='preservado'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        42
    );
    assert!(conn
        .prepare("SELECT permission_overwrites,permissions_synced FROM channels")
        .is_ok());
    let legacy: crate::models::Channel =
        serde_json::from_value(json!({"id":"antigo","name":"antigo","kind":"text"})).unwrap();
    assert!(legacy.permissions_synced && legacy.permission_overwrites.is_empty());
    db.shutdown();
}
