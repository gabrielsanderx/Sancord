//! Castigo (timeout) de membros — seções 35/36 da especificação e fluxo F.
//!
//! Enquanto o castigo vale, o membro continua vendo e lendo os canais, mas não
//! envia, não reage, não anexa, não fixa e não usa voz. A restrição mora em
//! `GuildServer::channel_permissions`, então todos os handlers que já conferem
//! permissão passam a respeitá-la, e ela termina sozinha no horário marcado.
//! O laço de expiração só limpa o registro e avisa os clientes.
use crate::db::WriteOp;
use crate::models::ServerMessage;
use crate::state::{ServerState, SharedState};

/// Mesmo teto adotado por outros mensageiros: 28 dias.
pub const MAX_SECS: u64 = 28 * 24 * 60 * 60;
const MAX_REASON_CHARS: usize = 300;

/// "5 minutos", "1 hora", "2 dias"... para as respostas e a auditoria.
pub fn describe_duration(secs: u64) -> String {
    let (n, one, many) = if secs % 86_400 == 0 {
        (secs / 86_400, "dia", "dias")
    } else if secs % 3_600 == 0 {
        (secs / 3_600, "hora", "horas")
    } else if secs % 60 == 0 {
        (secs / 60, "minuto", "minutos")
    } else {
        (secs, "segundo", "segundos")
    };
    format!("{n} {}", if n == 1 { one } else { many })
}

/// Tempo restante arredondado para cima ("3 minutos", "2 horas", "5 dias").
pub fn describe_remaining(ms: i64) -> String {
    let mins = ((ms.max(0) + 59_999) / 60_000) as u64;
    let secs = if mins >= 48 * 60 {
        mins.div_ceil(24 * 60) * 86_400
    } else if mins >= 120 {
        mins.div_ceil(60) * 3_600
    } else {
        mins.max(1) * 60
    };
    describe_duration(secs)
}

/// Aplica (`duration_secs` > 0) ou remove (0) o castigo. Devolve o texto de
/// confirmação para quem moderou. Toda a autorização acontece aqui.
pub fn apply(
    st: &mut ServerState,
    actor_uid: &str,
    server_id: &str,
    target_username: &str,
    duration_secs: u64,
    reason: Option<&str>,
    now: i64,
) -> Result<String, &'static str> {
    let actor_lower = st
        .users
        .get(actor_uid)
        .map(|u| u.username.to_lowercase())
        .ok_or("Sessão inválida.")?;
    let target = target_username.trim().to_lowercase();
    if server_id == "sancord" {
        return Err("O hub público não usa castigo de membros.");
    }
    let srv = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
    if !srv.is_member(&actor_lower) {
        return Err("Você não é membro deste servidor.");
    }
    let actor_is_owner = srv.is_owner(&actor_lower);
    if !actor_is_owner && !srv.effective_permissions(&actor_lower).moderate_members {
        return Err("Você não tem permissão para aplicar castigo.");
    }
    if !srv.is_member(&target) {
        return Err("Este usuário não é membro do servidor.");
    }
    if target == actor_lower {
        return Err("Você não pode aplicar castigo em si mesmo.");
    }
    if srv.is_owner(&target) || srv.effective_permissions(&target).administrator {
        return Err("O dono e os administradores não podem receber castigo.");
    }
    if !actor_is_owner && srv.highest_position(&target) >= srv.highest_position(&actor_lower) {
        return Err("Você só pode aplicar castigo em membros abaixo da sua hierarquia.");
    }
    if duration_secs > MAX_SECS {
        return Err("O castigo pode durar no máximo 28 dias.");
    }
    let reason: Option<String> = reason
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(|r| r.chars().take(MAX_REASON_CHARS).collect());
    let target_name = st
        .accounts
        .get(&target)
        .map(|a| a.username.clone())
        .unwrap_or_else(|| target.clone());

    let until = (duration_secs > 0).then(|| now + duration_secs as i64 * 1000);
    let srv = st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?;
    match until {
        Some(until) => {
            srv.member_timeouts.insert(target.clone(), until);
        }
        None => {
            if srv.member_timeouts.remove(&target).filter(|u| *u > now).is_none() {
                return Err("Este membro não está de castigo.");
            }
        }
    }
    let updated = srv.clone();
    st.db.write(WriteOp::SetMemberTimeout {
        server_id: server_id.to_string(),
        user_lower: target.clone(),
        until_ms: until,
    });

    let mut details = until.map(|_| format!("duração: {}", describe_duration(duration_secs)));
    if let Some(r) = &reason {
        details = Some(match details {
            Some(d) => format!("{d}; motivo: {r}"),
            None => format!("motivo: {r}"),
        });
    }
    let action = if until.is_some() { "member_timeout" } else { "member_timeout_removed" };
    crate::moderation::audit(st, server_id, &actor_lower, action, Some(&target), details);

    // Cada destinatário recebe o servidor com as próprias permissões recalculadas.
    st.broadcast_to_server(server_id, ServerMessage::ServerUpdated { server: updated });
    // Quem estava na voz deste servidor é desconectado (connect_voice caiu).
    st.enforce_voice_access();
    st.refresh_voice_grants();

    Ok(match until {
        Some(_) => format!("{target_name} está de castigo por {}.", describe_duration(duration_secs)),
        None => format!("O castigo de {target_name} foi removido."),
    })
}

/// Retira do estado e do banco os castigos vencidos e avisa os servidores afetados.
/// Chamado pelo laço periódico do servidor (a permissão em si já voltou pelo relógio).
pub fn clear_expired(st: &mut ServerState, now: i64) -> Vec<String> {
    let mut touched = Vec::new();
    let mut expired = Vec::new();
    for srv in st.servers.iter_mut() {
        let gone: Vec<String> = srv
            .member_timeouts
            .iter()
            .filter(|(_, until)| **until <= now)
            .map(|(user, _)| user.clone())
            .collect();
        if gone.is_empty() {
            continue;
        }
        for user in gone {
            srv.member_timeouts.remove(&user);
            expired.push((srv.id.clone(), user));
        }
        touched.push(srv.id.clone());
    }
    for (server_id, user_lower) in expired {
        st.db.write(WriteOp::SetMemberTimeout { server_id, user_lower, until_ms: None });
    }
    for sid in &touched {
        if let Some(server) = st.find_server(sid).cloned() {
            st.broadcast_to_server(sid, ServerMessage::ServerUpdated { server });
        }
    }
    if !touched.is_empty() {
        st.refresh_voice_grants();
    }
    touched
}

pub async fn expire(state: &SharedState) {
    let mut st = state.write().await;
    clear_expired(&mut st, crate::auth::now_ms());
}
