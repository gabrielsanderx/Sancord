// Fase 8: ordenação de threads/postagens e identificação de ids.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/threads.js'), 'utf8');
const state = { threadIndex: new Map() };
const context = vm.createContext({ state, Date, Math });
for (const name of ['isThreadId', 'threadsOf', 'sortThreads', 'timeAgo']) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Função ausente: ${name}`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}

test('ids de thread', () => {
  assert.equal(context.isThreadId('thr-abc'), true);
  assert.equal(context.isThreadId('srv-1-geral'), false);
  assert.equal(context.isThreadId(null), false);
});

test('ativas antes de arquivadas, mais recentes primeiro, só do canal pedido', () => {
  for (const t of [
    { id: 'thr-a', parent_id: 'c1', archived: false, last_message_at: 10 },
    { id: 'thr-b', parent_id: 'c1', archived: true, last_message_at: 99 },
    { id: 'thr-c', parent_id: 'c1', archived: false, last_message_at: 50 },
    { id: 'thr-d', parent_id: 'c2', archived: false, last_message_at: 70 },
  ]) state.threadIndex.set(t.id, t);
  const ids = context.sortThreads(context.threadsOf('c1')).map((t) => t.id);
  assert.equal(ids.join(','), 'thr-c,thr-a,thr-b');
});

test('tempo relativo', () => {
  assert.equal(context.timeAgo(Date.now()), 'agora');
  assert.equal(context.timeAgo(Date.now() - 5 * 60000), 'há 5 min');
  assert.equal(context.timeAgo(Date.now() - 3 * 86400000), 'há 3 dias');
});
