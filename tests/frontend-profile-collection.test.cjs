const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    state.selfUser = { id:"u1", username:"Ana", avatar_color:"#5865f2", profile_frame:"core-pulse", bio:"Bio salva" };
    loadDraftFromSelfUser();
    globalThis.sent = [];
    sendWs = (type, payload) => { sent.push(JSON.parse(JSON.stringify({type, payload}))); return true; };
    globalThis.receive = (type, payload) => handleServerMessage({type, payload});
    globalThis.inventory = [
      {kind:"avatar_decoration",id:"core-orbit",name:"Órbita Core",collection:"sancord-core"},
      {kind:"profile_frame",id:"core-pulse",name:"Pulso Core",collection:"sancord-core"},
      {kind:"profile_effect",id:"core-signal",name:"Sinal Core",collection:"sancord-core"},
      {kind:"nameplate",id:"core-stripe",name:"Faixa Core",collection:"sancord-core"},
      {kind:"name_style",id:"neon",name:"Neon Nítido",collection:"classicos"},
      {kind:"profile_frame",id:"founder",name:"Fundação",collection:"conquistas",availability:"badge:founder"}
    ];
    onCosmeticsState({catalog:inventory, owned:inventory.slice(0,5).map(cosmeticKey), collection:{favorites:[],seen:[],presets:[]}});
  `);
  h.document.getElementById('open-profile-collection').click();
  return h;
}

test('coleção filtra por tipo e conjunto, marca vistos e sincroniza favoritos', async t => {
  const h = await setup(t), d = h.document;
  const list = d.getElementById('collection-items');
  assert.match(list.textContent, /Sancord Core/);
  assert.match(list.textContent, /Clássicos/);
  assert.doesNotMatch(list.textContent, /Fundação/);
  const pick = (kind, id, action) => list.querySelector(`[data-key="${kind}:${id}"][data-action="${action}"]`);
  const frame = () => pick('profile_frame','core-pulse','preview');
  assert.match(frame().textContent, /Equipado/);
  assert.match(frame().textContent, /Novo/);
  const category = d.getElementById('collection-category');
  category.value = 'profile_frame';
  category.dispatchEvent(new h.w.Event('change'));
  assert.doesNotMatch(list.textContent, /Faixa Core/);
  const set = d.getElementById('collection-set');
  set.value = 'classicos';
  set.dispatchEvent(new h.w.Event('change'));
  assert.match(list.textContent, /Nenhum item/);
  set.value = 'all';
  set.dispatchEvent(new h.w.Event('change'));
  frame().click();
  assert.equal(h.run('sent.at(-1).type'), 'MarkCosmeticsSeen');
  assert.equal(h.run('profileDraft.profile_frame'), 'core-pulse');
  await h.run(`receive("CosmeticCollectionUpdated", {collection:{seen:["profile_frame:core-pulse"]}})`);
  assert.doesNotMatch(frame().textContent, /Novo/);
  pick('profile_frame','core-pulse','favorite').click();
  assert.equal(h.run('sent.at(-1).type'), 'SetCosmeticFavorite');
  assert.equal(h.run('sent.at(-1).payload.favorite'), true);
  await h.run(`receive("CosmeticCollectionUpdated", {collection:{favorites:["profile_frame:core-pulse"],seen:["profile_frame:core-pulse"]}})`);
  const favorites = d.getElementById('collection-favorites');
  favorites.click();
  category.value = 'all';
  category.dispatchEvent(new h.w.Event('change'));
  assert.equal(list.querySelectorAll('.collection-item').length, 1);
  assert.equal(pick('profile_frame','core-pulse','favorite').getAttribute('aria-pressed'), 'true');
});

test('Surpreenda-me prepara prévia só com itens possuídos e propõe um rascunho', async t => {
  const h = await setup(t), d = h.document;
  h.run('profileDraft.bio = "Rascunho local"; profileDraft.media.banner = "remove";');
  d.getElementById('collection-random').click();
  assert.equal(h.run('sent.length'), 0);
  assert.equal(h.run('profileDraft.avatar_decoration'), 'none');
  assert.equal(d.getElementById('collection-preview').classList.contains('hidden'), false);
  assert.match(d.getElementById('collection-preview-items').textContent, /Sinal Core/);
  d.getElementById('collection-use-look').click();
  assert.equal(h.run('sent.length'), 0);
  assert.equal(h.run('profileDraft.profile_frame'), 'core-pulse');
  assert.equal(h.run('profileDraft.profile_effect'), 'core-signal');
  assert.equal(h.run('profileDraft.nameplate_style'), 'core-stripe');
  assert.equal(h.run('state.selfUser.avatar_decoration'), undefined);
  assert.equal(h.run('profileDraft.avatar_decoration'), 'core-orbit');
  assert.equal(h.run('profileDraft.bio'), 'Rascunho local');
  assert.equal(h.run('profileDraft.media.banner'), 'remove');
  assert.equal(d.getElementById('settings-name-style-select').value, 'neon');
  assert.match(d.getElementById('collection-status').textContent, /Salve as alterações/);
});

test('preset captura o visual do editor e aplica pelo ID confirmado pelo servidor', async t => {
  const h = await setup(t), d = h.document;
  h.run('profileDraft.theme_primary = "#123abc"; profileDraft.profile_effect = "core-signal";');
  d.getElementById('collection-save-preset').click();
  const form = d.querySelector('.sancord-dialog form');
  form.querySelector('input').value = '  Meu visual  ';
  form.dispatchEvent(new h.w.Event('submit', {cancelable:true}));
  await h.flush();
  assert.equal(h.run('sent.at(-1).type'), 'SaveProfilePreset');
  assert.equal(h.run('sent.at(-1).payload.name'), 'Meu visual');
  assert.equal(h.run('sent.at(-1).payload.appearance.theme_primary'), '#123abc');
  assert.equal(h.run('sent.at(-1).payload.appearance.profile_effect'), 'core-signal');
  assert.match(d.getElementById('collection-presets').textContent, /Nenhum preset/);
  await h.run(`receive("CosmeticCollectionUpdated", {collection:{presets:[
    {id:"preset-a",...sent.at(-1).payload}, {id:"preset-b",name:"Inverno",appearance:{profile_frame:"founder"}}
  ]}})`);
  const apply = d.querySelector('button[aria-label="Aplicar preset Meu visual"]');
  assert.ok(!apply.disabled);
  assert.ok(d.querySelector('button[aria-label="Aplicar preset Inverno"]').disabled);
  apply.click();
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(sent.at(-1))')), {
    type:'EquipProfileLook', payload:{choice:{kind:'preset',id:'preset-a'}},
  });
});
