//! Projeção por destinatário na última fronteira de saída do WebSocket.
//! Uma resposta de consulta antiga também é revalidada aqui após revogações.
use crate::models::{GuildServer, ServerMessage, UserInfo};
use crate::state::ServerState;

impl ServerState {
    pub fn voice_media_permissions(&self, user_id: &str) -> (bool, bool) {
        let Some(user) = self.users.get(user_id) else {
            return (false, false);
        };
        let Some(ch) = user.voice_channel_id.as_deref() else {
            return (false, false);
        };
        let lower = user.username.to_lowercase();
        if !self.can_join_voice(&lower, ch) {
            return (false, false);
        }
        if crate::voice::is_private_voice(ch) {
            return (true, true);
        }
        self.servers
            .iter()
            .find(|s| s.find_channel(ch).is_some())
            .map(|s| {
                let p = s.channel_permissions(&lower, ch);
                (p.speak_voice, p.stream_video)
            })
            .unwrap_or((false, false))
    }

    pub fn can_signal_sdp(&self, user_id: &str, sdp: &serde_json::Value) -> bool {
        let Some(text) = sdp.get("sdp").and_then(|v| v.as_str()) else {
            return false;
        };
        let (audio, video) = self.voice_media_permissions(user_id);
        let mut kind = "";
        let mut session_direction = "sendrecv";
        let mut direction = session_direction;
        let mut active = true;
        let allowed = |kind: &str, direction: &str, active: bool| {
            !active
                || matches!(direction, "recvonly" | "inactive")
                || match kind {
                    "audio" => audio,
                    "video" => video,
                    _ => true,
                }
        };
        for line in text.lines().map(str::trim) {
            if let Some(media) = line.strip_prefix("m=") {
                if !allowed(kind, direction, active) {
                    return false;
                }
                let mut parts = media.split_whitespace();
                kind = parts.next().unwrap_or("");
                active = parts.next() != Some("0");
                direction = session_direction;
            } else if let Some(value) = line
                .strip_prefix("a=")
                .filter(|v| matches!(*v, "sendrecv" | "sendonly" | "recvonly" | "inactive"))
            {
                direction = value;
                if kind.is_empty() {
                    session_direction = value;
                }
            }
        }
        allowed(kind, direction, active)
    }

    pub fn can_signal_peer(&self, from: &str, to: &str) -> bool {
        if from == to {
            return false;
        }
        let (Some(a), Some(b)) = (self.users.get(from), self.users.get(to)) else {
            return false;
        };
        let (Some(ac), Some(bc)) = (&a.voice_channel_id, &b.voice_channel_id) else {
            return false;
        };
        ac == bc
            && self.can_join_voice(&a.username.to_lowercase(), ac)
            && self.can_join_voice(&b.username.to_lowercase(), bc)
    }

    pub fn can_join_voice(&self, user: &str, channel: &str) -> bool {
        if channel.starts_with("dmvoice:") || channel.starts_with("gdmvoice:") {
            // Chamada privada: participante, e ninguém da DM 1:1 bloqueou o outro.
            if !self.is_private_participant(channel, user) {
                return false;
            }
            return Self::parse_dm_participants(channel)
                .map_or(true, |(a, b)| !self.friends_store.blocked_either(&a, &b));
        }
        self.servers
            .iter()
            .find(|s| s.voice_channels.iter().any(|c| c.id == channel))
            .is_some_and(|s| {
                let p = s.channel_permissions(user, channel);
                p.view_channel && p.connect_voice
            })
    }

    pub fn enforce_voice_access(&mut self) {
        let revoked: Vec<(String, String)> = self
            .users
            .iter()
            .filter_map(|(uid, u)| {
                let ch = u.voice_channel_id.as_ref()?;
                let current = self.voice_media_permissions(uid);
                let previous = self.voice_grants.get(uid).copied().unwrap_or(current);
                let media_revoked = (previous.0 && !current.0) || (previous.1 && !current.1);
                if self.can_join_voice(&u.username.to_lowercase(), ch) && !media_revoked {
                    None
                } else {
                    Some((uid.clone(), ch.clone()))
                }
            })
            .collect();
        let changed = !revoked.is_empty();
        for (uid, channel) in revoked {
            self.voice_grants.remove(&uid);
            if let Some(user) = self.users.get_mut(&uid) {
                user.voice_channel_id = None;
                user.screen_sharing = false;
                user.camera_on = false;
                user.camera_stream_id = None;
                user.screen_stream_id = None;
            }
            self.broadcast_to_voice_channel_except(
                &channel,
                &uid,
                ServerMessage::PeerLeftVoice {
                    channel_id: channel.clone(),
                    peer_id: uid.clone(),
                },
            );
            if let Some(user) = self.users.get(&uid) {
                self.send_to(&uid, ServerMessage::SelfUpdated { user: user.clone() });
            }
            crate::voice::after_leave(self, &channel);
        }
        if changed {
            self.broadcast(ServerMessage::VoiceStateSync {
                voice_members: self.voice_members_map(),
                users: self.users_list(),
            });
        }
    }

    pub fn refresh_voice_grants(&mut self) {
        self.voice_grants = self
            .users
            .iter()
            .filter(|(_, u)| u.voice_channel_id.is_some())
            .map(|(uid, _)| (uid.clone(), self.voice_media_permissions(uid)))
            .collect();
    }

    pub fn can_view_channel(&self, user: &str, channel_id: &str) -> bool {
        if Self::is_dm_channel(channel_id) {
            return self.is_private_participant(channel_id, user);
        }
        self.servers
            .iter()
            .find(|s| s.has_channel_or_thread(channel_id))
            .is_some_and(|s| s.channel_permissions(user, channel_id).view_channel)
    }

    fn project_user_voice(&self, recipient: &str, user: &mut UserInfo) {
        crate::profile_sharing::project_user(self, recipient, user);
        if user
            .voice_channel_id
            .as_ref()
            .is_some_and(|ch| !self.can_view_channel(recipient, ch))
        {
            user.voice_channel_id = None;
            user.screen_sharing = false;
            user.camera_on = false;
            user.camera_stream_id = None;
            user.screen_stream_id = None;
            user.stream_quality = None;
        }
    }

    fn project_server_profile(&self, recipient: &str, server: &mut GuildServer) {
        *server = server.visible_to(recipient);
        for (owner, profile) in &mut server.member_profiles {
            crate::profile_sharing::project_member_profile(self, recipient, owner, profile);
        }
        server.member_roster.clear();
        if server.id != "sancord" {
            let mut seen = std::collections::HashSet::new();
            let owner_lower = server.owner_username.to_lowercase();
            let iter = server
                .members
                .iter()
                .map(|m| m.to_lowercase())
                .chain((!owner_lower.is_empty()).then_some(owner_lower));
            for member_lower in iter.take(500) {
                if !seen.insert(member_lower.clone()) {
                    continue;
                }
                if let Some(mut info) = self.resolve_friend_info(&member_lower) {
                    crate::profile_sharing::project_friend(self, recipient, &mut info);
                    server.member_roster.insert(member_lower, info);
                }
            }
        }
    }

    pub(crate) fn project_outbound(&self, recipient: &str, msg: &mut ServerMessage) -> bool {
        use ServerMessage::*;
        match msg {
            Welcome {
                servers,
                text_channels,
                voice_channels,
                chat_history,
                read_states,
                users,
                voice_members,
                ..
            } => {
                servers.retain(|s| s.is_member(recipient));
                for srv in servers {
                    self.project_server_profile(recipient, srv);
                }
                for channels in [text_channels, voice_channels] {
                    channels.retain(|ch| self.can_view_channel(recipient, &ch.id));
                    for ch in channels {
                        if let Some(srv) = self
                            .servers
                            .iter()
                            .find(|s| s.find_channel(&ch.id).is_some())
                        {
                            ch.effective_permissions =
                                Some(srv.channel_permissions(recipient, &ch.id));
                        }
                    }
                }
                chat_history.retain(|ch, _| self.can_read_text_channel(recipient, ch));
                read_states.retain(|r| self.can_view_channel(recipient, &r.channel_id));
                voice_members.retain(|ch, _| self.can_view_channel(recipient, ch));
                for u in users {
                    self.project_user_voice(recipient, u);
                }
            }
            ServersSync { servers } => {
                servers.retain(|s| s.is_member(recipient));
                for srv in servers {
                    self.project_server_profile(recipient, srv);
                }
            }
            ServerCreated { server, history, .. }
            | ServerAccessUpdated {
                server, history, ..
            } => {
                if !server.is_member(recipient) {
                    return false;
                }
                self.project_server_profile(recipient, server);
                history.retain(|ch, _| self.can_read_text_channel(recipient, ch));
                if let ServerAccessUpdated { read_states, .. } = msg {
                    read_states.retain(|r| self.can_view_channel(recipient, &r.channel_id));
                }
            }
            ServerUpdated { server } => {
                if !server.is_member(recipient) {
                    return false;
                }
                self.project_server_profile(recipient, server);
            }
            ServerMemberJoined { message, .. } => {
                return self.can_view_channel(recipient, &message.channel_id);
            }
            ServerProfileUpdated { server_id, username, profile } => {
                if !self.find_server(server_id).is_some_and(|s| s.is_member(recipient)) {
                    return false;
                }
                if let Some(profile) = profile {
                    crate::profile_sharing::project_member_profile(self, recipient, username, profile);
                }
            }
            ChannelCreated { channel, .. } => {
                if !self.can_view_channel(recipient, &channel.id) {
                    return false;
                }
                if let Some(srv) = self
                    .servers
                    .iter()
                    .find(|s| s.find_channel(&channel.id).is_some())
                {
                    channel.effective_permissions =
                        Some(srv.channel_permissions(recipient, &channel.id));
                }
            }
            ChannelDeleted { server_id, .. } => {
                if !self.find_server(server_id).is_some_and(|s| {
                    s.is_member(recipient) && s.effective_permissions(recipient).manage_channels
                }) {
                    return false;
                }
            }
            NewChatMessage { message } => {
                if !self.can_view_channel(recipient, &message.channel_id) {
                    return false;
                }
                if !self.can_read_text_channel(recipient, &message.channel_id) {
                    message.reply_to = None;
                }
            }
            MessageUpdated { message } => {
                if !self.can_read_text_channel(recipient, &message.channel_id) {
                    return false;
                }
            }
            MessagesPage { channel_id, .. }
            | PinnedMessages { channel_id, .. }
            | MessageDeleted { channel_id, .. }
            | MessagesBulkDeleted { channel_id, .. } => {
                if !self.can_read_text_channel(recipient, channel_id) {
                    return false;
                }
            }
            UserTyping { channel_id, .. }
            | PeerLeftVoice { channel_id, .. } => {
                if !self.can_view_channel(recipient, channel_id) {
                    return false;
                }
            }
            PeerJoinedVoice { channel_id, peer } => {
                if !self.can_view_channel(recipient, channel_id) { return false; }
                self.project_user_voice(recipient, peer);
            }
            ReadStateUpdated { state } => {
                if !self.can_view_channel(recipient, &state.channel_id) {
                    return false;
                }
            }
            VoiceStateSync {
                users,
                voice_members,
            } => {
                voice_members.retain(|ch, _| self.can_view_channel(recipient, ch));
                for u in users {
                    self.project_user_voice(recipient, u);
                }
            }
            UserJoined { user } | SelfUpdated { user } => self.project_user_voice(recipient, user),
            UserActivityUpdated { username, activity, .. } => {
                let owner = username.to_lowercase();
                let scope = crate::profile_sharing::access(self, recipient, &owner);
                let invisible = self
                    .users
                    .values()
                    .find(|u| u.username.to_lowercase() == owner)
                    .is_some_and(|u| u.status_kind == "invisible");
                if recipient != owner && (!scope.activity || invisible) {
                    *activity = None;
                }
            }
            FriendsSync {
                friends,
                incoming_requests,
                outgoing_requests,
                dm_conversations,
                message_requests,
                blocked,
                groups,
                ..
            } => {
                for friend in friends
                    .iter_mut()
                    .chain(incoming_requests)
                    .chain(outgoing_requests)
                    .chain(blocked)
                    .chain(dm_conversations.iter_mut().map(|c| &mut c.peer))
                    .chain(message_requests.iter_mut().map(|c| &mut c.peer))
                    .chain(groups.iter_mut().flat_map(|group| &mut group.members))
                {
                    crate::profile_sharing::project_friend(self, recipient, friend);
                }
            }
            DmOpened { peer, .. } => crate::profile_sharing::project_friend(self, recipient, peer),
            UserProfile { user, mutual_friends, .. } => {
                crate::profile_sharing::project_friend(self, recipient, user);
                for friend in mutual_friends { crate::profile_sharing::project_friend(self, recipient, friend); }
            }
            _ => {}
        }
        true
    }

    pub fn send_server_access(&self, user_id: &str, server_id: &str) {
        let Some(user) = self.users.get(user_id) else {
            return;
        };
        let lower = user.username.to_lowercase();
        let Some(srv) = self.find_server(server_id).filter(|s| s.is_member(&lower)) else {
            return;
        };
        // O cliente busca apenas as páginas recém-liberadas. Não duplica o histórico
        // de todos os canais para cada alteração de cargo, sobretudo com mídia legada.
        let history = std::collections::HashMap::new();
        let read_states = self
            .accounts
            .get(&lower)
            .map(|acc| {
                srv.text_channels
                    .iter()
                    .chain(srv.voice_channels.iter())
                    .filter(|c| self.can_view_channel(&lower, &c.id))
                    .map(|ch| {
                        let state = self.read_state(&acc.id, &ch.id);
                        crate::models::ReadStateInfo {
                            channel_id: ch.id.clone(),
                            last_read_at: state.last_read_at,
                            mention_count: state.mention_count,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        self.send_to(
            user_id,
            ServerMessage::ServerAccessUpdated {
                server: srv.clone(),
                history,
                read_states,
            },
        );
    }
}
