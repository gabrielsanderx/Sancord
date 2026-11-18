const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = require('css-tree');
const { JSDOM } = require('jsdom');
const styles = ['static/styles.css', 'static/ui.css'].map(file => ({
  file, source: fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
}));

test('folhas da interface são CSS válido, incluindo regras de responsividade', () => {
  for (const {file, source} of styles) {
    const errors = [];
    css.parse(source, { positions:true, onParseError:e=>errors.push(`${e.line}:${e.column} ${e.message}`) });
    assert.deepEqual(errors, [], file);
  }
});

// Aplica a cascata das variáveis dos temas fixos, incluindo a folha legada.
// Layout/DPI e estilos computados pelo WebView2 exigem homologação nativa separada.
function themeVariables(theme) {
  const root = new Map(), body = new Map();
  for (const {source} of styles) css.walk(css.parse(source), {
    visit:'Rule', enter(rule) {
      if (this.atrule || rule.prelude?.type !== 'SelectorList') return;
      for (const selector of rule.prelude.children) {
        const text = css.generate(selector);
        const target = text === ':root' ? root : body;
        const specificity = text === ':root' ? 10 : text === 'body' ? 1 :
          text === 'body[data-theme]' || text === `body[data-theme="${theme}"]` || text === `body[data-theme=${theme}]` ? 11 : 0;
        if (!specificity) continue;
        for (const declaration of rule.block.children) {
          if (declaration.type !== 'Declaration' || !declaration.property.startsWith('--')) continue;
          const previous = target.get(declaration.property);
          if (!previous || specificity >= previous.specificity) target.set(declaration.property, {
            specificity, value:css.generate(declaration.value).trim(),
          });
        }
      }
    },
  });
  function resolve(name, scope = body, visited = []) {
    assert.ok(!visited.includes(`${scope === root ? 'root' : 'body'}:${name}`), `ciclo em ${name}`);
    const value = (scope.get(name) || root.get(name))?.value;
    assert.ok(value, `token ausente: ${name}`);
    if (value === 'inherit') return resolve(name, root, visited);
    return value.replace(/var\((--[a-z-]+)\)/g, (_, ref) => resolve(ref, scope, [...visited, `${scope === root ? 'root' : 'body'}:${name}`]));
  }
  return resolve;
}
function luminance(value) {
  assert.match(value, /^#[a-f0-9]{6}$/i);
  const [r,g,b] = value.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return r*0.2126 + g*0.7152 + b*0.0722;
}

test('quatro temas mantêm contraste de leitura e superfícies distintas após a cascata legada', () => {
  for (const theme of ['light','dark','ash','oled']) {
    const token = themeVariables(theme), bg = luminance(token('--bg-chat'));
    assert.equal(token('--bg-input'), token('--bg-composer'), theme);
    assert.notEqual(token('--bg-input'), token('--bg-chat'), theme);
    assert.ok(luminance(token('--bg-server-rail')) < bg, `${theme}: rail mais escuro que o chat`);
    for (const surface of ['--bg-chat','--bg-card','--bg-hover']) {
      const surfaceLum = luminance(token(surface));
      for (const name of ['--text-primary','--text-body','--text-secondary','--text-subtle']) {
        if (surface === '--bg-hover' && name === '--text-subtle') continue;
        const fg = luminance(token(name)), contrast = (Math.max(fg,surfaceLum)+0.05)/(Math.min(fg,surfaceLum)+0.05);
        assert.ok(contrast >= 4.5, `${theme} ${name} em ${surface}: ${contrast.toFixed(2)}:1`);
      }
    }
  }
});

test('rótulos secundários de Aparência, perfis e atalhos usam tokens semânticos no tema Claro e responsividade preserva a ordem de saída', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'static/index.html'), 'utf8');
  const dom = new JSDOM(html);
  const { window } = dom, { document } = window;
  for (const { source } of styles) {
    const el = document.createElement('style');
    el.textContent = source;
    document.head.appendChild(el);
  }
  document.body.setAttribute('data-theme', 'light');
  for (const selector of [
    '.accent-swatch-badge',
    '.appearance-custom-text p',
    '#ptt-key-display',
    '#profile-card-custom-status',
    '#ui-toast',
  ]) {
    const color = window.getComputedStyle(document.querySelector(selector)).color;
    assert.doesNotMatch(color, /255,\s*255,\s*255|219,\s*222,\s*225|#fff|#dbdee1/i, selector);
  }
  assert.equal(window.getComputedStyle(document.querySelector('.density-choice-card.active')).borderColor, 'var(--accent)');
  assert.equal(window.getComputedStyle(document.querySelector('.profile-tab-btn.active')).borderBottomColor, 'var(--accent)');
  assert.equal(window.getComputedStyle(document.querySelector('.chat-header-left .channel-topic')).display, 'block');
  dom.window.close();
});
