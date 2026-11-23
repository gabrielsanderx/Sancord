//! Badge numérica nativa no ícone do Sanvo na barra de tarefas do Windows (`ITaskbarList3::SetOverlayIcon`).
//!
//! - Renderiza um overlay `HICON` 32-bit ARGB em memória (sem modificar `icon.ico` no disco).
//! - Escala automaticamente para o DPI real da janela (100% = 16px, 125% = 20px, 150% = 24px, 200% = 32px).
//! - Possui anel externo escuro de contraste para legibilidade tanto na barra de tarefas clara quanto escura do Windows.
//! - Remove completamente o overlay (`HICON(null)`) quando o contador chega a `0`.

use std::ptr;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{ITaskbarList3, TaskbarList};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, DestroyIcon, FlashWindowEx, FLASHWINFO, FLASHW_STOP, FLASHW_TIMERNOFG,
    FLASHW_TRAY, HICON, ICONINFO, SM_CXSMICON,
};

/// Formata o texto exibido na badge da barra de tarefas:
/// - `0` -> `None` (remove o overlay)
/// - `1..=99` -> `Some("1".."99")`
/// - `100+` -> `Some("99+")`
pub fn format_badge_label(count: u32) -> Option<String> {
    match count {
        0 => None,
        1..=99 => Some(count.to_string()),
        _ => Some("99+".to_string()),
    }
}

/// Texto acessível do overlay na barra de tarefas do Windows.
pub fn format_badge_accessibility(count: u32) -> String {
    match count {
        0 => String::new(),
        1 => "1 notificação não lida".to_string(),
        2..=99 => format!("{count} notificações não lidas"),
        _ => "Mais de 99 notificações não lidas".to_string(),
    }
}

/// Dimensão em pixels do overlay icon para um dado DPI do Windows (96 = 100%, 120 = 125%, 144 = 150%, 192 = 200%).
pub fn overlay_size_for_dpi(dpi: u32) -> usize {
    let safe_dpi = if dpi == 0 { 96 } else { dpi };
    ((16 * safe_dpi + 48) / 96).clamp(16, 48) as usize
}

/// Glifos bitmap 5×7 nítidos para `'0'..='9'` e `'+'`.
fn glyph_5x7(ch: char) -> Option<[u8; 7]> {
    Some(match ch {
        '0' => [
            0b01110,
            0b10001,
            0b10001,
            0b10001,
            0b10001,
            0b10001,
            0b01110,
        ],
        '1' => [
            0b00100,
            0b01100,
            0b00100,
            0b00100,
            0b00100,
            0b00100,
            0b01110,
        ],
        '2' => [
            0b01110,
            0b10001,
            0b00001,
            0b00110,
            0b01000,
            0b10000,
            0b11111,
        ],
        '3' => [
            0b11110,
            0b00001,
            0b00001,
            0b01110,
            0b00001,
            0b00001,
            0b11110,
        ],
        '4' => [
            0b10010,
            0b10010,
            0b10010,
            0b11111,
            0b00010,
            0b00010,
            0b00010,
        ],
        '5' => [
            0b11111,
            0b10000,
            0b11110,
            0b00001,
            0b00001,
            0b10001,
            0b01110,
        ],
        '6' => [
            0b01110,
            0b10000,
            0b11110,
            0b10001,
            0b10001,
            0b10001,
            0b01110,
        ],
        '7' => [
            0b11111,
            0b00001,
            0b00010,
            0b00100,
            0b00100,
            0b00100,
            0b00100,
        ],
        '8' => [
            0b01110,
            0b10001,
            0b10001,
            0b01110,
            0b10001,
            0b10001,
            0b01110,
        ],
        '9' => [
            0b01110,
            0b10001,
            0b10001,
            0b01111,
            0b00001,
            0b00001,
            0b01110,
        ],
        '+' => [
            0b00000,
            0b00100,
            0b00100,
            0b11111,
            0b00100,
            0b00100,
            0b00000,
        ],
        _ => return None,
    })
}

/// Glifo compacto 3×5 para quando `"99+"` é renderizado em ícones pequenos (16×16).
fn glyph_3x5(ch: char) -> Option<[u8; 5]> {
    Some(match ch {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        _ => return None,
    })
}

fn sample_text_mask(label: &str, gx: f32, gy: f32, size: usize) -> bool {
    let chars: Vec<char> = label.chars().collect();
    if chars.is_empty() {
        return false;
    }
    let s = size as f32;
    let use_compact = (chars.len() >= 2 && size <= 16) || (chars.len() >= 3 && size <= 22);
    let (gw, gh, gap) = if use_compact {
        (3.0f32, 5.0f32, 1.0f32)
    } else {
        (5.0f32, 7.0f32, 1.0f32)
    };

    // Escala e origem alinhadas à grade inteira de pixels para nitidez máxima em qualquer DPI.
    let raw_total_w = (chars.len() as f32) * gw + ((chars.len() - 1) as f32) * gap;
    let max_usable_w = s * (if chars.len() == 1 { 0.55 } else { 0.76 });
    let max_usable_h = s * 0.58;
    let scale = (max_usable_w / raw_total_w)
        .min(max_usable_h / gh)
        .floor()
        .max(1.0);

    let total_w = raw_total_w * scale;
    let total_h = gh * scale;
    let start_x = ((s - total_w) * 0.5).floor();
    let start_y = ((s - total_h) * 0.5).floor();

    if gx < start_x || gx >= start_x + total_w || gy < start_y || gy >= start_y + total_h {
        return false;
    }

    let local_x = (gx - start_x) / scale;
    let local_y = (gy - start_y) / scale;
    let stride = gw + gap;
    let char_idx = (local_x / stride).floor() as usize;
    if char_idx >= chars.len() {
        return false;
    }
    let in_char_x = local_x - (char_idx as f32) * stride;
    if in_char_x >= gw {
        return false;
    }

    let ch = chars[char_idx];
    if use_compact {
        let Some(rows) = glyph_3x5(ch) else { return false };
        let col = (in_char_x.floor() as usize).min(2);
        let row = (local_y.floor() as usize).min(4);
        ((rows[row] >> (2 - col)) & 1) == 1
    } else {
        let Some(rows) = glyph_5x7(ch) else { return false };
        let col = (in_char_x.floor() as usize).min(4);
        let row = (local_y.floor() as usize).min(6);
        ((rows[row] >> (4 - col)) & 1) == 1
    }
}

/// Renderiza um buffer BGRA 32-bit pré-multiplicado (`size * size * 4` bytes) para a badge.
/// Retorna `None` quando `count == 0`.
pub fn render_badge_bgra(size: usize, count: u32) -> Option<Vec<u8>> {
    let label = format_badge_label(count)?;
    let size = size.clamp(16, 64);
    let s = size as f32;
    let cx = s * 0.5;
    let cy = s * 0.5;

    // Pílula levemente horizontal para 3 caracteres ("99+"), círculo perfeito para 1–2 dígitos.
    let half_extra_x = if label.len() >= 3 { s * 0.05 } else { 0.0 };
    let outer_r = (s * 0.47) - half_extra_x * 0.35;
    let border_w = (s * 0.075).max(1.15);
    let inner_r = (outer_r - border_w).max(2.0);

    let mut out = vec![0u8; size * size * 4];
    const SUB: usize = 4;
    let inv_sub2 = 1.0 / ((SUB * SUB) as f32);

    for py in 0..size {
        for px in 0..size {
            let mut acc_r = 0.0f32;
            let mut acc_g = 0.0f32;
            let mut acc_b = 0.0f32;
            let mut acc_a = 0.0f32;

            for sy in 0..SUB {
                let gy = (py as f32) + ((sy as f32) + 0.5) / (SUB as f32);
                for sx in 0..SUB {
                    let gx = (px as f32) + ((sx as f32) + 0.5) / (SUB as f32);

                    let dx = (gx - cx).abs() - half_extra_x;
                    let dx = dx.max(0.0);
                    let dy = gy - cy;
                    let dist = (dx * dx + dy * dy).sqrt();

                    if dist > outer_r {
                        continue;
                    }

                    let (r, g, b, a) = if sample_text_mask(&label, gx, gy, size) && dist <= inner_r {
                        // Texto branco puro de alto contraste
                        (255.0, 255.0, 255.0, 1.0)
                    } else if dist <= inner_r {
                        // Preenchimento vermelho/danger original do Sanvo com leve gradiente vertical
                        let t = (gy / s).clamp(0.0, 1.0);
                        let r = 244.0 * (1.0 - t) + 217.0 * t;
                        let g = 63.0 * (1.0 - t) + 40.0 * t;
                        let b = 67.0 * (1.0 - t) + 46.0 * t;
                        (r, g, b, 1.0)
                    } else {
                        // Anel escuro externo para contraste tanto em taskbar clara quanto escura
                        (17.0, 19.0, 26.0, 0.94)
                    };

                    acc_r += r * a;
                    acc_g += g * a;
                    acc_b += b * a;
                    acc_a += a;
                }
            }

            let idx = (py * size + px) * 4;
            out[idx] = (acc_b * inv_sub2).round().clamp(0.0, 255.0) as u8;
            out[idx + 1] = (acc_g * inv_sub2).round().clamp(0.0, 255.0) as u8;
            out[idx + 2] = (acc_r * inv_sub2).round().clamp(0.0, 255.0) as u8;
            out[idx + 3] = (acc_a * inv_sub2 * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }

    Some(out)
}

/// Cria um `HICON` nativo Win32 a partir de um buffer BGRA 32-bit pré-multiplicado.
pub fn create_badge_hicon(size: usize, bgra: &[u8]) -> Option<HICON> {
    if bgra.len() != size * size * 4 {
        return None;
    }
    unsafe {
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size as i32,
                biHeight: -(size as i32), // Top-down DIB
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = ptr::null_mut();
        let hbm_color = CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
        if hbm_color.is_invalid() || bits.is_null() {
            if !hbm_color.is_invalid() {
                let _ = DeleteObject(hbm_color);
            }
            return None;
        }
        ptr::copy_nonoverlapping(bgra.as_ptr(), bits.cast::<u8>(), bgra.len());

        let hbm_mask = CreateBitmap(size as i32, size as i32, 1, 1, None);
        if hbm_mask.is_invalid() {
            let _ = DeleteObject(hbm_color);
            return None;
        }

        let icon_info = ICONINFO {
            fIcon: BOOL(1),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: hbm_mask,
            hbmColor: hbm_color,
        };
        let hicon = CreateIconIndirect(&icon_info).ok();
        let _ = DeleteObject(hbm_color);
        let _ = DeleteObject(hbm_mask);
        hicon
    }
}

/// Aplica ou remove a badge numérica no ícone do aplicativo na barra de tarefas do Windows.
pub fn apply_taskbar_badge(hwnd_raw: isize, count: u32) {
    if hwnd_raw == 0 {
        return;
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let Ok(taskbar) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER) else {
            return;
        };
        if taskbar.HrInit().is_err() {
            return;
        }
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
        if count == 0 {
            let _ = taskbar.SetOverlayIcon(hwnd, HICON::default(), PCWSTR::null());
            return;
        }

        let dpi = GetDpiForWindow(hwnd);
        let metric_px = if dpi > 0 {
            GetSystemMetricsForDpi(SM_CXSMICON, dpi)
        } else {
            0
        };
        let size = if metric_px >= 16 {
            (metric_px as usize).clamp(16, 48)
        } else {
            overlay_size_for_dpi(dpi)
        };

        let Some(bgra) = render_badge_bgra(size, count) else {
            return;
        };
        let Some(hicon) = create_badge_hicon(size, &bgra) else {
            return;
        };
        let desc: Vec<u16> = format_badge_accessibility(count)
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let _ = taskbar.SetOverlayIcon(hwnd, hicon, PCWSTR(desc.as_ptr()));
        let _ = DestroyIcon(hicon);
    }
}

/// Chama atenção discretamente na barra de tarefas do Windows durante uma chamada recebida
/// (no máximo 3 piscadas suaves, sem flash infinito, parando ao focar a janela ou encerrar).
pub fn set_call_attention_flash(hwnd_raw: isize, active: bool) {
    if hwnd_raw == 0 {
        return;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
        let info = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd,
            dwFlags: if active {
                FLASHW_TRAY | FLASHW_TIMERNOFG
            } else {
                FLASHW_STOP
            },
            uCount: if active { 3 } else { 0 },
            dwTimeout: 0,
        };
        let _ = FlashWindowEx(&info);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_label_and_accessibility_rules() {
        assert_eq!(format_badge_label(0), None);
        assert_eq!(format_badge_label(1).as_deref(), Some("1"));
        assert_eq!(format_badge_label(9).as_deref(), Some("9"));
        assert_eq!(format_badge_label(42).as_deref(), Some("42"));
        assert_eq!(format_badge_label(99).as_deref(), Some("99"));
        assert_eq!(format_badge_label(100).as_deref(), Some("99+"));
        assert_eq!(format_badge_label(250).as_deref(), Some("99+"));

        assert_eq!(format_badge_accessibility(0), "");
        assert_eq!(format_badge_accessibility(1), "1 notificação não lida");
        assert_eq!(format_badge_accessibility(5), "5 notificações não lidas");
        assert_eq!(format_badge_accessibility(120), "Mais de 99 notificações não lidas");
    }

    #[test]
    fn dpi_scaling_covers_100_125_150_and_200_percent() {
        assert_eq!(overlay_size_for_dpi(96), 16);  // 100%
        assert_eq!(overlay_size_for_dpi(120), 20); // 125%
        assert_eq!(overlay_size_for_dpi(144), 24); // 150%
        assert_eq!(overlay_size_for_dpi(192), 32); // 200%
    }

    #[test]
    fn renders_crisp_red_badge_with_white_digits_and_creates_win32_hicon_at_all_dpis() {
        assert!(render_badge_bgra(16, 0).is_none());
        for size in [16usize, 20, 24, 32] {
            for count in [1u32, 2, 15, 99, 120] {
                let bgra = render_badge_bgra(size, count).expect("deve renderizar BGRA");
                assert_eq!(bgra.len(), size * size * 4);
                // Canto extremo (0,0) é totalmente transparente
                assert_eq!(bgra[3], 0, "canto superior esquerdo deve ser transparente");

                let mut has_red_body = false;
                let mut has_white_glyph = false;
                for px in bgra.chunks_exact(4) {
                    let (b, g, r, a) = (px[0], px[1], px[2], px[3]);
                    if a > 200 && r > 180 && g < 100 && b < 100 {
                        has_red_body = true;
                    }
                    if a > 220 && r > 230 && g > 230 && b > 230 {
                        has_white_glyph = true;
                    }
                }
                assert!(has_red_body, "círculo vermelho ausente em size={size} count={count}");
                assert!(has_white_glyph, "texto branco ausente em size={size} count={count}");

                let hicon = create_badge_hicon(size, &bgra).expect("HICON Win32 válido");
                assert!(!hicon.is_invalid());
                unsafe {
                    let _ = DestroyIcon(hicon);
                }
            }
        }
    }

    #[test]
    fn apply_taskbar_badge_runs_against_real_win32_hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW,
        };
        unsafe {
            let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let title: Vec<u16> = "SanvoTaskbarTest\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                PCWSTR(class_name.as_ptr()),
                PCWSTR(title.as_ptr()),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                200,
                200,
                None,
                None,
                None,
                None,
            );
            if let Ok(hwnd) = hwnd {
                let raw = hwnd.0 as isize;
                apply_taskbar_badge(raw, 1);
                apply_taskbar_badge(raw, 2);
                apply_taskbar_badge(raw, 120);
                apply_taskbar_badge(raw, 0);
                let _ = DestroyWindow(hwnd);
            }
        }
    }
}
