//! Estado compartilhado do servidor.
//!
//! O estado em memória é um **cache** do banco: servidores, contas, amizades,
//! sessões e as mensagens mais recentes de cada canal. O SQLite é a fonte de
//! verdade persistente; toda alteração é enfileirada para a thread de escrita
//! (ver `db.rs`), então nenhum handler faz I/O de disco com o lock segurado.
//!
//! Limitação conhecida (Fase 1): o estado ainda fica atrás de um único
//! `RwLock`. Os handlers seguram o lock apenas para trabalho em memória e
//! nunca durante operações lentas (hash de senha, leitura de histórico).
//! A divisão em locks por domínio fica para fases seguintes.

use crate::auth::{self, LoginRateLimiter};
use crate::config::Config;
use crate::chat::ConnRate;
use crate::db::{self, AttachmentRecord, Db, DbError, ReadState, SessionRecord, WriteOp};
use crate::models::{GroupDm, GroupDmInfo, MessageMentions, ReadStateInfo};
use crate::models::{
    Account, Channel, ChannelKind, ChatMessage, DmConversation, FriendInfo, FriendsStore,
    GuildLayoutItem, GuildServer, Invite, InviteInfo, RolePermissions, ServerMessage, ServerRole,
    UserInfo, UserPrefs,
};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tokio::sync::{mpsc, Notify, RwLock};
use tracing::{info, warn};
use uuid::Uuid;

pub type SharedState = Arc<RwLock<ServerState>>;

/// Versão do protocolo WebSocket. 2 = autenticação obrigatória + paginação.
pub const PROTOCOL_VERSION: u32 = 2;
/// Mensagens mantidas em memória por canal (o restante fica só no banco).
pub const MESSAGE_CACHE_PER_CHANNEL: usize = 100;
/// Mensagens por canal enviadas no `Welcome` e por página de histórico.
pub const HISTORY_PAGE_SIZE: usize = 50;
/// Capacidade da fila de saída de cada conexão. Se um cliente não consome
/// rápido o bastante e a fila enche, a conexão é derrubada (o cliente
/// reconecta e recebe o estado completo), em vez de crescer memória sem limite.
pub const OUTBOUND_QUEUE: usize = 1024;
/// Intervalo mínimo entre gravações de "última atividade" de uma sessão.
const SESSION_TOUCH_INTERVAL_MS: i64 = 60 * 60 * 1000;

/// Conexão WebSocket registrada.
pub struct Peer {
    pub tx: mpsc::Sender<ServerMessage>,
    /// Notificado quando a fila de saída estoura: a task de envio encerra a conexão.
    pub kick: Arc<Notify>,
}

pub struct ServerState {
    pub config: Arc<Config>,
    pub db: Arc<Db>,
    pub text_channels: Vec<Channel>,
    pub voice_channels: Vec<Channel>,
    pub servers: Vec<GuildServer>,
    pub accounts: HashMap<String, Account>, // username_lower -> Account
    /// Perfil P2: badges concedidas pelo operador (adges.json na pasta de dados), por username_lower.
    pub badge_grants: HashMap<String, Vec<String>>,
    pub users: HashMap<String, UserInfo>,   // connection_id -> UserInfo
    pub presence_grace: HashMap<String, UserInfo>, // apenas apresentação, sem socket/voz
    pub peers: HashMap<String, Peer>,       // connection_id -> Peer
    /// Cache das mensagens recentes por canal (no máximo `MESSAGE_CACHE_PER_CHANNEL`).
    pub chat_history: HashMap<String, Vec<ChatMessage>>,
    pub scheduled_messages: HashMap<String, crate::scheduled::ScheduledMessage>,
    pub friends_store: FriendsStore,
    /// token_hash -> sessão
    pub sessions: HashMap<String, SessionRecord>,
    /// connection_id -> token_hash da sessão usada naquela conexão
    pub conn_sessions: HashMap<String, String>,
    pub login_limiter: LoginRateLimiter,
    /// código (MAIÚSCULO) -> convite
    pub invites: HashMap<String, Invite>,
    /// account_id -> preferências sincronizadas
    pub user_prefs: HashMap<String, UserPrefs>,
    /// id -> metadados dos anexos enviados
    pub attachments: HashMap<String, AttachmentRecord>,
    /// account_id -> horários dos últimos uploads (limite por minuto)
    pub upload_times: HashMap<String, Vec<i64>>,
    /// (account_id, channel_id) -> posição de leitura
    pub read_states: HashMap<(String, String), ReadState>,
    /// connection_id -> limites de ritmo
    pub rates: HashMap<String, ConnRate>,
    /// chave (conta ou IP) -> limite de prévia de convite HTTP
    pub invite_preview_rates: HashMap<String, crate::chat::SlidingWindow>,
    /// id (gdm:<uuid>) -> grupo privado
    pub group_dms: HashMap<String, GroupDm>,
    /// Direitos de mídia da última entrada na voz, para encerrar conexões ao revogar.
    pub voice_grants: HashMap<String, (bool, bool)>,
    /// Chamadas privadas em andamento (canal dmvoice:/gdmvoice: -> máquina de estados autoritativa).
    pub active_calls: HashMap<String, crate::voice::ActiveCall>,
    /// Configuração centralizada de timeouts/cooldowns de chamadas privadas.
    pub call_timing: crate::voice::CallTimingConfig,
    /// Cooldown anti-spam de toque em chamadas privadas: (caller_lower, channel_id) -> último toque (ms).
    pub call_ring_rates: HashMap<(String, String), i64>,
    /// Janela deslizante anti-spam para criação de chamadas/toques: (caller_lower, channel_id) -> timestamps (ms).
    pub call_ring_windows: HashMap<(String, String), Vec<i64>>,
    /// Timers pendentes de chamadas privadas a serem disparados fora do write lock.
    pub pending_call_timers: Vec<crate::voice::CallTimerAction>,
    /// Anti-spam de eventos sonoros compartilhados de voz: (actor_uid, categoria) -> último envio (ms).
    pub voice_cue_rates: HashMap<(String, String), i64>,
    /// AutoMod: mensagens recentes por autor (instante, hash) para detectar repetição.
    pub automod_recent: HashMap<String, Vec<(i64, u64)>>,
    /// Modo lento: (canal, username_lower) -> última mensagem aceita (ms). Só em memória.
    pub slowmode_last: HashMap<(String, String), i64>,
    /// Eventos agendados: server_id -> eventos (ordenados por início)
    pub events: HashMap<String, Vec<crate::models::ServerEvent>>,
    pub integrations: HashMap<String, crate::integrations::Integration>,
    pub game_catalog: Arc<RwLock<crate::games::GameCatalogCache>>,
    /// account_id -> código de confirmação de e-mail pendente (só o hash, só em memória).
    pub email_codes: HashMap<String, crate::email_verification::PendingCode>,
    /// Envio dos e-mails (SMTP de `data/smtp.json`, log ou memória nos testes).
    pub mailer: crate::mailer::Mailer,
    account_key_by_id: HashMap<String, String>,
    persisted_servers: HashMap<String, u64>,
    persisted_accounts: HashMap<String, u64>,
    persisted_friends: u64,
    last_msg_ts: i64,
}

fn content_hash<T: serde::Serialize>(v: &T) -> (u64, String) {
    let json = serde_json::to_string(v).unwrap_or_default();
    let mut h = DefaultHasher::new();
    json.hash(&mut h);
    (h.finish(), json)
}

fn default_hub(text_channels: Vec<Channel>, voice_channels: Vec<Channel>) -> GuildServer {
    GuildServer {
        id: "sancord".to_string(), // LEGACY COMPATIBILITY: ID técnico do hub legado mantido
        name: "Sanvo".to_string(),
        description: Some("Servidor principal do Sanvo — Hub de voz HD e texto".to_string()),
        icon_url: Some("/logo.png".to_string()),
        icon_color: "#5865F2".to_string(),
        banner_url: None,
        owner_username: String::new(),
        invite_code: "SANCORD".to_string(),
        text_channels,
        voice_channels,
        roles: vec![ServerRole {
            id: "everyone".to_string(),
            name: "@everyone".to_string(),
            color: "#b5bac1".to_string(),
            position: 0,
            hoist: false,
            mentionable: false,
            badge_emoji: None,
            permissions: RolePermissions::default(),
        }],
        member_roles: HashMap::new(),
        members: Vec::new(),
        banned_usernames: Vec::new(),
        ban_reasons: HashMap::new(),
        categories: Vec::new(),
        is_community: true,
        created_at: 0,
        member_joined_at: HashMap::new(),
        voice_moderation: HashMap::new(),
        automod: Default::default(),
        threads: Vec::new(),
        member_timeouts: HashMap::new(),
        member_nicks: HashMap::new(),
        member_profiles: HashMap::new(),
        member_roster: HashMap::new(),
        emojis: Vec::new(),
        invites_paused: false,
        rules_text: None,
        custom_invite_slug: None,
        temporary_members: Vec::new(),
    }
}

fn default_channels() -> (Vec<Channel>, Vec<Channel>) {
    let t = |id: &str| Channel::new(id, id, ChannelKind::Text);
    let v = |id: &str, name: &str| Channel::new(id, name, ChannelKind::Voice);
    (
        vec![t("geral"), t("rust-dev"), t("projetos-e-links")],
        vec![
            v("voice-geral", "Sala Geral"),
            v("voice-gameplay", "Gameplay & Live"),
            v("voice-pair", "Pair Programming"),
        ],
    )
}

/// Valida o layout da barra de servidores: remove IDs desconhecidos/duplicados,
/// pastas vazias, limita nomes/cores e acrescenta servidores ausentes ao fim.
pub fn sanitize_layout(layout: Vec<GuildLayoutItem>, visible: &[String]) -> Vec<GuildLayoutItem> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for item in layout.into_iter().take(500) {
        match item {
            GuildLayoutItem::Server { id } => {
                if visible.contains(&id) && seen.insert(id.clone()) {
                    out.push(GuildLayoutItem::Server { id });
                }
            }
            GuildLayoutItem::Folder { id, name, color, server_ids, collapsed } => {
                let ids: Vec<String> = server_ids
                    .into_iter()
                    .filter(|s| visible.contains(s) && seen.insert(s.clone()))
                    .collect();
                if ids.is_empty() {
                    continue;
                }
                let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
                out.push(GuildLayoutItem::Folder {
                    id: if id.is_empty() { format!("folder-{}", Uuid::new_v4().simple()) } else { id },
                    name: name.trim().chars().filter(|c| !c.is_control()).take(32).collect(),
                    color: color.filter(|c| crate::validate::is_hex_color(c)),
                    server_ids: ids,
                    collapsed,
                });
            }
        }
    }
    for id in visible {
        if !seen.contains(id) {
            out.push(GuildLayoutItem::Server { id: id.clone() });
        }
    }
    out
}

impl ServerState {
    /// Abre o banco (migrando JSON antigos se necessário) e carrega o cache.
    pub fn load(config: Config) -> Result<SharedState, DbError> {
        std::fs::create_dir_all(&config.data_dir)?;
        let (db, report) = Db::open(&config.db_path(), Some(&config.data_dir))?;
        if let Some(r) = report {
            info!(
                "Dados antigos migrados para {}: {} contas, {} sessões, {} servidores, {} mensagens",
                db.path().display(),
                r.users,
                r.sessions,
                r.servers,
                r.messages
            );
        }
        let db = Arc::new(db);
        let now = auth::now_ms();

        let accounts_vec = db.load_accounts()?;
        let mut servers = db.load_servers()?;
        let invites_vec = db.load_invites()?;
        let user_prefs = db.load_user_prefs()?;
        let attachments_vec = db.load_attachments()?;
        let read_states_vec = db.load_read_states()?;
        let group_dms_vec = db.load_group_dms()?;
        let integrations = db.load_integrations()?.into_iter().map(|i| (i.id.clone(), i)).collect();
        let mut events_by_server: HashMap<String, Vec<crate::models::ServerEvent>> = HashMap::new();
        for e in db.load_events()? {
            events_by_server.entry(e.server_id.clone()).or_default().push(e);
        }
        for th in db.load_threads()? {
            if let Some(srv) = servers.iter_mut().find(|s| s.id == th.server_id) {
                srv.threads.push(th);
            }
        }
        for (sid, cfg) in db.load_automod()? {
            if let Some(srv) = servers.iter_mut().find(|s| s.id == sid) {
                srv.automod = cfg;
            }
        }
        for (sid, user, vm) in db.load_voice_moderation()? {
            if let Some(srv) = servers.iter_mut().find(|s| s.id == sid) {
                srv.voice_moderation.insert(user, vm);
            }
        }
        // Castigos vencidos também entram: valem pelo relógio e o laço de expiração os limpa.
        for (sid, user, until) in db.load_member_timeouts()? {
            if let Some(srv) = servers.iter_mut().find(|s| s.id == sid) {
                srv.member_timeouts.insert(user, until);
            }
        }
        let friends_store = db.load_friends()?;
        let chat_history = db.load_recent_messages(MESSAGE_CACHE_PER_CHANNEL)?;
        let sessions_vec = db.load_sessions(now)?;
        db.write(WriteOp::DeleteExpiredSessions { now });

        // Badges são derivadas no servidor (operador + automáticas); o cliente nunca as define.
        let badge_grants = crate::cosmetics::load_badge_grants(&config.data_dir);
        let mut accounts = HashMap::new();
        for mut acc in accounts_vec {
            let lower = acc.username.to_lowercase();
            crate::cosmetics::sync_account_badges(&mut acc, badge_grants.get(&lower).map(Vec::as_slice).unwrap_or(&[]));
            accounts.insert(lower, acc);
        }

        let legacy_hub = config.legacy_hub;
        let created_hub = legacy_hub && servers.is_empty();
        if created_hub {
            let (t, v) = default_channels();
            servers.push(default_hub(t, v));
        }

        let (text_channels, voice_channels) = if legacy_hub {
            servers
                .iter()
                .find(|s| s.id == "sancord")
                .map(|s| (s.text_channels.clone(), s.voice_channels.clone()))
                .unwrap_or_else(default_channels)
        } else {
            (Vec::new(), Vec::new())
        };

        let last_msg_ts = chat_history
            .values()
            .flat_map(|l| l.iter().map(|m| m.created_at))
            .max()
            .unwrap_or(0);

        let game_catalog = crate::games::GameCatalogCache::load(&config.data_dir, config.game_api_enabled);
        let mailer = crate::mailer::Mailer::from_data_dir(&config.data_dir);
        let mut st = Self {
            config: Arc::new(config),
            scheduled_messages: db.load_scheduled()?.into_iter().map(|job| (job.id.clone(), job)).collect(),
            db,
            text_channels,
            voice_channels,
            servers,
            accounts,
            badge_grants,
            users: HashMap::new(),
            peers: HashMap::new(),
            chat_history,
            friends_store,
            sessions: sessions_vec.into_iter().map(|s| (s.token_hash.clone(), s)).collect(),
            conn_sessions: HashMap::new(),
            presence_grace: HashMap::new(),
            login_limiter: LoginRateLimiter::default(),
            invites: invites_vec.into_iter().map(|i| (i.code.to_uppercase(), i)).collect(),
            user_prefs,
            attachments: attachments_vec.into_iter().map(|a| (a.id.clone(), a)).collect(),
            upload_times: HashMap::new(),
            read_states: read_states_vec
                .into_iter()
                .map(|(u, c, s)| ((u, c), s))
                .collect(),
            rates: HashMap::new(),
            invite_preview_rates: HashMap::new(),
            group_dms: group_dms_vec.into_iter().map(|g| (g.id.clone(), g)).collect(),
            voice_grants: HashMap::new(),
            active_calls: HashMap::new(),
            call_timing: crate::voice::CallTimingConfig::default(),
            call_ring_rates: HashMap::new(),
            call_ring_windows: HashMap::new(),
            pending_call_timers: Vec::new(),
            voice_cue_rates: HashMap::new(),
            automod_recent: HashMap::new(),
            slowmode_last: HashMap::new(),
            events: events_by_server,
            integrations,
            game_catalog,
            email_codes: HashMap::new(),
            mailer,
            account_key_by_id: HashMap::new(),
            persisted_servers: HashMap::new(),
            persisted_accounts: HashMap::new(),
            persisted_friends: 0,
            last_msg_ts,
        };

        // Marca o que veio do banco como "já persistido" para que só mudanças
        // reais gerem escrita.
        for srv in &st.servers {
            if !created_hub {
                st.persisted_servers.insert(srv.id.clone(), content_hash(srv).0);
            }
        }
        for acc in st.accounts.values() {
            st.persisted_accounts.insert(acc.id.clone(), content_hash(acc).0);
        }
        st.persisted_friends = content_hash(&st.friends_store).0;
        st.rebuild_account_index();
        crate::profile_board::restore_first_creation(&mut st);
        if !legacy_hub {
            st.purge_legacy_hub();
        }

        // Servidores antigos ganham categorias/posições; cada servidor garante
        // que seu convite padrão exista na tabela de convites.
        for srv in &mut st.servers {
            srv.ensure_layout(now);
        }
        // Grava servidores antes dos convites (chave estrangeira invites -> servers).
        st.save_servers();
        let defaults: Vec<(String, String, String)> = st
            .servers
            .iter()
            .map(|s| (s.id.clone(), s.invite_code.clone(), s.owner_username.clone()))
            .collect();
        for (sid, code, owner) in defaults {
            if !st.invites.contains_key(&code.to_uppercase()) {
                st.register_invite(Invite {
                    code: code.to_uppercase(),
                    server_id: sid,
                    creator: owner,
                    created_at: now,
                    expires_at: None,
                    max_uses: None,
                    uses: 0,
                    channel_id: None,
                    temporary: false,
                    revoked_at: None,
                    revoked_by: None,
                    last_used_at: None,
                });
            }
        }

        for srv in &st.servers {
            for ch in &srv.text_channels {
                st.chat_history.entry(ch.id.clone()).or_default();
            }
        }

        if created_hub {
            st.save_servers();
            let ts = st.next_message_ts();
            st.insert_message(ChatMessage {
                id: Uuid::new_v4().to_string(),
                channel_id: "geral".to_string(),
                author_id: "system".to_string(),
                author_name: "Sanvo Bot".to_string(),
                author_color: "#5865F2".to_string(),
                author_avatar: Some("/logo.png".to_string()),
                content: "Bem-vindo ao Sanvo! Sua conta fica salva automaticamente para você entrar direto nas próximas vezes.".to_string(),
                image_url: None,
                reply_to: None,
                reactions: HashMap::new(),
                edited: false,
                pinned: false,
                timestamp: chrono::Local::now().format("%H:%M").to_string(),
                created_at: ts,
                nonce: None,
                attachments: Vec::new(),
                mentions: MessageMentions::default(),
                poll: None,
                author_kind: crate::models::AuthorKind::System,
                embeds: Vec::new(),
                forward: None,
            });
        }

        Ok(Arc::new(RwLock::new(st)))
    }

    // ---------------------------------------------------------------------
    // Persistência
    // ---------------------------------------------------------------------

    fn rebuild_account_index(&mut self) {
        self.account_key_by_id = self
            .accounts
            .iter()
            .map(|(k, a)| (a.id.clone(), k.clone()))
            .collect();
    }

    /// Grava amizades/DMs abertas se mudaram desde a última gravação.
    pub fn save_friends(&mut self) {
        let (h, _) = content_hash(&self.friends_store);
        if h != self.persisted_friends {
            if let Some(op) = db::friends_kv_op(&self.friends_store) {
                self.db.write(op);
                self.persisted_friends = h;
            }
        }
    }

    /// Apaga de vez o antigo hub público "sancord", em que toda conta entrava sozinha:
    /// canais, mensagens, threads, convites, eventos, integrações e agendamentos dele.
    /// O servidor sai do banco no próximo `save_servers` (cascata das tabelas filhas).
    fn purge_legacy_hub(&mut self) {
        let Some(pos) = self.servers.iter().position(|s| s.id == "sancord") else { return };
        let hub = self.servers.remove(pos);
        let rooms: Vec<String> = hub
            .text_channels
            .iter()
            .chain(hub.voice_channels.iter())
            .map(|c| c.id.clone())
            .chain(hub.threads.iter().map(|t| t.id.clone()))
            .collect();
        for room in &rooms {
            crate::integrations::remove_channel(self, room);
            self.delete_channel_history(room);
        }
        let scheduled: Vec<String> = self
            .scheduled_messages
            .values()
            .filter(|job| rooms.contains(&job.channel_id))
            .map(|job| job.id.clone())
            .collect();
        for id in scheduled {
            self.scheduled_messages.remove(&id);
            self.db.write(WriteOp::DeleteScheduled { id });
        }
        self.invites.retain(|_, inv| inv.server_id != "sancord");
        self.events.remove("sancord");
        self.text_channels.clear();
        self.voice_channels.clear();
        tracing::info!("Hub público \"sancord\" removido com {} canais/threads e o histórico deles.", rooms.len());
    }

    /// Grava apenas os servidores que mudaram (e remove os excluídos).
    pub fn save_servers(&mut self) {
        self.enforce_voice_access();
        self.refresh_voice_grants();
        if let Some(hub) = self.servers.iter().find(|s| s.id == "sancord") {
            self.text_channels = hub.text_channels.clone();
            self.voice_channels = hub.voice_channels.clone();
        }
        let mut alive = HashSet::new();
        for srv in &self.servers {
            alive.insert(srv.id.clone());
            let (h, _) = content_hash(srv);
            if self.persisted_servers.get(&srv.id) != Some(&h) {
                self.db.write(WriteOp::ReplaceServer(Box::new(srv.clone())));
                self.persisted_servers.insert(srv.id.clone(), h);
            }
        }
        let removed: Vec<String> = self
            .persisted_servers
            .keys()
            .filter(|id| !alive.contains(*id))
            .cloned()
            .collect();
        for id in removed {
            self.db.write(WriteOp::DeleteServer { id: id.clone() });
            self.persisted_servers.remove(&id);
        }
    }

    /// Grava apenas as contas que mudaram.
    pub fn save_accounts(&mut self) {
        for (key, acc) in &self.accounts {
            let (h, json) = content_hash(acc);
            if self.persisted_accounts.get(&acc.id) != Some(&h) {
                self.db.write(WriteOp::UpsertUser {
                    id: acc.id.clone(),
                    username_lower: key.clone(),
                    data: json,
                });
                self.persisted_accounts.insert(acc.id.clone(), h);
            }
        }
        self.rebuild_account_index();
    }

    /// Remove completamente uma conta e todas as referências a ela em memória e no banco.
    pub fn remove_account(&mut self, account_id: &str, username_lower: &str) {
        self.accounts.remove(username_lower);
        self.persisted_accounts.remove(account_id);
        self.rebuild_account_index();
        self.user_prefs.remove(account_id);
        self.scheduled_messages.retain(|_, job| job.account_id != account_id);
        self.rates.remove(account_id);
        self.upload_times.remove(account_id);
        self.read_states.retain(|(u, _), _| u != account_id);

        let mut touched_servers = Vec::new();
        for srv in &mut self.servers {
            let was_member = srv.members.iter().any(|m| m == username_lower);
            srv.members.retain(|m| m != username_lower);
            srv.member_roles.remove(username_lower);
            srv.member_joined_at.remove(username_lower);
            srv.member_nicks.remove(username_lower);
            srv.member_profiles.remove(username_lower);
            srv.voice_moderation.remove(username_lower);
            srv.member_timeouts.remove(username_lower);
            if was_member {
                touched_servers.push(srv.id.clone());
            }
        }
        self.save_servers();
        for sid in touched_servers {
            if let Some(srv) = self.find_server(&sid).cloned() {
                self.broadcast_to_server(&sid, ServerMessage::ServerUpdated { server: srv });
            }
        }

        let fs = &mut self.friends_store;
        for map in [
            &mut fs.friends,
            &mut fs.incoming_requests,
            &mut fs.outgoing_requests,
            &mut fs.blocked,
        ] {
            map.remove(username_lower);
            for list in map.values_mut() {
                list.retain(|x| x != username_lower);
            }
        }
        fs.open_dms.remove(username_lower);
        fs.dm_requests.remove(username_lower);
        fs.ignored_dms.remove(username_lower);
        self.save_friends();

        let group_ids: Vec<String> = self
            .group_dms
            .values()
            .filter(|g| g.members.iter().any(|m| m == username_lower))
            .map(|g| g.id.clone())
            .collect();
        for gid in group_ids {
            if let Some(g) = self.group_dms.get_mut(&gid) {
                g.members.retain(|m| m != username_lower);
                if g.members.is_empty() {
                    self.group_dms.remove(&gid);
                    self.db.write(WriteOp::DeleteGroupDm { id: gid });
                    continue;
                }
                if g.owner == username_lower {
                    g.owner = g.members[0].clone();
                }
            }
            self.save_group(&gid);
        }

        self.db.write(WriteOp::DeleteUser {
            id: account_id.to_string(),
            username_lower: username_lower.to_string(),
        });
    }

    /// Timestamp monotônico para novas mensagens (evita empates na ordenação).
    pub fn next_message_ts(&mut self) -> i64 {
        let now = auth::now_ms();
        self.last_msg_ts = now.max(self.last_msg_ts + 1);
        self.last_msg_ts
    }

    /// Adiciona uma nova mensagem ao cache e ao banco.
    pub fn insert_message(&mut self, msg: ChatMessage) {
        let stored = Box::new(msg.clone());
        let receipt = msg.nonce.as_deref().filter(|id| crate::ws::durable_chat_nonce(id).is_some())
            .and_then(|nonce| self.account_id_for(&msg.author_name.to_lowercase()).map(|id| (id, nonce)));
        self.db.write(match receipt {
            Some((account_id, nonce)) => WriteOp::DeliverChat { message: stored, account_id, nonce: nonce.to_string() },
            None => WriteOp::UpsertMessage(stored),
        });
        self.cache_message(msg);
    }

    pub fn publish_scheduled_message(&mut self, id: String, msg: ChatMessage) {
        self.db.write(WriteOp::PublishScheduled { id: id.clone(), message: Box::new(msg.clone()) });
        self.scheduled_messages.remove(&id);
        self.cache_message(msg);
    }

    fn cache_message(&mut self, msg: ChatMessage) {
        let list = self.chat_history.entry(msg.channel_id.clone()).or_default();
        let mut cached = msg;
        cached.nonce = None;
        list.push(cached);
        if list.len() > MESSAGE_CACHE_PER_CHANNEL {
            let excess = list.len() - MESSAGE_CACHE_PER_CHANNEL;
            list.drain(..excess);
        }
    }

    /// Persiste uma mensagem alterada (edição, reação, fixação).
    pub fn persist_message(&self, msg: &ChatMessage) {
        self.db.write(WriteOp::UpsertMessage(Box::new(msg.clone())));
    }

    pub fn remove_message(&mut self, channel_id: &str, message_id: &str) {
        if let Some(list) = self.chat_history.get_mut(channel_id) {
            list.retain(|m| m.id != message_id);
        }
        self.db.write(WriteOp::DeleteMessage { id: message_id.to_string() });
    }

    pub fn remove_messages_by_ids(&mut self, channel_id: &str, ids: &[String]) {
        if ids.is_empty() {
            return;
        }
        let set: HashSet<&str> = ids.iter().map(String::as_str).collect();
        if let Some(list) = self.chat_history.get_mut(channel_id) {
            list.retain(|m| !set.contains(m.id.as_str()));
        }
        self.db.write(WriteOp::DeleteMessagesByIds { ids: ids.to_vec() });
    }

    pub fn delete_channel_history(&mut self, channel_id: &str) {
        self.chat_history.remove(channel_id);
        self.read_states.retain(|(_, c), _| c != channel_id);
        self.db.write(WriteOp::DeleteChannelMessages { channel_id: channel_id.to_string() });
        self.db.write(WriteOp::DeleteReadStatesForChannel { channel_id: channel_id.to_string() });
    }

    // ---------------------------------------------------------------------
    // Leitura, não lidas e menções
    // ---------------------------------------------------------------------

    pub fn account_id_for(&self, username_lower: &str) -> Option<String> {
        self.accounts.get(username_lower).map(|a| a.id.clone())
    }

    fn put_read_state(&mut self, account_id: &str, channel_id: &str, state: ReadState) {
        self.read_states
            .insert((account_id.to_string(), channel_id.to_string()), state);
        self.db.write(WriteOp::UpsertReadState {
            user_id: account_id.to_string(),
            channel_id: channel_id.to_string(),
            state,
        });
    }

    pub fn read_state(&self, account_id: &str, channel_id: &str) -> ReadState {
        self.read_states
            .get(&(account_id.to_string(), channel_id.to_string()))
            .copied()
            .unwrap_or_default()
    }

    /// Marca como lido até `ts` (nunca volta no tempo) e zera as menções.
    pub fn mark_read(&mut self, account_id: &str, channel_id: &str, ts: i64) -> ReadStateInfo {
        let mut s = self.read_state(account_id, channel_id);
        if ts > s.last_read_at || s.mention_count > 0 {
            s.last_read_at = s.last_read_at.max(ts);
            s.mention_count = 0;
            self.put_read_state(account_id, channel_id, s);
        }
        ReadStateInfo { channel_id: channel_id.to_string(), last_read_at: s.last_read_at, mention_count: s.mention_count }
    }

    /// "Marcar como não lida": volta a posição para antes de `ts`.
    pub fn mark_unread(&mut self, account_id: &str, channel_id: &str, ts: i64) -> ReadStateInfo {
        let mut s = self.read_state(account_id, channel_id);
        s.last_read_at = ts - 1;
        self.put_read_state(account_id, channel_id, s);
        ReadStateInfo { channel_id: channel_id.to_string(), last_read_at: s.last_read_at, mention_count: s.mention_count }
    }

    /// Canais com mensagens (texto, chat de voz, threads e DMs) que o usuário pode ler.
    pub fn readable_channels(&self, username_lower: &str) -> Vec<String> {
        let mut out: Vec<String> = self
            .servers
            .iter()
            .filter(|s| s.is_member(username_lower))
            .flat_map(|s| {
                s.text_channels
                    .iter()
                    .chain(s.voice_channels.iter())
                    .map(|c| c.id.clone())
                    .chain(s.threads.iter().map(|t| t.id.clone()))
                    .filter(|id| self.can_view_channel(username_lower, id))
                    .collect::<Vec<_>>()
            })
            .collect();
        out.extend(
            self.chat_history
                .keys()
                .filter(|k| k.starts_with("dm:") && Self::is_dm_participant(k, username_lower))
                .cloned(),
        );
        out.extend(
            self.group_dms
                .values()
                .filter(|g| g.members.iter().any(|m| m == username_lower))
                .map(|g| g.id.clone()),
        );
        out
    }

    /// Estados de leitura enviados no Welcome. Na primeira vez de uma conta
    /// (nenhum registro ainda) marca tudo como lido, para que o histórico antigo
    /// não apareça todo como "não lido" depois da atualização.
    pub fn read_states_for(&mut self, account_id: &str, username_lower: &str) -> Vec<ReadStateInfo> {
        let channels = self.readable_channels(username_lower);
        let has_any = self.read_states.keys().any(|(u, _)| u == account_id);
        if !has_any {
            let now = auth::now_ms();
            for ch in &channels {
                self.put_read_state(account_id, ch, ReadState { last_read_at: now, mention_count: 0 });
            }
        }
        channels
            .into_iter()
            .map(|ch| {
                let s = self.read_state(account_id, &ch);
                ReadStateInfo { channel_id: ch, last_read_at: s.last_read_at, mention_count: s.mention_count }
            })
            .collect()
    }

    fn mention_targets(&self, channel_id: &str, author_lower: &str, mentions: &MessageMentions) -> HashSet<String> {
        let mut targets: HashSet<String> = HashSet::new();
        if Self::is_private_text(channel_id) {
            // DM e grupo: toda mensagem notifica os outros participantes,
            // exceto solicitações de mensagem e remetentes bloqueados pelo destinatário.
            for p in self.private_participants(channel_id) {
                if !self.friends_store.is_silenced(&p, channel_id)
                    && !self.friends_store.has_blocked(&p, author_lower)
                {
                    targets.insert(p);
                }
            }
        } else if let Some(srv) = self.find_server_by_text_channel(channel_id) {
            // O hub "sancord" aceita todas as contas (a lista `members` dele é parcial).
            let members: Vec<String> = if srv.id == "sancord" {
                self.accounts.keys().cloned().collect()
            } else {
                srv.members
                    .iter()
                    .cloned()
                    .chain(std::iter::once(srv.owner_username.clone()))
                    .filter(|m| !m.is_empty())
                    .collect()
            };
            if mentions.everyone {
                targets.extend(members.iter().cloned());
            }
            if mentions.online {
                let online: HashSet<String> = self
                    .users
                    .values()
                    .filter(|u| u.status_kind != "invisible")
                    .map(|u| u.username.to_lowercase())
                    .collect();
                targets.extend(members.iter().filter(|m| online.contains(*m)).cloned());
            }
            for role in &mentions.roles {
                for (user, roles) in &srv.member_roles {
                    if roles.contains(role) {
                        targets.insert(user.clone());
                    }
                }
            }
            for u in &mentions.users {
                if srv.is_member(u) {
                    targets.insert(u.clone());
                }
            }
        }
        targets.remove(author_lower);
        targets.retain(|user| self.can_view_channel(user, channel_id));
        targets
    }

    /// Soma uma menção para cada destinatário da mensagem (exceto o autor).
    /// Em DM, toda mensagem conta como menção para o outro participante.
    pub fn bump_mentions(&mut self, channel_id: &str, author_lower: &str, mentions: &MessageMentions) {
        let targets = self.mention_targets(channel_id, author_lower, mentions);
        for lower in targets {
            if let Some(acc) = self.account_id_for(&lower) {
                let mut s = self.read_state(&acc, channel_id);
                s.mention_count = s.mention_count.saturating_add(1);
                self.put_read_state(&acc, channel_id, s);
            }
        }
    }

    /// Quando uma mensagem ainda não lida que gerou notificação é apagada, reduz o contador
    /// de menções pendentes e sincroniza `ReadStateUpdated` com as sessões ativas (#54).
    pub fn decrement_mentions_on_delete(&mut self, msg: &ChatMessage) {
        let author_lower = msg.author_name.to_lowercase();
        let targets = self.mention_targets(&msg.channel_id, &author_lower, &msg.mentions);
        for lower in targets {
            if let Some(acc) = self.account_id_for(&lower) {
                let mut s = self.read_state(&acc, &msg.channel_id);
                if msg.created_at > s.last_read_at && s.mention_count > 0 {
                    s.mention_count = s.mention_count.saturating_sub(1);
                    self.put_read_state(&acc, &msg.channel_id, s);
                    let info = ReadStateInfo {
                        channel_id: msg.channel_id.clone(),
                        last_read_at: s.last_read_at,
                        mention_count: s.mention_count,
                    };
                    self.send_read_state(&lower, info);
                }
            }
        }
    }

    /// Envia o estado de leitura para todas as conexões da conta.
    pub fn send_read_state(&self, username_lower: &str, info: ReadStateInfo) {
        for (uid, u) in &self.users {
            if u.username.to_lowercase() == username_lower {
                self.send_to(uid, ServerMessage::ReadStateUpdated { state: info.clone() });
            }
        }
    }

    /// Renomeia um canal no cache e no banco (IDs de DM contêm usernames).
    pub fn rename_channel_history(&mut self, from: &str, to: &str) {
        if from == to {
            return;
        }
        if let Some(mut list) = self.chat_history.remove(from) {
            for m in &mut list {
                m.channel_id = to.to_string();
            }
            self.chat_history.insert(to.to_string(), list);
        }
        let moved: Vec<((String, String), ReadState)> = self
            .read_states
            .iter()
            .filter(|((_, c), _)| c == from)
            .map(|(k, v)| (k.clone(), *v))
            .collect();
        for ((u, _), s) in moved {
            self.read_states.remove(&(u.clone(), from.to_string()));
            self.read_states.insert((u, to.to_string()), s);
        }
        self.db.write(WriteOp::RenameChannel { from: from.to_string(), to: to.to_string() });
        self.db.write(WriteOp::RenameReadStatesChannel { from: from.to_string(), to: to.to_string() });
    }

    // ---------------------------------------------------------------------
    // Sessões
    // ---------------------------------------------------------------------

    pub fn account_by_id(&self, id: &str) -> Option<&Account> {
        self.account_key_by_id.get(id).and_then(|k| self.accounts.get(k))
    }

    /// Cria uma sessão e devolve o token em texto puro (só o cliente o guarda).
    pub fn create_session(&mut self, user_id: &str, remember: bool) -> String {
        let token = auth::generate_token();
        let now = auth::now_ms();
        let rec = SessionRecord {
            token_hash: auth::hash_token(&token),
            user_id: user_id.to_string(),
            created_at: now,
            last_seen_at: now,
            expires_at: now + self.config.session_ttl_ms(remember),
            remember,
        };
        self.db.write(WriteOp::InsertSession(rec.clone()));
        self.sessions.insert(rec.token_hash.clone(), rec);
        token
    }

    /// Valida o token e renova a expiração deslizante. Retorna (token_hash, conta).
    pub fn validate_session(&mut self, token: &str) -> Option<(String, Account)> {
        let token = token.trim();
        if token.is_empty() {
            return None;
        }
        let hash = auth::hash_token(token);
        let now = auth::now_ms();
        let ttl_remember = self.config.session_ttl_ms(true);
        let ttl_short = self.config.session_ttl_ms(false);
        let rec = self.sessions.get_mut(&hash)?;
        if rec.expires_at <= now {
            self.sessions.remove(&hash);
            self.db.write(WriteOp::DeleteSession { token_hash: hash });
            return None;
        }
        if now - rec.last_seen_at > SESSION_TOUCH_INTERVAL_MS {
            rec.last_seen_at = now;
            rec.expires_at = now + if rec.remember { ttl_remember } else { ttl_short };
            self.db.write(WriteOp::TouchSession {
                token_hash: hash.clone(),
                last_seen_at: rec.last_seen_at,
                expires_at: rec.expires_at,
            });
        }
        let user_id = rec.user_id.clone();
        let acc = self.account_by_id(&user_id)?.clone();
        Some((hash, acc))
    }

    pub fn revoke_session(&mut self, token_hash: &str) {
        self.sessions.remove(token_hash);
        self.db.write(WriteOp::DeleteSession { token_hash: token_hash.to_string() });
        self.kick_orphaned_connections();
    }

    /// Revoga as demais sessões do usuário (ex.: após troca de senha).
    pub fn revoke_other_sessions(&mut self, user_id: &str, keep_token_hash: Option<&str>) {
        self.sessions
            .retain(|h, s| s.user_id != user_id || Some(h.as_str()) == keep_token_hash);
        self.db.write(WriteOp::DeleteUserSessionsExcept {
            user_id: user_id.to_string(),
            keep_token_hash: keep_token_hash.map(|s| s.to_string()),
        });
        self.kick_orphaned_connections();
    }

    /// Encerra imediatamente conexões WebSocket cujo token de sessão não está mais ativo.
    pub fn kick_orphaned_connections(&self) {
        let conns: Vec<String> = self
            .conn_sessions
            .iter()
            .filter(|(_, h)| !self.sessions.contains_key(*h))
            .map(|(c, _)| c.clone())
            .collect();
        for c in conns {
            if let Some(peer) = self.peers.get(&c) {
                peer.kick.notify_one();
            }
        }
    }

    /// Lista as sessões ativas de uma conta, ordenadas com a sessão atual primeiro.
    pub fn sessions_for_account(
        &self,
        account_id: &str,
        current_token_hash: Option<&str>,
    ) -> Vec<crate::models::SessionInfo> {
        let now = auth::now_ms();
        let mut list: Vec<crate::models::SessionInfo> = self
            .sessions
            .values()
            .filter(|s| s.user_id == account_id && s.expires_at > now)
            .map(|s| {
                let id: String = s.token_hash.chars().take(16).collect();
                let current = current_token_hash.is_some_and(|h| h == s.token_hash);
                let connected = self.conn_sessions.values().any(|h| h == &s.token_hash);
                crate::models::SessionInfo {
                    id,
                    created_at: s.created_at,
                    last_seen_at: s.last_seen_at,
                    expires_at: s.expires_at,
                    remember: s.remember,
                    current,
                    connected,
                }
            })
            .collect();
        list.sort_by(|a, b| {
            b.current
                .cmp(&a.current)
                .then_with(|| b.last_seen_at.cmp(&a.last_seen_at))
        });
        list
    }

    // ---------------------------------------------------------------------
    // DMs e histórico
    // ---------------------------------------------------------------------

    pub fn make_dm_id(a_lower: &str, b_lower: &str) -> String {
        if a_lower <= b_lower {
            format!("dm:{}__{}", a_lower, b_lower)
        } else {
            format!("dm:{}__{}", b_lower, a_lower)
        }
    }

    /// Canal privado (DM 1:1 ou grupo), de texto ou de chamada.
    pub fn is_dm_channel(channel_id: &str) -> bool {
        ["dm:", "dmvoice:", "gdm:", "gdmvoice:"].iter().any(|p| channel_id.starts_with(p))
    }

    /// Conversa privada de texto (DM 1:1 ou grupo).
    pub fn is_private_text(channel_id: &str) -> bool {
        channel_id.starts_with("dm:") || channel_id.starts_with("gdm:")
    }

    /// Grupo de um canal de texto (`gdm:x`) ou de chamada (`gdmvoice:x`).
    pub fn group_for_channel(&self, channel_id: &str) -> Option<&GroupDm> {
        if let Some(raw) = channel_id.strip_prefix("gdmvoice:") {
            return self.group_dms.get(&format!("gdm:{raw}"));
        }
        self.group_dms.get(channel_id).filter(|_| channel_id.starts_with("gdm:"))
    }

    /// Participantes (username_lower) de uma conversa privada.
    pub fn private_participants(&self, channel_id: &str) -> Vec<String> {
        if let Some((a, b)) = Self::parse_dm_participants(channel_id) {
            return vec![a, b];
        }
        self.group_for_channel(channel_id).map(|g| g.members.clone()).unwrap_or_default()
    }

    /// Ponto único para "esta pessoa participa desta conversa privada?".
    pub fn is_private_participant(&self, channel_id: &str, username_lower: &str) -> bool {
        self.private_participants(channel_id).iter().any(|m| m == username_lower)
    }

    pub fn privacy_of(&self, username_lower: &str) -> crate::models::PrivacySettings {
        self.account_id_for(username_lower)
            .and_then(|id| self.user_prefs.get(&id))
            .map(|p| p.privacy.clone().sanitized())
            .unwrap_or_default()
    }

    /// Têm servidor em comum (fora o hub público) ou amigo em comum?
    pub fn share_context(&self, a: &str, b: &str) -> bool {
        let common_server = self
            .servers
            .iter()
            .any(|s| s.id != "sancord" && s.is_member(a) && s.is_member(b));
        let fa = self.friends_store.friends.get(a);
        let common_friend = fa.is_some_and(|list| list.iter().any(|f| self.friends_store.are_friends(f, b)));
        common_server || common_friend
    }

    /// Regras para `sender` mandar mensagem na DM com `recipient`.
    /// Ok(true) = vira solicitação de mensagem para o destinatário.
    pub fn dm_delivery(&self, sender: &str, recipient: &str, dm_id: &str) -> Result<bool, &'static str> {
        let fs = &self.friends_store;
        if fs.has_blocked(sender, recipient) {
            return Err("Você bloqueou este usuário. Desbloqueie para enviar mensagens.");
        }
        if fs.has_blocked(recipient, sender) {
            // Mensagem genérica: não revela que houve bloqueio.
            return Err("Não é possível enviar mensagens para este usuário.");
        }
        if fs.are_friends(sender, recipient) {
            return Ok(false);
        }
        // Já aceita: o destinatário respondeu/aceitou antes (está na lista dele e não é solicitação).
        let accepted = fs.open_dms.get(recipient).is_some_and(|l| l.iter().any(|d| d == dm_id))
            && !fs.is_request(recipient, dm_id);
        if accepted {
            return Ok(false);
        }
        match self.privacy_of(recipient).dm_policy.as_str() {
            "everyone" => Ok(false),
            "friends" => Err("Esta pessoa só recebe mensagens de amigos."),
            _ => Ok(true),
        }
    }

    /// Regras para `from` enviar pedido de amizade a `to`.
    pub fn friend_request_allowed(&self, from: &str, to: &str) -> Result<(), &'static str> {
        if self.friends_store.has_blocked(from, to) {
            return Err("Você bloqueou este usuário. Desbloqueie antes de adicioná-lo.");
        }
        if self.friends_store.has_blocked(to, from) {
            return Err("Não foi possível enviar o pedido de amizade.");
        }
        match self.privacy_of(to).friend_requests.as_str() {
            "none" => Err("Esta pessoa não está aceitando pedidos de amizade."),
            "mutual" if !self.share_context(from, to) => {
                Err("Esta pessoa só aceita pedidos de amigos de amigos ou de quem está em um servidor em comum.")
            }
            _ => Ok(()),
        }
    }

    /// Limpa status personalizados vencidos. Retorna quem mudou (para avisar os outros).
    pub fn clear_expired_statuses(&mut self, now: i64) -> Vec<String> {
        let expired: Vec<String> = self
            .accounts
            .iter()
            .filter(|(_, a)| a.custom_status_expires_at.is_some_and(|t| t <= now))
            .map(|(k, _)| k.clone())
            .collect();
        for key in &expired {
            if let Some(acc) = self.accounts.get_mut(key) {
                acc.custom_status = None;
                acc.custom_status_emoji = None;
                acc.custom_status_expires_at = None;
            }
            for u in self.users.values_mut() {
                if u.username.to_lowercase() == *key {
                    u.custom_status = None;
                    u.custom_status_emoji = None;
                    u.custom_status_expires_at = None;
                }
            }
        }
        if !expired.is_empty() {
            self.save_accounts();
        }
        expired
    }

    pub fn group_info(&self, g: &GroupDm) -> GroupDmInfo {
        let last = self.chat_history.get(&g.id).and_then(|l| l.last());
        GroupDmInfo {
            id: g.id.clone(),
            name: g.name.clone(),
            icon_url: g.icon_url.clone(),
            owner: g.owner.clone(),
            members: g.members.iter().filter_map(|m| self.resolve_friend_info(m)).collect(),
            voice_channel_id: g.voice_channel_id(),
            last_message: last.map(|m| m.content.chars().take(60).collect()),
            last_timestamp: last.map(|m| m.timestamp.clone()),
        }
    }

    pub fn save_group(&mut self, id: &str) {
        if let Some(g) = self.group_dms.get(id) {
            self.db.write(WriteOp::UpsertGroupDm(Box::new(g.clone())));
        }
    }

    pub fn parse_dm_participants(channel_id: &str) -> Option<(String, String)> {
        let body = channel_id
            .strip_prefix("dm:")
            .or_else(|| channel_id.strip_prefix("dmvoice:"))?;
        let (p1, p2) = body.split_once("__")?;
        if p1.is_empty() || p2.is_empty() {
            return None;
        }
        Some((p1.to_string(), p2.to_string()))
    }

    pub fn is_dm_participant(channel_id: &str, username_lower: &str) -> bool {
        Self::parse_dm_participants(channel_id)
            .map(|(a, b)| a == username_lower || b == username_lower)
            .unwrap_or(false)
    }

    /// O usuário pode ler este canal de texto? (DM própria ou servidor do qual é membro)
    pub fn can_read_text_channel(&self, username_lower: &str, channel_id: &str) -> bool {
        if Self::is_private_text(channel_id) {
            return self.is_private_participant(channel_id, username_lower);
        }
        self.find_server_by_text_channel(channel_id)
            .map(|s| { let p = s.channel_permissions(username_lower, channel_id); p.view_channel && p.read_history })
            .unwrap_or(false)
    }

    fn tail(list: &[ChatMessage]) -> Vec<ChatMessage> {
        let start = list.len().saturating_sub(HISTORY_PAGE_SIZE);
        list[start..].to_vec()
    }

    pub fn public_chat_history_for(&self, username_lower: &str) -> HashMap<String, Vec<ChatMessage>> {
        let mut allowed_channels: HashSet<&str> = HashSet::new();
        for srv in self.servers.iter().filter(|s| s.is_member(username_lower)) {
            for ch in srv.text_channels.iter().chain(srv.voice_channels.iter()) {
                if self.can_read_text_channel(username_lower, &ch.id) { allowed_channels.insert(ch.id.as_str()); }
            }
        }
        self.chat_history
            .iter()
            .filter(|(k, _)| !Self::is_dm_channel(k) && allowed_channels.contains(k.as_str()))
            .map(|(k, v)| (k.clone(), Self::tail(v)))
            .collect()
    }

    // ---------------------------------------------------------------------
    // Servidores
    // ---------------------------------------------------------------------

    /// Novo código de convite criptograficamente aleatório no formato `SANC-XXXXXXXX`
    /// (8 caracteres Base32 sem ambiguidade: 0/O, 1/I/L — 40 bits de entropia) e
    /// garantidamente único (jamais reutiliza códigos ativos ou revogados).
    pub fn generate_invite_code(&self) -> String {
        use argon2::password_hash::rand_core::{OsRng, RngCore};
        const ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
        loop {
            let mut bytes = [0u8; 8];
            OsRng.fill_bytes(&mut bytes);
            let body: String = bytes
                .iter()
                .map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char)
                .collect();
            let code = format!("SANC-{body}");
            if !self.invites.contains_key(&code)
                && !self
                    .servers
                    .iter()
                    .any(|s| s.custom_invite_slug.as_deref().is_some_and(|sl| sl.eq_ignore_ascii_case(&code)))
            {
                return code;
            }
        }
    }

    /// Valida e normaliza um slug personalizado de convite (3–32 chars, `[a-z0-9-]`,
    /// sem hifens no início/fim/duplos e fora da lista de nomes reservados).
    pub fn validate_custom_invite_slug(raw: &str) -> Result<String, &'static str> {
        let slug = raw.trim().to_lowercase();
        if slug.len() < 3 || slug.len() > 32 {
            return Err("O link personalizado deve ter entre 3 e 32 caracteres.");
        }
        if !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err("Use apenas letras sem acento, números e hífen (-).");
        }
        if slug.starts_with('-') || slug.ends_with('-') || slug.contains("--") {
            return Err("O link personalizado não pode começar, terminar ou repetir hífen.");
        }
        const RESERVED: &[&str] = &[
            "api", "invite", "invites", "login", "register", "admin", "sanvo", "sancord", "system",
            "open", "ws", "health", "attachments", "settings", "help", "support", "channel",
            "channels", "server", "servers", "user", "users", "dm", "voice", "auth",
            "logout", "session", "public-url",
        ];
        if RESERVED.contains(&slug.as_str()) || slug.starts_with("sanv-") || slug.starts_with("sanc-") {
            return Err("Este endereço é reservado. Escolha outro nome.");
        }
        Ok(slug)
    }

    /// Extrai o código de convite de uma entrada crua (código puro, `?invite=`,
    /// `sanvo://invite/CODIGO`, `sancord://invite/CODIGO`, `https://.../invite/CODIGO`,
    /// `sanvo.gg/CODIGO` ou `sancord.gg/CODIGO`).
    pub fn extract_invite_code(raw: &str) -> String {
        let trimmed = raw.trim();
        let candidate = if let Some((_, after)) = trimmed.split_once("invite=") {
            after.split(['&', '#', ' ']).next().unwrap_or(after)
        } else if let Some((_, after)) = trimmed.split_once("://invite/") {
            after.split(['?', '#', '/', ' ']).next().unwrap_or(after)
        } else if let Some((_, after)) = trimmed.split_once("/invite/") {
            after.split(['?', '#', '/', ' ']).next().unwrap_or(after)
        } else if let Some((_, after)) = trimmed.split_once("sanvo.gg/") {
            after.split(['?', '#', '/', ' ']).next().unwrap_or(after)
        } else if let Some((_, after)) = trimmed.split_once("sancord.gg/") {
            // LEGACY COMPATIBILITY: aceita links curtos legados sancord.gg/
            after.split(['?', '#', '/', ' ']).next().unwrap_or(after)
        } else {
            trimmed
        };
        candidate
            .trim()
            .trim_matches(|c: char| matches!(c, '/' | '?' | '#' | '.' | ',' | ';'))
            .to_uppercase()
    }

    /// Registra (ou atualiza) um convite em memória e no banco.
    pub fn register_invite(&mut self, invite: Invite) {
        self.db.write(WriteOp::UpsertInvite(invite.clone()));
        self.invites.insert(invite.code.to_uppercase(), invite);
    }

    /// Marca o convite como revogado (tombstone) no banco e na memória, impedindo
    /// que o código seja reutilizado e garantindo erro claro em tentativas futuras.
    pub fn revoke_invite(&mut self, code: &str, actor: &str) -> bool {
        let key = code.trim().to_uppercase();
        if let Some(mut inv) = self.invites.get(&key).cloned() {
            if inv.revoked_at.is_none() {
                inv.revoked_at = Some(auth::now_ms());
                inv.revoked_by = Some(actor.to_string());
                self.register_invite(inv);
                return true;
            }
        }
        false
    }

    pub fn remove_invite(&mut self, code: &str) {
        let code = code.to_uppercase();
        self.invites.remove(&code);
        self.db.write(WriteOp::DeleteInvite { code });
    }

    /// Quantidade de convites atualmente ativos (não revogados, não vencidos, sem esgotar usos).
    pub fn active_invite_count(&self, server_id: &str) -> usize {
        let now = auth::now_ms();
        self.invites
            .values()
            .filter(|i| i.server_id == server_id && i.invalid_status(now).is_none())
            .count()
    }

    /// Cria um convite novo para o servidor (jamais modifica convites existentes).
    pub fn create_invite(
        &mut self,
        server_id: &str,
        creator: &str,
        max_age_secs: Option<u64>,
        max_uses: Option<u32>,
        channel_id: Option<String>,
        temporary: bool,
    ) -> Invite {
        let now = auth::now_ms();
        let invite = Invite {
            code: self.generate_invite_code(),
            server_id: server_id.to_string(),
            creator: creator.to_string(),
            created_at: now,
            // 0 = sem validade; máximo de 30 dias.
            expires_at: max_age_secs
                .filter(|s| *s > 0)
                .map(|s| now + (s.min(30 * 24 * 3600) as i64) * 1000),
            max_uses: max_uses.filter(|m| *m > 0).map(|m| m.min(1000)),
            uses: 0,
            channel_id,
            temporary,
            revoked_at: None,
            revoked_by: None,
            last_used_at: None,
        };
        self.register_invite(invite.clone());
        invite
    }

    /// Resolve um código ou link para um convite válido, retornando `(error_kind, mensagem)` em caso de falha.
    pub fn resolve_invite_detailed(&self, raw: &str) -> Result<(Invite, &GuildServer), (&'static str, &'static str)> {
        let code = Self::extract_invite_code(raw);
        if code.is_empty() {
            return Err(("invalid", "Informe o código ou link do convite."));
        }
        let invite = if let Some(inv) = self.invites.get(&code) {
            inv.clone()
        } else if let Some(srv) = self
            .servers
            .iter()
            .find(|s| s.custom_invite_slug.as_deref().is_some_and(|sl| sl.eq_ignore_ascii_case(&code)))
        {
            if let Some(inv) = self.invites.get(&srv.invite_code.to_uppercase()) {
                inv.clone()
            } else {
                return Err(("invalid", "Convite inválido ou expirado."));
            }
        } else {
            return Err(("invalid", "Convite inválido ou expirado."));
        };

        let now = auth::now_ms();
        if invite.is_revoked() {
            return Err(("revoked", "Este convite não é mais válido."));
        }
        let srv = self
            .find_server(&invite.server_id)
            .ok_or(("unavailable", "Este servidor não está mais disponível."))?;
        if srv.invites_paused {
            return Err(("paused", "Convites temporariamente pausados."));
        }
        if let Some((kind, reason)) = invite.invalid_status(now) {
            return Err((kind, reason));
        }
        Ok((invite, srv))
    }

    /// Resolve um código (ou link `?invite=`) para um convite válido.
    pub fn resolve_invite(&self, raw: &str) -> Result<(Invite, &GuildServer), &'static str> {
        self.resolve_invite_detailed(raw).map_err(|(_, msg)| msg)
    }

    pub fn invite_info(&self, invite: &Invite) -> InviteInfo {
        let acc = self.accounts.get(&invite.creator);
        let creator_name = acc
            .map(|a| a.display_name.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| a.username.clone()))
            .unwrap_or_else(|| invite.creator.clone());
        let creator_avatar = acc.and_then(|a| a.avatar_url.clone());
        let srv = self.find_server(&invite.server_id);
        let is_default = srv.is_some_and(|s| s.invite_code.eq_ignore_ascii_case(&invite.code));
        let ch = invite
            .channel_id
            .as_deref()
            .and_then(|cid| srv.and_then(|s| s.find_channel(cid)));
        InviteInfo {
            invite: invite.clone(),
            creator_name,
            is_default,
            creator_avatar,
            channel_name: ch.map(|c| c.name.clone()),
            channel_kind: ch.map(|c| c.kind.clone()),
        }
    }

    /// Convites ainda ativos do servidor (mais novos primeiro).
    /// Convites revogados ou vencidos permanecem registrados como histórico/tombstone e não aparecem na lista ativa.
    pub fn server_invites(&mut self, server_id: &str) -> Vec<InviteInfo> {
        let now = auth::now_ms();
        let mut list: Vec<InviteInfo> = self
            .invites
            .values()
            .filter(|i| i.server_id == server_id && i.invalid_status(now).is_none())
            .map(|i| self.invite_info(i))
            .collect();
        list.sort_by(|a, b| b.invite.created_at.cmp(&a.invite.created_at));
        list
    }

    /// Remove um usuário de servidores onde entrou com associação temporária
    /// assim que sua última sessão ativa desconecta e ele não recebeu nenhum cargo.
    pub fn cleanup_temporary_members_for(&mut self, username_lower: &str) -> Vec<GuildServer> {
        let still_online = self
            .users
            .values()
            .any(|u| u.username.to_lowercase() == username_lower);
        if still_online {
            return Vec::new();
        }
        let mut changed_servers = Vec::new();
        for srv in &mut self.servers {
            if srv.id == "sancord" || srv.is_owner(username_lower) {
                continue;
            }
            if !srv.temporary_members.iter().any(|m| m == username_lower) {
                continue;
            }
            let has_role = srv
                .member_roles
                .get(username_lower)
                .is_some_and(|roles| roles.iter().any(|r| r != "everyone"));
            if has_role {
                // Promovido a membro permanente por possuir cargo.
                srv.temporary_members.retain(|m| m != username_lower);
                changed_servers.push(srv.clone());
                continue;
            }
            srv.temporary_members.retain(|m| m != username_lower);
            srv.members.retain(|m| m != username_lower);
            srv.member_roles.remove(username_lower);
            srv.member_joined_at.remove(username_lower);
            srv.member_nicks.remove(username_lower);
            srv.member_profiles.remove(username_lower);
            changed_servers.push(srv.clone());
        }
        if !changed_servers.is_empty() {
            self.save_servers();
        }
        changed_servers
    }

    /// Membros do servidor conectados agora (sem contar invisíveis).
    pub fn online_member_count(&self, srv: &GuildServer) -> usize {
        self.users
            .values()
            .filter(|u| u.status_kind != "invisible" && srv.is_member(&u.username.to_lowercase()))
            .map(|u| u.username.to_lowercase())
            .collect::<HashSet<_>>()
            .len()
    }

    // ---------------------------------------------------------------------
    // Preferências do usuário
    // ---------------------------------------------------------------------

    /// Preferências do usuário já filtradas para os servidores que ele ainda
    /// pode ver, com servidores novos acrescentados ao fim da barra.
    pub fn prefs_for(&self, account_id: &str, username_lower: &str) -> UserPrefs {
        let mut prefs = self.user_prefs.get(account_id).cloned().unwrap_or_default();
        let visible: Vec<String> = self
            .servers
            .iter()
            .filter(|s| s.is_member(username_lower))
            .map(|s| s.id.clone())
            .collect();
        prefs.guild_layout = sanitize_layout(prefs.guild_layout, &visible);
        prefs.muted_servers.retain(|id| visible.contains(id));
        let now = chrono::Utc::now().timestamp_millis();
        prefs.mutes.retain(|_, until| *until == 0 || *until > now);
        prefs
    }

    pub fn set_prefs(&mut self, account_id: &str, prefs: UserPrefs) {
        if let Ok(data) = serde_json::to_string(&prefs) {
            self.db.write(WriteOp::PutUserPrefs { user_id: account_id.to_string(), data });
        }
        self.user_prefs.insert(account_id.to_string(), prefs);
    }

    pub fn servers_for_user(&self, username_lower: &str) -> Vec<GuildServer> {
        self.servers
            .iter()
            .filter(|s| s.is_member(username_lower))
            .map(|s| s.visible_to(username_lower))
            .collect()
    }

    pub fn find_server(&self, server_id: &str) -> Option<&GuildServer> {
        self.servers.iter().find(|s| s.id == server_id)
    }

    pub fn find_server_mut(&mut self, server_id: &str) -> Option<&mut GuildServer> {
        self.servers.iter_mut().find(|s| s.id == server_id)
    }

    pub fn find_server_by_text_channel(&self, channel_id: &str) -> Option<&GuildServer> {
        self.servers.iter().find(|s| {
            s.text_channels.iter().any(|c| c.id == channel_id)
                || s.voice_channels.iter().any(|c| c.id == channel_id)
                || s.thread(channel_id).is_some()
        })
    }

    pub fn has_public_voice_channel(&self, channel_id: &str) -> bool {
        self.servers
            .iter()
            .any(|s| s.voice_channels.iter().any(|c| c.id == channel_id))
    }

    pub fn broadcast_to_server(&self, server_id: &str, msg: ServerMessage) {
        self.broadcast_to_server_except(server_id, "", msg);
    }

    pub fn broadcast_to_server_except(&self, server_id: &str, except_id: &str, msg: ServerMessage) {
        let Some(srv) = self.find_server(server_id) else {
            return;
        };
        for (uid, u) in &self.users {
            if uid != except_id && srv.is_member(&u.username.to_lowercase()) {
                self.send_to(uid, msg.clone());
                if matches!(&msg, ServerMessage::ServerUpdated { .. }) { self.send_server_access(uid, server_id); }
            }
        }
    }

    pub fn send_servers_sync_to_username(&self, target_lower: &str) {
        let servers = self.servers_for_user(target_lower);
        for (uid, u) in &self.users {
            if u.username.to_lowercase() == target_lower {
                self.send_to(
                    uid,
                    ServerMessage::ServersSync {
                        servers: servers.clone(),
                    },
                );
            }
        }
    }

    pub fn target_exists(&self, username_lower: &str) -> bool {
        self.accounts.contains_key(username_lower)
            || self
                .users
                .values()
                .any(|u| u.username.to_lowercase() == username_lower)
    }

    // ---------------------------------------------------------------------
    // Amigos
    // ---------------------------------------------------------------------

    pub fn resolve_friend_info(&self, target_lower: &str) -> Option<FriendInfo> {
        if let Some(u) = self
            .users
            .values()
            .find(|u| u.username.to_lowercase() == target_lower)
            .or_else(|| self.presence_grace.values().find(|u| u.username.to_lowercase() == target_lower))
        {
            let visible_online = u.status_kind != "invisible";
            let acc_created = self
                .accounts
                .get(target_lower)
                .and_then(|a| a.created_at.clone())
                .or_else(|| u.created_at.clone());
            let acc_id = self.accounts.get(target_lower).map(|a| a.id.clone());
            return Some(FriendInfo {
                id: acc_id,
                username: u.username.clone(),
                avatar_color: u.avatar_color.clone(),
                avatar_url: u.avatar_url.clone(),
                status_kind: u.status_kind.clone(),
                custom_status: u.custom_status.clone(),
                display_name: u.display_name.clone(),
                pronouns: u.pronouns.clone(),
                custom_status_emoji: u.custom_status_emoji.clone(),
                custom_status_expires_at: u.custom_status_expires_at,
                bio: u.bio.clone(),
                avatar_decoration: u.avatar_decoration.clone(),
                banner_url: u.banner_url.clone(),
                theme_primary: u.theme_primary.clone(),
                theme_accent: u.theme_accent.clone(),
                name_style: u.name_style.clone(),
                name_color: u.name_color.clone(),
                nameplate_style: u.nameplate_style.clone(),
                profile_effect: u.profile_effect.clone(),
                profile: u.profile.clone(),
                created_at: acc_created,
                online: visible_online,
                voice_channel_id: u.voice_channel_id.clone(),
                activity: if visible_online { u.activity.clone() } else { None },
            });
        }
        if let Some(acc) = self.accounts.get(target_lower) {
            return Some(FriendInfo {
                id: Some(acc.id.clone()),
                username: acc.username.clone(),
                avatar_color: acc.avatar_color.clone(),
                avatar_url: acc.avatar_url.clone(),
                status_kind: "invisible".to_string(),
                custom_status: acc.custom_status.clone(),
                display_name: acc.display_name.clone(),
                pronouns: acc.pronouns.clone(),
                custom_status_emoji: acc.custom_status_emoji.clone(),
                custom_status_expires_at: acc.custom_status_expires_at,
                bio: acc.bio.clone(),
                avatar_decoration: acc.avatar_decoration.clone(),
                banner_url: acc.banner_url.clone(),
                theme_primary: acc.theme_primary.clone(),
                theme_accent: acc.theme_accent.clone(),
                name_style: acc.name_style.clone(),
                name_color: acc.name_color.clone(),
                nameplate_style: acc.nameplate_style.clone(),
                profile_effect: acc.profile_effect.clone(),
                profile: acc.profile.clone(),
                created_at: acc.created_at.clone(),
                online: false,
                voice_channel_id: None,
                activity: None,
            });
        }
        None
    }

    pub fn set_dm_closed(&mut self, username_lower: &str, dm_id: &str, closed: bool) {
        let Some(acc) = self.account_id_for(username_lower) else {
            return;
        };
        let mut prefs = self.prefs_for(&acc, username_lower);
        let before = prefs.closed_dms.len();
        if closed {
            if !prefs.closed_dms.iter().any(|id| id == dm_id) {
                prefs.closed_dms.push(dm_id.to_string());
                prefs.closed_dms = crate::models::UserPrefs::sanitize_dm_ids(prefs.closed_dms);
                self.set_prefs(&acc, prefs);
            }
        } else {
            prefs.closed_dms.retain(|id| id != dm_id);
            if prefs.closed_dms.len() != before {
                self.set_prefs(&acc, prefs);
            }
        }
    }

    pub fn build_friends_sync_for(&self, me_lower: &str) -> ServerMessage {
        let map_list = |keys: Option<&Vec<String>>| -> Vec<FriendInfo> {
            let Some(list) = keys else {
                return Vec::new();
            };
            let mut out: Vec<FriendInfo> = list
                .iter()
                .filter_map(|k| self.resolve_friend_info(k))
                .collect();
            out.sort_by(|a, b| {
                b.online
                    .cmp(&a.online)
                    .then_with(|| a.username.to_lowercase().cmp(&b.username.to_lowercase()))
            });
            out
        };

        let friends = map_list(self.friends_store.friends.get(me_lower));
        let incoming_requests = map_list(self.friends_store.incoming_requests.get(me_lower));
        let outgoing_requests = map_list(self.friends_store.outgoing_requests.get(me_lower));
        let blocked = map_list(self.friends_store.blocked.get(me_lower));

        let mut dm_ids_set: HashSet<String> = HashSet::new();
        if let Some(open) = self.friends_store.open_dms.get(me_lower) {
            for id in open {
                if Self::is_dm_participant(id, me_lower) {
                    dm_ids_set.insert(id.clone());
                }
            }
        }
        for (ch_id, msgs) in &self.chat_history {
            if ch_id.starts_with("dm:") && !msgs.is_empty() && Self::is_dm_participant(ch_id, me_lower) {
                dm_ids_set.insert(ch_id.clone());
            }
        }

        let mut dm_conversations = Vec::new();
        let mut message_requests = Vec::new();
        let mut dm_history = HashMap::new();
        // Solicitações pendentes aparecem separadas (mesmo que ainda sem histórico em cache).
        for id in self.friends_store.dm_requests.get(me_lower).into_iter().flatten() {
            if Self::is_dm_participant(id, me_lower) {
                dm_ids_set.insert(id.clone());
            }
        }

        let closed_set: HashSet<String> = self
            .account_id_for(me_lower)
            .and_then(|acc| self.user_prefs.get(&acc))
            .map(|p| p.closed_dms.iter().cloned().collect())
            .unwrap_or_default();

        for dm_id in dm_ids_set {
            let Some((p1, p2)) = Self::parse_dm_participants(&dm_id) else {
                continue;
            };
            let other_lower = if p1 == me_lower { p2 } else { p1 };
            // Conversas com quem eu bloqueei, ignorei ou fechei ficam fora da lista (o histórico continua no banco).
            if self.friends_store.has_blocked(me_lower, &other_lower)
                || self.friends_store.is_ignored(me_lower, &dm_id)
                || closed_set.contains(&dm_id)
            {
                continue;
            }
            let Some(peer) = self.resolve_friend_info(&other_lower) else {
                continue;
            };
            let is_request = self.friends_store.is_request(me_lower, &dm_id);
            let msgs = self
                .chat_history
                .get(&dm_id)
                .map(|l| Self::tail(l))
                .unwrap_or_default();
            let last_msg = msgs.last();
            let last_message = last_msg.map(|m| {
                if m.content.is_empty() && m.image_url.is_some() {
                    "📷 Imagem".to_string()
                } else {
                    m.content.chars().take(60).collect()
                }
            });
            let last_timestamp = last_msg.map(|m| m.timestamp.clone());

            dm_history.insert(dm_id.clone(), msgs);
            let conv = DmConversation {
                dm_id,
                peer,
                last_message,
                last_timestamp,
            };
            if is_request {
                message_requests.push(conv);
            } else {
                dm_conversations.push(conv);
            }
        }

        let mut groups: Vec<GroupDmInfo> = Vec::new();
        for g in self.group_dms.values().filter(|g| g.members.iter().any(|m| m == me_lower)) {
            let msgs = self.chat_history.get(&g.id).map(|l| Self::tail(l)).unwrap_or_default();
            dm_history.insert(g.id.clone(), msgs);
            groups.push(self.group_info(g));
        }
        groups.sort_by(|a, b| a.id.cmp(&b.id));

        dm_conversations.sort_by(|a, b| {
            b.peer
                .online
                .cmp(&a.peer.online)
                .then_with(|| a.peer.username.to_lowercase().cmp(&b.peer.username.to_lowercase()))
        });

        ServerMessage::FriendsSync {
            friends,
            incoming_requests,
            outgoing_requests,
            dm_conversations,
            dm_history,
            blocked,
            message_requests,
            groups,
        }
    }

    pub fn send_friends_sync_to_username(&self, target_lower: &str) {
        let msg = self.build_friends_sync_for(target_lower);
        for (uid, u) in &self.users {
            if u.username.to_lowercase() == target_lower {
                self.send_to(uid, msg.clone());
            }
        }
    }

    pub fn broadcast_friends_sync_all(&self) {
        let mut sent_names: HashSet<String> = HashSet::new();
        for u in self.users.values() {
            let lower = u.username.to_lowercase();
            if sent_names.insert(lower.clone()) {
                self.send_friends_sync_to_username(&lower);
            }
        }
    }

    /// Envia para todos os participantes conectados de uma DM ou grupo.
    pub fn send_to_dm_participants(&self, channel_id: &str, msg: ServerMessage) {
        let participants = self.private_participants(channel_id);
        if participants.is_empty() {
            return;
        }
        for (uid, u) in &self.users {
            if participants.contains(&u.username.to_lowercase()) {
                self.send_to(uid, msg.clone());
            }
        }
    }

    // ---------------------------------------------------------------------
    // Voz e envio
    // ---------------------------------------------------------------------

    /// Mapa de channel_id -> lista de user_ids presentes em cada canal de voz
    pub fn voice_members_map(&self) -> HashMap<String, Vec<String>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for srv in &self.servers {
            for c in &srv.voice_channels {
                map.entry(c.id.clone()).or_default();
            }
        }

        for user in self.users.values() {
            if let Some(vc_id) = &user.voice_channel_id {
                map.entry(vc_id.clone())
                    .or_default()
                    .push(user.id.clone());
            }
        }
        map
    }

    pub fn users_list(&self) -> Vec<UserInfo> {
        let mut list: Vec<UserInfo> = self.users.values().cloned().collect();
        list.extend(self.presence_grace.values().cloned());
        list.sort_by(|a, b| a.username.to_lowercase().cmp(&b.username.to_lowercase()));
        list
    }

    /// Envia mensagem para uma conexão específica. Nunca bloqueia: se a fila
    /// dessa conexão estiver cheia, ela é marcada para desconexão.
    pub fn send_to(&self, user_id: &str, mut msg: ServerMessage) {
        if let Some(user) = self.users.get(user_id) {
            if !self.project_outbound(&user.username.to_lowercase(), &mut msg) { return; }
        }
        if let Some(peer) = self.peers.get(user_id) {
            match peer.tx.try_send(msg) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    warn!("Fila de saída cheia para {user_id}; desconectando cliente lento.");
                    peer.kick.notify_one();
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {}
            }
        }
    }

    /// Envia mensagem para todos os usuários conectados
    pub fn broadcast(&self, msg: ServerMessage) {
        for uid in self.peers.keys() {
            self.send_to(uid, msg.clone());
        }
    }

    /// Envia mensagem para todos exceto um usuário específico
    pub fn broadcast_except(&self, except_id: &str, msg: ServerMessage) {
        for uid in self.peers.keys() {
            if uid != except_id {
                self.send_to(uid, msg.clone());
            }
        }
    }

    /// Envia mensagem para todos os participantes de um canal de voz (exceto quem originou)
    pub fn broadcast_to_voice_channel_except(
        &self,
        channel_id: &str,
        except_id: &str,
        msg: ServerMessage,
    ) {
        for (uid, user) in &self.users {
            if uid != except_id && user.voice_channel_id.as_deref() == Some(channel_id) {
                self.send_to(uid, msg.clone());
            }
        }
    }

    /// Feedback de erro/sucesso padronizado para o cliente.
    pub fn feedback(&self, user_id: &str, ok: bool, action: &str, message: impl Into<String>) {
        self.send_to(
            user_id,
            ServerMessage::ServerFeedback {
                ok,
                message: message.into(),
                action: Some(action.to_string()),
            },
        );
    }

    /// Escolhe uma cor de avatar determinística a partir do nome
    pub fn pick_avatar_color(seed: &str) -> String {
        let palette = [
            "#5865F2", "#57F287", "#FEE75C", "#EB459E", "#ED4245", "#F74C00", "#00B0F4", "#9B59B6",
        ];
        let hash = seed.bytes().fold(0usize, |acc, b| acc.wrapping_add(b as usize));
        palette[hash % palette.len()].to_string()
    }
}
