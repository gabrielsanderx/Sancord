// E-mail obrigatório: cadastro com e-mail, login por e-mail ou nome, código de confirmação
// e conta antiga sem e-mail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openInterface } = require('./helpers/dom.cjs');

function mockServer(h, routes) {
  const calls = [];
  h.w.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    const body = options?.body ? JSON.parse(options.body) : null;
    calls.push([path, body]);
    const [status, json] = (routes[path] || (() => [500, {}]))(body, calls);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return calls;
}

test('cadastro exige e-mail válido e mostra o código de confirmação', async t => {
  const h = await openInterface(t);
  const d = h.document;
  const form = d.getElementById('login-form');
  d.getElementById('tab-register').click();
  const email = d.getElementById('auth-email-input');
  assert.equal(email.closest('.auth-field').classList.contains('hidden'), false, 'campo de e-mail no cadastro');
  assert.equal(d.getElementById('auth-username-label').textContent, 'Nome de usuário');

  d.getElementById('username-input').value = 'Ana';
  d.getElementById('password-input').value = 'senha-segura-1';
  email.value = 'sem-arroba';
  form.requestSubmit();
  assert.match(d.getElementById('auth-email-error').textContent, /e-mail válido/);

  const calls = mockServer(h, {
    '/api/register': () => [200, { ok: true, token: 'tok-1', username: 'Ana', email_step: 'verify', email_hint: 'a***@exemplo.com', retry_after: 60 }],
    '/api/email/verify': body => body.code === '123456' ? [200, { ok: true }] : [401, { ok: false, code: 'code_wrong' }],
  });
  email.value = 'ana@exemplo.com';
  form.requestSubmit();
  await h.flush();
  assert.deepEqual(calls[0], ['/api/register', { username: 'Ana', email: 'ana@exemplo.com', password: 'senha-segura-1', remember: true }]);
  const auth = d.getElementById('login-modal');
  assert.equal(auth.dataset.authMode, 'verify');
  assert.match(d.getElementById('auth-description').textContent, /a\*\*\*@exemplo\.com/);
  const resend = d.getElementById('auth-resend-btn');
  assert.equal(resend.disabled, true, 'reenvio aguarda o intervalo');
  assert.match(resend.textContent, /em \d+ s/);
  assert.equal(d.getElementById('password-input').value, '', 'senha some da tela');

  const code = d.getElementById('auth-verify-input');
  code.value = '111 111';
  code.dispatchEvent(new h.w.Event('input'));
  await h.flush();
  assert.match(d.getElementById('auth-verify-error').textContent, /Código incorreto/);
  code.value = '123456';
  code.dispatchEvent(new h.w.Event('input'));
  await h.flush();
  assert.deepEqual(calls.at(-1), ['/api/email/verify', { token: 'tok-1', code: '123456' }]);
});

test('e-mail já usado no cadastro marca o campo de e-mail', async t => {
  const h = await openInterface(t);
  const d = h.document;
  d.getElementById('tab-register').click();
  d.getElementById('username-input').value = 'Bia';
  d.getElementById('auth-email-input').value = 'ana@exemplo.com';
  d.getElementById('password-input').value = 'senha-segura-1';
  mockServer(h, { '/api/register': () => [409, { ok: false, code: 'email_taken' }] });
  d.getElementById('login-form').requestSubmit();
  await h.flush();
  assert.match(d.getElementById('auth-email-error').textContent, /já está em uso/);
  assert.equal(d.getElementById('auth-username-error').textContent, '');
});

test('conta antiga entra pelo nome, cadastra o e-mail e segue para o código', async t => {
  const h = await openInterface(t);
  const d = h.document;
  assert.equal(d.getElementById('auth-username-label').textContent, 'E-mail ou nome de usuário');
  const calls = mockServer(h, {
    '/api/login': () => [200, { ok: true, token: 'tok-velha', username: 'Velha', email_step: 'add' }],
    '/api/email/start': body => body.email === 'ocupado@exemplo.com'
      ? [409, { ok: false, code: 'email_taken' }]
      : [200, { ok: true, email_step: 'verify', email_hint: 'v***@exemplo.com', retry_after: 60 }],
  });
  d.getElementById('username-input').value = 'velha';
  d.getElementById('password-input').value = 'senha-segura-1';
  const form = d.getElementById('login-form');
  form.requestSubmit();
  await h.flush();
  const auth = d.getElementById('login-modal');
  assert.equal(auth.dataset.authMode, 'add-email');
  assert.equal(d.getElementById('password-input').closest('.auth-field').classList.contains('hidden'), true);
  const email = d.getElementById('auth-email-input');
  assert.equal(d.activeElement, email);

  email.value = 'ocupado@exemplo.com';
  form.requestSubmit();
  await h.flush();
  assert.match(d.getElementById('auth-email-error').textContent, /já está em uso/);
  email.value = 'velha@exemplo.com';
  form.requestSubmit();
  await h.flush();
  assert.deepEqual(calls.at(-1), ['/api/email/start', { token: 'tok-velha', email: 'velha@exemplo.com' }]);
  assert.equal(auth.dataset.authMode, 'verify');
  assert.match(d.getElementById('auth-description').textContent, /v\*\*\*@exemplo\.com/);

  // "Entrar com outra conta" descarta a sessão pendente e volta ao login.
  d.getElementById('auth-other-account-btn').click();
  await h.flush();
  assert.equal(auth.dataset.authMode, 'login');
  assert.equal(calls.at(-1)[0], '/api/logout');
});
