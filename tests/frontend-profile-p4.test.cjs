const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('editor integra catálogo, duas cores, direção e placa ao rascunho e ao pacote de salvamento', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`globalThis.sent = [];
    sendWs = (type, data) => { sent.push({type, data}); return true; };
    state.selfUser = { id:'ana', username:'Ana', avatar_color:'#7862d4', name_style:'gradient' };
    onCosmeticsState({catalog:[
      {id:'custom-gradient',kind:'name_style',name:'Gradiente Personalizado'},
      {id:'core-stripe',kind:'nameplate',name:'Faixa Core'},
      {id:'tide-glass',kind:'nameplate',name:'Vidro de Maré'}
    ], owned:['name_style:custom-gradient','nameplate:core-stripe']});
    document.getElementById('open-settings-btn').click();
    switchSettingsTab('profile');`);
  function change(id, value, event = 'change') {
    const input = d.getElementById(id);
    input.value = value;
    input.dispatchEvent(new h.w.Event(event, { bubbles:true }));
  }
  assert.ok(d.getElementById('settings-name-showcase').classList.contains('name-style-gradient'));
  change('settings-name-style-select', 'custom-gradient');
  assert.equal(d.getElementById('settings-name-gradient-controls').classList.contains('hidden'), false);
  change('settings-name-color-input', '#a677dd', 'input');
  change('settings-name-color-secondary', '#46cebd', 'input');
  change('settings-name-gradient-direction', 'radial');
  const gradient = d.getElementById('settings-name-showcase').style.getPropertyValue('--sancord-name-gradient');
  assert.match(gradient, /^radial-gradient\(ellipse/);
  assert.match(gradient, /#a677dd.*#46cebd/);
  // A placa abre um subeditor na lateral; o perfil completo continua visível.
  d.getElementById('open-nameplate-picker-btn').click();
  const view = d.querySelector('[data-pe-view="nameplate"]');
  assert.equal(view.classList.contains('hidden'), false);
  assert.equal(d.querySelector('[data-pe-view="home"]').classList.contains('hidden'), true);
  const buttons = [...view.querySelectorAll('.pe-choice')];
  assert.ok(buttons.find(b => b.textContent.includes('Vidro de Maré')).disabled);
  const core = buttons.find(b => b.textContent.includes('Faixa Core'));
  assert.ok(core.querySelector('.pe-plate-sample').classList.contains('nameplate-core-stripe'), 'amostra real da placa');
  core.click();
  assert.ok(d.querySelector('#live-profile-preview-card .profile-nameplate-wrap').classList.contains('nameplate-core-stripe'));
  assert.equal(h.run('sent.some(packet => packet.type === "UpdateProfile")'), false);
  assert.equal(h.run('state.selfUser.name_style'), 'gradient');
  view.querySelector('.pe-back').click();
  assert.equal(d.querySelector('[data-pe-view="home"]').classList.contains('hidden'), false);
  h.run('saveProfileBtn.click()');
  const payload = JSON.parse(h.run('JSON.stringify(sent.find(packet => packet.type === "UpdateProfile").data)'));
  assert.equal(payload.name_style, 'custom-gradient');
  assert.equal(payload.name_color, '#a677dd');
  assert.equal(payload.name_color_secondary, '#46cebd');
  assert.equal(payload.name_gradient_direction, 'radial');
  assert.equal(payload.nameplate_style, 'core-stripe');
});

test('nomes simples removem o estilo em tela, preservam a cor do cargo e reativam o estilo sem alterar o perfil', async t => {
  const h = await openInterface(t), d = h.document;
  const name = d.createElement('strong');
  name.id = 'p4-test-name'; name.textContent = 'Apelido de Bia';
  d.body.append(name);
  h.run(`globalThis.p4TestUser = { name_style:'custom-gradient', name_color:'#c984ed', name_color_secondary:'#4ccfbe' };
    applyNameStyleToEl(document.getElementById('p4-test-name'), p4TestUser, '#1685a6');
    const peer = { ...p4TestUser, id:'bia', username:'Bia', avatar_color:'#7862d4', nameplate_style:'core-stripe', online:true };
    state.users.set(peer.id, peer);
    state.dmConversations = [{ dm_id:'dm:ana__bia', peer }];
    renderDmList();
    document.body.append(buildFriendRow(peer));
    const message = buildMessageElementV2({ id:'p4-message', channel_id:'geral', author_name:'Bia', author_id:'bia', content:'oi', created_at:Date.now() });
    document.body.append(message);`);
  assert.ok(name.classList.contains('name-style-custom-gradient'));
  const dm = d.querySelector('.dm-item.nameplate-core-stripe .dm-item-name');
  const friend = d.querySelector('.friend-row.nameplate-core-stripe .friend-display-name');
  const author = d.querySelector('[data-msg-id="p4-message"] .message-author');
  for (const element of [dm, friend, author]) assert.ok(element.classList.contains('name-style-custom-gradient'));
  assert.equal(author.closest('[class*="nameplate-"]'), null, 'placas ficam fora das mensagens');
  const toggle = d.getElementById('appearance-show-name-styles');
  toggle.checked = false;
  toggle.dispatchEvent(new h.w.Event('change', { bubbles:true }));
  assert.equal(name.classList.contains('name-style-custom-gradient'), false);
  for (const element of [dm, friend, author]) assert.equal(element.classList.contains('name-style-custom-gradient'), false);
  assert.equal(name.style.getPropertyValue('--sancord-name-gradient'), '');
  assert.equal(name.style.getPropertyValue('--name-color'), '#1685a6');
  assert.equal(name.textContent, 'Apelido de Bia');
  assert.equal(h.run('loadAudioSettings().showProfileNameStyles'), false);
  assert.equal(h.run('p4TestUser.name_style'), 'custom-gradient');
  toggle.checked = true;
  toggle.dispatchEvent(new h.w.Event('change', { bubbles:true }));
  assert.ok(name.classList.contains('name-style-custom-gradient'));
});
