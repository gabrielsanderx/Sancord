#![windows_subsystem = "windows"]

use std::{env, fs, io, path::PathBuf, process::Command};
use sha2::{Digest, Sha256};

const CORE_EXE: &[u8] = include_bytes!(env!("SANCORD_BUNDLE_APP"));
const WEBVIEW_DLL: &[u8] = include_bytes!("../../WebView2Loader.dll");

fn launch() -> io::Result<()> {
    let launcher = env::current_exe()?;
    let parent = launcher.parent().ok_or_else(|| io::Error::other("Pasta do Sancord não encontrada"))?;
    let local = env::var_os("LOCALAPPDATA").ok_or_else(|| io::Error::other("LOCALAPPDATA não disponível"))?;
    let version = hex::encode(Sha256::digest(CORE_EXE));
    // Não sobrescreve um executável em uso ao atualizar a versão.
    let bin_dir = PathBuf::from(local).join("SancordDesktopData").join("bin_v4").join(&version[..16]);
    fs::create_dir_all(&bin_dir)?;
    let exe_path = bin_dir.join("SancordDesktop.exe");
    let dll_path = bin_dir.join("WebView2Loader.dll");
    for (path, bytes) in [(&exe_path, CORE_EXE), (&dll_path, WEBVIEW_DLL)] {
        if fs::read(path).ok().as_deref() != Some(bytes) { fs::write(path, bytes)?; }
    }
    let mut child = Command::new(&exe_path);
    child.args(env::args_os().skip(1)).current_dir(&bin_dir)
        .env("SANCORD_LAUNCHER_EXE", &launcher);
    if parent.join("SancordServer.exe").is_file() {
        child.env("SANCORD_HOST_EXE", parent.join("SancordServer.exe"))
            .env("SANCORD_HOST_DIR", parent);
    }
    child.spawn()?;
    Ok(())
}

fn main() {
    if let Err(error) = launch() {
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let message: Vec<u16> = format!("Não foi possível iniciar o Sancord:\n{error}").encode_utf16().chain(Some(0)).collect();
        unsafe { MessageBoxW(None, windows_core::PCWSTR(message.as_ptr()), windows_core::w!("Sancord"), MB_OK | MB_ICONERROR); }
    }
}
