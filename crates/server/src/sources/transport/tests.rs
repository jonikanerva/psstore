use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use super::*;

const MAX: Duration = Duration::from_millis(50);

#[derive(Clone)]
struct Scripted {
    status: u16,
    retry_after: Option<&'static str>,
    delay: Duration,
    body_bytes: usize,
}

fn answer(status: u16) -> Scripted {
    Scripted {
        status,
        retry_after: None,
        delay: Duration::ZERO,
        body_bytes: 2,
    }
}

#[derive(Clone, Default)]
struct Script {
    queue: Arc<Mutex<VecDeque<Scripted>>>,
    calls: Arc<Mutex<usize>>,
}

impl Script {
    fn calls(&self) -> usize {
        *self.calls.lock().unwrap()
    }
}

async fn serve(answers: Vec<Scripted>) -> (SocketAddr, Script) {
    let script = Script {
        queue: Arc::new(Mutex::new(answers.into())),
        calls: Arc::default(),
    };
    let state = script.clone();
    let app = Router::new().route(
        "/op",
        get(move || {
            let state = state.clone();
            async move {
                *state.calls.lock().unwrap() += 1;
                let next = state.queue.lock().unwrap().pop_front();
                let Some(next) = next else {
                    return StatusCode::IM_A_TEAPOT.into_response();
                };
                tokio::time::sleep(next.delay).await;
                let mut response: Response = (
                    StatusCode::from_u16(next.status).unwrap(),
                    "x".repeat(next.body_bytes),
                )
                    .into_response();
                if let Some(value) = next.retry_after {
                    response
                        .headers_mut()
                        .insert(RETRY_AFTER, value.parse().unwrap());
                }
                response
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, script)
}

async fn call(
    addr: SocketAddr,
    retries: u32,
    redirects: Redirects,
) -> Result<Answer, TransportError> {
    let client = build_client(redirects, false).unwrap();
    let url = format!("http://{addr}/op");
    send(
        || client.get(&url),
        Attempts {
            timeout: Duration::from_millis(500),
            retries,
            retry_after_max: MAX,
        },
        redirects,
    )
    .await
}

#[tokio::test]
async fn retries_a_429_once_with_the_clamped_delay_then_fails_rate_limited() {
    let limited = Scripted {
        retry_after: Some("2"),
        ..answer(429)
    };
    let (addr, script) = serve(vec![limited.clone(), limited]).await;
    let started = tokio::time::Instant::now();
    let outcome = call(addr, 1, Redirects::Follow).await;
    assert_eq!(
        outcome.unwrap_err(),
        TransportError::RateLimited {
            retry_after: Some(MAX)
        }
    );
    assert_eq!(script.calls(), 2);
    assert!(
        started.elapsed() >= MAX,
        "the retry waits for the clamped delay"
    );
}

#[tokio::test]
async fn retries_a_429_at_once_without_retry_after() {
    let (addr, script) = serve(vec![answer(429), answer(200)]).await;
    let outcome = call(addr, 1, Redirects::Follow).await.unwrap();
    assert_eq!(outcome.status, 200);
    assert_eq!(script.calls(), 2);
}

#[tokio::test]
async fn returns_a_3xx_answer_when_redirects_are_manual() {
    let (addr, _) = serve(vec![answer(302)]).await;
    let outcome = call(addr, 0, Redirects::Manual).await.unwrap();
    assert_eq!(outcome.status, 302);
}

#[tokio::test]
async fn treats_a_final_3xx_answer_as_a_failure_when_redirects_are_followed() {
    let (addr, _) = serve(vec![answer(302)]).await;
    let outcome = call(addr, 0, Redirects::Follow).await;
    assert_eq!(outcome.unwrap_err(), TransportError::Status(302));
}

#[tokio::test]
async fn never_retries_a_4xx_answer() {
    let (addr, script) = serve(vec![answer(401), answer(200)]).await;
    let outcome = call(addr, 3, Redirects::Follow).await;
    assert_eq!(outcome.unwrap_err(), TransportError::Status(401));
    assert_eq!(script.calls(), 1);
}

#[tokio::test]
async fn retries_a_5xx_answer_within_the_budget() {
    let (addr, script) = serve(vec![answer(503), answer(200)]).await;
    let outcome = call(addr, 1, Redirects::Follow).await.unwrap();
    assert_eq!(outcome.status, 200);
    assert_eq!(outcome.body.as_ref(), b"xx");
    assert_eq!(script.calls(), 2);
}

#[tokio::test]
async fn reports_the_last_5xx_status_after_the_retries() {
    let (addr, script) = serve(vec![answer(503), answer(502)]).await;
    let outcome = call(addr, 1, Redirects::Follow).await;
    assert_eq!(outcome.unwrap_err(), TransportError::Status(502));
    assert_eq!(script.calls(), 2);
}

#[tokio::test]
async fn retries_a_timeout_and_then_fails() {
    let slow = Scripted {
        delay: Duration::from_secs(2),
        ..answer(200)
    };
    let (addr, script) = serve(vec![slow.clone(), slow]).await;
    let outcome = call(addr, 1, Redirects::Follow).await;
    assert_eq!(outcome.unwrap_err(), TransportError::Failed);
    assert_eq!(script.calls(), 2);
}

#[tokio::test]
async fn fails_an_answer_larger_than_the_body_limit() {
    let large = Scripted {
        body_bytes: MAX_BODY_BYTES + 1,
        ..answer(200)
    };
    let (addr, _) = serve(vec![large]).await;
    let outcome = call(addr, 0, Redirects::Follow).await;
    assert_eq!(outcome.unwrap_err(), TransportError::Failed);
}

#[test]
fn parses_only_delta_seconds_and_clamps_large_values() {
    let max = Duration::from_secs(6);
    assert_eq!(
        parse_retry_after_value("2", max),
        Some(Duration::from_secs(2))
    );
    assert_eq!(parse_retry_after_value("0", max), Some(Duration::ZERO));
    assert_eq!(
        parse_retry_after_value("  5  ", max),
        Some(Duration::from_secs(5))
    );
    assert_eq!(parse_retry_after_value("600", max), Some(max));
    assert_eq!(
        parse_retry_after_value("99999999999999999999999", max),
        Some(max)
    );
    for invalid in ["", "-3", "1.5", "soon", "Wed, 21 Oct 2026 07:28:00 GMT"] {
        assert_eq!(parse_retry_after_value(invalid, max), None, "{invalid}");
    }
}
