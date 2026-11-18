// Fase 5: helpers puros do social.js (nomes de grupo, status com prazo, solicitações).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/social.js'), 'utf8');
function load(names, state) {
  const context = vm.createContext({ state, Date, Set, Map });
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context;
}

const me = { username: 'Ana' };
const names = ['myLowerName', 'findGroupDm', 'groupDisplayName', 'privateConversationPeople', 'findPrivateConv', 'isMessageRequest', 'customStatusText'];

test('nome do grupo: nome próprio ou membros sem eu', () => {
  const state = {
    selfUser: me,
    groupDms: [
      { id: 'gdm:1', name: 'Turma', members: [] },
      { id: 'gdm:2', name: null, members: [{ username: 'Ana' }, { username: 'beto', display_name: 'Beto B' }, { username: 'caio' }] },
    ],
  };
  const c = load(names, state);
  assert.equal(c.groupDisplayName(state.groupDms[0]), 'Turma');
  assert.equal(c.groupDisplayName(state.groupDms[1]), 'Beto B, caio');
  assert.deepEqual(c.privateConversationPeople('gdm:2').map((m) => m.username), ['beto', 'caio']);
});

test('solicitações de mensagem são achadas fora das DMs normais', () => {
  const peer = { username: 'eli' };
  const state = { selfUser: me, dmConversations: [], messageRequests: [{ dm_id: 'dm:ana__eli', peer }], groupDms: [] };
  const c = load(names, state);
  assert.equal(c.isMessageRequest('dm:ana__eli'), true);
  assert.equal(c.isMessageRequest('dm:ana__beto'), false);
  assert.equal(c.findPrivateConv('dm:ana__eli').peer, peer);
  const people = c.privateConversationPeople('dm:ana__eli');
  assert.equal(people.length, 1);
  assert.equal(people[0], peer);
});

test('status personalizado some depois do prazo e mostra o emoji', () => {
  const c = load(names, { selfUser: me });
  assert.equal(c.customStatusText({ custom_status: 'estudando', custom_status_emoji: '📚' }), '📚 estudando');
  assert.equal(c.customStatusText({ custom_status: 'estudando', custom_status_expires_at: Date.now() - 1 }), '');
  assert.equal(c.customStatusText({ custom_status: 'ok', custom_status_expires_at: Date.now() + 60000 }), 'ok');
  assert.equal(c.customStatusText(null), '');
});
