const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('GIFs de perfil usam no máximo dois originais e trocam a fonte ao perder foco', async t => {
  const h = await openInterface(t), d = h.document;
  const root = d.createElement('div');
  root.id = 'motion-fixture';
  d.body.append(root);
  h.run(`
    state.audioSettings.profileAnimations = "always";
    const root = document.getElementById("motion-fixture");
    for (let n = 0; n < 200; n++) {
      root.insertAdjacentHTML("beforeend", '<div class="member-item"><div class="avatar">' +
        renderAvatarInner("Pessoa " + n, '/api/attachments/abc/avatar.gif') + '</div></div>');
    }
    const source = root.querySelector("img").dataset.profileSrc;
    profileFrames.set(source, "blob:quadro-estatico");
    refreshAnimatedMedia(root);
    updateProfileMotion();
  `);
  const original = () => [...root.querySelectorAll('img')].filter(img => img.getAttribute('src') === img.dataset.profileSrc);
  assert.equal(original().length, 2);
  assert.equal(root.querySelectorAll('img[src="blob:quadro-estatico"]').length, 198);
  h.run(`profileMedia.get(document.querySelector("#motion-fixture img")).visible = false; updateProfileMotion();`);
  assert.equal(original().length, 2);
  assert.equal(root.querySelector('img').getAttribute('src'), 'blob:quadro-estatico');
  h.w.dispatchEvent(new h.w.Event('blur'));
  assert.equal(original().length, 0);
  assert.ok(d.body.classList.contains('profile-window-inactive'));
  h.w.dispatchEvent(new h.w.Event('focus'));
  h.run('updateProfileMotion()');
  assert.equal(original().length, 2);
  const reduce = d.getElementById('appearance-reduce-motion');
  reduce.click();
  h.run('applyProfileAnimPolicy()');
  assert.equal(original().length, 0);
});

test('controles locais desligam tipos independentes e interrompem o efeito atual', async t => {
  const h = await openInterface(t), d = h.document;
  for (const [type, key] of [
    ['decorations', 'showProfileDecorations'], ['frames', 'showProfileFrames'],
    ['nameplates', 'showProfileNameplates'],
  ]) {
    const input = d.getElementById(`appearance-show-profile-${type}`);
    assert.equal(input.checked, true);
    input.click();
    assert.equal(h.run(`state.audioSettings.${key}`), false);
    assert.ok(d.body.classList.contains(`profile-hide-${type}`));
  }
  h.run(`
    openMemberProfilePopover(null, {author_name:"Bia"});
    configureProfileEffect(document.getElementById("profile-card-effect-layer"), "core-signal");
    playProfileEffect(document.getElementById("profile-card-effect-layer"));
  `);
  const effect = d.getElementById('profile-card-effect-layer');
  assert.ok(effect.classList.contains('is-playing'));
  d.getElementById('appearance-show-profile-effects').click();
  assert.equal(effect.classList.contains('is-playing'), false);
  assert.equal(h.run('playProfileEffect(document.getElementById("profile-card-effect-layer"))'), false);
  assert.equal(h.run('profileAnimPolicy()'), 'hover');
  d.getElementById('appearance-show-profile-animations').click();
  assert.equal(h.run('profileAnimPolicy()'), 'never');
  assert.equal(d.getElementById('appearance-profile-animations').disabled, true);
  const stored = JSON.parse(h.w.localStorage.getItem('sancord_audio_settings'));
  assert.equal(stored.showProfileEffects, false);
  assert.equal(stored.showProfileFrames, false);
});
