//! The IGDB critic score adapter (STACK.md → 2.3 Outbound sources).
//!
//! The adapter follows `server/src/igdb/igdbClient.ts`. IGDB receives only the
//! public Sony title and a release-year range. The client gets a Twitch app
//! access token with the client-credentials grant. The client secret and the
//! token are [`Secret`](crate::domain::secret::Secret) values: they go into the
//! token request body and the `Authorization` header only, never into a URL,
//! a log, or an error value. The client never follows a redirect, so neither
//! value can reach another host.

mod query;
mod schema;

#[cfg(test)]
mod tests;

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use reqwest::header::{ACCEPT, CONTENT_TYPE, HeaderValue};

pub use query::{IGDB_CANDIDATE_LIMIT, games_query, quote_title};
pub use schema::{IgdbToken, decode_json, parse_games_response, parse_token_response};

use crate::application::ServiceFuture;
use crate::application::cache::TtlCache;
use crate::application::critic_scores::{CriticSource, CriticSourceError};
use crate::config::IgdbCredentials;
use crate::domain::critic_match::CriticCandidate;
use crate::sources::transport::{self, Attempts, Redirects, TransportError};

/// The Twitch token endpoint.
pub const IGDB_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";

/// The IGDB games endpoint.
pub const IGDB_GAMES_URL: &str = "https://api.igdb.com/v4/games";

/// The deadline of one provider call.
pub const IGDB_TIMEOUT: Duration = Duration::from_millis(1500);

/// A cached token is replaced this long before Twitch says that it expires.
pub const TOKEN_EXPIRY_MARGIN_SECONDS: f64 = 300.0;

/// A failed token request is cached this long, so that an outage is not
/// retried on every game page.
pub const TOKEN_FAILURE_TTL: Duration = Duration::from_secs(30);

/// The longest time that a token stays cached. The cache adds the time to
/// live to the current time, so an unbounded `expires_in` must not reach it.
/// Twitch app tokens live about 60 days.
const TOKEN_TTL_MAX: Duration = Duration::from_hours(8760);

/// One attempt per call, as in the TypeScript server. Without a retry, a 429
/// answer fails at once and no `Retry-After` delay applies.
const ATTEMPTS: Attempts = Attempts {
    timeout: IGDB_TIMEOUT,
    retries: 0,
    retry_after_max: Duration::ZERO,
};

/// The IGDB client. It holds one token in memory; concurrent callers share
/// one token request.
pub struct IgdbClient {
    http: reqwest::Client,
    credentials: IgdbCredentials,
    token_url: String,
    games_url: String,
    /// The token cache. The key is a generation number: a new generation
    /// drops the token that IGDB rejected. The capacity of one evicts the
    /// older generation.
    tokens: TtlCache<u64, IgdbToken, CriticSourceError>,
    generation: AtomicU64,
}

impl fmt::Debug for IgdbClient {
    /// The output names no credential, not even the client id (STACK.md §8).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IgdbClient")
            .field("token_url", &self.token_url)
            .field("games_url", &self.games_url)
            .finish_non_exhaustive()
    }
}

impl IgdbClient {
    /// The production client: HTTPS only, no redirects, and the fixed
    /// endpoints.
    ///
    /// # Errors
    ///
    /// The HTTP client could not be built (the TLS set-up failed).
    pub fn new(credentials: IgdbCredentials) -> Result<Self, reqwest::Error> {
        let http = transport::build_client(Redirects::Manual, true)?;
        Ok(Self::with_endpoints(
            http,
            credentials,
            IGDB_TOKEN_URL,
            IGDB_GAMES_URL,
        ))
    }

    /// A client with other endpoints, for tests with a local server.
    pub(crate) fn with_endpoints(
        http: reqwest::Client,
        credentials: IgdbCredentials,
        token_url: impl Into<String>,
        games_url: impl Into<String>,
    ) -> Self {
        Self {
            http,
            credentials,
            token_url: token_url.into(),
            games_url: games_url.into(),
            tokens: TtlCache::new(1, token_ttl),
            generation: AtomicU64::new(0),
        }
    }

    async fn find(
        &self,
        title: &str,
        year: i32,
    ) -> Result<Vec<CriticCandidate>, CriticSourceError> {
        let Some(query) = games_query(title, year) else {
            return Ok(Vec::new());
        };
        let generation = self.generation.load(Ordering::Acquire);
        match self.attempt(generation, &query).await {
            Err(CriticSourceError::Rejected) => {
                // IGDB or Twitch rejected the token or the credentials. Drop
                // the token and repeat the call once with a new one. Only the
                // first caller that saw this generation moves it on, so
                // concurrent callers share one new token request. A failed
                // exchange means that another caller moved it on first.
                self.generation
                    .compare_exchange(
                        generation,
                        generation.wrapping_add(1),
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    )
                    .ok();
                let next = self.generation.load(Ordering::Acquire);
                self.attempt(next, &query).await
            }
            other => other,
        }
    }

    async fn attempt(
        &self,
        generation: u64,
        query: &str,
    ) -> Result<Vec<CriticCandidate>, CriticSourceError> {
        let token = self.token(generation).await?;
        request_games(
            &self.http,
            &self.games_url,
            &self.credentials.client_id,
            &token,
            query,
        )
        .await
    }

    async fn token(&self, generation: u64) -> Result<IgdbToken, CriticSourceError> {
        let http = self.http.clone();
        let url = self.token_url.clone();
        let credentials = self.credentials.clone();
        self.tokens
            .get_with(generation, move || async move {
                request_token(&http, &url, &credentials).await
            })
            .await
    }
}

impl CriticSource for IgdbClient {
    fn find_games<'a>(
        &'a self,
        title: &'a str,
        year: i32,
    ) -> ServiceFuture<'a, Result<Vec<CriticCandidate>, CriticSourceError>> {
        Box::pin(self.find(title, year))
    }
}

/// The time to live of a token request outcome: the token until its expiry
/// minus the margin, a failure for 30 seconds.
fn token_ttl(outcome: &Result<IgdbToken, CriticSourceError>) -> Duration {
    match outcome {
        Ok(token) => {
            let seconds = (token.expires_in_seconds - TOKEN_EXPIRY_MARGIN_SECONDS).max(0.0);
            Duration::try_from_secs_f64(seconds).map_or(TOKEN_TTL_MAX, |ttl| ttl.min(TOKEN_TTL_MAX))
        }
        Err(_) => TOKEN_FAILURE_TTL,
    }
}

/// A 400, 401, or 403 answer is a rejection: the credentials or the token are
/// not valid. Every other failure is an outage.
fn classify(error: TransportError) -> CriticSourceError {
    match error {
        TransportError::Status(400 | 401 | 403) => CriticSourceError::Rejected,
        TransportError::Status(_) | TransportError::RateLimited { .. } | TransportError::Failed => {
            CriticSourceError::Unavailable
        }
    }
}

/// The JSON body of a 2xx answer. A 3xx answer (redirects are not followed)
/// or a body that is not JSON is an outage.
fn json_body(answer: &transport::Answer) -> Result<serde_json::Value, CriticSourceError> {
    if !(200..300).contains(&answer.status) {
        return Err(CriticSourceError::Unavailable);
    }
    decode_json(&answer.body).ok_or(CriticSourceError::Unavailable)
}

/// The client-credentials token request. The credentials travel in the form
/// body, never in the URL.
async fn request_token(
    http: &reqwest::Client,
    url: &str,
    credentials: &IgdbCredentials,
) -> Result<IgdbToken, CriticSourceError> {
    let form = [
        ("client_id", credentials.client_id.as_str()),
        ("client_secret", credentials.client_secret.expose()),
        ("grant_type", "client_credentials"),
    ];
    let answer = transport::send(
        || {
            http.post(url)
                .header(ACCEPT, "application/json")
                .form(&form)
        },
        ATTEMPTS,
        Redirects::Manual,
    )
    .await
    .map_err(classify)?;
    parse_token_response(&json_body(&answer)?).ok_or(CriticSourceError::Unavailable)
}

/// The games query. The body is the query text only: the title and the year
/// range.
async fn request_games(
    http: &reqwest::Client,
    url: &str,
    client_id: &str,
    token: &IgdbToken,
    query: &str,
) -> Result<Vec<CriticCandidate>, CriticSourceError> {
    let mut client_id =
        HeaderValue::from_str(client_id).map_err(|_| CriticSourceError::Unavailable)?;
    client_id.set_sensitive(true);
    let answer = transport::send(
        || {
            http.post(url)
                .header(ACCEPT, "application/json")
                .header("Client-ID", client_id.clone())
                .bearer_auth(token.access_token.expose())
                // Node `fetch` sets this content type for a string body.
                .header(CONTENT_TYPE, "text/plain;charset=UTF-8")
                .body(query.to_owned())
        },
        ATTEMPTS,
        Redirects::Manual,
    )
    .await
    .map_err(classify)?;
    parse_games_response(&json_body(&answer)?).ok_or(CriticSourceError::Unavailable)
}
