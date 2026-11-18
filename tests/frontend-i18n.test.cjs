// Fase 9: traduções (fallback e interpolação), marcação data-i18n e tipo de autor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadI18n(stored) {
  const store = new Map(stored ? [['sancord_lang', stored]] : []);
  const els = [];
  const context = vm.createContext({
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: {
      readyState: 'loading',
      documentElement: { lang: '' },
      addEventListener() {},
      dispatchEvent() {},
      querySelectorAll: (sel) => els.filter((e) => e.match === sel),
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    String,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/i18n.js'), 'utf8'), context);
  return { context, els, store };
}

test('português é a base; inglês traduz; chave sem tradução cai no português', () => {
  const { context } = loadI18n('en');
  assert.equal(context.t('home.friends'), 'Friends');
  assert.equal(context.t('notify.saved', { level: 'Nothing' }), 'Notifications: Nothing');
  vm.runInContext("I18N_LOCALES.en['home.friends'] = undefined", context);
  assert.equal(context.t('home.friends'), 'Amigos');
  assert.equal(context.t('chave.inexistente'), 'chave.inexistente');
});

test('idioma inválido salvo vira pt-BR; setLanguage aplica e guarda', () => {
  const { context, els, store } = loadI18n('klingon');
  assert.equal(context.currentLanguage(), 'pt-BR');
  const el = { match: '[data-i18n]', dataset: { i18n: 'home.servers' }, textContent: '' };
  const input = { match: '[data-i18n-placeholder]', dataset: { i18nPlaceholder: 'chat.search' }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  els.push(el, input);
  context.setLanguage('en');
  assert.equal(store.get('sancord_lang'), 'en');
  assert.equal(el.textContent, 'Servers');
  assert.equal(input.attrs.placeholder, 'Search');
  context.setLanguage('xx');
  assert.equal(context.currentLanguage(), 'en');
});

test('tipo de autor: campo novo e mensagens antigas de sistema', () => {
  const source = fs.readFileSync(path.join(__dirname, '../static/js/chat.js'), 'utf8');
  const start = source.indexOf('function authorKindOf(');
  const c = vm.createContext({});
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), c);
  assert.equal(c.authorKindOf({ author_kind: 'bot' }), 'bot');
  assert.equal(c.authorKindOf({ author_id: 'system' }), 'system');
  assert.equal(c.authorKindOf({ author_id: 'u1' }), 'user');
});

test('nomes herdados de Object não são idiomas nem chaves de tradução', () => {
  for (const saved of ['__proto__', 'constructor', 'toString']) {
    const { context, store } = loadI18n(saved);
    assert.equal(context.currentLanguage(), 'pt-BR');
    context.setLanguage('en');context.setLanguage(saved);
    assert.equal(context.currentLanguage(), 'en');assert.equal(store.get('sancord_lang'), 'en');
    assert.equal(context.t(saved, {anything:'value'}), saved);
  }
});
