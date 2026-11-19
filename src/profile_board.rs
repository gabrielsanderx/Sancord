use crate::models::{
    BoardAudience, ProfileBoard, ProfileBoardView, ProfileWidgetContent, ServerMessage,
};
use crate::state::ServerState;

const MAX_WIDGETS: usize = 8;
const MAX_COVER_BYTES: u64 = 4 * 1024 * 1024;

pub fn view(
    st: &ServerState,
    viewer: &str,
    owner: &str,
    has_mutual_server: bool,
    badges: &[String],
) -> Option<ProfileBoardView> {
    let board = &st.accounts.get(owner)?.profile_board;
    let allowed = viewer == owner
        || (!st.friends_store.blocked_either(viewer, owner)
            && match board.audience {
                BoardAudience::Everyone => true,
                BoardAudience::SharedSpaces => {
                    has_mutual_server || st.friends_store.are_friends(viewer, owner)
                }
                BoardAudience::Friends => st.friends_store.are_friends(viewer, owner),
            });
    if !allowed {
        return None;
    }
    let widgets: Vec<_> = board
        .widgets
        .iter()
        .filter(|w| w.visible)
        .cloned()
        .collect();
    let achievements = if widgets
        .iter()
        .any(|w| matches!(w.content, ProfileWidgetContent::Achievements))
    {
        let mut list: Vec<String> = badges
            .iter()
            .filter(|badge| {
                matches!(
                    badge.as_str(),
                    "alpha" | "beta" | "early_user" | "event_winner" | "contributor" | "bug_hunter"
                )
            })
            .cloned()
            .collect();
        for milestone in compute_milestones(st, owner) {
            if !list.iter().any(|existing| existing == milestone) {
                list.push(milestone.to_string());
            }
        }
        list
    } else {
        Vec::new()
    };
    Some(ProfileBoardView {
        widgets,
        achievements,
    })
}

fn compute_milestones(st: &ServerState, owner_lower: &str) -> Vec<&'static str> {
    let mut out = Vec::new();
    if st
        .servers
        .iter()
        .any(|s| s.id != "sancord" && s.owner_username.eq_ignore_ascii_case(owner_lower))
    {
        out.push("milestone_first_server");
    }
    let friends = st
        .friends_store
        .friends
        .get(owner_lower)
        .map(|list| list.len())
        .unwrap_or(0);
    if friends >= 5 {
        out.push("milestone_5_friends");
    }
    let db_msgs = st
        .db
        .count_messages_by_author(owner_lower)
        .unwrap_or(0)
        .max(0) as usize;
    let mem_msgs = st
        .chat_history
        .values()
        .flat_map(|msgs| msgs.iter())
        .filter(|m| m.author_name.eq_ignore_ascii_case(owner_lower))
        .count();
    let total_msgs = db_msgs.max(mem_msgs);
    if total_msgs >= 100 {
        out.push("milestone_100_messages");
    }
    if total_msgs >= 500 {
        out.push("milestone_500_messages");
    }
    out
}

pub fn send_owner_state(st: &ServerState, uid: &str) {
    if let Some(account) = st
        .users
        .get(uid)
        .and_then(|u| st.accounts.get(&u.username.to_lowercase()))
    {
        st.send_to(
            uid,
            ServerMessage::ProfileBoardState {
                board: account.profile_board.clone(),
            },
        );
    }
}

pub fn save(st: &mut ServerState, uid: &str, mut board: ProfileBoard) -> Result<(), &'static str> {
    let lower = st
        .users
        .get(uid)
        .ok_or("Sessão inválida.")?
        .username
        .to_lowercase();
    let account = st.accounts.get(&lower).ok_or("Conta não encontrada.")?;
    if board.revision != account.profile_board.revision {
        send_owner_state(st, uid);
        return Err("O mural mudou em outra sessão. Recarregue a versão do servidor.");
    }
    validate(st, &account.id, &mut board)?;
    if account.profile_board != board {
        board.revision = board
            .revision
            .checked_add(1)
            .ok_or("Limite de revisões do mural atingido.")?;
        if let Some(account) = st.accounts.get_mut(&lower) {
            account.profile_board = board.clone();
        }
        st.save_accounts();
        for (other_uid, user) in &st.users {
            if other_uid != uid && user.username.to_lowercase() == lower {
                st.send_to(
                    other_uid,
                    ServerMessage::ProfileBoardState {
                        board: board.clone(),
                    },
                );
            }
        }
    }
    st.send_to(uid, ServerMessage::ProfileBoardSaved { board });
    Ok(())
}

fn validate(
    st: &ServerState,
    account_id: &str,
    board: &mut ProfileBoard,
) -> Result<(), &'static str> {
    if board.widgets.len() > MAX_WIDGETS {
        return Err("O mural aceita até 8 widgets.");
    }
    let mut achievements = false;
    for widget in &mut board.widgets {
        match &mut widget.content {
            ProfileWidgetContent::FavoriteGame {
                name,
                description,
                cover_id,
            } => {
                normalize(name, 60, false)?;
                normalize(description, 160, true)?;
                if let Some(id) = cover_id {
                    let attachment = crate::profile::validate_owned_image(
                        st,
                        account_id,
                        id,
                        MAX_COVER_BYTES,
                        "A capa pode ter no máximo 4 MB.",
                    )?;
                    if attachment.content_type == "image/gif" {
                        return Err("Use PNG, JPG ou WebP para a capa.");
                    }
                }
            }
            ProfileWidgetContent::Playing { name } | ProfileWidgetContent::WantToPlay { name } => {
                normalize(name, 60, false)?;
            }
            ProfileWidgetContent::About { text } => normalize(text, 400, false)?,
            ProfileWidgetContent::Link { label, url } => {
                normalize(label, 60, false)?;
                normalize(url, 500, false)?;
                let parsed =
                    reqwest::Url::parse(url).map_err(|_| "Use um link HTTP ou HTTPS válido.")?;
                if !matches!(parsed.scheme(), "https" | "http")
                    || !parsed.has_host()
                    || !parsed.username().is_empty()
                    || parsed.password().is_some()
                {
                    return Err("Use um link HTTP ou HTTPS sem credenciais.");
                }
                *url = parsed.into();
            }
            ProfileWidgetContent::Achievements => {
                if achievements {
                    return Err("O mural aceita um widget de conquistas.");
                }
                achievements = true;
            }
            ProfileWidgetContent::Custom {
                title,
                text,
                emoji,
                image_id,
            } => {
                normalize(title, 60, false)?;
                normalize(text, 300, false)?;
                if let Some(raw_emoji) = emoji.take() {
                    let clean = raw_emoji.trim();
                    if !clean.is_empty() {
                        if clean.chars().count() > 8 || clean.chars().any(|c| c.is_control()) {
                            return Err("Use até 8 caracteres no emoji do bloco personalizado.");
                        }
                        *emoji = Some(clean.to_string());
                    }
                }
                if let Some(id) = image_id {
                    let attachment = crate::profile::validate_owned_image(
                        st,
                        account_id,
                        id,
                        MAX_COVER_BYTES,
                        "A imagem do bloco pode ter no máximo 4 MB.",
                    )?;
                    if attachment.content_type == "image/gif" {
                        return Err("Use PNG, JPG ou WebP para a imagem do bloco.");
                    }
                }
            }
        }
    }
    Ok(())
}

fn normalize(text: &mut String, limit: usize, optional: bool) -> Result<(), &'static str> {
    let value = text.trim();
    if (!optional && value.is_empty())
        || value.chars().count() > limit
        || value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r')
    {
        return Err("Preencha os campos obrigatórios e respeite os limites de texto do widget.");
    }
    if value.len() != text.len() {
        *text = value.to_string();
    }
    Ok(())
}
