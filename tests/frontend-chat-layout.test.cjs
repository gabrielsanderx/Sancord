// Regressão (0.2.2): itens do chat encolhiam até 22px quando o canal tinha rolagem,
// porque #chat-messages é flex em coluna e os itens tinham min-height explícito.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');

const css = fs.readFileSync(path.join(__dirname, '../static/ui.css'), 'utf8');

test('itens da lista de mensagens nunca encolhem', () => {
  const ast = csstree.parse(css);
  let found = false;
  csstree.walk(ast, {
    visit: 'Rule',
    enter(rule) {
      const selector = csstree.generate(rule.prelude);
      if (selector.split(',').some((s) => s.trim() === '#chat-messages>*')) {
        csstree.walk(rule.block, {
          visit: 'Declaration',
          enter(d) {
            if (d.property === 'flex-shrink' && csstree.generate(d.value).trim() === '0') found = true;
          },
        });
      }
    },
  });
  assert.ok(found, '#chat-messages > * precisa de flex-shrink: 0');
});

test('o cartão de prévia de link usa tokens de tema', () => {
  assert.match(css, /\.link-embed\s*\{[^}]*border-left:\s*4px solid var\(--accent\)/);
  assert.match(css, /a\.link-embed-title\s*\{[^}]*color:\s*var\(--link\)/);
});
