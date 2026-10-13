//! The `/api/games` routes.

use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use super::AppState;
use super::errors::ErrorResponse;
use super::params;
use super::session::{expire_cookie_on_rejection, npsso_from_cookie};
use crate::domain::errors::AccountError;
use crate::domain::game::GameDetail;

fn bad_request() -> Response {
    StatusCode::BAD_REQUEST.into_response()
}

fn json<T: Serialize, E: ErrorResponse>(outcome: Result<T, E>) -> Response {
    match outcome {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.into_error_response(),
    }
}

pub(super) async fn new_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Response {
    let Ok(page) = params::pagination(query.as_deref()) else {
        return bad_request();
    };
    json(state.games.new_games(page).await)
}

pub(super) async fn upcoming_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Response {
    let Ok(page) = params::pagination(query.as_deref()) else {
        return bad_request();
    };
    json(state.games.upcoming_games(page).await)
}

pub(super) async fn discounted_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Response {
    let Ok(page) = params::pagination(query.as_deref()) else {
        return bad_request();
    };
    json(state.games.discounted_games(page).await)
}

pub(super) async fn monthly_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Response {
    let Ok(page) = params::pagination(query.as_deref()) else {
        return bad_request();
    };
    json(state.games.monthly_games(page).await)
}

pub(super) async fn search_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Response {
    let Ok((term, page)) = params::search(query.as_deref()) else {
        return bad_request();
    };
    json(state.games.search_games(term, page).await)
}

pub(super) async fn genres(State(state): State<AppState>) -> Response {
    json(state.games.genres().await)
}

pub(super) async fn browse_games(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Response {
    let Ok((genre, order, page)) = params::browse(query.as_deref()) else {
        return bad_request();
    };
    json(state.games.browse_games(genre, order, page).await)
}

/// The game page: the game and its critic score. The score lookup never
/// fails; without a trusted score the key is absent.
pub(super) async fn game_by_id(
    State(state): State<AppState>,
    id: Result<Path<String>, PathRejection>,
) -> Response {
    let Ok(Path(raw)) = id else {
        return bad_request();
    };
    let Ok(id) = params::game_id(&raw) else {
        return bad_request();
    };
    let game = match state.games.game_by_id(id).await {
        Ok(game) => game,
        Err(error) => return error.into_error_response(),
    };
    let critic_score = state.critics.score_for(&game).await;
    Json(GameDetail { game, critic_score }).into_response()
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
        return AccountError::session_rejected("Not signed in").into_error_response();
    };
    let outcome = match list {
        SignedInList::Purchased => state.account.purchased_games(npsso).await,
        SignedInList::Wishlist => state.account.wishlist_games(npsso).await,
    };
    expire_cookie_on_rejection(json(outcome))
}

pub(super) async fn purchased_games(State(state): State<AppState>, headers: HeaderMap) -> Response {
    signed_in(&state, &headers, SignedInList::Purchased).await
}

pub(super) async fn wishlist_games(State(state): State<AppState>, headers: HeaderMap) -> Response {
    signed_in(&state, &headers, SignedInList::Wishlist).await
}
