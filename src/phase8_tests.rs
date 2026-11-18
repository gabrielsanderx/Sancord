//! Fase 8 — auditoria persistida, AutoMod e busca no histórico completo.
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

async fn audit(ws: &mut Ws, sid: &str, action: Option<&str>) -> Value {
    send(ws, json!({"type":"GetAuditLog","payload":{"server_id":sid,"action":action}})).await;
    wait_for(ws, "AuditLog").await
}

fn actions(log: &Value) -> Vec<String> {
    log["entries"].as_array().unwrap().iter().map(|e| e["action"].as_str().unwrap().to_string()).collect()
}

/// Envia e espera a confirmação (eco) ou a recusa da mensagem.
async fn send_chat(ws: &mut Ws, channel: &str, content: &str) -> Value {
    loop {
        let nonce = uuid::Uuid::new_v4().to_string();
        send(ws, json!({"type":"SendChat","payload":{"channel_id":channel,"content":content,"nonce":nonce}})).await;
        let v = loop {
            let v = wait_for_any(ws, &["NewChatMessage", "SendFailed"]).await;
            let p = &v["payload"];
            if p["nonce"] == nonce.as_str() || p["message"]["nonce"] == nonce.as_str() {
                break v;
            }
        };
        // O limitador anti-flood (8 a cada 5 s) não é o que está sendo testado aqui.
        if v["type"] == "SendFailed" && v["payload"]["message"].as_str().unwrap_or("").contains("rápido demais") {
            tokio::time::sleep(Duration::from_millis(700)).await;
            continue;
        }
        return v;
    }
}

#[tokio::test]
async fn audit_log_records_actions_and_requires_permission() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaAudit", "friends").await;
    let code = server["invite_code"].as_str().unwrap();
    let (mut membro, _) = join_with(&srv, "MembroAudit", code).await;
    let (_alvo, _) = join_with(&srv, "AlvoAudit", code).await;

    let role = create_role(&mut dono, &sid, "Auditor", json!({"view_audit_log": true})).await;
    send(&mut dono, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"logs","kind":"text"}})).await;
    wait_for(&mut dono, "ChannelCreated").await;
    send(&mut dono, json!({"type":"KickServerMember","payload":{"server_id":sid,"target_username":"AlvoAudit"}})).await;

    // Sem permissão.
    send(&mut membro, json!({"type":"GetAuditLog","payload":{"server_id":sid}})).await;
    assert_eq!(feedback(&mut membro, "audit_log").await["ok"], false);

    let mut log = audit(&mut dono, &sid, None).await;
    for _ in 0..20 {
        if actions(&log).contains(&"member_kick".to_string()) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        log = audit(&mut dono, &sid, None).await;
    }
    let acts = actions(&log);
    for expected in ["role_create", "channel_create", "member_kick"] {
        assert!(acts.contains(&expected.to_string()), "faltou {expected}: {acts:?}");
    }
    let kick = log["entries"].as_array().unwrap().iter().find(|e| e["action"] == "member_kick").unwrap();
    assert_eq!(kick["actor"], "donaaudit");
    assert_eq!(kick["target"], "alvoaudit");
    // Mais recente primeiro.
    assert_eq!(acts[0], "member_kick");

    // Filtro por ação e permissão concedida por cargo.
    let only = audit(&mut dono, &sid, Some("role_create")).await;
    assert!(actions(&only).iter().all(|a| a == "role_create"));
    send(&mut dono, json!({"type":"AssignUserRoles","payload":{"server_id":sid,"target_username":"MembroAudit","role_ids":[role]}})).await;
    loop {
        let up = wait_for(&mut membro, "ServerUpdated").await;
        if up["server"]["member_roles"]["membroaudit"].as_array().is_some_and(|r| !r.is_empty()) {
            break;
        }
    }
    let seen = audit(&mut membro, &sid, None).await;
    assert!(actions(&seen).contains(&"member_roles".to_string()));
}

#[tokio::test]
async fn automod_blocks_rules_alerts_and_exempts_moderators() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaMod", "friends").await;
    let (mut membro, _) = join_with(&srv, "MembroMod", server["invite_code"].as_str().unwrap()).await;
    let (_terceiro, _) = join_with(&srv, "TerceiroMod", server["invite_code"].as_str().unwrap()).await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    let alertas = server["text_channels"].as_array().unwrap().last().unwrap()["id"].as_str().unwrap().to_string();

    // Só quem gerencia o servidor configura.
    send(&mut membro, json!({"type":"UpdateAutoMod","payload":{"server_id":sid,"config":{"enabled":true}}})).await;
    assert_eq!(feedback(&mut membro, "automod").await["ok"], false);

    send(&mut dono, json!({"type":"UpdateAutoMod","payload":{"server_id":sid,"config":{
        "enabled":true, "blocked_words":["Palavrão","spam*"," "], "block_links":true,
        "allowed_domains":["https://www.Exemplo.com/caminho"], "block_invites":true, "max_mentions":1,
        "block_repeats":true, "alert_channel_id":alertas
    }}})).await;
    let cfg = wait_for(&mut dono, "AutoModSettings").await;
    assert_eq!(cfg["config"]["blocked_words"], json!(["palavrao", "spam*"]));
    assert_eq!(cfg["config"]["allowed_domains"], json!(["exemplo.com"]));

    let blocked = |v: &Value| v["type"] == "SendFailed";
    assert!(blocked(&send_chat(&mut membro, &geral, "isso é um PALAVRÃO!").await));
    assert!(blocked(&send_chat(&mut membro, &geral, "compre spammers baratos").await));
    assert!(!blocked(&send_chat(&mut membro, &geral, "palavra normal, sem problema").await));
    assert!(blocked(&send_chat(&mut membro, &geral, "veja https://golpe.net/x").await));
    assert!(!blocked(&send_chat(&mut membro, &geral, "doc em https://docs.exemplo.com/a").await));
    assert!(blocked(&send_chat(&mut membro, &geral, "entra lá: SANC-ABCD12").await));
    assert!(blocked(&send_chat(&mut membro, &geral, "@DonaMod @TerceiroMod").await));
    assert!(!blocked(&send_chat(&mut membro, &geral, "oi @DonaMod").await));
    let r = send_chat(&mut membro, &geral, "repetida").await;
    assert!(!blocked(&r), "{r}");
    assert!(!blocked(&send_chat(&mut membro, &geral, "repetida").await));
    assert!(blocked(&send_chat(&mut membro, &geral, "  REPETIDA ").await));

    // Dono é isento.
    assert!(!blocked(&send_chat(&mut dono, &geral, "palavrão do dono https://golpe.net").await));

    // Nada bloqueado chegou ao histórico; o canal de alertas recebeu avisos.
    {
        let st = srv.state.read().await;
        let hist = st.chat_history.get(&geral).cloned().unwrap_or_default();
        assert!(!hist.iter().any(|m| m.content.to_lowercase().contains("palavrão") && m.author_name == "MembroMod"));
        let alerts = st.chat_history.get(&alertas).cloned().unwrap_or_default();
        assert!(alerts.iter().filter(|m| m.author_name == "AutoMod").count() >= 5);
    }
    let log = audit(&mut dono, &sid, Some("automod_block")).await;
    assert!(log["entries"].as_array().unwrap().len() >= 5);

    // Editar para conteúdo proibido também é barrado.
    let ok = send_chat(&mut membro, &geral, "texto limpo").await;
    let mid = ok["payload"]["message"]["id"].as_str().unwrap().to_string();
    send(&mut membro, json!({"type":"EditChat","payload":{"channel_id":geral,"message_id":mid,"content":"agora com palavrao"}})).await;
    assert_eq!(feedback(&mut membro, "edit_chat").await["ok"], false);

    // Persistência.
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    assert!(reopened.read().await.find_server(&sid).unwrap().automod.enabled);
}

async fn search(ws: &mut Ws, payload: Value) -> Value {
    send(ws, json!({"type":"SearchMessages","payload":payload})).await;
    wait_for(ws, "SearchResults").await
}

#[tokio::test]
async fn search_finds_history_with_filters_and_respects_access() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaBusca", "friends").await;
    let (mut membro, _) = join_with(&srv, "MembroBusca", server["invite_code"].as_str().unwrap()).await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();

    // Canal privado que o membro não vê.
    send(&mut dono, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"diretoria","kind":"text",
        "overwrites":[{"target_type":"role","target_id":"everyone","permissions":{"view_channel":false}}],"permissions_synced":false}})).await;
    let secreto = wait_for(&mut dono, "ChannelCreated").await["channel"]["id"].as_str().unwrap().to_string();

    send_chat(&mut dono, &geral, "Relatório trimestral pronto https://exemplo.com/r").await;
    send_chat(&mut membro, &geral, "vou ler o relatorio amanhã").await;
    send_chat(&mut dono, &secreto, "relatório secreto da diretoria").await;
    send_chat(&mut membro, &geral, "assunto diferente").await;


    let contents = |r: &Value| -> Vec<String> {
        r["hits"].as_array().unwrap().iter().map(|h| h["message"]["content"].as_str().unwrap().to_string()).collect()
    };

    // Sem acento, por prefixo, no servidor inteiro: o membro não vê o canal privado.
    let r = search(&mut membro, json!({"query":"relat","server_id":sid,"request_id":"a"})).await;
    assert_eq!(r["request_id"], "a");
    let c = contents(&r);
    assert_eq!(c.len(), 2, "{c:?}");
    assert!(!c.iter().any(|x| x.contains("secreto")));
    assert_eq!(r["hits"][0]["channel_name"], server["text_channels"][0]["name"]);
    // A dona vê também o privado.
    assert_eq!(contents(&search(&mut dono, json!({"query":"relatorio"})).await).len(), 3);

    // Filtros.
    let by_author = contents(&search(&mut membro, json!({"query":"relatorio","author":"@MembroBusca"})).await);
    assert_eq!(by_author, vec!["vou ler o relatorio amanhã".to_string()]);
    let with_link = contents(&search(&mut membro, json!({"query":"","has":"link","server_id":sid})).await);
    assert_eq!(with_link.len(), 1);
    // Operadores FTS no texto não quebram a busca.
    let weird = search(&mut membro, json!({"query":"relatorio\" OR NEAR(*"})).await;
    assert!(weird["hits"].as_array().is_some());
    // Pedir explicitamente o canal privado não vaza nada.
    assert!(contents(&search(&mut membro, json!({"query":"secreto","channel_id":secreto})).await).is_empty());
    // Busca vazia não varre tudo.
    assert!(contents(&search(&mut membro, json!({"query":"  "})).await).is_empty());

    // Editar atualiza o índice; excluir remove.
    let sent = send_chat(&mut membro, &geral, "girassol amarelo").await;
    let mid = sent["payload"]["message"]["id"].as_str().unwrap().to_string();
    send(&mut membro, json!({"type":"EditChat","payload":{"channel_id":geral,"message_id":mid,"content":"orquídea roxa"}})).await;
    wait_for(&mut membro, "MessageUpdated").await;
    assert!(contents(&search(&mut membro, json!({"query":"girassol"})).await).is_empty());
    assert_eq!(contents(&search(&mut membro, json!({"query":"orquidea"})).await), vec!["orquídea roxa".to_string()]);
    send(&mut membro, json!({"type":"DeleteChat","payload":{"channel_id":geral,"message_id":mid}})).await;
    wait_for(&mut membro, "MessageDeleted").await;
    assert!(contents(&search(&mut membro, json!({"query":"orquidea"})).await).is_empty());
}

#[test]
fn automod_normalization_and_search_terms() {
    use crate::moderation::{normalize, search_terms};
    assert_eq!(normalize("AÇÃO Ébano"), "acao ebano");
    assert_eq!(search_terms("olá, \"mundo\" OR *x*"), vec!["olá", "mundo", "or", "x"]);
    assert_eq!(crate::db::fts_query(&["a\"b".into(), "c".into()]), "\"ab\"* \"c\"*");
}

// ---------------------------------------------------------------------------
// Enquetes e eventos
// ---------------------------------------------------------------------------

async fn send_poll(ws: &mut Ws, channel: &str, poll: Value) -> Value {
    let nonce = uuid::Uuid::new_v4().to_string();
    send(ws, json!({"type":"SendChat","payload":{"channel_id":channel,"content":"","nonce":nonce,"poll":poll}})).await;
    loop {
        let v = wait_for_any(ws, &["NewChatMessage", "SendFailed"]).await;
        let p = &v["payload"];
        if p["nonce"] == nonce.as_str() || p["message"]["nonce"] == nonce.as_str() {
            return v;
        }
    }
}

async fn poll_update(ws: &mut Ws, mid: &str) -> Value {
    loop {
        let up = wait_for(ws, "MessageUpdated").await;
        if up["message"]["id"] == mid {
            return up["message"]["poll"].clone();
        }
    }
}

#[tokio::test]
async fn polls_vote_change_close_and_persist() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaPoll", "friends").await;
    let (mut membro, _) = join_with(&srv, "MembroPoll", server["invite_code"].as_str().unwrap()).await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();

    // Validação.
    let bad = send_poll(&mut membro, &geral, json!({"question":"Só uma?","options":["A","a"," "]})).await;
    assert_eq!(bad["type"], "SendFailed");

    let sent = send_poll(&mut membro, &geral, json!({"question":"  Onde jogamos?  ","options":["Casa","Online","Casa"],"duration_hours":2})).await;
    assert_eq!(sent["type"], "NewChatMessage");
    let msg = &sent["payload"]["message"];
    let mid = msg["id"].as_str().unwrap().to_string();
    assert_eq!(msg["content"], "Onde jogamos?");
    assert_eq!(msg["poll"]["options"].as_array().unwrap().len(), 2);
    assert!(msg["poll"]["expires_at"].as_i64().unwrap() > crate::auth::now_ms());

    // Voto único: duas opções é recusado; trocar de voto substitui.
    send(&mut dono, json!({"type":"VotePoll","payload":{"channel_id":geral,"message_id":mid,"option_ids":["o1","o2"]}})).await;
    let fb = loop {
        let f = wait_for(&mut dono, "ServerFeedback").await;
        if f["action"] == "vote_poll" { break f; }
    };
    assert_eq!(fb["ok"], false);
    send(&mut dono, json!({"type":"VotePoll","payload":{"channel_id":geral,"message_id":mid,"option_ids":["o1"]}})).await;
    assert_eq!(poll_update(&mut membro, &mid).await["votes"]["o1"], json!(["donapoll"]));
    send(&mut dono, json!({"type":"VotePoll","payload":{"channel_id":geral,"message_id":mid,"option_ids":["o2","x9"]}})).await;
    let p = poll_update(&mut membro, &mid).await;
    assert!(p["votes"]["o1"].is_null());
    assert_eq!(p["votes"]["o2"], json!(["donapoll"]));

    // Só autor/moderação encerra; depois disso não há voto.
    send(&mut membro, json!({"type":"ClosePoll","payload":{"channel_id":geral,"message_id":mid}})).await;
    while poll_update(&mut dono, &mid).await["closed"] != true {}
    send(&mut dono, json!({"type":"VotePoll","payload":{"channel_id":geral,"message_id":mid,"option_ids":["o1"]}})).await;
    let fb = loop {
        let f = wait_for(&mut dono, "ServerFeedback").await;
        if f["action"] == "vote_poll" { break f; }
    };
    assert_eq!(fb["ok"], false);

    // Persistência dos votos.
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let saved = st.chat_history[&geral].iter().find(|m| m.id == mid).unwrap();
    let poll = saved.poll.as_ref().unwrap();
    assert!(poll.closed);
    assert_eq!(poll.votes["o2"], vec!["donapoll".to_string()]);
    drop(st);
    let _ = sid;
}

#[tokio::test]
async fn automod_also_checks_poll_options() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaPollMod", "friends").await;
    let (mut membro, _) = join_with(&srv, "MembroPollMod", server["invite_code"].as_str().unwrap()).await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    send(&mut dono, json!({"type":"UpdateAutoMod","payload":{"server_id":sid,"config":{"enabled":true,"blocked_words":["proibido"]}}})).await;
    wait_for(&mut dono, "AutoModSettings").await;
    let r = send_poll(&mut membro, &geral, json!({"question":"Qual?","options":["normal","PROIBIDO"]})).await;
    assert_eq!(r["type"], "SendFailed");
}

#[tokio::test]
async fn events_create_rsvp_permissions_and_persist() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaEvento", "friends").await;
    let (mut membro, _) = join_with(&srv, "MembroEvento", server["invite_code"].as_str().unwrap()).await;
    let voz = server["voice_channels"][0]["id"].as_str().unwrap().to_string();
    let start = crate::auth::now_ms() + 3_600_000;

    // Membro comum não cria; passado e fim antes do início são recusados.
    send(&mut membro, json!({"type":"SaveEvent","payload":{"server_id":sid,"title":"Noite de jogos","starts_at":start}})).await;
    let fb = loop { let f = wait_for(&mut membro, "ServerFeedback").await; if f["action"] == "save_event" { break f; } };
    assert_eq!(fb["ok"], false);
    send(&mut dono, json!({"type":"SaveEvent","payload":{"server_id":sid,"title":"Ontem","starts_at":start - 7_200_000 * 2}})).await;
    let fb = loop { let f = wait_for(&mut dono, "ServerFeedback").await; if f["action"] == "save_event" { break f; } };
    assert_eq!(fb["ok"], false);

    send(&mut dono, json!({"type":"SaveEvent","payload":{"server_id":sid,"title":"Noite de jogos","description":"Traga petiscos",
        "channel_id":voz,"starts_at":start,"ends_at":start + 7_200_000}})).await;
    let list = wait_for(&mut membro, "ServerEvents").await;
    let ev = &list["events"][0];
    let eid = ev["id"].as_str().unwrap().to_string();
    assert_eq!(ev["title"], "Noite de jogos");
    assert_eq!(ev["channel_id"], voz);
    assert_eq!(ev["interested"], json!(["donaevento"]));

    send(&mut membro, json!({"type":"SetEventInterest","payload":{"server_id":sid,"event_id":eid,"interested":true}})).await;
    loop {
        let l = wait_for(&mut dono, "ServerEvents").await;
        if l["events"][0]["interested"].as_array().unwrap().len() == 2 { break; }
    }
    // Membro não exclui evento de outra pessoa.
    send(&mut membro, json!({"type":"DeleteEvent","payload":{"server_id":sid,"event_id":eid}})).await;
    let fb = loop { let f = wait_for(&mut membro, "ServerFeedback").await; if f["action"] == "delete_event" { break f; } };
    assert_eq!(fb["ok"], false);

    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    assert_eq!(reopened.read().await.events[&sid][0].interested.len(), 2);

    send(&mut dono, json!({"type":"DeleteEvent","payload":{"server_id":sid,"event_id":eid}})).await;
    loop {
        let l = wait_for(&mut membro, "ServerEvents").await;
        if l["events"].as_array().unwrap().is_empty() { break; }
    }
    send(&mut dono, json!({"type":"GetAuditLog","payload":{"server_id":sid}})).await;
    let log = wait_for(&mut dono, "AuditLog").await;
    let acts: Vec<String> = log["entries"].as_array().unwrap().iter().map(|e| e["action"].as_str().unwrap().to_string()).collect();
    assert!(acts.contains(&"event_create".to_string()) || acts.contains(&"event_delete".to_string()), "{acts:?}");
}
// ---------------------------------------------------------------------------
// Threads e fóruns
// ---------------------------------------------------------------------------

async fn fb_of(ws: &mut Ws, action: &str) -> Value {
    loop {
        let f = wait_for(ws, "ServerFeedback").await;
        if f["action"] == action {
            return f;
        }
    }
}

async fn thread_where(ws: &mut Ws, id: &str, cond: impl Fn(&Value) -> bool) -> Value {
    loop {
        let up = wait_for(ws, "ThreadUpdated").await;
        if up["thread"]["id"] == id && cond(&up["thread"]) {
            return up["thread"].clone();
        }
    }
}

#[tokio::test]
async fn threads_inherit_permissions_track_activity_and_lock() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaThread", "friends").await;
    let (mut membro, _) = join_with(&srv, "MembroThread", server["invite_code"].as_str().unwrap()).await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();

    let base = send_chat(&mut membro, &geral, "Vamos discutir o torneio de sábado").await;
    let base_id = base["payload"]["message"]["id"].as_str().unwrap().to_string();
    send(&mut membro, json!({"type":"CreateThread","payload":{"channel_id":geral,"name":"  ","message_id":base_id}})).await;
    let th = wait_for(&mut membro, "ThreadCreated").await["thread"].clone();
    let tid = th["id"].as_str().unwrap().to_string();
    assert_eq!(th["name"], "Vamos discutir o torneio de sábado");
    assert_eq!(th["starter_message_id"], base_id);
    assert_eq!(th["parent_id"], geral);
    thread_where(&mut dono, &tid, |_| true).await;

    // Uma thread por mensagem; nada de thread dentro de thread.
    send(&mut dono, json!({"type":"CreateThread","payload":{"channel_id":geral,"name":"outra","message_id":base_id}})).await;
    assert_eq!(fb_of(&mut dono, "create_thread").await["ok"], false);
    send(&mut dono, json!({"type":"CreateThread","payload":{"channel_id":tid,"name":"aninhada"}})).await;
    assert_eq!(fb_of(&mut dono, "create_thread").await["ok"], false);

    // Conversa na thread: chega a quem vê o canal-pai e conta atividade.
    assert_eq!(send_chat(&mut dono, &tid, "Eu levo o controle extra").await["type"], "NewChatMessage");
    thread_where(&mut membro, &tid, |t| t["message_count"] == 1).await;
    loop {
        let m = wait_for(&mut membro, "NewChatMessage").await;
        if m["message"]["channel_id"] == tid.as_str() { break; }
    }
    send(&mut membro, json!({"type":"LoadMessages","payload":{"channel_id":tid}})).await;
    let page = wait_for(&mut membro, "MessagesPage").await;
    assert_eq!(page["messages"].as_array().unwrap().len(), 1);

    // Arquivar (dono da thread) e nova mensagem desarquiva.
    send(&mut membro, json!({"type":"UpdateThread","payload":{"thread_id":tid,"archived":true}})).await;
    thread_where(&mut membro, &tid, |t| t["archived"] == true).await;
    send_chat(&mut membro, &tid, "voltei").await;
    eventually_state(&srv, |st| st.find_server(&sid).unwrap().thread(&tid).is_some_and(|t| !t.archived && t.message_count == 2)).await;

    // Trancar é só da moderação; trancada, o membro não escreve.
    send(&mut membro, json!({"type":"UpdateThread","payload":{"thread_id":tid,"locked":true}})).await;
    assert_eq!(fb_of(&mut membro, "update_thread").await["ok"], false);
    send(&mut dono, json!({"type":"UpdateThread","payload":{"thread_id":tid,"locked":true}})).await;
    eventually_state(&srv, |st| st.find_server(&sid).unwrap().thread(&tid).is_some_and(|t| t.locked)).await;
    assert_eq!(send_chat(&mut membro, &tid, "posso?").await["type"], "SendFailed");
    assert_eq!(send_chat(&mut dono, &tid, "moderação pode").await["type"], "NewChatMessage");

    // Thread em canal privado não vaza.
    send(&mut dono, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"staff","kind":"text",
        "overwrites":[{"target_type":"role","target_id":"everyone","permissions":{"view_channel":false}}],"permissions_synced":false}})).await;
    let staff = wait_for(&mut dono, "ChannelCreated").await["channel"]["id"].as_str().unwrap().to_string();
    send(&mut dono, json!({"type":"CreateThread","payload":{"channel_id":staff,"name":"segredo"}})).await;
    let secret = wait_for(&mut dono, "ThreadCreated").await["thread"]["id"].as_str().unwrap().to_string();
    send(&mut membro, json!({"type":"ListThreads","payload":{"server_id":sid}})).await;
    let list = wait_for(&mut membro, "ThreadList").await;
    let ids: Vec<&str> = list["threads"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&tid.as_str()));
    assert!(!ids.contains(&secret.as_str()));
    assert_eq!(send_chat(&mut membro, &secret, "entrei?").await["type"], "SendFailed");
    send(&mut membro, json!({"type":"LoadMessages","payload":{"channel_id":secret}})).await;
    assert_eq!(fb_of(&mut membro, "load_messages").await["ok"], false);

    // Excluir o canal-pai leva as threads junto.
    send(&mut dono, json!({"type":"DeleteChannel","payload":{"server_id":sid,"channel_id":staff}})).await;
    eventually_state(&srv, |st| st.find_server(&sid).unwrap().thread(&secret).is_none() && !st.chat_history.contains_key(&secret)).await;
}

async fn eventually_state(srv: &TestServer, cond: impl Fn(&crate::state::ServerState) -> bool) {
    for _ in 0..60 {
        if cond(&*srv.state.read().await) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("condição não atingida");
}

#[tokio::test]
async fn forum_posts_are_threads_and_persist() {
    let srv = start_server().await;
    let (mut dono, server, sid) = owner_with_server(&srv, "DonaForum", "friends").await;
    let (mut membro, _) = join_with(&srv, "MembroForum", server["invite_code"].as_str().unwrap()).await;
    send(&mut dono, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"Sugestões","kind":"forum"}})).await;
    let forum = wait_for(&mut dono, "ChannelCreated").await["channel"].clone();
    assert_eq!(forum["kind"], "forum");
    let fid = forum["id"].as_str().unwrap().to_string();

    // Não se escreve direto no fórum; postagem não parte de mensagem.
    let direct = send_chat(&mut membro, &fid, "oi fórum").await;
    assert_eq!(direct["type"], "SendFailed");
    assert!(direct["payload"]["message"].as_str().unwrap().contains("postagem"));
    send(&mut membro, json!({"type":"CreateThread","payload":{"channel_id":fid,"name":"x","message_id":"m1"}})).await;
    assert_eq!(fb_of(&mut membro, "create_thread").await["ok"], false);

    send(&mut membro, json!({"type":"CreateThread","payload":{"channel_id":fid,"name":"Adicionar modo escuro azul"}})).await;
    let post = wait_for(&mut membro, "ThreadCreated").await["thread"].clone();
    let pid = post["id"].as_str().unwrap().to_string();
    assert!(post["starter_message_id"].is_null());
    assert_eq!(send_chat(&mut membro, &pid, "Seria ótimo para jogar à noite").await["type"], "NewChatMessage");

    // A busca encontra o texto da postagem e nomeia a thread.
    send(&mut dono, json!({"type":"SearchMessages","payload":{"query":"noite","server_id":sid}})).await;
    let r = wait_for(&mut dono, "SearchResults").await;
    assert_eq!(r["hits"][0]["channel_name"], "🧵 Adicionar modo escuro azul");

    // Persistência.
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    {
        let st = reopened.read().await;
        let t = st.find_server(&sid).unwrap().thread(&pid).cloned().unwrap();
        assert_eq!(t.parent_id, fid);
        assert_eq!(t.message_count, 1);
    }

    // Autor exclui a própria postagem: some e o histórico vai junto.
    send(&mut membro, json!({"type":"DeleteThread","payload":{"thread_id":pid}})).await;
    let gone = wait_for(&mut dono, "ThreadDeleted").await;
    assert_eq!(gone["thread_id"], pid);
    eventually_state(&srv, |st| !st.chat_history.contains_key(&pid)).await;
}