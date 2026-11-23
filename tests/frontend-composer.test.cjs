const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function fixture(t) {
  const h = await openInterface(t);
  h.run(`
    state.selfUser = {id:'ana',username:'Ana'};
    state.activeView = 'server'; state.activeServerId = 's1'; state.currentTextChannel = 'c1';
    state.composerCapabilities = new Set(['media_v1','scheduling_v1']);
    state.audioSettings.showTyping = false;
    const allowed = {view_channel:true,read_history:true,send_messages:true,attach_files:true,connect_voice:true,create_invites:true};
    state.textChannels = ['c1','c2'].map(id => ({id,name:id,kind:'text',effective_permissions:{...allowed}}));
    state.voiceChannels = [{id:'v1',name:'Sala de conversa',kind:'voice',effective_permissions:{...allowed}}];
    state.servers = [{id:'s1',name:'Estação',owner_username:'ana',members:['ana','bia'],roles:[],text_channels:state.textChannels,voice_channels:state.voiceChannels}];
    globalThis.packets = [];
    sendWs = (type,payload) => { packets.push({type,payload}); return true; };
    sendChatPayload = payload => sendWs('SendChat',payload);
    document.getElementById('login-modal').classList.add('hidden');
    onChannelOpened('c1');
  `);
  return h;
}

test('menu abre recursos permitidos, navega por teclado e some em canal somente leitura', async t => {
  const h = await fixture(t), d = h.document;
  const action = d.getElementById('attach-image-btn');
  action.click();
  const menu = d.querySelector('.sancord-menu');
  assert.match(menu.textContent, /Anexar arquivos.*Criar tópico.*Criar enquete/);
  assert.doesNotMatch(menu.textContent, /Apps|clipe/);
  assert.equal(action.getAttribute('aria-expanded'), 'true');
  d.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}));
  assert.match(d.activeElement.textContent, /Criar tópico/);
  d.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  assert.equal(d.querySelector('.sancord-menu'), null);
  assert.equal(d.activeElement, action);
  h.run(`state.textChannels[0].effective_permissions.send_messages = false; applyChannelHeader(state.servers[0], state.textChannels[0]);`);
  assert.equal(d.getElementById('chat-form').classList.contains('hidden'), true);
  assert.match(d.getElementById('composer-readonly').textContent, /Você não tem permissão/);
});

test('salto no chat aceita apenas a resposta do alvo atual e cancela ao sair da conversa', async t => {
  const h = await fixture(t);
  h.run(`
    Element.prototype.scrollIntoView = function () {};
    state.chatHistory.c1 = [];
    globalThis.page = id => ({ channel_id: 'c1', around_id: id, has_more: true, has_more_after: true,
      messages: [{ id, channel_id: 'c1', author_name: 'Bia', author_color: '#7862d4', content: 'Uma mensagem', created_at: 1000 }] });
    chatSearchInput.value = state.searchQuery = 'de:Bia';
    jumpToMessage('c1', 'antiga');
    jumpToMessage('c1', 'atual');
    handleMessagesPageV2(page('antiga'));
  `);
  assert.equal(h.run('getHistoryState("c1").loading'), true);
  assert.equal(h.run('state.chatHistory.c1.length'), 0);
  h.run(`handleMessagesPageV2(page('atual'))`);
  assert.equal(h.document.querySelector('.flash-highlight')?.dataset.msgId, 'atual');
  assert.equal(h.document.getElementById('chat-search-input').value, '');
  h.run(`jumpToMessage('c1', 'depois'); switchToHomeFriendsView(); handleMessagesPageV2(page('depois'))`);
  assert.equal(h.run('getHistoryState("c1").loading'), false);
  assert.equal(h.run('state.chatHistory.c1[0].id'), 'atual');
});

test('atalhos mantêm multilinha e cada conversa conserva rascunho, anexos e contexto de envio', async t => {
  const h = await fixture(t), d = h.document, input = d.getElementById('chat-input');
  h.run(`globalThis.uploads = [];
    XMLHttpRequest = class { constructor(){ this.upload = {}; uploads.push(this); } open(_,url){ this.url=url; } setRequestHeader(){} send(file){ this.file=file; } abort(){} };`);
  input.value = 'Uma linha\nOutra linha';
  input.dispatchEvent(new h.w.Event('input', {bubbles:true}));
  h.run(`state.audioSettings.chatEnterSends = false; addComposerFiles([new File(['a'],'a.txt'),new File(['b'],'b.txt')]);`);
  const key = opts => input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...opts}));
  assert.equal(h.run('uploads.length'), 0);
  assert.equal(key({ctrlKey:true,shiftKey:true}), true, 'Shift+Enter nunca envia');
  assert.equal(key({}), true, 'Enter insere uma linha neste modo');
  assert.equal(key({ctrlKey:true}), false);
  assert.equal(h.run('uploads.length'), 2);
  h.run(`uploads[0].upload.onprogress({lengthComputable:true,loaded:1,total:2});`);
  assert.equal(d.querySelector('.tray-progress').value, 50);
  h.run(`state.currentTextChannel = 'c2'; onChannelOpened('c2');`);
  assert.equal(input.value, '');
  h.run(`for (const [index,xhr] of uploads.entries()) { xhr.status=200; xhr.responseText=JSON.stringify({ok:true,attachment:{id:'upload'+index}}); xhr.onload(); }`);
  assert.equal(h.run('packets.length'), 0, 'conclusão em segundo plano não envia para outro canal');
  h.run(`state.currentTextChannel = 'c1'; onChannelOpened('c1');`);
  assert.equal(input.value, 'Uma linha\nOutra linha');
  assert.match(d.getElementById('composer-attachments').textContent, /Concluído/);
  key({ctrlKey:true});
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(packets[0])')), {type:'SendChat',payload:{channel_id:'c1',content:'Uma linha\nOutra linha',reply_to_id:null,reply_mention:true,attachment_ids:['upload0','upload1']}});
});

test('enquete tem opções individuais e agendamento valida a resposta antes de limpar o texto', async t => {
  const h = await fixture(t), d = h.document, input = d.getElementById('chat-input');
  h.run('openPollDialog()').catch(() => {});
  const form = d.querySelector('.sancord-dialog form');
  form.querySelector('[id^=f-question]').value = 'Onde jogamos?';
  form.querySelector('.dialog-text-list button').click();
  [...form.querySelectorAll('.dialog-text-list input')].forEach((value,index) => { value.value = `Opção ${index+1}`; });
  form.dispatchEvent(new h.w.Event('submit',{cancelable:true,bubbles:true}));
  await h.flush();
  assert.equal(h.run('packets[0].payload.poll.options.length'), 3);
  input.value = 'Mensagem para amanhã';
  d.getElementById('attach-image-btn').click();
  const trigger = [...d.querySelectorAll('.sancord-menu button')].find(button => button.textContent.includes('Agendar mensagem'));
  trigger.click();
  const submenu = d.querySelector('.sancord-submenu');
  assert.ok(submenu);
  [...submenu.querySelectorAll('button')].find(button => button.textContent.includes('Amanhã')).click();
  assert.equal(h.run('packets.at(-1).type'), 'ScheduleMessage');
  assert.equal(input.value, 'Mensagem para amanhã');
  await h.run('handleServerMessage({type:"ServerFeedback",payload:{ok:true,action:"schedule_message",message:"Mensagem agendada."}})');
  assert.equal(input.value, '');
});

test('10 participantes ficam sob a sala, abrem o perfil compartilhado e usam volume local', async t => {
  const h = await fixture(t), d = h.document;
  h.run(`state.currentVoiceChannel='v1'; state.voiceMembers.v1=[];
    for (let i=0;i<10;i++) {
      const id='peer'+i;
      state.users.set(id,{id,username:'Pessoa'+i,voice_channel_id:'v1',muted:i===2,camera_on:i===3,screen_sharing:i===4});
      state.voiceMembers.v1.push(id);
    }
    state.speakingUsers.add('peer4'); renderVoiceChannels();`);
  const channel = d.querySelector('.voice-channel-node');
  assert.equal(channel.querySelectorAll('.voice-user-row').length,10);
  assert.equal(channel.querySelector('.voice-channel-join').getAttribute('aria-pressed'),'true');
  assert.equal(channel.querySelector('.voice-user-row.speaking').dataset.speakingUser,'peer4');
  assert.ok(channel.querySelector('[aria-label="Microfone silenciado"]'));
  channel.querySelector('.voice-user-main').click();
  assert.equal(d.getElementById('compact-profile-modal').classList.contains('hidden'),false);
  h.run('closeCompactProfile(false)');
  channel.querySelector('.voice-user-more').click();
  const slider = d.querySelector('.voice-menu-volume input');
  slider.value = '135';
  slider.dispatchEvent(new h.w.Event('input'));
  assert.equal(h.run('getStoredVolume("peer0")'),135);
  assert.equal(h.run('packets.filter(p => p.type === "ModerateVoice").length'),0);
});

test('arrastar e colar preparam anexos e respeitam permissão de envio', async t => {
  const h = await fixture(t), d = h.document;
  h.run('switchToServerView()');
  const area = h.run('chatMainView');
  const transfer = { types:['Files'], files:[new h.w.File(['imagem'],'referencia.png',{type:'image/png'})] };
  const enter = new h.w.Event('dragenter',{bubbles:true,cancelable:true});
  Object.defineProperty(enter,'dataTransfer',{value:transfer});
  area.dispatchEvent(enter);
  assert.equal(d.getElementById('chat-drop-overlay').classList.contains('hidden'),false);
  const drop = new h.w.Event('drop',{bubbles:true,cancelable:true});
  Object.defineProperty(drop,'dataTransfer',{value:transfer});
  area.dispatchEvent(drop);
  assert.equal(h.run('state.composerFiles.length'),1);
  const paste = new h.w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[new h.w.File(['foto'],'colada.png',{type:'image/png'})]}});
  d.getElementById('chat-input').dispatchEvent(paste);
  assert.equal(h.run('state.composerFiles.length'),2);
  assert.equal(h.run('state.composerFiles.every(item => item.status === "pending")'),true);
  h.run('state.textChannels[0].effective_permissions.attach_files = false;');
  area.dispatchEvent(drop);
  assert.equal(h.run('state.composerFiles.length'),2);
});

test('detalhes de voz exibem somente métricas medidas e usam a rota ICE selecionada', async t => {
  const h = await fixture(t), d = h.document;
  await h.run(`state.currentVoiceChannel='v1'; state.peers = new Map([['peer',{pc:{getStats:async () => new Map([
    ['transport',{type:'transport',selectedCandidatePairId:'pair'}],
    ['pair',{type:'candidate-pair',currentRoundTripTime:.094,localCandidateId:'local',remoteCandidateId:'remote'}],
    ['local',{protocol:'udp',candidateType:'relay'}], ['remote',{candidateType:'srflx'}],
    ['audio',{type:'inbound-rtp',kind:'audio',jitter:.012,packetsReceived:99,packetsLost:1,codecId:'codec'}],
    ['codec',{mimeType:'audio/opus'}],
  ])}}]]); refreshVoiceConnectionDetails()`);
  const details = d.getElementById('voice-connection-details').textContent;
  assert.match(details, /Boa.*Ping94 ms.*Jitter12 ms.*1\.0%.*opus.*UDP · TURN/s);
  assert.doesNotMatch(details, /Capacidade/);
});
