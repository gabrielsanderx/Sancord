use super::{connect, register, send, start_server, start_server_in, wait_for, TestServer};
use axum::{
    body::{to_bytes, Body},
    http::{header, Method, Request, StatusCode},
    response::Response,
};
use futures::StreamExt;
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;

fn id() -> String {
    Uuid::new_v4().to_string()
}

async fn call(
    server: &TestServer,
    method: Method,
    path: &str,
    token: &str,
    body: impl Into<Body>,
) -> Response {
    server
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(body.into())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn body(response: Response) -> Value {
    let bytes = to_bytes(response.into_body(), 512 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn note(title: &str, folder: Option<&str>, deleted: bool) -> Value {
    json!({ "title": title, "folder_id": folder, "favorite": true, "pinned": true, "deleted": deleted, "blocks": [
        {"type": "text", "style": "quote", "spans": [{"text": "preço SSD", "marks": ["bold"], "href": "https://example.com/"}]},
        {"type": "list", "style": "checklist", "items": [{"spans": [{"text": "Comparar preços"}], "checked": true}]}
    ] })
}

fn mutation(version: u64, item: Value) -> Value {
    json!({"base_version": version, "operation_id": id(), "item": item})
}

async fn write(
    server: &TestServer,
    path: &str,
    token: &str,
    write: &Value,
    expected: u16,
) -> Value {
    let response = call(server, Method::POST, path, token, write.to_string()).await;
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 512 * 1024).await.unwrap();
    assert_eq!(status, expected, "{}", String::from_utf8_lossy(&bytes));
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

#[tokio::test]
async fn private_owner_revision_search_trash_and_restart() {
    let server = start_server().await;
    let owner = register(&server, "SanotedOwner").await;
    let other = register(&server, "SanotedOther").await;
    let mut own_ws = connect(&server, &owner).await;
    let mut other_ws = connect(&server, &other).await;
    let account = wait_for(&mut own_ws, "Welcome").await["account_id"].clone();
    assert!(account.is_string());
    assert_ne!(
        account,
        wait_for(&mut other_ws, "Welcome").await["account_id"]
    );
    let folder = id();
    let folder_path = format!("/api/sanoted/folders/{folder}");
    let note_path = format!("/api/sanoted/notes/{}", id());
    write(
        &server,
        &folder_path,
        &owner,
        &mutation(0, json!({"name": "Compras", "parent_id": null})),
        200,
    )
    .await;
    assert!(wait_for(&mut own_ws, "SanotedChanged").await.is_null());
    send(&mut other_ws, json!({"type": "Ping"})).await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while let Some(Ok(message)) = other_ws.next().await {
            if let Ok(text) = message.into_text() {
                if let Ok(event) = serde_json::from_str::<Value>(&text) {
                    assert_ne!(event["type"], "SanotedChanged");
                    if event["type"] == "Pong" {
                        return;
                    }
                }
            }
        }
        panic!("WebSocket da segunda conta fechou antes do Pong");
    })
    .await
    .unwrap();
    let create = mutation(0, note("Lembrar", Some(&folder), false));
    let created = write(&server, &note_path, &owner, &create, 200).await;
    assert_eq!(created["version"], 1);
    assert_eq!(
        write(&server, &note_path, &owner, &create, 200).await,
        created
    );

    for search in ["lembrar", "SSD", "compras"] {
        let path = format!("/api/sanoted?q={search}");
        let response = call(&server, Method::GET, &path, &owner, Body::empty()).await;
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
        let hits = body(response).await;
        assert_eq!(hits["notes"][0]["id"], created["id"]);
        assert!(hits["notes"][0].get("blocks").is_none());
        let foreign = body(call(&server, Method::GET, &path, &other, Body::empty()).await).await;
        assert_eq!(foreign, json!({"notes": [], "folders": []}));
    }
    assert_eq!(
        call(&server, Method::GET, &note_path, "", Body::empty())
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&server, Method::GET, &note_path, &other, Body::empty())
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let mut forged = mutation(1, note("Forjado", None, false));
    forged["user_id"] = account;
    write(&server, &note_path, &other, &forged, 422).await;
    let mut nested = mutation(1, note("Forjado", None, false));
    nested["item"]["user_id"] = forged["user_id"].clone();
    write(&server, &note_path, &other, &nested, 422).await;
    let foreign = write(
        &server,
        &note_path,
        &other,
        &mutation(1, note("Forjado", None, false)),
        409,
    )
    .await;
    assert!(foreign["current"].is_null());
    write(
        &server,
        &folder_path,
        &other,
        &mutation(1, json!({"name": "Forjado"})),
        409,
    )
    .await;

    let edited = write(
        &server,
        &note_path,
        &owner,
        &mutation(1, note("Comprar SSD", Some(&folder), false)),
        200,
    )
    .await;
    assert_eq!(edited["version"], 2);
    let conflict = write(
        &server,
        &note_path,
        &owner,
        &mutation(1, note("Revisão antiga", None, false)),
        409,
    )
    .await;
    assert_eq!(conflict["current"], edited);
    write(&server, &note_path, &owner, &mutation(2, Value::Null), 400).await;
    let trashed = write(
        &server,
        &note_path,
        &owner,
        &mutation(2, note("Comprar SSD", Some(&folder), true)),
        200,
    )
    .await;
    assert!(trashed["deleted_at"].is_number());
    let restored = write(
        &server,
        &note_path,
        &owner,
        &mutation(3, note("Comprar SSD", Some(&folder), false)),
        200,
    )
    .await;
    assert!(restored["deleted_at"].is_null());
    let reopened = start_server_in(server.dir.clone()).await;
    let saved = body(call(&reopened, Method::GET, &note_path, &owner, Body::empty()).await).await;
    assert_eq!(saved, restored);
    assert_eq!(saved["blocks"][1]["items"][0]["checked"], true);
}

#[tokio::test]
async fn private_asset_validation_folder_move_and_permanent_deletion() {
    let server = start_server().await;
    let owner = register(&server, "MediaOwner").await;
    let other = register(&server, "MediaOther").await;
    let note_path = format!("/api/sanoted/notes/{}", id());
    let asset = id();
    let download_path = format!("{note_path}/assets/{asset}");
    let upload_path = format!("{download_path}?filename=print.svg");
    let png = hex::decode("89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082").unwrap();
    assert_eq!(
        call(
            &server,
            Method::POST,
            &upload_path,
            &owner,
            &b"\0invalid"[..]
        )
        .await
        .status(),
        415
    );
    assert_eq!(
        call(
            &server,
            Method::POST,
            &upload_path,
            &owner,
            png[..24].to_vec()
        )
        .await
        .status(),
        415
    );
    assert_eq!(
        call(
            &server,
            Method::POST,
            &upload_path,
            &owner,
            vec![0u8; 10 * 1024 * 1024 + 1]
        )
        .await
        .status(),
        413
    );
    let first = body(call(&server, Method::POST, &upload_path, &owner, png.clone()).await).await;
    assert_eq!(first["mime"], "image/png");
    assert!(first["filename"].as_str().unwrap().ends_with(".png"));
    assert_eq!(
        body(call(&server, Method::POST, &upload_path, &owner, png.clone()).await).await,
        first
    );
    let download = call(&server, Method::GET, &download_path, &owner, Body::empty()).await;
    assert_eq!(download.headers()[header::CONTENT_TYPE], "image/png");
    assert!(download.headers()[header::CACHE_CONTROL]
        .to_str()
        .unwrap()
        .contains("no-store"));
    assert_eq!(
        to_bytes(download.into_body(), 1024).await.unwrap().as_ref(),
        png
    );
    assert_eq!(
        call(&server, Method::GET, &download_path, &other, Body::empty())
            .await
            .status(),
        404
    );
    assert_eq!(
        call(&server, Method::GET, &download_path, "", Body::empty())
            .await
            .status(),
        401
    );

    let parent = id();
    let parent_path = format!("/api/sanoted/folders/{parent}");
    let child = id();
    let child_path = format!("/api/sanoted/folders/{child}");
    write(
        &server,
        &parent_path,
        &owner,
        &mutation(0, json!({"name": "Raiz"})),
        200,
    )
    .await;
    write(
        &server,
        &child_path,
        &owner,
        &mutation(0, json!({"name": "Fotos", "parent_id":parent})),
        200,
    )
    .await;
    write(
        &server,
        &parent_path,
        &owner,
        &mutation(1, json!({"name": "Raiz", "parent_id":child})),
        400,
    )
    .await;
    let mut item = note("Screenshot", Some(&child), false);
    item["blocks"].as_array_mut().unwrap().push(json!({
        "type": "asset", "asset_id": asset, "image": false, "size": "large", "caption":"Legenda", "filename":"fake.html","bytes": 1
    }));
    let mut foreign_item = item.clone();
    foreign_item["folder_id"] = Value::Null;
    write(&server, &note_path, &other, &mutation(0, foreign_item), 400).await;
    let public_path = format!("/api/attachments/{asset}/print.png");
    assert_eq!(
        call(&server, Method::GET, &public_path, &owner, Body::empty())
            .await
            .status(),
        404
    );
    let saved = write(&server, &note_path, &owner, &mutation(0, item.clone()), 200).await;
    assert_eq!(saved["blocks"][2]["image"], true);
    assert_eq!(saved["blocks"][2]["filename"], first["filename"]);
    write(&server, &child_path, &owner, &mutation(1, Value::Null), 200).await;
    let moved = body(call(&server, Method::GET, &note_path, &owner, Body::empty()).await).await;
    assert_eq!(moved["folder_id"], parent);
    assert_eq!(moved["version"], 2);
    item["folder_id"] = json!(parent);
    item["deleted"] = json!(true);
    write(&server, &note_path, &owner, &mutation(2, item), 200).await;
    write(&server, &note_path, &owner, &mutation(3, Value::Null), 200).await;
    assert_eq!(
        call(&server, Method::GET, &download_path, &owner, Body::empty())
            .await
            .status(),
        404
    );
    assert_eq!(
        call(&server, Method::GET, &note_path, &owner, Body::empty())
            .await
            .status(),
        404
    );
}
