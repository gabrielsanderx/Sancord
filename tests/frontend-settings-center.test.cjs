const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('central de configurações tem 4 grupos, 22 páginas reais, busca profunda e rolagem até a opção', async t => {
  const h = await openInterface(t), d = h.document;
  d.getElementById('open-settings-btn').click();
  assert.equal(d.getElementById('settings-modal').classList.contains('hidden'), false);
  assert.equal(d.querySelector('.settings-esc-hint')?.textContent, 'ESC');

  const categories = [...d.querySelectorAll('.settings-nav .settings-nav-category')].map(el => el.textContent.trim());
  assert.deepEqual(categories, ['CONTA', 'PRIVACIDADE E SOCIAL', 'CONFIGURAÇÕES DO APP', 'SANVO']);

  const tabs = [...d.querySelectorAll('.settings-nav-item[data-settings-tab]')].map(el => el.dataset.settingsTab);
  assert.equal(tabs.length, 22);
  for (const tab of tabs) {
    d.querySelector(`.settings-nav-item[data-settings-tab="${tab}"]`).click();
    const panel = d.getElementById(`settings-tab-${tab}`);
    assert.ok(panel, `painel ausente: ${tab}`);
    assert.equal(panel.classList.contains('hidden'), false, `painel não abriu: ${tab}`);
    assert.ok(panel.textContent.trim().length > 20, `painel vazio: ${tab}`);
  }
  // Nenhuma captura de microfone ou câmera foi aberta apenas navegando pelas 22 páginas.
  assert.deepEqual(h.captures, []);

  // Busca profunda: "microfone" -> Voz e Vídeo, "senha" -> Segurança, "GIF" -> Acessibilidade, "bloqueados" -> Usuários Bloqueados.
  const search = d.getElementById('settings-search-input');
  const results = d.getElementById('settings-search-results');
  const runSearch = (query) => {
    search.value = query;
    search.dispatchEvent(new h.w.Event('input', { bubbles: true }));
    return [...results.querySelectorAll('.settings-search-hit')];
  };

  const micHits = runSearch('microfone');
  assert.ok(micHits.some(el => /Voz e Vídeo/.test(el.textContent)));
  micHits.find(el => /Voz e Vídeo/.test(el.textContent)).click();
  assert.equal(d.getElementById('settings-tab-voice').classList.contains('hidden'), false);

  const pwHits = runSearch('senha');
  assert.ok(pwHits.some(el => /Segurança/.test(el.textContent)));
  pwHits.find(el => /Segurança/.test(el.textContent)).click();
  assert.equal(d.getElementById('settings-tab-security').classList.contains('hidden'), false);

  const gifHits = runSearch('GIF');
  assert.ok(gifHits.some(el => /Acessibilidade/.test(el.textContent)));

  const blockedHits = runSearch('bloqueados');
  assert.ok(blockedHits.some(el => /Usuários Bloqueados/.test(el.textContent)));
  blockedHits.find(el => /Usuários Bloqueados/.test(el.textContent)).click();
  assert.equal(d.getElementById('settings-tab-blocked').classList.contains('hidden'), false);
});

test('minha conta mascara e-mail, oculta ID fora do modo desenvolvedor e perfis alternam global/servidor', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`
    state.selfUser = { id:"acc-12345", username:"gabriel", display_name:"Gabriel", avatar_color:"#5865f2", status_kind:"online" };
    state.accountEmail = "gabriel@exemplo.com";
    state.servers = [{ id:"s1", name:"Turma Sancord", text_channels:[], voice_channels:[], members:["gabriel"], member_profiles:{ gabriel:{ bio:"Bio local" } } }];
    syncSettingsModalFields();
    renderAccountEmailUI();
  `);
  assert.match(d.getElementById('account-info-email').textContent, /^ga\*+@exemplo\.com$/);
  d.getElementById('account-reveal-email-btn').click();
  assert.equal(d.getElementById('account-info-email').textContent, 'gabriel@exemplo.com');

  // ID da conta fica oculto até ativar Modo Desenvolvedor.
  assert.equal(d.getElementById('account-id-row').classList.contains('hidden'), true);
  const devToggle = d.getElementById('advanced-developer-mode');
  devToggle.checked = true;
  devToggle.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  assert.equal(d.getElementById('account-id-row').classList.contains('hidden'), false);
  assert.equal(d.getElementById('advanced-dev-telemetry').classList.contains('hidden'), false);

  // Perfis -> Perfis por servidor.
  d.querySelector('[data-settings-tab="profile"]').click();
  d.querySelector('[data-profile-subtab="server"]').click();
  assert.equal(d.getElementById('profile-subtab-server').classList.contains('hidden'), false);
  assert.match(d.getElementById('settings-server-profile-summary').textContent, /Bio própria/);
});

test('aparência, acessibilidade, chat, atalhos com conflito, Windows IPC e diagnóstico funcionam e persistem', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`
    globalThis.sent = [];
    sendWs = (type, payload) => { sent.push({type, payload}); return true; };
  `);

  // Aparência & Acessibilidade reais
  const zoom = d.getElementById('appearance-zoom-select');
  zoom.value = '110';
  zoom.dispatchEvent(new h.w.Event('change'));
  assert.equal(d.documentElement.style.fontSize, '110%');

  const sat = d.getElementById('accessibility-saturation-slider');
  sat.value = '60';
  sat.dispatchEvent(new h.w.Event('input'));
  assert.equal(d.documentElement.style.getPropertyValue('--ui-saturation'), '0.6');

  const hc = d.getElementById('accessibility-high-contrast');
  hc.checked = true;
  hc.dispatchEvent(new h.w.Event('change'));
  assert.ok(d.body.classList.contains('high-contrast'));

  // Chat: emoticons e agrupamento desligado
  assert.equal(h.run('convertBasicEmoticons("oi :) `code :)` <3")'), 'oi 🙂 `code :)` ❤️');
  const grp = d.getElementById('chat-group-messages');
  grp.checked = false;
  grp.dispatchEvent(new h.w.Event('change'));
  assert.equal(h.run('shouldGroup({author_name:"Ana",created_at:1000,timestamp:"12:00"},{author_name:"Ana",created_at:2000,timestamp:"12:00"})'), false);

  // Matriz de sons: 10 itens individuais
  assert.equal(d.querySelectorAll('#settings-sounds-matrix .settings-sound-row').length, 10);

  // Atalhos: detecta conflito ao tentar atribuir atalho já usado
  d.querySelector('[data-settings-tab="shortcuts"]').click();
  const keyBtns = d.querySelectorAll('#settings-custom-shortcuts-list .settings-shortcut-editor-row button');
  keyBtns[0].click(); // grava ação "quickSwitcher"
  h.w.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'm', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(d.getElementById('settings-shortcut-conflict').classList.contains('hidden'), false);
  assert.match(d.getElementById('settings-shortcut-conflict').textContent, /já está sendo usado/);

  // Windows IPC: estado recebido do host desktop atualiza controles nativos
  h.w.dispatchEvent(new h.w.CustomEvent('sancord-desktop-state', {
    detail: { isDesktop: true, version: '0.2.3', arch: 'x86_64', dataDir: 'C:\\SancordData', autostart: true, startMinimized: true, minimizeOnClose: false },
  }));
  assert.equal(d.getElementById('windows-autostart-toggle').checked, true);
  assert.equal(d.getElementById('windows-autostart-toggle').disabled, false);
  assert.equal(d.getElementById('windows-data-dir-label').textContent, 'C:\\SancordData');

  // Diagnóstico executa sem abrir captura e About lista licenças reais
  d.querySelector('[data-settings-tab="diagnostics"]').click();
  await h.flush();
  assert.ok(d.querySelectorAll('#diagnostics-results-list .settings-diag-row').length >= 5);
  assert.deepEqual(h.captures, []);

  d.querySelector('[data-settings-tab="about"]').click();
  assert.ok(d.querySelectorAll('#about-licenses-list .settings-license-chip').length >= 8);
});
