const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    SancordNotifications.resetForTests();
    state.selfUser = { id: "gabriel-id", username: "Gabriel", avatar_color: "#5865f2", status_kind: "online" };
    state.activeView = "server";
    state.activeDmId = null;
    state.activeChannelId = "geral";
    state.blockedUsers = new Set();
    state.messageRequests = [];
    state.dmConversations = [
      { dm_id: "dm:gabriel:swag", peer: { id: "swag-id", username: "Swag", display_name: "Swag", avatar_color: "#ef4444", avatar_url: "/api/attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/av.png", online: true, status_kind: "online" }, last_message: "Eai" },
      { dm_id: "dm:gabriel:iumi", peer: { id: "iumi-id", username: "Iumi", display_name: "Iumi", avatar_color: "#22c55e", avatar_url: null, online: false, status_kind: "invisible" }, last_message: "Bora?" },
      { dm_id: "dm:gabriel:bot", peer: { id: "bot-id", username: "Sancord Bot", display_name: "Sancord Bot", avatar_color: "#5865f2", avatar_url: null, online: true, status_kind: "online", is_bot: true }, last_message: "Bem-vindo!" },
    ];
    state.groupDms = [
      { id: "gdm:squad-1", name: "Squad Noite", icon_url: null, owner: "gabriel", members: [{ username: "Gabriel" }, { username: "Swag" }, { username: "Iumi" }], last_message: "Bora rank" }
    ];
    globalThis.sent = [];
    globalThis.playedSounds = [];
    sendWs = (type, payload) => { sent.push(JSON.parse(JSON.stringify({ type, payload }))); return true; };
    playUiSound = (kind, opts) => { playedSounds.push({ kind, opts: opts || {} }); };
    globalThis.receive = (type, payload) => handleServerMessage({ type, payload });
  `);
  return h;
}

test('1 nova DM, 5 DMs rápidas com cooldown de som, limite 99+, 3 usuários e servidor não cria avatar DM', async (t) => {
  const h = await setup(t), d = h.document;

  // 1 nova DM de Swag
  h.run(`receive("NewChatMessage", { message: { id:"m1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"Vai jogar?", created_at:1000 } })`);
  const rail = d.getElementById('rail-unread-dms');
  assert.equal(rail.classList.contains('hidden'), false);
  assert.equal(rail.querySelectorAll('.rail-dm-item').length, 1);
  assert.equal(rail.querySelector('[data-dm-id="dm:gabriel:swag"] .rail-dm-badge').textContent, '1');
  assert.equal(h.run('playedSounds.length'), 1);
  assert.equal(h.run('playedSounds[0].kind'), 'dm-message');
  // Não roubou foco nem trocou para DM automaticamente
  assert.equal(h.run('state.activeView'), 'server');
  assert.equal(h.run('state.activeDmId'), null);

  // 4 mensagens rápidas seguidas do mesmo usuário: 1 único avatar com badge 5, sem sobrepor 5 sons
  for (let i = 2; i <= 5; i++) {
    h.run(`receive("NewChatMessage", { message: { id:"m${i}", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"msg ${i}", created_at:${1000 + i} } })`);
  }
  assert.equal(rail.querySelectorAll('.rail-dm-item').length, 1);
  assert.equal(rail.querySelector('[data-dm-id="dm:gabriel:swag"] .rail-dm-badge').textContent, '5');
  assert.equal(h.run('playedSounds.length'), 1, 'cooldown evita dingdingding em rajada');

  // Mensagem em canal de servidor NÃO aparece nos avatares de DM
  h.run(`receive("NewChatMessage", { message: { id:"srv1", channel_id:"geral", author_id:"swag-id", author_name:"Swag", content:"oi geral", created_at:2000 } })`);
  assert.equal(rail.querySelectorAll('.rail-dm-item').length, 1);

  // DM de Iumi + Group DM: 3 itens distintos (Group DM usa ícone próprio de grupo)
  h.run(`receive("NewChatMessage", { message: { id:"i1", channel_id:"dm:gabriel:iumi", author_id:"iumi-id", author_name:"Iumi", content:"oi!", created_at:3000 } })`);
  h.run(`receive("NewChatMessage", { message: { id:"g1", channel_id:"gdm:squad-1", author_id:"swag-id", author_name:"Swag", content:"bora", created_at:4000 } })`);
  const items = [...rail.querySelectorAll('.rail-dm-item')];
  assert.equal(items.length, 3);
  // Ordenação prioriza atividade mais recente (gdm -> iumi -> swag)
  assert.equal(items[0].dataset.dmId, 'gdm:squad-1');
  assert.ok(items[0].querySelector('.rail-dm-btn').classList.contains('is-group'));
  assert.equal(items[1].dataset.dmId, 'dm:gabriel:iumi');
  assert.equal(items[2].dataset.dmId, 'dm:gabriel:swag');

  // Limite visual 99+
  assert.equal(h.run('SancordNotifications.formatUnreadCount(99)'), '99');
  assert.equal(h.run('SancordNotifications.formatUnreadCount(100)'), '99+');
  assert.equal(h.run('SancordNotifications.formatUnreadCount(250)'), '99+');
});

test('respeita conversa aberta em foco, janela sem foco, mute, DND, som OFF, badge OFF, própria mensagem, bloqueado e Message Request', async (t) => {
  const h = await setup(t), d = h.document;

  // 1. Mensagem própria não conta nem toca som
  h.run(`receive("NewChatMessage", { message: { id:"own1", channel_id:"dm:gabriel:swag", author_id:"gabriel-id", author_name:"Gabriel", content:"oi", created_at:100 } })`);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:swag") || 0'), 0);
  assert.equal(h.run('playedSounds.length'), 0);

  // 2. Remetente bloqueado não cria badge nem som
  h.run(`
    state.blockedUsers.add("iumi");
    receive("NewChatMessage", { message: { id:"blk1", channel_id:"dm:gabriel:iumi", author_id:"iumi-id", author_name:"Iumi", content:"spam", created_at:200 } });
  `);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:iumi") || 0'), 0);
  assert.equal(h.run('playedSounds.length'), 0);
  h.run('state.blockedUsers.delete("iumi")');

  // 3. Message Request não entra como badge de DM comum nem toca som
  h.run(`
    state.messageRequests = [{ dm_id: "dm:gabriel:estranho", peer: { username: "Estranho" } }];
    receive("NewChatMessage", { message: { id:"req1", channel_id:"dm:gabriel:estranho", author_id:"est-id", author_name:"Estranho", content:"oi", created_at:250 } });
  `);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:estranho") || 0'), 0);
  assert.equal(h.run('playedSounds.length'), 0);

  // 4. Conversa silenciada (mute): mantém unread badge mas NÃO toca som
  h.run(`
    state.prefs = { mutes: { "dm:gabriel:swag": 0 } };
    receive("NewChatMessage", { message: { id:"mut1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"silenciada", created_at:300 } });
  `);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:swag")'), 1);
  assert.equal(h.run('playedSounds.length'), 0);
  h.run('state.prefs = { mutes: {} }');

  // 5. DND: registra unread/badge mas NÃO toca som
  h.run(`
    state.selfUser.status_kind = "dnd";
    receive("NewChatMessage", { message: { id:"dnd1", channel_id:"dm:gabriel:iumi", author_id:"iumi-id", author_name:"Iumi", content:"oi dnd", created_at:400 } });
  `);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:iumi")'), 1);
  assert.equal(h.run('playedSounds.length'), 0);
  h.run('state.selfUser.status_kind = "online"');

  // 6. Som OFF + Badge ON funciona separadamente
  h.run(`
    state.audioSettings.soundMessages = false;
    receive("NewChatMessage", { message: { id:"nosnd1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"sem som", created_at:500 } });
  `);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:swag")'), 2);
  assert.equal(h.run('playedSounds.length'), 0);
  assert.equal(d.querySelectorAll('#rail-unread-dms .rail-dm-item').length, 2);

  // 7. Badge OFF oculta os avatares da barra lateral independentemente do som
  h.run(`
    state.audioSettings.soundMessages = true;
    state.audioSettings.notifDmBadges = false;
    updateHomeNotificationBadges();
  `);
  assert.equal(d.getElementById('rail-unread-dms').classList.contains('hidden'), true);
  h.run('state.audioSettings.notifDmBadges = true; updateHomeNotificationBadges();');

  // 8. Conversa aberta E janela focada -> não cria badge artificial nem toca som
  h.run(`
    state.activeView = "home";
    state.activeDmId = "dm:gabriel:swag";
    document.hasFocus = () => true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    isNearBottom = () => true;
    SancordNotifications.resetForTests();
    receive("ReadStateUpdated", { state: { channel_id: "dm:gabriel:swag", last_read_at: 500, mention_count: 0 } });
    receive("NewChatMessage", { message: { id:"open1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"vendo agora", created_at:600 } });
  `);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:swag") || 0'), 0);
  assert.equal(h.run('playedSounds.length'), 0);

  // 9. Mesma conversa aberta mas janela SEM FOCO -> gera unread + som
  h.run(`
    document.hasFocus = () => false;
    receive("NewChatMessage", { message: { id:"unfoc1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"minimizado", created_at:700 } });
  `);
  assert.equal(h.run('state.unreadDms.get("dm:gabriel:swag")'), 1);
  assert.equal(h.run('playedSounds.length'), 1);
});

test('multi-device ReadStateUpdated, reconnect sem rajada de sons, clique no avatar, Marcar como lida e atualização de avatar', async (t) => {
  const h = await setup(t), d = h.document;

  // Conexão inicial (Welcome) com 0 não lidas
  h.run('onWelcomeReadStates([{ channel_id: "dm:gabriel:swag", last_read_at: 100, mention_count: 0 }])');
  assert.equal(h.run('playedSounds.length'), 0);

  // Reconnect após receber 5 DMs offline: sincroniza contagem exata e NÃO toca sons retroativos (#30, #59)
  h.run(`onWelcomeReadStates([
    { channel_id: "dm:gabriel:swag", last_read_at: 100, mention_count: 5 },
    { channel_id: "dm:gabriel:iumi", last_read_at: 100, mention_count: 3 }
  ])`);
  assert.equal(d.querySelector('[data-dm-id="dm:gabriel:swag"] .rail-dm-badge').textContent, '5');
  assert.equal(d.querySelector('[data-dm-id="dm:gabriel:iumi"] .rail-dm-badge').textContent, '3');
  assert.equal(h.run('playedSounds.length'), 0, 'reconnect não toca sons retroativos');

  // Atualiza avatar do contato -> rail reflete novo avatar ao vivo
  h.run(`
    state.dmConversations[0].peer.avatar_url = "/api/attachments/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/novo.png";
    updateHomeNotificationBadges();
  `);
  assert.match(d.querySelector('[data-dm-id="dm:gabriel:swag"] img').src, /bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);

  // Clique no avatar abre diretamente a DM correspondente (não Profile Popout)
  d.querySelector('[data-dm-id="dm:gabriel:swag"] .rail-dm-btn').click();
  assert.equal(h.run('sent.at(-1).type'), 'OpenDm');
  assert.equal(h.run('sent.at(-1).payload.target_username'), 'Swag');

  // Leitura em outro dispositivo (multi-device ReadStateUpdated) remove o badge imediatamente
  h.run('receive("ReadStateUpdated", { state: { channel_id: "dm:gabriel:swag", last_read_at: 9999, mention_count: 0 } })');
  assert.equal(d.querySelector('[data-dm-id="dm:gabriel:swag"]'), null);

  // Nova mensagem após leitura volta com badge 1
  h.run(`receive("NewChatMessage", { message: { id:"after1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"cadê você?", created_at:10000 } })`);
  assert.equal(d.querySelector('[data-dm-id="dm:gabriel:swag"] .rail-dm-badge').textContent, '1');
});

test('lista de Mensagens diretas renderiza itens compactos para DM normal, unread 99+, ativa, grupo e bot', async (t) => {
  const h = await setup(t), d = h.document;
  h.run(`
    state.activeView = "home";
    state.activeDmId = "dm:gabriel:swag";
    state.unreadDms.set("dm:gabriel:iumi", 120);
    renderDmList();
  `);
  const list = d.getElementById('dm-list');
  const items = [...list.querySelectorAll('.dm-item')];
  assert.equal(items.length, 4); // 1 group + 3 DMs
  assert.ok(list.querySelector('.dm-group-item'), 'renderiza Group DM');
  assert.ok(list.querySelector('.dm-item.active'), 'renderiza DM ativa');
  assert.ok(list.querySelector('.dm-item.is-unread .dm-count-badge'), 'renderiza DM unread');
  assert.equal(list.querySelector('.dm-item.is-unread .dm-count-badge').textContent, '99+');
  assert.equal(list.querySelector('.dm-role-chip').textContent, 'APP');
  assert.ok(list.querySelector('.dm-avatar-wrap .dm-avatar'), 'usa classes de densidade compacta');
});

test('taskbar badge IPC (0 -> 1 -> 2 -> 1 -> 0), message_received WAV, deduplicação, deleção, níveis de servidor, logout e troca de conta', async (t) => {
  const h = await setup(t);
  h.run(`
    globalThis.ipcCalls = [];
    window.ipc = { postMessage: (msg) => ipcCalls.push(msg) };
    globalThis.soundMgrEvents = [];
    SancordSoundManager.setTestPlayHook((ev) => soundMgrEvents.push(ev));
    state.lastBadgeSent = -1;
    state.lastTaskbarBadgeSent = -1;
    updateDocumentTitle();
  `);

  // Estado inicial: 0 -> taskbar-badge:0
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 0);
  assert.ok(h.run('ipcCalls.includes("taskbar-badge:0")'));

  // 0 -> 1: Swag envia DM -> toca message_received e atualiza taskbar para 1
  h.run(`receive("NewChatMessage", { message: { id:"tb-1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"vai entrar?", created_at:1000 } })`);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 1);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:1');
  assert.equal(h.run('soundMgrEvents.length'), 1);
  assert.equal(h.run('soundMgrEvents[0].cueId'), 'message_received');

  // Deduplicação (#52): mesmo message.id entregue novamente pelo WebSocket NÃO incrementa nem toca som duas vezes
  h.run(`receive("NewChatMessage", { message: { id:"tb-1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"vai entrar?", created_at:1000 } })`);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 1);
  assert.equal(h.run('soundMgrEvents.length'), 1);

  // Mensagem editada (#53): NÃO cria nova notificação nem toca som
  h.run(`receive("MessageUpdated", { message: { id:"tb-1", channel_id:"dm:gabriel:swag", author_id:"swag-id", author_name:"Swag", content:"vai entrar agora?", edited:true, created_at:1000 } })`);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 1);
  assert.equal(h.run('soundMgrEvents.length'), 1);

  // 1 -> 2: Iumi envia DM (após cooldown global) -> taskbar-badge:2
  h.run(`
    SancordNotifications.recordSoundPlayed("dm:gabriel:swag", Date.now() - 2000);
    receive("NewChatMessage", { message: { id:"tb-2", channel_id:"dm:gabriel:iumi", author_id:"iumi-id", author_name:"Iumi", content:"bora!", created_at:2000 } });
  `);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 2);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:2');
  assert.equal(h.run('soundMgrEvents.length'), 2);

  // 2 -> 1 por deleção de mensagem não lida (#54): Iumi apaga a mensagem antes de Gabriel ler
  h.run(`receive("MessageDeleted", { channel_id:"dm:gabriel:iumi", message_id:"tb-2" })`);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 1);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:1');

  // 1 -> 2 novamente com menção em servidor; mensagem normal em servidor sem menção NÃO infla contador global (#8, #17)
  h.run(`
    state.servers = [{ id:"srv-1", name:"Sanvo Hub", text_channels:[{ id:"ch-geral", name:"geral" }], voice_channels:[], members:["gabriel","swag"] }];
    SancordNotifications.recordSoundPlayed("dm:gabriel:iumi", Date.now() - 2000);
    receive("NewChatMessage", { message: { id:"srv-normal", channel_id:"ch-geral", author_id:"swag-id", author_name:"Swag", content:"mensagem comum sem mencao", mentions:{ users:[], roles:[], everyone:false, online:false }, created_at:3000 } });
  `);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 1, 'mensagem comum de servidor não infla badge da taskbar');
  assert.equal(h.run('soundMgrEvents.length'), 2, 'canal de servidor em modo padrão não toca som sem menção');

  // Menção direta em servidor incrementa para 2 e toca som
  h.run(`
    receive("NewChatMessage", { message: { id:"srv-mention", channel_id:"ch-geral", author_id:"swag-id", author_name:"Swag", content:"oi @Gabriel", mentions:{ users:["gabriel"], roles:[], everyone:false, online:false }, created_at:4000 } });
  `);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 2);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:2');
  assert.equal(h.run('soundMgrEvents.length'), 3);

  // Configuração "Mostrar contador de notificações no ícone do Sanvo" OFF (#46, #47): envia taskbar-badge:0 mantendo unread interno = 2
  h.run(`
    {
      const chk = document.getElementById("notif-taskbar-badge");
      chk.checked = false;
      chk.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
  `);
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 2);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:0');

  // Reativa configuração -> taskbar volta para 2 imediatamente
  h.run(`
    {
      const chk = document.getElementById("notif-taskbar-badge");
      chk.checked = true;
      chk.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
  `);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:2');

  // 2 -> 1: Lê DM de Swag
  h.run(`receive("ReadStateUpdated", { state: { channel_id: "dm:gabriel:swag", last_read_at: 5000, mention_count: 0 } })`);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 1);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:1');

  // 1 -> 0: Marcar tudo como lido (#27) -> taskbar-badge:0
  h.run(`SancordNotifications.markAllAsRead()`);
  await h.flush();
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 0);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:0');

  // Logout / troca de conta (#43, #44): se havia 4 não lidas, limpa imediatamente para 0
  h.run(`
    onWelcomeReadStates([{ channel_id: "dm:gabriel:swag", last_read_at: 100, mention_count: 4 }]);
    updateDocumentTitle();
  `);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:4');
  h.run(`
    state.selfUser = null;
    SancordNotifications.clearSessionState();
  `);
  assert.equal(h.run('SancordNotifications.getGlobalUnreadNotificationCount()'), 0);
  assert.equal(h.run('ipcCalls.filter(c => c.startsWith("taskbar-badge:")).at(-1)'), 'taskbar-badge:0');
});
