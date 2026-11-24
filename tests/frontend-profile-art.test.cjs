const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('cartão e editor preservam as camadas, a mídia e o efeito durante mudanças de texto', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`state.selfUser = {username:'Mika', display_name:'Mika Solar', bio:'Perfil de teste',
    avatar_url:'/api/attachments/mika/avatar.png', avatar_decoration:'core-orbit', profile_frame:'core-pulse', profile_effect:'core-signal'};
    globalThis.packets = [];
    sendWs = (type, payload) => { packets.push({type, payload}); return true; };
    openSettingsModal('profile');`);
  // A prévia principal é o perfil completo (o mesmo cartão que os visitantes abrem).
  const preview = d.getElementById('live-profile-preview-card');
  const slot = id => d.getElementById(id);
  const changes = () => h.run('packets.filter(p => !p.type.startsWith("Get")).length');
  assert.ok(preview.classList.contains('profile-modal-2col'));
  assert.equal(h.run('profileThemeBackground(draftPreviewUser())'), null, 'perfil sem tema herda a aparência do app');
  assert.equal(h.run('isProfileDraftDirty()'), false);
  const image = slot('preview-card-avatar').querySelector('img');
  assert.ok(image);
  assert.ok(slot('preview-deco-wrap').querySelector('.avatar-art-back + #preview-card-avatar'));
  assert.ok(slot('preview-deco-wrap').querySelector('.avatar-art-front'));
  assert.ok(preview.querySelector('.cos-v5-frame'));
  assert.ok(preview.querySelectorAll('.frame-v5-orn').length >= 3);
  d.getElementById('profile-preview-replay').click();
  assert.ok(slot('preview-effect-layer').classList.contains('is-playing'));
  d.querySelector('[data-pe-open="about"]').click();
  const name = d.getElementById('settings-display-name');
  name.value = 'Mika Aurora';
  name.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.equal(slot('preview-card-name').textContent, 'Mika Aurora');
  assert.equal(slot('preview-card-avatar').querySelector('img'), image);
  assert.ok(slot('preview-effect-layer').classList.contains('is-playing'));
  assert.equal(changes(), 0);
  assert.equal(slot('pe-add-pronouns').classList.contains('hidden'), false, 'convite para adicionar pronomes só no editor');
  const pronouns = d.getElementById('settings-pronouns');
  pronouns.value = 'ela/dela';
  pronouns.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.equal(slot('preview-card-handle').textContent, '@mika');
  assert.equal(slot('preview-card-pronouns').textContent, 'ela/dela');
  assert.equal(slot('pe-add-pronouns').classList.contains('hidden'), true);
  assert.equal(d.getElementById('unsaved-profile-bar').classList.contains('hidden'), false);
  d.getElementById('pe-context-toggle').click();
  const theme = d.getElementById('profile-preview-theme');
  theme.value = 'light';
  theme.dispatchEvent(new h.w.Event('change'));
  assert.equal(d.querySelector('#profile-context-preview .profile-card').closest('[data-preview-theme]').dataset.previewTheme, 'light');
  h.run('state.audioSettings.reduceMotion = true; applyProfileAnimPolicy(); closeSettingsModal();');
  assert.ok(d.getElementById('profile-preview-replay').disabled);
  assert.equal(slot('preview-effect-layer').classList.contains('is-playing'), false);
  d.querySelector('.sancord-dialog .modal-actions-row .btn-secondary').click();
  await h.flush();
  assert.equal(name.value, 'Mika Aurora');
  h.run('closeSettingsModal();');
  d.querySelector('.sancord-dialog form').dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  await h.flush();
  assert.equal(name.value, 'Mika Solar');
  assert.equal(changes(), 0);
});

test('prévia por servidor compara herança e reage a um rascunho sem enviar alterações', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`state.selfUser = {username:'Mika', display_name:'Mika Solar', bio:'Bio global'};
    state.servers = [{id:'s1', name:'Estação', member_nicks:{mika:'Mika local'}, member_profiles:{mika:{bio:'Bio local'}}}];
    globalThis.packets = [];
    sendWs = (type, payload) => { packets.push({type, payload}); return true; };
    openSettingsModal('profile');`);
  d.querySelector('[data-profile-subtab="server"]').click();
  const preview = d.getElementById('settings-server-profile-preview');
  assert.match(preview.textContent, /Mika local.*Bio local/s);
  d.getElementById('settings-server-profile-compare').click();
  assert.match(preview.textContent, /Mika Solar.*Bio global/s);
  d.getElementById('settings-server-profile-edit-btn').click();
  const form = d.querySelector('.sancord-dialog form');
  const bio = form.querySelector('textarea');
  const card = d.querySelector('.server-profile-dialog-preview');
  assert.match(card.textContent, /Bio local/);
  bio.value = '';
  bio.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.match(card.textContent, /Bio global/);
  bio.value = 'Alteração local';
  bio.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.match(card.textContent, /Alteração local/);
  assert.equal(h.run('packets.filter(p => !p.type.startsWith("Get")).length'), 0);
  form.dispatchEvent(new h.w.Event('submit', { cancelable: true }));
  await h.flush();
  assert.equal(h.run('packets.at(-1).type'), 'SetServerProfile');
  assert.equal(h.run('packets.at(-1).payload.bio'), 'Alteração local');
});

test('clicar em Avatar abre subeditor com 12 avatares predefinidos e mantém opção de enviar imagem', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`state.selfUser = {username:'Swag', display_name:'Swag', avatar_color:'#6366f1', avatar_url:null};
    openSettingsModal('profile');`);

  let fileInputClicked = 0;
  d.getElementById('avatar-file-input').addEventListener('click', () => { fileInputClicked++; });

  // 1) Clicar no tile Avatar abre data-pe-view="avatar", NÃO abre o seletor de arquivos diretamente.
  d.getElementById('settings-change-avatar-btn').click();
  assert.equal(fileInputClicked, 0, 'Clicar em Avatar não deve abrir input de arquivo diretamente');
  const avatarView = d.querySelector('[data-pe-view="avatar"]');
  assert.equal(avatarView.classList.contains('hidden'), false, 'Subeditor de Avatar deve abrir');

  // 2) Renderiza 1 opção "Iniciais" + 12 avatares predefinidos pintados V5.
  const choices = [...d.querySelectorAll('#pe-preset-avatars-grid .pe-preset-avatar-choice')];
  assert.equal(choices.length, 13);
  assert.equal(choices[0].dataset.presetAvatar, 'initials');
  assert.equal(choices[0].classList.contains('selected'), true);

  // 3) Selecionar um avatar predefinido atualiza a prévia ao vivo imediatamente e marca rascunho sujo.
  const kitsuneChoice = d.querySelector('#pe-preset-avatars-grid [data-preset-avatar="kitsune"]');
  assert.ok(kitsuneChoice);
  kitsuneChoice.click();
  assert.ok(d.querySelector('#preview-card-avatar img')?.getAttribute('src')?.includes('preset_avatar_kitsune.webp'));
  assert.ok(d.querySelector('#settings-avatar-preview img')?.getAttribute('src')?.includes('preset_avatar_kitsune.webp'));
  assert.ok(d.querySelector('#pe-avatar-sub-preview img')?.getAttribute('src')?.includes('preset_avatar_kitsune.webp'));
  assert.equal(h.run('isProfileDraftDirty()'), true);
  assert.equal(d.getElementById('unsaved-profile-bar').classList.contains('hidden'), false);

  // 4) Clicar em "Enviar uma imagem" dentro do subeditor aciona o seletor de arquivo (#avatar-file-input).
  d.getElementById('pe-upload-avatar-btn').click();
  assert.equal(fileInputClicked, 1, 'Botão Enviar uma imagem deve acionar #avatar-file-input');

  // 5) Clicar em "Usar iniciais" volta para as iniciais da conta.
  d.getElementById('pe-avatar-remove-btn').click();
  assert.equal(d.querySelector('#preview-card-avatar img'), null);
  assert.equal(d.getElementById('preview-card-avatar').textContent.trim(), 'SW');
});
