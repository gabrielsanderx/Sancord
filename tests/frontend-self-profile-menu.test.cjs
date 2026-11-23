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

test('Developer Mode controla Copiar ID; sem Insígnias/Coleção/Clipes nas ações; badges visíveis no cabeçalho; multi-conta isolado', async t => {
  const h = await setup(t);
  const d = h.document;
  const trigger = d.getElementById('self-profile-trigger');

  // Developer Mode OFF -> Copiar ID oculto; 2 cards compactos; sem Insígnias/Coleção/Clipes como botão; badges visíveis no topo.
  trigger.click();
  const menu = d.getElementById('self-profile-menu');
  assert.equal(d.getElementById('spm-copy-id'), null);
  assert.equal(d.getElementById('spm-badges-trigger'), null, 'Insígnias NÃO deve mais ser botão do Self Profile Menu');
  assert.equal(d.getElementById('spm-collection-trigger'), null, 'Minha coleção NÃO deve mais ser botão do Self Profile Menu');
  assert.equal(menu.querySelectorAll('.spm-card').length, 2, 'Deve organizar ações em 2 cards compactos');
  const menuText = menu.textContent;
  assert.ok(!/Clipes|Orbs|Nitro|Minha coleção|Em breve/i.test(menuText), 'Não deve exibir botões removidos, mortos ou comerciais');

  // Badges continuam visíveis visualmente no cabeçalho do perfil com tooltip.
  const headerBadges = [...menu.querySelectorAll('.spm-badges .profile-badge')].map(el => el.dataset.badge);
  assert.deepEqual(headerBadges, ['founder', 'developer']);
  assert.equal(menu.querySelector('.spm-badges').classList.contains('hidden'), false);
  assert.equal(menu.classList.contains('has-frame'), true, 'Profile Frame real equipada deve ser aplicada');

  // Sem badges e sem frame -> container de badges some e classe has-frame é removida.
  h.run('state.selfUser.badges = []; state.selfUser.profile_frame = null; state.audioSettings.developerMode = true; SancordSelfProfileMenu.refreshIfOpen()');
  assert.equal(menu.querySelector('.spm-badges').classList.contains('hidden'), true);
  assert.equal(menu.classList.contains('has-frame'), false, 'Sem moldura equipada não deve renderizar moldura artificial');

  // Developer Mode ON -> Copiar ID aparece no card 2 e copia o ID real.
  const copyBtn = d.getElementById('spm-copy-id');
  assert.ok(copyBtn, 'Copiar ID deve aparecer quando Modo Desenvolvedor = ON');
  h.run('globalThis.__copied = null; copyTextSafe = async (txt) => { __copied = txt; }');
  copyBtn.click();
  assert.equal(h.run('__copied'), 'user-swag-001');

  // Com apenas 1 conta salva, Mudar de conta não exibe contador; com 2 contas, exibe contador e lista ambas.
  h.run(`
    SancordSelfProfileMenu.clearAllSavedAccounts();
    SancordSelfProfileMenu.registerSavedAccount({ id: 'user-swag-001', username: 'Swag', display_name: 'Swag', token: 'tok-swag', remember: true });
    SancordSelfProfileMenu.open();
  `);
  assert.equal(d.querySelector('#spm-accounts-trigger .spm-row-meta'), null);

  h.run(`
    SancordSelfProfileMenu.registerSavedAccount({ id: 'user-gab-002', username: 'Gabriel', display_name: 'Gabriel', token: 'tok-gab', remember: true });
    SancordSelfProfileMenu.refreshIfOpen();
  `);
  assert.equal(d.querySelector('#spm-accounts-trigger .spm-row-meta')?.textContent, '2');
  d.getElementById('spm-accounts-trigger').click();
  const accLabels = [...d.querySelectorAll('#self-profile-submenu .spm-account-row .spm-row-label')].map(el => el.textContent);
  assert.deepEqual(accLabels, ['Swag', 'Gabriel']);
  assert.ok(d.getElementById('spm-add-account'));
  assert.ok(d.getElementById('spm-logout-all'));
});

test('Editar perfil -> Insígnias: mostra apenas badges possuídas, permite ocultar, reordenar, cancelar, salvar, respeita limite e can_hide', async t => {
  const h = await setup(t);
  const d = h.document;

  // Carrega CosmeticsState realista com 4 badges possuídas (1 obrigatória verified_bot) de um catálogo maior.
  h.run(`
    onCosmeticsState({
      catalog: [],
      owned: [],
      badges: [
        { id: 'founder', name: 'Fundação', description: 'Fundou o Sancord.', category: 'trust', can_hide: true },
        { id: 'developer', name: 'Desenvolvimento', description: 'Equipe dev.', category: 'trust', can_hide: true },
        { id: 'verified_bot', name: 'Bot verificado', description: 'Integração verificada.', category: 'trust', can_hide: false },
        { id: 'early_user', name: 'Pioneira', description: 'Fase inicial.', category: 'cosmetic', can_hide: true },
        { id: 'event_winner', name: 'Vencedora', description: 'NÃO possuída.', category: 'trust', can_hide: true },
      ],
      owned_badges: ['founder', 'developer', 'verified_bot', 'early_user'],
      badge_order: [],
      hidden_badges: [],
      max_visible_badges: 6,
      collection: { favorites: [], presets: [], seen: [] },
    });
    openSettingsModal('profile');
  `);

  // Na tela inicial do editor, Insígnias fica recolhida em um card resumo (não lista tudo na coluna principal).
  const openBadgesBtn = d.getElementById('open-badges-editor-btn');
  assert.ok(openBadgesBtn);
  assert.equal(d.querySelector('[data-pe-view="badges"]').classList.contains('hidden'), true);

  // Abre o subeditor de Insígnias.
  openBadgesBtn.click();
  assert.equal(d.querySelector('[data-pe-view="badges"]').classList.contains('hidden'), false);
  const listedIds = [...d.querySelectorAll('#pe-badges-editor .pe-badge-row')].map(el => el.dataset.badgeId);
  assert.deepEqual(listedIds, ['founder', 'developer', 'verified_bot', 'early_user'], 'Nunca deve listar badge não possuída (event_winner)');

  // Badge obrigatória (can_hide: false) tem checkbox desabilitado.
  const botCheckbox = d.querySelector('#pe-badges-editor [data-badge-id="verified_bot"] .pe-badge-checkbox');
  assert.equal(botCheckbox.checked, true);
  assert.equal(botCheckbox.disabled, true);

  // Ocultar 'developer' e mover 'early_user' para cima atualiza prévia ao vivo imediatamente.
  const devCheckbox = d.querySelector('#pe-badges-editor [data-badge-id="developer"] .pe-badge-checkbox');
  devCheckbox.checked = false;
  devCheckbox.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  d.querySelector('#pe-badges-editor [data-badge-id="early_user"] [data-badge-move="up"]').click();

  const livePreviewIds = [...d.querySelectorAll('#preview-card-badges .profile-badge')].map(el => el.dataset.badge);
  assert.deepEqual(livePreviewIds, ['founder', 'early_user', 'verified_bot']);

  // Cancelar no subeditor descarta as alterações locais e restaura prévia.
  const cancelSubBtn = [...d.querySelectorAll('[data-pe-view="badges"] .pe-chooser-actions button')].find(b => b.textContent === 'Cancelar');
  cancelSubBtn.click();
  const restoredPreviewIds = [...d.querySelectorAll('#preview-card-badges .profile-badge')].map(el => el.dataset.badge);
  assert.deepEqual(restoredPreviewIds, ['founder', 'developer', 'verified_bot', 'early_user']);

  // Reabre, faz alterações, clica Aplicar e depois Salvar alterações -> envia UpdateProfile com badge_order e hidden_badges.
  openBadgesBtn.click();
  d.querySelector('#pe-badges-editor [data-badge-id="developer"] .pe-badge-checkbox').click();
  d.querySelector('#pe-badges-editor [data-badge-id="early_user"] [data-badge-move="up"]').click();
  const applySubBtn = [...d.querySelectorAll('[data-pe-view="badges"] .pe-chooser-actions button')].find(b => b.textContent === 'Aplicar');
  applySubBtn.click();
  assert.equal(d.getElementById('unsaved-profile-bar').classList.contains('hidden'), false);

  d.getElementById('save-profile-btn').click();
  await new Promise(r => setTimeout(r, 10));
  const sent = JSON.parse(h.run('JSON.stringify(__sent[__sent.length - 1])'));
  assert.equal(sent[0], 'UpdateProfile');
  assert.deepEqual(sent[1].hidden_badges, ['developer']);
  assert.deepEqual(sent[1].badge_order, ['founder', 'developer', 'early_user', 'verified_bot']);
  assert.deepEqual(Array.from(h.run('state.selfUser.badges')), ['founder', 'early_user', 'verified_bot']);

  // Self Profile Menu reflete imediatamente as badges atualizadas.
  h.run('closeSettingsModal(); SancordSelfProfileMenu.open()');
  const spmBadges = [...d.querySelectorAll('#self-profile-menu .spm-badges .profile-badge')].map(el => el.dataset.badge);
  assert.deepEqual(spmBadges, ['founder', 'early_user', 'verified_bot']);

  // Limite máximo (8 possuídas com max_visible_badges = 6) + estado vazio (0 possuídas).
  h.run(`
    onCosmeticsState({
      catalog: [],
      owned: [],
      badges: [
        { id: 'founder', name: 'Fundação', description: 'd', category: 'trust', can_hide: true },
        { id: 'developer', name: 'Dev', description: 'd', category: 'trust', can_hide: true },
        { id: 'moderator', name: 'Mod', description: 'd', category: 'trust', can_hide: true },
        { id: 'contributor', name: 'Contrib', description: 'd', category: 'trust', can_hide: true },
        { id: 'bug_hunter', name: 'Bugs', description: 'd', category: 'trust', can_hide: true },
        { id: 'event_winner', name: 'Evento', description: 'd', category: 'trust', can_hide: true },
        { id: 'early_user', name: 'Pioneira', description: 'd', category: 'cosmetic', can_hide: true },
        { id: 'alpha', name: 'Alpha', description: 'd', category: 'cosmetic', can_hide: true },
      ],
      owned_badges: ['founder', 'developer', 'moderator', 'contributor', 'bug_hunter', 'event_winner', 'early_user', 'alpha'],
      badge_order: [],
      hidden_badges: [],
      max_visible_badges: 6,
      collection: { favorites: [], presets: [], seen: [] },
    });
    openSettingsModal('profile');
    openPeView('badges');
  `);
  assert.equal(d.querySelectorAll('#preview-card-badges .profile-badge').length, 6, 'Limite máximo de 6 badges visíveis');
  assert.equal(d.querySelectorAll('#pe-badges-editor .pe-badge-row.is-capped').length, 2, 'Excedentes marcados como fora do limite');

  // Estado vazio (0 badges possuídas).
  h.run(`
    onCosmeticsState({
      catalog: [],
      owned: [],
      badges: [],
      owned_badges: [],
      badge_order: [],
      hidden_badges: [],
      max_visible_badges: 6,
      collection: { favorites: [], presets: [], seen: [] },
    });
  `);
  assert.ok(d.querySelector('#pe-badges-editor .pe-badges-empty'), 'Deve mostrar estado vazio limpo quando a conta não possui insígnias');
});
