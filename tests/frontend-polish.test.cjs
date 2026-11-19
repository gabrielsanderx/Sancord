// Fase 9: nível de notificação (canal > thread > servidor > padrão) e busca da navegação rápida.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/polish.js'), 'utf8');
function load(state, extra = {}) {
  const context = vm.createContext({
    state, String, Number, Math, Date,
    isPrivateTextId: (id) => /^g?dm:/.test(id),
    isMessageRequest: () => false,
    isOwnMessage: (m) => m.author_name === 'Eu',
    messageMentionsMe: (m) => Boolean(m.mentioned),
    serverForChannel: (id) => (id.startsWith('srv1-') || id === 'thr-1' ? { id: 'srv1' } : null),
    isServerMuted: (id) => (state.muted || []).includes(id),
    ...extra,
  });
  for (const name of ['notifyLevelFor', 'muteUntil', 'isMutedId', 'mutedChannelChain', 'isChannelMuted', 'notificationPolicy', 'normalizeText', 'matchScore', 'rankQuickItems']) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context;
}

test('nível: canal vence thread, que vence servidor; padrão quando nada definido', () => {
  const state = {
    prefs: { notify_levels: { srv1: 'mentions', 'srv1-geral': 'all' } },
    threadIndex: new Map([['thr-1', { parent_id: 'srv1-geral' }]]),
  };
  const c = load(state);
  assert.equal(c.notifyLevelFor('srv1-geral'), 'all');
  assert.equal(c.notifyLevelFor('thr-1'), 'all');
  assert.equal(c.notifyLevelFor('srv1-memes'), 'mentions');
  assert.equal(c.notifyLevelFor('dm:a__b'), 'default');
});

test('política: nada, só menções, tudo e o padrão antigo (servidor silenciado)', () => {
  const state = { prefs: { notify_levels: { 'srv1-a': 'none', 'srv1-b': 'mentions', 'srv1-c': 'all' } }, threadIndex: new Map(), muted: ['srv1'] };
  const c = load(state);
  const msg = (channel_id, mentioned = false) => ({ channel_id, author_name: 'Ana', mentioned });
  assert.equal(c.notificationPolicy(msg('srv1-a', true)).notify, false);
  assert.equal(c.notificationPolicy(msg('srv1-b')).sound, false);
  assert.equal(c.notificationPolicy(msg('srv1-b', true)).notify, true);
  assert.equal(c.notificationPolicy(msg('srv1-c')).notify, true);
  // Padrão + servidor silenciado: sem som para mensagem comum.
  assert.equal(c.notificationPolicy(msg('srv1-d')).sound, false);
  // DM no padrão: notifica.
  assert.equal(c.notificationPolicy(msg('dm:a__b')).notify, true);
  // A própria mensagem nunca notifica.
  assert.equal(c.notificationPolicy({ channel_id: 'srv1-c', author_name: 'Eu' }).sound, false);
});

test('navegação rápida: sem acento, prefixos e não lidos primeiro', () => {
  const c = load({ prefs: {}, threadIndex: new Map() });
  const items = [
    { kind: 'channel', label: 'geral' },
    { kind: 'channel', label: 'regras-gerais', unread: true },
    { kind: 'person', label: 'Gérson', alt: 'gerson' },
    { kind: 'server', label: 'Grupo Geral' },
  ];
  const names = (q) => c.rankQuickItems(items, q).map((i) => i.label).join('|');
  assert.equal(names('#ger'), 'geral|regras-gerais');
  assert.equal(names('@gers'), 'Gérson');
  assert.equal(names('*'), 'Grupo Geral');
  assert.equal(names('xyz'), '');
  assert.equal(c.matchScore('Ação rápida', 'acao'), 3);
});
