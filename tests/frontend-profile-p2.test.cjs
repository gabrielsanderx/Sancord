// Perfil P2: decorações novas, molduras (camada sobre o cartão), molduras reativas,
// badges concedidas pelo servidor e seletor de cosméticos do catálogo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

const CATALOG = [
  { id: 'core-orbit', kind: 'avatar_decoration', name: 'Órbita', collection: 'sancord-core', rarity: 'common', animated: true, availability: 'free' },
  { id: 'core-pulse', kind: 'profile_frame', name: 'Pulso Core', collection: 'sancord-core', rarity: 'common', animated: true, availability: 'free' },
  { id: 'minimal', kind: 'profile_frame', name: 'Minimal', collection: 'sancord-core', rarity: 'common', animated: false, availability: 'free' },
  { id: 'founder', kind: 'profile_frame', name: 'Fundação', collection: 'conquistas', rarity: 'founder', animated: true, availability: 'badge:founder' },
  { id: 'winter-2026', kind: 'profile_frame', name: 'Inverno 2026', collection: 'temporada-inverno', rarity: 'event', animated: true, availability: 'grant' },
];
const BADGES = [
  { id: 'founder', name: 'Fundação', category: 'trust', description: 'Fundou o projeto.' },
  { id: 'early_user', name: 'Pioneira', category: 'cosmetic', description: 'Conta da fase inicial.' },
];

async function setup(t) {
  const h = await openInterface(t);
  h.w.__cat = CATALOG;
  h.w.__badges = BADGES;
  h.run(`
    URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {};
    state.selfUser = { id: 'u1', username: 'Ana', avatar_color: '#5865f2', badges: ['founder', 'early_user'] };
    onCosmeticsState({ catalog: __cat, owned: ['avatar_decoration:core-orbit', 'profile_frame:core-pulse', 'profile_frame:minimal'], badges: __badges });
    refreshLiveProfilePreview = () => {};
  `);
  return h;
}

test('decoração nova tem arte própria em camada separada do avatar', async t => {
  const h = await setup(t);
  const html = h.run('getDecoSvgHtml("core-orbit")');
  assert.match(html, /deco-svg-layer/);
  assert.match(html, /avatar-art-front.*hover-loop/);
  assert.match(h.run('profileAvatarArtLayer("core-orbit", "back")'), /avatar-art-back/);
  assert.equal(h.run('sancordDecorationArt("inexistente")'), null);
  for (const id of ['nebula-orbit', 'sakura-fall', 'cyber-ring', 'electric-pulse', 'lunar', 'ember', 'snowfall', 'ocean-bubbles', 'digital-rain', 'retro-pixels']) {
    assert.ok(h.run(`sancordDecorationArt("${id}")`), `sem arte: ${id}`);
  }
});

test('moldura: camada única sobre o cartão, troca e remoção limpas', async t => {
  const h = await setup(t), d = h.document;
  const card = d.createElement('div');
  card.className = 'profile-card';
  h.w.__card = card;
  h.run('applyProfileFrame(__card, "cyber-corners")');
  assert.equal(card.classList.contains('pf-cyber-corners'), true);
  assert.equal(card.querySelectorAll('.pf-layer').length, 1);
  assert.ok(card.querySelector('.pf-layer svg.pf-corners'), 'ornamento próprio');
  h.run('applyProfileFrame(__card, "minimal")');
  assert.equal(card.classList.contains('pf-cyber-corners'), false);
  assert.equal(card.querySelectorAll('.pf-layer').length, 1);
  h.run('applyProfileFrame(__card, "none")');
  assert.equal(card.querySelector('.pf-layer'), null);
  assert.equal(card.classList.contains('has-frame'), false);
});

test('moldura reativa: presença e voz viram atributos (status oficial continua no avatar)', async t => {
  const h = await setup(t), d = h.document;
  const card = d.createElement('div');
  h.w.__card = card;
  h.run('state.speakingUsers = new Set(["u2"]); setFrameReactiveState(__card, { id: "u2", status_kind: "dnd", voice_channel_id: "v1" })');
  assert.equal(card.dataset.presence, 'dnd');
  assert.equal(card.dataset.voice, 'speaking');
  h.run('setFrameReactiveState(__card, { id: "u3", status_kind: "online", voice_channel_id: "v1", muted: true })');
  assert.equal(card.dataset.voice, 'muted');
  h.run('setFrameReactiveState(__card, { id: "u4", status_kind: "invisible" })');
  assert.equal(card.dataset.presence, 'offline');
  assert.equal(card.dataset.voice, 'none');
});

test('badges: confiança separada de cosmética, com nome e descrição', async t => {
  const h = await setup(t), d = h.document;
  const host = d.createElement('div');
  h.w.__host = host;
  h.run('renderProfileBadges(__host, ["founder", "early_user", "badge-falsa"])');
  const badges = [...host.querySelectorAll('.profile-badge')];
  assert.equal(badges.length, 2, 'id desconhecido não aparece');
  assert.equal(badges[0].classList.contains('badge-trust'), true);
  assert.equal(badges[1].classList.contains('badge-cosmetic'), true);
  assert.match(badges[0].getAttribute('aria-label'), /^Fundação — /);
  h.run('renderProfileBadges(__host, [])');
  assert.equal(host.classList.contains('hidden'), true);
});

test('seletor: abas, coleções, itens bloqueados não equipam e Aplicar vai para o rascunho', async t => {
  const h = await setup(t), d = h.document;
  h.run('profileDraft.profile_frame = "none"; openCosmeticPicker("profile_frame")');
  const pickerEl = d.querySelector('.cosmetic-picker');
  assert.equal(pickerEl.classList.contains('hidden'), false);
  const tabs = [...pickerEl.querySelectorAll('.cosmetic-tab')].map(b => b.textContent);
  assert.deepEqual(tabs, ['Todas (4)', 'Animadas (3)', 'Estáticas (1)', 'Conquistas (1)', 'Evento (1)']);
  const titles = [...pickerEl.querySelectorAll('.cosmetic-collection-title')].map(x => x.textContent);
  assert.deepEqual(titles, ['Sanvo Core', 'Conquistas', 'Temporada de inverno']);

  const founder = pickerEl.querySelector('.cosmetic-choice[data-id="founder"]');
  assert.equal(founder.classList.contains('locked'), true);
  founder.click();
  assert.match(pickerEl.querySelector('.cosmetic-locked-hint').textContent, /Conquista: Fundação/);
  assert.equal(h.run('picker.selected'), null, 'bloqueado não é selecionado');

  pickerEl.querySelector('.cosmetic-choice[data-id="core-pulse"]').click();
  assert.equal(pickerEl.querySelector('.cosmetic-choice.selected').dataset.id, 'core-pulse');
  assert.ok(pickerEl.querySelector('.cosmetic-picker-detail .compact-profile-preview.pf-core-pulse'), 'prévia real com a moldura');
  pickerEl.querySelector('[data-picker-apply]').click();
  assert.equal(h.run('profileDraft.profile_frame'), 'core-pulse');
  assert.equal(pickerEl.classList.contains('hidden'), true);

  // Remover tira a moldura do rascunho.
  h.run('openCosmeticPicker("profile_frame")');
  pickerEl.querySelector('[data-picker-none]').click();
  assert.equal(h.run('profileDraft.profile_frame'), 'none');
});

test('seletor de decoração usa o catálogo e mostra o avatar com a decoração', async t => {
  const h = await setup(t), d = h.document;
  h.run('profileDraft.avatar_decoration = "none"; openCosmeticPicker("avatar_decoration")');
  const choice = d.querySelector('.cosmetic-picker .cosmetic-choice[data-id="core-orbit"]');
  assert.ok(choice.querySelector('.avatar-deco-wrap .deco-svg-layer'));
  choice.click();
  d.querySelector('.cosmetic-picker [data-picker-apply]').click();
  assert.equal(h.run('profileDraft.avatar_decoration'), 'core-orbit');
});
