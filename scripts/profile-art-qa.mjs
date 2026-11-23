import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const sampleAvatar = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#342e57"/><circle cx="55" cy="46" r="30" fill="#916cb1"/><path d="M29 80 64 20l17 39z" fill="#f0bbaf"/><path d="M27 76 58 45 75 73z" fill="#82d9cb"/><circle cx="24" cy="23" r="3" fill="#f7e4c8"/></svg>`);
const sampleBanner = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky"><stop stop-color="#20233e"/><stop offset="1" stop-color="#7866a8"/></linearGradient></defs><rect width="600" height="150" fill="url(#sky)"/><circle cx="462" cy="52" r="47" fill="#e8acae" opacity=".65"/><path d="M0 150V109L109 72l100 34 78-48 83 47 94-34 136 49v30z" fill="#3e3865"/><path d="M0 150v-12l131-29 142 29 149-31 178 24v19z" fill="#292744"/><path d="M102 43h3m235-17h3m190 25h3m-15 29h3" stroke="#e9eafe" stroke-linecap="round"/></svg>`);

// Called by profile-motion-qa.mjs inside the isolated Windows WebView2 instance.
export async function runProfileArtQa(page, evaluate) {
  const destination = resolve(process.env.SANCORD_QA_SCREENSHOTS || 'qa-profile-redesign');
  await mkdir(destination, { recursive: true });
  async function screenshot(name, clip) {
    await evaluate(`new Promise(resolve => setTimeout(resolve, 170))`);
    const { data } = await page('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
    await writeFile(resolve(destination, `${name}.png`), Buffer.from(data, 'base64'));
  }
  async function size(width, height) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await page('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1366, 768);
  await evaluate(`(() => {
    state.audioSettings.profileAnimations = 'always';
    state.audioSettings.reduceMotion = false;
    applyProfileVisualSettings();
    document.getElementById('login-modal').classList.add('hidden');
    state.selfUser = { id:'qa-self', username:'Lume', display_name:'Lume', status_kind:'online', online:true,
      bio:'Crio ilustrações e exploro mapas com amigos.\\n\\n*Deixe um oi por aqui.*', avatar_color:'#525589',
      created_at:'19/11/2026', pronouns:'ela/dela', custom_status:'Mapeando novas rotas', badges:['early_user'] };
    state.users.set('qa-self', state.selfUser);
    globalThis.artFixture = { ...state.selfUser, avatar_url:${JSON.stringify(sampleAvatar)}, banner_url:${JSON.stringify(sampleBanner)},
      avatar_decoration:'galaxy-portal', profile_frame:'cosmic-drift',
      profile_effect:'star-trail', name_style:'custom-gradient', name_color:'#c9b8ff', name_color_secondary:'#8eede0',
      nameplate_style:'core-stripe', theme_primary:'#241e3c', theme_accent:'#302d4d', theme_highlight:'#9ea0eb' };
    globalThis.openArtFixture = appearance => {
      closeCompactProfile(false);
      openCompactProfile('qa-self', {author_name:'Lume'}, document.getElementById('self-avatar'));
      renderCompactProfileReply({user:{...state.selfUser, ...appearance}, server_id:null,
        links:[{label:'Portfólio',url:'https://example.org/lume'}]});
    };
    globalThis.artMetrics = () => {
      const card = document.querySelector('.compact-profile-dialog');
      const rect = name => card.querySelector('[data-profile-slot="'+name+'"]').getBoundingClientRect().toJSON();
      return { card:card.getBoundingClientRect().toJSON(), banner:rect('banner'), avatar:rect('avatar'),
        clipping:card.scrollWidth > card.clientWidth, width:innerWidth, height:innerHeight,
        playing:card.querySelector('.profile-effect-layer').classList.contains('is-playing') };
    };
  })()`);

  const motifs = [
    ['01-sem-cosmeticos', {}],
    ['02-decoracao-core', { avatar_decoration:'core-orbit', avatar_url:sampleAvatar }],
    ['03-moldura-sakura', { profile_frame:'sakura-wind' }],
    ['04-nome-gradiente', { name_style:'custom-gradient', name_color:'#c9b8ff', name_color_secondary:'#8eede0' }],
  ];
  for (const [file, appearance] of motifs) {
    await evaluate(`openArtFixture(${JSON.stringify(appearance)})`);
    await screenshot(file);
  }
  await evaluate('openArtFixture(artFixture)');
  const metrics = await evaluate('artMetrics()');
  assert.ok(metrics.playing, 'efeito inicia na abertura');
  assert.ok(!metrics.clipping && metrics.avatar.left - metrics.banner.left < 28, 'avatar alinhado à esquerda');
  assert.ok(metrics.banner.width >= metrics.card.width - 4, 'banner ocupa a largura interna do cartão');
  assert.ok(metrics.avatar.top < metrics.banner.bottom && metrics.avatar.bottom > metrics.banner.bottom, 'avatar cruza o limite inferior do banner');
  assert.ok(await evaluate(`(() => {
    const host = document.getElementById('compact-profile-content');
    const status = host.querySelector('.compact-profile-status');
    const since = host.querySelector('[data-profile-since]');
    return !status.hidden && !since.hidden &&
      Boolean(status.compareDocumentPosition(since) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`), 'status e data aparecem na ordem do cartão');
  await evaluate(`document.querySelector('.compact-profile-dialog .profile-effect-layer').getAnimations().forEach(a => { a.pause(); a.currentTime = 550; })`);
  await screenshot('05-efeito-entrada');
  const { x, y, width, height } = metrics.card;
  await screenshot('05b-cartao-cosmic', { x: x - 12, y: Math.floor(y) - 12, width: width + 24, height: Math.ceil(height) + 20, scale: 1 });
  for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440]]) {
    await size(width, height);
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate('applyProfileAnimPolicy()');
    const { card, clipping, playing } = await evaluate(`new Promise(resolve => requestAnimationFrame(() => {
      positionCompactProfile();
      resolve(artMetrics());
    }))`);
    assert.ok(!playing && !clipping && card.left >= 0 && card.right <= width && card.top >= 0 && card.bottom <= height,
      `cartão contido e estático em ${width}×${height}: ${JSON.stringify({ card, clipping, playing })}`);
    await screenshot(`06-combinacao-${width}`);
  }

  await size(1366, 768);
  await evaluate(`(() => {
    closeCompactProfile(false);
    state.selfUser = artFixture;
    state.users.set('qa-self', state.selfUser);
    openMemberProfilePopover('qa-self');
    onUserProfile({user: state.selfUser, server_id:null, bio_visible:true, banner_visible:true});
  })()`);
  await screenshot('07-perfil-completo');
  await evaluate(`(() => {
    document.getElementById('close-profile-card-btn').click();
    openSettingsModal('profile');
    document.getElementById('pe-context-toggle').click();
    const theme = document.getElementById('profile-preview-theme');
    theme.value = 'light';
    theme.dispatchEvent(new Event('change'));
  })()`);
  assert.equal(await evaluate(`document.getElementById('pe-context-popover').dataset.previewTheme`), 'light');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#profile-context-preview .compact-profile-bio')).color`),
    'rgb(240, 238, 251)', 'texto claro com fundo personalizado escuro, inclusive na prévia clara');
  await screenshot('08-editor-tema-claro');
  await evaluate(`loadAppearanceDraft({...artFixture, theme_primary:null, theme_accent:null, theme_highlight:null, name_style:'default', name_color:null}); refreshLiveProfilePreview()`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#profile-context-preview .profile-card')).backgroundColor`), 'rgb(250, 247, 252)');
  assert.ok(await evaluate(`(() => {
    const preview = document.getElementById('profile-context-preview').getBoundingClientRect();
    return preview.width > 0 && preview.right <= innerWidth;
  })()`), 'a prévia contextual permanece dentro da janela');
  await screenshot('08b-editor-tema-claro-sem-tema-proprio');
  await evaluate(`document.getElementById('pe-context-close').click()`);
  await evaluate('loadAppearanceDraft(artFixture); refreshLiveProfilePreview()');
  await evaluate(`(() => {
    onCosmeticsState({catalog:[
      {kind:'profile_frame',id:'core-pulse',name:'Pulso Core',collection:'sancord-core',animated:true,availability:'free'},
      {kind:'profile_frame',id:'cosmic-drift',name:'Deriva Cósmica',collection:'cosmic',animated:true,availability:'free'},
      {kind:'profile_frame',id:'sakura-wind',name:'Vento Sakura',collection:'sakura',animated:true,availability:'free'},
    ],owned:['profile_frame:core-pulse','profile_frame:cosmic-drift','profile_frame:sakura-wind'],badges:[]});
    openCosmeticPicker('profile_frame');
  })()`);
  await screenshot('09-seletor-molduras');
  await evaluate(`(() => {
    closeCosmeticPicker();
    state.servers = [{id:'qa-srv',name:'Estação Lume',member_nicks:{lume:'Lume da Estação'},
      member_profiles:{lume:{bio:'Ilustração colaborativa neste servidor.',profile_frame:'core-pulse'}}}];
    document.querySelector('[data-profile-subtab="server"]').click();
    document.getElementById('settings-server-profile-edit-btn').click();
  })()`);
  assert.match(await evaluate(`document.querySelector('.server-profile-dialog-preview').textContent`), /Lume da Estação/);
  await screenshot('10-editor-por-servidor');

  await evaluate(`(() => {
    document.querySelector('.sancord-dialog .modal-actions-row .btn-secondary').click();
    document.querySelector('[data-profile-subtab="global"]').click();
    document.querySelector('[data-pe-open="name"]').click();
    document.querySelector('[data-style-part="font"][data-style-sample="retro"]').click();
    document.querySelector('[data-pe-name-tab="effects"]').click();
    document.querySelector('[data-style-part="effect"][data-style-sample="neon"]').click();
  })()`);
  assert.equal(await evaluate('profileDraft.name_style'), 'retro+neon');
  assert.equal(await evaluate(`document.getElementById('preview-card-name').dataset.nameFont`), 'retro');
  await screenshot('11-fonte-e-efeito');
  await evaluate(`document.querySelector('[data-pe-view="name"] .pe-back').click()`);
  assert.equal(await evaluate('profileDraft.name_style'), 'custom-gradient', 'cancelar restaura o perfil no mesmo desktop');

  await evaluate(`(() => {
    receiveBoardEditorState({ widgets: [{ kind:'want_to_play', name:'Rota Boreal', visible:true }], audience:'everyone' });
    document.getElementById('pe-tab-wishlist').click();
  })()`);
  assert.match(await evaluate(`document.getElementById('pe-wishlist-widgets').textContent`), /Rota Boreal/);
  await screenshot('12-lista-de-desejos');
  await evaluate(`(() => {
    document.getElementById('settings-modal').classList.add('hidden');
    document.getElementById('self-profile-trigger').click();
  })()`);
  assert.ok(await evaluate(`!document.getElementById('self-profile-menu').classList.contains('hidden')`));
  await screenshot('13-menu-do-proprio-perfil');
  console.log(JSON.stringify({ screenshots:destination, resolutions:[1366,1920,2560], metrics }));
}

async function waitForProfileQa(label, read) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const ready = await read();
    if (ready) return ready;
    await delay(100);
  }
  throw Error(`Timeout no QA de perfil: ${label}`);
}

export async function registerProfileQaAccount(endpoint, username) {
  await waitForProfileQa('backend isolado', async () => (await fetch(endpoint + '/api/health').catch(() => null))?.ok);
  const password = 'qa-' + randomUUID();
  const response = await fetch(endpoint + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.ok(response.ok, `Cadastro de QA: HTTP ${response.status}`);
  const { token } = await response.json();
  assert.ok(token, 'token descartável recebido do backend');
  return { username, password, token };
}

function readProfileAs(endpoint, account, username) {
  const socket = new WebSocket(endpoint.replace('http:', 'ws:') + '/ws');
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Error('Perfil do QA indisponível pelo WebSocket')), 7000);
    const send = (type, payload) => socket.send(JSON.stringify({ type, payload }));
    socket.addEventListener('error', () => reject(Error('Falha ao consultar perfil do QA')), { once: true });
    socket.addEventListener('open', () => send('JoinServer', { token: account.token }), { once: true });
    socket.addEventListener('message', ({ data }) => {
      const { type, payload } = JSON.parse(data);
      if (type === 'Welcome') send('GetUserProfile', { username });
      if (type === 'UserProfile' && payload.user.username === username) resolve(payload);
    });
    socket.addEventListener('close', () => reject(Error('Conexão de QA encerrada antes da resposta')), { once: true });
  }).finally(() => {
    clearTimeout(timer);
    socket.close();
  });
}

export async function runLiveProfileQa(page, evaluate, endpoint, account, viewer) {
  await page('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    document.getElementById('tab-login').click();
    usernameInput.value = ${JSON.stringify(account.username)};
    passwordInput.value = ${JSON.stringify(account.password)};
    loginForm.requestSubmit();
  })()`);
  await waitForProfileQa('login e catálogo', () => evaluate('state.selfUser?.username === "LumeQA" && state.cosmetics.loaded'));
  await evaluate(`(() => {
    document.getElementById('self-profile-trigger').click();
    document.getElementById('spm-status-trigger').click();
    document.querySelector('[data-status-option="idle"]').click();
    openSettingsModal('profile');
  })()`);
  await waitForProfileQa('mural carregado', () => evaluate('Boolean(boardEditor.draft)'));
  await evaluate(`(() => {
    const click = selector => document.querySelector(selector).click();
    click('#open-decoration-picker-btn');
    click('[data-pe-gallery="avatar_decoration"] [data-id="core-orbit"]');
    click('[data-pe-view="decoration"] .pe-back');
  })()`);
  assert.equal(await evaluate('profileDraft.avatar_decoration'), 'none', 'cancelar restaura o tema original');
  await evaluate(`(() => {
    const click = selector => document.querySelector(selector).click();
    click('#open-decoration-picker-btn');
    click('[data-pe-gallery="avatar_decoration"] [data-id="core-orbit"]');
    click('[data-pe-view="decoration"] .pe-chooser-actions .btn-primary');
    click('[data-pe-open="name"]');
    click('[data-style-part="font"][data-style-sample="retro"]');
    click('[data-pe-name-tab="effects"]');
    click('[data-style-part="effect"][data-style-sample="custom-gradient"]');
    click('[data-pe-view="name"] .pe-chooser-actions .btn-primary');
    click('#pe-tab-wishlist');
    click('#pe-add-wishlist');
    const form = document.querySelector('.sancord-dialog form');
    form.querySelector('input').value = 'Rota Boreal';
    form.requestSubmit();
  })()`);
  await waitForProfileQa('jogo no rascunho', () => evaluate('boardEditor.draft.widgets.some(w => w.name === "Rota Boreal")'));
  await evaluate(`document.getElementById('save-profile-btn').click()`);
  await waitForProfileQa('confirmação do mural', () => evaluate('boardEditor.base.widgets.some(w => w.name === "Rota Boreal") && !boardEditor.saving'));
  const visible = await readProfileAs(endpoint, viewer, account.username);
  assert.equal(visible.user.name_style, 'retro+custom-gradient');
  assert.equal(visible.user.avatar_decoration, 'core-orbit');
  assert.equal(visible.user.status_kind, 'idle');
  assert.ok(visible.board.widgets.some(widget => widget.kind === 'want_to_play' && widget.name === 'Rota Boreal'));
  const destination = resolve(process.env.SANCORD_QA_SCREENSHOTS || 'qa-profile-redesign');
  await mkdir(destination, { recursive: true });
  const { data } = await page('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(resolve(destination, '14-perfil-salvo-backend-real.png'), Buffer.from(data, 'base64'));
  console.log('WebView2 + backend Rust: cancelamento, presença, decoração, fonte+efeito, mural e consulta por outra conta validados.');
}
