#![windows_subsystem = "windows"]

mod capture_bridge;
mod desktop_activity;
mod desktop_assets;
mod desktop_auth_storage;
mod desktop_links;
mod desktop_permissions;
mod desktop_taskbar;
mod desktop_tunnel;
mod desktop_updater;
use desktop_links::{confirm_page, desktop_url, link_endpoint, open_link_page, origin_of, KnownEndpoints};

use std::env;
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    platform::windows::WindowExtWindows,
    window::{Icon, WindowBuilder},
};
use wry::{WebContext, WebViewBuilder};

const LOGO_BYTES: &[u8] = include_bytes!("../../static/logo.png");
const ICON_RGBA: &[u8] = include_bytes!("../../icon_rgba.bin");
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone)]
enum UserEvent {
    /// Escolher o backend; a página carregada continua sendo um recurso do exe.
    Navigate(String),
    Discovered(String),
    OpenLink(String),
    /// Usuário confirmou na tela de conexão que confia no servidor do link.
    TrustLink(String),
    /// Usuário recusou o link: volta ao servidor local ou à tela de conexão.
    CancelLink,
    Status(String),
    /// Página terminou de carregar (usado para injetar a ponte só em origens confiáveis).
    PageLoaded(String),
    Update(serde_json::Value),
    DesktopState(serde_json::Value),
    AuthStorage(serde_json::Value),
    ActivityState(serde_json::Value),
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct DesktopPrefs {
    #[serde(default)]
    start_minimized: bool,
    #[serde(default)]
    minimize_on_close: bool,
}

impl DesktopPrefs {
    fn load(data_dir: &Path) -> Self {
        fs::read_to_string(data_dir.join("desktop-prefs.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
    fn save(&self, data_dir: &Path) {
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = fs::write(data_dir.join("desktop-prefs.json"), json);
        }
    }
}

const RUN_REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_REG_VALUE: &str = sancord::legacy_sancord_migration::RUN_REG_VALUE_SANVO;
const RUN_REG_VALUE_LEGACY: &str = sancord::legacy_sancord_migration::RUN_REG_VALUE_LEGACY_SANCORD;

fn query_windows_autostart() -> bool {
    for val_name in [RUN_REG_VALUE, RUN_REG_VALUE_LEGACY] {
        let ok = Command::new("reg.exe")
            .args(["query", RUN_REG_KEY, "/v", val_name])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok_and(|o| o.status.success());
        if ok {
            return true;
        }
    }
    false
}

fn set_windows_autostart(enabled: bool, minimized: bool) {
    // Limpa chave legada SancordDesktop sempre que o autostart é atualizado ou desativado.
    let _ = Command::new("reg.exe")
        .args(["delete", RUN_REG_KEY, "/v", RUN_REG_VALUE_LEGACY, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    if !enabled {
        let _ = Command::new("reg.exe")
            .args(["delete", RUN_REG_KEY, "/v", RUN_REG_VALUE, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        return;
    }
    let exe = sancord::legacy_sancord_migration::env_var_compat("SANVO_LAUNCHER_EXE", "SANCORD_LAUNCHER_EXE")
        .map(PathBuf::from)
        .or_else(|| env::current_exe().ok());
    let Some(exe) = exe else { return };
    let value = if minimized {
        format!("\"{}\" --minimized", exe.display())
    } else {
        format!("\"{}\"", exe.display())
    };
    let _ = Command::new("reg.exe")
        .args(["add", RUN_REG_KEY, "/v", RUN_REG_VALUE, "/t", "REG_SZ", "/d", &value, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

fn desktop_state_json(data_dir: &Path, prefs: &DesktopPrefs) -> serde_json::Value {
    serde_json::json!({
        "isDesktop": true,
        "version": env!("CARGO_PKG_VERSION"),
        "arch": env::consts::ARCH,
        "os": "Windows",
        "dataDir": data_dir.display().to_string(),
        "autostart": query_windows_autostart(),
        "startMinimized": prefs.start_minimized,
        "minimizeOnClose": prefs.minimize_on_close,
    })
}

/// Chave pública de descoberta embutida pelo build.rs (vazia = descoberta remota desativada).
const DISCOVERY_PUBKEY: &str = env!("SANCORD_DISCOVERY_PUBKEY");

/// Origens (`esquema://host:porta`) em que o app confia. Só páginas dessas
/// origens podem ser abertas na janela, usar o IPC e acessar a ponte de captura.
pub type TrustedOrigins = Arc<Mutex<Vec<String>>>;

/// Tela interna de conexão, também embutida no executável.
fn is_internal_page(url: &str) -> bool {
    desktop_assets::is_app_page(url) && url.split('?').next().is_some_and(|p| p.ends_with("/connect.html"))
}

/// Abre links externos no navegador padrão do sistema, nunca dentro do app.
fn open_external(url: &str) {
    if origin_of(url).is_none() || url.chars().any(|c| c.is_control()) {
        return;
    }
    let _ = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

/// Script injetado automaticamente em qualquer página aberta dentro do Sancord Desktop
/// Cria a barra superior nativa estilo Discord Desktop (arrastável + botões minimizar/maximizar/fechar)
const TITLEBAR_INIT_SCRIPT: &str = r#"
(function() {
  function injectDesktopTitlebar() {
    if (document.getElementById("sancord-native-titlebar")) return;
    if (!document.body) {
      requestAnimationFrame(injectDesktopTitlebar);
      return;
    }

    const style = document.createElement("style");
    style.textContent = `
      #sancord-native-titlebar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 30px;
        background: var(--bg-tertiary, #171b24);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-left: 12px;
        z-index: var(--z-titlebar, 9000);
        user-select: none;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #sancord-titlebar-drag {
        flex: 1;
        height: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: default;
      }
      .sancord-tb-title {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--text-muted, #a5afc3);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sancord-tb-badge {
        background: var(--brand, #7862d4);
        color: #fff;
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 4px;
        font-weight: 700;
      }
      .sancord-tb-controls {
        display: flex;
        height: 100%;
      }
      .sancord-tb-btn {
        width: 42px;
        height: 100%;
        border: none;
        background: transparent;
        color: var(--text-secondary, #bec7d8);
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.12s, color 0.12s;
      }
      .sancord-tb-btn:hover {
        background: rgba(255,255,255,0.08);
        color: #fff;
      }
      .sancord-tb-btn.close:hover {
        background: var(--red-hover, #d55c6c);
        color: #fff;
      }
      html, body {
        height: 100% !important;
        overflow: hidden !important;
      }
      .app-layout {
        height: calc(100vh - 30px) !important;
        margin-top: 30px !important;
      }
      .channels-sidebar,
      .main-content,
      .members-sidebar {
        height: 100% !important;
      }
      .modal-backdrop {
        top: 30px !important;
      }
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: var(--bg-secondary, #222733);
      }
      ::-webkit-scrollbar-thumb {
        background: var(--bg-hover, #343d4b);
        border-radius: 4px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: var(--bg-tertiary, #171b24);
      }
    `;
    document.head.appendChild(style);

    const bar = document.createElement("div");
    bar.id = "sancord-native-titlebar";
    bar.innerHTML = `
      <div id="sancord-titlebar-drag">
        <div class="sancord-tb-title">
          <span>SANVO</span>
          <span class="sancord-tb-badge">DESKTOP</span>
        </div>
      </div>
      <div class="sancord-tb-controls">
        <button type="button" class="sancord-tb-btn" id="tb-min" title="Minimizar">&#8212;</button>
        <button type="button" class="sancord-tb-btn" id="tb-max" title="Maximizar">&#9633;</button>
        <button type="button" class="sancord-tb-btn close" id="tb-close" title="Fechar">&#10005;</button>
      </div>
    `;
    document.body.prepend(bar);

    const dragRegion = document.getElementById("sancord-titlebar-drag");
    dragRegion.addEventListener("mousedown", (e) => {
      if (e.button === 0 && e.detail === 1) {
        window.ipc?.postMessage("drag");
      }
    });
    dragRegion.addEventListener("dblclick", () => {
      window.ipc?.postMessage("maximize");
    });

    document.getElementById("tb-min").addEventListener("click", () => {
      window.ipc?.postMessage("minimize");
    });
    document.getElementById("tb-max").addEventListener("click", () => {
      window.ipc?.postMessage("maximize");
    });
    window.requestSanvoWindowClose = async (nativeClose = false) => {
      try {
        await window.Sanoted?.flushLocal();
        window.ipc?.postMessage(nativeClose ? "close-native" : "close");
      } catch (_) {
        window.showErrorToast?.("Termine de salvar as alterações locais do Sanoted antes de fechar.");
      }
    };
    document.getElementById("tb-close").addEventListener("click", () => window.requestSanvoWindowClose());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectDesktopTitlebar);
  } else {
    injectDesktopTitlebar();
  }
})();
"#;

const LOADER_HTML: &str = r#"<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sanvo</title>
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/ui.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg-tertiary);
      color: var(--text-header, #f0f2f8);
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      overflow: hidden;
    }
    .card {
      background: var(--bg-primary);
      backdrop-filter: none;
      width: 420px;
      padding: 40px 32px;
      border-radius: var(--radius-lg, 8px);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
      text-align: center;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .status-ring {
      width: 56px;
      height: 56px;
      border: 4px solid rgba(88, 101, 242, 0.2);
      border-top-color: var(--brand);
      border-radius: 50%;
      margin: 0 auto 20px;
      animation: spin 0.85s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 26px; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.3px; }
    p { color: var(--text-secondary, #bec7d8); font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
    .manual-toggle {
      background: transparent;
      border: none;
      color: var(--text-muted, #a5afc3);
      font-size: 12px;
      cursor: pointer;
      text-decoration: underline;
    }
    .manual-box {
      display: none;
      margin-top: 14px;
      gap: 8px;
    }
    .manual-box.open { display: flex; }
    input {
      flex: 1;
      background: var(--bg-input, #383f50);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      padding: 10px 12px;
      color: #fff;
      font-size: 13px;
      outline: none;
    }
    input:focus { border-color: var(--brand); }
    button.btn {
      background: var(--brand, #7862d4);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="status-ring"></div>
    <h1>Sanvo Desktop</h1>
    <p id="status-text">Localizando servidor Sanvo...</p>

    <button class="manual-toggle" id="toggle-manual">Conectar a um endereço específico</button>
    <form class="manual-box" id="manual-form">
      <input type="url" id="manual-url" placeholder="https://..." required />
      <button type="submit" class="btn">Entrar</button>
    </form>
  </div>

  <div class="card confirm-card" id="confirm-card" style="display:none">
    <h1>Abrir este link?</h1>
    <p>O link quer abrir o Sanvo conectado a:</p>
    <p><strong id="confirm-origin" style="color:#fff;word-break:break-all"></strong></p>
    <p style="font-size:13px">Esse servidor receberá seu login e suas mensagens. Continue só se você conhece e confia em quem o enviou.</p>
    <div style="display:flex;gap:8px;justify-content:center">
      <button class="btn" id="confirm-cancel" style="background:#4e5058">Cancelar</button>
      <button class="btn" id="confirm-ok">Confiar e conectar</button>
    </div>
  </div>

  <script>
    (() => {
      // Confirmação de servidor desconhecido (texto via textContent; nada é interpretado como HTML).
      const params = new URLSearchParams(location.search);
      const origin = params.get("confirm");
      const link = params.get("link");
      if (!origin || !link) return;
      document.querySelector(".card").style.display = "none";
      document.getElementById("confirm-card").style.display = "";
      document.getElementById("confirm-origin").textContent = origin;
      document.getElementById("confirm-ok").addEventListener("click", () => window.ipc?.postMessage("trust-link:" + link));
      document.getElementById("confirm-cancel").addEventListener("click", () => window.ipc?.postMessage("cancel-link"));
    })();
    const statusText = document.getElementById("status-text");
    const toggleManual = document.getElementById("toggle-manual");
    const manualForm = document.getElementById("manual-form");
    const manualInput = document.getElementById("manual-url");

    window.__setSancordStatus = (txt) => {
      if (statusText) statusText.textContent = txt;
    };

    toggleManual.addEventListener("click", () => {
      manualForm.classList.toggle("open");
    });

    manualForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = manualInput.value.trim().replace(/\/$/, "");
      if (val) {
        statusText.textContent = "Conectando...";
        window.ipc?.postMessage("navigate:" + val);
      }
    });
  </script>
  <script src="/js/updater.js"></script>
</body>
</html>
"#;

/// Título da janela com o contador de menções/DMs não lidas, ex.: "(3) Sancord".
fn desktop_title(base: &str, unread: u32) -> String {
    match unread {
        0 => base.to_string(),
        n if n > 99 => format!("(99+) {base}"),
        n => format!("({n}) {base}"),
    }
}

fn http_get_text(url: &str, timeout_secs: u32) -> Option<String> {
    let out = Command::new("curl.exe")
        .args([
            "-sL",
            "--max-time",
            &timeout_secs.to_string(),
            "-H",
            "ngrok-skip-browser-warning: true",
            url,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        None
    }
}

fn check_server_reachable(base_url: &str) -> bool {
    let check_url = format!("{}/api/public-url", base_url.trim_end_matches('/'));
    if let Some(body) = http_get_text(&check_url, 4) {
        return body.contains("url");
    }
    false
}

fn spawn_remote_discovery_thread(proxy: EventLoopProxy<UserEvent>, cancelled: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        while !cancelled.load(Ordering::Relaxed) {
            if is_local_server_running() {
                let _ = proxy.send_event(UserEvent::Discovered("http://localhost:3000".to_string()));
                return;
            }

            if DISCOVERY_PUBKEY.is_empty() {
                let _ = proxy.send_event(UserEvent::Status(
                    "Aguardando o servidor local. Para entrar no servidor de um amigo, use \"Conectar a um endereço específico\".".to_string(),
                ));
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }

            let _ = proxy.send_event(UserEvent::Status(
                "Procurando servidor ativo do Sanvo...".to_string(),
            ));

            if let Some(text) = http_get_text(
                &format!(
                    "https://ntfy.sh/{}/json?poll=1&since=48h",
                    sancord::discovery::DEFAULT_TOPIC
                ),
                6,
            ) {
                // Só aceita anúncios assinados pela chave do host. Mensagens
                // sem assinatura (inclusive o formato antigo) são ignoradas.
                let now = chrono::Utc::now().timestamp();
                let mut candidates: Vec<String> = Vec::new();
                for line in text.lines().rev() {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                        if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
                            if let Some(url) =
                                sancord::discovery::verify_announcement(DISCOVERY_PUBKEY, msg, now)
                            {
                                if !candidates.contains(&url) {
                                    candidates.push(url);
                                }
                            }
                        }
                    }
                }

                for candidate in candidates.into_iter().take(4) {
                    let _ = proxy.send_event(UserEvent::Status(format!(
                        "Testando conexão com {}...",
                        candidate
                    )));
                    if check_server_reachable(&candidate) {
                        let _ = proxy.send_event(UserEvent::Discovered(candidate));
                        return;
                    }
                }
            }

            let _ = proxy.send_event(UserEvent::Status(
                "Aguardando o anfitrião iniciar o servidor Sanvo...".to_string(),
            ));
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

fn is_local_server_running() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Se estivermos no PC onde o servidor existe e ele estiver desligado,
/// inicia o servidor + túnel automaticamente em segundo plano!
fn ensure_local_host_started_if_present() -> bool {
    use sancord::legacy_sancord_migration::env_var_compat;
    if env_var_compat("SANVO_DISABLE_LOCAL_HOST", "SANCORD_DISABLE_LOCAL_HOST").as_deref() == Some("1") { return false; }
    if is_local_server_running() {
        return true;
    }

    let host_exe = env_var_compat("SANVO_HOST_EXE", "SANCORD_HOST_EXE")
        .map(PathBuf::from)
        .or_else(|| {
            env::current_exe().ok().and_then(|exe| {
                let parent = exe.parent()?;
                ["SanvoServer.exe", "SancordServer.exe"]
                    .into_iter()
                    .map(|name| parent.join(name))
                    .find(|p| p.exists())
            })
        });
    if let Some(host_exe) = host_exe.filter(|p| p.is_file()) {
        let host_dir = env_var_compat("SANVO_HOST_DIR", "SANCORD_HOST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| host_exe.parent().unwrap_or(Path::new(".")).to_path_buf());
        let _ = Command::new(&host_exe)
            .current_dir(&host_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();

        let cloudflared_exe = host_dir.join("cloudflared.exe");
        // Só um túnel por anfitrião: reiniciar o servidor não abre outro endereço público.
        if cloudflared_exe.exists() && !desktop_tunnel::tunnel_running(&cloudflared_exe) {
            let tunnel_log = host_dir.join("data").join("tunnel.log");
            let _ = fs::create_dir_all(host_dir.join("data"));
            let _ = fs::remove_file(&tunnel_log);
            let _ = Command::new(cloudflared_exe)
                .args([
                    "tunnel",
                    "--url",
                    "http://localhost:3000",
                    "--logfile",
                    tunnel_log.to_str().unwrap_or("data/tunnel.log"),
                ])
                .current_dir(&host_dir)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
            // O anúncio (assinado) da URL do túnel agora é feito pelo próprio
            // servidor (src/discovery.rs), que observa o tunnel.log.
        }

        for _ in 0..15 {
            std::thread::sleep(Duration::from_millis(120));
            if is_local_server_running() {
                return true;
            }
        }
    }

    false
}

static ORIG_WNDPROC: AtomicIsize = AtomicIsize::new(0);
static CURRENT_TASKBAR_BADGE: AtomicU32 = AtomicU32::new(0);

unsafe extern "system" fn workarea_wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, MINMAXINFO, WM_GETMINMAXINFO, WNDPROC,
    };

    let orig = ORIG_WNDPROC.load(Ordering::Relaxed);
    let orig_fn: WNDPROC = if orig != 0 {
        Some(std::mem::transmute(orig))
    } else {
        None
    };

    if msg == WM_GETMINMAXINFO && lparam.0 != 0 {
        if let Some(f) = orig_fn {
            let _ = CallWindowProcW(Some(f), hwnd, msg, wparam, lparam);
        }
        let mmi = &mut *(lparam.0 as *mut MINMAXINFO);
        let hmonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(hmonitor, &mut mi).as_bool() {
            let work = mi.rcWork;
            let mon = mi.rcMonitor;
            mmi.ptMaxPosition.x = work.left - mon.left;
            mmi.ptMaxPosition.y = work.top - mon.top;
            mmi.ptMaxSize.x = work.right - work.left;
            mmi.ptMaxSize.y = work.bottom - work.top;
            mmi.ptMaxTrackSize.x = mmi.ptMaxSize.x;
            mmi.ptMaxTrackSize.y = mmi.ptMaxSize.y;
        }
        return LRESULT(0);
    }

    if let Some(f) = orig_fn {
        CallWindowProcW(Some(f), hwnd, msg, wparam, lparam)
    } else {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

fn install_workarea_maximize_hook(window: &tao::window::Window) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowLongPtrW, GWLP_WNDPROC};
    unsafe {
        let hwnd = HWND(window.hwnd() as _);
        let prev = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, workarea_wndproc as *const () as isize);
        ORIG_WNDPROC.store(prev, Ordering::Relaxed);
    }
}

fn main() {
    if desktop_updater::run_helper_if_requested() { return; }
    desktop_links::register_protocol();
    unsafe {
        let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(
            windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        );
    }

    let local_app_data = env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let data_dir = sancord::legacy_sancord_migration::resolve_desktop_data_dir(Path::new(&local_app_data));
    let _ = fs::create_dir_all(&data_dir);
    let _ = fs::write(data_dir.join("logo.png"), LOGO_BYTES);

    // A ponte nativa só aceita a interface embutida; o backend fornece dados.
    let trusted: TrustedOrigins = Arc::new(Mutex::new(vec![
        desktop_assets::APP_ORIGIN.to_string(),
    ]));
    // Segredo da ponte de captura: entregue apenas a páginas confiáveis.
    let capture_token = sancord::auth::generate_token();
    let capture_port = capture_bridge::start_capture_bridge(capture_token.clone(), trusted.clone());
    let mut known = KnownEndpoints::load(&data_dir);
    let explicit_endpoint = sancord::legacy_sancord_migration::env_var_compat("SANVO_SERVER_URL", "SANCORD_SERVER_URL")
        .and_then(|url| origin_of(&url));
    if let Some(ep) = &explicit_endpoint {
        known.trust(ep);
    }
    // Link recebido do sistema: abre direto só se o servidor já for conhecido.
    let initial_link = env::args().skip(1).find_map(|arg| {
        let page = open_link_page(&arg)?;
        let origin = link_endpoint(&arg)?;
        Some(if known.contains(&origin) { page } else { confirm_page(&arg, &origin) })
    });
    let local_ready = explicit_endpoint.is_none() && initial_link.is_none() && ensure_local_host_started_if_present();
    let window_icon = Icon::from_rgba(ICON_RGBA.to_vec(), 64, 64).ok();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy: EventLoopProxy<UserEvent> = event_loop.create_proxy();
    let updater = desktop_updater::Updater::new(&data_dir, proxy.clone());
    let discovery_cancelled = Arc::new(AtomicBool::new(false));
    let base_title = sancord::legacy_sancord_migration::env_var_compat("SANVO_WINDOW_TITLE", "SANCORD_WINDOW_TITLE")
        .unwrap_or_else(|| "Sanvo".into());

    let window = std::rc::Rc::new(
        WindowBuilder::new()
            .with_title(base_title.clone())
            .with_window_icon(window_icon)
            .with_decorations(false)
            .with_inner_size(LogicalSize::new(1320.0, 830.0))
            .with_min_inner_size(LogicalSize::new(940.0, 600.0))
            .build(&event_loop)
            .expect("Falha ao criar janela nativa do Sanvo"),
    );

    install_workarea_maximize_hook(&window);
    if env::args().any(|arg| arg == "--minimized") {
        window.set_minimized(true);
    }

    let desktop_prefs = Arc::new(Mutex::new(DesktopPrefs::load(&data_dir)));
    let ipc_data_dir = data_dir.clone();
    let ipc_prefs = desktop_prefs.clone();
    let mut web_context = WebContext::new(Some(data_dir));
    let win_ipc = window.clone();
    let ipc_proxy = proxy.clone();
    let nav_proxy = proxy.clone();
    let new_window_proxy = proxy.clone();
    let load_proxy = proxy.clone();
    let ipc_updater = updater.clone();
    let (auth_requests, auth_receiver) = std::sync::mpsc::sync_channel::<String>(32);
    let auth_proxy = proxy.clone();
    std::thread::spawn(move || {
        for message in auth_receiver {
            if let Some(reply) = desktop_auth_storage::handle_request(&message) {
                let _ = auth_proxy.send_event(UserEvent::AuthStorage(reply));
            }
        }
    });

    let activity_proxy_bg = proxy.clone();
    let activity_monitor = Arc::new(desktop_activity::ActivityMonitor::spawn(
        ipc_data_dir.clone(),
        move |snapshot| {
            let _ = activity_proxy_bg.send_event(UserEvent::ActivityState(snapshot));
        },
    ));
    let (activity_requests, activity_receiver) = std::sync::mpsc::sync_channel::<String>(32);
    let activity_proxy_ipc = proxy.clone();
    let activity_monitor_ipc = activity_monitor.clone();
    std::thread::spawn(move || {
        for message in activity_receiver {
            let reply = activity_monitor_ipc.handle_ipc(&message);
            let _ = activity_proxy_ipc.send_event(UserEvent::ActivityState(reply));
        }
    });

    // A porta/segredo da ponte NÃO vão no script de inicialização (que roda em
    // qualquer página); são injetados depois do carregamento, só em origem confiável.
    let builder = WebViewBuilder::with_web_context(&mut web_context)
        .with_custom_protocol("sanvo".into(), |_id, request| desktop_assets::response(request))
        .with_custom_protocol("sancord".into(), |_id, request| desktop_assets::response(request)) // LEGACY COMPATIBILITY
        .with_initialization_script(TITLEBAR_INIT_SCRIPT)
        .with_initialization_script("window.__SANVO_AUTH_DPAPI = true; window.__SANVO_ACTIVITY_NATIVE = true; window.__SANCORD_AUTH_DPAPI = true; window.__SANCORD_ACTIVITY_NATIVE = true;")
        .with_navigation_handler(move |url: String| {
            if desktop_assets::is_app_page(&url) {
                return true;
            }
            if open_link_page(&url).is_some() { let _ = nav_proxy.send_event(UserEvent::OpenLink(url)); return false; }
            open_external(&url);
            false
        })
        .with_new_window_req_handler(move |url: String| {
            if open_link_page(&url).is_some() { let _ = new_window_proxy.send_event(UserEvent::OpenLink(url)); return false; }
            // Links com target="_blank" abrem no navegador do sistema.
            open_external(&url);
            false
        })
        .with_on_page_load_handler(move |event, url| {
            if matches!(event, wry::PageLoadEvent::Finished) {
                let _ = load_proxy.send_event(UserEvent::PageLoaded(url));
            }
        })
        .with_ipc_handler(move |req| {
            let page = req.uri().to_string();
            let from_loader = is_internal_page(&page);
            if !desktop_assets::is_app_page(&page) {
                return;
            }
            let cmd = req.body();
            if let Some(message) = cmd.strip_prefix("auth-storage:") {
                if !from_loader && message.len() <= desktop_auth_storage::MAX_IPC_BYTES {
                    let _ = auth_requests.try_send(message.to_string());
                }
                return;
            }
            if let Some(message) = cmd.strip_prefix("activity:") {
                if !from_loader && message.len() <= desktop_activity::MAX_IPC_BYTES {
                    let _ = activity_requests.try_send(message.to_string());
                }
                return;
            }
            if let Some(action) = cmd.strip_prefix("updates:") {
                ipc_updater.command(action);
                return;
            }
            if let Some(link) = cmd.strip_prefix("trust-link:") {
                // Só a tela de conexão (onde o usuário vê o endereço) pode confirmar.
                if from_loader && open_link_page(link).is_some() {
                    let _ = ipc_proxy.send_event(UserEvent::TrustLink(link.into()));
                }
                return;
            }
            if cmd == "cancel-link" {
                if from_loader {
                    let _ = ipc_proxy.send_event(UserEvent::CancelLink);
                }
                return;
            }
            if let Some(link) = cmd.strip_prefix("open-link:") {
                if open_link_page(link).is_some() { let _ = ipc_proxy.send_event(UserEvent::OpenLink(link.into())); }
                return;
            }
            if let Some(url) = cmd.strip_prefix("navigate:") {
                // Só a tela de carregamento pode pedir navegação manual, e só para http(s).
                if from_loader && origin_of(url).is_some() {
                    let _ = ipc_proxy.send_event(UserEvent::Navigate(url.trim().to_string()));
                }
                return;
            }
            // Fase 9: aviso nativo. "attention" pisca na barra de tarefas (só se a janela
            // não estiver em foco); "badge:N" mostra as menções pendentes no título.
            if cmd == "attention" {
                if !win_ipc.is_focused() {
                    win_ipc.request_user_attention(Some(tao::window::UserAttentionType::Informational));
                }
                return;
            }
            if let Some(action) = cmd.strip_prefix("desktop:") {
                let mut prefs = ipc_prefs.lock().unwrap_or_else(|e| e.into_inner());
                match action {
                    "get-state" => {}
                    "set-autostart:1" => set_windows_autostart(true, prefs.start_minimized),
                    "set-autostart:0" => set_windows_autostart(false, false),
                    "set-start-minimized:1" => {
                        prefs.start_minimized = true;
                        prefs.save(&ipc_data_dir);
                        if query_windows_autostart() {
                            set_windows_autostart(true, true);
                        }
                    }
                    "set-start-minimized:0" => {
                        prefs.start_minimized = false;
                        prefs.save(&ipc_data_dir);
                        if query_windows_autostart() {
                            set_windows_autostart(true, false);
                        }
                    }
                    "set-minimize-on-close:1" => {
                        prefs.minimize_on_close = true;
                        prefs.save(&ipc_data_dir);
                    }
                    "set-minimize-on-close:0" => {
                        prefs.minimize_on_close = false;
                        prefs.save(&ipc_data_dir);
                    }
                    "open-data-dir" => {
                        let _ = Command::new("explorer.exe")
                            .arg(&ipc_data_dir)
                            .creation_flags(CREATE_NO_WINDOW)
                            .spawn();
                    }
                    _ => {}
                }
                let snapshot = desktop_state_json(&ipc_data_dir, &prefs);
                let _ = ipc_proxy.send_event(UserEvent::DesktopState(snapshot));
                return;
            }
            if let Some(n) = cmd.strip_prefix("taskbar-badge:") {
                let count: u32 = n.trim().parse().unwrap_or(0).min(999);
                CURRENT_TASKBAR_BADGE.store(count, Ordering::Relaxed);
                desktop_taskbar::apply_taskbar_badge(win_ipc.hwnd() as isize, count);
                return;
            }
            if cmd == "call-attention:start" {
                desktop_taskbar::set_call_attention_flash(win_ipc.hwnd() as isize, true);
                return;
            }
            if cmd == "call-attention:stop" {
                desktop_taskbar::set_call_attention_flash(win_ipc.hwnd() as isize, false);
                return;
            }
            if cmd == "window:focus" {
                if win_ipc.is_minimized() {
                    win_ipc.set_minimized(false);
                }
                win_ipc.set_focus();
                desktop_taskbar::set_call_attention_flash(win_ipc.hwnd() as isize, false);
                return;
            }
            if let Some(n) = cmd.strip_prefix("badge:") {
                let count: u32 = n.trim().parse().unwrap_or(0).min(999);
                win_ipc.set_title(&desktop_title(&base_title, count));
                return;
            }
            match cmd.as_str() {
                "drag" => {
                    let _ = win_ipc.drag_window();
                }
                "minimize" => {
                    win_ipc.set_minimized(true);
                }
                "maximize" => {
                    win_ipc.set_maximized(!win_ipc.is_maximized());
                }
                "close" => {
                    let minimize = ipc_prefs
                        .lock()
                        .map(|p| p.minimize_on_close)
                        .unwrap_or(false);
                    if minimize {
                        win_ipc.set_minimized(true);
                    } else {
                        std::process::exit(0);
                    }
                }
                "close-native" => {
                    desktop_taskbar::apply_taskbar_badge(win_ipc.hwnd() as isize, 0);
                    std::process::exit(0);
                }
                _ => {}
            }
        });

    let webview = if explicit_endpoint.is_some() || local_ready || initial_link.is_some() {
        let endpoint = explicit_endpoint.as_deref().unwrap_or("http://localhost:3000");
        let page = initial_link.unwrap_or_else(|| desktop_url(endpoint).unwrap_or_else(|| desktop_assets::CONNECT_URL.into()));
        builder
            .with_url(&page)
            .build(&*window)
            .expect("Falha ao inicializar WebView2 nativo")
    } else {
        spawn_remote_discovery_thread(proxy.clone(), discovery_cancelled.clone());
        builder
            .with_url(desktop_assets::CONNECT_URL)
            .build(&*window)
            .expect("Falha ao inicializar WebView2 nativo")
    };
    desktop_permissions::grant_app_media(&webview);

    let mut last_minimized = None;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let page_loaded = matches!(&event, Event::UserEvent(UserEvent::PageLoaded(_)));
        if page_loaded || matches!(&event, Event::WindowEvent {
            event: WindowEvent::Resized(_) | WindowEvent::Focused(_), ..
        }) {
            let minimized = window.is_minimized();
            if page_loaded || last_minimized != Some(minimized) {
                last_minimized = Some(minimized);
                let _ = webview.evaluate_script(&format!(
                    "window.__SANVO_WINDOW_MINIMIZED = {minimized}; window.dispatchEvent(new Event('sanvo:window-visibility'));"
                ));
            }
        }
        match event {
            Event::UserEvent(UserEvent::Navigate(url)) => {
                // Endereço digitado pelo próprio usuário na tela de conexão.
                discovery_cancelled.store(true, Ordering::Relaxed);
                known.trust(&url);
                if let Some(page) = desktop_url(&url) { let _ = webview.load_url(&desktop_assets::webview_url(&page)); }
            }
            Event::UserEvent(UserEvent::Discovered(url)) => {
                // Local ou anúncio com assinatura válida do anfitrião.
                if !discovery_cancelled.swap(true, Ordering::Relaxed) {
                    known.trust(&url);
                    if let Some(page) = desktop_url(&url) { let _ = webview.load_url(&desktop_assets::webview_url(&page)); }
                }
            }
            Event::UserEvent(UserEvent::OpenLink(link)) => {
                discovery_cancelled.store(true, Ordering::Relaxed);
                let Some(origin) = link_endpoint(&link) else { return };
                let page = if known.contains(&origin) {
                    open_link_page(&link)
                } else {
                    Some(confirm_page(&link, &origin))
                };
                if let Some(page) = page { let _ = webview.load_url(&desktop_assets::webview_url(&page)); }
            }
            Event::UserEvent(UserEvent::CancelLink) => {
                let page = if is_local_server_running() {
                    desktop_url("http://localhost:3000").unwrap_or_else(|| desktop_assets::CONNECT_URL.into())
                } else {
                    desktop_assets::CONNECT_URL.into()
                };
                let _ = webview.load_url(&desktop_assets::webview_url(&page));
            }
            Event::UserEvent(UserEvent::TrustLink(link)) => {
                if let Some(origin) = link_endpoint(&link) {
                    known.trust(&origin);
                    if let Some(page) = open_link_page(&link) { let _ = webview.load_url(&desktop_assets::webview_url(&page)); }
                }
            }
            Event::UserEvent(UserEvent::PageLoaded(url)) => {
                if desktop_assets::is_app_page(&url) {
                    updater.page_loaded(&url);
                    let _ = webview.evaluate_script(&format!(
                        "window.__SANCORD_CAPTURE_PORT = {capture_port}; window.__SANCORD_CAPTURE_TOKEN = {};",
                        serde_json::to_string(&capture_token).unwrap_or_default()
                    ));
                }
            }
            Event::UserEvent(UserEvent::Status(msg)) => {
                if let Ok(json_msg) = serde_json::to_string(&msg) {
                    let _ = webview.evaluate_script(&format!(
                        "window.__setSancordStatus && window.__setSancordStatus({});",
                        json_msg
                    ));
                }
            }
            Event::UserEvent(UserEvent::Update(value)) => {
                if value["phase"] == "handoff" {
                    *control_flow = ControlFlow::Exit;
                } else if let Ok(json) = serde_json::to_string(&value) {
                    let _ = webview.evaluate_script(&format!("window.dispatchEvent(new CustomEvent('sancord-update', {{detail:{json}}}));"));
                }
            }
            Event::UserEvent(UserEvent::DesktopState(value)) => {
                if let Ok(json) = serde_json::to_string(&value) {
                    let _ = webview.evaluate_script(&format!("window.dispatchEvent(new CustomEvent('sancord-desktop-state', {{detail:{json}}}));"));
                }
            }
            Event::UserEvent(UserEvent::AuthStorage(value)) => {
                if webview.url().is_ok_and(|url| desktop_assets::is_app_page(&url) && !is_internal_page(&url)) {
                    let _ = webview.evaluate_script(&format!("window.dispatchEvent(new CustomEvent('sancord-auth-storage', {{detail:{value}}}));"));
                }
            }
            Event::UserEvent(UserEvent::ActivityState(value)) => {
                if webview.url().is_ok_and(|url| desktop_assets::is_app_page(&url) && !is_internal_page(&url)) {
                    let _ = webview.evaluate_script(&format!("window.dispatchEvent(new CustomEvent('sancord-activity-state', {{detail:{value}}}));"));
                }
            }
            Event::WindowEvent {
                event: WindowEvent::ScaleFactorChanged { .. },
                ..
            } => {
                let count = CURRENT_TASKBAR_BADGE.load(Ordering::Relaxed);
                desktop_taskbar::apply_taskbar_badge(window.hwnd() as isize, count);
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if webview.evaluate_script("if (window.requestSanvoWindowClose) window.requestSanvoWindowClose(true); else window.ipc.postMessage('close-native');").is_err() {
                    desktop_taskbar::apply_taskbar_badge(window.hwnd() as isize, 0);
                    *control_flow = ControlFlow::Exit;
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod title_tests {
    use super::desktop_title;

    #[test]
    fn window_title_shows_pending_mentions() {
        assert_eq!(desktop_title("Sanvo", 0), "Sanvo");
        assert_eq!(desktop_title("Sanvo", 3), "(3) Sanvo");
        assert_eq!(desktop_title("Sanvo QA", 250), "(99+) Sanvo QA");
    }
}
