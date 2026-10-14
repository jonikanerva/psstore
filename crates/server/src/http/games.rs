//! The `/api/games` routes.
//!
//! Each handler validates its input, calls one service, and returns the
//! typed outcome. A failure becomes a [`Problem`] through the one mapping in
//! `errors.rs`.

use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, RawQuery, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};

use super::AppState;
use super::errors::Problem;
use super::openapi::{
    BrowseQuery, GameNotFound, GamePath, InternalError, InvalidRequest, PageQuery, SearchQuery,
    SessionRejected, UpstreamFailure,
};
use super::params;
use super::session::{expire_cookie_on_rejection, npsso_from_cookie};
use crate::domain::errors::AccountError;
use crate::domain::game::{GameDetail, GenreList, PageResult};

/// The result of a JSON route.
type JsonResult<T> = Result<Json<T>, Problem>;

/// NEW: PS5 games released up to the next local midnight of any viewer.
#[utoipa::path(
    get,
    path = "/api/games/new",
    operation_id = "listNewGames",
    tag = "games",
    params(PageQuery),
    responses(
        (status = 200, description = "One page of NEW games.", body = PageResult),
        InvalidRequest,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn new_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> JsonResult<PageResult> {
    let page = params::pagination(query.as_deref())?;
    Ok(Json(state.games.new_games(page).await?))
}

/// UPCOMING: announced PS5 games from the current local day of any viewer.
#[utoipa::path(
    get,
    path = "/api/games/upcoming",
    operation_id = "listUpcomingGames",
    tag = "games",
    params(PageQuery),
    responses(
        (status = 200, description = "One page of UPCOMING games.", body = PageResult),
        InvalidRequest,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn upcoming_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> JsonResult<PageResult> {
    let page = params::pagination(query.as_deref())?;
    Ok(Json(state.games.upcoming_games(page).await?))
}

/// DISCOUNTED: PS5 games with a discount.
#[utoipa::path(
    get,
    path = "/api/games/discounted",
    operation_id = "listDiscountedGames",
    tag = "games",
    params(PageQuery),
    responses(
        (status = 200, description = "One page of DISCOUNTED games.", body = PageResult),
        InvalidRequest,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn discounted_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> JsonResult<PageResult> {
    let page = params::pagination(query.as_deref())?;
    Ok(Json(state.games.discounted_games(page).await?))
}

/// MONTHLY: this month's PS Plus games.
#[utoipa::path(
    get,
    path = "/api/games/monthly",
    operation_id = "listMonthlyGames",
    tag = "games",
    params(PageQuery),
    responses(
        (status = 200, description = "One page of MONTHLY games.", body = PageResult),
        InvalidRequest,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn monthly_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> JsonResult<PageResult> {
    let page = params::pagination(query.as_deref())?;
    Ok(Json(state.games.monthly_games(page).await?))
}

/// A search of all PS5 games in the Finnish store.
#[utoipa::path(
    get,
    path = "/api/games/search",
    operation_id = "searchGames",
    tag = "games",
    params(SearchQuery),
    responses(
        (status = 200, description = "One page of search results.", body = PageResult),
        InvalidRequest,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn search_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> JsonResult<PageResult> {
    let (term, page) = params::search(query.as_deref())?;
    Ok(Json(state.games.search_games(term, page).await?))
}

/// The BROWSE genre menu.
#[utoipa::path(
    get,
    path = "/api/games/genres",
    operation_id = "listGenres",
    tag = "games",
    responses(
        (status = 200, description = "The Sony genres with PS5 games.", body = GenreList),
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn genres(State(state): State<AppState>) -> JsonResult<GenreList> {
    Ok(Json(state.games.genres().await?))
}

/// BROWSE: the PS5 games of one Sony genre in one order.
#[utoipa::path(
    get,
    path = "/api/games/browse",
    operation_id = "browseGames",
    tag = "games",
    params(BrowseQuery),
    responses(
        (status = 200, description = "One page of the genre in the order.", body = PageResult),
        InvalidRequest,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn browse_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> JsonResult<PageResult> {
    let (genre, order, page) = params::browse(query.as_deref())?;
    Ok(Json(state.games.browse_games(genre, order, page).await?))
}

/// The game page: the game and its critic score. The score lookup never
/// fails; without a trusted score the key is absent.
#[utoipa::path(
    get,
    path = "/api/games/{id}",
    operation_id = "getGame",
    tag = "games",
    params(GamePath),
    responses(
        (status = 200, description = "The game page.", body = GameDetail),
        InvalidRequest,
        GameNotFound,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn game_by_id(
    State(state): State<AppState>,
    id: Result<Path<String>, PathRejection>,
) -> JsonResult<GameDetail> {
    let Path(raw) = id?;
    let id = params::game_id(&raw)?;
    let game = state.games.game_by_id(id).await?;
    let critic_score = state.critics.score_for(&game).await;
    Ok(Json(GameDetail { game, critic_score }))
}

/// The signed-in lists.
#[derive(Debug, Clone, Copy)]
enum SignedInList {
    Purchased,
    Wishlist,
}

/// A signed-in list. Without a usable cookie the route answers 401 before
/// any Sony call. A definitive Sony rejection answers 401 and clears the
/// cookie; any other failure keeps it.
async fn signed_in(state: &AppState, headers: &HeaderMap, list: SignedInList) -> Response {
    let Some(npsso) = npsso_from_cookie(headers) else {
        return Problem::from(AccountError::session_rejected("Not signed in")).into_response();
    };
    let outcome = match list {
        SignedInList::Purchased => state.account.purchased_games(npsso).await,
        SignedInList::Wishlist => state.account.wishlist_games(npsso).await,
    };
    expire_cookie_on_rejection(outcome.map(Json).map_err(Problem::from).into_response())
}

/// PURCHASED: the PS5 games of the signed-in user's library.
#[utoipa::path(
    get,
    path = "/api/games/purchased",
    operation_id = "listPurchasedGames",
    tag = "account",
    security(("npssoCookie" = [])),
    responses(
        (status = 200, description = "Every PS5 game of the library, on one page.", body = PageResult),
        SessionRejected,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn purchased_games(State(state): State<AppState>, headers: HeaderMap) -> Response {
    signed_in(&state, &headers, SignedInList::Purchased).await
}

/// WISHLIST: the PS5 games of the signed-in user's Sony wishlist.
#[utoipa::path(
    get,
    path = "/api/games/wishlist",
    operation_id = "listWishlistGames",
    tag = "account",
    security(("npssoCookie" = [])),
    responses(
        (status = 200, description = "Every PS5 game of the wishlist, on one page.", body = PageResult),
        SessionRejected,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn wishlist_games(State(state): State<AppState>, headers: HeaderMap) -> Response {
    signed_in(&state, &headers, SignedInList::Wishlist).await
}
