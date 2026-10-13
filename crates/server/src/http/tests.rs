//! Route tests with fake services. They pin the statuses, success bodies, and
//! headers of the TypeScript server (`server/src/__tests__/app.test.ts` and
//! `staticServer.test.ts`). Every `/api` failure is a Problem Details body
//! (`errors.rs`), and every answer of a documented route is in the OpenAPI
//! document (`openapi.rs`).

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::header::{ACCEPT, CACHE_CONTROL, CONTENT_TYPE, COOKIE, SET_COOKIE};
use axum::http::{Method, Request, StatusCode};
use axum::response::Response;
use tower::ServiceExt;

use super::errors::{Problem, ProblemCode};
use super::static_files::StaticSite;
use super::{AppState, app, openapi};
use crate::application::{AccountApi, CriticScores, GamesApi, Page, ServiceFuture};
use crate::domain::browse::{BrowseOrder, GenreKey};
use crate::domain::errors::{AccountError, GameLookupError, UpstreamError};
use crate::domain::game::{CriticScore, Game, Genre, GenreList, IdKind, PageResult};
use crate::domain::id::GameId;
use crate::domain::secret::Secret;
use crate::observability::testing::CapturedLogs;

const NPSSO: &str = "synthetic-npsso-0123456789abcdef";

fn game(id: &str) -> Game {
    Game {
        id: id.parse().unwrap(),
        name: "Sample".into(),
        date: "2026-10-14T21:00:00Z".into(),
        url: "https://image.example/cover.png".into(),
        price: "€49,95".into(),
        original_price: String::new(),
        discount_text: String::new(),
        discount_date: String::new(),
        screenshots: vec![],
        videos: vec![],
        genres: vec![],
        description: String::new(),
        studio: String::new(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: None,
        id_kind: IdKind::Product,
    }
}

fn page_of(ids: &[&str]) -> PageResult {
    PageResult {
        games: ids.iter().map(|id| game(id)).collect(),
        total_count: ids.len(),
        next_offset: None,
    }
}

/// A store fake: every list answers `list`, and the last page request is
/// recorded.
struct FakeGames {
    list: Result<PageResult, UpstreamError>,
    detail: Result<Game, GameLookupError>,
    genres: Result<GenreList, UpstreamError>,
    pages: Mutex<Vec<(String, Page)>>,
}

impl FakeGames {
    fn ok() -> Self {
        Self {
            list: Ok(page_of(&["EP0001-PPSA00001_00-SAMPLEGAME000001"])),
            detail: Ok(game("EP0001-PPSA00001_00-SAMPLEGAME000001")),
            genres: Ok(GenreList {
                genres: vec![Genre {
                    key: "ACTION".into(),
                    name: "Action".into(),
                }],
            }),
            pages: Mutex::default(),
        }
    }

    fn record(&self, what: &str, page: Page) {
        self.pages.lock().unwrap().push((what.into(), page));
    }

    fn list(&self, what: &str, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.record(what, page);
        let list = self.list.clone();
        Box::pin(async move { list })
    }
}

impl GamesApi for FakeGames {
    fn new_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list("new", page)
    }
    fn upcoming_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list("upcoming", page)
    }
    fn discounted_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list("discounted", page)
    }
    fn monthly_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list("monthly", page)
    }
    fn search_games(
        &self,
        term: String,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(&format!("search:{term}"), page)
    }
    fn genres(&self) -> ServiceFuture<'_, Result<GenreList, UpstreamError>> {
        let genres = self.genres.clone();
        Box::pin(async move { genres })
    }
    fn browse_games(
        &self,
        genre: GenreKey,
        order: BrowseOrder,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(
            &format!("browse:{}:{}", genre.as_str(), order.as_str()),
            page,
        )
    }
    fn game_by_id(&self, id: GameId) -> ServiceFuture<'_, Result<Game, GameLookupError>> {
        self.record(&format!("id:{}", id.as_str()), Page { offset: 0, size: 0 });
        let detail = self.detail.clone();
        Box::pin(async move { detail })
    }
}

struct FixedScore(Option<CriticScore>);

impl CriticScores for FixedScore {
    fn score_for<'a>(&'a self, _game: &'a Game) -> ServiceFuture<'a, Option<CriticScore>> {
        let score = self.0;
        Box::pin(async move { score })
    }
}

/// An account fake that counts its calls and checks the NPSSO it receives.
struct FakeAccount {
    verify: Result<(), AccountError>,
    lists: Result<PageResult, AccountError>,
    calls: AtomicUsize,
}

impl FakeAccount {
    fn ok() -> Self {
        Self {
            verify: Ok(()),
            lists: Ok(page_of(&["EP0001-PPSA00001_00-SAMPLEGAME000001"])),
            calls: AtomicUsize::new(0),
        }
    }

    fn failing(error: AccountError) -> Self {
        Self {
            verify: Err(error.clone()),
            lists: Err(error),
            calls: AtomicUsize::new(0),
        }
    }

    fn call(&self, npsso: &Secret) {
        assert_eq!(npsso.expose(), NPSSO);
        self.calls.fetch_add(1, Ordering::SeqCst);
    }
}

impl AccountApi for FakeAccount {
    fn verify_npsso(&self, npsso: Secret) -> ServiceFuture<'_, Result<(), AccountError>> {
        self.call(&npsso);
        let outcome = self.verify.clone();
        Box::pin(async move { outcome })
    }
    fn purchased_games(
        &self,
        npsso: Secret,
    ) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        self.call(&npsso);
        let outcome = self.lists.clone();
        Box::pin(async move { outcome })
    }
    fn wishlist_games(&self, npsso: Secret) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        self.call(&npsso);
        let outcome = self.lists.clone();
        Box::pin(async move { outcome })
    }
}

struct Harness {
    games: Arc<FakeGames>,
    account: Arc<FakeAccount>,
    state: AppState,
}

fn harness_with(
    games: FakeGames,
    account: FakeAccount,
    score: Option<CriticScore>,
    site: StaticSite,
) -> Harness {
    let games = Arc::new(games);
    let account = Arc::new(account);
    let games_api: Arc<dyn GamesApi> = games.clone();
    let account_api: Arc<dyn AccountApi> = account.clone();
    let state = AppState {
        games: games_api,
        critics: Arc::new(FixedScore(score)),
        account: account_api,
        site: Arc::new(site),
        build: Arc::default(),
    };
    Harness {
        games,
        account,
        state,
    }
}

fn harness() -> Harness {
    harness_with(
        FakeGames::ok(),
        FakeAccount::ok(),
        None,
        StaticSite::new("/nonexistent/psstore-build"),
    )
}

impl Harness {
    async fn send(&self, request: Request<Body>) -> Response {
        app(self.state.clone()).oneshot(request).await.unwrap()
    }

    async fn get(&self, uri: &str) -> Response {
        self.send(Request::get(uri).body(Body::empty()).unwrap())
            .await
    }

    async fn get_with(&self, uri: &str, name: &str, value: &str) -> Response {
        self.send(
            Request::get(uri)
                .header(name, value)
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    fn account_calls(&self) -> usize {
        self.account.calls.load(Ordering::SeqCst)
    }

    fn last_page(&self) -> (String, Page) {
        self.games.pages.lock().unwrap().last().cloned().unwrap()
    }
}

async fn body(response: Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn set_cookies(response: &Response) -> Vec<String> {
    response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_owned())
        .collect()
}

const EXPIRED: &str = "npsso=; Max-Age=0; Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict";

/// The media type of RFC 9457, written out so that the test does not take it
/// from the code under test.
const PROBLEM_JSON: &str = "application/problem+json";

/// Checks that the response is the Problem Details answer of `code`: its
/// status, the problem media type, and the exact body.
async fn assert_problem(response: Response, code: ProblemCode, context: &str) {
    assert_eq!(response.status(), code.status(), "{context}");
    assert_eq!(response.headers()[CONTENT_TYPE], PROBLEM_JSON, "{context}");
    assert_eq!(
        body(response).await,
        serde_json::to_string(&Problem::new(code)).unwrap(),
        "{context}"
    );
}

// ---- Health and lists -------------------------------------------------------

#[tokio::test]
async fn health_answers_ok() {
    let h = harness();
    let response = h.get("/healthz").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[CONTENT_TYPE], "application/json");
    assert_eq!(body(response).await, r#"{"ok":true}"#);
}

#[tokio::test]
async fn serves_each_list_as_json_with_the_requested_page() {
    let h = harness();
    for (path, what) in [
        ("/api/games/new", "new"),
        ("/api/games/upcoming", "upcoming"),
        ("/api/games/discounted", "discounted"),
        ("/api/games/monthly", "monthly"),
    ] {
        let response = h.get(&format!("{path}?offset=60&size=30")).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(response.headers()[CONTENT_TYPE], "application/json");
        let text = body(response).await;
        assert!(text.starts_with(r#"{"games":[{"id":"EP0001"#), "{text}");
        assert!(
            text.ends_with(r#""totalCount":1,"nextOffset":null}"#),
            "{text}"
        );
        assert_eq!(
            h.last_page(),
            (
                what.into(),
                Page {
                    offset: 60,
                    size: 30
                }
            )
        );
    }
}

#[tokio::test]
async fn rejects_invalid_parameters_with_an_invalid_request_problem() {
    let h = harness();
    for uri in [
        "/api/games/new?size=0",
        "/api/games/new?size=121",
        "/api/games/new?offset=-1",
        "/api/games/new?size=abc",
        "/api/games/new?size=1.5",
        "/api/games/new?size=1&size=2",
        "/api/games/search",
        "/api/games/search?q=%20",
        "/api/games/search?q=a&size=51",
        "/api/games/browse?genre=action&order=newest",
        "/api/games/browse?genre=ACTION&order=bad",
        "/api/games/%20%20",
        // A path segment that is not UTF-8 after percent decoding.
        "/api/games/%FF",
    ] {
        assert_problem(h.get(uri).await, ProblemCode::InvalidRequest, uri).await;
    }
    assert!(h.games.pages.lock().unwrap().is_empty());
}

#[tokio::test]
async fn passes_the_trimmed_search_term_and_the_browse_query() {
    let h = harness();
    assert_eq!(
        h.get("/api/games/search?q=+zelda+").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        h.last_page(),
        (
            "search:zelda".into(),
            Page {
                offset: 0,
                size: 50
            }
        )
    );
    let response = h
        .get("/api/games/browse?genre=MUSIC%2FRHYTHM&order=name-desc&size=10")
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        h.last_page(),
        (
            "browse:MUSIC/RHYTHM:name-desc".into(),
            Page {
                offset: 0,
                size: 10
            }
        )
    );
}

#[tokio::test]
async fn serves_the_genre_list() {
    let h = harness();
    let response = h.get("/api/games/genres").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body(response).await,
        r#"{"genres":[{"key":"ACTION","name":"Action"}]}"#
    );
}

#[tokio::test]
async fn maps_upstream_failures_to_status_and_problem_body() {
    let unavailable = r#"{"type":"about:blank","title":"Bad Gateway","status":502,"detail":"The PlayStation Store is unavailable. Try again later.","code":"upstream_unavailable"}"#;
    let rotated = r#"{"type":"about:blank","title":"Bad Gateway","status":502,"detail":"The PlayStation Store no longer accepts a stored query of this server.","code":"upstream_query_rotated"}"#;
    let limited = r#"{"type":"about:blank","title":"Service Unavailable","status":503,"detail":"The PlayStation Store limited the request rate. Try again later.","code":"upstream_rate_limited"}"#;
    let limited_after = r#"{"type":"about:blank","title":"Service Unavailable","status":503,"detail":"The PlayStation Store limited the request rate. Try again later.","code":"upstream_rate_limited","retryAfterSeconds":3}"#;
    let cases = [
        (
            UpstreamError::unavailable("Upstream unavailable"),
            StatusCode::BAD_GATEWAY,
            unavailable,
        ),
        (
            UpstreamError::QueryRotated {
                message: "rotated".into(),
                operation_name: "categoryGridRetrieve".into(),
            },
            StatusCode::BAD_GATEWAY,
            rotated,
        ),
        (
            UpstreamError::RateLimited {
                message: "limited".into(),
                retry_after_seconds: Some(3),
            },
            StatusCode::SERVICE_UNAVAILABLE,
            limited_after,
        ),
        (
            UpstreamError::RateLimited {
                message: "limited".into(),
                retry_after_seconds: None,
            },
            StatusCode::SERVICE_UNAVAILABLE,
            limited,
        ),
    ];
    for (error, status, expected) in cases {
        let games = FakeGames {
            list: Err(error),
            ..FakeGames::ok()
        };
        let h = harness_with(
            games,
            FakeAccount::ok(),
            None,
            StaticSite::new("/nonexistent"),
        );
        let response = h.get("/api/games/new").await;
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()[CONTENT_TYPE], PROBLEM_JSON);
        assert_eq!(body(response).await, expected);
    }
}

// ---- Game page ----------------------------------------------------------------

#[tokio::test]
async fn serves_the_game_page_with_and_without_a_critic_score() {
    let h = harness();
    let response = h
        .get("/api/games/%20EP0001-PPSA00001_00-SAMPLEGAME000001")
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let text = body(response).await;
    assert!(!text.contains("criticScore"), "{text}");
    assert_eq!(h.last_page().0, "id:EP0001-PPSA00001_00-SAMPLEGAME000001");

    let h = harness_with(
        FakeGames::ok(),
        FakeAccount::ok(),
        CriticScore::new(88),
        StaticSite::new("/x"),
    );
    let text = body(
        h.get("/api/games/EP0001-PPSA00001_00-SAMPLEGAME000001")
            .await,
    )
    .await;
    assert!(
        text.ends_with(r#""idKind":"product","criticScore":88}"#),
        "{text}"
    );
}

#[tokio::test]
async fn maps_a_missing_game_to_a_game_not_found_problem_without_the_id() {
    let games = FakeGames {
        detail: Err(GameLookupError::NotFound {
            id: "EP0000-PPSA00000_00-XXXXXXXXXXXXXXXX".parse().unwrap(),
        }),
        ..FakeGames::ok()
    };
    let h = harness_with(games, FakeAccount::ok(), None, StaticSite::new("/x"));
    let response = h
        .get("/api/games/EP0000-PPSA00000_00-XXXXXXXXXXXXXXXX")
        .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(response.headers()[CONTENT_TYPE], PROBLEM_JSON);
    assert_eq!(
        body(response).await,
        r#"{"type":"about:blank","title":"Not Found","status":404,"detail":"No PS5 game in the Finnish store has this id.","code":"game_not_found"}"#
    );
}

#[tokio::test]
async fn named_routes_are_never_read_as_a_game_id() {
    let h = harness();
    for path in ["/api/games/purchased", "/api/games/wishlist"] {
        assert_eq!(
            h.get(path).await.status(),
            StatusCode::UNAUTHORIZED,
            "{path}"
        );
    }
    assert_eq!(h.get("/api/games/genres").await.status(), StatusCode::OK);
    assert!(h.games.pages.lock().unwrap().is_empty());
}

// ---- Routing details ------------------------------------------------------------

#[tokio::test]
async fn ignores_a_trailing_slash_like_the_effect_router() {
    let h = harness();
    assert_eq!(h.get("/healthz/").await.status(), StatusCode::OK);
    assert_eq!(
        h.get("/api/games/new/?size=5").await.status(),
        StatusCode::OK
    );
    assert_eq!(h.last_page().1, Page { offset: 0, size: 5 });
    let response = h
        .send(
            Request::delete("/api/session/")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    for uri in ["/api/games/", "/api/games/a/b", "/api/", "/api"] {
        assert_problem(h.get(uri).await, ProblemCode::NotFound, uri).await;
    }
}

#[tokio::test]
async fn another_method_on_a_known_api_path_is_a_not_found_problem() {
    let h = harness();
    for (method, uri) in [
        (Method::POST, "/api/games/new"),
        (Method::PUT, "/api/session"),
        (Method::GET, "/api/session"),
        (Method::DELETE, "/api/games/wishlist"),
        (
            Method::PATCH,
            "/api/games/EP0001-PPSA00001_00-SAMPLEGAME000001",
        ),
    ] {
        let response = h
            .send(
                Request::builder()
                    .method(method.clone())
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await;
        assert_problem(response, ProblemCode::NotFound, &format!("{method} {uri}")).await;
    }
    assert!(h.games.pages.lock().unwrap().is_empty());
    assert_eq!(h.account_calls(), 0);
}

#[tokio::test]
async fn another_method_on_the_health_route_stays_an_empty_404() {
    let h = harness();
    let response = h
        .send(Request::post("/healthz").body(Body::empty()).unwrap())
        .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(response.headers().get(CONTENT_TYPE).is_none());
    assert_eq!(body(response).await, "");
}

#[tokio::test]
async fn head_works_on_api_routes() {
    let h = harness();
    let response = h
        .send(
            Request::head("/api/games/genres")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
}

// ---- Sign-in cookie API ---------------------------------------------------------

async fn sign_in(h: &Harness, payload: &str, content_type: Option<&str>) -> Response {
    let mut request = Request::post("/api/session");
    if let Some(content_type) = content_type {
        request = request.header(CONTENT_TYPE, content_type);
    }
    h.send(request.body(Body::from(payload.to_owned())).unwrap())
        .await
}

fn npsso_payload() -> String {
    format!(r#"{{"npsso":"{NPSSO}"}}"#)
}

#[tokio::test]
async fn sign_in_sets_the_exact_cookie_and_answers_an_empty_204() {
    let h = harness();
    let response = sign_in(&h, &npsso_payload(), Some("application/json")).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        set_cookies(&response),
        vec![format!(
            "npsso={NPSSO}; Max-Age=2592000; Path=/api; HttpOnly; Secure; SameSite=Strict"
        )]
    );
    let names: Vec<_> = response
        .headers()
        .keys()
        .map(|k| k.as_str().to_owned())
        .collect();
    assert!(
        names.iter().all(|n| !n.starts_with("access-control")),
        "{names:?}"
    );
    assert_eq!(body(response).await, "");
    assert_eq!(h.account_calls(), 1);
}

#[tokio::test]
async fn sign_in_accepts_json_with_parameters_and_a_missing_content_type() {
    let h = harness();
    for content_type in [
        Some("application/json; charset=utf-8"),
        Some("APPLICATION/JSON"),
        None,
    ] {
        let response = sign_in(&h, &npsso_payload(), content_type).await;
        assert_eq!(
            response.status(),
            StatusCode::NO_CONTENT,
            "{content_type:?}"
        );
    }
}

#[tokio::test]
async fn sign_in_answers_401_or_upstream_status_without_a_cookie() {
    for (error, status) in [
        (
            AccountError::session_rejected("Sony rejected the sign-in"),
            StatusCode::UNAUTHORIZED,
        ),
        (
            AccountError::Upstream(UpstreamError::unavailable("x")),
            StatusCode::BAD_GATEWAY,
        ),
        (
            AccountError::Upstream(UpstreamError::RateLimited {
                message: "x".into(),
                retry_after_seconds: None,
            }),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let h = harness_with(
            FakeGames::ok(),
            FakeAccount::failing(error),
            None,
            StaticSite::new("/x"),
        );
        let response = sign_in(&h, &npsso_payload(), Some("application/json")).await;
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()[CONTENT_TYPE], PROBLEM_JSON);
        let found = set_cookies(&response);
        assert!(found.is_empty(), "{found:?}");
    }
}

#[tokio::test]
async fn sign_in_rejects_a_malformed_payload_before_any_sony_call() {
    let h = harness();
    for payload in [
        "{}".to_owned(),
        r#"{"npsso":"short"}"#.to_owned(),
        format!(r#"{{"npsso":"{}"}}"#, "a".repeat(513)),
        format!(r#"{{"npsso":"{}; Path=/"}}"#, "a".repeat(20)),
        r#"{"npsso":42}"#.to_owned(),
        "not json".to_owned(),
        String::new(),
    ] {
        let response = sign_in(&h, &payload, Some("application/json")).await;
        let found = set_cookies(&response);
        assert!(found.is_empty(), "{found:?}");
        assert_problem(response, ProblemCode::InvalidRequest, &payload).await;
    }
    assert_eq!(h.account_calls(), 0);
}

#[tokio::test]
async fn sign_in_rejects_a_body_over_the_limit_with_413() {
    let h = harness();
    // The default body limit of axum is 2 MiB.
    let payload = format!(r#"{{"npsso":"{NPSSO}","pad":"{}"}}"#, "a".repeat(2 << 20));
    for content_type in [Some("application/json"), Some("text/plain"), None] {
        let response = sign_in(&h, &payload, content_type).await;
        let found = set_cookies(&response);
        assert!(found.is_empty(), "{found:?}");
        assert_problem(
            response,
            ProblemCode::PayloadTooLarge,
            &format!("{content_type:?}"),
        )
        .await;
    }
    assert_eq!(h.account_calls(), 0);
}

#[tokio::test]
async fn sign_in_rejects_a_non_json_content_type_with_415() {
    let h = harness();
    for content_type in [
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
        "text/json",
    ] {
        let response = sign_in(&h, &npsso_payload(), Some(content_type)).await;
        let found = set_cookies(&response);
        assert!(found.is_empty(), "{found:?}");
        // The detail is fixed: the request media type never reaches it.
        assert_problem(response, ProblemCode::UnsupportedMediaType, content_type).await;
    }
    assert_eq!(h.account_calls(), 0);
}

#[tokio::test]
async fn sign_out_expires_the_cookie_with_the_same_attributes() {
    let h = harness();
    let response = h
        .send(Request::delete("/api/session").body(Body::empty()).unwrap())
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(set_cookies(&response), vec![EXPIRED.to_owned()]);
    assert_eq!(h.account_calls(), 0);
}

// ---- Signed-in lists ------------------------------------------------------------

#[tokio::test]
async fn a_signed_in_list_needs_a_usable_cookie() {
    let h = harness();
    for cookie in [
        None,
        Some("npsso="),
        Some("other=1"),
        Some("npsso=; npsso=abc"),
    ] {
        let response = match cookie {
            Some(cookie) => {
                h.get_with("/api/games/purchased", COOKIE.as_str(), cookie)
                    .await
            }
            None => h.get("/api/games/purchased").await,
        };
        assert!(set_cookies(&response).is_empty(), "{cookie:?}");
        assert_problem(
            response,
            ProblemCode::SessionRejected,
            &format!("{cookie:?}"),
        )
        .await;
    }
    assert_eq!(h.account_calls(), 0);
}

#[tokio::test]
async fn serves_both_signed_in_lists() {
    let h = harness();
    let cookie = format!("npsso={NPSSO}");
    for path in ["/api/games/purchased", "/api/games/wishlist"] {
        let response = h.get_with(path, COOKIE.as_str(), &cookie).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let found = set_cookies(&response);
        assert!(found.is_empty(), "{found:?}");
    }
    assert_eq!(h.account_calls(), 2);
}

#[tokio::test]
async fn a_sony_rejection_answers_401_and_expires_the_cookie() {
    let error = AccountError::session_rejected("Sony rejected the sign-in");
    let h = harness_with(
        FakeGames::ok(),
        FakeAccount::failing(error),
        None,
        StaticSite::new("/x"),
    );
    let cookie = format!("npsso={NPSSO}");
    for path in ["/api/games/purchased", "/api/games/wishlist"] {
        let response = h.get_with(path, COOKIE.as_str(), &cookie).await;
        assert_eq!(set_cookies(&response), vec![EXPIRED.to_owned()]);
        assert_problem(response, ProblemCode::SessionRejected, path).await;
    }
}

#[tokio::test]
async fn an_outage_keeps_the_cookie() {
    for (error, status) in [
        (UpstreamError::unavailable("x"), StatusCode::BAD_GATEWAY),
        (
            UpstreamError::QueryRotated {
                message: "x".into(),
                operation_name: "getPurchasedGameList".into(),
            },
            StatusCode::BAD_GATEWAY,
        ),
        (
            UpstreamError::RateLimited {
                message: "x".into(),
                retry_after_seconds: Some(2),
            },
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let h = harness_with(
            FakeGames::ok(),
            FakeAccount::failing(AccountError::Upstream(error)),
            None,
            StaticSite::new("/x"),
        );
        let response = h
            .get_with(
                "/api/games/purchased",
                COOKIE.as_str(),
                &format!("npsso={NPSSO}"),
            )
            .await;
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()[CONTENT_TYPE], PROBLEM_JSON);
        let found = set_cookies(&response);
        assert!(found.is_empty(), "{found:?}");
    }
}

#[tokio::test]
async fn never_logs_the_npsso() {
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        let error = AccountError::session_rejected("Sony rejected the sign-in");
        let h = harness_with(
            FakeGames::ok(),
            FakeAccount::failing(error),
            None,
            StaticSite::new("/x"),
        );
        let cookie = format!("npsso={NPSSO}");
        h.get_with("/api/games/wishlist", COOKIE.as_str(), &cookie)
            .await;
        sign_in(&h, &npsso_payload(), Some("application/json")).await;
    }
    let text = logs.text();
    assert!(!text.is_empty(), "requests are logged");
    assert!(!text.contains(NPSSO), "{text}");
    assert!(!text.contains("dropped_fields"), "{text}");
}

// ---- Static client build ----------------------------------------------------------

/// A temporary build directory with an index, a favicon, one bundle, and a
/// secret file outside the build root.
struct BuildDir {
    base: PathBuf,
}

impl BuildDir {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let base = std::env::temp_dir().join(format!(
            "psstore-static-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let build = base.join("build");
        std::fs::create_dir_all(build.join("assets")).unwrap();
        std::fs::write(base.join("package.json"), r#"{"secret":true}"#).unwrap();
        std::fs::write(
            build.join("index.html"),
            "<!doctype html><title>spa</title>",
        )
        .unwrap();
        std::fs::write(build.join("favicon.png"), "png").unwrap();
        std::fs::write(build.join("assets").join("a-1.js"), "console.log(1)").unwrap();
        std::fs::write(build.join("assets").join("a-1.css"), "body{}").unwrap();
        Self { base }
    }

    fn harness(&self) -> Harness {
        harness_with(
            FakeGames::ok(),
            FakeAccount::ok(),
            None,
            StaticSite::new(self.base.join("build")),
        )
    }
}

impl Drop for BuildDir {
    fn drop(&mut self) {
        // A leftover temporary directory does not fail a test.
        std::fs::remove_dir_all(&self.base).ok();
    }
}

const BROWSER_ACCEPT: &str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

#[tokio::test]
async fn serves_a_hashed_bundle_with_a_text_content_type() {
    let dir = BuildDir::new();
    let h = dir.harness();
    let response = h.get("/assets/a-1.js").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    assert!(response.headers().get(CACHE_CONTROL).is_none());
    let response = h.get("/assets/a-1.css").await;
    assert_eq!(response.headers()[CONTENT_TYPE], "text/css; charset=utf-8");
}

#[tokio::test]
async fn a_missing_asset_and_the_assets_directory_are_404() {
    let dir = BuildDir::new();
    let h = dir.harness();
    for uri in ["/assets/nope.js", "/assets/", "/assets"] {
        assert_eq!(h.get(uri).await.status(), StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(
            h.get_with(uri, ACCEPT.as_str(), BROWSER_ACCEPT)
                .await
                .status(),
            StatusCode::NOT_FOUND,
            "{uri}"
        );
    }
}

#[tokio::test]
async fn serves_the_favicon_and_404s_a_missing_image() {
    let dir = BuildDir::new();
    let h = dir.harness();
    let response = h.get("/favicon.png").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
    assert_eq!(response.headers()[CACHE_CONTROL], "no-cache");
    assert_eq!(h.get("/nope.png").await.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn serves_index_html_at_the_root_with_no_cache() {
    let dir = BuildDir::new();
    let h = dir.harness();
    for response in [
        h.get("/").await,
        h.get_with("/", ACCEPT.as_str(), BROWSER_ACCEPT).await,
    ] {
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "text/html; charset=utf-8");
        assert_eq!(response.headers()[CACHE_CONTROL], "no-cache");
    }
}

#[tokio::test]
async fn a_deep_link_gets_index_html_only_when_accept_includes_text_html() {
    let dir = BuildDir::new();
    let h = dir.harness();
    let page = h.get_with("/g/123", ACCEPT.as_str(), BROWSER_ACCEPT).await;
    assert_eq!(page.status(), StatusCode::OK);
    assert_eq!(page.headers()[CACHE_CONTROL], "no-cache");
    assert!(body(page).await.contains("<title>spa</title>"));
    assert_eq!(
        h.get_with("/g/123", ACCEPT.as_str(), "*/*").await.status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(h.get("/g/123").await.status(), StatusCode::NOT_FOUND);
    // Media types are case-insensitive.
    assert_eq!(
        h.get_with("/g/123", ACCEPT.as_str(), "TEXT/HTML")
            .await
            .status(),
        StatusCode::OK
    );
    // A path with an extension never falls back.
    assert_eq!(
        h.get_with("/foo.js", ACCEPT.as_str(), BROWSER_ACCEPT)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    // An unknown API path never gets the client build, whatever `Accept`.
    for accept in [BROWSER_ACCEPT, "text/html", "*/*", "application/json"] {
        let response = h.get_with("/api/unknown", ACCEPT.as_str(), accept).await;
        assert!(response.headers().get(CACHE_CONTROL).is_none(), "{accept}");
        assert_problem(response, ProblemCode::NotFound, accept).await;
    }
    assert_problem(
        h.get("/api/unknown").await,
        ProblemCode::NotFound,
        "no Accept",
    )
    .await;
    // Only GET and HEAD reach the client build.
    let post = h
        .send(
            Request::post("/g/1")
                .header(ACCEPT, BROWSER_ACCEPT)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(post.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn rejects_path_traversal() {
    let dir = BuildDir::new();
    let h = dir.harness();
    for uri in [
        "/%2e%2e/%2e%2e/package.json",
        "/assets/..%2f..%2findex.html",
        "/assets/..%2f..%2f..%2fpackage.json",
        "/../package.json",
    ] {
        let response = h.get_with(uri, ACCEPT.as_str(), BROWSER_ACCEPT).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{uri}");
        assert!(!body(response).await.contains("secret"), "{uri}");
    }
}

#[tokio::test]
async fn every_path_is_404_without_a_build_directory() {
    let h = harness();
    assert_eq!(
        h.get_with("/", ACCEPT.as_str(), BROWSER_ACCEPT)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        h.get("/assets/a-1.js").await.status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        h.get_with("/g/1", ACCEPT.as_str(), BROWSER_ACCEPT)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn health_and_api_routes_come_before_the_client_build() {
    let dir = BuildDir::new();
    let h = dir.harness();
    let health = h
        .get_with("/healthz", ACCEPT.as_str(), BROWSER_ACCEPT)
        .await;
    assert_eq!(body(health).await, r#"{"ok":true}"#);
    let genres = h
        .get_with("/api/games/genres", ACCEPT.as_str(), BROWSER_ACCEPT)
        .await;
    assert!(body(genres).await.starts_with(r#"{"genres""#));
}

// ---- Request context ---------------------------------------------------------

/// A router with test handlers behind the request context middleware.
fn context_router() -> axum::Router {
    async fn logs_inside() -> &'static str {
        tracing::info!(count = 1_u64, "inside the handler");
        "ok"
    }
    async fn panics() -> &'static str {
        panic!("synthetic handler panic")
    }
    axum::Router::new()
        .route("/log", axum::routing::get(logs_inside))
        .route("/panic", axum::routing::get(panics))
        .layer(axum::middleware::from_fn(super::request_context))
}

async fn send_to_context(uri: &str) -> Response {
    context_router()
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap()
}

/// True for the text form of a random (version 4) UUID.
fn is_uuid_v4(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();
    let lengths: Vec<usize> = groups.iter().map(|g| g.len()).collect();
    lengths == [8, 4, 4, 4, 12]
        && text
            .chars()
            .all(|c| c == '-' || c.is_ascii_digit() || ('a'..='f').contains(&c))
        && groups[2].starts_with('4')
}

#[tokio::test]
async fn every_event_of_a_request_has_its_own_request_id() {
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        assert_eq!(send_to_context("/log").await.status(), StatusCode::OK);
        assert_eq!(send_to_context("/log").await.status(), StatusCode::OK);
    }
    let lines = logs.lines();
    assert_eq!(lines.len(), 4, "{}", logs.text());
    let ids: Vec<&str> = lines
        .iter()
        .map(|line| line["request_id"].as_str().unwrap())
        .collect();
    // Each request writes the handler event and then the completion line,
    // both with the id of that request.
    assert_eq!(ids[0], ids[1]);
    assert_eq!(ids[2], ids[3]);
    assert_ne!(ids[0], ids[2]);
    assert!(ids.iter().all(|id| is_uuid_v4(id)), "{ids:?}");
    for line in &lines {
        assert_eq!(line["route"], "/log");
        assert_eq!(line["method"], "GET");
        assert!(line.get("dropped_fields").is_none(), "{line}");
    }
    assert_eq!(lines[0]["message"], "inside the handler");
    assert_eq!(lines[1]["message"], "request completed");
    assert_eq!(lines[1]["status"], 200);
}

#[tokio::test]
async fn a_handler_panic_is_an_internal_error_problem_logged_with_its_request_id() {
    let logs = CapturedLogs::default();
    let response = {
        let _guard = logs.install();
        send_to_context("/panic").await
    };
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(response.headers()[CONTENT_TYPE], "application/problem+json");
    let text = body(response).await;
    assert!(text.contains(r#""code":"internal_error""#), "{text}");
    assert!(!text.contains("synthetic handler panic"), "{text}");
    let text = logs.text();
    assert!(!text.contains("synthetic handler panic"), "{text}");
    let lines = logs.lines();
    assert_eq!(lines.len(), 2, "{text}");
    assert_eq!(lines[0]["message"], "request handling panicked");
    assert_eq!(lines[1]["status"], 500);
    let id = lines[0]["request_id"].as_str().unwrap();
    assert!(is_uuid_v4(id), "{id}");
    assert_eq!(lines[1]["request_id"], id);
}

#[tokio::test]
async fn the_app_logs_each_request_with_a_request_id() {
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        harness().get("/api/games/new").await;
    }
    let lines = logs.lines();
    assert_eq!(lines.len(), 1, "{}", logs.text());
    assert_eq!(lines[0]["route"], "/api/games/new");
    assert!(is_uuid_v4(lines[0]["request_id"].as_str().unwrap()));
}

// ---- Version and readiness ---------------------------------------------------

#[tokio::test]
async fn version_answers_the_crate_version_and_the_commit() {
    let h = harness();
    let response = h.get("/version").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[CONTENT_TYPE], "application/json");
    let expected = format!(
        r#"{{"version":"{}","commit":"unknown"}}"#,
        env!("CARGO_PKG_VERSION")
    );
    assert_eq!(body(response).await, expected);

    let mut deployed = harness();
    deployed.state.build = Arc::new(crate::config::BuildInfo {
        commit: "0123456789abcdef0123456789abcdef01234567".into(),
        ..crate::config::BuildInfo::default()
    });
    let response = deployed.get("/version").await;
    assert!(
        body(response)
            .await
            .ends_with(r#","commit":"0123456789abcdef0123456789abcdef01234567"}"#)
    );
}

#[tokio::test]
async fn readiness_answers_ready_without_an_upstream_call() {
    let h = harness();
    let response = h.get("/readyz").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[CONTENT_TYPE], "application/json");
    assert_eq!(body(response).await, r#"{"ready":true}"#);
    assert_eq!(h.account_calls(), 0);
    assert!(h.games.pages.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_operational_routes_answer_get_only_and_come_before_the_client_build() {
    let dir = BuildDir::new();
    let h = dir.harness();
    for path in ["/version", "/readyz"] {
        let response = h.get_with(path, ACCEPT.as_str(), BROWSER_ACCEPT).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert!(body(response).await.starts_with('{'), "{path}");
        let post = h
            .send(Request::post(path).body(Body::empty()).unwrap())
            .await;
        assert_eq!(post.status(), StatusCode::NOT_FOUND, "{path}");
        assert_eq!(body(post).await, "", "{path}");
    }
}

// ---- Security headers --------------------------------------------------------

/// Fails unless the response has the four security headers.
fn assert_security_headers(response: &Response, what: &str) {
    let headers = response.headers();
    for (name, value) in [
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "strict-origin-when-cross-origin"),
        ("x-frame-options", "DENY"),
        ("cross-origin-opener-policy", "same-origin"),
    ] {
        assert_eq!(
            headers.get(name).and_then(|v| v.to_str().ok()),
            Some(value),
            "{name} on {what}"
        );
    }
    assert!(
        headers.get("content-security-policy").is_none(),
        "no CSP yet on {what}"
    );
}

#[tokio::test]
async fn every_response_has_the_security_headers() {
    let dir = BuildDir::new();
    let h = dir.harness();
    let cases = [
        ("/healthz", None, StatusCode::OK),
        ("/version", None, StatusCode::OK),
        ("/api/games/new", None, StatusCode::OK),
        ("/api/games/new?offset=x", None, StatusCode::BAD_REQUEST),
        ("/api/games/wishlist", None, StatusCode::UNAUTHORIZED),
        ("/api/unknown", None, StatusCode::NOT_FOUND),
        ("/", Some(BROWSER_ACCEPT), StatusCode::OK),
        ("/g/123", Some(BROWSER_ACCEPT), StatusCode::OK),
        ("/assets/a-1.js", None, StatusCode::OK),
        ("/assets/missing.js", None, StatusCode::NOT_FOUND),
        ("/favicon.png", None, StatusCode::OK),
    ];
    for (uri, accept, status) in cases {
        let response = match accept {
            Some(accept) => h.get_with(uri, ACCEPT.as_str(), accept).await,
            None => h.get(uri).await,
        };
        assert_eq!(response.status(), status, "{uri}");
        assert_security_headers(&response, uri);
    }
    let other_method = h
        .send(Request::post("/healthz").body(Body::empty()).unwrap())
        .await;
    assert_eq!(other_method.status(), StatusCode::NOT_FOUND);
    assert_security_headers(&other_method, "POST /healthz");
    let sign_out = h
        .send(Request::delete("/api/session").body(Body::empty()).unwrap())
        .await;
    assert_security_headers(&sign_out, "DELETE /api/session");

    let panicked = send_to_context("/panic").await;
    assert_eq!(panicked.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_security_headers(&panicked, "a contained panic");
}

// ---- The OpenAPI document ---------------------------------------------------------

/// The documented answers of one operation: each status with the media type
/// of its body, or `None` for an answer without a body.
fn documented(method: &str, template: &str) -> BTreeSet<(u16, Option<String>)> {
    let (_, document) = openapi::api_router();
    let value = serde_json::to_value(&document).unwrap();
    let responses = value["paths"][template][method]["responses"]
        .as_object()
        .unwrap_or_else(|| panic!("{method} {template} is not documented"));
    responses
        .iter()
        .map(|(status, response)| {
            let media = response["content"].as_object().map(|content| {
                assert_eq!(content.len(), 1, "{method} {template} {status}");
                content.keys().next().unwrap().clone()
            });
            (status.parse().unwrap(), media)
        })
        .collect()
}

/// One request against a harness, and the operation that answers it.
struct Probe {
    harness: Harness,
    request: Request<Body>,
    method: &'static str,
    template: &'static str,
}

fn probe(harness: Harness, request: Request<Body>, template: &'static str) -> Probe {
    let method = match *request.method() {
        Method::POST => "post",
        Method::DELETE => "delete",
        _ => "get",
    };
    Probe {
        harness,
        request,
        method,
        template,
    }
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri).body(Body::empty()).unwrap()
}

fn with_cookie(uri: &str) -> Request<Body> {
    Request::get(uri)
        .header(COOKIE, format!("npsso={NPSSO}"))
        .body(Body::empty())
        .unwrap()
}

fn session_post(payload: String, content_type: &str) -> Request<Body> {
    Request::post("/api/session")
        .header(CONTENT_TYPE, content_type)
        .body(Body::from(payload))
        .unwrap()
}

fn games_failing(error: UpstreamError) -> Harness {
    harness_with(
        FakeGames {
            list: Err(error.clone()),
            detail: Err(GameLookupError::Upstream(error.clone())),
            genres: Err(error),
            ..FakeGames::ok()
        },
        FakeAccount::ok(),
        None,
        StaticSite::new("/x"),
    )
}

fn account_failing(error: AccountError) -> Harness {
    harness_with(
        FakeGames::ok(),
        FakeAccount::failing(error),
        None,
        StaticSite::new("/x"),
    )
}

/// The upstream failures that each Sony route can pass on.
fn upstream_failures() -> [UpstreamError; 2] {
    [
        UpstreamError::unavailable("x"),
        UpstreamError::RateLimited {
            message: "x".into(),
            retry_after_seconds: Some(1),
        },
    ]
}

/// The answers of the store routes: success, invalid input, and upstream
/// failures.
fn store_probes() -> Vec<Probe> {
    const ID: &str = "EP0001-PPSA00001_00-SAMPLEGAME000001";
    let game_uri = format!("/api/games/{ID}");
    let mut probes = Vec::new();
    for (uri, template, invalid) in [
        (
            "/api/games/new",
            "/api/games/new",
            Some("/api/games/new?size=0"),
        ),
        (
            "/api/games/upcoming",
            "/api/games/upcoming",
            Some("/api/games/upcoming?size=0"),
        ),
        (
            "/api/games/discounted",
            "/api/games/discounted",
            Some("/api/games/discounted?size=0"),
        ),
        (
            "/api/games/monthly",
            "/api/games/monthly",
            Some("/api/games/monthly?size=0"),
        ),
        (
            "/api/games/search?q=a",
            "/api/games/search",
            Some("/api/games/search"),
        ),
        ("/api/games/genres", "/api/games/genres", None),
        (
            "/api/games/browse?genre=ACTION&order=newest",
            "/api/games/browse",
            Some("/api/games/browse?genre=action&order=newest"),
        ),
        (game_uri.as_str(), "/api/games/{id}", Some("/api/games/%20")),
    ] {
        probes.push(probe(harness(), get(uri), template));
        if let Some(invalid) = invalid {
            probes.push(probe(harness(), get(invalid), template));
        }
        for error in upstream_failures() {
            probes.push(probe(games_failing(error), get(uri), template));
        }
    }
    let missing = harness_with(
        FakeGames {
            detail: Err(GameLookupError::NotFound {
                id: ID.parse().unwrap(),
            }),
            ..FakeGames::ok()
        },
        FakeAccount::ok(),
        None,
        StaticSite::new("/x"),
    );
    probes.push(probe(missing, get(&game_uri), "/api/games/{id}"));
    probes
}

/// The answers of the signed-in lists and the sign-in routes.
fn account_probes() -> Vec<Probe> {
    let mut probes = Vec::new();
    for template in ["/api/games/purchased", "/api/games/wishlist"] {
        probes.push(probe(harness(), with_cookie(template), template));
        probes.push(probe(harness(), get(template), template));
        for error in upstream_failures() {
            probes.push(probe(
                account_failing(AccountError::Upstream(error)),
                with_cookie(template),
                template,
            ));
        }
    }
    let json = "application/json";
    for (harness, request) in [
        (harness(), session_post(npsso_payload(), json)),
        (harness(), session_post("{}".into(), json)),
        (harness(), session_post(npsso_payload(), "text/plain")),
        (harness(), session_post("a".repeat(3 << 20), json)),
        (
            account_failing(AccountError::session_rejected("x")),
            session_post(npsso_payload(), json),
        ),
        (
            harness(),
            Request::delete("/api/session").body(Body::empty()).unwrap(),
        ),
    ] {
        probes.push(probe(harness, request, "/api/session"));
    }
    for error in upstream_failures() {
        probes.push(probe(
            account_failing(AccountError::Upstream(error)),
            session_post(npsso_payload(), json),
            "/api/session",
        ));
    }
    probes
}

/// Each answer of a documented route has a documented status and media type,
/// and each documented answer except the 500 of a contained panic occurs.
#[tokio::test]
async fn every_answer_of_a_documented_route_is_in_the_document() {
    let mut seen = BTreeSet::new();
    for probe in store_probes().into_iter().chain(account_probes()) {
        let response = probe.harness.send(probe.request).await;
        let status = response.status().as_u16();
        let media = response
            .headers()
            .get(CONTENT_TYPE)
            .map(|value| value.to_str().unwrap().to_owned());
        let documented = documented(probe.method, probe.template);
        assert!(
            documented.contains(&(status, media.clone())),
            "{} {} answered {status} {media:?}; documented {documented:?}",
            probe.method,
            probe.template
        );
        seen.insert((probe.method, probe.template, status));
    }
    let (_, document) = openapi::api_router();
    let value = serde_json::to_value(&document).unwrap();
    for (template, item) in value["paths"].as_object().unwrap() {
        for (method, operation) in item.as_object().unwrap() {
            for status in operation["responses"].as_object().unwrap().keys() {
                let status: u16 = status.parse().unwrap();
                if status == 500 {
                    continue;
                }
                assert!(
                    seen.iter()
                        .any(|seen| *seen == (method.as_str(), template.as_str(), status)),
                    "{method} {template} documents {status}, and no probe gets it"
                );
            }
        }
    }
}

#[test]
fn the_document_lists_the_parameter_rules_of_the_server() {
    use super::params::{
        DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SEARCH_MAX_PAGE_SIZE, SEARCH_MAX_TERM_LENGTH,
    };
    let (_, document) = openapi::api_router();
    let value = serde_json::to_value(&document).unwrap();
    let parameter = |template: &str, name: &str| {
        value["paths"][template]["get"]["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["name"] == name)
            .unwrap()
            .clone()
    };
    let size = parameter("/api/games/new", "size");
    assert_eq!(size["schema"]["maximum"], MAX_PAGE_SIZE);
    assert!(
        size["description"]
            .as_str()
            .unwrap()
            .contains(&format!("default is {DEFAULT_PAGE_SIZE}"))
    );
    let search_size = parameter("/api/games/search", "size");
    assert_eq!(search_size["schema"]["maximum"], SEARCH_MAX_PAGE_SIZE);
    assert_eq!(
        parameter("/api/games/search", "q")["schema"]["maxLength"],
        SEARCH_MAX_TERM_LENGTH
    );
    let orders: Vec<&str> = value["components"]["schemas"]["BrowseOrder"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(orders, BrowseOrder::ALL.map(BrowseOrder::as_str));
    let codes: Vec<String> = value["components"]["schemas"]["ProblemCode"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    let expected: Vec<String> = ProblemCode::ALL
        .iter()
        .map(|code| {
            serde_json::to_value(code)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    assert_eq!(codes, expected);
    assert_eq!(
        value["paths"]["/api/games/purchased"]["get"]["security"][0],
        serde_json::json!({ openapi::NPSSO_COOKIE_SCHEME: [] })
    );
}
