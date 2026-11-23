const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

function finishEffect(h, layer, name = 'profileEffectEntrance', pseudoElement = '') {
  const event = new h.w.Event('animationend', { bubbles: true });
  Object.assign(event, { animationName: name, pseudoElement });
  layer.dispatchEvent(event);
}

test('perfil toca uma vez por visita, inclusive quando o efeito chega na resposta de um perfil offline', async t => {
  const h = await openInterface(t);
  const layer = h.document.getElementById('profile-card-effect-layer');
  const card = layer.parentElement;
  h.run('openMemberProfilePopover(null, { author_name: "Bia" })');
  assert.equal(layer.classList.contains('is-playing'), false);
  const response = `onUserProfile({ user: { username: "Bia", profile_effect: "core-signal", profile_frame: "core-pulse" } })`;
  h.run(response);
  assert.ok(layer.classList.contains('effect-core-signal'));
  assert.ok(card.classList.contains('profile-effect-running'));
  assert.ok(card.classList.contains('pf-core-pulse'));
  finishEffect(h, layer, 'profileEffectSweep', '::before');
  assert.ok(layer.classList.contains('is-playing'), 'fim de uma camada da arte não encerra o ciclo');
  finishEffect(h, layer);
  assert.equal(layer.classList.contains('is-playing'), false);
  assert.equal(card.classList.contains('profile-effect-running'), false);
  assert.ok(card.classList.contains('pf-core-pulse'));
  h.run(response);
  assert.equal(layer.classList.contains('is-playing'), false, 'sincronização do mesmo perfil não repete');
  h.run(`state.users.set('bia', {id:'bia', username:'Bia', profile_effect:'core-signal'});
    openMemberProfilePopover('bia')`);
  assert.ok(layer.classList.contains('is-playing'), 'reabrir é uma nova visita');
  h.document.getElementById('close-profile-card-btn').click();
  await h.flush();
  assert.equal(layer.classList.contains('is-playing'), false);
});

test('seletor respeita posse, permite replay e só altera o rascunho ao escolher', async t => {
  const h = await openInterface(t);
  const d = h.document;
  h.run(`state.selfUser = { id:'ana', username:'Ana', avatar_color:'#5865f2', profile_effect:'aurora' };
    onCosmeticsState({ catalog:[
      { kind:'profile_effect', id:'core-signal', name:'Sinal Core' },
      { kind:'profile_effect', id:'star-trail', name:'Rastro Celeste' },
    ], owned:['profile_effect:core-signal'], badges:[] });
    document.getElementById('open-settings-btn').click();
    switchSettingsTab('profile');`);
  d.getElementById('open-effect-picker-btn').click();
  // O efeito toca no perfil completo do editor, não num cartão separado.
  const layer = d.getElementById('preview-effect-layer');
  const view = d.querySelector('[data-pe-view="effect"]');
  const replay = view.querySelector('[data-pe-replay]');
  const buttons = [...view.querySelectorAll('.pe-choice')];
  assert.ok(buttons.find(b => b.textContent.includes('Rastro Celeste')).disabled);
  assert.ok(!buttons.some(b => b.textContent.includes('Poço de Luz')), 'sem efeito novo ausente no catálogo');
  buttons.find(b => b.textContent.includes('Sinal Core')).click();
  assert.ok(layer.classList.contains('effect-core-signal'), 'toca uma vez ao escolher');
  assert.equal(h.run('profileDraft.profile_effect'), 'core-signal');
  assert.equal(h.run('state.selfUser.profile_effect'), 'aurora');
  finishEffect(h, layer);
  assert.equal(layer.classList.contains('is-playing'), false);
  replay.click();
  assert.ok(layer.classList.contains('is-playing'));
  finishEffect(h, layer);
  d.getElementById('profile-preview-replay').click();
  assert.ok(layer.classList.contains('is-playing'), '↻ da prévia também reproduz');
  view.querySelector('.pe-back').click();
  assert.equal(h.run('profileDraft.profile_effect'), 'aurora', 'Voltar cancela somente a escolha');
  assert.equal(layer.classList.contains('is-playing'), false, 'cancelar interrompe a prévia');
  d.getElementById('open-effect-picker-btn').click();
  view.querySelector('[data-id="core-signal"]').click();
  view.querySelector('.pe-chooser-actions .btn-primary').click();
  assert.equal(h.run('profileDraft.profile_effect'), 'core-signal', 'Aplicar mantém o efeito no rascunho');
  h.run('closeSettingsModal()');
  await h.flush();
  d.querySelector('.sancord-dialog form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  await h.flush();
  assert.equal(layer.classList.contains('is-playing'), false, 'fechar a página interrompe o efeito');
});

test('segundo plano e redução de movimento interrompem efeitos clássicos e novos', async t => {
  const h = await openInterface(t);
  const d = h.document;
  const layer = d.getElementById('profile-card-effect-layer');
  h.run(`state.users.set('bia', { id:'bia', username:'Bia', profile_effect:'lightning' });
    openMemberProfilePopover('bia');`);
  assert.ok(layer.classList.contains('effect-lightning'));
  Object.defineProperty(d, 'hidden', { value: true, configurable: true });
  d.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.equal(layer.classList.contains('is-playing'), false);
  assert.equal(h.run('playProfileEffect(document.getElementById("profile-card-effect-layer"))'), false);
  Object.defineProperty(d, 'hidden', { value: false });
  h.run('playProfileEffect(document.getElementById("profile-card-effect-layer"))');
  assert.ok(layer.classList.contains('is-playing'));
  h.w.dispatchEvent(new h.w.Event('blur'));
  assert.equal(layer.classList.contains('is-playing'), false);
  h.run('playProfileEffect(document.getElementById("profile-card-effect-layer"))');
  h.run('state.audioSettings.reduceMotion = true; applyProfileAnimPolicy()');
  assert.equal(layer.classList.contains('is-playing'), false);
  assert.equal(h.run('playProfileEffect(document.getElementById("profile-card-effect-layer"))'), false);
});
