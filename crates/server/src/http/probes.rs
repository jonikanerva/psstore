//! The operational routes beside `/healthz` (liveness): the build identity
//! and readiness. Neither answer contains a secret or a file path, and
//! neither calls an upstream service.

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use super::AppState;

/// The body of `GET /version`.
#[derive(Debug, Serialize)]
struct VersionBody<'a> {
    version: &'a str,
    commit: &'a str,
}

/// `GET /version`: the crate version and the Git commit of the deployment
/// (`unknown` without `RAILWAY_GIT_COMMIT_SHA`).
pub(super) async fn version(State(state): State<AppState>) -> Response {
    axum::Json(VersionBody {
        version: state.build.version,
        commit: &state.build.commit,
    })
    .into_response()
}

/// `GET /readyz`: readiness.
///
/// The server is ready when its configuration is valid and its listener is
/// bound. A request reaches this handler only after both, so the answer is
/// always 200. A Sony or IGDB failure is an upstream error of one request,
/// not a readiness failure, so readiness calls neither service.
pub(super) async fn readiness() -> Response {
    axum::Json(serde_json::json!({ "ready": true })).into_response()
}
