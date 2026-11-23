const SancordOfflineCache = (() => {
  const key = "sancord_offline_snapshot";
  const ttl = 7 * 24 * 60 * 60 * 1000;
  let timer, social;
  const enabled = () => window.__SANCORD_AUTH_DPAPI === true && remembersActiveSession();

  function clear() {
    clearTimeout(timer);
    timer = null;
    social = null;
    SancordSessions.remove(localStorage, key);
  }

  const noVoice = user => ({ ...user, voice_channel_id: null, camera_on: false, screen_sharing: false,
    camera_stream_id: null, screen_stream_id: null, stream_quality: null });

  function save() {
    timer = null;
    if (!enabled() || !SancordConnection.canWrite() || !state.selfUser) return;
    const current = getActiveTextChannelId();
    const ordered = [...new Set([current, ...Object.keys(state.chatHistory || {})])].filter(Boolean);
    const history = {};
    const snapshot = {
      date: Date.now(), username: state.selfUser.username.toLowerCase(),
      route: { server: state.activeServerId, channel: state.currentTextChannel, dm: state.activeDmId, view: state.activeView },
      welcome: {
        user: noVoice(state.selfUser), servers: state.servers, prefs: state.prefs,
        users: [...state.users.values()].map(noVoice), chat_history: history,
        voice_members: {}, ice_servers: [], read_states: [...(state.readStates || [])].map(([channel_id, read]) => ({ channel_id, ...read })),
        composer_capabilities: [...(state.composerCapabilities || [])], history_page_size: 1,
      },
      social,
    };
    const encoder = new TextEncoder();
    const fits = text => encoder.encode(text).byteLength <= 60 * 1024;
    let serialized = JSON.stringify(snapshot);
    if (!fits(serialized)) {
      snapshot.welcome.users = [];
      serialized = JSON.stringify(snapshot);
    }
    if (!fits(serialized)) {
      snapshot.welcome.servers = state.servers.filter(server => server.id === snapshot.route.server);
      serialized = JSON.stringify(snapshot);
    }
    if (!fits(serialized)) {
      snapshot.social = null;
      serialized = JSON.stringify(snapshot);
    }
    if (!fits(serialized)) return;
    for (const id of ordered.slice(0, 32)) {
      if (!state.chatHistory[id]?.length) continue;
      history[id] = state.chatHistory[id].slice(id === current ? -24 : -8)
        .map(message => message.image_url?.startsWith("data:") ? { ...message, image_url: null, offline_missing_image: true } : message);
      const candidate = JSON.stringify(snapshot);
      if (fits(candidate)) serialized = candidate;
      else delete history[id];
    }
    void SancordSessions.set(localStorage, key, serialized);
  }

  function updated(type, payload) {
    if (!enabled() || !/^(Welcome|FriendsSync|SelfUpdated|ServersSync|ServerCreated|ServerRemoved|ServerUpdated|ServerAccessUpdated|ChannelCreated|ChannelUpdated|ChannelDeleted|NewChatMessage|MessageUpdated|MessageDeleted|ReactionUpdated|ReadStateUpdated)$/.test(type)) return;
    if (type === "FriendsSync") {
      const { dm_history, ...rest } = payload;
      social = rest;
    }
    if (!timer) timer = setTimeout(save, 600);
  }

  async function restore() {
    if (!enabled() || !getStoredUsername()) return false;
    try {
      const snapshot = JSON.parse(SancordSessions.get(localStorage, key) || "null");
      if (!snapshot || snapshot.username !== getStoredUsername().toLowerCase() || Date.now() - snapshot.date > ttl) return false;
      state.activeServerId = snapshot.route.server;
      state.currentTextChannel = snapshot.route.channel;
      await handleServerMessage({ type: "Welcome", payload: snapshot.welcome, cached: true });
      if (snapshot.social) await handleServerMessage({ type: "FriendsSync", payload: snapshot.social, cached: true });
      if (snapshot.route.view === "home" || !getActiveServer()) {
        if (snapshot.route.dm && findPrivateConv(snapshot.route.dm)) openDmConversation(snapshot.route.dm);
        else switchToHomeFriendsView();
      } else switchToServerView();
      return true;
    } catch (_) {
      clear();
      return false;
    }
  }

  return { clear, updated, restore };
})();
const SanvoOfflineCache = SancordOfflineCache;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoOfflineCache = SancordOfflineCache;
  globalThis.SancordOfflineCache = SancordOfflineCache; // LEGACY COMPATIBILITY
}
