//! Integração de rede: TLS real em loopback e certificados efêmeros só em memória.
//! Não usa GitHub Secrets, chaves de release, dados do usuário ou execução de pacotes.
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use std::{collections::HashMap, net::TcpListener, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, thread};

#[derive(Clone)]
struct Reply { status: u16, body: Vec<u8>, location: Option<String>, length: Option<usize> }
impl Reply {
    fn body(body: impl Into<Vec<u8>>) -> Self { Self { status: 200, body: body.into(), location: None, length: None } }
    fn status(status: u16) -> Self { Self { status, ..Self::body(Vec::new()) } }
}
struct HttpsServer {
    source: ReleaseSource, client: Client, requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>, worker: Option<thread::JoinHandle<()>>,
}
impl HttpsServer {
    fn new(handler: impl Fn(&str, &str) -> Reply + Send + 'static) -> Self {
        let rcgen::CertifiedKey { cert, signing_key } = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions().unwrap().with_no_client_auth()
            .with_single_cert(vec![cert.der().clone()], rustls::pki_types::PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into()).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("https://{}", listener.local_addr().unwrap());
        let source = ReleaseSource { latest: format!("{origin}/latest"), downloads: format!("{origin}/releases/download") };
        let client = Client::builder().https_only(true).no_proxy()
            .connect_timeout(Duration::from_secs(2)).timeout(Duration::from_secs(3))
            .tls_built_in_root_certs(false)
            .add_root_certificate(reqwest::Certificate::from_der(cert.der()).unwrap()).build().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (request_log, stopping) = (requests.clone(), stop.clone());
        let config = Arc::new(config);
        let worker = thread::spawn(move || {
            while !stopping.load(Ordering::Relaxed) {
                let (socket, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => { thread::sleep(Duration::from_millis(5)); continue; }
                    Err(e) => panic!("TLS de teste: {e}"),
                };
                // No Windows, accept herda o modo nao bloqueante do listener.
                socket.set_nonblocking(false).unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                socket.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut tls = rustls::StreamOwned::new(rustls::ServerConnection::new(config.clone()).unwrap(), socket);
                let mut headers = Vec::new();
                // Cliente que recusa o certificado encerra durante o handshake.
                while headers.len() < 16 * 1024 && !headers.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    if tls.read_exact(&mut byte).is_err() { break; }
                    headers.push(byte[0]);
                }
                if !headers.ends_with(b"\r\n\r\n") { continue; }
                let headers = String::from_utf8(headers).unwrap();
                let path = headers.lines().next().unwrap().split_whitespace().nth(1).unwrap();
                request_log.lock().unwrap().push(path.to_string());
                let reply = handler(path, &origin);
                let redirect = reply.location.map(|v| format!("Location: {v}\r\n")).unwrap_or_default();
                let header = format!("HTTP/1.1 {} Test\r\nContent-Length: {}\r\n{redirect}Connection: close\r\n\r\n", reply.status, reply.length.unwrap_or(reply.body.len()));
                if tls.write_all(header.as_bytes()).is_ok() {
                    for chunk in reply.body.chunks(16 * 1024) {
                        if tls.write_all(chunk).is_err() { break; }
                    }
                    tls.conn.send_close_notify();
                    let _ = tls.flush();
                }
            }
        });
        Self { source, client, requests, stop, worker: Some(worker) }
    }
    fn paths(&self) -> Vec<String> { self.requests.lock().unwrap().clone() }
}
impl Drop for HttpsServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() { worker.join().unwrap(); }
    }
}
struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("sancord-https-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap(); Self(path)
    }
    fn package(&self) -> PathBuf { self.0.join("package.exe") }
}
impl Drop for TestDir { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

struct Fixture { config: UpdateConfig, release: VerifiedRelease, package: Vec<u8> }
impl Fixture {
    fn new() -> Self {
        // Material público e exclusivo dos testes; não é a chave de distribuição.
        let signing = SigningKey::from_bytes(&[91; 32]);
        let config = UpdateConfig { repository: "gabrielsanderx/Sancord".into(), public_key: hex::encode(signing.verifying_key().as_bytes()) };
        let package: Vec<u8> = (0..192 * 1024).map(|n| (n % 251) as u8).collect();
        let manifest = Manifest { schema: 1, repository: config.repository.clone(), version: "0.2.0".into(), target: TARGET.into(), asset: ASSET.into(),
            size: package.len() as u64, sha256: hex::encode(Sha256::digest(&package)), notes: "Notas assinadas de teste".into() };
        let raw = serde_json::to_vec(&manifest).unwrap();
        let signature = hex::encode(signing.sign(&raw).to_bytes());
        let release = verify_manifest(&config, &raw, &signature).unwrap();
        Self { config, release, package }
    }
    fn routes(&self) -> HashMap<String, Reply> {
        let version = &self.release.manifest.version;
        let prefix = format!("/releases/download/v{version}");
        HashMap::from([
            ("/latest".into(), Reply::body(serde_json::to_vec(&serde_json::json!({"tag_name":format!("v{version}"),"draft":false,"prerelease":false})).unwrap())),
            (format!("{prefix}/sancord-update.json"), Reply::body(self.release.raw.clone())),
            (format!("{prefix}/sancord-update.sig"), Reply::body(self.release.signature.as_bytes().to_vec())),
            (format!("{prefix}/Sancord.exe"), Reply::body(self.package.clone())),
        ])
    }
}
fn server(routes: HashMap<String, Reply>) -> HttpsServer {
    HttpsServer::new(move |path, _| routes.get(path).cloned().unwrap_or_else(|| Reply::status(404)))
}

#[test]
fn https_detects_signed_release_and_downloads_redirect_with_real_progress() {
    let fixture = Fixture::new();
    let routes = fixture.routes();
    let http = HttpsServer::new(move |path, origin| {
        if path.ends_with("/Sancord.exe") {
            Reply { status: 302, location: Some(format!("{origin}/blob")), ..Reply::body(Vec::new()) }
        } else if path == "/blob" {
            routes["/releases/download/v0.2.0/Sancord.exe"].clone()
        } else { routes.get(path).cloned().unwrap_or_else(|| Reply::status(404)) }
    });
    let release = check_from(&fixture.config, "0.1.0", &http.client, &http.source).unwrap().unwrap();
    assert_eq!(release.manifest.version, "0.2.0");
    assert_eq!(release.manifest.notes, "Notas assinadas de teste");
    let dir = TestDir::new(); let mut progress = Vec::new();
    download_from(&fixture.config, &release, &dir.package(), |n,total| progress.push((n,total)), &http.client, &http.source).unwrap();
    assert_eq!(fs::read(dir.package()).unwrap(), fixture.package);
    assert!(progress.len() > 1);
    assert_eq!(progress.last(), Some(&(release.manifest.size, release.manifest.size)));
    assert!(progress.windows(2).all(|p| p[0].0 < p[1].0 && p[0].1 == p[1].1));
    assert_eq!(http.paths(), ["/latest", "/releases/download/v0.2.0/sancord-update.json", "/releases/download/v0.2.0/sancord-update.sig", "/releases/download/v0.2.0/Sancord.exe", "/blob"]);
}

#[test]
fn https_no_update_never_fetches_assets_for_missing_equal_old_or_experimental_releases() {
    let fixture = Fixture::new();
    let mut replies = vec![Reply::status(404)];
    for (tag, draft, prerelease) in [("v0.1.0",false,false),("v0.0.9",false,false),("v0.2.0",true,false),("v0.2.0-beta.1",false,true)] {
        replies.push(Reply::body(serde_json::to_vec(&serde_json::json!({"tag_name":tag,"draft":draft,"prerelease":prerelease})).unwrap()));
    }
    for reply in replies {
        let http = HttpsServer::new(move |_,_| reply.clone());
        assert!(check_from(&fixture.config, "0.1.0", &http.client, &http.source).unwrap().is_none());
        assert_eq!(http.paths(), ["/latest"]);
    }
}

#[test]
fn https_api_errors_invalid_json_and_oversized_responses_are_errors() {
    let fixture = Fixture::new();
    for reply in [Reply::status(429), Reply::status(500), Reply::body(b"invalid JSON".to_vec()), Reply::body(vec![b' '; 1024 * 1024 + 1])] {
        let http = HttpsServer::new(move |_,_| reply.clone());
        assert!(check_from(&fixture.config, "0.1.0", &http.client, &http.source).is_err());
        assert_eq!(http.paths(), ["/latest"]);
    }
}

#[test]
fn https_rejects_changed_signature_and_version_mismatch_before_download() {
    let fixture = Fixture::new();
    for variant in 0..3 {
        let mut routes = fixture.routes();
        match variant {
            0 => routes.get_mut("/releases/download/v0.2.0/sancord-update.json").unwrap().body.push(b' '),
            1 => routes.get_mut("/releases/download/v0.2.0/sancord-update.sig").unwrap().body = vec![b'0'; 128],
            _ => {
                let mut manifest = fixture.release.manifest.clone(); manifest.version = "0.3.0".into();
                let raw = serde_json::to_vec(&manifest).unwrap();
                let signature = hex::encode(SigningKey::from_bytes(&[91;32]).sign(&raw).to_bytes());
                routes.get_mut("/releases/download/v0.2.0/sancord-update.json").unwrap().body = raw;
                routes.get_mut("/releases/download/v0.2.0/sancord-update.sig").unwrap().body = signature.into_bytes();
            }
        }
        let http = server(routes);
        assert!(check_from(&fixture.config, "0.1.0", &http.client, &http.source).is_err());
        assert_eq!(http.paths().len(), 3);
        assert!(!http.paths().iter().any(|p| p.ends_with(".exe")));
    }
}

#[test]
fn https_failed_downloads_remove_partial_files_and_preserve_existing_files() {
    let fixture = Fixture::new();
    for variant in 0..4 {
        let mut routes = fixture.routes();
        let reply = routes.get_mut("/releases/download/v0.2.0/Sancord.exe").unwrap();
        match variant {
            0 => reply.body[100] ^= 1,
            1 => { reply.length = Some(reply.body.len()); reply.body.truncate(reply.body.len() / 2); }
            2 => reply.body.push(0),
            _ => reply.status = 503,
        }
        let http = server(routes); let dir = TestDir::new();
        assert!(download_from(&fixture.config, &fixture.release, &dir.package(), |_,_| {}, &http.client, &http.source).is_err());
        assert!(!dir.package().exists());
        assert_eq!(http.paths(), ["/releases/download/v0.2.0/Sancord.exe"]);
    }
    let http = server(fixture.routes()); let dir = TestDir::new();
    fs::write(dir.package(), b"preserve-existing").unwrap();
    assert!(download_from(&fixture.config, &fixture.release, &dir.package(), |_,_| {}, &http.client, &http.source).is_err());
    assert_eq!(fs::read(dir.package()).unwrap(), b"preserve-existing");
}

#[test]
fn https_rejects_untrusted_certificate_and_redirect_downgrade() {
    let fixture = Fixture::new(); let http = server(fixture.routes());
    let untrusted = Client::builder().https_only(true).no_proxy().connect_timeout(Duration::from_secs(2)).build().unwrap();
    assert!(check_from(&fixture.config, "0.1.0", &untrusted, &http.source).is_err());
    assert!(http.paths().is_empty());
    let redirect = HttpsServer::new(|_, origin| Reply { status: 302, location: Some(origin.replacen("https:", "http:", 1)), ..Reply::body(Vec::new()) });
    let dir = TestDir::new();
    assert!(download_from(&fixture.config, &fixture.release, &dir.package(), |_,_| {}, &redirect.client, &redirect.source).is_err());
    assert!(!dir.package().exists());
    assert_eq!(redirect.paths().len(), 1);
}

#[test]
fn https_connection_failure_is_reported_and_modified_metadata_makes_no_request() {
    let fixture = Fixture::new(); let http = server(fixture.routes());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("https://{}", listener.local_addr().unwrap()); drop(listener);
    let offline = ReleaseSource { latest: format!("{origin}/latest"), downloads: format!("{origin}/downloads") };
    assert!(check_from(&fixture.config, "0.1.0", &http.client, &offline).is_err());
    let dir = TestDir::new();
    assert!(download_from(&fixture.config, &fixture.release, &dir.package(), |_,_| {}, &http.client, &offline).is_err());
    assert!(!dir.package().exists());
    let mut changed = fixture.release.clone(); changed.raw.push(b' ');
    assert!(download_from(&fixture.config, &changed, &dir.package(), |_,_| {}, &http.client, &http.source).is_err());
    assert!(http.paths().is_empty());
}

#[test]
#[ignore = "Requer artefato real do CI via SANCORD_QA_SIGNED_RELEASE_DIR; nao publica nem executa o cliente"]
fn https_downloads_real_ci_artifact_with_embedded_release_key() {
    let directory = PathBuf::from(std::env::var_os("SANCORD_QA_SIGNED_RELEASE_DIR").expect("Informe a pasta do artefato assinado"));
    let config = UpdateConfig::embedded().unwrap();
    let raw = bounded(fs::File::open(directory.join("sancord-update.json")).unwrap(), 64 * 1024).unwrap();
    let signature = String::from_utf8(bounded(fs::File::open(directory.join("sancord-update.sig")).unwrap(), 256).unwrap()).unwrap();
    let release = verify_manifest(&config, &raw, &signature).unwrap();
    let package_path = directory.join(ASSET);
    verify_package(&package_path, &release.manifest).unwrap();
    let package = bounded(fs::File::open(package_path).unwrap(), release.manifest.size).unwrap();
    let fixture = Fixture { config, release, package };
    let http = server(fixture.routes()); let dir = TestDir::new();
    let release = check_from(&fixture.config, "0.0.0", &http.client, &http.source).unwrap().unwrap();
    let mut progress = Vec::new();
    download_from(&fixture.config, &release, &dir.package(), |done,total| progress.push((done,total)), &http.client, &http.source).unwrap();
    verify_package(&dir.package(), &fixture.release.manifest).unwrap();
    assert_eq!(release.raw, fixture.release.raw);
    assert_eq!(release.signature, fixture.release.signature);
    assert!(progress.len() > 1);
    assert_eq!(progress.last(), Some(&(release.manifest.size, release.manifest.size)));
    assert_eq!(http.paths().len(), 4);
}
