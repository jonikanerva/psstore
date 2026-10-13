//! The Sony account adapter: the NPSSO exchange and the signed-in lists
//! (STACK.md §14). Port of the signed-in account client of
//! `server/src/sony/sonyClient.ts`.
//!
//! Credential rules:
//!
//! - The NPSSO, the one-time code, and the access token are [`Secret`]
//!   values. The raw value is read only where it goes into the outbound
//!   request: the NPSSO into the `Cookie` header of the authorize call, the
//!   code into the token request body, and the token into the `Authorization`
//!   header of a library call. Both credential headers are marked sensitive.
//! - The client has no cookie store. It never forwards, stores, or reads a
//!   Sony `Set-Cookie` header.
//! - The client follows no redirect. The authorize call reads the code from
//!   the `Location` of its 302 answer. Any other 3xx answer is a failure, so
//!   a redirect never carries a credential to another URL.
//! - No call retries. Each failure has a fixed message: no header, redirect
//!   target, code, or token reaches an error, a log, or a response.

mod fields;
mod purchased;
mod session;
mod wishlist;

#[cfg(test)]
mod tests;

use std::time::Duration;

use reqwest::header::{ACCEPT, AUTHORIZATION, COOKIE, HeaderValue, LOCATION};
use serde::Serialize;
use serde_json::Value;

use super::catalog::locale_override;
use super::contract::SonyContract;
use super::graphql_errors::is_persisted_query_rotation;
use crate::application::ServiceFuture;
use crate::application::account::SonyAccount;
use crate::domain::errors::{AccountError, UpstreamError};
use crate::domain::library::{PurchasedEntry, WishlistEntry, dedupe_purchased};
use crate::domain::secret::Secret;
use crate::sources::transport::{self, Answer, Attempts, Redirects, TransportError};
use wishlist::WishlistOutcome;

/// The games per library page.
pub const PURCHASED_PAGE_SIZE: usize = 100;
/// The most library pages per request. A library that needs more pages fails
/// the request instead of showing a truncated list.
pub const PURCHASED_MAX_PAGES: usize = 20;

const SIGN_IN_UNAVAILABLE: &str = "Sony sign-in unavailable";
const SIGN_IN_REJECTED: &str = "Sony rejected the sign-in";
const SIGN_IN_UNEXPECTED: &str = "Sony sign-in answered unexpectedly";
const SIGN_IN_TIMED_OUT: &str = "Sony sign-in timed out";
const RATE_LIMITED: &str = "Sony sign-in rate limited the request (HTTP 429)";
const QUERY_ROTATED: &str =
    "Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh";
const LIBRARY_DRIFT: &str = "Sony library list has an unexpected shape";
const LIBRARY_TOO_LARGE: &str = "Sony library list exceeds the supported size";
const LIBRARY_TIMED_OUT: &str = "Sony library list timed out";
const WISHLIST_DRIFT: &str = "Sony wishlist has an unexpected shape";
const WISHLIST_TIMED_OUT: &str = "Sony wishlist timed out";

/// The deadlines of the account calls. Tests use shorter values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountTiming {
    /// The deadline of one HTTP call, including its body.
    pub call_timeout: Duration,
    /// The longest `Retry-After` delay that a 429 failure reports.
    pub retry_after_max: Duration,
    /// The deadline of the whole NPSSO exchange.
    pub exchange_deadline: Duration,
    /// The deadline of the whole library crawl.
    pub purchased_deadline: Duration,
    /// The deadline of the wishlist call.
    pub wishlist_deadline: Duration,
}

impl Default for AccountTiming {
    /// The values of the TypeScript server.
    fn default() -> Self {
        Self {
            call_timeout: Duration::from_secs(6),
            retry_after_max: Duration::from_secs(6),
            exchange_deadline: Duration::from_secs(15),
            purchased_deadline: Duration::from_secs(30),
            wishlist_deadline: Duration::from_secs(15),
        }
    }
}

/// The Sony account client.
pub struct SonyAccountClient {
    client: reqwest::Client,
    contract: SonyContract,
    /// The `x-psn-store-locale-override` value from `SONY_LOCALE`: English
    /// content from the Finnish store (STACK.md §9), like the store adapter.
    locale: String,
    timing: AccountTiming,
}

impl std::fmt::Debug for SonyAccountClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SonyAccountClient")
            .field("timing", &self.timing)
            .finish_non_exhaustive()
    }
}

/// The call whose failure is mapped. The calls differ in the statuses that
/// prove a rejection of the credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Call {
    Authorize,
    Token,
    Purchased,
    Wishlist,
}

impl SonyAccountClient {
    /// A client that follows no redirect. `https_only` is off only in tests
    /// with local servers.
    pub fn new(
        contract: SonyContract,
        timing: AccountTiming,
        https_only: bool,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: transport::build_client(Redirects::Manual, https_only)?,
            locale: locale_override(&contract.locale),
            contract,
            timing,
        })
    }

    fn attempts(&self) -> Attempts {
        Attempts {
            timeout: self.timing.call_timeout,
            retries: 0,
            retry_after_max: self.timing.retry_after_max,
        }
    }

    async fn exchange(&self, npsso: Secret) -> Result<Secret, AccountError> {
        within(self.timing.exchange_deadline, SIGN_IN_TIMED_OUT, async {
            let code = self.authorize(&npsso).await?;
            self.request_token(&code).await
        })
        .await
    }

    /// The one-time code of the authorize redirect. A 302 answer without a
    /// code is the definitive rejection of the NPSSO.
    async fn authorize(&self, npsso: &Secret) -> Result<Secret, AccountError> {
        let contract = &self.contract;
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("access_type", "offline")
            .append_pair("client_id", &contract.auth_client_id)
            .append_pair("redirect_uri", &contract.auth_redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", &contract.auth_scope)
            .finish();
        let url = format!("{}/authorize?{query}", contract.auth_base_url);
        // The only header with the NPSSO. No other cookie is sent.
        let mut cookie = HeaderValue::from_str(&format!("npsso={}", npsso.expose()))
            .map_err(|_| unavailable(SIGN_IN_UNAVAILABLE))?;
        cookie.set_sensitive(true);
        let answer = transport::send(
            || self.client.get(&url).header(COOKIE, cookie.clone()),
            self.attempts(),
            Redirects::Manual,
        )
        .await
        .map_err(|error| self.call_failed(error, Call::Authorize))?;
        if answer.status != 302 {
            return Err(unavailable(SIGN_IN_UNEXPECTED));
        }
        let location = answer
            .headers
            .get(LOCATION)
            .and_then(|value| value.to_str().ok());
        session::access_code(location, &contract.auth_redirect_uri).ok_or_else(rejected)
    }

    /// The access token for the one-time code. A 401 or 403 answer is the
    /// definitive rejection.
    async fn request_token(&self, code: &Secret) -> Result<Secret, AccountError> {
        let contract = &self.contract;
        let url = format!("{}/token", contract.auth_base_url);
        let mut basic = HeaderValue::from_str(&contract.auth_basic_header)
            .map_err(|_| unavailable(SIGN_IN_UNAVAILABLE))?;
        basic.set_sensitive(true);
        let form = [
            ("code", code.expose()),
            ("redirect_uri", contract.auth_redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("token_format", "jwt"),
        ];
        let answer = transport::send(
            || {
                self.client
                    .post(&url)
                    .header(AUTHORIZATION, basic.clone())
                    .form(form.as_slice())
            },
            self.attempts(),
            Redirects::Manual,
        )
        .await
        .map_err(|error| self.call_failed(error, Call::Token))?;
        session::access_token(json_body(&answer)?).ok_or_else(|| unavailable(SIGN_IN_UNEXPECTED))
    }

    /// One persisted-query GET with the access token.
    async fn graphql(
        &self,
        access_token: &Secret,
        operation: &str,
        hash: &str,
        variables: &str,
        call: Call,
    ) -> Result<Value, AccountError> {
        let extensions = serde_json::to_string(&Extensions {
            persisted_query: PersistedQuery {
                version: 1,
                sha256_hash: hash,
            },
        })
        .map_err(|_| unavailable(SIGN_IN_UNAVAILABLE))?;
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("operationName", operation)
            .append_pair("variables", variables)
            .append_pair("extensions", &extensions)
            .finish();
        let url = format!("{}?{query}", self.contract.graphql_url);
        let answer = transport::send(
            || {
                self.client
                    .get(&url)
                    .header(ACCEPT, "application/json")
                    .bearer_auth(access_token.expose())
                    .header("x-apollo-operation-name", operation)
                    .header("x-psn-store-locale-override", &self.locale)
            },
            self.attempts(),
            Redirects::Manual,
        )
        .await
        .map_err(|error| self.call_failed(error, call))?;
        json_body(&answer)
    }

    /// Reads the library pages in sequence until a page is not full.
    async fn purchased(&self, access_token: Secret) -> Result<Vec<PurchasedEntry>, AccountError> {
        within(self.timing.purchased_deadline, LIBRARY_TIMED_OUT, async {
            let contract = &self.contract;
            let mut collected = Vec::new();
            for page in 0..PURCHASED_MAX_PAGES {
                let variables = serde_json::to_string(&PurchasedVariables::page(page))
                    .map_err(|_| unavailable(SIGN_IN_UNAVAILABLE))?;
                let body = self
                    .graphql(
                        &access_token,
                        &contract.purchased_operation,
                        &contract.purchased_hash,
                        &variables,
                        Call::Purchased,
                    )
                    .await?;
                if is_persisted_query_rotation(&body) {
                    return Err(query_rotated(&contract.purchased_operation));
                }
                let Some(outcome) = purchased::parse_page(&body) else {
                    tracing::warn!("sony purchased list drift");
                    return Err(unavailable(LIBRARY_DRIFT));
                };
                if outcome.dropped > 0 {
                    tracing::warn!(
                        dropped = outcome.dropped,
                        kept = outcome.entries.len(),
                        "sony purchased list element drift"
                    );
                }
                // A full page is counted before the scope filter.
                let last = outcome.raw_count < PURCHASED_PAGE_SIZE;
                collected.extend(outcome.entries);
                if last {
                    return Ok(dedupe_purchased(collected));
                }
            }
            // The last allowed page was still full, so more games can exist.
            // A truncated library is never shown as complete.
            Err(unavailable(LIBRARY_TOO_LARGE))
        })
        .await
    }

    /// The wishlist in one request. Sony paginates nothing.
    async fn wishlist(&self, access_token: Secret) -> Result<Vec<WishlistEntry>, AccountError> {
        within(self.timing.wishlist_deadline, WISHLIST_TIMED_OUT, async {
            let contract = &self.contract;
            let body = self
                .graphql(
                    &access_token,
                    &contract.wishlist_operation,
                    &contract.wishlist_hash,
                    "{}",
                    Call::Wishlist,
                )
                .await?;
            if is_persisted_query_rotation(&body) {
                return Err(query_rotated(&contract.wishlist_operation));
            }
            match wishlist::parse(&body) {
                WishlistOutcome::Denied => Err(rejected()),
                WishlistOutcome::Drift => {
                    tracing::warn!("sony wishlist drift");
                    Err(unavailable(WISHLIST_DRIFT))
                }
                WishlistOutcome::Listed(page) => {
                    if page.dropped > 0 || page.out_of_scope > 0 {
                        tracing::warn!(
                            dropped = page.dropped,
                            out_of_scope = page.out_of_scope,
                            kept = page.entries.len(),
                            "sony wishlist element drift"
                        );
                    }
                    Ok(page.entries)
                }
            }
        })
        .await
    }

    /// Maps a transport failure. Only a 401 or 403 answer of the token call
    /// or a library call is a rejection. A 4xx answer of the authorize call
    /// is an outage, because only its redirect proves a rejection.
    fn call_failed(&self, error: TransportError, call: Call) -> AccountError {
        match (error, call) {
            (TransportError::RateLimited { retry_after }, _) => rate_limited(retry_after),
            // Sony answers 400 for a persisted query that it does not
            // whitelist.
            (TransportError::Status(400), Call::Wishlist) => {
                query_rotated(&self.contract.wishlist_operation)
            }
            (TransportError::Status(401 | 403), Call::Token | Call::Purchased | Call::Wishlist) => {
                rejected()
            }
            _ => unavailable(SIGN_IN_UNAVAILABLE),
        }
    }
}

impl SonyAccount for SonyAccountClient {
    fn exchange_npsso(&self, npsso: Secret) -> ServiceFuture<'_, Result<Secret, AccountError>> {
        Box::pin(self.exchange(npsso))
    }

    fn purchased_games(
        &self,
        access_token: Secret,
    ) -> ServiceFuture<'_, Result<Vec<PurchasedEntry>, AccountError>> {
        Box::pin(self.purchased(access_token))
    }

    fn wishlist_games(
        &self,
        access_token: Secret,
    ) -> ServiceFuture<'_, Result<Vec<WishlistEntry>, AccountError>> {
        Box::pin(self.wishlist(access_token))
    }
}

/// The persisted-query extension. The field order matches the TypeScript
/// `JSON.stringify` output.
#[derive(Serialize)]
struct Extensions<'a> {
    #[serde(rename = "persistedQuery")]
    persisted_query: PersistedQuery<'a>,
}

#[derive(Serialize)]
struct PersistedQuery<'a> {
    version: u8,
    #[serde(rename = "sha256Hash")]
    sha256_hash: &'a str,
}

/// The variables of one library page, in the TypeScript field order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PurchasedVariables {
    is_active: bool,
    platform: [&'static str; 1],
    size: usize,
    start: usize,
    sort_by: &'static str,
    sort_direction: &'static str,
}

impl PurchasedVariables {
    fn page(page: usize) -> Self {
        Self {
            is_active: true,
            platform: ["ps5"],
            size: PURCHASED_PAGE_SIZE,
            start: page * PURCHASED_PAGE_SIZE,
            sort_by: "ACTIVE_DATE",
            sort_direction: "desc",
        }
    }
}

/// Runs `work` with a deadline. A late call fails with `message`.
async fn within<T>(
    limit: Duration,
    message: &'static str,
    work: impl Future<Output = Result<T, AccountError>>,
) -> Result<T, AccountError> {
    tokio::time::timeout(limit, work)
        .await
        .unwrap_or_else(|_| Err(unavailable(message)))
}

/// The JSON body of a 2xx answer. A 3xx answer, which only the manual
/// redirect policy returns, and a body that is not JSON are outages.
fn json_body(answer: &Answer) -> Result<Value, AccountError> {
    if !(200..300).contains(&answer.status) {
        return Err(unavailable(SIGN_IN_UNAVAILABLE));
    }
    serde_json::from_slice(&answer.body).map_err(|_| unavailable(SIGN_IN_UNAVAILABLE))
}

fn unavailable(message: &'static str) -> AccountError {
    AccountError::Upstream(UpstreamError::unavailable(message))
}

fn rejected() -> AccountError {
    AccountError::session_rejected(SIGN_IN_REJECTED)
}

fn rate_limited(retry_after: Option<Duration>) -> AccountError {
    AccountError::Upstream(UpstreamError::RateLimited {
        message: RATE_LIMITED.to_owned(),
        // The TypeScript server rounds the delay up to whole seconds.
        retry_after_seconds: retry_after
            .map(|delay| delay.as_secs() + u64::from(delay.subsec_nanos() > 0)),
    })
}

fn query_rotated(operation: &str) -> AccountError {
    AccountError::Upstream(UpstreamError::QueryRotated {
        message: QUERY_ROTATED.to_owned(),
        operation_name: operation.to_owned(),
    })
}
