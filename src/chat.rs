//! Regras de chat independentes de rede/estado (fáceis de testar):
//! - detecção de menções no texto;
//! - validação de emoji de reação;
//! - limitador de ritmo por conexão (anti-spam básico).

use crate::models::MessageMentions;
use std::collections::VecDeque;

/// Candidato a menção de usuário: (username_lower, nome exibido).
pub struct MentionUser<'a> {
    pub lower: &'a str,
    pub display: &'a str,
}

/// Candidato a menção de cargo.
pub struct MentionRole<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub mentionable: bool,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// Encontra `@Nome` no texto. Nomes podem ter espaços ("finin pacman"), então
/// testamos os candidatos do maior para o menor e exigimos fronteira de
/// palavra depois do nome. Ignora trechos em código (`...` e ```...```).
pub fn parse_mentions(
    content: &str,
    users: &[MentionUser],
    roles: &[MentionRole],
    can_mention_everyone: bool,
) -> MessageMentions {
    let text = strip_code(content);
    let lower = text.to_lowercase();
    let mut out = MessageMentions::default();

    let mut user_cands: Vec<&MentionUser> = users.iter().collect();
    user_cands.sort_by_key(|u| std::cmp::Reverse(u.display.chars().count()));
    let mut role_cands: Vec<&MentionRole> = roles
        .iter()
        .filter(|r| r.id != "everyone" && (r.mentionable || can_mention_everyone))
        .collect();
    role_cands.sort_by_key(|r| std::cmp::Reverse(r.name.chars().count()));

    let chars: Vec<(usize, char)> = lower.char_indices().collect();
    for (pos, (byte_idx, ch)) in chars.iter().enumerate() {
        if *ch != '@' {
            continue;
        }
        // "@" precisa estar no início ou depois de algo que não seja letra (evita e-mails).
        if pos > 0 && is_word_char(chars[pos - 1].1) {
            continue;
        }
        let rest = &lower[byte_idx + 1..];
        let boundary_ok = |len: usize| rest[len..].chars().next().map_or(true, |c| !is_word_char(c));

        if rest.starts_with("everyone") && boundary_ok(8) {
            if can_mention_everyone {
                out.everyone = true;
            }
            continue;
        }
        if rest.starts_with("online") && boundary_ok(6) {
            if can_mention_everyone {
                out.online = true;
            }
            continue;
        }
        if let Some(u) = user_cands.iter().find(|u| {
            let name = u.display.to_lowercase();
            rest.starts_with(&name) && boundary_ok(name.len())
        }) {
            if !out.users.iter().any(|x| x == u.lower) {
                out.users.push(u.lower.to_string());
            }
            continue;
        }
        if let Some(r) = role_cands.iter().find(|r| {
            let name = r.name.to_lowercase();
            rest.starts_with(&name) && boundary_ok(name.len())
        }) {
            if !out.roles.iter().any(|x| x == r.id) {
                out.roles.push(r.id.to_string());
            }
        }
    }
    out
}

/// Remove blocos de código para não gerar menções dentro deles.
fn strip_code(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_block = false;
    let mut in_inline = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '`' {
            if chars.peek() == Some(&'`') {
                let mut n = 1;
                while chars.peek() == Some(&'`') {
                    chars.next();
                    n += 1;
                }
                if n >= 3 {
                    in_block = !in_block;
                }
                out.push(' ');
                continue;
            }
            if !in_block {
                in_inline = !in_inline;
            }
            out.push(' ');
            continue;
        }
        out.push(if in_block || in_inline { ' ' } else { c });
    }
    out
}

/// Reação válida: emoji Unicode curto (sem letras/dígitos ASCII nem marcação).
pub fn clean_reaction(raw: &str) -> Option<String> {
    let e = raw.trim();
    let count = e.chars().count();
    if count == 0 || count > 10 || e.len() > 32 {
        return None;
    }
    if e.chars().any(|c| c.is_ascii_alphanumeric() || c.is_whitespace() || c.is_control() || "<>\"'&`".contains(c)) {
        return None;
    }
    // Pelo menos um caractere fora do ASCII (os emojis são todos não-ASCII).
    if e.is_ascii() {
        return None;
    }
    Some(e.to_string())
}

/// Janela deslizante: no máximo `max` eventos em `window_ms`.
#[derive(Debug, Default)]
pub struct SlidingWindow {
    times: VecDeque<i64>,
}

impl SlidingWindow {
    pub fn allow(&mut self, now: i64, max: usize, window_ms: i64) -> bool {
        while self.times.front().is_some_and(|t| now - *t >= window_ms) {
            self.times.pop_front();
        }
        if self.times.len() >= max {
            return false;
        }
        self.times.push_back(now);
        true
    }
}

/// Limites por conexão. Valores pensados para conversa normal não esbarrar.
#[derive(Debug, Default)]
pub struct ConnRate {
    pub messages: SlidingWindow,
    pub reactions: SlidingWindow,
    pub typing_last: i64,
}

impl ConnRate {
    pub fn allow_message(&mut self, now: i64) -> bool {
        self.messages.allow(now, 8, 5_000)
    }
    pub fn allow_reaction(&mut self, now: i64) -> bool {
        self.reactions.allow(now, 15, 5_000)
    }
    /// "Digitando" é reenviado pelo cliente a cada ~2 s; mais que isso é descartado.
    pub fn allow_typing(&mut self, now: i64) -> bool {
        if now - self.typing_last < 1_500 {
            return false;
        }
        self.typing_last = now;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn users() -> Vec<MentionUser<'static>> {
        vec![
            MentionUser { lower: "ana", display: "Ana" },
            MentionUser { lower: "ana paula", display: "Ana Paula" },
            MentionUser { lower: "joao", display: "Joao" },
        ]
    }

    #[test]
    fn mentions_users_with_spaces_and_longest_match() {
        let m = parse_mentions("oi @Ana Paula e @joao!", &users(), &[], false);
        assert_eq!(m.users, vec!["ana paula", "joao"]);
        let m = parse_mentions("@ana, tudo bem?", &users(), &[], false);
        assert_eq!(m.users, vec!["ana"]);
    }

    #[test]
    fn ignores_emails_partial_names_and_code() {
        let m = parse_mentions("mande para x@ana.com", &users(), &[], false);
        assert!(m.users.is_empty());
        let m = parse_mentions("@anabela não existe", &users(), &[], false);
        assert!(m.users.is_empty());
        let m = parse_mentions("`@ana` e ```\n@joao\n```", &users(), &[], false);
        assert!(m.users.is_empty());
    }

    #[test]
    fn everyone_and_roles_respect_permissions() {
        let roles = [
            MentionRole { id: "r1", name: "Moderador", mentionable: true },
            MentionRole { id: "r2", name: "Staff", mentionable: false },
        ];
        let m = parse_mentions("@everyone @online @Moderador @Staff", &users(), &roles, false);
        assert!(!m.everyone && !m.online);
        assert_eq!(m.roles, vec!["r1"]);
        let m = parse_mentions("@everyone @online @Staff", &users(), &roles, true);
        assert!(m.everyone && m.online);
        assert_eq!(m.roles, vec!["r2"]);
    }

    #[test]
    fn reactions_only_accept_emoji() {
        assert_eq!(clean_reaction("👍").as_deref(), Some("👍"));
        assert_eq!(clean_reaction("❤️").as_deref(), Some("❤️"));
        assert_eq!(clean_reaction("👨‍👩‍👧").as_deref(), Some("👨‍👩‍👧"));
        assert!(clean_reaction("lol").is_none());
        assert!(clean_reaction("<b>").is_none());
        assert!(clean_reaction("").is_none());
        assert!(clean_reaction(":)").is_none());
    }

    #[test]
    fn rate_limits() {
        let mut r = ConnRate::default();
        for i in 0..8 {
            assert!(r.allow_message(1000 + i));
        }
        assert!(!r.allow_message(1010));
        assert!(r.allow_message(6100), "janela liberou");
        assert!(r.allow_typing(0 + 2000));
        assert!(!r.allow_typing(2500));
        assert!(r.allow_typing(4000));
    }
}
