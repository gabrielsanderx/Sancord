// Etapa C1: cartão de prévia de link montado com segurança e respeitando a preferência.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

const message = (embeds) => ({ id: 'msg 1', channel_id: 'srv-geral', embeds });

test('cartão mostra site, título-link, descrição e imagem pelo proxy do Sancord', async t => {
  const h = await openInterface(t);
  h.w.__msg = message([{ url: 'https://exemplo.com/a', site_name: 'Exemplo', title: 'Título <b>sem HTML</b>', description: 'Texto', image_url: 'https://exemplo.com/i.png' }]);
  const node = h.run('buildEmbedsNode(__msg)');
  const card = node.querySelector('.link-embed');
  assert.equal(card.querySelector('.link-embed-site').textContent, 'Exemplo');
  const title = card.querySelector('a.link-embed-title.chat-link');
  assert.equal(title.textContent, 'Título <b>sem HTML</b>', 'texto puro, nada interpretado como HTML');
  assert.equal(title.querySelector('b'), null);
  assert.equal(title.getAttribute('href'), 'https://exemplo.com/a');
  assert.equal(title.getAttribute('rel'), 'noopener noreferrer');
  const img = card.querySelector('img.link-embed-image');
  assert.match(img.getAttribute('src'), /\/api\/link-preview\/srv-geral\/msg%201\/0$/, 'imagem pelo proxy, nunca direto do site');
  assert.ok(!img.getAttribute('src').includes('exemplo.com'));
});

test('URL perigosa não vira link, embed vazio some e a preferência desliga tudo', async t => {
  const h = await openInterface(t);
  h.w.__msg = message([{ url: 'javascript:alert(1)', title: 'Perigoso' }, { url: 'https://x.com', title: '' }]);
  const node = h.run('buildEmbedsNode(__msg)');
  assert.equal(node.querySelectorAll('.link-embed').length, 1);
  assert.equal(node.querySelector('a'), null, 'javascript: não vira link');
  assert.equal(node.querySelector('strong.link-embed-title').textContent, 'Perigoso');
  assert.equal(h.run('buildEmbedsNode({ id: "x", channel_id: "c", embeds: [] })'), null);
  h.run('state.audioSettings.autoEmbeds = false');
  h.w.__msg = message([{ url: 'https://exemplo.com', title: 'Oi' }]);
  assert.equal(h.run('buildEmbedsNode(__msg)'), null, 'preferência de privacidade desligada: sem prévia');
});
