const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '../..');

// Isola somente o DOM. Não acessa contas, rede, banco ou dispositivos reais.
async function openInterface(t) {
  const errors = [], captures = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'static/index.html'), 'utf8'), {
    url: 'https://sancord.invalid/', runScripts: 'outside-only',
    virtualConsole: console, pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window, document = w.document, context = dom.getInternalVMContext();
  w.addEventListener('error', e => errors.push(e.error?.stack || e.message));
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.setInterval = () => 0;
  w.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_') };
  w.fetch = async () => { throw Error('Rede indisponível no teste de DOM'); };
  w.WebSocket = class {
    static OPEN = 1; static CLOSED = 3; readyState = 3;
    addEventListener() {} close() {} send() { throw Error('Sem conexão de teste'); }
  };
  w.Audio = class { pause() {} play() { return Promise.resolve(); } };
  Object.defineProperty(w.navigator, 'mediaDevices', { value: {
    enumerateDevices: async () => [],
    getUserMedia: async () => { captures.push('microphone'); throw Error('Captura bloqueada no teste'); },
    getDisplayMedia: async () => { captures.push('screen'); throw Error('Captura bloqueada no teste'); },
  } });
  for (const script of document.querySelectorAll('script[src]')) {
    const file = path.join(root, 'static', new URL(script.src).pathname);
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(context);
  }
  const flush = () => new Promise(resolve => w.setTimeout(resolve, 0));
  await flush();
  t.after(() => assert.deepEqual(errors, [], 'nenhum erro de script/evento'));
  return { w, document, captures, flush, run: source => vm.runInContext(source, context) };
}
module.exports = { openInterface };
