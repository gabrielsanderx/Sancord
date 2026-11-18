//! Castigo (timeout) de membros — fluxo F da especificação e autorização.
use super::*;

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

async fn create_role(ws: &mut Ws, sid: &str, name: &str, permissions: Value) -> String {
    send(ws, json!({"type":"CreateRole","payload":{"server_id":sid,"name":name,"color":"#123456","permissions":permissions}})).await;
    loop {
        let up = wait_for(ws, "ServerUpdated").await;
        if let Some(r) = up["server"]["roles"].as_array().unwrap().iter().find(|r| r["name"] == name) {
            return r["id"].as_str().unwrap().to_string();
        }
    }
}

async fn assign(owner: &mut Ws, sid: &str, user: &str, role: &str) {
    send(owner, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":user,"role_ids":[role]}})).await;
    let lower = user.to_lowercase();
    loop {
        let up = wait_for(owner, "ServerUpdated").await;
        if up["server"]["member_roles"][&lower].as_array().is_some_and(|r| r.iter().any(|id| id == role)) {
            return;
        }
    }
}

async fn timeout(ws: &mut Ws, sid: &str, target: &str, secs: u64, reason: Option<&str>) -> Value {
    send(ws, json!({"type":"TimeoutMember","payload":{"server_id":sid,"target_username":target,"duration_secs":secs,"reason":reason}})).await;
    feedback(ws, "timeout_member").await
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

#[tokio::test]
async fn flow_f_timeout_blocks_actions_persists_and_expires() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaCastigo", "friends").await;
    let code = server["invite_code"].as_str().unwrap();
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let voz = server["voice_channels"][0]["id"].as_str().unwrap().to_string();
    let (mut moderadora, _) = join_with(&srv, "Moderadora", code).await;
    let (mut castigado, _) = join_with(&srv, "Castigado", code).await;
    let role = create_role(&mut dono, &sid, "Moderação", json!({"moderate_members":true})).await;
    assign(&mut dono, &sid, "Moderadora", &role).await;

    let antes = send_chat(&mut castigado, &geral, "antes do castigo").await;
    assert_eq!(antes["type"], "NewChatMessage");

    // Moderadora aplica 10 minutos com motivo.
    let fb = timeout(&mut moderadora, &sid, "Castigado", 600, Some("  flood no geral  ")).await;
    assert_eq!(fb["ok"], true, "{fb}");
    assert!(fb["message"].as_str().unwrap().contains("10 minutos"));

    // O próprio membro recebe o servidor com o castigo e as permissões já reduzidas.
    let up = loop {
        let up = wait_for(&mut castigado, "ServerUpdated").await;
        if up["server"]["member_timeouts"]["castigado"].is_i64() {
            break up;
        }
    };
    let canal = up["server"]["text_channels"].as_array().unwrap().iter().find(|c| c["id"] == geral.as_str()).unwrap();
    assert_eq!(canal["effective_permissions"]["send_messages"], false);
    assert_eq!(canal["effective_permissions"]["view_channel"], true);

    // Envio recusado com aviso próprio; leitura, visão e voz conferidas no servidor.
    let falha = send_chat(&mut castigado, &geral, "durante o castigo").await;
    assert_eq!(falha["type"], "SendFailed");
    assert!(falha["payload"]["message"].as_str().unwrap().contains("castigo"), "{falha}");
    {
        let st = srv.state.read().await;
        let s = st.find_server(&sid).unwrap();
        let p = s.channel_permissions("castigado", &geral);
        assert!(p.view_channel && p.read_history);
        assert!(!p.send_messages && !p.add_reactions && !p.attach_files && !p.pin_messages);
        assert!(!st.can_join_voice("castigado", &voz));
        assert!(st.can_join_voice("moderadora", &voz), "só o alvo é afetado");
    }

    // Persistido: sobrevive a reinício do servidor.
    let db = srv.state.read().await.db.clone();
    db.flush();
    {
        let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
        let st = reopened.read().await;
        assert!(st.find_server(&sid).unwrap().member_timeouts.contains_key("castigado"));
    }

    // Auditoria com duração e motivo (sem espaços nas pontas).
    send(&mut dono, json!({"type":"GetAuditLog","payload":{"server_id":sid,"action":"member_timeout"}})).await;
    let log = wait_for(&mut dono, "AuditLog").await;
    let entry = &log["entries"][0];
    assert_eq!(entry["target"], "castigado");
    assert_eq!(entry["actor"], "moderadora");
    assert_eq!(entry["details"], "duração: 10 minutos; motivo: flood no geral");

    // Fim do prazo: a permissão volta pelo relógio e a limpeza avisa os clientes.
    {
        let mut st = srv.state.write().await;
        let now = crate::auth::now_ms();
        st.find_server_mut(&sid).unwrap().member_timeouts.insert("castigado".into(), now - 1);
        assert!(st.find_server(&sid).unwrap().channel_permissions("castigado", &geral).send_messages);
        assert_eq!(crate::timeouts::clear_expired(&mut st, now), vec![sid.clone()]);
        assert!(st.find_server(&sid).unwrap().member_timeouts.is_empty());
    }
    loop {
        let up = wait_for(&mut castigado, "ServerUpdated").await;
        if up["server"]["member_timeouts"].as_object().is_some_and(|m| m.is_empty()) {
            break;
        }
    }
    let depois = send_chat(&mut castigado, &geral, "acesso restaurado").await;
    assert_eq!(depois["type"], "NewChatMessage");
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    assert!(reopened.read().await.find_server(&sid).unwrap().member_timeouts.is_empty(), "registro apagado do banco");
}

#[tokio::test]
async fn timeout_authorization_and_removal() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaRegras", "friends").await;
    let code = server["invite_code"].as_str().unwrap();
    let (mut moderador, _) = join_with(&srv, "Moderador", code).await;
    let (mut comum, _) = join_with(&srv, "Comum", code).await;
    let (_admin, _) = join_with(&srv, "Admin", code).await;
    let (_veterana, _) = join_with(&srv, "Veterana", code).await;
    let moderacao = create_role(&mut dono, &sid, "Moderação", json!({"moderate_members":true})).await;
    let administracao = create_role(&mut dono, &sid, "Administração", json!({"administrator":true})).await;
    let veteranos = create_role(&mut dono, &sid, "Veteranos", json!({})).await;
    assign(&mut dono, &sid, "Moderador", &moderacao).await;
    assign(&mut dono, &sid, "Admin", &administracao).await;
    assign(&mut dono, &sid, "Veterana", &veteranos).await;

    // Sem a permissão.
    let fb = timeout(&mut comum, &sid, "Veterana", 60, None).await;
    assert_eq!(fb["ok"], false);
    assert!(fb["message"].as_str().unwrap().contains("permissão"));
    // Dono, administradores, a si mesmo e acima de 28 dias.
    for (alvo, secs, trecho) in [
        ("DonaRegras", 60, "administradores"),
        ("Admin", 60, "administradores"),
        ("Moderador", 60, "si mesmo"),
        ("Comum", crate::timeouts::MAX_SECS + 1, "28 dias"),
    ] {
        let fb = timeout(&mut moderador, &sid, alvo, secs, None).await;
        assert_eq!(fb["ok"], false, "{alvo}");
        assert!(fb["message"].as_str().unwrap().contains(trecho), "{alvo}: {fb}");
    }
    // Hierarquia: o resultado acompanha a posição real dos cargos.
    let (moderador_pos, veterana_pos) = {
        let st = srv.state.read().await;
        let s = st.find_server(&sid).unwrap();
        (s.highest_position("moderador"), s.highest_position("veterana"))
    };
    let fb = timeout(&mut moderador, &sid, "Veterana", 60, None).await;
    assert_eq!(fb["ok"], moderador_pos > veterana_pos, "{fb}");

    // Remover sem castigo ativo é recusado; aplicar e remover funcionam e são auditados.
    let fb = timeout(&mut moderador, &sid, "Comum", 0, None).await;
    assert_eq!(fb["ok"], false);
    assert!(fb["message"].as_str().unwrap().contains("não está de castigo"));
    assert_eq!(timeout(&mut moderador, &sid, "Comum", 3600, None).await["ok"], true);
    let fb = timeout(&mut moderador, &sid, "Comum", 0, None).await;
    assert_eq!(fb["ok"], true, "{fb}");
    assert!(srv.state.read().await.find_server(&sid).unwrap().timeout_until("comum", crate::auth::now_ms()).is_none());
    send(&mut dono, json!({"type":"GetAuditLog","payload":{"server_id":sid,"action":"member_timeout_removed"}})).await;
    assert_eq!(wait_for(&mut dono, "AuditLog").await["entries"][0]["target"], "comum");

    // O dono pode aplicar em qualquer membro abaixo dele, inclusive moderadores.
    assert_eq!(timeout(&mut dono, &sid, "Moderador", 60, None).await["ok"], true);
}

#[test]
fn durations_are_described_in_portuguese() {
    use crate::timeouts::{describe_duration, describe_remaining};
    assert_eq!(describe_duration(60), "1 minuto");
    assert_eq!(describe_duration(600), "10 minutos");
    assert_eq!(describe_duration(3600), "1 hora");
    assert_eq!(describe_duration(86_400 * 7), "7 dias");
    assert_eq!(describe_duration(45), "45 segundos");
    assert_eq!(describe_remaining(1), "1 minuto");
    assert_eq!(describe_remaining(61_000), "2 minutos");
    assert_eq!(describe_remaining(3 * 3_600_000), "3 horas");
    assert_eq!(describe_remaining(3 * 86_400_000), "3 dias");
}
