// Uma superfície para as rotas de autenticação que o servidor oferece.
const AUTH_SCREEN_MODES = {
  login: { title: "auth.title", endpoint: "/api/login" },
  register: { title: "auth.register.title", endpoint: "/api/register" },
  recovery: { title: "auth.recovery.title", endpoint: "/api/recover-password", description: "auth.recovery.description" },
  // E-mail obrigatório: conta antiga sem e-mail (`add-email`) e confirmação por código (`verify`).
  "add-email": { title: "auth.addEmail.title", description: "auth.addEmail.description" },
  verify: { title: "auth.verify.title", description: "auth.verify.description" },
};
const authEmailInput = document.getElementById("auth-email-input");
const authVerifyInput = document.getElementById("auth-verify-input");
const authResendBtn = document.getElementById("auth-resend-btn");
const AUTH_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Sessão já criada que ainda precisa do e-mail: { token, username, remember, stored, hint }.
let authPending = null;
let authResendTimer = null;
const authFields = loginForm.querySelector(".auth-fields");
const authCodeInput = document.getElementById("auth-code-input");
const authConfirmInput = document.getElementById("auth-confirm-input");
const authRetryButton = document.getElementById("auth-retry-btn");
const authPasswordToggle = document.getElementById("auth-toggle-password");
const authSavedAccounts = document.getElementById("auth-saved-accounts");
const authAccountList = document.getElementById("auth-account-list");
const authRemember = document.getElementById("remember-me-input");
const authSubmitLabel = document.getElementById("auth-submit-label");
const authProgress = document.getElementById("auth-progress");
let authMode = "login";
let authBusy = false;
let authConnecting = false;
let authFadeTimer = null;
let authRetry = null;
let authResetCompleted = false;
let authSessionVolatile = false;

function setAuthText(element, key) {
  element.dataset.i18n = key;
  element.textContent = t(key);
}

function setPasswordVisible(visible) {
  passwordInput.type = visible ? "text" : "password";
  authPasswordToggle.setAttribute("aria-pressed", String(visible));
  authPasswordToggle.setAttribute("aria-label", t(visible ? "auth.hidePassword" : "auth.showPassword"));
  authPasswordToggle.replaceChildren(SancordIcons.node(visible ? "eye-off" : "eye"));
}

function setAuthFieldError(field, key = "") {
  const error = document.getElementById(field.getAttribute("aria-describedby").split(" ")[0]);
  if (key) {
    field.setAttribute("aria-invalid", "true");
    setAuthText(error, key);
  } else {
    field.removeAttribute("aria-invalid");
    delete error.dataset.i18n;
    error.textContent = "";
  }
  error.classList.toggle("hidden", !key);
}

function showAuthError(key = "", retry = null) {
  authRetry = retry;
  if (key) setAuthText(authErrorEl, key);
  else {
    delete authErrorEl.dataset.i18n;
    authErrorEl.textContent = "";
  }
  authErrorEl.classList.toggle("hidden", !key);
  authRetryButton.classList.toggle("hidden", !retry);
}

async function signInWithSavedAccount(account) {
  if (authBusy) return;
  showAuthError();
  setAuthBusy(true, "session");
  if (await SancordSelfProfileMenu.switchToSavedAccount(account)) return;
  setAuthBusy(false);
  refreshAuthSavedAccounts();
  if (authErrorEl.classList.contains("hidden")) {
    showAuthError("auth.error.network", () => signInWithSavedAccount(account));
  }
}

function refreshAuthSavedAccounts() {
  const accounts = SancordSelfProfileMenu.listSavedAccounts();
  authAccountList.replaceChildren();
  for (const account of accounts) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-link";
    button.textContent = account.display_name && account.display_name !== account.username
      ? `${account.display_name} · @${account.username}` : `@${account.username}`;
    button.addEventListener("click", () => signInWithSavedAccount(account));
    button.disabled = authBusy;
    row.append(button);
    authAccountList.append(row);
  }
  authSavedAccounts.classList.toggle("hidden", authMode !== "login" || accounts.length === 0);
}

function focusAuthField() {
  if (!loginModal.classList.contains("hidden")) {
    const field = authMode === "verify" ? authVerifyInput
      : authMode === "add-email" ? authEmailInput
      : !usernameInput.value.trim() ? usernameInput
      : authMode === "register" && !authEmailInput.value.trim() ? authEmailInput
      : authMode === "recovery" ? authCodeInput : passwordInput;
    field.focus({ preventScroll: true });
  }
}

const AUTH_FIELDS = () => [usernameInput, passwordInput, authCodeInput, authConfirmInput, authEmailInput, authVerifyInput];

function setAuthMode(mode, focus = true) {
  const view = AUTH_SCREEN_MODES[mode];
  if (authMode !== mode) {
    for (const field of [passwordInput, authCodeInput, authConfirmInput, authVerifyInput]) field.value = "";
    authFields.classList.remove("auth-mode-enter");
    requestAnimationFrame(() => authFields.classList.add("auth-mode-enter"));
  }
  if (mode !== "verify") stopResendCountdown();
  authMode = mode;
  loginModal.dataset.authMode = mode;
  loginModal.querySelectorAll("[data-auth-only]").forEach(section => {
    section.classList.toggle("hidden", !section.dataset.authOnly.split(" ").includes(mode));
  });
  setAuthText(document.getElementById("auth-title"), view.title);
  setAuthText(document.getElementById("auth-username-label"), mode === "register" ? "auth.username" : "auth.identifier");
  const description = document.getElementById("auth-description");
  description.classList.toggle("hidden", !view.description);
  if (view.description) setAuthText(description, view.description);
  if (mode === "verify") {
    // O texto leva o e-mail mascarado; sem data-i18n para a troca de idioma não apagar o endereço.
    delete description.dataset.i18n;
    description.textContent = t("auth.verify.description", { email: authPending?.hint || t("auth.email") });
  }
  passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
  passwordInput.setAttribute("aria-describedby", mode === "login" ? "auth-password-error" : "auth-password-error auth-password-hint");
  setAuthText(document.getElementById("auth-password-label"), mode === "recovery" ? "auth.newPassword" : "auth.password");
  setAuthText(tabLogin, mode === "recovery" ? "auth.tab.login" : "auth.submit.login");
  setAuthText(authSubmitLabel, `auth.submit.${mode}`);
  setPasswordVisible(false);
  for (const field of AUTH_FIELDS()) setAuthFieldError(field);
  showAuthError();
  refreshAuthSavedAccounts();
  if (focus) focusAuthField();
}

// ---------------------------------------------------------------------------
// E-mail obrigatório: cadastrar (contas antigas) e confirmar com o código
// ---------------------------------------------------------------------------
function stopResendCountdown() {
  clearInterval(authResendTimer);
  authResendTimer = null;
  authResendBtn.disabled = authBusy;
  setAuthText(authResendBtn, "auth.resend");
}

function startResendCountdown(seconds) {
  stopResendCountdown();
  let left = Math.max(1, Math.ceil(Number(seconds) || 60));
  const tick = () => {
    if (left <= 0) {
      stopResendCountdown();
      return;
    }
    authResendBtn.disabled = true;
    delete authResendBtn.dataset.i18n;
    authResendBtn.textContent = t("auth.resendIn", { seconds: left });
    left -= 1;
  };
  tick();
  authResendTimer = setInterval(tick, 1000);
}

/** Mostra o passo de e-mail pendente de uma sessão já criada (login, cadastro ou sessão salva). */
function enterEmailStep({ token, username, remember = true, stored = false, step, hint, sent = false, retryAfter, failed = false }) {
  authPending = { token, username, remember, stored, hint: hint || authPending?.hint || "" };
  setAuthBusy(false);
  setAuthMode(step === "add" ? "add-email" : "verify");
  if (step === "add") return;
  if (failed) {
    showAuthError("auth.error.sendFailed");
    stopResendCountdown();
  } else if (sent) startResendCountdown(retryAfter);
  else requestEmailCode();
}

/** Abre a tela de login direto no passo de e-mail (sessão salva ou recusada pelo servidor). */
function requireEmailStep({ step, email_hint } = {}) {
  const token = getStoredToken();
  if (!token) {
    showAuthScreen({ error: "auth.error.session" });
    return;
  }
  authConnecting = false;
  clearTimeout(authFadeTimer);
  document.body.removeAttribute("data-auth-pending");
  loginModal.inert = false;
  loginModal.classList.remove("hidden", "auth-leaving");
  enterEmailStep({ token, username: getStoredUsername() || "", stored: true, step, hint: email_hint });
}

function authEmailPayload(extra = {}) {
  return { token: authPending?.token || "", ...extra };
}

async function requestEmailCode(email) {
  if (!authPending || authBusy) return;
  showAuthError();
  setAuthBusy(true, email ? "add-email" : authMode);
  try {
    const response = await requestAuth("/api/email/start", authEmailPayload(email ? { email } : {}));
    const data = await response.json().catch(() => null);
    setAuthBusy(false);
    if (data?.email_hint) authPending.hint = data.email_hint;
    if (response.ok && data?.ok) {
      if (!data.email_step) return completeEmailStep();
      if (authMode !== "verify") setAuthMode("verify");
      else setAuthMode("verify", false);
      startResendCountdown(data.retry_after);
      if (typeof showUiToast === "function") showUiToast(t("auth.notice.codeSent"));
      return;
    }
    handleEmailStepError(response.status, data);
  } catch (_) {
    setAuthBusy(false);
    showAuthError("auth.error.network", () => requestEmailCode(email));
  }
}

async function verifyEmailCode(code) {
  setAuthBusy(true, "verify");
  try {
    const response = await requestAuth("/api/email/verify", authEmailPayload({ code }));
    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok) return completeEmailStep();
    setAuthBusy(false);
    handleEmailStepError(response.status, data);
  } catch (_) {
    setAuthBusy(false);
    showAuthError("auth.error.network", () => loginForm.requestSubmit());
  }
}

function handleEmailStepError(status, data) {
  const code = data?.code;
  if (status === 401 && code === "session") {
    cancelEmailStep();
    showAuthScreen({ error: "auth.error.session" });
  } else if (code === "email_taken") {
    if (authMode !== "add-email") setAuthMode("add-email");
    setAuthFieldError(authEmailInput, "auth.error.emailUsed");
    authEmailInput.focus();
  } else if (code === "email_invalid") {
    setAuthFieldError(authEmailInput, "auth.error.emailInvalid");
    authEmailInput.focus();
  } else if (code === "cooldown") {
    if (authMode !== "verify") setAuthMode("verify");
    startResendCountdown(data?.retry_after);
  } else if (code === "code_wrong") {
    setAuthFieldError(authVerifyInput, "auth.error.codeWrong");
    authVerifyInput.select();
  } else if (code === "code_expired" || code === "code_attempts" || code === "code_missing") {
    setAuthFieldError(authVerifyInput, "auth.error.codeExpired");
    stopResendCountdown();
    authResendBtn.focus();
  } else if (code === "send_failed") {
    showAuthError("auth.error.sendFailed");
    stopResendCountdown();
  } else if (status === 429) showAuthError("auth.error.limit");
  else showAuthError("auth.error.server");
}

async function completeEmailStep() {
  const pending = authPending;
  authPending = null;
  stopResendCountdown();
  if (!pending) return;
  if (!pending.stored) {
    const saved = await storeSession(pending.token, pending.username, pending.remember);
    authSessionVolatile = pending.remember && !saved;
  }
  authVerifyInput.value = "";
  startAuthConnection(pending.token);
}

/** "Entrar com outra conta": descarta a sessão pendente (inclusive a salva) e volta ao login. */
function cancelEmailStep() {
  const pending = authPending;
  authPending = null;
  stopResendCountdown();
  if (pending?.stored) {
    SancordConnection.stop();
    clearStoredSession();
  }
  if (pending?.token) requestAuth("/api/logout", { token: pending.token }).catch(() => {});
}

function setAuthBusy(active, operation = authMode) {
  authBusy = active;
  loginForm.setAttribute("aria-busy", String(active));
  for (const control of loginModal.querySelectorAll("button, input")) control.disabled = active;
  authSubmitBtn.classList.toggle("is-loading", active);
  const label = active ? `auth.progress.${operation}` : `auth.submit.${authMode}`;
  setAuthText(authSubmitLabel, label);
  authProgress.textContent = active ? t(label) : "";
}

function showAuthScreen({ mode = "login", username, error } = {}) {
  authConnecting = false;
  clearTimeout(authFadeTimer);
  document.body.removeAttribute("data-auth-pending");
  loginModal.inert = false;
  loginModal.classList.remove("hidden", "auth-leaving");
  if (username !== undefined) usernameInput.value = username;
  passwordInput.value = "";
  setAuthBusy(false);
  setAuthMode(mode);
  if (error) showAuthError(error);
}

function finishAuthScreen() {
  if (!authConnecting && !document.body.hasAttribute("data-auth-pending")) return;
  authConnecting = false;
  document.body.removeAttribute("data-auth-pending");
  if (!loginModal.classList.contains("hidden")) {
    loginModal.inert = true;
    loginModal.classList.add("auth-leaving");
    authFadeTimer = setTimeout(() => {
      loginModal.classList.add("hidden");
      loginModal.classList.remove("auth-leaving");
      setAuthBusy(false);
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 180);
  } else setAuthBusy(false);
  if (authResetCompleted) showUiToast(t("auth.notice.recovered"));
  if (authSessionVolatile) showErrorToast(t("auth.notice.temporary"));
  authResetCompleted = false;
  authSessionVolatile = false;
}

function startAuthConnection(token, cached = false) {
  authConnecting = true;
  setAuthBusy(true, "session");
  SancordConnection.start(token, cached);
  if (cached) finishAuthScreen();
}

function authRejected(message) {
  authResetCompleted = false;
  authSessionVolatile = false;
  const deleted = message?.includes("Conta excluída") || message?.includes("Conta desativada");
  showAuthScreen({ error: deleted ? "auth.error.accountUnavailable" : "auth.error.session" });
}

function validateAuthFields(mode) {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const recoveryCode = authCodeInput.value.trim();
  const email = authEmailInput.value.trim();
  const errors = new Map();
  if (mode === "add-email" || mode === "verify") {
    if (mode === "add-email") {
      if (!email) errors.set(authEmailInput, "auth.error.email");
      else if (!AUTH_EMAIL_RE.test(email)) errors.set(authEmailInput, "auth.error.emailInvalid");
    } else if (authVerifyInput.value.replace(/\D/g, "").length !== 6) errors.set(authVerifyInput, "auth.error.verifyCode");
    if (errors.size) {
      for (const [field, key] of errors) setAuthFieldError(field, key);
      errors.keys().next().value.focus();
      return null;
    }
    return mode === "add-email" ? { email } : { code: authVerifyInput.value.replace(/\D/g, "") };
  }
  if (!username) errors.set(usernameInput, mode === "register" ? "auth.error.username" : "auth.error.identifier");
  else if (mode === "register") {
    if ([...username].length < 2 || [...username].length > 24) errors.set(usernameInput, "auth.error.usernameLength");
    else if (/[<>:"`\p{Cc}]/u.test(username) || username.includes("__")) errors.set(usernameInput, "auth.error.usernameChars");
  }
  if (mode === "register") {
    if (!email) errors.set(authEmailInput, "auth.error.email");
    else if (!AUTH_EMAIL_RE.test(email)) errors.set(authEmailInput, "auth.error.emailInvalid");
  }
  if (mode === "recovery" && !recoveryCode) errors.set(authCodeInput, "auth.error.code");
  if (!password) errors.set(passwordInput, "auth.error.password");
  else if (mode !== "login" && ([...password].length < 8 || [...password].length > 128)) errors.set(passwordInput, "auth.error.passwordLength");
  if (mode === "recovery" && password !== authConfirmInput.value) errors.set(authConfirmInput, "auth.error.confirm");
  if (errors.size) {
    for (const [field, key] of errors) setAuthFieldError(field, key);
    errors.keys().next().value.focus();
    return null;
  }
  const remember = authRemember.checked;
  return mode === "recovery"
    ? { username, recovery_code: recoveryCode, new_password: password, remember }
    : mode === "register" ? { username, email, password, remember } : { username, password, remember };
}

function showAuthResponseError(code, mode, data) {
  if (code === 409 && mode === "register" && data?.code === "email_taken") {
    setAuthFieldError(authEmailInput, "auth.error.emailUsed");
    authEmailInput.focus();
  } else if (code === 400 && mode === "register" && (data?.code === "email_invalid" || data?.code === "email_missing")) {
    setAuthFieldError(authEmailInput, data.code === "email_missing" ? "auth.error.email" : "auth.error.emailInvalid");
    authEmailInput.focus();
  } else if (code === 409 && mode === "register") {
    setAuthFieldError(usernameInput, "auth.error.usernameUsed");
    usernameInput.focus();
  } else if (code === 401) {
    const field = mode === "recovery" ? authCodeInput : passwordInput;
    setAuthFieldError(field, mode === "recovery" ? "auth.error.recovery" : "auth.error.credentials");
    field.focus();
  } else if (code === 429) showAuthError("auth.error.limit");
  else if (code === 400) showAuthError("auth.error.form");
  else showAuthError("auth.error.server", () => loginForm.requestSubmit());
}

async function requestAuth(path, payload, timeout = 12000) {
  return SancordNet.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeout),
  });
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (authBusy) return;
  showAuthError();
  for (const field of AUTH_FIELDS()) setAuthFieldError(field);
  if (!SancordNet.secureForAuth) {
    showAuthError("auth.error.secure");
    return;
  }
  const mode = authMode;
  const payload = validateAuthFields(mode);
  if (!payload) return;
  if (mode === "add-email") return requestEmailCode(payload.email);
  if (mode === "verify") return verifyEmailCode(payload.code);
  setAuthBusy(true);
  try {
    const response = await requestAuth(AUTH_SCREEN_MODES[mode].endpoint, payload);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data.token) {
      setAuthBusy(false);
      showAuthResponseError(response.status, mode, data);
      return;
    }
    if (data.email_step) {
      // A sessão já existe, mas o app só abre depois do e-mail confirmado.
      for (const field of [passwordInput, authCodeInput, authConfirmInput]) field.value = "";
      enterEmailStep({
        token: data.token, username: data.username, remember: payload.remember, step: data.email_step,
        hint: data.email_hint, sent: mode === "register" && Boolean(data.retry_after), retryAfter: data.retry_after,
        failed: data.code === "send_failed",
      });
      return;
    }
    const saved = await storeSession(data.token, data.username, payload.remember);
    authSessionVolatile = payload.remember && !saved;
    authResetCompleted = mode === "recovery";
    for (const field of [passwordInput, authCodeInput, authConfirmInput]) field.value = "";
    setPasswordVisible(false);
    startAuthConnection(data.token);
  } catch (_) {
    setAuthBusy(false);
    showAuthError("auth.error.network", () => loginForm.requestSubmit());
  }
});

async function tryAutoLogin() {
  if (!SancordNet.secureForAuth) {
    showAuthScreen({ error: "auth.error.secure" });
    return;
  }
  const token = getStoredToken();
  if (!token) {
    showAuthScreen();
    SancordConnection.checkLoginAvailability();
    return;
  }
  const cached = await SancordOfflineCache.restore();
  if (!cached) {
    try {
      const response = await requestAuth("/api/session", { token }, 3000);
      if (response.status === 401) { SancordConnection.reject(); return; }
      const data = await response.json().catch(() => null);
      if (data?.email_step) { requireEmailStep({ step: data.email_step, email_hint: data.email_hint }); return; }
    } catch (_) { /* O gerenciador classifica a falha e agenda a recuperação. */ }
  }
  if (token === getStoredToken()) startAuthConnection(token, cached);
}

document.getElementById("offline-sign-in").addEventListener("click", () => {
  SancordConnection.stop();
  showAuthScreen({ username: getStoredUsername() || "" });
});

tabRegister.addEventListener("click", () => setAuthMode("register"));
tabLogin.addEventListener("click", () => setAuthMode("login"));
authResendBtn.addEventListener("click", () => requestEmailCode());
document.getElementById("auth-change-email-btn").addEventListener("click", () => setAuthMode("add-email"));
document.getElementById("auth-other-account-btn").addEventListener("click", () => {
  cancelEmailStep();
  setAuthMode("login");
});
authVerifyInput.addEventListener("input", () => {
  // Colar "123 456" ou digitar o sexto número já envia.
  const digits = authVerifyInput.value.replace(/\D/g, "").slice(0, 6);
  if (authVerifyInput.value !== digits) authVerifyInput.value = digits;
  if (digits.length === 6 && !authBusy) loginForm.requestSubmit();
});
document.getElementById("open-recover-password-btn").addEventListener("click", () => setAuthMode("recovery"));
authPasswordToggle.addEventListener("click", () => setPasswordVisible(passwordInput.type === "password"));
document.addEventListener("sancord:language", () => setPasswordVisible(passwordInput.type === "text"));
authRetryButton.addEventListener("click", () => { if (!authBusy) authRetry?.(); });
for (const field of AUTH_FIELDS()) {
  field.addEventListener("input", () => {
    setAuthFieldError(field);
    showAuthError();
  });
}

void (async () => {
  await SancordSessions.ready;
  await tryAutoLogin();
})();
