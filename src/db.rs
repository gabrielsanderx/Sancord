//! Persistência em SQLite.
//!
//! Arquitetura:
//! - **Escrita**: uma thread dedicada recebe `WriteOp` por um canal e aplica em
//!   lotes, cada lote numa transação. Os handlers WebSocket só enfileiram a
//!   operação (custo ~zero), então nenhum I/O de disco acontece com o lock do
//!   estado segurado nem na thread do runtime async. Antes, cada mensagem
//!   reescrevia `chat_history.json` inteiro de forma síncrona.
//! - **Leitura**: uma conexão separada (WAL permite leitura concorrente com a
//!   escrita), usada no carregamento inicial e, via `spawn_blocking`, para
//!   paginação de histórico.
//!
//! Esquema (v2):
//! - normalizados: `messages`, `sessions`, `servers`, `categories`, `channels`,
//!   `server_members`, `roles`, `member_roles`, `bans`, `invites`, `user_prefs`;
//! - ainda em documento JSON (normalização prevista na fase Social): `users`
//!   e as amizades (`kv`).
//!
//! Gravação de servidor: o estado em memória continua sendo um `GuildServer`;
//! quando ele muda, `ReplaceServer` regrava as linhas daquele servidor numa
//! transação (servidores são pequenos, então isso é barato e evita centenas de
//! operações de diff espalhadas pelo código).

use crate::models::{
    Account, Category, Channel, ChannelKind, ChatMessage, FriendsStore, GuildServer, Invite,
    RolePermissions, ServerRole, UserPrefs,
};
use crate::validate::{is_hex_color, sanitize_stored_image, MAX_CHAT_IMAGE_BYTES, MAX_PROFILE_IMAGE_BYTES};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread::JoinHandle;
use tracing::{error, info, warn};

pub const SCHEMA_VERSION: i64 = 13;

/// Metadados de um arquivo enviado (o conteúdo fica em `data/uploads/`).
#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentRecord {
    pub id: String,
    pub uploader_id: String,
    pub uploader_lower: String,
    pub filename: String,
    pub content_type: String,
    pub kind: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub sha256: String,
    /// extensão do arquivo em disco (derivada do conteúdo, não do nome enviado)
    pub ext: String,
    pub created_at: i64,
}

impl AttachmentRecord {
    pub fn to_public(&self) -> crate::models::Attachment {
        crate::models::Attachment {
            id: self.id.clone(),
            filename: self.filename.clone(),
            content_type: self.content_type.clone(),
            kind: self.kind.clone(),
            size: self.size,
            width: self.width,
            height: self.height,
            url: format!(
                "/api/attachments/{}/{}",
                self.id,
                crate::uploads::url_encode_component(&self.filename)
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ReadState {
    pub last_read_at: i64,
    pub mention_count: u32,
}
const KV_FRIENDS: &str = "friends_store";

#[derive(Debug)]
pub enum DbError {
    Sql(rusqlite::Error),
    Json(serde_json::Error),
    Io(std::io::Error),
    Closed,
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Sql(e) => write!(f, "erro SQLite: {e}"),
            DbError::Json(e) => write!(f, "erro de serialização: {e}"),
            DbError::Io(e) => write!(f, "erro de I/O: {e}"),
            DbError::Closed => write!(f, "banco de dados fechado"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sql(e)
    }
}
impl From<serde_json::Error> for DbError {
    fn from(e: serde_json::Error) -> Self {
        DbError::Json(e)
    }
}
impl From<std::io::Error> for DbError {
    fn from(e: std::io::Error) -> Self {
        DbError::Io(e)
    }
}

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRecord {
    pub token_hash: String,
    pub user_id: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
    pub remember: bool,
}

/// Operações de escrita enfileiradas para a thread do banco.
#[derive(Debug)]
pub enum WriteOp {
    UpsertIntegration(Box<crate::integrations::Integration>),
    DeleteIntegration { id: String },
    UpsertUser { id: String, username_lower: String, data: String },
    /// Regrava todas as linhas de um servidor (dados, categorias, canais, membros, cargos, bans).
    ReplaceServer(Box<GuildServer>),
    DeleteServer { id: String },
    UpsertInvite(Invite),
    DeleteInvite { code: String },
    PutUserPrefs { user_id: String, data: String },
    InsertAttachment(Box<AttachmentRecord>),
    UpsertReadState { user_id: String, channel_id: String, state: ReadState },
    DeleteReadStatesForChannel { channel_id: String },
    RenameReadStatesChannel { from: String, to: String },
    UpsertGroupDm(Box<crate::models::GroupDm>),
    DeleteGroupDm { id: String },
    InsertReport { id: String, reporter: String, target: String, message_id: Option<String>, reason: String, created_at: i64 },
    InsertAudit(Box<crate::models::AuditEntry>),
    UpsertEvent(Box<crate::models::ServerEvent>),
    UpsertThread(Box<crate::models::Thread>),
    DeleteThread { id: String },
    DeleteEvent { id: String },
    PutAutoMod { server_id: String, data: String },
    /// Moderação de voz; muted=false e deafened=false apaga a linha.
    SetVoiceModeration { server_id: String, user_lower: String, muted: bool, deafened: bool },
    RenameVoiceModeration { from: String, to: String },
    /// Castigo de membro; `until_ms` = None apaga a linha.
    SetMemberTimeout { server_id: String, user_lower: String, until_ms: Option<i64> },
    RenameMemberTimeout { from: String, to: String },
    UpsertMessage(Box<ChatMessage>),
    DeleteMessage { id: String },
    DeleteChannelMessages { channel_id: String },
    /// Usado quando um usuário muda de nome: IDs de DM contêm o username.
    RenameChannel { from: String, to: String },
    PutKv { key: String, value: String },
    InsertSession(SessionRecord),
    TouchSession { token_hash: String, last_seen_at: i64, expires_at: i64 },
    DeleteSession { token_hash: String },
    DeleteUserSessionsExcept { user_id: String, keep_token_hash: Option<String> },
    DeleteExpiredSessions { now: i64 },
    /// Responde quando todas as operações anteriores foram gravadas.
    Barrier(mpsc::Sender<()>),
    Shutdown(mpsc::Sender<()>),
}

pub struct Db {
    path: PathBuf,
    tx: mpsc::Sender<WriteOp>,
    reader: Mutex<Connection>,
    writer: Mutex<Option<JoinHandle<()>>>,
}

/// Resumo da importação dos arquivos JSON antigos.
#[derive(Debug, Default, Clone)]
pub struct ImportReport {
    pub users: usize,
    pub sessions: usize,
    pub servers: usize,
    pub messages: usize,
    pub friends: bool,
}

fn configure(conn: &Connection) -> DbResult<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

fn migrate_schema(conn: &Connection) -> DbResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username_lower TEXT NOT NULL UNIQUE,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                remember INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                edited INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at, id);
            CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
            CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(channel_id) WHERE pinned = 1;
            CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            PRAGMA user_version = 1;
            "#,
        )?;
    }
    if version < 2 {
        migrate_v2(conn)?;
    }
    if version < 3 {
        conn.execute_batch(
            r#"
            BEGIN;
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                uploader_id TEXT NOT NULL,
                uploader_lower TEXT NOT NULL,
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                kind TEXT NOT NULL,
                size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                sha256 TEXT NOT NULL,
                ext TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploader_id, created_at);
            CREATE TABLE IF NOT EXISTS read_states (
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                last_read_at INTEGER NOT NULL,
                mention_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, channel_id)
            );
            CREATE INDEX IF NOT EXISTS idx_read_states_channel ON read_states(channel_id);
            PRAGMA user_version = 3;
            COMMIT;
            "#,
        )?;
    }
    if version < 4 {
        let txn = conn.unchecked_transaction()?;
        for (table, column, definition) in [
            ("categories", "permission_overwrites", "TEXT NOT NULL DEFAULT '[]'"),
            ("channels", "permission_overwrites", "TEXT NOT NULL DEFAULT '[]'"),
            ("channels", "permissions_synced", "INTEGER NOT NULL DEFAULT 1"),
        ] {
            let present: i64 = txn.query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
                params![column], |r| r.get(0),
            )?;
            if present == 0 { txn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?; }
        }
        txn.execute_batch("PRAGMA user_version = 4;")?;
        txn.commit()?;
    }
    if version < 5 {
        // v5 (Social): grupos privados e denúncias.
        conn.execute_batch(
            r#"
            BEGIN;
            CREATE TABLE IF NOT EXISTS group_dms (
                id TEXT PRIMARY KEY,
                name TEXT,
                icon_url TEXT,
                owner_lower TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS group_dm_members (
                group_id TEXT NOT NULL REFERENCES group_dms(id) ON DELETE CASCADE,
                user_lower TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (group_id, user_lower)
            );
            CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_dm_members(user_lower);
            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                reporter_lower TEXT NOT NULL,
                target_lower TEXT NOT NULL,
                message_id TEXT,
                reason TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'open'
            );
            CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_lower, created_at);
            PRAGMA user_version = 5;
            COMMIT;
            "#,
        )?;
    }
    if version < 6 {
        // v6 (Voz): limite de pessoas por canal de voz e moderação de voz por servidor.
        let txn = conn.unchecked_transaction()?;
        let present: i64 = txn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('channels') WHERE name = 'user_limit'",
            [],
            |r| r.get(0),
        )?;
        if present == 0 {
            txn.execute_batch("ALTER TABLE channels ADD COLUMN user_limit INTEGER NOT NULL DEFAULT 0;")?;
        }
        txn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS voice_moderation (
                server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                user_lower TEXT NOT NULL,
                muted INTEGER NOT NULL DEFAULT 0,
                deafened INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (server_id, user_lower)
            );
            PRAGMA user_version = 6;
            "#,
        )?;
        txn.commit()?;
    }
    if version < 7 {
        // v7 (Avançados): auditoria, AutoMod e índice de busca de texto completo.
        // O índice FTS5 é "external content": guarda só os termos e aponta para
        // `messages`; os gatilhos o mantêm em dia e o 'rebuild' indexa o histórico.
        let txn = conn.unchecked_transaction()?;
        txn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                actor_lower TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT,
                details TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_server_time ON audit_log(server_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS automod_config (
                server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
                data TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content, author_name,
                content='messages', content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            );
            CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content, author_name) VALUES (new.rowid, new.content, new.author_name);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content, author_name) VALUES ('delete', old.rowid, old.content, old.author_name);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF content, author_name ON messages
            WHEN old.content IS NOT new.content OR old.author_name IS NOT new.author_name BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content, author_name) VALUES ('delete', old.rowid, old.content, old.author_name);
                INSERT INTO messages_fts(rowid, content, author_name) VALUES (new.rowid, new.content, new.author_name);
            END;
            INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
            PRAGMA user_version = 7;
            "#,
        )?;
        txn.commit()?;
    }
    if version < 8 {
        // v8: eventos agendados dos servidores.
        conn.execute_batch(
            r#"
            BEGIN;
            CREATE TABLE IF NOT EXISTS server_events (
                id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                starts_at INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_server ON server_events(server_id, starts_at);
            PRAGMA user_version = 8;
            COMMIT;
            "#,
        )?;
    }
    if version < 9 {
        // v9: threads e postagens de fórum. As mensagens continuam em `messages`
        // (channel_id = id da thread); aqui ficam só os metadados.
        conn.execute_batch(
            r#"
            BEGIN;
            CREATE TABLE IF NOT EXISTS threads (
                id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                parent_id TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_threads_server ON threads(server_id);
            CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_id);
            PRAGMA user_version = 9;
            COMMIT;
            "#,
        )?;
    }
    if version < 10 {
        conn.execute_batch("BEGIN;
            CREATE TABLE IF NOT EXISTS channel_integrations (
                id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                channel_id TEXT NOT NULL, data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_integrations_channel ON channel_integrations(channel_id);
            PRAGMA user_version = 10;
            COMMIT;")?;
    }
    if version < 11 {
        // v11: castigo (timeout) de membros, com fim em ms. Linhas vencidas são
        // removidas pelo servidor; a permissão já deixa de valer pelo relógio.
        conn.execute_batch("BEGIN;
            CREATE TABLE IF NOT EXISTS member_timeouts (
                server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                user_lower TEXT NOT NULL,
                until_ms INTEGER NOT NULL,
                PRIMARY KEY (server_id, user_lower)
            );
            PRAGMA user_version = 11;
            COMMIT;")?;
    }
    if version < 12 {
        // v12: modo lento por canal (segundos entre mensagens de cada pessoa).
        let txn = conn.unchecked_transaction()?;
        let present: i64 = txn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('channels') WHERE name = 'slowmode_secs'",
            [],
            |r| r.get(0),
        )?;
        if present == 0 {
            txn.execute_batch("ALTER TABLE channels ADD COLUMN slowmode_secs INTEGER NOT NULL DEFAULT 0;")?;
        }
        txn.execute_batch("PRAGMA user_version = 12;")?;
        txn.commit()?;
    }
    if version < 13 {
        // v13: tags de fórum (JSON) no canal; as tags de cada postagem ficam no JSON da thread.
        let txn = conn.unchecked_transaction()?;
        let present: i64 = txn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('channels') WHERE name = 'forum_tags'",
            [],
            |r| r.get(0),
        )?;
        if present == 0 {
            txn.execute_batch("ALTER TABLE channels ADD COLUMN forum_tags TEXT NOT NULL DEFAULT '[]';")?;
        }
        txn.execute_batch("PRAGMA user_version = 13;")?;
        txn.commit()?;
    }
    Ok(())
}

/// Filtros já validados de uma busca (o servidor decide `channels`).
#[derive(Debug, Clone, Default)]
pub struct SearchFilter {
    pub channels: Vec<String>,
    /// Termos já normalizados; vazio = sem filtro de texto.
    pub terms: Vec<String>,
    pub author_lower: Option<String>,
    pub has: Option<String>,
    pub before: Option<i64>,
    pub after: Option<i64>,
    pub pinned: bool,
    pub mentions_user: Option<String>,
    pub limit: usize,
}

/// Monta a expressão FTS5 com cada termo entre aspas e como prefixo
/// (o usuário não consegue injetar operadores da sintaxe FTS).
pub fn fts_query(terms: &[String]) -> String {
    terms
        .iter()
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn upsert_group_dm(conn: &Connection, g: &crate::models::GroupDm) -> DbResult<()> {
    conn.execute(
        "INSERT INTO group_dms (id, name, icon_url, owner_lower, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon_url = excluded.icon_url,
             owner_lower = excluded.owner_lower",
        params![g.id, g.name, g.icon_url, g.owner, g.created_at],
    )?;
    conn.execute("DELETE FROM group_dm_members WHERE group_id = ?1", params![g.id])?;
    let mut stmt = conn.prepare("INSERT INTO group_dm_members (group_id, user_lower, position) VALUES (?1, ?2, ?3)")?;
    for (i, m) in g.members.iter().enumerate() {
        stmt.execute(params![g.id, m, i as i64])?;
    }
    Ok(())
}

/// v2: servidores normalizados. Bancos v1 guardavam cada servidor como JSON
/// na tabela `servers(id, data, updated_at)`; ela é renomeada para
/// `servers_v1` (mantida como backup) e convertida para as tabelas novas.
fn migrate_v2(conn: &Connection) -> DbResult<()> {
    let txn = conn.unchecked_transaction()?;
    let has_v1: i64 = txn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('servers') WHERE name = 'data'",
        [],
        |r| r.get(0),
    )?;
    if has_v1 > 0 {
        txn.execute_batch("ALTER TABLE servers RENAME TO servers_v1;")?;
    }
    txn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            icon_url TEXT,
            icon_color TEXT NOT NULL,
            banner_url TEXT,
            owner_lower TEXT NOT NULL,
            owner_id TEXT,
            default_invite TEXT NOT NULL,
            is_community INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            position INTEGER NOT NULL,
            permission_overwrites TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_categories_server ON categories(server_id);
        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            category_id TEXT,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            topic TEXT,
            position INTEGER NOT NULL,
            permission_overwrites TEXT NOT NULL DEFAULT '[]',
            permissions_synced INTEGER NOT NULL DEFAULT 1,
            user_limit INTEGER NOT NULL DEFAULT 0,
            -- Também aqui (e não só na v12/v13): a conversão v1 -> v2 já grava os canais.
            slowmode_secs INTEGER NOT NULL DEFAULT 0,
            forum_tags TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);
        CREATE TABLE IF NOT EXISTS server_members (
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            user_lower TEXT NOT NULL,
            user_id TEXT,
            joined_at INTEGER NOT NULL,
            PRIMARY KEY (server_id, user_lower)
        );
        CREATE INDEX IF NOT EXISTS idx_members_user ON server_members(user_lower);
        CREATE TABLE IF NOT EXISTS roles (
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            position INTEGER NOT NULL,
            hoist INTEGER NOT NULL DEFAULT 0,
            mentionable INTEGER NOT NULL DEFAULT 0,
            badge_emoji TEXT,
            permissions TEXT NOT NULL,
            PRIMARY KEY (server_id, id)
        );
        CREATE TABLE IF NOT EXISTS member_roles (
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            user_lower TEXT NOT NULL,
            role_id TEXT NOT NULL,
            PRIMARY KEY (server_id, user_lower, role_id)
        );
        CREATE TABLE IF NOT EXISTS bans (
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            user_lower TEXT NOT NULL,
            user_id TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (server_id, user_lower)
        );
        CREATE TABLE IF NOT EXISTS invites (
            code TEXT PRIMARY KEY,
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            creator_lower TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER,
            max_uses INTEGER,
            uses INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_invites_server ON invites(server_id);
        CREATE TABLE IF NOT EXISTS user_prefs (
            user_id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );
        "#,
    )?;
    if has_v1 > 0 {
        let docs: Vec<String> = {
            let mut stmt = txn.prepare("SELECT data FROM servers_v1 ORDER BY rowid")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut migrated = 0;
        for doc in docs {
            match serde_json::from_str::<GuildServer>(&doc) {
                Ok(srv) => {
                    replace_server(&txn, &srv)?;
                    migrated += 1;
                }
                Err(e) => warn!("Servidor v1 ilegível ignorado na migração: {e}"),
            }
        }
        info!("Banco migrado para v2: {migrated} servidor(es) normalizado(s); backup em servers_v1.");
    }
    txn.execute_batch("PRAGMA user_version = 2;")?;
    txn.commit()?;
    Ok(())
}

/// Regrava todas as linhas de um servidor. A linha em `servers` é atualizada
/// (não apagada) para não disparar o `ON DELETE CASCADE` dos convites.
fn replace_server(conn: &Connection, srv: &GuildServer) -> DbResult<()> {
    let now = crate::auth::now_ms();
    let created = if srv.created_at > 0 { srv.created_at } else { now };
    conn.execute(
        "INSERT INTO servers (id, name, description, icon_url, icon_color, banner_url, owner_lower,
             owner_id, default_invite, is_community, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT id FROM users WHERE username_lower = ?7), ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
             icon_url = excluded.icon_url, icon_color = excluded.icon_color, banner_url = excluded.banner_url,
             owner_lower = excluded.owner_lower, owner_id = excluded.owner_id,
             default_invite = excluded.default_invite, is_community = excluded.is_community,
             updated_at = excluded.updated_at",
        params![
            srv.id,
            srv.name,
            srv.description,
            srv.icon_url,
            srv.icon_color,
            srv.banner_url,
            srv.owner_username,
            srv.invite_code,
            srv.is_community as i64,
            created,
            now
        ],
    )?;
    for table in ["categories", "channels", "server_members", "roles", "member_roles", "bans"] {
        conn.execute(&format!("DELETE FROM {table} WHERE server_id = ?1"), params![srv.id])?;
    }
    {
        let mut stmt = conn.prepare(
            "INSERT INTO categories (id, server_id, name, position, permission_overwrites) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for c in &srv.categories {
            stmt.execute(params![c.id, srv.id, c.name, c.position, serde_json::to_string(&c.permission_overwrites)?])?;
        }
    }
    {
        let mut stmt = conn.prepare(
            "INSERT OR REPLACE INTO channels (id, server_id, category_id, kind, name, topic, position, permission_overwrites, permissions_synced, user_limit, slowmode_secs, forum_tags)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )?;
        for c in srv.text_channels.iter().chain(srv.voice_channels.iter()) {
            stmt.execute(params![c.id, srv.id, c.category_id, c.kind.as_str(), c.name, c.topic, c.position,
                serde_json::to_string(&c.permission_overwrites)?, c.permissions_synced, c.user_limit, c.slowmode_secs,
                serde_json::to_string(&c.forum_tags)?])?;
        }
    }
    {
        let mut stmt = conn.prepare(
            "INSERT OR IGNORE INTO server_members (server_id, user_lower, user_id, joined_at)
             VALUES (?1, ?2, (SELECT id FROM users WHERE username_lower = ?2), ?3)",
        )?;
        for m in &srv.members {
            let joined = srv.member_joined_at.get(m).copied().unwrap_or(created);
            stmt.execute(params![srv.id, m, joined])?;
        }
    }
    {
        let mut stmt = conn.prepare(
            "INSERT OR REPLACE INTO roles (server_id, id, name, color, position, hoist, mentionable, badge_emoji, permissions)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for r in &srv.roles {
            stmt.execute(params![
                srv.id,
                r.id,
                r.name,
                r.color,
                r.position,
                r.hoist as i64,
                r.mentionable as i64,
                r.badge_emoji,
                serde_json::to_string(&r.permissions)?
            ])?;
        }
    }
    {
        let mut stmt = conn.prepare(
            "INSERT OR IGNORE INTO member_roles (server_id, user_lower, role_id) VALUES (?1, ?2, ?3)",
        )?;
        for (user, role_ids) in &srv.member_roles {
            for rid in role_ids {
                stmt.execute(params![srv.id, user, rid])?;
            }
        }
    }
    {
        let mut stmt = conn.prepare(
            "INSERT OR IGNORE INTO bans (server_id, user_lower, user_id, created_at)
             VALUES (?1, ?2, (SELECT id FROM users WHERE username_lower = ?2), ?3)",
        )?;
        for (i, b) in srv.banned_usernames.iter().enumerate() {
            stmt.execute(params![srv.id, b, now + i as i64])?;
        }
    }
    Ok(())
}

fn upsert_invite(conn: &Connection, inv: &Invite) -> DbResult<()> {
    conn.execute(
        "INSERT INTO invites (code, server_id, creator_lower, created_at, expires_at, max_uses, uses)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(code) DO UPDATE SET uses = excluded.uses, expires_at = excluded.expires_at,
             max_uses = excluded.max_uses, creator_lower = excluded.creator_lower",
        params![
            inv.code,
            inv.server_id,
            inv.creator,
            inv.created_at,
            inv.expires_at,
            inv.max_uses,
            inv.uses
        ],
    )?;
    Ok(())
}

fn apply(conn: &Connection, op: WriteOp) -> DbResult<()> {
    let now = crate::auth::now_ms();
    match op {
        WriteOp::UpsertIntegration(i) => {
            conn.execute("INSERT INTO channel_integrations(id,server_id,channel_id,data) VALUES(?1,?2,?3,?4)
                ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![i.id,i.server_id,i.channel_id,serde_json::to_string(&*i)?])?;
        }
        WriteOp::DeleteIntegration { id } => { conn.execute("DELETE FROM channel_integrations WHERE id=?1", params![id])?; }
        WriteOp::UpsertUser { id, username_lower, data } => {
            conn.execute(
                "INSERT INTO users (id, username_lower, data, updated_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET username_lower = excluded.username_lower,
                   data = excluded.data, updated_at = excluded.updated_at",
                params![id, username_lower, data, now],
            )?;
        }
        WriteOp::ReplaceServer(srv) => replace_server(conn, &srv)?,
        WriteOp::DeleteServer { id } => {
            // ON DELETE CASCADE remove categorias, canais, membros, cargos, bans e convites.
            conn.execute("DELETE FROM servers WHERE id = ?1", params![id])?;
        }
        WriteOp::UpsertInvite(inv) => upsert_invite(conn, &inv)?,
        WriteOp::DeleteInvite { code } => {
            conn.execute("DELETE FROM invites WHERE code = ?1", params![code])?;
        }
        WriteOp::PutUserPrefs { user_id, data } => {
            conn.execute(
                "INSERT INTO user_prefs (user_id, data) VALUES (?1, ?2)
                 ON CONFLICT(user_id) DO UPDATE SET data = excluded.data",
                params![user_id, data],
            )?;
        }
        WriteOp::InsertAttachment(a) => {
            conn.execute(
                "INSERT OR IGNORE INTO attachments (id, uploader_id, uploader_lower, filename, content_type,
                     kind, size, width, height, sha256, ext, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    a.id,
                    a.uploader_id,
                    a.uploader_lower,
                    a.filename,
                    a.content_type,
                    a.kind,
                    a.size as i64,
                    a.width,
                    a.height,
                    a.sha256,
                    a.ext,
                    a.created_at
                ],
            )?;
        }
        WriteOp::UpsertReadState { user_id, channel_id, state } => {
            conn.execute(
                "INSERT INTO read_states (user_id, channel_id, last_read_at, mention_count)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_at = excluded.last_read_at,
                     mention_count = excluded.mention_count",
                params![user_id, channel_id, state.last_read_at, state.mention_count],
            )?;
        }
        WriteOp::DeleteReadStatesForChannel { channel_id } => {
            conn.execute("DELETE FROM read_states WHERE channel_id = ?1", params![channel_id])?;
        }
        WriteOp::RenameReadStatesChannel { from, to } => {
            conn.execute(
                "UPDATE OR REPLACE read_states SET channel_id = ?2 WHERE channel_id = ?1",
                params![from, to],
            )?;
        }
        WriteOp::UpsertGroupDm(g) => upsert_group_dm(conn, &g)?,
        WriteOp::SetVoiceModeration { server_id, user_lower, muted, deafened } => {
            if muted || deafened {
                conn.execute(
                    "INSERT INTO voice_moderation (server_id, user_lower, muted, deafened) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(server_id, user_lower) DO UPDATE SET muted = excluded.muted, deafened = excluded.deafened",
                    params![server_id, user_lower, muted, deafened],
                )?;
            } else {
                conn.execute(
                    "DELETE FROM voice_moderation WHERE server_id = ?1 AND user_lower = ?2",
                    params![server_id, user_lower],
                )?;
            }
        }
        WriteOp::RenameVoiceModeration { from, to } => {
            conn.execute(
                "UPDATE OR REPLACE voice_moderation SET user_lower = ?2 WHERE user_lower = ?1",
                params![from, to],
            )?;
        }
        WriteOp::SetMemberTimeout { server_id, user_lower, until_ms } => match until_ms {
            Some(until) => {
                conn.execute(
                    "INSERT INTO member_timeouts (server_id, user_lower, until_ms) VALUES (?1, ?2, ?3)
                     ON CONFLICT(server_id, user_lower) DO UPDATE SET until_ms = excluded.until_ms",
                    params![server_id, user_lower, until],
                )?;
            }
            None => {
                conn.execute(
                    "DELETE FROM member_timeouts WHERE server_id = ?1 AND user_lower = ?2",
                    params![server_id, user_lower],
                )?;
            }
        },
        WriteOp::RenameMemberTimeout { from, to } => {
            conn.execute(
                "UPDATE OR REPLACE member_timeouts SET user_lower = ?2 WHERE user_lower = ?1",
                params![from, to],
            )?;
        }
        WriteOp::UpsertThread(th) => {
            conn.execute(
                "INSERT INTO threads (id, server_id, parent_id, data) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, data = excluded.data",
                params![th.id, th.server_id, th.parent_id, serde_json::to_string(&*th)?],
            )?;
        }
        WriteOp::DeleteThread { id } => {
            conn.execute("DELETE FROM threads WHERE id = ?1", params![id])?;
            conn.execute("DELETE FROM messages WHERE channel_id = ?1", params![id])?;
            conn.execute("DELETE FROM read_states WHERE channel_id = ?1", params![id])?;
        }
        WriteOp::UpsertEvent(e) => {
            conn.execute(
                "INSERT INTO server_events (id, server_id, starts_at, data) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, data = excluded.data",
                params![e.id, e.server_id, e.starts_at, serde_json::to_string(&*e)?],
            )?;
        }
        WriteOp::DeleteEvent { id } => {
            conn.execute("DELETE FROM server_events WHERE id = ?1", params![id])?;
        }
        WriteOp::InsertAudit(e) => {
            conn.execute(
                "INSERT OR IGNORE INTO audit_log (id, server_id, actor_lower, action, target, details, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![e.id, e.server_id, e.actor, e.action, e.target, e.details, e.created_at],
            )?;
        }
        WriteOp::PutAutoMod { server_id, data } => {
            conn.execute(
                "INSERT INTO automod_config (server_id, data) VALUES (?1, ?2)
                 ON CONFLICT(server_id) DO UPDATE SET data = excluded.data",
                params![server_id, data],
            )?;
        }
        WriteOp::DeleteGroupDm { id } => {
            conn.execute("DELETE FROM group_dms WHERE id = ?1", params![id])?;
        }
        WriteOp::InsertReport { id, reporter, target, message_id, reason, created_at } => {
            conn.execute(
                "INSERT OR IGNORE INTO reports (id, reporter_lower, target_lower, message_id, reason, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, reporter, target, message_id, reason, created_at],
            )?;
        }
        WriteOp::UpsertMessage(msg) => upsert_message(conn, &msg)?,
        WriteOp::DeleteMessage { id } => {
            conn.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        }
        WriteOp::DeleteChannelMessages { channel_id } => {
            conn.execute("DELETE FROM messages WHERE channel_id = ?1", params![channel_id])?;
        }
        WriteOp::RenameChannel { from, to } => {
            conn.execute(
                "UPDATE messages SET channel_id = ?2, data = json_set(data, '$.channel_id', ?2)
                 WHERE channel_id = ?1",
                params![from, to],
            )?;
        }
        WriteOp::PutKv { key, value } => {
            conn.execute(
                "INSERT INTO kv (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
        }
        WriteOp::InsertSession(s) => insert_session(conn, &s)?,
        WriteOp::TouchSession { token_hash, last_seen_at, expires_at } => {
            conn.execute(
                "UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1",
                params![token_hash, last_seen_at, expires_at],
            )?;
        }
        WriteOp::DeleteSession { token_hash } => {
            conn.execute("DELETE FROM sessions WHERE token_hash = ?1", params![token_hash])?;
        }
        WriteOp::DeleteUserSessionsExcept { user_id, keep_token_hash } => {
            conn.execute(
                "DELETE FROM sessions WHERE user_id = ?1 AND token_hash IS NOT ?2",
                params![user_id, keep_token_hash],
            )?;
        }
        WriteOp::DeleteExpiredSessions { now } => {
            conn.execute("DELETE FROM sessions WHERE expires_at <= ?1", params![now])?;
        }
        WriteOp::Barrier(_) | WriteOp::Shutdown(_) => {}
    }
    Ok(())
}

fn upsert_message(conn: &Connection, msg: &ChatMessage) -> DbResult<()> {
    let mut stored = msg.clone();
    stored.nonce = None;
    let data = serde_json::to_string(&stored)?;
    conn.execute(
        "INSERT INTO messages (id, channel_id, author_id, author_name, content, created_at, edited, pinned, data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, edited = excluded.edited,
           pinned = excluded.pinned, data = excluded.data, author_name = excluded.author_name",
        params![
            stored.id,
            stored.channel_id,
            stored.author_id,
            stored.author_name,
            stored.content,
            stored.created_at,
            stored.edited as i64,
            stored.pinned as i64,
            data
        ],
    )?;
    Ok(())
}

fn insert_session(conn: &Connection, s: &SessionRecord) -> DbResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, remember)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![s.token_hash, s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.remember as i64],
    )?;
    Ok(())
}

fn writer_loop(mut conn: Connection, rx: mpsc::Receiver<WriteOp>) {
    while let Ok(first) = rx.recv() {
        let mut batch = vec![first];
        while batch.len() < 512 {
            match rx.try_recv() {
                Ok(op) => batch.push(op),
                Err(_) => break,
            }
        }
        let mut acks = Vec::new();
        let mut shutdown = false;
        match conn.transaction() {
            Ok(txn) => {
                for op in batch {
                    match op {
                        WriteOp::Barrier(ack) => acks.push(ack),
                        WriteOp::Shutdown(ack) => {
                            acks.push(ack);
                            shutdown = true;
                        }
                        other => {
                            let label = format!("{:?}", std::mem::discriminant(&other));
                            if let Err(e) = apply(&txn, other) {
                                error!("Falha ao gravar no banco ({label}): {e}");
                            }
                        }
                    }
                }
                if let Err(e) = txn.commit() {
                    error!("Falha ao confirmar transação no banco: {e}");
                }
            }
            Err(e) => error!("Falha ao abrir transação no banco: {e}"),
        }
        for ack in acks {
            let _ = ack.send(());
        }
        if shutdown {
            break;
        }
    }
    info!("Thread de escrita do banco encerrada.");
}

impl Db {
    /// Abre (ou cria) o banco, aplica o esquema e, se o banco estiver vazio,
    /// importa os arquivos JSON antigos encontrados em `legacy_dir`.
    pub fn open(path: &Path, legacy_dir: Option<&Path>) -> DbResult<(Db, Option<ImportReport>)> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut writer_conn = Connection::open(path)?;
        configure(&writer_conn)?;
        migrate_schema(&writer_conn)?;

        let report = match legacy_dir {
            Some(dir) if db_is_empty(&writer_conn)? => import_legacy_json(&mut writer_conn, dir)?,
            _ => None,
        };

        let reader = Connection::open(path)?;
        configure(&reader)?;

        let (tx, rx) = mpsc::channel();
        let handle = std::thread::Builder::new()
            .name("sancord-db-writer".into())
            .spawn(move || writer_loop(writer_conn, rx))?;

        Ok((
            Db {
                path: path.to_path_buf(),
                tx,
                reader: Mutex::new(reader),
                writer: Mutex::new(Some(handle)),
            },
            report,
        ))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Enfileira uma escrita. Nunca bloqueia.
    pub fn write(&self, op: WriteOp) {
        if self.tx.send(op).is_err() {
            error!("Tentativa de escrita com o banco já fechado.");
        }
    }

    /// Bloqueia até todas as escritas enfileiradas antes desta chamada serem gravadas.
    pub fn flush(&self) {
        let (ack_tx, ack_rx) = mpsc::channel();
        self.write(WriteOp::Barrier(ack_tx));
        let _ = ack_rx.recv_timeout(std::time::Duration::from_secs(10));
    }

    /// Grava tudo o que estiver pendente e encerra a thread de escrita.
    pub fn shutdown(&self) {
        let (ack_tx, ack_rx) = mpsc::channel();
        self.write(WriteOp::Shutdown(ack_tx));
        let _ = ack_rx.recv_timeout(std::time::Duration::from_secs(10));
        if let Ok(mut guard) = self.writer.lock() {
            if let Some(h) = guard.take() {
                let _ = h.join();
            }
        }
    }

    fn with_reader<T>(&self, f: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
        let conn = self.reader.lock().map_err(|_| DbError::Closed)?;
        f(&conn)
    }

    pub fn load_accounts(&self) -> DbResult<Vec<Account>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT data FROM users")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for row in rows {
                match serde_json::from_str::<Account>(&row?) {
                    Ok(acc) => out.push(acc),
                    Err(e) => warn!("Usuário corrompido ignorado no banco: {e}"),
                }
            }
            Ok(out)
        })
    }

    /// Monta os servidores a partir das tabelas normalizadas (ordem de criação).
    pub fn load_servers(&self) -> DbResult<Vec<GuildServer>> {
        self.with_reader(|c| {
            let mut servers: Vec<GuildServer> = {
                let mut stmt = c.prepare(
                    "SELECT id, name, description, icon_url, icon_color, banner_url, owner_lower,
                            default_invite, is_community, created_at
                     FROM servers ORDER BY rowid",
                )?;
                let rows = stmt.query_map([], |r| {
                    Ok(GuildServer {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        description: r.get(2)?,
                        icon_url: r.get(3)?,
                        icon_color: r.get(4)?,
                        banner_url: r.get(5)?,
                        owner_username: r.get(6)?,
                        invite_code: r.get(7)?,
                        is_community: r.get::<_, i64>(8)? != 0,
                        created_at: r.get(9)?,
                        text_channels: Vec::new(),
                        voice_channels: Vec::new(),
                        roles: Vec::new(),
                        member_roles: HashMap::new(),
                        members: Vec::new(),
                        banned_usernames: Vec::new(),
                        categories: Vec::new(),
                        member_joined_at: HashMap::new(),
                        voice_moderation: HashMap::new(),
                        automod: Default::default(),
                        threads: Vec::new(),
                        member_timeouts: HashMap::new(),
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            let index: HashMap<String, usize> =
                servers.iter().enumerate().map(|(i, s)| (s.id.clone(), i)).collect();
            let slot = |sid: &str| index.get(sid).copied();

            let mut stmt = c.prepare("SELECT server_id, id, name, position, permission_overwrites FROM categories ORDER BY position")?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, Category { id: r.get(1)?, name: r.get(2)?, position: r.get(3)?,
                    permission_overwrites: serde_json::from_str(&r.get::<_, String>(4)?).map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e)))? }))
            })?;
            for row in rows {
                let (sid, cat) = row?;
                if let Some(i) = slot(&sid) {
                    servers[i].categories.push(cat);
                }
            }

            let mut stmt = c.prepare(
                "SELECT server_id, id, category_id, kind, name, topic, position, permission_overwrites, permissions_synced, user_limit, slowmode_secs, forum_tags FROM channels ORDER BY position, rowid",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, i32>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, bool>(8)?,
                    r.get::<_, u32>(9)?,
                    r.get::<_, u32>(10)?,
                    r.get::<_, String>(11)?,
                ))
            })?;
            for row in rows {
                let (sid, id, category_id, kind, name, topic, position, overwrites, permissions_synced, user_limit, slowmode_secs, forum_tags) = row?;
                let Some(i) = slot(&sid) else { continue };
                let Some(kind) = ChannelKind::parse(&kind) else {
                    warn!("Canal {id} com tipo desconhecido '{kind}' ignorado");
                    continue;
                };
                let ch = Channel { id, name, kind: kind.clone(), category_id, position, topic,
                    permission_overwrites: serde_json::from_str(&overwrites)?, permissions_synced, user_limit, slowmode_secs,
                    // Tag ilegível não derruba o servidor: o fórum só fica sem tags.
                    forum_tags: serde_json::from_str(&forum_tags).unwrap_or_default(), effective_permissions: None };
                if kind.is_text_like() {
                    servers[i].text_channels.push(ch);
                } else {
                    servers[i].voice_channels.push(ch);
                }
            }

            let mut stmt = c.prepare(
                "SELECT server_id, user_lower, joined_at FROM server_members ORDER BY joined_at, rowid",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
            })?;
            for row in rows {
                let (sid, user, joined) = row?;
                if let Some(i) = slot(&sid) {
                    servers[i].member_joined_at.insert(user.clone(), joined);
                    servers[i].members.push(user);
                }
            }

            let mut stmt = c.prepare(
                "SELECT server_id, id, name, color, position, hoist, mentionable, badge_emoji, permissions
                 FROM roles ORDER BY position, rowid",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i32>(4)?,
                    r.get::<_, i64>(5)? != 0,
                    r.get::<_, i64>(6)? != 0,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, String>(8)?,
                ))
            })?;
            for row in rows {
                let (sid, id, name, color, position, hoist, mentionable, badge_emoji, perms) = row?;
                let Some(i) = slot(&sid) else { continue };
                let permissions: RolePermissions = serde_json::from_str(&perms).unwrap_or_default();
                servers[i].roles.push(ServerRole {
                    id,
                    name,
                    color,
                    position,
                    hoist,
                    mentionable,
                    badge_emoji,
                    permissions,
                });
            }

            let mut stmt = c.prepare("SELECT server_id, user_lower, role_id FROM member_roles ORDER BY rowid")?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })?;
            for row in rows {
                let (sid, user, role) = row?;
                if let Some(i) = slot(&sid) {
                    servers[i].member_roles.entry(user).or_default().push(role);
                }
            }

            let mut stmt = c.prepare("SELECT server_id, user_lower FROM bans ORDER BY created_at, rowid")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (sid, user) = row?;
                if let Some(i) = slot(&sid) {
                    servers[i].banned_usernames.push(user);
                }
            }
            Ok(servers)
        })
    }

    pub fn load_invites(&self) -> DbResult<Vec<Invite>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare(
                "SELECT code, server_id, creator_lower, created_at, expires_at, max_uses, uses FROM invites",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(Invite {
                    code: r.get(0)?,
                    server_id: r.get(1)?,
                    creator: r.get(2)?,
                    created_at: r.get(3)?,
                    expires_at: r.get(4)?,
                    max_uses: r.get(5)?,
                    uses: r.get(6)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn load_user_prefs(&self) -> DbResult<HashMap<String, UserPrefs>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT user_id, data FROM user_prefs")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            let mut out = HashMap::new();
            for row in rows {
                let (uid, data) = row?;
                match serde_json::from_str::<UserPrefs>(&data) {
                    Ok(p) => {
                        out.insert(uid, p);
                    }
                    Err(e) => warn!("Preferências corrompidas de {uid} ignoradas: {e}"),
                }
            }
            Ok(out)
        })
    }

    pub fn load_friends(&self) -> DbResult<FriendsStore> {
        self.with_reader(|c| {
            let raw: Option<String> = c
                .query_row("SELECT value FROM kv WHERE key = ?1", params![KV_FRIENDS], |r| r.get(0))
                .optional()?;
            Ok(raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default())
        })
    }

    pub fn load_sessions(&self, now: i64) -> DbResult<Vec<SessionRecord>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare(
                "SELECT token_hash, user_id, created_at, last_seen_at, expires_at, remember
                 FROM sessions WHERE expires_at > ?1",
            )?;
            let rows = stmt.query_map(params![now], |r| {
                Ok(SessionRecord {
                    token_hash: r.get(0)?,
                    user_id: r.get(1)?,
                    created_at: r.get(2)?,
                    last_seen_at: r.get(3)?,
                    expires_at: r.get(4)?,
                    remember: r.get::<_, i64>(5)? != 0,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    /// Últimas `per_channel` mensagens de cada canal, em ordem cronológica.
    pub fn load_recent_messages(&self, per_channel: usize) -> DbResult<HashMap<String, Vec<ChatMessage>>> {
        self.with_reader(|c| {
            let channels: Vec<String> = {
                let mut stmt = c.prepare("SELECT DISTINCT channel_id FROM messages")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            let mut out = HashMap::new();
            let mut stmt = c.prepare(
                "SELECT data FROM messages WHERE channel_id = ?1
                 ORDER BY created_at DESC, id DESC LIMIT ?2",
            )?;
            for ch in channels {
                let rows = stmt.query_map(params![ch, per_channel as i64], |r| r.get::<_, String>(0))?;
                let mut list: Vec<ChatMessage> = rows
                    .filter_map(|r| r.ok())
                    .filter_map(|s| serde_json::from_str(&s).ok())
                    .collect();
                list.reverse();
                out.insert(ch, list);
            }
            Ok(out)
        })
    }

    pub fn get_message(&self, channel_id: &str, message_id: &str) -> DbResult<Option<ChatMessage>> {
        self.with_reader(|c| {
            let raw: Option<String> = c
                .query_row(
                    "SELECT data FROM messages WHERE id = ?1 AND channel_id = ?2",
                    params![message_id, channel_id],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
        })
    }

    /// Página de mensagens anteriores a `before_id` (ou as mais recentes se `None`),
    /// em ordem cronológica. Retorna também se ainda existem mensagens mais antigas.
    pub fn messages_before(
        &self,
        channel_id: &str,
        before_id: Option<&str>,
        limit: usize,
    ) -> DbResult<(Vec<ChatMessage>, bool)> {
        let limit = limit.clamp(1, 100);
        self.with_reader(|c| {
            let anchor: Option<(i64, String)> = match before_id {
                Some(bid) => c
                    .query_row(
                        "SELECT created_at, id FROM messages WHERE id = ?1 AND channel_id = ?2",
                        params![bid, channel_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?,
                None => None,
            };
            if before_id.is_some() && anchor.is_none() {
                return Ok((Vec::new(), false));
            }
            let fetch = (limit + 1) as i64;
            let raw: Vec<String> = match anchor {
                Some((ts, id)) => {
                    let mut stmt = c.prepare(
                        "SELECT data FROM messages WHERE channel_id = ?1
                           AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
                         ORDER BY created_at DESC, id DESC LIMIT ?4",
                    )?;
                    let rows = stmt.query_map(params![channel_id, ts, id, fetch], |r| r.get(0))?;
                    rows.collect::<Result<Vec<_>, _>>()?
                }
                None => {
                    let mut stmt = c.prepare(
                        "SELECT data FROM messages WHERE channel_id = ?1
                         ORDER BY created_at DESC, id DESC LIMIT ?2",
                    )?;
                    let rows = stmt.query_map(params![channel_id, fetch], |r| r.get(0))?;
                    rows.collect::<Result<Vec<_>, _>>()?
                }
            };
            let has_more = raw.len() > limit;
            let mut list: Vec<ChatMessage> = raw
                .into_iter()
                .take(limit)
                .filter_map(|s| serde_json::from_str(&s).ok())
                .collect();
            list.reverse();
            Ok((list, has_more))
        })
    }

    /// Página de mensagens posteriores a `after_id`, em ordem cronológica.
    pub fn messages_after(&self, channel_id: &str, after_id: &str, limit: usize) -> DbResult<(Vec<ChatMessage>, bool)> {
        let limit = limit.clamp(1, 100);
        self.with_reader(|c| {
            let Some((ts, id)) = c
                .query_row(
                    "SELECT created_at, id FROM messages WHERE id = ?1 AND channel_id = ?2",
                    params![after_id, channel_id],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
                )
                .optional()?
            else {
                return Ok((Vec::new(), false));
            };
            let mut stmt = c.prepare(
                "SELECT data FROM messages WHERE channel_id = ?1
                   AND (created_at > ?2 OR (created_at = ?2 AND id > ?3))
                 ORDER BY created_at ASC, id ASC LIMIT ?4",
            )?;
            let rows = stmt.query_map(params![channel_id, ts, id, (limit + 1) as i64], |r| r.get::<_, String>(0))?;
            let raw: Vec<String> = rows.collect::<Result<Vec<_>, _>>()?;
            let has_more = raw.len() > limit;
            let list = raw
                .into_iter()
                .take(limit)
                .filter_map(|s| serde_json::from_str(&s).ok())
                .collect();
            Ok((list, has_more))
        })
    }

    /// Janela ao redor de uma mensagem (metade antes, metade depois, incluindo ela).
    /// Retorna (mensagens, há_mais_antigas, há_mais_novas).
    pub fn messages_around(
        &self,
        channel_id: &str,
        around_id: &str,
        limit: usize,
    ) -> DbResult<(Vec<ChatMessage>, bool, bool)> {
        let limit = limit.clamp(2, 100);
        let Some(center) = self.get_message(channel_id, around_id)? else {
            return Ok((Vec::new(), false, false));
        };
        let (mut before, more_before) = self.messages_before(channel_id, Some(around_id), limit / 2)?;
        let (after, more_after) = self.messages_after(channel_id, around_id, limit - limit / 2 - 1)?;
        before.push(center);
        before.extend(after);
        Ok((before, more_before, more_after))
    }

    /// Mensagens fixadas do canal, mais recentes primeiro.
    pub fn pinned_messages(&self, channel_id: &str, limit: usize) -> DbResult<Vec<ChatMessage>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare(
                "SELECT data FROM messages WHERE channel_id = ?1 AND pinned = 1
                 ORDER BY created_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![channel_id, limit as i64], |r| r.get::<_, String>(0))?;
            Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
        })
    }

    pub fn load_attachments(&self) -> DbResult<Vec<AttachmentRecord>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare(
                "SELECT id, uploader_id, uploader_lower, filename, content_type, kind, size, width, height,
                        sha256, ext, created_at FROM attachments",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(AttachmentRecord {
                    id: r.get(0)?,
                    uploader_id: r.get(1)?,
                    uploader_lower: r.get(2)?,
                    filename: r.get(3)?,
                    content_type: r.get(4)?,
                    kind: r.get(5)?,
                    size: r.get::<_, i64>(6)? as u64,
                    width: r.get(7)?,
                    height: r.get(8)?,
                    sha256: r.get(9)?,
                    ext: r.get(10)?,
                    created_at: r.get(11)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn load_group_dms(&self) -> DbResult<Vec<crate::models::GroupDm>> {
        self.with_reader(|c| {
            let mut groups: Vec<crate::models::GroupDm> = {
                let mut stmt = c.prepare("SELECT id, name, icon_url, owner_lower, created_at FROM group_dms ORDER BY created_at")?;
                let rows = stmt.query_map([], |r| {
                    Ok(crate::models::GroupDm {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        icon_url: r.get(2)?,
                        owner: r.get(3)?,
                        members: Vec::new(),
                        created_at: r.get(4)?,
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            let index: HashMap<String, usize> = groups.iter().enumerate().map(|(i, g)| (g.id.clone(), i)).collect();
            let mut stmt = c.prepare("SELECT group_id, user_lower FROM group_dm_members ORDER BY position")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (gid, user) = row?;
                if let Some(&i) = index.get(&gid) {
                    groups[i].members.push(user);
                }
            }
            Ok(groups)
        })
    }

    /// Castigos persistidos: (server_id, user_lower, fim em ms).
    pub fn load_member_timeouts(&self) -> DbResult<Vec<(String, String, i64)>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT server_id, user_lower, until_ms FROM member_timeouts")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    /// Moderação de voz persistida: (server_id, user_lower) -> silenciado/ensurdecido.
    pub fn load_voice_moderation(&self) -> DbResult<Vec<(String, String, crate::models::VoiceModeration)>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT server_id, user_lower, muted, deafened FROM voice_moderation")?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    crate::models::VoiceModeration { muted: r.get::<_, i64>(2)? != 0, deafened: r.get::<_, i64>(3)? != 0 },
                ))
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    /// Auditoria de um servidor, mais recentes primeiro. Devolve até `limit` e se há mais.
    pub fn audit_log(&self, server_id: &str, before: Option<i64>, action: Option<&str>, limit: usize) -> DbResult<(Vec<crate::models::AuditEntry>, bool)> {
        self.with_reader(|c| {
            let mut stmt = c.prepare(
                "SELECT id, server_id, actor_lower, action, target, details, created_at FROM audit_log
                 WHERE server_id = ?1 AND created_at < ?2 AND (?3 IS NULL OR action = ?3)
                 ORDER BY created_at DESC, id DESC LIMIT ?4",
            )?;
            let rows = stmt.query_map(
                params![server_id, before.unwrap_or(i64::MAX), action, (limit + 1) as i64],
                |r| {
                    Ok(crate::models::AuditEntry {
                        id: r.get(0)?,
                        server_id: r.get(1)?,
                        actor: r.get(2)?,
                        action: r.get(3)?,
                        target: r.get(4)?,
                        details: r.get(5)?,
                        created_at: r.get(6)?,
                    })
                },
            )?;
            let mut list = rows.collect::<Result<Vec<_>, _>>()?;
            let more = list.len() > limit;
            list.truncate(limit);
            Ok((list, more))
        })
    }

    pub fn load_threads(&self) -> DbResult<Vec<crate::models::Thread>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT data FROM threads")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for row in rows {
                match serde_json::from_str(&row?) {
                    Ok(t) => out.push(t),
                    Err(err) => warn!("Thread ilegível ignorada: {err}"),
                }
            }
            Ok(out)
        })
    }

    pub fn load_events(&self) -> DbResult<Vec<crate::models::ServerEvent>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT data FROM server_events ORDER BY starts_at")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for row in rows {
                match serde_json::from_str(&row?) {
                    Ok(e) => out.push(e),
                    Err(err) => warn!("Evento ilegível ignorado: {err}"),
                }
            }
            Ok(out)
        })
    }

    pub fn load_integrations(&self) -> DbResult<Vec<crate::integrations::Integration>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT data FROM channel_integrations")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for row in rows { out.push(serde_json::from_str(&row?)?); }
            Ok(out)
        })
    }

    pub fn load_automod(&self) -> DbResult<Vec<(String, crate::models::AutoModConfig)>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT server_id, data FROM automod_config")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            let mut out = Vec::new();
            for row in rows {
                let (sid, data) = row?;
                match serde_json::from_str(&data) {
                    Ok(cfg) => out.push((sid, cfg)),
                    Err(e) => warn!("AutoMod ilegível do servidor {sid} ignorado: {e}"),
                }
            }
            Ok(out)
        })
    }

    /// Busca no histórico persistido. O chamador limita `channels` ao que a pessoa pode ler.
    pub fn search_messages(&self, f: &SearchFilter) -> DbResult<(Vec<ChatMessage>, bool)> {
        if f.channels.is_empty() {
            return Ok((Vec::new(), false));
        }
        self.with_reader(|c| {
            let channels = serde_json::to_string(&f.channels)?;
            let fts = (!f.terms.is_empty()).then(|| fts_query(&f.terms));
            let sql = format!(
                "SELECT m.data FROM messages m
                 {join}
                 WHERE m.channel_id IN (SELECT value FROM json_each(?1))
                   {fts_cond}
                   AND (?3 IS NULL OR lower(m.author_name) = ?3)
                   AND (?4 IS NULL OR m.created_at < ?4)
                   AND (?5 IS NULL OR m.created_at > ?5)
                   AND (?6 = 0 OR m.pinned = 1)
                   AND (?7 IS NULL
                        OR (?7 = 'link' AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%'))
                        OR (?7 = 'file' AND json_array_length(json_extract(m.data, '$.attachments')) > 0)
                        OR (?7 = 'image' AND (json_extract(m.data, '$.image_url') IS NOT NULL
                            OR EXISTS (SELECT 1 FROM json_each(json_extract(m.data, '$.attachments')) a
                                       WHERE json_extract(a.value, '$.kind') = 'image'))))
                   AND (?8 IS NULL OR EXISTS (SELECT 1 FROM json_each(json_extract(m.data, '$.mentions.users')) u WHERE u.value = ?8)
                        OR json_extract(m.data, '$.mentions.everyone') = 1)
                 ORDER BY m.created_at DESC, m.id DESC LIMIT ?9",
                join = if fts.is_some() { "JOIN messages_fts ON messages_fts.rowid = m.rowid" } else { "" },
                fts_cond = if fts.is_some() { "AND messages_fts MATCH ?2" } else { "AND ?2 IS NULL" },
            );
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(
                params![
                    channels,
                    fts,
                    f.author_lower,
                    f.before,
                    f.after,
                    f.pinned as i64,
                    f.has,
                    f.mentions_user,
                    (f.limit + 1) as i64
                ],
                |r| r.get::<_, String>(0),
            )?;
            let raw = rows.collect::<Result<Vec<_>, _>>()?;
            let more = raw.len() > f.limit;
            let list = raw
                .into_iter()
                .take(f.limit)
                .filter_map(|s| serde_json::from_str(&s).ok())
                .collect();
            Ok((list, more))
        })
    }

    /// Denúncias registradas (para a futura tela de moderação e para testes).
    pub fn count_reports(&self, target_lower: &str) -> DbResult<i64> {
        self.with_reader(|c| {
            Ok(c.query_row("SELECT COUNT(*) FROM reports WHERE target_lower = ?1", params![target_lower], |r| r.get(0))?)
        })
    }

    pub fn load_read_states(&self) -> DbResult<Vec<(String, String, ReadState)>> {
        self.with_reader(|c| {
            let mut stmt = c.prepare("SELECT user_id, channel_id, last_read_at, mention_count FROM read_states")?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    ReadState { last_read_at: r.get(2)?, mention_count: r.get::<_, i64>(3)?.max(0) as u32 },
                ))
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    pub fn count_messages(&self, channel_id: &str) -> DbResult<i64> {
        self.with_reader(|c| {
            Ok(c.query_row(
                "SELECT COUNT(*) FROM messages WHERE channel_id = ?1",
                params![channel_id],
                |r| r.get(0),
            )?)
        })
    }
}

fn db_is_empty(conn: &Connection) -> DbResult<bool> {
    let users: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    let servers: i64 = conn.query_row("SELECT COUNT(*) FROM servers", [], |r| r.get(0))?;
    let messages: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
    Ok(users == 0 && servers == 0 && messages == 0)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let raw = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str(&raw) {
        Ok(v) => Some(v),
        Err(e) => {
            warn!("Arquivo legado {} ilegível, ignorado: {e}", path.display());
            None
        }
    }
}

/// Importa `accounts.json`, `servers.json`, `chat_history.json` e `friends.json`
/// para o banco numa única transação. Depois renomeia os arquivos para
/// `*.migrated.bak` (nada é apagado).
fn import_legacy_json(conn: &mut Connection, dir: &Path) -> DbResult<Option<ImportReport>> {
    let accounts_p = dir.join("accounts.json");
    let servers_p = dir.join("servers.json");
    let chat_p = dir.join("chat_history.json");
    let friends_p = dir.join("friends.json");
    let channels_p = dir.join("channels.json");

    let any = [&accounts_p, &servers_p, &chat_p, &friends_p].iter().any(|p| p.exists());
    if !any {
        return Ok(None);
    }
    info!("Importando dados JSON antigos de {} para o SQLite...", dir.display());

    let now = crate::auth::now_ms();
    let session_ttl = 30i64 * 24 * 60 * 60 * 1000;
    let mut report = ImportReport::default();
    let txn = conn.transaction()?;

    if let Some(accounts) = read_json::<HashMap<String, Account>>(&accounts_p) {
        for (key, mut acc) in accounts {
            acc.avatar_url = sanitize_stored_image(acc.avatar_url.take(), MAX_PROFILE_IMAGE_BYTES);
            acc.banner_url = sanitize_stored_image(acc.banner_url.take(), MAX_PROFILE_IMAGE_BYTES);
            if !is_hex_color(&acc.avatar_color) {
                acc.avatar_color = "#5865F2".into();
            }
            // O hash antigo usa o nome original como salt; preserva para a migração.
            if acc.password_salt_key.is_none() {
                acc.password_salt_key = Some(key.clone());
            }
            let legacy_token = std::mem::take(&mut acc.token);
            let data = serde_json::to_string(&acc)?;
            apply(&txn, WriteOp::UpsertUser { id: acc.id.clone(), username_lower: key, data })?;
            report.users += 1;
            if !legacy_token.trim().is_empty() {
                insert_session(
                    &txn,
                    &SessionRecord {
                        token_hash: crate::auth::hash_token(&legacy_token),
                        user_id: acc.id.clone(),
                        created_at: now,
                        last_seen_at: now,
                        expires_at: now + session_ttl,
                        remember: true,
                    },
                )?;
                report.sessions += 1;
            }
        }
    }

    if let Some(servers) = read_json::<Vec<GuildServer>>(&servers_p) {
        for mut srv in servers {
            srv.icon_url = sanitize_stored_image(srv.icon_url.take(), MAX_PROFILE_IMAGE_BYTES);
            srv.banner_url = sanitize_stored_image(srv.banner_url.take(), MAX_PROFILE_IMAGE_BYTES);
            if !is_hex_color(&srv.icon_color) {
                srv.icon_color = "#5865F2".into();
            }
            for role in &mut srv.roles {
                if !is_hex_color(&role.color) {
                    role.color = "#b5bac1".into();
                }
            }
            replace_server(&txn, &srv)?;
            report.servers += 1;
        }
    }

    if let Some(history) = read_json::<HashMap<String, Vec<ChatMessage>>>(&chat_p) {
        for (channel_id, list) in history {
            let total = list.len() as i64;
            for (i, mut msg) in list.into_iter().enumerate() {
                // Mensagens antigas só tinham "HH:MM"; preserva a ordem relativa.
                if msg.created_at == 0 {
                    msg.created_at = now - (total - i as i64) * 1000;
                }
                msg.channel_id = channel_id.clone();
                msg.image_url = msg
                    .image_url
                    .take()
                    .filter(|s| crate::validate::validate_image_data_url(s, MAX_CHAT_IMAGE_BYTES).is_ok());
                msg.author_avatar = sanitize_stored_image(msg.author_avatar.take(), MAX_PROFILE_IMAGE_BYTES);
                if !is_hex_color(&msg.author_color) {
                    msg.author_color = "#5865F2".into();
                }
                upsert_message(&txn, &msg)?;
                report.messages += 1;
            }
        }
    }

    if let Some(friends) = read_json::<FriendsStore>(&friends_p) {
        let value = serde_json::to_string(&friends)?;
        apply(&txn, WriteOp::PutKv { key: KV_FRIENDS.into(), value })?;
        report.friends = true;
    }

    txn.commit()?;

    for p in [&accounts_p, &servers_p, &chat_p, &friends_p, &channels_p] {
        if p.exists() {
            let mut bak = p.clone().into_os_string();
            bak.push(".migrated.bak");
            if let Err(e) = std::fs::rename(p, &bak) {
                warn!("Não foi possível renomear {} após migração: {e}", p.display());
            }
        }
    }
    info!(
        "Migração concluída: {} usuários, {} sessões, {} servidores, {} mensagens.",
        report.users, report.sessions, report.servers, report.messages
    );
    Ok(Some(report))
}

pub fn friends_kv_op(store: &FriendsStore) -> Option<WriteOp> {
    serde_json::to_string(store).ok().map(|value| WriteOp::PutKv {
        key: KV_FRIENDS.into(),
        value,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as Map;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sancord-test-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn msg(id: &str, ch: &str, ts: i64) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            channel_id: ch.into(),
            author_id: "u1".into(),
            author_name: "Ana".into(),
            author_color: "#ffffff".into(),
            author_avatar: None,
            content: format!("msg {id}"),
            image_url: None,
            reply_to: None,
            reactions: Map::new(),
            edited: false,
            pinned: false,
            timestamp: "10:00".into(),
            created_at: ts,
            nonce: Some("n".into()),
            attachments: Vec::new(),
            mentions: Default::default(),
            poll: None,
            author_kind: crate::models::AuthorKind::User,
        }
    }

    #[test]
    fn around_after_and_pins() {
        let dir = temp_dir("around");
        let (db, _) = Db::open(&dir.join("t.db"), None).unwrap();
        for i in 0..40 {
            let mut m = msg(&format!("m{i:03}"), "c", 100 + i);
            m.pinned = i % 10 == 0;
            db.write(WriteOp::UpsertMessage(Box::new(m)));
        }
        db.flush();
        let (list, more_before, more_after) = db.messages_around("c", "m020", 10).unwrap();
        let ids: Vec<&str> = list.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids.first(), Some(&"m015"));
        assert!(ids.contains(&"m020"));
        assert_eq!(ids.last(), Some(&"m024"));
        assert!(more_before && more_after);
        let (after, more) = db.messages_after("c", "m035", 10).unwrap();
        assert_eq!(after.len(), 4);
        assert!(!more);
        let pins = db.pinned_messages("c", 50).unwrap();
        assert_eq!(pins.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["m030", "m020", "m010", "m000"]);
        db.shutdown();
    }

    #[test]
    fn messages_pagination_is_ordered_and_complete() {
        let dir = temp_dir("pag");
        let (db, _) = Db::open(&dir.join("t.db"), None).unwrap();
        for i in 0..250 {
            db.write(WriteOp::UpsertMessage(Box::new(msg(&format!("m{i:04}"), "geral", 1000 + i))));
        }
        db.write(WriteOp::UpsertMessage(Box::new(msg("outro", "rust", 5))));
        db.flush();

        assert_eq!(db.count_messages("geral").unwrap(), 250);
        let (page1, more1) = db.messages_before("geral", None, 50).unwrap();
        assert_eq!(page1.len(), 50);
        assert!(more1);
        assert_eq!(page1.first().unwrap().id, "m0200");
        assert_eq!(page1.last().unwrap().id, "m0249");
        assert!(page1.iter().all(|m| m.nonce.is_none()), "nonce não deve ser persistido");

        // Percorre todo o histórico para trás sem perder nem duplicar mensagens.
        let mut seen = page1.len();
        let mut cursor = page1.first().unwrap().id.clone();
        loop {
            let (page, more) = db.messages_before("geral", Some(&cursor), 50).unwrap();
            seen += page.len();
            if page.is_empty() || !more {
                break;
            }
            cursor = page.first().unwrap().id.clone();
        }
        assert_eq!(seen, 250);

        let recent = db.load_recent_messages(100).unwrap();
        assert_eq!(recent["geral"].len(), 100);
        assert_eq!(recent["geral"].last().unwrap().id, "m0249");
        assert_eq!(recent["rust"].len(), 1);
        db.shutdown();
    }

    #[test]
    fn update_delete_and_rename() {
        let dir = temp_dir("upd");
        let (db, _) = Db::open(&dir.join("t.db"), None).unwrap();
        let mut m = msg("a", "dm:ana__bia", 1);
        db.write(WriteOp::UpsertMessage(Box::new(m.clone())));
        m.content = "editado".into();
        m.edited = true;
        db.write(WriteOp::UpsertMessage(Box::new(m.clone())));
        db.write(WriteOp::RenameChannel { from: "dm:ana__bia".into(), to: "dm:ana__carla".into() });
        db.flush();
        let got = db.get_message("dm:ana__carla", "a").unwrap().unwrap();
        assert_eq!(got.content, "editado");
        assert!(got.edited);
        assert_eq!(got.channel_id, "dm:ana__carla");
        db.write(WriteOp::DeleteMessage { id: "a".into() });
        db.flush();
        assert!(db.get_message("dm:ana__carla", "a").unwrap().is_none());
        db.shutdown();
    }

    #[test]
    fn sessions_roundtrip_and_expiry() {
        let dir = temp_dir("sess");
        let (db, _) = Db::open(&dir.join("t.db"), None).unwrap();
        let s = |h: &str, exp: i64| SessionRecord {
            token_hash: h.into(),
            user_id: "u1".into(),
            created_at: 0,
            last_seen_at: 0,
            expires_at: exp,
            remember: true,
        };
        db.write(WriteOp::InsertSession(s("valida", 10_000)));
        db.write(WriteOp::InsertSession(s("expirada", 10)));
        db.write(WriteOp::InsertSession(s("outra", 10_000)));
        db.flush();
        let live = db.load_sessions(100).unwrap();
        assert_eq!(live.len(), 2);
        db.write(WriteOp::DeleteUserSessionsExcept { user_id: "u1".into(), keep_token_hash: Some("valida".into()) });
        db.flush();
        let live = db.load_sessions(100).unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].token_hash, "valida");
        db.shutdown();
    }

    fn sample_server(id: &str) -> GuildServer {
        let mut srv = GuildServer {
            id: id.into(),
            name: "Rustaceos".into(),
            description: Some("desc".into()),
            icon_url: None,
            icon_color: "#123456".into(),
            banner_url: None,
            owner_username: "ana".into(),
            invite_code: "SANC-ABC234".into(),
            text_channels: vec![
                Channel::new(format!("{id}-geral"), "geral", ChannelKind::Text),
                Channel::new(format!("{id}-avisos"), "avisos", ChannelKind::Announcement),
            ],
            voice_channels: vec![Channel::new(format!("{id}-v1"), "Voz", ChannelKind::Voice)],
            roles: vec![ServerRole {
                id: "everyone".into(),
                name: "@everyone".into(),
                color: "#b5bac1".into(),
                position: 0,
                hoist: false,
                mentionable: false,
                badge_emoji: None,
                permissions: RolePermissions::default(),
            }],
            member_roles: HashMap::from([("bia".to_string(), vec!["everyone".to_string()])]),
            members: vec!["ana".into(), "bia".into()],
            banned_usernames: vec!["carlos".into()],
            categories: Vec::new(),
            is_community: true,
            created_at: 1000,
            member_joined_at: HashMap::from([("bia".to_string(), 5000)]),
            voice_moderation: HashMap::new(),
            automod: Default::default(),
            threads: Vec::new(),
            member_timeouts: HashMap::new(),
        };
        srv.ensure_layout(1000);
        srv
    }

    #[test]
    fn server_roundtrip_normalized() {
        let dir = temp_dir("srv");
        let (db, _) = Db::open(&dir.join("t.db"), None).unwrap();
        let srv = sample_server("s1");
        db.write(WriteOp::ReplaceServer(Box::new(srv.clone())));
        db.flush();
        let loaded = db.load_servers().unwrap();
        assert_eq!(loaded.len(), 1);
        let l = &loaded[0];
        assert_eq!(l.name, "Rustaceos");
        assert!(l.is_community);
        assert_eq!(l.categories.len(), 2);
        assert_eq!(l.text_channels.len(), 2);
        assert_eq!(l.text_channels[1].kind, ChannelKind::Announcement);
        assert_eq!(l.voice_channels[0].category_id.as_deref(), Some("s1-cat-voz"));
        assert_eq!(l.members, vec!["ana".to_string(), "bia".to_string()]);
        assert_eq!(l.member_joined_at["bia"], 5000);
        assert_eq!(l.banned_usernames, vec!["carlos".to_string()]);
        assert_eq!(l.member_roles["bia"], vec!["everyone".to_string()]);

        // Regravar com um canal a menos remove a linha antiga.
        let mut changed = srv.clone();
        changed.text_channels.pop();
        db.write(WriteOp::ReplaceServer(Box::new(changed)));
        db.flush();
        assert_eq!(db.load_servers().unwrap()[0].text_channels.len(), 1);
        db.shutdown();
    }

    #[test]
    fn invites_and_cascade_delete() {
        let dir = temp_dir("inv");
        let (db, _) = Db::open(&dir.join("t.db"), None).unwrap();
        db.write(WriteOp::ReplaceServer(Box::new(sample_server("s1"))));
        let mut inv = Invite {
            code: "SANC-XYZ789".into(),
            server_id: "s1".into(),
            creator: "ana".into(),
            created_at: 1,
            expires_at: Some(99),
            max_uses: Some(5),
            uses: 0,
        };
        db.write(WriteOp::UpsertInvite(inv.clone()));
        inv.uses = 3;
        db.write(WriteOp::UpsertInvite(inv.clone()));
        // Regravar o servidor NÃO pode apagar os convites.
        db.write(WriteOp::ReplaceServer(Box::new(sample_server("s1"))));
        db.flush();
        let invs = db.load_invites().unwrap();
        assert_eq!(invs.len(), 1);
        assert_eq!(invs[0].uses, 3);
        assert_eq!(invs[0].max_uses, Some(5));

        db.write(WriteOp::DeleteServer { id: "s1".into() });
        db.flush();
        assert!(db.load_invites().unwrap().is_empty(), "convites saem junto com o servidor");
        assert!(db.load_servers().unwrap().is_empty());
        db.shutdown();
    }

    #[test]
    fn migrates_v1_server_documents() {
        let dir = temp_dir("v1");
        let path = dir.join("t.db");
        {
            let conn = Connection::open(&path).unwrap();
            // Só a tabela antiga; o bloco v1 cria as demais e o v2 converte esta.
            conn.execute_batch(
                "CREATE TABLE servers (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);",
            )
            .unwrap();
            // Documento no formato antigo (sem categorias/posições).
            let doc = serde_json::json!({
                "id": "srv-old", "name": "Antigo", "icon_color": "#5865F2", "owner_username": "ana",
                "invite_code": "ABC1234",
                "text_channels": [{"id": "srv-old-geral", "name": "geral", "kind": "text"}],
                "voice_channels": [{"id": "srv-old-v1", "name": "Voz", "kind": "voice"}],
                "members": ["ana"]
            });
            conn.execute("INSERT INTO servers VALUES ('srv-old', ?1, 0)", params![doc.to_string()]).unwrap();
        }
        let (db, _) = Db::open(&path, None).unwrap();
        let servers = db.load_servers().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "Antigo");
        assert_eq!(servers[0].text_channels[0].name, "geral");
        assert_eq!(servers[0].voice_channels.len(), 1);
        db.shutdown();
    }

    #[test]
    fn imports_legacy_json_and_sanitizes() {
        let dir = temp_dir("legacy");
        let accounts = serde_json::json!({
            "ana": {
                "id": "id-ana", "username": "Ana", "password_hash": crate::auth::legacy_hash("ana", "1234"),
                "avatar_color": "#ff0000", "avatar_url": "data:image/png;base64,AAA\" onerror=\"x",
                "token": "token-antigo"
            }
        });
        let chat = serde_json::json!({
            "geral": [
                {"id": "1", "channel_id": "geral", "author_id": "x", "author_name": "Ana", "author_color": "#fff",
                 "content": "primeira", "timestamp": "10:00"},
                {"id": "2", "channel_id": "geral", "author_id": "x", "author_name": "Ana", "author_color": "#fff",
                 "content": "segunda", "timestamp": "10:01"}
            ]
        });
        std::fs::write(dir.join("accounts.json"), accounts.to_string()).unwrap();
        std::fs::write(dir.join("chat_history.json"), chat.to_string()).unwrap();

        let (db, report) = Db::open(&dir.join("sancord.db"), Some(&dir)).unwrap();
        let report = report.expect("deveria importar");
        assert_eq!(report.users, 1);
        assert_eq!(report.sessions, 1);
        assert_eq!(report.messages, 2);
        assert!(dir.join("accounts.json.migrated.bak").exists());
        assert!(!dir.join("accounts.json").exists());

        let accs = db.load_accounts().unwrap();
        assert_eq!(accs[0].avatar_url, None, "avatar malicioso deve ser descartado");
        assert_eq!(accs[0].password_salt_key.as_deref(), Some("ana"));
        let sessions = db.load_sessions(crate::auth::now_ms()).unwrap();
        assert_eq!(sessions[0].token_hash, crate::auth::hash_token("token-antigo"));

        let (page, _) = db.messages_before("geral", None, 10).unwrap();
        assert_eq!(page.iter().map(|m| m.content.as_str()).collect::<Vec<_>>(), ["primeira", "segunda"]);
        db.shutdown();

        // Reabrir não importa de novo.
        let (db2, report2) = Db::open(&dir.join("sancord.db"), Some(&dir)).unwrap();
        assert!(report2.is_none());
        db2.shutdown();
    }
}
