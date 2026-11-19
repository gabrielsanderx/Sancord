// O palco da call aparece só onde a call acontece (servidor dela ou a conversa privada dela).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('call de servidor não aparece numa DM nem em outro servidor', async t => {
  const h = await openInterface(t);
  h.run(`state.servers = [
      { id: 's1', name: 'Só tristeza', voice_channels: [{ id: 'voice-call', name: 'Call', kind: 'voice' }], text_channels: [] },
      { id: 's2', name: 'Outro', voice_channels: [], text_channels: [] },
    ];
    state.currentVoiceChannel = 'voice-call';`);
  const hidden = () => h.run('voiceStage.classList.contains("stage-out-of-context")');
  h.run('state.activeView = "server"; state.activeServerId = "s1"; syncVoiceStageContext()');
  assert.equal(hidden(), false, 'no servidor da call');
  h.run('state.activeView = "home"; state.activeDmId = "dm:ana__fi"; syncVoiceStageContext()');
  assert.equal(hidden(), true, 'na DM com um amigo');
  h.run('state.activeView = "server"; state.activeServerId = "s2"; syncVoiceStageContext()');
  assert.equal(hidden(), true, 'em outro servidor');
});

test('call privada aparece só na conversa dela', async t => {
  const h = await openInterface(t);
  const hidden = () => h.run('voiceStage.classList.contains("stage-out-of-context")');
  h.run('state.currentVoiceChannel = "dmvoice:ana__fi"; state.activeView = "home"; state.activeDmId = "dm:ana__fi"; syncVoiceStageContext()');
  assert.equal(hidden(), false);
  h.run('state.activeDmId = "dm:ana__bia"; syncVoiceStageContext()');
  assert.equal(hidden(), true);
  h.run('state.activeView = "server"; state.activeServerId = "s1"; syncVoiceStageContext()');
  assert.equal(hidden(), true);
  h.run('state.currentVoiceChannel = "gdmvoice:g1"; state.activeView = "home"; state.activeDmId = "gdm:g1"; syncVoiceStageContext()');
  assert.equal(hidden(), false, 'grupo');
});
