use crate::cosmetics::{self, Kind};
use crate::models::{
    Account, ClientMessage, ProfileAppearance, ProfileLookChoice, ProfilePreset, ServerMessage,
};
use crate::state::ServerState;

const MAX_PRESETS: usize = 12;

pub fn handle(st: &mut ServerState, uid: &str, message: ClientMessage) -> Result<(), &'static str> {
    let lower = st
        .users
        .get(uid)
        .ok_or("Sessão inválida.")?
        .username
        .to_lowercase();
    let account = st.accounts.get_mut(&lower).ok_or("Conta não encontrada.")?;
    let (changed, feedback) = match message {
        ClientMessage::SetCosmeticFavorite { key, favorite } => {
            let favorites = &account.cosmetic_collection.favorites;
            let position = favorites.iter().position(|value| value == &key);
            match (favorite, position) {
                (true, None) => {
                    check_owned_key(account, &key)?;
                    account.cosmetic_collection.favorites.push(key);
                }
                (false, Some(index)) => {
                    account.cosmetic_collection.favorites.remove(index);
                }
                _ => return Ok(()),
            }
            (true, None)
        }
        ClientMessage::MarkCosmeticsSeen { key } => {
            let keys = if let Some(key) = key {
                check_owned_key(account, &key)?;
                vec![key]
            } else {
                cosmetics::owned_keys(account)
            };
            let seen = &mut account.cosmetic_collection.seen;
            let before = seen.len();
            for key in keys {
                if !seen.contains(&key) {
                    seen.push(key);
                }
            }
            (seen.len() != before, None)
        }
        ClientMessage::SaveProfilePreset { name, appearance } => {
            let name = name.trim();
            if name.is_empty() || name.chars().count() > 32 || name.chars().any(char::is_control) {
                return Err("Use um nome de preset de 1 a 32 caracteres.");
            }
            let presets = &account.cosmetic_collection.presets;
            if presets.len() >= MAX_PRESETS {
                return Err("Você pode guardar até 12 presets.");
            }
            let name_lower = name.to_lowercase();
            if presets
                .iter()
                .any(|preset| preset.name.to_lowercase() == name_lower)
            {
                return Err("Já existe um preset com esse nome.");
            }
            let appearance = validate_appearance(account, appearance)?;
            account.cosmetic_collection.presets.push(ProfilePreset {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.to_string(),
                appearance,
            });
            (true, Some("Preset salvo."))
        }
        ClientMessage::DeleteProfilePreset { id } => {
            let presets = &mut account.cosmetic_collection.presets;
            let index = presets
                .iter()
                .position(|preset| preset.id == id)
                .ok_or("Preset não encontrado.")?;
            presets.remove(index);
            (true, Some("Preset removido."))
        }
        ClientMessage::EquipProfileLook { choice } => {
            let appearance = match choice {
                ProfileLookChoice::Preset { id } => account
                    .cosmetic_collection
                    .presets
                    .iter()
                    .find(|preset| preset.id == id)
                    .ok_or("Preset não encontrado.")?
                    .appearance
                    .clone(),
                ProfileLookChoice::Custom { appearance } => appearance,
            };
            let appearance = validate_appearance(account, appearance)?;
            equip_appearance(st, uid, &lower, appearance);
            return Ok(());
        }
        _ => unreachable!("mensagem de outra área encaminhada para Minha Coleção"),
    };
    if changed {
        st.save_accounts();
        let resolved = st.accounts.get(&lower).ok_or("Conta não encontrada.")?;
        let update = ServerMessage::CosmeticCollectionUpdated {
            collection: resolved.cosmetic_collection.clone(),
        };
        for (id, user) in &st.users {
            if user.username.to_lowercase() == lower {
                st.send_to(id, update.clone());
            }
        }
    }
    if let Some(text) = feedback {
        st.feedback(uid, true, "cosmetic_collection", text);
    }
    Ok(())
}

fn check_owned_key(account: &Account, key: &str) -> Result<(), &'static str> {
    if cosmetics::owns_key(account, key) {
        Ok(())
    } else {
        Err("Este item não está disponível na sua coleção.")
    }
}

fn validate_appearance(
    account: &Account,
    mut appearance: ProfileAppearance,
) -> Result<ProfileAppearance, &'static str> {
    for (value, kind) in [
        (&mut appearance.avatar_decoration, Kind::AvatarDecoration),
        (&mut appearance.profile_frame, Kind::ProfileFrame),
        (&mut appearance.profile_effect, Kind::ProfileEffect),
        (&mut appearance.nameplate_style, Kind::Nameplate),
        (&mut appearance.name_style, Kind::NameStyle),
    ] {
        *value = cosmetics::check_equip(account, kind, value.as_deref().unwrap_or_default())?;
    }
    for color in [
        &mut appearance.theme_primary,
        &mut appearance.theme_accent,
        &mut appearance.theme_highlight,
        &mut appearance.name_color,
        &mut appearance.name_color_secondary,
    ] {
        if let Some(value) = color {
            let value = value.trim();
            if value.is_empty() {
                *color = None;
            } else if crate::validate::is_hex_color(value) {
                *color = Some(value.to_ascii_lowercase());
            } else {
                return Err("Use cores válidas para o tema e o nome.");
            }
        }
    }
    if appearance
        .name_color_secondary
        .as_ref()
        .is_some_and(|color| color.len() != 7)
    {
        return Err("Use seis dígitos hexadecimais na segunda cor do nome.");
    }
    for (choice, allowed) in [
        (
            &mut appearance.theme_mode,
            crate::profile::THEME_MODES.as_slice(),
        ),
        (
            &mut appearance.theme_direction,
            crate::profile::THEME_DIRECTIONS.as_slice(),
        ),
        (
            &mut appearance.name_gradient_direction,
            crate::profile::THEME_DIRECTIONS.as_slice(),
        ),
    ] {
        if choice.is_some() {
            *choice = crate::profile::clean_choice(choice.take(), allowed)
                .ok_or("Modo ou direção de gradiente inválido.")?;
        }
    }
    Ok(appearance)
}

fn equip_appearance(st: &mut ServerState, uid: &str, lower: &str, appearance: ProfileAppearance) {
    // A conta e as sessões ativas têm os mesmos campos de apresentação.
    macro_rules! equip {
        ($target:ident) => {
            $target.avatar_decoration = appearance.avatar_decoration.clone();
            $target.profile.profile_frame = appearance.profile_frame.clone();
            $target.profile_effect = appearance.profile_effect.clone();
            $target.nameplate_style = appearance.nameplate_style.clone();
            $target.name_style = appearance.name_style.clone();
            $target.name_color = appearance.name_color.clone();
            $target.profile.name_color_secondary = appearance.name_color_secondary.clone();
            $target.profile.name_gradient_direction = appearance.name_gradient_direction.clone();
            $target.theme_primary = appearance.theme_primary.clone();
            $target.theme_accent = appearance.theme_accent.clone();
            $target.profile.theme_highlight = appearance.theme_highlight.clone();
            $target.profile.theme_mode = appearance.theme_mode.clone();
            $target.profile.theme_direction = appearance.theme_direction.clone();
        };
    }
    if let Some(account) = st.accounts.get_mut(lower) {
        equip!(account);
    }
    for user in st
        .users
        .values_mut()
        .filter(|user| user.username.to_lowercase() == lower)
    {
        equip!(user);
    }
    st.save_accounts();
    crate::profile::broadcast_profile(st);
    st.send_to(uid, ServerMessage::ProfileLookApplied { appearance });
}
