// QA desktop, com perfis WebView2 e backend descartáveis. Não usa dados de produção.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function until(label, check, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(110);
  }
  throw Error(`Tempo esgotado: ${label}`);
}

async function freePort() {
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

const data = await mkdtemp(join(tmpdir(), "sanvo-sanoted-qa-"));
const executable = resolve(process.env.SANCORD_QA_EXE || "target-dev/debug/SancordApp.exe");
const logs = join(data, "logs");
const port = await freePort();
const endpoint = `http://127.0.0.1:${port}`;
const processes = [];
const sockets = [];

function launch(exe, settings) {
  const child = spawn(exe, [], { windowsHide: true, stdio: "ignore", env: { ...process.env, ...settings } });
  processes.push(child);
  return child;
}

async function startBackend() {
  const child = launch(join(dirname(executable), "sancord.exe"), { SANCORD_BIND: `127.0.0.1:${port}`,
    SANCORD_DATA_DIR: join(data, "backend"), SANCORD_LOG_DIR: logs, SANCORD_DISCOVERY: "0" });
  await once(child, "spawn");
  await until("backend SQLite de QA", async () => (await fetch(endpoint + "/api/health").catch(() => null))?.ok);
  return child;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

async function startDesktop(name) {
  const debugPort = await freePort();
  const child = launch(executable, { SANCORD_DESKTOP_DATA_DIR: join(data, name),
    SANCORD_DISABLE_UPDATES: "1", SANCORD_DISABLE_LOCAL_HOST: "1", SANCORD_REGISTER_PROTOCOL: "0",
    SANCORD_SERVER_URL: endpoint, SANCORD_WINDOW_TITLE: `Sanoted QA - ${name}`,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort}` });
  const target = await until("WebView2 " + name, async () => {
    const tabs = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()).catch(() => []);
    return tabs.find(tab => tab.type === "page" && tab.url.includes(".localhost"));
  });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const pending = new Map();
  const events = new Map();
  ws.onmessage = event => {
    const result = JSON.parse(event.data);
    if (result.method) { events.get(result.method)?.(result.params); return; }
    const op = pending.get(result.id);
    if (!op) return;
    pending.delete(result.id);
    if (result.error) op.reject(Error(result.error.message));
    else op.resolve(result.result);
  };
  const cdp = (method, params) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async expression => {
    const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await until("scripts embutidos", () => run("typeof Sanoted !== 'undefined' && document.readyState === 'complete'"));
  return { child, run, cdp, events };
}

const text = value => JSON.stringify(value);
const sanity = "Lembrar de comprar SSD";
const recovered = "Texto recuperado depois de encerrar o processo";
const tokenPost = (path, payload) => fetch(endpoint + path, {
  method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
});
const username = "SanotedQA";
const email = "sanoted-qa@example.invalid";
const password = "qa-" + randomUUID();
const signedIn = `state.selfUser?.username === ${text(username)} && SancordConnection.canWrite()`;
const click = sel => `document.querySelector(${text(sel)}).click()`;
const choose = (sel, label) => `[...document.querySelectorAll(${text(sel)})].find(el => el.textContent.trim() === ${text(label)}).click()`;
const menu = label => choose(".msg-ctx-item", label);
const rightClick = sel => `document.querySelector(${text(sel)}).dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true,clientX:300,clientY:140}))`;
const submitDialog = `document.querySelector(".sancord-dialog form").requestSubmit()`;
const notesOpen = `!document.getElementById("sanoted-new").disabled && !document.getElementById("sanoted").classList.contains("hidden")`;
const noteRows = `[...document.querySelectorAll(".sanoted-note-row")]`;
const setInput = (sel, value) => `(() => { const input = document.querySelector(${text(sel)}); input.value = ${text(value)}; input.dispatchEvent(new Event("input", {bubbles:true})); })()`;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const dispatchFile = (event, name, type, bytes) => `(() => {
  const e = document.getElementById("sanoted-editor");
  const transfer = new DataTransfer();
  transfer.items.add(new File([Uint8Array.from(atob(${text(bytes)}), c => c.charCodeAt(0))], ${text(name)}, {type:${text(type)}}));
  if (${text(event)} === "change") {
    const input = document.getElementById("sanoted-file"); input.files = transfer.files;
    input.dispatchEvent(new Event("change", {bubbles:true}));
  } else e.dispatchEvent(${text(event)} === "paste"
    ? new ClipboardEvent("paste", {bubbles:true,cancelable:true,clipboardData:transfer})
    : new DragEvent("drop", {bubbles:true,cancelable:true,dataTransfer:transfer}));
})()`;

async function login(run) {
  await run(`usernameInput.value = ${text(username)}; passwordInput.value = ${text(password)};
    const remember = document.querySelector("#login-form input[type=checkbox]"); if (remember) remember.checked=true;
    loginForm.requestSubmit()`);
  await until("conta autenticada", () => run(signedIn));
}

async function show(run) {
  await run(click("#open-sanoted-btn"));
  await until("cache criptografado aberto", () => run(notesOpen));
}

async function apiNote(token, id, data) {
  const response = await fetch(endpoint + "/api/sanoted/notes/" + id, data ? {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  } : { headers: { Authorization: "Bearer " + token } });
  return response.ok ? response.json() : null;
}

try {
  let backend = await startBackend();
  const register = await tokenPost("/api/register", { username, email, password });
  assert.ok(register.ok);
  const { token } = await register.json();
  const code = await until("e-mail de QA", async () => {
    for (const name of await readdir(logs)) {
      const match = (await readFile(join(logs, name), "utf8")).match(/sanoted-qa@example\.invalid: (\d{6})/);
      if (match) return match[1];
    }
  });
  assert.ok((await tokenPost("/api/email/verify", { token, code })).ok);
  let a = await startDesktop("A");
  await login(a.run);
  await show(a.run);
  await a.run(click("#sanoted-new"));
  await a.run(setInput("#sanoted-title", sanity));
  const id = await until("nota local", () => a.run(`${noteRows}[0]?.dataset.noteId`));
  await a.run(`(() => {
    const e = document.getElementById("sanoted-editor");
    e.focus();
    const t = new DataTransfer(); t.setData("text/plain", "Comparar preços https://example.com/");
    e.dispatchEvent(new ClipboardEvent("paste", {clipboardData:t,bubbles:true,cancelable:true}));
    const r=document.createRange(); r.selectNodeContents(e);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector('[data-note-command="bold"]').click();
    document.querySelector('[data-note-command="checklist"]').click();
  })()`);
  await until("checklist na UI", () => a.run('Boolean(document.querySelector("[data-note-check]"))'));
  await a.run(click("[data-note-check]"));
  await a.run(dispatchFile("paste", "screenshot.png", "image/png", png));
  await a.run(dispatchFile("drop", "arrastado.png", "image/png", png));
  await a.run(dispatchFile("change", "arquivo.png", "image/png", png));
  const saved = await until("autosave e upload confirmado no SQLite", async () => {
    const note = await apiNote(token, id);
    return note?.blocks.filter(b => b.type === "asset").length === 3 && note;
  });
  assert.equal(saved.title, sanity);
  assert.equal(saved.blocks.some(b => b.style === "checklist" && b.items.some(i => i.checked)), true);
  assert.match(JSON.stringify(saved.blocks), /https:\/\/example\.com\//);
  assert.match(JSON.stringify(saved.blocks), /bold/);
  await until("miniatura da imagem", () => a.run(`Boolean(document.querySelector(".sanoted-asset img")?.naturalWidth)`));
  await a.run(click(".sanoted-image-button"));
  assert.equal(await a.run(`!imageLightboxModal.classList.contains("hidden")`), true);
  await a.run(`imageLightboxModal.classList.add("hidden")`);
  const assetMenu = click('.sanoted-asset button[aria-label="Opções do anexo"]');
  await a.run(assetMenu);
  await a.run(menu("Pequena"));
  await a.run(assetMenu);
  await a.run(menu("Editar legenda…"));
  await a.run(setInput('.sancord-dialog input[id^="f-caption"]', "Screenshot do orçamento"));
  await a.run(submitDialog);
  await until("tamanho e legenda persistidos", async () => (await apiNote(token, id))?.blocks.some(
    b => b.type === "asset" && b.size === "small" && b.caption === "Screenshot do orçamento"
  ));
  await a.run(click("#sanoted-more"));
  await a.run(`[...document.querySelectorAll(".msg-ctx-item")].find(el => el.textContent.trim() === "Favoritar")?.click()`);
  await until("nota favoritada", async () => (await apiNote(token, id))?.favorite);

  const b = await startDesktop("B");
  await login(b.run);
  await show(b.run);
  await until("nota no segundo perfil", () => b.run(`${noteRows}[0]?.dataset.noteId === ${text(id)}`));
  await b.run(click(`[data-note-id="${id}"]`));
  await until("documento no segundo perfil", () => b.run(`document.querySelector("#sanoted-title").value === ${text(sanity)} && document.querySelectorAll(".sanoted-asset").length === 3`));

  let suspendedUpload = false;
  a.events.set("Fetch.requestPaused", request => {
    if (request.request.method === "POST") suspendedUpload = true;
    else void a.cdp("Fetch.continueRequest", { requestId: request.requestId });
  });
  await a.cdp("Fetch.enable", { patterns: [{ urlPattern: `${endpoint}/api/sanoted/notes/*/assets/*` }] });
  await a.run(dispatchFile("paste", "interrompido.png", "image/png", png));
  await until("upload em andamento", () => suspendedUpload);
  await stop(backend);
  await until("queda real do backend", () => a.run("!SancordConnection.canWrite()"));
  await a.cdp("Fetch.disable");
  await a.run(setInput("#sanoted-title", recovered));
  await a.run(dispatchFile("paste", "offline.png", "image/png", png));
  await a.run("Sanoted.flushLocal()");
  assert.match(await a.run('document.querySelector("#sanoted-status").textContent'), /Offline/);
  await stop(a.child);
  a = await startDesktop("A");
  await until("startup com snapshot offline", () => a.run("Boolean(state.sanotedAccountId)"), 18000);
  await show(a.run);
  await until("nota no cache recuperado", () => a.run(`${noteRows}[0]?.textContent.includes(${text(recovered)})`));
  await a.run(click(`[data-note-id="${id}"]`));
  await until("anexos recuperados após encerramento", () => a.run(`document.querySelectorAll(".sanoted-asset").length === 5`));

  backend = await startBackend();
  await until("reconexão e sync de nota e anexo pendente", async () => {
    const note = await apiNote(token, id);
    return note?.title === recovered && note.blocks.filter(b => b.type === "asset").length === 5;
  }, 35000);
  await until("realtime no segundo perfil", () => b.run(`document.querySelector("#sanoted-title").value === ${text(recovered)}`), 35000);

  const { version: before, blocks } = await apiNote(token, id);
  const variant = "Edição concorrente em outro dispositivo";
  await b.run(setInput("#sanoted-title", "Minha edição concorrente"));
  assert.ok(await apiNote(token, id, { base_version: before, operation_id: randomUUID(),
    item: { title: variant, folder_id: null, pinned: false, favorite: true, deleted: false, blocks } }));
  await until("conflito de revisão na UI", () => b.run(`!document.querySelector("#sanoted-conflict").classList.contains("hidden")`));
  await b.run(choose("#sanoted-conflict button", "Manter minha versão"));
  const kept = await until("versão local escolhida", async () => {
    const note = await apiNote(token, id);
    return note?.title === "Minha edição concorrente" && note;
  });
  await until("versão resolvida aparece na outra janela", () => a.run(`document.querySelector("#sanoted-title").value === "Minha edição concorrente"`));
  await a.run(setInput("#sanoted-title", "Edição local a descartar"));
  assert.ok(await apiNote(token, id, { base_version: kept.version, operation_id: randomUUID(),
    item: { title: variant, folder_id: null, pinned: false, favorite: true, deleted: false, blocks: kept.blocks } }));
  await until("segundo conflito", () => a.run(`!document.querySelector("#sanoted-conflict").classList.contains("hidden")`));
  await a.run(choose("#sanoted-conflict button", "Usar versão do servidor"));
  await until("versão do servidor escolhida", () => a.run(`document.querySelector("#sanoted-title").value === ${text(variant)}`));

  await a.run(click("#sanoted-folder-new"));
  await a.run(setInput('.sancord-dialog input[id^="f-name"]', "Compras QA"));
  await a.run(submitDialog);
  const folder = await until("pasta criada", () => a.run(`document.querySelector(".sanoted-folder-row")?.dataset.folderId`));
  await a.run(click("#sanoted-more"));
  await a.run(menu("Mover para pasta…"));
  await a.run(setInput('.sancord-dialog select[id^="f-destination"]', folder));
  await a.run(submitDialog);
  await until("nota movida para pasta", async () => (await apiNote(token, id))?.folder_id === folder);
  await a.run(rightClick(".sanoted-note-row"));
  await a.run(menu("Fixar"));
  await until("nota fixada", async () => (await apiNote(token, id))?.pinned);
  await a.run(click('[data-note-filter="favorite"]'));
  await a.run(setInput("#sanoted-search", "compras qa"));
  await until("busca por pasta no filtro de favoritas", () => a.run(`${noteRows}[0]?.dataset.noteId === ${text(id)}`));
  await a.run(setInput("#sanoted-search", "sem resultado qa"));
  await until("busca sem resultado", () => a.run(`${noteRows}.length === 0`));
  await a.run(setInput("#sanoted-search", ""));
  await a.run(click("#sanoted-more"));
  await a.run(menu("Mover para a lixeira"));
  await until("nota na lixeira do backend", async () => (await apiNote(token, id))?.deleted_at);
  await a.run(click('[data-note-filter="trash"]'));
  await a.run(rightClick(".sanoted-note-row"));
  await a.run(menu("Restaurar"));
  await until("restaurada", async () => (await apiNote(token, id))?.deleted_at === null);
  await a.run(click("#sanoted-more"));
  await a.run(menu("Mover para a lixeira"));
  await until("nota novamente na lixeira", async () => (await apiNote(token, id))?.deleted_at);
  await a.run(rightClick(".sanoted-note-row"));
  await a.run(menu("Excluir permanentemente"));
  await a.run(submitDialog);
  await until("exclusão permanente", async () => await apiNote(token, id) === null);
  assert.equal(await a.run(`document.querySelector("#open-sanoted-btn").previousElementSibling.id`), "open-discover-servers-btn");
  await a.run(click("#open-starred-tab-btn"));
  assert.equal(await a.run(`document.querySelector("#sanoted").classList.contains("hidden")`), true);
  await show(a.run);
  await a.run(click("#open-friends-tab-btn"));
  assert.equal(await a.run(`document.querySelector("#sanoted").classList.contains("hidden")`), true);
  console.log("Sanoted QA passou: editor, anexos, pasta, busca, pin, favoritos, lixeira, conflito, navegação e dois perfis. Cache e anexos recuperados após encerrar o processo com o backend desligado.");
} finally {
  sockets.forEach(ws => ws.close());
  await Promise.all(processes.map(stop));
}
