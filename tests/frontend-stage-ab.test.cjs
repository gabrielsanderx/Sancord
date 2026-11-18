// Etapas A e B: sincronização de notas/favoritas/ignorados na conta, recuperação de senha,
// sessões ativas, transferência de posse, exclusão de conta, motivo de ban/kick e limpeza em lote.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const advSource = fs.readFileSync(path.join(__dirname, '../static/js/advanced.js'), 'utf8');

test('index.html inclui controles de recuperação de senha, e-mail, sessões ativas e exclusão de conta', () => {
  for (const id of [
    'open-recover-password-btn',
    'account-info-email',
    'account-edit-email-btn',
    'generate-recovery-code-btn',
    'refresh-sessions-btn',
    'revoke-other-sessions-btn',
    'account-sessions-list',
    'delete-own-account-btn',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `Elemento #${id} ausente em index.html`);
  }
});

test('auditoria e regras de moderação (kick, ban, transferir posse) em advanced.js', () => {
  const sent = [];
  const context = vm.createContext({
    Date,
    Number,
    String,
    Object,
    Math,
    state: { selfUser: { username: 'Dono' } },
    isServerOwner: (srv, u) => srv?.owner_username === String(u || '').toLowerCase(),
    getServerPermissionsFor: (_srv, u) => {
      const low = String(u || '').toLowerCase();
      if (low === 'dono') return { administrator: true, kick_members: true, ban_members: true, moderate_members: true };
      if (low === 'mod') return { administrator: false, kick_members: true, ban_members: true, moderate_members: true };
      return { administrator: false, kick_members: false, ban_members: false, moderate_members: false };
    },
    getUserServerRoles: (_srv, u) => {
      const low = String(u || '').toLowerCase();
      if (low === 'mod') return [{ id: 'r-mod', position: 5 }];
      if (low === 'membro') return [{ id: 'r-mem', position: 1 }];
      return [];
    },
    sendWs: (type, payload) => sent.push({ type, payload }),
    SancordUI: {},
  });

  const labelsStart = advSource.indexOf('const AUDIT_LABELS');
  vm.runInContext(
    advSource.slice(labelsStart, advSource.indexOf('};', labelsStart) + 2).replace('const AUDIT_LABELS', 'var AUDIT_LABELS'),
    context
  );
  for (const fn of [
    'auditSentence',
    'memberTimeoutUntil',
    'formatTimeoutEnd',
    'canTimeoutMember',
    'timeoutMenuItems',
    'canKickMember',
    'canBanMember',
    'canTransferOwnership',
    'memberModerationMenuItems',
  ]) {
    const start = advSource.indexOf(`function ${fn}(`);
    assert.notEqual(start, -1, `Função ${fn} ausente em advanced.js`);
    vm.runInContext(advSource.slice(start, advSource.indexOf('\n}', start) + 2), context);
  }

  assert.equal(
    context.auditSentence({ actor: 'ana', action: 'server_transfer_ownership', target: 'bia' }),
    'ana transferiu a posse do servidor para bia'
  );
  assert.equal(
    context.auditSentence({ actor: 'ana', action: 'message_bulk_delete', target: 'geral' }),
    'ana limpou mensagens em geral'
  );

  const srv = {
    id: 'srv-1',
    name: 'Clube Rust',
    owner_username: 'dono',
    members: ['dono', 'mod', 'membro'],
    member_timeouts: {},
  };

  // Dono pode aplicar castigo, expulsar, banir e transferir posse para membro.
  const ownerMenu = context.memberModerationMenuItems(srv, 'membro', 'Membro');
  assert.equal(ownerMenu.length, 4);
  assert.ok(ownerMenu.some((i) => i.label.includes('Transferir posse')));

  // Moderador pode aplicar castigo, expulsar e banir membro abaixo dele, mas NÃO pode transferir posse nem moderar o dono.
  context.state.selfUser.username = 'Mod';
  const modMenu = context.memberModerationMenuItems(srv, 'membro', 'Membro');
  assert.equal(modMenu.length, 3);
  assert.ok(!modMenu.some((i) => i.label.includes('Transferir posse')));
  assert.equal(context.memberModerationMenuItems(srv, 'dono', 'Dono').length, 0);
});

test('preferências sincronizadas na conta (notas, favoritas e ignorados) em app.js', () => {
  const storage = new Map([['sancord_blocked_users', '["antigo"]']]);
  const sent = [];
  const context = vm.createContext({
    Set,
    Array,
    Object,
    String,
    JSON,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    document: { getElementById: () => null },
    state: {
      starredMsgIds: new Set(['m-local']),
      ignoredUsers: new Set(['ignorado1']),
      blockedUsers: new Set(),
      prefs: { user_notes: {}, ignored_users: [], starred_messages: [] },
    },
    sendWs: (type, payload) => sent.push({ type, payload }),
  });

  for (const fn of [
    'updateHomeStarredBadge',
    'applySyncedUserPrefs',
    'saveStarredMessages',
    'saveModerationLists',
    'getUserProfileNote',
    'setUserProfileNote',
  ]) {
    const start = appSource.indexOf(`function ${fn}(`);
    assert.notEqual(start, -1, `Função ${fn} ausente em app.js`);
    vm.runInContext(appSource.slice(start, appSource.indexOf('\n}', start) + 2), context);
  }

  // Primeira sincronização migra favoritas/ignorados locais para o servidor se o servidor estiver vazio.
  context.applySyncedUserPrefs(context.state.prefs);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'UpdateUserPrefs');
  assert.deepEqual(Array.from(sent[0].payload.starred_messages), ['m-local']);
  assert.deepEqual(Array.from(sent[0].payload.ignored_users), ['ignorado1']);

  // Salvar nota sincroniza via UpdateUserPrefs.
  context.setUserProfileNote('Bia', 'Joga Valorant');
  assert.equal(context.getUserProfileNote('bia'), 'Joga Valorant');
  assert.equal(sent.at(-1).type, 'UpdateUserPrefs');
  assert.equal(sent.at(-1).payload.user_notes.bia, 'Joga Valorant');

  // saveModerationLists remove sancord_blocked_users legado e sincroniza ignored_users.
  context.saveModerationLists();
  assert.equal(storage.has('sancord_blocked_users'), false);
});
