const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    state.selfUser = { id:"ana", username:"Ana", avatar_color:"#6452e1" };
    globalThis.sent = [];
    sendWs = (type, payload) => { sent.push(JSON.parse(JSON.stringify({type, payload}))); return true; };
    globalThis.receive = (type, payload) => handleServerMessage({type, payload});
  `);
  return h;
}

test('mural permite arrastar, mover pelo teclado e salvar visibilidade e ordem', async t => {
  const h = await setup(t), d = h.document;
  d.getElementById('open-board-editor').click();
  assert.equal(h.run('sent.at(-1).type'), 'GetProfileBoard');
  await h.run(`receive("ProfileBoardState", {board:{revision:3, audience:"everyone", widgets:[
    {kind:"playing",visible:true,name:"Jogo A"},
    {kind:"want_to_play",visible:true,name:"Jogo B"},
    {kind:"about",visible:true,text:"Sobre a Ana"}
  ]}})`);
  const list = d.getElementById('board-editor-widgets');
  const drag = (target, type) => {
    const event = new h.w.Event(type, { bubbles:true, cancelable:true });
    Object.defineProperty(event, 'dataTransfer', {value:{setData() {}}});
    target.dispatchEvent(event);
  };
  drag(list.children[0].querySelector('.profile-board-grip'), 'dragstart');
  drag(list.children[2], 'dragover');
  assert.ok(list.children[2].classList.contains('drop-target'));
  drag(list.children[2], 'drop');
  assert.match(list.children[0].textContent, /Jogo B/);
  list.children[2].querySelector('[data-action="up"]').click();
  assert.match(list.children[1].textContent, /Jogo A/);
  assert.match(d.activeElement.getAttribute('aria-label'), /Subir Jogo A/);

  const visible = list.children[0].querySelector('input');
  visible.click();
  d.getElementById('board-audience').value = 'friends';
  d.getElementById('board-audience').dispatchEvent(new h.w.Event('change'));
  const save = d.getElementById('board-save');
  save.click();
  const packet = JSON.parse(h.run('JSON.stringify(sent.at(-1))'));
  assert.equal(packet.type, 'SaveProfileBoard');
  assert.equal(packet.payload.board.revision, 3);
  assert.equal(packet.payload.board.audience, 'friends');
  assert.deepEqual(packet.payload.board.widgets.map(w => w.kind), ['want_to_play','playing','about']);
  assert.equal(packet.payload.board.widgets[0].visible, false);
  assert.equal(save.disabled, true);
  await h.run('receive("ProfileBoardSaved", {board:{...sent.at(-1).payload.board, revision:4}})');
  assert.equal(d.getElementById('board-editor-status').textContent, 'Mural salvo.');
});

test('capa enviada pelo editor entra no rascunho e conflito conserva o trabalho local', async t => {
  const h = await setup(t), d = h.document;
  h.run(`
    globalThis.uploaded = [];
    uploadProfileImage = async (file, name) => { uploaded.push([file.size, name]); return "aa".repeat(16); };
  `);
  d.getElementById('open-board-editor').click();
  await h.run('receive("ProfileBoardState", {board:{revision:0,audience:"everyone",widgets:[]}})');
  d.getElementById('board-add-widget').click();
  await h.flush();
  d.querySelector('[data-gp-manual="1"]').click();
  await h.flush();
  const dlg = d.querySelector('.sancord-dialog');
  const named = name => dlg.querySelector(`[id^="f-${name}-"]`);
  named('name').value = 'Jogo da Ana';
  named('cover_action').value = 'upload';
  named('cover_action').dispatchEvent(new h.w.Event('change'));
  const file = new h.w.File(['PNG'], 'capa.png', {type:'image/png'});
  Object.defineProperty(named('cover'), 'files', {value:[file]});
  dlg.querySelector('form').dispatchEvent(new h.w.Event('submit', { cancelable:true }));
  await h.flush();
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(uploaded)')), [[3,'capa.png']]);
  assert.equal(h.run('boardEditor.draft.widgets[0].cover_id'), 'aa'.repeat(16));
  assert.notEqual(h.run('sent.at(-1).type'), 'SaveProfileBoard');

  const save = d.getElementById('board-save');
  save.click();
  await h.run('receive("ProfileBoardState", {board:{revision:1,audience:"friends",widgets:[]}})');
  await h.run('receive("ServerFeedback", {action:"profile_board",message:"O mural mudou em outra sessão.",ok:false})');
  assert.equal(save.disabled, true);
  assert.match(d.getElementById('board-editor-status').textContent, /outra sessão/);
  assert.match(d.getElementById('board-editor-widgets').textContent, /Jogo da Ana/);
});

test('aba mostra dados públicos na ordem do servidor com texto e links seguros', async t => {
  const h = await setup(t), d = h.document;
  h.run(`
    state.cosmetics = {badges:[{id:"alpha", name:"Alpha", description:"Participou do Alpha."}]};
    openMemberProfilePopover(null, {author_name:"Bia"});
  `);
  d.querySelector('[data-profile-tab="board"]').click();
  assert.equal(d.getElementById('profile-tab-board').classList.contains('hidden'), false);
  await h.run(`receive("UserProfile", {user:{username:"Bia"}, board:{widgets:[
    {kind:"favorite_game",visible:true,name:"Jogo A",description:"Aventura",cover_id:"ee".repeat(16)},
    {kind:"about",visible:true,text:"<b>Sobre</b>"},
    {kind:"achievements",visible:true},
    {kind:"link",visible:true,label:"Comunidade",url:"https://example.org/jogo"},
    {kind:"link",visible:true,label:"Inválido",url:"javascript:alert(1)"},
    {kind:"want_to_play",visible:true,name:"Rota Boreal"},
    {kind:"want_to_play",visible:false,name:"Jogo reservado"},
    {kind:"playing",visible:false,name:"Oculto"}
  ], achievements:["alpha"]}})`);
  const root = d.getElementById('profile-board-widgets');
  assert.deepEqual([...root.querySelectorAll('h3')].map(el => el.textContent), ['Jogo favorito', 'Sobre mim', 'Conquistas', 'Link', 'Quero jogar']);
  assert.match(root.querySelector('img').src, /attachments\/[a-f]{32}\/capa$/);
  assert.match(root.textContent, /<b>Sobre<\/b>/);
  assert.equal(root.querySelector('b'), null);
  assert.equal(root.querySelector('.profile-board-achievements li').textContent, 'Alpha');
  assert.equal(root.querySelector('a').href, 'https://example.org/jogo');
  d.querySelector('[data-profile-tab="wishlist"]').click();
  const wishlist = d.getElementById('profile-wishlist-widgets');
  assert.match(wishlist.textContent, /Rota Boreal/);
  assert.doesNotMatch(wishlist.textContent, /Jogo reservado|Jogo A/);
  await h.run('receive("UserProfile", {user:{username:"Bia"}})');
  assert.equal(root.textContent, 'Mural indisponível.');
  assert.equal(wishlist.textContent, 'Lista de desejos indisponível.');
});

test('bloco personalizado e marcos automáticos funcionam no editor e na aba do mural', async t => {
  const h = await setup(t), d = h.document;
  h.run(`
    globalThis.uploaded = [];
    uploadProfileImage = async (file, name) => { uploaded.push([file.size, name]); return "bb".repeat(16); };
  `);
  d.getElementById('open-board-editor').click();
  await h.run('receive("ProfileBoardState", {board:{revision:0,audience:"everyone",widgets:[]}})');
  d.getElementById('board-widget-kind').value = 'custom';
  d.getElementById('board-add-widget').click();
  const dlg = d.querySelector('.sancord-dialog');
  const named = name => dlg.querySelector(`[id^="f-${name}-"]`);
  named('title').value = 'Meu Projeto';
  named('emoji').value = '🚀';
  named('text').value = 'Construindo novidades no Sancord.';
  named('image_action').value = 'upload';
  named('image_action').dispatchEvent(new h.w.Event('change'));
  const file = new h.w.File(['PNG'], 'bloco.png', {type:'image/png'});
  Object.defineProperty(named('image'), 'files', {value:[file]});
  dlg.querySelector('form').dispatchEvent(new h.w.Event('submit', { cancelable:true }));
  await h.flush();
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(boardEditor.draft.widgets[0])')), {
    visible: true,
    kind: 'custom',
    title: 'Meu Projeto',
    emoji: '🚀',
    text: 'Construindo novidades no Sancord.',
    image_id: 'bb'.repeat(16),
  });

  h.run(`openMemberProfilePopover(null, {author_name:"Bia"})`);
  d.querySelector('[data-profile-tab="board"]').click();
  await h.run(`receive("UserProfile", {user:{username:"Bia"}, board:{widgets:[
    {kind:"custom",visible:true,title:"Setup",emoji:"✨",text:"Texto seguro",image_id:"cc".repeat(16)},
    {kind:"achievements",visible:true}
  ], achievements:["milestone_first_server","milestone_100_messages"]}})`);
  const root = d.getElementById('profile-board-widgets');
  assert.equal(root.querySelector('h3').textContent, '✨ Setup');
  assert.match(root.querySelector('img').src, /attachments\/[c]{32}\/imagem$/);
  assert.deepEqual([...root.querySelectorAll('.profile-board-achievements li')].map(el => el.textContent), [
    'Criador de comunidade',
    '100 mensagens',
  ]);
});
