// Etapa C3: silenciar por tempo (servidor/categoria/canal/thread/conversa) e caixa de menções.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    globalThis.__sent = [];
    sendWs = (type, payload) => { __sent.push([type, payload]); return true; };
    state.selfUser = { id: 'u-eu', username: 'Eu' };
    state.servers = [{ id: 's1', name: 'Servidor', text_channels: [
      { id: 'c1', name: 'geral', category_id: 'k1', kind: 'text' },
      { id: 'c2', name: 'solto', kind: 'text' },
    ], voice_channels: [], categories: [{ id: 'k1', name: 'Conversa' }] }];
    state.threadIndex = new Map([['t1', { id: 't1', name: 'fio', parent_id: 'c1', server_id: 's1' }]]);
    state.prefs = { guild_layout: [], muted_servers: [], collapsed_categories: [], mutes: {} };
  `);
  return h;
}

test('silêncio da categoria vale para os canais dela e suas threads, com prazo', async t => {
  const h = await setup(t);
  const before = Date.now();
  h.run('setMute("k1", 60, "Conversa")');
  const [type, payload] = h.run('__sent[__sent.length - 1]');
  assert.equal(type, 'UpdateUserPrefs');
  assert.ok(payload.mutes.k1 >= before + 3600000 && payload.mutes.k1 <= Date.now() + 3600000);
  assert.equal(h.run('isChannelMuted("c1")'), true, 'canal da categoria');
  assert.equal(h.run('isChannelMuted("t1")'), true, 'thread do canal da categoria');
  assert.equal(h.run('isChannelMuted("c2")'), false, 'canal fora da categoria');
  assert.equal(h.run('isServerMuted("s1")'), false);

  // Vencido não conta; 0 é "até reativar".
  h.run('state.prefs.mutes = { c2: Date.now() - 1, "dm:eu:ana": 0 }');
  assert.equal(h.run('isChannelMuted("c2")'), false);
  assert.equal(h.run('isChannelMuted("c1")'), false);
  assert.equal(h.run('isChannelMuted("dm:eu:ana")'), true);
});

test('silenciado: sem som nem aviso, exceto menção direta; "nada" continua mais forte', async t => {
  const h = await setup(t);
  h.run('state.prefs.mutes = { s1: 0 }');
  const quiet = h.run('notificationPolicy({ channel_id: "c2", author_name: "Ana", content: "oi", mentions: { users: [] } })');
  assert.equal(quiet.sound, false);
  assert.equal(quiet.notify, false);
  const direct = h.run('notificationPolicy({ channel_id: "c2", author_name: "Ana", content: "@Eu", mentions: { users: ["eu"] } })');
  assert.equal(direct.sound, true);
  assert.equal(direct.notify, true);
  h.run('state.prefs.notify_levels = { c2: "none" }');
  assert.equal(h.run('notificationPolicy({ channel_id: "c2", author_name: "Ana", content: "@Eu", mentions: { users: ["eu"] } })').sound, false);
  // Nível explícito no canal vence o silêncio herdado do servidor; o silêncio do próprio canal vence o nível.
  h.run('state.prefs.notify_levels = { c2: "all" }');
  assert.equal(h.run('notificationPolicy({ channel_id: "c2", author_name: "Ana", content: "oi", mentions: { users: [] } })').sound, true);
  h.run('state.prefs.mutes = { c2: 0 }');
  assert.equal(h.run('notificationPolicy({ channel_id: "c2", author_name: "Ana", content: "oi", mentions: { users: [] } })').sound, false);
  // DM silenciada.
  h.run('state.prefs.notify_levels = {}; state.prefs.mutes = { "dm:ana:eu": Date.now() + 60000 }');
  assert.equal(h.run('notificationPolicy({ channel_id: "dm:ana:eu", author_name: "Ana", content: "oi", mentions: { users: [] } })').notify, false);
});

test('menu: "Silenciar" abre as durações; depois vira "Reativar" e limpa o silêncio antigo do servidor', async t => {
  const h = await setup(t), d = h.document;
  const [item] = h.run('muteMenuItems("c2", "canal", "#solto", { x: 10, y: 10 })');
  assert.equal(item.label, 'Silenciar canal');
  item.onSelect();
  const options = [...d.querySelectorAll('.sancord-menu .msg-ctx-item')].map(b => b.textContent);
  assert.deepEqual(options, ['Por 15 minutos', 'Por 1 hora', 'Por 3 horas', 'Por 8 horas', 'Por 24 horas', 'Até eu reativar']);
  d.querySelectorAll('.sancord-menu .msg-ctx-item')[0].click();
  const [again] = h.run('muteMenuItems("c2", "canal", "#solto", {})');
  assert.equal(again.label, 'Reativar canal');
  assert.match(again.hint, /^até /);

  h.run('state.prefs.muted_servers = ["s1"]');
  const [srvItem] = h.run('muteMenuItems("s1", "servidor", "Servidor", {})');
  assert.equal(srvItem.label, 'Reativar servidor');
  srvItem.onSelect();
  const [, payload] = h.run('__sent[__sent.length - 1]');
  assert.equal(JSON.stringify(payload.muted_servers), '[]');
  assert.equal(h.run('isServerMuted("s1")'), false);
});

test('caixa de menções: pede só menções, mostra texto seguro e leva à mensagem', async t => {
  const h = await setup(t), d = h.document;
  d.getElementById('mentions-inbox-btn').click();
  const panel = d.getElementById('mentions-inbox-panel');
  assert.equal(panel.classList.contains('hidden'), false);
  const [type, payload] = h.run('__sent[__sent.length - 1]');
  assert.equal(type, 'SearchMessages');
  assert.equal(payload.mentions_me, true);
  assert.equal(payload.query, '');
  assert.match(payload.request_id, /^inbox/);

  h.run('globalThis.__jumped = null; jumpToMessage = (c, m) => { __jumped = [c, m]; }');
  h.w.__res = { request_id: payload.request_id, has_more: false, hits: [
    { message: { id: 'm9', channel_id: 'c1', author_name: 'Ana', created_at: Date.now(), content: '<img src=x onerror=alert(1)> @Eu' }, channel_name: 'geral', server_id: 's1', server_name: 'Servidor' },
  ] };
  assert.equal(h.run('onInboxResults(__res)'), true);
  const row = d.querySelector('#mentions-inbox-list .inbox-hit');
  assert.equal(row.querySelector('img'), null);
  assert.equal(row.querySelector('.search-hit-where').textContent, 'Servidor • #geral');
  row.click();
  assert.equal(h.run('JSON.stringify(__jumped)'), '["c1","m9"]');
  assert.equal(panel.classList.contains('hidden'), true);

  // Respostas da busca normal não são capturadas pela caixa.
  assert.equal(h.run('onInboxResults({ request_id: "s3", hits: [] })'), false);

  // Também abre pela tela de Amigos (o painel não depende do cabeçalho do chat).
  d.getElementById('friends-inbox-btn').click();
  assert.equal(panel.classList.contains('hidden'), false);
  assert.equal(panel.parentElement, d.body);
  assert.equal(d.getElementById('friends-inbox-btn').getAttribute('aria-expanded'), 'true');
  d.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(panel.classList.contains('hidden'), true);
  assert.equal(d.getElementById('friends-inbox-btn').getAttribute('aria-expanded'), 'false');
});
