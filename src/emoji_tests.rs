//! Etapa C5 — emojis próprios do servidor: regras, mensagens, reações e persistência.
use super::*;

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

/// Conta com servidor próprio, devolvendo também o token (para enviar imagens).
async fn owner(srv: &TestServer, name: &str) -> (Ws, String, Value, String) {
    let token = register(srv, name).await;
    let mut ws = connect(srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    send(&mut ws, json!({"type":"CreateServer","payload":{"name":format!("Servidor de {name}"),"template":"friends"}})).await;
    let created = wait_for(&mut ws, "ServerCreated").await;
    let sid = created["server"]["id"].as_str().unwrap().to_string();
    (ws, token, created["server"].clone(), sid)
}

async fn member(srv: &TestServer, name: &str, invite: &str) -> (Ws, String) {
    let token = register(srv, name).await;
    let mut ws = connect(srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    send(&mut ws, json!({"type":"JoinServerByInvite","payload":{"invite_code":invite}})).await;
    wait_for(&mut ws, "ServerCreated").await;
    (ws, token)
}

async fn image(srv: &TestServer, token: &str, bytes: Vec<u8>) -> String {
    let (status, body) = upload(srv, token, "emoji.png", bytes).await;
    assert_eq!(status, 200, "{body}");
    body["attachment"]["id"].as_str().unwrap().to_string()
}

fn tiny_gif() -> Vec<u8> {
    let mut gif = b"GIF89a".to_vec();
    gif.extend_from_slice(&32u16.to_le_bytes());
    gif.extend_from_slice(&32u16.to_le_bytes());
    gif.extend_from_slice(&[0, 0, 0, 0x3B]);
    gif
}

async fn create(ws: &mut Ws, sid: &str, name: &str, id: &str) -> Value {
    send(ws, json!({"type":"CreateServerEmoji","payload":{"server_id":sid,"name":name,"attachment_id":id}})).await;
    feedback(ws, "server_emoji").await
}

async fn emojis_of(srv: &TestServer, sid: &str) -> Vec<crate::models::ServerEmoji> {
    srv.state.read().await.find_server(sid).unwrap().emojis.clone()
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

#[tokio::test]
async fn server_emoji_rules_and_persistence() {
    let srv = start_server().await;
    let (mut dona, dona_token, server, sid) = owner(&srv, "DonaEmoji").await;
    let (mut ana, ana_token) = member(&srv, "AnaEmoji", server["invite_code"].as_str().unwrap()).await;

    let png = image(&srv, &dona_token, tiny_png()).await;
    let fb = create(&mut dona, &sid, ":festa:", &png).await;
    assert_eq!(fb["ok"], true, "{fb}");
    let list = emojis_of(&srv, &sid).await;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "festa");
    assert_eq!(list[0].id, png);
    assert!(!list[0].animated);
    // Todos os membros recebem a lista.
    loop {
        let up = wait_for(&mut ana, "ServerUpdated").await;
        if up["server"]["emojis"][0]["name"] == "festa" {
            break;
        }
    }

    // Nome inválido, repetido (sem diferenciar maiúsculas) e a mesma imagem duas vezes.
    let other = image(&srv, &dona_token, tiny_png()).await;
    assert!(create(&mut dona, &sid, "x", &other).await["message"].as_str().unwrap().contains("2 a 32"));
    assert!(create(&mut dona, &sid, "com espaço", &other).await["ok"] == false);
    assert!(create(&mut dona, &sid, "FESTA", &other).await["message"].as_str().unwrap().contains("Já existe"));
    assert!(create(&mut dona, &sid, "outra", &png).await["message"].as_str().unwrap().contains("já é um emoji"));

    // Só imagens, até 256 KB, enviadas pela própria pessoa.
    let text = image(&srv, &dona_token, b"apenas texto".to_vec()).await;
    assert!(create(&mut dona, &sid, "texto", &text).await["message"].as_str().unwrap().contains("PNG"));
    let mut big = tiny_png();
    big.resize(300 * 1024, 0);
    let big = image(&srv, &dona_token, big).await;
    assert!(create(&mut dona, &sid, "grande", &big).await["message"].as_str().unwrap().contains("256 KB"));
    let alheia = image(&srv, &ana_token, tiny_png()).await;
    assert!(create(&mut dona, &sid, "alheia", &alheia).await["message"].as_str().unwrap().contains("enviada por você"));

    // Sem permissão (membro comum) não cria; GIF vira animado.
    let fb = create(&mut ana, &sid, "meu", &alheia).await;
    assert!(fb["message"].as_str().unwrap().contains("permissão"), "{fb}");
    let gif = image(&srv, &dona_token, tiny_gif()).await;
    assert_eq!(create(&mut dona, &sid, "dancinha", &gif).await["ok"], true);
    assert!(emojis_of(&srv, &sid).await.iter().any(|e| e.name == "dancinha" && e.animated));

    // Renomear (com auditoria) e persistir.
    send(&mut dona, json!({"type":"RenameServerEmoji","payload":{"server_id":sid,"emoji_id":png,"name":"festao"}})).await;
    assert_eq!(feedback(&mut dona, "server_emoji").await["ok"], true);
    send(&mut dona, json!({"type":"GetAuditLog","payload":{"server_id":sid,"action":"emoji_update"}})).await;
    let log = wait_for(&mut dona, "AuditLog").await;
    assert!(log["entries"].as_array().unwrap().iter().any(|e| e["details"] == "emoji: :festa: → :festao:"), "{log}");
    let db = srv.state.read().await.db.clone();
    db.flush();
    {
        let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
        let st = reopened.read().await;
        let names: Vec<String> = st.find_server(&sid).unwrap().emojis.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec!["festao".to_string(), "dancinha".to_string()]);
    }

    // Excluir.
    send(&mut dona, json!({"type":"DeleteServerEmoji","payload":{"server_id":sid,"emoji_id":gif}})).await;
    assert_eq!(feedback(&mut dona, "server_emoji").await["ok"], true);
    assert_eq!(emojis_of(&srv, &sid).await.len(), 1);
}

#[tokio::test]
async fn server_emoji_in_messages_and_reactions() {
    let srv = start_server().await;
    let (mut dona, dona_token, server, sid) = owner(&srv, "DonaEmoji2").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let (mut ana, _) = member(&srv, "AnaEmoji2", server["invite_code"].as_str().unwrap()).await;
    let (mut estranho, _, est_server, _) = owner(&srv, "EstranhoEmoji2").await;
    let canal_estranho = est_server["text_channels"][0]["id"].as_str().unwrap().to_string();

    let id = image(&srv, &dona_token, tiny_png()).await;
    assert_eq!(create(&mut dona, &sid, "festa", &id).await["ok"], true);

    // Membro usa: o código fica com o nome atual. Quem não é membro: vira :nome:.
    let m = send_chat(&mut ana, &geral, &format!("oi <:nomeantigo:{id}> e <:x:123>")).await;
    assert_eq!(m["payload"]["message"]["content"], format!("oi <:festa:{id}> e <:x:123>"));
    let fora = send_chat(&mut estranho, &canal_estranho, &format!("copiei <:festa:{id}>")).await;
    assert_eq!(fora["payload"]["message"]["content"], "copiei :festa:");

    // Editar também passa pela mesma regra.
    let mid = m["payload"]["message"]["id"].as_str().unwrap().to_string();
    send(&mut ana, json!({"type":"EditChat","payload":{"channel_id":geral,"message_id":mid,"content":format!("<a:festa:{id}>!")}})).await;
    let edited = loop {
        let v = wait_for(&mut ana, "MessageUpdated").await;
        if v["message"]["id"] == mid.as_str() {
            break v["message"].clone();
        }
    };
    assert_eq!(edited["content"], format!("<:festa:{id}>!"), "animado corrigido pelo cadastro");

    // Reação com o emoji do servidor.
    let key = format!("<:festa:{id}>");
    send(&mut ana, json!({"type":"ToggleReaction","payload":{"channel_id":geral,"message_id":mid,"emoji":format!("<:qualquer:{id}>")}})).await;
    let reacted = loop {
        let v = wait_for(&mut ana, "MessageUpdated").await;
        if v["message"]["id"] == mid.as_str() && v["message"]["reactions"].get(&key).is_some() {
            break v["message"].clone();
        }
    };
    assert_eq!(reacted["reactions"][&key], json!(["AnaEmoji2"]));

    // Emoji excluído: dá para tirar a própria reação, mas não adicionar de novo.
    send(&mut dona, json!({"type":"DeleteServerEmoji","payload":{"server_id":sid,"emoji_id":id}})).await;
    assert_eq!(feedback(&mut dona, "server_emoji").await["ok"], true);
    send(&mut ana, json!({"type":"ToggleReaction","payload":{"channel_id":geral,"message_id":mid,"emoji":key}})).await;
    loop {
        let v = wait_for(&mut ana, "MessageUpdated").await;
        if v["message"]["id"] == mid.as_str() && v["message"]["reactions"].get(&key).is_none() {
            break;
        }
    }
    send(&mut ana, json!({"type":"ToggleReaction","payload":{"channel_id":geral,"message_id":mid,"emoji":key}})).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let st = srv.state.read().await;
    let msg = st.chat_history[&geral].iter().find(|x| x.id == mid).unwrap();
    assert!(!msg.reactions.contains_key(&key), "não volta a adicionar emoji excluído");
    drop(st);

    // Texto que não é emoji continua recusado como reação.
    send(&mut ana, json!({"type":"ToggleReaction","payload":{"channel_id":geral,"message_id":mid,"emoji":"<b>oi</b>"}})).await;
    assert_eq!(feedback(&mut ana, "reaction").await["ok"], false);
}
