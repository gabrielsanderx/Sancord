//! Perfil — Fase P1: mídia do perfil por anexo, catálogo de cosméticos validado,
//! tema (gradiente/direção/destaque) e bio de 300 caracteres.
use super::*;

async fn feedback(ws: &mut Ws, action: &str) -> Value {
    loop {
        let fb = wait_for(ws, "ServerFeedback").await;
        if fb["action"] == action {
            return fb;
        }
    }
}

fn tiny_gif() -> Vec<u8> {
    let mut gif = b"GIF89a".to_vec();
    gif.extend_from_slice(&16u16.to_le_bytes());
    gif.extend_from_slice(&16u16.to_le_bytes());
    gif.extend_from_slice(&[0, 0, 0, 0x3B]);
    gif
}

async fn att(srv: &TestServer, token: &str, name: &str, bytes: Vec<u8>) -> String {
    let (status, body) = upload(srv, token, name, bytes).await;
    assert_eq!(status, 200, "{body}");
    body["attachment"]["id"].as_str().unwrap().to_string()
}

async fn account(srv: &TestServer, lower: &str) -> crate::models::Account {
    srv.state.read().await.accounts.get(lower).unwrap().clone()
}

#[tokio::test]
async fn profile_dimensions_are_bounded_and_appearance_updates_reach_other_sessions() {
    let srv = start_server().await;
    let token = register(&srv, "MovimentoPerfil").await;
    let mut first = connect(&srv, &token).await;
    wait_for(&mut first, "Welcome").await;
    let mut second = connect(&srv, &token).await;
    let welcome = wait_for(&mut second, "Welcome").await;
    let second_id = &welcome["user"]["id"];

    let mut oversized = tiny_gif();
    oversized[6..8].copy_from_slice(&4097u16.to_le_bytes());
    let image = att(&srv, &token, "largura.gif", oversized).await;
    send(&mut first, json!({"type":"SetProfileMedia","payload":{"kind":"banner","attachment_id":image}})).await;
    let error = feedback(&mut first, "profile_media").await;
    assert_eq!(error["ok"], false);
    assert!(error["message"].as_str().unwrap().contains("4096"));
    assert!(account(&srv, "movimentoperfil").await.banner_url.is_none());

    send(&mut first, json!({"type":"UpdateProfile","payload":{
        "display_name":"Novo nome", "status_kind":"idle", "avatar_decoration":"core-orbit",
        "profile_effect":"core-signal", "profile_frame":"core-pulse"
    }})).await;
    loop {
        let sync = wait_for(&mut second, "VoiceStateSync").await;
        if sync["users"].as_array().unwrap().iter().any(|u| {
            u["id"] == *second_id && u["profile_frame"] == "core-pulse"
                && u["avatar_decoration"] == "core-orbit" && u["profile_effect"] == "core-signal"
                && u["display_name"] == "Novo nome" && u["status_kind"] == "idle"
        }) { break; }
    }
}

#[tokio::test]
async fn profile_media_uses_validated_attachments_and_syncs() {
    let srv = start_server().await;
    let token = register(&srv, "PerfilMidia").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    // O catálogo chega logo depois do Welcome, com o que a conta possui.
    let cos = wait_for(&mut a, "CosmeticsState").await;
    assert!(cos["catalog"].as_array().unwrap().len() >= 50);
    assert!(cos["owned"].as_array().unwrap().iter().any(|k| k == "avatar_decoration:flame-violet"));

    let other_token = register(&srv, "Observadora").await;
    let mut b = connect(&srv, &other_token).await;
    wait_for(&mut b, "Welcome").await;

    let png = att(&srv, &token, "eu.png", tiny_png()).await;
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"avatar","attachment_id":png}})).await;
    assert_eq!(feedback(&mut a, "profile_media").await["ok"], true);
    let acc = account(&srv, "perfilmidia").await;
    assert!(acc.avatar_url.as_deref().unwrap().starts_with(&format!("/api/attachments/{png}/")));
    assert!(!acc.profile.avatar_animated);
    // Quem está conectado recebe o novo endereço (leve: um caminho, não a imagem).
    loop {
        let sync = wait_for(&mut b, "VoiceStateSync").await;
        let me = sync["users"].as_array().unwrap().iter().find(|u| u["username"] == "PerfilMidia").cloned();
        if me.as_ref().is_some_and(|u| u["avatar_url"].as_str().is_some_and(|s| s.contains(&png))) {
            break;
        }
    }

    // GIF vira avatar animado; banner próprio; remover volta ao padrão.
    let gif = att(&srv, &token, "anima.gif", tiny_gif()).await;
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"avatar","attachment_id":gif}})).await;
    assert_eq!(feedback(&mut a, "profile_media").await["ok"], true);
    assert!(account(&srv, "perfilmidia").await.profile.avatar_animated);
    let banner = att(&srv, &token, "faixa.png", tiny_png()).await;
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"banner","attachment_id":banner}})).await;
    assert_eq!(feedback(&mut a, "profile_media").await["ok"], true);
    assert!(account(&srv, "perfilmidia").await.banner_url.unwrap().contains(&banner));
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"avatar"}})).await;
    assert_eq!(feedback(&mut a, "profile_media").await["message"], "Avatar removido.");
    let acc = account(&srv, "perfilmidia").await;
    assert!(acc.avatar_url.is_none() && !acc.profile.avatar_animated);

    // Regras: imagem de outra pessoa, tipo errado, tamanho e tipo de mídia inválido.
    let alheia = att(&srv, &other_token, "dela.png", tiny_png()).await;
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"avatar","attachment_id":alheia}})).await;
    assert!(feedback(&mut a, "profile_media").await["message"].as_str().unwrap().contains("enviada por você"));
    let texto = att(&srv, &token, "nota.txt", b"so texto".to_vec()).await;
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"banner","attachment_id":texto}})).await;
    assert!(feedback(&mut a, "profile_media").await["message"].as_str().unwrap().contains("PNG"));
    let mut grande = tiny_png();
    grande.resize(7 * 1024 * 1024, 0);
    let grande = att(&srv, &token, "grande.png", grande).await;
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"avatar","attachment_id":grande}})).await;
    assert!(feedback(&mut a, "profile_media").await["message"].as_str().unwrap().contains("6 MB"));
    send(&mut a, json!({"type":"SetProfileMedia","payload":{"kind":"fundo","attachment_id":png}})).await;
    assert_eq!(feedback(&mut a, "profile_media").await["ok"], false);

    // Persistência.
    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    assert!(st.accounts["perfilmidia"].banner_url.as_deref().unwrap().contains(&banner));
}

/// Imagens de perfil (anexos) ficam em cache imutável; o resto da API continua sem cache.
#[tokio::test]
async fn profile_images_are_cacheable_while_api_is_not() {
    let srv = start_server().await;
    let token = register(&srv, "PerfilCache").await;
    let id = att(&srv, &token, "eu.png", tiny_png()).await;
    let get = |path: String| {
        let router = srv.router.clone();
        async move { router.oneshot(axum::http::Request::get(path).body(axum::body::Body::empty()).unwrap()).await.unwrap() }
    };
    let img = get(format!("/api/attachments/{id}/eu.png")).await;
    assert_eq!(img.status(), 200);
    let cc = img.headers()["cache-control"].to_str().unwrap().to_string();
    assert!(cc.contains("immutable") && !cc.contains("no-store"), "{cc}");
    assert!(img.headers().get("pragma").is_none());
    let api = get("/api/health".to_string()).await;
    assert!(api.headers()["cache-control"].to_str().unwrap().contains("no-store"));
}

#[tokio::test]
async fn cosmetics_are_validated_and_theme_and_bio_rules_apply() {
    let srv = start_server().await;
    let token = register(&srv, "PerfilTema").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;

    // Equipar do catálogo funciona; tema com gradiente diagonal e destaque.
    send(&mut a, json!({"type":"UpdateProfile","payload":{
        "avatar_decoration":"flame-violet","name_style":"neon","nameplate_style":"nebula","profile_effect":"aurora",
        "theme_primary":"#112233","theme_accent":"#445566","theme_highlight":"#ff8800","theme_mode":"gradient","theme_direction":"diagonal",
        "bio":"x".repeat(320)}})).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    let acc = account(&srv, "perfiltema").await;
    assert_eq!(acc.avatar_decoration.as_deref(), Some("flame-violet"));
    assert_eq!(acc.name_style.as_deref(), Some("neon"));
    assert_eq!(acc.nameplate_style.as_deref(), Some("nebula"));
    assert_eq!(acc.profile_effect.as_deref(), Some("aurora"));
    assert_eq!(acc.profile.theme_mode.as_deref(), Some("gradient"));
    assert_eq!(acc.profile.theme_direction.as_deref(), Some("diagonal"));
    assert_eq!(acc.profile.theme_highlight.as_deref(), Some("#ff8800"));
    assert_eq!(acc.bio.as_deref().unwrap().chars().count(), 300);

    // Item inexistente, tipo trocado e moldura que não existe: recusados, nada muda.
    send(&mut a, json!({"type":"UpdateProfile","payload":{"avatar_decoration":"lendaria-fake","bio":"oi"}})).await;
    assert!(feedback(&mut a, "update_profile").await["message"].as_str().unwrap().contains("não existe"));
    send(&mut a, json!({"type":"UpdateProfile","payload":{"nameplate_style":"flame-violet","bio":"oi"}})).await;
    assert_eq!(feedback(&mut a, "update_profile").await["ok"], false);
    send(&mut a, json!({"type":"UpdateProfile","payload":{"profile_frame":"<img>","bio":"oi"}})).await;
    assert_eq!(feedback(&mut a, "update_profile").await["ok"], false);
    let acc = account(&srv, "perfiltema").await;
    assert_eq!(acc.avatar_decoration.as_deref(), Some("flame-violet"));
    assert_eq!(acc.nameplate_style.as_deref(), Some("nebula"));
    assert!(acc.profile.profile_frame.is_none());

    // Valor de tema fora da lista é ignorado; vazio limpa; "none" tira o item.
    send(&mut a, json!({"type":"UpdateProfile","payload":{"theme_direction":"espiral","theme_mode":"","avatar_decoration":"none","bio":"oi"}})).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    let acc = account(&srv, "perfiltema").await;
    assert_eq!(acc.profile.theme_direction.as_deref(), Some("diagonal"));
    assert!(acc.profile.theme_mode.is_none());
    assert!(acc.avatar_decoration.is_none());
}

#[tokio::test]
async fn new_profile_effect_is_owned_equipped_and_persisted_with_existing_protocol() {
    let srv = start_server().await;
    let token = register(&srv, "PerfilEfeito").await;
    let mut ws = connect(&srv, &token).await;
    wait_for(&mut ws, "Welcome").await;
    let cosmetics = wait_for(&mut ws, "CosmeticsState").await;
    let owned = cosmetics["owned"].as_array().unwrap();
    assert!(owned.iter().any(|id| id == "profile_effect:core-signal"));
    assert!(owned.iter().any(|id| id == "profile_effect:aurora"));

    send(&mut ws, json!({"type":"UpdateProfile","payload":{"profile_effect":"core-signal"}})).await;
    let sync = wait_for(&mut ws, "VoiceStateSync").await;
    let me = sync["users"].as_array().unwrap().iter().find(|u| u["username"] == "PerfilEfeito").unwrap();
    assert_eq!(me["profile_effect"], "core-signal");

    srv.state.read().await.db.clone().flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    assert_eq!(st.accounts["perfilefeito"].profile_effect.as_deref(), Some("core-signal"));
}

#[tokio::test]
async fn name_gradient_and_plate_sync_between_sessions_and_persist() {
    let srv = start_server().await;
    let token = register(&srv, "PerfilGradiente").await;
    let mut desktop = connect(&srv, &token).await;
    wait_for(&mut desktop, "Welcome").await;
    let cosmetics = wait_for(&mut desktop, "CosmeticsState").await;
    let owned = cosmetics["owned"].as_array().unwrap();
    assert!(owned.iter().any(|id| id == "name_style:custom-gradient"));
    assert!(owned.iter().any(|id| id == "nameplate:core-stripe"));
    let mut second = connect(&srv, &token).await;
    wait_for(&mut second, "Welcome").await;

    send(&mut desktop, json!({"type":"UpdateProfile","payload":{
        "name_style":"custom-gradient", "nameplate_style":"core-stripe", "name_color":"#bc8ef1",
        "name_color_secondary":"#52CFC8", "name_gradient_direction":"diagonal", "bio":"Etapa 4"
    }})).await;
    loop {
        let sync = wait_for(&mut second, "VoiceStateSync").await;
        let sessions: Vec<_> = sync["users"].as_array().unwrap().iter()
            .filter(|u| u["username"] == "PerfilGradiente").collect();
        if !sessions.iter().any(|u| u["bio"] == "Etapa 4") { continue; }
        assert_eq!(sessions.len(), 2);
        for u in sessions {
            assert_eq!(u["name_style"], "custom-gradient");
            assert_eq!(u["nameplate_style"], "core-stripe");
            assert_eq!(u["name_color_secondary"], "#52cfc8");
            assert_eq!(u["name_gradient_direction"], "diagonal");
        }
        break;
    }

    // Um cliente antigo omite as duas propriedades novas. Valores inválidos também não as apagam.
    send(&mut desktop, json!({"type":"UpdateProfile","payload":{
        "name_color_secondary":"#12;display:none", "name_gradient_direction":"espiral", "bio":"Validação"
    }})).await;
    send(&mut desktop, json!({"type":"UpdateProfile","payload":{"bio":"Cliente antigo"}})).await;
    loop {
        let sync = wait_for(&mut desktop, "VoiceStateSync").await;
        if sync["users"].as_array().unwrap().iter().any(|u| u["bio"] == "Cliente antigo") { break; }
    }
    srv.state.read().await.db.clone().flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let st = reopened.read().await;
    let saved = &st.accounts["perfilgradiente"];
    assert_eq!(saved.nameplate_style.as_deref(), Some("core-stripe"));
    assert_eq!(saved.profile.name_color_secondary.as_deref(), Some("#52cfc8"));
    assert_eq!(saved.profile.name_gradient_direction.as_deref(), Some("diagonal"));
}
