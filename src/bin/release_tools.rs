//! Ferramenta de manutenção; não é distribuída aos usuários.
use std::{env, fs, io::Write, path::Path};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use ed25519_dalek::{Signer, SigningKey};
use sancord::updates::{self, Manifest, UpdateConfig};
use sha2::{Digest, Sha256};

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut cfg = UpdateConfig::embedded()?;
    match args.first().map(String::as_str) {
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
            let secret = env::var("SANCORD_UPDATE_SIGNING_KEY").map_err(|_| "Secret SANCORD_UPDATE_SIGNING_KEY ausente.")?;
            let seed: [u8;32] = hex::decode(secret.trim()).map_err(|_| "Secret inválido.")?.try_into().map_err(|_| "Secret deve conter 32 bytes em hexadecimal.")?;
            let signing = SigningKey::from_bytes(&seed);
            if hex::encode(signing.verifying_key().as_bytes()) != cfg.public_key { return Err("A chave do secret não corresponde à chave pública do aplicativo.".into()); }
            let dir = Path::new(&args[1]); let bytes = fs::read(dir.join(updates::ASSET)).map_err(|e| e.to_string())?;
            let notes = fs::read_to_string(&args[2]).map_err(|e| e.to_string())?;
            let manifest = Manifest { schema:1, repository:cfg.repository.clone(), version:env!("CARGO_PKG_VERSION").into(), target:updates::TARGET.into(), asset:updates::ASSET.into(), size:bytes.len() as u64, sha256:hex::encode(Sha256::digest(&bytes)), notes };
            let raw = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
            let signature = hex::encode(signing.sign(&raw).to_bytes());
            updates::verify_manifest(&cfg, &raw, &signature)?;
            fs::write(dir.join("sancord-update.json"), raw).map_err(|e| e.to_string())?;
            fs::write(dir.join("sancord-update.sig"), signature).map_err(|e| e.to_string())?;
            println!("Metadados assinados e verificados.");
        }
        Some("verify") if args.len() == 2 => {
            let dir = Path::new(&args[1]);
            let release = updates::verify_manifest(&cfg, &fs::read(dir.join("sancord-update.json")).map_err(|e| e.to_string())?, &fs::read_to_string(dir.join("sancord-update.sig")).map_err(|e| e.to_string())?)?;
            updates::verify_package(&dir.join(updates::ASSET), &release.manifest)?;
            println!("Assinatura e integridade válidas.");
        }
        _ => return Err("Uso: sancord-release check | keygen <arquivo-novo> | validate <vX.Y.Z> | sign <pasta-dist> <notas.md> | verify <pasta-dist>".into()),
    }
    Ok(())
}
fn main() { if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); } }
