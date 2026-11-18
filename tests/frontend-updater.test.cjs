const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/updater.js'), 'utf8');
function harness() {
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) {
      const hidden = new Set(); const handlers = {};
      elements.set(id, { handlers, textContent:'', innerHTML:'', disabled:false,
        classList:{ add:x=>hidden.add(x), remove:x=>hidden.delete(x), toggle:(x,on)=>on?hidden.add(x):hidden.delete(x), contains:x=>hidden.has(x) },
        setAttribute(){}, addEventListener:(type,fn)=>handlers[type]=fn,
      });
    }
    return elements.get(id);
  }
  const sent = []; let receive;
  const context = vm.createContext({
    document: { createElement:()=>el('toast'), body:{ appendChild(){} }, getElementById:el,
      querySelectorAll:selector=>[el(selector)], },
    window:{ ipc:{ postMessage:m=>sent.push(m) }, addEventListener:(name,fn)=>receive=fn },
  });
  vm.runInContext(source, context);
  return { el, sent, event:detail=>receive({detail}) };
}
test('versão e changelog assinado são texto; download e reinício exigem ação', () => {
  const c=harness();
  c.event({ phase:'available', version:'0.2.0', current:'0.1.0', notes:'<script>unsafe()</script>' });
  assert.equal(c.el('[data-update-current]').textContent,'0.1.0');
  assert.equal(c.el('[data-update-notes]').textContent,'<script>unsafe()</script>');
  assert.equal(c.el('toast').classList.contains('hidden'),false);
  assert.deepEqual(c.sent,['updates:status']);
  c.el('toast-update-action').handlers.click();
  assert.equal(c.sent.at(-1),'updates:download');
  c.event({ phase:'ready', version:'0.2.0' });
  c.el('settings-update-action').handlers.click();
  assert.equal(c.sent.at(-1),'updates:restart');
});
test('progresso limitado e erros de rede permitem verificar novamente', () => {
  const c=harness(); c.el('check-updates-btn').handlers.click();
  assert.equal(c.sent.at(-1),'updates:check');
  c.event({phase:'downloading',percent:120});
  assert.equal(c.el('[data-update-progress]').value,100);
  assert.equal(c.el('check-updates-btn').disabled,true);
  c.event({phase:'error',message:'Sem conexão'});
  assert.equal(c.el('[data-update-status]').textContent,'Sem conexão');
  assert.equal(c.el('check-updates-btn').disabled,false);
  c.event({phase:'up_to_date'});
  assert.equal(c.el('toast').classList.contains('hidden'),true);
});
