const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

async function setup(t) {
  const h = await openInterface(t);
  h.run(`
    globalThis.sent = [];
    sendWs = (type, payload) => { sent.push({type, payload}); return true; };
    const channel = {id:"c1", name:"geral", kind:"text"};
    state.activeView = "server";
    state.activeServerId = "s1";
    state.currentTextChannel = channel.id;
    state.textChannels = [channel];
    state.selfUser = {id:"me", username:"Ana"};
    state.servers = [{ id:"s1", name:"Turma", owner_username:"Ana",
      text_channels:[channel], voice_channels:[], members:["ana","bia"],
      member_nicks:{bia:"Apelido de Bia"},
      member_profiles:{bia:{avatar:{url:"/api/attachments/local/avatar.png", animated:false}, bio:"**Bio local**"}},
    }];
    globalThis.bia = { id:"bia", username:"Bia", display_name:"Nome global", avatar_color:"#5865f2",
      avatar_url:"/api/attachments/global/avatar.png", banner_url:"/api/attachments/global/banner.png",
      bio:"Bio global", online:true, status_kind:"online" };
    state.users.set("bia", bia);
    globalThis.msg = {id:"m1", channel_id:"c1", author_name:"Bia", author_id:"bia", content:"oi", created_at:Date.now()};
    state.chatHistory.c1 = [msg];
    renderChatMessages();
    renderMembersSidebar();
  `);
  return h;
}

test('perfil local sincroniza no cartão, nos membros e no chat; DM usa a identidade global', async t => {
  const h = await setup(t), d = h.document;
  h.run('openMemberProfilePopover("bia", msg)');
  const image = selector => d.querySelector(`${selector} img`)?.getAttribute('src');
  const text = id => d.getElementById(id).textContent;
  const bio = () => text('profile-card-bio');
  assert.equal(text('profile-card-name'), 'Apelido de Bia');
  assert.equal(bio(), 'Bio local');
  assert.match(image('#profile-card-banner'), /global\/banner\.png$/);
  for (const selector of ['#profile-card-avatar', '[data-msg-id="m1"] .avatar', '.member-item .avatar']) {
    assert.match(image(selector), /local\/avatar\.png$/);
  }
  await h.run(`handleServerMessage({type:"ServerProfileUpdated", payload:{
    server_id:"s1", username:"bia", profile:{ banner:{url:"/api/attachments/local/banner.png",animated:false} }
  }})`);
  assert.equal(bio(), 'Bio global');
  assert.match(image('#profile-card-banner'), /local\/banner\.png$/);
  assert.match(image('[data-msg-id="m1"] .avatar'), /global\/avatar\.png$/);

  h.run('openMemberProfilePopover("bia", { ...msg, channel_id: "dm:ana__bia" })');
  assert.equal(text('profile-card-name'), 'Nome global');
  assert.match(image('#profile-card-banner'), /global\/banner\.png$/);
  h.run(`onUserProfile({ user:{ ...bia, bio:"Resposta antiga de outro contexto" }, server_id:"s1" })`);
  assert.equal(bio(), 'Bio global');
  assert.equal(h.run('sent.at(-1).payload.server_id'), null);
});

test('editor envia anexos e somente os campos alterados no servidor escolhido', async t => {
  const h = await setup(t), d = h.document;
  h.run(`
    state.servers[0].member_profiles.ana = {
      bio:"Bio antiga", banner:{url:"/api/attachments/local/banner.png",animated:false}
    };
    globalThis.uploads = [];
    uploadProfileImage = async (file, name) => { uploads.push([file.size,name]); return "id-avatar"; };
    globalThis.editing = openServerProfileDialog("s1");
  `);
  const dlg = d.querySelector('.sancord-dialog');
  const named = name => dlg.querySelector(`[id^="f-${name}-"]`);
  named('bio').value = 'Bio nova';
  named('avatar').value = 'upload';
  named('avatar').dispatchEvent(new h.w.Event('change'));
  named('banner').value = 'inherit';
  dlg.querySelector('form').dispatchEvent(new h.w.Event('submit', { cancelable:true }));
  assert.ok(dlg.querySelector('[role="alert"]:not(.hidden)'));
  const file = new h.w.File(['PNG'], 'nova.png', {type:'image/png'});
  Object.defineProperty(named('avatar_file'), 'files', {value:[file]});
  dlg.querySelector('form').dispatchEvent(new h.w.Event('submit', { cancelable:true }));
  await h.run('editing');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(uploads)')), [[3,'nova.png']]);
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(sent.at(-1))')), {
    type:'SetServerProfile', payload:{ server_id:'s1', bio:'Bio nova', avatar_attachment_id:'id-avatar', banner_attachment_id:'' },
  });
});

test('cosméticos e tema por servidor substituem o global em chat, membros e cartão, preservando DM', async t => {
  const h = await setup(t), d = h.document;
  h.run(`
    onCosmeticsState({
      catalog: [
        { kind:"avatar_decoration", id:"nebula-orbit", name:"Nebula Orbit" },
        { kind:"profile_frame", id:"minimal", name:"Minimal" },
        { kind:"profile_effect", id:"aurora", name:"Aurora" },
        { kind:"nameplate", id:"core-stripe", name:"Core Stripe" },
        { kind:"name_style", id:"neon", name:"Neon" },
        { kind:"name_style", id:"retro", name:"Retrô" },
      ],
      owned: ["avatar_decoration:nebula-orbit","profile_frame:minimal","profile_effect:aurora","nameplate:core-stripe","name_style:neon","name_style:retro"],
      badges: [],
    });
    bia.avatar_decoration = "sakura-fall";
    bia.profile_frame = "royal";
    bia.name_style = "retro";
    bia.theme_primary = "#111111";
    state.servers[0].member_profiles.bia = {
      avatar_decoration: "nebula-orbit",
      profile_frame: "minimal",
      nameplate_style: "core-stripe",
      name_style: "neon",
      theme_mode: "solid",
      theme_primary: "#223344",
    };
    renderChatMessages();
    renderMembersSidebar();
    openMemberProfilePopover("bia", msg);
  `);
  assert.ok(d.querySelector('[data-msg-id="m1"] .avatar-status-wrap.deco-nebula-orbit'));
  assert.ok(d.querySelector('[data-msg-id="m1"] .message-author.name-style-neon'));
  assert.ok(d.querySelector('.member-item.nameplate-core-stripe'));
  assert.ok(d.querySelector('.member-item .user-avatar-wrap.deco-nebula-orbit'));
  assert.ok(d.querySelector('.member-item .member-display-name.name-style-neon'));
  assert.ok(d.getElementById('profile-popover-card').classList.contains('pf-minimal'));
  assert.ok(d.getElementById('profile-card-name').classList.contains('name-style-neon'));

  // Em DM volta ao perfil global.
  h.run('openMemberProfilePopover("bia", { ...msg, channel_id: "dm:ana__bia" })');
  assert.ok(d.getElementById('profile-popover-card').classList.contains('pf-royal'));
  assert.ok(d.getElementById('profile-card-name').classList.contains('name-style-retro'));

  // Diálogo permite escolher cosméticos e tema local e envia apenas os campos modificados.
  h.run('globalThis.editingCosm = openServerProfileDialog("s1");');
  const dlg = d.querySelector('.sancord-dialog');
  const named = name => dlg.querySelector(`[id^="f-${name}-"]`);
  named('avatar_decoration').value = 'nebula-orbit';
  named('profile_frame').value = 'minimal';
  named('theme_override').value = 'custom';
  named('theme_override').dispatchEvent(new h.w.Event('change'));
  named('theme_mode').value = 'solid';
  named('theme_mode').dispatchEvent(new h.w.Event('change'));
  named('theme_primary').value = '#112233';
  named('theme_highlight').value = '#445566';
  dlg.querySelector('form').dispatchEvent(new h.w.Event('submit', { cancelable:true }));
  await h.run('editingCosm');
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(sent.at(-1))')), {
    type: 'SetServerProfile',
    payload: {
      server_id: 's1',
      avatar_decoration: 'nebula-orbit',
      profile_frame: 'minimal',
      theme_mode: 'solid',
      theme_primary: '#112233',
      theme_highlight: '#445566',
    },
  });
});
