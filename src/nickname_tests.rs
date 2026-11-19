//! Etapa C4 — apelido por servidor: permissões, hierarquia, castigo e persistência.
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

async fn nick(ws: &mut Ws, sid: &str, target: &str, nickname: Value) -> Value {
    send(ws, json!({"type":"SetMemberNickname","payload":{"server_id":sid,"target_username":target,"nickname":nickname}})).await;
    feedback(ws, "member_nick").await
}

async fn nicks_of(srv: &TestServer, sid: &str) -> std::collections::HashMap<String, String> {
    srv.state.read().await.find_server(sid).unwrap().member_nicks.clone()
}

#[tokio::test]
async fn nickname_rules_follow_permissions_hierarchy_and_timeout() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaNick", "friends").await;
    let invite = server["invite_code"].as_str().unwrap().to_string();
    let (mut ana, _) = join_with(&srv, "AnaNick", &invite).await;
    let (mut bia, _) = join_with(&srv, "BiaNick", &invite).await;

    // Próprio apelido: padrão permitido; espaços e controles limpos; difundido no ServerUpdated.
    let fb = nick(&mut ana, &sid, "AnaNick", json!("  Aninha \n da  Silva ")).await;
    assert_eq!(fb["ok"], true, "{fb}");
    assert_eq!(nicks_of(&srv, &sid).await["ananick"], "Aninha da Silva");
    loop {
        let up = wait_for(&mut bia, "ServerUpdated").await;
        if up["server"]["member_nicks"]["ananick"] == "Aninha da Silva" {
            break;
        }
    }

    // Limite de 32 caracteres; vazio remove.
    assert_eq!(nick(&mut ana, &sid, "AnaNick", json!("x".repeat(33))).await["ok"], false);
    assert_eq!(nick(&mut ana, &sid, "AnaNick", json!("")).await["ok"], true);
    assert!(!nicks_of(&srv, &sid).await.contains_key("ananick"));

    // Sem manage_nicknames não muda o de outra pessoa.
    let fb = nick(&mut bia, &sid, "AnaNick", json!("Troll")).await;
    assert_eq!(fb["ok"], false);
    assert!(fb["message"].as_str().unwrap().contains("permissão"), "{fb}");

    // Com manage_nicknames: só abaixo na hierarquia; nunca o dono.
    let apelidos = create_role(&mut dona, &sid, "Apelidos", json!({"manage_nicknames":true})).await;
    assign(&mut dona, &sid, "BiaNick", &apelidos).await;
    assert_eq!(nick(&mut bia, &sid, "AnaNick", json!("Ana da Bia")).await["ok"], true);
    assert_eq!(nicks_of(&srv, &sid).await["ananick"], "Ana da Bia");
    let fb = nick(&mut bia, &sid, "DonaNick", json!("Chefe")).await;
    assert!(fb["message"].as_str().unwrap().contains("dono"), "{fb}");
    let alto = create_role(&mut dona, &sid, "Alto", json!({})).await;
    {
        // Coloca o cargo "Alto" acima do "Apelidos" e dá para a Ana.
        let mut st = srv.state.write().await;
        let s = st.find_server_mut(&sid).unwrap();
        let top = s.roles.iter().map(|r| r.position).max().unwrap();
        s.roles.iter_mut().find(|r| r.id == alto).unwrap().position = top + 1;
        s.member_roles.insert("ananick".into(), vec![alto.clone()]);
    }
    let fb = nick(&mut bia, &sid, "AnaNick", json!("Ana 2")).await;
    assert!(fb["message"].as_str().unwrap().contains("hierarquia"), "{fb}");

    // A dona muda o de qualquer um.
    assert_eq!(nick(&mut dona, &sid, "BiaNick", json!("Bia Moderadora")).await["ok"], true);

    // De castigo, não muda o próprio apelido.
    send(&mut dona, json!({"type":"TimeoutMember","payload":{"server_id":sid,"target_username":"AnaNick","duration_secs":600}})).await;
    assert_eq!(feedback(&mut dona, "timeout_member").await["ok"], true);
    let fb = nick(&mut ana, &sid, "AnaNick", json!("Fugindo")).await;
    assert_eq!(fb["ok"], false, "{fb}");

    // Auditoria registra a troca.
    send(&mut dona, json!({"type":"GetAuditLog","payload":{"server_id":sid,"action":"member_nick"}})).await;
    let log = wait_for(&mut dona, "AuditLog").await;
    assert!(log["entries"].as_array().unwrap().iter().any(|e| e["details"] == "apelido: Bia Moderadora"), "{log}");
}

#[tokio::test]
async fn nickname_persists_and_is_cleared_when_member_leaves() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaNick2", "friends").await;
    let invite = server["invite_code"].as_str().unwrap().to_string();
    let (mut ana, _) = join_with(&srv, "AnaNick2", &invite).await;
    let (_cris, _) = join_with(&srv, "CrisNick2", &invite).await;

    assert_eq!(nick(&mut ana, &sid, "AnaNick2", json!("Aninha")).await["ok"], true);
    assert_eq!(nick(&mut dona, &sid, "CrisNick2", json!("Cris")).await["ok"], true);

    // Sobrevive a reinício (coluna server_members.nickname).
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    {
        let st = reopened.read().await;
        let s = st.find_server(&sid).unwrap();
        assert_eq!(s.member_nicks["ananick2"], "Aninha");
        assert_eq!(s.member_nicks["crisnick2"], "Cris");
    }

    // Expulsar remove o apelido.
    send(&mut dona, json!({"type":"KickServerMember","payload":{"server_id":sid,"target_username":"CrisNick2"}})).await;
    loop {
        let up = wait_for(&mut dona, "ServerUpdated").await;
        if !up["server"]["members"].as_array().unwrap().iter().any(|m| m == "crisnick2") {
            break;
        }
    }
    assert!(!nicks_of(&srv, &sid).await.contains_key("crisnick2"));
    assert_eq!(nicks_of(&srv, &sid).await["ananick2"], "Aninha");
}

#[test]
fn clean_nickname_rules() {
    use crate::nicknames::clean;
    assert_eq!(clean(None), Ok(None));
    assert_eq!(clean(Some("   ")), Ok(None));
    assert_eq!(clean(Some("a\tb\u{0}c")), Ok(Some("a b c".into())));
    assert_eq!(clean(Some(&"é".repeat(32))), Ok(Some("é".repeat(32))));
    assert!(clean(Some(&"é".repeat(33))).is_err());
}
