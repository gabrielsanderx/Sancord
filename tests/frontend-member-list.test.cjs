// Testes da lista lateral de membros: agrupamento por cargos destacados,
// hierarquia, Disponível, Offline, Owner, Bots/Apps, voz e reatividade realtime.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');
const ML = require('../static/js/member-list.js');

const ROLES = [
  { id: 'everyone', name: '@everyone', color: '#b5bac1', position: 0, hoist: false },
  { id: 'r-vip', name: 'VIP', color: '#f1c40f', position: 50, hoist: false },
  { id: 'r-mod', name: 'MODERADOR', color: '#2ecc71', position: 80, hoist: true },
  { id: 'r-admin', name: 'ADMINISTRADOR', color: '#3498db', position: 90, hoist: true },
  { id: 'r-founder', name: 'FUNDADOR', color: '#e74c3c', position: 100, hoist: true },
  { id: 'r-bots', name: "| 💻 | Bot's", color: '#5865f2', position: 70, display_separately: true },
];

test('buildMemberGroups: zero cargos, presença (online/away/idle/dnd/offline/invisible) e sem seções vazias', () => {
  const members = [
    { id: '1', username: 'Ana', status_kind: 'online' },
    { id: '2', username: 'Bruno', status_kind: 'away' },
    { id: '3', username: 'Carla', status_kind: 'idle' },
    { id: '4', username: 'Diego', status_kind: 'dnd' },
    { id: '5', username: 'Eva', status_kind: 'offline' },
    { id: '6', username: 'Fábio', status_kind: 'invisible' },
  ];
  const groups = ML.buildMemberGroups(members, ROLES, { memberRoles: {} });
  assert.deepEqual(groups.map(g => [g.kind, g.label, g.count]), [
    ['available', 'Disponível', 4],
    ['offline', 'Offline', 2],
  ]);
  assert.deepEqual(groups[0].members.map(m => [m.username, m.status]), [
    ['Ana', 'online'],
    ['Bruno', 'idle'],
    ['Carla', 'idle'],
    ['Diego', 'dnd'],
  ]);
  assert.deepEqual(groups[1].members.map(m => m.username), ['Eva', 'Fábio']);

  // Lista vazia não cria grupos vazios.
  assert.deepEqual(ML.buildMemberGroups([], ROLES, {}), []);
  // Apenas offline não cria Disponível — 0.
  const onlyOff = ML.buildMemberGroups([{ id: '5', username: 'Eva', status_kind: 'offline' }], ROLES, {});
  assert.deepEqual(onlyOff.map(g => [g.kind, g.label, g.count]), [['offline', 'Offline', 1]]);
});

test('buildMemberGroups: hierarquia estrita, sem duplicação com múltiplos cargos destacados e cor independente de hoist', () => {
  const members = [
    { id: '1', username: 'Swag', status_kind: 'online' },
    { id: '2', username: 'Gabriel', status_kind: 'dnd' },
    { id: '3', username: 'Lucas', status_kind: 'idle' },
    { id: '4', username: 'Marcos', status_kind: 'offline' },
    // Entrada duplicada na origem não pode duplicar na saída.
    { id: '1b', username: 'swag', status_kind: 'online' },
  ];
  const memberRoles = {
    swag: ['r-vip', 'r-mod', 'r-admin', 'r-founder'],
    gabriel: ['r-vip', 'r-mod', 'r-admin'],
    lucas: ['r-vip'], // cargo NÃO destacado (hoist: false), mas define cor!
    marcos: ['r-founder'], // offline com cargo destacado -> vai para Offline sem duplicar
  };
  const groups = ML.buildMemberGroups(members, ROLES, { memberRoles, ownerUsername: 'swag' });

  // Ordem estritamente pela posição (100 > 90 > Disponível > Offline), nunca alfabética.
  assert.deepEqual(groups.map(g => [g.kind, g.label, g.count]), [
    ['role', 'FUNDADOR', 1],
    ['role', 'ADMINISTRADOR', 1],
    ['available', 'Disponível', 1],
    ['offline', 'Offline', 1],
  ]);

  // Cada usuário aparece exatamente uma vez no total.
  const all = groups.flatMap(g => g.members.map(m => m.lowerUsername));
  assert.equal(all.length, 4);
  assert.equal(new Set(all).size, 4);

  // Swag só em FUNDADOR, com flag isOwner.
  assert.equal(groups[0].members[0].username, 'Swag');
  assert.equal(groups[0].members[0].isOwner, true);
  assert.equal(groups[0].members[0].roleColor, '#e74c3c');

  // Gabriel só em ADMINISTRADOR (não em MODERADOR nem VIP).
  assert.equal(groups[1].members[0].username, 'Gabriel');
  assert.equal(groups[1].members[0].roleColor, '#3498db');

  // Lucas está em Disponível (VIP não é destacado), mas mantém a cor do cargo VIP.
  assert.equal(groups[2].members[0].username, 'Lucas');
  assert.equal(groups[2].members[0].roleColor, '#f1c40f');

  // Marcos offline vai para Offline, mantendo a referência de cor no modelo.
  assert.equal(groups[3].members[0].username, 'Marcos');
  assert.equal(groups[3].members[0].offline, true);
});

test('buildMemberGroups: owner sem cargo destacado e bots com/sem cargo destacado (sem hardcode)', () => {
  const roles = [
    { id: 'r-deus', name: '👑 DEUS', color: '#e74c3c', position: 100, hoist: true },
    { id: 'r-bots', name: "| 💻 | Bot's", color: '#5865f2', position: 50, hoist: true },
  ];
  // 1) Owner SEM cargo destacado NÃO cria seção "OWNER" nem "FUNDADOR".
  const ownerNoRole = ML.buildMemberGroups(
    [{ id: 'o1', username: 'Dono', status_kind: 'online' }],
    roles,
    { memberRoles: {}, ownerUsername: 'dono' }
  );
  assert.deepEqual(ownerNoRole.map(g => [g.kind, g.label, g.count]), [['available', 'Disponível', 1]]);
  assert.equal(ownerNoRole[0].members[0].isOwner, true);

  // 2) Referência completa: DEUS (Swag), Bot's (Xenon bot), Disponível (Jockie bot sem cargo), Offline.
  const refGroups = ML.buildMemberGroups(
    [
      { id: 'u1', username: 'Swag', status_kind: 'online' },
      { id: 'b1', username: 'Xenon', status_kind: 'online', is_bot: true },
      { id: 'b2', username: 'Jockie Music', status_kind: 'online', is_bot: true },
      { id: 'u2', username: 'MembroOff', status_kind: 'offline' },
    ],
    roles,
    {
      memberRoles: { swag: ['r-deus'], xenon: ['r-bots'] },
      ownerUsername: 'swag',
    }
  );
  assert.deepEqual(refGroups.map(g => [g.label, g.count, g.members.map(m => m.username)]), [
    ['👑 DEUS', 1, ['Swag']],
    ["| 💻 | Bot's", 1, ['Xenon']],
    ['Disponível', 1, ['Jockie Music']],
    ['Offline', 1, ['MembroOff']],
  ]);
  assert.equal(refGroups[1].members[0].isBot, true);
  assert.equal(refGroups[2].members[0].isBot, true);
});

test('buildMemberGroups: cor vem do cargo mais alto que define cor, mesmo se o cargo superior não tiver cor', () => {
  const roles = [
    { id: 'r-top-nocolor', name: 'Staff', color: '', position: 100, hoist: true },
    { id: 'r-color', name: 'Rubi', color: '#e91e63', position: 50, hoist: false },
  ];
  const groups = ML.buildMemberGroups(
    [{ id: 'u1', username: 'Bia', status_kind: 'online' }],
    roles,
    { memberRoles: { bia: ['r-top-nocolor', 'r-color'] } }
  );
  assert.equal(groups[0].label, 'Staff');
  assert.equal(groups[0].members[0].roleColor, '#e91e63');
});

test('DOM e realtime: sem MEMBROS ONLINE, coroa depois do nome, badge APP, voz com permissão, mutações realtime e cache de render', async t => {
  const h = await openInterface(t);
  const d = h.document;

  h.run(`
    state.selfUser = { id: 'u-swag', username: 'Swag', status_kind: 'online', avatar_color: '#e74c3c' };
    state.servers = [{
      id: 'srv-1',
      name: 'Só tristeza',
      owner_username: 'swag',
      members: ['swag', 'xenon', 'gabriel', 'jockie music', 'offuser'],
      roles: [
        { id: 'everyone', name: '@everyone', color: '#b5bac1', position: 0, hoist: false, permissions: { view_channel: true, send_messages: true } },
        { id: 'r-deus', name: 'DEUS', color: '#e74c3c', position: 100, hoist: true, badge_emoji: '👑', permissions: { administrator: true } },
        { id: 'r-mod', name: 'MODERADOR', color: '#2ecc71', position: 80, hoist: true, permissions: {} },
        { id: 'r-bots', name: "BOT'S", color: '#5865f2', position: 60, hoist: true, permissions: {} },
      ],
      member_roles: {
        swag: ['r-deus'],
        xenon: ['r-bots'],
      },
      text_channels: [{ id: 'c1', name: 'geral', kind: 'text' }],
      voice_channels: [
        { id: 'v-priv', name: 'Call Privada', kind: 'voice', effective_permissions: { view_channel: true } },
        { id: 'v-secret', name: 'Sala Secreta', kind: 'voice', effective_permissions: { view_channel: false } },
      ],
      categories: [],
    }];
    state.activeServerId = 'srv-1';
    state.activeView = 'server';
    state.currentTextChannel = 'c1';
    state.voiceChannels = state.servers[0].voice_channels;
    state.users = new Map([
      ['u-swag', { id: 'u-swag', username: 'Swag', status_kind: 'online', avatar_color: '#e74c3c', voice_channel_id: 'v-priv' }],
      ['u-xenon', { id: 'u-xenon', username: 'Xenon', status_kind: 'online', is_bot: true, avatar_color: '#5865f2' }],
      ['u-gab', { id: 'u-gab', username: 'Gabriel', status_kind: 'idle', avatar_color: '#3498db', voice_channel_id: 'v-secret' }],
      ['u-jock', { id: 'u-jock', username: 'Jockie Music', status_kind: 'dnd', is_bot: true, avatar_color: '#9b59b6', custom_status: '🎧 Tocando lo-fi' }],
    ]);
    renderMembersSidebar();
  `);

  // 1) Sem cabeçalho global MEMBROS ONLINE.
  assert.equal(d.getElementById('online-count-title').classList.contains('hidden'), true);
  assert.equal(d.getElementById('online-count-title').textContent, '');

  // 2) Cabeçalhos exatos na ordem hierárquica, sem emojis injetados automaticamente no cabeçalho do cargo.
  const headers = () => [...d.querySelectorAll('#members-list .member-group-header')].map(el => el.textContent);
  assert.deepEqual(headers(), ['DEUS — 1', "BOT'S — 1", 'Disponível — 2', 'Offline — 1']);

  // 3) Owner crown aparece pequena DEPOIS do nome (nunca antes) e APP badge nos bots.
  const swagRow = d.querySelector('[data-member-username="swag"]');
  assert.ok(swagRow.querySelector('.member-owner-crown'), 'Owner deve ter coroa');
  const swagRowChildren = [...swagRow.querySelector('.member-name-row').children];
  assert.equal(swagRowChildren[0].classList.contains('member-name'), true);
  assert.equal(swagRowChildren[1].classList.contains('member-owner-crown'), true);
  assert.equal(swagRow.querySelector('.member-activity').textContent, '🔊 Call Privada');

  const xenonRow = d.querySelector('[data-member-username="xenon"]');
  assert.equal(xenonRow.querySelector('.member-app-badge')?.textContent, 'APP');
  assert.equal(xenonRow.querySelector('.member-activity'), null);

  // 4) Canal de voz sem permissão de visualização não vaza para o usuário.
  const gabRow = d.querySelector('[data-member-username="gabriel"]');
  assert.equal(gabRow.querySelector('.member-activity'), null);

  // 5) Status personalizado aparece na linha secundária.
  const jockRow = d.querySelector('[data-member-username="jockie music"]');
  assert.equal(jockRow.querySelector('.member-activity')?.textContent, '🎧 Tocando lo-fi');
  assert.equal(jockRow.querySelector('.member-app-badge')?.textContent, 'APP');

  // 6) Performance: segunda chamada sem mudanças não recria o DOM.
  const firstSwagEl = swagRow;
  h.run('renderMembersSidebar()');
  assert.equal(d.querySelector('[data-member-username="swag"]'), firstSwagEl);

  // 7) Realtime: atribuir MODERADOR ao Gabriel move de Disponível -> MODERADOR sem duplicar.
  h.run(`{
    const next = JSON.parse(JSON.stringify(state.servers[0]));
    next.member_roles.gabriel = ['r-mod'];
    handleServerMessage({ type: 'ServerUpdated', payload: { server: next } });
  }`);
  assert.deepEqual(headers(), ['DEUS — 1', 'MODERADOR — 1', "BOT'S — 1", 'Disponível — 1', 'Offline — 1']);
  assert.equal(d.querySelectorAll('[data-member-username="gabriel"]').length, 1);

  // 8) Realtime: alterar hierarquia (BOT'S acima de MODERADOR) reordena imediatamente.
  h.run(`{
    const next = JSON.parse(JSON.stringify(state.servers[0]));
    next.roles.find(r => r.id === 'r-bots').position = 95;
    handleServerMessage({ type: 'ServerUpdated', payload: { server: next } });
  }`);
  assert.deepEqual(headers(), ['DEUS — 1', "BOT'S — 1", 'MODERADOR — 1', 'Disponível — 1', 'Offline — 1']);

  // 9) Realtime: desligar hoist (display_separately) de MODERADOR remove a seção e devolve Gabriel a Disponível.
  h.run(`{
    const next = JSON.parse(JSON.stringify(state.servers[0]));
    next.roles.find(r => r.id === 'r-mod').hoist = false;
    handleServerMessage({ type: 'ServerUpdated', payload: { server: next } });
  }`);
  assert.deepEqual(headers(), ['DEUS — 1', "BOT'S — 1", 'Disponível — 2', 'Offline — 1']);

  // 10) Realtime: remover cargo destacado do Swag move para Disponível (ainda mantendo a coroa de owner, sem criar seção OWNER).
  h.run(`{
    const next = JSON.parse(JSON.stringify(state.servers[0]));
    delete next.member_roles.swag;
    handleServerMessage({ type: 'ServerUpdated', payload: { server: next } });
  }`);
  assert.deepEqual(headers(), ["BOT'S — 1", 'Disponível — 3', 'Offline — 1']);
  assert.ok(d.querySelector('[data-member-username="swag"] .member-owner-crown'));
});
