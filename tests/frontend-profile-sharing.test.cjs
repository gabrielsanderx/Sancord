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
  d.getElementById('compact-full-profile').click();
  assert.equal(quick.classList.contains('hidden'), true);
  assert.equal(d.getElementById('profile-popover-modal').classList.contains('hidden'), false);
  h.run(`onUserProfile({user:{username:"Bia"}, server_id:"s1", activity_visible:false, bio_visible:false,
    banner_visible:false, links:[{label:"GitHub",url:"https://github.com/monalisa",verified_github:true}]})`);
  assert.match(d.getElementById('profile-card-links').textContent, /GitHub verificado/);
  assert.equal(d.getElementById('profile-card-bio').textContent, 'Nenhuma biografia definida.');
  assert.equal(d.getElementById('profile-activity-card-list').textContent, 'Atividade indisponível.');
  h.run('refreshVisibleProfiles("Bia")');
  assert.equal(d.getElementById('profile-card-links').textContent, '');
  assert.equal(h.run('sent.at(-1).payload.server_id'), 's1');
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
