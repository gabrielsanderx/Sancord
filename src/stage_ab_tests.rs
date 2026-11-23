//! Testes de integração das Etapas A e B:
//! - Preferências sincronizadas na conta (`user_notes`, `ignored_users`, `starred_messages`)
//! - E-mail da conta + Código único de recuperação (`POST /api/recover-password`)
//! - Sessões e dispositivos ativos (`ListSessions`, `RevokeSession`)
//! - Transferência de posse de servidor (`TransferServerOwnership`) e exclusão da própria conta (`DeleteAccount`)
//! - Expulsão/Banimento com motivo (`bans.reason` no esquema v14), limpeza de histórico recente e `BulkDeleteMessages`
use super::*;

#[tokio::test]
async fn user_prefs_sync_notes_ignored_and_starred() {
    let srv = start_server().await;
    let token = register(&srv, "PrefUser").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;

    send(
        &mut a,
        json!({
            "type": "UpdateUserPrefs",
            "payload": {
                "user_notes": {
                    "  Bia ": "Amiga do CS2",
                    "vazio": "   "
                },
                "ignored_users": ["Carlos", "carlos", "  davi "],
                "starred_messages": ["msg-1", "msg-1", " msg-2 "]
            }
        }),
    )
    .await;

    let prefs = wait_for(&mut a, "UserPrefsUpdated").await["prefs"].clone();
    assert_eq!(prefs["user_notes"], json!({"bia": "Amiga do CS2"}));
    assert_eq!(prefs["ignored_users"], json!(["carlos", "davi"]));
    assert_eq!(prefs["starred_messages"], json!(["msg-1", "msg-2"]));

    // Segunda conexão recebe tudo no Welcome e persiste no banco.
    let mut b = connect(&srv, &token).await;
    let w = wait_for(&mut b, "Welcome").await;
    assert_eq!(w["prefs"]["user_notes"]["bia"], "Amiga do CS2");
    assert_eq!(w["prefs"]["ignored_users"], json!(["carlos", "davi"]));
    assert_eq!(w["prefs"]["starred_messages"], json!(["msg-1", "msg-2"]));
}

#[tokio::test]
async fn email_and_single_use_recovery_code_flow() {
    let srv = start_server().await;
    let token = register(&srv, "Recuperavel").await;
    let mut ws = connect(&srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    // O cadastro já exige e-mail (o helper usa `<nome>@sanvo.test`).
    let initial_email = wait_for(&mut ws, "AccountEmailUpdated").await;
    assert_eq!(initial_email["email"], "recuperavel@sanvo.test");

    // Atualiza e-mail com senha correta.
    send(
        &mut ws,
        json!({
            "type": "UpdateAccountEmail",
            "payload": {
                "email": "User@Exemplo.com",
                "current_password": "senha-segura-1"
            }
        }),
    )
    .await;
    let updated_email = wait_for(&mut ws, "AccountEmailUpdated").await;
    assert_eq!(updated_email["email"], "user@exemplo.com");

    // Gera código de recuperação único.
    send(
        &mut ws,
        json!({
            "type": "GenerateRecoveryCode",
            "payload": {
                "current_password": "senha-segura-1"
            }
        }),
    )
    .await;
    let generated = wait_for(&mut ws, "RecoveryCodeGenerated").await;
    let code = generated["recovery_code"].as_str().unwrap().to_string();
    assert!(code.starts_with("SANC-"), "código gerado: {code}");

    // Usa o código de recuperação via HTTP (aceita com ou sem traços, case-insensitive).
    let (status, body) = post(
        &srv,
        "/api/recover-password",
        json!({
            "username": "recuperavel",
            "recovery_code": code.to_lowercase(),
            "new_password": "nova-senha-forte-99"
        }),
    )
    .await;
    assert_eq!(status, 200, "recuperação falhou: {body}");
    let new_token = body["token"].as_str().unwrap().to_string();
    assert_ne!(new_token, token);

    // A sessão antiga foi revogada ao redefinir a senha.
    let (s_old, _) = post(&srv, "/api/session", json!({"token": token})).await;
    assert_eq!(s_old, 401);

    // O código é de uso único: tentar reutilizar retorna 401.
    let (s_reuse, _) = post(
        &srv,
        "/api/recover-password",
        json!({
            "username": "recuperavel",
            "recovery_code": code,
            "new_password": "outra-senha-123"
        }),
    )
    .await;
    assert_eq!(s_reuse, 401);

    // Login com a senha nova funciona.
    let (s_login, _) = post(
        &srv,
        "/api/login",
        json!({"username": "recuperavel", "password": "nova-senha-forte-99"}),
    )
    .await;
    assert_eq!(s_login, 200);
}

#[tokio::test]
async fn active_sessions_list_and_revoke() {
    let srv = start_server().await;
    let t1 = register(&srv, "MultiSess").await;
    let (s2, b2) = post(
        &srv,
        "/api/login",
        json!({"username": "multisess", "password": "senha-segura-1"}),
    )
    .await;
    assert_eq!(s2, 200);
    let t2 = b2["token"].as_str().unwrap().to_string();

    let mut ws1 = connect(&srv, &t1).await;
    wait_for(&mut ws1, "Welcome").await;
    let list_msg = wait_for(&mut ws1, "SessionsList").await;
    let sessions = list_msg["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 2);
    assert!(sessions[0]["current"].as_bool().unwrap());

    let other_id = sessions
        .iter()
        .find(|s| !s["current"].as_bool().unwrap())
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(other_id.len(), 16, "ID curto não expõe hash completo");

    send(&mut ws1, json!({"type": "RevokeSession", "payload": {"session_id": other_id}})).await;
    let after = wait_for(&mut ws1, "SessionsList").await;
    assert_eq!(after["sessions"].as_array().unwrap().len(), 1);

    // Token da segunda sessão não é mais aceito.
    let (s_check, _) = post(&srv, "/api/session", json!({"token": t2})).await;
    assert_eq!(s_check, 401);
}

#[tokio::test]
async fn transfer_server_ownership_and_delete_account_guard() {
    let srv = start_server().await;
    let (mut owner_ws, server, sid) = owner_with_server(&srv, "Fundador1", "blank").await;
    let invite = server["invite_code"].as_str().unwrap().to_string();
    let (mut member_ws, _) = join_with(&srv, "Sucessor", &invite).await;
    wait_for(&mut owner_ws, "ServerUpdated").await;

    // Enquanto for dono de um servidor, não pode excluir a própria conta.
    send(
        &mut owner_ws,
        json!({"type": "DeleteAccount", "payload": {"current_password": "senha-segura-1"}}),
    )
    .await;
    let fb_guard = wait_for(&mut owner_ws, "ServerFeedback").await;
    assert_eq!(fb_guard["ok"], false);
    assert_eq!(fb_guard["action"], "delete_account");

    // Transfere a posse para Sucessor.
    send(
        &mut owner_ws,
        json!({
            "type": "TransferServerOwnership",
            "payload": {
                "server_id": sid,
                "new_owner_username": "Sucessor"
            }
        }),
    )
    .await;
    let upd = wait_for(&mut owner_ws, "ServerUpdated").await;
    assert_eq!(upd["server"]["owner_username"], "sucessor");
    let fb_ok = wait_for(&mut owner_ws, "ServerFeedback").await;
    assert_eq!(fb_ok["ok"], true);
    assert_eq!(fb_ok["action"], "transfer_ownership");

    // Novo dono consulta auditoria e vê server_transfer_ownership.
    wait_for(&mut member_ws, "ServerUpdated").await;
    send(
        &mut member_ws,
        json!({"type": "GetAuditLog", "payload": {"server_id": sid}}),
    )
    .await;
    let audit = wait_for(&mut member_ws, "AuditLog").await;
    assert!(audit["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["action"] == "server_transfer_ownership" && e["target"] == "sucessor"));

    // Agora o ex-dono pode excluir sua própria conta.
    send(
        &mut owner_ws,
        json!({"type": "DeleteAccount", "payload": {"current_password": "senha-segura-1"}}),
    )
    .await;
    let gone = wait_for(&mut owner_ws, "AuthFailed").await;
    assert!(gone["message"].as_str().unwrap().contains("excluída"));
    assert!(!srv.state.read().await.accounts.contains_key("fundador1"));
}

#[tokio::test]
async fn kick_ban_with_reason_message_cleanup_and_bulk_delete() {
    let srv = start_server().await;
    let (mut owner_ws, server, sid) = owner_with_server(&srv, "ModBoss", "blank").await;
    let invite = server["invite_code"].as_str().unwrap().to_string();
    let ch_id = server["text_channels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == "text")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let (mut spammer_ws, _) = join_with(&srv, "Spammer", &invite).await;
    wait_for(&mut owner_ws, "ServerUpdated").await;

    // Spammer envia 2 mensagens e ModBoss envia 2 mensagens.
    for txt in ["spam 1", "spam 2"] {
        send(&mut spammer_ws, json!({"type": "SendChat", "payload": {"channel_id": ch_id, "content": txt}})).await;
        wait_for(&mut owner_ws, "NewChatMessage").await;
    }
    for txt in ["aviso 1", "aviso 2"] {
        send(&mut owner_ws, json!({"type": "SendChat", "payload": {"channel_id": ch_id, "content": txt}})).await;
        wait_for(&mut owner_ws, "NewChatMessage").await;
    }

    // Bane Spammer com motivo e limpeza das mensagens das últimas 24h (86400s).
    send(
        &mut owner_ws,
        json!({
            "type": "BanServerMember",
            "payload": {
                "server_id": sid,
                "target_username": "Spammer",
                "reason": "Flood no canal geral",
                "delete_message_seconds": 86400
            }
        }),
    )
    .await;
    let bulk_ban = wait_for(&mut owner_ws, "MessagesBulkDeleted").await;
    assert_eq!(bulk_ban["channel_id"], ch_id);
    assert_eq!(bulk_ban["message_ids"].as_array().unwrap().len(), 2);

    let srv_upd = wait_for(&mut owner_ws, "ServerUpdated").await;
    assert_eq!(
        srv_upd["server"]["ban_reasons"]["spammer"],
        "Flood no canal geral"
    );

    let removed = wait_for(&mut spammer_ws, "ServerRemoved").await;
    assert!(removed["reason"]
        .as_str()
        .unwrap()
        .contains("Flood no canal geral"));

    // Persiste ban_reasons no SQLite (esquema v14).
    let db = srv.state.read().await.db.clone();
    db.flush();
    let loaded_srvs = db.load_servers().unwrap();
    let db_srv = loaded_srvs.iter().find(|s| s.id == sid).unwrap();
    assert_eq!(
        db_srv.ban_reasons.get("spammer").map(String::as_str),
        Some("Flood no canal geral")
    );

    // BulkDeleteMessages apaga as 2 mensagens de ModBoss (preservando boas-vindas se filtrarmos por autor).
    send(
        &mut owner_ws,
        json!({
            "type": "BulkDeleteMessages",
            "payload": {
                "channel_id": ch_id,
                "count": 10,
                "author_username": "ModBoss"
            }
        }),
    )
    .await;
    let bulk_mod = wait_for(&mut owner_ws, "MessagesBulkDeleted").await;
    assert_eq!(bulk_mod["message_ids"].as_array().unwrap().len(), 2);
    let fb_bulk = wait_for(&mut owner_ws, "ServerFeedback").await;
    assert_eq!(fb_bulk["ok"], true);
    assert_eq!(fb_bulk["action"], "bulk_delete");
}
