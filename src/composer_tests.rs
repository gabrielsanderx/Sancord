use super::*;

#[tokio::test]
async fn schedule_is_private_survives_restart_and_delivers_once_while_offline() {
    let srv = start_server().await;
    let (mut sender, server, channel_server) =
        owner_with_server(&srv, "AgendaAna", "friends").await;
    let channel = server["text_channels"][0]["id"].as_str().unwrap();
    let (mut peer, _) = join_with(&srv, "AgendaBia", server["invite_code"].as_str().unwrap()).await;
    let schedule_at = crate::auth::now_ms() + 60_000;
    for content in ["Mensagem programada", "Será cancelada"] {
        send(&mut sender, json!({"type":"ScheduleMessage","payload":{"channel_id":channel,"content":content,"send_at":schedule_at}})).await;
        let list = wait_for(&mut sender, "ScheduledMessages").await;
        assert!(list["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|job| job["content"] == content));
        assert_eq!(wait_for(&mut sender, "ServerFeedback").await["ok"], true);
    }
    let jobs: Vec<_> = srv
        .state
        .read()
        .await
        .scheduled_messages
        .values()
        .cloned()
        .collect();
    let pending = jobs
        .iter()
        .find(|job| job.content == "Mensagem programada")
        .unwrap();
    let cancelled = jobs
        .iter()
        .find(|job| job.content == "Será cancelada")
        .unwrap();
    send(&mut peer, json!({"type":"ListScheduledMessages"})).await;
    assert_eq!(
        wait_for(&mut peer, "ScheduledMessages").await["messages"],
        json!([])
    );
    send(
        &mut peer,
        json!({"type":"CancelScheduledMessage","payload":{"id":pending.id}}),
    )
    .await;
    assert_eq!(wait_for(&mut peer, "ServerFeedback").await["ok"], false);
    send(
        &mut sender,
        json!({"type":"CancelScheduledMessage","payload":{"id":cancelled.id}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut sender, "ScheduledMessages").await["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let db = srv.state.read().await.db.clone();
    tokio::task::spawn_blocking(move || db.flush())
        .await
        .unwrap();
    drop(sender);

    let restarted = start_server_in(srv.dir.clone()).await;
    assert!(restarted.state.read().await.users.is_empty());
    assert!(restarted
        .state
        .read()
        .await
        .find_server(&channel_server)
        .is_some());
    crate::scheduled::publish_due(&restarted.state, schedule_at - 1).await;
    assert_eq!(restarted.state.read().await.scheduled_messages.len(), 1);
    crate::scheduled::publish_due(&restarted.state, schedule_at).await;
    crate::scheduled::publish_due(&restarted.state, schedule_at).await;
    let db = restarted.state.read().await.db.clone();
    let (channel, pending_id, cancelled_id) =
        (channel.to_owned(), pending.id.clone(), cancelled.id.clone());
    tokio::task::spawn_blocking(move || {
        db.flush();
        let message = db.get_message(&channel, &pending_id).unwrap().unwrap();
        assert_eq!(message.content, "Mensagem programada");
        assert_eq!(message.author_name, "AgendaAna");
        assert!(db.get_message(&channel, &cancelled_id).unwrap().is_none());
        assert!(db.load_scheduled().unwrap().is_empty());
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn scheduled_send_rechecks_write_permission_while_publishing() {
    let srv = start_server().await;
    let (_owner, server, sid) = owner_with_server(&srv, "AgendaHost", "friends").await;
    let (mut sender, _) = join_with(
        &srv,
        "AgendaVisitante",
        server["invite_code"].as_str().unwrap(),
    )
    .await;
    let channel = server["text_channels"][0]["id"].as_str().unwrap();
    let when = crate::auth::now_ms() + 1000;
    send(&mut sender, json!({"type":"ScheduleMessage","payload":{"channel_id":channel,"content":"Sem acesso depois","send_at":when}})).await;
    let queued = wait_for(&mut sender, "ScheduledMessages").await;
    let id = queued["messages"][0]["id"].as_str().unwrap();
    {
        let mut state = srv.state.write().await;
        state
            .servers
            .iter_mut()
            .find(|server| server.id == sid)
            .unwrap()
            .members
            .retain(|name| name != "agendavisitante");
    }
    crate::scheduled::publish_due(&srv.state, when).await;
    let state = srv.state.read().await;
    assert!(state.scheduled_messages[id]
        .error
        .as_deref()
        .unwrap()
        .contains("membro"));
    assert!(state
        .chat_history
        .get(channel)
        .into_iter()
        .flatten()
        .all(|msg| msg.id != id));
}

#[tokio::test]
async fn sticker_and_voice_have_distinct_attachment_types_confirmed_by_the_server() {
    let srv = start_server().await;
    let token = register(&srv, "AnexosCompositor").await;
    let (status, sticker) =
        upload(&srv, &token, "orbita.png&presentation=sticker", tiny_png()).await;
    assert_eq!(status, 200);
    assert_eq!(sticker["attachment"]["kind"], "sticker");
    let mut wav = b"RIFF\x26\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x40\x1f\0\0\x80\x3e\0\0\x02\0\x10\0data\x02\0\0\0".to_vec();
    wav.extend_from_slice(&[0, 0]);
    let (status, voice) = upload(&srv, &token, "audio.wav&presentation=voice", wav).await;
    assert_eq!(status, 200);
    assert_eq!(voice["attachment"]["kind"], "voice");
    let (status, _) = upload(&srv, &token, "audio.wav&presentation=voice", tiny_png()).await;
    assert_eq!(status, 400);
    let mut session = connect(&srv, &token).await;
    wait_for(&mut session, "Welcome").await;
    let channel = srv.state.read().await.text_channels[0].id.clone();
    send(&mut session, json!({"type":"SendChat","payload":{"channel_id":channel,"content":"", "attachment_ids":[sticker["attachment"]["id"],voice["attachment"]["id"]]}})).await;
    let message = wait_for(&mut session, "NewChatMessage").await;
    assert_eq!(message["message"]["attachments"][0]["kind"], "sticker");
    assert_eq!(
        message["message"]["attachments"][1]["content_type"],
        "audio/wav"
    );
}
