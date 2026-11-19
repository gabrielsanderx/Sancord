const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
function load(names, globals) {
  const c = vm.createContext({ Map, Set, ...globals });
  for (const name of names) {
    let start = source.indexOf(`async function ${name}(`);
    if (start < 0) start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), c);
  }
  return c;
}
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function joinHarness(captures, connected = true) {
  const sent = [], errors = [];
  let capture = 0;
  const node = () => ({ textContent:'', classList:{ add(){}, remove(){} } });
  const state = { currentVoiceChannel:null, voiceChannels:[], muted:false, deafened:false };
  const c = load(['joinVoiceChannel','leaveVoiceChannel'], {
    state, isPrivateVoiceId:()=>true, ensureLocalAudioStream:()=>captures[capture++].promise,
    sendWs:(type,payload)=>{sent.push({type,payload});return connected;},
    showErrorToast:m=>errors.push(m), releaseLocalAudioStream(){}, cleanupAllPeers(){}, playUiSound(){}, clearUnansweredCallTimer(){},
    stopVoicePingMonitor(){},stopVoiceCallTimer(){},stopScreenSharing(){},stopCamera(){},
    getFriendlyVoiceName:id=>id, syncVoiceStageContext(){}, startVoicePingMonitor(){},startVoiceCallTimer(){},syncVoiceStateWithServer(){},
    startUnansweredCallTimer(){},updateSelfProfileUI(){},updateQuickKrispBtnUI(){},renderVoiceChannels(){},renderVoiceStage(){},updateDmCallButtonUI(){},
    activeVoiceChannelName:node(),stageTitle:node(),voiceConnectionPanel:node(),voiceStage:node(),toggleStageBtn:node(),
  });
  return {c,state,sent,errors};
}
test('sair enquanto o microfone aguarda resposta cancela a entrada atrasada', async () => {
  const capture=deferred(); const h=joinHarness([capture]);
  const join=h.c.joinVoiceChannel('dmvoice:a__b');
  h.c.leaveVoiceChannel(); capture.resolve({}); await join;
  assert.equal(h.state.currentVoiceChannel,null);
  assert.equal(h.sent.filter(m=>m.type==='JoinVoice').length,0);
});
test('duas entradas concorrentes respeitam o último canal escolhido', async () => {
  const first=deferred(), second=deferred(); const h=joinHarness([first,second]);
  const a=h.c.joinVoiceChannel('dmvoice:a__b'); const b=h.c.joinVoiceChannel('dmvoice:a__c');
  second.resolve({}); await b; first.resolve({}); await a;
  assert.equal(h.state.currentVoiceChannel,'dmvoice:a__c');
  assert.equal(h.sent.filter(m=>m.type==='JoinVoice').length,1);
});
test('WebSocket indisponível não apresenta uma nova chamada como conectada', async () => {
  const capture=deferred();const h=joinHarness([capture],false);
  const join=h.c.joinVoiceChannel('dmvoice:a__b');capture.resolve({});await join;
  assert.equal(h.state.currentVoiceChannel,null);
  assert.equal(h.errors.length,1);
});
test('fechar participante interrompe também o caminho de áudio amplificado', () => {
  const calls=[];
  const audio={srcObject:{},muted:false,volume:1,pause:()=>calls.push('pause'),remove:()=>calls.push('remove')};
  const gain={gain:{value:1.5},disconnect:()=>calls.push('gain-disconnect')};
  const input={disconnect:()=>calls.push('source-disconnect')};
  const state={peers:new Map([['peer',{pc:{close:()=>calls.push('close')},vadStops:[()=>calls.push('vad-stop')]}]]),speakingUsers:new Set(),audioGainNodes:new Map([['remote',{peerId:'peer',audioEl:audio,gainNode:gain,sourceNode:input}]])};
  const names = ['closePeerConnection'];
  if(source.includes('function releaseRemoteAudio('))names.unshift('releaseRemoteAudio');
  const c=load(names,{state,clearTimeout(){},document:{querySelectorAll:()=>[audio]}});
  c.closePeerConnection('peer');
  assert.equal(state.audioGainNodes.size,0); assert.equal(state.peers.size,0);
  assert.equal(gain.gain.value,0);
  assert.equal(audio.srcObject,null);
  for(const action of ['pause','gain-disconnect','source-disconnect','vad-stop'])assert.ok(calls.includes(action),action);
});
test('oferta que termina depois de sair da voz não envia SDP antigo', async () => {
  const pending=deferred(), sent=[];
  const entry={pc:{signalingState:'stable',createOffer:()=>pending.promise,setLocalDescription:async function(sdp){this.localDescription=sdp;}},makingOffer:false};
  const state={currentVoiceChannel:'v1',selfUser:{id:'eu'},users:new Map([['peer',{voice_channel_id:'v1'}]]),peers:new Map([['peer',entry]])};
  const names=['initiateOfferToPeer'];
  if(source.includes('function isCurrentVoicePeer('))names.unshift('isCurrentVoicePeer');
  const c=load(names,{state,createOrGetPeerConnection:()=>entry,getSelectedQualityProfile:()=>({maxBitrate:100}),boostSdpVideoBitrate:s=>s,sendWs:(type,payload)=>sent.push({type,payload})});
  const offer=c.initiateOfferToPeer('peer');state.currentVoiceChannel=null;state.peers.clear();pending.resolve({sdp:'audio'});await offer;
  assert.equal(sent.length,0);
});

test('pedidos concorrentes compartilham a mesma abertura do microfone', async () => {
  const pending=deferred(); const state={localAudioStream:null}; let opens=0;
  const stream={};
  const c=load(['ensureLocalAudioStream'],{state,createLocalAudioStream:()=>{opens++;return pending.promise;}});
  const first=c.ensureLocalAudioStream(),second=c.ensureLocalAudioStream();
  pending.resolve(stream);
  assert.equal(await first,stream);assert.equal(await second,stream);assert.equal(opens,1);
  assert.equal(state.audioCapturePromise,null);
});

test('microfone liberado enquanto a permissão está pendente descarta e para a captura tardia', async () => {
  const pending=deferred();let stops=0;
  const state={audioSettings:{},localAudioStream:null};
  const c=load(['ensureLocalAudioStream','createLocalAudioStream','releaseLocalAudioStream'],{
    state,navigator:{mediaDevices:{getUserMedia:()=>pending.promise}},teardownAudioDsp(){},
  });
  const capture=c.ensureLocalAudioStream();c.releaseLocalAudioStream();
  pending.resolve({getTracks:()=>[{stop:()=>stops++}]});
  assert.equal(await capture,null);assert.equal(stops,1);assert.equal(state.localAudioStream,null);
});

test('recusar microfone informa modo de escuta e não repete o pedido de permissão', async () => {
  let requests=0,closed=0;const errors=[];
  const stream={getTracks:()=>[]};const state={audioSettings:{},localAudioStream:null};
  class AudioContext {createMediaStreamDestination(){return {stream};}close(){closed++;return Promise.resolve();}}
  const c=load(['ensureLocalAudioStream','createLocalAudioStream','releaseLocalAudioStream'],{
    state,navigator:{mediaDevices:{getUserMedia:async()=>{requests++;throw {name:'NotAllowedError'};}}},
    window:{AudioContext},console:{warn(){}},showErrorToast:m=>errors.push(m),teardownAudioDsp(){},
  });
  assert.equal(await c.ensureLocalAudioStream(),stream);
  assert.equal(requests,1);assert.equal(errors.length,1);assert.equal(state.microphoneUnavailable,true);
  c.releaseLocalAudioStream();assert.equal(closed,1);assert.equal(state.localAudioStream,null);
});

test('fechar configurações durante a permissão não reativa o teste do microfone', async () => {
  const pending=deferred();let released=0,applied=0;
  const state={micTestActive:false,currentVoiceChannel:null};const micTestBtn={textContent:''};
  const c=load(['toggleMicrophoneTest','closeSettingsModal'],{
    state,micTestBtn,ensureLocalAudioStream:()=>pending.promise,
    releaseLocalAudioStream:()=>released++,applyDspParametersRealtime:()=>applied++,
    pttRecordBtn:null,unsavedProfileBar:null,settingsModal:null,
  });
  const test=c.toggleMicrophoneTest();c.closeSettingsModal();pending.resolve({});await test;
  assert.equal(state.micTestActive,false);assert.equal(released,1);assert.equal(applied,1);
  assert.equal(micTestBtn.textContent,'Teste do microfone');
});

test('parar teste libera a captura isolada e preserva o microfone de chamada ativa', async () => {
  let released=0;const state={micTestActive:true,currentVoiceChannel:null};
  const c=load(['toggleMicrophoneTest'],{
    state,micTestBtn:{},releaseLocalAudioStream:()=>released++,applyDspParametersRealtime(){},
  });
  await c.toggleMicrophoneTest();assert.equal(released,1);
  state.micTestActive=true;state.currentVoiceChannel='voz';
  await c.toggleMicrophoneTest();assert.equal(released,1);assert.equal(state.micTestActive,false);
});

test('mudar dispositivo ou filtro fora da chamada não abre captura do microfone',async()=>{
  let captures=0,releases=0;const state={currentVoiceChannel:null,micTestActive:false};
  const c=load(['ensureLocalAudioStream'],{state,createLocalAudioStream:()=>{captures++;},releaseLocalAudioStream:()=>releases++});
  assert.equal(await c.ensureLocalAudioStream(true),null);assert.equal(captures,0);assert.equal(releases,1);
});
