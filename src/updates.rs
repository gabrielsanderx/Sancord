//! Atualizações do cliente: metadados Ed25519, pacote SHA-256, instalação com rollback.
//! Nenhuma chave privada ou token GitHub é usado pelo aplicativo.
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, time::Duration};
use ed25519_dalek::{Signature, VerifyingKey};
use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_PACKAGE: u64 = 256 * 1024 * 1024;
// Compatibilidade do pacote é SO/arquitetura; não depende do linker GNU/MSVC.
pub const TARGET: &str = "windows-x86_64";
pub const ASSET: &str = "Sancord.exe";

#[derive(Clone, Deserialize, Serialize)]
pub struct UpdateConfig { pub repository: String, pub public_key: String }
impl UpdateConfig {
    pub fn embedded() -> Result<Self> { serde_json::from_str(include_str!("../release-config.json")).map_err(|e| e.to_string()) }
    pub fn validate(&self) -> Result<()> {
        let parts: Vec<_> = self.repository.split('/').collect();
        if parts.len() != 2 || parts.iter().any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))) {
            return Err("Repositório de atualizações inválido.".into());
        }
        key(&self.public_key)?;
        Ok(())
    }
}
fn key(raw: &str) -> Result<VerifyingKey> {
    let bytes: [u8; 32] = hex::decode(raw.trim()).map_err(|_| "Chave pública de atualização inválida.")?
        .try_into().map_err(|_| "Atualizações ainda não configuradas: falta a chave pública.")?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| "Chave pública inválida.".into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema: u32, pub repository: String, pub version: String, pub target: String,
    pub asset: String, pub size: u64, pub sha256: String, pub notes: String,
}
#[derive(Clone)]
pub struct VerifiedRelease { pub manifest: Manifest, pub raw: Vec<u8>, pub signature: String }

pub fn newer(candidate: &str, current: &str) -> Result<bool> {
    let next = Version::parse(candidate).map_err(|_| "Versão publicada inválida.")?;
    let installed = Version::parse(current).map_err(|_| "Versão instalada inválida.")?;
    Ok(next.pre.is_empty() && next > installed)
}

pub fn verify_manifest(config: &UpdateConfig, raw: &[u8], signature: &str) -> Result<VerifiedRelease> {
    config.validate()?;
    if raw.len() > 64 * 1024 { return Err("Metadados excedem o limite.".into()); }
    let bytes = hex::decode(signature.trim()).map_err(|_| "Assinatura inválida.")?;
    let signature_bytes = Signature::from_slice(&bytes).map_err(|_| "Assinatura inválida.")?;
    key(&config.public_key)?.verify_strict(raw, &signature_bytes).map_err(|_| "A assinatura da atualização não confere. Instalação bloqueada.")?;
    let m: Manifest = serde_json::from_slice(raw).map_err(|_| "Metadados inválidos.")?;
    let version = Version::parse(&m.version).map_err(|_| "Versão inválida.")?;
    if m.schema != 1 || m.repository != config.repository || m.target != TARGET || m.asset != ASSET
        || !version.pre.is_empty() || !version.build.is_empty() || m.size == 0 || m.size > MAX_PACKAGE
        || m.sha256.len() != 64 || !m.sha256.bytes().all(|b| b.is_ascii_hexdigit()) || m.notes.len() > 48 * 1024 {
        return Err("Metadados incompatíveis com este aplicativo.".into());
    }
    Ok(VerifiedRelease { manifest: m, raw: raw.to_vec(), signature: signature.to_string() })
}

pub fn client() -> Result<Client> {
    Client::builder().https_only(true).connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300)).redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(concat!("Sancord/", env!("CARGO_PKG_VERSION")))
        .build().map_err(|_| "Não foi possível iniciar a conexão segura.".into())
}
fn bounded(mut reader: impl Read, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.by_ref().take(limit + 1).read_to_end(&mut bytes).map_err(|_| "Falha ao receber dados da atualização.")?;
    if bytes.len() as u64 > limit { return Err("Resposta de atualização excede o limite.".into()); }
    Ok(bytes)
}
// Privado: produção só constrói os endereços HTTPS fixos do GitHub. Os testes
// exercitam o mesmo fluxo com TLS local, sem opção de trocar o servidor no app.
struct ReleaseSource { latest: String, downloads: String }
impl ReleaseSource {
    fn github(config: &UpdateConfig) -> Self {
        Self {
            latest: format!("https://api.github.com/repos/{}/releases/latest", config.repository),
            downloads: format!("https://github.com/{}/releases/download", config.repository),
        }
    }
    fn asset(&self, version: &str, name: &str) -> String {
        format!("{}/v{version}/{name}", self.downloads)
    }
}
fn get_bytes(client: &Client, url: &str, limit: u64) -> Result<Vec<u8>> {
    let response = client.get(url).timeout(Duration::from_secs(30)).send()
        .and_then(|r| r.error_for_status()).map_err(|_| "Falha de rede ao consultar atualizações. Tente novamente.")?;
    bounded(response, limit)
}
#[derive(Deserialize)]
struct GithubRelease { tag_name: String, draft: bool, prerelease: bool }
fn release_version(raw: &[u8], current: &str) -> Result<Option<String>> {
    let release: GithubRelease = serde_json::from_slice(raw).map_err(|_| "Resposta inválida do GitHub.")?;
    if release.draft || release.prerelease { return Ok(None); }
    let version = release.tag_name.strip_prefix('v').ok_or("Tag de versão inválida.")?;
    Ok(if newer(version, current)? { Some(version.into()) } else { None })
}
pub fn check(config: &UpdateConfig, current: &str) -> Result<Option<VerifiedRelease>> {
    config.validate()?;
    let client = client()?;
    check_from(config, current, &client, &ReleaseSource::github(config))
}
fn check_from(config: &UpdateConfig, current: &str, client: &Client, source: &ReleaseSource) -> Result<Option<VerifiedRelease>> {
    config.validate()?;
    let response = client.get(&source.latest)
        .header("Accept", "application/vnd.github+json").timeout(Duration::from_secs(30)).send()
        .map_err(|_| "Não foi possível consultar o GitHub. Verifique a conexão.".to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(None); }
    let response = response.error_for_status().map_err(|_| "GitHub indisponível ou limite de consultas atingido. Tente mais tarde.")?;
    let Some(version) = release_version(&bounded(response, 1024 * 1024)?, current)? else { return Ok(None); };
    let raw = get_bytes(client, &source.asset(&version, "sancord-update.json"), 64 * 1024)?;
    let signature = String::from_utf8(get_bytes(client, &source.asset(&version, "sancord-update.sig"), 256)?).map_err(|_| "Assinatura inválida.")?;
    let verified = verify_manifest(config, &raw, &signature)?;
    if verified.manifest.version != version { return Err("A versão assinada difere da release.".into()); }
    Ok(Some(verified))
}

/// Escreve em arquivo novo, com limite e hash calculados durante o download.
pub fn stage_stream(mut reader: impl Read, path: &Path, manifest: &Manifest, mut progress: impl FnMut(u64, u64)) -> Result<()> {
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut hash = Sha256::new(); let mut total = 0u64; let mut buf = [0u8; 64 * 1024];
        loop {
            let n = reader.read(&mut buf).map_err(|_| "Download interrompido. Tente novamente.")?;
            if n == 0 { break; }
            total += n as u64;
            if total > manifest.size || total > MAX_PACKAGE { return Err("Tamanho do pacote divergente.".into()); }
            hash.update(&buf[..n]); file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            progress(total, manifest.size);
        }
        if total != manifest.size || hex::encode(hash.finalize()) != manifest.sha256.to_ascii_lowercase() { return Err("Integridade do pacote inválida. Instalação bloqueada.".into()); }
        file.sync_all().map_err(|e| e.to_string())
    })();
    drop(file);
    if result.is_err() { let _ = fs::remove_file(path); }
    result
}
pub fn download(config: &UpdateConfig, release: &VerifiedRelease, path: &Path, progress: impl FnMut(u64, u64)) -> Result<()> {
    download_from(config, release, path, progress, &client()?, &ReleaseSource::github(config))
}
fn download_from(config: &UpdateConfig, release: &VerifiedRelease, path: &Path, progress: impl FnMut(u64, u64), client: &Client, source: &ReleaseSource) -> Result<()> {
    let verified = verify_manifest(config, &release.raw, &release.signature)?;
    let response = client.get(source.asset(&verified.manifest.version, ASSET)).send()
        .and_then(|r| r.error_for_status()).map_err(|_| "Falha de rede durante o download. Tente novamente.")?;
    stage_stream(response, path, &verified.manifest, progress)
}
pub fn verify_package(path: &Path, manifest: &Manifest) -> Result<()> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != manifest.size { return Err("Tamanho do pacote divergente.".into()); }
    let mut hash = Sha256::new(); let mut buf = [0; 64 * 1024];
    loop { let n = file.read(&mut buf).map_err(|e| e.to_string())?; if n == 0 { break; } hash.update(&buf[..n]); }
    if hex::encode(hash.finalize()) != manifest.sha256.to_ascii_lowercase() { return Err("Pacote alterado após o download.".into()); }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallJob {
    pub parent_pid: u32, pub target: PathBuf, pub package: PathBuf,
    pub manifest: String, pub signature: String, pub current_version: String,
    pub endpoint: Option<String>,
}

/// Usa cópia ao lado do destino: renomeações permanecem no mesmo volume.
/// Falha no início do novo processo restaura o executável anterior.
pub fn install(config: &UpdateConfig, job: &InstallJob, mut launch: impl FnMut(&Path) -> Result<()>) -> Result<()> {
    if !job.target.is_absolute() || !job.package.is_absolute() || job.target.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("exe")) != Some(true) {
        return Err("Destino de instalação inválido.".into());
    }
    if !fs::symlink_metadata(&job.target).map_err(|e| e.to_string())?.file_type().is_file() {
        return Err("O destino precisa ser um executável regular existente.".into());
    }
    let release = verify_manifest(config, job.manifest.as_bytes(), &job.signature)?;
    if !newer(&release.manifest.version, &job.current_version)? { return Err("Atualização recusada: versão igual ou anterior.".into()); }
    verify_package(&job.package, &release.manifest)?;
    let parent = job.target.parent().ok_or("Pasta de instalação inválida.")?;
    let nonce = uuid::Uuid::new_v4();
    let staged = parent.join(format!(".sancord-{nonce}.new.exe"));
    let backup = parent.join(format!("Sancord-before-{}-{nonce}.exe", job.current_version));
    let result = (|| {
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&staged).map_err(|e| e.to_string())?;
        let mut input = fs::File::open(&job.package).map_err(|e| e.to_string())?;
        std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?; drop(output);
        verify_package(&staged, &release.manifest)?;
        fs::rename(&job.target, &backup).map_err(|_| "Não foi possível substituir o aplicativo. Feche outras instâncias ou mova-o para uma pasta com permissão de escrita.")?;
        if let Err(error) = fs::rename(&staged, &job.target) {
            fs::rename(&backup, &job.target).map_err(|e| format!("Falha ao restaurar o aplicativo: {e}. Cópia anterior: {}", backup.display()))?;
            return Err(error.to_string());
        }
        if let Err(error) = launch(&job.target) {
            // O contrato de launch: Err significa que nenhum processo foi criado.
            fs::remove_file(&job.target).map_err(|e| e.to_string())?;
            fs::rename(&backup, &job.target).map_err(|e| format!("Falha ao restaurar: {e}. Cópia: {}", backup.display()))?;
            return Err(format!("A versão anterior foi restaurada: {error}"));
        }
        Ok(())
    })();
    if staged.exists() { let _ = fs::remove_file(staged); }
    result
}

#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "updates_https_tests.rs"]
mod https_tests;
