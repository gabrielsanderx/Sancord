// Castigo (timeout): estado exibido, horário de término e quando os botões aparecem.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/advanced.js'), 'utf8');

const srv = {
  id: 'srv1', owner_username: 'dona', members: ['dona', 'mod', 'comum', 'admin', 'veterana'],
  member_timeouts: { comum: 2_000_000, antigo: 500 },
  roles: [
    { id: 'everyone', position: 0, permissions: {} },
    { id: 'moderacao', position: 2, permissions: { moderate_members: true } },
    { id: 'admin', position: 5, permissions: { administrator: true } },
    { id: 'veteranos', position: 3, permissions: {} },
  ],
  member_roles: { mod: ['moderacao'], admin: ['admin'], veterana: ['veteranos'] },
};

function load(self) {
  const sent = [];
  const context = vm.createContext({
    Date, Number, String, Math, sent,
    state: { selfUser: { username: self } },
    isServerOwner: (s, u) => s.owner_username === String(u).toLowerCase(),
    getUserServerRoles: (s, u) => (s.member_roles[String(u).toLowerCase()] || []).map((id) => s.roles.find((r) => r.id === id)),
    getServerPermissionsFor: (s, u) => {
      const p = {};
      for (const r of (s.member_roles[String(u).toLowerCase()] || []).map((id) => s.roles.find((x) => x.id === id))) Object.assign(p, r.permissions);
      return p;
    },
    sendWs: (type, payload) => sent.push({ type, payload }),
  });
  const choices = source.indexOf('const TIMEOUT_CHOICES');
  vm.runInContext(source.slice(choices, source.indexOf('];', choices) + 2), context);
  for (const name of ['memberTimeoutUntil', 'formatTimeoutEnd', 'canTimeoutMember', 'timeoutMenuItems']) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context;
}

test('castigo só vale até o fim do prazo e ignora maiúsculas', () => {
  const c = load('mod');
  assert.equal(c.memberTimeoutUntil(srv, 'Comum', 1_000_000), 2_000_000);
  assert.equal(c.memberTimeoutUntil(srv, 'comum', 2_000_000), null, 'no instante final já acabou');
  assert.equal(c.memberTimeoutUntil(srv, 'antigo', 1_000_000), null, 'registro vencido não conta');
  assert.equal(c.memberTimeoutUntil(null, 'comum'), null);
});

test('horário de término: só a hora no mesmo dia, data e hora em outro dia', () => {
  const c = load('mod');
  const now = new Date(2026, 10, 18, 10, 0).getTime();
  assert.match(c.formatTimeoutEnd(new Date(2026, 10, 18, 14, 30).getTime(), now), /^14:30$/);
  assert.match(c.formatTimeoutEnd(new Date(2026, 10, 20, 9, 5).getTime(), now), /20\/11.*09:05/);
});

test('botão de castigo segue a regra do servidor', () => {
  const mod = load('mod');
  assert.equal(mod.canTimeoutMember(srv, 'comum'), true);
  assert.equal(mod.canTimeoutMember(srv, 'mod'), false, 'a si mesmo');
  assert.equal(mod.canTimeoutMember(srv, 'dona'), false, 'dono');
  assert.equal(mod.canTimeoutMember(srv, 'admin'), false, 'administrador');
  assert.equal(mod.canTimeoutMember(srv, 'veterana'), false, 'cargo acima');
  assert.equal(mod.canTimeoutMember(srv, 'desconhecido'), false, 'não membro');
  assert.equal(mod.canTimeoutMember({ ...srv, id: 'sancord' }, 'comum'), false, 'hub público');
  assert.equal(load('comum').canTimeoutMember(srv, 'veterana'), false, 'sem permissão');
  assert.equal(load('dona').canTimeoutMember(srv, 'veterana'), true, 'dono pode em qualquer membro');
});

test('menu oferece aplicar ou remover conforme o estado', () => {
  const c = load('mod');
  const active = { ...srv, member_timeouts: { comum: Date.now() + 60_000 } };
  const [remove] = c.timeoutMenuItems(active, 'comum', 'Comum');
  assert.match(remove.label, /^Remover castigo \(até /);
  const [apply] = c.timeoutMenuItems({ ...srv, member_timeouts: {} }, 'comum', 'Comum');
  assert.equal(apply.label, 'Aplicar castigo…');
  assert.equal(c.timeoutMenuItems(srv, 'veterana', 'Veterana').length, 0);
});
