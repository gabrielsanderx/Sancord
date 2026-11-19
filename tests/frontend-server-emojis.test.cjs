// Etapa C5: emojis próprios do servidor — desenho, conversão, seletor, reações e configurações.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

const ID1 = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';
const ID3 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function setup(t, me = 'Dona') {
  const h = await openInterface(t);
  h.w.__me = me;
  h.run(`
    globalThis.__sent = [];
    sendWs = (type, payload) => { __sent.push([type, payload]); return true; };
    state.selfUser = { id: 'u1', username: __me };
    state.servers = [
      { id: 's1', name: 'Primeiro', owner_username: 'dona', members: ['dona', 'ana'], roles: [{ id: 'everyone', position: 0, permissions: {} }], member_roles: {},
        text_channels: [{ id: 'c1', name: 'geral', kind: 'text' }], voice_channels: [], categories: [],
        emojis: [{ id: '${ID1}', name: 'festa_boa', animated: false, creator: 'dona' }, { id: '${ID3}', name: 'dancinha', animated: true, creator: 'dona' }] },
      { id: 's2', name: 'Segundo', owner_username: 'outra', members: ['dona', 'outra'], roles: [], member_roles: {},
        text_channels: [{ id: 'c2', name: 'papo', kind: 'text' }], voice_channels: [], categories: [],
        emojis: [{ id: '${ID2}', name: 'festa_boa', animated: false, creator: 'outra' }] },
    ];
    state.activeView = 'server';
    state.activeServerId = 's1';
  `);
  return h;
}

test('mensagem: código vira imagem; só emojis = grande; "_" do nome não vira itálico', async t => {
  const h = await setup(t), d = h.document;
  const box = d.createElement('div');
  box.innerHTML = h.run(`renderMarkdown('oi <:festa_boa:${ID1}> e _itálico_')`);
  const img = box.querySelector('img.custom-emoji');
  assert.ok(img, box.innerHTML);
  assert.match(img.getAttribute('src'), new RegExp(`/api/attachments/${ID1}/emoji$`));
  assert.equal(img.getAttribute('alt'), ':festa_boa:');
  assert.equal(img.classList.contains('jumbo'), false);
  assert.equal(box.querySelector('em').textContent, 'itálico');

  box.innerHTML = h.run(`renderMarkdown('<a:dancinha:${ID3}> <:festa_boa:${ID1}>')`);
  assert.equal(box.querySelectorAll('img.custom-emoji.jumbo').length, 2);

  // Dentro de código continua texto; código malformado não vira imagem.
  box.innerHTML = h.run(`renderMarkdown('\`<:festa_boa:${ID1}>\` <:x:123> <img src=x onerror=alert(1)>')`);
  assert.equal(box.querySelector('img'), null);
  assert.match(box.querySelector('code').textContent, /<:festa_boa:/);
});

test('envio: ":nome:" vira código (servidor aberto primeiro); edição mostra ":nome:" de novo', async t => {
  const h = await setup(t);
  assert.equal(h.run(`encodeCustomEmojis('bora :festa_boa: :naoexiste:')`), `bora <:festa_boa:${ID1}> :naoexiste:`);
  assert.equal(h.run(`encodeCustomEmojis(':dancinha:')`), `<a:dancinha:${ID3}>`);
  assert.equal(h.run(`encodeCustomEmojis('\`:festa_boa:\` 10:30:00')`), '`:festa_boa:` 10:30:00');
  assert.equal(h.run(`encodeCustomEmojis('<:festa_boa:${ID1}>')`), `<:festa_boa:${ID1}>`, 'código pronto fica igual');
  h.run(`state.activeServerId = 's2'`);
  assert.equal(h.run(`encodeCustomEmojis(':festa_boa:')`), `<:festa_boa:${ID2}>`, 'nome repetido: vale o do servidor aberto');
  assert.equal(h.run(`decodeCustomEmojis('a <a:dancinha:${ID3}> b')`), 'a :dancinha: b');
});

test('reação com emoji do servidor aparece como imagem', async t => {
  const h = await setup(t);
  h.w.__msg = { id: 'm1', channel_id: 'c1', author_name: 'Ana', content: 'oi', reactions: { [`<:festa_boa:${ID1}>`]: ['Dona'], '👍': ['Ana'] } };
  h.run('messagePermissions = () => ({ add_reactions: true })');
  const row = h.run('buildReactionsNode(__msg)');
  const pills = [...row.querySelectorAll('.reaction-pill:not(.reaction-add)')];
  assert.equal(pills[0].querySelector('img.reaction-emoji').getAttribute('alt'), ':festa_boa:');
  assert.equal(pills[0].classList.contains('reacted'), true);
  assert.equal(pills[1].textContent.startsWith('👍'), true);
  pills[0].click();
  assert.equal(h.run('JSON.stringify(__sent[__sent.length - 1])'), JSON.stringify(['ToggleReaction', { channel_id: 'c1', message_id: 'm1', emoji: `<:festa_boa:${ID1}>` }]));
});

test('seletor e autocompletar: seção por servidor, inserção ":nome:" e recentes sem emoji excluído', async t => {
  const h = await setup(t), d = h.document;
  h.w.localStorage.setItem('sancord_recent_emojis', JSON.stringify([`<:sumiu:${'b'.repeat(32)}>`, `<:festa_boa:${ID2}>`, '🔥']));
  h.run('initEmojiPicker(); emojiPopover.renderBody()');
  const titles = [...d.querySelectorAll('#emoji-popover .emoji-section-title')].map(x => x.textContent);
  assert.deepEqual(titles.slice(0, 3), ['Recentes', 'Primeiro', 'Segundo']);
  const recents = d.querySelectorAll('#emoji-popover .emoji-grid')[0].querySelectorAll('.emoji-choice-btn');
  assert.equal(recents.length, 2, 'o excluído some dos recentes');
  const custom = d.querySelector('#emoji-popover .emoji-choice-btn.custom');
  assert.equal(custom.dataset.insert, ':festa_boa:');
  h.run('chatInput.value = ""');
  custom.click();
  assert.equal(h.run('chatInput.value'), ':festa_boa:');

  const items = h.run('autocompleteCandidates(":", "dan")');
  assert.equal(items[0].kind, 'custom');
  assert.equal(items[0].insert, ':dancinha: ');
});

test('configurações: lista, contador e ações só para quem gerencia expressões', async t => {
  const h = await setup(t), d = h.document;
  h.run('renderEmojiSettings(state.servers[0])');
  const rows = d.querySelectorAll('#emoji-list .emoji-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('strong').textContent, ':festa_boa:');
  assert.match(rows[1].querySelector('.settings-hint-text').textContent, /^Animado/);
  assert.equal(d.getElementById('emoji-count').textContent, '2 de 50');
  assert.equal(rows[0].querySelectorAll('button').length, 2, 'dona: renomear e excluir');
  assert.equal(d.getElementById('emoji-upload-btn').disabled, false);

  const h2 = await setup(t, 'Ana');
  h2.run('renderEmojiSettings(state.servers[0])');
  assert.equal(h2.document.querySelectorAll('#emoji-list .emoji-row button').length, 0);
  assert.equal(h2.document.getElementById('emoji-upload-btn').disabled, true);
  h2.run(`state.servers[0].roles.push({ id: 'r', position: 1, permissions: { manage_expressions: true } }); state.servers[0].member_roles = { ana: ['r'] }`);
  assert.equal(h2.run('canManageEmojis(state.servers[0])'), true);

  assert.equal(h.run('emojiNameFromFile("Festa Junina!.png")'), 'Festa_Junina');
  assert.equal(h.run('emojiNameFromFile("ç.png")'), 'emoji');
});
