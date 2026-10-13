//! The HTTP interface: routes, request validation, status mapping, the
//! sign-in cookie, and the built single-page client.
//!
//! The JSON bodies, statuses, and headers match the TypeScript server
//! (`docs/contracts/api/`). Handlers are thin: they validate the input, call
//! one service, and map the typed outcome to a response.

pub mod errors;
mod games;
pub mod params;
mod session;
pub mod static_files;

#[cfg(test)]
mod tests;

use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use axum::Router;
use axum::extract::{MatchedPath, Request};
use axum::http::{StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use futures_util::FutureExt;
use tower::Layer;
use tower::util::MapRequestLayer;

use crate::application::{AccountApi, CriticScores, GamesApi};
use static_files::StaticSite;

/// The services and the client build that the handlers use.
#[derive(Debug, Clone)]
pub struct AppState {
    pub games: Arc<dyn GamesApi>,
    pub critics: Arc<dyn CriticScores>,
    pub account: Arc<dyn AccountApi>,
    pub site: Arc<StaticSite>,
}

/// The service that `main` serves: the router behind trailing-slash
/// trimming. The Effect router of the TypeScript server ignored a trailing
/// slash, so `/api/games/new/` is the NEW list.
pub fn app(state: AppState) -> tower::util::MapRequest<Router, fn(Request) -> Request> {
    let trim: fn(Request) -> Request = trim_trailing_slash;
    MapRequestLayer::new(trim).layer(router(state))
}

/// All routes. A known path with another method answers an empty 404, like
/// the TypeScript server. Every other path goes to the client build.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health).fallback(not_found))
        .route("/api/games/new", get(games::new_games).fallback(not_found))
        .route(
            "/api/games/upcoming",
            get(games::upcoming_games).fallback(not_found),
        )
        .route(
            "/api/games/discounted",
            get(games::discounted_games).fallback(not_found),
        )
        .route(
            "/api/games/monthly",
            get(games::monthly_games).fallback(not_found),
        )
        .route(
            "/api/games/purchased",
            get(games::purchased_games).fallback(not_found),
        )
        .route(
            "/api/games/wishlist",
            get(games::wishlist_games).fallback(not_found),
        )
        .route(
            "/api/games/search",
            get(games::search_games).fallback(not_found),
        )
        .route("/api/games/genres", get(games::genres).fallback(not_found))
        .route(
            "/api/games/browse",
            get(games::browse_games).fallback(not_found),
        )
        .route(
            "/api/games/{id}",
            get(games::game_by_id).fallback(not_found),
        )
        .route(
            "/api/session",
            post(session::sign_in)
                .delete(session::sign_out)
                .fallback(not_found),
        )
        .fallback(static_files::serve_fallback)
        .layer(middleware::from_fn(request_context))
        .with_state(state)
}

/// Removes trailing slashes from the path, except from the root path.
fn trim_trailing_slash(mut request: Request) -> Request {
    let uri = request.uri();
    let path = uri.path();
    if path.len() > 1 && path.ends_with('/') {
        let trimmed = path.trim_end_matches('/');
        let trimmed = if trimmed.is_empty() { "/" } else { trimmed };
        let rebuilt = match uri.query() {
            Some(query) => format!("{trimmed}?{query}"),
            None => trimmed.to_owned(),
        };
        if let Ok(path_and_query) = rebuilt.parse() {
            let mut parts = uri.clone().into_parts();
            parts.path_and_query = Some(path_and_query);
            if let Ok(new_uri) = Uri::from_parts(parts) {
                *request.uri_mut() = new_uri;
            }
        }
    }
    request
}

/// Writes one log line per request and contains a panic in request handling
/// as an empty 500. The line has the route pattern, never the path, the query,
/// a header, or a body: a search term or a game id is user input.
async fn request_context(request: Request, next: Next) -> Response {
    let started = tokio::time::Instant::now();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map_or_else(|| "static".to_owned(), |p| p.as_str().to_owned());
    let method = request.method().as_str().to_owned();

    // The panic payload is dropped unread, because it can contain private
    // data. `AssertUnwindSafe` is acceptable: the handler future is dropped,
    // and the shared state recovers from poisoned locks.
    let response = match AssertUnwindSafe(next.run(request)).catch_unwind().await {
        Ok(response) => response,
        Err(_payload) => {
            tracing::error!(route = route.as_str(), "request handling panicked");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    };
    tracing::info!(
        route = route.as_str(),
        method = method.as_str(),
        status = u64::from(response.status().as_u16()),
        elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        "request completed"
    );
    response
}

/// `GET /healthz`. It calls no upstream service.
async fn health() -> Response {
    axum::Json(serde_json::json!({ "ok": true })).into_response()
}

/// An empty 404.
async fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}
