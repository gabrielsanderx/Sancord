//! Fase 8 — threads e fóruns.
//!
//! Uma thread é um "canal" leve dentro de um servidor: as mensagens usam o id da
//! thread como `channel_id` e as permissões vêm do canal-pai
//! (`GuildServer::channel_permissions`). Por isso histórico, menções, não lidas,
//! digitando, fixadas, AutoMod e busca funcionam sem caminhos especiais.
//! Num fórum (`ChannelKind::Forum`) cada postagem é uma thread.
use crate::db::WriteOp;
use crate::models::{Channel, ChannelKind, ForumTag, MessageMentions, ServerMessage, Thread};
use crate::state::{ServerState, SharedState};
use uuid::Uuid;

pub const NAME_MAX: usize = 100;
pub const MAX_THREADS_PER_SERVER: usize = 1000;
pub const MAX_FORUM_TAGS: usize = 20;
pub const MAX_POST_TAGS: usize = 5;
const TAG_NAME_MAX: usize = 20;
const TAG_EMOJI_MAX: usize = 8;

/// Valida a lista completa de tags de um fórum. Ids já existentes são mantidos
/// (as postagens continuam marcadas); qualquer outro id vem do servidor.
pub fn sanitize_forum_tags(input: Vec<ForumTag>, existing: &[ForumTag]) -> Result<Vec<ForumTag>, &'static str> {
    if input.len() > MAX_FORUM_TAGS {
        return Err("Um fórum pode ter no máximo 20 tags.");
    }
    let mut out: Vec<ForumTag> = Vec::with_capacity(input.len());
    for tag in input {
        let name: String = tag.name.split_whitespace().collect::<Vec<_>>().join(" ").chars().filter(|c| !c.is_control()).take(TAG_NAME_MAX).collect();
        if name.is_empty() {
            return Err("Toda tag precisa de um nome.");
        }
        if out.iter().any(|t| t.name.to_lowercase() == name.to_lowercase()) {
            return Err("Há tags com o mesmo nome.");
        }
        let emoji = tag.emoji.map(|e| e.trim().chars().filter(|c| !c.is_control()).take(TAG_EMOJI_MAX).collect::<String>()).filter(|e| !e.is_empty());
        let id = if existing.iter().any(|t| t.id == tag.id) {
            tag.id
        } else {
            format!("tag-{}", &Uuid::new_v4().simple().to_string()[..8])
        };
        out.push(ForumTag { id, name, emoji, moderated: tag.moderated });
    }
    Ok(out)
}

/// Tags de uma postagem: existentes no fórum, sem repetição, até 5, na ordem do
/// fórum. Tags "só moderação" não podem ser postas nem tiradas por outras pessoas.
pub fn validate_post_tags(ch: &Channel, requested: &[String], current: &[String], moderator: bool) -> Result<Vec<String>, &'static str> {
    if ch.kind != ChannelKind::Forum {
        return if requested.is_empty() { Ok(Vec::new()) } else { Err("Tags só existem em postagens de fórum.") };
    }
    if requested.iter().any(|id| !ch.forum_tags.iter().any(|t| &t.id == id)) {
        return Err("Uma das tags não existe mais neste fórum.");
    }
    let chosen: Vec<String> = ch.forum_tags.iter().filter(|t| requested.contains(&t.id)).map(|t| t.id.clone()).collect();
    if chosen.len() > MAX_POST_TAGS {
        return Err("Uma postagem pode ter no máximo 5 tags.");
    }
    if !moderator {
        let touched_moderated = ch
            .forum_tags
            .iter()
            .filter(|t| t.moderated)
            .any(|t| chosen.contains(&t.id) != current.contains(&t.id));
        if touched_moderated {
            return Err("Algumas tags só a moderação pode aplicar ou remover.");
        }
    }
    Ok(chosen)
}

/// Depois de editar as tags do fórum: tira das postagens as que deixaram de existir.
pub fn prune_post_tags(st: &mut ServerState, server_id: &str, forum_id: &str) {
    let Some(srv) = st.find_server(server_id) else { return };
    let valid: Vec<String> = srv.find_channel(forum_id).map(|c| c.forum_tags.iter().map(|t| t.id.clone()).collect()).unwrap_or_default();
    let changed: Vec<Thread> = srv
        .threads
        .iter()
        .filter(|t| t.parent_id == forum_id && t.tags.iter().any(|id| !valid.contains(id)))
        .cloned()
        .map(|mut t| {
            t.tags.retain(|id| valid.contains(id));
            t
        })
        .collect();
    for t in changed {
        store(st, t);
    }
}

fn lower_of(st: &ServerState, uid: &str) -> Option<String> {
    st.users.get(uid).map(|u| u.username.to_lowercase())
}

fn clean_name(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ").chars().filter(|c| !c.is_control()).take(NAME_MAX).collect()
}

fn find_thread(st: &ServerState, thread_id: &str) -> Option<Thread> {
    st.servers.iter().find_map(|s| s.thread(thread_id).cloned())
}

fn is_moderator(st: &ServerState, lower: &str, thread: &Thread) -> bool {
    st.find_server(&thread.server_id)
        .is_some_and(|s| s.channel_permissions(lower, &thread.parent_id).manage_messages)
}

/// Envia `msg` a quem pode ver a thread (= o canal-pai).
fn send_to_viewers(st: &ServerState, thread_id: &str, msg: ServerMessage) {
    for (uid, u) in &st.users {
        if st.can_view_channel(&u.username.to_lowercase(), thread_id) {
            st.send_to(uid, msg.clone());
        }
    }
}

fn store(st: &mut ServerState, thread: Thread) {
    if let Some(srv) = st.find_server_mut(&thread.server_id) {
        match srv.threads.iter_mut().find(|t| t.id == thread.id) {
            Some(slot) => *slot = thread.clone(),
            None => srv.threads.push(thread.clone()),
        }
    }
    st.db.write(WriteOp::UpsertThread(Box::new(thread.clone())));
    let id = thread.id.clone();
    send_to_viewers(st, &id, ServerMessage::ThreadUpdated { thread });
}

pub async fn list(state: &SharedState, user_id: &str, server_id: String) {
    let st = state.read().await;
    let Some(lower) = lower_of(&st, user_id) else { return };
    let Some(srv) = st.find_server(&server_id).filter(|s| s.is_member(&lower)) else { return };
    let threads = srv.threads.iter().filter(|t| st.can_view_channel(&lower, &t.id)).cloned().collect();
    st.send_to(user_id, ServerMessage::ThreadList { server_id, threads });
}

pub async fn create(state: &SharedState, user_id: &str, channel_id: String, name: String, message_id: Option<String>, tags: Vec<String>) {
    let starter = match &message_id {
        Some(mid) => crate::ws::fetch_message_for_mutation(state, &channel_id, mid).await,
        None => None,
    };
    let mut st = state.write().await;
    let Some(lower) = lower_of(&st, user_id) else { return };
    let result: Result<Thread, &'static str> = (|| {
        let srv = st.find_server_by_text_channel(&channel_id).ok_or("Canal não encontrado.")?;
        let ch = srv.find_channel(&channel_id).ok_or("Não é possível criar uma thread dentro de outra.")?;
        let perms = srv.channel_permissions(&lower, &channel_id);
        if !perms.view_channel || !perms.read_history || !perms.send_messages {
            return Err("Você não pode criar threads neste canal.");
        }
        let is_forum = ch.kind == ChannelKind::Forum;
        if is_forum && message_id.is_some() {
            return Err("Postagens de fórum não partem de uma mensagem.");
        }
        let starter_id = match &message_id {
            Some(mid) => {
                let msg = starter.as_ref().filter(|m| m.channel_id == channel_id).ok_or("Mensagem não encontrada.")?;
                if srv.threads.iter().any(|t| t.starter_message_id.as_deref() == Some(mid.as_str())) {
                    return Err("Esta mensagem já tem uma thread.");
                }
                Some(msg.id.clone())
            }
            None => None,
        };
        let mut title = clean_name(&name);
        if title.is_empty() {
            title = starter.as_ref().map(|m| clean_name(&m.content.chars().take(40).collect::<String>())).unwrap_or_default();
        }
        if title.is_empty() {
            return Err(if is_forum { "Dê um título para a postagem." } else { "Dê um nome para a thread." });
        }
        if srv.threads.len() >= MAX_THREADS_PER_SERVER {
            return Err("Este servidor atingiu o limite de threads.");
        }
        let tags = validate_post_tags(ch, &tags, &[], perms.manage_messages)?;
        let now = crate::auth::now_ms();
        Ok(Thread {
            id: format!("thr-{}", Uuid::new_v4().simple()),
            server_id: srv.id.clone(),
            parent_id: channel_id.clone(),
            name: title,
            owner: lower.clone(),
            starter_message_id: starter_id,
            created_at: now,
            last_message_at: now,
            message_count: 0,
            archived: false,
            locked: false,
            tags,
        })
    })();
    let thread = match result {
        Ok(t) => t,
        Err(msg) => {
            st.feedback(user_id, false, "create_thread", msg);
            return;
        }
    };
    // O título passa pelo AutoMod como qualquer texto do servidor.
    if let Err((rule, reason)) = crate::moderation::check_message(&mut st, &thread.server_id, &lower, &thread.name, &MessageMentions::default()) {
        st.feedback(user_id, false, "create_thread", reason);
        crate::moderation::report_violation(&mut st, &thread.server_id, &lower, &channel_id, rule, &thread.name);
        return;
    }
    st.chat_history.entry(thread.id.clone()).or_default();
    store(&mut st, thread.clone());
    st.send_to(user_id, ServerMessage::ThreadCreated { thread });
}

pub async fn update(state: &SharedState, user_id: &str, thread_id: String, name: Option<String>, archived: Option<bool>, locked: Option<bool>, tags: Option<Vec<String>>) {
    let mut st = state.write().await;
    let Some(lower) = lower_of(&st, user_id) else { return };
    let Some(mut thread) = find_thread(&st, &thread_id).filter(|t| st.can_view_channel(&lower, &t.id)) else { return };
    let moderator = is_moderator(&st, &lower, &thread);
    let owner = thread.owner == lower;
    let parent = st.find_server(&thread.server_id).and_then(|s| s.find_channel(&thread.parent_id)).cloned();
    let result: Result<(), &'static str> = (|| {
        if (name.is_some() || archived.is_some() || tags.is_some()) && !(owner || moderator) {
            return Err("Só quem criou a thread ou a moderação podem alterá-la.");
        }
        if let Some(requested) = &tags {
            let parent = parent.as_ref().ok_or("Canal não encontrado.")?;
            thread.tags = validate_post_tags(parent, requested, &thread.tags, moderator)?;
        }
        if locked.is_some() && !moderator {
            return Err("Só a moderação tranca ou destranca threads.");
        }
        if let Some(n) = &name {
            let n = clean_name(n);
            if n.is_empty() {
                return Err("Nome inválido.");
            }
            thread.name = n;
        }
        if let Some(a) = archived {
            if !a && thread.locked && !moderator {
                return Err("Esta thread está trancada.");
            }
            thread.archived = a;
        }
        if let Some(l) = locked {
            thread.locked = l;
        }
        Ok(())
    })();
    if let Err(msg) = result {
        st.feedback(user_id, false, "update_thread", msg);
        return;
    }
    if moderator && !owner {
        let what = match (locked, archived) {
            (Some(true), _) => "thread_lock",
            (Some(false), _) => "thread_unlock",
            (_, Some(true)) => "thread_archive",
            _ => "thread_update",
        };
        crate::moderation::audit(&st, &thread.server_id, &lower, what, Some(&thread.name), None);
    }
    store(&mut st, thread);
}

pub async fn delete(state: &SharedState, user_id: &str, thread_id: String) {
    let mut st = state.write().await;
    let Some(lower) = lower_of(&st, user_id) else { return };
    let Some(thread) = find_thread(&st, &thread_id) else { return };
    if !(is_moderator(&st, &lower, &thread) || thread.owner == lower) {
        st.feedback(user_id, false, "delete_thread", "Só quem criou a thread ou a moderação podem excluí-la.");
        return;
    }
    // Avisa antes de remover: depois disso ninguém mais "vê" a thread.
    send_to_viewers(
        &st,
        &thread_id,
        ServerMessage::ThreadDeleted { server_id: thread.server_id.clone(), thread_id: thread_id.clone(), parent_id: thread.parent_id.clone() },
    );
    remove_thread(&mut st, &thread);
    crate::moderation::audit(&st, &thread.server_id, &lower, "thread_delete", Some(&thread.name), None);
}

fn remove_thread(st: &mut ServerState, thread: &Thread) {
    if let Some(srv) = st.find_server_mut(&thread.server_id) {
        srv.threads.retain(|t| t.id != thread.id);
    }
    st.delete_channel_history(&thread.id);
    st.db.write(WriteOp::DeleteThread { id: thread.id.clone() });
}

/// Canal-pai excluído: as threads dele vão junto.
pub fn remove_threads_of(st: &mut ServerState, server_id: &str, parent_id: &str) {
    let gone: Vec<Thread> = st
        .find_server(server_id)
        .map(|s| s.threads.iter().filter(|t| t.parent_id == parent_id).cloned().collect())
        .unwrap_or_default();
    for t in gone {
        remove_thread(st, &t);
    }
}

/// Nova mensagem numa thread: atualiza atividade e desarquiva (se não trancada).
pub fn on_message(st: &mut ServerState, channel_id: &str, at: i64) {
    let Some(mut thread) = find_thread(st, channel_id) else { return };
    thread.last_message_at = at;
    thread.message_count = thread.message_count.saturating_add(1);
    if thread.archived && !thread.locked {
        thread.archived = false;
    }
    store(st, thread);
}

/// Mensagem apagada numa thread: só ajusta o contador.
pub fn on_message_deleted(st: &mut ServerState, channel_id: &str) {
    let Some(mut thread) = find_thread(st, channel_id) else { return };
    thread.message_count = thread.message_count.saturating_sub(1);
    store(st, thread);
}
