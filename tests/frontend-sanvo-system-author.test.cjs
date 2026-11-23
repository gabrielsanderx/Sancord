// O projeto virou Sanvo: mensagens de sistema antigas ("Sancord") aparecem como "Sanvo".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('autor de sistema antigo é exibido como Sanvo; usuário real com o mesmo nome não muda', async t => {
  const h = await openInterface(t);
  const payload = {
    chat_history: { c1: [
      { id: 'm1', channel_id: 'c1', author_id: 'system', author_name: 'Sancord', author_kind: 'System', content: 'Swag iniciou uma chamada.' },
      { id: 'm2', channel_id: 'c1', author_id: 'system', author_name: 'Sancord Bot', content: 'Bem-vindo!' },
      { id: 'm3', channel_id: 'c1', author_id: 'u9', author_name: 'Sancord', content: 'sou uma pessoa', reply_to: { id: 'm1', author_id: 'system', author_name: 'Sancord' } },
    ] },
  };
  h.w.__payload = payload;
  h.run('renameLegacySystemAuthors(window.__payload)');
  const [m1, m2, m3] = payload.chat_history.c1;
  assert.equal(m1.author_name, 'Sanvo');
  assert.equal(m2.author_name, 'Sanvo Bot');
  assert.equal(m3.author_name, 'Sancord', 'conta de pessoa não é renomeada');
  assert.equal(m3.reply_to.author_name, 'Sanvo', 'resposta a mensagem de sistema também');
});
