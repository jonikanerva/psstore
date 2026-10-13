//! Process entry point: read the settings, set up logging, and serve.

use std::net::{Ipv4Addr, SocketAddr};
use std::process::ExitCode;

use psstore_server::config::Config;
use psstore_server::http::static_files::index_exists;
use psstore_server::lifecycle::{self, SHUTDOWN_GRACE};
use psstore_server::sources::sony::contract::SonyContract;
use psstore_server::{http, observability, wiring};

fn main() -> ExitCode {
    // The settings come first, because they select the log format. Reading
    // them cannot fail; an invalid value falls back to its default and is
    // logged below.
    let config = Config::from_env();
    if observability::init(config.log_format).is_err() {
        #[expect(clippy::print_stderr, reason = "logging could not be set up")]
        {
            eprintln!("psstore-server: logging could not be set up");
        }
        return ExitCode::FAILURE;
    }
    observability::install_panic_hook();
    for setting in &config.invalid {
        tracing::warn!(
            stage = "config",
            reason = setting.tag(),
            "invalid setting ignored; the default applies"
        );
    }

    let Ok(sony) = SonyContract::load() else {
        tracing::error!(stage = "sony_contract", "the Sony contract file is invalid");
        return ExitCode::FAILURE;
    };
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        tracing::error!("the async runtime could not start");
        return ExitCode::FAILURE;
    };
    let outcome = runtime.block_on(run(config, sony));
    // Dropping a runtime waits for its blocking tasks without a limit. After
    // the grace period nothing may keep the process alive, so the runtime
    // ends without that wait.
    runtime.shutdown_background();
    match outcome {
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

    lifecycle::serve(listener, app, lifecycle::shutdown_signal(), SHUTDOWN_GRACE)
        .await
        .map(|_stopped| ())
        .map_err(|_| "serve")
}
