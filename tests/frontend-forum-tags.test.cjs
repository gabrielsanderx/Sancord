// Tags de fórum no cliente: texto "uma por linha", comparação, filtro e opções.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/threads.js'), 'utf8');
const context = vm.createContext({ JSON, String, Boolean, Set, Map });
for (const name of ['forumTagsToLines', 'parseForumTagLines', 'sameForumTags', 'forumTagLabel', 'forumTagOptions', 'matchesTagFilter']) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Função ausente: ${name}`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}

const existing = [
  { id: 'tag-1', name: 'Bug', emoji: '🐛', moderated: false },
  { id: 'tag-2', name: 'Resolvido', emoji: '✅', moderated: true },
];

test('linhas: emoji opcional, (mod) no fim e ids preservados pelo nome', () => {
  const parsed = context.parseForumTagLines('🐛 bug\n\n  Ideia nova  \n✅ Resolvido (MOD)\n💡\n', existing);
  assert.equal(parsed.length, 4, 'linha vazia é ignorada');
  assert.equal(parsed[3].name, '💡', 'só um emoji vira o próprio nome da tag');
  assert.equal(parsed[3].emoji, null);
  assert.equal(parsed[0].id, 'tag-1');
  assert.equal(parsed[0].name, 'bug');
  assert.equal(parsed[0].emoji, '🐛');
  assert.equal(parsed[1].id, '');
  assert.equal(parsed[1].emoji, null);
  assert.equal(parsed[1].name, 'Ideia nova');
  assert.equal(parsed[2].moderated, true);
  assert.equal(parsed[2].id, 'tag-2');
});

test('ida e volta do texto não muda as tags', () => {
  const text = context.forumTagsToLines(existing);
  assert.equal(text, '🐛 Bug\n✅ Resolvido (mod)');
  assert.equal(context.sameForumTags(context.parseForumTagLines(text, existing), existing), true);
  assert.equal(context.sameForumTags(context.parseForumTagLines('🐛 Bug', existing), existing), false);
});

test('nome com número no começo não vira emoji', () => {
  const [tag] = context.parseForumTagLines('2024 Torneio', []);
  assert.equal(tag.name, '2024 Torneio');
  assert.equal(tag.emoji, null);
});

test('filtro mostra postagens com qualquer tag escolhida', () => {
  const post = { tags: ['tag-1'] };
  assert.equal(context.matchesTagFilter(post, new Set()), true);
  assert.equal(context.matchesTagFilter(post, new Set(['tag-1', 'tag-9'])), true);
  assert.equal(context.matchesTagFilter(post, new Set(['tag-2'])), false);
  assert.equal(context.matchesTagFilter({}, new Set(['tag-1'])), false);
});

test('tag da moderação vem travada para quem não modera', () => {
  const forum = { forum_tags: existing };
  const member = context.forumTagOptions(forum, false);
  assert.equal(member[0].disabled, false);
  assert.equal(member[1].disabled, true);
  assert.equal(member[1].label, '✅ Resolvido');
  assert.equal(context.forumTagOptions(forum, true)[1].disabled, false);
});
