// Testes completos do DmContextMenu e do ContextMenu reutilizável (SancordUI).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeEnv(stateOverrides = {}) {
  const sent = [];
  const toasts = [];
  const copied = [];
  let confirmed = true;

  const uiKitSrc = fs.readFileSync(path.join(__dirname, '../static/js/ui-kit.js'), 'utf8');
  const dmSrc = fs.readFileSync(path.join(__dirname, '../static/js/dm-context-menu.js'), 'utf8');

  const state = {
    selfUser: { id: 'acc-me', username: 'Gabriel' },
    friends: [{ id: 'acc-swag', username: 'Swag', display_name: 'Swag', online: true }],
    blocked: [],
    incomingRequests: [],
    outgoingRequests: [],
    dmConversations: [{ dm_id: 'dm:gabriel__swag', peer: { id: 'acc-swag', username: 'Swag', display_name: 'Swag', online: true } }],
    unreadDms: new Map(),
    ignoredUsers: new Set(),
    chatHistory: { 'dm:gabriel__swag': [{ id: 'm1', content: 'oi' }] },
    prefs: { mutes: {}, notify_levels: {}, pinned_dms: [], favorite_dms: [], user_notes: {} },
    uiSettings: { developerMode: false },
    servers: [
      { id: 's1', name: 'Sancord Dev', owner_username: 'gabriel', members: ['gabriel'], banned_usernames: [], invites_paused: false, effective_permissions: { create_invites: true } },
      { id: 's2', name: 'Sem Permissão', owner_username: 'outro', members: ['gabriel', 'outro'], banned_usernames: [], invites_paused: false, effective_permissions: { create_invites: false } },
      { id: 's3', name: 'Convites Pausados', owner_username: 'gabriel', members: ['gabriel'], banned_usernames: [], invites_paused: true, effective_permissions: { create_invites: true } },
      { id: 's4', name: 'Já Membro', owner_username: 'gabriel', members: ['gabriel', 'swag'], banned_usernames: [], invites_paused: false, effective_permissions: { create_invites: true } },
    ],
    currentVoiceChannel: null,
    activeView: 'home',
    activeDmId: null,
    ...stateOverrides,
  };

  const ctx = vm.createContext({
    console, Date, Number, String, Object, Array, Map, Set, JSON, Promise, Math,
    setTimeout, clearTimeout,
    state,
    window: { innerWidth: 1280, innerHeight: 720, addEventListener: () => {}, removeEventListener: () => {} },
    document: { activeElement: null, addEventListener: () => {}, removeEventListener: () => {} },
    sendWs: (type, payload) => sent.push({ type, payload }),
    showUiToast: (msg) => toasts.push(msg),
    copyTextSafe: (txt) => { copied.push(txt); return Promise.resolve(); },
    getUserProfileNote: (u) => state.prefs.user_notes?.[u.toLowerCase()] || '',
    setUserProfileNote: (u, val) => {
      if (val) state.prefs.user_notes[u.toLowerCase()] = val;
      else delete state.prefs.user_notes[u.toLowerCase()];
    },
    saveModerationLists: () => sent.push({ type: 'UpdateUserPrefs', payload: { ignored_users: [...state.ignoredUsers] } }),
    muteUntil: (id) => (id in (state.prefs.mutes || {}) ? state.prefs.mutes[id] : null),
    muteUntilLabel: (u) => (u === 0 ? 'até reativar' : 'até 12:00'),
    setMute: (id, mins) => sent.push({ type: 'SetMute', payload: { id, mins } }),
    channelNotifyLevel: (id) => state.prefs.notify_levels?.[id] || 'default',
    setChannelNotifyLevel: (id, lvl) => sent.push({ type: 'SetNotify', payload: { id, lvl } }),
    renderDmList: () => {},
    renderChatMessages: () => {},
    updateHomeStarredBadge: () => {},
    refreshUnreadIndicators: () => {},
    switchToHomeFriendsView: () => { state.activeDmId = null; },
    joinVoiceChannel: (id, label) => sent.push({ type: 'JoinVoiceLocal', payload: { id, label } }),
    leaveVoiceChannel: () => sent.push({ type: 'LeaveVoiceLocal' }),
    openMemberProfilePopover: (_id, info) => sent.push({ type: 'OpenProfile', payload: info }),
  });

  vm.runInContext(`${uiKitSrc}\n${dmSrc}\nthis.SancordUI = SancordUI; this.DmContextMenu = DmContextMenu;`, ctx);
  ctx.SancordUI.confirm = async () => confirmed;
  const setConfirm = (v) => { confirmed = v; };
  return { DmContextMenu: ctx.DmContextMenu, SancordUI: ctx.SancordUI, state, sent, toasts, copied, setConfirm };
}

test('estrutura base do DmContextMenu: sem Apps, sem cabeçalho grande e sem bloco fixo de Notificações', () => {
  const { DmContextMenu, state } = makeEnv();
  const items = DmContextMenu.buildItems({ conv: state.dmConversations[0] });
  const labels = items.filter((i) => !i.separator).map((i) => i.label);

  assert.ok(!items.some((i) => i.header), 'não deve ter cabeçalho grande nem seção NOTIFICAÇÕES no menu principal');
  assert.ok(!labels.some((l) => /apps/i.test(l)), 'opção Apps NÃO pode existir');
  assert.equal(items[0].id, 'mark-read');
  assert.equal(items[0].disabled, true, 'DM lida deixa Marcar como lida desabilitado');

  assert.ok(labels.includes('Fixar'));
  assert.ok(labels.includes('Adicionar aos favoritos'));
  assert.ok(labels.includes('Perfil'));
  assert.ok(labels.includes('Iniciar chamada'));
  const noteItem = items.find((i) => i.id === 'note');
  assert.equal(noteItem.label, 'Adicionar nota');
  assert.equal(noteItem.sublabel, 'Visível apenas para você');
  assert.ok(labels.includes('Fechar mensagem direta'));
  assert.ok(labels.includes('Convidar para o servidor'));
  assert.ok(labels.includes('Remover amigo'));
  assert.ok(labels.includes('Ignorar'));
  const blockItem = items.find((i) => i.id === 'block');
  assert.equal(blockItem.danger, true);
  const muteItem = items.find((i) => i.id === 'mute-user');
  assert.equal(muteItem.label, 'Silenciar @Swag');
  assert.ok(muteItem.submenu.some((s) => s.id === 'notify-mentions'), 'notificações organizadas dentro do submenu');
  assert.ok(!items.some((i) => i.id === 'copy-user-id' || i.id === 'copy-channel-id'), 'Developer Mode OFF oculta IDs');
});

test('DM não lida, fixar, favoritar, fechar DM e Developer Mode ON', () => {
  const { DmContextMenu, state, sent, copied } = makeEnv({
    unreadDms: new Map([['dm:gabriel__swag', 3]]),
    uiSettings: { developerMode: true },
  });
  const items = DmContextMenu.buildItems({ conv: state.dmConversations[0] });
  const markRead = items.find((i) => i.id === 'mark-read');
  assert.equal(markRead.disabled, false);
  markRead.onSelect();
  assert.ok(sent.some((s) => s.type === 'AckChannel' && s.payload.channel_id === 'dm:gabriel__swag'));

  items.find((i) => i.id === 'toggle-pin').onSelect();
  assert.deepEqual(Array.from(state.prefs.pinned_dms), ['dm:gabriel__swag']);
  assert.equal(DmContextMenu.buildItems({ conv: state.dmConversations[0] }).find((i) => i.id === 'toggle-pin').label, 'Desafixar');

  items.find((i) => i.id === 'toggle-favorite').onSelect();
  assert.deepEqual(Array.from(state.prefs.favorite_dms), ['dm:gabriel__swag']);
  assert.equal(DmContextMenu.buildItems({ conv: state.dmConversations[0] }).find((i) => i.id === 'toggle-favorite').label, 'Remover dos favoritos');

  items.find((i) => i.id === 'copy-user-id').onSelect();
  items.find((i) => i.id === 'copy-channel-id').onSelect();
  assert.deepEqual(copied, ['acc-swag', 'dm:gabriel__swag']);

  items.find((i) => i.id === 'close-dm').onSelect();
  assert.ok(sent.some((s) => s.type === 'CloseDm' && s.payload.dm_id === 'dm:gabriel__swag'));
});

test('relacionamentos dinâmicos (não amigo, pendente enviada/recebida, bloqueado, ignorado, silenciado e servidores elegíveis)', () => {
  const peer = { id: 'acc-bia', username: 'Bia', display_name: 'Bia', online: true };

  // 1. Não amigo + convite só para servidores elegíveis (filtra sem permissão, pausados e onde já é membro)
  const env1 = makeEnv({ friends: [], dmConversations: [] });
  const items1 = env1.DmContextMenu.buildItems({ peer });
  assert.ok(items1.some((i) => i.id === 'add-friend'));
  const inviteSub = items1.find((i) => i.id === 'invite-server');
  assert.deepEqual(inviteSub.submenu.map((s) => s.label), ['Sancord Dev', 'Já Membro']);

  // 2. Solicitação enviada -> Cancelar solicitação
  const envOut = makeEnv({ friends: [], outgoingRequests: [peer] });
  assert.ok(envOut.DmContextMenu.buildItems({ peer }).some((i) => i.id === 'cancel-request'));

  // 3. Solicitação recebida -> Aceitar amizade
  const envIn = makeEnv({ friends: [], incomingRequests: [peer] });
  assert.ok(envIn.DmContextMenu.buildItems({ peer }).some((i) => i.id === 'accept-request'));

  // 4. Bloqueado -> Desbloquear, sem Iniciar chamada e sem Convidar para servidor
  const envBlk = makeEnv({ friends: [], blocked: [peer] });
  const blkItems = envBlk.DmContextMenu.buildItems({ peer });
  assert.ok(blkItems.some((i) => i.id === 'unblock'));
  assert.ok(!blkItems.some((i) => i.id === 'call'));
  assert.ok(!blkItems.some((i) => i.id === 'invite-server'));

  // 5. Silenciado e ignorado -> mostra Reativar som e Deixar de ignorar
  const envMuted = makeEnv({
    ignoredUsers: new Set(['swag']),
    prefs: { mutes: { 'dm:gabriel__swag': 0 }, notify_levels: {}, pinned_dms: [], favorite_dms: [], user_notes: { swag: 'Amigo antigo' } },
  });
  const mItems = envMuted.DmContextMenu.buildItems({ conv: envMuted.state.dmConversations[0] });
  assert.equal(mItems.find((i) => i.id === 'note').label, 'Editar nota');
  assert.equal(mItems.find((i) => i.id === 'toggle-ignore').label, 'Deixar de ignorar');
  const muteSub = mItems.find((i) => i.id === 'mute-user');
  assert.equal(muteSub.hint, 'até reativar');
  assert.ok(muteSub.submenu.some((s) => s.id === 'unmute-dm'));

  // 6. Sem servidores elegíveis -> não exibe submenu de convite
  const envNoSrv = makeEnv({ servers: [] });
  assert.ok(!envNoSrv.DmContextMenu.buildItems({ conv: envNoSrv.state.dmConversations[0] }).some((i) => i.id === 'invite-server'));
});

test('ContextMenu reposiciona próximo à borda e vira submenu para a esquerda em janela pequena', () => {
  const uiKitSrc = fs.readFileSync(path.join(__dirname, '../static/js/ui-kit.js'), 'utf8');
  const appended = [];
  class FakeEl {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = '';
      this.style = {};
      this.dataset = {};
      this.attrs = {};
      this.children = [];
      this.listeners = {};
      this.disabled = false;
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    appendChild(c) { this.children.push(c); return c; }
    append(...xs) { this.children.push(...xs); }
    get childElementCount() { return this.children.length; }
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
    focus() {}
    remove() {}
    contains(el) { return el === this || this.children.some((c) => c.contains?.(el)); }
    querySelector(sel) {
      if (sel.includes('button')) return this.children.find((c) => c.tagName === 'BUTTON' && !c.disabled) || null;
      return null;
    }
    getBoundingClientRect() {
      const left = parseFloat(this.style.left) || 0;
      const top = parseFloat(this.style.top) || 0;
      const width = 224;
      const height = this.className.includes('sancord-submenu') ? 160 : 320;
      return { left, top, right: left + width, bottom: top + height, width, height };
    }
  }
  const ctx = vm.createContext({
    console, Math, Number, String, Object, Array, Boolean, setTimeout, clearTimeout,
    window: { innerWidth: 500, innerHeight: 400, addEventListener: () => {}, removeEventListener: () => {} },
    document: {
      activeElement: null,
      body: { appendChild: (el) => { appended.push(el); return el; } },
      createElement: (tag) => new FakeEl(tag),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  vm.runInContext(`${uiKitSrc}\nthis.SancordUI = SancordUI;`, ctx);
  ctx.SancordUI.ContextMenu(490, 390, [
    ctx.SancordUI.ContextMenuSubmenu({
      label: 'Convidar para o servidor',
      submenu: [ctx.SancordUI.ContextMenuItem({ label: 'Sancord Dev', onSelect: () => {} })],
    }),
  ]);
  const rootMenu = appended[0];
  assert.ok(parseFloat(rootMenu.style.left) <= 500 - 224 - 8, 'menu raiz não pode ultrapassar a borda direita');
  assert.ok(parseFloat(rootMenu.style.top) <= 400 - 320 - 8, 'menu raiz não pode ultrapassar a borda inferior');

  // Abre submenu clicando no gatilho -> como não cabe à direita, deve abrir à esquerda do menu raiz
  const triggerBtn = rootMenu.children[0];
  triggerBtn.listeners.click[0]({ stopPropagation: () => {} });
  const subMenu = appended[1];
  assert.ok(subMenu, 'submenu deve ser criado');
  assert.ok(parseFloat(subMenu.style.left) < parseFloat(rootMenu.style.left), 'submenu deve virar para a esquerda quando sem espaço à direita');
});
