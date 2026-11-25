//! Perfil — Fase P1: mídia do perfil (avatar/banner) e regras do tema.
//!
//! Avatar e banner deixam de ser data-URL dentro da conta: a imagem sobe como anexo
//! (`POST /api/attachments`, tipo detectado pelos bytes) e a conta guarda só o caminho
//! `/api/attachments/{id}/{nome}`. O ID muda a cada troca, então o cache dos clientes
//! (servido como imutável) nunca mostra a imagem antiga, e a difusão do perfil fica leve.
//! Data-URLs antigas continuam válidas até a pessoa trocar a imagem.
use crate::models::{ServerMemberProfile, ServerMessage, ServerProfileChanges, ServerProfileImage};
use crate::state::ServerState;

pub const MAX_AVATAR_BYTES: u64 = 6 * 1024 * 1024;
pub const MAX_BANNER_BYTES: u64 = 8 * 1024 * 1024;
pub const BIO_MAX_CHARS: usize = 300;
pub const THEME_MODES: [&str; 2] = ["solid", "gradient"];
pub const THEME_DIRECTIONS: [&str; 4] = ["vertical", "horizontal", "diagonal", "radial"];

/// `Some(None)` limpa (texto vazio); `Some(Some(v))` grava; `None` mantém
/// (campo ausente ou valor fora da lista, que é ignorado em vez de apagar o atual).
pub fn clean_choice(input: Option<String>, allowed: &[&str]) -> Option<Option<String>> {
    let v = input?.trim().to_lowercase();
    if v.is_empty() {
        return Some(None);
    }
    allowed.contains(&v.as_str()).then_some(Some(v))
}

/// Avatar ou banner. Toda a autorização acontece aqui.
pub fn set_media(st: &mut ServerState, uid: &str, kind: &str, attachment_id: Option<&str>) -> Result<&'static str, &'static str> {
    let lower = st.users.get(uid).map(|u| u.username.to_lowercase()).ok_or("Sessão inválida.")?;
    let account_id = &st.accounts.get(&lower).ok_or("Conta não encontrada.")?.id;
    let avatar = match kind {
        "avatar" => true,
        "banner" => false,
        _ => return Err("Tipo de imagem de perfil inválido."),
    };
    let image = validated_image(st, account_id, avatar, attachment_id.unwrap_or_default())?;
    let animated = image.as_ref().is_some_and(|image| image.animated);
    let url = image.map(|image| image.url);
    let apply = |avatar_url: &mut Option<String>, banner_url: &mut Option<String>, p: &mut crate::models::ProfileExtras| {
        if avatar {
            *avatar_url = url.clone();
            p.avatar_animated = animated;
        } else {
            *banner_url = url.clone();
            p.banner_animated = animated;
        }
    };
    for u in st.users.values_mut().filter(|u| u.username.to_lowercase() == lower) {
        apply(&mut u.avatar_url, &mut u.banner_url, &mut u.profile);
    }
    if let Some(acc) = st.accounts.get_mut(&lower) {
        apply(&mut acc.avatar_url, &mut acc.banner_url, &mut acc.profile);
    }
    if avatar {
        st.sync_author_messages(&lower);
    }
    st.save_accounts();
    broadcast_profile(st);
    Ok(match (avatar, url.is_some()) {
        (true, true) => "Avatar atualizado.",
        (true, false) => "Avatar removido.",
        (false, true) => "Banner atualizado.",
        (false, false) => "Banner removido.",
    })
}

fn validated_image(st: &ServerState, account_id: &str, avatar: bool, id: &str) -> Result<Option<ServerProfileImage>, &'static str> {
    let id = id.trim();
    if id.is_empty() {
        return Ok(None);
    }
    let (limit, size_error) = if avatar {
        (MAX_AVATAR_BYTES, "O avatar pode ter no máximo 6 MB.")
    } else {
        (MAX_BANNER_BYTES, "O banner pode ter no máximo 8 MB.")
    };
    let att = validate_owned_image(st, account_id, id, limit, size_error)?;
    Ok(Some(ServerProfileImage { url: att.to_public().url, animated: att.content_type == "image/gif" }))
}

pub(crate) fn validate_owned_image<'a>(
    st: &'a ServerState,
    account_id: &str,
    id: &str,
    limit: u64,
    size_error: &'static str,
) -> Result<&'a crate::db::AttachmentRecord, &'static str> {
    let att = st.attachments.get(id).ok_or("Imagem não encontrada. Envie de novo.")?;
    if att.uploader_id != account_id {
        return Err("Use uma imagem enviada por você.");
    }
    if !matches!(att.content_type.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif") {
        return Err("Use PNG, JPG, WebP ou GIF.");
    }
    if att.size > limit {
        return Err(size_error);
    }
    if att.width.zip(att.height).is_some_and(|(w, h)| {
        w == 0 || h == 0 || w > 4096 || h > 4096 || u64::from(w) * u64::from(h) > 8_388_608
    }) {
        return Err("Use uma imagem com até 4096 pixels por lado e 8 milhões de pixels no total.");
    }
    Ok(att)
}

fn clean_hex_color(input: &str) -> Result<Option<String>, &'static str> {
    let color = input.trim();
    if color.is_empty() {
        return Ok(None);
    }
    if crate::validate::is_hex_color(color) {
        Ok(Some(color.to_ascii_lowercase()))
    } else {
        Err("Cor inválida. Use um código hexadecimal como #5865f2.")
    }
}

fn clean_choice_strict(input: &str, allowed: &[&str], err: &'static str) -> Result<Option<String>, &'static str> {
    let val = input.trim().to_ascii_lowercase();
    if val.is_empty() {
        return Ok(None);
    }
    if allowed.contains(&val.as_str()) {
        Ok(Some(val))
    } else {
        Err(err)
    }
}

pub fn set_server_profile(
    st: &mut ServerState,
    uid: &str,
    server_id: &str,
    changes: ServerProfileChanges,
) -> Result<(), &'static str> {
    if server_id == "sancord" {
        return Err("O hub público usa o perfil global.");
    }
    let lower = st.users.get(uid).map(|u| u.username.to_lowercase()).ok_or("Sessão inválida.")?;
    let server = st.find_server(server_id).ok_or("Servidor não encontrado.")?;
    if !server.is_member(&lower) {
        return Err("Você não é membro deste servidor.");
    }
    let account = st.accounts.get(&lower).ok_or("Conta não encontrada.")?;
    let previous = server.member_profiles.get(&lower).cloned().unwrap_or_default();
    let mut profile = previous.clone();
    if let Some(id) = changes.avatar_attachment_id {
        profile.avatar = validated_image(st, &account.id, true, &id)?;
    }
    if let Some(id) = changes.banner_attachment_id {
        profile.banner = validated_image(st, &account.id, false, &id)?;
    }
    if let Some(bio) = changes.bio {
        let bio = bio.trim();
        if bio.chars().count() > BIO_MAX_CHARS {
            return Err("A bio pode ter no máximo 300 caracteres.");
        }
        profile.bio = (!bio.is_empty()).then(|| bio.to_string());
    }
    if let Some(raw) = changes.avatar_decoration {
        profile.avatar_decoration = crate::cosmetics::check_equip(account, crate::cosmetics::Kind::AvatarDecoration, &raw)?;
    }
    if let Some(raw) = changes.profile_frame {
        profile.profile_frame = crate::cosmetics::check_equip(account, crate::cosmetics::Kind::ProfileFrame, &raw)?;
    }
    if let Some(raw) = changes.profile_effect {
        profile.profile_effect = crate::cosmetics::check_equip(account, crate::cosmetics::Kind::ProfileEffect, &raw)?;
    }
    if let Some(raw) = changes.nameplate_style {
        profile.nameplate_style = crate::cosmetics::check_equip(account, crate::cosmetics::Kind::Nameplate, &raw)?;
    }
    if let Some(raw) = changes.name_style {
        profile.name_style = crate::cosmetics::check_equip(account, crate::cosmetics::Kind::NameStyle, &raw)?;
    }
    if let Some(raw) = changes.name_color {
        profile.name_color = clean_hex_color(&raw)?;
    }
    if let Some(raw) = changes.name_color_secondary {
        profile.name_color_secondary = clean_hex_color(&raw)?;
    }
    if let Some(raw) = changes.name_gradient_direction {
        profile.name_gradient_direction = clean_choice_strict(&raw, &THEME_DIRECTIONS, "Direção de gradiente do nome inválida.")?;
    }
    if let Some(raw) = changes.theme_primary {
        profile.theme_primary = clean_hex_color(&raw)?;
    }
    if let Some(raw) = changes.theme_accent {
        profile.theme_accent = clean_hex_color(&raw)?;
    }
    if let Some(raw) = changes.theme_highlight {
        profile.theme_highlight = clean_hex_color(&raw)?;
    }
    if let Some(raw) = changes.theme_mode {
        profile.theme_mode = clean_choice_strict(&raw, &THEME_MODES, "Modo de tema inválido.")?;
    }
    if let Some(raw) = changes.theme_direction {
        profile.theme_direction = clean_choice_strict(&raw, &THEME_DIRECTIONS, "Direção de gradiente do tema inválida.")?;
    }
    if previous == profile {
        return Ok(());
    }
    let server = st.find_server_mut(server_id).ok_or("Servidor não encontrado.")?;
    let profile = if profile == ServerMemberProfile::default() {
        server.member_profiles.remove(&lower);
        None
    } else {
        server.member_profiles.insert(lower.clone(), profile.clone());
        Some(profile)
    };
    st.save_servers();
    st.broadcast_to_server(server_id, ServerMessage::ServerProfileUpdated {
        server_id: server_id.to_string(),
        username: lower,
        profile,
    });
    Ok(())
}

/// Avisa todos os clientes (lista de usuários) e as listas de amigos — o mesmo
/// caminho usado pelas outras mudanças de perfil.
pub fn broadcast_profile(st: &ServerState) {
    let sync = ServerMessage::VoiceStateSync { voice_members: st.voice_members_map(), users: st.users_list() };
    st.broadcast(sync);
    st.broadcast_friends_sync_all();
}

/// Envia o catálogo e a posse para todas as conexões da conta.
pub fn send_cosmetics(st: &ServerState, lower: &str) {
    let Some(acc) = st.accounts.get(lower) else { return };
    let msg = cosmetics_state(acc);
    for (uid, u) in &st.users {
        if u.username.to_lowercase() == lower {
            st.send_to(uid, msg.clone());
        }
    }
}

pub fn cosmetics_state(acc: &crate::models::Account) -> ServerMessage {
    ServerMessage::CosmeticsState {
        catalog: crate::cosmetics::catalog().to_vec(),
        owned: crate::cosmetics::owned_keys(acc),
        badges: crate::cosmetics::BADGES.to_vec(),
        owned_badges: crate::cosmetics::account_owned_badges(acc).to_vec(),
        badge_order: acc.badge_order.clone(),
        hidden_badges: acc.hidden_badges.clone(),
        max_visible_badges: crate::cosmetics::MAX_VISIBLE_BADGES,
        collection: acc.cosmetic_collection.clone(),
    }
}

pub fn send_badge_admin_state(st: &ServerState, uid: &str) {
    let can_manage = st
        .users
        .get(uid)
        .and_then(|u| st.accounts.get(&u.username.to_lowercase()))
        .is_some_and(crate::cosmetics::is_badge_operator);
    if !can_manage {
        st.send_to(
            uid,
            ServerMessage::BadgeAdminState {
                can_manage: false,
                grants: std::collections::HashMap::new(),
                accounts: Vec::new(),
            },
        );
        return;
    }
    let mut accounts: Vec<String> = st.accounts.values().map(|a| a.username.clone()).collect();
    accounts.sort_by_key(|a| a.to_lowercase());
    st.send_to(
        uid,
        ServerMessage::BadgeAdminState {
            can_manage: true,
            grants: st.badge_grants.clone(),
            accounts,
        },
    );
}

pub fn set_user_badges(
    st: &mut ServerState,
    uid: &str,
    target_username: &str,
    badges: Vec<String>,
) -> Result<(), &'static str> {
    let caller_lower = st
        .users
        .get(uid)
        .map(|u| u.username.to_lowercase())
        .ok_or("Sessão inválida.")?;
    let caller_ok = st
        .accounts
        .get(&caller_lower)
        .is_some_and(crate::cosmetics::is_badge_operator);
    if !caller_ok {
        return Err("Apenas operadores autorizados podem gerenciar selos.");
    }
    let target_lower = target_username.trim().to_lowercase();
    if target_lower.is_empty() || !st.accounts.contains_key(&target_lower) {
        return Err("Conta de destino não encontrada.");
    }
    let mut validated: Vec<String> = Vec::new();
    for raw in badges {
        let id = raw.trim();
        if id.is_empty() {
            continue;
        }
        let Some(def) = crate::cosmetics::badge(id) else {
            return Err("Selo desconhecido.");
        };
        if !validated.iter().any(|existing| existing == def.id) {
            validated.push(def.id.to_string());
        }
    }
    // Preserva ordem canônica de BADGES.
    let ordered: Vec<String> = crate::cosmetics::BADGES
        .iter()
        .filter(|b| validated.iter().any(|id| id == b.id))
        .map(|b| b.id.to_string())
        .collect();

    // Evita remover o último operador do sistema por engano.
    let keeps_operator = ordered
        .iter()
        .any(|b| matches!(b.as_str(), "founder" | "developer"));
    if target_lower == caller_lower && !keeps_operator {
        let other_operator_exists = st.accounts.iter().any(|(k, acc)| {
            k != &caller_lower && crate::cosmetics::is_badge_operator(acc)
        });
        if !other_operator_exists {
            return Err("Mantenha pelo menos um operador com selo Fundador ou Desenvolvedor.");
        }
    }

    let mut next_grants = st.badge_grants.clone();
    if ordered.is_empty() {
        next_grants.remove(&target_lower);
    } else {
        next_grants.insert(target_lower.clone(), ordered.clone());
    }
    crate::cosmetics::save_badge_grants(&st.config.data_dir, &next_grants)
        .map_err(|_| "Não foi possível salvar badges.json no servidor.")?;
    st.badge_grants = next_grants;

    let effective = if let Some(acc) = st.accounts.get_mut(&target_lower) {
        crate::cosmetics::sync_account_badges(acc, &ordered);
        acc.profile.badges.clone()
    } else {
        Vec::new()
    };
    let mut updated_sessions: Vec<(String, crate::models::UserInfo)> = Vec::new();
    for (sess_id, user) in st.users.iter_mut() {
        if user.username.to_lowercase() == target_lower {
            user.profile.badges = effective.clone();
            updated_sessions.push((sess_id.clone(), user.clone()));
        }
    }
    st.save_accounts();
    for (sess_id, user) in updated_sessions {
        st.send_to(&sess_id, ServerMessage::SelfUpdated { user });
    }
    send_cosmetics(st, &target_lower);
    broadcast_profile(st);
    crate::profile_sharing::refresh_viewers(st, &target_lower);
    send_badge_admin_state(st, uid);
    Ok(())
}
