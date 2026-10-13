//! The serve loop with its shutdown policy (STACK.md §9).
//!
//! On a stop signal the server stops accepting connections and lets active
//! requests finish. A grace period bounds that wait: at its end [`serve`]
//! returns, and the caller ends the process, which cuts the requests that are
//! still active.

use std::convert::Infallible;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use axum::ServiceExt as _;
use axum::extract::Request;
use axum::response::Response;
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tower::Service;

/// The grace period of the production server. The longest request is the
/// purchased-games crawl with its 30-second deadline. Railway sends SIGKILL
/// only after its own drain time.
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(35);

/// How the serve loop ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stopped {
    /// Every connection closed within the grace period.
    Drained,
    /// The grace period ended with active requests. The caller must end the
    /// process: the connection tasks of these requests still exist.
    DeadlineReached,
}

/// Serves `app` on `listener` until `shutdown` completes. Then it stops
/// accepting connections, lets active requests finish, and returns when the
/// last connection closes or when `grace` ends, whichever comes first.
///
/// # Errors
///
/// The listener fails.
pub async fn serve<S>(
    listener: TcpListener,
    app: S,
    shutdown: impl Future<Output = ()> + Send + 'static,
    grace: Duration,
) -> std::io::Result<Stopped>
where
    S: Service<Request, Response = Response, Error = Infallible> + Clone + Send + 'static,
    S::Future: Send,
{
    let stop = Arc::new(Notify::new());
    let notify = Arc::clone(&stop);
    let server =
        axum::serve(listener, app.into_make_service()).with_graceful_shutdown(async move {
            shutdown.await;
            tracing::info!("shutdown started");
            notify.notify_one();
        });
    tokio::select! {
        result = server => result.map(|()| Stopped::Drained),
        () = async {
            stop.notified().await;
            tokio::time::sleep(grace).await;
        } => {
            tracing::warn!("shutdown grace period ended with active requests");
            Ok(Stopped::DeadlineReached)
        }
    }
}

/// Completes on SIGINT (Ctrl-C) or SIGTERM.
///
/// A signal handler that cannot be set up logs a warning and never
/// completes. Both signals behave the same way: a failed set-up must not
/// stop a healthy server, and the other signal still works. When no handler
/// works, Railway's SIGKILL after its drain time stops the process.
pub async fn shutdown_signal() {
    let interrupt = async {
        if tokio::signal::ctrl_c().await.is_err() {
            tracing::warn!(
                reason = "sigint_handler",
                "the interrupt handler could not be set up"
            );
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        } else {
            tracing::warn!(
                reason = "sigterm_handler",
                "the terminate handler could not be set up"
            );
            std::future::pending::<()>().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {},
        () = terminate => {},
    }
}
