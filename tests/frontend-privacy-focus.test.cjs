// Etapa A: opções que antes não faziam nada — proteção de links, Modo Foco e Status da conta.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const polish = fs.readFileSync(path.join(__dirname, '../static/js/polish.js'), 'utf8');
const advanced = fs.readFileSync(path.join(__dirname, '../static/js/advanced.js'), 'utf8');
function take(source, names, context) {
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return context;
}

test('proteção de links: só http(s), só com a opção ligada e domínio não confiável', () => {
  const c = take(polish, ['linkHost', 'linkNeedsConfirmation'], vm.createContext({ URL, String }));
  const none = new Set();
  assert.equal(c.linkHost('https://www.Exemplo.com/a?b=1'), 'exemplo.com');
  assert.equal(c.linkHost('sancord://open/?invite=SANC-ABC123'), null);
  assert.equal(c.linkHost('javascript:alert(1)'), null);
  assert.equal(c.linkNeedsConfirmation('https://exemplo.com/x', true, none), true);
  assert.equal(c.linkNeedsConfirmation('https://exemplo.com/x', false, none), false, 'opção desligada');
  assert.equal(c.linkNeedsConfirmation('https://www.exemplo.com/x', true, new Set(['exemplo.com'])), false, 'domínio confiável');
  assert.equal(c.linkNeedsConfirmation('sancord://open/?invite=X', true, none), false, 'convite do Sancord não pergunta');
});

function policy(settings) {
  const state = {
    selfUser: { username: 'Eu' },
    audioSettings: settings,
    friends: [{ username: 'Amiga' }],
    prefs: { notify_levels: {} },
  };
  return take(polish, ['isFriendName', 'notifyLevelFor', 'notificationPolicy'], vm.createContext({
    state, String,
    isPrivateTextId: (id) => /^g?dm:/.test(id),
    isMessageRequest: () => false,
    isOwnMessage: (m) => m.author_name === 'Eu',
    messageMentionsMe: () => false,
    serverForChannel: () => null,
    isServerMuted: () => false,
  }));
}

test('Modo Foco silencia conversa privada de quem não é amigo, sem esconder a mensagem', () => {
  const dmStranger = { channel_id: 'dm:eu__estranho', author_name: 'Estranho' };
  const dmFriend = { channel_id: 'dm:amiga__eu', author_name: 'amiga' };
  const off = policy({ familyFocus: false });
  assert.equal(off.notificationPolicy(dmStranger).notify, true);
  const on = policy({ familyFocus: true });
  const silenced = on.notificationPolicy(dmStranger);
  assert.equal(silenced.sound, false);
  assert.equal(silenced.notify, false);
  assert.equal(silenced.mention, true, 'continua contando como não lida');
  assert.equal(on.notificationPolicy(dmFriend).notify, true, 'amigo continua notificando (nome sem diferenciar maiúsculas)');
  assert.equal(on.notificationPolicy({ channel_id: 'srv-geral', author_name: 'Estranho' }).sound, true, 'canal de servidor não é afetado');
});

test('Status da conta lista só castigos ativos, do que termina antes', () => {
  const c = take(advanced, ['memberTimeoutUntil', 'selfActiveTimeouts'], vm.createContext({ String, Date }));
  const now = 1_000_000;
  const servers = [
    { name: 'B', member_timeouts: { eu: now + 50_000 } },
    { name: 'A', member_timeouts: { eu: now + 10_000, outro: now + 99_000 } },
    { name: 'Vencido', member_timeouts: { eu: now - 1 } },
    { name: 'Livre' },
  ];
  const list = c.selfActiveTimeouts(servers, 'Eu', now);
  assert.equal(list.map((x) => x.server.name).join(','), 'A,B');
  assert.equal(c.selfActiveTimeouts(servers, 'ninguem', now).length, 0);
});
