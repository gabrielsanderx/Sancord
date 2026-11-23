fn main() {
    println!("cargo:rerun-if-changed=icon.rc");
    println!("cargo:rerun-if-changed=icon.ico");
    let root = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    embed_resource::compile("icon.rc", embed_resource::NONE);
    println!("cargo:rerun-if-env-changed=SANVO_APP_EXE");
    println!("cargo:rerun-if-env-changed=SANCORD_APP_EXE");
    let app = std::env::var_os("SANVO_APP_EXE")
        .or_else(|| std::env::var_os("SANCORD_APP_EXE")) // LEGACY COMPATIBILITY
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| root.join("target/release/SancordApp.exe"));
    println!("cargo:rerun-if-changed={}", app.display());
    println!("cargo:rustc-env=SANCORD_BUNDLE_APP={}", app.display());

    // Chave pública de descoberta embutida no cliente desktop. Ela é criada pelo
    // servidor do host em `data/discovery_public.key` na primeira execução;
    // pode ser sobrescrita com SANVO_DISCOVERY_PUBKEY (ou legado SANCORD_DISCOVERY_PUBKEY).
    println!("cargo:rerun-if-changed=data/discovery_public.key");
    println!("cargo:rerun-if-env-changed=SANVO_DISCOVERY_PUBKEY");
    println!("cargo:rerun-if-env-changed=SANCORD_DISCOVERY_PUBKEY");
    let key = std::env::var("SANVO_DISCOVERY_PUBKEY")
        .ok()
        .or_else(|| std::env::var("SANCORD_DISCOVERY_PUBKEY").ok()) // LEGACY COMPATIBILITY
        .or_else(|| std::fs::read_to_string("data/discovery_public.key").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or_default();
    println!("cargo:rustc-env=SANVO_DISCOVERY_PUBKEY={key}");
    println!("cargo:rustc-env=SANCORD_DISCOVERY_PUBKEY={key}");
}
