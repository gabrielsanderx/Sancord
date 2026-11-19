//! Etapa C7 — GIFs favoritos (sem serviço externo): validação, sincronização e reenvio.
use super::*;

fn tiny_gif() -> Vec<u8> {
    let mut gif = b"GIF89a".to_vec();
    gif.extend_from_slice(&40u16.to_le_bytes());
    gif.extend_from_slice(&30u16.to_le_bytes());
    gif.extend_from_slice(&[0, 0, 0, 0x3B]);
    gif
}

async fn att(srv: &TestServer, token: &str, name: &str, bytes: Vec<u8>) -> String {
    let (status, body) = upload(srv, token, name, bytes).await;
    assert_eq!(status, 200, "{body}");
    body["attachment"]["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn favorite_gifs_are_validated_synced_and_resendable() {
    let srv = start_server().await;
    let token = register(&srv, "GifDona").await;
    let mut a = connect(&srv, &token).await;
    wait_for(&mut a, "Welcome").await;
    send(&mut a, json!({"type":"CreateServer","payload":{"name":"Gifs","template":"friends"}})).await;
    let server = wait_for(&mut a, "ServerCreated").await["server"].clone();
    let geral = server["text_channels"][0]["id"].as_str().unwrap().to_string();

    let gif = att(&srv, &token, "dança.gif", tiny_gif()).await;
    let gif2 = att(&srv, &token, "outro.gif", tiny_gif()).await;
    let png = att(&srv, &token, "foto.png", tiny_png()).await;

    // Repetido, PNG, inexistente e ID malformado ficam de fora; a ordem é mantida.
    send(&mut a, json!({"type":"UpdateUserPrefs","payload":{"favorite_gifs":[gif2, gif, gif2, png, "0".repeat(32), "../x"]}})).await;
    let prefs = wait_for(&mut a, "UserPrefsUpdated").await["prefs"].clone();
    assert_eq!(prefs["favorite_gifs"], json!([gif2, gif]));

    // Outra conexão da mesma conta recebe; sobrevive a reinício.
    let mut b = connect(&srv, &token).await;
    assert_eq!(wait_for(&mut b, "Welcome").await["prefs"]["favorite_gifs"], json!([gif2, gif]));
    let db = srv.state.read().await.db.clone();
    db.flush();
    {
        let reopened = crate::state::ServerState::load(Config::for_tests(srv.dir.clone())).unwrap();
        let st = reopened.read().await;
        let acc = st.accounts.get("gifdona").unwrap().id.clone();
        assert_eq!(st.user_prefs[&acc].favorite_gifs, vec![gif2.clone(), gif.clone()]);
    }

    // Outra pessoa que recebeu o GIF reenvia pelo ID, como faz o seletor.
    let (mut ana, _) = join_with(&srv, "GifAna", server["invite_code"].as_str().unwrap()).await;
    let nonce = uuid::Uuid::new_v4().to_string();
    send(&mut ana, json!({"type":"SendChat","payload":{"channel_id":geral,"content":"","attachment_ids":[gif],"nonce":nonce}})).await;
    let sent = loop {
        let v = wait_for_any(&mut ana, &["NewChatMessage", "SendFailed"]).await;
        if v["payload"]["message"]["nonce"] == nonce.as_str() || v["payload"]["nonce"] == nonce.as_str() {
            break v;
        }
    };
    assert_eq!(sent["type"], "NewChatMessage", "{sent}");
    assert_eq!(sent["payload"]["message"]["attachments"][0]["id"], gif.as_str());
    assert_eq!(sent["payload"]["message"]["attachments"][0]["content_type"], "image/gif");
}

#[test]
fn favorite_gif_cap() {
    let many: Vec<String> = (0..300).map(|i| format!("{i:032x}")).collect();
    let kept = crate::models::UserPrefs::sanitize_favorite_gifs(many, |_| true);
    assert_eq!(kept.len(), crate::models::UserPrefs::MAX_FAVORITE_GIFS);
    assert_eq!(kept[0], format!("{:032x}", 0));
}
