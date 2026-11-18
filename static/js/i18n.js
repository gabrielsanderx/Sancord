// ============================================================================
// Sancord — Internacionalização (Fase 9, seção 70)
//   t("chave", { nome }) devolve o texto no idioma atual (pt-BR é a base).
//   No HTML: data-i18n (texto), data-i18n-placeholder, data-i18n-title.
//   Idioma salvo neste aparelho ("sancord_lang"). English está em preparação:
//   chaves sem tradução caem no português.
// Carregado antes dos demais scripts (não depende de nada).
// ============================================================================

const I18N_LOCALES = {
  "pt-BR": {
    "lang.name": "Português (Brasil)",
    "common.done": "Concluir",
    "common.loading": "Carregando…",
    "common.refresh": "Atualizar",
    "server.integrations": "Integrações",
    "integrations.hint": "Bots de envio e webhooks publicam texto neste canal. Não enviam anexos nem notificam menções. O AutoMod continua ativo.",
    "integrations.channel": "Canal de destino",
    "integrations.create": "Criar integração",
    "integrations.name": "Nome",
    "integrations.kind": "Tipo",
    "integrations.bot": "Bot de envio",
    "integrations.failed": "Não foi possível gerenciar a integração. Confira sua conexão e a versão do servidor.",
    "integrations.noChannels": "Nenhum canal com permissão para gerenciar integrações.",
    "integrations.empty": "Nenhuma integração neste canal.",
    "integrations.credential": "Credencial da integração",
    "integrations.credentialHint": "Guarde a credencial: ela só aparece agora. Quem tem o token pode publicar neste canal. Não a compartilhe no chat. O envio para se o responsável perder acesso; um administrador pode renovar a credencial.",
    "integrations.copy": "Copiar dados de acesso",
    "integrations.copied": "Dados copiados. Guarde o token fora do chat e do código público.",
    "integrations.copyFailed": "Não foi possível copiar os dados. Renove a credencial para exibi-la novamente.",
    "integrations.rotate": "Renovar token",
    "integrations.revoke": "Revogar integração",
    "integrations.revokeHint": "O token atual deixará de funcionar imediatamente. Deseja continuar?",
    "common.save": "Salvar",
    "common.cancel": "Cancelar",
    "common.confirm": "Confirmar",
    "common.required": "Preencha: {field}.",
    "quick.server": "Servidor",
    "quick.voice": "voz",
    "quick.thread": "Thread",
    "quick.dm": "Mensagem direta",
    "quick.group": "Grupo",
    "quick.friend": "Amigo",
    "quick.noUnread": "Nenhum canal não lido neste servidor.",
    "shortcut.quick": "Navegação rápida (canais, pessoas, servidores)",
    "shortcut.channel": "Canal anterior / próximo",
    "shortcut.unread": "Canal não lido anterior / próximo",
    "shortcut.read": "Marcar o canal atual como lido",
    "shortcut.search": "Buscar no histórico",
    "shortcut.help": "Ver todos os atalhos",
    "auth.title": "Bem-vindo de volta!",
    "auth.subtitle": "Estamos felizes em ver você novamente no Sancord.",
    "auth.tab.register": "Criar Conta",
    "auth.tab.login": "Já tenho conta",
    "auth.username": "NOME DE USUÁRIO",
    "auth.password": "SENHA",
    "auth.password.placeholder": "Mínimo de 8 caracteres para contas novas",
    "auth.remember": "Manter conectado neste dispositivo",
    "auth.submit.register": "Criar Conta e Entrar",
    "auth.submit.login": "Entrar na Conta",
    "home.friends": "Amigos",
    "home.starred": "Favoritas",
    "home.servers": "Servidores",
    "home.dms": "Mensagens diretas",
    "home.activeNow": "Ativo agora",
    "home.findConversation": "Encontre ou comece uma conversa",
    "friends.search": "Buscar amigo...",
    "friends.online": "Disponível",
    "friends.all": "Todos",
    "friends.pending": "Pendente",
    "friends.requests": "Solicitações",
    "friends.blocked": "Bloqueados",
    "friends.add": "Adicionar amigo",
    "settings.account": "Conta",
    "settings.privacy": "Dados e privacidade",
    "settings.notifications": "Notificações",
    "settings.voice": "Voz e vídeo",
    "settings.appearance": "Aparência",
    "settings.shortcuts": "Atalhos",
    "settings.updates": "Atualizações",
    "settings.logout": "Sair da Conta",
    "settings.language": "Idioma",
    "settings.language.hint": "O inglês ainda está em preparação: textos sem tradução aparecem em português.",
    "server.overview": "Visão Geral",
    "server.roles": "Cargos & Permissões",
    "server.channels": "Canais",
    "server.members": "Membros & Moderação",
    "server.invites": "Convites",
    "server.automod": "AutoMod",
    "server.audit": "Registro de auditoria",
    "server.events": "Eventos",
    "chat.search": "Buscar",
    "quick.placeholder": "Para onde você quer ir?  # canal  @ pessoa  * servidor",
    "quick.hint": "↑↓ navegar • Enter abrir • Esc fechar • Ctrl+/ todos os atalhos",
    "quick.empty": "Nada encontrado.",
    "forum.search": "Buscar postagens…",
    "forum.newPost": "+ Nova postagem",
    "notify.title": "Notificações",
    "notify.default": "Padrão",
    "notify.all": "Todas as mensagens",
    "notify.mentions": "Só @menções",
    "notify.none": "Nada",
    "notify.saved": "Notificações: {level}",
    "author.system": "SISTEMA",
    "author.bot": "BOT",
    "author.webhook": "WEBHOOK",
  },
  en: {
    "lang.name": "English (preview)",
    "common.done": "Done",
    "common.loading": "Loading…",
    "common.refresh": "Refresh",
    "server.integrations": "Integrations",
    "integrations.hint": "Sending bots and webhooks publish text to this channel. Attachments and mention notifications are disabled. AutoMod still applies.",
    "integrations.channel": "Destination channel",
    "integrations.create": "Create integration",
    "integrations.name": "Name",
    "integrations.kind": "Type",
    "integrations.bot": "Sending bot",
    "integrations.failed": "Could not manage the integration. Check your connection and server version.",
    "integrations.noChannels": "No channels where you can manage integrations.",
    "integrations.empty": "No integrations in this channel.",
    "integrations.credential": "Integration credential",
    "integrations.credentialHint": "Save this credential: it is only shown now. Anyone with the token can publish to this channel. Do not share it in chat. Sending stops if the responsible user loses access; an administrator can rotate the credential.",
    "integrations.copy": "Copy access details",
    "integrations.copied": "Details copied. Keep the token out of chat and public code.",
    "integrations.copyFailed": "Could not copy the details. Rotate the credential to display a new one.",
    "integrations.rotate": "Rotate token",
    "integrations.revoke": "Revoke integration",
    "integrations.revokeHint": "The current token will stop working immediately. Continue?",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.required": "Fill in: {field}.",
    "quick.server": "Server",
    "quick.voice": "voice",
    "quick.thread": "Thread",
    "quick.dm": "Direct message",
    "quick.group": "Group",
    "quick.friend": "Friend",
    "quick.noUnread": "No unread channels in this server.",
    "shortcut.quick": "Quick navigation (channels, people, servers)",
    "shortcut.channel": "Previous / next channel",
    "shortcut.unread": "Previous / next unread channel",
    "shortcut.read": "Mark the current channel as read",
    "shortcut.search": "Search history",
    "shortcut.help": "Show all keybinds",
    "auth.title": "Welcome back!",
    "auth.subtitle": "We're so glad to see you on Sancord again.",
    "auth.tab.register": "Create account",
    "auth.tab.login": "I have an account",
    "auth.username": "USERNAME",
    "auth.password": "PASSWORD",
    "auth.password.placeholder": "At least 8 characters for new accounts",
    "auth.remember": "Keep me signed in on this device",
    "auth.submit.register": "Create account and sign in",
    "auth.submit.login": "Sign in",
    "home.friends": "Friends",
    "home.starred": "Starred",
    "home.servers": "Servers",
    "home.dms": "Direct messages",
    "home.activeNow": "Active now",
    "home.findConversation": "Find or start a conversation",
    "friends.search": "Search friends...",
    "friends.online": "Online",
    "friends.all": "All",
    "friends.pending": "Pending",
    "friends.requests": "Requests",
    "friends.blocked": "Blocked",
    "friends.add": "Add friend",
    "settings.account": "Account",
    "settings.privacy": "Data & privacy",
    "settings.notifications": "Notifications",
    "settings.voice": "Voice & video",
    "settings.appearance": "Appearance",
    "settings.shortcuts": "Keybinds",
    "settings.updates": "Updates",
    "settings.logout": "Log out",
    "settings.language": "Language",
    "settings.language.hint": "English is a preview: untranslated text is shown in Portuguese.",
    "server.overview": "Overview",
    "server.roles": "Roles & permissions",
    "server.channels": "Channels",
    "server.members": "Members & moderation",
    "server.invites": "Invites",
    "server.automod": "AutoMod",
    "server.audit": "Audit log",
    "server.events": "Events",
    "chat.search": "Search",
    "quick.placeholder": "Where would you like to go?  # channel  @ person  * server",
    "quick.hint": "↑↓ move • Enter open • Esc close • Ctrl+/ all keybinds",
    "quick.empty": "No results.",
    "forum.search": "Search posts…",
    "forum.newPost": "+ New post",
    "notify.title": "Notifications",
    "notify.default": "Default",
    "notify.all": "All messages",
    "notify.mentions": "Only @mentions",
    "notify.none": "Nothing",
    "notify.saved": "Notifications: {level}",
    "author.system": "SYSTEM",
    "author.bot": "BOT",
    "author.webhook": "WEBHOOK",
  },
};

const I18N_DEFAULT = "pt-BR";

function i18nStoredLang() {
  try {
    const v = localStorage.getItem("sancord_lang");
    return v && Object.hasOwn(I18N_LOCALES, v) ? v : I18N_DEFAULT;
  } catch (_) {
    return I18N_DEFAULT;
  }
}

let i18nLang = i18nStoredLang();

/** Texto traduzido; `{nome}` é trocado por vars.nome. Sem tradução: português; sem chave: a própria chave. */
function t(key, vars) {
  const locale = I18N_LOCALES[i18nLang];
  const fallback = I18N_LOCALES[I18N_DEFAULT];
  const text = (Object.hasOwn(locale, key) ? locale[key] : undefined) ??
    (Object.hasOwn(fallback, key) ? fallback[key] : undefined) ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
}

function currentLanguage() {
  return i18nLang;
}

/** Aplica as traduções aos elementos marcados (todo o documento ou um trecho). */
function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitle));
  });
  document.documentElement.lang = i18nLang === "en" ? "en" : "pt-BR";
}

function setLanguage(lang) {
  if (!Object.hasOwn(I18N_LOCALES, lang)) return;
  i18nLang = lang;
  try {
    localStorage.setItem("sancord_lang", lang);
  } catch (_) {}
  applyI18n();
  document.dispatchEvent(new CustomEvent("sancord:language", { detail: { lang } }));
}

document.addEventListener("DOMContentLoaded", () => applyI18n());
if (document.readyState !== "loading") applyI18n();
