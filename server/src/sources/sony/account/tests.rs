//! Tests of the Sony account client against a local mock server. They port
//! `server/src/__tests__/sonyAccountClient.test.ts` and add challenge cases.
//! All credential values are synthetic (STACK.md §14 → Fixtures).
//!
//! The tests run in real time with short deadlines: a paused clock can fire a
//! timer before a local socket answer arrives.

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, COOKIE};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::*;
use crate::domain::game::IdKind;

const NPSSO: &str = "synthetic-npsso-0123456789abcdef";
const CODE: &str = "v3.synthetic-code";
const TOKEN: &str = "synthetic-access-token-qrstuvwxyz";
const REDIRECT: &str = "com.scee.psxandroid.scecompcall://redirect";

// ---------------------------------------------------------------------------
// The mock server.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Reply {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: String,
    delay: Duration,
}

fn reply(status: u16) -> Reply {
    Reply {
        status,
        headers: vec![],
        body: String::new(),
        delay: Duration::ZERO,
    }
}

fn json_reply(body: &Value) -> Reply {
    Reply {
        headers: vec![("content-type", "application/json".into())],
        body: body.to_string(),
        ..reply(200)
    }
}

fn redirect(location: Option<&str>) -> Reply {
    let mut answer = reply(302);
    if let Some(location) = location {
        answer.headers.push(("location", location.to_owned()));
    }
    answer
}

fn code_redirect() -> Reply {
    redirect(Some(&format!("{REDIRECT}/?code={CODE}")))
}

fn token_reply() -> Reply {
    json_reply(&json!({
        "access_token": TOKEN,
        "refresh_token": "synthetic-refresh",
        "id_token": "synthetic-id",
        "expires_in": 3599,
    }))
}

/// One request that the mock server received.
#[derive(Debug, Clone)]
struct Recorded {
    method: Method,
    path: String,
    query: String,
    headers: HeaderMap,
    body: String,
}

impl Recorded {
    fn query_pairs(&self) -> Vec<(String, String)> {
        form_urlencoded::parse(self.query.as_bytes())
            .into_owned()
            .collect()
    }

    fn query_param(&self, name: &str) -> Option<String> {
        self.query_pairs()
            .into_iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
    }

    fn header(&self, name: impl axum::http::header::AsHeaderName) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }

    /// The `start` variable of a library page request.
    fn start(&self) -> Option<u64> {
        let variables: Value = serde_json::from_str(&self.query_param("variables")?).ok()?;
        variables["start"].as_u64()
    }
}

#[derive(Clone, Default)]
struct Mock {
    replies: Arc<Mutex<VecDeque<Reply>>>,
    /// The answer after the queue is empty.
    repeat: Arc<Mutex<Option<Reply>>>,
    recorded: Arc<Mutex<Vec<Recorded>>>,
}

impl Mock {
    fn requests(&self) -> Vec<Recorded> {
        self.recorded.lock().unwrap().clone()
    }

    fn calls(&self) -> usize {
        self.recorded.lock().unwrap().len()
    }
}

async fn handle(mock: Mock, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let body = to_bytes(body, 1 << 20).await.unwrap();
    mock.recorded.lock().unwrap().push(Recorded {
        method: parts.method.clone(),
        path: parts.uri.path().to_owned(),
        query: parts.uri.query().unwrap_or_default().to_owned(),
        headers: parts.headers.clone(),
        body: String::from_utf8(body.to_vec()).unwrap(),
    });
    let next = mock.replies.lock().unwrap().pop_front();
    let Some(next) = next.or_else(|| mock.repeat.lock().unwrap().clone()) else {
        return StatusCode::IM_A_TEAPOT.into_response();
    };
    tokio::time::sleep(next.delay).await;
    let mut response = (StatusCode::from_u16(next.status).unwrap(), next.body).into_response();
    for (name, value) in next.headers {
        response.headers_mut().append(name, value.parse().unwrap());
    }
    response
}

async fn serve(replies: Vec<Reply>, repeat: Option<Reply>) -> (SocketAddr, Mock) {
    let mock = Mock {
        replies: Arc::new(Mutex::new(replies.into())),
        repeat: Arc::new(Mutex::new(repeat)),
        recorded: Arc::default(),
    };
    let state = mock.clone();
    let app = Router::new().fallback(move |request: Request| handle(state.clone(), request));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, mock)
}

fn timing() -> AccountTiming {
    AccountTiming {
        call_timeout: Duration::from_secs(2),
        retry_after_max: Duration::from_secs(6),
        exchange_deadline: Duration::from_secs(5),
        purchased_deadline: Duration::from_secs(5),
        wishlist_deadline: Duration::from_secs(5),
    }
}

fn contract() -> SonyContract {
    SonyContract::load().unwrap()
}

fn client_with(addr: SocketAddr, timing: AccountTiming) -> SonyAccountClient {
    let mut contract = contract();
    contract.graphql_url = format!("http://{addr}/graphql");
    contract.auth_base_url = format!("http://{addr}/oauth");
    SonyAccountClient::new(contract, timing, false).unwrap()
}

async fn mock_client(replies: Vec<Reply>) -> (SonyAccountClient, Mock) {
    let (addr, mock) = serve(replies, None).await;
    (client_with(addr, timing()), mock)
}

async fn exchange(client: &SonyAccountClient) -> Result<Secret, AccountError> {
    client.exchange_npsso(Secret::new(NPSSO)).await
}

async fn library(client: &SonyAccountClient) -> Result<Vec<PurchasedEntry>, AccountError> {
    client.purchased_games(Secret::new(TOKEN)).await
}

async fn wishlist(client: &SonyAccountClient) -> Result<Vec<WishlistEntry>, AccountError> {
    client.wishlist_games(Secret::new(TOKEN)).await
}

fn tag<T>(outcome: &Result<T, AccountError>) -> &'static str {
    match outcome {
        Ok(_) => "ok",
        Err(error) => error.tag(),
    }
}

fn message<T>(outcome: &Result<T, AccountError>) -> String {
    match outcome {
        Err(AccountError::SessionRejected { message })
        | Err(AccountError::Upstream(UpstreamError::Unavailable { message }))
        | Err(AccountError::Upstream(UpstreamError::QueryRotated { message, .. }))
        | Err(AccountError::Upstream(UpstreamError::RateLimited { message, .. })) => {
            message.clone()
        }
        Ok(_) => "ok".into(),
    }
}

fn game_row(index: usize) -> Value {
    json!({
        "conceptId": index.to_string(),
        "name": format!("Synthetic {index}"),
        "platform": "PS5",
        "productId": format!("EP0001-PPSA{index:05}_00-SYNTHETIC{index:07}"),
        "image": {"url": "https://img.test/x.png"},
    })
}

fn library_page(from: usize, count: usize) -> Reply {
    let games: Vec<Value> = (from..from + count).map(game_row).collect();
    json_reply(&json!({"data": {"purchasedTitlesRetrieve": {"games": games}}}))
}

fn wishlist_body(list: &Value) -> Reply {
    json_reply(&json!({"data": {"storeWishlistSecure": list}}))
}

fn wish_row(id: &str, platforms: &[&str]) -> Value {
    json!({
        "__typename": "Concept",
        "id": id,
        "name": format!("Synthetic {id}"),
        "platforms": platforms,
        "boxArt": {"url": "https://img.test/x.png"},
    })
}

// ---------------------------------------------------------------------------
// The NPSSO exchange.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn exchange_sends_the_cookie_once_and_returns_the_token() {
    let mut authorize = code_redirect();
    // Sony's own cookie must never be read back or forwarded.
    authorize
        .headers
        .push(("set-cookie", "sony-session=synthetic-sony-cookie".into()));
    let (client, mock) = mock_client(vec![authorize, token_reply()]).await;

    let token = exchange(&client).await.unwrap();
    assert_eq!(token.expose(), TOKEN);

    let requests = mock.requests();
    assert_eq!(requests.len(), 2);
    let contract = contract();
    let authorize = &requests[0];
    assert_eq!(authorize.method, Method::GET);
    assert_eq!(authorize.path, "/oauth/authorize");
    assert_eq!(
        authorize.query_pairs(),
        [
            ("access_type".to_owned(), "offline".to_owned()),
            ("client_id".to_owned(), contract.auth_client_id.clone()),
            (
                "redirect_uri".to_owned(),
                contract.auth_redirect_uri.clone()
            ),
            ("response_type".to_owned(), "code".to_owned()),
            ("scope".to_owned(), contract.auth_scope.clone()),
        ]
    );
    let cookies: Vec<_> = authorize.headers.get_all(COOKIE).iter().collect();
    assert_eq!(cookies, [format!("npsso={NPSSO}").as_str()]);
    assert!(authorize.header(AUTHORIZATION).is_none());

    let token_call = &requests[1];
    assert_eq!(token_call.method, Method::POST);
    assert_eq!(token_call.path, "/oauth/token");
    assert_eq!(token_call.query, "");
    assert_eq!(
        token_call.header(CONTENT_TYPE),
        Some("application/x-www-form-urlencoded")
    );
    assert_eq!(
        token_call.header(AUTHORIZATION),
        Some(contract.auth_basic_header.as_str())
    );
    assert!(
        token_call.header(COOKIE).is_none(),
        "no cookie is forwarded"
    );
    let form: Vec<(String, String)> = form_urlencoded::parse(token_call.body.as_bytes())
        .into_owned()
        .collect();
    assert_eq!(
        form,
        [
            ("code".to_owned(), CODE.to_owned()),
            (
                "redirect_uri".to_owned(),
                contract.auth_redirect_uri.clone()
            ),
            ("grant_type".to_owned(), "authorization_code".to_owned()),
            ("token_format".to_owned(), "jwt".to_owned()),
        ]
    );
    for request in &requests {
        assert!(!request.query.contains(NPSSO), "the NPSSO is in no URL");
        assert!(!request.body.contains(NPSSO), "the NPSSO is in no body");
    }
}

#[tokio::test]
async fn a_redirect_without_a_code_is_a_rejection() {
    for location in [
        Some("https://login.example.test/signin".to_owned()),
        Some(format!("https://login.example.test/?code={CODE}")),
        Some(format!("{REDIRECT}/?error=x")),
        Some(format!("{REDIRECT}/?code=")),
        None,
    ] {
        let (client, mock) = mock_client(vec![redirect(location.as_deref())]).await;
        let outcome = exchange(&client).await;
        assert_eq!(tag(&outcome), "SessionRejected", "{location:?}");
        assert_eq!(message(&outcome), "Sony rejected the sign-in");
        assert_eq!(mock.calls(), 1, "no token call after a rejection");
    }
}

#[tokio::test]
async fn an_authorize_answer_other_than_302_is_unexpected() {
    for status in [200, 301, 303, 307, 308] {
        let mut answer = reply(status);
        answer
            .headers
            .push(("location", format!("{REDIRECT}/?code={CODE}")));
        let (client, mock) = mock_client(vec![answer]).await;
        let outcome = exchange(&client).await;
        assert_eq!(tag(&outcome), "UpstreamUnavailable", "{status}");
        assert_eq!(message(&outcome), "Sony sign-in answered unexpectedly");
        assert_eq!(mock.calls(), 1, "the client follows no redirect");
    }
}

#[tokio::test]
async fn a_token_answer_without_a_usable_token_is_an_outage() {
    let cases = [
        (
            json_reply(&json!({"error": "x"})),
            "Sony sign-in answered unexpectedly",
        ),
        (
            json_reply(&json!({"access_token": TOKEN, "expires_in": "3599"})),
            "Sony sign-in answered unexpectedly",
        ),
        (
            json_reply(&json!([TOKEN])),
            "Sony sign-in answered unexpectedly",
        ),
        (
            Reply {
                body: "<html>".into(),
                ..reply(200)
            },
            "Sony sign-in unavailable",
        ),
    ];
    for (answer, expected) in cases {
        let (client, mock) = mock_client(vec![code_redirect(), answer.clone()]).await;
        let outcome = exchange(&client).await;
        assert_eq!(tag(&outcome), "UpstreamUnavailable", "{answer:?}");
        assert_eq!(message(&outcome), expected, "{answer:?}");
        assert_eq!(mock.calls(), 2);
    }
}

#[tokio::test]
async fn the_exchange_has_a_deadline() {
    let slow = Reply {
        delay: Duration::from_millis(500),
        ..code_redirect()
    };
    let (addr, mock) = serve(vec![slow, token_reply()], None).await;
    let client = client_with(
        addr,
        AccountTiming {
            exchange_deadline: Duration::from_millis(100),
            ..timing()
        },
    );
    let outcome = exchange(&client).await;
    assert_eq!(message(&outcome), "Sony sign-in timed out");
    assert_eq!(tag(&outcome), "UpstreamUnavailable");
    assert_eq!(mock.calls(), 1);
}

// ---------------------------------------------------------------------------
// The status mapping of every call. Only a definitive rejection is 401.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
enum Step {
    Authorize,
    Token,
    Purchased,
    Wishlist,
}

#[tokio::test]
async fn maps_each_status_of_each_call_without_a_retry() {
    use Step::{Authorize, Purchased, Token, Wishlist};
    let rows: &[(Step, u16, &str)] = &[
        // Only the authorize redirect proves a rejection, never a 4xx.
        (Authorize, 400, "UpstreamUnavailable"),
        (Authorize, 401, "UpstreamUnavailable"),
        (Authorize, 403, "UpstreamUnavailable"),
        (Authorize, 404, "UpstreamUnavailable"),
        (Authorize, 429, "UpstreamRateLimited"),
        (Authorize, 500, "UpstreamUnavailable"),
        (Authorize, 503, "UpstreamUnavailable"),
        (Token, 400, "UpstreamUnavailable"),
        (Token, 401, "SessionRejected"),
        (Token, 403, "SessionRejected"),
        (Token, 404, "UpstreamUnavailable"),
        (Token, 429, "UpstreamRateLimited"),
        (Token, 500, "UpstreamUnavailable"),
        (Token, 302, "UpstreamUnavailable"),
        (Purchased, 400, "UpstreamUnavailable"),
        (Purchased, 401, "SessionRejected"),
        (Purchased, 403, "SessionRejected"),
        (Purchased, 404, "UpstreamUnavailable"),
        (Purchased, 429, "UpstreamRateLimited"),
        (Purchased, 500, "UpstreamUnavailable"),
        (Purchased, 502, "UpstreamUnavailable"),
        (Purchased, 302, "UpstreamUnavailable"),
        (Wishlist, 400, "UpstreamQueryRotated"),
        (Wishlist, 401, "SessionRejected"),
        (Wishlist, 403, "SessionRejected"),
        (Wishlist, 404, "UpstreamUnavailable"),
        (Wishlist, 429, "UpstreamRateLimited"),
        (Wishlist, 500, "UpstreamUnavailable"),
        (Wishlist, 502, "UpstreamUnavailable"),
        (Wishlist, 302, "UpstreamUnavailable"),
    ];
    for &(step, status, expected) in rows {
        let failing = reply(status);
        let (replies, calls) = match step {
            Authorize => (vec![failing], 1),
            Token => (vec![code_redirect(), failing], 2),
            Purchased | Wishlist => (vec![failing], 1),
        };
        let (client, mock) = mock_client(replies).await;
        let actual = match step {
            Authorize | Token => tag(&exchange(&client).await),
            Purchased => tag(&library(&client).await),
            Wishlist => tag(&wishlist(&client).await),
        };
        assert_eq!(actual, expected, "{step:?} {status}");
        assert_eq!(mock.calls(), calls, "{step:?} {status}: no retry");
    }
}

#[tokio::test]
async fn a_rate_limit_reports_the_clamped_retry_after_in_whole_seconds() {
    let limited = |value: Option<&str>| {
        let mut answer = reply(429);
        if let Some(value) = value {
            answer.headers.push(("retry-after", value.to_owned()));
        }
        answer
    };
    for (header, expected) in [(Some("2"), Some(2)), (Some("600"), Some(6)), (None, None)] {
        let (client, _) = mock_client(vec![limited(header)]).await;
        let outcome = library(&client).await;
        assert_eq!(
            outcome.unwrap_err(),
            AccountError::Upstream(UpstreamError::RateLimited {
                message: "Sony sign-in rate limited the request (HTTP 429)".into(),
                retry_after_seconds: expected,
            }),
            "{header:?}"
        );
    }
}

#[tokio::test]
async fn errors_carry_no_code_npsso_token_location_or_list_data() {
    let foreign = format!("https://login.example.test/?code={CODE}");
    let mut outcomes = vec![];
    let (client, _) = mock_client(vec![redirect(Some(&foreign))]).await;
    outcomes.push(exchange(&client).await.map(|_| ()));
    let (client, _) = mock_client(vec![code_redirect(), reply(401)]).await;
    outcomes.push(exchange(&client).await.map(|_| ()));
    let (client, _) = mock_client(vec![code_redirect(), json_reply(&json!({"x": CODE}))]).await;
    outcomes.push(exchange(&client).await.map(|_| ()));
    let (client, _) =
        mock_client(vec![wishlist_body(&json!({"unexpected": "Synthetic 77"}))]).await;
    outcomes.push(wishlist(&client).await.map(|_| ()));
    let (client, _) = mock_client(vec![library_page(0, PURCHASED_PAGE_SIZE), reply(500)]).await;
    outcomes.push(library(&client).await.map(|_| ()));
    for outcome in outcomes {
        let error = outcome.unwrap_err();
        let debug = format!("{error:?}");
        let body = response_body(error.into_response()).await;
        for text in [debug, body] {
            for secret in [CODE, NPSSO, TOKEN, "login.example.test", "Synthetic 77"] {
                assert!(!text.contains(secret), "{text} contains {secret}");
            }
        }
    }
}

async fn response_body(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 1 << 16).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[tokio::test]
async fn a_network_failure_is_an_outage() {
    // A closed port: the connection fails.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let client = client_with(addr, timing());
    assert_eq!(
        message(&exchange(&client).await),
        "Sony sign-in unavailable"
    );
    assert_eq!(message(&library(&client).await), "Sony sign-in unavailable");
    assert_eq!(
        message(&wishlist(&client).await),
        "Sony sign-in unavailable"
    );
}

#[test]
fn the_debug_output_holds_no_credential_or_header() {
    let client = SonyAccountClient::new(contract(), AccountTiming::default(), true).unwrap();
    let text = format!("{client:?}");
    assert!(!text.contains("Basic"), "{text}");
    assert!(!text.contains(&contract().auth_client_id), "{text}");
}

// ---------------------------------------------------------------------------
// The purchased library.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn requests_the_library_with_the_persisted_query_and_a_bearer_token() {
    let (client, mock) = mock_client(vec![library_page(1, 2)]).await;
    let entries = library(&client).await.unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries[0].product_id,
        "EP0001-PPSA00001_00-SYNTHETIC0000001"
    );
    let request = &mock.requests()[0];
    let contract = contract();
    assert_eq!(request.method, Method::GET);
    assert_eq!(request.path, "/graphql");
    assert_eq!(
        request.query_param("operationName").as_deref(),
        Some("getPurchasedGameList")
    );
    assert_eq!(
        request.query_param("variables").as_deref(),
        Some(
            r#"{"isActive":true,"platform":["ps5"],"size":100,"start":0,"sortBy":"ACTIVE_DATE","sortDirection":"desc"}"#
        )
    );
    assert_eq!(
        request.query_param("extensions"),
        Some(format!(
            r#"{{"persistedQuery":{{"version":1,"sha256Hash":"{}"}}}}"#,
            contract.purchased_hash
        ))
    );
    let bearer = format!("Bearer {TOKEN}");
    assert_eq!(request.header(AUTHORIZATION), Some(bearer.as_str()));
    assert_eq!(request.header(ACCEPT), Some("application/json"));
    assert_eq!(
        request.header("x-apollo-operation-name"),
        Some("getPurchasedGameList")
    );
    assert_eq!(request.header("x-psn-store-locale-override"), Some("en-FI"));
    assert!(request.header(COOKIE).is_none());
    assert!(!request.query.contains(TOKEN), "the token is in no URL");
}

#[tokio::test]
async fn crawls_pages_in_order_until_a_short_page_and_removes_duplicates() {
    let size = PURCHASED_PAGE_SIZE;
    let (client, mock) = mock_client(vec![library_page(0, size), library_page(size - 1, 3)]).await;
    let entries = library(&client).await.unwrap();
    let starts: Vec<_> = mock.requests().iter().map(Recorded::start).collect();
    assert_eq!(starts, [Some(0), Some(100)]);
    // Row 99 is on both pages: it is kept once, in its first position.
    assert_eq!(entries.len(), size + 2);
    let row = |index: usize| game_row(index)["productId"].as_str().unwrap().to_owned();
    assert_eq!(entries[99].product_id, row(99));
    assert_eq!(entries[100].product_id, row(100));
    assert_eq!(entries[101].product_id, row(101));
    let ids: std::collections::HashSet<_> = entries.iter().map(|e| &e.product_id).collect();
    assert_eq!(ids.len(), entries.len());
}

#[tokio::test]
async fn fails_when_the_page_cap_is_reached_with_a_full_last_page() {
    let (addr, mock) = serve(vec![], Some(library_page(0, PURCHASED_PAGE_SIZE))).await;
    let client = client_with(addr, timing());
    let outcome = library(&client).await;
    assert_eq!(tag(&outcome), "UpstreamUnavailable");
    assert_eq!(
        message(&outcome),
        "Sony library list exceeds the supported size"
    );
    assert_eq!(mock.calls(), PURCHASED_MAX_PAGES);
    let starts: Vec<_> = mock.requests().iter().map(Recorded::start).collect();
    let expected: Vec<_> = (0..20_u64).map(|page| Some(page * 100)).collect();
    assert_eq!(starts, expected, "pages are read in sequence");
}

/// A page of out-of-scope games is still a full page: the crawl compares
/// the raw count with the page size.
#[tokio::test]
async fn a_full_page_of_out_of_scope_games_continues_the_crawl() {
    let ps4: Vec<Value> = (0..PURCHASED_PAGE_SIZE)
        .map(|index| {
            let mut row = game_row(index);
            row["platform"] = json!("PS4");
            row
        })
        .collect();
    let first = json_reply(&json!({"data": {"purchasedTitlesRetrieve": {"games": ps4}}}));
    let (client, mock) = mock_client(vec![first, library_page(500, 1)]).await;
    let entries = library(&client).await.unwrap();
    assert_eq!(mock.calls(), 2);
    assert_eq!(entries.len(), 1);
}

#[tokio::test]
async fn fails_the_whole_request_when_a_later_page_fails() {
    let (client, _) = mock_client(vec![library_page(0, PURCHASED_PAGE_SIZE), reply(500)]).await;
    assert_eq!(tag(&library(&client).await), "UpstreamUnavailable");
    let (client, _) = mock_client(vec![library_page(0, PURCHASED_PAGE_SIZE), reply(401)]).await;
    assert_eq!(tag(&library(&client).await), "SessionRejected");
}

#[tokio::test]
async fn maps_a_rotated_hash_an_unknown_envelope_and_a_body_that_is_not_json() {
    let rotated = json_reply(&json!({
        "errors": [{"extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}}],
    }));
    let (client, _) = mock_client(vec![rotated]).await;
    let outcome = library(&client).await;
    assert_eq!(
        outcome.unwrap_err(),
        AccountError::Upstream(UpstreamError::QueryRotated {
            message: "Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh"
                .into(),
            operation_name: "getPurchasedGameList".into(),
        })
    );
    let (client, _) = mock_client(vec![json_reply(&json!({"data": {"somethingElse": []}}))]).await;
    let outcome = library(&client).await;
    assert_eq!(
        message(&outcome),
        "Sony library list has an unexpected shape"
    );
    let not_json = Reply {
        body: "<html>".into(),
        ..reply(200)
    };
    let (client, _) = mock_client(vec![not_json]).await;
    assert_eq!(message(&library(&client).await), "Sony sign-in unavailable");
}

#[tokio::test]
async fn a_crawl_that_outlives_its_deadline_fails() {
    let slow_full_page = Reply {
        delay: Duration::from_millis(100),
        ..library_page(0, PURCHASED_PAGE_SIZE)
    };
    let (addr, mock) = serve(vec![], Some(slow_full_page)).await;
    let client = client_with(
        addr,
        AccountTiming {
            purchased_deadline: Duration::from_millis(350),
            ..timing()
        },
    );
    let outcome = library(&client).await;
    assert_eq!(message(&outcome), "Sony library list timed out");
    assert!(mock.calls() < PURCHASED_MAX_PAGES);
}

// ---------------------------------------------------------------------------
// The wishlist.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn makes_one_wishlist_get_with_the_persisted_query_a_token_and_the_locale() {
    let list = json!([wish_row("1", &["PS5"]), wish_row("2", &["PS4"])]);
    let (client, mock) = mock_client(vec![wishlist_body(&list)]).await;
    let entries = wishlist(&client).await.unwrap();
    assert_eq!(
        entries,
        [WishlistEntry {
            id: "1".into(),
            id_kind: IdKind::Concept,
            name: "Synthetic 1".into(),
            image_url: "https://img.test/x.png".into(),
        }]
    );
    assert_eq!(mock.calls(), 1);
    let request = &mock.requests()[0];
    assert_eq!(request.method, Method::GET);
    assert_eq!(
        request.query_param("operationName").as_deref(),
        Some("storeRetrieveWishlist")
    );
    assert_eq!(request.query_param("variables").as_deref(), Some("{}"));
    let extensions: Value =
        serde_json::from_str(&request.query_param("extensions").unwrap()).unwrap();
    assert_eq!(
        extensions,
        json!({"persistedQuery": {"version": 1, "sha256Hash": contract().wishlist_hash}})
    );
    let bearer = format!("Bearer {TOKEN}");
    assert_eq!(request.header(AUTHORIZATION), Some(bearer.as_str()));
    assert_eq!(request.header("x-psn-store-locale-override"), Some("en-FI"));
    assert!(request.header(COOKIE).is_none());
}

#[tokio::test]
async fn an_empty_wishlist_is_a_success() {
    let (client, _) = mock_client(vec![wishlist_body(&json!([]))]).await;
    assert_eq!(wishlist(&client).await, Ok(vec![]));
}

#[tokio::test]
async fn a_graphql_access_denied_answer_is_a_rejection() {
    let denied = json_reply(&json!({
        "errors": [{"message": "Access denied! You need to be authorized."}],
        "data": {"storeWishlistSecure": null},
    }));
    let (client, _) = mock_client(vec![denied]).await;
    let outcome = wishlist(&client).await;
    assert_eq!(tag(&outcome), "SessionRejected");
    assert_eq!(message(&outcome), "Sony rejected the sign-in");
}

#[tokio::test]
async fn a_null_or_missing_list_without_a_denial_is_drift_never_an_empty_list() {
    for body in [
        json!({"data": {"storeWishlistSecure": null}}),
        json!({"data": {}}),
        json!({"data": null}),
        json!({}),
        json!({"errors": [{"message": "Internal error"}], "data": null}),
    ] {
        let (client, _) = mock_client(vec![json_reply(&body)]).await;
        let outcome = wishlist(&client).await;
        assert_eq!(tag(&outcome), "UpstreamUnavailable", "{body}");
        assert_eq!(message(&outcome), "Sony wishlist has an unexpected shape");
    }
}

#[tokio::test]
async fn maps_a_rotated_hash_reported_in_the_wishlist_body() {
    let rotated = json_reply(&json!({
        "errors": [{"extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}}],
    }));
    let (client, _) = mock_client(vec![rotated]).await;
    assert_eq!(
        wishlist(&client).await.unwrap_err(),
        AccountError::Upstream(UpstreamError::QueryRotated {
            message: "Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh"
                .into(),
            operation_name: "storeRetrieveWishlist".into(),
        })
    );
}

#[tokio::test]
async fn a_wishlist_body_that_is_not_json_is_an_outage() {
    let html = Reply {
        body: "<html>".into(),
        ..reply(200)
    };
    let (client, _) = mock_client(vec![html]).await;
    assert_eq!(
        message(&wishlist(&client).await),
        "Sony sign-in unavailable"
    );
}

#[tokio::test]
async fn a_wishlist_call_that_outlives_its_deadline_fails() {
    let slow = Reply {
        delay: Duration::from_millis(500),
        ..wishlist_body(&json!([]))
    };
    let (addr, _) = serve(vec![slow], None).await;
    let client = client_with(
        addr,
        AccountTiming {
            wishlist_deadline: Duration::from_millis(100),
            ..timing()
        },
    );
    assert_eq!(message(&wishlist(&client).await), "Sony wishlist timed out");
}

#[tokio::test]
async fn element_drift_logs_counts_only() {
    use crate::observability::testing::CapturedLogs;

    let list = json!([
        wish_row("1", &["PS5"]),
        wish_row("2", &["PS4"]),
        {"__typename": "Concept", "id": "3", "name": 5},
    ]);
    let rows = vec![
        game_row(1),
        json!(null),
        json!({"name": "Synthetic Broken"}),
    ];
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        let (client, _) = mock_client(vec![wishlist_body(&list)]).await;
        assert_eq!(wishlist(&client).await.unwrap().len(), 1);
        let page = json_reply(&json!({"data": {"purchasedTitlesRetrieve": {"games": rows}}}));
        let (client, _) = mock_client(vec![page]).await;
        assert_eq!(library(&client).await.unwrap().len(), 1);
        let (client, _) = mock_client(vec![wishlist_body(&json!({}))]).await;
        assert!(wishlist(&client).await.is_err());
    }
    let lines = logs.lines();
    let find = |message: &str| {
        lines
            .iter()
            .find(|line| line["message"] == message)
            .cloned()
            .unwrap_or_else(|| panic!("no line {message}: {lines:?}"))
    };
    let wishlist_line = find("sony wishlist element drift");
    assert_eq!(wishlist_line["dropped"], 1);
    assert_eq!(wishlist_line["out_of_scope"], 1);
    assert_eq!(wishlist_line["kept"], 1);
    let library_line = find("sony purchased list element drift");
    assert_eq!(library_line["dropped"], 2);
    assert_eq!(library_line["kept"], 1);
    find("sony wishlist drift");
    for line in &lines {
        assert!(line.get("dropped_fields").is_none(), "{line}");
    }
    let text = logs.text();
    for secret in [TOKEN, "Synthetic", "EP0001", "img.test"] {
        assert!(!text.contains(secret), "{text} contains {secret}");
    }
}
