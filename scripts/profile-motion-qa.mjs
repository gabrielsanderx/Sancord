import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { runProfileArtQa } from './profile-art-qa.mjs';
import { runComposerVoiceQa } from './composer-voice-qa.mjs';

const composerVoiceQa = process.argv.includes('--composer-voice');

const exec = promisify(execFile);
const delay = ms => new Promise(r => setTimeout(r, ms));
const gif = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f90400140000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex');
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url.startsWith('/api/attachments/')) {
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.end(gif);
  } else {
    res.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = 'http://127.0.0.1:' + server.address().port;
const locator = createServer().listen(0, '127.0.0.1');
await once(locator, 'listening');
const debugPort = locator.address().port;
await new Promise((r, j) => locator.close(error => error ? j(error) : r()));
const debugUrl = 'http://127.0.0.1:' + debugPort;
const data = await mkdtemp(join(tmpdir(), 'sancord-profile-p8-'));
const app = spawn(resolve(process.env.SANCORD_QA_EXE || 'target/debug/SancordApp.exe'), [], { windowsHide: true, stdio: 'ignore', env: {
  ...process.env,
  SANCORD_DESKTOP_DATA_DIR: data,
  SANCORD_REGISTER_PROTOCOL: '0',
  SANCORD_DISABLE_UPDATES: '1',
  SANCORD_SERVER_URL: endpoint,
  SANCORD_WINDOW_TITLE: 'Sancord - QA perfis',
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + debugPort +
    (composerVoiceQa ? ' --use-fake-device-for-media-stream --use-fake-ui-for-media-stream' : ''),
} });
const clients = [];
async function connect(address) {
  const ws = new WebSocket(address);
  clients.push(ws);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const packet = JSON.parse(event.data);
    const op = pending.get(packet.id);
    if (!op) return;
    pending.delete(packet.id);
    if (packet.error) op.reject(Error(packet.error.message));
    else op.resolve(packet.result);
  };
  return (method, params = {}) => {
    const id = ++next;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
}
async function endpointJson(path) {
  const res = await fetch(debugUrl + path);
  if (!res.ok) throw Error('CDP HTTP ' + res.status);
  return res.json();
}
async function windowsStats(pids) {
  const ids = [app.pid, ...pids].filter(Number.isInteger);
  const ps = '$ids=@(' + ids.join(',') + '); ' +
    '$known=Get-Process -Id $ids -ErrorAction SilentlyContinue; ' +
    '$usage=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^pid_([0-9]+)_" -and $ids -contains [int]$Matches[1] } | Select-Object Name,UtilizationPercentage); ' +
    '[PSCustomObject]@{workingSetMB=[math]::Round(($known | Measure-Object WorkingSet64 -Sum).Sum / 1MB,1);gpu=$usage} | ConvertTo-Json -Compress -Depth 4';
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 6000 });
    const result = JSON.parse(stdout);
    const gpu = result.gpu || [];
    return { workingSetMB: result.workingSetMB, gpuEnginePeakPercent: gpu.length ? Math.max(...gpu.map(g => Number(g.UtilizationPercentage))) : null };
  } catch { return null; }
}
try {
  let target;
  for (let tryNo = 0; tryNo < 40 && !target; tryNo++) {
    const tabs = await endpointJson('/json/list').catch(() => []);
    target = tabs.find(t => t.type === 'page' && t.url.includes('sancord.localhost'));
    if (!target) await delay(500);
  }
  if (!target) throw Error('WebView2 não abriu a página embutida para QA.');
  const page = await connect(target.webSocketDebuggerUrl);
  const browserInfo = await endpointJson('/json/version').catch(() => ({}));
  const browser = browserInfo.webSocketDebuggerUrl ? await connect(browserInfo.webSocketDebuggerUrl).catch(() => null) : null;
  const processMetrics = () => browser ? browser('SystemInfo.getProcessInfo').then(r => r.processInfo).catch(() => []) : [];
  const evaluate = async expression => {
    const response = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt++) {
    ready = await evaluate(`document.readyState === 'complete' && typeof applyProfileVisualSettings === 'function'`).catch(() => false);
    if (!ready) await delay(100);
  }
  if (!ready) throw Error('O frontend embutido do Sancord não terminou de iniciar.');
  if (composerVoiceQa) {
    await runComposerVoiceQa(page, evaluate);
  } else if (process.argv.includes('--art')) {
    await runProfileArtQa(page, evaluate);
  } else {
  await page('Performance.enable');
  await page('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'no-preference'}] });
  const info = await evaluate(`({
    ready: typeof updateProfileMotion === "function",
    imageDecoder: typeof ImageDecoder,
    origin: location.origin,
    hidden: document.hidden
  })`);
  console.log(JSON.stringify({ environment: info }));
  if (!info.ready || info.imageDecoder !== 'function' || info.hidden) throw Error('A janela de QA não está disponível em primeiro plano.');
  await evaluate(`(() => {
    state.audioSettings.profileAnimations = "always";
    const root = document.createElement("section");
    root.id = "qa-motion-list";
    root.style.cssText = "position:fixed;inset:54px 20px 20px;z-index:99999;display:grid;grid-template-columns:repeat(10,minmax(0,1fr));grid-auto-rows:66px;gap:6px;overflow:auto;background:var(--bg-app);padding:10px";
    for(let i=0;i<240;i++) {
      const row = document.createElement("div"); row.className = "member-item";
      row.innerHTML = '<div class="user-avatar-wrap"><div class="avatar" style="background:#5144ab">' +
        renderAvatarInner("Pessoa "+i,"/api/attachments/teste/avatar.gif") +
        '</div>'+getDecoSvgHtml("core-orbit")+'</div><span class="styled-name">Pessoa '+i+'</span>';
      root.append(row);
    }
    document.body.append(root);
    applyProfileVisualSettings();
    return root.children.length;
  })()`);
  const count = `(() => {
    const nodes = [...document.querySelectorAll("#qa-motion-list img")];
    return {total:nodes.length, live:nodes.filter(img=>img.getAttribute("src") === img.dataset.profileSrc).length,
      still:nodes.filter(img=>img.classList.contains("profile-media-ready") && img.getAttribute("src")?.startsWith("blob:")).length,
      visible:nodes.filter(img=>profileMedia.get(img)?.visible).length,
      decoration:getComputedStyle(document.querySelector("#qa-motion-list .deco-svg-layer")).display,
      motionSurfaces:document.querySelectorAll(".profile-motion-active").length};
  })()`;
  let result;
  for (let i=0;i<30;i++) {
    result = await evaluate(count);
    if (result.live === 2 && result.still > 2) break;
    await delay(200);
  }
  if (result.live !== 2 || result.still < 3) throw Error('Slots ou quadros estáticos divergentes: ' + JSON.stringify(result));
  const getMetrics = async () => Object.fromEntries((await page('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const sample = async label => {
    const before = await getMetrics();
    const processesBefore = await processMetrics();
    const windows = windowsStats(processesBefore.map(p=>p.id));
    const frames = await evaluate(`new Promise(resolve => {
      let first = null, previous = 0, frames = 0, worst = 0;
      const step = now => {
        if (first === null) { first = now; previous = now; }
        else { frames++; worst = Math.max(worst, now - previous); previous = now; }
        if (now - first >= 2000) resolve({ fps: Math.round(frames*1000/(now-first)), maxFrameMs: Math.round(worst) });
        else requestAnimationFrame(step);
      }; requestAnimationFrame(step);
    })`);
    const after = await getMetrics();
    const processesAfter = await processMetrics();
    const timeByPid = Object.fromEntries(processesBefore.map(p=>[p.id,p.cpuTime]));
    const cpuMs = processesAfter.reduce((total,p)=>total + (p.id in timeByPid ? Math.max(0,p.cpuTime-timeByPid[p.id])*1000 : 0), 0);
    console.log(JSON.stringify({ label, ...await evaluate(count), ...frames,
      rendererTaskMs:Math.round((after.TaskDuration-before.TaskDuration)*1000),
      webviewProcessesCpuMs:processesAfter.length ? Math.round(cpuMs) : null,
      jsHeapMB:Number((after.JSHeapUsedSize / 1048576).toFixed(2)),
      windows:await windows,
    }));
  };
  await evaluate('noteProfileInteraction(document.querySelector("#qa-motion-list .member-item"),true)');
  await delay(150);
  await sample('cosmeticos_ligados');
  await evaluate('for (const id of ["decorations","frames","effects","nameplates","animations"]) { const input = document.getElementById("appearance-show-profile-"+id); if(input.checked) input.click(); }');
  await delay(150);
  const disabled = await evaluate(count);
  if (disabled.live !== 0 || disabled.decoration !== 'none' || disabled.still < result.still) throw Error('Preferências não foram aplicadas: ' + JSON.stringify(disabled));
  await sample('cosmeticos_desligados');
  await evaluate('state.audioSettings.showProfileAnimations=true; applyProfileVisualSettings(); window.dispatchEvent(new Event("blur"));');
  const background = await evaluate(count);
  if (background.live !== 0 || background.motionSurfaces) throw Error('Restaram animações na perda de foco.');
  console.log(JSON.stringify({label:'apos_perda_de_foco',...background}));
  }
} finally {
  for (const client of clients) client.close();
  app.kill();
  server.closeAllConnections();
  server.close();
}
