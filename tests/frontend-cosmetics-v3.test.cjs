// Testes do Motor Unificado de Cosméticos v3 (camadas, IDLE_WITH_EVENTS, timeline,
// frames responsivas, nameplates ilustradas, novas fontes/materiais e reduced motion).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('SancordCosmetics expõe pipeline estruturado, metadata completa e sem emojis como arte', async t => {
  const h = await openInterface(t);
  const summary = JSON.parse(h.run(`JSON.stringify({
    version: SancordCosmetics.VERSION,
    decos: Object.keys(SancordCosmetics.registry.avatar_decorations),
    frames: Object.keys(SancordCosmetics.registry.frames),
    effects: Object.keys(SancordCosmetics.registry.profile_effects),
    nameplates: Object.keys(SancordCosmetics.registry.nameplates),
    maxIdle: SancordCosmetics.BUDGET.maxConcurrentIdleHosts,
  })`));

  assert.equal(summary.version, 3);
  assert.ok(summary.decos.length >= 8, 'Pelo menos 8 Avatar Decorations v3');
  assert.ok(summary.frames.length >= 8, 'Pelo menos 8 Profile Frames v3');
  assert.ok(summary.effects.length >= 6, 'Pelo menos 6 Profile Effects v3');
  assert.ok(summary.nameplates.length >= 8, 'Pelo menos 8 Nameplates v3');
  assert.equal(summary.maxIdle, 6);

  // Nenhum rótulo de PROFILE_EFFECTS ou NAMEPLATES usa emoji decorativo como arte.
  const hasEmojiNames = h.run(`[...PROFILE_EFFECTS, ...NAMEPLATES].some(i => /[🔥✨🌸💚⚡❄️🎉🌐🌋🌌📺🌈🩸🌿👑🕳️☢️🌆]/.test(i.name || ''))`);
  assert.equal(hasEmojiNames, false, 'Não deve usar emojis como arte nos nomes dos cosméticos');
});

test('Avatar Decorations v3 compõem BACK+FRONT, suportam STATIC detalhadas e IDLE_WITH_EVENTS respeitando budget e Reduced Motion', async t => {
  const h = await openInterface(t);
  const d = h.document;

  // 1) Guardião Celeste (galaxy-portal): camadas back+front, companheiro com pálpebra e estrela cadente.
  const wrap = d.createElement('div');
  wrap.className = 'profile-card-avatar-wrap';
  wrap.innerHTML = '<div class="avatar">SW</div><span class="status-badge online"></span>';
  d.body.appendChild(wrap);
  h.w.__wrap = wrap;

  h.run('applyDecoToElement(__wrap, "galaxy-portal")');
  assert.ok(wrap.querySelector('.avatar-art-back.cos-v3-deco'), 'Camada traseira (BACK_LAYER) presente');
  assert.ok(wrap.querySelector('.avatar-art-front.cos-v3-deco'), 'Camada frontal (FRONT_LAYER) presente');
  assert.ok(wrap.querySelector('.cos-eyelid'), 'Pálpebra para evento secundário de piscar');
  assert.ok(wrap.querySelector('.cos-shooting-star'), 'Estrela cadente para evento raro');
  assert.equal(wrap.dataset.cosmeticMode, 'IDLE_WITH_EVENTS');
  assert.ok(h.run('SancordCosmetics.getIdleHostCount()') >= 1);

  // Disparo de eventos secundário e raro funciona normalmente com motion ativo.
  assert.equal(h.run('SancordCosmetics.triggerIdleEventNow(__wrap, "secondary")'), true);
  assert.equal(wrap.classList.contains('is-secondary-event'), true);
  assert.equal(h.run('SancordCosmetics.triggerIdleEventNow(__wrap, "rare")'), true);
  assert.equal(wrap.classList.contains('is-rare-event'), true);

  // Com reduceMotion = true, scheduler pausa e remove classes de evento imediatamente.
  h.run('state.audioSettings.reduceMotion = true; applyProfileAnimPolicy()');
  assert.equal(wrap.classList.contains('is-secondary-event'), false);
  assert.equal(wrap.classList.contains('is-rare-event'), false);
  assert.equal(h.run('SancordCosmetics.triggerIdleEventNow(__wrap, "secondary")'), false);

  // 2) Estática de alto detalhe (static-royal-crown): back+front, modo STATIC, sem registrar idle timer.
  h.run('state.audioSettings.reduceMotion = false; applyProfileAnimPolicy(); applyDecoToElement(__wrap, "static-royal-crown")');
  assert.ok(wrap.querySelector('.avatar-art-back.cos-v3-deco'));
  assert.ok(wrap.querySelector('.avatar-art-front.cos-v3-deco'));
  assert.equal(wrap.querySelector('.avatar-art-front').dataset.cosmeticMode, 'STATIC');
  assert.equal(h.run('SancordCosmetics.getIdleHostCount()'), 0);

  // 3) Remoção limpa todas as camadas.
  h.run('applyDecoToElement(__wrap, "none")');
  assert.equal(wrap.querySelectorAll('.deco-svg-layer').length, 0);
});

test('Profile Frames v3, Timeline Multi-Estágio de Profile Effects, Nameplates SVG e 10 Fontes + Materiais de Nome', async t => {
  const h = await openInterface(t);
  const d = h.document;

  // 1) Frame arquitetônica (royal estática e cosmic-drift animada) com 4 cantos, crista SVG e selo inferior.
  const card = d.createElement('div');
  card.className = 'profile-card';
  card.dataset.profileRenderContext = 'FULL_PROFILE';
  const effectLayer = d.createElement('div');
  effectLayer.className = 'profile-effect-layer';
  card.appendChild(effectLayer);
  d.body.appendChild(card);
  h.w.__card = card;
  h.w.__effectLayer = effectLayer;

  h.run('applyProfileFrame(__card, "royal")');
  assert.equal(card.querySelectorAll('.frame-art-corner').length, 4);
  assert.ok(card.querySelector('.cos-frame-crest svg'));
  assert.ok(card.querySelector('.frame-art-bottom-seal svg'));
  assert.equal(card.querySelector('.cos-v3-frame').dataset.cosmeticMode, 'STATIC');

  // 2) Profile Effect com timeline multi-estágio (star-trail: back + front).
  h.run('configureProfileEffect(__effectLayer, "star-trail"); playProfileEffect(__effectLayer)');
  assert.equal(effectLayer.classList.contains('is-playing'), true);
  assert.ok(effectLayer.querySelector('.effect-plane-back'), 'Plano de profundidade traseiro');
  assert.ok(effectLayer.querySelector('.effect-plane-front'), 'Plano de profundidade frontal');
  assert.equal(effectLayer.dataset.effectStage, 'init');

  // Aguarda transição para entrance (~150ms) e depois stopProfileEffect limpa tudo.
  await new Promise(r => setTimeout(r, 200));
  assert.equal(effectLayer.dataset.effectStage, 'entrance');
  h.run('stopProfileEffect(__effectLayer)');
  assert.equal(effectLayer.classList.contains('is-playing'), false);
  assert.equal(effectLayer.dataset.effectStage, undefined);

  // 3) Nameplate composta em SVG (.np-art-layer) preserva conteúdo textual e remove limpo.
  const plateRow = d.createElement('div');
  plateRow.innerHTML = '<span class="styled-name">Swag</span>';
  d.body.appendChild(plateRow);
  h.w.__plateRow = plateRow;
  h.run('applyNameplateChip(__plateRow, "twilight-garden")');
  assert.equal(plateRow.classList.contains('has-np-art'), true);
  assert.ok(plateRow.querySelector(':scope > .np-art-layer svg'));
  assert.equal(plateRow.querySelector('.styled-name').textContent, 'Swag');
  h.run('applyNameplateChip(__plateRow, "none")');
  assert.equal(plateRow.classList.contains('has-np-art'), false);
  assert.equal(plateRow.querySelector('.np-art-layer'), null);

  // 4) Display Name Styles: novas fontes (editorial, bubble, cyber, fantasy) + novos materiais (gummy, ink, cosmic).
  const nameEl = plateRow.querySelector('.styled-name');
  h.w.__nameEl = nameEl;
  h.run('applyNameStyleToEl(__nameEl, { name_style: "editorial+gummy", name_color: "#f472b6" }, "#ffffff")');
  assert.equal(nameEl.dataset.nameFont, 'editorial');
  assert.equal(nameEl.classList.contains('name-style-gummy'), true);

  h.run('applyNameStyleToEl(__nameEl, { name_style: "cyber+cosmic" }, "#ffffff")');
  assert.equal(nameEl.dataset.nameFont, 'cyber');
  assert.equal(nameEl.classList.contains('name-style-cosmic'), true);

  h.run('applyNameStyleToEl(__nameEl, { name_style: "fantasy+ink", name_color: "#818cf8" }, "#ffffff")');
  assert.equal(nameEl.dataset.nameFont, 'fantasy');
  assert.equal(nameEl.classList.contains('name-style-ink'), true);
});
