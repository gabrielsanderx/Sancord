// Seletor de compartilhamento de tela: janelas minimizadas aparecem com aviso.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('janela minimizada aparece na aba Aplicativos com a etiqueta "Minimizada"', async t => {
  const h = await openInterface(t);
  h.run(`
    state.pickerTab = 'window';
    state.selectedSource = null;
    state.pickerSources = [
      { id: 'mon:0', kind: 'monitor', title: 'Tela 1', width: 1920, height: 1080, thumbnail: 'data:,' },
      { id: 'win:1', kind: 'window', title: 'Navegador', width: 1280, height: 720, thumbnail: 'data:,', minimized: false },
      { id: 'win:2', kind: 'window', title: 'WhatsApp', width: 1000, height: 700, thumbnail: 'data:,', minimized: true },
    ];
    renderPickerSources();
  `);
  const cards = [...h.document.querySelectorAll('#picker-sources-grid .source-card')];
  assert.deepEqual(cards.map(c => c.querySelector('.source-title').textContent), ['Navegador', 'WhatsApp']);
  assert.equal(cards[0].querySelector('.source-min-tag'), null);
  assert.equal(cards[1].querySelector('.source-min-tag').textContent, 'Minimizada');
  cards[1].click();
  assert.equal(h.run('state.selectedSource.id'), 'win:2', 'pode ser escolhida');
});
