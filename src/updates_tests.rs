use super::*;
use ed25519_dalek::{Signer, SigningKey};

fn fixture() -> (UpdateConfig, VerifiedRelease, Vec<u8>) {
    let signing = SigningKey::from_bytes(&[7; 32]); // Chave exclusiva dos testes, nunca usada em releases.
    let cfg = UpdateConfig { repository: "gabrielsanderx/Sancord".into(), public_key: hex::encode(signing.verifying_key().as_bytes()) };
    let bytes = b"MZ-package-fixture-for-tests".to_vec();
    let manifest = Manifest { schema: 1, repository: cfg.repository.clone(), version: "0.2.0".into(), target: TARGET.into(), asset: ASSET.into(), size: bytes.len() as u64, sha256: hex::encode(Sha256::digest(&bytes)), notes: "Correções de voz".into() };
    let raw = serde_json::to_vec(&manifest).unwrap();
    let signature = hex::encode(signing.sign(&raw).to_bytes());
    let verified = verify_manifest(&cfg, &raw, &signature).unwrap();
    (cfg, verified, bytes)
}
fn dir() -> PathBuf { let p = std::env::temp_dir().join(format!("sancord-updater-{}", uuid::Uuid::new_v4())); fs::create_dir_all(&p).unwrap(); p }

#[test]
fn semver_handles_numeric_versions_and_stable_channel() {
    assert!(newer("0.10.0", "0.9.9").unwrap());
    assert!(!newer("0.2.0", "0.2.0").unwrap());
    assert!(!newer("0.1.0", "0.2.0").unwrap());
    assert!(!newer("0.3.0-beta.1", "0.2.0").unwrap());
    assert!(newer("0.2.0", "0.2.0-beta.1").unwrap());
    assert!(newer("invalid", "0.2.0").is_err());
}
#[test]
fn release_detection_ignores_drafts_prereleases_equal_and_older() {
    for (tag, draft, prerelease) in [("v0.3.0",true,false),("v0.3.0-beta.1",false,true),("v0.2.0",false,false),("v0.1.0",false,false)] {
        let raw = serde_json::to_vec(&serde_json::json!({"tag_name":tag,"draft":draft,"prerelease":prerelease})).unwrap();
        assert!(release_version(&raw, "0.2.0").unwrap().is_none());
    }
    assert_eq!(release_version(br#"{"tag_name":"v0.3.0","draft":false,"prerelease":false}"#, "0.2.0").unwrap().as_deref(), Some("0.3.0"));
    assert!(release_version(b"broken JSON", "0.2.0").is_err());
}
#[test]
fn network_client_refuses_plain_http() {
    assert!(client().unwrap().get("http://127.0.0.1:9/").send().is_err());
}
#[test]
fn signature_rejects_tampering_wrong_key_and_unsigned_manifest() {
    let (mut cfg, release, _) = fixture();
    let mut changed = release.raw.clone(); changed.push(b' ');
    assert!(verify_manifest(&cfg, &changed, &release.signature).is_err());
    assert!(verify_manifest(&cfg, &release.raw, "").is_err());
    cfg.public_key = hex::encode(SigningKey::from_bytes(&[8;32]).verifying_key().as_bytes());
    assert!(verify_manifest(&cfg, &release.raw, &release.signature).is_err());
}
#[test]
fn signed_manifest_still_must_match_repository_target_and_size() {
    let (cfg, release, _) = fixture();
    for field in ["repository", "target", "asset", "size", "version"] {
        let mut m = release.manifest.clone();
        match field { "repository" => m.repository = "other/repo".into(), "target" => m.target = "linux".into(), "asset" => m.asset = "../bad.exe".into(), "size" => m.size = MAX_PACKAGE+1, _ => m.version = "0.3.0-beta.1".into() }
        let raw = serde_json::to_vec(&m).unwrap();
        let sig = hex::encode(SigningKey::from_bytes(&[7;32]).sign(&raw).to_bytes());
        assert!(verify_manifest(&cfg, &raw, &sig).is_err(), "{field}");
    }
}
#[test]
fn streamed_download_checks_progress_hash_length_and_truncation() {
    let (_, release, bytes) = fixture(); let dir = dir(); let mut updates = vec![];
    stage_stream(&bytes[..], &dir.join("good.exe"), &release.manifest, |n,total| updates.push((n,total))).unwrap();
    assert_eq!(updates.last(), Some(&(bytes.len() as u64, bytes.len() as u64)));
    for bad in [&bytes[..bytes.len()-1], &b"different-signed-size-payload"[..]] {
        let path = dir.join("bad.exe");
        assert!(stage_stream(bad, &path, &release.manifest, |_,_| {}).is_err());
        assert!(!path.exists());
    }
    assert!(stage_stream(&bytes[..], &dir.join("good.exe"), &release.manifest, |_,_| {}).is_err());
}
#[test]
fn network_read_failure_removes_partial_file() {
    struct Failing;
    impl Read for Failing { fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { Err(std::io::Error::new(std::io::ErrorKind::ConnectionReset,"offline")) } }
    let (_, release, _) = fixture(); let path = dir().join("download.exe");
    assert!(stage_stream(Failing, &path, &release.manifest, |_,_| {}).is_err()); assert!(!path.exists());
}
fn job(dir: &Path, release: &VerifiedRelease, bytes: &[u8]) -> InstallJob {
    let package = dir.join("package.exe"); let target = dir.join("Sancord.exe");
    fs::write(&package, bytes).unwrap(); fs::write(&target, b"old-client").unwrap();
    InstallJob { parent_pid: 0, target, package, manifest: String::from_utf8(release.raw.clone()).unwrap(), signature: release.signature.clone(), current_version: "0.1.0".into(), endpoint: None }
}
#[test]
fn install_reverifies_and_launches_only_verified_package() {
    let (cfg, release, bytes) = fixture(); let dir = dir(); let job = job(&dir, &release, &bytes); let mut launches = 0;
    install(&cfg, &job, |path| { launches+=1; assert_eq!(fs::read(path).unwrap(), bytes); Ok(()) }).unwrap();
    assert_eq!(launches, 1); assert_eq!(fs::read(job.target).unwrap(), bytes);
    assert!(fs::read_dir(dir).unwrap().any(|p| p.unwrap().file_name().to_string_lossy().starts_with("Sancord-before-")));
}
#[test]
fn failed_restart_rolls_back_previous_executable() {
    let (cfg, release, bytes) = fixture(); let dir = dir(); let job = job(&dir, &release, &bytes);
    assert!(install(&cfg, &job, |_| Err("spawn failed".into())).is_err());
    assert_eq!(fs::read(job.target).unwrap(), b"old-client");
}
#[test]
fn modified_download_or_downgrade_never_installs_or_launches() {
    let (cfg, release, bytes) = fixture(); let dir = dir(); let mut job = job(&dir, &release, &bytes);
    job.current_version = "0.2.0".into();
    assert!(install(&cfg, &job, |_| panic!("must not execute")).is_err());
    job.current_version = "0.1.0".into(); fs::write(&job.package, b"tampered").unwrap();
    assert!(install(&cfg, &job, |_| panic!("must not execute")).is_err());
    assert_eq!(fs::read(job.target).unwrap(), b"old-client");
}
#[test]
fn transition_accepts_sanvo_and_sancord_manifests_with_same_ed25519_key() {
    let signing = SigningKey::from_bytes(&[7; 32]);
    let cfg_sancord = UpdateConfig {
        repository: "gabrielsanderx/Sancord".into(),
        public_key: hex::encode(signing.verifying_key().as_bytes()),
    };
    let cfg_sanvo = UpdateConfig {
        repository: "gabrielsanderx/Sanvo".into(),
        public_key: cfg_sancord.public_key.clone(),
    };
    let bytes = b"MZ-sanvo-transition-binary".to_vec();
    let sanvo_manifest = Manifest {
        schema: 1,
        repository: "gabrielsanderx/Sanvo".into(),
        version: "0.2.8".into(),
        target: TARGET.into(),
        asset: SANVO_ASSET.into(),
        size: bytes.len() as u64,
        sha256: hex::encode(Sha256::digest(&bytes)),
        notes: "Sancord agora é Sanvo".into(),
    };
    let raw = serde_json::to_vec(&sanvo_manifest).unwrap();
    let sig = hex::encode(signing.sign(&raw).to_bytes());
    // Ambos os clientes (legado e novo) aceitam o manifesto durante a transição.
    assert!(verify_manifest(&cfg_sancord, &raw, &sig).is_ok());
    assert!(verify_manifest(&cfg_sanvo, &raw, &sig).is_ok());
}
