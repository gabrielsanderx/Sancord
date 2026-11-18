// Fase 6: volume/silêncio por pessoa (persistidos pelo nome), silêncio do servidor
// aplicado pelo receptor e detecção de "sozinho na chamada".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/voice.js'), 'utf8');
function load(names, state) {
  const store = new Map();
  const context = vm.createContext({
    state, Map, Set, JSON, VOLUME_KEY: 'sancord_voice_volumes', LOCAL_MUTE_KEY: 'sancord_voice_local_mutes',
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
  });
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  context.store = store;
  return context;
}

const names = ['readJsonStore', 'writeJsonStore', 'voiceKeyOf', 'getStoredVolume', 'storeVolume', 'isLocallyMuted', 'isPeerSilenced', 'selfServerMuted', 'selfServerDeafened', 'aloneInCall'];

function baseState() {
  return {
    users: new Map([
      ['c1', { id: 'c1', username: 'Ana' }],
      ['c2', { id: 'c2', username: 'Beto', server_muted: true }],
    ]),
    userVolumes: new Map(),
    voiceVolumes: {},
    localVoiceMutes: new Set(),
    selfUser: { id: 'eu', voice_channel_id: 'v1', server_muted: false, server_deafened: false },
    voiceMembers: { v1: ['eu'], v2: ['eu', 'c1'] },
  };
}

test('volume fica salvo pelo nome e sobrevive a um id novo', () => {
  const state = baseState();
  const c = load(names, state);
  assert.equal(c.getStoredVolume('c1'), 100);
  c.storeVolume('c1', 150);
  assert.match(c.store.get('sancord_voice_volumes'), /"ana":150/);
  // Mesma pessoa reconectada com outro id.
  state.users.set('c9', { id: 'c9', username: 'ANA' });
  assert.equal(c.getStoredVolume('c9'), 150);
  c.storeVolume('c9', 100);
  assert.equal(c.store.get('sancord_voice_volumes'), '{}');
});

test('quem está silenciado pelo servidor ou só para mim não toca', () => {
  const state = baseState();
  const c = load(names, state);
  assert.equal(c.isPeerSilenced('c1'), false);
  assert.equal(c.isPeerSilenced('c2'), true, 'silêncio do servidor vale no receptor');
  state.localVoiceMutes.add('ana');
  assert.equal(c.isLocallyMuted('c1'), true);
  assert.equal(c.isPeerSilenced('c1'), true);
});

test('meu estado de moderação só vale dentro da voz', () => {
  const state = baseState();
  const c = load(names, state);
  state.selfUser.server_deafened = true;
  assert.equal(c.selfServerDeafened(), true);
  assert.equal(c.selfServerMuted(), true, 'ensurdecido também não fala');
  state.selfUser.voice_channel_id = null;
  assert.equal(c.selfServerMuted(), false);
});

test('sozinho na chamada', () => {
  const c = load(names, baseState());
  assert.equal(c.aloneInCall('v1'), true);
  assert.equal(c.aloneInCall('v2'), false);
  assert.equal(c.aloneInCall('vazio'), true);
});

const appSource = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
function appFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return appSource.slice(start, appSource.indexOf('\n}', start) + 2);
}

test('retomada da voz só envia uma entrada depois de aplicar o Welcome', () => {
  const sent = [];
  const ws = { readyState: 1 };
  const c = vm.createContext({
    state: { ws, currentVoiceChannel: 'voz', historyState: new Map() }, Map,
    reconnect: { attempt: 1 }, WebSocket: { OPEN: 1 },
    wsStatusDot: { classList: { add() {} } },
    clearTimeout() {}, clearInterval() {}, setTimeout() {}, setConnectionBanner() {},
    cleanupAllPeers() {}, syncVoiceStateWithServer() {}, renderVoiceStage() {}, showUiToast() {},
    sendWs: (type, payload) => sent.push({ type, payload }),
  });
  vm.runInContext(appFunction('onConnectionReady'), c);
  const start = source.indexOf('function resumeVoiceAfterReconnect(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), c);
  c.onConnectionReady(ws);
  assert.equal(sent.length, 0, 'não deve entrar antes de receber o estado e ICE do Welcome');
  c.resumeVoiceAfterReconnect();
  assert.equal(sent.filter(e => e.type === 'JoinVoice').length, 1);
});

test('evento atrasado do peer antigo não fecha a conexão substituta', () => {
  const oldPeer = { pc: { connectionState: 'closed' } };
  const newPeer = { pc: { connectionState: 'connected' } };
  const closed = [];
  const c = vm.createContext({
    state: { peers: new Map([['beto', newPeer]]) },
    clearTimeout() {}, closePeerConnection: id => closed.push(id),
  });
  vm.runInContext(appFunction('handlePeerConnectionState'), c);
  c.handlePeerConnectionState('beto', oldPeer);
  assert.equal(closed.length, 0, 'callback antigo não deve alcançar o peer atual');
});
