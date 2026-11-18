// Regressões da lógica do frontend, executando as funções reais sem dependências npm.
// O DOM/rede mínimos abaixo só isolam efeitos; a integração real usa o servidor Rust.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/chat.js'), 'utf8');
function load(names, globals) {
  const context = vm.createContext({ Map, Set, URL, URLSearchParams,
    window: { location: { search: '?endpoint=http%3A%2F%2F127.0.0.1%3A3100', origin: 'http://sancord.localhost' } },
    CSS: { escape: s => s }, isMessageRequest: () => false, ...globals });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/transport.js'), 'utf8'), context);
  // Helpers de conversa privada (DM/grupo) ficam em permissions.js.
  const perms = fs.readFileSync(path.join(__dirname, '../static/js/permissions.js'), 'utf8');
  const s = perms.indexOf('function isPrivateTextId(');
  vm.runInContext(perms.slice(s, perms.indexOf('\n}', s) + 2), context);
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Função ausente: ${name}`);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  return context;
}

function readHarness({ focused = true, hidden = false, active = 'geral', send = true } = {}) {
  const sent = [];
  const state = {
    activeView: 'server', activeDmId: null, chatHistory: {}, unreadDms: new Map(),
    readStates: new Map(), historyState: new Map(), unreadDividerByChannel: new Map(),
  };
  const context = load([
    'getReadState', 'maybeAckActiveChannel', 'onNewMessageForUnread', 'onWelcomeReadStates', 'onChannelOpened',
  ], {
    state, document: { hidden, hasFocus: () => focused },
    chatMainView: { classList: { contains: () => false } },
    getActiveTextChannelId: () => active,
    getHistoryState: id => state.historyState.get(id) || {},
    isNearBottom: () => true, isOwnMessage: m => m.author_name === 'Eu',
    messageMentionsMe: m => Boolean(m.mentioned), lastAckSent: new Map(),
    sendWs: (type, payload) => { sent.push({ type, payload }); return send; },
    refreshUnreadIndicators() {}, updateHomeNotificationBadges() {}, renderDmList() {},
    maybeDesktopNotify() {}, hideJumpBar() {}, placeUnreadDivider() {}, showUiToast() {},
    setTimeout() {},
  });
  return { context, state, sent };
}

test('ack que falha mantém menções e posição de leitura para nova tentativa', () => {
  const { context, state } = readHarness({ send: false });
  state.chatHistory.geral = [{ id: 'm1', created_at: 100 }];
  state.readStates.set('geral', { last_read_at: 10, mention_count: 2 });
  context.maybeAckActiveChannel();
  assert.equal(state.readStates.get('geral').last_read_at, 10);
  assert.equal(state.readStates.get('geral').mention_count, 2);
});

test('ack no canal visível e focado envia a última mensagem e limpa o badge', () => {
  const { context, state, sent } = readHarness({ active: 'dm:a:b' });
  state.chatHistory['dm:a:b'] = [{ id: 'm1', created_at: 100 }];
  state.unreadDms.set('dm:a:b', 2);
  context.maybeAckActiveChannel();
  assert.equal(sent[0].type, 'AckChannel');
  assert.equal(sent[0].payload.message_id, 'm1');
  assert.equal(state.readStates.get('dm:a:b').last_read_at, 100);
  assert.equal(state.unreadDms.has('dm:a:b'), false);
});

test('janela oculta, sem foco, histórico antigo e marcação manual não geram ack', () => {
  for (const mode of ['hidden', 'unfocused', 'history', 'manual']) {
    const { context, state, sent } = readHarness({ hidden: mode === 'hidden', focused: mode !== 'unfocused' });
    state.chatHistory.geral = [{ id: 'm1', created_at: 100 }];
    if (mode === 'history') state.historyState.set('geral', { hasNewer: true });
    if (mode === 'manual') state.suppressAckFor = 'geral';
    context.maybeAckActiveChannel();
    assert.equal(sent.length, 0, mode);
  }
});

test('DM recebida sincroniza badge com leitura mesmo com a conversa aberta sem foco', () => {
  for (const active of ['geral', 'dm:a:b']) {
    const { context, state } = readHarness({ active, focused: false });
    context.onNewMessageForUnread({ channel_id: 'dm:a:b', author_name: 'Outra pessoa', created_at: 100 });
    assert.equal(state.readStates.get('dm:a:b').mention_count, 1);
    assert.equal(state.unreadDms.get('dm:a:b'), 1);
  }
});

test('Welcome remove badges de DMs que já foram lidas em outro dispositivo', () => {
  const { context, state } = readHarness();
  state.unreadDms.set('dm:a:b', 8);
  context.onWelcomeReadStates([]);
  assert.equal(state.unreadDms.size, 0);
});

test('trocar de conversa cancela envio automático de anexos pendentes', () => {
  const { context, state } = readHarness();
  state.composerChannelId = 'geral';
  state.sendWhenUploaded = true;
  context.onChannelOpened('rust-dev');
  assert.equal(state.sendWhenUploaded, false);
});

test('atualização realtime preserva rascunho, seleção, foco e agrupamento da edição', () => {
  const state = { editingMsgId: 'm1' };
  const input = { value: 'rascunho ainda não salvo', selectionStart: 3, selectionEnd: 12, selectionDirection: 'backward' };
  const document = { activeElement: input };
  let grouped;
  let replacement;
  const original = {
    classList: { contains: name => name === 'grouped' },
    querySelector: () => input,
    replaceWith: el => { replacement = el; },
  };
  const updatedInput = {
    value: 'texto salvo', focus() { document.activeElement = this; },
    setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
  };
  const chatMessagesEl = {
    querySelector: selector => selector.endsWith(' .inline-edit-input')
      ? (replacement ? updatedInput : input) : (replacement || original),
  };
  const context = load(['captureMessageEdit', 'restoreMessageEdit', 'updateChatMessageUI'], {
    state, document, chatMessagesEl, autosizeTextarea() {},
    buildMessageElementV2: (msg, options) => {
      grouped = options.grouped;
      return { querySelector: () => updatedInput };
    },
  });
  context.updateChatMessageUI({ id: 'm1', content: 'texto salvo', reactions: [{ emoji: '👍' }] });
  assert.equal(updatedInput.value, input.value);
  assert.equal(updatedInput.selectionStart, 3);
  assert.equal(updatedInput.selectionEnd, 12);
  assert.equal(updatedInput.selectionDirection, 'backward');
  assert.equal(document.activeElement, updatedInput);
  assert.equal(grouped, true);
});

test('fluxo realtime limita o cache a 300 mensagens e permite buscar as descartadas', () => {
  const state = { activeView: 'server', chatHistory: { geral: [] } };
  const hs = {};
  const context = load(['cacheIncomingChatMessage'], {
    state, HISTORY_WINDOW_CAP: 300, getActiveTextChannelId: () => 'geral',
    getHistoryState: () => hs, isNearBottom: () => true, isOwnMessage: () => false,
  });
  for (let id = 1; id <= 350; id++) context.cacheIncomingChatMessage({ id, channel_id: 'geral' });
  assert.equal(state.chatHistory.geral.length, 300);
  assert.equal(state.chatHistory.geral[0].id, 51);
  assert.equal(state.chatHistory.geral.at(-1).id, 350);
  assert.equal(hs.hasMore, true);
});

test('ao atingir o limite longe do fim, conserva a janela e indica mensagens mais novas', () => {
  const messages = Array.from({ length: 300 }, (_, id) => ({ id, channel_id: 'geral' }));
  const state = { activeView: 'server', chatHistory: { geral: messages } };
  const hs = {};
  const context = load(['cacheIncomingChatMessage'], {
    state, HISTORY_WINDOW_CAP: 300, getActiveTextChannelId: () => 'geral',
    getHistoryState: () => hs, isNearBottom: () => false, isOwnMessage: () => false,
  });
  const result = context.cacheIncomingChatMessage({ id: 300, channel_id: 'geral' });
  assert.equal(result.stored, false);
  assert.equal(messages.length, 300);
  assert.equal(messages[0].id, 0);
  assert.equal(messages.at(-1).id, 299);
  assert.equal(hs.hasNewer, true);
});

test('carregar imagem com dimensões reservadas não desloca o histórico', () => {
  const { context, images, chatMessagesEl } = attachmentHarness({ hasNewer: true, near: true });
  context.buildAttachmentsNode({ channel_id: 'geral', attachments: [{ kind: 'image', width: 1024, height: 1024, url: '/imagem.png' }] });
  images[0].listeners.load?.();
  assert.equal(chatMessagesEl.scrollTop, 200);
});

test('imagem antiga sem dimensões também respeita a janela de histórico e a posição de leitura', () => {
  for (const options of [{ hasNewer: true, near: true }, { hasNewer: false, near: false }]) {
    const { context, images, chatMessagesEl } = attachmentHarness(options);
    context.buildAttachmentsNode({ channel_id: 'geral', image_url: 'data:image/png;base64,legado' });
    images[0].listeners.load?.();
    assert.equal(chatMessagesEl.scrollTop, 200);
  }
});

function attachmentHarness({ hasNewer, near }) {
  const images = [];
  const chatMessagesEl = { scrollTop: 200, scrollHeight: 5000 };
  const document = { createElement(tag) {
    const element = {
      style: {}, listeners: {}, naturalHeight: 4096,
      setAttribute() {}, appendChild() {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
    };
    if (tag === 'img') images.push(element);
    return element;
  } };
  return {
    images, chatMessagesEl,
    context: load(['buildAttachmentsNode'], {
      state: {}, document, chatMessagesEl,
      getActiveTextChannelId: () => 'geral', getHistoryState: () => ({ hasNewer }), isNearBottom: () => near,
    }),
  };
}

test('página do presente preserva mensagem realtime recebida durante a consulta', () => {
  const context = load(['mergeLatestPage'], { HISTORY_WINDOW_CAP: 300 });
  const page = [{ id: 'a', created_at: 10 }, { id: 'b', created_at: 20 }];
  const current = [{ id: 'a', created_at: 10 }, { id: 'c', created_at: 30 }];
  assert.deepEqual(Array.from(context.mergeLatestPage(page, current), m => m.id), ['a', 'b', 'c']);
});
