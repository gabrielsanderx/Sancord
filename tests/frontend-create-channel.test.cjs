// Criar canal: o tipo escolhido no diálogo é o tipo enviado ao servidor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function createVia(h, start, pick, extra = () => {}) {
  const d = h.document;
  h.run(`globalThis.sent = [];
    sendWs = (type, payload) => { sent.push({ type, payload }); return true; };
    state.servers = [{ id: 's1', name: 'Squad', owner: 'ana', categories: [], roles: [], text_channels: [], voice_channels: [] }];
    state.activeServerId = 's1';
    getActiveServer = () => state.servers[0];`);
  h.run(start);
  await h.flush();
  const dialog = d.querySelector('.sancord-dialog');
  const card = [...dialog.querySelectorAll('.sancord-card-option')].find(c => c.textContent.includes(pick));
  card.click();
  const name = dialog.querySelector('input[type="text"], input:not([type])');
  name.value = 'privadão';
  name.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  extra(dialog);
  dialog.querySelector('form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  await h.flush();
  return JSON.parse(h.run('JSON.stringify(sent.find(p => p.type === "CreateChannel")?.payload || null)'));
}

test('escolher Voz no diálogo cria canal de voz (botão de texto e de voz)', async t => {
  const h = await openInterface(t);
  for (const start of ['openCreateChannelModal("text")', 'openCreateChannelModal("voice")']) {
    const payload = await createVia(h, start, 'Voz');
    assert.equal(payload?.kind, 'voice', `a partir de ${start}`);
  }
});

test('o + de uma categoria de voz já abre o diálogo em Voz', async t => {
  const h = await openInterface(t);
  h.run(`globalThis.srvK = { text_channels: [{ id: 't1', category_id: 'cat-texto' }],
    voice_channels: [{ id: 'v1', category_id: 'cat-voz' }] }`);
  assert.equal(h.run('categoryChannelKind(srvK, { id: "cat-voz", name: "Canais de voz" })'), 'voice');
  assert.equal(h.run('categoryChannelKind(srvK, { id: "cat-texto", name: "Texto" })'), 'text');
  assert.equal(h.run('categoryChannelKind(srvK, { id: "nova", name: "Calls" })'), 'voice', 'vazia: segue o nome');
  assert.equal(h.run('categoryChannelKind(srvK, { id: "nova", name: "Geral" })'), 'text');
  h.run(`globalThis.sent = [];
    sendWs = (type, payload) => { sent.push({ type, payload }); return true; };
    state.servers = [{ id: 's1', name: 'Squad', owner: 'ana', categories: [{ id: 'cat-voz', name: 'Voz' }], roles: [],
      text_channels: [], voice_channels: [{ id: 'v1', name: 'Call', kind: 'voice', category_id: 'cat-voz' }] }];
    getActiveServer = () => state.servers[0];
    openCreateChannelDialog({ categoryId: 'cat-voz', kind: categoryChannelKind(state.servers[0], state.servers[0].categories[0]) });`);
  await h.flush();
  const checked = h.document.querySelector('.sancord-dialog .sancord-card-option input:checked');
  assert.equal(checked.value, 'voice');
});

test('canal de voz privado continua sendo de voz', async t => {
  const h = await openInterface(t);
  const payload = await createVia(h, 'openCreateChannelModal("text")', 'Voz', dialog => {
    const access = [...dialog.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'private'));
    access.value = 'private';
    access.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  });
  assert.equal(payload.kind, 'voice');
  assert.equal(payload.permissions_synced, false);
});
