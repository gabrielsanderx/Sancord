//! Etapa C2 — resposta com/sem menção e encaminhamento com cópia congelada.
use super::*;

/// Envia e devolve a mensagem confirmada ou a recusa (`SendFailed`).
async fn send_chat(ws: &mut Ws, payload: Value) -> Value {
    let nonce = uuid::Uuid::new_v4().to_string();
    let mut p = payload;
    p["nonce"] = json!(nonce);
    send(ws, json!({"type":"SendChat","payload":p})).await;
    loop {
        let v = wait_for_any(ws, &["NewChatMessage", "SendFailed"]).await;
        let pl = &v["payload"];
        if pl["nonce"] == nonce.as_str() || pl["message"]["nonce"] == nonce.as_str() {
            return v;
        }
    }
}

async fn create_channel(ws: &mut Ws, sid: &str, name: &str, kind: &str) -> String {
    send(ws, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":name,"kind":kind}})).await;
    loop {
        let v = wait_for(ws, "ChannelCreated").await;
        if v["channel"]["name"] == name {
            return v["channel"]["id"].as_str().unwrap().to_string();
        }
    }
}

#[tokio::test]
async fn reply_without_mention_does_not_notify_even_after_edit() {
    let srv = start_server().await;
    let (mut dona, server, _sid) = owner_with_server(&srv, "DonaReply", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let (mut ana, _) = join_with(&srv, "AnaReply", server["invite_code"].as_str().unwrap()).await;

    let base = send_chat(&mut dona, json!({"channel_id":geral,"content":"pergunta"})).await;
    let base_id = base["payload"]["message"]["id"].as_str().unwrap().to_string();

    let silent = send_chat(&mut ana, json!({"channel_id":geral,"content":"resposta quieta","reply_to_id":base_id,"reply_mention":false})).await;
    let m = &silent["payload"]["message"];
    assert_eq!(m["reply_to"]["mention"], false);
    assert!(m["mentions"]["users"].as_array().map_or(true, |u| !u.iter().any(|x| x == "donareply")), "sem menção: {m}");
    let silent_id = m["id"].as_str().unwrap().to_string();

    let loud = send_chat(&mut ana, json!({"channel_id":geral,"content":"resposta normal","reply_to_id":base_id})).await;
    assert_eq!(loud["payload"]["message"]["reply_to"]["mention"], true, "padrão continua mencionando");
    assert!(loud["payload"]["message"]["mentions"]["users"].as_array().unwrap().iter().any(|x| x == "donareply"));

    // Editar a resposta silenciosa não passa a mencionar.
    send(&mut ana, json!({"type":"EditChat","payload":{"channel_id":geral,"message_id":silent_id,"content":"resposta quieta editada"}})).await;
    let edited = loop {
        let v = wait_for(&mut ana, "MessageUpdated").await;
        if v["message"]["id"] == silent_id.as_str() {
            break v["message"].clone();
        }
    };
    assert!(edited["mentions"]["users"].as_array().map_or(true, |u| !u.iter().any(|x| x == "donareply")), "{edited}");
}

#[tokio::test]
async fn forward_copies_a_frozen_snapshot_with_rules() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaFwd", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let destino = create_channel(&mut dona, &sid, "destino", "text").await;
    let avisos = create_channel(&mut dona, &sid, "avisos", "announcement").await;
    let (mut bia, _) = join_with(&srv, "BiaFwd", server["invite_code"].as_str().unwrap()).await;

    let original = send_chat(&mut dona, json!({"channel_id":geral,"content":"**plano** do sábado"})).await;
    let orig_id = original["payload"]["message"]["id"].as_str().unwrap().to_string();

    // Encaminhar com comentário: autor é quem encaminha; cópia guarda texto e origem.
    let fwd = send_chat(&mut bia, json!({"channel_id":destino,"content":"olha isso","forward":{"channel_id":geral,"message_id":orig_id}})).await;
    assert_eq!(fwd["type"], "NewChatMessage", "{fwd}");
    let m = &fwd["payload"]["message"];
    assert_eq!(m["author_name"], "BiaFwd");
    assert_eq!(m["content"], "olha isso");
    assert_eq!(m["forward"]["content"], "**plano** do sábado");
    assert_eq!(m["forward"]["source_message_id"], orig_id.as_str());
    let nome = server["text_channels"][0]["name"].as_str().unwrap();
    assert_eq!(m["forward"]["source_label"], format!("#{nome} · Servidor de DonaFwd"));
    let fwd_id = m["id"].as_str().unwrap().to_string();

    // Sem comentário também vale.
    let bare = send_chat(&mut bia, json!({"channel_id":destino,"content":"","forward":{"channel_id":geral,"message_id":orig_id}})).await;
    assert_eq!(bare["type"], "NewChatMessage");

    // A cópia é congelada: editar a original não muda o encaminhamento.
    send(&mut dona, json!({"type":"EditChat","payload":{"channel_id":geral,"message_id":orig_id,"content":"mudei tudo"}})).await;
    loop {
        let v = wait_for(&mut dona, "MessageUpdated").await;
        if v["message"]["id"] == orig_id.as_str() {
            break;
        }
    }
    {
        let st = srv.state.read().await;
        let copy = st.chat_history[&destino].iter().find(|x| x.id == fwd_id).unwrap();
        assert_eq!(copy.forward.as_ref().unwrap().content, "**plano** do sábado");
    }

    // Reencaminhar mantém a origem e o texto originais.
    let again = send_chat(&mut dona, json!({"channel_id":geral,"content":"","forward":{"channel_id":destino,"message_id":fwd_id}})).await;
    assert_eq!(again["payload"]["message"]["forward"]["source_message_id"], orig_id.as_str());
    assert_eq!(again["payload"]["message"]["forward"]["content"], "**plano** do sábado");

    // Regras: anúncios, enquetes e acesso à origem.
    let to_ann = send_chat(&mut dona, json!({"channel_id":avisos,"content":"","forward":{"channel_id":geral,"message_id":orig_id}})).await;
    assert_eq!(to_ann["type"], "SendFailed");
    assert!(to_ann["payload"]["message"].as_str().unwrap().contains("anúncios"));
    let poll = send_chat(&mut dona, json!({"channel_id":geral,"content":"","poll":{"question":"Pizza?","options":["Sim","Não"],"duration_hours":1}})).await;
    let poll_id = poll["payload"]["message"]["id"].as_str().unwrap().to_string();
    let fwd_poll = send_chat(&mut bia, json!({"channel_id":destino,"content":"","forward":{"channel_id":geral,"message_id":poll_id}})).await;
    assert!(fwd_poll["payload"]["message"].as_str().unwrap().contains("Enquetes"));

    let (mut estranho, est_server, _) = owner_with_server(&srv, "EstranhoFwd", "friends").await;
    let meu = est_server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let roubo = send_chat(&mut estranho, json!({"channel_id":meu,"content":"","forward":{"channel_id":geral,"message_id":orig_id}})).await;
    assert_eq!(roubo["type"], "SendFailed");
    assert!(roubo["payload"]["message"].as_str().unwrap().contains("acesso"), "{roubo}");
    let fantasma = send_chat(&mut bia, json!({"channel_id":destino,"content":"","forward":{"channel_id":geral,"message_id":"nao-existe"}})).await;
    assert!(fantasma["payload"]["message"].as_str().unwrap().contains("não existe"));
}
