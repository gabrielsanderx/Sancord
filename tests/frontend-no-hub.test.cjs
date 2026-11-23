// Sem o hub público "sancord": conta sem servidor abre no Início, e excluir o último
// servidor também volta para lá.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

const welcome = servers => `handleServerMessage({ type: 'Welcome', payload: {
  user: { id: 'u1', username: 'Nova', avatar_color: '#7862d4' }, servers: ${JSON.stringify(servers)},
  text_channels: [], voice_channels: [], voice_members: {}, users: [], chat_history: {}, prefs: null } })`;

test('conta nova sem servidor abre no Início, sem servidor "sancord"', async t => {
  const h = await openInterface(t);
  await h.run(welcome([]));
  await h.flush();
  assert.equal(h.run('state.activeServerId'), null);
  assert.equal(h.run('state.activeView'), 'home');
  assert.equal(h.run('state.servers.length'), 0);
  assert.equal(h.document.querySelector('[data-server-id="sancord"]'), null);
  const get = id => h.document.getElementById(id);
  assert.equal(get('home-first-steps').classList.contains('hidden'), false);
  get('first-create-server').focus();
  get('first-create-server').click();
  assert.equal(h.document.activeElement.id, 'create-srv-name-input');
  get('create-srv-cancel-btn').click();
  assert.equal(h.document.activeElement.id, 'first-create-server');
  get('first-join-server').click();
  assert.equal(h.document.activeElement.id, 'join-srv-code-input');
  get('join-srv-cancel-btn').click();
  get('first-add-friend').click();
  assert.equal(h.document.activeElement.id, 'add-friend-input');
  assert.equal(get('home-first-steps').classList.contains('hidden'), true);
});

test('excluir o último servidor volta para o Início', async t => {
  const h = await openInterface(t);
  const own = { id: 's1', name: 'Meu', text_channels: [{ id: 'c1', name: 'geral', kind: 'text' }], voice_channels: [], categories: [], roles: [] };
  await h.run(welcome([own]));
  await h.flush();
  assert.equal(h.run('state.activeServerId'), 's1');
  h.run('switchToHomeFriendsView()');
  assert.equal(h.document.getElementById('home-first-steps').classList.contains('hidden'), true);
  await h.run(`handleServerMessage({ type: 'ServerRemoved', payload: { server_id: 's1', reason: null } })`);
  await h.flush();
  assert.equal(h.run('state.activeServerId'), null);
  assert.equal(h.run('state.activeView'), 'home');
  assert.equal(h.document.getElementById('home-first-steps').classList.contains('hidden'), false);
});
