const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('HTML completo carrega scripts na ordem real e preserva marca, badges e reações', async t => {
  const h = await openInterface(t), d = h.document;
  assert.deepEqual(h.captures, []);
  assert.ok(d.querySelector('#nav-home-btn svg[aria-label="Sancord"]'));
  assert.equal(d.querySelectorAll('button:not(#nav-home-btn) svg:not([data-sancord-icon])').length, 0);
  assert.ok(d.querySelector('#pinned-msgs-btn').contains(d.getElementById('pinned-count-badge')));
  assert.ok(d.querySelector('#server-menu-btn .server-menu-caret[data-sancord-icon="chevron"]'));
  const reaction = d.querySelector('[data-ctx-react="👍"]');
  assert.equal(reaction.textContent, '👍');
  assert.equal(reaction.querySelector('svg'), null);
});

test('decoração de controles dinâmicos preserva classes, listeners e emojis de conteúdo', async t => {
  const h = await openInterface(t), d = h.document;
  const button = d.createElement('button');
  button.className = 'channel-edit-btn'; button.innerHTML = '<svg class="local-control"></svg>';
  let clicks = 0; button.addEventListener('click', () => clicks++);
  const emoji = d.createElement('button'); emoji.className = 'emoji-choice-btn'; emoji.textContent = '⭐';
  d.body.append(button, emoji); await h.flush();
  assert.ok(button.querySelector('svg.local-control[data-sancord-icon="settings"]'));
  button.click(); assert.equal(clicks, 1);
  assert.equal(emoji.textContent, '⭐'); assert.equal(emoji.querySelector('svg'), null);
});

test('settings trocam os quatro temas e abrir Voz não solicita captura', async t => {
  const h = await openInterface(t), d = h.document;
  d.getElementById('open-settings-btn').click();
  assert.equal(d.getElementById('settings-modal').classList.contains('hidden'), false);
  d.querySelector('[data-settings-tab="appearance"]').click();
  for (const theme of ['light', 'dark', 'ash', 'oled']) {
    d.querySelector(`[data-app-theme="${theme}"]`).click();
    assert.equal(d.body.dataset.theme, theme);
  }
  d.querySelector('[data-settings-tab="voice"]').click();
  assert.equal(d.getElementById('settings-tab-voice').classList.contains('hidden'), false);
  assert.deepEqual(h.captures, []);
});

test('tooltip de controle com role=button funciona após sair, voltar e focar', async t => {
  const h = await openInterface(t), d = h.document;
  const control = d.createElement('div'); control.setAttribute('role', 'button');
  control.tabIndex = 0; control.title = 'Ajuda do controle'; d.body.appendChild(control);
  for (let i = 0; i < 2; i++) {
    control.dispatchEvent(new h.w.Event('pointerover', { bubbles: true }));
    assert.ok(d.querySelector('.sancord-tooltip.visible'));
    control.dispatchEvent(new h.w.Event('pointerout', { bubbles: true }));
    assert.equal(d.querySelector('.sancord-tooltip.visible'), null);
  }
  control.focus(); assert.equal(d.querySelector('.sancord-tooltip.visible').textContent, 'Ajuda do controle');
  assert.equal(control.getAttribute('aria-label'), 'Ajuda do controle');
});

test('confirmação recebe foco, contém Tab/Shift+Tab e Escape devolve foco sem confirmar', async t => {
  const h = await openInterface(t), d = h.document;
  const origin = d.getElementById('open-settings-btn'); origin.focus();
  const result = h.run('SancordUI.confirm({title:"Confirmar",message:"Sem operação remota",confirmLabel:"Excluir",danger:true})');
  await h.flush();
  const dialog = d.querySelector('.sancord-dialog');
  const cancel = dialog.querySelector('button[type="button"]'), submit = dialog.querySelector('button[type="submit"]');
  assert.equal(d.activeElement, cancel, 'confirmação destrutiva inicia em Cancelar');
  cancel.dispatchEvent(new h.w.KeyboardEvent('keydown', { key:'Tab', shiftKey:true, bubbles:true, cancelable:true }));
  assert.equal(d.activeElement, submit);
  submit.dispatchEvent(new h.w.KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true }));
  assert.equal(d.activeElement, cancel);
  cancel.dispatchEvent(new h.w.KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
  assert.equal(await result, false); assert.equal(d.querySelector('.sancord-dialog'), null);
  assert.equal(d.activeElement, origin);
});

test('janela estreita recolhe membros para painel flutuante e perfis preservam cores do tema', async t => {
  const h = await openInterface(t), d = h.document;
  const layout = d.getElementById('app-layout'), toggle = d.getElementById('toggle-members-btn');
  h.run('state.activeView = "server"; appLayout.classList.remove("hide-members"); toggleMembersBtn.classList.add("active");');
  h.run('NARROW_QUERY.matches = true; syncNarrowLayout();');
  assert.equal(d.body.classList.contains('narrow-window'), true);
  assert.equal(layout.classList.contains('hide-members'), true);
  toggle.click();
  assert.equal(layout.classList.contains('force-members'), true);
  d.getElementById('chat-messages').dispatchEvent(new h.w.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(layout.classList.contains('force-members'), false);
  assert.equal(layout.classList.contains('hide-members'), true);
  h.run('NARROW_QUERY.matches = false; syncNarrowLayout();');
  assert.equal(d.body.classList.contains('narrow-window'), false);
  assert.equal(layout.classList.contains('hide-members'), false);

  h.run('state.selfUser = { id: "u1", username: "VozQA_A", avatar_color: "#5865f2", name_color: null }; updateSelfProfileUI();');
  assert.equal(d.getElementById('self-username').style.color, '');
  h.run('openMemberProfilePopover(null, { author_name: "VozQA_B", author_color: "#5865f2" });');
  assert.equal(d.getElementById('profile-popover-modal').classList.contains('hidden'), false);
  assert.equal(d.getElementById('profile-card-name').textContent, 'VozQA_B');
  assert.equal(d.getElementById('profile-card-name').style.color, '');
});

test('perfil offline recebe mídia e moldura do servidor e só mostra amigos em comum confirmados', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`
    state.activeView = "server";
    state.activeServerId = "teste";
    state.servers = [{ id: "teste", member_nicks: { bia: "Apelido no servidor" } }];
    state.friends = [{ username: "Ana", online: true }];
    state.ws = { readyState: WebSocket.OPEN, send() {} };
    sendWs = () => true;
    openMemberProfilePopover(null, { author_name: "Bia" });
  `);
  const mutual = d.getElementById('profile-mutual-friends-list');
  assert.equal(mutual.textContent, 'Carregando…');
  h.run(`onUserProfile({ user: {
    username: "Bia", display_name: "Nome global", pronouns: "ela", online: false,
    status_kind: "invisible", bio: "**Descrição**", avatar_color: "#123456",
    avatar_url: "/api/attachments/id/avatar.webp", banner_url: "/api/attachments/id/banner.webp",
    profile_frame: "core-pulse", badges: ["early_user"]
  }, server_id: "teste", mutual_friends: [], mutual_servers: [] });`);
  assert.equal(d.getElementById('profile-card-name').textContent, 'Apelido no servidor');
  assert.equal(d.getElementById('profile-card-handle').textContent, '@bia');
  assert.equal(d.getElementById('profile-card-pronouns').textContent, 'ela');
  assert.equal(d.querySelector('#profile-card-bio strong').textContent, 'Descrição');
  assert.match(d.querySelector('#profile-card-avatar img').src, /avatar\.webp$/);
  assert.match(d.querySelector('#profile-card-banner img').src, /banner\.webp$/);
  assert.ok(d.querySelector('#profile-popover-card.pf-core-pulse > .pf-layer'));
  assert.ok(d.querySelector('#profile-card-badges [data-badge="early_user"]'));
  assert.equal(mutual.textContent, 'Nenhum amigo em comum.');
});
