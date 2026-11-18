//! Tags de fórum: definição pela moderação, aplicação nas postagens e limpeza.
use super::*;

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

async fn forum_tags(ws: &mut Ws, forum: &str) -> Vec<Value> {
    loop {
        let up = wait_for(ws, "ServerUpdated").await;
        let ch = up["server"]["text_channels"].as_array().unwrap().iter().find(|c| c["id"] == forum).cloned().unwrap();
        if ch["forum_tags"].as_array().is_some_and(|t| !t.is_empty()) {
            return ch["forum_tags"].as_array().unwrap().clone();
        }
    }
}

/// Espera a versão da thread que satisfaz `pred` (ThreadCreated/ThreadUpdated).
async fn thread_where(ws: &mut Ws, id: &str, pred: impl Fn(&Value) -> bool) -> Value {
    loop {
        let v = wait_for_any(ws, &["ThreadUpdated", "ThreadCreated"]).await;
        let t = &v["payload"]["thread"];
        if t["id"] == id && pred(t) {
            return t.clone();
        }
    }
}

#[tokio::test]
async fn forum_tags_are_managed_applied_and_pruned() {
    let srv = start_server().await;
    let (mut dona, server, sid) = owner_with_server(&srv, "DonaForum", "friends").await;
    let (mut membro, _) = join_with(&srv, "Postadora", server["invite_code"].as_str().unwrap()).await;
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();
    send(&mut dona, json!({"type":"CreateChannel","payload":{"server_id":sid,"name":"suporte","kind":"forum"}})).await;
    let forum = loop {
        let v = wait_for(&mut dona, "ChannelCreated").await;
        if v["channel"]["kind"] == "forum" {
            break v["channel"]["id"].as_str().unwrap().to_string();
        }
    };
    let set_tags = |tags: Value| json!({"type":"UpdateChannel","payload":{"server_id":sid,"channel_id":forum,"forum_tags":tags}});

    // Validação: canal comum, nome vazio, repetidos e o limite de 20.
    send(&mut dona, json!({"type":"UpdateChannel","payload":{"server_id":sid,"channel_id":geral,"forum_tags":[{"name":"x"}]}})).await;
    assert!(feedback(&mut dona, "update_channel").await["message"].as_str().unwrap().contains("fórum"));
    send(&mut dona, set_tags(json!([{"name":"   "}]))).await;
    assert!(feedback(&mut dona, "update_channel").await["message"].as_str().unwrap().contains("nome"));
    send(&mut dona, set_tags(json!([{"name":"Bug"},{"name":"bug"}]))).await;
    assert!(feedback(&mut dona, "update_channel").await["message"].as_str().unwrap().contains("mesmo nome"));
    let many: Vec<Value> = (0..21).map(|i| json!({"name": format!("t{i}")})).collect();
    send(&mut dona, set_tags(json!(many))).await;
    assert!(feedback(&mut dona, "update_channel").await["message"].as_str().unwrap().contains("20"));
    // Membro sem gerenciar canais não define tags.
    send(&mut membro, set_tags(json!([{"name":"Hack"}]))).await;
    assert_eq!(feedback(&mut membro, "update_channel").await["ok"], false);

    // Dona define três tags; o id vem do servidor e o texto é limpo.
    send(&mut dona, set_tags(json!([
        {"id":"inventado","name":"  Bug   crítico ","emoji":" 🐛 "},
        {"name":"Ideia","emoji":"💡"},
        {"name":"Resolvido","emoji":"✅","moderated":true}
    ]))).await;
    let tags = forum_tags(&mut membro, &forum).await;
    assert_eq!(tags.len(), 3);
    assert_eq!(tags[0]["name"], "Bug crítico");
    assert_eq!(tags[0]["emoji"], "🐛");
    assert_ne!(tags[0]["id"], "inventado", "id escolhido pelo cliente é ignorado");
    let (bug, ideia, resolvido) = (tags[0]["id"].as_str().unwrap().to_string(), tags[1]["id"].as_str().unwrap().to_string(), tags[2]["id"].as_str().unwrap().to_string());

    // Membro publica com tags comuns; a tag "só moderação" é recusada.
    send(&mut membro, json!({"type":"CreateThread","payload":{"channel_id":forum,"name":"Erro ao entrar","tags":[resolvido]}})).await;
    assert!(feedback(&mut membro, "create_thread").await["message"].as_str().unwrap().contains("moderação"));
    send(&mut membro, json!({"type":"CreateThread","payload":{"channel_id":forum,"name":"Erro ao entrar","tags":[ideia, bug, bug]}})).await;
    let post = wait_for(&mut membro, "ThreadCreated").await["thread"].clone();
    let pid = post["id"].as_str().unwrap().to_string();
    assert_eq!(post["tags"], json!([bug, ideia]), "sem repetição, na ordem do fórum");

    // Thread comum não tem tags; tag inexistente é recusada.
    send(&mut membro, json!({"type":"UpdateThread","payload":{"thread_id":pid,"tags":["tag-que-nao-existe"]}})).await;
    assert!(feedback(&mut membro, "update_thread").await["message"].as_str().unwrap().contains("não existe"));

    // A moderação marca como resolvido; a autora não consegue tirar essa tag.
    send(&mut dona, json!({"type":"UpdateThread","payload":{"thread_id":pid,"tags":[bug, resolvido]}})).await;
    thread_where(&mut membro, &pid, |t| t["tags"] == json!([bug, resolvido])).await;
    send(&mut membro, json!({"type":"UpdateThread","payload":{"thread_id":pid,"tags":[bug]}})).await;
    assert!(feedback(&mut membro, "update_thread").await["message"].as_str().unwrap().contains("moderação"));
    // Mas pode trocar as tags comuns mantendo a da moderação.
    send(&mut membro, json!({"type":"UpdateThread","payload":{"thread_id":pid,"tags":[ideia, resolvido]}})).await;
    thread_where(&mut membro, &pid, |t| t["tags"] == json!([ideia, resolvido])).await;

    // Remover a tag "Ideia" do fórum tira ela da postagem; ids mantidos preservam as demais.
    send(&mut dona, set_tags(json!([
        {"id":bug,"name":"Bug crítico","emoji":"🐛"},
        {"id":resolvido,"name":"Resolvido","emoji":"✅","moderated":true}
    ]))).await;
    thread_where(&mut membro, &pid, |t| t["tags"] == json!([resolvido])).await;

    // Persistência: tags do fórum e da postagem sobrevivem a reinício.
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let s = st.find_server(&sid).unwrap();
    assert_eq!(s.find_channel(&forum).unwrap().forum_tags.len(), 2);
    assert_eq!(s.thread(&pid).unwrap().tags, vec![resolvido.clone()]);
    drop(st);

    // Auditoria lista os nomes.
    send(&mut dona, json!({"type":"GetAuditLog","payload":{"server_id":sid,"action":"channel_update"}})).await;
    let log = wait_for(&mut dona, "AuditLog").await;
    assert!(log["entries"].as_array().unwrap().iter().any(|e| e["details"] == "tags: Bug crítico, Resolvido"), "{log}");
}

#[test]
fn post_tags_rules_without_network() {
    use crate::models::{Channel, ChannelKind, ForumTag};
    use crate::threads::validate_post_tags;
    let tag = |id: &str, moderated: bool| ForumTag { id: id.into(), name: id.into(), emoji: None, moderated };
    let mut forum = Channel::new("f", "f", ChannelKind::Forum);
    forum.forum_tags = vec![tag("a", false), tag("b", false), tag("c", false), tag("d", false), tag("e", false), tag("f", false), tag("m", true)];
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert!(validate_post_tags(&forum, &ids(&["a", "b", "c", "d", "e", "f"]), &[], false).is_err(), "mais de 5");
    assert_eq!(validate_post_tags(&forum, &ids(&["m", "a"]), &[], true).unwrap(), ids(&["a", "m"]), "moderação aplica");
    assert!(validate_post_tags(&forum, &ids(&["m"]), &[], false).is_err());
    let text = Channel::new("t", "t", ChannelKind::Text);
    assert!(validate_post_tags(&text, &[], &[], false).unwrap().is_empty());
    assert!(validate_post_tags(&text, &ids(&["a"]), &[], false).is_err(), "thread comum sem tags");
}
