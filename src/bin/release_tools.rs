//! Ferramenta de manutenção; não é distribuída aos usuários.
use std::{env, fs, io::Write, path::Path};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use ed25519_dalek::{Signer, SigningKey};
use sancord::updates::{self, Manifest, UpdateConfig};
use sha2::{Digest, Sha256};
mod migration_check;

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut cfg = UpdateConfig::embedded()?;
    match args.first().map(String::as_str) {
        Some("check-migration") if args.len() == 2 => migration_check::run(Path::new(&args[1]))?,
        Some("check") if args.len() == 1 => {
            match updates::check(&cfg, env!("CARGO_PKG_VERSION"))? {
                Some(release) => println!("Atualização disponível: {}", release.manifest.version),
                None => println!("Nenhuma atualização estável mais nova disponível."),
            }
        }
        Some("keygen") if args.len() == 2 => {
            let mut bytes = [0;32]; OsRng.fill_bytes(&mut bytes);
            let key = SigningKey::from_bytes(&bytes);
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&args[1]).map_err(|e| e.to_string())?;
            file.write_all(hex::encode(bytes).as_bytes()).map_err(|e| e.to_string())?; file.sync_all().map_err(|e| e.to_string())?;
            cfg.public_key = hex::encode(key.verifying_key().as_bytes());
            fs::write("release-config.json", serde_json::to_vec_pretty(&cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            println!("Chave pública gravada em release-config.json. Chave privada salva no arquivo solicitado; não será exibida.");
        }
        Some("validate") if args.len() == 2 => {
            cfg.validate()?;
            let version = env!("CARGO_PKG_VERSION");
            let parsed = semver::Version::parse(version).map_err(|e| e.to_string())?;
            if args[1] != format!("v{version}") || !parsed.pre.is_empty() || !parsed.build.is_empty() { return Err("Tag e Cargo.toml devem indicar a mesma versão estável.".into()); }
            println!("Configuração e versão válidas.");
        }
        Some("sign") if args.len() == 3 => {
            cfg.validate()?;
            let secret = sancord::legacy_sancord_migration::env_var_compat(
                "SANVO_UPDATE_SIGNING_KEY",
                "SANCORD_UPDATE_SIGNING_KEY",
            )
            .ok_or("Secret SANVO_UPDATE_SIGNING_KEY (ou legado SANCORD_UPDATE_SIGNING_KEY) ausente.")?;
            let seed: [u8;32] = hex::decode(secret.trim()).map_err(|_| "Secret inválido.")?.try_into().map_err(|_| "Secret deve conter 32 bytes em hexadecimal.")?;
            let signing = SigningKey::from_bytes(&seed);
            if hex::encode(signing.verifying_key().as_bytes()) != cfg.public_key { return Err("A chave do secret não corresponde à chave pública do aplicativo.".into()); }
            let dir = Path::new(&args[1]);
            let notes = fs::read_to_string(&args[2]).map_err(|e| e.to_string())?;

            // Assina metadados para Sanvo.exe (sanvo-update.json) e cópia de transição Sancord.exe (sancord-update.json).
            let mut signed_any = false;
            for (asset_name, json_name, sig_name) in [
                (updates::SANVO_ASSET, updates::SANVO_MANIFEST_JSON, updates::SANVO_MANIFEST_SIG),
                (updates::LEGACY_ASSET, updates::LEGACY_MANIFEST_JSON, updates::LEGACY_MANIFEST_SIG),
            ] {
                let asset_path = dir.join(asset_name);
                if !asset_path.is_file() {
                    continue;
                }
                let bytes = fs::read(&asset_path).map_err(|e| e.to_string())?;
                let manifest = Manifest {
                    schema: 1,
                    repository: cfg.repository.clone(),
                    version: env!("CARGO_PKG_VERSION").into(),
                    target: updates::TARGET.into(),
                    asset: asset_name.into(),
                    size: bytes.len() as u64,
                    sha256: hex::encode(Sha256::digest(&bytes)),
                    notes: notes.clone(),
                };
                let raw = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
                let signature = hex::encode(signing.sign(&raw).to_bytes());
                updates::verify_manifest(&cfg, &raw, &signature)?;
                fs::write(dir.join(json_name), raw).map_err(|e| e.to_string())?;
                fs::write(dir.join(sig_name), signature).map_err(|e| e.to_string())?;
                signed_any = true;
            }
            if !signed_any {
                return Err(format!("Nenhum executável ({} ou {}) encontrado em {}.", updates::SANVO_ASSET, updates::LEGACY_ASSET, dir.display()));
            }
            println!("Metadados assinados e verificados.");
        }
        Some("verify") if args.len() == 2 => {
            let dir = Path::new(&args[1]);
            let mut verified_any = false;
            for (asset_name, json_name, sig_name) in [
                (updates::SANVO_ASSET, updates::SANVO_MANIFEST_JSON, updates::SANVO_MANIFEST_SIG),
                (updates::LEGACY_ASSET, updates::LEGACY_MANIFEST_JSON, updates::LEGACY_MANIFEST_SIG),
            ] {
                let json_path = dir.join(json_name);
                if !json_path.is_file() {
                    continue;
                }
                let release = updates::verify_manifest(
                    &cfg,
                    &fs::read(&json_path).map_err(|e| e.to_string())?,
                    &fs::read_to_string(dir.join(sig_name)).map_err(|e| e.to_string())?,
                )?;
                updates::verify_package(&dir.join(asset_name), &release.manifest)?;
                verified_any = true;
            }
            if !verified_any {
                return Err("Nenhum manifesto de atualização encontrado para verificar.".into());
            }
            println!("Assinatura e integridade válidas.");
        }
        _ => return Err("Uso: sancord-release check | check-migration <pasta-qa> | keygen <arquivo-novo> | validate <vX.Y.Z> | sign <pasta-dist> <notas.md> | verify <pasta-dist>".into()),
    }
    Ok(())
}
fn main() { if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); } }
