//! The client against a local HTTP server: the request shape, the error
//! classification, and the drift logs (port of `sonyClientLive.test.ts`).

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Value, json};

use super::super::*;
use crate::domain::browse::{BrowseOrder, GenreKey};
use crate::domain::game::PlusOffer;
use crate::observability::testing::CapturedLogs;

#[derive(Clone)]
struct Reply {
    status: u16,
    body: String,
}

fn reply(status: u16, body: &str) -> Reply {
    Reply {
        status,
        body: body.to_owned(),
    }
}

fn json_reply(body: &Value) -> Reply {
    reply(200, &body.to_string())
}

/// One request that the server received.
#[derive(Clone, Debug)]
struct Seen {
    path: String,
    query: Vec<(String, String)>,
    headers: HeaderMap,
}

impl Seen {
    fn param(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
}

#[derive(Clone, Default)]
struct Upstream {
    replies: Arc<Mutex<VecDeque<Reply>>>,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Upstream {
    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

/// A local server that answers each request with the next reply. The last
/// reply repeats.
async fn serve(replies: Vec<Reply>) -> (SonyCatalogClient, Upstream) {
    let upstream = Upstream {
        replies: Arc::new(Mutex::new(replies.into())),
        seen: Arc::default(),
    };
    let state = upstream.clone();
    let app = Router::new().fallback(move |request: Request| {
        let state = state.clone();
        async move {
            let uri = request.uri().clone();
            state.seen.lock().unwrap().push(Seen {
                path: uri.path().to_owned(),
                query: form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes())
                    .into_owned()
                    .collect(),
                headers: request.headers().clone(),
            });
            let next = {
                let mut queue = state.replies.lock().unwrap();
                if queue.len() > 1 {
                    queue.pop_front()
                } else {
                    queue.front().cloned()
                }
            };
            let next = next.unwrap_or_else(|| reply(418, ""));
            Response::builder()
                .status(StatusCode::from_u16(next.status).unwrap())
                .body(Body::from(next.body))
                .unwrap()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let contract = SonyContract::load().unwrap();
    let client = SonyCatalogClient::with_endpoints(
        &contract,
        format!("http://{addr}/api/graphql/v1/op"),
        format!("http://{addr}/bin/imagic/gameslist"),
        false,
    )
    .unwrap();
    (client, upstream)
}

const SKU: &str = "EP0001-PPSA00001_00-ALPHA00000000000";

fn rotation() -> Value {
    json!({"errors": [{"extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}}]})
}

fn log_with(logs: &CapturedLogs, event: &str) -> Option<Value> {
    logs.lines().into_iter().find(|line| line["event"] == event)
}

#[tokio::test]
async fn a_drifted_grid_is_an_empty_list_with_a_warning() {
    let (client, _) = serve(vec![json_reply(&json!({"data": {}}))]).await;
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    let concepts = client.concepts_by_feature(SonyFeature::New, 10, 0).await;
    assert_eq!(concepts, Ok(vec![]));
    let line = log_with(&logs, "sony.categoryGrid.drift").unwrap();
    assert_eq!(line["level"], "WARN");
    assert_eq!(line["feature"], "new");
    assert_eq!(line["operation"], "categoryGridRetrieve");
}

#[tokio::test]
async fn an_empty_grid_does_not_warn() {
    let (client, _) = serve(vec![json_reply(
        &json!({"data": {"categoryGridRetrieve": {"concepts": []}}}),
    )])
    .await;
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    let concepts = client.concepts_by_feature(SonyFeature::New, 10, 0).await;
    assert_eq!(concepts, Ok(vec![]));
    assert!(logs.lines().is_empty(), "{}", logs.text());
}

#[tokio::test]
async fn a_broken_element_keeps_the_others_and_logs_the_counts() {
    let (client, _) = serve(vec![json_reply(&json!({"data": {"categoryGridRetrieve": {
        "concepts": [
            {"id": "1", "name": "Good", "price": null, "products": [{"id": SKU}]},
            {"id": {"wrong": true}, "name": "Broken"}
        ]
    }}}))])
    .await;
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    let concepts = client
        .concepts_by_feature(SonyFeature::Upcoming, 10, 0)
        .await
        .unwrap();
    assert_eq!(concepts.len(), 1);
    assert_eq!(concepts[0].name.as_deref(), Some("Good"));
    let line = log_with(&logs, "sony.categoryGrid.elementDrift").unwrap();
    assert_eq!(line["level"], "WARN");
    assert_eq!(line["dropped"], 1);
    assert_eq!(line["kept"], 1);
    assert_eq!(line["feature"], "upcoming");
}

#[tokio::test]
async fn a_rotation_is_query_rotated_on_every_graphql_path() {
    let (client, _) = serve(vec![json_reply(&rotation())]).await;
    let rotated = |operation: &str| UpstreamError::QueryRotated {
        message: ROTATED_MESSAGE.to_owned(),
        operation_name: operation.to_owned(),
    };
    assert_eq!(
        client.concepts_by_feature(SonyFeature::New, 10, 0).await,
        Err(rotated("categoryGridRetrieve"))
    );
    assert_eq!(
        client.product_detail(SKU.into()).await,
        Err(rotated("metGetProductById"))
    );
    assert_eq!(
        client.product_price(SKU.into()).await,
        Err(rotated("productRetrieveForCtasWithPrice"))
    );
    assert_eq!(
        client.search_page("elden".into(), 0, 50).await,
        Err(rotated("getSearchResults"))
    );
    assert_eq!(client.genres().await, Err(rotated("categoryGridRetrieve")));
    let browse = BrowseRequest {
        genre: GenreKey::parse("ACTION").unwrap(),
        order: BrowseOrder::Newest,
        offset: 0,
        size: 60,
    };
    assert_eq!(
        client.browse_page(browse).await,
        Err(rotated("categoryGridRetrieve"))
    );
}

#[tokio::test]
async fn a_message_only_rotation_on_the_product_path_is_detected() {
    let (client, _) = serve(vec![json_reply(
        &json!({"errors": [{"message": "PersistedQueryNotFound"}]}),
    )])
    .await;
    assert!(matches!(
        client.product_detail(SKU.into()).await,
        Err(UpstreamError::QueryRotated { .. })
    ));
}

#[tokio::test]
async fn a_persistent_429_is_rate_limited_after_one_retry() {
    let (client, upstream) = serve(vec![reply(429, "rate limited")]).await;
    let expected = Err(UpstreamError::RateLimited {
        message: "Sony upstream rate limited the request (HTTP 429)".into(),
        retry_after_seconds: None,
    });
    assert_eq!(
        client
            .concepts_by_feature(SonyFeature::New, 10, 0)
            .await
            .map(|_| ()),
        expected
    );
    assert_eq!(upstream.seen().len(), 2);
    assert_eq!(
        client.product_price("EP0001-X".into()).await.map(|_| ()),
        expected
    );
    assert_eq!(client.plus_monthly().await.map(|_| ()), expected);
}

#[tokio::test]
async fn a_server_error_is_unavailable_with_its_status() {
    let (client, upstream) = serve(vec![reply(500, "boom")]).await;
    let expected = Err(UpstreamError::unavailable("Sony upstream returned 500"));
    assert_eq!(
        client
            .concepts_by_feature(SonyFeature::New, 10, 0)
            .await
            .map(|_| ()),
        expected
    );
    assert_eq!(upstream.seen().len(), 2, "a 5xx answer is retried once");
    assert_eq!(
        client.product_price("EP0001-X".into()).await.map(|_| ()),
        expected
    );
    assert_eq!(client.plus_monthly().await.map(|_| ()), expected);
}

#[tokio::test]
async fn a_client_error_is_not_retried() {
    let (client, upstream) = serve(vec![reply(404, "")]).await;
    assert_eq!(
        client.product_detail(SKU.into()).await,
        Err(UpstreamError::unavailable("Sony upstream returned 404"))
    );
    assert_eq!(upstream.seen().len(), 1);
}

#[tokio::test]
async fn a_body_that_is_not_json_is_unavailable() {
    let (client, _) = serve(vec![reply(200, "<html>")]).await;
    assert_eq!(
        client.product_detail(SKU.into()).await,
        Err(UpstreamError::unavailable(
            "Sony upstream returned a body that is not JSON"
        ))
    );
}

#[tokio::test]
async fn the_price_request_has_the_operation_hash_and_locale() {
    let (client, upstream) = serve(vec![json_reply(
        &json!({"data": {"productRetrieve": {"webctas": []}}}),
    )])
    .await;
    let price = client.product_price("EP0001-X".into()).await.unwrap();
    assert_eq!(price, crate::domain::catalog::ProductPrice::default());
    let seen = upstream.seen();
    let request = &seen[0];
    assert_eq!(request.path, "/api/graphql/v1/op");
    assert_eq!(
        request.param("operationName"),
        Some("productRetrieveForCtasWithPrice")
    );
    assert_eq!(
        request.param("variables"),
        Some(r#"{"productId":"EP0001-X"}"#)
    );
    assert_eq!(
        request.param("extensions"),
        Some(
            r#"{"persistedQuery":{"version":1,"sha256Hash":"1f0ca607e170abbfb7d67bd76c9bbc97f21fe2e807be49e5fe764e14566cb605"}}"#
        )
    );
    assert_eq!(
        request.header("x-apollo-operation-name"),
        Some("productRetrieveForCtasWithPrice")
    );
    assert_eq!(request.header("x-psn-store-locale-override"), Some("en-FI"));
    assert_eq!(request.header("accept"), Some("application/json"));
    assert_eq!(request.header("cookie"), None);
    assert_eq!(request.header("authorization"), None);
}

#[tokio::test]
async fn the_price_answer_gives_the_plus_offer() {
    let (client, _) = serve(vec![json_reply(
        &json!({"data": {"productRetrieve": {"webctas": [{
            "type": "UPSELL_PS_PLUS_DISCOUNT",
            "price": {
                "applicability": "UPSELL",
                "serviceBranding": ["PS_PLUS"],
                "isTiedToSubscription": false,
                "discountedPrice": "€44,95"
            }
        }]}}}),
    )])
    .await;
    let price = client.product_price("EP0001-X".into()).await.unwrap();
    assert_eq!(
        price.plus_offer,
        Some(PlusOffer::Price {
            price: "€44,95".into()
        })
    );
}

#[tokio::test]
async fn the_grid_request_has_the_feature_variables() {
    let (client, upstream) = serve(vec![json_reply(
        &json!({"data": {"categoryGridRetrieve": {"concepts": []}}}),
    )])
    .await;
    client
        .concepts_by_feature(SonyFeature::New, 300, 0)
        .await
        .unwrap();
    let seen = upstream.seen();
    assert_eq!(seen[0].param("operationName"), Some("categoryGridRetrieve"));
    assert_eq!(
        seen[0].param("variables"),
        Some(
            r#"{"id":"d0446d4b-dc9a-4f1e-86ec-651f099c9b29","locale":"en-fi","pageArgs":{"size":300,"offset":0},"sortBy":{"name":"conceptReleaseDate","isAscending":false},"filterBy":["targetPlatforms:PS5","conceptReleaseDate:last_thirty_days"],"facetOptions":[]}"#
        )
    );
    assert_eq!(
        seen[0].header("x-apollo-operation-name"),
        Some("categoryGridRetrieve")
    );
}

#[tokio::test]
async fn the_monthly_request_is_anonymous_and_warns_on_an_empty_list() {
    let (client, upstream) = serve(vec![json_reply(
        &json!([{"catalogKey": "A", "count": 0, "games": []}]),
    )])
    .await;
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    assert_eq!(client.plus_monthly().await, Ok(vec![]));
    let seen = upstream.seen();
    assert_eq!(seen[0].path, "/bin/imagic/gameslist");
    assert_eq!(seen[0].param("locale"), Some("en-fi"));
    assert_eq!(
        seen[0].param("categoryList"),
        Some("plus-monthly-games-list")
    );
    assert_eq!(seen[0].header("cookie"), None);
    assert_eq!(seen[0].header("authorization"), None);
    assert_eq!(seen[0].header("x-apollo-operation-name"), None);
    assert!(log_with(&logs, "sony.plusMonthly.empty").is_some());
}

#[tokio::test]
async fn a_monthly_body_that_is_not_a_list_fails_with_a_drift_warning() {
    let (client, _) = serve(vec![json_reply(&json!({"unexpected": true}))]).await;
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    assert_eq!(
        client.plus_monthly().await,
        Err(UpstreamError::unavailable(
            "PS Plus monthly list has an unexpected shape"
        ))
    );
    let line = log_with(&logs, "sony.plusMonthly.drift").unwrap();
    assert_eq!(line["level"], "WARN");
}

#[tokio::test]
async fn search_browse_and_genre_drift_fail_instead_of_reading_empty() {
    let (client, _) = serve(vec![json_reply(&json!({"data": {}}))]).await;
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    assert_eq!(
        client.search_page("zq-secret-term".into(), 0, 50).await,
        Err(UpstreamError::unavailable(
            "Sony search response has an unexpected shape"
        ))
    );
    let browse = BrowseRequest {
        genre: GenreKey::parse("ACTION").unwrap(),
        order: BrowseOrder::Newest,
        offset: 0,
        size: 60,
    };
    assert_eq!(
        client.browse_page(browse).await,
        Err(UpstreamError::unavailable(
            "Sony browse grid has an unexpected shape"
        ))
    );
    assert_eq!(
        client.genres().await,
        Err(UpstreamError::unavailable(
            "Sony genre facet has an unexpected shape"
        ))
    );
    for event in [
        "sony.search.drift",
        "sony.browse.drift",
        "sony.genres.drift",
    ] {
        assert!(log_with(&logs, event).is_some(), "{event}");
    }
    assert!(!logs.text().contains("zq-secret-term"));
}

#[tokio::test]
async fn the_search_request_narrows_the_page_and_never_logs_the_term() {
    let (client, upstream) = serve(vec![json_reply(&json!({"data": {"universalSearch": {
        "pageInfo": {"isLast": false},
        "results": [
            {"__typename": "Product", "id": SKU, "platforms": ["PS5"], "storeDisplayClassification": "FULL_GAME"},
            {"__typename": "Product", "id": "EP0001-CUSA00001_00-PS4ONLY000000000", "platforms": ["PS4"], "storeDisplayClassification": "FULL_GAME"},
            {"__typename": "Unknown"}
        ]
    }}}))])
    .await;
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    let page = client
        .search_page("zq secret".into(), 50, 25)
        .await
        .unwrap();
    assert_eq!(page.candidates.len(), 1);
    assert!(!page.is_last);
    assert_eq!(page.raw_count, 3);
    let seen = upstream.seen();
    assert_eq!(
        seen[0].param("variables"),
        Some(
            r#"{"countryCode":"FI","languageCode":"en","nextCursor":"","pageOffset":50,"pageSize":25,"searchTerm":"zq secret"}"#
        )
    );
    let line = log_with(&logs, "sony.search.elementDrift").unwrap();
    assert_eq!(line["dropped"], 1);
    assert_eq!(line["kept"], 2);
    assert!(!logs.text().contains("zq secret"));
    assert!(!logs.text().contains(SKU));
}

#[tokio::test]
async fn the_browse_and_genre_requests_carry_their_variables() {
    let golden = super::fixture("categoryGridBrowse.golden.json");
    let (client, upstream) = serve(vec![json_reply(&golden)]).await;
    let page = client
        .browse_page(BrowseRequest {
            genre: GenreKey::parse("MUSIC/RHYTHM").unwrap(),
            order: BrowseOrder::MostDownloaded,
            offset: 60,
            size: 60,
        })
        .await
        .unwrap();
    assert_eq!(page.concepts.len(), 3);
    assert!(!page.is_last);
    let genres = client.genres().await.unwrap();
    assert_eq!(genres.len(), 35);
    let seen = upstream.seen();
    assert!(
        seen[0]
            .param("variables")
            .unwrap()
            .contains(r#""sortBy":{"name":"downloads30","isAscending":false},"filterBy":["targetPlatforms:PS5","conceptGenres:MUSIC/RHYTHM"]"#)
    );
    assert!(
        seen[1]
            .param("variables")
            .unwrap()
            .contains(r#""pageArgs":{"size":0,"offset":0},"sortBy":null"#)
    );
}
