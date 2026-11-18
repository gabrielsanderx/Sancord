const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/permissions.js'), 'utf8');

test('revogar acesso elimina caches e resposta pendente, preservando conversa acessível', () => {
  const publicMessages = [{ id: 'publica' }];
  const state = {
    chatHistory: { publico: publicMessages, privado: [{ id: 'segredo' }] },
    historyState: new Map([['privado', { loading: true }]]),
    readStates: new Map([['privado', { mention_count: 3 }]]),
    unreadDividerByChannel: new Map([['privado', 'segredo']]),
    replyingTo: { channel_id: 'privado' }, currentVoiceChannel: null,
  };
  let cancelled = false;
  const context = vm.createContext({
    state, pinnedPopover: { classList: { add() {} } },
    clearReplyingTo() { cancelled = true; }, refreshUnreadIndicators() {},
    getActiveTextChannelId: () => 'publico', chatMessagesEl: null,
  });
  vm.runInContext(source, context);
  context.reconcileServerAccess({ text_channels: [{ id: 'publico' }, { id: 'privado' }] }, {
    text_channels: [{ id: 'publico', effective_permissions: { read_history: true } }],
  });
  assert.equal(Object.hasOwn(state.chatHistory, 'privado'), false);
  assert.equal(state.chatHistory.publico, publicMessages);
  assert.equal(state.historyState.has('privado'), false);
  assert.equal(state.readStates.has('privado'), false);
  assert.equal(state.unreadDividerByChannel.has('privado'), false);
  assert.equal(cancelled, true);
});

test('retirar histórico limpa mensagens mesmo quando o canal continua visível', () => {
  const state = { chatHistory: { canal: [{ id: 'antiga' }] }, currentVoiceChannel: null };
  let cleared = false;
  const context = vm.createContext({ state, pinnedPopover: null, refreshUnreadIndicators() {},
    getActiveTextChannelId: () => 'canal', chatMessagesEl: { replaceChildren() { cleared = true; } } });
  vm.runInContext(source, context);
  context.reconcileServerAccess({ text_channels: [{ id: 'canal' }] }, {
    text_channels: [{ id: 'canal', effective_permissions: { read_history: false } }],
  });
  assert.equal(Object.hasOwn(state.chatHistory, 'canal'), false);
  assert.equal(cleared, true);
});

test('editor bloqueia autoatribuição, cargos superiores e concessões sem permissão', () => {
  const low = { id: 'baixo', position: 1, permissions: { send_messages: true } };
  const manager = { id: 'gestor', position: 5 };
  const admin = { id: 'admin', position: 10, permissions: { administrator: true } };
  const roles = { eu: [manager], colega: [low], superior: [admin], dono: [admin] };
  const srv = { owner_username: 'dono' };
  const context = vm.createContext({
    state: { selfUser: { username: 'Eu' } },
    getServerPermissionsFor: () => ({ manage_roles: true, administrator: false, send_messages: true }),
    getUserServerRoles: (_, user) => roles[user] || [], isServerOwner: (_, user) => user === 'dono',
  });
  vm.runInContext(source, context);
  assert.equal(context.canAssignRole(srv, low, 'colega'), true);
  assert.equal(context.canAssignRole(srv, admin, 'colega'), false);
  assert.equal(context.canAssignRole(srv, low, 'eu'), false);
  assert.equal(context.canAssignRole(srv, low, 'dono'), false);
  assert.equal(context.canAssignRole(srv, low, 'superior'), false);
  assert.equal(context.canAssignRole(srv, { ...low, permissions: { ban_members: true } }, 'colega'), false);
});
