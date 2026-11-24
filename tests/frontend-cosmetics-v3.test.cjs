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

  assert.equal(summary.version, 5);
  assert.ok(summary.decos.length >= 8, 'Pelo menos 8 Avatar Decorations registradas');
  assert.ok(summary.frames.length >= 8, 'Pelo menos 8 Profile Frames registradas');
  assert.ok(summary.effects.length >= 6, 'Pelo menos 6 Profile Effects registrados');
  assert.ok(summary.nameplates.length >= 8, 'Pelo menos 8 Nameplates registradas');
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
  assert.ok(wrap.querySelector('.avatar-art-back.cos-v5-deco'), 'Camada traseira (BACK_LAYER) presente');
  assert.ok(wrap.querySelector('.avatar-art-front.cos-v5-deco'), 'Camada frontal (FRONT_LAYER) presente');
  assert.ok(wrap.querySelector('img.cos-v5-art-back'), 'Arte WebP pintada traseira presente');
  assert.ok(wrap.querySelector('img.cos-v5-art-front'), 'Arte WebP pintada frontal presente');
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

  // 2) Profile Effect com timeline narrativa V5 (star-trail: camada WebP + Canvas 2D VFX).
  h.run('configureProfileEffect(__effectLayer, "star-trail"); playProfileEffect(__effectLayer)');
  assert.equal(effectLayer.classList.contains('is-playing'), true);
  assert.ok(effectLayer.querySelector('.cos-v5-effect'), 'Camada narrativa V5 montada');
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

test('classificação canônica de animação cobre todas as categorias e mantém itens estáticos como STATIC', async t => {
  const h = await openInterface(t);
  const check = JSON.parse(h.run(`JSON.stringify({
    galaxy: SancordCosmetics.getAnimationMode("avatar_decoration", "galaxy-portal"),
    sakura: SancordCosmetics.getAnimationMode("avatar_decoration", "sakura-glow"),
    flame: SancordCosmetics.getAnimationMode("avatar_decoration", "flame-violet"),
    staticCrown: SancordCosmetics.getAnimationMode("avatar_decoration", "static-royal-crown"),
    corePulse: SancordCosmetics.getAnimationMode("profile_frame", "core-pulse"),
    royalFrame: SancordCosmetics.getAnimationMode("profile_frame", "royal"),
    cyberHudFrame: SancordCosmetics.getAnimationMode("profile_frame", "cyber-corners"),
    reactiveAura: SancordCosmetics.getAnimationMode("profile_frame", "reactive-aura"),
    voicePulse: SancordCosmetics.getAnimationMode("profile_frame", "voice-pulse"),
    starTrail: SancordCosmetics.getAnimationMode("profile_effect", "star-trail"),
    embers: SancordCosmetics.getAnimationMode("profile_effect", "embers"),
    twilight: SancordCosmetics.getAnimationMode("nameplate", "twilight-garden"),
    starlit: SancordCosmetics.getAnimationMode("nameplate", "starlit-silt"),
    goldLeaf: SancordCosmetics.getAnimationMode("nameplate", "gold-leaf"),
    prism: SancordCosmetics.getAnimationMode("name_style", "prism"),
    neon: SancordCosmetics.getAnimationMode("name_style", "neon"),
    chrome: SancordCosmetics.getAnimationMode("name_style", "chrome"),
    editorial: SancordCosmetics.getAnimationMode("name_style", "editorial"),
  })`));

  assert.equal(check.galaxy, 'IDLE_WITH_EVENTS');
  assert.equal(check.sakura, 'IDLE_WITH_EVENTS');
  assert.equal(check.flame, 'IDLE_WITH_EVENTS');
  assert.equal(check.staticCrown, 'STATIC');
  assert.equal(check.corePulse, 'IDLE_WITH_EVENTS');
  assert.equal(check.royalFrame, 'STATIC');
  assert.equal(check.cyberHudFrame, 'STATIC');
  assert.equal(check.reactiveAura, 'REACTIVE');
  assert.equal(check.voicePulse, 'REACTIVE');
  assert.equal(check.starTrail, 'PLAY_ON_OPEN');
  assert.equal(check.embers, 'PLAY_ON_OPEN');
  assert.equal(check.twilight, 'IDLE_WITH_EVENTS');
  assert.equal(check.starlit, 'IDLE_WITH_EVENTS');
  assert.equal(check.goldLeaf, 'STATIC');
  assert.equal(check.prism, 'LOOP');
  assert.equal(check.neon, 'LOOP');
  assert.equal(check.chrome, 'IDLE_WITH_EVENTS');
  assert.equal(check.editorial, 'STATIC');
});

test('hover em mensagem não congela perfil aberto, re-render é idempotente e budget segura lista com 80 membros', async t => {
  const h = await openInterface(t);
  const d = h.document;

  // 1) Abrir Perfil Completo e simular hover em uma mensagem externa: perfil continua com .profile-motion-active!
  h.run(`
    state.users.set('bia', {
      id: 'bia', username: 'Bia', display_name: 'Bia', avatar_color: '#6366f1',
      avatar_decoration: 'galaxy-portal', profile_frame: 'cosmic-drift',
      profile_effect: 'star-trail', name_style: 'cyber+holographic', nameplate_style: 'starlit-silt'
    });
    openMemberProfilePopover('bia');
    updateProfileMotion();
  `);
  const card = d.getElementById('profile-popover-card');
  assert.equal(card.classList.contains('profile-motion-active'), true, 'Perfil completo aberto recebe motion ativo');

  const msg = d.createElement('div');
  msg.className = 'message-item';
  d.body.appendChild(msg);
  h.w.__msg = msg;
  h.run('noteProfileInteraction(__msg, false); updateProfileMotion();');
  assert.equal(card.classList.contains('profile-motion-active'), true, 'Hover em mensagem não pode congelar o perfil aberto');
  assert.equal(msg.classList.contains('profile-motion-active'), true, 'Item com hover também anima sem roubar o perfil');

  // 2) Re-renderização de bio não destrói nós de decoração/moldura nem reinicia efeito já encerrado.
  const decoLayerBefore = card.querySelector('.deco-svg-layer');
  const frameLayerBefore = card.querySelector('.pf-layer');
  assert.ok(frameLayerBefore.querySelector('.frame-art-glint'), 'Frame animada v3 possui camada de brilho');
  h.run(`
    stopProfileEffect(document.getElementById('profile-card-effect-layer'));
    renderVisitedProfile({ ...state.users.get('bia'), bio: 'Nova bio atualizada' }, 'Bia', 'bia');
  `);
  assert.equal(card.querySelector('.deco-svg-layer'), decoLayerBefore, 'Decoração preservada sem reiniciar animação');
  assert.equal(card.querySelector('.pf-layer'), frameLayerBefore, 'Moldura preservada sem reiniciar animação');
  assert.equal(d.getElementById('profile-card-effect-layer').classList.contains('is-playing'), false, 'Bio nova não redispara ProfileEffect');

  // 3) Lista de 80 membros respeita orçamento de idle hosts e isola erros de IDs inválidos.
  const sidebar = d.createElement('aside');
  sidebar.className = 'members-sidebar';
  for (let i = 0; i < 80; i++) {
    const row = d.createElement('div');
    row.className = 'member-item';
    row.innerHTML = '<div class="avatar-deco-wrap"><div class="avatar">M</div></div><span class="styled-name">M' + i + '</span>';
    sidebar.appendChild(row);
  }
  d.body.appendChild(sidebar);
  h.w.__sidebar = sidebar;
  h.run(`
    for (const row of __sidebar.querySelectorAll('.member-item')) {
      applyDecoToElement(row.querySelector('.avatar-deco-wrap'), 'sakura-glow');
      SancordCosmetics.renderNameplateArt(row, 'twilight-garden');
    }
    SancordCosmetics.reconcileIdleBudget();
  `);
  const activeInSidebar = sidebar.querySelectorAll('[data-cosmetic-idle-active="true"]').length;
  assert.equal(activeInSidebar, 0, 'Member list nunca consome idle scheduler quando sem hover');
  const totalActive = d.querySelectorAll('[data-cosmetic-idle-active="true"]').length;
  assert.ok(totalActive <= 6, `Total de idle hosts ativos (${totalActive}) deve respeitar budget <= 6`);

  // Isolamento de erro: chamadas inválidas não quebram renderização.
  assert.doesNotThrow(() => {
    h.run(`
      SancordCosmetics.avatarArtLayerHtml(null, 'front');
      SancordCosmetics.profileFrameArtHtml('__inexistente__');
      SancordCosmetics.profileEffectArtHtml(undefined);
      SancordCosmetics.renderNameplateArt(null, 'starlit-silt');
    `);
  });
});

test('CSS de cosméticos não usa animation:none fora de Reduced Motion e cobre todos os contextos e materiais', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const uiCss = fs.readFileSync(path.join(__dirname, '..', 'static', 'ui.css'), 'utf8');
  const cosCss = fs.readFileSync(path.join(__dirname, '..', 'static', 'cosmetics', 'cosmetics.css'), 'utf8');

  assert.equal(uiCss.includes(':is(.pf-layer, .deco-svg-layer):not(.profile-motion-active *) *,\nbody:is(.anim-policy-never'), false,
    'ui.css não deve matar animações com animation:none !important em :not(.profile-motion-active *)');
  assert.match(cosCss, /\[data-profile-render-context="popout"\]/, 'cosmetics.css cobre contexto popout');
  assert.match(cosCss, /\[data-profile-render-context="editor"\]/, 'cosmetics.css cobre contexto editor');
  assert.match(cosCss, /cosNameNeonPulse/, 'cosmetics.css anima brilho neon/glow');
  assert.match(cosCss, /cosNameMetalSheen/, 'cosmetics.css anima reflexo especular metálico chrome/royal');
  assert.match(cosCss, /cosRailPulseDown/, 'cosmetics.css anima trilhos luminosos de frames v3');
  assert.match(cosCss, /cosPlateGlint/, 'cosmetics.css anima sheen de nameplates v3');
  assert.match(cosCss, /\[data-cosmetic-mode="STATIC"\][\s\S]*animation:\s*none\s*!important/, 'Itens STATIC permanecem estáticos');
  assert.equal(uiCss.includes('@media (prefers-reduced-motion: reduce) { *, *::before, *::after'), false,
    'ui.css não deve matar todas as animações no Windows quando efeitos do sistema estão desligados');
});

test('Windows com efeitos de animação desligados (prefers-reduced-motion) não congela cosméticos sem opt-in no Sanvo', async t => {
  const h = await openInterface(t);
  const d = h.document;
  h.run(`
    window.matchMedia = (q) => ({
      matches: String(q).includes('prefers-reduced-motion'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    });
    state.audioSettings.reduceMotion = false;
    state.audioSettings.syncReducedMotion = false;
    applyReduceMotion();
  `);
  assert.equal(d.body.classList.contains('reduce-motion'), false);
  assert.equal(d.body.classList.contains('anim-policy-never'), false);
  assert.equal(h.run('SancordCosmetics.isReducedMotionActive()'), false);

  // Ao ativar "Sincronizar com o computador", passa a respeitar o Windows imediatamente.
  h.run('state.audioSettings.syncReducedMotion = true; applyReduceMotion();');
  assert.equal(d.body.classList.contains('reduce-motion'), true);
  assert.equal(d.body.classList.contains('anim-policy-never'), true);
  assert.equal(h.run('SancordCosmetics.isReducedMotionActive()'), true);
});

test('Biblioteca Flagship V5: 4 coleções pintadas WebP multicamada (BACK+FRONT+BLINK), frames assimétricas (TL+TR+BR), efeitos 4-atos e aliases legados', async t => {
  const h = await openInterface(t);
  const d = h.document;

  const stats = JSON.parse(h.run(`JSON.stringify({
    engineVersion: SancordCosmetics.VERSION,
    vfxVersion: SanvoCosmeticsVFX.VERSION,
    v5Decos: Object.keys(SancordCosmetics.V5_AVATAR_ART).length,
    v5Frames: Object.keys(SancordCosmetics.V5_FRAME_ART).length,
    uiDecos: AVATAR_DECORATIONS.filter(x => x.id !== 'none').length,
    uiEffects: PROFILE_EFFECTS.filter(x => x.id !== 'none').length,
    legacyDeco: SancordCosmetics.resolveCosmeticId("avatar_decoration", "flame-violet"),
    legacyFrame: SancordCosmetics.resolveCosmeticId("profile_frame", "prism-flow"),
    legacyEffect: SancordCosmetics.resolveCosmeticId("profile_effect", "lightning"),
    legacyPlate: SancordCosmetics.resolveCosmeticId("nameplate", "crimson"),
  })`));

  assert.equal(stats.engineVersion, 5);
  assert.equal(stats.vfxVersion, 5);
  assert.equal(stats.v5Decos, 13);
  assert.equal(stats.v5Frames, 17);
  assert.equal(stats.uiDecos, 13);
  assert.equal(stats.uiEffects, 12);
  assert.equal(stats.legacyDeco, 'dragon-fire');
  assert.equal(stats.legacyFrame, 'holographic');
  assert.equal(stats.legacyEffect, 'synth-overdrive');
  assert.equal(stats.legacyPlate, 'ember-line');

  // Combinação completa no Perfil Completo: Kitsune-Neko Cyber (WebP BACK+FRONT+BLINK) + Chassi Synth-Neko (TL+TR+BR) + Inicialização Holográfica
  h.run(`
    state.users.set('nova', {
      id: 'nova', username: 'Nova', display_name: 'Nova Cyber', avatar_color: '#6366f1',
      avatar_decoration: 'cat-gamer', profile_frame: 'holographic',
      profile_effect: 'circuit-boot', name_style: 'fantasy+holographic', nameplate_style: 'core-stripe'
    });
    openMemberProfilePopover('nova');
  `);
  const card = d.getElementById('profile-popover-card');
  assert.ok(card.querySelector('.avatar-art-back .cos-v5-art-back')?.getAttribute('src')?.includes('deco_cyber_back.webp'));
  assert.ok(card.querySelector('.avatar-art-front .cos-v5-art-front')?.getAttribute('src')?.includes('deco_cyber_front.webp'));
  assert.ok(card.querySelector('.avatar-art-front .cos-v5-blink-img')?.getAttribute('src')?.includes('deco_cyber_blink.webp'));
  assert.ok(card.querySelector('.avatar-art-back .cos-vfx-avatar-back'), 'Avatar decoration monta Canvas VFX na camada traseira');
  assert.ok(card.querySelector('.avatar-art-front .cos-vfx-avatar-front'), 'Avatar decoration monta Canvas VFX na camada frontal');
  assert.ok(card.querySelector('.pf-layer .cos-v5-frame .frame-v5-tl')?.getAttribute('src')?.includes('frame_cyber_tl.webp'));
  assert.ok(card.querySelector('.pf-layer .cos-v5-frame .frame-v5-tr')?.getAttribute('src')?.includes('frame_cyber_tr.webp'));
  assert.ok(card.querySelector('.pf-layer .cos-v5-frame .frame-v5-br')?.getAttribute('src')?.includes('frame_cyber_br.webp'));
  assert.ok(card.querySelector('.pf-layer .cos-vfx-frame'), 'Profile Frame V5 monta Canvas Ambient VFX');
  assert.ok(card.querySelector('#profile-card-effect-layer .cos-vfx-effect'), 'Profile Effect V5 monta Canvas narrativo');

  // Troca rápida de cosméticos limpa canvases antigos sem vazamento e respeita moldura estática
  h.run(`
    applyDecoToElement(document.getElementById('profile-card-deco-wrap'), 'galaxy-portal');
    applyDecoToElement(document.getElementById('profile-card-deco-wrap'), 'sakura-glow');
    applyProfileFrame(document.getElementById('profile-popover-card'), 'sakura-wind');
    applyProfileFrame(document.getElementById('profile-popover-card'), 'early-user');
  `);
  assert.equal(card.querySelectorAll('.pf-layer .cos-vfx-frame').length, 0, 'Frame estática (early-user) remove Canvas VFX');
  assert.equal(card.querySelectorAll('#profile-card-deco-wrap .cos-vfx-canvas').length, 2, 'Decoração troca limpa com exatamente 2 planos Canvas');

  // Member list nunca cria Canvas VFX
  const sidebar = d.createElement('aside');
  sidebar.className = 'members-sidebar';
  sidebar.innerHTML = '<div class="member-item"><div class="avatar-deco-wrap"><div class="avatar">N</div></div></div>';
  d.body.appendChild(sidebar);
  h.w.__sbV5 = sidebar;
  h.run('applyDecoToElement(__sbV5.querySelector(".avatar-deco-wrap"), "cat-gamer")');
  assert.equal(sidebar.querySelectorAll('.cos-vfx-canvas').length, 0, 'Member list nunca instancia Canvas VFX');

  // Expansão V5: conjunto exclusivo Soberano + 4 novos efeitos narrativos + 6 novas insígnias exclusivas jewel
  h.run(`
    applyDecoToElement(document.getElementById('profile-card-deco-wrap'), 'eclipse-sovereign');
    applyProfileFrame(document.getElementById('profile-popover-card'), 'sovereign-crest');
    configureProfileEffect(document.getElementById('profile-card-effect-layer'), 'abyssal-tide');
    playProfileEffect(document.getElementById('profile-card-effect-layer'));
    renderProfileBadges(document.getElementById('profile-card-badges'), [
      'architect', 'sovereign', 'astral_guardian', 'dragon_forged', 'prism_collector', 'obsidian_vip'
    ]);
  `);
  assert.ok(card.querySelector('.avatar-art-front .cos-v5-art-front')?.getAttribute('src')?.includes('deco_sovereign_front.webp'));
  assert.ok(card.querySelector('.pf-layer .cos-v5-frame .frame-v5-tl')?.getAttribute('src')?.includes('frame_sovereign_tl.webp'));
  assert.ok(card.querySelector('#profile-card-effect-layer .cos-v5-effect'), 'Novo efeito abyssal-tide usa camada V5 sem linhas SVG antigas');
  assert.equal(card.querySelectorAll('#profile-card-effect-layer .effect-plane-back').length, 0);
  assert.equal(card.querySelectorAll('#profile-card-badges .profile-badge.badge-jewel').length, 6, 'Todas as 6 novas insígnias exclusivas renderizam com estilo jewel');

  // Expansão V5 Wave 3: Bosque Onírico (com flutter blink), Templo do Trovão, Horizonte Arcade, Lagoa de Jade + molduras exclusivas Founder/Developer dedicadas
  h.run(`
    applyDecoToElement(document.getElementById('profile-card-deco-wrap'), 'lunar');
    applyProfileFrame(document.getElementById('profile-popover-card'), 'dream-sanctuary');
    configureProfileEffect(document.getElementById('profile-card-effect-layer'), 'dream-butterflies');
    playProfileEffect(document.getElementById('profile-card-effect-layer'));
  `);
  assert.ok(card.querySelector('.avatar-art-front .cos-v5-art-front')?.getAttribute('src')?.includes('deco_dream_front.webp'));
  assert.ok(card.querySelector('.avatar-art-front .cos-v5-blink-img')?.getAttribute('src')?.includes('deco_dream_blink.webp'), 'Guardião das Borboletas inclui overlay secundário de bater de asas');
  assert.ok(card.querySelector('.pf-layer .cos-v5-frame .frame-v5-tl')?.getAttribute('src')?.includes('frame_dream_tl.webp'));
  assert.ok(card.querySelector('#profile-card-effect-layer .cos-v5-effect'), 'Revoada Onírica monta efeito narrativo V5');

  h.run(`
    applyDecoToElement(document.getElementById('profile-card-deco-wrap'), 'core-orbit');
    applyProfileFrame(document.getElementById('profile-popover-card'), 'founder');
  `);
  assert.ok(card.querySelector('.avatar-art-front .cos-v5-art-front')?.getAttribute('src')?.includes('deco_jade_front.webp'));
  assert.ok(card.querySelector('.pf-layer .cos-v5-frame .frame-v5-tl')?.getAttribute('src')?.includes('frame_founder_tl.webp'), 'Moldura Founder usa ornamento dedicado frame_founder_tl.webp');
});
