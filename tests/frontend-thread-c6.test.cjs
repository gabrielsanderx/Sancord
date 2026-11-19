// Etapa C6: ordenar fórum, seguir thread, prazo de arquivamento e membros da thread.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t, me = 'Ana') {
  const h = await openInterface(t);
  h.w.__me = me;
  h.run(`
    globalThis.__sent = [];
    sendWs = (type, payload) => { __sent.push([type, payload]); return true; };
    state.selfUser = { id: 'u-' + __me.toLowerCase(), username: __me };
    state.servers = [{ id: 's1', name: 'Servidor', owner_username: 'dona', members: ['dona', 'ana', 'bia', 'cris'],
      roles: [{ id: 'everyone', position: 0, permissions: { send_messages: true, view_channel: true, read_history: true } }], member_roles: {},
      text_channels: [{ id: 'c1', name: 'geral', kind: 'text' }, { id: 'f1', name: 'ajuda', kind: 'forum', forum_tags: [] }], voice_channels: [], categories: [] }];
    state.activeServerId = 's1';
    state.activeView = 'server';
    state.users = new Map([
      ['u1', { id: 'u1', username: 'Ana', status_kind: 'online' }],
      ['u2', { id: 'u2', username: 'Bia', status_kind: 'online' }],
      ['u3', { id: 'u3', username: 'Cris', status_kind: 'online' }],
    ]);
    const now = Date.now();
    for (const th of [
      { id: 'thr-velha-ativa', name: 'Velha mas ativa', parent_id: 'f1', created_at: now - 9e6, last_message_at: now - 1e3 },
      { id: 'thr-nova-quieta', name: 'Nova e quieta', parent_id: 'f1', created_at: now - 1e5, last_message_at: now - 1e5 },
      { id: 'thr-arquivada', name: 'Arquivada recente', parent_id: 'f1', created_at: now, last_message_at: now, archived: true },
      { id: 'thr-c1', name: 'Conversa', parent_id: 'c1', owner: 'ana', created_at: now, last_message_at: now, message_count: 3, members: ['ana', 'bia'], auto_archive_minutes: 60 },
    ]) state.threadIndex.set(th.id, { server_id: 's1', owner: 'dona', message_count: 1, members: [], auto_archive_minutes: 1440, ...th });
  `);
  return h;
}

test('fórum: atividade recente ou data de criação, arquivadas por último, escolha lembrada', async t => {
  const h = await setup(t), d = h.document;
  assert.equal(h.run('sortForumPosts(threadsOf("f1"), "activity").map(t => t.id).join()'), 'thr-velha-ativa,thr-nova-quieta,thr-arquivada');
  assert.equal(h.run('sortForumPosts(threadsOf("f1"), "created").map(t => t.id).join()'), 'thr-nova-quieta,thr-velha-ativa,thr-arquivada');

  h.run('state.forumViewChannel = "f1"; renderForumPosts()');
  const titles = () => [...d.querySelectorAll('#forum-posts .forum-post strong')].map(x => x.textContent);
  assert.deepEqual(titles(), ['Velha mas ativa', 'Nova e quieta', 'Arquivada recente']);
  const sel = d.getElementById('forum-sort');
  assert.equal(sel.value, 'activity');
  sel.value = 'created';
  sel.dispatchEvent(new h.w.Event('change'));
  assert.deepEqual(titles(), ['Nova e quieta', 'Velha mas ativa', 'Arquivada recente']);
  assert.equal(h.run('forumSortFor("f1")'), 'created', 'guardado neste aparelho');
  assert.equal(h.run('forumSortFor("outro")'), 'activity');
});

test('menu da thread: seguir/deixar de seguir e prazo de arquivamento com o atual marcado', async t => {
  const h = await setup(t), d = h.document;
  h.w.__ev = { clientX: 10, clientY: 10 };
  h.run('openThreadMenu(__ev, threadById("thr-c1"))');
  const labels = () => [...d.querySelectorAll('.sancord-menu .msg-ctx-item')].map(b => b.textContent);
  assert.ok(labels().includes('Deixar de seguir'), labels().join(' | '));
  assert.ok(labels().includes('Membros da thread (2)'));
  const prazo = [...d.querySelectorAll('.sancord-menu .msg-ctx-item')].find(b => b.textContent.startsWith('Arquivar após inatividade'));
  assert.match(prazo.textContent, /1 hora$/);
  prazo.click();
  const choices = [...d.querySelectorAll('.sancord-menu .msg-ctx-item')];
  assert.deepEqual(choices.map(b => b.textContent.replace('✓', '').trim()), ['1 hora', '24 horas', '3 dias', '1 semana']);
  choices[3].click();
  assert.equal(h.run('JSON.stringify(__sent[__sent.length - 1])'), '["UpdateThread",{"thread_id":"thr-c1","auto_archive_minutes":10080}]');

  // Quem não segue vê "Seguir thread"; sem ser dona nem moderação, não vê o prazo.
  const h2 = await setup(t, 'Cris');
  h2.run('openThreadMenu({ clientX: 1, clientY: 1 }, threadById("thr-c1"))');
  const l2 = [...h2.document.querySelectorAll('.sancord-menu .msg-ctx-item')].map(b => b.textContent);
  assert.ok(l2.includes('Seguir thread'));
  assert.ok(!l2.some(x => x.startsWith('Arquivar após inatividade')));
  [...h2.document.querySelectorAll('.sancord-menu .msg-ctx-item')].find(b => b.textContent === 'Seguir thread').click();
  assert.equal(h2.run('JSON.stringify(__sent[__sent.length - 1])'), '["JoinThread",{"thread_id":"thr-c1"}]');
});

test('thread aberta: cabeçalho com membros e lista lateral só com quem segue', async t => {
  const h = await setup(t), d = h.document;
  h.run('state.currentTextChannel = "thr-c1"; applyThreadHeader(threadById("thr-c1")); renderMembersSidebar()');
  assert.match(d.getElementById('chat-channel-topic').textContent, /3 mensagens • 2 membros • seguindo$/);
  const names = [...d.querySelectorAll('#members-list .member-name')].map(x => x.textContent.trim()).sort();
  assert.deepEqual(names, ['Ana', 'Bia']);
  assert.equal(d.getElementById('online-count-title')?.textContent || h.run('onlineCountTitle.textContent'), 'MEMBROS DA THREAD — 2');

  // Fora da thread volta a lista do servidor sem cabeçalho global "MEMBROS ONLINE".
  h.run('state.currentTextChannel = "c1"; renderMembersSidebar()');
  assert.equal([...d.querySelectorAll('#members-list .member-name')].length >= 3, true);
  assert.equal(d.getElementById('online-count-title').classList.contains('hidden'), true);
  assert.equal(d.getElementById('online-count-title').textContent, '');
  assert.equal(d.querySelector('#members-list .member-group-header').textContent, 'Disponível — 3');
});
