//! The built single-page client (`web/build`).
//!
//! The rules match the static server of the TypeScript server:
//!
//! - `/assets/…` serves a hashed bundle. An unknown file there is a 404, never
//!   `index.html`, so a stale page never runs the wrong bundle.
//! - Another path serves its file from the build root with
//!   `Cache-Control: no-cache`, so `index.html` never points at deleted
//!   bundles after a deploy.
//! - A deep link gets `index.html` only for a path without a file extension
//!   whose `Accept` header includes `text/html`. Everything else is an empty
//!   404.
//! - Without a build directory every path is a 404.
//! - An `/api` path never reaches the client build. A path that no API route
//!   matches answers a Problem Details 404, whatever the `Accept` header.
//!
//! `ServeDir` rejects path traversal. It sends `Last-Modified` and answers
//! `If-Modified-Since` and range requests; it sends no `ETag`.

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{ACCEPT, CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};

use super::AppState;
use super::errors::{ProblemCode, problem};

/// The path prefix of the hashed bundles.
const ASSETS_PREFIX: &str = "/assets";
/// The path prefix of the API.
const API_PREFIX: &str = "/api";

/// The client build directory.
#[derive(Debug, Clone)]
pub struct StaticSite {
    root: PathBuf,
}

impl StaticSite {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Answers one request for a file of the client build.
    pub async fn respond(&self, request: Request) -> Response {
        if request.method() != Method::GET && request.method() != Method::HEAD {
            return not_found();
        }
        let path = request.uri().path().to_owned();

        if let Some(rest) = assets_path(&path) {
            if rest.is_empty() || rest == "/" {
                return not_found();
            }
            let Some(request) = with_path(request, rest) else {
                return not_found();
            };
            let response = serve(ServeDir::new(self.root.join("assets")), request).await;
            return found(response).map_or_else(not_found, with_charset);
        }

        let accepts_html = request
            .headers()
            .get(ACCEPT)
            .and_then(|value| value.to_str().ok())
            // Media types are case-insensitive (RFC 9110, section 8.3.1).
            .is_some_and(|value| value.to_ascii_lowercase().contains("text/html"));
        let index = self.root.join("index.html");
        let (head, deep_link) = split_for_fallback(request);
        let response = if path == "/" {
            serve(ServeFile::new(&index), deep_link).await
        } else {
            serve(
                ServeDir::new(&self.root).append_index_html_on_directories(false),
                deep_link,
            )
            .await
        };
        if let Some(response) = found(response) {
            return no_cache(with_charset(response));
        }
        if has_extension(&path) || !accepts_html || !index.is_file() {
            return not_found();
        }
        let response = serve(ServeFile::new(&index), head).await;
        found(response).map_or_else(not_found, |r| no_cache(with_charset(r)))
    }
}

/// Any path that no route matches: a Problem Details 404 for an `/api` path,
/// the client build for every other path.
pub(super) async fn serve_fallback(State(state): State<AppState>, request: Request) -> Response {
    if is_api_path(request.uri().path()) {
        return problem(ProblemCode::NotFound);
    }
    state.site.respond(request).await
}

/// True for `/api` and every path under it, at a segment boundary.
fn is_api_path(path: &str) -> bool {
    path.strip_prefix(API_PREFIX)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// The part of the path after `/assets`, or `None` for another path.
fn assets_path(path: &str) -> Option<&str> {
    let rest = path.strip_prefix(ASSETS_PREFIX)?;
    (rest.is_empty() || rest.starts_with('/')).then_some(rest)
}

/// True when the last path segment has an extension, like Node
/// `path.extname`: a dot that is not the first character of the segment.
fn has_extension(path: &str) -> bool {
    let segment = path.rsplit('/').next().unwrap_or_default();
    segment.rfind('.').is_some_and(|dot| dot > 0)
}

/// A copy of the request line for the `index.html` fallback, and the request
/// itself for the file lookup. The fallback needs only the method and the
/// headers.
fn split_for_fallback(request: Request) -> (Request, Request) {
    let mut copy = Request::new(Body::empty());
    *copy.method_mut() = request.method().clone();
    *copy.uri_mut() = Uri::from_static("/index.html");
    *copy.headers_mut() = request.headers().clone();
    (copy, request)
}

/// The request with another path and the same query.
fn with_path(mut request: Request, path: &str) -> Option<Request> {
    let path_and_query = match request.uri().query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_owned(),
    };
    let mut parts = request.uri().clone().into_parts();
    parts.path_and_query = Some(path_and_query.parse().ok()?);
    *request.uri_mut() = Uri::from_parts(parts).ok()?;
    Some(request)
}

async fn serve<S>(service: S, request: Request) -> Response
where
    S: tower::Service<Request, Error = std::convert::Infallible> + Send,
    S::Response: IntoResponse,
    S::Future: Send,
{
    match service.oneshot(request).await {
        Ok(response) => response.into_response(),
        Err(never) => match never {},
    }
}

/// The response when it is not a 404 or a server error.
fn found(response: Response) -> Option<Response> {
    let status = response.status();
    (status != StatusCode::NOT_FOUND && !status.is_server_error()).then_some(response)
}

fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

fn no_cache(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

/// Adds `charset=utf-8` to a text content type, like the TypeScript server.
fn with_charset(mut response: Response) -> Response {
    let Some(value) = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    else {
        return response;
    };
    let is_text = value.starts_with("text/")
        || value.starts_with("application/javascript")
        || value.starts_with("application/json");
    if is_text && !value.contains("charset") {
        let with = format!("{value}; charset=utf-8");
        if let Ok(header) = HeaderValue::from_str(&with) {
            response.headers_mut().insert(CONTENT_TYPE, header);
        }
    }
    response
}

/// The index file of a build root, for startup diagnostics.
#[must_use]
pub fn index_exists(root: &Path) -> bool {
    root.join("index.html").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_a_file_extension_like_node_extname() {
        assert!(has_extension("/favicon.png"));
        assert!(has_extension("/a/b.js"));
        assert!(has_extension("/g/1.5"));
        assert!(!has_extension("/g/123"));
        assert!(!has_extension("/.bashrc"));
        assert!(!has_extension("/"));
    }

    #[test]
    fn detects_the_api_prefix_at_a_segment_boundary() {
        assert!(is_api_path("/api"));
        assert!(is_api_path("/api/"));
        assert!(is_api_path("/api/unknown"));
        assert!(is_api_path("/api/games/a/b"));
        assert!(!is_api_path("/apix"));
        assert!(!is_api_path("/g/api"));
        assert!(!is_api_path("/"));
    }

    #[test]
    fn splits_the_assets_prefix_at_a_segment_boundary() {
        assert_eq!(assets_path("/assets"), Some(""));
        assert_eq!(assets_path("/assets/a.js"), Some("/a.js"));
        assert_eq!(assets_path("/assetsx/a.js"), None);
        assert_eq!(assets_path("/g/1"), None);
    }
}
