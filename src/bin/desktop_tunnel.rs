//! Túnel público (cloudflared) do anfitrião local.
//!
//! O app liga o servidor e o túnel quando encontra o servidor desligado. Antes, criava
//! um túnel novo a cada abertura, mesmo com outro já rodando; reiniciar o servidor
//! várias vezes deixava vários túneis abertos, cada um com um endereço público.
//! Agora só cria se não houver um `cloudflared.exe` desta mesma pasta em execução.

use std::path::Path;

/// Mesmo executável, sem diferenciar maiúsculas (caminhos do Windows) nem barras.
pub fn same_executable(a: &str, b: &Path) -> bool {
    let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    norm(a) == norm(&b.to_string_lossy())
}

/// Há um `cloudflared.exe` deste caminho rodando?
pub fn tunnel_running(cloudflared_exe: &Path) -> bool {
    process_paths("cloudflared.exe").iter().any(|path| same_executable(path, cloudflared_exe))
}

/// Caminhos completos dos processos com este nome de arquivo.
fn process_paths(image_name: &str) -> Vec<String> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut out = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snapshot, &mut entry).is_ok();
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if name.eq_ignore_ascii_case(image_name) {
                if let Some(path) = crate::desktop_activity::query_process_image_path(entry.th32ProcessID) {
                    out.push(path);
                }
            }
            ok = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compara_caminhos_do_windows_sem_diferenciar_maiusculas() {
        let exe = Path::new(r"D:\Sancord\cloudflared.exe");
        assert!(same_executable(r"d:\sancord\CLOUDFLARED.EXE", exe));
        assert!(same_executable("D:/Sancord/cloudflared.exe", exe));
        assert!(!same_executable(r"D:\Outro\cloudflared.exe", exe));
    }

    /// Conferência manual na máquina do anfitrião, com o túnel ligado:
    /// `SANVO_QA_CLOUDFLARED=D:\Sancord\cloudflared.exe cargo test --bin SancordApp tunel_real -- --ignored`
    #[test]
    #[ignore]
    fn tunel_real_em_execucao_e_detectado() {
        let exe = std::env::var("SANVO_QA_CLOUDFLARED").expect("defina SANVO_QA_CLOUDFLARED");
        assert!(tunnel_running(Path::new(&exe)));
    }

    #[test]
    fn processo_inexistente_nao_conta_como_tunel() {
        assert!(!tunnel_running(Path::new(r"Z:\nao-existe\cloudflared.exe")));
    }
}
