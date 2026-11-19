const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('botão de chat no canal de voz abre conversa sem entrar na chamada e edita bitrate', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`
    globalThis.sent = [];
    globalThis.joinedVoice = [];
    sendWs = (type, payload) => { sent.push(JSON.parse(JSON.stringify({type, payload}))); return true; };
    joinVoiceChannel = (id) => { joinedVoice.push(id); };
    const textCh = { id:"t1", name:"geral", kind:"text", effective_permissions:{view_channel:true,read_history:true,send_messages:true,attach_files:true,add_reactions:true} };
    const voiceCh = { id:"v1", name:"Sala VIP", kind:"voice", bitrate_kbps:192, effective_permissions:{view_channel:true,read_history:true,send_messages:true,attach_files:true,add_reactions:true} };
    state.selfUser = { id:"ana", username:"Ana", avatar_color:"#5865f2" };
    state.servers = [{ id:"s1", name:"Turma", owner_username:"Ana", text_channels:[textCh], voice_channels:[voiceCh], members:["ana"], roles:[], member_roles:{} }];
    state.activeServerId = "s1";
    state.activeView = "server";
    state.textChannels = [textCh];
    state.voiceChannels = [voiceCh];
    state.currentTextChannel = "t1";
    state.chatHistory.v1 = [{ id:"mv1", channel_id:"v1", author_id:"ana", author_name:"Ana", author_color:"#5865f2", content:"Mensagem na sala de voz", timestamp:"12:00", created_at:Date.now() }];
    renderVoiceChannels();
  `);

  const chatBtn = d.querySelector('.voice-chat-open-btn');
  assert.ok(chatBtn, 'botão de chat do canal de voz deve existir');
  chatBtn.click();
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(joinedVoice)')), []);
  assert.equal(h.run('state.currentTextChannel'), 'v1');
  assert.equal(d.getElementById('current-text-channel-title').textContent, 'Sala VIP');
  assert.match(d.getElementById('chat-channel-topic').textContent, /192 kbps/);
  assert.match(d.getElementById('chat-input').placeholder, /Sala VIP/);
  assert.match(d.getElementById('chat-messages').textContent, /Mensagem na sala de voz/);

  // SDP aplica o bitrate configurado do canal de voz ativo.
  const sdp = h.run(`
    state.currentVoiceChannel = "v1";
    boostSdpVideoBitrate("v=0\\r\\nm=audio 9 UDP/TLS/RTP/SAVPF 111\\r\\na=fmtp:111 minptime=10\\r\\n", 9000000);
  `);
  assert.match(sdp, /maxaveragebitrate=192000/);

  // Editar canal de voz inclui bitrate_kbps no pacote UpdateChannel.
  h.run('globalThis.editVoice = openEditChannelDialog(state.servers[0], state.voiceChannels[0]);');
  const dlg = d.querySelector('.sancord-dialog');
  const bitrateField = dlg.querySelector('[id^="f-bitrate_kbps-"]');
  assert.ok(bitrateField);
  bitrateField.value = '256';
  dlg.querySelector('form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  await h.run('editVoice');
  const upd = JSON.parse(h.run('JSON.stringify(sent.at(-1))'));
  assert.equal(upd.type, 'UpdateChannel');
  assert.equal(upd.payload.channel_id, 'v1');
  assert.equal(upd.payload.bitrate_kbps, 256);
});
