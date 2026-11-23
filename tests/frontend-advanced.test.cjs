// Fase 8: filtros da busca digitados na caixa e frase do registro de auditoria.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/advanced.js'), 'utf8');
function load(names) {
  const context = vm.createContext({ Date, Number, String, Object });
  const labelsStart = source.indexOf('const AUDIT_LABELS');
  vm.runInContext(source.slice(labelsStart, source.indexOf('};', labelsStart) + 2).replace('const AUDIT_LABELS', 'var AUDIT_LABELS'), context);
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context;
}

const c = load(['parseSearchDate', 'parseSearchQuery', 'auditSentence']);

test('texto livre e filtros em português ou inglês', () => {
  const p = c.parseSearchQuery('relatório final de:@Ana tem:link fixadas menciona:eu');
  assert.equal(p.query, 'relatório final');
  assert.equal(p.author, 'Ana');
  assert.equal(p.has, 'link');
  assert.equal(p.pinned, true);
  assert.equal(p.mentions_me, true);
  const q = c.parseSearchQuery('from:bia has:image');
  assert.equal(q.author, 'bia');
  assert.equal(q.has, 'image');
  assert.equal(q.query, '');
});

test('datas: antes = início do dia, depois = fim do dia; inválidas viram texto', () => {
  const p = c.parseSearchQuery('antes:2026-11-10 depois:01/11/2026');
  assert.equal(p.before, new Date(2026, 10, 10, 0, 0, 0).getTime());
  assert.equal(p.after, new Date(2026, 10, 1, 23, 59, 59).getTime());
  const bad = c.parseSearchQuery('antes:ontem tem:holograma');
  assert.equal(bad.before, null);
  assert.equal(bad.has, null);
  assert.equal(bad.query, 'antes:ontem tem:holograma');
});

test('filtros avançados: canal, menção a usuário, múltiplos tem:, durante: e chips', () => {
  const p = c.parseSearchQuery('minecraft de:Gabriel em:#geral tem:imagem tem:vídeo tem:enquete menções:@Ana durante:2026-10-15');
  assert.equal(p.query, 'minecraft');
  assert.equal(p.author, 'Gabriel');
  assert.equal(p.in_channel, 'geral');
  assert.deepEqual(Array.from(p.has_list), ['image', 'video', 'poll']);
  assert.equal(p.has, 'image');
  assert.equal(p.mentions_user, 'Ana');
  assert.equal(p.mentions_me, false);
  assert.ok(p.after < new Date(2026, 9, 15, 0, 0, 0).getTime());
  assert.ok(p.before > new Date(2026, 9, 15, 23, 59, 59).getTime());
  assert.ok(p.filters.some((f) => f.kind === 'in_channel' && f.label === 'Em: #geral'));
  assert.ok(p.filters.some((f) => f.kind === 'mentions_user' && f.label === 'Menciona: @Ana'));
});

test('frase do registro de auditoria', () => {
  assert.equal(c.auditSentence({ actor: 'dona', action: 'member_kick', target: 'beto' }), 'dona expulsou beto');
  assert.equal(c.auditSentence({ actor: 'automod', action: 'automod_block', target: 'caio' }), 'AutoMod bloqueou uma mensagem de caio');
  assert.equal(c.auditSentence({ actor: 'x', action: 'acao_nova' }), 'x acao_nova');
});
