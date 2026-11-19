// Etapa C4: menu completo do usuário na lista de membros e apelido por servidor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t, me = 'Mod') {
  const h = await openInterface(t);
  h.w.__me = me;
  h.run(`
    globalThis.__sent = [];
    sendWs = (type, payload) => { __sent.push([type, payload]); return true; };
    state.selfUser = { id: 'u-' + __me.toLowerCase(), username: __me };
    state.friends = []; state.incomingRequests = []; state.outgoingRequests = [{ username: 'Pendente' }];
    globalThis.__srv = {
      id: 's1', name: 'Servidor', owner_username: 'dona',
      members: ['dona', 'mod', 'ana', 'pendente', 'chefe'],
      roles: [
        { id: 'everyone', name: '@everyone', position: 0, permissions: { change_nickname: true } },
        { id: 'r-mod', name: 'Moderação', position: 5, permissions: { manage_nicknames: true, manage_roles: true, kick_members: true } },
        { id: 'r-chefe', name: 'Chefia', position: 9, permissions: {} },
        { id: 'r-baixo', name: 'Turma', position: 2, permissions: {} },
      ],
      member_roles: { mod: ['r-mod'], chefe: ['r-chefe'], ana: ['r-baixo'] },
      member_nicks: { ana: 'Aninha' },
      text_channels: [{ id: 'c1', name: 'geral', kind: 'text' }], voice_channels: [], categories: [],
    };
    state.servers = [__srv];
  `);
  return h;
}

const labels = (items) => items.filter((i) => i.label).map((i) => i.label);

test('nome exibido: apelido no canal do servidor; nome de usuário fora dele', async t => {
  const h = await setup(t);
  assert.equal(h.run('displayNameIn("c1", "Ana")'), 'Aninha');
  assert.equal(h.run('displayNameIn("c1", "Chefe")'), 'Chefe');
  assert.equal(h.run('displayNameIn("dm:ana__mod", "Ana")'), 'Ana');
  const el = h.run('buildMessageElementV2({ id: "m1", channel_id: "c1", author_name: "Ana", content: "oi", created_at: Date.now() })');
  const author = el.querySelector('.message-author');
  assert.equal(author.textContent, 'Aninha');
  assert.equal(author.getAttribute('title'), '@Ana');
});

test('apelido: o próprio com change_nickname; outros só abaixo na hierarquia e nunca o dono', async t => {
  const h = await setup(t);
  assert.equal(h.run('canChangeNickname(__srv, "mod")'), true, 'o próprio');
  assert.equal(h.run('canChangeNickname(__srv, "ana")'), true, 'abaixo (Turma < Moderação)');
  assert.equal(h.run('canChangeNickname(__srv, "chefe")'), false, 'acima (Chefia)');
  assert.equal(h.run('canChangeNickname(__srv, "dona")'), false, 'dono');
  assert.equal(h.run('canEditMemberRoles(__srv, "ana")'), true);
  assert.equal(h.run('canEditMemberRoles(__srv, "mod")'), false, 'não edita os próprios cargos');
  // De castigo, nem o próprio.
  h.run('__srv.member_timeouts = { mod: Date.now() + 60000 }');
  assert.equal(h.run('canChangeNickname(__srv, "mod")'), false);
  // Membro comum só muda o próprio.
  const h2 = await setup(t, 'Ana');
  assert.equal(h2.run('canChangeNickname(__srv, "ana")'), true);
  assert.equal(h2.run('canChangeNickname(__srv, "pendente")'), false);
  h2.run('__srv.roles[0].permissions.change_nickname = false');
  assert.equal(h2.run('canChangeNickname(__srv, "ana")'), false, '@everyone sem change_nickname');
});

test('menu completo do membro: ações sociais, apelido, cargos e moderação', async t => {
  const h = await setup(t);
  const items = h.run('memberUserMenuItems(__srv, { id: "u-ana", username: "Ana" }, () => {})');
  const l = labels(items);
  for (const want of ['Ver perfil', 'Mensagem', 'Ligar', 'Adicionar amigo', 'Mudar apelido…', 'Cargos…', 'Copiar nome de usuário', 'Copiar ID do usuário', 'Bloquear', 'Expulsar do servidor…']) {
    assert.ok(l.includes(want), `falta "${want}" em ${l.join(' | ')}`);
  }
  assert.equal(items[0].header, 'Aninha (@Ana)');

  const pending = labels(h.run('memberUserMenuItems(__srv, { username: "Pendente" }, () => {})'));
  assert.ok(pending.includes('Pedido de amizade enviado'));
  assert.ok(!pending.includes('Adicionar amigo'));

  const self = labels(h.run('memberUserMenuItems(__srv, { id: "u-mod", username: "Mod" }, () => {})'));
  assert.ok(self.includes('Editar meu apelido…'));
  for (const no of ['Mensagem', 'Ligar', 'Bloquear', 'Cargos…', 'Expulsar do servidor…']) assert.ok(!self.includes(no), `não deveria ter "${no}"`);

  const boss = labels(h.run('memberUserMenuItems(__srv, { username: "Chefe" }, () => {})'));
  assert.ok(!boss.includes('Mudar apelido…') && !boss.includes('Cargos…'), 'acima na hierarquia');

  // "Ligar" abre a DM e marca a chamada pendente.
  items.find((i) => i.label === 'Ligar').onSelect();
  assert.equal(h.run('state.pendingCallPeer'), 'ana');
  assert.equal(h.run('JSON.stringify(__sent[__sent.length - 1])'), '["OpenDm",{"target_username":"Ana"}]');
});

test('diálogos: apelido envia limpo ou remove; cargos mantêm os de cima marcados', async t => {
  const h = await setup(t), d = h.document;
  h.run('openNicknameDialog(__srv, "ana", "Ana")');
  await h.flush();
  const input = [...d.querySelectorAll('.sancord-dialog-field input')].pop();
  assert.equal(input.value, 'Aninha');
  input.value = '  Ana B  ';
  [...d.querySelectorAll('.modal-actions-row button[type="submit"]')].pop().click();
  await h.flush();
  assert.equal(h.run('JSON.stringify(__sent[__sent.length - 1])'), '["SetMemberNickname",{"server_id":"s1","target_username":"ana","nickname":"Ana B"}]');

  h.run('openNicknameDialog(__srv, "ana", "Ana")');
  await h.flush();
  [...d.querySelectorAll('.sancord-dialog-extra')].pop().click();
  await h.flush();
  assert.equal(h.run('JSON.stringify(__sent[__sent.length - 1])'), '["SetMemberNickname",{"server_id":"s1","target_username":"ana","nickname":null}]');

  // Cargos: Chefia (acima) vem desativada; marcar Moderação? também acima/igual → desativada.
  h.run('__srv.member_roles.ana = ["r-baixo", "r-chefe"]');
  h.run('openMemberRolesDialog(__srv, "ana", "Aninha")');
  await h.flush();
  const boxes = [...[...d.querySelectorAll('.sancord-checklist')].pop().querySelectorAll('input')];
  const byLabel = Object.fromEntries(boxes.map((b) => [b.parentElement.querySelector('span').textContent, b]));
  assert.equal(byLabel['Chefia'].disabled, true);
  assert.equal(byLabel['Chefia'].checked, true);
  assert.equal(byLabel['Moderação'].disabled, true);
  assert.equal(byLabel['Turma'].disabled, false);
  byLabel['Turma'].click();
  [...d.querySelectorAll('.modal-actions-row button[type="submit"]')].pop().click();
  await h.flush();
  assert.equal(h.run('JSON.stringify(__sent[__sent.length - 1])'), '["AssignUserRoles",{"server_id":"s1","target_username":"ana","role_ids":["r-chefe"]}]');
});
