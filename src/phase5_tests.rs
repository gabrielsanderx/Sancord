//! Fase 5 — social: bloqueio, solicitações de mensagem, privacidade, grupos,
//! perfil completo, denúncias e status com prazo.
use super::*;

async fn user(srv: &TestServer, name: &str) -> Ws {
    let token = register(srv, name).await;
    let mut ws = connect(srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    ws
}

/// Espera um FriendsSync que satisfaça a condição.
async fn sync_until(ws: &mut Ws, cond: impl Fn(&Value) -> bool) -> Value {
    loop {
        let s = wait_for(ws, "FriendsSync").await;
        if cond(&s) {
            return s;
        }
    }
}

fn names(list: &Value) -> Vec<String> {
    list.as_array()
        .map(|l| l.iter().map(|f| f["username"].as_str().unwrap_or("").to_lowercase()).collect())
        .unwrap_or_default()
}

async fn befriend(a: &mut Ws, b: &mut Ws, b_name: &str, a_name: &str) {
    send(a, json!({"type":"SendFriendRequest","payload":{"target_username":b_name}})).await;
    sync_until(b, |s| names(&s["incoming_requests"]).contains(&a_name.to_lowercase())).await;
    send(b, json!({"type":"RespondFriendRequest","payload":{"from_username":a_name,"accept":true}})).await;
    sync_until(a, |s| names(&s["friends"]).contains(&b_name.to_lowercase())).await;
    sync_until(b, |s| names(&s["friends"]).contains(&a_name.to_lowercase())).await;
}

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

#[tokio::test]
async fn block_breaks_friendship_and_stops_dm_and_requests() {
    let srv = start_server().await;
    let mut ana = user(&srv, "AnaBloq").await;
    let mut beto = user(&srv, "BetoBloq").await;
    befriend(&mut ana, &mut beto, "BetoBloq", "AnaBloq").await;

    send(&mut ana, json!({"type":"BlockUser","payload":{"target_username":"BetoBloq"}})).await;
    assert_eq!(feedback(&mut ana, "block_user").await["ok"], true);
    let s = sync_until(&mut ana, |s| names(&s["blocked"]).contains(&"betobloq".into())).await;
    assert!(names(&s["friends"]).is_empty());
    sync_until(&mut beto, |s| names(&s["friends"]).is_empty()).await;

    // Beto não consegue mandar DM nem pedido de amizade.
    let dm = ServerState::make_dm_id("anabloq", "betobloq");
    send(&mut beto, json!({"type":"SendChat","payload":{"channel_id":dm,"content":"oi?"}})).await;
    let fail = wait_for(&mut beto, "SendFailed").await;
    assert!(!fail["message"].as_str().unwrap().contains("bloque"), "não revela o bloqueio");
    send(&mut beto, json!({"type":"SendFriendRequest","payload":{"target_username":"AnaBloq"}})).await;
    assert_eq!(wait_for(&mut beto, "FriendFeedback").await["ok"], false);
    // Nem chamada privada.
    send(&mut beto, json!({"type":"JoinVoice","payload":{"channel_id":dm.replacen("dm:", "dmvoice:", 1)}})).await;
    assert_eq!(feedback(&mut beto, "join_voice").await["ok"], false);
    // Ana também não envia enquanto bloqueia.
    send(&mut ana, json!({"type":"SendChat","payload":{"channel_id":dm,"content":"oi"}})).await;
    assert!(wait_for(&mut ana, "SendFailed").await["message"].as_str().unwrap().contains("bloqueou"));

    send(&mut ana, json!({"type":"UnblockUser","payload":{"target_username":"BetoBloq"}})).await;
    sync_until(&mut ana, |s| names(&s["blocked"]).is_empty()).await;
    send(&mut beto, json!({"type":"SendFriendRequest","payload":{"target_username":"AnaBloq"}})).await;
    assert_eq!(wait_for(&mut beto, "FriendFeedback").await["ok"], true);
}

#[tokio::test]
async fn stranger_dm_becomes_request_and_privacy_is_enforced() {
    let srv = start_server().await;
    let mut ana = user(&srv, "AnaReq").await;
    let mut caio = user(&srv, "CaioReq").await;
    let dm = ServerState::make_dm_id("anareq", "caioreq");

    send(&mut caio, json!({"type":"OpenDm","payload":{"target_username":"AnaReq"}})).await;
    wait_for(&mut caio, "DmOpened").await;
    send(&mut caio, json!({"type":"SendChat","payload":{"channel_id":dm,"content":"olá, desconhecida"}})).await;
    let s = sync_until(&mut ana, |s| s["message_requests"].as_array().is_some_and(|l| !l.is_empty())).await;
    assert_eq!(s["message_requests"][0]["dm_id"], dm);
    assert!(s["dm_conversations"].as_array().unwrap().iter().all(|c| c["dm_id"] != dm));
    {
        let st = srv.state.read().await;
        let acc = st.accounts.get("anareq").unwrap();
        assert_eq!(st.read_state(&acc.id, &dm).mention_count, 0, "solicitação não notifica");
    }

    send(&mut ana, json!({"type":"AcceptMessageRequest","payload":{"dm_id":dm}})).await;
    let s = sync_until(&mut ana, |s| s["message_requests"].as_array().is_some_and(|l| l.is_empty())).await;
    assert!(s["dm_conversations"].as_array().unwrap().iter().any(|c| c["dm_id"] == dm));

    // Política "só amigos": um novo desconhecido é recusado.
    send(&mut ana, json!({"type":"UpdateUserPrefs","payload":{"privacy":{"dm_policy":"friends","friend_requests":"none"}}})).await;
    let prefs = wait_for(&mut ana, "UserPrefsUpdated").await;
    assert_eq!(prefs["prefs"]["privacy"]["dm_policy"], "friends");
    let mut duda = user(&srv, "DudaReq").await;
    let dm2 = ServerState::make_dm_id("anareq", "dudareq");
    send(&mut duda, json!({"type":"SendChat","payload":{"channel_id":dm2,"content":"oi"}})).await;
    assert!(wait_for(&mut duda, "SendFailed").await["message"].as_str().unwrap().contains("amigos"));
    send(&mut duda, json!({"type":"SendFriendRequest","payload":{"target_username":"AnaReq"}})).await;
    assert_eq!(wait_for(&mut duda, "FriendFeedback").await["ok"], false);
    // A conversa já aceita com Caio continua funcionando.
    send(&mut caio, json!({"type":"SendChat","payload":{"channel_id":dm,"content":"ainda posso?","nonce":"n1"}})).await;
    loop {
        let m = wait_for(&mut ana, "NewChatMessage").await;
        if m["message"]["content"] == "ainda posso?" {
            break;
        }
    }

    // Valor desconhecido de política vira o padrão seguro.
    send(&mut ana, json!({"type":"UpdateUserPrefs","payload":{"privacy":{"dm_policy":"qualquer","friend_requests":"x"}}})).await;
    let prefs = wait_for(&mut ana, "UserPrefsUpdated").await;
    assert_eq!(prefs["prefs"]["privacy"]["dm_policy"], "requests");
}

#[tokio::test]
async fn ignore_request_hides_it() {
    let srv = start_server().await;
    let mut ana = user(&srv, "AnaIgn").await;
    let mut eli = user(&srv, "EliIgn").await;
    let dm = ServerState::make_dm_id("anaign", "eliign");
    send(&mut eli, json!({"type":"SendChat","payload":{"channel_id":dm,"content":"spam"}})).await;
    sync_until(&mut ana, |s| s["message_requests"].as_array().is_some_and(|l| l.len() == 1)).await;
    send(&mut ana, json!({"type":"IgnoreMessageRequest","payload":{"dm_id":dm}})).await;
    let s = sync_until(&mut ana, |s| s["message_requests"].as_array().is_some_and(|l| l.is_empty())).await;
    assert!(s["dm_conversations"].as_array().unwrap().iter().all(|c| c["dm_id"] != dm));
}

#[tokio::test]
async fn group_dm_lifecycle() {
    let srv = start_server().await;
    let mut dono = user(&srv, "DonoGrp").await;
    let mut m1 = user(&srv, "MembroUm").await;
    let mut m2 = user(&srv, "MembroDois").await;
    let mut fora = user(&srv, "ForaGrp").await;
    befriend(&mut dono, &mut m1, "MembroUm", "DonoGrp").await;
    befriend(&mut dono, &mut m2, "MembroDois", "DonoGrp").await;

    // Não-amigo não entra.
    send(&mut dono, json!({"type":"CreateGroupDm","payload":{"usernames":["MembroUm","ForaGrp"]}})).await;
    assert_eq!(feedback(&mut dono, "create_group").await["ok"], false);

    send(&mut dono, json!({"type":"CreateGroupDm","payload":{"usernames":["MembroUm","MembroDois"],"name":"  Turma  "}})).await;
    let gid = wait_for(&mut dono, "GroupDmOpened").await["group_id"].as_str().unwrap().to_string();
    assert!(gid.starts_with("gdm:"));
    let s = sync_until(&mut m1, |s| s["groups"].as_array().is_some_and(|g| !g.is_empty())).await;
    assert_eq!(s["groups"][0]["name"], "Turma");
    assert_eq!(s["groups"][0]["members"].as_array().unwrap().len(), 3);

    send(&mut m1, json!({"type":"SendChat","payload":{"channel_id":gid,"content":"oi turma @MembroDois"}})).await;
    loop {
        let m = wait_for(&mut m2, "NewChatMessage").await;
        if m["message"]["content"] == "oi turma @MembroDois" {
            break;
        }
    }
    send(&mut fora, json!({"type":"SendChat","payload":{"channel_id":gid,"content":"entrei?"}})).await;
    wait_for(&mut fora, "SendFailed").await;
    send(&mut fora, json!({"type":"JoinVoice","payload":{"channel_id":gid.replacen("gdm:", "gdmvoice:", 1)}})).await;
    assert_eq!(feedback(&mut fora, "join_voice").await["ok"], false);

    // Só o dono remove; membro comum não.
    send(&mut m1, json!({"type":"RemoveGroupDmMember","payload":{"group_id":gid,"username":"MembroDois"}})).await;
    assert_eq!(feedback(&mut m1, "remove_group_member").await["ok"], false);
    send(&mut dono, json!({"type":"RemoveGroupDmMember","payload":{"group_id":gid,"username":"MembroDois"}})).await;
    sync_until(&mut m2, |s| s["groups"].as_array().is_some_and(|g| g.is_empty())).await;
    send(&mut m2, json!({"type":"SendChat","payload":{"channel_id":gid,"content":"ainda aqui?"}})).await;
    wait_for(&mut m2, "SendFailed").await;

    // Dono sai: posse passa para o próximo.
    send(&mut dono, json!({"type":"LeaveGroupDm","payload":{"group_id":gid}})).await;
    let s = sync_until(&mut m1, |s| s["groups"][0]["members"].as_array().is_some_and(|m| m.len() == 1)).await;
    assert_eq!(s["groups"][0]["owner"], "membroum");

    // Persistência: o grupo sobrevive a reinício.
    {
        let db = srv.state.read().await.db.clone();
        db.flush();
        let reopened = db.load_group_dms().unwrap();
        assert_eq!(reopened[0].owner, "membroum");
        assert_eq!(reopened.len(), 1);
    }
    // Último sai: grupo e histórico apagados.
    send(&mut m1, json!({"type":"LeaveGroupDm","payload":{"group_id":gid}})).await;
    sync_until(&mut m1, |s| s["groups"].as_array().is_some_and(|g| g.is_empty())).await;
    let st = srv.state.read().await;
    assert!(st.group_dms.is_empty());
    assert!(!st.chat_history.contains_key(&gid));
}

#[tokio::test]
async fn profile_mutuals_and_reports() {
    let srv = start_server().await;
    let (mut ana, server, sid) = owner_with_server(&srv, "AnaPerfil", "friends").await;
    let (mut beto, _) = join_with(&srv, "BetoPerfil", server["invite_code"].as_str().unwrap()).await;
    let mut caio = user(&srv, "CaioPerfil").await;
    befriend(&mut ana, &mut caio, "CaioPerfil", "AnaPerfil").await;
    befriend(&mut beto, &mut caio, "CaioPerfil", "BetoPerfil").await;

    send(&mut ana, json!({"type":"GetUserProfile","payload":{"username":"BetoPerfil","server_id":sid}})).await;
    let p = wait_for(&mut ana, "UserProfile").await;
    assert_eq!(p["relationship"], "none");
    assert_eq!(p["mutual_servers"][0]["id"], sid);
    assert_eq!(names(&p["mutual_friends"]), vec!["caioperfil".to_string()]);
    assert!(p["joined_server_at"].as_i64().unwrap() > 0);

    // Quem não é do servidor não vê a data de entrada nele.
    send(&mut caio, json!({"type":"GetUserProfile","payload":{"username":"BetoPerfil","server_id":sid}})).await;
    let p = wait_for(&mut caio, "UserProfile").await;
    assert_eq!(p["relationship"], "friend");
    assert!(p["joined_server_at"].is_null());
    assert!(p["mutual_servers"].as_array().unwrap().is_empty());

    send(&mut ana, json!({"type":"ReportUser","payload":{"username":"BetoPerfil","reason":"   "}})).await;
    assert_eq!(feedback(&mut ana, "report_user").await["ok"], false);
    send(&mut ana, json!({"type":"ReportUser","payload":{"username":"BetoPerfil","reason":"spam"}})).await;
    assert_eq!(feedback(&mut ana, "report_user").await["ok"], true);
    let db = srv.state.read().await.db.clone();
    db.flush();
    assert_eq!(db.count_reports("betoperfil").unwrap(), 1);
}

#[tokio::test]
async fn profile_fields_and_custom_status_expiry() {
    let srv = start_server().await;
    let mut ana = user(&srv, "AnaStatus").await;
    send(&mut ana, json!({"type":"UpdateProfile","payload":{
        "display_name":"  Ana Lima  ","pronouns":"ela/dela",
        "custom_status":"estudando","custom_status_emoji":"📚","custom_status_expires_in":3600
    }})).await;
    let me = loop {
        let sync = wait_for(&mut ana, "VoiceStateSync").await;
        if let Some(u) = sync["users"].as_array().unwrap().iter().find(|u| u["username"] == "AnaStatus") {
            if u["custom_status"] == "estudando" {
                break u.clone();
            }
        }
    };
    assert_eq!(me["display_name"], "Ana Lima");
    assert_eq!(me["pronouns"], "ela/dela");
    assert_eq!(me["custom_status_emoji"], "📚");
    assert!(me["custom_status_expires_at"].as_i64().unwrap() > crate::auth::now_ms());

    // Vence o prazo e roda a limpeza periódica.
    {
        let mut st = srv.state.write().await;
        st.accounts.get_mut("anastatus").unwrap().custom_status_expires_at = Some(1);
    }
    crate::social::expire_statuses(&srv.state).await;
    let u = wait_for(&mut ana, "SelfUpdated").await;
    assert!(u["user"]["custom_status"].is_null());
    assert!(u["user"]["custom_status_emoji"].is_null());
    let st = srv.state.read().await;
    assert!(st.accounts.get("anastatus").unwrap().custom_status.is_none());
}
