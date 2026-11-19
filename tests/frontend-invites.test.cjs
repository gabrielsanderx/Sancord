const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

function createInviteEnv({ fetchHandler } = {}) {
  const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://sancord.localhost/index.html?endpoint=http%3A%2F%2F127.0.0.1%3A3000",
    runScripts: "outside-only",
  });
  const { window } = dom;
  const sent = [];
  const toasts = [];
  const copied = [];

  window.fetch = async (url, opts) => {
    if (fetchHandler) return fetchHandler(String(url), opts || {});
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          code: "SANC-AB3K9X2M",
          server_id: "srv-2",
          name: "Guilda Teste",
          description: "Servidor de amigos",
          icon_color: "#5865f2",
          member_count: 14,
          online_count: 4,
          inviter_name: "Ana",
          channel_id: "ch-geral",
          channel_name: "geral",
          temporary: false,
          already_member: false,
          rules_text: null,
        };
      },
    };
  };

  window.state = {
    selfUser: { id: "u1", username: "Gabriel", display_name: "Gabriel" },
    activeServerId: "srv-1",
    activeView: "server",
    currentTextChannel: "ch-1",
    authToken: "tok-123",
    friends: [
      { username: "joao", display_name: "João Silva", status_kind: "online", avatar_color: "#22aa88" },
      { username: "maria", display_name: "Maria", status_kind: "idle", avatar_color: "#aa55cc" },
      { username: "pedro", display_name: "Pedro", status_kind: "offline", avatar_color: "#5588cc" },
    ],
    dmConversations: [
      { peer_username: "lucas", peer_display_name: "Lucas DM", peer_avatar_color: "#cc8833" },
    ],
    users: new Map(),
    servers: [
      {
        id: "srv-1",
        name: "Só tristeza",
        owner_username: "gabriel",
        invite_code: "SANC-INIT1234",
        invites_paused: false,
        members: ["gabriel", "pedro"],
        roles: [{ id: "everyone", name: "@everyone", position: 0, permissions: { create_invites: true } }],
        text_channels: [
          { id: "ch-1", name: "geral", kind: "text", effective_permissions: { view_channel: true, create_invites: true } },
          { id: "ch-priv", name: "privado", kind: "text", effective_permissions: { view_channel: true, create_invites: false } },
        ],
        voice_channels: [
          { id: "v-1", name: "Call", kind: "voice", effective_permissions: { view_channel: true, create_invites: true } },
        ],
      },
    ],
  };

  window.editingServerId = "srv-1";
  window.sendWs = (type, payload) => sent.push({ type, payload });
  window.showUiToast = (msg) => toasts.push(msg);
  window.copyTextSafe = (txt, msg) => copied.push({ txt, msg });
  window.escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  window.cachedMediaUrl = (u) => u;
  window.renderAvatarInner = (name) => String(name || "U").slice(0, 2).toUpperCase();
  window.resolvePublicOriginUrl = async () => "http://127.0.0.1:3000";
  window.getActiveServer = () => window.state.servers[0];
  window.getServerPermissionsFor = () => ({ create_invites: true, manage_invites: true, manage_server: true });
  window.getChannelPermissions = (_srv, ch) => ch?.effective_permissions || { view_channel: true, create_invites: true };
  window.canUserEditServer = () => true;
  window.switchToServerId = (sid, cid) => sent.push({ type: "_SWITCH_SERVER", payload: { sid, cid } });
  window.SancordUI = {
    confirmCalls: [],
    menuCalls: [],
    tooltip() {},
    async confirm(opts) {
      this.confirmCalls.push(opts);
      return true;
    },
    contextMenu(_x, _y, items) {
      this.menuCalls.push(items);
    },
  };

  const ctx = dom.getInternalVMContext();
  for (const rel of ["static/js/icons.js", "static/js/transport.js", "static/js/invites.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), ctx, { filename: rel });
  }
  window.SancordNet = vm.runInContext("SancordNet", ctx);
  window.SancordIcons = vm.runInContext("SancordIcons", ctx);

  return { dom, window, sent, toasts, copied };
}

test("InviteModal página 1 e 2: busca amigos, envia DM sem duplicar, edita e gera novo link", async () => {
  const { window, sent, copied } = createInviteEnv();
  const { document, SancordInvites } = window;

  await SancordInvites.openInviteModal("srv-1", "ch-1");
  const modal = document.getElementById("invite-server-modal");
  assert.equal(modal.classList.contains("hidden"), false);
  assert.match(document.getElementById("invite-modal-title").textContent, /Só tristeza/);
  assert.equal(document.getElementById("invite-modal-channel-pill").textContent, "# geral");

  // Ao abrir por um canal específico, cria convite de 7 dias vinculado ao canal.
  assert.equal(sent[0].type, "CreateInvite");
  assert.equal(sent[0].payload.channel_id, "ch-1");
  assert.equal(sent[0].payload.max_age_secs, 604800);

  // Pedro já é membro; João e Maria têm botão Convidar; Lucas DM também aparece.
  const rows = [...document.querySelectorAll("#invite-modal-friends-list .invite-friend-row")];
  assert.equal(rows.length, 4);
  assert.ok(rows.some((r) => r.textContent.includes("Já está no servidor")));

  // Busca instantânea filtra por nome.
  const search = document.getElementById("invite-friend-search");
  search.value = "joão";
  search.dispatchEvent(new window.Event("input"));
  const filtered = [...document.querySelectorAll("#invite-modal-friends-list .invite-friend-row")];
  assert.equal(filtered.length, 1);

  // Clicar Convidar envia DM e trava o botão como "Enviado ✓".
  const invBtn = filtered[0].querySelector("button");
  invBtn.click();
  invBtn.click(); // segundo clique não duplica envio
  const dmSends = sent.filter((s) => s.type === "InviteFriendToServer");
  assert.equal(dmSends.length, 1);
  assert.equal(dmSends[0].payload.target_username, "joao");
  assert.equal(invBtn.textContent, "Enviado ✓");
  assert.equal(invBtn.disabled, true);

  // Busca sem resultados mostra estado vazio claro.
  search.value = "ninguem-existe-xyz";
  search.dispatchEvent(new window.Event("input"));
  assert.match(document.getElementById("invite-modal-friends-list").textContent, /Você ainda pode compartilhar o link abaixo/);

  // Copiar link mostra feedback "Copiado ✓".
  const copyBtn = document.getElementById("invite-modal-copy-link-btn");
  copyBtn.click();
  assert.equal(copied.length, 1);
  assert.equal(copyBtn.textContent, "Copiado ✓");

  // Página 2: editar configurações e gerar novo link.
  document.getElementById("invite-modal-edit-link-btn").click();
  assert.equal(document.getElementById("invite-modal-page-settings").classList.contains("hidden"), false);
  document.getElementById("invite-modal-expiry").value = "3600";
  document.getElementById("invite-modal-max-uses").value = "5";
  document.getElementById("invite-modal-temporary").checked = true;
  document.getElementById("invite-modal-create-btn").click();

  const createCalls = sent.filter((s) => s.type === "CreateInvite");
  const lastCreate = createCalls[createCalls.length - 1].payload;
  assert.equal(lastCreate.max_age_secs, 3600);
  assert.equal(lastCreate.max_uses, 5);
  assert.equal(lastCreate.temporary, true);

  // Simula resposta InviteCreated -> volta para Página 1 com o novo link.
  await SancordInvites.onInviteCreated({
    invite: {
      code: "SANC-NEW88888",
      server_id: "srv-1",
      expires_at: Date.now() + 3600_000,
      max_uses: 5,
      uses: 0,
      temporary: true,
      channel_id: "ch-1",
      channel_name: "geral",
    },
  });
  assert.equal(document.getElementById("invite-modal-page-main").classList.contains("hidden"), false);
  assert.equal(document.getElementById("invite-modal-code-badge").textContent, "SANC-NEW88888");
  assert.match(document.getElementById("invite-modal-expiry-note").textContent, /Associação temporária ativa/);

  // ESC fecha o modal.
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(modal.classList.contains("hidden"), true);
});

test("InvitePreviewModal exibe prévia, regras obrigatórias, já-membro e estados de erro", async () => {
  let mockResponse = null;
  const { window, sent } = createInviteEnv({
    fetchHandler: async () => ({
      ok: Boolean(mockResponse?.ok),
      status: mockResponse?.ok ? 200 : 410,
      async json() {
        return mockResponse;
      },
    }),
  });
  const { document, SancordInvites } = window;

  // 1. Servidor com regras obrigatórias trava botão até aceitar checkbox.
  mockResponse = {
    ok: true,
    code: "SANC-RULES123",
    server_id: "srv-rules",
    name: "Comunidade Regras",
    description: "Lugar organizado",
    icon_color: "#3377ff",
    member_count: 25,
    online_count: 7,
    inviter_name: "Carla",
    channel_id: "ch-welcome",
    channel_name: "boas-vindas",
    temporary: true,
    already_member: false,
    rules_text: "Seja cordial.",
  };
  await SancordInvites.openInvitePreview("SANC-RULES123");
  const joinBtn = document.getElementById("invite-preview-join-btn");
  const rulesCheck = document.getElementById("invite-preview-rules-check");
  assert.equal(document.getElementById("invite-preview-name").textContent, "Comunidade Regras");
  assert.equal(joinBtn.disabled, true);
  rulesCheck.checked = true;
  rulesCheck.dispatchEvent(new window.Event("change"));
  assert.equal(joinBtn.disabled, false);
  joinBtn.click();
  const joinCall = sent.find((s) => s.type === "JoinServerByInvite");
  assert.equal(joinCall.payload.invite_code, "SANC-RULES123");
  assert.equal(joinCall.payload.accepted_rules, true);

  // 2. Já é membro: mostra aviso e botão "Abrir servidor".
  mockResponse = {
    ok: true,
    code: "SANC-INIT1234",
    server_id: "srv-1",
    name: "Só tristeza",
    member_count: 2,
    online_count: 1,
    already_member: true,
  };
  await SancordInvites.openInvitePreview("SANC-INIT1234");
  assert.equal(document.getElementById("invite-preview-already").classList.contains("hidden"), false);
  assert.equal(joinBtn.textContent, "Abrir servidor");
  joinBtn.click();
  assert.ok(sent.some((s) => s.type === "_SWITCH_SERVER" && s.payload.sid === "srv-1"));

  // 3. Estados de erro distintos: expirado, revogado, pausado, banido.
  for (const [kind, expected] of [
    ["expired", /expirado/i],
    ["revoked", /não é mais válido/i],
    ["paused", /pausados/i],
    ["banned", /não pode entrar/i],
  ]) {
    mockResponse = { ok: false, error_kind: kind };
    await SancordInvites.openInvitePreview(`SANC-ERR-${kind}`);
    assert.equal(document.getElementById("invite-preview-error").classList.contains("hidden"), false);
    const fullText =
      document.getElementById("invite-preview-error-title").textContent +
      " " +
      document.getElementById("invite-preview-error-msg").textContent;
    assert.match(fullText, expected);
  }
});

test("InviteManagementPage renderiza tabela, pausa/retoma e menu de detalhes/revogação", async () => {
  const { window, sent } = createInviteEnv();
  const { document, SancordInvites, SancordUI } = window;

  await SancordInvites.onInvitesList({
    server_id: "srv-1",
    invites_paused: true,
    invites: [
      {
        code: "SANC-CUSTOM11",
        server_id: "srv-1",
        creator: "gabriel",
        creator_name: "Gabriel",
        channel_name: "geral",
        uses: 2,
        max_uses: 10,
        expires_at: Date.now() + 86400_000,
        temporary: true,
        is_default: false,
      },
    ],
  });

  // Banner de pausado visível e botão para retomar.
  assert.equal(document.getElementById("srv-invites-paused-banner").classList.contains("hidden"), false);
  document.getElementById("srv-invites-resume-btn").click();
  assert.ok(sent.some((s) => s.type === "SetInvitesPaused" && s.payload.paused === false));

  // Tabela com linha do convite e menu ⋯ com Copiar, Detalhes e Revogar.
  const row = document.querySelector('.invite-mgmt-row[data-invite-code="SANC-CUSTOM11"]');
  assert.ok(row);
  assert.match(row.textContent, /2 \/ 10/);
  assert.match(row.textContent, /#geral/);
  row.querySelector(".invite-more-btn").click();
  const menu = SancordUI.menuCalls[0];
  const revokeItem = menu.find((i) => i.label === "Revogar convite");
  assert.ok(revokeItem);
  await revokeItem.onSelect();
  assert.ok(sent.some((s) => s.type === "RevokeInvite" && s.payload.code === "SANC-CUSTOM11"));
});

test("Link personalizado (slug) atualiza prévia, salva, copia e remove", async () => {
  const { window, sent, copied } = createInviteEnv();
  const { document, SancordInvites } = window;
  const input = document.getElementById("srv-custom-slug-input");
  const saveBtn = document.getElementById("srv-custom-slug-save-btn");
  const copyBtn = document.getElementById("srv-custom-slug-copy-btn");
  const clearBtn = document.getElementById("srv-custom-slug-clear-btn");

  SancordInvites.syncCustomSlugUI({ id: "srv-1", custom_invite_slug: null });
  assert.equal(copyBtn.classList.contains("hidden"), true);

  input.value = "minha-guilda";
  input.dispatchEvent(new window.Event("input"));
  await new Promise((r) => setTimeout(r, 10));
  assert.match(document.getElementById("srv-custom-slug-preview").textContent, /invite=minha-guilda/);
  assert.equal(copyBtn.classList.contains("hidden"), false);

  saveBtn.click();
  assert.ok(sent.some((s) => s.type === "SetCustomInviteSlug" && s.payload.slug === "minha-guilda"));

  copyBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(copied.some((c) => c.txt.includes("invite=minha-guilda")));

  clearBtn.click();
  assert.ok(sent.some((s) => s.type === "SetCustomInviteSlug" && s.payload.slug === null));
});

test("SancordNet.extractInviteCode interpreta códigos puros e formatos de link", () => {
  const { window } = createInviteEnv();
  const { SancordNet } = window;
  assert.equal(SancordNet.extractInviteCode("SANC-AB3K9X2M"), "SANC-AB3K9X2M");
  assert.equal(
    SancordNet.extractInviteCode("sancord://open/?endpoint=http%3A%2F%2F127.0.0.1%3A3000&invite=SANC-AB3K9X2M"),
    "SANC-AB3K9X2M"
  );
  assert.equal(SancordNet.extractInviteCode("sancord://invite/SANC-AB3K9X2M"), "SANC-AB3K9X2M");
  assert.equal(SancordNet.extractInviteCode("https://exemplo.com/invite/SANC-AB3K9X2M?ref=1"), "SANC-AB3K9X2M");
  assert.equal(SancordNet.extractInviteCode("sancord.gg/SANC-AB3K9X2M"), "SANC-AB3K9X2M");
});
