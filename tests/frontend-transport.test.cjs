const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/transport.js'), 'utf8');
function transport(endpoint) {
  return vm.runInNewContext(`${source}\nSancordNet`, {
    URL, URLSearchParams, fetch: (url, options) => ({ url, options }),
    window: { location: { search: `?endpoint=${encodeURIComponent(endpoint)}`, origin: 'http://sancord.localhost' } },
  });
}
test('interface interna encaminha HTTP, mídia e WebSocket ao backend escolhido', async () => {
  const net = transport('http://127.0.0.1:3100');
  assert.equal((await net.fetch('/api/login')).url, 'http://127.0.0.1:3100/api/login');
  assert.equal(net.url('/api/attachments/a/foto.png'), 'http://127.0.0.1:3100/api/attachments/a/foto.png');
  assert.equal(net.websocketUrl(), 'ws://127.0.0.1:3100/ws');
  assert.equal(transport('https://example.com').websocketUrl(), 'wss://example.com/ws');
});
test('sessões ficam separadas por backend e os convites são links do aplicativo', () => {
  const a = transport('https://a.example');
  const b = transport('https://b.example');
  assert.notEqual(a.sessionKey('sancord_token'), b.sessionKey('sancord_token'));
  const link = new URL(a.link({ invite: 'abc-123' }));
  assert.equal(link.protocol, 'sancord:');
  assert.equal(link.hostname, 'open');
  assert.equal(link.searchParams.get('endpoint'), 'https://a.example');
  assert.equal(link.searchParams.get('invite'), 'abc-123');
});
test('endereços e recursos recusam scripts e credenciais embutidas', () => {
  for (const invalid of ['javascript:alert(1)', 'file:///x', 'https://user:pass@example.com']) {
    assert.throws(() => transport(invalid));
  }
  assert.throws(() => transport('https://a.example').url('javascript:alert(1)'));
  assert.equal(transport('https://a.example').imageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.throws(() => transport('https://a.example').imageUrl('data:text/html;base64,AAAA'));
});
test('SanvoNet e LegacySancordMigration aceitam convites sanvo://, sanvo.gg/ e migram chaves de localStorage sem quebrar sancord_*', () => {
  const net = transport('https://a.example');
  assert.equal(net.extractInviteCode('sanvo.gg/SANV-AB3K9X2M'), 'SANV-AB3K9X2M');
  assert.equal(net.extractInviteCode('sancord.gg/SANC-AB3K9X2M'), 'SANC-AB3K9X2M');
  assert.equal(net.extractInviteCode('sanvo://open/?endpoint=https%3A%2F%2Fa.example&invite=SANV-123'), 'SANV-123');
  assert.equal(net.extractInviteCode('sanvo://invite/SANV-999'), 'SANV-999');
  const sanvoLink = new URL(net.sanvoLink({ invite: 'SANV-123' }));
  assert.equal(sanvoLink.protocol, 'sanvo:');
  assert.equal(sanvoLink.hostname, 'open');

  const authSrc = fs.readFileSync(require('node:path').join(__dirname, '../static/js/auth-storage.js'), 'utf8');
  const storeData = new Map([['sancord_lang', 'pt-BR'], ['sancord_audio_settings', '{"micGain":95}']]);
  const fakeStorage = {
    getItem: (k) => (storeData.has(k) ? storeData.get(k) : null),
    setItem: (k, v) => { storeData.set(k, String(v)); },
    removeItem: (k) => { storeData.delete(k); },
  };
  const ctx = vm.createContext({
    SancordNet: net,
    localStorage: fakeStorage,
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    window: { addEventListener: () => {} },
  });
  vm.runInContext(authSrc, ctx);
  assert.equal(storeData.get('sanvo_lang'), 'pt-BR', 'migrou sancord_lang para sanvo_lang');
  assert.equal(storeData.get('sanvo_audio_settings'), '{"micGain":95}', 'migrou sancord_audio_settings para sanvo_audio_settings');
  ctx.SanvoSessions.set(fakeStorage, 'sanvo_token', 'tok-123');
  assert.equal(ctx.SanvoSessions.get(fakeStorage, 'sancord_token'), 'tok-123', 'compatível entre sanvo_token e sancord_token');
  assert.equal(ctx.SanvoSessions.get(fakeStorage, 'sanvo_token'), 'tok-123');
});
