// Testes do Self Profile Menu (painel do próprio usuário no canto inferior esquerdo).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    globalThis.__sent = [];
    sendWs = (type, payload) => { __sent.push([type, payload]); return true; };
    state.selfUser = {
      id: 'user-swag-001',
      username: 'Swag',
      display_name: 'Swag',
      avatar_color: '#e74c3c',
      status_kind: 'idle',
      custom_status: null,
      avatar_decoration: 'flame-violet',
      profile_frame: 'core-pulse',
      profile_effect: 'embers',
      badges: ['founder', 'developer'],
    };
    state.cosmetics = {
      loaded: true,
      catalog: [],
      owned: new Set(['avatar_decoration:flame-violet', 'profile_frame:core-pulse']),
      badges: [
        { id: 'founder', name: 'Fundador', description: 'Criador do Sancord', category: 'trust' },
        { id: 'developer', name: 'Desenvolvedor', description: 'Contribui para o app', category: 'trust' },
      ],
    };
    state.servers = [{
      id: 'srv-1',
      name: 'Só tristeza',
      owner_username: 'swag',
      members: ['swag'],
      roles: [{ id: 'everyone', name: '@everyone', position: 0, hoist: false, permissions: { view_channel: true, send_messages: true } }],
      member_roles: {},
      text_channels: [{ id: 'c1', name: 'geral', kind: 'text' }],
      voice_channels: [],
      categories: [],
    }];
    state.activeServerId = 'srv-1';
    state.activeView = 'server';
    state.users = new Map([['user-swag-001', state.selfUser]]);
    state.audioSettings.developerMode = false;
    updateSelfProfileUI();
    renderMembersSidebar();
  `);
  return h;
}

test('clicar avatar/nome abre e fecha Self Profile Menu sem abrir Configurações; clique fora e Esc fecham', async t => {
  const h = await setup(t);
  const d = h.document;
  const trigger = d.getElementById('self-profile-trigger');
  const avatar = d.getElementById('self-avatar');
  const settingsModal = d.getElementById('settings-modal');

  // 1) Clicar no avatar abre Self Profile Menu, NÃO abre Configurações nem input de arquivo.
  let fileInputClicked = false;
  d.getElementById('avatar-file-input').addEventListener('click', () => { fileInputClicked = true; });
  avatar.click();
  const menu = d.getElementById('self-profile-menu');
  assert.ok(menu && !menu.classList.contains('hidden'), 'Self Profile Menu deve abrir ao clicar no avatar');
  assert.equal(menu.dataset.profileRenderContext, 'SELF_PROFILE_MENU');
  assert.equal(settingsModal.classList.contains('hidden'), true, 'Configurações NÃO deve abrir ao clicar no avatar');
  assert.equal(fileInputClicked, false, 'File picker NÃO deve abrir ao clicar no avatar do dock');

  // 2) Clicar novamente no trigger fecha o menu.
  trigger.click();
  assert.equal(menu.classList.contains('hidden'), true);

  // 3) Reabrir e clicar fora fecha o menu.
  trigger.click();
  assert.equal(menu.classList.contains('hidden'), false);
  d.body.dispatchEvent(new h.w.Event('pointerdown', { bubbles: true }));
  assert.equal(menu.classList.contains('hidden'), true);

  // 4) Reabrir e pressionar Escape fecha o menu.
  trigger.click();
  assert.equal(menu.classList.contains('hidden'), false);
  h.w.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.classList.contains('hidden'), true);
});

test('Editar perfil abre Perfis; Status abre submenu e atualiza realtime; Engrenagem, Mute e Deafen permanecem independentes', async t => {
  const h = await setup(t);
  const d = h.document;
  const trigger = d.getElementById('self-profile-trigger');

  // Mute e Deafen NÃO abrem o Self Profile Menu.
  d.getElementById('toggle-mute-btn').click();
  assert.equal(h.run('SancordSelfProfileMenu.isOpen()'), false);
  d.getElementById('toggle-deafen-btn').click();
  assert.equal(h.run('SancordSelfProfileMenu.isOpen()'), false);

  // Engrenagem abre Configurações (Minha Conta), não o Self Profile Menu.
  d.getElementById('open-settings-btn').click();
  assert.equal(d.getElementById('settings-modal').classList.contains('hidden'), false);
  assert.equal(h.run('SancordSelfProfileMenu.isOpen()'), false);
  h.run('closeSettingsModal()');

  // Abrir Self Profile Menu -> abrir submenu de Status -> passar o mouse em item do submenu NÃO fecha o submenu.
  trigger.click();
  const statusTrigger = d.getElementById('spm-status-trigger');
  assert.ok(statusTrigger);
  statusTrigger.click();
  const submenu = d.getElementById('self-profile-submenu');
  assert.equal(submenu.classList.contains('hidden'), false);
  const customBtn = d.getElementById('spm-set-custom-status');
  assert.ok(customBtn);
  customBtn.dispatchEvent(new h.w.Event('pointerenter', { bubbles: true }));
  assert.equal(submenu.classList.contains('hidden'), false, 'Passar o mouse em item do submenu não pode fechar o submenu');
  const dndBtn = submenu.querySelector('[data-status-option="dnd"]');
  assert.ok(dndBtn);
  dndBtn.click();

  // Enviou UpdateProfile com status_kind = dnd e atualizou dock + member list em realtime.
  const lastSent = JSON.parse(h.run('JSON.stringify(__sent[__sent.length - 1])'));
  assert.deepEqual(lastSent, ['UpdateProfile', { status_kind: 'dnd' }]);
  assert.equal(h.run('state.selfUser.status_kind'), 'dnd');
  assert.ok(d.getElementById('self-status-dot').classList.contains('dnd'));
  assert.equal(d.querySelector('[data-member-username="swag"]').dataset.memberStatus, 'dnd');
  assert.equal(h.run('SancordSelfProfileMenu.isOpen()'), false);

  // Reabrir e clicar "Editar perfil" -> abre Configurações na aba Perfis.
  trigger.click();
  d.getElementById('spm-edit-profile').click();
  assert.equal(h.run('SancordSelfProfileMenu.isOpen()'), false);
  assert.equal(d.getElementById('settings-modal').classList.contains('hidden'), false);
  assert.equal(d.getElementById('settings-tab-profile').classList.contains('hidden'), false);
});

test('Developer Mode controla Copiar ID; Insígnias respeita badges reais; sem botões mortos e seletor multi-conta isolado', async t => {
  const h = await setup(t);
  const d = h.document;
  const trigger = d.getElementById('self-profile-trigger');

  // Developer Mode OFF -> Copiar ID oculto; Insígnias visível (conta possui 2); sem Clipes/Orbs.
  trigger.click();
  assert.equal(d.getElementById('spm-copy-id'), null);
  assert.ok(d.getElementById('spm-badges-trigger'));
  const menuText = d.getElementById('self-profile-menu').textContent;
  assert.ok(!/Clipes|Orbs|Nitro/i.test(menuText), 'Não deve exibir botões mortos ou comerciais');

  // Submenu Insígnias lista apenas badges reais da conta.
  d.getElementById('spm-badges-trigger').click();
  const badgeLabels = [...d.querySelectorAll('#self-profile-submenu .spm-badge-item .spm-row-label')].map(el => el.textContent);
  assert.deepEqual(badgeLabels, ['Fundador', 'Desenvolvedor']);

  // Sem badges na conta -> linha Insígnias desaparece.
  h.run('state.selfUser.badges = []; state.audioSettings.developerMode = true; SancordSelfProfileMenu.refreshIfOpen()');
  assert.equal(d.getElementById('spm-badges-trigger'), null);

  // Developer Mode ON -> Copiar ID aparece e copia o ID real.
  const copyBtn = d.getElementById('spm-copy-id');
  assert.ok(copyBtn, 'Copiar ID deve aparecer quando Modo Desenvolvedor = ON');
  h.run('globalThis.__copied = null; copyTextSafe = async (txt) => { __copied = txt; }');
  copyBtn.click();
  assert.equal(h.run('__copied'), 'user-swag-001');

  // Seletor multi-conta: registra 2 contas isoladas e lista no submenu Mudar de conta.
  h.run(`
    SancordSelfProfileMenu.registerSavedAccount({ id: 'user-swag-001', username: 'Swag', display_name: 'Swag', token: 'tok-swag', remember: true });
    SancordSelfProfileMenu.registerSavedAccount({ id: 'user-gab-002', username: 'Gabriel', display_name: 'Gabriel', token: 'tok-gab', remember: true });
    SancordSelfProfileMenu.open();
  `);
  d.getElementById('spm-accounts-trigger').click();
  const accLabels = [...d.querySelectorAll('#self-profile-submenu .spm-account-row .spm-row-label')].map(el => el.textContent);
  assert.deepEqual(accLabels, ['Swag', 'Gabriel']);
  assert.ok(d.getElementById('spm-add-account'));
  assert.ok(d.getElementById('spm-logout-all'));
});
