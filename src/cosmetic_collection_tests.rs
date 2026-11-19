use super::*;

async fn collection_feedback(ws: &mut Ws) -> Value {
    loop {
        let feedback = wait_for(ws, "ServerFeedback").await;
        if feedback["action"] == "cosmetic_collection" {
            return feedback;
        }
    }
}

#[tokio::test]
async fn favorites_seen_and_presets_are_private_persistent_and_shared_by_own_sessions() {
    let srv = start_server().await;
    let token = register(&srv, "ColecaoDona").await;
    let mut owner = connect(&srv, &token).await;
    wait_for(&mut owner, "Welcome").await;
    let initial = wait_for(&mut owner, "CosmeticsState").await;
    assert_eq!(initial["collection"]["favorites"], json!([]));
    let mut second = connect(&srv, &token).await;
    wait_for(&mut second, "Welcome").await;
    wait_for(&mut second, "CosmeticsState").await;
    let guest_token = register(&srv, "VisitaColecao").await;
    let mut guest = connect(&srv, &guest_token).await;
    wait_for(&mut guest, "Welcome").await;
    assert_eq!(
        wait_for(&mut guest, "CosmeticsState").await["collection"]["presets"],
        json!([])
    );

    send(&mut owner, json!({"type":"SetCosmeticFavorite","payload":{"key":"profile_frame:founder","favorite":true}})).await;
    assert_eq!(collection_feedback(&mut owner).await["ok"], false);
    send(&mut owner, json!({"type":"SetCosmeticFavorite","payload":{"key":"profile_frame:core-pulse","favorite":true}})).await;
    let update = wait_for(&mut owner, "CosmeticCollectionUpdated").await;
    assert_eq!(
        update["collection"]["favorites"],
        json!(["profile_frame:core-pulse"])
    );
    assert_eq!(
        wait_for(&mut second, "CosmeticCollectionUpdated").await,
        update
    );
    send(
        &mut owner,
        json!({"type":"MarkCosmeticsSeen","payload":{"key":"profile_frame:core-pulse"}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut owner, "CosmeticCollectionUpdated").await["collection"]["seen"],
        json!(["profile_frame:core-pulse"])
    );
    send(&mut owner, json!({"type":"MarkCosmeticsSeen","payload":{}})).await;
    let marked =
        wait_for(&mut owner, "CosmeticCollectionUpdated").await["collection"]["seen"].clone();
    assert!(marked
        .as_array()
        .unwrap()
        .iter()
        .any(|key| key == "profile_effect:core-signal"));
    assert!(marked
        .as_array()
        .unwrap()
        .iter()
        .all(|key| key != "profile_frame:founder"));

    send(&mut owner, json!({"type":"UpdateProfile","payload":{
        "status_kind":"idle","custom_status":"Em QA","bio":"Minha bio","display_name":"Nome global"
    }})).await;
    send(&mut owner, json!({"type":"SaveProfilePreset","payload":{"name":" Core ","appearance":{
        "avatar_decoration":"core-orbit","profile_frame":"core-pulse","profile_effect":"core-signal",
        "nameplate_style":"core-stripe","name_style":"custom-gradient","name_color":"#12ABCD",
        "name_color_secondary":"#34cdef","name_gradient_direction":"radial",
        "theme_primary":"#123456","theme_accent":"#345678","theme_mode":"gradient","theme_direction":"horizontal"
    }}})).await;
    let saved = wait_for(&mut owner, "CosmeticCollectionUpdated").await["collection"].clone();
    let preset = &saved["presets"][0];
    assert_eq!(preset["name"], "Core");
    assert_eq!(preset["appearance"]["name_color"], "#12abcd");
    let id = preset["id"].as_str().unwrap();
    assert!(srv.state.read().await.accounts["colecaodona"]
        .profile
        .profile_frame
        .is_none());

    send(
        &mut guest,
        json!({"type":"EquipProfileLook","payload":{"choice":{"kind":"preset","id":id}}}),
    )
    .await;
    assert_eq!(collection_feedback(&mut guest).await["ok"], false);
    send(
        &mut owner,
        json!({"type":"EquipProfileLook","payload":{"choice":{"kind":"preset","id":id}}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut owner, "ProfileLookApplied").await["appearance"],
        preset["appearance"]
    );
    loop {
        let sync = wait_for(&mut second, "VoiceStateSync").await;
        if sync["users"].as_array().unwrap().iter().any(|user| {
            user["username"] == "ColecaoDona"
                && user["profile_frame"] == "core-pulse"
                && user["name_style"] == "custom-gradient"
        }) {
            break;
        }
    }
    send(
        &mut guest,
        json!({"type":"GetUserProfile","payload":{"username":"ColecaoDona"}}),
    )
    .await;
    let profile = wait_for_any(&mut guest, &["UserProfile", "CosmeticCollectionUpdated"]).await;
    assert_eq!(profile["type"], "UserProfile");
    let user = &profile["payload"]["user"];
    assert_eq!(user["theme_primary"], "#123456");
    assert_eq!(user["profile_frame"], "core-pulse");
    assert_eq!(user["bio"], "Minha bio");
    assert_eq!(user["display_name"], "Nome global");
    assert!(user.get("cosmetic_collection").is_none());

    let db = srv.state.read().await.db.clone();
    db.flush();
    let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
    let state = reopened.read().await;
    let account = &state.accounts["colecaodona"];
    assert_eq!(
        serde_json::to_value(&account.cosmetic_collection).unwrap(),
        saved
    );
    assert_eq!(account.status_kind, "idle");
    assert_eq!(account.custom_status.as_deref(), Some("Em QA"));
    assert_eq!(account.profile_effect.as_deref(), Some("core-signal"));
    drop(state);

    send(
        &mut owner,
        json!({"type":"DeleteProfilePreset","payload":{"id":id}}),
    )
    .await;
    assert_eq!(
        wait_for(&mut owner, "CosmeticCollectionUpdated").await["collection"]["presets"],
        json!([])
    );
}

#[tokio::test]
async fn applying_a_preset_rechecks_revoked_items_and_keeps_the_previous_look_on_error() {
    let srv = start_server().await;
    let token = register(&srv, "ColecaoRevisao").await;
    let mut owner = connect(&srv, &token).await;
    wait_for(&mut owner, "Welcome").await;
    srv.state
        .write()
        .await
        .accounts
        .get_mut("colecaorevisao")
        .unwrap()
        .inventory
        .push("profile_frame:winter-2026".into());
    send(
        &mut owner,
        json!({"type":"SaveProfilePreset","payload":{"name":"Inverno","appearance":{
            "profile_frame":"winter-2026","avatar_decoration":"core-orbit","theme_primary":"#789abc"
        }}}),
    )
    .await;
    let update = wait_for(&mut owner, "CosmeticCollectionUpdated").await;
    let id = &update["collection"]["presets"][0]["id"];
    assert_eq!(collection_feedback(&mut owner).await["ok"], true);
    srv.state
        .write()
        .await
        .accounts
        .get_mut("colecaorevisao")
        .unwrap()
        .inventory
        .clear();
    send(
        &mut owner,
        json!({"type":"EquipProfileLook","payload":{"choice":{"kind":"preset","id":id}}}),
    )
    .await;
    assert_eq!(collection_feedback(&mut owner).await["ok"], false);
    send(
        &mut owner,
        json!({"type":"EquipProfileLook","payload":{"choice":{"kind":"custom","appearance":{
            "profile_frame":"core-pulse","theme_primary":"red"
        }}}}),
    )
    .await;
    assert_eq!(collection_feedback(&mut owner).await["ok"], false);
    let state = srv.state.read().await;
    let account = &state.accounts["colecaorevisao"];
    assert!(account.profile.profile_frame.is_none());
    assert!(account.avatar_decoration.is_none());
    assert!(account.theme_primary.is_none());
}
