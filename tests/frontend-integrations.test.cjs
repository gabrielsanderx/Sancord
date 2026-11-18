const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/js/integrations.js'),'utf8');
function load(extra){const c=vm.createContext({t:k=>k,...extra});vm.runInContext(source.slice(0,source.indexOf('document.getElementById("integration-channel")?.addEventListener')),c);return c;}
test('gerenciamento envia sessão só no header e recusa erro HTTP sem expor credencial',async()=>{
  const calls=[];let ok=true;
  const c=load({getStoredToken:()=> 'sessao-teste',SancordTransport:{fetch:async(path,opts)=>{calls.push({path,opts});return {ok,json:async()=>ok?{ok:true}: {ok:false,message:'Sem acesso'}};}}});
  await c.integrationApi('/api/channels/c/integrations','POST',{name:'Nome',kind:'bot'});
  assert.equal(calls[0].opts.headers.Authorization,'Bearer sessao-teste');assert.equal(calls[0].opts.redirect,'error');
  assert.ok(!calls[0].path.includes('sessao'));assert.ok(!calls[0].opts.body.includes('sessao'));
  ok=false;await assert.rejects(c.integrationApi('/api/channels/c/integrations'),/Sem acesso/);
});
test('seletor de integrações filtra canais por permissão e tipo',()=>{
  const c=load({getChannelPermissions:(_,ch)=>ch.perms});
  const p={view_channel:true,send_messages:true,manage_channels:true};
  const result=c.integrationChannels({text_channels:[{id:'ok',kind:'text',perms:p},{id:'forum',kind:'forum',perms:p},
    {id:'anuncio',kind:'announcement',perms:p},{id:'privado',kind:'text',perms:{...p,view_channel:false}}]});
  assert.equal(result.map(x=>x.id).join(','),'ok');
});
test('bot com nome igual ao usuário não é tratado como mensagem própria',()=>{
  const chat=fs.readFileSync(path.join(__dirname,'../static/js/chat.js'),'utf8');
  const start=chat.indexOf('function isOwnMessage(');const c=vm.createContext({state:{selfUser:{id:'eu'}},myLower:()=> 'ana'});
  vm.runInContext(chat.slice(start,chat.indexOf('\n}',start)+2),c);
  assert.equal(c.isOwnMessage({author_id:'bot',author_name:'Ana',author_kind:'bot'}),false);
  assert.equal(c.isOwnMessage({author_id:'eu',author_name:'Ana'}),true);
});
