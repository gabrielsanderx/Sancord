//! Modo lento por canal: limite por pessoa, isenção de moderação, threads e persistência.
use super::*;

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

/// Envia e devolve a mensagem confirmada ou a recusa (`SendFailed`).
async fn send_chat(ws: &mut Ws, channel: &str, content: &str) -> Value {
    let nonce = uuid::Uuid::new_v4().to_string();
    send(ws, json!({"type":"SendChat","payload":{"channel_id":channel,"content":content,"nonce":nonce}})).await;
    loop {
        let v = wait_for_any(ws, &["NewChatMessage", "SendFailed"]).await;
        let p = &v["payload"];
        if p["nonce"] == nonce.as_str() || p["message"]["nonce"] == nonce.as_str() {
            return v;
        }
    }
}

async fn set_slowmode(ws: &mut Ws, sid: &str, channel: &str, secs: u32) {
    send(ws, json!({"type":"UpdateChannel","payload":{"server_id":sid,"channel_id":channel,"slowmode_secs":secs}})).await;
}

async fn wait_slowmode(ws: &mut Ws, channel: &str, secs: u32) {
    loop {
        let up = wait_for(ws, "ServerUpdated").await;
        let ch = up["server"]["text_channels"].as_array().unwrap().iter().find(|c| c["id"] == channel).cloned();
        if ch.is_some_and(|c| c["slowmode_secs"] == secs) {
            return;
        }
    }
}

#[tokio::test]
async fn slowmode_limits_members_exempts_moderators_and_persists() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaLenta", "friends").await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let voz = server["voice_channels"][0]["id"].as_str().unwrap().to_string();
    let (mut apressado, _) = join_with(&srv, "Apressado", server["invite_code"].as_str().unwrap()).await;

    // Validação e permissão.
    set_slowmode(&mut dona, &sid, &geral, crate::slowmode::MAX_SECS + 1).await;
    assert!(feedback(&mut dona, "update_channel").await["message"].as_str().unwrap().contains("6 horas"));
    set_slowmode(&mut dona, &sid, &voz, 10).await;
    assert!(feedback(&mut dona, "update_channel").await["message"].as_str().unwrap().contains("canais de texto"));
    set_slowmode(&mut apressado, &sid, &geral, 5).await;
    assert_eq!(feedback(&mut apressado, "update_channel").await["ok"], false);
    assert_eq!(srv.state.read().await.find_server(&sid).unwrap().slowmode_for(&geral), 0, "recusas não alteram o canal");

    // Dona liga 30 s; todos recebem o canal com o valor.
    set_slowmode(&mut dona, &sid, &geral, 30).await;
    wait_slowmode(&mut apressado, &geral, 30).await;

    assert_eq!(send_chat(&mut apressado, &geral, "primeira").await["type"], "NewChatMessage");
    let recusa = send_chat(&mut apressado, &geral, "segunda").await;
    assert_eq!(recusa["type"], "SendFailed");
    let texto = recusa["payload"]["message"].as_str().unwrap();
    assert!(texto.starts_with("Modo lento: aguarde") && texto.contains("segundos"), "{texto}");

    // Quem gerencia canais não espera.
    assert_eq!(send_chat(&mut dona, &geral, "aviso 1").await["type"], "NewChatMessage");
    assert_eq!(send_chat(&mut dona, &geral, "aviso 2").await["type"], "NewChatMessage");

    // Thread segue o modo lento do canal-pai, com contagem própria.
    let base = send_chat(&mut dona, &geral, "assunto para thread").await["payload"]["message"]["id"].as_str().unwrap().to_string();
    send(&mut dona, json!({"type":"CreateThread","payload":{"channel_id":geral,"name":"Conversa","message_id":base}})).await;
    let tid = wait_for(&mut dona, "ThreadCreated").await["thread"]["id"].as_str().unwrap().to_string();
    assert_eq!(srv.state.read().await.find_server(&sid).unwrap().slowmode_for(&tid), 30);
    assert_eq!(send_chat(&mut apressado, &tid, "na thread").await["type"], "NewChatMessage");
    assert_eq!(send_chat(&mut apressado, &tid, "de novo na thread").await["type"], "SendFailed");

    // Passado o intervalo, volta a enviar.
    {
        let mut st = srv.state.write().await;
        let past = crate::auth::now_ms() - 31_000;
        st.slowmode_last.insert((geral.clone(), "apressado".into()), past);
    }
    assert_eq!(send_chat(&mut apressado, &geral, "depois de esperar").await["type"], "NewChatMessage");

    // Auditoria com o valor e persistência após reinício.
    send(&mut dona, json!({"type":"GetAuditLog","payload":{"server_id":sid,"action":"channel_update"}})).await;
    let log = wait_for(&mut dona, "AuditLog").await;
    assert!(log["entries"].as_array().unwrap().iter().any(|e| e["details"] == "modo lento: 30 segundos"), "{log}");
    let db = srv.state.read().await.db.clone();
    db.flush();
    {
        let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
        assert_eq!(reopened.read().await.find_server(&sid).unwrap().slowmode_for(&geral), 30);
    }

    // Desligado: mensagens seguidas voltam a passar.
    set_slowmode(&mut dona, &sid, &geral, 0).await;
    wait_slowmode(&mut apressado, &geral, 0).await;
    assert_eq!(send_chat(&mut apressado, &geral, "livre 1").await["type"], "NewChatMessage");
    assert_eq!(send_chat(&mut apressado, &geral, "livre 2").await["type"], "NewChatMessage");
}

#[test]
fn slowmode_wait_math_and_text() {
    use crate::slowmode::{describe_wait, remaining};
    assert_eq!(remaining(None, 30, 1_000), None, "nunca enviou");
    assert_eq!(remaining(Some(1_000), 0, 1_000), None, "desligado");
    assert_eq!(remaining(Some(1_000), 30, 11_000), Some(20_000));
    assert_eq!(remaining(Some(1_000), 30, 31_000), None, "no instante exato já pode");
    assert_eq!(describe_wait(1), "1 segundo");
    assert_eq!(describe_wait(29_001), "30 segundos");
    assert_eq!(describe_wait(61_000), "2 minutos");
    assert_eq!(describe_wait(3 * 3_600_000), "3 horas");
}

#[test]
fn prune_forgets_entries_older_than_the_maximum() {
    let dir = std::env::temp_dir().join(format!("sancord-slow-{}", uuid::Uuid::new_v4()));
    let shared = crate::state::ServerState::load(Config::for_tests(dir)).unwrap();
    let mut st = shared.try_write().unwrap();
    let now = 100_000_000;
    st.slowmode_last.insert(("a".into(), "x".into()), now - i64::from(crate::slowmode::MAX_SECS) * 1000 - 1);
    st.slowmode_last.insert(("b".into(), "x".into()), now - 1_000);
    crate::slowmode::prune(&mut st, now);
    assert_eq!(st.slowmode_last.len(), 1);
    assert!(st.slowmode_last.contains_key(&("b".to_string(), "x".to_string())));
}
