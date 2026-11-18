// Exercita os módulos reais com DOM mínimo, sem backend, microfone ou janela nativa.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../static/js',name),'utf8');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};this.textContent='';this.classList={add(){},remove(){},toggle(){}};}
  appendChild(child){child.parent=this;this.children.push(child);return child;}
  append(...children){children.forEach(child=>this.appendChild(child));}
  setAttribute(){}
  addEventListener(type,fn){this.events[type]=fn;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  querySelector(){return null;}
  all(){return this.children.flatMap(child=>[child,...child.all()]);}
}
function load(){
  const body=new Element('body'),store=new Map([['sancord_lang','en']]),handlers={};
  const doc={body,readyState:'loading',documentElement:{},activeElement:null,
    createElement:tag=>new Element(tag),
    addEventListener(type,fn){(handlers[type]??=[]).push(fn);},removeEventListener(){},
    dispatchEvent(e){handlers[e.type]?.forEach(fn=>fn(e));},
    querySelectorAll(sel){return sel==='[data-i18n]'?body.all().filter(n=>n.dataset.i18n):[];},
  };
  const c=vm.createContext({document:doc,localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
    CustomEvent:class {constructor(type){this.type=type;}},setTimeout(){},
  });
  vm.runInContext(read('i18n.js'),c);vm.runInContext(read('ui-kit.js')+'\nthis.ui=SancordUI;',c);
  return {c,body,doc};
}
const click=node=>node.events.click({});
test('diálogo aberto muda idioma sem recriar nem encerrar o formulário',async()=>{
  const {c,body}=load();const result=c.ui.formDialog({title:'Minha anotação'});
  const buttons=body.all().filter(n=>n.tag==='button'),title=body.all().find(n=>n.tag==='h2');
  assert.equal(buttons[0].textContent,'Cancel');assert.equal(buttons[1].textContent,'Save');
  c.setLanguage('pt-BR');
  assert.equal(buttons[0].textContent,'Cancelar');assert.equal(buttons[1].textContent,'Salvar');
  assert.equal(title.textContent,'Minha anotação');assert.equal(body.children.length,1);
  click(buttons[0]);assert.equal(await result,null);assert.equal(body.children.length,0);
});
test('confirmação traduz padrão, preserva ação explícita e mantém resultado',async()=>{
  const {c,body}=load();const defaultResult=c.ui.confirm({title:'Teste',message:'Conteúdo do usuário'});
  assert.equal(body.all().find(n=>n.type==='submit').textContent,'Confirm');
  body.all().find(n=>n.tag==='form').events.submit({preventDefault(){}});assert.equal(await defaultResult,true);
  const customResult=c.ui.confirm({title:'Teste',confirmLabel:'Excluir minha postagem'});
  c.setLanguage('pt-BR');assert.equal(body.all().find(n=>n.type==='submit').textContent,'Excluir minha postagem');
  click(body.all().find(n=>n.tag==='button'&&n.type==='button'));assert.equal(await customResult,false);
});
function addFunction(c,source,name){const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);}
test('navegação rápida traduz categorias e preserva nomes e ação da conversa',()=>{
  const {c}=load(),sent=[];
  c.state={servers:[{id:'s1',name:'Servidor da Ana',voice_channels:[{id:'v1',name:'Conversa'}]}],threadIndex:new Map(),
    dmConversations:[{dm_id:'dm:a__b',peer:{username:'Ana'}}],groupDms:[{id:'g1',name:'Turma'}],friends:[{username:'Beto'}]};
  c.groupDisplayName=g=>g.name;c.sendWs=(...args)=>sent.push(args);
  addFunction(c,read('polish.js'),'quickSwitcherItems');
  let items=c.quickSwitcherItems();assert.equal(items[0].label,'Servidor da Ana');assert.equal(items[0].sub,'Server');
  assert.equal(items[1].sub,'Servidor da Ana • voice');assert.equal(items[2].sub,'Direct message');
  assert.equal(items[3].sub,'Group');assert.equal(items[4].sub,'Friend');
  items[2].go();assert.equal(sent[0][0],'OpenDm');assert.equal(sent[0][1].target_username,'Ana');
  c.setLanguage('pt-BR');items=c.quickSwitcherItems();assert.equal(items[2].sub,'Mensagem direta');assert.equal(items[2].label,'Ana');
});
test('lista de atalhos troca descrições e preserva as teclas',()=>{
  const {c,doc}=load(),box=new Element('div'),source=read('polish.js');
  doc.getElementById=id=>id==='shortcuts-extra-rows'?box:null;
  const start=source.indexOf('const EXTRA_SHORTCUTS =');vm.runInContext(source.slice(start,source.indexOf('\n];',start)+3),c);
  addFunction(c,source,'renderExtraShortcuts');c.renderExtraShortcuts();
  assert.equal(box.children[0].children[0].textContent,'Quick navigation (channels, people, servers)');
  assert.equal(box.children[0].children[1].textContent,'Ctrl + K');
  box.children=[];c.setLanguage('pt-BR');c.renderExtraShortcuts();
  assert.equal(box.children[0].children[0].textContent,'Navegação rápida (canais, pessoas, servidores)');
  assert.equal(box.children[0].children[1].textContent,'Ctrl + K');
});
