// Mensagens antigas sempre mostram o perfil atual do autor (avatar, decoração, nome),
// mesmo com o autor offline, reconectado com outra sessão ou em DM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    sendWs = () => true;
    const channel = { id: "c1", name: "geral", kind: "text" };
    state.activeView = "server";
    state.activeServerId = "s1";
    state.currentTextChannel = channel.id;
    state.textChannels = [channel];
    state.selfUser = { id: "me", username: "Swag" };
    state.users.clear();
    state.servers = [{ id: "s1", name: "Turma", owner_username: "swag",
      text_channels: [channel], voice_channels: [], members: ["swag", "clara"],
      member_roster: { clara: { username: "clara", display_name: "Clara", avatar_color: "#ff00aa",
        avatar_url: "/api/attachments/novo/clara.png", avatar_decoration: "nebula-orbit", name_style: "neon" } },
    }];
    state.chatHistory.c1 = [
      { id: "m1", channel_id: "c1", author_name: "clara", author_id: "old-1", author_avatar: "/cosmetics/assets/preset_avatar_dream.webp", author_color: "#111111", content: "?", created_at: Date.now() - 60000 },
      { id: "m2", channel_id: "c1", author_name: "clara", author_id: "old-2", author_avatar: "/api/attachments/velho/loira.png", author_color: "#111111", content: "oi", created_at: Date.now() - 1000, reply_to: { id: "m1", author_name: "clara", preview: "?" } },
    ];
    renderChatMessages();
  `);
  return h;
}

const src = (d, id) => d.querySelector(`[data-msg-id="${id}"] .avatar img`)?.getAttribute('src') || '';

test('autor offline: mensagens antigas usam o perfil atual do roster do servidor', async t => {
  const h = await setup(t), d = h.document;
  for (const id of ['m1', 'm2']) {
    assert.match(src(d, id), /novo\/clara\.png$/, id);
    assert.ok(d.querySelector(`[data-msg-id="${id}"] .avatar-status-wrap.deco-nebula-orbit`), id);
    assert.ok(d.querySelector(`[data-msg-id="${id}"] .message-author.name-style-neon`), id);
    assert.equal(d.querySelector(`[data-msg-id="${id}"] .message-author`).textContent, 'Clara');
  }
});

test('reconexão com nova sessão atualiza todas as mensagens antigas', async t => {
  const h = await setup(t), d = h.document;
  await h.run(`handleServerMessage({ type: "VoiceStateSync", payload: { voice_members: {}, users: [
    { id: "sessao-nova", username: "clara", display_name: "Clara", avatar_color: "#ff00aa",
      avatar_url: "/api/attachments/outro/clara2.gif", avatar_decoration: "sakura-fall", name_style: "retro" },
  ] } })`);
  for (const id of ['m1', 'm2']) {
    assert.match(d.querySelector(`[data-msg-id="${id}"] .avatar img`).dataset.profileSrc || src(d, id), /outro\/clara2\.gif$/, id);
    assert.ok(d.querySelector(`[data-msg-id="${id}"] .avatar-status-wrap.deco-sakura-fall`), id);
  }
  assert.equal(h.run('state.chatHistory.c1[0].author_avatar'), '/api/attachments/outro/clara2.gif');
  // Ao sair, o perfil continua o mais recente.
  await h.run(`handleServerMessage({ type: "UserLeft", payload: { user_id: "sessao-nova" } })`);
  h.run('renderChatMessages()');
  assert.ok(d.querySelector('[data-msg-id="m1"] .avatar-status-wrap.deco-sakura-fall'));
});

test('DM: perfil do par atualiza mensagens antigas e nome exibido', async t => {
  const h = await setup(t), d = h.document;
  await h.run(`
    state.activeView = "home";
    state.activeDmId = "dm:clara__swag";
    state.chatHistory["dm:clara__swag"] = [
      { id: "d1", channel_id: "dm:clara__swag", author_name: "clara", author_id: "x", author_avatar: "/velho.png", author_color: "#111111", content: "oi", created_at: Date.now() },
    ];
    handleServerMessage({ type: "FriendsSync", payload: {
      friends: [], incoming_requests: [], outgoing_requests: [], blocked: [], message_requests: [], groups: [],
      dm_conversations: [{ dm_id: "dm:clara__swag", peer: { username: "clara", display_name: "Clara ✨", avatar_color: "#ff00aa",
        avatar_url: "/api/attachments/dm/clara.png", avatar_decoration: "nebula-orbit", online: false, status_kind: "invisible" } }],
    } });
  `);
  assert.match(src(d, 'd1'), /dm\/clara\.png$/);
  assert.ok(d.querySelector('[data-msg-id="d1"] .avatar-status-wrap.deco-nebula-orbit'));
  assert.equal(d.querySelector('[data-msg-id="d1"] .message-author').textContent, 'Clara ✨');
});
