use sancord::config::Config;
use sancord::state::ServerState;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    let config = Config::from_env();

    // Logs técnicos: console + arquivo diário em `logs/` (separados da interface).
    let _ = std::fs::create_dir_all(&config.log_dir);
    let file_appender = tracing_appender::rolling::daily(&config.log_dir, "sancord.log");
    let (file_writer, _log_guard) = tracing_appender::non_blocking(file_appender);
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_env("SANCORD_LOG")
                .or_else(|_| tracing_subscriber::EnvFilter::try_from_default_env())
                .unwrap_or_else(|_| "sancord=info,tower_http=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::fmt::layer().with_ansi(false).with_writer(file_writer))
        .init();

    let bind = config.bind;
    let data_dir = config.data_dir.clone();
    info!("Dados em {}", config.data_dir.display());

    let shared_state = match ServerState::load(config) {
        Ok(s) => s,
        Err(e) => {
            error!("Não foi possível abrir o banco de dados: {e}");
            std::process::exit(1);
        }
    };
    let db = shared_state.read().await.db.clone();

    // Status personalizado e castigo com prazo: limpa os vencidos a cada 30 s.
    // (O castigo já deixa de valer no horário exato; aqui só avisa os clientes.)
    let expiry_state = shared_state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            tick.tick().await;
            sancord::social::expire_statuses(&expiry_state).await;
            sancord::timeouts::expire(&expiry_state).await;
            sancord::threads::expire(&expiry_state).await;
            sancord::slowmode::prune_shared(&expiry_state).await;
        }
    });

    let schedule_state = shared_state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(2));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            sancord::scheduled::publish_due(&schedule_state, sancord::auth::now_ms()).await;
        }
    });

    let app = sancord::build_router(shared_state);

    let listener = match tokio::net::TcpListener::bind(bind).await {
        Ok(l) => l,
        Err(e) => {
            error!("Falha ao abrir {bind}: {e} (outra instância do Sancord já está rodando?)");
            std::process::exit(1);
        }
    };
    info!("🦀 Servidor Sancord rodando em http://localhost:{}", bind.port());

    // Anuncia (assinada) a URL do túnel Cloudflare para o app desktop dos amigos.
    sancord::discovery::spawn_publisher(data_dir);

    // Sem graceful shutdown do axum: ele esperaria indefinidamente os
    // WebSockets abertos. Ao receber Ctrl+C, paramos de aceitar conexões e
    // descarregamos a fila do banco.
    tokio::select! {
        result = axum::serve(listener, app) => {
            if let Err(e) = result {
                error!("Erro ao executar servidor Axum: {e}");
            }
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Encerrando: gravando dados pendentes...");
        }
    }

    // Garante que toda escrita enfileirada chegue ao disco.
    let _ = tokio::task::spawn_blocking(move || db.shutdown()).await;
    info!("Sancord encerrado.");
}
