const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function load(names, globals) {
  const c=vm.createContext({Map,Set,console:{warn(){},info(){}},...globals});
  for(const name of [...['canPublishVideo','stopMediaTracks','cameraCaptureConstraints'],...names]) {
    let start=source.indexOf(`async function ${name}(`);
    if(start<0)start=source.indexOf(`function ${name}(`);
    if(start<0 && ['canPublishVideo','stopMediaTracks','cameraCaptureConstraints'].includes(name))continue;
    assert.notEqual(start,-1,name);
    vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);
  }
  return c;
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function media(){const t={kind:'video',readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';}};return {track:t,getTracks:()=>[t],getVideoTracks:()=>[t]};}
function harness(extra={}) {
  const state={currentVoiceChannel:'v1',peers:new Map(),cameraOn:false,screenSharing:false};
  const errors=[];let permission=true;
  const c=load(['toggleCamera','stopCamera','publishScreenStream','startBrowserDisplayMediaFallback','stopScreenSharing','confirmNativeScreenShare'],{
    state,voicePermissions:()=>({stream_video:permission}),
    toggleCameraBtn:null,cameraBtnLabel:null,shareScreenBtn:null,screenBtnLabel:null,screenShareModal:null,
    showErrorToast:m=>errors.push(m),alert:m=>errors.push(m),
    playUiSound(){},syncVoiceStateWithServer(){},renderVoiceStage(){},refreshAudioDeviceLists(){},
    initiateOfferToPeer:async()=>{},applySenderEncodingParameters:async()=>{},...extra,
  });
  return {c,state,errors,revoke:()=>permission=false};
}
test('câmera autorizada depois de sair é parada e não publicada',async()=>{
  const pending=deferred(),stream=media();
  const h=harness({navigator:{mediaDevices:{getUserMedia:()=>pending.promise}}});
  const request=h.c.toggleCamera();h.state.currentVoiceChannel=null;await h.c.stopCamera(false);
  pending.resolve(stream);await request;
  assert.equal(h.state.cameraOn,false);assert.equal(h.state.localCameraStream??null,null);assert.equal(stream.track.stops,1);
});
test('segundo clique cancela a abertura da câmera sem abrir outra captura',async()=>{
  const pending=deferred(),stream=media();let captures=0;
  const h=harness({navigator:{mediaDevices:{getUserMedia:()=>{captures++;return pending.promise;}}}});
  const first=h.c.toggleCamera(),second=h.c.toggleCamera();pending.resolve(stream);await Promise.all([first,second]);
  assert.equal(captures,1);assert.equal(h.state.cameraOn,false);assert.equal(stream.track.stops,1);
});
test('revogar transmissão durante o pedido de câmera descarta a captura',async()=>{
  const pending=deferred(),stream=media();const h=harness({navigator:{mediaDevices:{getUserMedia:()=>pending.promise}}});
  const request=h.c.toggleCamera();h.revoke();pending.resolve(stream);await request;
  assert.equal(h.state.cameraOn,false);assert.equal(stream.track.stops,1);
});
test('captura de tela pendente não atravessa a troca de canal',async()=>{
  const pending=deferred(),stream=media();const h=harness({navigator:{mediaDevices:{getDisplayMedia:()=>pending.promise}}});
  const request=h.c.startBrowserDisplayMediaFallback({fps:30,width:1280,height:720},false);
  h.state.currentVoiceChannel='v2';await h.c.stopScreenSharing(false);pending.resolve(stream);await request;
  assert.equal(h.state.screenSharing,false);assert.equal(stream.track.stops,1);
});
test('parar compartilhamento limpa captura nativa mesmo antes de existir stream',async()=>{
  const h=harness();let cleaned=0;h.state.nativeCaptureCleanup=()=>cleaned++;
  await h.c.stopScreenSharing(false);assert.equal(cleaned,1);assert.equal(h.state.nativeCaptureCleanup,null);
});
test('parar durante configuração de encoder impede publicação nos demais peers',async()=>{
  const pending=deferred(),stream=media();const adds=[];
  const h=harness({applySenderEncodingParameters:()=>pending.promise});
  for(const id of ['a','b'])h.state.peers.set(id,{screenSenders:[],pc:{addTrack(){adds.push(id);return {track:stream.track};},removeTrack(){}}});
  const request=h.c.publishScreenStream(stream,{fps:30});
  await h.c.stopScreenSharing(false);pending.resolve();await request;
  assert.deepEqual(adds,['a']);assert.equal(h.state.screenSharing,false);
});

test('evento atrasado da câmera anterior não desliga a nova',async()=>{
  const old=media(),current=media();let stream=old;
  const h=harness({navigator:{mediaDevices:{getUserMedia:async()=>stream}}});
  await h.c.toggleCamera();const lateEnd=old.track.onended;
  await h.c.stopCamera(false);stream=current;await h.c.toggleCamera();lateEnd();
  assert.equal(h.state.localCameraStream,current);assert.equal(h.state.cameraOn,true);
});

test('recusa de câmera mostra erro sem ativar vídeo',async()=>{
  const h=harness({navigator:{mediaDevices:{getUserMedia:async()=>{throw {name:'NotAllowedError'};}}}});
  await h.c.toggleCamera();assert.equal(h.state.cameraOn,false);assert.equal(h.state.cameraStarting,false);assert.equal(h.errors.length,1);
});

function nativeHarness(bridgePromise=null) {
  const listeners=new Map(),sent=[],generated=[],writes=[];
  const ws={readyState:1,send:s=>sent.push(JSON.parse(s)),addEventListener:(type,f)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(f);},removeEventListener:(type,f)=>listeners.get(type)?.delete(f)};
  class Generator {
    constructor({kind}){this.kind=kind;this.stops=0;generated.push(this);this.writable={getWriter:()=>({write:async f=>writes.push(f),abort:async()=>{}})};}
    stop(){this.stops++;}
  }
  class Stream {constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}}
  class Frame {constructor(){this.closed=false;}close(){this.closed=true;}}
  const h=harness({
    window:{MediaStreamTrackGenerator:Generator,VideoFrame:Frame,AudioData:Frame},
    MediaStreamTrackGenerator:Generator,MediaStream:Stream,VideoFrame:Frame,AudioData:Frame,
    ArrayBuffer,DataView,Uint8Array,Float32Array,performance:{now:()=>100},WebSocket:{OPEN:1},
    ensureCaptureBridgeConnection:()=>bridgePromise||Promise.resolve(ws),
    getSelectedQualityProfile:()=>({width:1280,height:720,fps:30}),pickerAudioCheckbox:{checked:true},
  });
  h.state.selectedSource={id:'qa',kind:'window'};
  return {...h,ws,sent,generated,writes,emit(type,data){for(const f of [...(listeners.get(type)||[])])f(type==='message'?{data}:{});},listeners};
}
test('captura nativa aguardando a ponte é cancelada pela saída',async()=>{
  const pending=deferred(),h=nativeHarness(pending.promise);const request=h.c.confirmNativeScreenShare();
  h.state.currentVoiceChannel=null;await h.c.stopScreenSharing(false);pending.resolve(h.ws);await request;
  assert.equal(h.generated.length,0);assert.equal(h.sent.length,0);assert.equal(h.state.screenStarting,false);
});
test('ponte nativa desconectada para transmissão e libera os geradores',async()=>{
  const h=nativeHarness();await h.c.confirmNativeScreenShare();assert.equal(h.state.screenSharing,true);
  h.ws.readyState=3;h.emit('close');
  assert.equal(h.state.screenSharing,false);assert.equal(h.state.localScreenStream,null);
  assert.ok(h.generated.every(t=>t.stops>0));assert.equal(h.listeners.get('message').size,0);assert.equal(h.errors.length,1);
});
test('frames truncados ou com tamanho inválido não chegam ao encoder',async()=>{
  const h=nativeHarness();await h.c.confirmNativeScreenShare();
  assert.doesNotThrow(()=>{h.emit('message',new ArrayBuffer(1));h.emit('message',new Uint8Array([2,0,0,0,0,0,0,0,0]).buffer);});
  const invalid=new ArrayBuffer(9);const view=new DataView(invalid);view.setUint8(0,1);view.setUint32(1,3840,true);view.setUint32(5,2160,true);h.emit('message',invalid);
  assert.equal(h.writes.length,0);
  const valid=new ArrayBuffer(15);const good=new DataView(valid);good.setUint8(0,1);good.setUint32(1,2,true);good.setUint32(5,2,true);h.emit('message',valid);
  await new Promise(setImmediate);assert.equal(h.writes.length,1);assert.equal(h.writes[0].closed,true);
  await h.c.stopScreenSharing(false);
});

test('encerrar vídeo remoto não conserva a última câmera como transmissão de tela',()=>{
  const stream=media(),peer={incomingVideoStreams:new Map([['camera',stream]])};
  const c=load(['resolveRemotePeerStreams'],{});
  const result=c.resolveRemotePeerStreams({camera_on:false,screen_sharing:false},peer);
  assert.equal(result.cameraStream,null);assert.equal(result.screenStream,null);
});
test('câmera e tela simultâneas mantêm a identidade dos streams e ignoram os encerrados',()=>{
  const camera=media(),screen=media(),old=media();old.track.readyState='ended';
  const peer={incomingVideoStreams:new Map([['old',old],['screen',screen],['camera',camera]])};
  const c=load(['resolveRemotePeerStreams'],{});
  const user={camera_on:true,screen_sharing:true,camera_stream_id:'camera',screen_stream_id:'screen'};
  const result=c.resolveRemotePeerStreams(user,peer);
  assert.equal(result.cameraStream,camera);assert.equal(result.screenStream,screen);
  user.camera_stream_id='old';assert.equal(c.resolveRemotePeerStreams(user,peer).cameraStream,null);
});

test('listagem e transmissão compartilham uma conexão pendente à ponte',async()=>{
  const sockets=[],state={};
  class Socket {static OPEN=1;constructor(){sockets.push(this);}close(){this.onclose?.();}}
  const c=load(['ensureCaptureBridgeConnection'],{state,WebSocket:Socket,window:{__SANCORD_CAPTURE_PORT:9999},encodeURIComponent,setTimeout,clearTimeout});
  const a=c.ensureCaptureBridgeConnection(),b=c.ensureCaptureBridgeConnection();
  assert.equal(sockets.length,1);sockets[0].readyState=1;sockets[0].onopen();
  assert.equal(await a,sockets[0]);assert.equal(await b,sockets[0]);assert.equal(state.captureConnectPromise,null);
});
test('ponte que não abre expira e permite nova tentativa',async()=>{
  const sockets=[],state={};let expire;
  class Socket {static OPEN=1;constructor(){sockets.push(this);}close(){this.onclose?.();}}
  const c=load(['ensureCaptureBridgeConnection'],{state,WebSocket:Socket,window:{__SANCORD_CAPTURE_PORT:9999},encodeURIComponent,setTimeout:f=>{expire=f;return 1;},clearTimeout(){}});
  const failed=c.ensureCaptureBridgeConnection();expire();await assert.rejects(failed,/não respondeu/);
  assert.equal(state.captureConnectPromise,null);
  const retry=c.ensureCaptureBridgeConnection();sockets[1].readyState=1;sockets[1].onopen();assert.equal(await retry,sockets[1]);
});

test('câmera usa dispositivo e qualidade salvos sem abrir outro microfone',async()=>{
  let constraints;const stream=media();
  const h=harness({navigator:{mediaDevices:{getUserMedia:async c=>{constraints=c;return stream;}}}});
  h.state.audioSettings={cameraDeviceId:'webcam-externa',cameraQuality:'1080'};
  await h.c.toggleCamera();
  assert.equal(constraints.video.deviceId.exact,'webcam-externa');assert.equal(constraints.video.width.ideal,1920);
  assert.equal(constraints.video.height.ideal,1080);assert.equal(constraints.audio,false);
});
test('qualidade de câmera desconhecida usa 720p e dispositivo padrão',()=>{
  const h=harness();h.state.audioSettings={cameraQuality:'inválida'};
  const c=h.c.cameraCaptureConstraints();assert.equal(c.video.width.ideal,1280);assert.equal(c.video.height.ideal,720);assert.equal(c.video.deviceId,undefined);
});

test('falha ao publicar tela libera a captura obtida pelo seletor do sistema',async()=>{
  const stream=media();const h=harness({navigator:{mediaDevices:{getDisplayMedia:async()=>stream}}});
  h.state.peers.set('peer',{screenSenders:[],pc:{addTrack(){throw Error('peer encerrado');},removeTrack(){}}});
  await h.c.startBrowserDisplayMediaFallback({fps:30,width:1280,height:720},false);
  assert.equal(h.state.screenSharing,false);assert.equal(h.state.localScreenStream,null);assert.equal(stream.track.stops,1);assert.equal(h.errors.length,1);
});
