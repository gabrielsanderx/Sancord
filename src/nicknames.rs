//! Etapa C4 — apelido por servidor.
//!
//! Regras (iguais às do Discord): cada pessoa troca o próprio apelido se tiver
//! `change_nickname` (padrão: sim; o castigo tira). Trocar o de outra pessoa exige
//! `manage_nicknames` e que ela esteja abaixo na hierarquia; o dono pode tudo e
//! ninguém além dele mexe no apelido do dono. Apelido vazio remove.
use crate::models::ServerMessage;
use crate::state::ServerState;

pub const MAX_CHARS: usize = 32;

/// Limpa espaços e caracteres de controle; `None` = remover o apelido.
pub fn clean(raw: Option<&str>) -> Result<Option<String>, &'static str> {
    let Some(raw) = raw else { return Ok(None) };
    let text: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > MAX_CHARS {
        return Err("O apelido pode ter no máximo 32 caracteres.");
    }
    Ok(Some(text))
}

/// Define (ou remove) o apelido de `target_username` no servidor. Toda a autorização acontece aqui.
pub fn apply(
    st: &mut ServerState,
    actor_uid: &str,
    server_id: &str,
    target_username: &str,
    nickname: Option<&str>,
) -> Result<String, &'static str> {
    let actor = st
        .users
        .get(actor_uid)
        .map(|u| u.username.to_lowercase())
        .ok_or("Sessão inválida.")?;
    if server_id == "sancord" {
        return Err("O hub público não usa apelidos por servidor.");
    }
    let target = target_username.trim().trim_start_matches('@').to_lowercase();
    let nick = clean(nickname)?;
    let srv = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
    if !srv.is_member(&actor) {
        return Err("Você não é membro deste servidor.");
    }
    if !srv.is_member(&target) {
        return Err("Este usuário não é membro do servidor.");
    }
    let actor_is_owner = srv.is_owner(&actor);
    let mine = srv.effective_permissions(&actor);
    if target == actor {
        // O castigo vale por canal (`channel_permissions`); aqui ele é conferido à parte.
        // Dono e administradores nunca ficam de castigo.
        if !actor_is_owner && !mine.administrator && srv.timeout_until(&actor, crate::auth::now_ms()).is_some() {
            return Err("Você está de castigo e não pode mudar o apelido agora.");
        }
        if !actor_is_owner && !mine.change_nickname && !mine.manage_nicknames {
            return Err("Você não tem permissão para mudar o próprio apelido aqui.");
        }
    } else {
        if !actor_is_owner && !mine.manage_nicknames {
            return Err("Você não tem permissão para gerenciar apelidos.");
        }
        if srv.is_owner(&target) {
            return Err("Só o dono pode mudar o apelido do dono.");
        }
        if !actor_is_owner && srv.highest_position(&target) >= srv.highest_position(&actor) {
            return Err("Você só pode mudar o apelido de membros abaixo da sua hierarquia.");
        }
    }
    let target_name = st
        .accounts
        .get(&target)
        .map(|a| a.username.clone())
        .unwrap_or_else(|| target.clone());

    let srv = st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?;
    let previous = srv.member_nicks.get(&target).cloned();
    if previous == nick {
        return Ok(match &nick {
            Some(n) => format!("O apelido já é \"{n}\"."),
            None => "Não há apelido para remover.".to_string(),
        });
    }
    match &nick {
        Some(n) => {
            srv.member_nicks.insert(target.clone(), n.clone());
        }
        None => {
            srv.member_nicks.remove(&target);
        }
    }
    let updated = srv.clone();
    st.save_servers();
    let details = Some(match (&previous, &nick) {
        (_, Some(n)) => format!("apelido: {n}"),
        (Some(p), None) => format!("apelido removido (era {p})"),
        (None, None) => "apelido removido".to_string(),
    });
    crate::moderation::audit(st, server_id, &actor, "member_nick", Some(&target), details);
    st.broadcast_to_server(server_id, ServerMessage::ServerUpdated { server: updated });
    let whose = if target == actor { "Seu apelido".to_string() } else { format!("O apelido de {target_name}") };
    Ok(match nick {
        Some(n) => format!("{whose} agora é \"{n}\"."),
        None => format!("{whose} foi removido."),
    })
}
