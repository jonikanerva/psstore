//! Outbound HTTP with a deadline per attempt and a bounded retry.
//!
//! This is the transport edge. It knows nothing about Sony or IGDB. It returns
//! a structured failure, and the adapters map that failure to their typed
//! errors. A failure never carries the text of a `reqwest` error, because that
//! text can contain a URL.

use std::time::Duration;

use axum::body::Bytes;
use reqwest::header::{HeaderMap, RETRY_AFTER};

/// The `User-Agent` of every outbound request.
pub const USER_AGENT: &str = concat!("psstore/", env!("CARGO_PKG_VERSION"));

/// The largest response body that an attempt reads. A larger body fails the
/// attempt, so one answer cannot exhaust the memory of the service.
pub const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

/// The connect timeout of every outbound client.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// How redirects are handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Redirects {
    /// Follow up to 10 redirects. A final 3xx answer is a failure.
    Follow,
    /// Do not follow. A 3xx answer is returned to the caller, which reads the
    /// `Location` header itself (the Sony sign-in exchange).
    Manual,
}

/// Builds an outbound client with Rustls, gzip decoding, and the service
/// `User-Agent`. `https_only` is off only in tests with local servers.
///
/// # Errors
///
/// The TLS set-up failed.
pub fn build_client(
    redirects: Redirects,
    https_only: bool,
) -> Result<reqwest::Client, reqwest::Error> {
    let policy = match redirects {
        Redirects::Follow => reqwest::redirect::Policy::limited(10),
        Redirects::Manual => reqwest::redirect::Policy::none(),
    };
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .https_only(https_only)
        .redirect(policy)
        .gzip(true)
        .build()
}

/// The retry budget of one call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Attempts {
    /// The deadline of one attempt, including the response body.
    pub timeout: Duration,
    /// Additional attempts after the first one.
    pub retries: u32,
    /// The longest `Retry-After` delay that a 429 answer may cause.
    pub retry_after_max: Duration,
}

/// A failed call. The `Display` texts are fixed: they show no URL, header,
/// or body.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TransportError {
    /// The service answered 429 and the retry budget is used up.
    #[error("the service limited the request rate")]
    RateLimited { retry_after: Option<Duration> },
    /// A non-2xx answer: a 4xx at once, other statuses after the retries.
    #[error("the service answered with an error status")]
    Status(u16),
    /// A timeout, a connection failure, or a body that is unreadable or too
    /// large, after the retries.
    #[error("the request to the service failed")]
    Failed,
}

/// A successful answer: a 2xx status, or a 3xx status with
/// [`Redirects::Manual`].
#[derive(Debug, Clone)]
pub struct Answer {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Bytes,
}

/// Sends the request that `build` makes, with the retry rules of the
/// TypeScript server:
///
/// - A 429 answer retries after its `Retry-After` delay, clamped to
///   `retry_after_max`, or at once without a usable header. After the last
///   attempt it fails with [`TransportError::RateLimited`].
/// - A 4xx answer fails at once. Repeating the request cannot change it.
/// - A 5xx answer, a timeout, or a connection failure retries.
///
/// # Errors
///
/// The [`TransportError`] of the last attempt.
pub async fn send(
    build: impl Fn() -> reqwest::RequestBuilder,
    attempts: Attempts,
    redirects: Redirects,
) -> Result<Answer, TransportError> {
    let mut attempt = 0;
    let mut last = TransportError::Failed;
    while attempt <= attempts.retries {
        let outcome = tokio::time::timeout(attempts.timeout, read(build())).await;
        let Ok(Ok(answer)) = outcome else {
            last = TransportError::Failed;
            attempt += 1;
            continue;
        };
        if answer.status == 429 {
            let retry_after = parse_retry_after(&answer.headers, attempts.retry_after_max);
            if attempt < attempts.retries {
                attempt += 1;
                if let Some(delay) = retry_after.filter(|d| !d.is_zero()) {
                    tokio::time::sleep(delay).await;
                }
                continue;
            }
            return Err(TransportError::RateLimited { retry_after });
        }
        let manual_redirect = redirects == Redirects::Manual && (300..400).contains(&answer.status);
        if (200..300).contains(&answer.status) || manual_redirect {
            return Ok(answer);
        }
        if (400..500).contains(&answer.status) {
            return Err(TransportError::Status(answer.status));
        }
        last = TransportError::Status(answer.status);
        attempt += 1;
    }
    Err(last)
}

/// One attempt: the answer with its whole body, or `Err` for a transport
/// failure. The error value is dropped on purpose: its text can contain a URL.
async fn read(request: reqwest::RequestBuilder) -> Result<Answer, ()> {
    let mut response = request.send().await.map_err(|_| ())?;
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Answer {
        status,
        headers,
        body: Bytes::from(body),
    })
}

/// Parses `Retry-After` in its delta-seconds form only. An absent, negative,
/// fractional, or HTTP-date value gives `None`: the caller retries at once and
/// never guesses. A larger delay is clamped to `max`, so a hostile header
/// cannot stall an interactive request.
pub fn parse_retry_after(headers: &HeaderMap, max: Duration) -> Option<Duration> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?;
    parse_retry_after_value(value, max)
}

fn parse_retry_after_value(value: &str, max: Duration) -> Option<Duration> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    // A very long digit run does not fit in u64. It is still a delay longer
    // than the maximum.
    let seconds = trimmed.parse::<u64>().unwrap_or(u64::MAX);
    Some(Duration::from_secs(seconds).min(max))
}

#[cfg(test)]
mod tests;
