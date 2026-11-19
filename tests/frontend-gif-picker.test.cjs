// Etapa C7: seletor de GIF local (favoritos + GIFs das conversas), sem serviço externo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

const G1 = '11111111111111111111111111111111';
const G2 = '22222222222222222222222222222222';
const G3 = '33333333333333333333333333333333';

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    globalThis.__sent = [];
    sendWs = (type, payload) => { __sent.push([type, payload]); return true; };
    globalThis.__chats = [];
    sendChatPayload = (p) => { __chats.push(p); return true; };
    state.selfUser = { id: 'u1', username: 'Ana' };
    state.prefs = { guild_layout: [], muted_servers: [], collapsed_categories: [], favorite_gifs: ['${G2}'] };
    getActiveTextChannelId = () => 'c1';
    const gif = (id, name) => ({ id, filename: name, content_type: 'image/gif', kind: 'image', url: '/api/attachments/' + id + '/' + name, size: 10 });
    state.chatHistory = {
      c1: [
        { id: 'm1', channel_id: 'c1', author_name: 'Bia', created_at: 1000, attachments: [gif('${G1}', 'danca.gif'), { id: 'p'.repeat(32), filename: 'foto.png', content_type: 'image/png', kind: 'image', url: '/x' }] },
        { id: 'm2', channel_id: 'c1', author_name: 'Bia', created_at: 3000, attachments: [gif('${G1}', 'danca.gif')] },
      ],
      c2: [{ id: 'm3', channel_id: 'c2', author_name: 'Cris', created_at: 2000, forward: { attachments: [gif('${G3}', 'gato.gif')] } }],
    };
  `);
  return h;
}

test('GIFs das conversas: só GIF, sem repetir, mais recente primeiro (inclui encaminhadas)', async t => {
  const h = await setup(t);
  assert.equal(h.run('conversationGifs().map(g => g.id + ":" + g.name).join()'), `${G1}:danca.gif,${G3}:gato.gif`);
});

test('seletor: abas, filtro, envio pelo ID do anexo e respeito à resposta', async t => {
  const h = await setup(t), d = h.document;
  d.getElementById('gif-picker-btn').click();
  const pop = d.getElementById('gif-popover');
  assert.equal(pop.classList.contains('hidden'), false);
  const tabs = () => [...pop.querySelectorAll('.gif-tab')].map(b => `${b.textContent}${b.classList.contains('active') ? '*' : ''}`);
  assert.deepEqual(tabs(), ['Favoritos (1)*', 'Nas conversas (2)']);
  assert.equal(pop.querySelectorAll('.gif-pick').length, 1);
  assert.match(pop.querySelector('.gif-pick img').getAttribute('src'), new RegExp(`/api/attachments/${G2}/gif$`));

  pop.querySelector('[data-gif-tab="recent"]').click();
  assert.deepEqual(tabs(), ['Favoritos (1)', 'Nas conversas (2)*']);
  const search = pop.querySelector('.gif-search');
  search.value = 'gato';
  search.dispatchEvent(new h.w.Event('input'));
  const picks = pop.querySelectorAll('.gif-pick');
  assert.equal(picks.length, 1);

  h.run('state.replyingTo = { id: "m9", author_name: "Bia", content: "oi" }');
  picks[0].click();
  const sent = h.run('JSON.stringify(__chats[0])');
  assert.equal(sent, JSON.stringify({ channel_id: 'c1', content: '', reply_to_id: 'm9', reply_mention: true, attachment_ids: [G3] }));
  assert.equal(pop.classList.contains('hidden'), true, 'fecha depois de enviar');
  assert.equal(h.run('state.replyingTo'), null);
});

test('favoritar e desfavoritar: estrela no GIF da mensagem sincroniza na conta', async t => {
  const h = await setup(t), d = h.document;
  h.run('state.audioSettings = { autoEmbeds: true }');
  const node = h.run('buildAttachmentsNode(state.chatHistory.c1[0])');
  const star = node.querySelector('.attachment-gif-wrap .gif-fav-btn');
  assert.ok(star, 'GIF tem estrela');
  assert.equal(node.querySelectorAll('.gif-fav-btn').length, 1, 'PNG não tem');
  assert.equal(star.textContent, '☆');
  d.body.appendChild(node);
  star.click();
  assert.equal(h.run('JSON.stringify(__sent[__sent.length - 1])'), JSON.stringify(['UpdateUserPrefs', { favorite_gifs: [G1, G2] }]));
  assert.equal(star.textContent, '★', 'estrela atualizada sem redesenhar');
  star.click();
  assert.equal(h.run('JSON.stringify(state.prefs.favorite_gifs)'), JSON.stringify([G2]));
  // ID inválido é ignorado.
  h.run('toggleFavoriteGif("../x")');
  assert.equal(h.run('JSON.stringify(state.prefs.favorite_gifs)'), JSON.stringify([G2]));
});

test('canal sem permissão: não envia GIF', async t => {
  const h = await setup(t);
  h.run('chatInput.disabled = true; sendGif("' + G1 + '")');
  assert.equal(h.run('__chats.length'), 0);
});
