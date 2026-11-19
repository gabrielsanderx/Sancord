//! Etapa C5 — emojis próprios do servidor.
//!
//! - A imagem é enviada como anexo comum (`POST /api/attachments`); o emoji guarda o ID
//!   do anexo, que também é o ID do emoji. Assim `<:nome:id>` é desenhado por qualquer
//!   cliente em `/api/attachments/{id}/…` (servido com `nosniff` e CSP `sandbox`).
//! - Só PNG, JPEG, GIF ou WebP de até 256 KiB, enviados por quem cria o emoji.
//! - Nome: 2 a 32 caracteres `[A-Za-z0-9_]`, único no servidor (sem diferenciar maiúsculas).
//! - Até 50 emojis por servidor. Exige `manage_expressions` (ou dono/administrador).
//! - Nas mensagens, `<:nome:id>` só fica se o emoji existir num servidor de que o autor é
//!   membro (como no Discord com emojis de outros servidores); senão vira `:nome:`.
use crate::models::{GuildServer, ServerEmoji, ServerMessage};
use crate::state::ServerState;

pub const MAX_PER_SERVER: usize = 50;
pub const MAX_BYTES: u64 = 256 * 1024;

pub fn clean_name(raw: &str) -> Result<String, &'static str> {
    let name = raw.trim().trim_matches(':');
    let len = name.chars().count();
    if !(2..=32).contains(&len) || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("O nome do emoji deve ter de 2 a 32 letras, números ou _.");
    }
    Ok(name.to_string())
}

pub fn token(e: &ServerEmoji) -> String {
    format!("<{}:{}:{}>", if e.animated { "a" } else { "" }, e.name, e.id)
}

fn is_emoji_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Lê `<:nome:id>` ou `<a:nome:id>` no começo de `s`: (nome, id, bytes consumidos).
fn parse_token(s: &str) -> Option<(&str, &str, usize)> {
    let rest = s.strip_prefix("<a:").or_else(|| s.strip_prefix("<:"))?;
    let head = s.len() - rest.len();
    let close = rest.find('>')?;
    let inner = &rest[..close];
    let (name, id) = inner.split_once(':')?;
    if name.is_empty() || name.len() > 32 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || !is_emoji_id(id) {
        return None;
    }
    Some((name, id, head + close + 1))
}

/// Emoji `id` num servidor de que `user_lower` é membro.
pub fn usable<'a>(st: &'a ServerState, user_lower: &str, id: &str) -> Option<&'a ServerEmoji> {
    st.servers
        .iter()
        .filter(|s| s.is_member(user_lower))
        .find_map(|s| s.emojis.iter().find(|e| e.id == id))
}

/// Reescreve os códigos de emoji do texto: válidos ficam no formato atual (nome atual);
/// os que o autor não pode usar ou que não existem viram `:nome:`.
pub fn normalize_content(st: &ServerState, author_lower: &str, content: &str) -> String {
    if !content.contains("<:") && !content.contains("<a:") {
        return content.to_string();
    }
    let mut out = String::with_capacity(content.len());
    let mut i = 0;
    while i < content.len() {
        let rest = &content[i..];
        if rest.starts_with('<') {
            if let Some((name, id, used)) = parse_token(rest) {
                match usable(st, author_lower, id) {
                    Some(e) => out.push_str(&token(e)),
                    None => {
                        out.push(':');
                        out.push_str(name);
                        out.push(':');
                    }
                }
                i += used;
                continue;
            }
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Chave de reação para um emoji do servidor: `Some((chave, só_remover))`.
/// Emoji que o autor não pode usar (ou excluído) só serve para tirar a própria reação.
pub fn reaction_key(st: &ServerState, user_lower: &str, raw: &str) -> Option<(String, bool)> {
    let raw = raw.trim();
    let (_, id, used) = parse_token(raw)?;
    if used != raw.len() {
        return None;
    }
    Some(match usable(st, user_lower, id) {
        Some(e) => (token(e), false),
        None => (raw.to_string(), true),
    })
}

fn require_manager(srv: &GuildServer, actor: &str) -> Result<(), &'static str> {
    if !srv.is_member(actor) {
        return Err("Você não é membro deste servidor.");
    }
    let p = srv.effective_permissions(actor);
    if srv.is_owner(actor) || p.administrator || p.manage_expressions {
        Ok(())
    } else {
        Err("Você não tem permissão para gerenciar emojis.")
    }
}

fn actor_of(st: &ServerState, uid: &str) -> Result<(String, String), &'static str> {
    let u = st.users.get(uid).ok_or("Sessão inválida.")?;
    let lower = u.username.to_lowercase();
    let account = st.accounts.get(&lower).map(|a| a.id.clone()).unwrap_or_default();
    Ok((lower, account))
}

fn finish(st: &mut ServerState, server_id: &str, actor: &str, action: &str, details: String) {
    st.save_servers();
    crate::moderation::audit(st, server_id, actor, action, None, Some(details));
    if let Some(server) = st.find_server(server_id).cloned() {
        st.broadcast_to_server(server_id, ServerMessage::ServerUpdated { server });
    }
}

pub fn create(st: &mut ServerState, uid: &str, server_id: &str, name: &str, attachment_id: &str) -> Result<String, &'static str> {
    let (actor, account_id) = actor_of(st, uid)?;
    if server_id == "sancord" {
        return Err("O hub público não tem emojis próprios.");
    }
    let name = clean_name(name)?;
    let srv = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
    require_manager(srv, &actor)?;
    if srv.emojis.len() >= MAX_PER_SERVER {
        return Err("Este servidor já tem 50 emojis. Exclua algum para enviar outro.");
    }
    if srv.emojis.iter().any(|e| e.name.eq_ignore_ascii_case(&name)) {
        return Err("Já existe um emoji com esse nome neste servidor.");
    }
    let att = st.attachments.get(attachment_id).ok_or("Imagem não encontrada. Envie de novo.")?;
    if att.uploader_id != account_id {
        return Err("Use uma imagem enviada por você.");
    }
    if !matches!(att.content_type.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp") {
        return Err("O emoji precisa ser PNG, JPG, GIF ou WebP.");
    }
    if att.size > MAX_BYTES {
        return Err("A imagem do emoji pode ter no máximo 256 KB.");
    }
    if st.servers.iter().any(|s| s.emojis.iter().any(|e| e.id == attachment_id)) {
        return Err("Esta imagem já é um emoji. Envie a imagem de novo para criar outro.");
    }
    let emoji = ServerEmoji {
        id: attachment_id.to_string(),
        name: name.clone(),
        animated: att.content_type == "image/gif",
        creator: actor.clone(),
        created_at: crate::auth::now_ms(),
    };
    st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?.emojis.push(emoji);
    finish(st, server_id, &actor, "emoji_create", format!("emoji: :{name}:"));
    Ok(format!("Emoji :{name}: adicionado."))
}

pub fn rename(st: &mut ServerState, uid: &str, server_id: &str, emoji_id: &str, name: &str) -> Result<String, &'static str> {
    let (actor, _) = actor_of(st, uid)?;
    let name = clean_name(name)?;
    let srv = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
    require_manager(srv, &actor)?;
    let old = srv.emojis.iter().find(|e| e.id == emoji_id).ok_or("Emoji não encontrado.")?.name.clone();
    if old == name {
        return Ok(format!("O emoji já se chama :{name}:."));
    }
    if srv.emojis.iter().any(|e| e.id != emoji_id && e.name.eq_ignore_ascii_case(&name)) {
        return Err("Já existe um emoji com esse nome neste servidor.");
    }
    let srv = st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?;
    if let Some(e) = srv.emojis.iter_mut().find(|e| e.id == emoji_id) {
        e.name = name.clone();
    }
    finish(st, server_id, &actor, "emoji_update", format!("emoji: :{old}: → :{name}:"));
    Ok(format!("Emoji renomeado para :{name}:."))
}

pub fn delete(st: &mut ServerState, uid: &str, server_id: &str, emoji_id: &str) -> Result<String, &'static str> {
    let (actor, _) = actor_of(st, uid)?;
    let srv = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
    require_manager(srv, &actor)?;
    let srv = st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?;
    let pos = srv.emojis.iter().position(|e| e.id == emoji_id).ok_or("Emoji não encontrado.")?;
    let removed = srv.emojis.remove(pos);
    finish(st, server_id, &actor, "emoji_delete", format!("emoji: :{}:", removed.name));
    Ok(format!("Emoji :{}: excluído.", removed.name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_tokens() {
        assert_eq!(clean_name(" :festa_2: "), Ok("festa_2".into()));
        assert!(clean_name("a").is_err());
        assert!(clean_name("com espaço").is_err());
        assert!(clean_name("ç_acento").is_err());
        assert!(clean_name(&"x".repeat(33)).is_err());
        let id = "0123456789abcdef0123456789abcdef";
        assert_eq!(parse_token(&format!("<:festa:{id}> resto")).map(|t| (t.0, t.2)), Some(("festa", 41)));
        assert_eq!(parse_token(&format!("<a:gif:{id}>")).map(|t| t.0), Some("gif"));
        assert!(parse_token("<:festa:123>").is_none(), "id curto");
        assert!(parse_token(&format!("<:fes ta:{id}>")).is_none());
        assert!(parse_token(&format!("<b:festa:{id}>")).is_none());
    }
}
