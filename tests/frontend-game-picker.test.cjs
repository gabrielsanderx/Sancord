const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

const MOCK_CATALOG = [
  { id: 'sancord:minecraft', title: 'Minecraft', cover_url: null, release_year: 2011, platforms: ['PC', 'Console'] },
  { id: 'steam:1245620', title: 'ELDEN RING', cover_url: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg', release_year: 2022, platforms: ['PC', 'PlayStation'] },
  { id: 'steam:730', title: 'Counter-Strike 2', cover_url: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg', release_year: 2023, platforms: ['PC'] },
  { id: 'steam:999001', title: 'Resident Evil 4', cover_url: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2050650/header.jpg', release_year: 2023, platforms: ['PC', 'PlayStation'] },
  { id: 'steam:999002', title: 'Resident Evil 4 (2005)', cover_url: null, release_year: 2005, platforms: ['PC'] },
  { id: 'steam:999003', title: 'Super Ultra Mega Campeonato de Corrida Intergaláctica Deluxe Edition 2026', cover_url: null, release_year: 2026, platforms: ['PC'] },
];

async function setup(t, { fetchImpl = null } = {}) {
  const h = await openInterface(t);
  h.w.fetch = fetchImpl || (async (url) => {
    const u = String(url);
    if (u.includes('/api/games/popular')) {
      return { ok: true, json: async () => ({ ok: true, games: MOCK_CATALOG }) };
    }
    if (u.includes('/api/games/search')) {
      const parsed = new URL(u, 'https://sancord.invalid');
      const q = (parsed.searchParams.get('q') || '').toLowerCase();
      const hits = MOCK_CATALOG.filter((g) => g.title.toLowerCase().includes(q));
      return { ok: true, json: async () => ({ ok: true, games: hits }) };
    }
    if (u.includes('/api/games/resolve')) {
      return { ok: true, json: async () => ({ ok: true, game: null }) };
    }
    throw new Error('Endpoint inesperado: ' + u);
  });
  h.run(`
    SancordGamePicker.resetCacheForTests();
    state.selfUser = { id:"swag", username:"Swag", avatar_color:"#6452e1" };
    globalThis.sent = [];
    sendWs = (type, payload) => { sent.push(JSON.parse(JSON.stringify({type, payload}))); return true; };
    globalThis.receive = (type, payload) => handleServerMessage({type, payload});
  `);
  return h;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('GamePicker: pesquisar Minecraft, adicionar nota, prévia e salvar Jogo favorito sem formulário manual', async (t) => {
  const h = await setup(t), d = h.document;
  d.getElementById('open-board-editor').click();
  await h.run('receive("ProfileBoardState", {board:{revision:1, audience:"everyone", widgets:[]}})');

  d.getElementById('board-widget-kind').value = 'favorite_game';
  d.getElementById('board-add-widget').click();
  await h.flush();

  const dialog = d.querySelector('[data-game-picker="1"]');
  assert.ok(dialog, 'deve abrir o GamePicker');
  const input = dialog.querySelector('.gp-search-input');
  input.value = 'Minecraft';
  input.dispatchEvent(new h.w.Event('input'));
  await wait(300);
  await h.flush();

  const mineCard = dialog.querySelector('[data-game-id="sancord:minecraft"]');
  assert.ok(mineCard, 'deve encontrar Minecraft na busca');
  mineCard.click();

  // Jogo sem capa usa fallback limpo (nenhuma <img> quebrada)
  assert.ok(mineCard.querySelector('.gp-cover-fallback'));
  const noteInput = dialog.querySelector('.gp-note-field textarea');
  noteInput.value = 'Construindo castelos desde 2012';
  noteInput.dispatchEvent(new h.w.Event('input'));
  assert.match(dialog.querySelector('.gp-preview-card').textContent, /Minecraft/);
  assert.match(dialog.querySelector('.gp-preview-card').textContent, /Construindo castelos/);

  dialog.querySelector('[data-gp-save="1"]').click();
  await h.flush();

  const widget = JSON.parse(h.run('JSON.stringify(boardEditor.draft.widgets[0])'));
  assert.equal(widget.kind, 'favorite_game');
  assert.equal(widget.name, 'Minecraft');
  assert.equal(widget.game_id, 'sancord:minecraft');
  assert.equal(widget.description, 'Construindo castelos desde 2012');
  assert.equal(widget.release_year, 2011);
  // Recentes foi salvo para a próxima abertura
  assert.equal(h.run('SancordGamePicker.loadRecents()[0].id'), 'sancord:minecraft');
});

test('GamePicker: trocar jogo favorito preserva antigo ao cancelar e permite remover pelo editor', async (t) => {
  const h = await setup(t), d = h.document;
  d.getElementById('open-board-editor').click();
  await h.run(`receive("ProfileBoardState", {board:{revision:2, audience:"everyone", widgets:[
    {kind:"favorite_game", visible:true, name:"ELDEN RING", description:"", cover_id:null, game_id:"steam:1245620"}
  ]}})`);

  // Abre edição, seleciona outro jogo, mas CANCELA
  d.querySelector('#board-editor-widgets [data-action="edit"]').click();
  await h.flush();
  const dlg1 = d.querySelector('[data-game-picker="1"]');
  dlg1.querySelector('[data-game-id="steam:730"]').click();
  dlg1.querySelector('[data-gp-cancel="1"]').click();
  await h.flush();
  assert.equal(h.run('boardEditor.draft.widgets[0].name'), 'ELDEN RING');

  // Abre de novo e troca salvando (também testa múltiplos resultados semelhantes + título longo)
  d.querySelector('#board-editor-widgets [data-action="edit"]').click();
  await h.flush();
  const dlg2 = d.querySelector('[data-game-picker="1"]');
  const input = dlg2.querySelector('.gp-search-input');
  input.value = 'Resident Evil 4';
  input.dispatchEvent(new h.w.Event('input'));
  await wait(300);
  await h.flush();
  assert.ok(dlg2.querySelector('[data-game-id="steam:999001"]'));
  assert.ok(dlg2.querySelector('[data-game-id="steam:999002"]'));
  dlg2.querySelector('[data-game-id="steam:999002"]').click();
  dlg2.querySelector('[data-gp-save="1"]').click();
  await h.flush();
  assert.equal(h.run('boardEditor.draft.widgets[0].name'), 'Resident Evil 4 (2005)');

  // Remove pelo botão "Remover do Mural" dentro do GamePicker
  d.querySelector('#board-editor-widgets [data-action="edit"]').click();
  await h.flush();
  d.querySelector('[data-gp-remove="1"]').click();
  await h.flush();
  assert.equal(h.run('boardEditor.draft.widgets.length'), 0);
});

test('GamePicker: erro de API mostra retry funcional e modo offline exibe catálogo local + recentes', async (t) => {
  let failNext = true;
  const h = await setup(t, {
    fetchImpl: async (url) => {
      if (failNext) throw new Error('offline');
      return {
        ok: true,
        json: async () => ({ ok: true, games: MOCK_CATALOG }),
      };
    },
  });
  const d = h.document;
  d.getElementById('open-board-editor').click();
  await h.run('receive("ProfileBoardState", {board:{revision:0, audience:"everyone", widgets:[]}})');
  d.getElementById('board-widget-kind').value = 'want_to_play';
  d.getElementById('board-add-widget').click();
  await h.flush();

  const dlg = d.querySelector('[data-game-picker="1"]');
  // Modo offline mostra aviso e catálogo local embutido
  assert.match(dlg.textContent, /Modo offline/);
  assert.ok(dlg.querySelector('[data-game-id="sancord:minecraft"]'));

  // Busca com erro na API exibe botão "Tentar novamente"
  const input = dlg.querySelector('.gp-search-input');
  input.value = 'Super Ultra Mega';
  input.dispatchEvent(new h.w.Event('input'));
  await wait(300);
  await h.flush();
  const retry = dlg.querySelector('[data-gp-retry="1"]');
  assert.ok(retry, 'deve exibir botão Tentar novamente');

  // Restaura rede e clica em Tentar novamente
  failNext = false;
  retry.click();
  await h.flush();
  const longCard = dlg.querySelector('[data-game-id="steam:999003"]');
  assert.ok(longCard, 'retry deve carregar resultados');
  assert.match(longCard.title, /Super Ultra Mega/);
  dlg.querySelector('[data-gp-cancel="1"]').click();
});

test('Jogando agora sincroniza automaticamente com Activity ao vivo, exibe tempo real e limpa ao fechar jogo sem alterar Jogo favorito', async (t) => {
  const h = await setup(t), d = h.document;
  const startedAt = Date.now() - 45 * 60 * 1000;
  h.run(`
    SancordActivity.applyNativeSnapshot({
      supported: true,
      config: { detect_games: true, share_activity: true },
      detected: { name: "ELDEN RING", exe_name: "eldenring.exe", started_at: ${startedAt} },
      registered: [{ exe_name: "hades.exe", display_name: "Hades", enabled: true }],
      candidates: []
    });
  `);

  d.getElementById('open-board-editor').click();
  await h.run(`receive("ProfileBoardState", {board:{revision:1, audience:"everyone", widgets:[
    {kind:"favorite_game", visible:true, name:"Minecraft", description:"", cover_id:null, game_id:"sancord:minecraft"}
  ]}})`);

  // Adiciona widget Jogando agora -> toggle automático vem ligado por padrão e mostra jogo detectado + PC
  d.getElementById('board-widget-kind').value = 'playing';
  d.getElementById('board-add-widget').click();
  await h.flush();
  const dlg = d.querySelector('[data-game-picker="1"]');
  assert.equal(dlg.querySelector('#gp-auto-activity').checked, true);
  assert.match(dlg.querySelector('.gp-detected-card').textContent, /ELDEN RING/);
  assert.match(dlg.textContent, /Jogos detectados no seu PC/);
  dlg.querySelector('[data-gp-save="1"]').click();
  await h.flush();

  const preview = d.getElementById('pe-board-widgets');
  const playingCard = preview.querySelector('[data-widget-kind="playing"]');
  assert.ok(playingCard.classList.contains('is-live-playing'));
  assert.match(playingCard.textContent, /ELDEN RING/);
  assert.match(playingCard.textContent, /há 45 minutos/);
  // Jogo favorito permanece fixo em Minecraft
  assert.match(preview.querySelector('[data-widget-kind="favorite_game"]').textContent, /Minecraft/);

  // Fecha o jogo no PC -> Jogando agora muda para estado discreto sem apagar o widget; Jogo favorito não muda
  h.run(`
    SancordActivity.applyNativeSnapshot({
      supported: true,
      config: { detect_games: true, share_activity: true },
      detected: null,
      registered: [{ exe_name: "hades.exe", display_name: "Hades", enabled: true }],
      candidates: []
    });
  `);
  const afterClose = d.getElementById('pe-board-widgets').querySelector('[data-widget-kind="playing"]');
  assert.ok(afterClose.classList.contains('is-auto-idle'));
  assert.match(afterClose.textContent, /Nenhum jogo no momento/);
  assert.equal(h.run('boardEditor.draft.widgets.some(w => w.kind === "playing" && w.auto_activity)'), true);
  assert.match(d.getElementById('pe-board-widgets').querySelector('[data-widget-kind="favorite_game"]').textContent, /Minecraft/);
});

test('Lista de desejos (#pe-add-wishlist) reutiliza o mesmo GamePicker central', async (t) => {
  const h = await setup(t), d = h.document;
  d.getElementById('open-board-editor').click();
  await h.run('receive("ProfileBoardState", {board:{revision:0, audience:"everyone", widgets:[]}})');
  d.getElementById('pe-add-wishlist').click();
  await h.flush();
  const dlg = d.querySelector('[data-game-picker="1"]');
  assert.ok(dlg);
  dlg.querySelector('[data-game-id="steam:730"]').click();
  dlg.querySelector('[data-gp-save="1"]').click();
  await h.flush();
  assert.match(d.getElementById('pe-wishlist-widgets').textContent, /Counter-Strike 2/);
  assert.equal(h.run('boardEditor.draft.widgets[0].kind'), 'want_to_play');
  assert.equal(h.run('boardEditor.draft.widgets[0].game_id'), 'steam:730');
});
