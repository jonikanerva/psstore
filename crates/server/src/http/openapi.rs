//! The OpenAPI 3.1 document of the `/api` routes (`contract/openapi.json`).
//!
//! [`api_routes`] registers every documented route through `utoipa-axum`, so
//! the router that serves `/api` and the document come from one list. The
//! `openapi` binary exports the document of the same function. The export
//! needs no state, no environment, no network, and no client build.
//!
//! The annotations describe the handlers; they do not prove what a handler
//! answers. The route tests (`http/tests.rs`) check each answered status and
//! content type against this document, and the API examples
//! (`docs/contracts/api/`) pin the bodies.
//!
//! The query types below only document the parameters. `params.rs` decodes
//! them, with the JavaScript number rules of the TypeScript server, which
//! accept more spellings than the documented form.

use axum::Router;
use utoipa::openapi::security::{ApiKey, ApiKeyValue, SecurityScheme};
use utoipa::{IntoParams, IntoResponses, Modify, OpenApi, ToSchema};
use utoipa_axum::router::{OpenApiRouter, UtoipaMethodRouterExt};
use utoipa_axum::routes;

use super::errors::{Problem, ProblemCode, problem};
use super::{AppState, games, session};
use crate::domain::browse::BrowseOrder;

/// The name of the security scheme of the sign-in cookie.
pub const NPSSO_COOKIE_SCHEME: &str = "npssoCookie";

#[derive(Debug, OpenApi)]
#[openapi(
    info(
        title = "psstore API",
        description = "The Finnish PS5 store view of psstore. Every failure answers RFC 9457 Problem Details (`application/problem+json`) with a stable `code`."
    ),
    components(schemas(Problem, ProblemCode, BrowseOrder)),
    modifiers(&SignInCookie),
    tags(
        (name = "games", description = "Public PS5 store data"),
        (name = "account", description = "The signed-in user's own Sony data, read-only"),
        (name = "session", description = "The Sony sign-in cookie")
    )
)]
struct ApiDoc;

/// Adds the cookie security scheme of the signed-in routes, and removes the
/// empty licence that the derive takes from the crate manifest: the crate
/// declares no licence.
#[derive(Debug)]
struct SignInCookie;

impl Modify for SignInCookie {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi.info.license = None;
        let components = openapi
            .components
            .get_or_insert_with(utoipa::openapi::Components::new);
        components.add_security_scheme(
            NPSSO_COOKIE_SCHEME,
            SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::with_description(
                "npsso",
                "The HttpOnly sign-in cookie that `POST /api/session` sets. The browser sends it; script never reads or writes it.",
            ))),
        );
    }
}

/// The documented `/api` routes. A known path with another method answers a
/// Problem Details 404 (`not_found`), like an unknown `/api` path.
pub fn api_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(games::new_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::upcoming_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::discounted_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::monthly_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::purchased_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::wishlist_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::search_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::genres).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::browse_games).map(|r| r.fallback(method_not_found)))
        .routes(routes!(games::game_by_id).map(|r| r.fallback(method_not_found)))
        .routes(routes!(session::sign_in, session::sign_out).map(|r| r.fallback(method_not_found)))
}

/// The `/api` router and the document of the same routes.
pub fn api_router() -> (Router<AppState>, utoipa::openapi::OpenApi) {
    api_routes().split_for_parts()
}

/// The OpenAPI document as pretty JSON with a final newline.
///
/// # Errors
///
/// A JSON serialization failure of the document.
pub fn document_json() -> Result<String, serde_json::Error> {
    let mut text = api_routes().into_openapi().to_pretty_json()?;
    text.push('\n');
    Ok(text)
}

/// The answer to another method on a documented path.
async fn method_not_found() -> axum::response::Response {
    problem(ProblemCode::NotFound)
}

// ---- Parameters ---------------------------------------------------------------

/// The page of a list.
#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PageQuery {
    /// The index of the first game. The default is 0.
    #[param(required = false, minimum = 0, maximum = 9_007_199_254_740_991_u64)]
    pub offset: usize,
    /// The number of games on the page: 1 to 120. The default is 60.
    #[param(required = false, minimum = 1, maximum = 120)]
    pub size: usize,
}

/// A search of all PS5 games in the Finnish store.
#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SearchQuery {
    /// The search term. The server trims it; the trimmed term has 1 to 100
    /// UTF-16 code units.
    #[param(min_length = 1, max_length = 100)]
    pub q: String,
    /// The index of the first game. The default is 0.
    #[param(required = false, minimum = 0, maximum = 9_007_199_254_740_991_u64)]
    pub offset: usize,
    /// The number of games on the page: 1 to 50. The default is 50.
    #[param(required = false, minimum = 1, maximum = 50)]
    pub size: usize,
}

/// The PS5 games of one Sony genre in one order.
#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct BrowseQuery {
    /// A Sony genre key from `GET /api/games/genres`. The server does not
    /// trim it.
    #[param(pattern = "^[A-Z0-9_/-]{1,64}$")]
    pub genre: String,
    pub order: BrowseOrder,
    /// The index of the first game. The default is 0.
    #[param(required = false, minimum = 0, maximum = 9_007_199_254_740_991_u64)]
    pub offset: usize,
    /// The number of games on the page: 1 to 120. The default is 60.
    #[param(required = false, minimum = 1, maximum = 120)]
    pub size: usize,
}

/// The game page path.
#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Path)]
pub struct GamePath {
    /// A game id from a card. The server trims it; the trimmed id is not
    /// empty.
    #[param(min_length = 1)]
    pub id: String,
}

/// The body of `POST /api/session`. Other keys are ignored.
#[derive(Debug, ToSchema)]
pub struct SignInRequest {
    /// The NPSSO token of the user's Sony account: 16 to 512 characters from
    /// `A-Za-z0-9._~-`.
    #[schema(min_length = 16, max_length = 512, pattern = "^[A-Za-z0-9._~-]+$")]
    pub npsso: String,
}

// ---- Failure responses ----------------------------------------------------------

/// `invalid_request`.
#[derive(Debug, IntoResponses)]
#[response(
    status = 400,
    description = "Problem `invalid_request`: an invalid query parameter, path segment, or body.",
    content_type = "application/problem+json"
)]
pub struct InvalidRequest(pub Problem);

/// `session_rejected`.
#[derive(Debug, IntoResponses)]
#[response(
    status = 401,
    description = "Problem `session_rejected`: no sign-in cookie, or Sony rejected the NPSSO. A signed-in route also clears the cookie.",
    content_type = "application/problem+json"
)]
pub struct SessionRejected(pub Problem);

/// `game_not_found`.
#[derive(Debug, IntoResponses)]
#[response(
    status = 404,
    description = "Problem `game_not_found`: no PS5 game in the Finnish store has this id.",
    content_type = "application/problem+json"
)]
pub struct GameNotFound(pub Problem);

/// `payload_too_large`.
#[derive(Debug, IntoResponses)]
#[response(
    status = 413,
    description = "Problem `payload_too_large`: the body is larger than the body limit.",
    content_type = "application/problem+json"
)]
pub struct PayloadTooLarge(pub Problem);

/// `unsupported_media_type`.
#[derive(Debug, IntoResponses)]
#[response(
    status = 415,
    description = "Problem `unsupported_media_type`: the body has another media type than JSON.",
    content_type = "application/problem+json"
)]
pub struct UnsupportedMediaType(pub Problem);

/// The upstream failures of a route that calls Sony.
#[derive(Debug, IntoResponses)]
pub enum UpstreamFailure {
    #[response(
        status = 502,
        description = "Problem `upstream_unavailable` or `upstream_query_rotated`: Sony failed, timed out, answered unexpectedly, or no longer knows a persisted query.",
        content_type = "application/problem+json"
    )]
    BadGateway(Problem),
    #[response(
        status = 503,
        description = "Problem `upstream_rate_limited`: Sony limited the request rate. `retryAfterSeconds` gives Sony's delay when Sony sent one.",
        content_type = "application/problem+json"
    )]
    ServiceUnavailable(Problem),
}

/// `internal_error`: every route can answer it.
#[derive(Debug, IntoResponses)]
#[response(
    status = 500,
    description = "Problem `internal_error`: the server failed to handle the request.",
    content_type = "application/problem+json"
)]
pub struct InternalError(pub Problem);
