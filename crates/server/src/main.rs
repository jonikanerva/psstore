//! Process entry point: read the settings, set up logging, and serve.

use std::net::{Ipv4Addr, SocketAddr};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use axum::ServiceExt as _;
use psstore_server::config::Config;
use psstore_server::http::static_files::index_exists;
use psstore_server::sources::sony::contract::SonyContract;
use psstore_server::{http, observability, wiring};

/// The time that active requests get after a stop signal. The longest
/// request is the purchased-games crawl with its 30 s deadline.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(35);

fn main() -> ExitCode {
    if observability::init().is_err() {
        #[allow(clippy::print_stderr, reason = "logging could not be set up")]
        {
            eprintln!("psstore-server: logging could not be set up");
        }
        return ExitCode::FAILURE;
    }
    observability::install_panic_hook();

    let config = Config::from_env();
    let Ok(sony) = SonyContract::load() else {
        tracing::error!(stage = "sony_contract", "the Sony contract file is invalid");
        return ExitCode::FAILURE;
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            tracing::error!("the async runtime could not start");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(run(config, sony)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(stage) => {
            tracing::error!(stage, "service stopped with an error");
            ExitCode::FAILURE
        }
    }
}

async fn run(config: Config, sony: SonyContract) -> Result<(), &'static str> {
    if index_exists(&config.web_build) {
        tracing::info!("client build found");
    } else {
        tracing::warn!("client build missing; every page path answers 404");
    }
    if config.igdb.is_none() {
        tracing::info!("critic score off: IGDB credentials missing");
    }
    let app = http::app(wiring::state(&config, &sony));

    let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, config.port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|_| "bind")?;
    let bound = listener.local_addr().map_err(|_| "bind")?;
    tracing::info!(bind = %bound, "service started");

    // Stop accepting connections on a signal. Give active requests a grace
    // period, then stop.
    let stop = Arc::new(tokio::sync::Notify::new());
    let notify = Arc::clone(&stop);
    let server =
        axum::serve(listener, app.into_make_service()).with_graceful_shutdown(async move {
            shutdown_signal().await;
            tracing::info!("shutdown started");
            notify.notify_one();
        });
    tokio::select! {
        result = server => result.map_err(|_| "serve"),
        () = async {
            stop.notified().await;
            tokio::time::sleep(SHUTDOWN_GRACE).await;
        } => {
            tracing::warn!("shutdown grace period ended with active requests");
            Ok(())
        }
    }
}

async fn shutdown_signal() {
    let interrupt = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {},
        () = terminate => {},
    }
}
