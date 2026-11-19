// Perfil P1: tema (sólido/gradiente/direção/destaque/contraste), bio segura, mídia por
// anexo com rascunho, política de animação, catálogo de cosméticos e prévia em contextos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    globalThis.__sent = [];
    sendWs = (type, payload) => { __sent.push([type, payload]); return true; };
    let __n = 0;
    URL.createObjectURL = () => 'blob:teste-' + (++__n);
    URL.revokeObjectURL = () => {};
    state.selfUser = { id: 'u1', username: 'Ana', avatar_color: '#5865f2', avatar_url: null, banner_url: '/api/attachments/${'a'.repeat(32)}/faixa.png' };
  `);
  return h;
}

test('tema: perfis antigos seguem como gradiente vertical; sólido, diagonal e radial', async t => {
  const h = await setup(t);
  const bg = (u) => h.run(`profileThemeBackground(${JSON.stringify(u)})`);
  assert.equal(bg({ theme_primary: '#112233', theme_accent: '#445566' }), 'linear-gradient(180deg, #112233, #445566)');
  assert.equal(bg({ theme_primary: '#112233', theme_accent: '#445566', theme_mode: 'solid' }), '#112233');
  assert.equal(bg({ theme_primary: '#112233', theme_accent: '#445566', theme_mode: 'gradient', theme_direction: 'diagonal' }), 'linear-gradient(135deg, #112233, #445566)');
  assert.equal(bg({ theme_primary: '#112233', theme_accent: '#445566', theme_mode: 'gradient', theme_direction: 'radial' }), 'radial-gradient(circle at 30% 20%, #112233, #445566)');
  assert.equal(bg({}), null);
  assert.equal(bg({ theme_primary: 'red;background:url(x)' }), null, 'só hex vira cor');
});

test('contraste automático e cor de destaque no cartão', async t => {
  const h = await setup(t), d = h.document;
  assert.equal(h.run('profileTextTone({ theme_primary: "#fefefe", theme_accent: "#f0f0f0" })'), 'dark');
  assert.equal(h.run('profileTextTone({ theme_primary: "#101010", theme_accent: "#202040" })'), 'light');
  const card = d.createElement('div');
  h.w.__card = card;
  h.run('applyProfileTheme(__card, { theme_primary: "#fefefe", theme_mode: "solid", theme_highlight: "#ff8800" })');
  assert.equal(card.classList.contains('profile-text-dark'), true);
  assert.equal(card.style.getPropertyValue('--profile-highlight'), '#ff8800');
});

test('bio: markdown seguro, sem HTML do usuário, e contador', async t => {
  const h = await setup(t), d = h.document;
  const el = d.createElement('p');
  h.w.__el = el;
  h.run('renderProfileBio(__el, "**forte** <img src=x onerror=alert(1)> https://exemplo.com")');
  assert.equal(el.querySelector('strong').textContent, 'forte');
  assert.equal(el.querySelector('img'), null);
  assert.equal(el.querySelector('a').getAttribute('href'), 'https://exemplo.com');
  h.run('renderProfileBio(__el, "  ")');
  assert.equal(el.textContent, 'Nenhuma biografia definida.');
  assert.equal(el.classList.contains('is-empty'), true);
  const input = d.getElementById('settings-bio-input');
  assert.equal(input.getAttribute('maxlength'), '300');
  input.value = 'olá 👋';
  h.run('updateBioCounter()');
  assert.equal(d.getElementById('settings-bio-counter').textContent, '5 / 300');
});

test('mídia: caminho do servidor, GIF marcado como animado e política de animação', async t => {
  const h = await setup(t), d = h.document;
  assert.match(h.run('cachedMediaUrl("/api/attachments/abc/eu.png")'), /^https?:\/\/[^/]+\/api\/attachments\/abc\/eu\.png$/);
  assert.match(h.run('renderAvatarInner("Ana", "/api/attachments/abc/avatar.gif")'), /data-anim="1"/);
  assert.match(h.run('renderAvatarInner("Ana", "/api/attachments/abc/avatar.webp")'), /loading="lazy"/);

  h.run('state.audioSettings = { profileAnimations: undefined }');
  assert.equal(h.run('profileAnimPolicy()'), 'hover', 'padrão');
  h.run('state.audioSettings.profileAnimations = "always"');
  assert.equal(h.run('profileAnimPolicy()'), 'always');
  h.run('state.audioSettings.reduceMotion = true');
  assert.equal(h.run('profileAnimPolicy()'), 'never', 'Reduzir animações vence');

  h.run('state.audioSettings = { profileAnimations: "hover" }');
  d.body.insertAdjacentHTML('beforeend', '<div class="member-item"><div class="avatar"><img id="m" data-anim="1"></div></div><div class="profile-card"><div class="avatar"><img id="p" data-anim="1"></div></div>');
  assert.equal(h.run('mediaShouldAnimate(document.getElementById("m"))'), false, 'lista: parado');
  assert.equal(h.run('mediaShouldAnimate(document.getElementById("p"))'), true, 'perfil aberto: anima');
  h.run('syncMediaAnimation(document.getElementById("m"))');
  assert.equal(d.getElementById('m').classList.contains('anim-paused'), true);
});

test('rascunho de mídia: prévia imediata, envio só ao salvar e remoção', async t => {
  const h = await setup(t);
  h.run(`
    globalThis.__uploads = [];
    uploadProfileImage = async (blob, name) => { __uploads.push(name); return '${'b'.repeat(32)}'; };
    refreshLiveProfilePreview = () => {};
  `);
  h.run('setPendingProfileMedia("avatar", { blob: new Blob(["x"]), name: "avatar.webp", animated: false })');
  h.run('setPendingProfileMedia("banner", "remove")');
  assert.equal(h.run('draftPreviewUser().avatar_url'), 'blob:teste-1', 'prévia usa o rascunho');
  assert.equal(h.run('draftPreviewUser().banner_url'), null, 'banner removido no rascunho');
  assert.equal(h.run('__sent.length'), 0, 'nada vai ao servidor antes de salvar');
  assert.equal(await h.run('flushPendingProfileMedia()'), true);
  assert.equal(h.run('JSON.stringify(__sent)'), JSON.stringify([
    ['SetProfileMedia', { kind: 'avatar', attachment_id: 'b'.repeat(32) }],
    ['SetProfileMedia', { kind: 'banner' }],
  ]));
  assert.equal(h.run('Object.keys(profileDraft.media).length'), 0);
  // Remover algo que não existe não cria pendência.
  h.run('state.selfUser.avatar_url = null; setPendingProfileMedia("avatar", "remove")');
  assert.equal(h.run('Object.keys(profileDraft.media).length'), 0);
});

test('recorte: faixa para banner e círculo para avatar', async t => {
  const h = await setup(t);
  h.run('cropEditor.mode = "banner"');
  assert.equal(h.run('JSON.stringify(cropFrame())'), JSON.stringify({ w: 340, h: 136, outW: 1200, outH: 480 }));
  h.run('cropEditor.mode = "avatar"');
  assert.equal(h.run('cropFrame().w === cropFrame().h'), true);
});

test('catálogo: posse vinda do servidor e prévia em contextos', async t => {
  const h = await setup(t), d = h.document;
  assert.equal(h.run('ownsCosmetic("avatar_decoration", "qualquer")'), true, 'antes do catálogo não esconde nada');
  h.run('onCosmeticsState({ catalog: [{ id: "flame-violet", kind: "avatar_decoration", name: "Chama" }], owned: ["avatar_decoration:flame-violet"] })');
  assert.equal(h.run('ownsCosmetic("avatar_decoration", "flame-violet")'), true);
  assert.equal(h.run('ownsCosmetic("avatar_decoration", "outra")'), false);
  assert.equal(h.run('ownsCosmetic("avatar_decoration", "none")'), true);

  h.run('refreshLiveProfilePreview = () => {}');
  d.querySelector('[data-profile-context="chat"]').click();
  const host = d.getElementById('profile-context-preview');
  assert.equal(host.classList.contains('hidden'), false);
  assert.equal(d.getElementById('live-profile-preview-card').classList.contains('hidden'), true);
  assert.match(host.textContent, /Ana/);
  d.querySelector('[data-profile-context="popout"]').click();
  assert.equal(host.classList.contains('hidden'), true);
});
