const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('static/app.js'), chat = read('static/js/chat.js');
function take(source, name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
function icons(context) { vm.runInContext(read('static/js/icons.js'), context); }

test('ícones de controles usam geometria local; nomes desconhecidos não injetam markup', () => {
  const c = vm.createContext({}); icons(c);
  assert.equal(vm.runInContext('SancordIcons.resolve("↑")', c), 'arrow-up');
  assert.equal(vm.runInContext('SancordIcons.resolve("↓")', c), 'arrow-down');
  for (const name of ['hash','settings','reply','camera','🗑️']) {
    c.input = name;
    const html = vm.runInContext('SancordIcons.html(input)', c);
    assert.match(html, /viewBox="0 0 24 24"/);
    assert.match(html, /aria-hidden="true"/);
    assert.doesNotMatch(html, /href=|<script|onload=/);
  }
  for (const name of ['__proto__','constructor','<img src=x onerror=alert(1)>']) {
    c.input = name;
    assert.equal(vm.runInContext('SancordIcons.resolve(input)', c), 'more');
  }
});

test('estado vazio compartilha ícone e escapa títulos e descrições', () => {
  const c = vm.createContext({}); icons(c);
  const source = read('static/js/ui-kit.js');
  const start = source.indexOf('  function emptyHTML(');
  vm.runInContext(source.slice(start, source.indexOf('\n  }', start) + 4), c);
  c.value = {title:'<img onerror="x">',description:'A & B',icon:'search'};
  const html = vm.runInContext('emptyHTML(value)', c);
  assert.match(html, /class="ui-empty"/);
  assert.match(html, /data-sancord-icon="search"/);
  assert.match(html, /&lt;img/);
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<img/);
});

test('tooltip mantém o nome acessível e acompanha mudanças de estado do controle', () => {
  const c = vm.createContext({});
  const source = read('static/js/ui-kit.js');
  const start = source.indexOf('  function tooltipText(');
  vm.runInContext(source.slice(start, source.indexOf('\n  }', start) + 4), c);
  const attrs = new Map();
  const control = {title:'Silenciar',dataset:{},hasAttribute:k=>attrs.has(k),getAttribute:k=>attrs.get(k),
    setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>{if(k==='title')control.title='';}};
  assert.equal(c.tooltipText(control), 'Silenciar');
  assert.equal(attrs.get('aria-label'), 'Silenciar');
  assert.equal(control.title, '');
  control.title = 'Ativar microfone';
  assert.equal(c.tooltipText(control), 'Ativar microfone');
  assert.equal(attrs.get('aria-label'), 'Ativar microfone');
  attrs.set('aria-label', 'Nome específico'); control.title = 'Ajuda complementar';
  c.tooltipText(control);
  assert.equal(attrs.get('aria-label'), 'Nome específico');
});

test('painel inclui membros reais offline, elimina sessões repetidas e filtra outros servidores', () => {
  const c = vm.createContext({}); take(app, 'sidebarMemberRows', c);
  const srv = {id:'s1',owner_username:'ana',members:['ana','bia','caio']};
  const rows = c.sidebarMemberRows(srv, [
    {id:'1',username:'Ana',status_kind:'online'}, {id:'2',username:'ANA',status_kind:'online'},
    {id:'3',username:'Outro',status_kind:'online'},
  ]);
  assert.deepEqual(Array.from(rows, u => u.username.toLowerCase()).sort(), ['ana','bia','caio']);
  assert.equal(rows.filter(u => u.status_kind === 'offline').length, 2);
  assert.equal(rows.find(u => u.username === 'bia').id, null);
  assert.equal(c.sidebarMemberRows({id:'sancord',members:['desconhecido']}, []).length, 0);
});

function welcomeHarness(history) {
  const fragment = {children:[],appendChild(node){this.children.push(node);}};
  const output = {children:[],innerHTML:'',querySelector(){return null;},appendChild(node){this.children.push(node);}};
  const c = vm.createContext({
    state:{chatHistory:{geral:[]},textChannels:[{id:'geral',name:'<canal>'}],unreadDividerByChannel:new Map()},
    document:{createDocumentFragment:()=>fragment,createElement:()=>({className:'',innerHTML:''}),getElementById:()=>null},
    chatMessagesEl:output,getActiveTextChannelId:()=> 'geral',getHistoryState:()=>history,
    captureMessageEdit(){},restoreMessageEdit(){},updatePinnedBadge(){},updateJumpPresentBar(){},maybeAckActiveChannel(){},requestAnimationFrame:fn=>fn(),
  });
  icons(c); take(app, 'escapeHtml', c); take(chat, 'renderChatMessagesV2', c);
  c.renderChatMessagesV2(); return fragment.children;
}
test('canal vazio confirmado mostra boas-vindas com o nome escapado', () => {
  const children = welcomeHarness({loading:false,hasMore:false});
  assert.equal(children.length, 1);
  assert.match(children[0].className, /channel-welcome/);
  assert.match(children[0].innerHTML, /# &lt;canal&gt;/);
  assert.doesNotMatch(children[0].innerHTML, /<canal>/);
});
test('carregamento e janelas parciais do histórico não fingem início do canal', () => {
  for (const history of [{loading:true},{hasMore:true},{hasNewer:true}]) assert.equal(welcomeHarness(history).length, 0);
});

test('composer cresce até o limite sem ocupar metade da janela', () => {
  const c = vm.createContext({window:{innerHeight:600}}); take(chat, 'autosizeTextarea', c);
  const large = {style:{},scrollHeight:900}; c.autosizeTextarea(large);
  assert.equal(large.style.height, '180px');
  const small = {style:{},scrollHeight:44}; c.autosizeTextarea(small);
  assert.equal(small.style.height, '44px');
});

function deleteRoleHarness(confirmation) {
  let callback; const sent = [];
  const c = vm.createContext({document:{getElementById:()=>({addEventListener:(_,fn)=>{callback=fn;}})},
    state:{servers:[{id:'server'}]}, editingServerId:'server',selectedRoleId:'role-a',
    SancordUI:{confirm:()=>confirmation},sendWs:(...args)=>sent.push(args)});
  const start = app.indexOf('document.getElementById("role-edit-delete-btn")?.addEventListener');
  const end = app.indexOf('\ndocument.getElementById("srv-quick-add-text-btn")', start);
  vm.runInContext(app.slice(start,end), c);
  return {c,sent,run:()=>callback()};
}
test('cancelar confirmação compartilhada não envia exclusão', async () => {
  const h = deleteRoleHarness(Promise.resolve(false)); await h.run(); assert.equal(h.sent.length,0);
});
test('confirmação assíncrona mantém o cargo escolhido antes de abrir o diálogo', async () => {
  let resolve; const confirmation = new Promise(r=>{resolve=r;});
  const h = deleteRoleHarness(confirmation); const pending = h.run();
  h.c.selectedRoleId = 'role-b'; resolve(true); await pending;
  assert.equal(h.sent.length,1); assert.equal(h.sent[0][1].role_id,'role-a');
});
