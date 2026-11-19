use crate::models::{
    ClientMessage, FriendInfo, GitHubProfileChallenge, ProfileAudience, ProfileLink,
    ProfileLinkView, ProfilePrivacy, ServerMessage, UserInfo,
};
use crate::state::{ServerState, SharedState};
use std::cell::OnceCell;
use std::time::Duration;

#[derive(Clone, Copy)]
pub struct ProfileAccess {
    pub details: bool,
    pub bio: bool,
    pub pronouns: bool,
    pub banner: bool,
    pub status: bool,
    pub activity: bool,
    pub badges: bool,
    pub board: bool,
    pub connections: bool,
}

pub fn access(st: &ServerState, viewer: &str, owner: &str) -> ProfileAccess {
    let default = ProfilePrivacy::default();
    let privacy = st
        .accounts
        .get(owner)
        .map(|a| &a.profile_sharing.privacy)
        .unwrap_or(&default);
    let blocked = st.friends_store.blocked_either(viewer, owner);
    let friends = st.friends_store.are_friends(viewer, owner);
    let shared = OnceCell::new();
    let permits = |audience| {
        if viewer == owner {
            return true;
        }
        if blocked {
            return false;
        }
        match audience {
            ProfileAudience::Everyone => true,
            ProfileAudience::SharedSpaces => {
                friends
                    || *shared.get_or_init(|| {
                        st.servers
                            .iter()
                            .any(|s| s.id != "sancord" && s.is_member(viewer) && s.is_member(owner))
                    })
            }
            ProfileAudience::Friends => friends,
            ProfileAudience::OnlyMe => false,
        }
    };
    let details = permits(privacy.audience);
    let field = |audience| details && permits(audience);
    ProfileAccess {
        details,
        bio: field(privacy.bio),
        pronouns: field(privacy.pronouns),
        banner: field(privacy.banner),
        status: field(privacy.status),
        activity: field(privacy.activity),
        badges: field(privacy.badges),
        board: field(privacy.board),
        connections: field(privacy.connections),
    }
}

macro_rules! redact_profile {
    ($u:ident, $scope:ident) => {
        if !$scope.bio {
            $u.bio = None;
        }
        if !$scope.pronouns {
            $u.pronouns = None;
        }
        if !$scope.banner {
            $u.banner_url = None;
            $u.profile.banner_animated = false;
        }
        if !$scope.status {
            $u.custom_status = None;
            $u.custom_status_emoji = None;
            $u.custom_status_expires_at = None;
        }
        if !$scope.details {
            $u.created_at = None;
            $u.avatar_decoration = None;
            $u.nameplate_style = None;
            $u.name_style = None;
            $u.name_color = None;
            $u.theme_primary = None;
            $u.theme_accent = None;
            $u.profile_effect = None;
            $u.profile.profile_frame = None;
            $u.profile.name_color_secondary = None;
            $u.profile.name_gradient_direction = None;
            $u.profile.theme_highlight = None;
            $u.profile.theme_mode = None;
            $u.profile.theme_direction = None;
        }
        if !$scope.badges {
            $u.profile.badges.retain(|id| {
                crate::cosmetics::badge(id).is_some_and(|badge| badge.category == "trust")
            });
        }
    };
}

pub fn project_user(st: &ServerState, viewer: &str, user: &mut UserInfo) {
    let scope = access(st, viewer, &user.username.to_lowercase());
    redact_profile!(user, scope);
}

pub fn project_friend(st: &ServerState, viewer: &str, user: &mut FriendInfo) {
    let scope = access(st, viewer, &user.username.to_lowercase());
    redact_profile!(user, scope);
    if !scope.activity
        || user
            .voice_channel_id
            .as_ref()
            .is_some_and(|ch| !st.can_view_channel(viewer, ch))
    {
        user.voice_channel_id = None;
    }
}

pub fn project_member_profile(
    st: &ServerState,
    viewer: &str,
    owner: &str,
    profile: &mut crate::models::ServerMemberProfile,
) {
    let scope = access(st, viewer, owner);
    if !scope.bio {
        profile.bio = None;
    }
    if !scope.banner {
        profile.banner = None;
    }
    if !scope.details {
        profile.avatar_decoration = None;
        profile.profile_frame = None;
        profile.profile_effect = None;
        profile.nameplate_style = None;
        profile.name_style = None;
        profile.name_color = None;
        profile.name_color_secondary = None;
        profile.name_gradient_direction = None;
        profile.theme_primary = None;
        profile.theme_accent = None;
        profile.theme_highlight = None;
        profile.theme_mode = None;
        profile.theme_direction = None;
    }
}

const SOCIAL_PLATFORMS: &[&str] = &[
    "github",
    "steam",
    "twitch",
    "youtube",
    "spotify",
    "x",
    "instagram",
    "xbox",
    "playstation",
    "tiktok",
    "linkedin",
    "reddit",
    "website",
];

pub fn detect_platform(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let found = match host {
        "github.com" => "github",
        "steamcommunity.com" | "store.steampowered.com" => "steam",
        "twitch.tv" => "twitch",
        "youtube.com" | "youtu.be" => "youtube",
        "open.spotify.com" | "spotify.com" => "spotify",
        "x.com" | "twitter.com" => "x",
        "instagram.com" => "instagram",
        "xbox.com" | "account.xbox.com" => "xbox",
        "psnprofiles.com" | "playstation.com" => "playstation",
        "tiktok.com" => "tiktok",
        "linkedin.com" => "linkedin",
        "reddit.com" | "old.reddit.com" => "reddit",
        _ => return None,
    };
    Some(found.to_string())
}

fn clean_platform(input: Option<String>, url: &str) -> Result<Option<String>, &'static str> {
    if let Some(raw) = input {
        let trimmed = raw.trim().to_ascii_lowercase();
        if !trimmed.is_empty() {
            if !SOCIAL_PLATFORMS.contains(&trimmed.as_str()) {
                return Err("Plataforma de conexão desconhecida.");
            }
            return Ok(Some(trimmed));
        }
    }
    Ok(detect_platform(url))
}

pub fn public_links(st: &ServerState, owner: &str, scope: ProfileAccess) -> Vec<ProfileLinkView> {
    if !scope.connections {
        return Vec::new();
    }
    st.accounts
        .get(owner)
        .into_iter()
        .flat_map(|a| &a.profile_sharing.links)
        .filter(|link| link.visible)
        .map(|link| ProfileLinkView {
            label: link.label.clone(),
            url: link.url.clone(),
            verified_github: link.verified_github,
            platform: link.platform.clone().or_else(|| detect_platform(&link.url)),
        })
        .collect()
}

fn sharing_state(st: &ServerState, lower: &str) -> Option<ServerMessage> {
    let settings = &st.accounts.get(lower)?.profile_sharing;
    Some(ServerMessage::ProfileSharingState {
        privacy: settings.privacy.clone(),
        links: settings.links.clone(),
    })
}

pub fn refresh_viewers(st: &ServerState, lower: &str) {
    let Some(account) = st.accounts.get(lower) else {
        return;
    };
    st.broadcast(ServerMessage::ProfilePresentationChanged {
        username: account.username.clone(),
    });
    for server in &st.servers {
        if let Some(profile) = server.member_profiles.get(lower) {
            st.broadcast_to_server(
                &server.id,
                ServerMessage::ServerProfileUpdated {
                    server_id: server.id.clone(),
                    username: lower.to_string(),
                    profile: Some(profile.clone()),
                },
            );
        }
    }
}

pub fn refresh_relationship(st: &ServerState, a: &str, b: &str) {
    let sync = ServerMessage::VoiceStateSync {
        users: st.users_list(),
        voice_members: st.voice_members_map(),
    };
    for (id, session) in &st.users {
        let lower = session.username.to_lowercase();
        let target = if lower == a {
            b
        } else if lower == b {
            a
        } else {
            continue;
        };
        let Some(account) = st.accounts.get(target) else {
            continue;
        };
        st.send_to(id, sync.clone());
        for server in st.servers.iter().filter(|s| s.is_member(&lower)) {
            if let Some(profile) = server.member_profiles.get(target) {
                st.send_to(
                    id,
                    ServerMessage::ServerProfileUpdated {
                        server_id: server.id.clone(),
                        username: target.to_string(),
                        profile: Some(profile.clone()),
                    },
                );
            }
        }
        st.send_to(
            id,
            ServerMessage::ProfilePresentationChanged {
                username: account.username.clone(),
            },
        );
    }
}

fn changed(st: &mut ServerState, lower: &str, reproject: bool, refresh: bool) {
    st.save_accounts();
    if let Some(update) = sharing_state(st, lower) {
        for (id, user) in &st.users {
            if user.username.to_lowercase() == lower {
                st.send_to(id, update.clone());
            }
        }
    }
    if reproject {
        crate::profile::broadcast_profile(st);
    }
    if refresh {
        refresh_viewers(st, lower);
    }
}

fn clean_label(label: &str) -> Result<String, &'static str> {
    let label = label.trim();
    if label.is_empty() || label.chars().count() > 60 || label.chars().any(char::is_control) {
        return Err("Use um título de 1 a 60 caracteres.");
    }
    Ok(label.to_string())
}

fn clean_link(url: &str) -> Result<String, &'static str> {
    let url = url.trim();
    if url.len() > 500 || url.chars().any(char::is_control) {
        return Err("Use um endereço de até 500 caracteres.");
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| "Endereço inválido.")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.has_host()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Use um link HTTP ou HTTPS sem credenciais.");
    }
    Ok(parsed.into())
}

fn github_handle(url: &str) -> Option<String> {
    let url = reqwest::Url::parse(url).ok()?;
    let handle = url.path().trim_end_matches('/').strip_prefix('/')?;
    (url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && !handle.is_empty()
        && handle.len() <= 39
        && handle.as_bytes().first()?.is_ascii_alphanumeric()
        && handle.as_bytes().last()?.is_ascii_alphanumeric()
        && handle
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-'))
    .then(|| handle.to_ascii_lowercase())
}

fn update(st: &mut ServerState, uid: &str, msg: ClientMessage) -> Result<(), &'static str> {
    let lower = st
        .users
        .get(uid)
        .ok_or("Sessão inválida.")?
        .username
        .to_lowercase();
    let account = st.accounts.get_mut(&lower).ok_or("Conta não encontrada.")?;
    let sharing = &mut account.profile_sharing;
    let (reproject, refresh) = match msg {
        ClientMessage::GetProfileSharing => {
            if let Some(data) = sharing_state(st, &lower) {
                st.send_to(uid, data);
            }
            return Ok(());
        }
        ClientMessage::SetProfilePrivacy { privacy } => {
            if sharing.privacy == privacy {
                if let Some(data) = sharing_state(st, &lower) {
                    st.send_to(uid, data);
                }
                return Ok(());
            }
            sharing.privacy = privacy;
            (true, true)
        }
        ClientMessage::SetProfileLink {
            id,
            label,
            url,
            visible,
            platform,
        } => {
            let label = clean_label(&label)?;
            let url = clean_link(&url)?;
            let platform = clean_platform(platform, &url)?;
            let was_visible = if let Some(id) = id {
                let link = sharing
                    .links
                    .iter_mut()
                    .find(|link| link.id == id)
                    .ok_or("Conexão não encontrada.")?;
                if link.url != url {
                    link.challenge = None;
                    link.verified_github = false;
                }
                let previous = link.visible;
                link.label = label;
                link.url = url;
                link.visible = visible;
                link.platform = platform;
                previous
            } else {
                if sharing.links.len() >= 8 {
                    return Err("O perfil aceita até oito conexões.");
                }
                sharing.links.push(ProfileLink {
                    id: uuid::Uuid::new_v4().to_string(),
                    label,
                    url,
                    visible,
                    verified_github: false,
                    challenge: None,
                    platform,
                });
                false
            };
            (false, visible || was_visible)
        }
        ClientMessage::RemoveProfileLink { id } => {
            let index = sharing
                .links
                .iter()
                .position(|link| link.id == id)
                .ok_or("Conexão não encontrada.")?;
            (false, sharing.links.remove(index).visible)
        }
        ClientMessage::StartGitHubProfileVerification { id } => {
            let link = sharing
                .links
                .iter_mut()
                .find(|link| link.id == id)
                .ok_or("Conexão não encontrada.")?;
            github_handle(&link.url)
                .ok_or("Use o endereço HTTPS do seu perfil pessoal no GitHub.")?;
            if link.verified_github {
                return Err("Esta conexão já foi verificada.");
            }
            link.challenge = Some(GitHubProfileChallenge {
                code: format!("sancord-{}", uuid::Uuid::new_v4().simple()),
                expires_at: crate::auth::now_ms() + 20 * 60_000,
            });
            (false, false)
        }
        _ => unreachable!(),
    };
    changed(st, &lower, reproject, refresh);
    Ok(())
}

#[derive(serde::Deserialize)]
struct GitHubUser {
    login: String,
    bio: Option<String>,
    #[serde(rename = "type")]
    kind: String,
}

fn proves_control(user: &GitHubUser, handle: &str, code: &str) -> bool {
    user.kind == "User"
        && user.login.eq_ignore_ascii_case(handle)
        && user
            .bio
            .as_deref()
            .is_some_and(|bio| bio.split_whitespace().any(|part| part == code))
}

static GITHUB_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

async fn fetch_github_user(handle: &str) -> Result<GitHubUser, &'static str> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Sancord-Profile-Verification")
        .build()
        .map_err(|_| "Não foi possível consultar o GitHub.")?;
    let mut response = client
        .get(format!("https://api.github.com/users/{handle}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "GitHub indisponível. Tente novamente mais tarde.")?;
    if !response.status().is_success() {
        return Err("O perfil do GitHub está indisponível para verificação.");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Resposta incompleta do GitHub.")?
    {
        if bytes.len() + chunk.len() > 32_768 {
            return Err("Resposta inválida do GitHub.");
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Resposta inválida do GitHub.")
}

async fn verify(state: &SharedState, uid: &str, id: &str) -> Result<(), &'static str> {
    let _slot = GITHUB_SLOTS
        .try_acquire()
        .map_err(|_| "Há verificações em andamento. Tente novamente em instantes.")?;
    let (lower, account_id, handle, code) = {
        let mut st = state.write().await;
        let lower = st
            .users
            .get(uid)
            .ok_or("Sessão inválida.")?
            .username
            .to_lowercase();
        let account = st.accounts.get_mut(&lower).ok_or("Conta não encontrada.")?;
        let settings = &mut account.profile_sharing;
        let now = crate::auth::now_ms();
        if settings.github_retry_at > now {
            return Err("Aguarde 30 segundos entre consultas ao GitHub.");
        }
        let link = settings
            .links
            .iter()
            .find(|link| link.id == id)
            .ok_or("Conexão não encontrada.")?;
        let handle = github_handle(&link.url).ok_or("Endereço de perfil GitHub inválido.")?;
        let challenge = link
            .challenge
            .as_ref()
            .filter(|c| c.expires_at > now)
            .ok_or("Gere um código novo para começar.")?;
        settings.github_retry_at = now + 30_000;
        let snapshot = (lower, account.id.clone(), handle, challenge.code.clone());
        st.save_accounts();
        snapshot
    };
    let response = fetch_github_user(&handle).await?;
    if !proves_control(&response, &handle, &code) {
        return Err("Copie o código para sua bio pública do GitHub como uma palavra separada e tente novamente.");
    }
    let mut st = state.write().await;
    let account = st
        .accounts
        .get_mut(&lower)
        .filter(|a| a.id == account_id)
        .ok_or("Conta não encontrada.")?;
    let link = account
        .profile_sharing
        .links
        .iter_mut()
        .find(|link| link.id == id)
        .ok_or("Conexão não encontrada.")?;
    if !link
        .challenge
        .as_ref()
        .is_some_and(|c| c.expires_at > crate::auth::now_ms() && c.code == code)
        || github_handle(&link.url).as_deref() != Some(&handle)
    {
        return Err("O desafio mudou. Gere um código novo.");
    }
    link.verified_github = true;
    link.challenge = None;
    let visible = link.visible;
    changed(&mut st, &lower, false, visible);
    Ok(())
}

pub async fn handle(state: &SharedState, uid: &str, msg: ClientMessage) {
    let result = match msg {
        ClientMessage::CheckGitHubProfileVerification { id } => verify(state, uid, &id).await,
        msg => update(&mut *state.write().await, uid, msg),
    };
    if let Err(message) = result {
        state
            .read()
            .await
            .feedback(uid, false, "profile_sharing", message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_proof_requires_an_exact_code_and_personal_handle() {
        let user = GitHubUser {
            login: "Dona".into(),
            bio: Some("Olá sancord-codigo aqui".into()),
            kind: "User".into(),
        };
        assert!(proves_control(&user, "dona", "sancord-codigo"));
        assert!(!proves_control(&user, "intruso", "sancord-codigo"));
        assert!(!proves_control(&user, "dona", "sancord-cod"));
        assert_eq!(
            github_handle("https://github.com/Dona/").as_deref(),
            Some("dona")
        );
        for url in [
            "https://github.com/owner/repo",
            "https://github.com.exemplo.org/Dona",
            "https://github.com/Dona?alias=outra",
            "https://github.com/%2e%2e",
        ] {
            assert!(github_handle(url).is_none());
        }
    }
}
