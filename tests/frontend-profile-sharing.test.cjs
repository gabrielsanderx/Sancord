const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('configura visibilidade e cria conexão oculta por padrão', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`
    state.selfUser = {id:"ana",username:"Ana"};
    globalThis.sent = [];
    sendWs = (type,payload) => { sent.push(JSON.parse(JSON.stringify({type,payload}))); return true; };
    switchSettingsTab("privacy");
    receiveProfileSharing({privacy:{},links:[]});
  `);
  assert.equal(h.run('sent[0].type'), 'GetProfileSharing');
  const form = d.getElementById('profile-privacy-form');
  form.querySelector('[name="audience"]').value = 'friends';
  form.querySelector('[name="activity"]').value = 'only_me';
  form.dispatchEvent(new h.w.Event('submit', {cancelable:true}));
  assert.equal(h.run('sent.at(-1).payload.privacy.audience'), 'friends');
  assert.equal(h.run('sent.at(-1).payload.privacy.activity'), 'only_me');
  d.getElementById('add-profile-link').click();
  const dialog = d.querySelector('.sancord-dialog form');
  dialog.querySelector('[id^="f-label"]').value = 'Projeto';
  dialog.querySelector('[id^="f-url"]').value = 'https://example.org';
  dialog.dispatchEvent(new h.w.Event('submit', {cancelable:true}));
  await h.flush();
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(sent.at(-1))')), {
    type:'SetProfileLink', payload:{id:null,label:'Projeto',url:'https://example.org/',visible:false},
  });
});

test('cartão rápido abre o perfil completo e mantém campos revogados fora do DOM', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`
    state.selfUser = {id:"ana",username:"Ana",avatar_color:"#5865f2"};
    state.activeView = "server"; state.activeServerId = "s1";
    state.servers = [{id:"s1",members:["ana","bia"],text_channels:[{id:"c1"}], member_nicks:{bia:"Bia local"},
      member_profiles:{bia:{bio:"bio antiga de servidor",banner:{url:"/api/attachments/ab/antigo.png",animated:false}}}}];
    globalThis.sent = [];
    sendWs = (type,payload) => { sent.push({type,payload}); return true; };
    openCompactProfile(null,{author_name:"Bia",channel_id:"c1"});
  `);
  const quick = d.getElementById('compact-profile-modal');
  assert.equal(quick.classList.contains('hidden'), false);
  assert.equal(d.getElementById('compact-profile-title').textContent, 'Bia local');
  assert.doesNotMatch(quick.textContent, /bio antiga/);
  h.run(`onUserProfile({user:{username:"Bia",bio:"bio global"}, server_id:"s1", bio_visible:false, banner_visible:false})`);
  assert.doesNotMatch(quick.textContent, /bio antiga|bio global/);
  assert.equal(quick.querySelector('.profile-card-banner img'), null);
  h.run('state.prefs = {user_notes:{}}');
  const note = quick.querySelector('.compact-profile-note textarea');
  note.value = 'Jogar em grupo';
  note.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.equal(h.run('sent.at(-1).payload.user_notes.bia'), 'Jogar em grupo');
  d.getElementById('compact-full-profile').click();
  assert.equal(quick.classList.contains('hidden'), true);
  assert.equal(d.getElementById('profile-popover-modal').classList.contains('hidden'), false);
  assert.equal(d.getElementById('profile-card-note-input').value, 'Jogar em grupo');
  h.run(`onUserProfile({user:{username:"Bia"}, server_id:"s1", activity_visible:false, bio_visible:false,
    banner_visible:false, links:[{label:"GitHub",url:"https://github.com/monalisa",verified_github:true}]})`);
  const linksEl = d.getElementById('profile-card-links');
  assert.match(linksEl.textContent, /GitHub/);
  assert.doesNotMatch(linksEl.textContent, /Link manual/);
  assert.equal(linksEl.querySelector('.profile-connection-verified')?.getAttribute('aria-label'), 'GitHub verificado');
  assert.equal(d.getElementById('profile-card-bio').textContent, 'Nenhuma biografia definida.');
  assert.equal(d.getElementById('profile-activity-card-list').textContent, 'Atividade indisponível.');
  h.run('refreshVisibleProfiles("Bia")');
  assert.equal(d.getElementById('profile-card-links').textContent, '');
  assert.equal(h.run('sent.at(-1).payload.server_id'), 's1');
});

test('conexões públicas exibem apenas ícone + nome limpo, respeitam fallback/privacidade/tooltip e removem texto técnico', async t => {
  const h = await openInterface(t), d = h.document;
  const wrap = d.getElementById('profile-card-links-wrap');
  const list = d.getElementById('profile-card-links');

  // Nenhuma conexão -> seção oculta
  h.run('renderVisitedProfileLinks([])');
  assert.equal(wrap.classList.contains('hidden'), true);
  assert.equal(list.children.length, 0);

  // Várias conexões: nome personalizado, domínio desconhecido, legado sem nome, nome longo, URL longa e conexão oculta
  h.run(`renderVisitedProfileLinks([
    { label: "Meu GitHub", url: "https://github.com/gabrielsanderx", visible: true, verified_github: false, platform: "github" },
    { label: "Meu portfólio", url: "https://meusite.dev/projetos/sanvo-desktop-app", visible: true, verified_github: false },
    { label: "", url: "https://github.com/legado", visible: true, verified_github: false },
    { label: "", url: "https://www.exemplolimpo.org/caminho", visible: true, verified_github: false },
    { label: "Um nome de conexão extremamente longo que precisa truncar com reticências", url: "https://sub.dominio.com/muito/longo/caminho/extra", visible: true },
    { label: "Oculta", url: "https://hidden.example.com", visible: false }
  ])`);

  assert.equal(wrap.classList.contains('hidden'), false);
  const rows = [...list.querySelectorAll('.profile-connection-row')];
  assert.equal(rows.length, 5, 'conexão oculta não deve aparecer no perfil público');

  // Nunca exibir texto técnico ("Link manual", "conexão manual") no perfil público
  assert.doesNotMatch(list.textContent, /Link manual|conexão manual/i);

  // 1. GitHub com nome personalizado
  assert.equal(rows[0].querySelector('.profile-connection-icon').textContent, '🐙');
  assert.equal(rows[0].querySelector('.profile-connection-label').textContent, 'Meu GitHub');
  assert.equal(rows[0].querySelector('a').dataset.uiTooltip, 'github.com/gabrielsanderx');
  assert.equal(rows[0].querySelector('.profile-connection-verified'), null);

  // 2. Domínio desconhecido usa ícone genérico 🔗 e nome personalizado sem expor URL no texto
  assert.equal(rows[1].querySelector('.profile-connection-icon').textContent, '🔗');
  assert.equal(rows[1].querySelector('.profile-connection-label').textContent, 'Meu portfólio');
  assert.doesNotMatch(rows[1].textContent, /https:\/\/meusite\.dev/);

  // 3. Legado sem label no GitHub -> fallback limpo "GitHub"
  assert.equal(rows[2].querySelector('.profile-connection-label').textContent, 'GitHub');

  // 4. Legado sem label em domínio genérico -> fallback limpo sem "www."
  assert.equal(rows[3].querySelector('.profile-connection-icon').textContent, '🔗');
  assert.equal(rows[3].querySelector('.profile-connection-label').textContent, 'exemplolimpo.org');

  // 5. Nome longo recebe tooltip com nome + domínio
  assert.match(rows[4].querySelector('a').dataset.uiTooltip, /sub\.dominio\.com/);

  // Cargos: vários cargos e nenhum cargo
  const roleRow = d.getElementById('profile-card-roles-list');
  const roleWrap = d.getElementById('profile-card-roles-wrap');
  h.run('renderProfileRoles(document.getElementById("profile-card-roles-list"), [])');
  assert.equal(roleWrap.classList.contains('hidden'), true);
  h.run('renderProfileRoles(document.getElementById("profile-card-roles-list"), [{name:"Fundador",badge_emoji:"👑",color:"#fbbf24"},{name:"Moderador",color:"#5865f2"}])');
  assert.equal(roleWrap.classList.contains('hidden'), false);
  const chips = [...roleRow.querySelectorAll('.compact-profile-role')];
  assert.equal(chips.length, 2);
  assert.equal(chips[0].textContent, '👑 Fundador');
  assert.equal(chips[1].textContent, 'Moderador');
});

test('plataformas sociais e painel administrativo de selos funcionam com restrição por permissão', async t => {
  const h = await openInterface(t), d = h.document;
  h.run(`
    state.selfUser = {id:"op",username:"Operador"};
    state.cosmetics = {
      badges: [
        {id:"founder", name:"Fundador", category:"trust", description:"Fundação"},
        {id:"bug_hunter", name:"Caçador de bugs", category:"cosmetic", description:"Relatou bugs"},
      ],
    };
    globalThis.sent = [];
    sendWs = (type,payload) => { sent.push(JSON.parse(JSON.stringify({type,payload}))); return true; };
    receiveProfileSharing({
      privacy: {},
      links: [
        {id:"l1", label:"Steam", url:"https://steamcommunity.com/id/op", visible:true, verified_github:false, platform:"steam"},
        {id:"l2", label:"GitHub", url:"https://github.com/op", visible:true, verified_github:true, platform:"github"},
      ],
    });
  `);
  const ownLinksText = d.getElementById('profile-own-links').textContent;
  assert.match(ownLinksText, /Steam · Link manual/);
  assert.match(ownLinksText, /GitHub verificado/);

  // Sem permissão de operador, painel permanece oculto.
  h.run('receiveBadgeAdminState({can_manage:false, grants:{}, accounts:[]})');
  assert.equal(d.getElementById('badge-admin-panel').classList.contains('hidden'), true);

  // Com permissão, painel abre, permite escolher conta e enviar SetUserBadges.
  h.run('receiveBadgeAdminState({can_manage:true, grants:{bia:["bug_hunter"]}, accounts:["Bia","Operador"]})');
  assert.equal(d.getElementById('badge-admin-panel').classList.contains('hidden'), false);
  const userSelect = d.getElementById('badge-admin-user');
  userSelect.value = 'Bia';
  userSelect.dispatchEvent(new h.w.Event('change'));
  const checks = [...d.querySelectorAll('#badge-admin-list input[type="checkbox"]')];
  assert.equal(checks.find(c => c.value === 'bug_hunter').checked, true);
  assert.equal(checks.find(c => c.value === 'founder').checked, false);
  checks.find(c => c.value === 'founder').checked = true;
  d.getElementById('badge-admin-save').click();
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(sent.at(-1))')), {
    type: 'SetUserBadges',
    payload: { target_username: 'Bia', badges: ['founder', 'bug_hunter'] },
  });
});
