const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

test('login padrão, navegação em um único card e validações por campo', async t => {
  const h = await openInterface(t);
  const d = h.document;
  const auth = d.getElementById('login-modal');
  const form = d.getElementById('login-form');
  const name = d.getElementById('username-input');
  const password = d.getElementById('password-input');
  assert.equal(auth.dataset.authMode, 'login');
  assert.equal(d.activeElement, name);
  assert.equal(auth.querySelectorAll('.auth-card').length, 1);
  assert.doesNotMatch(auth.textContent, /QR Code|telefone|nascimento/i);
  assert.equal(name.autocomplete, 'username');
  assert.equal(password.autocomplete, 'current-password');

  d.getElementById('tab-register').click();
  assert.equal(auth.dataset.authMode, 'register');
  assert.equal(password.autocomplete, 'new-password');
  name.value = 'a__b';
  password.value = 'curta';
  form.requestSubmit();
  assert.equal(name.getAttribute('aria-invalid'), 'true');
  assert.equal(password.getAttribute('aria-invalid'), 'true');
  assert.match(d.getElementById('auth-password-error').textContent, /8 a 128/);
  assert.equal(d.activeElement, name);
  d.getElementById('auth-toggle-password').click();
  assert.equal(password.type, 'text');
  d.getElementById('tab-login').click();
  assert.equal(password.type, 'password');
  assert.equal(password.value, '');
  assert.equal(d.activeElement, password);
});

test('envio impede duplicatas, distingue rede de credenciais e permite tentar novamente', async t => {
  const h = await openInterface(t);
  const d = h.document;
  const submit = d.getElementById('auth-submit-btn');
  const form = d.getElementById('login-form');
  const retry = d.getElementById('auth-retry-btn');
  d.getElementById('username-input').value = 'Ana';
  d.getElementById('password-input').value = ' erro de teste ';
  let failRequest;
  const calls = [];
  h.w.fetch = (url, options) => {
    calls.push([new URL(url).pathname, JSON.parse(options.body)]);
    return new Promise((_, reject) => { failRequest = reject; });
  };
  form.requestSubmit();
  form.requestSubmit();
  assert.equal(calls.length, 1);
  assert.equal(submit.disabled, true);
  assert.ok(submit.classList.contains('is-loading'));
  assert.equal(calls[0][1].password, ' erro de teste ');
  failRequest(Error('teste de rede'));
  await h.flush();
  assert.match(d.getElementById('auth-error').textContent, /Não foi possível conectar/);
  assert.equal(retry.classList.contains('hidden'), false);
  h.w.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'mensagem técnica do servidor' }) });
  retry.click();
  await h.flush();
  assert.match(d.getElementById('auth-password-error').textContent, /usuário ou senha incorretos/);
  assert.equal(retry.classList.contains('hidden'), true);
  assert.equal(submit.disabled, false);
});

test('recuperação preserva o código ao corrigir a senha e usa a rota de recuperação do servidor', async t => {
  const h = await openInterface(t);
  const d = h.document;
  const form = d.getElementById('login-form');
  d.getElementById('username-input').value = 'Ana';
  d.getElementById('open-recover-password-btn').click();
  const code = d.getElementById('auth-code-input');
  assert.equal(d.activeElement, code);
  code.value = 'SANC-1234-1234-1234';
  d.getElementById('password-input').value = 'nova-senha-segura';
  d.getElementById('auth-confirm-input').value = 'outra-senha';
  form.requestSubmit();
  assert.equal(d.getElementById('auth-confirm-input').getAttribute('aria-invalid'), 'true');
  assert.equal(code.value, 'SANC-1234-1234-1234');
  d.getElementById('auth-confirm-input').value = 'nova-senha-segura';
  let sent;
  h.w.fetch = async (url, options) => {
    sent = [new URL(url).pathname, JSON.parse(options.body)];
    return { ok: false, status: 401, json: async () => null };
  };
  form.requestSubmit();
  await h.flush();
  assert.deepEqual(sent, ['/api/recover-password', {
    username: 'Ana', recovery_code: 'SANC-1234-1234-1234', new_password: 'nova-senha-segura', remember: true,
  }]);
  assert.match(d.getElementById('auth-code-error').textContent, /código de recuperação inválido/);
});

test('origem remota sem HTTPS não recebe credenciais', async t => {
  const h = await openInterface(t, { url: 'http://sancord.invalid/' });
  const d = h.document;
  let calls = 0;
  h.w.fetch = async () => { calls++; };
  d.getElementById('username-input').value = 'Ana';
  d.getElementById('password-input').value = 'senha-de-teste';
  d.getElementById('login-form').requestSubmit();
  await h.flush();
  assert.equal(calls, 0);
  assert.match(d.getElementById('auth-error').textContent, /HTTPS/);
});

test('sessão revogada volta para o login e preserva o contexto do convite', async t => {
  const h = await openInterface(t, { url: 'https://sancord.invalid/?invite=SANC-TESTE' });
  h.run('storeSession("token-de-teste", "Ana", true)');
  h.w.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/api/session');
    return { ok: false, status: 401 };
  };
  await h.run('tryAutoLogin()');
  assert.equal(h.run('getStoredToken()'), null);
  assert.equal(h.run('state.pendingInviteCode'), 'SANC-TESTE');
  assert.match(h.document.getElementById('auth-error').textContent, /sessão expirou/);
  assert.equal(h.document.getElementById('login-modal').dataset.authMode, 'login');
});
