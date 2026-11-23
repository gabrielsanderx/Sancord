//! Notas privadas. O dono vem exclusivamente da sessão validada.
use crate::{auth, db::Db, models::ServerMessage, state::SharedState, uploads};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, path::PathBuf, sync::Arc};
use uuid::Uuid;

const NOTE_BYTES: usize = 128 * 1024;
const ASSET_BYTES: usize = 10 * 1024 * 1024;
const FILE_QUOTA: usize = 250 * 1024 * 1024;
const MAX_NOTES: usize = 500;
const MAX_FOLDERS: usize = 100;
const MAX_ASSETS: usize = 24;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/sanoted", get(snapshot))
        .route(
            "/api/sanoted/notes/:id",
            get(get_note)
                .post(write_note)
                .layer(DefaultBodyLimit::max(NOTE_BYTES + 8192)),
        )
        .route(
            "/api/sanoted/folders/:id",
            post(write_folder).layer(DefaultBodyLimit::max(2048)),
        )
        .route(
            "/api/sanoted/notes/:note/assets/:asset",
            get(download)
                .post(upload)
                .layer(DefaultBodyLimit::max(ASSET_BYTES)),
        )
}

#[derive(Clone)]
struct Owner {
    id: String,
    db: Arc<Db>,
    data: PathBuf,
}

async fn owner(state: &SharedState, headers: &HeaderMap) -> Result<Owner, Response> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let mut st = state.write().await;
    let Some((_, account)) = st.validate_session(token) else {
        return Err(error(
            StatusCode::UNAUTHORIZED,
            "Entre novamente para acessar suas notas.",
        ));
    };
    if crate::email_verification::email_step(st.config.require_verified_email, &account).is_some() {
        return Err(error(
            StatusCode::FORBIDDEN,
            "Confirme seu e-mail para acessar o Sanoted.",
        ));
    }
    Ok(Owner {
        id: account.id,
        db: st.db.clone(),
        data: st.config.data_dir.clone(),
    })
}

async fn notify(state: &SharedState, owner: &str) {
    let st = state.read().await;
    for (uid, user) in &st.users {
        if st.account_id_for(&user.username.to_lowercase()).as_deref() == Some(owner) {
            st.send_to(uid, ServerMessage::SanotedChanged);
        }
    }
}

async fn run<T: Send + 'static>(
    owner: Owner,
    f: impl FnOnce(&Connection, &Owner) -> crate::db::DbResult<T> + Send + 'static,
) -> Result<T, Response> {
    match tokio::task::spawn_blocking(move || owner.db.with_reader(|db| f(db, &owner))).await {
        Ok(Ok(value)) => Ok(value),
        _ => {
            tracing::warn!("Falha ao acessar a persistência do Sanoted.");
            Err(error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Não foi possível acessar as notas agora. Tente novamente.",
            ))
        }
    }
}

fn error(code: StatusCode, message: &str) -> Response {
    (code, Json(json!({ "message": message }))).into_response()
}
fn json_response(value: Value) -> Response {
    ([(header::CACHE_CONTROL, "private, no-store")], Json(value)).into_response()
}
fn missing() -> Response {
    error(StatusCode::NOT_FOUND, "Item indisponível.")
}
fn uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn conflict<T: Serialize>(current: Option<T>) -> Response {
    let mut response = json_response(
        json!({ "current": current, "message": "O item mudou em outro dispositivo." }),
    );
    *response.status_mut() = StatusCode::CONFLICT;
    response
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum TextStyle {
    Paragraph,
    Heading,
    Subheading,
    Quote,
    Code,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Mark {
    Bold,
    Italic,
    Underline,
    Strike,
}
#[derive(Clone, Deserialize, Serialize)]
struct Span {
    text: String,
    #[serde(default)]
    marks: Vec<Mark>,
    #[serde(default)]
    href: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ListStyle {
    Bullet,
    Ordered,
    Checklist,
}
#[derive(Clone, Deserialize, Serialize)]
struct Item {
    spans: Vec<Span>,
    #[serde(default)]
    checked: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ImageSize {
    Small,
    Medium,
    Large,
    Full,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Block {
    Text {
        style: TextStyle,
        spans: Vec<Span>,
    },
    List {
        style: ListStyle,
        items: Vec<Item>,
    },
    Asset {
        asset_id: String,
        image: bool,
        size: ImageSize,
        caption: String,
        filename: String,
        bytes: u64,
    },
}

#[derive(Clone, Deserialize, Serialize)]
struct Note {
    id: String,
    version: u64,
    title: String,
    folder_id: Option<String>,
    pinned: bool,
    favorite: bool,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    preview: String,
    blocks: Vec<Block>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Folder {
    id: String,
    version: u64,
    name: String,
    parent_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Write<T> {
    base_version: u64,
    operation_id: String,
    item: Option<T>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NoteInput {
    title: String,
    folder_id: Option<String>,
    pinned: bool,
    favorite: bool,
    deleted: bool,
    blocks: Vec<Block>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FolderInput {
    name: String,
    parent_id: Option<String>,
}

const NOTE_LOOKUP: &str = "SELECT data, mutation FROM sanoted_notes WHERE owner=?1 AND id=?2";
const FOLDER_LOOKUP: &str = "SELECT data, mutation FROM sanoted_folders WHERE owner=?1 AND id=?2";

fn lookup<T: DeserializeOwned>(
    db: &Connection,
    sql: &str,
    owner: &str,
    id: &str,
) -> crate::db::DbResult<Option<(T, Option<String>)>> {
    let row: Option<(String, Option<String>)> = db
        .query_row(sql, params![owner, id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?;
    row.map(|(data, op)| Ok((serde_json::from_str(&data)?, op)))
        .transpose()
}

fn rows<T: DeserializeOwned>(
    db: &Connection,
    sql: &str,
    owner: &str,
) -> crate::db::DbResult<Vec<T>> {
    let mut stmt = db.prepare(sql)?;
    let data = stmt.query_map([owner], |row| row.get::<_, String>(0))?;
    data.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}

fn document_text(blocks: &[Block]) -> Result<String, &'static str> {
    if blocks.len() > 1500 || serde_json::to_vec(blocks).map_or(true, |v| v.len() > NOTE_BYTES) {
        return Err("A nota excede o limite de 128 KiB de texto formatado.");
    }
    let mut text = String::new();
    let mut assets = 0;
    fn append(text: &mut String, spans: &[Span]) -> Result<(), &'static str> {
        for span in spans {
            if span.marks.len() > 4
                || span.href.as_ref().is_some_and(|href| {
                    href.len() > 2048
                        || reqwest::Url::parse(href).map_or(true, |url| {
                            !matches!(url.scheme(), "http" | "https")
                                || !url.username().is_empty()
                                || url.password().is_some()
                        })
                })
            {
                return Err("A nota contém um link inválido.");
            }
            text.push_str(&span.text);
        }
        text.push('\n');
        Ok(())
    }
    for block in blocks {
        match block {
            Block::Text { spans, .. } => append(&mut text, spans)?,
            Block::List { items, .. } => {
                for item in items {
                    append(&mut text, &item.spans)?;
                }
            }
            Block::Asset {
                asset_id,
                caption,
                filename,
                bytes,
                ..
            } => {
                assets += 1;
                if !uuid(asset_id)
                    || caption.chars().count() > 250
                    || filename.chars().count() > 160
                    || *bytes > ASSET_BYTES as u64
                {
                    return Err("Anexo inválido na nota.");
                }
                text.push_str(filename);
                text.push(' ');
                text.push_str(caption);
                text.push('\n');
            }
        }
    }
    if assets > MAX_ASSETS {
        return Err("Cada nota pode ter até 24 anexos.");
    }
    Ok(text)
}

#[derive(Deserialize)]
struct Search {
    #[serde(default)]
    q: String,
}

async fn snapshot(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(search): Query<Search>,
) -> Response {
    let owner = match owner(&state, &headers).await {
        Ok(v) => v,
        Err(res) => return res,
    };
    let query = search
        .q
        .trim()
        .chars()
        .take(180)
        .collect::<String>()
        .to_lowercase();
    match run(owner, move |db, owner| {
        let folders: Vec<Folder> = rows(db, "SELECT data FROM sanoted_folders WHERE owner=?1", &owner.id)?;
        let folder_matches: HashSet<_> = folders.iter().filter(|f| f.name.to_lowercase().contains(&query)).map(|f| f.id.as_str()).collect();
        let mut stmt = db.prepare("SELECT json_remove(data, '$.blocks'), instr(search_text, ?2)>0 FROM sanoted_notes WHERE owner=?1")?;
        let values = stmt.query_map(params![owner.id, query], |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)))?;
        let mut notes = Vec::new();
        for item in values {
            let (raw, matched) = item?;
            let meta: Value = serde_json::from_str(&raw)?;
            if matched || meta["folder_id"].as_str().is_some_and(|id| folder_matches.contains(id)) { notes.push(meta); }
        }
        Ok(json!({"folders": folders, "notes": notes}))
    }).await { Ok(v) => json_response(v), Err(res) => res }
}

async fn get_note(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let owner = match owner(&state, &headers).await {
        Ok(v) => v,
        Err(res) => return res,
    };
    if !uuid(&id) {
        return missing();
    }
    match run(owner, move |db, owner| {
        lookup::<Note>(db, NOTE_LOOKUP, &owner.id, &id)
    })
    .await
    {
        Ok(Some((note, _))) => json_response(json!(note)),
        Ok(None) => missing(),
        Err(res) => res,
    }
}

async fn write_note(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(write): Json<Write<NoteInput>>,
) -> Response {
    let owner = match owner(&state, &headers).await {
        Ok(v) => v,
        Err(res) => return res,
    };
    if !uuid(&id) || !uuid(&write.operation_id) {
        return error(StatusCode::BAD_REQUEST, "Identificador inválido.");
    }
    let account = owner.id.clone();
    let result = run(owner, move |db, owner| save_note(db, owner, id, write)).await;
    match result {
        Ok((answer, true)) => {
            notify(&state, &account).await;
            answer
        }
        Ok((answer, false)) | Err(answer) => answer,
    }
}

fn save_note(
    db: &Connection,
    owner: &Owner,
    id: String,
    write: Write<NoteInput>,
) -> crate::db::DbResult<(Response, bool)> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let current = lookup::<Note>(&tx, NOTE_LOOKUP, &owner.id, &id)?;
    if let Some((note, Some(op))) = &current {
        if op == &write.operation_id {
            return Ok((json_response(json!(note)), false));
        }
    }
    let version = current.as_ref().map_or(0, |(note, _)| note.version);
    if write.item.is_none() && current.is_none() {
        return Ok((json_response(Value::Null), false));
    }
    if write.base_version != version {
        return Ok((conflict(current.map(|(note, _)| note)), false));
    }
    let Some(mut input) = write.item else {
        if !current.is_some_and(|(n, _)| n.deleted_at.is_some()) {
            return Ok((
                error(
                    StatusCode::BAD_REQUEST,
                    "Mova a nota para a lixeira antes de apagar definitivamente.",
                ),
                false,
            ));
        }
        let paths = {
            let mut stmt = tx
                .prepare("SELECT storage_id, ext FROM sanoted_assets WHERE owner=?1 AND note=?2")?;
            let list = stmt.query_map(params![owner.id, id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            list.collect::<Result<Vec<_>, _>>()?
        };
        tx.execute(
            "DELETE FROM sanoted_assets WHERE owner=?1 AND note=?2",
            params![owner.id, id],
        )?;
        tx.execute(
            "DELETE FROM sanoted_notes WHERE owner=?1 AND id=?2",
            params![owner.id, id],
        )?;
        tx.commit()?;
        for (storage, ext) in paths {
            let _ = std::fs::remove_file(uploads::disk_path(&owner.data, &storage, &ext));
        }
        return Ok((json_response(Value::Null), true));
    };
    if version == 0
        && tx.query_row(
            "SELECT count(*) FROM sanoted_notes WHERE owner=?1",
            [&owner.id],
            |r| r.get::<_, usize>(0),
        )? >= MAX_NOTES
    {
        return Ok((
            error(
                StatusCode::BAD_REQUEST,
                "Limite de 500 notas, incluindo a lixeira.",
            ),
            false,
        ));
    }
    if input.title.chars().count() > 160 {
        return Ok((
            error(
                StatusCode::BAD_REQUEST,
                "O título pode ter até 160 caracteres.",
            ),
            false,
        ));
    }
    if let Some(folder) = &input.folder_id {
        if lookup::<Folder>(&tx, FOLDER_LOOKUP, &owner.id, folder)?.is_none() {
            return Ok((
                error(
                    StatusCode::BAD_REQUEST,
                    "A pasta selecionada não está disponível.",
                ),
                false,
            ));
        }
    }
    for block in &mut input.blocks {
        if let Block::Asset {
            asset_id,
            image,
            filename,
            bytes,
            ..
        } = block
        {
            let Some(asset) = asset_record(&tx, &owner.id, &id, asset_id)? else {
                return Ok((
                    error(
                        StatusCode::BAD_REQUEST,
                        "Um anexo ainda não está disponível nesta nota.",
                    ),
                    false,
                ));
            };
            *image = asset.mime.starts_with("image/");
            *filename = asset.filename;
            *bytes = asset.size;
        }
    }
    let text = match document_text(&input.blocks) {
        Ok(text) => text,
        Err(msg) => return Ok((error(StatusCode::BAD_REQUEST, msg), false)),
    };
    let now = auth::now_ms();
    let note = Note {
        id,
        version: version + 1,
        title: input.title.trim().to_string(),
        folder_id: input.folder_id,
        pinned: input.pinned,
        favorite: input.favorite,
        created_at: current.as_ref().map_or(now, |(n, _)| n.created_at),
        updated_at: now,
        deleted_at: input
            .deleted
            .then(|| current.and_then(|(n, _)| n.deleted_at).unwrap_or(now)),
        preview: text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(140)
            .collect(),
        blocks: input.blocks,
    };
    let search = format!("{} {text}", note.title).to_lowercase();
    tx.execute("INSERT INTO sanoted_notes(owner,id,data,search_text,mutation) VALUES (?1,?2,?3,?4,?5)
       ON CONFLICT(owner,id) DO UPDATE SET data=excluded.data,search_text=excluded.search_text,mutation=excluded.mutation",
        params![owner.id, note.id, serde_json::to_string(&note)?, search, write.operation_id])?;
    tx.commit()?;
    Ok((json_response(json!(note)), true))
}

async fn write_folder(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(write): Json<Write<FolderInput>>,
) -> Response {
    let owner = match owner(&state, &headers).await {
        Ok(v) => v,
        Err(res) => return res,
    };
    if !uuid(&id) || !uuid(&write.operation_id) {
        return error(StatusCode::BAD_REQUEST, "Identificador inválido.");
    }
    let account = owner.id.clone();
    match run(owner, move |db, owner| save_folder(db, owner, id, write)).await {
        Ok((result, true)) => {
            notify(&state, &account).await;
            result
        }
        Ok((result, false)) | Err(result) => result,
    }
}

fn save_folder(
    db: &Connection,
    owner: &Owner,
    id: String,
    write: Write<FolderInput>,
) -> crate::db::DbResult<(Response, bool)> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    let current = lookup::<Folder>(&tx, FOLDER_LOOKUP, &owner.id, &id)?;
    if let Some((folder, Some(op))) = &current {
        if op == &write.operation_id {
            return Ok((json_response(json!(folder)), false));
        }
    }
    let version = current.as_ref().map_or(0, |(f, _)| f.version);
    if write.item.is_none() && current.is_none() {
        return Ok((json_response(Value::Null), false));
    }
    if version != write.base_version {
        return Ok((conflict(current.map(|(folder, _)| folder)), false));
    }
    let Some(input) = write.item else {
        let parent = current.and_then(|(folder, _)| folder.parent_id);
        tx.execute("UPDATE sanoted_folders SET data=json_set(data,'$.parent_id',?3,'$.version',json_extract(data,'$.version')+1),mutation=NULL WHERE owner=?1 AND json_extract(data,'$.parent_id')=?2", params![owner.id, id, parent])?;
        tx.execute("UPDATE sanoted_notes SET data=json_set(data,'$.folder_id',?3,'$.version',json_extract(data,'$.version')+1),mutation=NULL WHERE owner=?1 AND json_extract(data,'$.folder_id')=?2", params![owner.id, id, parent])?;
        tx.execute(
            "DELETE FROM sanoted_folders WHERE owner=?1 AND id=?2",
            params![owner.id, id],
        )?;
        tx.commit()?;
        return Ok((json_response(Value::Null), true));
    };
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Ok((
            error(
                StatusCode::BAD_REQUEST,
                "Use um nome de pasta com até 80 caracteres.",
            ),
            false,
        ));
    }
    let mut ancestor = input.parent_id.clone();
    let mut visited = HashSet::from([id.clone()]);
    while let Some(parent) = ancestor {
        if !visited.insert(parent.clone()) {
            return Ok((
                error(
                    StatusCode::BAD_REQUEST,
                    "Uma pasta não pode ficar dentro de si mesma.",
                ),
                false,
            ));
        }
        let Some((folder, _)) = lookup::<Folder>(&tx, FOLDER_LOOKUP, &owner.id, &parent)? else {
            return Ok((missing(), false));
        };
        ancestor = folder.parent_id;
    }
    if version == 0
        && tx.query_row(
            "SELECT count(*) FROM sanoted_folders WHERE owner=?1",
            [&owner.id],
            |r| r.get::<_, usize>(0),
        )? >= MAX_FOLDERS
    {
        return Ok((
            error(StatusCode::BAD_REQUEST, "Limite de 100 pastas."),
            false,
        ));
    }
    let folder = Folder {
        id,
        version: version + 1,
        name: name.to_string(),
        parent_id: input.parent_id,
    };
    tx.execute(
        "INSERT INTO sanoted_folders(owner,id,data,mutation) VALUES (?1,?2,?3,?4)
       ON CONFLICT(owner,id) DO UPDATE SET data=excluded.data,mutation=excluded.mutation",
        params![
            owner.id,
            folder.id,
            serde_json::to_string(&folder)?,
            write.operation_id
        ],
    )?;
    tx.commit()?;
    Ok((json_response(json!(folder)), true))
}

#[derive(Serialize)]
struct Asset {
    #[serde(skip)]
    storage: String,
    #[serde(skip)]
    ext: String,
    filename: String,
    mime: String,
    size: u64,
}

fn asset_record(
    db: &Connection,
    owner: &str,
    note: &str,
    id: &str,
) -> crate::db::DbResult<Option<Asset>> {
    Ok(db.query_row("SELECT storage_id,ext,filename,mime,size FROM sanoted_assets WHERE owner=?1 AND note=?2 AND id=?3",
        params![owner, note, id], |r| Ok(Asset { storage: r.get(0)?, ext: r.get(1)?, filename: r.get(2)?, mime: r.get(3)?, size: r.get(4)? })).optional()?)
}

#[derive(Deserialize)]
struct Upload {
    #[serde(default)]
    filename: String,
}

async fn upload(
    State(state): State<SharedState>,
    Path((note, id)): Path<(String, String)>,
    Query(query): Query<Upload>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let owner = match owner(&state, &headers).await {
        Ok(v) => v,
        Err(res) => return res,
    };
    if !uuid(&note) || !uuid(&id) {
        return missing();
    }
    if body.is_empty() || body.len() > ASSET_BYTES {
        return error(StatusCode::BAD_REQUEST, "O anexo deve ter até 10 MiB.");
    }
    let (mime, _, ext) = uploads::sniff(&body);
    let valid = match ext {
        "png" | "jpg" | "webp" | "gif" => valid_image(&body, mime, ext),
        "pdf" => body.starts_with(b"%PDF-") && body.trim_ascii_end().ends_with(b"%%EOF"),
        "txt" => std::str::from_utf8(&body).is_ok() && !body.contains(&0),
        _ => false,
    };
    if !valid {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Use PNG, JPEG, WebP, GIF, PDF ou texto UTF-8 válido.",
        );
    }
    let data = owner.data.clone();
    let filename = uploads::sanitize_filename(&query.filename, ext);
    let filename = PathBuf::from(filename)
        .with_extension(ext)
        .to_string_lossy()
        .into_owned();
    let asset = Asset {
        storage: Uuid::new_v4().simple().to_string(),
        ext: ext.into(),
        filename,
        mime: mime.into(),
        size: body.len() as u64,
    };
    let path = uploads::disk_path(&data, &asset.storage, &asset.ext);
    let saved = run(owner, move |db, owner| {
        let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
        if let Some(existing) = asset_record(&tx, &owner.id, &note, &id)? { return Ok(json_response(json!(existing))); }
        let bytes: usize = tx.query_row("SELECT coalesce(sum(size),0) FROM sanoted_assets WHERE owner=?1", [&owner.id], |r| r.get(0))?;
        let count: usize = tx.query_row("SELECT count(*) FROM sanoted_assets WHERE owner=?1 AND note=?2", params![owner.id, note], |r| r.get(0))?;
        if bytes + body.len() > FILE_QUOTA || count >= MAX_ASSETS {
            return Ok(error(StatusCode::BAD_REQUEST, "Limite de 250 MiB por conta ou 24 anexos por nota atingido."));
        }
        uploads::write_file(&path, &body)?;
        let result = tx.execute("INSERT INTO sanoted_assets(owner,note,id,storage_id,ext,filename,mime,size) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![owner.id, note, id, asset.storage, asset.ext, asset.filename, asset.mime, asset.size]).and_then(|_| tx.commit());
        if let Err(err) = result { let _ = std::fs::remove_file(&path); return Err(err.into()); }
        Ok(json_response(json!(asset)))
    }).await;
    saved.unwrap_or_else(|res| res)
}

fn valid_image(bytes: &[u8], mime: &str, ext: &str) -> bool {
    let bounds_ok = uploads::image_dimensions(bytes, mime).is_some_and(|(w, h)| {
        w > 0 && h > 0 && w <= 10000 && h <= 10000 && u64::from(w) * u64::from(h) <= 36_000_000
    });
    bounds_ok
        && match ext {
            "png" => {
                bytes.get(8..16) == Some(b"\0\0\0\rIHDR")
                    && bytes.ends_with(b"\0\0\0\0IEND\xaeB\x60\x82")
            }
            "jpg" => bytes.ends_with(b"\xff\xd9"),
            "webp" => bytes
                .get(4..8)
                .and_then(|size| size.try_into().ok())
                .is_some_and(|size| u32::from_le_bytes(size) as u64 + 8 == bytes.len() as u64),
            "gif" => bytes.len() > 20 && bytes.ends_with(b";"),
            _ => false,
        }
}

async fn download(
    State(state): State<SharedState>,
    Path((note, id)): Path<(String, String)>,
    req: Request<Body>,
) -> Response {
    let owner = match owner(&state, req.headers()).await {
        Ok(v) => v,
        Err(res) => return res,
    };
    if !uuid(&note) || !uuid(&id) {
        return missing();
    }
    let data = owner.data.clone();
    match run(owner, move |db, owner| {
        asset_record(db, &owner.id, &note, &id)
    })
    .await
    {
        Ok(Some(a)) => {
            uploads::serve_file(
                uploads::disk_path(&data, &a.storage, &a.ext),
                req,
                &a.filename,
                &a.mime,
                a.mime.starts_with("image/"),
                true,
            )
            .await
        }
        Ok(None) => missing(),
        Err(res) => res,
    }
}
