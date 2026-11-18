//! Fase 6 — voz: moderação (silenciar/ensurdecer/mover/desconectar), limite de
//! pessoas, chamadas privadas (registro, recusa, fim, privacidade) e ICE.
use super::*;

async fn user(srv: &TestServer, name: &str) -> (Ws, String) {
    let token = register(srv, name).await;
    let mut ws = connect(srv, &token).await;
    let w = wait_for(&mut ws, "Welcome").await;
    (ws, w["user"]["id"].as_str().unwrap().to_string())
}

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

async fn befriend(a: &mut Ws, b: &mut Ws, a_name: &str, b_name: &str) {
    send(a, json!({"type":"SendFriendRequest","payload":{"target_username":b_name}})).await;
    assert_eq!(wait_for(a, "FriendFeedback").await["ok"], true);
    send(b, json!({"type":"RespondFriendRequest","payload":{"from_username":a_name,"accept":true}})).await;
    loop {
        let s = wait_for(b, "FriendsSync").await;
        if s["friends"].as_array().unwrap().iter().any(|f| f["username"] == a_name) {
            break;
        }
    }
}

async fn voice_of(srv: &TestServer, uid: &str) -> Option<String> {
    srv.state.read().await.users.get(uid).and_then(|u| u.voice_channel_id.clone())
}

/// Espera até a condição sobre o estado do servidor valer (máx. 3 s).
async fn eventually(srv: &TestServer, cond: impl Fn(&crate::state::ServerState) -> bool) {
    for _ in 0..60 {
        if cond(&*srv.state.read().await) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("condição não atingida");
}

fn voice_channel_id(server: &Value) -> String {
    server["voice_channels"][0]["id"].as_str().unwrap().to_string()
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

#[tokio::test]
async fn server_mute_deafen_with_permission_hierarchy_and_persistence() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaVoz", "friends").await;
    let code = server["invite_code"].as_str().unwrap();
    let (mut moda, _) = join_with(&srv, "ModVoz", code).await;
    let (mut membro, _) = join_with(&srv, "MembroVoz", code).await;
    let vc = voice_channel_id(&server);
    let role = create_role(&mut dono, &sid, "Mod de voz", json!({"mute_members": true, "deafen_members": true})).await;
    send(&mut dono, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":"ModVoz","role_ids":[role]}})).await;
    eventually(&srv, |st| st.find_server(&sid).unwrap().effective_permissions("modvoz").mute_members).await;

    let membro_id = {
        let st = srv.state.read().await;
        st.users.iter().find(|(_, u)| u.username == "MembroVoz").unwrap().0.clone()
    };
    send(&mut membro, json!({"type":"JoinVoice","payload":{"channel_id":vc}})).await;
    eventually(&srv, |st| st.users[&membro_id].voice_channel_id.is_some()).await;

    // Sem permissão: membro comum não silencia ninguém.
    send(&mut membro, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"ModVoz","action":"mute"}})).await;
    assert_eq!(feedback(&mut membro, "moderate_voice").await["ok"], false);
    // Hierarquia: moderador não silencia a dona.
    send(&mut moda, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"DonaVoz","action":"mute"}})).await;
    assert_eq!(feedback(&mut moda, "moderate_voice").await["ok"], false);
    // Permissão que o cargo não tem: mover.
    send(&mut moda, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"MembroVoz","action":"disconnect"}})).await;
    assert_eq!(feedback(&mut moda, "moderate_voice").await["ok"], false);

    send(&mut moda, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"MembroVoz","action":"mute"}})).await;
    assert_eq!(feedback(&mut moda, "moderate_voice").await["ok"], true);
    loop {
        let sync = wait_for(&mut membro, "VoiceStateSync").await;
        let me = sync["users"].as_array().unwrap().iter().find(|u| u["id"] == membro_id.as_str()).cloned().unwrap();
        if me["server_muted"] == true {
            assert_eq!(me["server_deafened"], false);
            break;
        }
    }

    // Persiste: sair e voltar mantém; e sobrevive a reinício.
    send(&mut membro, json!({"type":"LeaveVoice"})).await;
    eventually(&srv, |st| st.users[&membro_id].voice_channel_id.is_none() && !st.users[&membro_id].server_muted).await;
    send(&mut membro, json!({"type":"JoinVoice","payload":{"channel_id":vc}})).await;
    eventually(&srv, |st| st.users[&membro_id].server_muted).await;
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    assert!(reopened.read().await.find_server(&sid).unwrap().voice_moderation["membrovoz"].muted);

    send(&mut moda, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"MembroVoz","action":"unmute"}})).await;
    assert_eq!(feedback(&mut moda, "moderate_voice").await["ok"], true);
    eventually(&srv, |st| !st.users[&membro_id].server_muted && st.find_server(&sid).unwrap().voice_moderation.is_empty()).await;
}

#[tokio::test]
async fn move_disconnect_and_user_limit() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonoMove", "friends").await;
    let code = server["invite_code"].as_str().unwrap();
    let (mut ana, _) = join_with(&srv, "AnaMove", code).await;
    let (mut bia, _) = join_with(&srv, "BiaMove", code).await;
    let v1 = voice_channel_id(&server);
    send(&mut dono, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"Sala 2","kind":"voice"}})).await;
    let v2 = loop {
        let up = wait_for(&mut dono, "ServerUpdated").await;
        if let Some(c) = up["server"]["voice_channels"].as_array().unwrap().iter().find(|c| c["name"] == "Sala 2") {
            break c["id"].as_str().unwrap().to_string();
        }
    };
    let id_of = |st: &crate::state::ServerState, name: &str| st.users.iter().find(|(_, u)| u.username == name).unwrap().0.clone();
    let (ana_id, bia_id) = {
        let st = srv.state.read().await;
        (id_of(&st, "AnaMove"), id_of(&st, "BiaMove"))
    };

    // Limite: canal de texto recusa; voz aceita e é aplicado.
    let text = server["text_channels"][0]["id"].as_str().unwrap();
    send(&mut dono, json!({"type":"UpdateChannel","payload":{"server_id":sid,"channel_id":text,"user_limit":2}})).await;
    assert_eq!(feedback(&mut dono, "update_channel").await["ok"], false);
    send(&mut dono, json!({"type":"UpdateChannel","payload":{"server_id":sid,"channel_id":v2,"user_limit":1}})).await;
    eventually(&srv, |st| st.find_server(&sid).unwrap().find_channel(&v2).unwrap().user_limit == 1).await;

    send(&mut ana, json!({"type":"JoinVoice","payload":{"channel_id":v2}})).await;
    eventually(&srv, |st| st.users[&ana_id].voice_channel_id.as_deref() == Some(v2.as_str())).await;
    send(&mut bia, json!({"type":"JoinVoice","payload":{"channel_id":v2}})).await;
    let fb = feedback(&mut bia, "join_voice").await;
    assert_eq!(fb["ok"], false);
    assert!(fb["message"].as_str().unwrap().contains("cheio"));
    assert_eq!(voice_of(&srv, &bia_id).await, None);

    // Mover: Bia em v1, dono move para v2 (moderador ignora o limite).
    send(&mut bia, json!({"type":"JoinVoice","payload":{"channel_id":v1}})).await;
    eventually(&srv, |st| st.users[&bia_id].voice_channel_id.as_deref() == Some(v1.as_str())).await;
    send(&mut dono, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"BiaMove","action":"move","channel_id":v2}})).await;
    assert_eq!(feedback(&mut dono, "moderate_voice").await["ok"], true);
    let moved = wait_for(&mut bia, "VoiceMoved").await;
    assert_eq!(moved["channel_id"], v2);
    assert_eq!(voice_of(&srv, &bia_id).await.as_deref(), Some(v2.as_str()));
    // Ana (já em v2) é avisada da entrada para iniciar a conexão.
    loop {
        let j = wait_for(&mut ana, "PeerJoinedVoice").await;
        if j["peer"]["id"] == bia_id.as_str() {
            break;
        }
    }

    // Desconectar.
    send(&mut dono, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"AnaMove","action":"disconnect"}})).await;
    assert_eq!(feedback(&mut dono, "moderate_voice").await["ok"], true);
    assert!(wait_for(&mut ana, "VoiceMoved").await["channel_id"].is_null());
    assert_eq!(voice_of(&srv, &ana_id).await, None);
    // Desconectar quem não está na voz é erro.
    send(&mut dono, json!({"type":"ModerateVoice","payload":{"server_id":sid,"target_username":"AnaMove","action":"disconnect"}})).await;
    assert_eq!(feedback(&mut dono, "moderate_voice").await["ok"], false);
}

#[tokio::test]
async fn private_call_log_decline_and_end() {
    let srv = start_server().await;
    let (mut ana, ana_id) = user(&srv, "AnaCall").await;
    let (mut beto, beto_id) = user(&srv, "BetoCall").await;
    befriend(&mut ana, &mut beto, "AnaCall", "BetoCall").await;
    let dm = ServerState::make_dm_id("anacall", "betocall");
    let call = dm.replacen("dm:", "dmvoice:", 1);

    // Chamada recusada e perdida.
    send(&mut ana, json!({"type":"JoinVoice","payload":{"channel_id":call}})).await;
    let ring = wait_for(&mut beto, "DmCallIncoming").await;
    assert_eq!(ring["voice_channel_id"], call);
    send(&mut beto, json!({"type":"DeclineCall","payload":{"channel_id":call}})).await;
    assert_eq!(wait_for(&mut ana, "CallDeclined").await["by_username"], "BetoCall");
    send(&mut ana, json!({"type":"LeaveVoice"})).await;
    assert_eq!(wait_for(&mut beto, "CallEnded").await["channel_id"], call);
    eventually(&srv, |st| {
        let h = st.chat_history.get(&dm).cloned().unwrap_or_default();
        h.iter().any(|m| m.content.contains("iniciou uma chamada")) && h.iter().any(|m| m.content.contains("Chamada perdida"))
    })
    .await;
    {
        let st = srv.state.read().await;
        let acc = st.accounts.get("betocall").unwrap();
        assert!(st.read_state(&acc.id, &dm).mention_count >= 1, "chamada perdida notifica");
        assert!(st.active_calls.is_empty());
    }

    // Chamada atendida e encerrada (a queda da conexão também conta como saída).
    send(&mut ana, json!({"type":"JoinVoice","payload":{"channel_id":call}})).await;
    wait_for(&mut beto, "DmCallIncoming").await;
    send(&mut beto, json!({"type":"JoinVoice","payload":{"channel_id":call}})).await;
    eventually(&srv, |st| st.active_calls.get(&call).is_some_and(|c| c.answered)).await;
    assert_eq!(voice_of(&srv, &beto_id).await.as_deref(), Some(call.as_str()));
    drop(beto);
    eventually(&srv, |st| !st.users.contains_key(&beto_id)).await;
    send(&mut ana, json!({"type":"LeaveVoice"})).await;
    eventually(&srv, |st| {
        st.chat_history.get(&dm).is_some_and(|h| h.iter().any(|m| m.content.contains("Chamada encerrada")))
    })
    .await;
    assert_eq!(voice_of(&srv, &ana_id).await, None);
}

#[tokio::test]
async fn strangers_cannot_ring_without_accepted_conversation() {
    let srv = start_server().await;
    let (_ana, _) = user(&srv, "AnaPriv").await;
    let (mut caio, caio_id) = user(&srv, "CaioPriv").await;
    let call = ServerState::make_dm_id("anapriv", "caiopriv").replacen("dm:", "dmvoice:", 1);
    send(&mut caio, json!({"type":"JoinVoice","payload":{"channel_id":call}})).await;
    let fb = feedback(&mut caio, "join_voice").await;
    assert_eq!(fb["ok"], false);
    assert!(fb["message"].as_str().unwrap().contains("aceitar"));
    assert_eq!(voice_of(&srv, &caio_id).await, None);
}

#[test]
fn ice_servers_from_environment() {
    use crate::config::ice_servers_from;
    let default = ice_servers_from(None, None, None, None);
    assert_eq!(default.len(), 1);
    assert!(default[0].urls.iter().all(|u| u.starts_with("stun:")));
    // TURN sem credencial é ignorado; URLs inválidas são descartadas.
    assert_eq!(ice_servers_from(None, Some("turn:relay.exemplo:3478"), None, None).len(), 1);
    let full = ice_servers_from(
        Some("stun:a.exemplo:3478, http://x"),
        Some("turn:relay.exemplo:3478?transport=udp,turns:relay.exemplo:5349"),
        Some("sancord"),
        Some("segredo"),
    );
    assert_eq!(full[0].urls, vec!["stun:a.exemplo:3478".to_string()]);
    assert_eq!(full[1].urls.len(), 2);
    assert_eq!(full[1].username.as_deref(), Some("sancord"));
}

#[tokio::test]
async fn welcome_carries_ice_servers() {
    let srv = start_server().await;
    let token = register(&srv, "IceUser").await;
    let mut ws = connect(&srv, &token).await;
    let w = wait_for(&mut ws, "Welcome").await;
    assert!(w["ice_servers"][0]["urls"].as_array().is_some_and(|u| !u.is_empty()));
}

#[tokio::test]
async fn voice_moderation_survives_username_change_and_restart() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "DonoRenameVoz", "friends").await;
    let (mut member, _) = join_with(&srv, "VozAntiga", server["invite_code"].as_str().unwrap()).await;
    for action in ["mute", "deafen"] {
        send(&mut owner, json!({"type":"ModerateVoice","payload":{
            "server_id":sid,"target_username":"VozAntiga","action":action
        }})).await;
        assert_eq!(feedback(&mut owner, "moderate_voice").await["ok"], true);
    }
    send(&mut member, json!({"type":"UpdateUsername","payload":{"new_username":"VozNova"}})).await;
    assert_eq!(feedback(&mut member, "update_username").await["ok"], true);
    let vc = voice_channel_id(&server);
    send(&mut member, json!({"type":"JoinVoice","payload":{"channel_id":vc}})).await;
    eventually(&srv, |st| st.users.values().any(|u| u.username == "VozNova" && u.voice_channel_id.is_some())).await;
    {
        let st = srv.state.read().await;
        let user = st.users.values().find(|u| u.username == "VozNova").unwrap();
        assert!(user.server_muted && user.server_deafened, "renomear não pode remover a moderação");
        assert!(!st.find_server(&sid).unwrap().voice_moderation.contains_key("vozantiga"));
    }
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let moderation = &st.find_server(&sid).unwrap().voice_moderation;
    assert!(!moderation.contains_key("vozantiga"));
    let flags = moderation.get("voznova").expect("moderação deve sobreviver ao reinício");
    assert!(flags.muted && flags.deafened);
}
