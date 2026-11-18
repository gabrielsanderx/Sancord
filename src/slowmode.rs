//! Modo lento por canal (seção 36 da especificação).
//!
//! O intervalo fica no canal (`Channel::slowmode_secs`) e vale também para as
//! threads e postagens de fórum dele. O servidor guarda, só em memória, o horário
//! da última mensagem aceita de cada pessoa em cada canal: depois de um reinício
//! todo mundo pode falar de novo, o que é aceitável para um limite de ritmo.
use crate::state::{ServerState, SharedState};

/// Teto adotado por outros mensageiros: 6 horas.
pub const MAX_SECS: u32 = 6 * 60 * 60;

/// Quanto falta (ms) para poder enviar de novo, ou `None` se já pode.
pub fn remaining(last_ms: Option<i64>, slowmode_secs: u32, now: i64) -> Option<i64> {
    let last = last_ms?;
    let wait = last + i64::from(slowmode_secs) * 1000 - now;
    (slowmode_secs > 0 && wait > 0).then_some(wait)
}

/// "12 segundos", "3 minutos", "2 horas" — sempre arredondado para cima.
pub fn describe_wait(ms: i64) -> String {
    let secs = (ms.max(0) + 999) / 1000;
    let (n, one, many) = if secs < 60 {
        (secs.max(1), "segundo", "segundos")
    } else if secs < 2 * 60 * 60 {
        ((secs + 59) / 60, "minuto", "minutos")
    } else {
        ((secs + 3599) / 3600, "hora", "horas")
    };
    format!("{n} {}", if n == 1 { one } else { many })
}

/// Esquece registros mais velhos que o maior intervalo possível.
pub fn prune(st: &mut ServerState, now: i64) {
    let horizon = now - i64::from(MAX_SECS) * 1000;
    st.slowmode_last.retain(|_, last| *last > horizon);
}

pub async fn prune_shared(state: &SharedState) {
    let mut st = state.write().await;
    prune(&mut st, crate::auth::now_ms());
}
