use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::schema::{count_of, rating_of, year_of_unix_seconds};
use super::*;
use crate::application::CriticScores;
use crate::application::critic_scores::CriticScoreService;
use crate::domain::game::{CriticScore, Game, IdKind};
use crate::domain::secret::Secret;
use crate::observability::testing::CapturedLogs;

const SECRET: &str = "synthetic-client-secret";
const CLIENT_ID: &str = "synthetic-client-id";
const TOKEN_PATH: &str = "/oauth2/token";
const GAMES_PATH: &str = "/v4/games";
const GOLDEN: &str = include_str!("../../../tests/fixtures/igdbGames.golden.json");

// ---------------------------------------------------------------------------
// A local fake of the Twitch and IGDB endpoints.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Recorded {
    method: String,
    path: String,
    query: Option<String>,
    headers: HeaderMap,
    body: String,
}

impl Recorded {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }

    fn header_names(&self) -> BTreeSet<String> {
        self.headers.keys().map(|k| k.as_str().to_owned()).collect()
    }

    fn is_token(&self) -> bool {
        self.path == TOKEN_PATH
    }
}

type Calls = Arc<Mutex<Vec<Recorded>>>;

fn answer(status: u16, body: &Value) -> Response {
    (
        StatusCode::from_u16(status).unwrap(),
        [("content-type", "application/json")],
        body.to_string(),
    )
        .into_response()
}

fn token_body(token: &str) -> Value {
    json!({ "access_token": token, "expires_in": 5_000_000, "token_type": "bearer" })
}

fn games_body() -> Value {
    json!([{
        "name": "Synthetic Quest",
        "first_release_date": 1_700_000_000,
        "aggregated_rating": 84.4,
        "aggregated_rating_count": 12
    }])
}

/// Serves `respond(request, call index)` for every request.
async fn serve(
    respond: impl Fn(&Recorded, usize) -> Response + Send + Sync + 'static,
) -> (String, Calls) {
    let calls: Calls = Arc::default();
    let respond = Arc::new(respond);
    let recorded_calls = Arc::clone(&calls);
    let app = Router::new().fallback(move |request: Request| {
        let calls = Arc::clone(&recorded_calls);
        let respond = Arc::clone(&respond);
        async move {
            let (parts, body) = request.into_parts();
            let body = to_bytes(body, usize::MAX).await.unwrap();
            let recorded = Recorded {
                method: parts.method.to_string(),
                path: parts.uri.path().to_owned(),
                query: parts.uri.query().map(str::to_owned),
                headers: parts.headers,
                body: String::from_utf8(body.to_vec()).unwrap(),
            };
            let index = {
                let mut calls = calls.lock().unwrap();
                calls.push(recorded.clone());
                calls.len() - 1
            };
            respond(&recorded, index)
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), calls)
}

/// A fake with a fixed token answer and a fixed games answer.
async fn serve_fixed(token: (u16, Value), games: (u16, Value)) -> (String, Calls) {
    serve(move |call, _| {
        if call.is_token() {
            answer(token.0, &token.1)
        } else {
            answer(games.0, &games.1)
        }
    })
    .await
}

fn credentials() -> IgdbCredentials {
    IgdbCredentials {
        client_id: CLIENT_ID.into(),
        client_secret: Secret::new(SECRET),
    }
}

fn client(base: &str) -> IgdbClient {
    IgdbClient::with_endpoints(
        transport::build_client(Redirects::Manual, false).unwrap(),
        credentials(),
        format!("{base}{TOKEN_PATH}"),
        format!("{base}{GAMES_PATH}"),
    )
}

fn snapshot(calls: &Calls) -> Vec<Recorded> {
    calls.lock().unwrap().clone()
}

fn token_calls(calls: &Calls) -> usize {
    snapshot(calls).iter().filter(|c| c.is_token()).count()
}

// ---------------------------------------------------------------------------
// The cases of `server/src/__tests__/igdbClient.test.ts`.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sends_the_credentials_in_the_token_form_body_not_the_url() {
    let (base, calls) = serve_fixed((200, token_body("tok-1")), (200, games_body())).await;
    let found = client(&base).find("Synthetic Quest", 2023).await;
    assert!(found.is_ok(), "{found:?}");

    let token_call = &snapshot(&calls)[0];
    assert_eq!(token_call.method, "POST");
    assert_eq!(token_call.path, TOKEN_PATH);
    assert_eq!(token_call.query, None, "nothing travels in the URL");
    assert_eq!(
        token_call.header("content-type"),
        Some("application/x-www-form-urlencoded")
    );
    assert_eq!(token_call.header("accept"), Some("application/json"));
    let form: Vec<(String, String)> = form_urlencoded::parse(token_call.body.as_bytes())
        .into_owned()
        .collect();
    assert_eq!(
        form,
        [
            ("client_id".to_owned(), CLIENT_ID.to_owned()),
            ("client_secret".to_owned(), SECRET.to_owned()),
            ("grant_type".to_owned(), "client_credentials".to_owned()),
        ]
    );
    assert_eq!(
        token_call.header_names(),
        BTreeSet::from(
            [
                "accept",
                "accept-encoding",
                "content-length",
                "content-type",
                "host",
                "user-agent"
            ]
            .map(str::to_owned)
        ),
    );
}

#[tokio::test]
async fn sends_the_token_and_client_id_as_headers_and_only_the_title_and_year_range() {
    let (base, calls) = serve_fixed((200, token_body("tok-1")), (200, games_body())).await;
    client(&base).find("Synthetic Quest", 2023).await.unwrap();

    let games_call = &snapshot(&calls)[1];
    assert_eq!(games_call.method, "POST");
    assert_eq!(games_call.path, GAMES_PATH);
    assert_eq!(games_call.query, None);
    assert_eq!(games_call.header("accept"), Some("application/json"));
    assert_eq!(games_call.header("client-id"), Some(CLIENT_ID));
    assert_eq!(games_call.header("authorization"), Some("Bearer tok-1"));
    assert_eq!(
        games_call.header("content-type"),
        Some("text/plain;charset=UTF-8")
    );
    assert_eq!(
        games_call.body,
        games_query("Synthetic Quest", 2023).unwrap()
    );
    // No other header: no cookie, no forwarded address, nothing of a visitor.
    assert_eq!(
        games_call.header_names(),
        BTreeSet::from(
            [
                "accept",
                "accept-encoding",
                "authorization",
                "client-id",
                "content-length",
                "content-type",
                "host",
                "user-agent"
            ]
            .map(str::to_owned)
        ),
    );
}

#[tokio::test]
async fn reuses_one_token_for_concurrent_and_later_calls() {
    let (base, calls) = serve_fixed((200, token_body("tok-1")), (200, games_body())).await;
    let igdb = client(&base);
    let (a, b, c) = tokio::join!(
        igdb.find("Synthetic Quest", 2023),
        igdb.find("Other", 2023),
        igdb.find("Third", 2023),
    );
    assert!(a.is_ok() && b.is_ok() && c.is_ok());
    igdb.find("Later", 2023).await.unwrap();
    assert_eq!(token_calls(&calls), 1);
    assert_eq!(snapshot(&calls).len(), 5);
}

#[tokio::test]
async fn refreshes_the_token_once_after_a_401_and_retries_the_call() {
    let tokens = Arc::new(Mutex::new(0));
    let (base, calls) = serve(move |call, _| {
        if call.is_token() {
            let mut count = tokens.lock().unwrap();
            *count += 1;
            answer(200, &token_body(&format!("tok-{count}")))
        } else if call.header("authorization") == Some("Bearer tok-1") {
            answer(401, &json!({ "message": "Unauthorized" }))
        } else {
            answer(200, &games_body())
        }
    })
    .await;
    let found = client(&base).find("Synthetic Quest", 2023).await;
    assert_eq!(found.unwrap().len(), 1);
    let order: Vec<bool> = snapshot(&calls).iter().map(Recorded::is_token).collect();
    assert_eq!(order, [true, false, true, false]);
}

#[tokio::test]
async fn fails_as_rejected_when_the_provider_keeps_answering_401() {
    let (base, calls) = serve_fixed((200, token_body("tok")), (401, json!({}))).await;
    let found = client(&base).find("Synthetic Quest", 2023).await;
    assert_eq!(found, Err(CriticSourceError::Rejected));
    assert_eq!(snapshot(&calls).len(), 4, "one refresh and one retry");
}

#[tokio::test]
async fn fails_as_unavailable_on_a_500_a_bad_body_or_a_bad_token_body() {
    let (base, _) = serve_fixed((200, token_body("tok")), (500, json!({}))).await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Unavailable)
    );

    let (base, _) = serve_fixed(
        (200, token_body("tok")),
        (200, json!({ "not": "an array" })),
    )
    .await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Unavailable)
    );

    let (base, _) = serve(|_, _| answer(200, &json!({ "nothing": true }))).await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Unavailable)
    );
}

#[tokio::test]
async fn never_logs_the_secret_the_token_or_the_client_id() {
    let (base, _) = serve_fixed((200, token_body("tok-secret-value")), (500, json!({}))).await;
    let critics = CriticScoreService::new(Arc::new(client(&base)));
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        assert_eq!(critics.score_for(&game()).await, None);
    }
    let text = logs.text();
    assert!(text.contains("CriticSourceUnavailable"), "{text}");
    for private in [SECRET, "tok-secret-value", CLIENT_ID, "Synthetic Quest"] {
        assert!(!text.contains(private), "{text}");
    }
}

// ---------------------------------------------------------------------------
// Challenge cases beyond the TypeScript tests.
// ---------------------------------------------------------------------------

fn game() -> Game {
    Game {
        id: "EP0001-PPSA00001_00-ALPHA00000000000".into(),
        name: "Synthetic Quest".into(),
        date: "2023-11-14T00:00:00Z".into(),
        url: String::new(),
        price: String::new(),
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

#[tokio::test]
async fn the_whole_chain_returns_the_matched_score() {
    let (base, _) = serve_fixed((200, token_body("tok")), (200, games_body())).await;
    let critics = CriticScoreService::new(Arc::new(client(&base)));
    assert_eq!(critics.score_for(&game()).await, CriticScore::new(84));
}

#[tokio::test]
async fn a_rejected_token_request_is_repeated_once_per_lookup() {
    let (base, calls) = serve_fixed(
        (400, json!({ "message": "invalid client" })),
        (200, games_body()),
    )
    .await;
    let igdb = client(&base);
    assert_eq!(
        igdb.find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Rejected)
    );
    assert_eq!(token_calls(&calls), 2);
    // The second rejection is cached; the next lookup drops it and asks once.
    assert_eq!(
        igdb.find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Rejected)
    );
    assert_eq!(token_calls(&calls), 3);
    assert_eq!(
        snapshot(&calls).len(),
        3,
        "no games request without a token"
    );
}

#[tokio::test]
async fn a_failed_token_request_is_cached_and_not_repeated_at_once() {
    let (base, calls) = serve_fixed((500, json!({})), (200, games_body())).await;
    let igdb = client(&base);
    for _ in 0..2 {
        assert_eq!(
            igdb.find("Synthetic Quest", 2023).await,
            Err(CriticSourceError::Unavailable)
        );
    }
    assert_eq!(token_calls(&calls), 1);
}

#[tokio::test]
async fn a_token_that_expires_within_the_margin_is_not_kept() {
    let short = json!({ "access_token": "tok", "expires_in": 300 });
    let (base, calls) = serve_fixed((200, short), (200, games_body())).await;
    let igdb = client(&base);
    igdb.find("Synthetic Quest", 2023).await.unwrap();
    igdb.find("Synthetic Quest", 2023).await.unwrap();
    assert_eq!(token_calls(&calls), 2);
}

#[test]
fn a_token_lives_until_its_expiry_minus_the_margin() {
    let token = |seconds: f64| {
        Ok(IgdbToken {
            access_token: Secret::new("tok"),
            expires_in_seconds: seconds,
        })
    };
    assert_eq!(token_ttl(&token(3600.0)), Duration::from_mins(55));
    assert_eq!(
        token_ttl(&token(5_000_000.0)),
        Duration::from_secs(4_999_700)
    );
    assert_eq!(token_ttl(&token(300.0)), Duration::ZERO);
    assert_eq!(token_ttl(&token(0.5)), Duration::ZERO);
    assert_eq!(token_ttl(&token(300.5)), Duration::from_millis(500));
    assert_eq!(token_ttl(&token(1e300)), TOKEN_TTL_MAX);
    assert_eq!(
        token_ttl(&Err(CriticSourceError::Unavailable)),
        Duration::from_secs(30)
    );
    assert_eq!(
        token_ttl(&Err(CriticSourceError::Rejected)),
        Duration::from_secs(30)
    );
}

#[tokio::test]
async fn a_429_fails_at_once_as_unavailable() {
    let (base, calls) = serve_fixed((200, token_body("tok")), (429, json!({}))).await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Unavailable)
    );
    assert_eq!(snapshot(&calls).len(), 2, "no retry");
}

#[tokio::test]
async fn never_follows_a_redirect_with_the_token_or_the_secret() {
    let (base, calls) = serve(|call, _| {
        let location = format!(
            "http://{}/elsewhere",
            call.header("host").unwrap_or_default()
        );
        if call.path == "/elsewhere" {
            answer(200, &games_body())
        } else if call.is_token() {
            answer(200, &token_body("tok"))
        } else {
            (StatusCode::TEMPORARY_REDIRECT, [("location", location)]).into_response()
        }
    })
    .await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Unavailable)
    );
    let paths: Vec<String> = snapshot(&calls).into_iter().map(|c| c.path).collect();
    assert_eq!(paths, [TOKEN_PATH, GAMES_PATH]);

    let (base, calls) = serve(|call, _| {
        let location = format!(
            "http://{}/elsewhere",
            call.header("host").unwrap_or_default()
        );
        (StatusCode::PERMANENT_REDIRECT, [("location", location)]).into_response()
    })
    .await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Unavailable)
    );
    let paths: Vec<String> = snapshot(&calls).into_iter().map(|c| c.path).collect();
    assert_eq!(paths, [TOKEN_PATH]);
}

#[tokio::test]
async fn a_body_that_is_not_json_is_unavailable() {
    let (base, _) = serve(|call, _| {
        if call.is_token() {
            answer(200, &token_body("tok"))
        } else {
            (StatusCode::OK, "<html>").into_response()
        }
    })
    .await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 2023).await,
        Err(CriticSourceError::Unavailable)
    );
}

#[tokio::test]
async fn a_year_outside_the_calendar_sends_no_request() {
    let (base, calls) = serve_fixed((200, token_body("tok")), (200, games_body())).await;
    assert_eq!(
        client(&base).find("Synthetic Quest", 9999).await,
        Ok(vec![])
    );
    assert!(snapshot(&calls).is_empty());
}

#[test]
fn debug_output_names_no_credential() {
    let igdb = client("http://127.0.0.1:9");
    let text = format!("{igdb:?}");
    assert!(!text.contains(SECRET), "{text}");
    assert!(!text.contains(CLIENT_ID), "{text}");
    let token = IgdbToken {
        access_token: Secret::new("synthetic-token"),
        expires_in_seconds: 3600.0,
    };
    let text = format!("{token:?}");
    assert!(!text.contains("synthetic-token"), "{text}");
    assert!(text.contains("<redacted>"), "{text}");
}

#[test]
fn the_endpoints_and_limits_match_the_typescript_server() {
    assert_eq!(IGDB_TOKEN_URL, "https://id.twitch.tv/oauth2/token");
    assert_eq!(IGDB_GAMES_URL, "https://api.igdb.com/v4/games");
    assert_eq!(IGDB_TIMEOUT, Duration::from_millis(1500));
    assert_eq!(IGDB_CANDIDATE_LIMIT, 10);
    assert_eq!(TOKEN_FAILURE_TTL, Duration::from_secs(30));
    assert_eq!(ATTEMPTS.retries, 0);
}

#[test]
fn classifies_only_400_401_and_403_as_rejected() {
    for status in [400, 401, 403] {
        assert_eq!(
            classify(TransportError::Status(status)),
            CriticSourceError::Rejected
        );
    }
    for error in [
        TransportError::Status(404),
        TransportError::Status(500),
        TransportError::Status(302),
        TransportError::RateLimited { retry_after: None },
        TransportError::Failed,
    ] {
        assert_eq!(classify(error), CriticSourceError::Unavailable);
    }
}

// ---------------------------------------------------------------------------
// The cases of `server/src/__tests__/igdbSchema.test.ts`.
// ---------------------------------------------------------------------------

fn candidate(
    name: &str,
    release_year: Option<i32>,
    rating: Option<u8>,
    rating_count: u64,
) -> CriticCandidate {
    CriticCandidate {
        name: name.into(),
        release_year,
        rating: rating.and_then(CriticScore::new),
        rating_count,
    }
}

#[test]
fn decodes_the_golden_fixture() {
    let golden = decode_json(GOLDEN.as_bytes()).unwrap();
    assert_eq!(
        parse_games_response(&golden).unwrap(),
        [
            candidate("Synthetic Quest", Some(2023), Some(84), 12),
            candidate("Synthetic Quest: Remastered", Some(2025), Some(80), 5),
            candidate("Synthetic Unrated", Some(2023), None, 0),
            // Malformed values are dropped; the candidate stays without a score.
            candidate("Synthetic Malformed", None, None, 0),
        ]
    );
}

#[test]
fn drops_an_out_of_range_rating() {
    let parsed = parse_games_response(&json!([
        { "name": "A", "aggregated_rating": 120, "aggregated_rating_count": 9 },
        { "name": "B", "aggregated_rating": -1, "aggregated_rating_count": 9 },
    ]))
    .unwrap();
    let ratings: Vec<_> = parsed.iter().map(|c| c.rating).collect();
    assert_eq!(ratings, [None, None]);
}

#[test]
fn is_none_when_the_body_is_not_an_array() {
    assert_eq!(parse_games_response(&json!({ "message": "nope" })), None);
    assert_eq!(parse_games_response(&Value::Null), None);
}

#[test]
fn keeps_the_token_redacted() {
    let token = parse_token_response(&json!({
        "access_token": "synthetic-token",
        "expires_in": 3600,
        "token_type": "bearer"
    }))
    .unwrap();
    assert_eq!(token.expires_in_seconds, 3600.0);
    assert!(!format!("{token:?}").contains("synthetic-token"));
    assert_eq!(token.access_token.expose(), "synthetic-token");
}

#[test]
fn is_none_without_a_usable_token_or_lifetime() {
    for body in [
        json!({ "access_token": "", "expires_in": 10 }),
        json!({ "access_token": "x" }),
        json!({ "access_token": "x", "expires_in": 0 }),
        json!({ "access_token": "x", "expires_in": -5 }),
        json!({ "access_token": "x", "expires_in": "3600" }),
        json!({ "access_token": 7, "expires_in": 3600 }),
        json!([]),
        Value::Null,
    ] {
        assert!(parse_token_response(&body).is_none(), "{body}");
    }
}

// ---------------------------------------------------------------------------
// Challenge cases for the schema.
// ---------------------------------------------------------------------------

/// Expected values from Node 24.21.0: `Math.round(x)`.
#[test]
fn rounds_the_rating_like_math_round() {
    let cases = [
        (json!(84.4), 84),
        (json!(84.5), 85),
        (json!(84.499_999_999_999_99), 84),
        (json!(0.499_999_999_999_999_94), 0),
        (json!(0.5), 1),
        (json!(2.5), 3),
        (json!(99.5), 100),
        (json!(100), 100),
        (json!(0), 0),
        (json!(-0.0), 0),
        (json!(50.500_000_1), 51),
    ];
    for (value, expected) in cases {
        assert_eq!(rating_of(&value), CriticScore::new(expected), "{value}");
    }
    for value in [
        json!(100.0001),
        json!(-0.1),
        json!("84"),
        json!(null),
        json!(true),
    ] {
        assert_eq!(rating_of(&value), None, "{value}");
    }
}

/// Expected values from Node 24.21.0:
/// `new Date(seconds * 1000).getUTCFullYear()`.
#[test]
fn reads_the_release_year_like_javascript() {
    let cases = [
        (json!(1_700_000_000), Some(2023)),
        (json!(1_760_000_000), Some(2025)),
        (json!(1_703_980_800), Some(2023)),
        (json!(1_704_067_199.999_9), Some(2023)),
        (json!(-0.0005), Some(1970)),
        (json!(-0.5), Some(1969)),
        (json!(0), Some(1970)),
        (json!(1.5), Some(1970)),
        (json!(253_402_128_000_i64), Some(9999)),
        (json!(-62_135_596_800_i64), Some(1)),
        (json!(-62_135_596_801_i64), Some(0)),
        (json!(1e306), None),
        (json!(8.64e12 + 0.001), None),
        (json!("soon"), None),
        (json!(null), None),
    ];
    for (value, expected) in cases {
        assert_eq!(year_of_unix_seconds(&value), expected, "{value}");
    }
}

/// A deliberate difference: JavaScript dates reach the year 275760, a jiff
/// timestamp ends at 9999-12-30T22:00Z. No IGDB game has such a date.
#[test]
fn a_release_date_beyond_the_jiff_range_has_no_year() {
    // 9999-12-31T23:59:59Z: JavaScript gives 9999.
    assert_eq!(year_of_unix_seconds(&json!(253_402_300_799_i64)), None);
    assert_eq!(year_of_unix_seconds(&json!(253_402_300_800_i64)), None);
    assert_eq!(year_of_unix_seconds(&json!(8.64e12)), None);
}

#[test]
fn reads_only_integer_counts_of_zero_or_more() {
    let cases = [
        (json!(12), 12),
        (json!(12.0), 12),
        (json!(0), 0),
        (json!(2.5), 0),
        (json!(-2), 0),
        (json!("12"), 0),
        (json!(null), 0),
        (json!(1e300), u64::MAX),
    ];
    for (value, expected) in cases {
        assert_eq!(count_of(&value), expected, "{value}");
    }
}

#[test]
fn never_reads_the_user_rating() {
    let parsed = parse_games_response(&json!([
        { "name": "A", "rating": 90, "rating_count": 500, "first_release_date": 1_700_000_000 }
    ]))
    .unwrap();
    assert_eq!(parsed, [candidate("A", Some(2023), None, 0)]);
}

#[test]
fn drops_an_element_without_a_string_name_and_keeps_the_others() {
    let parsed = parse_games_response(&json!([
        { "name": 7 },
        "Synthetic Quest",
        null,
        [],
        { "name": "" },
        { "name": "Kept", "aggregated_rating": 70, "aggregated_rating_count": 4 },
    ]))
    .unwrap();
    assert_eq!(
        parsed,
        [
            candidate("", None, None, 0),
            candidate("Kept", None, Some(70), 4)
        ]
    );
}

#[test]
fn a_body_that_is_not_json_does_not_decode() {
    assert_eq!(decode_json(b"<html>"), None);
    assert_eq!(decode_json(b""), None);
}

// ---------------------------------------------------------------------------
// The query: the cases of `buildGamesQuery` in igdbClient.test.ts.
// ---------------------------------------------------------------------------

#[test]
fn removes_characters_that_end_the_quoted_title() {
    assert_eq!(
        quote_title("A \"quoted\" \\ title\nnext"),
        "A  quoted    title next"
    );
    let query = games_query("X\"; fields *; where id > 0; \"", 2023).unwrap();
    assert!(
        query.starts_with("search \"X ; fields *; where id > 0;\";"),
        "{query}"
    );
    assert_eq!(query.matches('"').count(), 2);
}

#[test]
fn limits_the_release_date_to_the_year_and_its_neighbours() {
    let query = games_query("Game", 2023).unwrap();
    // Date.UTC(2022, 0, 1) / 1000 and Date.UTC(2025, 0, 1) / 1000.
    assert!(
        query.contains("first_release_date >= 1640995200"),
        "{query}"
    );
    assert!(query.contains("first_release_date < 1735689600"), "{query}");
}

/// Expected text from Node 24.21.0 running `buildGamesQuery`.
#[test]
fn builds_the_exact_query_text() {
    assert_eq!(
        games_query("Synthetic Quest", 2023).unwrap(),
        "search \"Synthetic Quest\"; fields name,first_release_date,aggregated_rating,aggregated_rating_count; where first_release_date >= 1640995200 & first_release_date < 1735689600; limit 10;"
    );
}

/// Expected values from Node 24.21.0 running `quoteTitle`. JavaScript `trim`
/// removes U+FEFF and keeps U+0085, unlike Rust `str::trim`.
#[test]
fn trims_like_javascript() {
    assert_eq!(quote_title("\u{FEFF}Title\u{0085}"), "Title\u{0085}");
    assert_eq!(quote_title("\u{00A0}\u{2028}Ti\u{0}tle\u{3000}"), "Ti tle");
    assert_eq!(
        quote_title(" \u{180E}Title\u{180E} "),
        "\u{180E}Title\u{180E}"
    );
    assert_eq!(
        quote_title("\u{200B}Title\u{200B}"),
        "\u{200B}Title\u{200B}"
    );
    assert_eq!(quote_title("Tab\there\u{7F}"), "Tab here");
}

#[test]
fn a_year_range_outside_the_calendar_has_no_query() {
    assert_eq!(games_query("Game", 9998), None);
    assert!(games_query("Game", 9997).is_some());
    // A jiff timestamp starts at -9999-01-02T01:59:59Z, after the start of
    // the year -9999.
    assert!(games_query("Game", -9997).is_some());
    assert_eq!(games_query("Game", -9998), None);
    assert_eq!(games_query("Game", i32::MIN), None);
    assert_eq!(games_query("Game", i32::MAX), None);
}
