//! Fase 8 — moderação e busca: registro de auditoria persistido, AutoMod por
//! servidor (aplicado no backend antes de gravar a mensagem) e busca no
//! histórico completo restrita aos canais que a pessoa pode ler.
use crate::db::{SearchFilter, WriteOp};
use crate::models::{AuditEntry, AutoModConfig, GuildServer, MessageMentions, SearchHit, ServerMessage};
use crate::state::{ServerState, SharedState};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tracing::warn;
use uuid::Uuid;

pub const AUDIT_PAGE: usize = 50;
pub const SEARCH_PAGE: usize = 25;
const MAX_WORDS: usize = 200;
const MAX_DOMAINS: usize = 50;
const REPEAT_WINDOW_MS: i64 = 30_000;
const REPEAT_LIMIT: usize = 3;

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/// Registra uma ação administrativa. `actor`/`target` são username_lower.
pub fn audit(st: &ServerState, server_id: &str, actor: &str, action: &str, target: Option<&str>, details: Option<String>) {
    let entry = AuditEntry {
        id: Uuid::new_v4().to_string(),
        server_id: server_id.to_string(),
        actor: actor.to_string(),
        action: action.to_string(),
        target: target.map(str::to_string),
        details: details.map(|d| d.chars().take(500).collect()),
        created_at: crate::auth::now_ms(),
    };
    st.db.write(WriteOp::InsertAudit(Box::new(entry)));
}

/// Atalho para handlers que só têm o id da conexão.
pub fn audit_by_uid(st: &ServerState, user_id: &str, server_id: &str, action: &str, target: Option<&str>, details: Option<String>) {
    if let Some(u) = st.users.get(user_id) {
        audit(st, server_id, &u.username.to_lowercase(), action, target, details);
    }
}

fn can_view_audit(srv: &GuildServer, lower: &str) -> bool {
    srv.is_member(lower) && srv.effective_permissions(lower).view_audit_log
}

fn can_manage_automod(srv: &GuildServer, lower: &str) -> bool {
    srv.is_member(lower) && srv.effective_permissions(lower).manage_server
}

pub async fn get_audit_log(state: &SharedState, user_id: &str, server_id: String, before: Option<i64>, action: Option<String>) {
    let db = {
        let st = state.read().await;
        let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
        if !st.find_server(&server_id).is_some_and(|s| can_view_audit(s, &lower)) {
            st.feedback(user_id, false, "audit_log", "Você não tem permissão para ver o registro de auditoria.");
            return;
        }
        st.db.clone()
    };
    let sid = server_id.clone();
    let action = action.filter(|a| !a.is_empty() && a.len() <= 40);
    let result = tokio::task::spawn_blocking(move || {
        db.flush();
        db.audit_log(&sid, before, action.as_deref(), AUDIT_PAGE)
    })
    .await;
    let st = state.read().await;
    match result {
        Ok(Ok((entries, has_more))) => st.send_to(user_id, ServerMessage::AuditLog { server_id, entries, has_more }),
        other => {
            warn!("Falha ao ler auditoria: {other:?}");
            st.feedback(user_id, false, "audit_log", "Não foi possível carregar o registro de auditoria.");
        }
    }
}

// ---------------------------------------------------------------------------
// AutoMod
// ---------------------------------------------------------------------------

/// Minúsculas e sem acentos (á→a, ç→c...), para comparar palavras.
pub fn normalize(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

fn tokens(normalized: &str) -> Vec<&str> {
    normalized.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()).collect()
}

/// Valida e normaliza a configuração enviada pela interface.
pub fn sanitize_config(srv: &GuildServer, mut cfg: AutoModConfig) -> Result<AutoModConfig, &'static str> {
    let mut words: Vec<String> = Vec::new();
    for w in cfg.blocked_words.iter().map(|w| normalize(w.trim())) {
        let w: String = w.chars().take(60).collect();
        if !w.trim_end_matches('*').trim().is_empty() && !words.contains(&w) {
            words.push(w);
        }
    }
    if words.len() > MAX_WORDS {
        return Err("Use no máximo 200 palavras bloqueadas.");
    }
    cfg.blocked_words = words;
    let mut domains: Vec<String> = Vec::new();
    for d in &cfg.allowed_domains {
        let d = d.trim().to_lowercase();
        let d = d.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
        let d = d.split('/').next().unwrap_or("").to_string();
        if !d.is_empty() && d.contains('.') && !domains.contains(&d) {
            domains.push(d);
        }
    }
    if domains.len() > MAX_DOMAINS {
        return Err("Use no máximo 50 domínios liberados.");
    }
    cfg.allowed_domains = domains;
    cfg.max_mentions = cfg.max_mentions.min(50);
    cfg.exempt_roles.retain(|r| r != "everyone" && srv.roles.iter().any(|x| &x.id == r));
    cfg.exempt_roles.dedup();
    if let Some(ch) = &cfg.alert_channel_id {
        if !srv.text_channels.iter().any(|c| &c.id == ch) {
            return Err("Canal de alertas inválido.");
        }
    }
    Ok(cfg)
}

fn is_exempt(srv: &GuildServer, lower: &str) -> bool {
    let p = srv.effective_permissions(lower);
    if srv.is_owner(lower) || p.administrator || p.manage_server || p.manage_messages {
        return true;
    }
    srv.member_roles
        .get(lower)
        .is_some_and(|roles| roles.iter().any(|r| srv.automod.exempt_roles.contains(r)))
}

fn link_domains(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut out = Vec::new();
    for (i, _) in lower.match_indices("http://").chain(lower.match_indices("https://")).chain(lower.match_indices("www.")) {
        let rest = &lower[i..];
        let rest = rest.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
        let host: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '.' || *c == '-').collect();
        if host.contains('.') {
            out.push(host);
        }
    }
    out
}

fn has_invite(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("sancord://")
        || lower.match_indices("sanc-").any(|(i, _)| {
            lower[i + 5..].chars().take_while(|c| c.is_ascii_alphanumeric()).count() >= 4
        })
}

fn content_hash(normalized: &str) -> u64 {
    let mut h = DefaultHasher::new();
    normalized.split_whitespace().collect::<Vec<_>>().join(" ").hash(&mut h);
    h.finish()
}

/// Regra violada (nome técnico, mensagem para quem enviou).
pub type Violation = (&'static str, &'static str);

/// Avalia uma mensagem. Atualiza o histórico de repetição do autor.
pub fn check_message(
    st: &mut ServerState,
    server_id: &str,
    author_lower: &str,
    content: &str,
    mentions: &MessageMentions,
) -> Result<(), Violation> {
    let Some(srv) = st.find_server(server_id) else { return Ok(()) };
    let cfg = &srv.automod;
    if !cfg.enabled || is_exempt(srv, author_lower) {
        return Ok(());
    }
    let norm = normalize(content);
    let toks = tokens(&norm);
    for w in &cfg.blocked_words {
        let hit = if let Some(prefix) = w.strip_suffix('*') {
            toks.iter().any(|t| t.starts_with(prefix))
        } else if w.contains(' ') {
            tokens(&norm).join(" ").contains(&tokens(w).join(" "))
        } else {
            toks.iter().any(|t| t == w)
        };
        if hit {
            return Err(("blocked_word", "Mensagem bloqueada pelo AutoMod: contém uma palavra proibida neste servidor."));
        }
    }
    if cfg.block_invites && has_invite(content) {
        return Err(("invite", "Mensagem bloqueada pelo AutoMod: convites não são permitidos aqui."));
    }
    if cfg.block_links {
        let allowed = |host: &str| cfg.allowed_domains.iter().any(|d| host == d || host.ends_with(&format!(".{d}")));
        if link_domains(content).iter().any(|h| !allowed(h)) {
            return Err(("link", "Mensagem bloqueada pelo AutoMod: links não são permitidos aqui."));
        }
    }
    if cfg.max_mentions > 0 {
        let count = mentions.users.len() + mentions.roles.len() + usize::from(mentions.everyone) + usize::from(mentions.online);
        if count > cfg.max_mentions as usize {
            return Err(("mentions", "Mensagem bloqueada pelo AutoMod: menções demais numa só mensagem."));
        }
    }
    if cfg.block_repeats && !norm.trim().is_empty() {
        let now = crate::auth::now_ms();
        let h = content_hash(&norm);
        let list = st.automod_recent.entry(author_lower.to_string()).or_default();
        list.retain(|(t, _)| now - t < REPEAT_WINDOW_MS);
        let repeats = list.iter().filter(|(_, x)| *x == h).count();
        if repeats + 1 >= REPEAT_LIMIT {
            return Err(("repeat", "Mensagem bloqueada pelo AutoMod: mesma mensagem repetida muitas vezes."));
        }
        list.push((now, h));
    }
    Ok(())
}

/// Registra o bloqueio e avisa no canal de alertas (só quem pode ver o canal recebe).
pub fn report_violation(st: &mut ServerState, server_id: &str, author_lower: &str, channel_id: &str, rule: &str, content: &str) {
    let preview: String = content.chars().take(120).collect();
    audit(st, server_id, "automod", "automod_block", Some(author_lower), Some(format!("regra: {rule}; canal: {channel_id}; texto: {preview}")));
    let Some(alert) = st.find_server(server_id).and_then(|s| s.automod.alert_channel_id.clone()) else { return };
    let channel_name = st
        .find_server(server_id)
        .and_then(|s| s.find_channel(channel_id))
        .map(|c| c.name.clone())
        .unwrap_or_default();
    let msg = crate::models::ChatMessage {
        id: Uuid::new_v4().to_string(),
        channel_id: alert.clone(),
        author_id: "system".into(),
        author_name: "AutoMod".into(),
        author_color: "#f23f43".into(),
        author_avatar: Some("/logo.png".into()),
        content: format!("🛡️ Mensagem de **{author_lower}** bloqueada em #{channel_name} (regra: {rule}).\n> {}", preview.replace('\n', " ")),
        image_url: None,
        reply_to: None,
        reactions: Default::default(),
        edited: false,
        pinned: false,
        timestamp: chrono::Local::now().format("%H:%M").to_string(),
        created_at: st.next_message_ts(),
        nonce: None,
        attachments: Vec::new(),
        mentions: MessageMentions::default(),
        poll: None,
        author_kind: crate::models::AuthorKind::System,
        embeds: Vec::new(),
        forward: None,
    };
    st.insert_message(msg.clone());
    st.broadcast_to_server(server_id, ServerMessage::NewChatMessage { message: msg });
}

pub async fn get_automod(state: &SharedState, user_id: &str, server_id: String) {
    let st = state.read().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    match st.find_server(&server_id).filter(|s| can_manage_automod(s, &lower)) {
        Some(srv) => st.send_to(user_id, ServerMessage::AutoModSettings { server_id, config: srv.automod.clone() }),
        None => st.feedback(user_id, false, "automod", "Você não tem permissão para configurar o AutoMod."),
    }
}

pub async fn update_automod(state: &SharedState, user_id: &str, server_id: String, config: AutoModConfig) {
    let mut st = state.write().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    let Some(srv) = st.find_server(&server_id).filter(|s| can_manage_automod(s, &lower)) else {
        st.feedback(user_id, false, "automod", "Você não tem permissão para configurar o AutoMod.");
        return;
    };
    let clean = match sanitize_config(srv, config) {
        Ok(c) => c,
        Err(msg) => {
            st.feedback(user_id, false, "automod", msg);
            return;
        }
    };
    let data = serde_json::to_string(&clean).unwrap_or_default();
    if let Some(srv) = st.find_server_mut(&server_id) {
        srv.automod = clean.clone();
    }
    st.db.write(WriteOp::PutAutoMod { server_id: server_id.clone(), data });
    audit(&st, &server_id, &lower, "automod_update", None, Some(format!(
        "ativo: {}; palavras: {}; links: {}; convites: {}; menções: {}; repetição: {}",
        clean.enabled, clean.blocked_words.len(), clean.block_links, clean.block_invites, clean.max_mentions, clean.block_repeats
    )));
    st.feedback(user_id, true, "automod", "AutoMod atualizado.");
    st.send_to(user_id, ServerMessage::AutoModSettings { server_id, config: clean });
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/// Termos seguros para o FTS: só letras/números, até 8 termos.
pub fn search_terms(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.chars().take(40).collect::<String>().to_lowercase())
        .take(8)
        .collect()
}

fn fold_ascii_pt(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ã' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'õ' | 'ô' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

fn normalize_has_kind(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "link" | "links" => Some("link"),
        "file" | "arquivo" | "arquivos" => Some("file"),
        "image" | "imagem" | "imagens" => Some("image"),
        "video" | "vídeo" | "videos" | "vídeos" => Some("video"),
        "audio" | "áudio" | "audios" | "áudios" | "voz" => Some("audio"),
        "embed" | "embeds" => Some("embed"),
        "reaction" | "reacao" | "reação" | "reacoes" | "reações" => Some("reaction"),
        "poll" | "enquete" | "enquetes" => Some("poll"),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn search(
    state: &SharedState,
    user_id: &str,
    request_id: Option<String>,
    query: String,
    server_id: Option<String>,
    channel_id: Option<String>,
    private_only: bool,
    author: Option<String>,
    has: Option<String>,
    has_list: Vec<String>,
    before: Option<i64>,
    after: Option<i64>,
    pinned: bool,
    mentions_me: bool,
    mentions_user: Option<String>,
    sort: Option<String>,
    offset: usize,
) {
    let request_id = request_id.map(|r| r.chars().take(40).collect::<String>());
    let sort_norm = match sort.as_deref().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("oldest") => "oldest".to_string(),
        Some("relevance") => "relevance".to_string(),
        _ => "recent".to_string(),
    };
    let safe_offset = offset.min(2000);

    // Rate limit dedicado por conexão contra abuso em buscas globais.
    {
        let now = crate::auth::now_ms();
        let mut st = state.write().await;
        if !st.rates.entry(user_id.to_string()).or_default().allow_search(now) {
            st.send_to(
                user_id,
                ServerMessage::SearchResults {
                    request_id,
                    hits: Vec::new(),
                    has_more: false,
                    total_count: 0,
                    offset: safe_offset,
                    sort: sort_norm,
                    error: Some("Muitas buscas em seguida. Aguarde alguns segundos.".into()),
                },
            );
            return;
        }
    }

    let (db, filter) = {
        let st = state.read().await;
        let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
        let readable = st.readable_channels(&lower);
        let channels: Vec<String> = if let Some(ch) = &channel_id {
            // Se for canal pai (ex.: fórum/texto com threads), inclui o canal e suas threads legíveis.
            let mut set: Vec<String> = readable
                .iter()
                .filter(|c| *c == ch)
                .cloned()
                .collect();
            if let Some(srv) = st.find_server_by_text_channel(ch) {
                for th in &srv.threads {
                    if th.parent_id == *ch && readable.contains(&th.id) && !set.contains(&th.id) {
                        set.push(th.id.clone());
                    }
                }
            }
            set
        } else if let Some(sid) = &server_id {
            match st.find_server(sid) {
                Some(srv) => readable
                    .into_iter()
                    .filter(|c| srv.text_channels.iter().any(|t| &t.id == c) || srv.thread(c).is_some())
                    .collect(),
                None => Vec::new(),
            }
        } else if private_only {
            readable.into_iter().filter(|c| ServerState::is_private_text(c)).collect()
        } else {
            readable
        };

        let mut normalized_has: Vec<String> = Vec::new();
        if let Some(h) = has.as_deref().and_then(normalize_has_kind) {
            normalized_has.push(h.to_string());
        }
        for raw_h in &has_list {
            if let Some(h) = normalize_has_kind(raw_h) {
                let s = h.to_string();
                if !normalized_has.contains(&s) {
                    normalized_has.push(s);
                }
            }
        }

        let terms = search_terms(&query);
        let folded_terms: Vec<String> = terms.iter().map(|t| fold_ascii_pt(t)).collect();
        let mut matching_thread_channels = Vec::new();
        if !folded_terms.is_empty() {
            for ch in &channels {
                if let Some(srv) = st.find_server_by_text_channel(ch) {
                    if let Some(th) = srv.thread(ch) {
                        let parent_tags: Vec<String> = srv
                            .find_channel(&th.parent_id)
                            .map(|parent| {
                                th.tags
                                    .iter()
                                    .filter_map(|tid| parent.forum_tags.iter().find(|ft| ft.id == *tid).map(|ft| ft.name.clone()))
                                    .collect()
                            })
                            .unwrap_or_default();
                        let hay = fold_ascii_pt(&format!("{} {}", th.name, parent_tags.join(" ")));
                        if folded_terms.iter().all(|t| hay.contains(t.as_str())) {
                            matching_thread_channels.push(ch.clone());
                        }
                    }
                }
            }
        }

        let explicit_mention = mentions_user
            .map(|u| u.trim().trim_start_matches('@').to_lowercase())
            .filter(|u| !u.is_empty());
        let (target_mention, include_roles) = if let Some(u) = explicit_mention {
            (Some(u), false)
        } else if mentions_me {
            (Some(lower.clone()), true)
        } else {
            (None, false)
        };

        let filter = SearchFilter {
            channels,
            terms,
            author_lower: author.map(|a| a.trim().trim_start_matches('@').to_lowercase()).filter(|a| !a.is_empty()),
            has: None,
            has_list: normalized_has,
            before,
            after,
            pinned,
            mentions_user: target_mention,
            mentions_include_roles: include_roles,
            mention_roles: if include_roles {
                st.servers
                    .iter()
                    .filter_map(|s| s.member_roles.get(&lower))
                    .flatten()
                    .filter(|r| r.as_str() != "everyone")
                    .take(200)
                    .cloned()
                    .collect()
            } else {
                Vec::new()
            },
            matching_thread_channels,
            sort: sort_norm.clone(),
            offset: safe_offset,
            limit: SEARCH_PAGE,
        };
        let no_filters = filter.terms.is_empty()
            && filter.author_lower.is_none()
            && filter.has_list.is_empty()
            && filter.before.is_none()
            && filter.after.is_none()
            && !filter.pinned
            && filter.mentions_user.is_none();
        if no_filters {
            st.send_to(
                user_id,
                ServerMessage::SearchResults {
                    request_id,
                    hits: Vec::new(),
                    has_more: false,
                    total_count: 0,
                    offset: safe_offset,
                    sort: sort_norm,
                    error: None,
                },
            );
            return;
        }
        (st.db.clone(), filter)
    };
    let result = tokio::task::spawn_blocking(move || {
        db.flush();
        db.search_messages(&filter)
    })
    .await;
    let st = state.read().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    match result {
        Ok(Ok((messages, has_more, total_count))) => {
            let hits = messages
                .into_iter()
                // Revalida: permissões podem ter mudado durante a consulta.
                .filter(|m| st.can_read_text_channel(&lower, &m.channel_id))
                .map(|m| describe_hit(&st, &lower, m))
                .collect();
            st.send_to(
                user_id,
                ServerMessage::SearchResults {
                    request_id,
                    hits,
                    has_more,
                    total_count,
                    offset: safe_offset,
                    sort: sort_norm,
                    error: None,
                },
            );
        }
        other => {
            warn!("Falha na busca: {other:?}");
            st.send_to(
                user_id,
                ServerMessage::SearchResults {
                    request_id,
                    hits: Vec::new(),
                    has_more: false,
                    total_count: 0,
                    offset: safe_offset,
                    sort: sort_norm,
                    error: Some("Não foi possível pesquisar agora.".into()),
                },
            );
        }
    }
}

fn describe_hit(st: &ServerState, me: &str, message: crate::models::ChatMessage) -> SearchHit {
    let ch = message.channel_id.clone();
    if let Some((a, b)) = ServerState::parse_dm_participants(&ch) {
        let peer = if a == me { b } else { a };
        let name = st.resolve_friend_info(&peer).map(|f| f.username).unwrap_or(peer);
        return SearchHit {
            message,
            channel_name: format!("@{name}"),
            server_id: None,
            server_name: None,
            parent_channel_name: None,
            is_thread: false,
            is_forum: false,
        };
    }
    if let Some(g) = st.group_for_channel(&ch) {
        let name = g.name.clone().unwrap_or_else(|| "Grupo".into());
        return SearchHit {
            message,
            channel_name: name,
            server_id: None,
            server_name: None,
            parent_channel_name: None,
            is_thread: false,
            is_forum: false,
        };
    }
    let srv = st.find_server_by_text_channel(&ch);
    if let Some(s) = srv {
        if let Some(th) = s.thread(&ch) {
            let parent = s.find_channel(&th.parent_id);
            let is_forum = parent.is_some_and(|p| p.kind == crate::models::ChannelKind::Forum);
            return SearchHit {
                channel_name: format!("🧵 {}", th.name),
                parent_channel_name: parent.map(|p| p.name.clone()),
                is_thread: true,
                is_forum,
                server_id: Some(s.id.clone()),
                server_name: Some(s.name.clone()),
                message,
            };
        }
        if let Some(c) = s.find_channel(&ch) {
            return SearchHit {
                channel_name: c.name.clone(),
                parent_channel_name: None,
                is_thread: false,
                is_forum: c.kind == crate::models::ChannelKind::Forum,
                server_id: Some(s.id.clone()),
                server_name: Some(s.name.clone()),
                message,
            };
        }
    }
    SearchHit {
        channel_name: String::new(),
        parent_channel_name: None,
        is_thread: false,
        is_forum: false,
        server_id: srv.map(|s| s.id.clone()),
        server_name: srv.map(|s| s.name.clone()),
        message,
    }
}

/// Carrega mensagens vizinhas (antes e depois) para o preview "Ver contexto" da busca,
/// revalidando permissões de leitura do canal.
pub async fn message_context(
    state: &SharedState,
    user_id: &str,
    request_id: Option<String>,
    channel_id: String,
    message_id: String,
) {
    let request_id = request_id.map(|r| r.chars().take(40).collect::<String>());
    let db = {
        let st = state.read().await;
        let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
        if !st.can_read_text_channel(&lower, &channel_id) {
            st.send_to(
                user_id,
                ServerMessage::MessageContext {
                    request_id,
                    channel_id,
                    message_id,
                    messages: Vec::new(),
                },
            );
            return;
        }
        st.db.clone()
    };
    let ch = channel_id.clone();
    let mid = message_id.clone();
    let res = tokio::task::spawn_blocking(move || {
        db.flush();
        db.messages_around(&ch, &mid, 5)
    })
    .await;
    let st = state.read().await;
    let Some(lower) = st.users.get(user_id).map(|u| u.username.to_lowercase()) else { return };
    if !st.can_read_text_channel(&lower, &channel_id) {
        return;
    }
    let messages = match res {
        Ok(Ok((list, _, _))) => list,
        _ => Vec::new(),
    };
    st.send_to(
        user_id,
        ServerMessage::MessageContext {
            request_id,
            channel_id,
            message_id,
            messages,
        },
    );
}
