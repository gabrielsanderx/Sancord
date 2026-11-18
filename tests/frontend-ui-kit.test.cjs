// Fase 9 (seção 63): cache de imagens em data URL convertidas em blob: uma única vez.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/ui-kit.js'), 'utf8');
const cacheCode = source.slice(source.indexOf('const MEDIA_URL_CACHE'), source.indexOf('const SancordUI'));

function load() {
  let created = 0;
  const context = vm.createContext({
    Map, Uint8Array, String,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Blob: class { constructor(parts, opts) { this.size = parts[0].length; this.type = opts.type; } },
    URL: { createObjectURL: (blob) => `blob:test/${++created}-${blob.type}` },
  });
  vm.runInContext(`${cacheCode}\nthis.cachedMediaUrl = cachedMediaUrl; this.cache = MEDIA_URL_CACHE;`, context);
  return { context, created: () => created };
}

const bigPng = `data:image/png;base64,${Buffer.alloc(4000, 7).toString('base64')}`;

test('data URL grande vira blob: uma vez e é reaproveitada', () => {
  const { context, created } = load();
  const first = context.cachedMediaUrl(bigPng);
  assert.match(first, /^blob:test\/1-image\/png$/);
  assert.equal(context.cachedMediaUrl(bigPng), first);
  assert.equal(created(), 1);
});

test('endereços comuns, pequenos ou de tipo não suportado ficam iguais', () => {
  const { context, created } = load();
  assert.equal(context.cachedMediaUrl('/uploads/a.png'), '/uploads/a.png');
  assert.equal(context.cachedMediaUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  const svg = `data:image/svg+xml;base64,${Buffer.alloc(4000, 1).toString('base64')}`;
  assert.equal(context.cachedMediaUrl(svg), svg);
  assert.equal(context.cachedMediaUrl(null), null);
  assert.equal(created(), 0);
});

test('cache tem limite de entradas', () => {
  const { context } = load();
  for (let i = 0; i < 520; i++) {
    context.cachedMediaUrl(`data:image/png;base64,${Buffer.alloc(4000, i % 256).toString('base64')}${'A'.repeat(i % 4 === 0 ? 0 : 4)}${i}`);
  }
  assert.ok(context.cache.size <= 500);
});

test('limite do cache também limita blobs alocados e preserva imagens já usadas', () => {
  const { context, created } = load();
  const first = context.cachedMediaUrl(bigPng);
  for (let i = 0; i < 530; i++) {
    const bytes = Buffer.alloc(4000, 7);
    bytes.writeUInt32LE(i, 0);
    context.cachedMediaUrl(`data:image/png;base64,${bytes.toString('base64')}`);
  }
  assert.ok(created() <= 500, 'remover apenas a entrada do Map não libera o blob do WebView');
  assert.equal(context.cachedMediaUrl(bigPng), first);
});

test('limite em bytes impede acumular centenas de imagens grandes', () => {
  const { context, created } = load();
  for (let i = 0; i < 8; i++) {
    const url = `data:image/png;base64,${Buffer.alloc(6 * 1024 * 1024, i).toString('base64')}`;
    const before = created();
    const result = context.cachedMediaUrl(url);
    if (created() === before) assert.equal(result, url, 'o limite não pode esconder a imagem');
  }
  assert.ok(created() * 6 * 1024 * 1024 <= 32 * 1024 * 1024);
});
