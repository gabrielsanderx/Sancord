//! Detecção local de jogos no Windows para Atividade / Rich Presence do Sancord.
//!
//! Usa apenas APIs leves de janelas/processos do Windows (`EnumWindows`,
//! `GetForegroundWindow`, `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`,
//! `QueryFullProcessImageNameW`), com handles RAII, blocklist rigorosa de
//! processos do sistema/navegadores, catálogo estruturado, leitura opcional
//! de manifestos Steam/Epic e lista de jogos registrados pelo usuário.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const POLL_INTERVAL: Duration = Duration::from_secs(4);
pub const MAX_IPC_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ActivityConfig {
    #[serde(default = "default_true")]
    pub detect_games: bool,
    #[serde(default = "default_true")]
    pub share_activity: bool,
}

fn default_true() -> bool {
    true
}

impl Default for ActivityConfig {
    fn default() -> Self {
        Self {
            detect_games: true,
            share_activity: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RegisteredGame {
    pub id: String,
    pub exe_name: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RunningApp {
    pub pid: u32,
    pub exe_name: String,
    pub exe_path: String,
    pub window_title: String,
    pub is_foreground: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CandidateProcess {
    pub exe_name: String,
    pub window_title: String,
    pub suggested_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DetectedActivity {
    pub key: String,
    pub kind: String,
    pub application_id: String,
    pub name: String,
    pub exe_name: String,
    pub started_at: i64,
    pub source: String,
    pub is_foreground: bool,
}

#[derive(Debug, Clone)]
struct SteamAppEntry {
    app_id: String,
    name: String,
    install_dir_lower: String,
}

#[derive(Debug, Clone)]
struct EpicAppEntry {
    app_name: String,
    display_name: String,
    install_location_lower: String,
    launch_exe_lower: String,
}

struct KnownGame {
    exe: &'static str,
    app_id: &'static str,
    name: &'static str,
    title_contains: Option<&'static str>,
}

const KNOWN_GAMES: &[KnownGame] = &[
    KnownGame { exe: "cyberpunk2077.exe", app_id: "game:cyberpunk2077", name: "Cyberpunk 2077", title_contains: None },
    KnownGame { exe: "minecraftlauncher.exe", app_id: "game:minecraft_launcher", name: "Minecraft Launcher", title_contains: None },
    KnownGame { exe: "minecraft.windows.exe", app_id: "game:minecraft", name: "Minecraft", title_contains: None },
    KnownGame { exe: "javaw.exe", app_id: "game:minecraft", name: "Minecraft", title_contains: Some("minecraft") },
    KnownGame { exe: "java.exe", app_id: "game:minecraft", name: "Minecraft", title_contains: Some("minecraft") },
    KnownGame { exe: "fortniteclient-win64-shipping.exe", app_id: "game:fortnite", name: "Fortnite", title_contains: None },
    KnownGame { exe: "gta5.exe", app_id: "game:gtav", name: "Grand Theft Auto V", title_contains: None },
    KnownGame { exe: "gta5_enhanced.exe", app_id: "game:gtav", name: "Grand Theft Auto V", title_contains: None },
    KnownGame { exe: "fivem.exe", app_id: "game:fivem", name: "FiveM", title_contains: None },
    KnownGame { exe: "fivem_gtaprocess.exe", app_id: "game:fivem", name: "FiveM", title_contains: None },
    KnownGame { exe: "valorant-win64-shipping.exe", app_id: "game:valorant", name: "VALORANT", title_contains: None },
    KnownGame { exe: "league of legends.exe", app_id: "game:lol", name: "League of Legends", title_contains: None },
    KnownGame { exe: "leagueclientux.exe", app_id: "game:lol", name: "League of Legends", title_contains: None },
    KnownGame { exe: "cs2.exe", app_id: "game:cs2", name: "Counter-Strike 2", title_contains: None },
    KnownGame { exe: "dota2.exe", app_id: "game:dota2", name: "Dota 2", title_contains: None },
    KnownGame { exe: "eldenring.exe", app_id: "game:eldenring", name: "ELDEN RING", title_contains: None },
    KnownGame { exe: "rdr2.exe", app_id: "game:rdr2", name: "Red Dead Redemption 2", title_contains: None },
    KnownGame { exe: "bg3.exe", app_id: "game:bg3", name: "Baldur's Gate 3", title_contains: None },
    KnownGame { exe: "bg3_dx11.exe", app_id: "game:bg3", name: "Baldur's Gate 3", title_contains: None },
    KnownGame { exe: "witcher3.exe", app_id: "game:witcher3", name: "The Witcher 3: Wild Hunt", title_contains: None },
    KnownGame { exe: "skyrimse.exe", app_id: "game:skyrimse", name: "Skyrim Special Edition", title_contains: None },
    KnownGame { exe: "fallout4.exe", app_id: "game:fallout4", name: "Fallout 4", title_contains: None },
    KnownGame { exe: "r5apex.exe", app_id: "game:apex", name: "Apex Legends", title_contains: None },
    KnownGame { exe: "r5apex_dx12.exe", app_id: "game:apex", name: "Apex Legends", title_contains: None },
    KnownGame { exe: "overwatch.exe", app_id: "game:overwatch2", name: "Overwatch 2", title_contains: None },
    KnownGame { exe: "rocketleague.exe", app_id: "game:rocketleague", name: "Rocket League", title_contains: None },
    KnownGame { exe: "terraria.exe", app_id: "game:terraria", name: "Terraria", title_contains: None },
    KnownGame { exe: "stardew valley.exe", app_id: "game:stardew", name: "Stardew Valley", title_contains: None },
    KnownGame { exe: "hollow_knight.exe", app_id: "game:hollowknight", name: "Hollow Knight", title_contains: None },
    KnownGame { exe: "hades.exe", app_id: "game:hades", name: "Hades", title_contains: None },
    KnownGame { exe: "hades2.exe", app_id: "game:hades2", name: "Hades II", title_contains: None },
    KnownGame { exe: "deadbydaylight-win64-shipping.exe", app_id: "game:dbd", name: "Dead by Daylight", title_contains: None },
    KnownGame { exe: "rustclient.exe", app_id: "game:rust", name: "Rust", title_contains: None },
    KnownGame { exe: "dayz_x64.exe", app_id: "game:dayz", name: "DayZ", title_contains: None },
    KnownGame { exe: "rainbowsix.exe", app_id: "game:r6siege", name: "Tom Clancy's Rainbow Six Siege", title_contains: None },
    KnownGame { exe: "rainbowsix_vulkan.exe", app_id: "game:r6siege", name: "Tom Clancy's Rainbow Six Siege", title_contains: None },
    KnownGame { exe: "cod.exe", app_id: "game:cod", name: "Call of Duty", title_contains: None },
    KnownGame { exe: "helldivers2.exe", app_id: "game:helldivers2", name: "HELLDIVERS 2", title_contains: None },
    KnownGame { exe: "palworld-win64-shipping.exe", app_id: "game:palworld", name: "Palworld", title_contains: None },
    KnownGame { exe: "lethal company.exe", app_id: "game:lethalcompany", name: "Lethal Company", title_contains: None },
    KnownGame { exe: "robloxplayerbeta.exe", app_id: "game:roblox", name: "Roblox", title_contains: None },
    KnownGame { exe: "genshinimpact.exe", app_id: "game:genshin", name: "Genshin Impact", title_contains: None },
    KnownGame { exe: "starrail.exe", app_id: "game:starrail", name: "Honkai: Star Rail", title_contains: None },
    KnownGame { exe: "wow.exe", app_id: "game:wow", name: "World of Warcraft", title_contains: None },
    KnownGame { exe: "wowclassic.exe", app_id: "game:wowclassic", name: "World of Warcraft Classic", title_contains: None },
    KnownGame { exe: "ffxiv_dx11.exe", app_id: "game:ffxiv", name: "FINAL FANTASY XIV", title_contains: None },
    KnownGame { exe: "escapefromtarkov.exe", app_id: "game:tarkov", name: "Escape from Tarkov", title_contains: None },
    KnownGame { exe: "pathofexile.exe", app_id: "game:poe", name: "Path of Exile", title_contains: None },
    KnownGame { exe: "pathofexilesteam.exe", app_id: "game:poe", name: "Path of Exile", title_contains: None },
    KnownGame { exe: "diablo iv.exe", app_id: "game:diablo4", name: "Diablo IV", title_contains: None },
    KnownGame { exe: "fc24.exe", app_id: "game:eafc24", name: "EA SPORTS FC 24", title_contains: None },
    KnownGame { exe: "fc25.exe", app_id: "game:eafc25", name: "EA SPORTS FC 25", title_contains: None },
    KnownGame { exe: "eurotrucks2.exe", app_id: "game:ets2", name: "Euro Truck Simulator 2", title_contains: None },
    KnownGame { exe: "acs.exe", app_id: "game:assettocorsa", name: "Assetto Corsa", title_contains: None },
    KnownGame { exe: "factorio.exe", app_id: "game:factorio", name: "Factorio", title_contains: None },
    KnownGame { exe: "factorygame-win64-shipping.exe", app_id: "game:satisfactory", name: "Satisfactory", title_contains: None },
    KnownGame { exe: "subnautica.exe", app_id: "game:subnautica", name: "Subnautica", title_contains: None },
    KnownGame { exe: "nms.exe", app_id: "game:nms", name: "No Man's Sky", title_contains: None },
    KnownGame { exe: "destiny2.exe", app_id: "game:destiny2", name: "Destiny 2", title_contains: None },
    KnownGame { exe: "warframe.x64.exe", app_id: "game:warframe", name: "Warframe", title_contains: None },
    KnownGame { exe: "tslgame.exe", app_id: "game:pubg", name: "PUBG: BATTLEGROUNDS", title_contains: None },
    KnownGame { exe: "among us.exe", app_id: "game:amongus", name: "Among Us", title_contains: None },
    KnownGame { exe: "phasmophobia.exe", app_id: "game:phasmophobia", name: "Phasmophobia", title_contains: None },
    KnownGame { exe: "valheim.exe", app_id: "game:valheim", name: "Valheim", title_contains: None },
    KnownGame { exe: "monsterhunterworld.exe", app_id: "game:mhw", name: "Monster Hunter: World", title_contains: None },
    KnownGame { exe: "re4.exe", app_id: "game:re4", name: "Resident Evil 4", title_contains: None },
    KnownGame { exe: "forzahorizon5.exe", app_id: "game:fh5", name: "Forza Horizon 5", title_contains: None },
];

const BLOCKED_PROCESSES: &[&str] = &[
    "explorer.exe", "svchost.exe", "dwm.exe", "csrss.exe", "lsass.exe", "wininit.exe",
    "winlogon.exe", "services.exe", "sihost.exe", "taskhostw.exe", "taskmgr.exe",
    "searchhost.exe", "searchapp.exe", "startmenuexperiencehost.exe", "shellexperiencehost.exe",
    "applicationframehost.exe", "textinputhost.exe", "systemsettings.exe", "lockapp.exe",
    "runtimebroker.exe", "ctfmon.exe", "conhost.exe", "dllhost.exe", "msiexec.exe",
    "mmc.exe", "regedit.exe", "control.exe", "cmd.exe", "powershell.exe", "pwsh.exe",
    "windowsterminal.exe", "openconsole.exe", "rundll32.exe", "spoolsv.exe",
    "smartscreen.exe", "securityhealthsystray.exe", "widgets.exe", "phoneexperiencehost.exe",
    "sancord.exe", "sancordapp.exe", "sancordserver.exe", "sancordbundle.exe",
    "discord.exe", "discordptb.exe", "discordcanary.exe",
    "chrome.exe", "msedge.exe", "msedgewebview2.exe", "firefox.exe", "opera.exe",
    "operagx.exe", "brave.exe", "vivaldi.exe", "arc.exe", "waterfox.exe",
    "teams.exe", "ms-teams.exe", "slack.exe", "telegram.exe", "whatsapp.exe", "zoom.exe", "skype.exe",
    "steam.exe", "steamwebhelper.exe", "steamservice.exe",
    "epicgameslauncher.exe", "epicwebhelper.exe", "battle.net.exe", "eadesktop.exe",
    "upc.exe", "ubisoftconnect.exe", "galaxyclient.exe", "riotclientservices.exe",
    "riotclientux.exe", "xboxpcapp.exe",
    "code.exe", "cursor.exe", "windsurf.exe", "devenv.exe", "idea64.exe", "pycharm64.exe",
    "webstorm64.exe", "rider64.exe", "notepad.exe", "notepad++.exe", "sublime_text.exe",
    "obs64.exe", "obs32.exe", "vlc.exe", "spotify.exe", "nvidia overlay.exe", "nvcontainer.exe",
    "geforce experience.exe", "radeonsoftware.exe", "armourycrate.exe", "icue.exe",
    "lghub.exe", "razercentral.exe", "cloudflared.exe", "node.exe", "cargo.exe", "rustc.exe",
    "git.exe", "snippingtool.exe", "screenclippinghost.exe", "calculatorapp.exe",
    "photos.exe", "mspaint.exe", "wordpad.exe", "winword.exe", "excel.exe", "powerpnt.exe",
    "outlook.exe", "olk.exe", "onedrive.exe", "dropbox.exe",
];

const NON_GAME_EXE_FRAGMENTS: &[&str] = &[
    "unins", "setup", "install", "updater", "crash", "reporter", "redist", "vcredist",
    "dxsetup", "webview", "cefprocess", "eac_launcher", "easyanticheat", "beservice",
];

pub fn is_blocked_process(exe_lower: &str) -> bool {
    BLOCKED_PROCESSES.contains(&exe_lower)
}

fn is_utility_exe(exe_lower: &str) -> bool {
    NON_GAME_EXE_FRAGMENTS.iter().any(|frag| exe_lower.contains(frag))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_exe_name(raw: &str) -> Option<String> {
    let base = Path::new(raw.trim())
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(raw.trim())
        .trim()
        .to_ascii_lowercase();
    if base.is_empty() || base.len() > 120 || !base.ends_with(".exe") {
        return None;
    }
    if base.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return None;
    }
    Some(base)
}

fn clean_display_name(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(80)
        .collect();
    if cleaned.is_empty() { None } else { Some(cleaned) }
}

fn suggest_name(exe_lower: &str, window_title: &str) -> String {
    if let Some(title) = clean_display_name(window_title) {
        if title.len() <= 48 {
            return title;
        }
    }
    let stem = exe_lower.strip_suffix(".exe").unwrap_or(exe_lower);
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => "Jogo".into(),
    }
}

/// Extrai pares `"chave" "valor"` simples de arquivos VDF/ACF da Steam.
fn parse_vdf_kv(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut tokens = Vec::new();
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '"' {
                let mut val = String::new();
                while let Some(ch) = chars.next() {
                    if ch == '\\' {
                        if let Some(next) = chars.next() {
                            val.push(next);
                        }
                    } else if ch == '"' {
                        break;
                    } else {
                        val.push(ch);
                    }
                }
                tokens.push(val);
            }
        }
        if tokens.len() >= 2 {
            out.push((tokens[0].to_ascii_lowercase(), tokens[1].clone()));
        }
    }
    out
}

fn parse_steam_manifest(text: &str) -> Option<SteamAppEntry> {
    let mut app_id = None;
    let mut name = None;
    let mut install_dir = None;
    for (k, v) in parse_vdf_kv(text) {
        match k.as_str() {
            "appid" => app_id = Some(v),
            "name" => name = Some(v),
            "installdir" => install_dir = Some(v),
            _ => {}
        }
    }
    let app_id = app_id.filter(|s| !s.is_empty())?;
    let name = clean_display_name(&name?)?;
    let lower_name = name.to_ascii_lowercase();
    if lower_name.contains("steamworks common redistributables")
        || lower_name.starts_with("proton ")
        || lower_name.contains("steam linux runtime")
        || lower_name.ends_with(" soundtrack")
    {
        return None;
    }
    let install_dir_lower = install_dir?.trim().to_ascii_lowercase();
    if install_dir_lower.is_empty() {
        return None;
    }
    Some(SteamAppEntry { app_id, name, install_dir_lower })
}

fn parse_epic_manifest(text: &str) -> Option<EpicAppEntry> {
    let val: serde_json::Value = serde_json::from_str(text).ok()?;
    let app_name = val.get("AppName")?.as_str()?.trim().to_string();
    let display_name = clean_display_name(val.get("DisplayName")?.as_str()?)?;
    let install_location = val.get("InstallLocation")?.as_str()?.trim().replace('/', "\\").to_ascii_lowercase();
    let launch_exe = val
        .get("LaunchExecutable")
        .and_then(|v| v.as_str())
        .and_then(normalize_exe_name)
        .unwrap_or_default();
    if app_name.is_empty() || install_location.is_empty() {
        return None;
    }
    Some(EpicAppEntry {
        app_name,
        display_name,
        install_location_lower: install_location,
        launch_exe_lower: launch_exe,
    })
}

fn discover_steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    fn add_root(roots: &mut Vec<PathBuf>, seen: &mut HashSet<String>, p: PathBuf) {
        let key = p.to_string_lossy().to_ascii_lowercase();
        if p.is_dir() && seen.insert(key) {
            roots.push(p);
        }
    }

    if let Ok(out) = Command::new("reg.exe")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                if let Some(idx) = line.find("REG_SZ") {
                    let path = line[idx + 6..].trim().replace('/', "\\");
                    if !path.is_empty() {
                        add_root(&mut roots, &mut seen, PathBuf::from(path));
                    }
                }
            }
        }
    }
    add_root(&mut roots, &mut seen, PathBuf::from(r"C:\Program Files (x86)\Steam"));
    add_root(&mut roots, &mut seen, PathBuf::from(r"C:\Program Files\Steam"));

    let mut extra = Vec::new();
    for root in &roots {
        let vdf = root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = fs::read_to_string(vdf) {
            for (k, v) in parse_vdf_kv(&text) {
                if k == "path" {
                    let p = PathBuf::from(v.replace("\\\\", "\\"));
                    extra.push(p);
                }
            }
        }
    }
    for p in extra {
        add_root(&mut roots, &mut seen, p);
    }
    roots
}

fn discover_steam_apps() -> Vec<SteamAppEntry> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in discover_steam_roots() {
        let steamapps = root.join("steamapps");
        let Ok(entries) = fs::read_dir(steamapps) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue };
            if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&path) {
                if let Some(app) = parse_steam_manifest(&text) {
                    if seen.insert(app.app_id.clone()) {
                        out.push(app);
                    }
                }
            }
        }
    }
    out
}

fn discover_epic_apps() -> Vec<EpicAppEntry> {
    let mut out = Vec::new();
    let dir = PathBuf::from(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests");
    let Ok(entries) = fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("item") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            if let Some(app) = parse_epic_manifest(&text) {
                out.push(app);
            }
        }
    }
    out
}

struct OwnedHandle(windows::Win32::Foundation::HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
}

fn query_process_image_path(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let guard = OwnedHandle(handle);
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let ok = unsafe {
        QueryFullProcessImageNameW(guard.0, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
    };
    if ok.is_ok() && len > 0 {
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    } else {
        None
    }
}

/// Enumera janelas visíveis de nível superior no Windows com baixo custo de CPU.
pub fn enumerate_running_apps() -> Vec<RunningApp> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    struct CollectCtx {
        fg_pid: u32,
        by_pid: HashMap<u32, (String, bool)>,
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 {
            return BOOL(1);
        }
        let title_len = GetWindowTextLengthW(hwnd);
        if title_len <= 0 {
            return BOOL(1);
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return BOOL(1);
        }
        let mut title_buf = vec![0u16; (title_len as usize).min(256) + 1];
        let copied = GetWindowTextW(hwnd, &mut title_buf);
        if copied <= 0 {
            return BOOL(1);
        }
        let title = String::from_utf16_lossy(&title_buf[..copied as usize]).trim().to_string();
        if title.is_empty() {
            return BOOL(1);
        }
        let ctx = &mut *(lparam.0 as *mut CollectCtx);
        let is_fg = pid == ctx.fg_pid;
        ctx.by_pid
            .entry(pid)
            .and_modify(|(existing, fg)| {
                if is_fg {
                    *fg = true;
                }
                if title.len() > existing.len() {
                    *existing = title.clone();
                }
            })
            .or_insert((title, is_fg));
        BOOL(1)
    }

    let fg_hwnd = unsafe { GetForegroundWindow() };
    let mut fg_pid: u32 = 0;
    if !fg_hwnd.0.is_null() {
        unsafe {
            GetWindowThreadProcessId(fg_hwnd, Some(&mut fg_pid));
        }
    }
    let mut ctx = CollectCtx {
        fg_pid,
        by_pid: HashMap::new(),
    };
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut ctx as *mut CollectCtx as isize));
    }

    let mut out = Vec::new();
    for (pid, (window_title, is_foreground)) in ctx.by_pid {
        let Some(exe_path) = query_process_image_path(pid) else { continue };
        let Some(exe_name) = normalize_exe_name(&exe_path) else { continue };
        out.push(RunningApp {
            pid,
            exe_name,
            exe_path,
            window_title,
            is_foreground,
        });
    }
    out
}

pub struct GameDetector {
    data_dir: Option<PathBuf>,
    pub config: ActivityConfig,
    pub registered: Vec<RegisteredGame>,
    steam_apps: Vec<SteamAppEntry>,
    epic_apps: Vec<EpicAppEntry>,
    active_sessions: HashMap<String, i64>,
    current_key: Option<String>,
    pub current: Option<DetectedActivity>,
    pub candidates: Vec<CandidateProcess>,
}

impl GameDetector {
    pub fn load(data_dir: PathBuf) -> Self {
        let config = fs::read_to_string(data_dir.join("activity-config.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let registered = fs::read_to_string(data_dir.join("activity-games.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            data_dir: Some(data_dir),
            config,
            registered,
            steam_apps: discover_steam_apps(),
            epic_apps: discover_epic_apps(),
            active_sessions: HashMap::new(),
            current_key: None,
            current: None,
            candidates: Vec::new(),
        }
    }

    #[cfg(test)]
    fn in_memory() -> Self {
        Self {
            data_dir: None,
            config: ActivityConfig::default(),
            registered: Vec::new(),
            steam_apps: Vec::new(),
            epic_apps: Vec::new(),
            active_sessions: HashMap::new(),
            current_key: None,
            current: None,
            candidates: Vec::new(),
        }
    }

    fn save_config(&self) {
        if let Some(dir) = &self.data_dir {
            if let Ok(json) = serde_json::to_string_pretty(&self.config) {
                let _ = fs::write(dir.join("activity-config.json"), json);
            }
        }
    }

    fn save_registered(&self) {
        if let Some(dir) = &self.data_dir {
            if let Ok(json) = serde_json::to_string_pretty(&self.registered) {
                let _ = fs::write(dir.join("activity-games.json"), json);
            }
        }
    }

    fn match_app(&self, app: &RunningApp) -> Option<(String, String, String, u8)> {
        // 1. Jogos registrados pelo usuário (maior prioridade; permite renomear ou adicionar jogo desconhecido)
        if let Some(reg) = self.registered.iter().find(|g| g.exe_name == app.exe_name) {
            if !reg.enabled {
                return None;
            }
            let app_id = reg
                .application_id
                .clone()
                .unwrap_or_else(|| format!("custom:{}", reg.id));
            return Some((format!("reg:{}", reg.exe_name), app_id, reg.display_name.clone(), 3));
        }

        if is_blocked_process(&app.exe_name) || is_utility_exe(&app.exe_name) {
            return None;
        }

        // 2. Catálogo estruturado conhecido
        let title_lower = app.window_title.to_ascii_lowercase();
        for g in KNOWN_GAMES {
            if g.exe == app.exe_name {
                if let Some(hint) = g.title_contains {
                    if !title_lower.contains(hint) {
                        continue;
                    }
                }
                return Some((
                    format!("known:{}", g.app_id),
                    g.app_id.to_string(),
                    g.name.to_string(),
                    2,
                ));
            }
        }

        let path_lower = app.exe_path.replace('/', "\\").to_ascii_lowercase();

        // 3. Manifestos Steam instalados
        for s in &self.steam_apps {
            let needle = format!("\\steamapps\\common\\{}\\", s.install_dir_lower);
            if path_lower.contains(&needle) {
                return Some((
                    format!("steam:{}", s.app_id),
                    format!("steam:{}", s.app_id),
                    s.name.clone(),
                    1,
                ));
            }
        }

        // 4. Manifestos Epic Games instalados
        for e in &self.epic_apps {
            let matches_dir = !e.install_location_lower.is_empty()
                && path_lower.starts_with(&e.install_location_lower);
            let matches_exe = !e.launch_exe_lower.is_empty() && app.exe_name == e.launch_exe_lower;
            if matches_dir || matches_exe {
                return Some((
                    format!("epic:{}", e.app_name),
                    format!("epic:{}", e.app_name),
                    e.display_name.clone(),
                    1,
                ));
            }
        }

        None
    }

    /// Avalia uma lista de apps em execução e retorna `true` se a atividade ativa mudou.
    pub fn evaluate(&mut self, apps: &[RunningApp], now: i64) -> bool {
        let prev = self.current.clone();
        let mut candidates = Vec::new();
        let mut seen_candidates = HashSet::new();

        if !self.config.detect_games {
            self.active_sessions.clear();
            self.current_key = None;
            self.current = None;
            self.candidates.clear();
            return prev != self.current;
        }

        let mut recognized: Vec<(String, String, String, String, u8, bool)> = Vec::new();
        let mut running_keys = HashSet::new();

        for app in apps {
            if let Some((key, app_id, name, priority)) = self.match_app(app) {
                if running_keys.insert(key.clone()) {
                    recognized.push((key, app_id, name, app.exe_name.clone(), priority, app.is_foreground));
                }
            } else if !is_blocked_process(&app.exe_name)
                && !is_utility_exe(&app.exe_name)
                && !self.registered.iter().any(|g| g.exe_name == app.exe_name)
                && seen_candidates.insert(app.exe_name.clone())
            {
                candidates.push(CandidateProcess {
                    exe_name: app.exe_name.clone(),
                    window_title: app.window_title.chars().take(64).collect(),
                    suggested_name: suggest_name(&app.exe_name, &app.window_title),
                });
            }
        }

        candidates.sort_by(|a, b| a.suggested_name.to_lowercase().cmp(&b.suggested_name.to_lowercase()));
        candidates.truncate(20);
        self.candidates = candidates;

        // Mantém timestamp original enquanto o processo continua rodando; remove os fechados.
        self.active_sessions.retain(|k, _| running_keys.contains(k));
        for (key, ..) in &recognized {
            self.active_sessions.entry(key.clone()).or_insert(now);
        }

        // Regra determinística para múltiplos jogos:
        // 1) jogo reconhecido em foreground (maior prioridade vence);
        // 2) jogo ativo anterior se ainda estiver aberto (evita troca ao dar Alt+Tab);
        // 3) jogo reconhecido iniciado mais recentemente.
        let chosen = recognized
            .iter()
            .filter(|(_, _, _, _, _, fg)| *fg)
            .max_by_key(|(key, _, _, _, prio, _)| (*prio, *self.active_sessions.get(key).unwrap_or(&0)))
            .or_else(|| {
                self.current_key
                    .as_ref()
                    .and_then(|cur| recognized.iter().find(|(k, ..)| k == cur))
            })
            .or_else(|| {
                recognized
                    .iter()
                    .max_by_key(|(key, _, _, _, prio, _)| (*self.active_sessions.get(key).unwrap_or(&0), *prio))
            });

        self.current = chosen.map(|(key, app_id, name, exe_name, _, is_fg)| {
            self.current_key = Some(key.clone());
            DetectedActivity {
                key: key.clone(),
                kind: "playing".into(),
                application_id: app_id.clone(),
                name: name.clone(),
                exe_name: exe_name.clone(),
                started_at: *self.active_sessions.get(key).unwrap_or(&now),
                source: "game_detector".into(),
                is_foreground: *is_fg,
            }
        });
        if self.current.is_none() {
            self.current_key = None;
        }

        // Mudança relevante para propagar (ignora troca apenas de is_foreground no mesmo jogo)
        let same_payload = match (&prev, &self.current) {
            (Some(a), Some(b)) => {
                a.key == b.key
                    && a.name == b.name
                    && a.application_id == b.application_id
                    && a.started_at == b.started_at
            }
            (None, None) => true,
            _ => false,
        };
        !same_payload
    }

    pub fn register_game(&mut self, exe_raw: &str, display_raw: &str) -> Result<RegisteredGame, &'static str> {
        let exe_name = normalize_exe_name(exe_raw).ok_or("Informe um executável válido (.exe).")?;
        if is_blocked_process(&exe_name) {
            return Err("Processos do sistema, navegadores ou o próprio Sancord não podem ser registrados como jogo.");
        }
        let display_name = clean_display_name(display_raw).ok_or("Informe o nome do jogo.")?;
        if let Some(existing) = self.registered.iter_mut().find(|g| g.exe_name == exe_name) {
            existing.display_name = display_name;
            existing.enabled = true;
            let cloned = existing.clone();
            self.save_registered();
            return Ok(cloned);
        }
        if self.registered.len() >= 64 {
            return Err("Limite de 64 jogos registrados atingido.");
        }
        let id = format!(
            "g{}",
            exe_name
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(24)
                .collect::<String>()
        );
        let entry = RegisteredGame {
            id,
            exe_name,
            display_name,
            application_id: None,
            enabled: true,
            source: "manual".into(),
        };
        self.registered.push(entry.clone());
        self.save_registered();
        Ok(entry)
    }

    pub fn update_game(&mut self, exe_raw: &str, display_raw: Option<&str>, enabled: Option<bool>) -> bool {
        let Some(exe_name) = normalize_exe_name(exe_raw) else { return false };
        let Some(game) = self.registered.iter_mut().find(|g| g.exe_name == exe_name) else {
            return false;
        };
        if let Some(name) = display_raw.and_then(clean_display_name) {
            game.display_name = name;
        }
        if let Some(en) = enabled {
            game.enabled = en;
        }
        self.save_registered();
        true
    }

    pub fn remove_game(&mut self, exe_raw: &str) -> bool {
        let Some(exe_name) = normalize_exe_name(exe_raw) else { return false };
        let before = self.registered.len();
        self.registered.retain(|g| g.exe_name != exe_name);
        if self.registered.len() != before {
            self.save_registered();
            true
        } else {
            false
        }
    }

    pub fn snapshot_json(&self) -> serde_json::Value {
        serde_json::json!({
            "supported": true,
            "config": self.config,
            "detected": self.current,
            "registered": self.registered,
            "candidates": self.candidates,
            "steamCount": self.steam_apps.len(),
            "epicCount": self.epic_apps.len(),
        })
    }
}

pub struct ActivityMonitor {
    inner: Arc<(Mutex<GameDetector>, Condvar)>,
}

impl ActivityMonitor {
    pub fn spawn<F>(data_dir: PathBuf, on_update: F) -> Self
    where
        F: Fn(serde_json::Value) + Send + Sync + 'static,
    {
        let detector = GameDetector::load(data_dir);
        let inner = Arc::new((Mutex::new(detector), Condvar::new()));
        let bg = inner.clone();
        std::thread::spawn(move || {
            loop {
                let detect_enabled = {
                    let guard = bg.0.lock().unwrap_or_else(|e| e.into_inner());
                    guard.config.detect_games
                };
                if detect_enabled {
                    let apps = enumerate_running_apps();
                    let snapshot = {
                        let mut guard = bg.0.lock().unwrap_or_else(|e| e.into_inner());
                        let changed = guard.evaluate(&apps, now_ms());
                        changed.then(|| guard.snapshot_json())
                    };
                    if let Some(val) = snapshot {
                        on_update(val);
                    }
                    let guard = bg.0.lock().unwrap_or_else(|e| e.into_inner());
                    let _ = bg.1.wait_timeout(guard, POLL_INTERVAL);
                } else {
                    let guard = bg.0.lock().unwrap_or_else(|e| e.into_inner());
                    drop(bg.1.wait(guard));
                }
            }
        });
        Self { inner }
    }

    pub fn handle_ipc(&self, payload: &str) -> serde_json::Value {
        let mut reply_error: Option<String> = None;
        let snapshot = if payload == "get-state" || payload == "scan-now" {
            let apps = enumerate_running_apps();
            let mut guard = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
            guard.evaluate(&apps, now_ms());
            guard.snapshot_json()
        } else if let Some(json_str) = payload.strip_prefix("set-config:") {
            let apps = enumerate_running_apps();
            let mut guard = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(v) = val.get("detect_games").and_then(|b| b.as_bool()) {
                    guard.config.detect_games = v;
                }
                if let Some(v) = val.get("share_activity").and_then(|b| b.as_bool()) {
                    guard.config.share_activity = v;
                }
                guard.save_config();
            }
            guard.evaluate(&apps, now_ms());
            self.inner.1.notify_all();
            guard.snapshot_json()
        } else if let Some(json_str) = payload.strip_prefix("register-game:") {
            let apps = enumerate_running_apps();
            let mut guard = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                let exe = val.get("exe_name").and_then(|v| v.as_str()).unwrap_or("");
                let name = val.get("display_name").and_then(|v| v.as_str()).unwrap_or("");
                if let Err(err) = guard.register_game(exe, name) {
                    reply_error = Some(err.to_string());
                }
            }
            guard.evaluate(&apps, now_ms());
            self.inner.1.notify_all();
            guard.snapshot_json()
        } else if let Some(json_str) = payload.strip_prefix("update-game:") {
            let apps = enumerate_running_apps();
            let mut guard = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                let exe = val.get("exe_name").and_then(|v| v.as_str()).unwrap_or("");
                let name = val.get("display_name").and_then(|v| v.as_str());
                let enabled = val.get("enabled").and_then(|v| v.as_bool());
                guard.update_game(exe, name, enabled);
            }
            guard.evaluate(&apps, now_ms());
            self.inner.1.notify_all();
            guard.snapshot_json()
        } else if let Some(json_str) = payload.strip_prefix("remove-game:") {
            let apps = enumerate_running_apps();
            let mut guard = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                let exe = val.get("exe_name").and_then(|v| v.as_str()).unwrap_or("");
                guard.remove_game(exe);
            }
            guard.evaluate(&apps, now_ms());
            self.inner.1.notify_all();
            guard.snapshot_json()
        } else {
            let guard = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
            guard.snapshot_json()
        };

        let mut obj = snapshot;
        if let Some(err) = reply_error {
            obj["error"] = serde_json::Value::String(err);
        }
        obj
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(exe: &str, title: &str, fg: bool) -> RunningApp {
        RunningApp {
            pid: 100,
            exe_name: exe.to_ascii_lowercase(),
            exe_path: format!(r"C:\Games\{exe}"),
            window_title: title.into(),
            is_foreground: fg,
        }
    }

    #[test]
    fn ignores_system_and_browser_processes() {
        let mut det = GameDetector::in_memory();
        let apps = vec![
            app("explorer.exe", "Desktop", false),
            app("chrome.exe", "Google Chrome", true),
            app("sancord.exe", "Sancord", false),
            app("discord.exe", "Discord", false),
            app("svchost.exe", "Host", false),
        ];
        det.evaluate(&apps, 1_000);
        assert!(det.current.is_none());
        assert!(det.candidates.is_empty());
    }

    #[test]
    fn detects_known_game_preserves_timestamp_and_clears_on_close() {
        let mut det = GameDetector::in_memory();
        let cp = vec![app("Cyberpunk2077.exe", "Cyberpunk 2077", true)];
        assert!(det.evaluate(&cp, 10_000));
        assert_eq!(det.current.as_ref().unwrap().name, "Cyberpunk 2077");
        assert_eq!(det.current.as_ref().unwrap().started_at, 10_000);

        // Refresh não reseta timestamp nem dispara mudança falsa
        assert!(!det.evaluate(&cp, 50_000));
        assert_eq!(det.current.as_ref().unwrap().started_at, 10_000);

        // Processo fechou -> atividade some imediatamente
        assert!(det.evaluate(&[], 60_000));
        assert!(det.current.is_none());

        // Reabre depois -> novo timestamp
        assert!(det.evaluate(&cp, 90_000));
        assert_eq!(det.current.as_ref().unwrap().started_at, 90_000);
    }

    #[test]
    fn resolves_two_games_with_foreground_and_alt_tab_stability() {
        let mut det = GameDetector::in_memory();
        let mut g1 = app("Cyberpunk2077.exe", "Cyberpunk 2077", true);
        let mut g2 = app("EldenRing.exe", "ELDEN RING", false);
        det.evaluate(&[g1.clone(), g2.clone()], 1_000);
        assert_eq!(det.current.as_ref().unwrap().name, "Cyberpunk 2077");

        // Alt+Tab para o navegador: mantém Cyberpunk 2077 estável
        g1.is_foreground = false;
        det.evaluate(&[g1.clone(), g2.clone(), app("chrome.exe", "Chrome", true)], 5_000);
        assert_eq!(det.current.as_ref().unwrap().name, "Cyberpunk 2077");
        assert_eq!(det.current.as_ref().unwrap().started_at, 1_000);

        // Usuário foca Elden Ring -> troca para Elden Ring com timestamp preservado
        g2.is_foreground = true;
        assert!(det.evaluate(&[g1.clone(), g2.clone()], 9_000));
        assert_eq!(det.current.as_ref().unwrap().name, "ELDEN RING");
        assert_eq!(det.current.as_ref().unwrap().started_at, 1_000);

        // Elden Ring fecha -> volta para Cyberpunk 2077 sem perder timestamp
        assert!(det.evaluate(&[g1], 15_000));
        assert_eq!(det.current.as_ref().unwrap().name, "Cyberpunk 2077");
        assert_eq!(det.current.as_ref().unwrap().started_at, 1_000);
    }

    #[test]
    fn java_requires_minecraft_window_title_and_custom_registration_works() {
        let mut det = GameDetector::in_memory();
        det.evaluate(&[app("javaw.exe", "Eclipse IDE", true)], 1_000);
        assert!(det.current.is_none());

        det.evaluate(&[app("javaw.exe", "Minecraft 1.21.4 - Multiplayer", true)], 2_000);
        assert_eq!(det.current.as_ref().unwrap().name, "Minecraft");

        // Processo não reconhecido vira candidato e só publica se usuário registrar
        let indie = vec![app("MyIndieGame.exe", "My Indie Game", true)];
        det.evaluate(&indie, 3_000);
        assert!(det.current.is_none());
        assert_eq!(det.candidates.len(), 1);
        assert_eq!(det.candidates[0].exe_name, "myindiegame.exe");

        assert!(det.register_game("chrome.exe", "Chrome").is_err());
        det.register_game("MyIndieGame.exe", "Aventura Indie").unwrap();
        det.evaluate(&indie, 4_000);
        assert_eq!(det.current.as_ref().unwrap().name, "Aventura Indie");

        // Desativar detecção limpa atividade imediatamente
        det.config.detect_games = false;
        assert!(det.evaluate(&indie, 5_000));
        assert!(det.current.is_none());
    }

    #[test]
    fn parses_steam_and_epic_manifests_and_matches_paths() {
        let steam_acf = r#"
        "AppState"
        {
            "appid"     "1245620"
            "name"      "Hades Custom"
            "installdir"    "HadesCustom"
        }
        "#;
        let epic_item = r#"{
            "AppName": "Sugar",
            "DisplayName": "Rocket Epic",
            "InstallLocation": "D:\\EpicGames\\RocketEpic",
            "LaunchExecutable": "Binaries/RocketEpic.exe"
        }"#;
        let mut det = GameDetector::in_memory();
        det.steam_apps.push(parse_steam_manifest(steam_acf).unwrap());
        det.epic_apps.push(parse_epic_manifest(epic_item).unwrap());

        let steam_proc = RunningApp {
            pid: 1,
            exe_name: "unknown_bin.exe".into(),
            exe_path: r"D:\SteamLibrary\steamapps\common\HadesCustom\x64\unknown_bin.exe".into(),
            window_title: "Hades".into(),
            is_foreground: true,
        };
        det.evaluate(&[steam_proc], 1_000);
        assert_eq!(det.current.as_ref().unwrap().name, "Hades Custom");
        assert_eq!(det.current.as_ref().unwrap().application_id, "steam:1245620");

        let epic_proc = RunningApp {
            pid: 2,
            exe_name: "rocketepic.exe".into(),
            exe_path: r"D:\EpicGames\RocketEpic\Binaries\RocketEpic.exe".into(),
            window_title: "Rocket".into(),
            is_foreground: true,
        };
        det.evaluate(&[epic_proc], 2_000);
        assert_eq!(det.current.as_ref().unwrap().name, "Rocket Epic");
        assert_eq!(det.current.as_ref().unwrap().application_id, "epic:Sugar");
    }
}
