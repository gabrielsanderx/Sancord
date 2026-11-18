// Modo lento no cliente: contagem regressiva, formato do tempo, opções e isenção.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/servers.js'), 'utf8');

function load(perms, sentAt) {
  const srv = { id: 's', text_channels: [{ id: 'geral', slowmode_secs: 30, effective_permissions: perms }, { id: 'livre' }] };
  const context = vm.createContext({
    Date, Math, Number, String, Map,
    state: { servers: [srv], threadIndex: new Map([['thr-1', { parent_id: 'geral' }]]), slowmodeSentAt: new Map(sentAt) },
    getChannelPermissions: (_s, ch) => ch?.effective_permissions || {},
  });
  const choices = source.indexOf('const SLOWMODE_CHOICES');
  vm.runInContext(source.slice(choices, source.indexOf('];', choices) + 2), context);
  for (const name of ['slowmodeLabel', 'slowmodeOptions', 'slowmodeContext', 'bypassesSlowmode', 'slowmodeWaitMs', 'formatSlowmodeWait', 'currentSlowmodeWait']) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context;
}

test('espera conta a partir do último envio e zera no fim', () => {
  const c = load({ send_messages: true }, []);
  assert.equal(c.slowmodeWaitMs(1_000, 30, 11_000), 20_000);
  assert.equal(c.slowmodeWaitMs(1_000, 30, 31_000), 0);
  assert.equal(c.slowmodeWaitMs(null, 30, 5_000), 0);
  assert.equal(c.slowmodeWaitMs(1_000, 0, 1_500), 0);
});

test('tempo restante legível', () => {
  const c = load({}, []);
  assert.equal(c.formatSlowmodeWait(1), '1 s');
  assert.equal(c.formatSlowmodeWait(29_100), '30 s');
  assert.equal(c.formatSlowmodeWait(125_000), '2 min 05 s');
  assert.equal(c.formatSlowmodeWait(2 * 3_600_000 + 60_000), '2 h 01 min');
});

test('seletor mantém um valor fora da lista', () => {
  const c = load({}, []);
  assert.equal(c.slowmodeOptions(30).length, 14);
  const custom = c.slowmodeOptions(45);
  assert.equal(custom.at(-1).value, '45');
  assert.equal(custom.at(-1).label, '45 segundos');
});

test('thread segue o canal-pai e moderação não espera', () => {
  const now = Date.now();
  const membro = load({ send_messages: true }, [['geral', now - 10_000], ['thr-1', now - 1_000]]);
  assert.ok(membro.currentSlowmodeWait('geral', now) > 19_000);
  assert.ok(membro.currentSlowmodeWait('thr-1', now) > 28_000, 'thread usa os 30 s do pai');
  assert.equal(membro.currentSlowmodeWait('livre', now), 0, 'canal sem modo lento');
  const moderador = load({ send_messages: true, manage_messages: true }, [['geral', now - 1_000]]);
  assert.equal(moderador.currentSlowmodeWait('geral', now), 0);
});
