import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function runComposerVoiceQa(page, evaluate) {
  const destination = resolve(process.env.SANCORD_QA_SCREENSHOTS || 'qa-composer-voice');
  await mkdir(destination, { recursive: true });
  async function snapshot(name) {
    await evaluate('new Promise(resolve => setTimeout(resolve, 180))');
    const { data } = await page('Page.captureScreenshot', { format:'png', fromSurface:true });
    await writeFile(resolve(destination, `${name}.png`), Buffer.from(data, 'base64'));
  }
  async function resize(width, height) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
    await evaluate('new Promise(resolve => setTimeout(resolve, 250))');
  }
  await page('Emulation.setFocusEmulationEnabled', { enabled:true });
  await resize(1366,768);
  const opened = await evaluate(`(() => {
    const errors = globalThis.qaComposerErrors = [];
    window.addEventListener('error', event => { errors.push(event.message); });
    state.selfUser = {id:'lume',username:'Lume',display_name:'Lume',avatar_color:'#7566ba',status_kind:'online',online:true};
    state.users.set('lume',state.selfUser);
    state.composerCapabilities = new Set(['media_v1','scheduling_v1']);
    const perms = { view_channel:true,read_history:true,send_messages:true,attach_files:true,connect_voice:true,create_invites:true };
    const channel = {id:'qa-text',name:'resenha',kind:'text',topic:'Planos para a próxima partida',effective_permissions:perms};
    const voice = {id:'qa-voice',name:'Estação de conversa',kind:'voice',effective_permissions:perms};
    state.servers = [{id:'qa-server',name:'Estação Aurora',members:['lume','nina','rui'],owner_username:'lume',roles:[],text_channels:[channel],voice_channels:[voice]}];
    state.activeView = 'server'; state.activeServerId = 'qa-server'; state.currentTextChannel = channel.id;
    state.textChannels = [channel]; state.voiceChannels = [voice];
    state.chatHistory[channel.id] = [
      ['Nina','Alguém já terminou de montar o mapa?','#a689c3'],
      ['Rui','A primeira parte está pronta. Podemos testar na sexta.','#65a6ae'],
      ['Lume','Boa! Vou deixar as referências no canal.','#9a85e2'],
    ].map(([name,content,color],i) => ({id:'qa-message-'+i,channel_id:channel.id,author_id:name.toLowerCase(),author_name:name,author_color:color,timestamp:'18:30',created_at:Date.now() - (3-i)*60000,content}));
    globalThis.qaPackets = [];
    sendWs = (type,payload) => { qaPackets.push({type,payload}); return true; };
    document.getElementById('login-modal').classList.add('hidden');
    switchToServerView();
    updateSelfProfileUI();
    chatInput.value = 'Podemos testar às 19h.';
    chatInput.dispatchEvent(new Event('input'));
    document.getElementById('attach-image-btn').click();
    return {open:Boolean(document.querySelector('.sancord-menu')), context:composerContext(), disabled:composerActionButton.disabled, errors};
  })()`);
  assert.ok(opened.open, JSON.stringify(opened));
  assert.ok(await evaluate(`(() => { const m = document.querySelector('.sancord-menu').getBoundingClientRect();
    return m.left >= 0 && m.top >= 0 && m.right <= innerWidth && m.bottom <= chatForm.getBoundingClientRect().bottom; })()`));
  await snapshot('01-acoes-do-composer');
  await evaluate(`Array.from(document.querySelectorAll('.sancord-menu button')).find(b => b.textContent.includes('Agendar mensagem')).click()`);
  await snapshot('02-agendamento');
  await evaluate(`SancordUI.closeContextMenu(); openPollDialog(); null`);
  await snapshot('03-enquete');
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape', bubbles:true}));
    document.getElementById('sticker-picker-btn').click()`);
  await snapshot('04-figurinhas');
  await evaluate(`prepareSticker({ recipe:stickerCollection[0], id:stickerCollection[0][0], name:stickerCollection[0][1] })`);
  assert.equal(await evaluate('state.composerFiles[0]?.presentation'), 'sticker');
  await evaluate(`addComposerFiles([new File(['referências'], 'Notas do mapa.txt', {type:'text/plain'})]);
    setReplyingTo(state.chatHistory['qa-text'][0]);`);
  await snapshot('05-resposta-e-anexos');
  await evaluate(`clearComposerFiles(); clearReplyingTo(); openVoiceRecorder()`);
  assert.equal(await evaluate('voiceRecording?.recorder?.state'), 'recording');
  await snapshot('06-gravacao');
  await evaluate(`stopVoiceRecording(voiceRecording); new Promise(resolve => setTimeout(resolve, 200))`);
  assert.ok(await evaluate('voiceRecording?.file?.size > 0 && voiceRecording?.stream === null'));
  assert.ok(await evaluate(`(async () => {
    const audio = voiceRecorderPanel.querySelector('audio'); audio.muted = true;
    await audio.play(); await new Promise(resolve => setTimeout(resolve, 60));
    audio.pause(); return audio.currentTime > 0;
  })()`));
  await snapshot('07-audio-pronto');
  await evaluate(`(() => {
    cancelVoiceRecording(false);
    state.currentVoiceChannel = 'qa-voice';
    state.voiceMembers['qa-voice'] = [];
    for (const [index,name] of ['Lume','Nina','Rui','Mika','Bia','Leo','Cris','Dani','Vini','Ana'].entries()) {
      const id = name.toLowerCase();
      state.users.set(id,{id,username:name,online:true,avatar_color:['#7368b2','#548884','#945e86'][index%3],voice_channel_id:'qa-voice',muted:index===2,screen_sharing:index===3,camera_on:index===4});
      state.voiceMembers['qa-voice'].push(id);
    }
    state.speakingUsers.add('nina');
    state.speakingUsers.add('mika');
    voiceConnectionPanel.classList.remove('hidden');
    activeVoiceChannelName.textContent = 'Estação de conversa';
    updateVoiceDockContext('qa-voice');
    renderVoiceChannels();
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll('.voice-user-row').length`), 10);
  assert.equal(await evaluate(`document.querySelector('#sticker-picker-btn').querySelectorAll('svg').length`), 1);
  await snapshot('08-voz-dez-participantes');
  await resize(1120,730);
  assert.ok(await evaluate(`(() => { const name = document.querySelector('[data-speaking-user="mika"] .voice-user-name'); return name.scrollWidth <= name.clientWidth; })()`));
  await snapshot('08b-voz-largura-reduzida');
  await resize(1366,768);
  await evaluate(`document.querySelector('[data-speaking-user="nina"] .voice-user-more').click()`);
  await snapshot('09-volume-local');
  await evaluate(`SancordUI.closeContextMenu(); openDmConversation('dm:lume__nina', state.users.get('nina'));
    state.currentVoiceChannel = 'dmvoice:lume__nina'; activeVoiceChannelName.textContent = 'Nina';
    updateDmCallButtonUI();
    state.voiceMembers[state.currentVoiceChannel] = ['lume','nina']; stageTitle.textContent = 'Chamada privada · Nina';
    voiceStage.classList.remove('hidden'); renderVoiceStage(); updateVoiceDockContext(state.currentVoiceChannel);`);
  assert.equal(await evaluate(`document.querySelectorAll('#private-stage-controls button').length`), 5);
  await snapshot('10-chamada-privada');
  await resize(1920,1080);
  await snapshot('11-chamada-privada-1920');
  assert.deepEqual(await evaluate('qaComposerErrors'), []);
  console.log(JSON.stringify({ screenshots:destination, resolutions:[1120,1366,1920], participants:10, virtualMicrophone:true }));
}
