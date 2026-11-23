use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub kind: ChannelKind,
    /// Categoria que contém o canal (`None` = fora de categoria, aparece no topo).
    #[serde(default)]
    pub category_id: Option<String>,
    /// Ordem dentro da categoria (menor primeiro).
    #[serde(default)]
    pub position: i32,
    /// Descrição curta exibida no cabeçalho do canal.
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub permission_overwrites: Vec<crate::permissions::PermissionOverwrite>,
    #[serde(default = "default_true")]
    pub permissions_synced: bool,
    /// Limite de pessoas num canal de voz (0 = sem limite).
    #[serde(default)]
    pub user_limit: u32,
    /// Taxa de bits de áudio num canal de voz em kbps (0 = padrão 128 kbps; faixa 32..=256).
    #[serde(default)]
    pub bitrate_kbps: u32,
    /// Modo lento (canais de texto): intervalo mínimo entre mensagens de cada pessoa.
    /// 0 = desligado; quem gerencia mensagens ou canais não espera.
    #[serde(default)]
    pub slowmode_secs: u32,
    /// Fórum: tags disponíveis para as postagens (definidas por quem gerencia canais).
    #[serde(default)]
    pub forum_tags: Vec<ForumTag>,
    /// Projeção calculada pelo backend para o destinatário, nunca aceita do cliente.
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub effective_permissions: Option<RolePermissions>,
}

impl Channel {
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: ChannelKind) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind,
            category_id: None,
            position: 0,
            topic: None,
            permission_overwrites: Vec::new(),
            permissions_synced: true,
            user_limit: 0,
            bitrate_kbps: 0,
            slowmode_secs: 0,
            forum_tags: Vec::new(),
            effective_permissions: None,
        }
    }

    pub fn in_category(mut self, category_id: &str, position: i32) -> Self {
        self.category_id = Some(category_id.to_string());
        self.position = position;
        self
    }
}

/// Tag de fórum. `moderated` = só a moderação aplica ou remove das postagens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForumTag {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub emoji: Option<String>,
    #[serde(default)]
    pub moderated: bool,
}

/// Tipos de canal. Texto e anúncios ficam em `text_channels` (têm mensagens);
/// voz fica em `voice_channels`.
///
/// Arquitetura preparada para novos tipos (fórum, palco, mídia): basta um novo
/// variante + `is_text_like`/`is_voice_like` e o tratamento no cliente.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    Text,
    Voice,
    /// Canal de anúncios: todos leem, só moderadores publicam.
    Announcement,
    /// Fórum (Fase 8): cada postagem é uma thread; não recebe mensagens diretas.
    Forum,
}

impl ChannelKind {
    /// Fica na lista de canais "de texto" (permissões, layout e leitura).
    pub fn is_text_like(&self) -> bool {
        matches!(self, ChannelKind::Text | ChannelKind::Announcement | ChannelKind::Forum)
    }

    /// Aceita mensagens diretamente (texto, anúncios e chat de canais de voz; fórum só por postagens/threads).
    pub fn accepts_messages(&self) -> bool {
        matches!(
            self,
            ChannelKind::Text | ChannelKind::Announcement | ChannelKind::Voice
        )
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ChannelKind::Text => "text",
            ChannelKind::Voice => "voice",
            ChannelKind::Announcement => "announcement",
            ChannelKind::Forum => "forum",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "text" => Some(ChannelKind::Text),
            "voice" => Some(ChannelKind::Voice),
            "announcement" => Some(ChannelKind::Announcement),
            "forum" => Some(ChannelKind::Forum),
            _ => None,
        }
    }
}

/// Thread (Fase 8): conversa filha de um canal de texto ou postagem de fórum.
/// As mensagens usam `id` como canal; as permissões são as do canal-pai.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Thread {
    pub id: String,
    pub server_id: String,
    pub parent_id: String,
    pub name: String,
    pub owner: String,
    /// Mensagem do canal-pai que originou a thread (não existe em postagens de fórum).
    #[serde(default)]
    pub starter_message_id: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub last_message_at: i64,
    #[serde(default)]
    pub message_count: u32,
    /// Arquivada: some da lista ativa; uma nova mensagem desarquiva (se não estiver trancada).
    #[serde(default)]
    pub archived: bool,
    /// Trancada: só a moderação escreve.
    #[serde(default)]
    pub locked: bool,
    /// Postagem de fórum: ids das tags do canal aplicadas (até 5).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Etapa C6: arquiva sozinha após N minutos sem mensagens (60, 1440, 4320 ou 10080).
    #[serde(default = "default_auto_archive_minutes")]
    pub auto_archive_minutes: u32,
    /// Etapa C6: quem segue a thread (username_lower). Quem cria ou escreve entra sozinho.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<String>,
}

pub fn default_auto_archive_minutes() -> u32 {
    1440
}

/// Categoria de canais dentro de um servidor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub position: i32,
    #[serde(default)]
    pub permission_overwrites: Vec<crate::permissions::PermissionOverwrite>,
}

/// Convite para um servidor. `expires_at`/`max_uses` ausentes = sem limite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invite {
    pub code: String,
    pub server_id: String,
    /// username em minúsculas de quem criou
    pub creator: String,
    pub created_at: i64,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub max_uses: Option<u32>,
    #[serde(default)]
    pub uses: u32,
    /// Canal de destino vinculado ao convite (opcional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    /// Associação temporária: o membro é removido ao desconectar se não receber nenhum cargo.
    #[serde(default)]
    pub temporary: bool,
    /// Timestamp de revogação (tombstone): impede reutilização do código revogado.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<i64>,
}

impl Invite {
    pub fn is_revoked(&self) -> bool {
        self.revoked_at.is_some()
    }

    /// Código de motivo estruturado + mensagem amigável, se o convite não puder mais ser usado.
    pub fn invalid_status(&self, now_ms: i64) -> Option<(&'static str, &'static str)> {
        if self.revoked_at.is_some() {
            return Some(("revoked", "Este convite não é mais válido."));
        }
        if self.expires_at.is_some_and(|t| now_ms >= t) {
            return Some(("expired", "Este convite expirou."));
        }
        if self.max_uses.is_some_and(|m| self.uses >= m) {
            return Some(("max_uses", "Este convite atingiu o limite de usos."));
        }
        None
    }

    /// Motivo pelo qual o convite não pode mais ser usado, se houver.
    pub fn invalid_reason(&self, now_ms: i64) -> Option<&'static str> {
        self.invalid_status(now_ms).map(|(_, msg)| msg)
    }
}

/// Item da barra de servidores do usuário: servidor solto ou pasta.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum GuildLayoutItem {
    Server {
        id: String,
    },
    Folder {
        id: String,
        #[serde(default)]
        name: String,
        #[serde(default)]
        color: Option<String>,
        #[serde(default)]
        server_ids: Vec<String>,
        #[serde(default)]
        collapsed: bool,
    },
}

/// Preferências do usuário sincronizadas entre dispositivos.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct UserPrefs {
    /// Ordem da barra de servidores e pastas.
    #[serde(default)]
    pub guild_layout: Vec<GuildLayoutItem>,
    /// Servidores silenciados (sem sons/destaques de notificação).
    #[serde(default)]
    pub muted_servers: Vec<String>,
    /// Categorias recolhidas na lista de canais.
    #[serde(default)]
    pub collapsed_categories: Vec<String>,
    /// Quem pode mandar mensagem direta e pedido de amizade (aplicado no servidor).
    #[serde(default)]
    pub privacy: PrivacySettings,
    /// Fase 9: nível de notificação por servidor ou canal/thread/conversa:
    /// "all" (tudo), "mentions" (só menções) ou "none" (nada). O canal vence o servidor.
    #[serde(default)]
    pub notify_levels: HashMap<String, String>,
    /// Notas privadas sobre outros usuários: username_lower -> texto da nota.
    #[serde(default)]
    pub user_notes: HashMap<String, String>,
    /// Usuários silenciados localmente (mensagens recolhidas/ocultas): username_lower.
    #[serde(default)]
    pub ignored_users: Vec<String>,
    /// IDs de mensagens marcadas com estrela (favoritadas) pelo usuário.
    #[serde(default)]
    pub starred_messages: Vec<String>,
    /// Etapa C3: silêncio por tempo de servidor, categoria, canal, thread ou conversa:
    /// id -> fim em ms (0 = até reativar). Silenciado = sem som, aviso nem destaque de não lido,
    /// exceto menções diretas.
    #[serde(default)]
    pub mutes: HashMap<String, i64>,
    /// Etapa C7: GIFs favoritos (IDs de anexos GIF), do mais recente ao mais antigo.
    #[serde(default)]
    pub favorite_gifs: Vec<String>,
    /// DMs/grupos fixados no topo da lista de conversas (privado do usuário).
    #[serde(default)]
    pub pinned_dms: Vec<String>,
    /// DMs/grupos favoritados (exibidos também na área Favoritos).
    #[serde(default)]
    pub favorite_dms: Vec<String>,
    /// DMs ocultadas pelo usuário via "Fechar mensagem direta" (reabrem com nova mensagem ou OpenDm).
    #[serde(default)]
    pub closed_dms: Vec<String>,
}

impl UserPrefs {
    pub const MAX_FAVORITE_GIFS: usize = 200;

    /// Sem repetição, só IDs de anexo válidos que `is_gif` confirma, no máximo 200.
    pub fn sanitize_favorite_gifs(ids: Vec<String>, is_gif: impl Fn(&str) -> bool) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        ids.into_iter()
            .filter(|id| id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) && seen.insert(id.clone()) && is_gif(id))
            .take(Self::MAX_FAVORITE_GIFS)
            .collect()
    }

    pub const MAX_MUTES: usize = 500;

    /// Mantém chaves curtas, fins válidos e ainda no futuro (0 = sem prazo), no máximo 500.
    pub fn sanitize_mutes(mutes: HashMap<String, i64>, now_ms: i64) -> HashMap<String, i64> {
        mutes
            .into_iter()
            .filter(|(k, v)| !k.is_empty() && k.len() <= 120 && (*v == 0 || *v > now_ms))
            .take(Self::MAX_MUTES)
            .collect()
    }

    pub const MAX_NOTIFY_LEVELS: usize = 500;
    pub const MAX_USER_NOTES: usize = 200;
    pub const MAX_IGNORED_USERS: usize = 500;
    pub const MAX_STARRED_MESSAGES: usize = 500;

    /// Mantém só níveis válidos e chaves curtas, no máximo 500 itens.
    pub fn sanitize_notify_levels(levels: HashMap<String, String>) -> HashMap<String, String> {
        levels
            .into_iter()
            .filter(|(k, v)| !k.is_empty() && k.len() <= 120 && matches!(v.as_str(), "all" | "mentions" | "none"))
            .take(Self::MAX_NOTIFY_LEVELS)
            .collect()
    }

    pub fn sanitize_user_notes(notes: HashMap<String, String>) -> HashMap<String, String> {
        notes
            .into_iter()
            .filter_map(|(k, v)| {
                let key = k.trim().to_lowercase();
                let val: String = v
                    .trim()
                    .chars()
                    .filter(|c| !c.is_control() || *c == '\n')
                    .take(500)
                    .collect();
                if !key.is_empty() && key.len() <= 32 && !val.is_empty() {
                    Some((key, val))
                } else {
                    None
                }
            })
            .take(Self::MAX_USER_NOTES)
            .collect()
    }

    pub fn sanitize_ignored_users(list: Vec<String>) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        list.into_iter()
            .filter_map(|u| {
                let key = u.trim().to_lowercase();
                if !key.is_empty() && key.len() <= 32 && seen.insert(key.clone()) {
                    Some(key)
                } else {
                    None
                }
            })
            .take(Self::MAX_IGNORED_USERS)
            .collect()
    }

    pub fn sanitize_starred_messages(list: Vec<String>) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        list.into_iter()
            .filter_map(|id| {
                let clean = id.trim().to_string();
                if !clean.is_empty() && clean.len() <= 64 && seen.insert(clean.clone()) {
                    Some(clean)
                } else {
                    None
                }
            })
            .take(Self::MAX_STARRED_MESSAGES)
            .collect()
    }

    pub const MAX_DM_LIST_PREFS: usize = 100;

    pub fn sanitize_dm_ids(list: Vec<String>) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        list.into_iter()
            .filter_map(|id| {
                let clean = id.trim().to_string();
                let valid_prefix = clean.starts_with("dm:") || clean.starts_with("gdm:");
                if valid_prefix && clean.len() <= 120 && seen.insert(clean.clone()) {
                    Some(clean)
                } else {
                    None
                }
            })
            .take(Self::MAX_DM_LIST_PREFS)
            .collect()
    }
}

/// Configurações de privacidade. Valores desconhecidos caem no padrão.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrivacySettings {
    /// "everyone" (qualquer um), "requests" (não amigos caem em Solicitações) ou "friends" (só amigos)
    #[serde(default = "default_dm_policy")]
    pub dm_policy: String,
    /// "everyone", "mutual" (amigos de amigos ou servidor em comum) ou "none"
    #[serde(default = "default_friend_policy")]
    pub friend_requests: String,
}

fn default_dm_policy() -> String {
    "requests".into()
}
fn default_friend_policy() -> String {
    "everyone".into()
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self { dm_policy: default_dm_policy(), friend_requests: default_friend_policy() }
    }
}

impl PrivacySettings {
    pub fn sanitized(mut self) -> Self {
        if !matches!(self.dm_policy.as_str(), "everyone" | "requests" | "friends") {
            self.dm_policy = default_dm_policy();
        }
        if !matches!(self.friend_requests.as_str(), "everyone" | "mutual" | "none") {
            self.friend_requests = default_friend_policy();
        }
        self
    }
}

/// Grupo privado (DM com várias pessoas, sem ser servidor). Canal de texto `gdm:<uuid>`,
/// chamada `gdmvoice:<uuid>`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupDm {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    /// username_lower de quem administra (cria, remove membros)
    pub owner: String,
    /// username_lower dos membros (inclui o dono)
    pub members: Vec<String>,
    pub created_at: i64,
}

impl GroupDm {
    pub const MAX_MEMBERS: usize = 10;

    pub fn voice_channel_id(&self) -> String {
        format!("gdmvoice:{}", self.id.trim_start_matches("gdm:"))
    }
}

/// Grupo como o cliente recebe no FriendsSync.
#[derive(Debug, Clone, Serialize)]
pub struct GroupDmInfo {
    pub id: String,
    pub name: Option<String>,
    pub icon_url: Option<String>,
    pub owner: String,
    pub members: Vec<FriendInfo>,
    pub voice_channel_id: String,
    pub last_message: Option<String>,
    pub last_timestamp: Option<String>,
}

/// Servidor em comum mostrado no perfil.
#[derive(Debug, Clone, Serialize)]
pub struct MutualServer {
    pub id: String,
    pub name: String,
    pub icon_url: Option<String>,
    pub icon_color: String,
}

/// Convite com dados de exibição para a tela de gerenciamento.
#[derive(Debug, Clone, Serialize)]
pub struct InviteInfo {
    #[serde(flatten)]
    pub invite: Invite,
    pub creator_name: String,
    pub is_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator_avatar: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_kind: Option<ChannelKind>,
}

/// Posição de um canal após arrastar e soltar.
#[derive(Debug, Clone, Deserialize)]
pub struct ChannelPlacement {
    pub id: String,
    #[serde(default)]
    pub category_id: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Conjunto completo de permissões por cargo em um servidor
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolePermissions {
    #[serde(default = "default_true")]
    pub view_channel: bool,
    #[serde(default = "default_true")]
    pub read_history: bool,
    #[serde(default = "default_true")]
    pub add_reactions: bool,
    #[serde(default = "default_true")]
    pub pin_messages: bool,
    #[serde(default)]
    pub administrator: bool,
    #[serde(default)]
    pub manage_server: bool,
    #[serde(default)]
    pub manage_roles: bool,
    #[serde(default)]
    pub manage_channels: bool,
    #[serde(default)]
    pub kick_members: bool,
    #[serde(default)]
    pub ban_members: bool,
    #[serde(default)]
    pub manage_messages: bool,
    #[serde(default)]
    pub mention_everyone: bool,
    #[serde(default = "default_true")]
    pub send_messages: bool,
    #[serde(default = "default_true")]
    pub attach_files: bool,
    #[serde(default = "default_true")]
    pub connect_voice: bool,
    #[serde(default = "default_true")]
    pub speak_voice: bool,
    #[serde(default = "default_true")]
    pub stream_video: bool,
    #[serde(default = "default_true")]
    pub create_invites: bool,
    /// Ver lista completa de convites, revogar convites de outros e pausar/retomar convites.
    #[serde(default)]
    pub manage_invites: bool,
    /// Moderação de voz (Fase 6): silenciar, ensurdecer e mover/desconectar membros.
    #[serde(default)]
    pub mute_members: bool,
    #[serde(default)]
    pub deafen_members: bool,
    #[serde(default)]
    pub move_members: bool,
    /// Fase 8: ver o registro de auditoria e configurar o AutoMod.
    #[serde(default)]
    pub view_audit_log: bool,
    /// Aplicar e remover castigo (timeout) de membros abaixo na hierarquia.
    #[serde(default)]
    pub moderate_members: bool,
    /// Etapa C4: trocar o próprio apelido no servidor (padrão: sim).
    #[serde(default = "default_true")]
    pub change_nickname: bool,
    /// Etapa C4: trocar o apelido de membros abaixo na hierarquia.
    #[serde(default)]
    pub manage_nicknames: bool,
    /// Etapa C5: enviar, renomear e excluir emojis do servidor.
    #[serde(default)]
    pub manage_expressions: bool,
}

impl Default for RolePermissions {
    fn default() -> Self {
        Self {
            view_channel: true, read_history: true, add_reactions: true, pin_messages: true,
            administrator: false,
            manage_server: false,
            manage_roles: false,
            manage_channels: false,
            kick_members: false,
            ban_members: false,
            manage_messages: false,
            mention_everyone: false,
            send_messages: true,
            attach_files: true,
            connect_voice: true,
            speak_voice: true,
            stream_video: true,
            create_invites: true,
            manage_invites: false,
            mute_members: false,
            deafen_members: false,
            move_members: false,
            view_audit_log: false,
            moderate_members: false,
            change_nickname: true,
            manage_nicknames: false,
            manage_expressions: false,
        }
    }
}

impl RolePermissions {
    pub fn all_admin() -> Self {
        Self {
            view_channel: true, read_history: true, add_reactions: true, pin_messages: true,
            administrator: true,
            manage_server: true,
            manage_roles: true,
            manage_channels: true,
            kick_members: true,
            ban_members: true,
            manage_messages: true,
            mention_everyone: true,
            send_messages: true,
            attach_files: true,
            connect_voice: true,
            speak_voice: true,
            stream_video: true,
            create_invites: true,
            manage_invites: true,
            mute_members: true,
            deafen_members: true,
            move_members: true,
            view_audit_log: true,
            moderate_members: true,
            change_nickname: true,
            manage_nicknames: true,
            manage_expressions: true,
        }
    }

    pub fn merge_from(&mut self, other: &Self) {
        if other.administrator {
            *self = Self::all_admin();
            return;
        }
        self.manage_server |= other.manage_server;
        self.manage_roles |= other.manage_roles;
        self.manage_channels |= other.manage_channels;
        self.kick_members |= other.kick_members;
        self.ban_members |= other.ban_members;
        self.manage_messages |= other.manage_messages;
        self.mention_everyone |= other.mention_everyone;
        self.send_messages |= other.send_messages;
        self.attach_files |= other.attach_files;
        self.connect_voice |= other.connect_voice;
        self.speak_voice |= other.speak_voice;
        self.stream_video |= other.stream_video;
        self.create_invites |= other.create_invites;
        self.manage_invites |= other.manage_invites;
        self.view_channel |= other.view_channel;
        self.read_history |= other.read_history;
        self.add_reactions |= other.add_reactions;
        self.pin_messages |= other.pin_messages;
        self.mute_members |= other.mute_members;
        self.deafen_members |= other.deafen_members;
        self.move_members |= other.move_members;
        self.view_audit_log |= other.view_audit_log;
        self.moderate_members |= other.moderate_members;
        self.change_nickname |= other.change_nickname;
        self.manage_nicknames |= other.manage_nicknames;
        self.manage_expressions |= other.manage_expressions;
    }
}

/// Cargo configurável dentro de um servidor (cores, hoist, ícone e permissões)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerRole {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub position: i32,
    #[serde(default)]
    pub hoist: bool,
    #[serde(default)]
    pub mentionable: bool,
    #[serde(default)]
    pub badge_emoji: Option<String>,
    #[serde(default)]
    pub permissions: RolePermissions,
}

/// Servidor estilo Discord persistido em data/servers.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuildServer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    pub icon_color: String,
    #[serde(default)]
    pub banner_url: Option<String>,
    pub owner_username: String,
    pub invite_code: String,
    #[serde(default)]
    pub text_channels: Vec<Channel>,
    #[serde(default)]
    pub voice_channels: Vec<Channel>,
    #[serde(default)]
    pub roles: Vec<ServerRole>,
    /// username_lower -> lista de role_ids atribuídos
    #[serde(default)]
    pub member_roles: HashMap<String, Vec<String>>,
    /// username_lower dos membros pertencentes a este servidor
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub banned_usernames: Vec<String>,
    /// Motivo opcional de cada banimento: username_lower -> motivo.
    #[serde(default)]
    pub ban_reasons: HashMap<String, String>,
    #[serde(default)]
    pub categories: Vec<Category>,
    /// Servidor de comunidade (aberto) ou privado (amigos/grupo).
    #[serde(default)]
    pub is_community: bool,
    #[serde(default)]
    pub created_at: i64,
    /// username_lower -> momento de entrada (ms)
    #[serde(default)]
    pub member_joined_at: HashMap<String, i64>,
    /// Silenciar/ensurdecer de servidor por membro (persistido em `voice_moderation`).
    /// Não vai para os clientes: o estado aparece em `UserInfo.server_muted/deafened`.
    #[serde(default, skip_serializing)]
    pub voice_moderation: HashMap<String, VoiceModeration>,
    /// Regras do AutoMod (persistidas em `automod_config`; só moderadores as recebem).
    #[serde(default, skip_serializing)]
    pub automod: AutoModConfig,
    /// Threads e postagens de fórum (persistidas em `threads`; enviadas à parte,
    /// filtradas pelo acesso ao canal-pai).
    #[serde(default, skip_serializing)]
    pub threads: Vec<Thread>,
    /// Castigos ativos: username_lower -> fim (ms). Persistido em `member_timeouts`;
    /// vai para os clientes do servidor, que mostram o aviso e o tempo restante.
    #[serde(default)]
    pub member_timeouts: HashMap<String, i64>,
    /// Etapa C4: apelido neste servidor (username_lower -> apelido). Persistido em
    /// `server_members.nickname`; some quando a pessoa sai, é expulsa ou banida.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub member_nicks: HashMap<String, String>,
    /// Campos que substituem o perfil global apenas neste servidor.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub member_profiles: HashMap<String, ServerMemberProfile>,
    /// Resumo visual (já filtrado por privacidade) dos membros do servidor, preenchido
    /// somente na projeção de saída para preservar personalizações de membros offline.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub member_roster: HashMap<String, FriendInfo>,
    /// Etapa C5: emojis próprios do servidor (tabela `server_emojis`).
    #[serde(default)]
    pub emojis: Vec<ServerEmoji>,
    /// Quando true, entradas por convite ficam temporariamente pausadas sem apagar os convites.
    #[serde(default)]
    pub invites_paused: bool,
    /// Regras opcionais exibidas na prévia do convite antes de confirmar entrada.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules_text: Option<String>,
    /// Base arquitetural para slug personalizado de convite (opcional, sem monetização).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_invite_slug: Option<String>,
    /// Membros em associação temporária (`username_lower`): removidos ao desconectar se não receberem cargo.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub temporary_members: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerMemberProfile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<ServerProfileImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner: Option<ServerProfileImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_decoration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_frame: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_effect: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nameplate_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_color_secondary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_gradient_direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_primary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_accent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_highlight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_direction: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerProfileImage {
    pub url: String,
    pub animated: bool,
}

/// Campos ausentes preservam o override atual. Texto vazio volta a herdar.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ServerProfileChanges {
    #[serde(default)]
    pub avatar_attachment_id: Option<String>,
    #[serde(default)]
    pub banner_attachment_id: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub avatar_decoration: Option<String>,
    #[serde(default)]
    pub profile_frame: Option<String>,
    #[serde(default)]
    pub profile_effect: Option<String>,
    #[serde(default)]
    pub nameplate_style: Option<String>,
    #[serde(default)]
    pub name_style: Option<String>,
    #[serde(default)]
    pub name_color: Option<String>,
    #[serde(default)]
    pub name_color_secondary: Option<String>,
    #[serde(default)]
    pub name_gradient_direction: Option<String>,
    #[serde(default)]
    pub theme_primary: Option<String>,
    #[serde(default)]
    pub theme_accent: Option<String>,
    #[serde(default)]
    pub theme_highlight: Option<String>,
    #[serde(default)]
    pub theme_mode: Option<String>,
    #[serde(default)]
    pub theme_direction: Option<String>,
}

/// Etapa C5: emoji do servidor. O `id` é o do anexo com a imagem (32 hex), então
/// qualquer cliente desenha `<:nome:id>` por `/api/attachments/{id}/…`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerEmoji {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub animated: bool,
    #[serde(default)]
    pub creator: String,
    #[serde(default)]
    pub created_at: i64,
}

/// Fase 8 — regras automáticas aplicadas no servidor a mensagens de canais do servidor.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AutoModConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Palavras/expressões proibidas (comparadas sem acento e sem maiúsculas;
    /// `palavra*` também pega prefixos).
    #[serde(default)]
    pub blocked_words: Vec<String>,
    /// Bloqueia links, exceto os domínios liberados.
    #[serde(default)]
    pub block_links: bool,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    /// Bloqueia convites (SANC-..., sancord://).
    #[serde(default)]
    pub block_invites: bool,
    /// Máximo de menções de pessoas/cargos numa mensagem (0 = sem limite).
    #[serde(default)]
    pub max_mentions: u32,
    /// Bloqueia a mesma mensagem repetida 3 vezes em 30 s.
    #[serde(default)]
    pub block_repeats: bool,
    /// Cargos isentos (além de dono, administradores e quem gerencia mensagens).
    #[serde(default)]
    pub exempt_roles: Vec<String>,
    /// Canal onde os bloqueios são avisados para a moderação (opcional).
    #[serde(default)]
    pub alert_channel_id: Option<String>,
}

/// Entrada do registro de auditoria de um servidor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuditEntry {
    pub id: String,
    pub server_id: String,
    pub actor: String,
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub details: Option<String>,
    pub created_at: i64,
}

/// Resultado de busca: a mensagem e onde ela está.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub message: ChatMessage,
    pub channel_name: String,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_channel_name: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_thread: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_forum: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct VoiceModeration {
    pub muted: bool,
    pub deafened: bool,
}

/// Servidor ICE entregue ao cliente (formato de `RTCIceServer`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IceServer {
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

impl GuildServer {
    /// Normaliza servidores antigos (sem categorias/posições) para o layout novo.
    pub fn ensure_layout(&mut self, now_ms: i64) {
        if self.created_at == 0 {
            self.created_at = now_ms;
        }
        let needs_categories = self.categories.is_empty()
            && self
                .text_channels
                .iter()
                .chain(self.voice_channels.iter())
                .all(|c| c.category_id.is_none());
        if needs_categories {
            let text_cat = format!("{}-cat-texto", self.id);
            let voice_cat = format!("{}-cat-voz", self.id);
            self.categories = vec![
                Category { id: text_cat.clone(), name: "Canais de texto".into(), position: 0, permission_overwrites: Vec::new() },
                Category { id: voice_cat.clone(), name: "Canais de voz".into(), position: 1, permission_overwrites: Vec::new() },
            ];
            for (i, c) in self.text_channels.iter_mut().enumerate() {
                c.category_id = Some(text_cat.clone());
                c.position = i as i32;
            }
            for (i, c) in self.voice_channels.iter_mut().enumerate() {
                c.category_id = Some(voice_cat.clone());
                c.position = i as i32;
            }
        }
        // Canais apontando para categorias inexistentes voltam para "sem categoria".
        let valid: std::collections::HashSet<String> = self.categories.iter().map(|c| c.id.clone()).collect();
        for c in self.text_channels.iter_mut().chain(self.voice_channels.iter_mut()) {
            if c.category_id.as_ref().is_some_and(|id| !valid.contains(id)) {
                c.category_id = None;
            }
        }
        let mut members = self.members.clone();
        if !self.owner_username.is_empty() {
            members.push(self.owner_username.clone());
        }
        for m in members {
            self.member_joined_at.entry(m).or_insert(self.created_at);
        }
        self.sort_layout();
    }

    /// Ordena categorias e canais pelas posições.
    pub fn sort_layout(&mut self) {
        self.categories.sort_by_key(|c| c.position);
        self.text_channels.sort_by_key(|c| c.position);
        self.voice_channels.sort_by_key(|c| c.position);
    }

    pub fn thread(&self, thread_id: &str) -> Option<&Thread> {
        self.threads.iter().find(|t| t.id == thread_id)
    }

    /// Canal comum ou thread deste servidor.
    pub fn has_channel_or_thread(&self, id: &str) -> bool {
        self.find_channel(id).is_some() || self.thread(id).is_some()
    }

    pub fn find_channel(&self, channel_id: &str) -> Option<&Channel> {
        self.text_channels
            .iter()
            .chain(self.voice_channels.iter())
            .find(|c| c.id == channel_id)
    }

    pub fn find_channel_mut(&mut self, channel_id: &str) -> Option<&mut Channel> {
        self.text_channels
            .iter_mut()
            .chain(self.voice_channels.iter_mut())
            .find(|c| c.id == channel_id)
    }

    /// Próxima posição livre dentro de uma categoria.
    pub fn next_position(&self, category_id: Option<&str>) -> i32 {
        self.text_channels
            .iter()
            .chain(self.voice_channels.iter())
            .filter(|c| c.category_id.as_deref() == category_id)
            .map(|c| c.position + 1)
            .max()
            .unwrap_or(0)
    }
    pub fn is_owner(&self, username_lower: &str) -> bool {
        !self.owner_username.is_empty() && self.owner_username == username_lower
    }

    /// Modo lento que vale para um canal; thread/postagem segue o canal-pai.
    pub fn slowmode_for(&self, channel_id: &str) -> u32 {
        let id = self.thread(channel_id).map(|t| t.parent_id.as_str()).unwrap_or(channel_id);
        self.find_channel(id).map(|c| c.slowmode_secs).unwrap_or(0)
    }

    /// Fim do castigo, se ainda estiver valendo em `now` (ms).
    pub fn timeout_until(&self, username_lower: &str, now: i64) -> Option<i64> {
        self.member_timeouts.get(username_lower).copied().filter(|until| *until > now)
    }

    pub fn is_banned(&self, username_lower: &str) -> bool {
        self.banned_usernames.iter().any(|b| b == username_lower)
    }

    pub fn is_member(&self, username_lower: &str) -> bool {
        if self.is_banned(username_lower) {
            return false;
        }
        self.id == "sancord"
            || self.is_owner(username_lower)
            || self.members.iter().any(|m| m == username_lower)
    }

    pub fn effective_permissions(&self, username_lower: &str) -> RolePermissions {
        if !self.is_member(username_lower) { return RolePermissions::none(); }
        if self.is_owner(username_lower) {
            return RolePermissions::all_admin();
        }
        let mut perms = self
            .roles
            .iter()
            .find(|r| r.id == "everyone")
            .map(|r| r.permissions.clone())
            .unwrap_or_default();

        // No hub público "sancord" sem dono fixo, manter comportamento comunitário para canais
        if self.id == "sancord" && self.owner_username.is_empty() {
            perms.manage_channels = true;
        }

        if let Some(assigned) = self.member_roles.get(username_lower) {
            for role_id in assigned {
                if let Some(role) = self.roles.iter().find(|r| &r.id == role_id) {
                    perms.merge_from(&role.permissions);
                }
            }
        }
        if perms.administrator { RolePermissions::all_admin() } else { perms }
    }

    pub fn highest_position(&self, username_lower: &str) -> i32 {
        if self.is_owner(username_lower) {
            return i32::MAX;
        }
        self.member_roles
            .get(username_lower)
            .into_iter()
            .flatten()
            .filter_map(|rid| self.roles.iter().find(|r| &r.id == rid))
            .map(|r| r.position)
            .max()
            .unwrap_or(0)
    }
}

/// Resumo público ao visualizar um código de convite antes de entrar
#[derive(Debug, Clone, Serialize)]
pub struct InvitePreviewResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub server_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub icon_color: Option<String>,
    pub banner_url: Option<String>,
    pub member_count: usize,
    /// Membros conectados agora (sem contar quem está invisível).
    pub online_count: usize,
    pub is_community: bool,
    pub expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inviter_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inviter_avatar: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_name: Option<String>,
    #[serde(default)]
    pub temporary: bool,
    #[serde(default)]
    pub already_member: bool,
    #[serde(default)]
    pub invites_paused: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    pub message: Option<String>,
}

fn default_status() -> String {
    "online".to_string()
}

/// Conta persistente salva em disco (data/accounts.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    pub avatar_color: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default = "default_status")]
    pub status_kind: String,
    #[serde(default)]
    pub custom_status: Option<String>,
    /// Nome de exibição (o username continua sendo a identidade única).
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub pronouns: Option<String>,
    #[serde(default)]
    pub custom_status_emoji: Option<String>,
    /// Status personalizado some sozinho neste instante (ms), se definido.
    #[serde(default)]
    pub custom_status_expires_at: Option<i64>,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub avatar_decoration: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    #[serde(default)]
    pub theme_primary: Option<String>,
    #[serde(default)]
    pub theme_accent: Option<String>,
    #[serde(default)]
    pub name_style: Option<String>,
    #[serde(default)]
    pub name_color: Option<String>,
    #[serde(default)]
    pub nameplate_style: Option<String>,
    #[serde(default)]
    pub profile_effect: Option<String>,
    #[serde(default)]
    pub password_salt_key: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    /// E-mail opcional associado à conta (visível apenas para o próprio titular).
    #[serde(default)]
    pub email: Option<String>,
    /// Hash do código de recuperação de senha (uso único).
    #[serde(default)]
    pub recovery_code_hash: Option<String>,
    /// Perfil P1: cosméticos possuídos além dos gratuitos (concedidos só pelo servidor).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inventory: Vec<String>,
    #[serde(default)]
    pub cosmetic_collection: CosmeticCollection,
    #[serde(default)]
    pub profile_board: ProfileBoard,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub created_community: bool,
    #[serde(default)]
    pub profile_sharing: ProfileSharing,
    /// Preferências privadas do titular sobre ordem e ocultação de badges exibidas no perfil.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badge_order: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_badges: Vec<String>,
    /// Todas as badges realmente possuídas pela conta (derivadas no servidor, nunca persistidas diretamente).
    #[serde(skip)]
    pub owned_badges: Vec<String>,
    #[serde(flatten, default)]
    pub profile: ProfileExtras,
    /// Token legado (texto puro) das versões antigas. Só é lido durante a
    /// migração dos JSON e convertido em sessão com hash; nunca é gravado.
    #[serde(default, skip_serializing)]
    pub token: String,
}

fn default_remember() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthRequest {
    pub username: String,
    pub password: String,
    /// "Manter conectado": sessão longa (30 dias) ou curta (24 h).
    #[serde(default = "default_remember")]
    pub remember: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionRequest {
    pub token: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RecoverPasswordRequest {
    pub username: String,
    pub recovery_code: String,
    pub new_password: String,
    #[serde(default = "default_remember")]
    pub remember: bool,
}

/// Resumo seguro de uma sessão ativa da conta (nunca expõe o token nem o hash completo).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
    pub remember: bool,
    pub current: bool,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthResponse {
    pub ok: bool,
    pub message: Option<String>,
    pub token: Option<String>,
    pub username: Option<String>,
    pub avatar_color: Option<String>,
    pub avatar_url: Option<String>,
}

fn default_activity_kind() -> String {
    "playing".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityButton {
    pub label: String,
    pub url: String,
}

/// Atividade em tempo real / Rich Presence separada de `status_kind` e `custom_status`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserActivity {
    #[serde(default = "default_activity_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_id: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub large_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub large_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub small_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub small_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub party_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub party_size: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub party_max: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buttons: Vec<ActivityButton>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spectate_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub avatar_color: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default = "default_status")]
    pub status_kind: String,
    #[serde(default)]
    pub custom_status: Option<String>,
    /// Nome de exibição (o username continua sendo a identidade única).
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub pronouns: Option<String>,
    #[serde(default)]
    pub custom_status_emoji: Option<String>,
    /// Status personalizado some sozinho neste instante (ms), se definido.
    #[serde(default)]
    pub custom_status_expires_at: Option<i64>,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub avatar_decoration: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    #[serde(default)]
    pub theme_primary: Option<String>,
    #[serde(default)]
    pub theme_accent: Option<String>,
    #[serde(default)]
    pub name_style: Option<String>,
    #[serde(default)]
    pub name_color: Option<String>,
    #[serde(default)]
    pub nameplate_style: Option<String>,
    #[serde(default)]
    pub profile_effect: Option<String>,
    #[serde(flatten, default)]
    pub profile: ProfileExtras,
    #[serde(default)]
    pub created_at: Option<String>,
    pub voice_channel_id: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    /// Silenciado/ensurdecido por um moderador do servidor (vale enquanto estiver nos canais dele).
    #[serde(default)]
    pub server_muted: bool,
    #[serde(default)]
    pub server_deafened: bool,
    pub screen_sharing: bool,
    #[serde(default)]
    pub camera_on: bool,
    #[serde(default)]
    pub stream_quality: Option<String>,
    #[serde(default)]
    pub camera_stream_id: Option<String>,
    #[serde(default)]
    pub screen_stream_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<UserActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyRef {
    pub id: String,
    pub author_name: String,
    pub preview: String,
    /// Etapa C2: a resposta menciona (notifica) o autor original? Padrão: sim.
    #[serde(default = "default_true")]
    pub mention: bool,
}

/// Etapa C2 — pedido de encaminhamento: qual mensagem copiar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardRequest {
    pub channel_id: String,
    pub message_id: String,
}

/// Etapa C2 — cópia congelada da mensagem encaminhada (não muda se a original
/// for editada ou apagada). O autor original não aparece, como em outros mensageiros.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ForwardSnapshot {
    pub source_channel_id: String,
    pub source_message_id: String,
    /// "#canal · Servidor", "Mensagem direta" ou "Grupo"
    pub source_label: String,
    pub original_created_at: i64,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub embeds: Vec<crate::link_preview::LinkEmbed>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub channel_id: String,
    pub author_id: String,
    pub author_name: String,
    pub author_color: String,
    #[serde(default)]
    pub author_avatar: Option<String>,
    pub content: String,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub reply_to: Option<ReplyRef>,
    #[serde(default)]
    pub reactions: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub edited: bool,
    #[serde(default)]
    pub pinned: bool,
    /// Horário formatado para exibição ("HH:MM"), mantido por compatibilidade.
    pub timestamp: String,
    /// Momento real de criação (ms desde a época, UTC). Usado para ordenação e paginação.
    #[serde(default)]
    pub created_at: i64,
    /// Identificador opcional gerado pelo cliente para casar a confirmação do
    /// envio com a mensagem local. Só aparece no eco do envio; não é persistido.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
    /// Arquivos enviados com a mensagem (imagens, vídeos, áudios, documentos...).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
    /// Menções resolvidas pelo servidor no envio (base para destaque e notificações).
    #[serde(default, skip_serializing_if = "MessageMentions::is_empty")]
    pub mentions: MessageMentions,
    /// Enquete anexada à mensagem (Fase 8); votos ficam junto da mensagem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll: Option<Poll>,
    /// Fase 9 (seção 66): quem escreveu — pessoa, sistema, bot ou webhook.
    /// Mensagens antigas não têm o campo: `author_id == "system"` também conta como sistema.
    #[serde(default, skip_serializing_if = "AuthorKind::is_user")]
    pub author_kind: AuthorKind,
    /// Etapa C1: prévias de links geradas pelo servidor (nunca aceitas do cliente).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub embeds: Vec<crate::link_preview::LinkEmbed>,
    /// Etapa C2: mensagem encaminhada (cópia congelada da original).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forward: Option<ForwardSnapshot>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthorKind {
    #[default]
    User,
    System,
    Bot,
    Webhook,
}

impl AuthorKind {
    pub fn is_user(&self) -> bool {
        *self == AuthorKind::User
    }
}

impl ChatMessage {
    pub fn authored_by(&self, connection_id: &str, username: &str) -> bool {
        self.author_kind() == AuthorKind::User &&
            (self.author_id == connection_id || self.author_name.eq_ignore_ascii_case(username))
    }
    /// Tipo efetivo do autor, considerando mensagens antigas de sistema.
    pub fn author_kind(&self) -> AuthorKind {
        if self.author_id == "system" && self.author_kind == AuthorKind::User {
            AuthorKind::System
        } else {
            self.author_kind
        }
    }
}

/// Pedido de criação de enquete enviado junto do `SendChat`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PollInput {
    pub question: String,
    pub options: Vec<String>,
    #[serde(default)]
    pub multiple: bool,
    /// 0 = sem prazo; máximo 7 dias (168 h).
    #[serde(default)]
    pub duration_hours: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PollOption {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Poll {
    pub question: String,
    pub options: Vec<PollOption>,
    /// opção -> usernames (minúsculos) que votaram nela
    #[serde(default)]
    pub votes: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub closed: bool,
}

impl Poll {
    pub const MAX_OPTIONS: usize = 10;

    pub fn is_open(&self, now: i64) -> bool {
        !self.closed && self.expires_at.map_or(true, |t| now < t)
    }
}

/// Evento agendado de um servidor (Fase 8).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerEvent {
    pub id: String,
    pub server_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Canal (de voz ou texto) onde acontece, ou um local livre.
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    pub starts_at: i64,
    #[serde(default)]
    pub ends_at: Option<i64>,
    pub creator: String,
    /// Interessados (username minúsculo)
    #[serde(default)]
    pub interested: Vec<String>,
    pub created_at: i64,
}

/// Anexo já armazenado no servidor (`url` aponta para o download).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub content_type: String,
    /// "image" | "video" | "audio" | "file" | "sticker" | "voice"
    pub kind: String,
    pub size: u64,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    pub url: String,
}

/// Quem a mensagem menciona. Calculado no servidor (o cliente não decide).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct MessageMentions {
    /// usernames em minúsculas
    #[serde(default)]
    pub users: Vec<String>,
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub everyone: bool,
    /// @online: só quem está conectado
    #[serde(default)]
    pub online: bool,
}

impl MessageMentions {
    pub fn is_empty(&self) -> bool {
        self.users.is_empty() && self.roles.is_empty() && !self.everyone && !self.online
    }
}

/// Posição de leitura de um canal para o usuário atual.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReadStateInfo {
    pub channel_id: String,
    /// `created_at` da última mensagem lida (0 = nada lido)
    pub last_read_at: i64,
    pub mention_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FriendsStore {
    /// username_lower -> lista de username_lower confirmados como amigos
    #[serde(default)]
    pub friends: HashMap<String, Vec<String>>,
    /// username_lower -> lista de username_lower que enviaram pedido
    #[serde(default)]
    pub incoming_requests: HashMap<String, Vec<String>>,
    /// username_lower -> lista de username_lower para quem enviou pedido
    #[serde(default)]
    pub outgoing_requests: HashMap<String, Vec<String>>,
    /// username_lower -> lista de dm_ids abertos na sidebar
    #[serde(default)]
    pub open_dms: HashMap<String, Vec<String>>,
    /// username_lower -> usuários que ele bloqueou
    #[serde(default)]
    pub blocked: HashMap<String, Vec<String>>,
    /// username_lower -> DMs de não amigos aguardando aceitar/ignorar
    #[serde(default)]
    pub dm_requests: HashMap<String, Vec<String>>,
    /// username_lower -> solicitações ignoradas (ficam ocultas e silenciosas até ele abrir)
    #[serde(default)]
    pub ignored_dms: HashMap<String, Vec<String>>,
}

impl FriendsStore {
    /// Conversa que não notifica `user`: solicitação pendente ou ignorada.
    pub fn is_silenced(&self, user: &str, dm_id: &str) -> bool {
        self.is_request(user, dm_id) || Self::has(&self.ignored_dms, user, dm_id)
    }
    pub fn is_ignored(&self, user: &str, dm_id: &str) -> bool {
        Self::has(&self.ignored_dms, user, dm_id)
    }
    fn has(map: &HashMap<String, Vec<String>>, a: &str, b: &str) -> bool {
        map.get(a).is_some_and(|v| v.iter().any(|x| x == b))
    }
    pub fn are_friends(&self, a: &str, b: &str) -> bool {
        Self::has(&self.friends, a, b)
    }
    /// `a` bloqueou `b`?
    pub fn has_blocked(&self, a: &str, b: &str) -> bool {
        Self::has(&self.blocked, a, b)
    }
    /// Algum dos dois bloqueou o outro?
    pub fn blocked_either(&self, a: &str, b: &str) -> bool {
        self.has_blocked(a, b) || self.has_blocked(b, a)
    }
    pub fn is_request(&self, user: &str, dm_id: &str) -> bool {
        Self::has(&self.dm_requests, user, dm_id)
    }
    pub fn push_unique(map: &mut HashMap<String, Vec<String>>, key: &str, value: &str) -> bool {
        let list = map.entry(key.to_string()).or_default();
        if list.iter().any(|x| x == value) {
            false
        } else {
            list.push(value.to_string());
            true
        }
    }
    pub fn remove_from(map: &mut HashMap<String, Vec<String>>, key: &str, value: &str) {
        if let Some(list) = map.get_mut(key) {
            list.retain(|x| x != value);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendInfo {
    /// ID estável da conta (usado por "Copiar ID do usuário" no Modo Desenvolvedor).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub username: String,
    pub avatar_color: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    pub status_kind: String,
    #[serde(default)]
    pub custom_status: Option<String>,
    /// Nome de exibição (o username continua sendo a identidade única).
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub pronouns: Option<String>,
    #[serde(default)]
    pub custom_status_emoji: Option<String>,
    /// Status personalizado some sozinho neste instante (ms), se definido.
    #[serde(default)]
    pub custom_status_expires_at: Option<i64>,
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub avatar_decoration: Option<String>,
    #[serde(default)]
    pub banner_url: Option<String>,
    #[serde(default)]
    pub theme_primary: Option<String>,
    #[serde(default)]
    pub theme_accent: Option<String>,
    #[serde(default)]
    pub name_style: Option<String>,
    #[serde(default)]
    pub name_color: Option<String>,
    #[serde(default)]
    pub nameplate_style: Option<String>,
    #[serde(default)]
    pub profile_effect: Option<String>,
    #[serde(flatten, default)]
    pub profile: ProfileExtras,
    #[serde(default)]
    pub created_at: Option<String>,
    pub online: bool,
    #[serde(default)]
    pub voice_channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<UserActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmConversation {
    pub dm_id: String,
    pub peer: FriendInfo,
    #[serde(default)]
    pub last_message: Option<String>,
    #[serde(default)]
    pub last_timestamp: Option<String>,
}

/// Estado autoritativo da máquina de estados de chamadas privadas (DM / Group DM).
/// Separa explicitamente o período de toque (`Ringing`) da sessão de voz ativa (`WaitingActive` / `Connected`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CallState {
    Ringing,
    WaitingActive,
    Connected,
    Ended,
}

/// Snapshot serializado de uma chamada privada, usado em tempo real e na reconstrução após reconexão.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallSnapshot {
    pub call_id: String,
    pub dm_id: String,
    pub voice_channel_id: String,
    pub state: CallState,
    pub caller_username: String,
    pub caller_display_name: String,
    pub caller_color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller_avatar: Option<String>,
    pub active_participants: Vec<String>,
    pub ringing_targets: Vec<String>,
    pub declined_by: Vec<String>,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ring_started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ring_expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<String>,
    pub server_now: i64,
}

/// Mensagens enviadas do Cliente (Frontend) para o Servidor Rust via WebSocket
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ClientMessage {
    ListScheduledMessages,
    ScheduleMessage { channel_id: String, content: String, send_at: i64 },
    CancelScheduledMessage { id: String },
    /// Identificação inicial do usuário ao entrar no servidor (via token de conta ou nome)
    JoinServer {
        token: Option<String>,
        username: Option<String>,
    },

    /// Atualizar foto de perfil do usuário (salva na conta)
    UpdateAvatar { avatar_url: String },

    /// Atualizar status online, frase personalizada, bio e personalização completa de perfil
    UpdateProfile {
        #[serde(default)]
        status_kind: Option<String>,
        #[serde(default)]
        custom_status: Option<String>,
        #[serde(default)]
        bio: Option<String>,
        #[serde(default)]
        avatar_decoration: Option<String>,
        #[serde(default)]
        banner_url: Option<String>,
        #[serde(default)]
        theme_primary: Option<String>,
        #[serde(default)]
        theme_accent: Option<String>,
        #[serde(default)]
        name_style: Option<String>,
        #[serde(default)]
        name_color: Option<String>,
        #[serde(default)]
        name_color_secondary: Option<String>,
        #[serde(default)]
        name_gradient_direction: Option<String>,
        #[serde(default)]
        nameplate_style: Option<String>,
        #[serde(default)]
        profile_effect: Option<String>,
        /// `None` mantém; `Some("")` limpa.
        #[serde(default)]
        display_name: Option<String>,
        #[serde(default)]
        pronouns: Option<String>,
        #[serde(default)]
        custom_status_emoji: Option<String>,
        /// Segundos até o status personalizado sumir (0 = nunca). Só vale junto com `custom_status`.
        #[serde(default)]
        custom_status_expires_in: Option<i64>,
        /// Perfil P1: destaque (#rrggbb), "solid"/"gradient", direção do gradiente e moldura.
        #[serde(default)]
        theme_highlight: Option<String>,
        #[serde(default)]
        theme_mode: Option<String>,
        #[serde(default)]
        theme_direction: Option<String>,
        #[serde(default)]
        profile_frame: Option<String>,
        /// Preferências de ordem e ocultação das badges possuídas pela conta (validadas no servidor).
        #[serde(default)]
        badge_order: Option<Vec<String>>,
        #[serde(default)]
        hidden_badges: Option<Vec<String>>,
    },

    /// Perfil P1: avatar ou banner a partir de uma imagem enviada em /api/attachments.
    /// `kind`: "avatar" | "banner"; `attachment_id` ausente = remover (volta ao padrão).
    SetProfileMedia {
        kind: String,
        #[serde(default)]
        attachment_id: Option<String>,
    },
    SetServerProfile {
        server_id: String,
        #[serde(flatten)]
        changes: ServerProfileChanges,
    },
    GetProfileBoard,
    SaveProfileBoard { board: ProfileBoard },
    GetProfileSharing,
    SetProfilePrivacy { privacy: ProfilePrivacy },
    SetProfileLink {
        id: Option<String>,
        label: String,
        url: String,
        visible: bool,
        #[serde(default)]
        platform: Option<String>,
    },
    RemoveProfileLink { id: String },
    StartGitHubProfileVerification { id: String },
    CheckGitHubProfileVerification { id: String },
    GetBadgeAdminState,
    SetUserBadges { target_username: String, badges: Vec<String> },
    SetCosmeticFavorite { key: String, favorite: bool },
    MarkCosmeticsSeen { key: Option<String> },
    SaveProfilePreset { name: String, appearance: ProfileAppearance },
    DeleteProfilePreset { id: String },
    EquipProfileLook { choice: ProfileLookChoice },

    /// Bloquear usuário (desfaz amizade e pedidos; ele não pode mais te enviar DM nem pedido)
    BlockUser { target_username: String },
    UnblockUser { target_username: String },

    /// Aceitar solicitação de mensagem (a DM passa para a lista normal)
    AcceptMessageRequest { dm_id: String },
    /// Ignorar solicitação de mensagem (some da lista; uma nova mensagem gera outra solicitação)
    IgnoreMessageRequest { dm_id: String },

    /// Criar grupo privado com amigos (até 10 pessoas contando você)
    CreateGroupDm {
        usernames: Vec<String>,
        #[serde(default)]
        name: Option<String>,
    },
    /// Renomear / trocar imagem do grupo (`Some("")` limpa)
    UpdateGroupDm {
        group_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        icon_url: Option<String>,
    },
    AddGroupDmMembers { group_id: String, usernames: Vec<String> },
    /// Só o dono remove outros membros
    RemoveGroupDmMember { group_id: String, username: String },
    LeaveGroupDm { group_id: String },

    /// Perfil completo (servidores/amigos em comum, data de entrada no servidor)
    GetUserProfile {
        username: String,
        #[serde(default)]
        server_id: Option<String>,
    },

    /// Denunciar usuário/mensagem (fica registrado para a moderação)
    ReportUser {
        username: String,
        reason: String,
        #[serde(default)]
        message_id: Option<String>,
    },

    /// Envio de mensagem em um canal de texto (com texto, resposta e/ou imagem)
    SendChat {
        channel_id: String,
        content: String,
        #[serde(default)]
        image_url: Option<String>,
        #[serde(default)]
        reply_to_id: Option<String>,
        #[serde(default)]
        nonce: Option<String>,
        /// IDs devolvidos por `POST /api/attachments`
        #[serde(default)]
        attachment_ids: Vec<String>,
        /// Enquete (Fase 8)
        #[serde(default)]
        poll: Option<PollInput>,
        /// Etapa C2: responder sem mencionar o autor (padrão: menciona).
        #[serde(default = "default_true")]
        reply_mention: bool,
        /// Etapa C2: encaminhar esta mensagem (o texto vira um comentário opcional).
        #[serde(default)]
        forward: Option<ForwardRequest>,
    },

    /// Votar numa enquete (substitui os votos anteriores; lista vazia retira o voto)
    VotePoll { channel_id: String, message_id: String, option_ids: Vec<String> },
    /// Encerrar enquete (autor ou quem gerencia mensagens)
    ClosePoll { channel_id: String, message_id: String },

    /// Threads e fóruns (Fase 8)
    ListThreads { server_id: String },
    CreateThread {
        /// Canal de texto (thread) ou fórum (postagem)
        channel_id: String,
        name: String,
        /// Mensagem do canal que origina a thread
        #[serde(default)]
        message_id: Option<String>,
        /// Postagem de fórum: tags do canal a aplicar
        #[serde(default)]
        tags: Vec<String>,
    },
    UpdateThread {
        thread_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        archived: Option<bool>,
        #[serde(default)]
        locked: Option<bool>,
        #[serde(default)]
        tags: Option<Vec<String>>,
        /// Etapa C6: 60, 1440, 4320 ou 10080 minutos sem mensagens até arquivar.
        #[serde(default)]
        auto_archive_minutes: Option<u32>,
    },
    DeleteThread { thread_id: String },
    /// Etapa C6: seguir (entrar) ou deixar de seguir uma thread.
    JoinThread { thread_id: String },
    LeaveThread { thread_id: String },

    /// Eventos do servidor (Fase 8)
    ListEvents { server_id: String },
    SaveEvent {
        server_id: String,
        /// Ausente = criar
        #[serde(default)]
        event_id: Option<String>,
        title: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        channel_id: Option<String>,
        #[serde(default)]
        location: Option<String>,
        starts_at: i64,
        #[serde(default)]
        ends_at: Option<i64>,
    },
    DeleteEvent { server_id: String, event_id: String },
    SetEventInterest { server_id: String, event_id: String, interested: bool },

    /// Carregar histórico: antes de uma mensagem (rolar para cima), depois de
    /// uma mensagem (rolar para baixo numa janela antiga) ou ao redor de uma
    /// mensagem (pular para resposta/fixada/link).
    LoadMessages {
        channel_id: String,
        #[serde(default)]
        before_id: Option<String>,
        #[serde(default)]
        after_id: Option<String>,
        #[serde(default)]
        around_id: Option<String>,
        #[serde(default)]
        limit: Option<u32>,
    },

    /// Marcar canal como lido até a mensagem indicada
    AckChannel { channel_id: String, message_id: String },

    /// Marcar todos os canais de um servidor como lidos
    AckServer { server_id: String },

    /// Marcar como não lida a partir desta mensagem
    MarkUnread { channel_id: String, message_id: String },

    /// Todas as mensagens fixadas de um canal (inclusive fora do cache)
    ListPins { channel_id: String },

    /// Editar própria mensagem
    EditChat {
        channel_id: String,
        message_id: String,
        content: String,
    },

    /// Apagar própria mensagem
    DeleteChat {
        channel_id: String,
        message_id: String,
    },

    /// Fixar ou desfixar mensagem no canal
    TogglePinChat {
        channel_id: String,
        message_id: String,
    },

    /// Adicionar ou remover reação com emoji
    ToggleReaction {
        channel_id: String,
        message_id: String,
        emoji: String,
    },

    /// Indicar que o usuário está digitando no canal
    Typing { channel_id: String },

    /// Criar um novo canal (texto, voz ou anúncios) em um servidor
    CreateChannel {
        name: String,
        kind: ChannelKind,
        #[serde(default)]
        server_id: Option<String>,
        #[serde(default)]
        category_id: Option<String>,
        #[serde(default)]
        topic: Option<String>,
        #[serde(default)]
        overwrites: Vec<crate::permissions::PermissionOverwrite>,
        #[serde(default = "default_true")]
        permissions_synced: bool,
    },

    /// Editar nome, descrição ou tipo (texto <-> anúncios) de um canal
    UpdateChannel {
        server_id: String,
        channel_id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        topic: Option<String>,
        #[serde(default)]
        kind: Option<ChannelKind>,
        /// Só canais de voz: 0 = sem limite, máximo 99.
        #[serde(default)]
        user_limit: Option<u32>,
        /// Só canais de voz: 0 = padrão (128 kbps), faixa 32..=256 kbps.
        #[serde(default)]
        bitrate_kbps: Option<u32>,
        /// Só canais de texto: 0 desliga; máximo de 6 horas.
        #[serde(default)]
        slowmode_secs: Option<u32>,
        /// Só fóruns: lista completa de tags (ids existentes são mantidos).
        #[serde(default)]
        forum_tags: Option<Vec<ForumTag>>,
    },

    UpdateChannelPermissions {
        server_id: String,
        channel_id: String,
        #[serde(default)]
        overwrites: Vec<crate::permissions::PermissionOverwrite>,
        #[serde(default)]
        sync_category: bool,
    },
    UpdateCategoryPermissions {
        server_id: String,
        category_id: String,
        overwrites: Vec<crate::permissions::PermissionOverwrite>,
    },

    /// Criar categoria de canais
    CreateCategory { server_id: String, name: String },

    /// Renomear categoria
    UpdateCategory {
        server_id: String,
        category_id: String,
        name: String,
    },

    /// Excluir categoria (os canais dela ficam sem categoria)
    DeleteCategory {
        server_id: String,
        category_id: String,
    },

    /// Nova ordem de categorias e canais (arrastar e soltar)
    ReorderServerLayout {
        server_id: String,
        #[serde(default)]
        categories: Vec<String>,
        #[serde(default)]
        channels: Vec<ChannelPlacement>,
    },

    /// Criar convite com validade, limite de usos, canal e associação temporária opcionais
    CreateInvite {
        server_id: String,
        #[serde(default)]
        max_age_secs: Option<u64>,
        #[serde(default)]
        max_uses: Option<u32>,
        #[serde(default)]
        channel_id: Option<String>,
        #[serde(default)]
        temporary: bool,
    },

    /// Listar convites ativos do servidor (gerenciadores)
    ListInvites { server_id: String },

    /// Revogar um convite
    RevokeInvite { server_id: String, code: String },

    /// Pausar ou retomar temporariamente os convites do servidor (sem apagar links ativos)
    SetInvitesPaused { server_id: String, paused: bool },

    /// Definir ou remover slug personalizado de convite do servidor (3–32 caracteres [a-z0-9-])
    SetCustomInviteSlug {
        server_id: String,
        #[serde(default)]
        slug: Option<String>,
    },

    /// Atualizar preferências sincronizadas (barra de servidores, pastas, silenciados, notas, ignorados, favoritos)
    UpdateUserPrefs {
        #[serde(default)]
        guild_layout: Option<Vec<GuildLayoutItem>>,
        #[serde(default)]
        muted_servers: Option<Vec<String>>,
        #[serde(default)]
        collapsed_categories: Option<Vec<String>>,
        #[serde(default)]
        privacy: Option<PrivacySettings>,
        #[serde(default)]
        notify_levels: Option<HashMap<String, String>>,
        #[serde(default)]
        user_notes: Option<HashMap<String, String>>,
        #[serde(default)]
        ignored_users: Option<Vec<String>>,
        #[serde(default)]
        starred_messages: Option<Vec<String>>,
        #[serde(default)]
        mutes: Option<HashMap<String, i64>>,
        #[serde(default)]
        favorite_gifs: Option<Vec<String>>,
        #[serde(default)]
        pinned_dms: Option<Vec<String>>,
        #[serde(default)]
        favorite_dms: Option<Vec<String>>,
    },

    /// Deletar um canal personalizado
    DeleteChannel {
        channel_id: String,
        #[serde(default)]
        server_id: Option<String>,
    },

    /// Renomear canal existente (somente dono/gerenciar canais)
    RenameChannel {
        server_id: String,
        channel_id: String,
        name: String,
    },

    /// Criar um novo servidor (o criador se torna Dono exclusivo)
    CreateServer {
        name: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        icon_url: Option<String>,
        #[serde(default)]
        icon_color: Option<String>,
        #[serde(default)]
        template: Option<String>,
        /// Comunidade (aberto) ou privado (padrão)
        #[serde(default)]
        is_community: bool,
    },

    /// Entrar em outro servidor usando código ou link de convite
    JoinServerByInvite {
        invite_code: String,
        #[serde(default)]
        accepted_rules: bool,
    },

    /// Sair de um servidor (membros que não são donos)
    LeaveServer { server_id: String },

    /// Editar informações, ícone, banner ou código de convite do servidor (somente criador / gerenciar servidor)
    UpdateServer {
        server_id: String,
        name: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        icon_url: Option<String>,
        #[serde(default)]
        banner_url: Option<String>,
        #[serde(default)]
        icon_color: Option<String>,
        #[serde(default)]
        regenerate_invite: bool,
        #[serde(default)]
        is_community: Option<bool>,
        #[serde(default)]
        rules_text: Option<String>,
    },

    /// Excluir definitivamente um servidor (exclusivo para o criador original)
    DeleteServer { server_id: String },

    /// Enviar convite do servidor diretamente na DM de um amigo
    InviteFriendToServer {
        server_id: String,
        target_username: String,
        #[serde(default)]
        invite_code: Option<String>,
        #[serde(default)]
        channel_id: Option<String>,
    },

    /// Criar novo cargo dentro de um servidor
    CreateRole {
        server_id: String,
        name: String,
        color: String,
        #[serde(default)]
        hoist: bool,
        #[serde(default)]
        mentionable: bool,
        #[serde(default)]
        badge_emoji: Option<String>,
        #[serde(default)]
        permissions: RolePermissions,
    },

    /// Atualizar cargo existente (nome, cor, posição, hoist, permissões)
    UpdateRole {
        server_id: String,
        role_id: String,
        name: String,
        color: String,
        position: i32,
        hoist: bool,
        mentionable: bool,
        #[serde(default)]
        badge_emoji: Option<String>,
        permissions: RolePermissions,
    },

    /// Excluir cargo de um servidor
    DeleteRole {
        server_id: String,
        role_id: String,
    },

    /// Atribuir/remover lista de cargos de um membro no servidor
    AssignUserRoles {
        server_id: String,
        target_username: String,
        role_ids: Vec<String>,
    },
    ReorderRoles { server_id: String, role_ids: Vec<String> },

    /// Expulsar membro de um servidor
    KickServerMember {
        server_id: String,
        target_username: String,
        #[serde(default)]
        reason: Option<String>,
    },

    /// Banir membro permanentemente de um servidor
    BanServerMember {
        server_id: String,
        target_username: String,
        #[serde(default)]
        reason: Option<String>,
        /// Segundos recentes de histórico de mensagens do membro banido a apagar (0 = manter tudo, máx 7 dias).
        #[serde(default)]
        delete_message_seconds: Option<u64>,
    },

    /// Transferir posse definitiva do servidor para outro membro atual (somente dono atual)
    TransferServerOwnership {
        server_id: String,
        new_owner_username: String,
    },

    /// Apagar em lote as últimas `count` mensagens de um canal (até 100), opcionalmente filtrando por autor
    BulkDeleteMessages {
        channel_id: String,
        count: usize,
        #[serde(default)]
        author_username: Option<String>,
    },

    /// Listar sessões ativas da própria conta
    ListSessions,

    /// Revogar uma sessão específica pelo ID curto (`SessionInfo.id`)
    RevokeSession {
        session_id: String,
    },

    /// Atualizar (ou remover) e-mail da conta mediante confirmação da senha atual
    UpdateAccountEmail {
        #[serde(default)]
        email: Option<String>,
        current_password: String,
    },

    /// Gerar código único de recuperação de senha mediante confirmação da senha atual
    GenerateRecoveryCode {
        current_password: String,
    },

    /// Excluir permanentemente a própria conta mediante confirmação da senha atual
    DeleteAccount {
        current_password: String,
    },

    /// Castigo (timeout): `duration_secs` = 0 remove; máximo de 28 dias.
    TimeoutMember {
        server_id: String,
        target_username: String,
        duration_secs: u64,
        #[serde(default)]
        reason: Option<String>,
    },

    /// Etapa C4: apelido no servidor (o próprio ou de outro membro). `None` ou vazio remove.
    SetMemberNickname {
        server_id: String,
        target_username: String,
        #[serde(default)]
        nickname: Option<String>,
    },

    /// Etapa C5: emoji do servidor a partir de uma imagem já enviada em /api/attachments.
    CreateServerEmoji {
        server_id: String,
        name: String,
        attachment_id: String,
    },
    RenameServerEmoji {
        server_id: String,
        emoji_id: String,
        name: String,
    },
    DeleteServerEmoji {
        server_id: String,
        emoji_id: String,
    },

    /// Remover banimento de um usuário em um servidor
    UnbanServerMember {
        server_id: String,
        target_username: String,
    },

    /// Alterar senha da própria conta
    ChangePassword {
        current_password: String,
        new_password: String,
    },

    /// Alterar nome de exibição da própria conta
    UpdateUsername { new_username: String },

    /// Enviar pedido de amizade pelo nome de usuário
    SendFriendRequest { target_username: String },

    /// Aceitar ou recusar pedido de amizade recebido
    RespondFriendRequest { from_username: String, accept: bool },

    /// Cancelar pedido de amizade enviado
    CancelFriendRequest { target_username: String },

    /// Remover amigo da lista
    RemoveFriend { target_username: String },

    /// Abrir ou iniciar conversa privada (DM) com um usuário
    OpenDm { target_username: String },

    /// Ocultar DM da lista recente do usuário atual (não apaga histórico nem amizade)
    CloseDm { dm_id: String },

    /// Entrar em um canal de voz (público ou privado de DM)
    JoinVoice { channel_id: String, #[serde(default)] resume: bool },

    /// Sair do canal de voz atual
    LeaveVoice,

    /// Moderação de voz num servidor: "mute" | "unmute" | "deafen" | "undeafen" | "disconnect" | "move"
    ModerateVoice {
        server_id: String,
        target_username: String,
        action: String,
        /// Destino quando `action` = "move"
        #[serde(default)]
        channel_id: Option<String>,
    },

    /// Recusar uma chamada privada recebida (avisa quem está na chamada e para o toque em todos os aparelhos)
    DeclineCall { channel_id: String },

    /// Cancelar o toque ativo de uma chamada privada sem necessariamente encerrar a sala
    CancelCall { channel_id: String },

    /// Chamar novamente participantes que não atenderam numa chamada privada ainda aberta (com cooldown)
    RingCall {
        channel_id: String,
        #[serde(default)]
        target_username: Option<String>,
    },

    /// Fase 8: registro de auditoria (mais recentes primeiro; `before` = cursor em ms)
    GetAuditLog {
        server_id: String,
        #[serde(default)]
        before: Option<i64>,
        #[serde(default)]
        action: Option<String>,
    },
    GetAutoMod { server_id: String },
    UpdateAutoMod { server_id: String, config: AutoModConfig },

    /// Busca no histórico completo, só nos canais que o usuário pode ler.
    SearchMessages {
        #[serde(default)]
        request_id: Option<String>,
        #[serde(default)]
        query: String,
        /// Escopo: um servidor, um canal, ou `private_only` (DMs e grupos).
        #[serde(default)]
        server_id: Option<String>,
        #[serde(default)]
        channel_id: Option<String>,
        #[serde(default)]
        private_only: bool,
        /// Filtros
        #[serde(default)]
        author: Option<String>,
        /// "link" | "file" | "image" | "video" | "audio" | "embed" | "reaction" | "poll"
        #[serde(default)]
        has: Option<String>,
        /// Múltiplos filtros `tem:` combinados (AND).
        #[serde(default)]
        has_list: Vec<String>,
        #[serde(default)]
        before: Option<i64>,
        #[serde(default)]
        after: Option<i64>,
        #[serde(default)]
        pinned: bool,
        #[serde(default)]
        mentions_me: bool,
        /// Menção direta a qualquer usuário (`menções:@nome`).
        #[serde(default)]
        mentions_user: Option<String>,
        /// "recent" | "oldest" | "relevance"
        #[serde(default)]
        sort: Option<String>,
        /// Paginação (0-based).
        #[serde(default)]
        offset: usize,
    },

    /// Preview compacto de mensagens vizinhas (antes/depois) para um resultado da busca.
    GetMessageContext {
        #[serde(default)]
        request_id: Option<String>,
        channel_id: String,
        message_id: String,
    },

    /// Atualizar atividade em tempo real / Rich Presence (None limpa a atividade)
    UpdateActivity {
        #[serde(default)]
        activity: Option<UserActivity>,
    },

    /// Atualizar estado de mídia (mute, deafen, compartilhamento de tela, câmera e qualidade)
    UpdateVoiceState {
        muted: bool,
        deafened: bool,
        screen_sharing: bool,
        #[serde(default)]
        camera_on: bool,
        #[serde(default)]
        stream_quality: Option<String>,
        #[serde(default)]
        camera_stream_id: Option<String>,
        #[serde(default)]
        screen_stream_id: Option<String>,
    },

    /// Sinalização WebRTC: Offer SDP direcionada a um peer específico
    WebRtcOffer {
        target_id: String,
        sdp: serde_json::Value,
    },

    /// Sinalização WebRTC: Answer SDP direcionada a um peer específico
    WebRtcAnswer {
        target_id: String,
        sdp: serde_json::Value,
    },

    /// Sinalização WebRTC: Candidato ICE para conectividade NAT/STUN
    WebRtcIceCandidate {
        target_id: String,
        candidate: serde_json::Value,
    },

    /// Keep-alive para evitar timeout de túneis (ex: Cloudflare Tunnel 100s)
    Ping,
}

/// Mensagens enviadas do Servidor Rust para o(s) Cliente(s) via WebSocket
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    ScheduledMessages { messages: Vec<crate::scheduled::ScheduledMessage> },
    /// Estado completo inicial enviado quando o usuário conecta
    Welcome {
        #[serde(default)]
        composer_capabilities: Vec<String>,
        user: UserInfo,
        text_channels: Vec<Channel>,
        voice_channels: Vec<Channel>,
        servers: Vec<GuildServer>,
        users: Vec<UserInfo>,
        voice_members: HashMap<String, Vec<String>>,
        chat_history: HashMap<String, Vec<ChatMessage>>,
        /// Versão do protocolo WebSocket (permite ao cliente detectar incompatibilidade).
        protocol_version: u32,
        /// Horário do servidor (ms UTC) para o cliente corrigir diferença de relógio.
        server_time: i64,
        /// Quantas mensagens por canal vieram em `chat_history`.
        history_page_size: usize,
        /// Preferências sincronizadas (barra de servidores, pastas, silenciados).
        prefs: UserPrefs,
        /// Posição de leitura e menções pendentes por canal.
        read_states: Vec<ReadStateInfo>,
        /// Servidores STUN/TURN para as chamadas (configurados no servidor).
        #[serde(default)]
        ice_servers: Vec<IceServer>,
    },

    /// Posição de leitura mudou (ack em outro dispositivo, marcar como não lida...)
    ReadStateUpdated { state: ReadStateInfo },

    /// Mensagens fixadas de um canal (resposta a ListPins)
    PinnedMessages {
        channel_id: String,
        messages: Vec<ChatMessage>,
    },

    /// Preferências alteradas em outro dispositivo/aba
    UserPrefsUpdated { prefs: UserPrefs },

    /// Perfil P1: catálogo de cosméticos e chaves possuídas ("tipo:id"), só para a própria conta.
    CosmeticsState {
        catalog: Vec<crate::cosmetics::CosmeticItem>,
        owned: Vec<String>,
        /// Definições das badges (nome, categoria trust/cosmetic, descrição, can_hide).
        badges: Vec<crate::cosmetics::BadgeDef>,
        /// IDs de badges realmente possuídas pela conta (inclusive as ocultadas pelo titular).
        owned_badges: Vec<String>,
        /// Ordem personalizada escolhida pelo titular.
        badge_order: Vec<String>,
        /// Badges ocultadas pelo titular.
        hidden_badges: Vec<String>,
        /// Limite máximo de badges exibidas simultaneamente.
        max_visible_badges: usize,
        collection: CosmeticCollection,
    },
    CosmeticCollectionUpdated { collection: CosmeticCollection },
    ProfileLookApplied { appearance: ProfileAppearance },

    /// Convite criado com sucesso (para quem pediu)
    InviteCreated { invite: InviteInfo },

    /// Lista de convites do servidor (resposta a ListInvites / após revogar / pausar)
    InvitesList {
        server_id: String,
        invites: Vec<InviteInfo>,
        #[serde(default)]
        invites_paused: bool,
    },

    /// Autenticação do WebSocket recusada (token ausente, inválido ou expirado).
    /// O servidor fecha a conexão logo depois; o cliente deve voltar ao login.
    AuthFailed { message: String },
    Pong,
    ChatAccepted { nonce: String },

    /// Página de histórico pedida com `LoadMessages`
    MessagesPage {
        channel_id: String,
        before_id: Option<String>,
        #[serde(default)]
        after_id: Option<String>,
        #[serde(default)]
        around_id: Option<String>,
        messages: Vec<ChatMessage>,
        /// Existem mensagens mais antigas que a primeira da página
        has_more: bool,
        /// Existem mensagens mais novas que a última da página
        #[serde(default)]
        has_more_after: bool,
    },

    /// Falha ao enviar uma mensagem específica (permite "Tentar novamente" no cliente)
    SendFailed {
        nonce: Option<String>,
        channel_id: String,
        message: String,
    },

    /// Sincronização completa dos servidores dos quais o usuário participa
    ServersSync { servers: Vec<GuildServer> },

    /// Canal adicionado em um servidor específico
    ChannelCreated {
        #[serde(default)]
        server_id: String,
        channel: Channel,
    },

    /// Canal removido de um servidor específico
    ChannelDeleted {
        #[serde(default)]
        server_id: String,
        channel_id: String,
        kind: ChannelKind,
    },

    /// Novo servidor criado ou entrou por convite
    ServerCreated {
        server: GuildServer,
        #[serde(default)]
        history: HashMap<String, Vec<ChatMessage>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default_channel_id: Option<String>,
    },

    /// Dados, canais, cargos ou membros de um servidor foram atualizados
    ServerUpdated { server: GuildServer },
    /// Novo membro entrou por convite (persiste mensagem de sistema no canal e notifica em tempo real)
    ServerMemberJoined {
        server_id: String,
        username: String,
        display_name: String,
        invite_code: String,
        message: ChatMessage,
    },
    ServerProfileUpdated {
        server_id: String,
        username: String,
        profile: Option<ServerMemberProfile>,
    },

    /// Ressincroniza acesso e dados recém-liberados após mudar cargos/permissões.
    ServerAccessUpdated {
        server: GuildServer,
        history: HashMap<String, Vec<ChatMessage>>,
        read_states: Vec<ReadStateInfo>,
    },

    /// Usuário foi removido ou servidor excluído
    ServerRemoved {
        server_id: String,
        #[serde(default)]
        reason: Option<String>,
    },

    /// Resposta de feedback para operações de servidor/cargos/conta
    ServerFeedback {
        ok: bool,
        message: String,
        #[serde(default)]
        action: Option<String>,
    },

    /// Atualização imediata do próprio usuário (ex: alteração de username)
    SelfUpdated { user: UserInfo },

    /// Novo usuário entrou ou atualizou seu perfil no servidor
    UserJoined { user: UserInfo },

    /// Usuário desconectou do servidor
    UserLeft { user_id: String },

    /// Nova mensagem de texto publicada em um canal
    NewChatMessage { message: ChatMessage },

    /// Mensagem editada, fixada ou com reação atualizada
    MessageUpdated { message: ChatMessage },

    /// Mensagem apagada de um canal
    MessageDeleted {
        channel_id: String,
        message_id: String,
    },

    /// Usuário está digitando no canal
    UserTyping {
        channel_id: String,
        user_id: String,
        username: String,
    },

    /// Sincronização do estado de canais de voz e status de usuários (mute/tela)
    VoiceStateSync {
        voice_members: HashMap<String, Vec<String>>,
        users: Vec<UserInfo>,
    },

    /// Notifica os membros que já estavam na call para iniciarem Offer WebRTC com o novo participante
    PeerJoinedVoice { channel_id: String, peer: UserInfo },

    /// Notifica que um participante saiu da call para fechar a RTCPeerConnection
    PeerLeftVoice { channel_id: String, peer_id: String },
    /// Evento sonoro compartilhado e autorizado pelo servidor para participantes da mesma call.
    VoiceCueEvent {
        event_id: String,
        event_type: String,
        voice_session_id: String,
        actor_user_id: String,
        timestamp: i64,
    },

    /// Um moderador moveu (`Some`) ou desconectou (`None`) você da voz
    VoiceMoved { channel_id: Option<String>, by: String },

    /// Alguém recusou a chamada privada em que você está (ou você recusou em outro aparelho)
    CallDeclined {
        channel_id: String,
        by_username: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        call_id: Option<String>,
    },

    /// Alguém atendeu a chamada privada (sincroniza multi-dispositivo e para ringtone/ringback imediatamente)
    CallAnswered {
        call_id: String,
        channel_id: String,
        by_username: String,
    },

    /// O período de toque (ringing) expirou, mas a sessão pode continuar aberta em WAITING_ACTIVE/CONNECTED
    CallRingTimeout {
        call_id: String,
        channel_id: String,
    },

    /// O chamador cancelou o toque ativo (para ringtone imediatamente nos destinatários)
    CallCanceled {
        call_id: String,
        channel_id: String,
        by_username: String,
    },

    /// Snapshot autoritativo do estado atual de uma chamada privada (RINGING, WAITING_ACTIVE, CONNECTED, ENDED)
    CallStateUpdated {
        call: CallSnapshot,
    },

    /// Lista de chamadas privadas ativas/disponíveis do usuário (enviada na conexão/reconexão)
    ActiveCallsSync {
        calls: Vec<CallSnapshot>,
    },

    /// A chamada privada terminou definitivamente (para de tocar e remove opção de entrada tardia)
    CallEnded {
        channel_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        call_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },

    /// Fase 8
    AuditLog { server_id: String, entries: Vec<AuditEntry>, has_more: bool },
    /// Threads visíveis de um servidor (resposta a ListThreads)
    ThreadList { server_id: String, threads: Vec<Thread> },
    /// Thread criada ou alterada (só para quem vê o canal-pai)
    ThreadUpdated { thread: Thread },
    /// Para quem criou: abre a thread recém-criada
    ThreadCreated { thread: Thread },
    ThreadDeleted { server_id: String, thread_id: String, parent_id: String },
    /// Lista completa dos eventos de um servidor (enviada a todos os membros a cada mudança)
    ServerEvents { server_id: String, events: Vec<ServerEvent> },
    AutoModSettings { server_id: String, config: AutoModConfig },
    SearchResults {
        request_id: Option<String>,
        hits: Vec<SearchHit>,
        has_more: bool,
        #[serde(default)]
        total_count: usize,
        #[serde(default)]
        offset: usize,
        #[serde(default)]
        sort: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    MessageContext {
        request_id: Option<String>,
        channel_id: String,
        message_id: String,
        messages: Vec<ChatMessage>,
    },

    UserActivityUpdated {
        user_id: String,
        username: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        activity: Option<UserActivity>,
    },

    /// Repasse de Offer WebRTC
    WebRtcOffer {
        from_id: String,
        sdp: serde_json::Value,
    },

    /// Repasse de Answer WebRTC
    WebRtcAnswer {
        from_id: String,
        sdp: serde_json::Value,
    },

    /// Repasse de ICE Candidate WebRTC
    WebRtcIceCandidate {
        from_id: String,
        candidate: serde_json::Value,
    },

    /// Sincronização da lista de amigos, pedidos pendentes e conversas privadas (DMs)
    FriendsSync {
        friends: Vec<FriendInfo>,
        incoming_requests: Vec<FriendInfo>,
        outgoing_requests: Vec<FriendInfo>,
        dm_conversations: Vec<DmConversation>,
        dm_history: HashMap<String, Vec<ChatMessage>>,
        /// Usuários que eu bloqueei
        #[serde(default)]
        blocked: Vec<FriendInfo>,
        /// DMs de não amigos aguardando aceitar/ignorar
        #[serde(default)]
        message_requests: Vec<DmConversation>,
        /// Grupos privados dos quais participo (histórico em `dm_history`)
        #[serde(default)]
        groups: Vec<GroupDmInfo>,
    },

    /// Perfil completo de outro usuário (resposta a GetUserProfile)
    UserProfile {
        user: FriendInfo,
        details_visible: bool,
        activity_visible: bool,
        bio_visible: bool,
        banner_visible: bool,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        links: Vec<ProfileLinkView>,
        #[serde(skip_serializing_if = "Option::is_none")]
        board: Option<ProfileBoardView>,
        /// "self" | "friend" | "incoming" | "outgoing" | "blocked" | "none"
        relationship: String,
        mutual_servers: Vec<MutualServer>,
        mutual_friends: Vec<FriendInfo>,
        /// Entrada no servidor pedido (ms), se for membro
        joined_server_at: Option<i64>,
        server_id: Option<String>,
    },
    ProfileBoardState { board: ProfileBoard },
    ProfileBoardSaved { board: ProfileBoard },
    ProfileSharingState { privacy: ProfilePrivacy, links: Vec<ProfileLink> },
    ProfilePresentationChanged { username: String },
    BadgeAdminState {
        can_manage: bool,
        grants: HashMap<String, Vec<String>>,
        accounts: Vec<String>,
    },

    /// Grupo criado/aberto: o cliente deve navegar até ele
    GroupDmOpened { group_id: String },

    /// Resposta de feedback ao enviar/gerenciar solicitação de amizade
    FriendFeedback { ok: bool, message: String },

    /// Confirmação de abertura/criação de DM com histórico
    DmOpened {
        dm_id: String,
        peer: FriendInfo,
        messages: Vec<ChatMessage>,
    },

    /// Notificação de chamada privada recebida em uma DM ou grupo
    DmCallIncoming {
        dm_id: String,
        voice_channel_id: String,
        from_username: String,
        from_color: String,
        from_avatar: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        call_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ring_started_at: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ring_expires_at: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        server_now: Option<i64>,
    },

    /// Lista de sessões ativas da conta do usuário
    SessionsList {
        sessions: Vec<SessionInfo>,
    },

    /// E-mail privado da conta do usuário (enviado na conexão e ao atualizar)
    AccountEmailUpdated {
        email: Option<String>,
    },

    /// Código de recuperação gerado (exibido uma única vez ao usuário)
    RecoveryCodeGenerated {
        recovery_code: String,
    },

    /// Lote de mensagens apagadas de um canal (moderação ou banimento com limpeza)
    MessagesBulkDeleted {
        channel_id: String,
        message_ids: Vec<String>,
    },
}

/// Perfil (Fase P1): campos novos compartilhados por `Account`, `UserInfo` e `FriendInfo`
/// (achatados no JSON, sem migração). Só o servidor escreve; os valores já chegam validados.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ProfileExtras {
    /// Segundo tom e direção do gradiente do nome. A cor primária continua em `name_color`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_color_secondary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_gradient_direction: Option<String>,
    /// Avatar/banner são GIF: clientes podem mostrar quadro estático fora do perfil aberto.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub avatar_animated: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub banner_animated: bool,
    /// Tema do perfil: cor de destaque (#rrggbb), "solid" | "gradient" e direção do gradiente.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_highlight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_direction: Option<String>,
    /// Moldura do cartão de perfil (id do catálogo de cosméticos).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_frame: Option<String>,
    /// Badges concedidas pelo servidor (nunca escolhidas pelo usuário).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileBoard {
    pub revision: u32,
    pub audience: BoardAudience,
    pub widgets: Vec<ProfileWidget>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoardAudience {
    #[default]
    Everyone,
    SharedSpaces,
    Friends,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileWidget {
    pub visible: bool,
    #[serde(flatten)]
    pub content: ProfileWidgetContent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProfileWidgetContent {
    FavoriteGame {
        name: String,
        #[serde(default)]
        description: String,
        #[serde(default)]
        cover_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        game_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cover_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        release_year: Option<u16>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        platforms: Vec<String>,
    },
    Playing {
        #[serde(default)]
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        game_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cover_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        release_year: Option<u16>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        platforms: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        auto_activity: bool,
    },
    WantToPlay {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        game_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cover_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        release_year: Option<u16>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        platforms: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
    About { text: String },
    Link { label: String, url: String },
    Achievements,
    Custom {
        title: String,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        emoji: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileBoardView {
    pub widgets: Vec<ProfileWidget>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub achievements: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileAudience {
    #[default]
    Everyone,
    SharedSpaces,
    Friends,
    OnlyMe,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProfilePrivacy {
    pub audience: ProfileAudience,
    pub bio: ProfileAudience,
    pub pronouns: ProfileAudience,
    pub banner: ProfileAudience,
    pub status: ProfileAudience,
    pub activity: ProfileAudience,
    pub badges: ProfileAudience,
    pub board: ProfileAudience,
    pub connections: ProfileAudience,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ProfileSharing {
    pub privacy: ProfilePrivacy,
    pub links: Vec<ProfileLink>,
    pub github_retry_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileLink {
    pub id: String,
    pub label: String,
    pub url: String,
    pub visible: bool,
    pub verified_github: bool,
    pub challenge: Option<GitHubProfileChallenge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubProfileChallenge {
    pub code: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileLinkView {
    pub label: String,
    pub url: String,
    pub verified_github: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CosmeticCollection {
    pub favorites: Vec<String>,
    pub seen: Vec<String>,
    pub presets: Vec<ProfilePreset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfilePreset {
    pub id: String,
    pub name: String,
    pub appearance: ProfileAppearance,
}

/// Só apresentação. Presets nunca gravam avatar, banner, bio, presença ou identidade.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileAppearance {
    pub avatar_decoration: Option<String>,
    pub profile_frame: Option<String>,
    pub profile_effect: Option<String>,
    pub nameplate_style: Option<String>,
    pub name_style: Option<String>,
    pub name_color: Option<String>,
    pub name_color_secondary: Option<String>,
    pub name_gradient_direction: Option<String>,
    pub theme_primary: Option<String>,
    pub theme_accent: Option<String>,
    pub theme_highlight: Option<String>,
    pub theme_mode: Option<String>,
    pub theme_direction: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProfileLookChoice {
    Preset { id: String },
    Custom { appearance: ProfileAppearance },
}
