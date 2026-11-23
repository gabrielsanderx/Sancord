// Uma superfície para as rotas de autenticação que o servidor oferece.
const AUTH_SCREEN_MODES = {
  login: { title: "auth.title", endpoint: "/api/login" },
  register: { title: "auth.register.title", endpoint: "/api/register" },
  recovery: { title: "auth.recovery.title", endpoint: "/api/recover-password", description: "auth.recovery.description" },
};
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
    const field = !usernameInput.value.trim() ? usernameInput : authMode === "recovery" ? authCodeInput : passwordInput;
    field.focus({ preventScroll: true });
  }
}

function setAuthMode(mode, focus = true) {
  const view = AUTH_SCREEN_MODES[mode];
  if (authMode !== mode) {
    for (const field of [passwordInput, authCodeInput, authConfirmInput]) field.value = "";
    authFields.classList.remove("auth-mode-enter");
    requestAnimationFrame(() => authFields.classList.add("auth-mode-enter"));
  }
  authMode = mode;
  loginModal.dataset.authMode = mode;
  loginModal.querySelectorAll("[data-auth-only]").forEach(section => {
    section.classList.toggle("hidden", !section.dataset.authOnly.split(" ").includes(mode));
  });
  setAuthText(document.getElementById("auth-title"), view.title);
  const description = document.getElementById("auth-description");
  description.classList.toggle("hidden", !view.description);
  if (view.description) setAuthText(description, view.description);
  passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
  passwordInput.setAttribute("aria-describedby", mode === "login" ? "auth-password-error" : "auth-password-error auth-password-hint");
  setAuthText(document.getElementById("auth-password-label"), mode === "recovery" ? "auth.newPassword" : "auth.password");
  setAuthText(tabLogin, mode === "recovery" ? "auth.tab.login" : "auth.submit.login");
  setAuthText(authSubmitLabel, `auth.submit.${mode}`);
  setPasswordVisible(false);
  for (const field of [usernameInput, passwordInput, authCodeInput, authConfirmInput]) setAuthFieldError(field);
  showAuthError();
  refreshAuthSavedAccounts();
  if (focus) focusAuthField();
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
  const errors = new Map();
  if (!username) errors.set(usernameInput, "auth.error.username");
  else if (mode === "register") {
    if ([...username].length < 2 || [...username].length > 24) errors.set(usernameInput, "auth.error.usernameLength");
    else if (/[<>:"`\p{Cc}]/u.test(username) || username.includes("__")) errors.set(usernameInput, "auth.error.usernameChars");
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
    : { username, password, remember };
}

function showAuthResponseError(code, mode) {
  if (code === 409 && mode === "register") {
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
  for (const field of [usernameInput, passwordInput, authCodeInput, authConfirmInput]) setAuthFieldError(field);
  if (!SancordNet.secureForAuth) {
    showAuthError("auth.error.secure");
    return;
  }
  const mode = authMode;
  const payload = validateAuthFields(mode);
  if (!payload) return;
  setAuthBusy(true);
  try {
    const response = await requestAuth(AUTH_SCREEN_MODES[mode].endpoint, payload);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data.token) {
      setAuthBusy(false);
      showAuthResponseError(response.status, mode);
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
document.getElementById("open-recover-password-btn").addEventListener("click", () => setAuthMode("recovery"));
authPasswordToggle.addEventListener("click", () => setPasswordVisible(passwordInput.type === "password"));
document.addEventListener("sancord:language", () => setPasswordVisible(passwordInput.type === "text"));
authRetryButton.addEventListener("click", () => { if (!authBusy) authRetry?.(); });
for (const field of [usernameInput, passwordInput, authCodeInput, authConfirmInput]) {
  field.addEventListener("input", () => {
    setAuthFieldError(field);
    showAuthError();
  });
}

void (async () => {
  await SancordSessions.ready;
  await tryAutoLogin();
})();
