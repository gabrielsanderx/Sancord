//! Etapa C6 — membros da thread e arquivamento automático por inatividade.
use super::*;

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

async fn send_chat(ws: &mut Ws, channel: &str, content: &str) -> Value {
    let nonce = uuid::Uuid::new_v4().to_string();
    send(ws, json!({"type":"SendChat","payload":{"channel_id":channel,"content":content,"nonce":nonce}})).await;
    loop {
        let v = wait_for_any(ws, &["NewChatMessage", "SendFailed"]).await;
        if v["payload"]["nonce"] == nonce.as_str() || v["payload"]["message"]["nonce"] == nonce.as_str() {
            return v;
        }
    }
}

/// Espera o ThreadUpdated da thread que satisfaz `ok`.
async fn thread_update(ws: &mut Ws, tid: &str, ok: impl Fn(&Value) -> bool) -> Value {
    loop {
        let v = wait_for(ws, "ThreadUpdated").await;
        if v["thread"]["id"] == tid && ok(&v["thread"]) {
            return v["thread"].clone();
        }
    }
}

async fn thread_of(srv: &TestServer, sid: &str, tid: &str) -> crate::models::Thread {
    srv.state.read().await.find_server(sid).unwrap().thread(tid).unwrap().clone()
}

#[tokio::test]
async fn thread_members_follow_and_auto_archive_choice() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaThr", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let invite = server["invite_code"].as_str().unwrap().to_string();
    let (mut ana, _) = join_with(&srv, "AnaThr", &invite).await;
    let (mut bia, _) = join_with(&srv, "BiaThr", &invite).await;

    let base = send_chat(&mut ana, &geral, "vamos discutir").await["payload"]["message"]["id"].as_str().unwrap().to_string();
    send(&mut ana, json!({"type":"CreateThread","payload":{"channel_id":geral,"name":"Discussão","message_id":base}})).await;
    let created = wait_for(&mut ana, "ThreadCreated").await["thread"].clone();
    let tid = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["members"], json!(["anathr"]), "quem cria segue");
    assert_eq!(created["auto_archive_minutes"], 1440, "padrão: 24 horas");

    // Quem escreve passa a seguir; seguir e deixar de seguir manualmente.
    send_chat(&mut dona, &tid, "opa").await;
    thread_update(&mut ana, &tid, |t| t["members"].as_array().unwrap().iter().any(|m| m == "donathr")).await;
    send(&mut bia, json!({"type":"JoinThread","payload":{"thread_id":tid}})).await;
    thread_update(&mut bia, &tid, |t| t["members"].as_array().unwrap().iter().any(|m| m == "biathr")).await;
    send(&mut bia, json!({"type":"LeaveThread","payload":{"thread_id":tid}})).await;
    let t = thread_update(&mut bia, &tid, |t| !t["members"].as_array().unwrap().iter().any(|m| m == "biathr")).await;
    assert_eq!(t["members"], json!(["anathr", "donathr"]));

    // Prazo: só dona da thread ou moderação; só valores aceitos.
    send(&mut bia, json!({"type":"UpdateThread","payload":{"thread_id":tid,"auto_archive_minutes":60}})).await;
    assert_eq!(feedback(&mut bia, "update_thread").await["ok"], false);
    send(&mut ana, json!({"type":"UpdateThread","payload":{"thread_id":tid,"auto_archive_minutes":30}})).await;
    assert!(feedback(&mut ana, "update_thread").await["message"].as_str().unwrap().contains("1 hora"));
    send(&mut ana, json!({"type":"UpdateThread","payload":{"thread_id":tid,"auto_archive_minutes":60}})).await;
    thread_update(&mut ana, &tid, |t| t["auto_archive_minutes"] == 60).await;

    // Persistência (JSON da thread).
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let t = st.find_server(&sid).unwrap().thread(&tid).unwrap();
    assert_eq!(t.auto_archive_minutes, 60);
    assert_eq!(t.members, vec!["anathr".to_string(), "donathr".to_string()]);
}

#[tokio::test]
async fn idle_threads_archive_by_their_own_deadline_and_wake_on_message() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaIdle", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let mut ids = Vec::new();
    for (i, minutes) in [60u32, 10080].into_iter().enumerate() {
        let base = send_chat(&mut dona, &geral, &format!("base {i}")).await["payload"]["message"]["id"].as_str().unwrap().to_string();
        send(&mut dona, json!({"type":"CreateThread","payload":{"channel_id":geral,"name":format!("T{i}"),"message_id":base}})).await;
        let tid = wait_for(&mut dona, "ThreadCreated").await["thread"]["id"].as_str().unwrap().to_string();
        send(&mut dona, json!({"type":"UpdateThread","payload":{"thread_id":tid,"auto_archive_minutes":minutes}})).await;
        thread_update(&mut dona, &tid, |t| t["auto_archive_minutes"] == minutes).await;
        ids.push(tid);
    }
    let now = crate::auth::now_ms();
    {
        // Duas horas sem mensagens nas duas threads.
        let mut st = srv.state.write().await;
        let s = st.find_server_mut(&sid).unwrap();
        for t in s.threads.iter_mut() {
            t.last_message_at = now - 2 * 3_600_000;
            t.created_at = now - 2 * 3_600_000;
        }
    }
    let archived = crate::threads::archive_idle(&mut *srv.state.write().await, now);
    assert_eq!(archived, 1, "só a de 1 hora venceu");
    assert!(thread_of(&srv, &sid, &ids[0]).await.archived);
    assert!(!thread_of(&srv, &sid, &ids[1]).await.archived, "a de 1 semana continua ativa");
    // Os clientes ficam sabendo.
    thread_update(&mut dona, &ids[0], |t| t["archived"] == true).await;
    // Rodar de novo não arquiva nada a mais.
    assert_eq!(crate::threads::archive_idle(&mut *srv.state.write().await, now), 0);

    // Nova mensagem desarquiva.
    send_chat(&mut dona, &ids[0], "voltei").await;
    assert!(!thread_of(&srv, &sid, &ids[0]).await.archived);
}
