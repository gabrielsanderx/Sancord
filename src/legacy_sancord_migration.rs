//! Camada centralizada de migração e compatibilidade `Sancord` (legado) -> `Sanvo` (atual).
//!
//! Regras desta camada:
//! 1. Instalações novas usam exclusivamente `%LOCALAPPDATA%\Sanvo` e identificadores `Sanvo`.
//! 2. Instalações existentes que possuam `%LOCALAPPDATA%\SancordDesktopData` têm suas
//!    configurações copiadas de forma segura para `%LOCALAPPDATA%\Sanvo` na primeira
//!    inicialização, **sem apagar** a pasta antiga.
//! 3. Variáveis de ambiente aceitam `SANVO_*` com fallback automático para `SANCORD_*`.
//! 4. Sessões protegidas por DPAPI selam com entropia `Sanvo desktop auth v1:{scope}` e
//!    abrem com fallback para `Sancord desktop auth v1:{scope}`.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

/// Nome oficial do diretório em `%LOCALAPPDATA%`.
pub const SANVO_DATA_DIR_NAME: &str = "Sanvo";

/// LEGACY COMPATIBILITY: Nome antigo do diretório em `%LOCALAPPDATA%`.
pub const LEGACY_SANCORD_DATA_DIR_NAME: &str = "SancordDesktopData";

/// Valor oficial em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
pub const RUN_REG_VALUE_SANVO: &str = "SanvoDesktop";

/// LEGACY COMPATIBILITY: Valor antigo em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
pub const RUN_REG_VALUE_LEGACY_SANCORD: &str = "SancordDesktop";

/// Prefixo oficial de entropia DPAPI para tokens de sessão no Windows.
pub const DPAPI_ENTROPY_PREFIX_SANVO: &str = "Sanvo desktop auth v1";

/// LEGACY COMPATIBILITY: Prefixo antigo de entropia DPAPI para abrir sessões já salvas.
pub const DPAPI_ENTROPY_PREFIX_LEGACY_SANCORD: &str = "Sancord desktop auth v1";

/// Arquivos portáteis de configuração do cliente desktop migrados de `SancordDesktopData` para `Sanvo`.
pub const PORTABLE_DESKTOP_FILES: &[&str] = &[
    "desktop-prefs.json",
    "known_endpoints.json",
    "activity-config.json",
    "activity-games.json",
    "updates/result.json",
];

/// Lê uma variável de ambiente priorizando `SANVO_*` com fallback para `SANCORD_*`.
///
/// // LEGACY COMPATIBILITY: mantém suporte a scripts e ambientes que ainda definem `SANCORD_*`.
pub fn env_var_compat(sanvo_key: &str, legacy_sancord_key: &str) -> Option<String> {
    if let Ok(val) = env::var(sanvo_key) {
        if !val.trim().is_empty() {
            return Some(val);
        }
    }
    if let Ok(val) = env::var(legacy_sancord_key) {
        if !val.trim().is_empty() {
            return Some(val);
        }
    }
    None
}

/// Entropia DPAPI primária do Sanvo para um escopo de sessão.
pub fn dpapi_entropy_for_scope(scope: &str) -> String {
    format!("{DPAPI_ENTROPY_PREFIX_SANVO}:{scope}")
}

/// LEGACY COMPATIBILITY: Entropia DPAPI legada do Sancord para abrir sessões criadas antes da migração.
pub fn dpapi_legacy_entropy_for_scope(scope: &str) -> String {
    format!("{DPAPI_ENTROPY_PREFIX_LEGACY_SANCORD}:{scope}")
}

/// Resolve o diretório de dados do cliente desktop em `%LOCALAPPDATA%`, executando
/// a migração segura `SancordDesktopData` -> `Sanvo` quando aplicável.
pub fn resolve_desktop_data_dir(local_app_data: &Path) -> PathBuf {
    let env_override = env_var_compat("SANVO_DESKTOP_DATA_DIR", "SANCORD_DESKTOP_DATA_DIR")
        .map(PathBuf::from);
    resolve_desktop_data_dir_with(local_app_data, env_override)
}

/// Versão testável de [`resolve_desktop_data_dir`] com override explícito.
pub fn resolve_desktop_data_dir_with(
    local_app_data: &Path,
    env_override: Option<PathBuf>,
) -> PathBuf {
    if let Some(custom) = env_override {
        let _ = fs::create_dir_all(&custom);
        return custom;
    }

    let sanvo_dir = local_app_data.join(SANVO_DATA_DIR_NAME);
    let legacy_dir = local_app_data.join(LEGACY_SANCORD_DATA_DIR_NAME);

    if legacy_dir.is_dir() {
        let _ = migrate_legacy_desktop_dir(&legacy_dir, &sanvo_dir);
    } else {
        let _ = fs::create_dir_all(&sanvo_dir);
    }

    sanvo_dir
}

/// Copia arquivos de configuração e armazenamento do WebView2 de `legacy_dir` (`SancordDesktopData`)
/// para `sanvo_dir` (`Sanvo`) sem sobrescrever arquivos já existentes no destino e sem apagar a origem.
pub fn migrate_legacy_desktop_dir(legacy_dir: &Path, sanvo_dir: &Path) -> io::Result<usize> {
    if !legacy_dir.is_dir() {
        return Ok(0);
    }
    let first_time_sanvo = !sanvo_dir.exists();
    fs::create_dir_all(sanvo_dir)?;

    let mut copied_count = 0usize;
    for rel in PORTABLE_DESKTOP_FILES {
        let src = legacy_dir.join(rel);
        let dst = sanvo_dir.join(rel);
        if src.is_file() && !dst.exists() {
            if let Some(parent) = dst.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if fs::copy(&src, &dst).is_ok() {
                copied_count += 1;
            }
        }
    }

    // Se a pasta Sanvo acabou de ser criada a partir de uma instalação existente do Sancord,
    // também migra o Local Storage do WebView2 (EBWebView/Default/Local Storage/leveldb) se disponível,
    // preservando tokens DPAPI, contas salvas e preferências locais do usuário.
    if first_time_sanvo {
        let legacy_leveldb = legacy_dir
            .join("EBWebView")
            .join("Default")
            .join("Local Storage")
            .join("leveldb");
        let sanvo_leveldb = sanvo_dir
            .join("EBWebView")
            .join("Default")
            .join("Local Storage")
            .join("leveldb");
        if legacy_leveldb.is_dir() && !sanvo_leveldb.exists() {
            copied_count += copy_dir_flat_best_effort(&legacy_leveldb, &sanvo_leveldb);
        }

        let marker = sanvo_dir.join(".migrated-from-sancord.json");
        if !marker.exists() {
            let body = format!(
                "{{\"migrated_from\":{:?},\"files_copied\":{copied_count}}}",
                legacy_dir.to_string_lossy()
            );
            let _ = fs::write(marker, body);
        }
    }

    Ok(copied_count)
}

fn copy_dir_flat_best_effort(src_dir: &Path, dst_dir: &Path) -> usize {
    if fs::create_dir_all(dst_dir).is_err() {
        return 0;
    }
    let Ok(entries) = fs::read_dir(src_dir) else {
        return 0;
    };
    let mut count = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let dst = dst_dir.join(entry.file_name());
            if !dst.exists() && fs::copy(&path, &dst).is_ok() {
                count += 1;
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("sanvo-migration-test-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn clean_install_creates_only_sanvo_dir_without_sancord_folder() {
        let root = temp_test_dir("clean");
        let resolved = resolve_desktop_data_dir_with(&root, None);
        assert_eq!(resolved, root.join("Sanvo"));
        assert!(resolved.is_dir(), "Pasta Sanvo deve existir em instalação limpa");
        assert!(
            !root.join("SancordDesktopData").exists(),
            "Instalação limpa NÃO pode criar pasta SancordDesktopData"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn existing_sancord_install_migrates_files_to_sanvo_and_preserves_legacy_dir() {
        let root = temp_test_dir("upgrade");
        let legacy = root.join("SancordDesktopData");
        fs::create_dir_all(legacy.join("updates")).unwrap();
        fs::write(
            legacy.join("desktop-prefs.json"),
            r#"{"start_minimized":true,"minimize_on_close":false}"#,
        )
        .unwrap();
        fs::write(
            legacy.join("known_endpoints.json"),
            r#"["https://chat.sanvo.example"]"#,
        )
        .unwrap();
        fs::write(
            legacy.join("updates/result.json"),
            r#"{"version":"0.2.7"}"#,
        )
        .unwrap();

        let resolved = resolve_desktop_data_dir_with(&root, None);
        assert_eq!(resolved, root.join("Sanvo"));
        assert!(resolved.join("desktop-prefs.json").is_file());
        assert!(resolved.join("known_endpoints.json").is_file());
        assert!(resolved.join("updates/result.json").is_file());
        assert!(resolved.join(".migrated-from-sancord.json").is_file());
        // A pasta legada jamais deve ser apagada automaticamente.
        assert!(legacy.join("desktop-prefs.json").is_file());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn existing_sanvo_install_is_not_overwritten_by_older_legacy_files() {
        let root = temp_test_dir("no-overwrite");
        let legacy = root.join("SancordDesktopData");
        let sanvo = root.join("Sanvo");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&sanvo).unwrap();
        fs::write(legacy.join("desktop-prefs.json"), r#"{"start_minimized":false}"#).unwrap();
        fs::write(sanvo.join("desktop-prefs.json"), r#"{"start_minimized":true}"#).unwrap();
        fs::write(legacy.join("activity-games.json"), r#"[{"exe_name":"game.exe"}]"#).unwrap();

        let resolved = resolve_desktop_data_dir_with(&root, None);
        assert_eq!(resolved, sanvo);
        assert_eq!(
            fs::read_to_string(sanvo.join("desktop-prefs.json")).unwrap(),
            r#"{"start_minimized":true}"#
        );
        // Arquivos ausentes no Sanvo ainda são copiados do legado.
        assert!(sanvo.join("activity-games.json").is_file());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn dpapi_entropy_helpers_produce_sanvo_and_legacy_sancord_scopes() {
        assert_eq!(
            dpapi_entropy_for_scope("persistente:sancord_token:http://127.0.0.1:3000"),
            "Sanvo desktop auth v1:persistente:sancord_token:http://127.0.0.1:3000"
        );
        assert_eq!(
            dpapi_legacy_entropy_for_scope("persistente:sancord_token:http://127.0.0.1:3000"),
            "Sancord desktop auth v1:persistente:sancord_token:http://127.0.0.1:3000"
        );
    }
}
