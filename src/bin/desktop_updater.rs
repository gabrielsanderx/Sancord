//! Controlador fora da thread da UI; helper é uma cópia do cliente instalado.
use std::{env, fs, path::{Path, PathBuf}, process::Command, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};
use std::os::windows::process::CommandExt;
use sancord::updates::{self, InstallJob, UpdateConfig, VerifiedRelease};
use serde_json::{json, Value};
use tao::event_loop::EventLoopProxy;
use super::UserEvent;

#[derive(Clone)]
struct Downloaded { release: VerifiedRelease, package: PathBuf }
pub struct Updater {
    data: PathBuf, busy: AtomicBool, started: AtomicBool,
    release: Mutex<Option<VerifiedRelease>>, downloaded: Mutex<Option<Downloaded>>,
    latest: Mutex<Value>, endpoint: Mutex<Option<String>>, proxy: EventLoopProxy<UserEvent>,
}
impl Updater {
    pub fn new(data: &Path, proxy: EventLoopProxy<UserEvent>) -> Arc<Self> {
        let result_path = data.join("updates/result.json");
        let initial = fs::read(&result_path).ok().filter(|b| b.len() < 8192)
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .filter(|v| v["phase"] == "updated" && v["version"] == env!("CARGO_PKG_VERSION"))
            .unwrap_or_else(|| json!({"phase":"idle", "current":env!("CARGO_PKG_VERSION")}));
        let _ = fs::remove_file(result_path);
        Arc::new(Self { data: data.join("updates"), busy: AtomicBool::new(false), started: AtomicBool::new(false),
            release: Mutex::new(None), downloaded: Mutex::new(None), endpoint: Mutex::new(None),
            latest: Mutex::new(initial), proxy })
    }
    fn emit(&self, mut value: Value) {
        value["current"] = env!("CARGO_PKG_VERSION").into();
        if let Ok(mut last) = self.latest.lock() { *last = value.clone(); }
        let _ = self.proxy.send_event(UserEvent::Update(value));
    }
    pub fn refresh(&self) {
        if let Ok(last) = self.latest.lock() { let _ = self.proxy.send_event(UserEvent::Update(last.clone())); }
    }
    pub fn page_loaded(self: &Arc<Self>, url: &str) {
        if let Ok(url) = reqwest::Url::parse(url) {
            if let Some((_, endpoint)) = url.query_pairs().find(|(key,_)| key == "endpoint") {
                if let Some(origin) = super::desktop_links::origin_of(&endpoint) {
                    if let Ok(mut current) = self.endpoint.lock() { *current = Some(origin); }
                }
            }
        }
        self.refresh();
        if !self.started.swap(true, Ordering::Relaxed) {
            let this = self.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                this.command("check");
            });
        }
    }
    pub fn command(self: &Arc<Self>, action: &str) {
        if action == "status" { self.refresh(); return; }
        if !matches!(action, "check" | "download" | "restart") || self.busy.swap(true, Ordering::SeqCst) { return; }
        let action = action.to_string(); let this = self.clone();
        std::thread::spawn(move || {
            let result = match action.as_str() { "check" => this.check(), "download" => this.download(), _ => this.restart() };
            if action == "restart" && result.is_ok() { return; } // Aguarda o encerramento; impede um segundo helper.
            if let Err(message) = result { this.emit(json!({"phase":"error", "message":message})); }
            this.busy.store(false, Ordering::SeqCst);
        });
    }
    fn check(&self) -> updates::Result<()> {
        let cfg = UpdateConfig::embedded()?;
        if cfg.public_key.is_empty() {
            self.emit(json!({"phase":"not_configured", "message":"Atualizações automáticas ainda não estão disponíveis nesta versão."}));
            return Ok(());
        }
        self.emit(json!({"phase":"checking"}));
        let found = updates::check(&cfg, env!("CARGO_PKG_VERSION"))?;
        if let Ok(mut downloaded) = self.downloaded.lock() { *downloaded = None; }
        if let Some(release) = &found {
            self.emit(json!({"phase":"available", "version":release.manifest.version, "notes":release.manifest.notes}));
        } else { self.emit(json!({"phase":"up_to_date"})); }
        *self.release.lock().map_err(|_| "Não foi possível atualizar o estado.")? = found;
        Ok(())
    }
    fn download(&self) -> updates::Result<()> {
        let release = self.release.lock().map_err(|_| "Estado indisponível.")?.clone().ok_or("Verifique as atualizações primeiro.")?;
        let dir = self.data.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let package = dir.join("package.exe");
        let mut last_percent = u64::MAX;
        self.emit(json!({"phase":"downloading", "percent":0, "version":release.manifest.version}));
        updates::download(&UpdateConfig::embedded()?, &release, &package, |done,total| {
            let percent = done.saturating_mul(100) / total.max(1);
            if percent != last_percent { last_percent = percent; self.emit(json!({"phase":"downloading", "percent":percent, "downloaded":done, "total":total, "version":release.manifest.version})); }
        })?;
        *self.downloaded.lock().map_err(|_| "Estado indisponível.")? = Some(Downloaded { release: release.clone(), package });
        self.emit(json!({"phase":"ready", "version":release.manifest.version, "message":"Download verificado. Reinicie para instalar."}));
        Ok(())
    }
    fn restart(&self) -> updates::Result<()> {
        let downloaded = self.downloaded.lock().map_err(|_| "Estado indisponível.")?.clone().ok_or("Baixe a atualização antes de reiniciar.")?;
        let cfg = UpdateConfig::embedded()?;
        updates::verify_manifest(&cfg, &downloaded.release.raw, &downloaded.release.signature)?;
        updates::verify_package(&downloaded.package, &downloaded.release.manifest)?;
        let current = env::current_exe().map_err(|e| e.to_string())?;
        let target = env::var_os("SANCORD_LAUNCHER_EXE").map(PathBuf::from).unwrap_or_else(|| current.clone());
        let target = fs::canonicalize(target).map_err(|_| "Não foi possível localizar o aplicativo instalado.")?;
        let dir = downloaded.package.parent().ok_or("Pasta inválida.")?;
        let helper = dir.join("SancordUpdateHelper.exe");
        fs::copy(&current, &helper).map_err(|e| e.to_string())?;
        fs::write(dir.join("WebView2Loader.dll"), include_bytes!("../../WebView2Loader.dll")).map_err(|e| e.to_string())?;
        let job = InstallJob { parent_pid: std::process::id(), target, package: downloaded.package.clone(),
            manifest: String::from_utf8(downloaded.release.raw).map_err(|e| e.to_string())?, signature: downloaded.release.signature,
            current_version: env!("CARGO_PKG_VERSION").into(), endpoint: self.endpoint.lock().ok().and_then(|p| p.clone()) };
        let job_path = dir.join("install.json");
        fs::write(&job_path, serde_json::to_vec(&job).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        Command::new(helper).arg("--sancord-apply-update").arg(job_path).current_dir(dir)
            .creation_flags(super::CREATE_NO_WINDOW).spawn().map_err(|_| "Não foi possível iniciar a instalação. O aplicativo atual foi preservado.")?;
        self.emit(json!({"phase":"handoff"}));
        Ok(())
    }
}

/// Executado antes de criar WebView, captura ou servidor. Nunca executa pacote não verificado.
pub fn run_helper_if_requested() -> bool {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.first().is_none_or(|a| a != "--sancord-apply-update") { return false; }
    let result = (|| -> updates::Result<()> {
        if args.len() != 2 { return Err("Argumentos de atualização inválidos.".into()); }
        use std::io::Read;
        let mut raw = Vec::new();
        fs::File::open(&args[1]).map_err(|e| e.to_string())?.take(128 * 1024 + 1).read_to_end(&mut raw).map_err(|e| e.to_string())?;
        if raw.len() > 128 * 1024 { return Err("Trabalho de instalação inválido.".into()); }
        let job: InstallJob = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        if job.current_version != env!("CARGO_PKG_VERSION") || job.parent_pid == std::process::id() { return Err("Versão de origem inválida.".into()); }
        let cfg = UpdateConfig::embedded()?;
        let release = updates::verify_manifest(&cfg, job.manifest.as_bytes(), &job.signature)?;
        updates::verify_package(&job.package, &release.manifest)?;
        // Espera pelo processo que solicitou a troca, com timeout; sem taskkill.
        unsafe {
            use windows::Win32::{Foundation::{CloseHandle, WAIT_OBJECT_0, ERROR_INVALID_PARAMETER}, System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE}};
            match OpenProcess(PROCESS_SYNCHRONIZE, false, job.parent_pid) {
                Ok(handle) => {
                    let waited = WaitForSingleObject(handle, 60_000); let _ = CloseHandle(handle);
                    if waited != WAIT_OBJECT_0 { return Err("Outra instância ainda está encerrando. Tente novamente.".into()); }
                }
                Err(error) if error.code() == windows_core::HRESULT::from_win32(ERROR_INVALID_PARAMETER.0) => {},
                Err(_) => return Err("Não foi possível confirmar o encerramento do aplicativo.".into()),
            }
        }
        updates::install(&cfg, &job, |target| {
            let mut cmd = Command::new(target);
            cmd.current_dir(target.parent().ok_or("Pasta inválida.")?).creation_flags(super::CREATE_NO_WINDOW);
            // O launcher novo deve apontar para si mesmo, não para o helper.
            cmd.env_remove("SANCORD_LAUNCHER_EXE");
            if let Some(endpoint) = &job.endpoint {
                let origin = super::desktop_links::origin_of(endpoint).ok_or("Servidor de retorno inválido.")?;
                cmd.env("SANCORD_SERVER_URL", origin);
            }
            let result_path = Path::new(&args[1]).parent().and_then(Path::parent).map(|p| p.join("result.json"));
            if let Some(path) = &result_path {
                let _ = fs::write(path, serde_json::to_vec(&json!({"phase":"updated", "version":release.manifest.version})).map_err(|e| e.to_string())?);
            }
            match cmd.spawn() {
                Ok(_) => Ok(()),
                Err(error) => {
                    if let Some(path) = result_path { let _ = fs::remove_file(path); }
                    Err(error.to_string())
                }
            }
        })
    })();
    if let Err(error) = result {
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_OK, MB_ICONERROR};
        let text: Vec<u16> = format!("Atualização não concluída.\n{error}").encode_utf16().chain(Some(0)).collect();
        unsafe { MessageBoxW(None, windows_core::PCWSTR(text.as_ptr()), windows_core::w!("Sancord"), MB_OK | MB_ICONERROR); }
    }
    true
}
