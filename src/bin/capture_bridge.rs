use base64_helper::to_base64;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use windows::core::{implement, Interface, PROPVARIANT};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
    EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, ReleaseDC, SelectObject,
    SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HALFTONE, HDC, HMONITOR, MONITORINFOEXW, SRCCOPY,
};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    eConsole, eRender, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{
    CreateEventW, GetCurrentProcessId, SetEvent, WaitForSingleObject,
};
use windows::Win32::System::Variant::VT_BLOB;
use windows::Win32::Foundation::WPARAM;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{CreateSolidBrush, FillRect};
use windows::Win32::UI::WindowsAndMessaging::{
    DrawIconEx, EnumWindows, GetClassLongPtrW, GetCursorInfo, GetIconInfo, GetWindow,
    GetWindowLongW, GetWindowPlacement, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SendMessageTimeoutW, ShowWindow,
    CURSORINFO, CURSOR_SHOWING, DI_NORMAL, GCLP_HICON, GCLP_HICONSM, GWL_EXSTYLE, GW_OWNER,
    HICON, ICONINFO, ICON_BIG, ICON_SMALL2, SMTO_ABORTIFHUNG, SW_SHOWNOACTIVATE,
    WINDOWPLACEMENT, WM_GETICON, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

mod base64_helper {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn to_base64(input: &[u8]) -> String {
        let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
        for chunk in input.chunks(3) {
            let b0 = chunk[0] as usize;
            let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(TABLE[(n >> 18) & 63] as char);
            out.push(TABLE[(n >> 12) & 63] as char);
            out.push(if chunk.len() > 1 { TABLE[(n >> 6) & 63] as char } else { '=' });
            out.push(if chunk.len() > 2 { TABLE[n & 63] as char } else { '=' });
        }
        out
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CaptureSourceInfo {
    pub id: String,
    pub kind: String, // "monitor" | "window"
    pub title: String,
    pub width: i32,
    pub height: i32,
    pub thumbnail: String, // data:image/bmp;base64,...
    /// Janela minimizada: a miniatura é o ícone do app e ela é restaurada ao transmitir.
    #[serde(default)]
    pub minimized: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd")]
enum BridgeCommand {
    #[serde(rename = "list_sources")]
    ListSources,
    #[serde(rename = "start_capture")]
    StartCapture {
        id: String,
        kind: String,
        max_width: i32,
        max_height: i32,
        fps: u32,
        capture_audio: bool,
    },
    #[serde(rename = "stop_capture")]
    StopCapture,
}

#[derive(Debug, Serialize)]
struct SourcesResponse {
    #[serde(rename = "type")]
    msg_type: &'static str,
    sources: Vec<CaptureSourceInfo>,
}

const CAPTUREBLT_FLAG: u32 = 0x40000000;
const PW_RENDERFULLCONTENT: u32 = 2;

/// Inicia a ponte local de captura (tela/janela + áudio do sistema).
///
/// Segurança: qualquer página aberta em qualquer navegador do PC consegue abrir
/// WebSocket para 127.0.0.1. Por isso cada conexão precisa (1) vir de uma
/// origem confiável do app (cabeçalho `Origin`, que páginas não conseguem
/// forjar) e (2) apresentar o segredo aleatório desta execução (`?token=`),
/// que só é entregue às páginas confiáveis.
pub fn start_capture_bridge(token: String, trusted: crate::TrustedOrigins) -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("Falha ao abrir bridge local");
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).ok();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Falha ao criar runtime tokio para capture_bridge");

        rt.block_on(async move {
            let tokio_listener = TcpListener::from_std(listener).unwrap();
            let token = Arc::new(token);
            while let Ok((stream, _)) = tokio_listener.accept().await {
                tokio::spawn(handle_bridge_ws(stream, token.clone(), trusted.clone()));
            }
        });
    });

    port
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn handle_bridge_ws(
    stream: tokio::net::TcpStream,
    token: Arc<String>,
    trusted: crate::TrustedOrigins,
) {
    use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
    let check = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let origin_ok = req
            .headers()
            .get("origin")
            .and_then(|o| o.to_str().ok())
            .map(|o| {
                let o = o.to_ascii_lowercase();
                trusted.lock().map(|t| t.contains(&o)).unwrap_or(false)
            })
            .unwrap_or(false);
        let token_ok = req
            .uri()
            .query()
            .unwrap_or("")
            .split('&')
            .filter_map(|kv| kv.strip_prefix("token="))
            .any(|t| constant_time_eq(t.as_bytes(), token.as_bytes()));
        if origin_ok && token_ok {
            Ok(resp)
        } else {
            let mut deny = ErrorResponse::new(Some("forbidden".into()));
            *deny.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN;
            Err(deny)
        }
    };
    let Ok(ws_stream) = tokio_tungstenite::accept_hdr_async(stream, check).await else {
        return;
    };

    let (mut ws_tx, mut ws_rx) = ws_stream.split();
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(4);

    let send_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut stop_flag: Option<Arc<AtomicBool>> = None;

    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(text) = msg {
            if let Ok(cmd) = serde_json::from_str::<BridgeCommand>(&text) {
                match cmd {
                    BridgeCommand::ListSources => {
                        let sources = tokio::task::spawn_blocking(enumerate_capture_sources)
                            .await
                            .unwrap_or_default();
                        let resp = SourcesResponse {
                            msg_type: "sources",
                            sources,
                        };
                        if let Ok(json) = serde_json::to_string(&resp) {
                            let _ = out_tx.send(Message::Text(json)).await;
                        }
                    }
                    BridgeCommand::StartCapture {
                        id,
                        kind,
                        max_width,
                        max_height,
                        fps,
                        capture_audio,
                    } => {
                        if let Some(prev) = stop_flag.take() {
                            prev.store(true, Ordering::Relaxed);
                        }
                        let flag = Arc::new(AtomicBool::new(false));
                        stop_flag = Some(flag.clone());

                        let v_tx = out_tx.clone();
                        let v_flag = flag.clone();
                        std::thread::spawn(move || {
                            video_capture_loop(&id, &kind, max_width, max_height, fps, v_flag, v_tx);
                        });

                        if capture_audio {
                            let a_tx = out_tx.clone();
                            let a_flag = flag.clone();
                            std::thread::spawn(move || {
                                audio_capture_loop(a_flag, a_tx);
                            });
                        }
                    }
                    BridgeCommand::StopCapture => {
                        if let Some(prev) = stop_flag.take() {
                            prev.store(true, Ordering::Relaxed);
                        }
                    }
                }
            }
        }
    }

    if let Some(prev) = stop_flag.take() {
        prev.store(true, Ordering::Relaxed);
    }
    send_task.abort();
}

// ============================================================================
// Enumeração de Monitores e Janelas com Miniaturas BMP
// ============================================================================

#[derive(Clone)]
struct MonitorRect {
    index: usize,
    name: String,
    rect: RECT,
}

unsafe extern "system" fn enum_monitors_proc(
    hmonitor: HMONITOR,
    _hdc: HDC,
    _lprect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let list = &mut *(lparam.0 as *mut Vec<MonitorRect>);
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(hmonitor, &mut info.monitorInfo as *mut _).as_bool() {
        let idx = list.len() + 1;
        let rect = info.monitorInfo.rcMonitor;
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        list.push(MonitorRect {
            index: idx,
            name: format!("Tela {} ({}×{})", idx, w, h),
            rect,
        });
    }
    BOOL(1)
}

#[derive(Clone)]
struct WindowEntry {
    hwnd_val: isize,
    title: String,
    rect: RECT,
    minimized: bool,
}

/// Janelas "ocultas" pelo DWM: apps UWP suspensos (ex.: Configurações), a Experiência de
/// Entrada do Windows e janelas de outras áreas de trabalho virtuais. Não aparecem na tela.
unsafe fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut u32 as *mut _,
        std::mem::size_of::<u32>() as u32,
    )
    .is_ok()
        && cloaked != 0
}

/// Mesma regra do Alt+Tab: janela de topo visível, sem dono (ou marcada como janela de app),
/// que não seja ferramenta, nem oculta pelo DWM, nem do próprio Sancord.
unsafe fn is_shareable_app_window(hwnd: HWND) -> bool {
    if !IsWindowVisible(hwnd).as_bool() || is_cloaked(hwnd) {
        return false;
    }
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if (ex_style & WS_EX_TOOLWINDOW.0) != 0 {
        return false;
    }
    let owned = GetWindow(hwnd, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false);
    if owned && (ex_style & WS_EX_APPWINDOW.0) == 0 {
        return false;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    pid != GetCurrentProcessId()
}

unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if !is_shareable_app_window(hwnd) {
        return BOOL(1);
    }
    let minimized = IsIconic(hwnd).as_bool();

    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return BOOL(1);
    }

    let mut buf = vec![0u16; (len + 1) as usize];
    let copied = GetWindowTextW(hwnd, &mut buf);
    let title = String::from_utf16_lossy(&buf[..copied as usize]);
    let trimmed = title.trim();
    if trimmed.is_empty()
        || trimmed == "Program Manager"
        || trimmed == "Windows Input Experience"
        || trimmed == "Sancord"
    {
        return BOOL(1);
    }

    // Minimizada: o retângulo atual é o do ícone; usa o tamanho que ela terá ao ser restaurada.
    let rect = if minimized {
        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        if GetWindowPlacement(hwnd, &mut placement).is_err() {
            return BOOL(1);
        }
        placement.rcNormalPosition
    } else {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return BOOL(1);
        }
        rect
    };
    let w = rect.right - rect.left;
    let h = rect.bottom - rect.top;
    if w >= 120 && h >= 80 {
        let list = &mut *(lparam.0 as *mut Vec<WindowEntry>);
        list.push(WindowEntry {
            hwnd_val: hwnd.0 as isize,
            title: trimmed.to_string(),
            rect,
            minimized,
        });
    }
    BOOL(1)
}

/// Ícone do app da janela (grande, se houver), sem travar em janelas que não respondem.
unsafe fn window_icon(hwnd: HWND) -> Option<HICON> {
    for kind in [ICON_BIG, ICON_SMALL2] {
        let mut result = 0usize;
        let ok = SendMessageTimeoutW(
            hwnd,
            WM_GETICON,
            WPARAM(kind as usize),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            60,
            Some(&mut result as *mut usize),
        );
        if ok.0 != 0 && result != 0 {
            return Some(HICON(result as *mut _));
        }
    }
    for index in [GCLP_HICON, GCLP_HICONSM] {
        let icon = GetClassLongPtrW(hwnd, index);
        if icon != 0 {
            return Some(HICON(icon as *mut _));
        }
    }
    None
}

/// Miniatura de janela minimizada: fundo escuro com o ícone do app no centro.
unsafe fn minimized_thumbnail_bgra(hwnd: HWND, out_w: i32, out_h: i32) -> Option<Vec<u8>> {
    let screen_dc = GetDC(HWND::default());
    if screen_dc.is_invalid() {
        return None;
    }
    let dc = CreateCompatibleDC(screen_dc);
    let bmp = CreateCompatibleBitmap(screen_dc, out_w, out_h);
    let old = SelectObject(dc, bmp);
    // COLORREF é 0x00BBGGRR: fundo #1A1C24.
    let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x0024_1C1A));
    FillRect(dc, &RECT { left: 0, top: 0, right: out_w, bottom: out_h }, brush);
    let _ = DeleteObject(brush);
    if let Some(icon) = window_icon(hwnd) {
        let size = (out_h / 3).clamp(24, 64);
        let _ = DrawIconEx(dc, (out_w - size) / 2, (out_h - size) / 2, icon, size, size, 0, None, DI_NORMAL);
    }
    let mut pixels = vec![0u8; (out_w * out_h * 4) as usize];
    extract_dib_bgra(dc, bmp, out_w, out_h, &mut pixels);
    SelectObject(dc, old);
    let _ = DeleteObject(bmp);
    let _ = DeleteDC(dc);
    ReleaseDC(HWND::default(), screen_dc);
    Some(pixels)
}

fn encode_bgra_to_bmp_data_url(bgra: &[u8], w: i32, h: i32) -> String {
    let pixel_bytes = (w * h * 4) as u32;
    let file_size = 54 + pixel_bytes;
    let mut bmp = Vec::with_capacity(file_size as usize);

    // BITMAPFILEHEADER (14 bytes)
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&file_size.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&54u32.to_le_bytes());

    // BITMAPINFOHEADER (40 bytes) — altura negativa = top-down!
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&w.to_le_bytes());
    bmp.extend_from_slice(&(-h).to_le_bytes());
    bmp.extend_from_slice(&1u16.to_le_bytes());
    bmp.extend_from_slice(&32u16.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&pixel_bytes.to_le_bytes());
    bmp.extend_from_slice(&0i32.to_le_bytes());
    bmp.extend_from_slice(&0i32.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());

    bmp.extend_from_slice(bgra);
    format!("data:image/bmp;base64,{}", to_base64(&bmp))
}

fn enumerate_capture_sources() -> Vec<CaptureSourceInfo> {
    let mut results = Vec::new();

    unsafe {
        // 1. Monitores
        let mut monitors: Vec<MonitorRect> = Vec::new();
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_monitors_proc),
            LPARAM(&mut monitors as *mut _ as isize),
        );

        for m in monitors {
            let src_w = (m.rect.right - m.rect.left).max(1);
            let src_h = (m.rect.bottom - m.rect.top).max(1);
            let (tw, th) = fit_dimensions(src_w, src_h, 320, 180);
            if let Some(bgra) = capture_monitor_bgra(m.rect, tw, th, false) {
                results.push(CaptureSourceInfo {
                    id: format!("mon:{}", m.index - 1),
                    kind: "monitor".to_string(),
                    title: m.name,
                    width: src_w,
                    height: src_h,
                    thumbnail: encode_bgra_to_bmp_data_url(&bgra, tw, th),
                    minimized: false,
                });
            }
        }

        // 2. Janelas Abertas
        let mut windows_list: Vec<WindowEntry> = Vec::new();
        let _ = EnumWindows(
            Some(enum_windows_proc),
            LPARAM(&mut windows_list as *mut _ as isize),
        );

        // Janelas abertas primeiro (na ordem em que estão na tela), depois as minimizadas.
        windows_list.sort_by_key(|w| w.minimized);
        for win in windows_list.into_iter().take(24) {
            let src_w = (win.rect.right - win.rect.left).max(1);
            let src_h = (win.rect.bottom - win.rect.top).max(1);
            let (tw, th) = fit_dimensions(src_w, src_h, 320, 180);
            let hwnd = HWND(win.hwnd_val as *mut _);
            let thumb = if win.minimized {
                minimized_thumbnail_bgra(hwnd, tw, th)
            } else {
                capture_window_bgra(hwnd, win.rect, tw, th)
            };
            if let Some(bgra) = thumb {
                results.push(CaptureSourceInfo {
                    id: format!("win:{}", win.hwnd_val),
                    kind: "window".to_string(),
                    title: win.title,
                    width: src_w,
                    height: src_h,
                    thumbnail: encode_bgra_to_bmp_data_url(&bgra, tw, th),
                    minimized: win.minimized,
                });
            }
        }
    }

    results
}

fn fit_dimensions(src_w: i32, src_h: i32, max_w: i32, max_h: i32) -> (i32, i32) {
    let mut w = src_w.max(2);
    let mut h = src_h.max(2);

    if w > max_w || h > max_h {
        let ratio_w = max_w as f64 / w as f64;
        let ratio_h = max_h as f64 / h as f64;
        let scale = ratio_w.min(ratio_h);
        w = ((w as f64 * scale).round() as i32).max(2);
        h = ((h as f64 * scale).round() as i32).max(2);
    }

    // I420 exige largura e altura pares
    w = (w & !1).max(2);
    h = (h & !1).max(2);
    (w, h)
}

unsafe fn draw_cursor_on_dc(mem_dc: HDC, origin_x: i32, origin_y: i32) {
    let mut ci = CURSORINFO::default();
    ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
    if GetCursorInfo(&mut ci).is_ok() && (ci.flags.0 & CURSOR_SHOWING.0) != 0 && !ci.hCursor.is_invalid() {
        let mut ii = ICONINFO::default();
        if GetIconInfo(ci.hCursor, &mut ii).is_ok() {
            let draw_x = ci.ptScreenPos.x - origin_x - ii.xHotspot as i32;
            let draw_y = ci.ptScreenPos.y - origin_y - ii.yHotspot as i32;
            let _ = DrawIconEx(
                mem_dc,
                draw_x,
                draw_y,
                ci.hCursor,
                0,
                0,
                0,
                None,
                DI_NORMAL,
            );
            if !ii.hbmMask.is_invalid() {
                let _ = DeleteObject(ii.hbmMask);
            }
            if !ii.hbmColor.is_invalid() {
                let _ = DeleteObject(ii.hbmColor);
            }
        }
    }
}

unsafe fn capture_monitor_bgra(
    rect: RECT,
    out_w: i32,
    out_h: i32,
    include_cursor: bool,
) -> Option<Vec<u8>> {
    let src_w = rect.right - rect.left;
    let src_h = rect.bottom - rect.top;
    if src_w <= 0 || src_h <= 0 {
        return None;
    }

    let screen_dc = GetDC(HWND::default());
    if screen_dc.is_invalid() {
        return None;
    }

    let full_dc = CreateCompatibleDC(screen_dc);
    let full_bmp = CreateCompatibleBitmap(screen_dc, src_w, src_h);
    let old_full = SelectObject(full_dc, full_bmp);

    let blt_ok = BitBlt(
        full_dc,
        0,
        0,
        src_w,
        src_h,
        screen_dc,
        rect.left,
        rect.top,
        windows::Win32::Graphics::Gdi::ROP_CODE(SRCCOPY.0 | CAPTUREBLT_FLAG),
    )
    .is_ok();

    if blt_ok && include_cursor {
        draw_cursor_on_dc(full_dc, rect.left, rect.top);
    }

    let mut pixels = vec![0u8; (out_w * out_h * 4) as usize];
    if blt_ok {
        if out_w == src_w && out_h == src_h {
            extract_dib_bgra(full_dc, full_bmp, out_w, out_h, &mut pixels);
        } else {
            let scaled_dc = CreateCompatibleDC(screen_dc);
            let scaled_bmp = CreateCompatibleBitmap(screen_dc, out_w, out_h);
            let old_scaled = SelectObject(scaled_dc, scaled_bmp);
            SetStretchBltMode(scaled_dc, HALFTONE);
            let _ = StretchBlt(
                scaled_dc,
                0,
                0,
                out_w,
                out_h,
                full_dc,
                0,
                0,
                src_w,
                src_h,
                SRCCOPY,
            );
            extract_dib_bgra(scaled_dc, scaled_bmp, out_w, out_h, &mut pixels);
            SelectObject(scaled_dc, old_scaled);
            let _ = DeleteObject(scaled_bmp);
            let _ = DeleteDC(scaled_dc);
        }
    }

    SelectObject(full_dc, old_full);
    let _ = DeleteObject(full_bmp);
    let _ = DeleteDC(full_dc);
    ReleaseDC(HWND::default(), screen_dc);

    if blt_ok {
        Some(pixels)
    } else {
        None
    }
}

unsafe fn capture_window_bgra(hwnd: HWND, rect: RECT, out_w: i32, out_h: i32) -> Option<Vec<u8>> {
    let src_w = rect.right - rect.left;
    let src_h = rect.bottom - rect.top;
    if src_w <= 0 || src_h <= 0 {
        return None;
    }

    let screen_dc = GetDC(HWND::default());
    if screen_dc.is_invalid() {
        return None;
    }

    let full_dc = CreateCompatibleDC(screen_dc);
    let full_bmp = CreateCompatibleBitmap(screen_dc, src_w, src_h);
    let old_full = SelectObject(full_dc, full_bmp);

    let printed = PrintWindow(hwnd, full_dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
    if !printed {
        let _ = BitBlt(
            full_dc,
            0,
            0,
            src_w,
            src_h,
            screen_dc,
            rect.left,
            rect.top,
            windows::Win32::Graphics::Gdi::ROP_CODE(SRCCOPY.0 | CAPTUREBLT_FLAG),
        );
    }

    let mut pixels = vec![0u8; (out_w * out_h * 4) as usize];
    if out_w == src_w && out_h == src_h {
        extract_dib_bgra(full_dc, full_bmp, out_w, out_h, &mut pixels);
    } else {
        let scaled_dc = CreateCompatibleDC(screen_dc);
        let scaled_bmp = CreateCompatibleBitmap(screen_dc, out_w, out_h);
        let old_scaled = SelectObject(scaled_dc, scaled_bmp);
        SetStretchBltMode(scaled_dc, HALFTONE);
        let _ = StretchBlt(
            scaled_dc,
            0,
            0,
            out_w,
            out_h,
            full_dc,
            0,
            0,
            src_w,
            src_h,
            SRCCOPY,
        );
        extract_dib_bgra(scaled_dc, scaled_bmp, out_w, out_h, &mut pixels);
        SelectObject(scaled_dc, old_scaled);
        let _ = DeleteObject(scaled_bmp);
        let _ = DeleteDC(scaled_dc);
    }

    SelectObject(full_dc, old_full);
    let _ = DeleteObject(full_bmp);
    let _ = DeleteDC(full_dc);
    ReleaseDC(HWND::default(), screen_dc);

    Some(pixels)
}

unsafe fn extract_dib_bgra(
    hdc: HDC,
    hbmp: windows::Win32::Graphics::Gdi::HBITMAP,
    w: i32,
    h: i32,
    out: &mut [u8],
) {
    let mut bi = BITMAPINFO::default();
    bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bi.bmiHeader.biWidth = w;
    bi.bmiHeader.biHeight = -h; // top-down
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = BI_RGB.0;

    let _ = GetDIBits(
        hdc,
        hbmp,
        0,
        h as u32,
        Some(out.as_mut_ptr() as *mut _),
        &mut bi,
        DIB_RGB_COLORS,
    );
}

// Conversão rápida BGRA -> I420 (YUV420p) para streaming com baixo consumo de banda local
fn bgra_to_i420(bgra: &[u8], w: usize, h: usize, out: &mut Vec<u8>) {
    let y_size = w * h;
    let uv_w = w / 2;
    let uv_h = h / 2;
    let uv_size = uv_w * uv_h;
    out.resize(y_size + uv_size * 2, 0);

    let (y_plane, uv_planes) = out.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_size);

    for row in 0..h {
        let row_offset = row * w * 4;
        let y_row = row * w;
        for col in 0..w {
            let idx = row_offset + col * 4;
            let b = bgra[idx] as i32;
            let g = bgra[idx + 1] as i32;
            let r = bgra[idx + 2] as i32;
            let y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            y_plane[y_row + col] = y.clamp(0, 255) as u8;
        }
    }

    for row_pair in 0..uv_h {
        let row0 = (row_pair * 2) * w * 4;
        let row1 = (row_pair * 2 + 1) * w * 4;
        let uv_row = row_pair * uv_w;
        for col_pair in 0..uv_w {
            let c0 = col_pair * 2 * 4;
            let c1 = c0 + 4;

            let b = (bgra[row0 + c0] as i32
                + bgra[row0 + c1] as i32
                + bgra[row1 + c0] as i32
                + bgra[row1 + c1] as i32)
                >> 2;
            let g = (bgra[row0 + c0 + 1] as i32
                + bgra[row0 + c1 + 1] as i32
                + bgra[row1 + c0 + 1] as i32
                + bgra[row1 + c1 + 1] as i32)
                >> 2;
            let r = (bgra[row0 + c0 + 2] as i32
                + bgra[row0 + c1 + 2] as i32
                + bgra[row1 + c0 + 2] as i32
                + bgra[row1 + c1 + 2] as i32)
                >> 2;

            let u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
            let v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
            u_plane[uv_row + col_pair] = u.clamp(0, 255) as u8;
            v_plane[uv_row + col_pair] = v.clamp(0, 255) as u8;
        }
    }
}

fn video_capture_loop(
    id: &str,
    kind: &str,
    max_width: i32,
    max_height: i32,
    fps: u32,
    stop: Arc<AtomicBool>,
    tx: mpsc::Sender<Message>,
) {
    let target_fps = fps.clamp(15, 60);
    let frame_interval = Duration::from_secs_f64(1.0 / target_fps as f64);
    let mut i420_buf: Vec<u8> = Vec::new();

    unsafe {
        let mut monitors: Vec<MonitorRect> = Vec::new();
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_monitors_proc),
            LPARAM(&mut monitors as *mut _ as isize),
        );

        let monitor_idx: usize = id
            .strip_prefix("mon:")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let hwnd_val: isize = id
            .strip_prefix("win:")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        // Janela minimizada não tem imagem: restaura sem roubar o foco antes de transmitir.
        if kind == "window" && hwnd_val != 0 {
            let hwnd = HWND(hwnd_val as *mut _);
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }

        while !stop.load(Ordering::Relaxed) {
            let tick = Instant::now();

            let captured = if kind == "window" && hwnd_val != 0 {
                let hwnd = HWND(hwnd_val as *mut _);
                let mut rect = RECT::default();
                if IsIconic(hwnd).as_bool() {
                    // Minimizada durante a transmissão: segura o último quadro até voltar.
                    None
                } else
                if GetWindowRect(hwnd, &mut rect).is_ok() {
                    let src_w = (rect.right - rect.left).max(2);
                    let src_h = (rect.bottom - rect.top).max(2);
                    let (ow, oh) = fit_dimensions(src_w, src_h, max_width, max_height);
                    capture_window_bgra(hwnd, rect, ow, oh).map(|bgra| (bgra, ow, oh))
                } else {
                    None
                }
            } else if let Some(mon) = monitors.get(monitor_idx).or_else(|| monitors.first()) {
                let src_w = (mon.rect.right - mon.rect.left).max(2);
                let src_h = (mon.rect.bottom - mon.rect.top).max(2);
                let (ow, oh) = fit_dimensions(src_w, src_h, max_width, max_height);
                capture_monitor_bgra(mon.rect, ow, oh, true).map(|bgra| (bgra, ow, oh))
            } else {
                None
            };

            if let Some((bgra, ow, oh)) = captured {
                bgra_to_i420(&bgra, ow as usize, oh as usize, &mut i420_buf);
                let mut packet = Vec::with_capacity(9 + i420_buf.len());
                packet.push(0x01); // Video I420 frame
                packet.extend_from_slice(&(ow as u32).to_le_bytes());
                packet.extend_from_slice(&(oh as u32).to_le_bytes());
                packet.extend_from_slice(&i420_buf);

                let _ = tx.try_send(Message::Binary(packet));
            }

            let elapsed = tick.elapsed();
            if elapsed < frame_interval {
                std::thread::sleep(frame_interval - elapsed);
            }
        }
    }
}

// ============================================================================
// Captura de Áudio do Sistema via WASAPI (Process Loopback s/ Eco ou Device Loopback)
// ============================================================================

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct AudioActivationHandler {
    event: windows::Win32::Foundation::HANDLE,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for AudioActivationHandler_Impl {
    fn ActivateCompleted(
        &self,
        _activateoperation: Option<&IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        unsafe {
            let _ = SetEvent(self.event);
        }
        Ok(())
    }
}

unsafe fn try_create_process_loopback_client() -> Option<(IAudioClient, u32, u16)> {
    let pid = GetCurrentProcessId();
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };

    #[repr(C)]
    struct RawBlobPropVariant {
        vt: u16,
        w1: u16,
        w2: u16,
        w3: u16,
        cb_size: u32,
        _pad: u32,
        p_blob_data: *const u8,
    }

    let raw_prop = RawBlobPropVariant {
        vt: VT_BLOB.0,
        w1: 0,
        w2: 0,
        w3: 0,
        cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        _pad: 0,
        p_blob_data: &mut params as *mut _ as *const u8,
    };
    let prop_ptr: *const PROPVARIANT = &raw_prop as *const RawBlobPropVariant as *const PROPVARIANT;

    let event = CreateEventW(None, false, false, None).ok()?;
    let handler: IActivateAudioInterfaceCompletionHandler =
        AudioActivationHandler { event }.into();

    let op = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(prop_ptr),
        &handler,
    )
    .ok()?;

    WaitForSingleObject(event, 3000);
    let _ = windows::Win32::Foundation::CloseHandle(event);

    let mut hr = windows::core::HRESULT(0);
    let mut unknown = None;
    op.GetActivateResult(&mut hr, &mut unknown).ok()?;
    hr.ok().ok()?;
    let audio_client: IAudioClient = unknown?.cast().ok()?;

    // Process loopback exige que o caller informe o formato desejado (48kHz, stereo, f32)
    let sample_rate = 48_000u32;
    let channels = 2u16;
    let wfx = WAVEFORMATEX {
        wFormatTag: 3, // WAVE_FORMAT_IEEE_FLOAT
        nChannels: channels,
        nSamplesPerSec: sample_rate,
        nAvgBytesPerSec: sample_rate * (channels as u32) * 4,
        nBlockAlign: channels * 4,
        wBitsPerSample: 32,
        cbSize: 0,
    };

    audio_client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            200_000,
            0,
            &wfx,
            None,
        )
        .ok()?;

    Some((audio_client, sample_rate, channels))
}

unsafe fn create_default_loopback_client() -> Option<(IAudioClient, u32, u16, bool)> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .ok()?;
    let audio_client: IAudioClient = device.Activate(CLSCTX_ALL, None).ok()?;
    let mix_fmt_ptr = audio_client.GetMixFormat().ok()?;
    let mix_fmt = &*mix_fmt_ptr;
    let sample_rate = mix_fmt.nSamplesPerSec;
    let channels = mix_fmt.nChannels;
    let is_float = mix_fmt.wBitsPerSample == 32;

    let init_res = audio_client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        200_000,
        0,
        mix_fmt_ptr,
        None,
    );
    CoTaskMemFree(Some(mix_fmt_ptr as *const _));
    init_res.ok()?;

    Some((audio_client, sample_rate, channels, is_float))
}

fn audio_capture_loop(stop: Arc<AtomicBool>, tx: mpsc::Sender<Message>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let (audio_client, sample_rate, src_channels, is_float) =
            if let Some((client, sr, ch)) = try_create_process_loopback_client() {
                (client, sr, ch, true)
            } else if let Some(res) = create_default_loopback_client() {
                res
            } else {
                CoUninitialize();
                return;
            };

        let Ok(capture_client) = audio_client.GetService::<IAudioCaptureClient>() else {
            CoUninitialize();
            return;
        };

        if audio_client.Start().is_err() {
            CoUninitialize();
            return;
        }

        let mut stereo_f32: Vec<f32> = Vec::new();

        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(10));

            while let Ok(packet_len) = capture_client.GetNextPacketSize() {
                if packet_len == 0 {
                    break;
                }

                let mut data_ptr: *mut u8 = std::ptr::null_mut();
                let mut num_frames: u32 = 0;
                let mut flags: u32 = 0;

                if capture_client
                    .GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
                    .is_err()
                {
                    break;
                }

                if num_frames > 0 {
                    stereo_f32.clear();
                    stereo_f32.reserve(num_frames as usize * 2);

                    if (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0 || data_ptr.is_null() {
                        stereo_f32.resize(num_frames as usize * 2, 0.0);
                    } else if is_float {
                        let ch = src_channels as usize;
                        let slice = std::slice::from_raw_parts(
                            data_ptr as *const f32,
                            num_frames as usize * ch,
                        );
                        for frame in slice.chunks_exact(ch) {
                            let left = frame[0];
                            let right = if ch > 1 { frame[1] } else { left };
                            stereo_f32.push(left);
                            stereo_f32.push(right);
                        }
                    } else {
                        let ch = src_channels as usize;
                        let slice = std::slice::from_raw_parts(
                            data_ptr as *const i16,
                            num_frames as usize * ch,
                        );
                        for frame in slice.chunks_exact(ch) {
                            let left = frame[0] as f32 / 32768.0;
                            let right = if ch > 1 { frame[1] as f32 / 32768.0 } else { left };
                            stereo_f32.push(left);
                            stereo_f32.push(right);
                        }
                    }

                    let mut packet = Vec::with_capacity(13 + stereo_f32.len() * 4);
                    packet.push(0x02); // Audio f32 stereo interleaved
                    packet.extend_from_slice(&sample_rate.to_le_bytes());
                    packet.extend_from_slice(&2u32.to_le_bytes());
                    packet.extend_from_slice(&num_frames.to_le_bytes());
                    for sample in &stereo_f32 {
                        packet.extend_from_slice(&sample.to_le_bytes());
                    }
                    let _ = tx.try_send(Message::Binary(packet));
                }

                let _ = capture_client.ReleaseBuffer(num_frames);
            }
        }

        let _ = audio_client.Stop();
        CoUninitialize();
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    async fn try_connect(port: u16, origin: Option<&str>, token: &str) -> bool {
        let mut req = format!("ws://127.0.0.1:{port}/?token={token}")
            .into_client_request()
            .unwrap();
        if let Some(o) = origin {
            req.headers_mut().insert("origin", o.parse().unwrap());
        }
        tokio_tungstenite::connect_async(req).await.is_ok()
    }

    #[tokio::test]
    async fn bridge_requires_trusted_origin_and_token() {
        let trusted: crate::TrustedOrigins =
            Arc::new(std::sync::Mutex::new(vec!["http://localhost:3000".to_string()]));
        let port = start_capture_bridge("segredo-certo".into(), trusted.clone());

        // Sem origem (ex.: programa qualquer) e sem segredo.
        assert!(!try_connect(port, None, "").await);
        // Site malicioso aberto em outro navegador, mesmo que adivinhasse o segredo.
        assert!(!try_connect(port, Some("https://site-malicioso.com"), "segredo-certo").await);
        // Origem confiável, segredo errado ou ausente.
        assert!(!try_connect(port, Some("http://localhost:3000"), "errado").await);
        assert!(!try_connect(port, Some("http://localhost:3000"), "").await);
        // Página confiável do app com o segredo correto.
        assert!(try_connect(port, Some("http://localhost:3000"), "segredo-certo").await);

        // Origem remota só passa depois de ser marcada como confiável.
        let remote = "https://abc.trycloudflare.com";
        assert!(!try_connect(port, Some(remote), "segredo-certo").await);
        trusted.lock().unwrap().push(remote.to_string());
        assert!(try_connect(port, Some(remote), "segredo-certo").await);
    }

    /// Conferência manual na máquina real (depende das janelas abertas):
    /// `cargo test --bin SancordApp lista_janelas_reais -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn lista_janelas_reais() {
        let sources = enumerate_capture_sources();
        for s in sources.iter().filter(|s| s.kind == "window") {
            println!("{} {}x{} minimizada={} | {}", s.id, s.width, s.height, s.minimized, s.title);
            assert!(s.thumbnail.starts_with("data:image/bmp;base64,"));
            if let Ok(dir) = std::env::var("SANCORD_THUMBS_DIR") {
                let b64 = s.thumbnail.trim_start_matches("data:image/bmp;base64,");
                let _ = std::fs::write(format!("{dir}/{}.b64", s.id.replace(':', "_")), b64);
            }
        }
        assert!(sources.iter().any(|s| s.kind == "monitor"));
    }
}
