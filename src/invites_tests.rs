use super::*;
use std::collections::HashSet;

async fn preview_http(srv: &TestServer, code: &str, bearer: Option<&str>) -> (u16, Value) {
    let mut builder = axum::http::Request::get(format!("/api/invites/{code}"));
    if let Some(tok) = bearer {
        builder = builder.header("authorization", format!("Bearer {tok}"));
    }
    let req = builder.body(axum::body::Body::empty()).unwrap();
    let res = srv.router.clone().oneshot(req).await.unwrap();
    let status = res.status().as_u16();
    let body: Value = serde_json::from_slice(&axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap()).unwrap();
    (status, body)
}

#[tokio::test]
async fn invite_codes_have_high_entropy_and_never_reuse_revoked_codes() {
    let srv = start_server().await;
    let (mut owner, _server, sid) = owner_with_server(&srv, "Entropia", "friends").await;

    // 50 códigos gerados possuem alta entropia (SANC- + 8 chars Base32 sem ambiguidade) e são todos únicos.
    let mut seen = HashSet::new();
    {
        let st = srv.state.read().await;
        for _ in 0..50 {
            let code = st.generate_invite_code();
            assert!(code.starts_with("SANC-"), "prefixo preservado: {code}");
            assert_eq!(code.len(), 13, "SANC- + 8 caracteres: {code}");
            assert!(
                code[5..].chars().all(|c| "23456789ABCDEFGHJKMNPQRSTUVWXYZ".contains(c)),
                "sem caracteres ambíguos: {code}"
            );
            assert!(seen.insert(code), "código duplicado");
        }
    }

    // Revogação mantém tombstone: código não pode ser reutilizado e retorna erro claro.
    send(&mut owner, json!({"type": "CreateInvite", "payload": {"server_id": sid}})).await;
    let code = wait_for(&mut owner, "InviteCreated").await["invite"]["code"]
        .as_str()
        .unwrap()
        .to_string();

    send(&mut owner, json!({"type": "RevokeInvite", "payload": {"server_id": sid, "code": code}})).await;
    let list = wait_for(&mut owner, "InvitesList").await;
    assert!(list["invites"].as_array().unwrap().iter().all(|i| i["code"] != code.as_str()));

    {
        let st = srv.state.read().await;
        let tomb = st.invites.get(&code.to_uppercase()).expect("tombstone mantido");
        assert!(tomb.revoked_at.is_some());
        assert_eq!(tomb.revoked_by.as_deref(), Some("entropia"));
    }

    let (status, body) = preview_http(&srv, &code, None).await;
    assert_eq!(status, 410);
    assert_eq!(body["ok"], false);
    assert_eq!(body["error_kind"], "revoked");
    assert!(body["message"].as_str().unwrap().contains("não é mais válido"));

    let (_guest, reply) = join_with(&srv, "ConvidadoRev", &code).await;
    assert_eq!(reply["type"], "ServerFeedback");
    assert!(reply["payload"]["message"].as_str().unwrap().contains("não é mais válido"));
}

#[tokio::test]
async fn invite_pause_and_resume_blocks_and_restores_without_losing_expiry() {
    let srv = start_server().await;
    let (mut owner, _server, sid) = owner_with_server(&srv, "Pausadora", "friends").await;

    send(&mut owner, json!({"type": "CreateInvite", "payload": {"server_id": sid, "max_age_secs": 3600}})).await;
    let active_code = wait_for(&mut owner, "InviteCreated").await["invite"]["code"]
        .as_str()
        .unwrap()
        .to_string();

    send(&mut owner, json!({"type": "CreateInvite", "payload": {"server_id": sid, "max_age_secs": 3600}})).await;
    let expiring_code = wait_for(&mut owner, "InviteCreated").await["invite"]["code"]
        .as_str()
        .unwrap()
        .to_string();

    // Pausa convites.
    send(&mut owner, json!({"type": "SetInvitesPaused", "payload": {"server_id": sid, "paused": true}})).await;
    let list = wait_for(&mut owner, "InvitesList").await;
    assert_eq!(list["invites_paused"], true);

    // Prévia e entrada ficam bloqueadas enquanto pausado.
    let (status, body) = preview_http(&srv, &active_code, None).await;
    assert_eq!(status, 403);
    assert_eq!(body["error_kind"], "paused");
    let (_g1, reply1) = join_with(&srv, "Pausado1", &active_code).await;
    assert_eq!(reply1["type"], "ServerFeedback");
    assert!(reply1["payload"]["message"].as_str().unwrap().contains("pausados"));

    // Simula um dos convites expirando enquanto estava pausado.
    srv.state.write().await.invites.get_mut(&expiring_code).unwrap().expires_at = Some(1);

    // Retoma convites: convite ainda válido volta a funcionar; vencido continua vencido.
    send(&mut owner, json!({"type": "SetInvitesPaused", "payload": {"server_id": sid, "paused": false}})).await;
    let list2 = wait_for(&mut owner, "InvitesList").await;
    assert_eq!(list2["invites_paused"], false);

    let (_g2, reply2) = join_with(&srv, "RetomadoOk", &active_code).await;
    assert_eq!(reply2["type"], "ServerCreated");

    let (_g3, reply3) = join_with(&srv, "RetomadoExp", &expiring_code).await;
    assert_eq!(reply3["type"], "ServerFeedback");
    assert!(reply3["payload"]["message"].as_str().unwrap().contains("expirou"));
}

#[tokio::test]
async fn invite_max_uses_atomic_concurrency_allows_only_one_joiner() {
    let srv = start_server().await;
    let (mut owner, _server, sid) = owner_with_server(&srv, "Atomico", "friends").await;

    send(&mut owner, json!({"type": "CreateInvite", "payload": {"server_id": sid, "max_uses": 1}})).await;
    let code = wait_for(&mut owner, "InviteCreated").await["invite"]["code"]
        .as_str()
        .unwrap()
        .to_string();

    let t1 = register(&srv, "Corrida1").await;
    let t2 = register(&srv, "Corrida2").await;
    let mut c1 = connect(&srv, &t1).await;
    let mut c2 = connect(&srv, &t2).await;
    wait_for(&mut c1, "Welcome").await;
    wait_for(&mut c2, "Welcome").await;

    let payload = json!({"type": "JoinServerByInvite", "payload": {"invite_code": code}});
    let (r1, r2) = tokio::join!(
        async {
            send(&mut c1, payload.clone()).await;
            wait_for_any(&mut c1, &["ServerCreated", "ServerFeedback"]).await
        },
        async {
            send(&mut c2, payload.clone()).await;
            wait_for_any(&mut c2, &["ServerCreated", "ServerFeedback"]).await
        }
    );

    let types = [r1["type"].as_str().unwrap(), r2["type"].as_str().unwrap()];
    assert_eq!(types.iter().filter(|&&t| t == "ServerCreated").count(), 1, "apenas 1 entra: {types:?}");
    assert_eq!(types.iter().filter(|&&t| t == "ServerFeedback").count(), 1, "o outro recebe erro: {types:?}");

    let uses = srv.state.read().await.invites.get(&code).unwrap().uses;
    assert_eq!(uses, 1);
}

#[tokio::test]
async fn invite_permissions_channel_target_and_manage_invites() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "PermDono", "friends").await;
    let default_code = server["invite_code"].as_str().unwrap().to_string();

    // Cria um segundo canal de texto para vincular ao convite.
    send(&mut owner, json!({"type": "CreateChannel", "payload": {"server_id": sid, "name": "boas-vindas", "kind": "text"}})).await;
    let ch_created = wait_for(&mut owner, "ChannelCreated").await;
    let welcome_ch = ch_created["channel"]["id"].as_str().unwrap().to_string();

    // Entra membro comum e retira `create_invites` de @everyone.
    let (mut member, _) = join_with(&srv, "SemPerm", &default_code).await;
    wait_for(&mut owner, "ServerUpdated").await;
    {
        let mut st = srv.state.write().await;
        let s = st.find_server_mut(&sid).unwrap();
        s.roles.iter_mut().find(|r| r.id == "everyone").unwrap().permissions.create_invites = false;
    }

    send(&mut member, json!({"type": "CreateInvite", "payload": {"server_id": sid}})).await;
    let fb = wait_for(&mut member, "ServerFeedback").await;
    assert_eq!(fb["ok"], false);

    // Cria cargo somente com `manage_invites` (sem `manage_server`) e atribui ao membro.
    send(&mut owner, json!({
        "type": "CreateRole",
        "payload": {
            "server_id": sid,
            "name": "GestorConvites",
            "color": "#22aa88",
            "hoist": false,
            "mentionable": false,
            "permissions": { "create_invites": true, "manage_invites": true }
        }
    })).await;
    let role_id = loop {
        let upd = wait_for(&mut owner, "ServerUpdated").await;
        if let Some(r) = upd["server"]["roles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["name"] == "GestorConvites")
        {
            break r["id"].as_str().unwrap().to_string();
        }
    };
    send(&mut owner, json!({"type": "AssignUserRoles", "payload": {"server_id": sid, "target_username": "semperm", "role_ids": [role_id]}})).await;
    wait_for(&mut owner, "ServerUpdated").await;

    // Dono cria convite vinculado ao canal #boas-vindas.
    send(&mut owner, json!({
        "type": "CreateInvite",
        "payload": { "server_id": sid, "channel_id": welcome_ch, "max_age_secs": 86400 }
    })).await;
    let inv = wait_for(&mut owner, "InviteCreated").await["invite"].clone();
    assert_eq!(inv["channel_id"], welcome_ch);
    assert_eq!(inv["channel_name"], "boas-vindas");
    let ch_code = inv["code"].as_str().unwrap().to_string();

    // GestorConvites consegue listar e revogar convite de outro membro.
    send(&mut member, json!({"type": "ListInvites", "payload": {"server_id": sid}})).await;
    let list = wait_for(&mut member, "InvitesList").await;
    assert!(list["invites"].as_array().unwrap().iter().any(|i| i["code"] == ch_code.as_str()));

    // Novo usuário entra pelo convite do canal: abre no canal vinculado e gera ServerMemberJoined.
    let (_newbie, reply) = join_with(&srv, "NovatoCanal", &ch_code).await;
    assert_eq!(reply["type"], "ServerCreated");
    assert_eq!(reply["payload"]["default_channel_id"], welcome_ch);

    let joined_evt = wait_for(&mut owner, "ServerMemberJoined").await;
    assert_eq!(joined_evt["server_id"], sid);
    assert_eq!(joined_evt["invite_code"], ch_code);
    assert_eq!(joined_evt["message"]["channel_id"], welcome_ch);
    assert!(joined_evt["message"]["content"].as_str().unwrap().contains("entrou no servidor"));

    // GestorConvites recebe atualização em tempo real do uso do convite (uses == 1).
    loop {
        let realtime_list = wait_for(&mut member, "InvitesList").await;
        if realtime_list["invites"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["code"] == ch_code.as_str() && i["uses"] == 1)
        {
            break;
        }
    }

    // GestorConvites revoga o convite criado pelo dono.
    send(&mut member, json!({"type": "RevokeInvite", "payload": {"server_id": sid, "code": ch_code}})).await;
    let after = wait_for(&mut member, "InvitesList").await;
    assert!(after["invites"].as_array().unwrap().iter().all(|i| i["code"] != ch_code.as_str()));
}

#[tokio::test]
async fn invite_temporary_membership_removes_on_disconnect_unless_role_assigned() {
    let srv = start_server().await;
    let (mut owner, _server, sid) = owner_with_server(&srv, "TempHost", "friends").await;

    send(&mut owner, json!({
        "type": "CreateInvite",
        "payload": { "server_id": sid, "temporary": true }
    })).await;
    let temp_code = wait_for(&mut owner, "InviteCreated").await["invite"]["code"]
        .as_str()
        .unwrap()
        .to_string();

    // Visitante 1 entra sem cargo -> ao desconectar, sai automaticamente do servidor.
    let (guest1, r1) = join_with(&srv, "TempSai", &temp_code).await;
    assert_eq!(r1["type"], "ServerCreated");
    wait_for(&mut owner, "ServerUpdated").await;
    assert!(srv.state.read().await.find_server(&sid).unwrap().temporary_members.contains(&"tempsai".to_string()));
    drop(guest1);
    wait_for(&mut owner, "ServerUpdated").await;
    {
        let st = srv.state.read().await;
        let s = st.find_server(&sid).unwrap();
        assert!(!s.is_member("tempsai"), "membro temporário sem cargo é removido ao desconectar");
        assert!(!s.temporary_members.contains(&"tempsai".to_string()));
    }

    // Visitante 2 entra por convite temporário, mas recebe cargo -> permanece ao desconectar.
    let (guest2, r2) = join_with(&srv, "TempFica", &temp_code).await;
    assert_eq!(r2["type"], "ServerCreated");
    wait_for(&mut owner, "ServerUpdated").await;
    let mod_role_id = srv.state.read().await.find_server(&sid).unwrap()
        .roles.iter().find(|r| r.name == "Moderador").unwrap().id.clone();
    send(&mut owner, json!({
        "type": "AssignUserRoles",
        "payload": { "server_id": sid, "target_username": "tempfica", "role_ids": [mod_role_id] }
    })).await;
    wait_for(&mut owner, "ServerUpdated").await;
    drop(guest2);
    tokio::time::sleep(Duration::from_millis(120)).await;
    {
        let st = srv.state.read().await;
        let s = st.find_server(&sid).unwrap();
        assert!(s.is_member("tempfica"), "membro temporário que ganhou cargo vira permanente");
    }
}

#[tokio::test]
async fn invite_rules_ban_duplicate_join_and_preview_auth() {
    let srv = start_server().await;
    let (mut owner, server, sid) = owner_with_server(&srv, "RegrasHost", "friends").await;
    let code = server["invite_code"].as_str().unwrap().to_string();

    // Configura regras de entrada no servidor.
    send(&mut owner, json!({
        "type": "UpdateServer",
        "payload": {
            "server_id": sid,
            "name": "Servidor com Regras",
            "rules_text": "1. Respeite todos.\n2. Sem spam."
        }
    })).await;
    wait_for(&mut owner, "ServerUpdated").await;

    // Prévia mostra as regras e já-membro para o dono autenticado.
    let owner_tok = post(&srv, "/api/login", json!({"username": "RegrasHost", "password": "senha-segura-1"})).await.1["token"]
        .as_str()
        .unwrap()
        .to_string();
    let (st_owner, pv_owner) = preview_http(&srv, &code, Some(&owner_tok)).await;
    assert_eq!(st_owner, 200);
    assert_eq!(pv_owner["already_member"], true);
    assert!(pv_owner["rules_text"].as_str().unwrap().contains("Respeite todos"));

    // Tentativa de entrada sem aceitar regras falha com ação específica.
    let t_new = register(&srv, "NovoRegras").await;
    let mut ws_new = connect(&srv, &t_new).await;
    wait_for(&mut ws_new, "Welcome").await;
    send(&mut ws_new, json!({"type": "JoinServerByInvite", "payload": {"invite_code": code, "accepted_rules": false}})).await;
    let fb = wait_for(&mut ws_new, "ServerFeedback").await;
    assert_eq!(fb["action"], "join_invite_rules");

    // Aceitando regras, entra normalmente e conta 1 uso.
    send(&mut ws_new, json!({"type": "JoinServerByInvite", "payload": {"invite_code": code, "accepted_rules": true}})).await;
    wait_for(&mut ws_new, "ServerCreated").await;
    wait_for(&mut owner, "ServerUpdated").await;
    assert_eq!(srv.state.read().await.invites.get(&code).unwrap().uses, 1);

    // Entrada duplicada por quem já é membro NÃO incrementa usos.
    send(&mut ws_new, json!({"type": "JoinServerByInvite", "payload": {"invite_code": code, "accepted_rules": true}})).await;
    wait_for(&mut ws_new, "ServerCreated").await;
    wait_for(&mut owner, "ServerUpdated").await;
    assert_eq!(srv.state.read().await.invites.get(&code).unwrap().uses, 1);

    // Banimento: tanto prévia autenticada quanto entrada WS recusam sem vazar motivo interno.
    send(&mut owner, json!({"type": "BanServerMember", "payload": {"server_id": sid, "target_username": "novoregras", "reason": "motivo interno secreto"}})).await;
    wait_for(&mut owner, "ServerUpdated").await;

    let (st_ban, pv_ban) = preview_http(&srv, &code, Some(&t_new)).await;
    assert_eq!(st_ban, 403);
    assert_eq!(pv_ban["error_kind"], "banned");
    assert_eq!(pv_ban["message"], "Você não pode entrar neste servidor.");
    assert!(!pv_ban.to_string().contains("motivo interno secreto"));

    send(&mut ws_new, json!({"type": "JoinServerByInvite", "payload": {"invite_code": code, "accepted_rules": true}})).await;
    let fb_ban = wait_for(&mut ws_new, "ServerFeedback").await;
    assert_eq!(fb_ban["ok"], false);
    assert_eq!(fb_ban["message"], "Você não pode entrar neste servidor.");

    // Convite inexistente.
    let (st_404, pv_404) = preview_http(&srv, "SANC-NAOEXIST", None).await;
    assert_eq!(st_404, 404);
    assert_eq!(pv_404["error_kind"], "invalid");
}

#[tokio::test]
async fn invite_persists_all_v19_fields_across_restart() {
    let dir = std::env::temp_dir().join(format!("sancord-inv-v19-{}", uuid::Uuid::new_v4()));
    let sid;
    let code;
    let revoked_code;
    let ch_id;
    {
        let srv = start_server_in(dir.clone()).await;
        let (mut owner, server, s) = owner_with_server(&srv, "PersisteInv", "friends").await;
        sid = s;
        ch_id = server["text_channels"][0]["id"].as_str().unwrap().to_string();

        send(&mut owner, json!({
            "type": "UpdateServer",
            "payload": { "server_id": sid, "name": "Persistido", "rules_text": "Regra persistida" }
        })).await;
        wait_for(&mut owner, "ServerUpdated").await;

        send(&mut owner, json!({
            "type": "CreateInvite",
            "payload": { "server_id": sid, "channel_id": ch_id, "temporary": true, "max_uses": 10, "max_age_secs": 3600 }
        })).await;
        code = wait_for(&mut owner, "InviteCreated").await["invite"]["code"].as_str().unwrap().to_string();

        send(&mut owner, json!({"type": "CreateInvite", "payload": {"server_id": sid}})).await;
        revoked_code = wait_for(&mut owner, "InviteCreated").await["invite"]["code"].as_str().unwrap().to_string();
        send(&mut owner, json!({"type": "RevokeInvite", "payload": {"server_id": sid, "code": revoked_code}})).await;
        wait_for(&mut owner, "InvitesList").await;

        send(&mut owner, json!({"type": "SetInvitesPaused", "payload": {"server_id": sid, "paused": true}})).await;
        wait_for(&mut owner, "InvitesList").await;

        let db = srv.state.read().await.db.clone();
        db.flush();
        db.shutdown();
    }

    let srv = start_server_in(dir).await;
    let st = srv.state.read().await;
    let s = st.find_server(&sid).expect("servidor recarregado");
    assert!(s.invites_paused);
    assert_eq!(s.rules_text.as_deref(), Some("Regra persistida"));

    let inv = st.invites.get(&code).expect("convite recarregado");
    assert_eq!(inv.channel_id.as_deref(), Some(ch_id.as_str()));
    assert!(inv.temporary);
    assert_eq!(inv.max_uses, Some(10));

    let tomb = st.invites.get(&revoked_code).expect("tombstone recarregado");
    assert!(tomb.is_revoked());
    assert_eq!(tomb.revoked_by.as_deref(), Some("persisteinv"));
}

#[tokio::test]
async fn invite_custom_slug_validates_uniqueness_reserved_and_joins() {
    let srv = start_server().await;
    let (mut owner1, _s1, sid1) = owner_with_server(&srv, "SlugDono1", "friends").await;
    let (mut owner2, _s2, sid2) = owner_with_server(&srv, "SlugDono2", "friends").await;

    // Palavra reservada e formato inválido são recusados.
    for bad in ["ab", "admin", "sanc-teste", "com espaco", "-inicio", "duplo--hifen"] {
        send(&mut owner1, json!({"type": "SetCustomInviteSlug", "payload": {"server_id": sid1, "slug": bad}})).await;
        let fb = wait_for(&mut owner1, "ServerFeedback").await;
        assert_eq!(fb["ok"], false, "slug inválido deveria falhar: {bad}");
    }

    // Slug válido é salvo, aparece na prévia e permite entrada por link curto.
    send(&mut owner1, json!({"type": "SetCustomInviteSlug", "payload": {"server_id": sid1, "slug": "Guilda-Sancord"}})).await;
    let upd = wait_for(&mut owner1, "ServerUpdated").await;
    assert_eq!(upd["server"]["custom_invite_slug"], "guilda-sancord");

    let (status, pv) = preview_http(&srv, "guilda-sancord", None).await;
    assert_eq!(status, 200);
    assert_eq!(pv["ok"], true);
    assert_eq!(pv["server_id"], sid1);

    // Outro servidor não pode registrar o mesmo slug.
    send(&mut owner2, json!({"type": "SetCustomInviteSlug", "payload": {"server_id": sid2, "slug": "guilda-sancord"}})).await;
    let fb_dup = wait_for(&mut owner2, "ServerFeedback").await;
    assert_eq!(fb_dup["ok"], false);
    assert!(fb_dup["message"].as_str().unwrap().contains("já está em uso"));

    // Convidado entra usando o formato curto sancord.gg/guilda-sancord.
    let (_guest, reply) = join_with(&srv, "VisitanteSlug", "sancord.gg/guilda-sancord").await;
    assert_eq!(reply["type"], "ServerCreated");
    assert_eq!(reply["payload"]["server"]["id"], sid1);
    wait_for(&mut owner1, "ServerUpdated").await;

    // Remover slug invalida o endereço personalizado.
    send(&mut owner1, json!({"type": "SetCustomInviteSlug", "payload": {"server_id": sid1, "slug": ""}})).await;
    let upd_clear = wait_for(&mut owner1, "ServerUpdated").await;
    assert!(upd_clear["server"].get("custom_invite_slug").is_none());

    let (st_404, _) = preview_http(&srv, "guilda-sancord", None).await;
    assert_eq!(st_404, 404);
}
