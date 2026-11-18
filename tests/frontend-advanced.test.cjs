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
  const bad = c.parseSearchQuery('antes:ontem tem:video');
  assert.equal(bad.before, null);
  assert.equal(bad.has, null);
  assert.equal(bad.query, 'antes:ontem tem:video');
});

test('frase do registro de auditoria', () => {
  assert.equal(c.auditSentence({ actor: 'dona', action: 'member_kick', target: 'beto' }), 'dona expulsou beto');
  assert.equal(c.auditSentence({ actor: 'automod', action: 'automod_block', target: 'caio' }), 'AutoMod bloqueou uma mensagem de caio');
  assert.equal(c.auditSentence({ actor: 'x', action: 'acao_nova' }), 'x acao_nova');
});
