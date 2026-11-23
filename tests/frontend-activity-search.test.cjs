// Testes de frontend: Atividade/Rich Presence, prioridade na Member List e Pesquisa Avançada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeMiniDom() {
  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = '';
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.style = {};
      this._text = '';
    }
    set textContent(v) { this._text = String(v ?? ''); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    appendChild(c) { this.children.push(c); return c; }
    append(...list) { for (const x of list) this.children.push(x); }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (sel === 'a' && c.tagName === 'A') out.push(c);
          if (sel === 'img' && c.tagName === 'IMG') out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
  }
  return {
    createElement: (tag) => new El(tag),
    createTextNode: (txt) => ({ textContent: String(txt ?? ''), children: [] }),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
}

function loadActivityModule(overrides = {}) {
  const src = fs.readFileSync(path.join(__dirname, '../static/js/activity.js'), 'utf8');
  const sent = [];
  const store = new Map();
  const doc = makeMiniDom();
  const ctx = vm.createContext({
    console,
    Date,
    Number,
    String,
    Object,
    Array,
    Map,
    Set,
    JSON,
    URL,
    setInterval: () => 1,
    clearInterval: () => {},
    window: {
      __SANCORD_ACTIVITY_NATIVE: false,
      addEventListener: () => {},
      prompt: () => null,
    },
    document: doc,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    state: {
      selfUser: { username: 'Gabriel', status_kind: 'online' },
      ws: { readyState: 1 },
    },
    WebSocket: { OPEN: 1 },
    sendWs: (type, payload) => sent.push({ type, payload }),
    ...overrides,
  });
  vm.runInContext(`${src}\nthis.SancordActivity = SancordActivity;`, ctx);
  return { act: ctx.SancordActivity, sent, doc, ctx };
}

test('SancordActivity formata tempo, party, cartão Rich Presence e bloqueia URLs inseguras', () => {
  const { act, doc } = loadActivityModule();
  const now = 1_800_000_000_000;
  assert.equal(act.formatElapsed(now - 92 * 60 * 1000, now), 'há 1h 32min');
  assert.equal(act.formatElapsed(now - 47 * 60 * 1000, now), 'há 47 minutos');
  assert.equal(act.formatParty({ party_size: 2, party_max: 4 }), '2 de 4 jogadores');
  assert.equal(act.formatCompactLine({ kind: 'playing', name: 'Cyberpunk 2077' }), '🎮 Cyberpunk 2077');

  const card = act.createRichActivityCard({
    kind: 'playing',
    name: 'Minecraft',
    details: 'Explorando mundo Survival',
    state: 'Overworld',
    party_size: 2,
    party_max: 4,
    started_at: now - 47 * 60 * 1000,
    large_image: 'javascript:alert(1)',
    buttons: [
      { label: 'Site seguro', url: 'https://example.com' },
      { label: 'Inseguro', url: 'file:///C:/Windows/win.ini' },
    ],
  }, { document: doc });

  assert.ok(card.textContent.includes('JOGANDO UM JOGO'));
  assert.ok(card.textContent.includes('Minecraft'));
  assert.ok(card.textContent.includes('Explorando mundo Survival'));
  assert.ok(card.textContent.includes('2 de 4 jogadores'));
  assert.equal(card.querySelectorAll('img').length, 0);
  const links = card.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.com/');
});

test('SancordActivity respeita privacidade, prioridade de fontes e invisível', () => {
  const { act, sent, ctx } = loadActivityModule();
  act.applyNativeSnapshot({
    supported: true,
    config: { detect_games: true, share_activity: true },
    detected: { key: 'known:game:cp', kind: 'playing', application_id: 'game:cp', name: 'Cyberpunk 2077', exe_name: 'cyberpunk2077.exe', started_at: 1000 },
    registered: [],
    candidates: [],
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'UpdateActivity');
  assert.equal(sent[0].payload.activity.name, 'Cyberpunk 2077');

  // RPC tem prioridade sobre detector de processos
  act.setSourceActivity('rpc', { kind: 'playing', name: 'Minecraft', details: 'Survival' });
  assert.equal(sent[sent.length - 1].payload.activity.name, 'Minecraft');

  // Desligar compartilhamento limpa no servidor mantendo detecção local
  act.setConfig({ share_activity: false });
  assert.equal(sent[sent.length - 1].payload.activity, null);
  assert.equal(act.resolveActiveActivity().name, 'Minecraft');

  // Religar compartilhamento e ficar invisível -> não compartilha
  act.setConfig({ share_activity: true });
  assert.equal(sent[sent.length - 1].payload.activity.name, 'Minecraft');
  ctx.state.selfUser.status_kind = 'invisible';
  act.onSelfStatusChanged();
  assert.equal(sent[sent.length - 1].payload.activity, null);
});

test('MemberList exibe atividade estruturada e respeita prioridade castigo > voz > atividade > status', () => {
  const mlSrc = fs.readFileSync(path.join(__dirname, '../static/js/member-list.js'), 'utf8');
  const ctx = vm.createContext({ Object, Array, String, Set, Map });
  vm.runInContext(`${mlSrc}\nthis.SancordMemberList = SancordMemberList;`, ctx);
  const { resolveMemberActivity } = ctx.SancordMemberList;

  const srv = { voice_channels: [{ id: 'v1', name: 'Call 1' }] };
  const gamer = { username: 'Gabriel', online: true, status_kind: 'online', activity: { kind: 'playing', name: 'Cyberpunk 2077' } };
  assert.equal(resolveMemberActivity(srv, gamer, { customStatus: 'Oi' }), '🎮 Cyberpunk 2077');

  const inVoice = { ...gamer, voice_channel_id: 'v1' };
  assert.equal(resolveMemberActivity(srv, inVoice, { customStatus: 'Oi' }), '🔊 Call 1');

  const offline = { ...gamer, online: false, status_kind: 'offline' };
  assert.equal(resolveMemberActivity(srv, offline, {}), '');
});

test('SancordSearch destaca termos com segurança, gera sugestões e gerencia histórico local', () => {
  const advSrc = fs.readFileSync(path.join(__dirname, '../static/js/advanced.js'), 'utf8');
  const searchSrc = fs.readFileSync(path.join(__dirname, '../static/js/search.js'), 'utf8');
  const store = new Map();
  const ctx = vm.createContext({
    console, Date, Number, String, Object, Array, Map, Set, JSON, RegExp, Math,
    setTimeout, clearTimeout,
    document: makeMiniDom(),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    state: {
      selfUser: { username: 'Gabriel', display_name: 'Gabriel', avatar_color: '#5865F2' },
      users: new Map([['u1', { username: 'Ana', display_name: 'Ana Silva', avatar_color: '#ff0066' }]]),
      friends: [],
      activeView: 'server',
    },
    getActiveServer: () => ({
      id: 'srv1',
      members: ['gabriel', 'ana'],
      text_channels: [{ id: 'c1', name: 'geral', kind: 'text' }, { id: 'c2', name: 'anuncios', kind: 'announcement' }],
      threads: [{ id: 't1', name: 'Dúvidas Minecraft' }],
    }),
  });
  vm.runInContext(`
    const startDate = ${JSON.stringify(advSrc.indexOf('function parseSearchDate('))};
    ${advSrc.slice(advSrc.indexOf('function parseSearchDate('), advSrc.indexOf('function hideSearchResults('))}
    ${searchSrc}
    this.SancordSearch = SancordSearch;
  `, ctx);

  const S = ctx.SancordSearch;
  const hl = S.highlightSnippet('Veja <script> o Relatório do Minecraft!', ['relatorio', 'minec']);
  assert.ok(!hl.includes('<script>'));
  assert.ok(hl.includes('&lt;script&gt;'));
  assert.ok(hl.includes('<mark class="search-hl">Relatório</mark>'));
  assert.ok(hl.includes('<mark class="search-hl">Minec</mark>raft'));

  const userSugg = S.buildSuggestions('de:an');
  assert.ok(userSugg.items.some((i) => i.title.includes('@Ana')));

  const chanSugg = S.buildSuggestions('em:ger');
  assert.ok(chanSugg.items.some((i) => i.title === '#geral'));

  const hasSugg = S.buildSuggestions('tem:enq');
  assert.ok(hasSugg.items.some((i) => i.title === 'tem:enquete'));

  S.saveHistory('minecraft de:Gabriel');
  S.saveHistory('relatorio.pdf');
  assert.deepEqual(S.loadHistory(), ['relatorio.pdf', 'minecraft de:Gabriel']);
  S.clearHistory();
  assert.deepEqual(S.loadHistory(), []);
});
