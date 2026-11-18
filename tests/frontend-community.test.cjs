// Fase 8: contagem/seleção de enquetes e janela de eventos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/community.js'), 'utf8');
const context = vm.createContext({ Date, Number, String, Set, Object });
for (const name of ['pollTally', 'pollIsOpen', 'nextPollSelection', 'upcomingEvents', 'eventIsLive', 'toLocalInput', 'fromLocalInput']) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Função ausente: ${name}`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}

const poll = {
  options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }, { id: 'o3', text: 'C' }],
  votes: { o1: ['ana', 'bia'], o2: ['ana'] },
  multiple: false,
};

test('contagem por opção, votantes únicos e meus votos', () => {
  const t = context.pollTally(poll, 'ana');
  assert.equal(t.counts.o1, 2);
  assert.equal(t.counts.o3, 0);
  assert.equal(t.voters, 2);
  assert.deepEqual([...t.mine].sort(), ['o1', 'o2']);
});

test('seleção: única troca/retira, múltipla alterna', () => {
  assert.deepEqual([...context.nextPollSelection(poll, new Set(['o1']), 'o2')], ['o2']);
  assert.deepEqual([...context.nextPollSelection(poll, new Set(['o1']), 'o1')], []);
  const multi = { ...poll, multiple: true };
  assert.deepEqual([...context.nextPollSelection(multi, new Set(['o1']), 'o3')].sort(), ['o1', 'o3']);
  assert.deepEqual([...context.nextPollSelection(multi, new Set(['o1', 'o3']), 'o1')], ['o3']);
});

test('enquete aberta, encerrada e vencida', () => {
  const now = 1_000_000;
  assert.equal(context.pollIsOpen({ closed: false }, now), true);
  assert.equal(context.pollIsOpen({ closed: true }, now), false);
  assert.equal(context.pollIsOpen({ closed: false, expires_at: now - 1 }, now), false);
});

test('eventos futuros, ao vivo e encerrados', () => {
  const now = 10 * 3600000;
  const list = [
    { starts_at: now + 1000 },
    { starts_at: now - 1000, ends_at: now + 1000 },
    { starts_at: now - 2 * 3600000 },
  ];
  assert.equal(context.upcomingEvents(list, now).length, 2);
  assert.equal(context.eventIsLive(list[1], now), true);
  assert.equal(context.eventIsLive(list[0], now), false);
});

test('datetime-local ida e volta no fuso local', () => {
  const ms = new Date(2026, 10, 20, 19, 30).getTime();
  assert.equal(context.toLocalInput(ms), '2026-11-20T19:30');
  assert.equal(context.fromLocalInput('2026-11-20T19:30'), ms);
  assert.equal(context.fromLocalInput(''), null);
});
