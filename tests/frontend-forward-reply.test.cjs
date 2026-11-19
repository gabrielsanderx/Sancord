// Etapa C2: bloco de mensagem encaminhada e botão "@" da resposta.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('encaminhada: rótulo, markdown seguro, origem e prévias pelo proxy com índice próprio', async t => {
  const h = await openInterface(t);
  h.w.__msg = {
    id: 'm2', channel_id: 'srv-destino', author_name: 'Bia', content: 'olha',
    forward: {
      source_channel_id: 'srv-geral', source_message_id: 'm1', source_label: '#geral · Servidor X',
      original_created_at: Date.UTC(2026, 10, 18, 12, 0), content: '**plano** <img src=x onerror=alert(1)>',
      embeds: [{ url: 'https://exemplo.com', title: 'Exemplo', image_url: 'https://exemplo.com/i.png' }],
    },
  };
  const node = h.run('buildForwardNode(__msg)');
  assert.equal(node.querySelector('.forwarded-label').textContent, '↪ Encaminhada');
  const text = node.querySelector('.forwarded-text');
  assert.equal(text.querySelector('strong').textContent, 'plano');
  assert.equal(text.querySelector('img'), null, 'HTML do conteúdo nunca é interpretado');
  assert.match(node.querySelector('.forwarded-source').textContent, /^#geral · Servidor X • /);
  assert.match(node.querySelector('img.link-embed-image').getAttribute('src'), /\/api\/link-preview\/srv-destino\/m2\/100$/);
  assert.equal(h.run('buildForwardNode({ id: "x", channel_id: "c" })'), null);
});

test('botão "@" alterna a menção da resposta e fica guardado', async t => {
  const h = await openInterface(t), d = h.document;
  assert.equal(h.run('replyMentionEnabled()'), true, 'padrão: menciona');
  h.run('setReplyingTo({ id: "m1", author_name: "Outra Pessoa", content: "oi" })');
  const btn = d.getElementById('reply-mention-toggle');
  assert.equal(btn.classList.contains('hidden'), false);
  assert.equal(btn.textContent, '@ ATIVADO');
  btn.click();
  assert.equal(h.run('replyMentionEnabled()'), false);
  assert.equal(btn.textContent, '@ DESATIVADO');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  btn.click();
  assert.equal(h.run('replyMentionEnabled()'), true);
});
