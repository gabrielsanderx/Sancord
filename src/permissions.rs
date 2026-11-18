//! Regras de autorização compartilhadas pelos handlers e pela projeção de dados.
use crate::models::{GuildServer, RolePermissions};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const CHANNEL_PERMISSIONS: &[&str] = &[
    "view_channel",
    "read_history",
    "send_messages",
    "attach_files",
    "add_reactions",
    "manage_messages",
    "pin_messages",
    "mention_everyone",
    "connect_voice",
    "speak_voice",
    "stream_video",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OverwriteTarget {
    Role,
    Member,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionOverwrite {
    pub target_type: OverwriteTarget,
    pub target_id: String,
    /// Ausente = herdar; true = permitir; false = negar.
    #[serde(default)]
    pub permissions: HashMap<String, bool>,
}

impl RolePermissions {
    pub fn none() -> Self {
        Self {
            administrator: false,
            manage_server: false,
            manage_roles: false,
            manage_channels: false,
            kick_members: false,
            ban_members: false,
            manage_messages: false,
            mention_everyone: false,
            send_messages: false,
            attach_files: false,
            connect_voice: false,
            speak_voice: false,
            stream_video: false,
            create_invites: false,
            view_channel: false,
            read_history: false,
            add_reactions: false,
            pin_messages: false,
            mute_members: false,
            deafen_members: false,
            move_members: false,
            view_audit_log: false,
        }
    }

    pub fn value(&self, name: &str) -> bool {
        match name {
            "administrator" => self.administrator,
            "manage_server" => self.manage_server,
            "manage_roles" => self.manage_roles,
            "manage_channels" => self.manage_channels,
            "kick_members" => self.kick_members,
            "ban_members" => self.ban_members,
            "manage_messages" => self.manage_messages,
            "mention_everyone" => self.mention_everyone,
            "send_messages" => self.send_messages,
            "attach_files" => self.attach_files,
            "connect_voice" => self.connect_voice,
            "speak_voice" => self.speak_voice,
            "stream_video" => self.stream_video,
            "create_invites" => self.create_invites,
            "view_channel" => self.view_channel,
            "read_history" => self.read_history,
            "add_reactions" => self.add_reactions,
            "pin_messages" => self.pin_messages,
            "mute_members" => self.mute_members,
            "deafen_members" => self.deafen_members,
            "move_members" => self.move_members,
            "view_audit_log" => self.view_audit_log,
            _ => false,
        }
    }

    fn set_channel(&mut self, name: &str, value: bool) {
        match name {
            "view_channel" => self.view_channel = value,
            "read_history" => self.read_history = value,
            "send_messages" => self.send_messages = value,
            "attach_files" => self.attach_files = value,
            "add_reactions" => self.add_reactions = value,
            "manage_messages" => self.manage_messages = value,
            "pin_messages" => self.pin_messages = value,
            "mention_everyone" => self.mention_everyone = value,
            "connect_voice" => self.connect_voice = value,
            "speak_voice" => self.speak_voice = value,
            "stream_video" => self.stream_video = value,
            _ => {}
        }
    }
}

impl GuildServer {
    pub fn visible_to(&self, user: &str) -> Self {
        let mut visible = self.clone();
        for channels in [&mut visible.text_channels, &mut visible.voice_channels] {
            channels.retain(|ch| self.channel_permissions(user, &ch.id).view_channel);
            for ch in channels {
                ch.effective_permissions = Some(self.channel_permissions(user, &ch.id));
            }
        }
        visible.categories.retain(|cat| {
            let mut p = self.effective_permissions(user);
            if self.is_owner(user) || p.administrator {
                return true;
            }
            self.apply_overwrites(user, &mut p, &cat.permission_overwrites);
            p.view_channel
                || visible
                    .text_channels
                    .iter()
                    .chain(&visible.voice_channels)
                    .any(|ch| ch.category_id.as_ref() == Some(&cat.id))
        });
        // Um canal explicitamente liberado pode continuar visível numa categoria negada.
        visible
    }

    pub fn require_role_manager(&self, actor: &str) -> Result<(), &'static str> {
        if !self.is_member(actor) {
            return Err("Você não é membro deste servidor.");
        }
        let p = self.effective_permissions(actor);
        if self.is_owner(actor) || p.administrator || p.manage_roles {
            Ok(())
        } else {
            Err("Você não tem permissão para gerenciar cargos.")
        }
    }

    pub fn authorize_role(
        &self,
        actor: &str,
        role_id: &str,
        new_position: Option<i32>,
    ) -> Result<(), &'static str> {
        self.require_role_manager(actor)?;
        let role = self
            .roles
            .iter()
            .find(|r| r.id == role_id)
            .ok_or("Cargo não encontrado.")?;
        if let Some(pos) = new_position {
            if role_id != "everyone" && !(1..=1_000_000).contains(&pos) {
                return Err("Posição de cargo inválida.");
            }
        }
        if !self.is_owner(actor) {
            let high = self.highest_position(actor);
            if role_id != "everyone"
                && (role.position >= high || new_position.is_some_and(|p| p >= high))
            {
                return Err("Você só pode administrar cargos abaixo do seu cargo mais alto.");
            }
        }
        Ok(())
    }

    pub fn authorize_grants(
        &self,
        actor: &str,
        before: &RolePermissions,
        after: &RolePermissions,
    ) -> Result<(), &'static str> {
        self.require_role_manager(actor)?;
        let mine = self.effective_permissions(actor);
        if self.is_owner(actor) || mine.administrator {
            return Ok(());
        }
        let admin = [
            "administrator",
            "manage_server",
            "manage_roles",
            "manage_channels",
            "kick_members",
            "ban_members",
            "create_invites",
            "mute_members",
            "deafen_members",
            "move_members",
            "view_audit_log",
        ];
        for key in admin
            .iter()
            .copied()
            .chain(CHANNEL_PERMISSIONS.iter().copied())
        {
            if after.value(key) && !before.value(key) && !mine.value(key) {
                return Err("Você não pode conceder uma permissão que não possui.");
            }
        }
        Ok(())
    }

    pub fn authorize_assignment(
        &self,
        actor: &str,
        target: &str,
        roles: &[String],
    ) -> Result<(), &'static str> {
        self.require_role_manager(actor)?;
        if roles.len() > self.roles.len()
            || roles.iter().collect::<HashSet<_>>().len() != roles.len()
        {
            return Err("A lista de cargos contém duplicatas ou excede o limite.");
        }
        if !self.is_member(target) {
            return Err("O destinatário não é membro deste servidor.");
        }
        if !self.is_owner(actor)
            && (actor == target
                || self.is_owner(target)
                || self.highest_position(target) >= self.highest_position(actor))
        {
            return Err("Você só pode alterar os cargos de membros abaixo da sua hierarquia.");
        }
        let old = self
            .member_roles
            .get(target)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        // Valida adições e remoções; receber a lista completa não autoriza remover cargos superiores.
        for id in old
            .iter()
            .chain(roles)
            .filter(|id| old.contains(id) != roles.contains(id))
        {
            if id == "everyone" {
                return Err("O cargo de todos é automático.");
            }
            self.authorize_role(actor, id, None)?;
            if roles.contains(id) {
                let role = self
                    .roles
                    .iter()
                    .find(|r| &r.id == id)
                    .ok_or("Cargo não encontrado.")?;
                self.authorize_grants(actor, &RolePermissions::none(), &role.permissions)?;
            }
        }
        if roles
            .iter()
            .any(|id| id == "everyone" || !self.roles.iter().any(|r| &r.id == id))
        {
            return Err("A lista contém um cargo inválido.");
        }
        Ok(())
    }

    fn apply_overwrites(&self, user: &str, p: &mut RolePermissions, rules: &[PermissionOverwrite]) {
        let assigned = self
            .member_roles
            .get(user)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        // Everyone → união das negações/permissões dos cargos → exceção individual.
        for phase in 0..3 {
            let matching = |r: &&PermissionOverwrite| match phase {
                0 => r.target_type == OverwriteTarget::Role && r.target_id == "everyone",
                1 => {
                    r.target_type == OverwriteTarget::Role
                        && r.target_id != "everyone"
                        && assigned.contains(&r.target_id)
                }
                _ => r.target_type == OverwriteTarget::Member && r.target_id == user,
            };
            for value in [false, true] {
                for rule in rules.iter().filter(matching) {
                    for (key, allowed) in &rule.permissions {
                        if *allowed == value {
                            p.set_channel(key, value);
                        }
                    }
                }
            }
        }
    }

    pub fn channel_permissions(&self, user: &str, channel_id: &str) -> RolePermissions {
        // Thread: herda do canal-pai; trancada, só a moderação escreve.
        if let Some(t) = self.thread(channel_id) {
            let mut p = self.channel_permissions(user, &t.parent_id);
            if t.locked && !p.manage_messages {
                p.send_messages = false;
                p.attach_files = false;
            }
            return p;
        }
        let Some(ch) = self.find_channel(channel_id) else {
            return RolePermissions::none();
        };
        let mut p = self.effective_permissions(user);
        if !self.is_member(user) {
            return RolePermissions::none();
        }
        if self.is_owner(user) || p.administrator {
            return RolePermissions::all_admin();
        }
        if let Some(cat) = self
            .categories
            .iter()
            .find(|c| Some(&c.id) == ch.category_id.as_ref())
        {
            self.apply_overwrites(user, &mut p, &cat.permission_overwrites);
        }
        if ch.category_id.is_none() || !ch.permissions_synced {
            self.apply_overwrites(user, &mut p, &ch.permission_overwrites);
        }
        if !p.view_channel {
            return RolePermissions::none();
        }
        p
    }

    pub fn validate_overwrites(
        &self,
        actor: &str,
        rules: &[PermissionOverwrite],
    ) -> Result<(), &'static str> {
        if !self.is_member(actor) || !self.effective_permissions(actor).manage_channels {
            return Err("Você não tem permissão para gerenciar canais.");
        }
        if rules.len() > 200 {
            return Err("Limite de exceções de permissão excedido.");
        }
        let mut seen = HashSet::new();
        let mine = self.effective_permissions(actor);
        for rule in rules {
            if !seen.insert((format!("{:?}", rule.target_type), &rule.target_id)) {
                return Err("Há alvos duplicados nas permissões.");
            }
            let exists = match rule.target_type {
                OverwriteTarget::Role => self.roles.iter().any(|r| r.id == rule.target_id),
                OverwriteTarget::Member => {
                    self.is_member(&rule.target_id) && self.members.contains(&rule.target_id)
                }
            };
            if !exists {
                return Err("Cargo ou membro da exceção não encontrado.");
            }
            for (key, value) in &rule.permissions {
                if !CHANNEL_PERMISSIONS.contains(&key.as_str()) {
                    return Err("Permissão de canal desconhecida.");
                }
                if *value && !self.is_owner(actor) && !mine.administrator && !mine.value(key) {
                    return Err("Você não pode conceder uma permissão que não possui.");
                }
            }
        }
        Ok(())
    }
}
