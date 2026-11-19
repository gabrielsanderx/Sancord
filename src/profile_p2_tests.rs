//! Perfil — Fase P2: decorações e molduras do catálogo, molduras por conquista (badges
//! concedidas só pelo servidor) e itens de temporada por inventário.
use super::*;

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

async fn account(srv: &TestServer, lower: &str) -> crate::models::Account {
    srv.state.read().await.accounts.get(lower).unwrap().clone()
}

async fn equip(ws: &mut Ws, field: &str, id: &str) {
    send(ws, json!({"type":"UpdateProfile","payload":{ field: id, "bio": "oi" }})).await;
    tokio::time::sleep(Duration::from_millis(120)).await;
}

#[tokio::test]
async fn frames_and_decorations_follow_catalog_badges_and_inventory() {
    let srv = start_server().await;
    let token = register(&srv, "MolduraTeste").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    let cos = wait_for(&mut a, "CosmeticsState").await;
    let badges = cos["badges"].as_array().unwrap();
    assert!(badges.iter().any(|b| b["id"] == "founder" && b["category"] == "trust"));
    assert!(badges.iter().any(|b| b["id"] == "early_user" && b["category"] == "cosmetic"));
    // Conta nova (antes do corte) já é "Pioneira".
    let owned = cos["owned"].as_array().unwrap();
    assert!(owned.iter().any(|k| k == "profile_frame:early-user"), "moldura da badge automática");
    assert!(!owned.iter().any(|k| k == "profile_frame:founder"));

    // Gratuitas: equipar e tirar.
    equip(&mut a, "profile_frame", "core-pulse").await;
    equip(&mut a, "avatar_decoration", "core-orbit").await;
    let acc = account(&srv, "moldurateste").await;
    assert_eq!(acc.profile.profile_frame.as_deref(), Some("core-pulse"));
    assert_eq!(acc.avatar_decoration.as_deref(), Some("core-orbit"));
    assert!(acc.profile.badges.contains(&"early_user".to_string()));

    // Por conquista sem a badge: recusado. O cliente não consegue se dar badges.
    send(&mut a, json!({"type":"UpdateProfile","payload":{"profile_frame":"founder","badges":["founder"],"bio":"oi"}})).await;
    assert!(feedback(&mut a, "update_profile").await["message"].as_str().unwrap().contains("não possui"));
    let acc = account(&srv, "moldurateste").await;
    assert_eq!(acc.profile.profile_frame.as_deref(), Some("core-pulse"));
    assert!(!acc.profile.badges.contains(&"founder".to_string()));

    // Temporada: só por inventário (evento, presente, código).
    send(&mut a, json!({"type":"UpdateProfile","payload":{"profile_frame":"winter-2026","bio":"oi"}})).await;
    assert_eq!(feedback(&mut a, "update_profile").await["ok"], false);
    srv.state.write().await.accounts.get_mut("moldurateste").unwrap().inventory.push("profile_frame:winter-2026".into());
    equip(&mut a, "profile_frame", "winter-2026").await;
    assert_eq!(account(&srv, "moldurateste").await.profile.profile_frame.as_deref(), Some("winter-2026"));

    // Badge concedida pelo operador: vale ao reconectar e libera a moldura de conquista.
    srv.state.write().await.badge_grants.insert("moldurateste".into(), vec!["founder".into(), "inexistente".into()]);
    let mut b = connect(&srv, &token).await;
    wait_for(&mut b, "Welcome").await;
    let cos = wait_for(&mut b, "CosmeticsState").await;
    assert!(cos["owned"].as_array().unwrap().iter().any(|k| k == "profile_frame:founder"));
    equip(&mut b, "profile_frame", "founder").await;
    let acc = account(&srv, "moldurateste").await;
    assert_eq!(acc.profile.profile_frame.as_deref(), Some("founder"));
    assert_eq!(acc.profile.badges, vec!["founder".to_string(), "early_user".to_string()], "confiança primeiro; badge inexistente ignorada");
}

#[tokio::test]
async fn operator_badges_file_is_read_on_load() {
    let srv = start_server().await;
    let token = register(&srv, "OperadoraArq").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    let db = srv.state.read().await.db.clone();
    db.flush();
    std::fs::write(srv.dir.join("badges.json"), r#"{"OperadoraArq":["developer","bug_hunter"]}"#).unwrap();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    assert_eq!(st.accounts["operadoraarq"].profile.badges, vec!["developer".to_string(), "bug_hunter".to_string(), "early_user".to_string()]);
}
