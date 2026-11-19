use super::*;

#[tokio::test]
async fn voice_channel_text_chat_supports_messages_permissions_search_and_cleanup() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "DonaVoz", "friends").await;
    let invite = server["invite_code"].as_str().unwrap();
    let voice_id = server["voice_channels"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (mut member, joined) = join_with(&srv, "MembroVoz", invite).await;
    assert_eq!(joined["type"], "ServerCreated");
    let outsider_token = register(&srv, "ForaVoz").await;
    let mut outsider = connect(&srv, &outsider_token).await;
    wait_for(&mut outsider, "Welcome").await;

    // 1. Mensagens enviadas no canal de voz chegam aos membros, podem ser reagidas, fixadas e buscadas.
    send(
        &mut owner,
        json!({"type":"SendChat","payload":{"channel_id":voice_id,"content":"Link da reunião na call!"}}),
    )
    .await;
    let msg = wait_for(&mut owner, "NewChatMessage").await["message"].clone();
    let msg_id = msg["id"].as_str().unwrap().to_string();
    assert_eq!(msg["channel_id"], voice_id);
    assert_eq!(msg["content"], "Link da reunião na call!");
    let seen = wait_for(&mut member, "NewChatMessage").await["message"].clone();
    assert_eq!(seen["id"], msg_id);

    // Fixar mensagem e listar pins no canal de voz.
    send(
        &mut owner,
        json!({"type":"TogglePinChat","payload":{"channel_id":voice_id,"message_id":msg_id}}),
    )
    .await;
    let pinned_owner = wait_for(&mut owner, "MessageUpdated").await["message"].clone();
    assert_eq!(pinned_owner["pinned"], true);
    let pinned = wait_for(&mut member, "MessageUpdated").await["message"].clone();
    assert_eq!(pinned["pinned"], true);

    // Reagir na mensagem do canal de voz.
    send(
        &mut member,
        json!({"type":"ToggleReaction","payload":{"channel_id":voice_id,"message_id":msg_id,"emoji":"🔥"}}),
    )
    .await;
    let reacted = wait_for(&mut owner, "MessageUpdated").await["message"].clone();
    assert!(reacted["reactions"]["🔥"].is_array());

    // Thread em canal de voz continua bloqueada.
    send(
        &mut owner,
        json!({"type":"CreateThread","payload":{"channel_id":voice_id,"name":"Thread Voz","message_id":msg_id}}),
    )
    .await;
    let fb = wait_for(&mut owner, "ServerFeedback").await;
    assert_eq!(fb["ok"], false);

    // Outsider não consegue ler nem enviar no canal de voz.
    send(
        &mut outsider,
        json!({"type":"SendChat","payload":{"channel_id":voice_id,"content":"Intruso"}}),
    )
    .await;
    assert_eq!(wait_for_any(&mut outsider, &["SendFailed", "NewChatMessage"]).await["type"], "SendFailed");

    // Permissão send_messages=false no canal de voz bloqueia envio do membro, mantendo leitura.
    send(
        &mut owner,
        json!({
            "type":"UpdateChannelPermissions",
            "payload":{
                "server_id": sid,
                "channel_id": voice_id,
                "sync_category": false,
                "overwrites": [{
                    "target_type": "role",
                    "target_id": "everyone",
                    "permissions": { "send_messages": false }
                }]
            }
        }),
    )
    .await;
    wait_for(&mut member, "ServerUpdated").await;
    send(
        &mut member,
        json!({"type":"SendChat","payload":{"channel_id":voice_id,"content":"Sem permissão"}}),
    )
    .await;
    assert_eq!(wait_for_any(&mut member, &["SendFailed", "NewChatMessage"]).await["type"], "SendFailed");

    // 2. Histórico do canal de voz vem no Welcome ao reconectar e persiste no SQLite.
    let db = srv.state.read().await.db.clone();
    db.flush();
    let member_token = register(&srv, "LeitorVoz2").await;
    let mut member2 = connect(&srv, &member_token).await;
    wait_for(&mut member2, "Welcome").await;
    send(
        &mut member2,
        json!({"type":"JoinServerByInvite","payload":{"invite_code":invite}}),
    )
    .await;
    let joined2 = wait_for(&mut member2, "ServerCreated").await;
    assert_eq!(joined2["history"][&voice_id][0]["id"], msg_id);

    // 3. Criar novo canal de voz, enviar mensagem e excluir o canal limpa o histórico.
    send(
        &mut owner,
        json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"Sala Temp","kind":"voice"}}),
    )
    .await;
    let temp_ch = wait_for(&mut owner, "ChannelCreated").await["channel"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    send(
        &mut owner,
        json!({"type":"SendChat","payload":{"channel_id":temp_ch,"content":"msg temporária"}}),
    )
    .await;
    wait_for(&mut owner, "NewChatMessage").await;
    send(
        &mut owner,
        json!({"type":"DeleteChannel","payload":{"server_id":sid,"channel_id":temp_ch}}),
    )
    .await;
    wait_for(&mut owner, "ChannelDeleted").await;
    db.flush();
    assert_eq!(db.count_messages(&temp_ch).unwrap(), 0);
}

#[tokio::test]
async fn voice_channel_bitrate_validates_audits_and_persists_schema_v18() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "DonaBitrate", "friends").await;
    let text_id = server["text_channels"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let voice_id = server["voice_channels"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Recusa bitrate fora da faixa ou em canal de texto.
    for (ch, kbps) in [(&text_id, 128), (&voice_id, 16), (&voice_id, 512)] {
        send(
            &mut owner,
            json!({"type":"UpdateChannel","payload":{"server_id":sid,"channel_id":ch,"bitrate_kbps":kbps}}),
        )
        .await;
        let fb = wait_for(&mut owner, "ServerFeedback").await;
        assert_eq!(fb["action"], "update_channel");
        assert_eq!(fb["ok"], false, "{fb}");
    }

    // Aceita 192 kbps no canal de voz, sincroniza e persiste após reabrir o banco.
    send(
        &mut owner,
        json!({"type":"UpdateChannel","payload":{"server_id":sid,"channel_id":voice_id,"bitrate_kbps":192}}),
    )
    .await;
    let updated = wait_for(&mut owner, "ServerUpdated").await;
    let vc = updated["server"]["voice_channels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == voice_id)
        .unwrap();
    assert_eq!(vc["bitrate_kbps"], 192);

    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let state = reopened.read().await;
    let persisted = state
        .find_server(&sid)
        .unwrap()
        .find_channel(&voice_id)
        .unwrap();
    assert_eq!(persisted.bitrate_kbps, 192);
}
