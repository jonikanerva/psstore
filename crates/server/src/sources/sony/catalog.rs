//! The anonymous Sony store client (port of the anonymous `SonyClient` in
//! `server/src/sony/sonyClient.ts`): the category grids, the product detail
//! and price, search, BROWSE, the genre facet, and the PS Plus monthly feed.
//!
//! Each method sends one request with the request shape of the TypeScript
//! client, detects a persisted-query rotation, decodes and scopes the answer
//! at the boundary, and logs drift with counts only. A log line never holds a
//! URL, a search term, a product id, or a body.

mod grid;
mod json;
mod monthly;
mod product;
mod request;
mod search;

#[cfg(test)]
mod tests;

use std::time::Duration;

use serde_json::Value;

pub use self::grid::{
    BrowseOutcome, CategoryGridOutcome, GenresOutcome, extract_browse_page, extract_category_grid,
    extract_genres,
};
pub use self::monthly::{PlusMonthlyOutcome, parse_plus_monthly};
pub use self::product::{extract_product_detail, parse_product_price};
pub use self::request::{GridQuery, locale_override};
pub use self::search::{SearchOutcome, parse_search_response};
use crate::application::ServiceFuture;
/// The port that this client implements. It lives in `application`, so that
/// the service does not depend on this adapter.
pub use crate::application::games::SonyCatalog;
use crate::domain::catalog::{
    BrowsePage, BrowseRequest, Concept, PlusMonthlyEntry, ProductDetail, ProductPrice, SearchPage,
    SonyFeature,
};
use crate::domain::errors::UpstreamError;
use crate::domain::game::Genre;
use crate::domain::id::ProductId;
use crate::domain::listing::narrow_search_entries;
use crate::sources::sony::contract::SonyContract;
use crate::sources::sony::graphql_errors::is_persisted_query_rotation;
use crate::sources::transport::{self, Attempts, Redirects, TransportError};

/// The deadline of one Sony request attempt.
pub const SONY_TIMEOUT: Duration = Duration::from_millis(6000);
/// Additional attempts after the first one.
pub const SONY_RETRY_COUNT: u32 = 1;
/// The longest `Retry-After` delay before the retry: the attempt deadline,
/// so an upstream cannot stall an interactive request longer than that.
pub const SONY_RETRY_AFTER_MAX: Duration = SONY_TIMEOUT;
/// The PS Plus monthly games feed, outside the GraphQL contract.
pub const PLUS_MONTHLY_URL: &str = "https://www.playstation.com/bin/imagic/gameslist";
/// The category of the monthly feed.
pub const PLUS_MONTHLY_CATEGORY: &str = "plus-monthly-games-list";

const ROTATED_MESSAGE: &str =
    "Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh";

/// The Sony store client.
#[derive(Debug, Clone)]
pub struct SonyCatalogClient {
    http: reqwest::Client,
    contract: SonyContract,
    graphql_url: String,
    monthly_url: String,
    attempts: Attempts,
}

impl SonyCatalogClient {
    /// The production client: Sony's hosts over HTTPS only.
    ///
    /// # Errors
    ///
    /// The HTTP client could not be built (the TLS set-up failed).
    pub fn new(contract: &SonyContract) -> Result<Self, reqwest::Error> {
        Self::with_endpoints(
            contract,
            contract.graphql_url.clone(),
            PLUS_MONTHLY_URL.to_owned(),
            true,
        )
    }

    /// A client with other endpoints, for tests with a local server.
    ///
    /// # Errors
    ///
    /// The HTTP client could not be built (the TLS set-up failed).
    pub fn with_endpoints(
        contract: &SonyContract,
        graphql_url: String,
        monthly_url: String,
        https_only: bool,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            http: transport::build_client(Redirects::Follow, https_only)?,
            contract: contract.clone(),
            graphql_url,
            monthly_url,
            attempts: Attempts {
                timeout: SONY_TIMEOUT,
                retries: SONY_RETRY_COUNT,
                retry_after_max: SONY_RETRY_AFTER_MAX,
            },
        })
    }

    /// One persisted-query GET. The answer is untrusted until decoded.
    async fn graphql(
        &self,
        operation: &str,
        hash: &str,
        variables: String,
    ) -> Result<Value, UpstreamError> {
        let query = request::graphql_query(operation, hash, &variables)?;
        let url = format!("{}?{query}", self.graphql_url);
        let locale = locale_override(&self.contract.locale);
        let answer = transport::send(
            || {
                self.http
                    .get(url.as_str())
                    .header(reqwest::header::ACCEPT, "application/json")
                    .header("x-apollo-operation-name", operation)
                    .header("x-psn-store-locale-override", locale.as_str())
            },
            self.attempts,
            Redirects::Follow,
        )
        .await
        .map_err(upstream_error)?;
        json_body(&answer.body)
    }

    /// A GraphQL answer that is not a rotation.
    async fn graphql_checked(
        &self,
        operation: &str,
        hash: &str,
        variables: String,
    ) -> Result<Value, UpstreamError> {
        let json = self.graphql(operation, hash, variables).await?;
        if is_persisted_query_rotation(&json) {
            return Err(rotated(operation));
        }
        Ok(json)
    }

    /// The raw answer of one category grid request, checked for a rotation.
    /// The live check reads it to count the dropped elements.
    ///
    /// # Errors
    ///
    /// An outage, a rate limit, a rotated query hash, or a body that is not
    /// JSON.
    pub async fn category_grid_json(&self, query: &GridQuery) -> Result<Value, UpstreamError> {
        let variables = query.variables(&self.contract)?;
        self.graphql_checked(
            &self.contract.category_grid_operation,
            &self.contract.category_grid_hash,
            variables,
        )
        .await
    }

    async fn fetch_concepts(
        &self,
        feature: SonyFeature,
        size: usize,
        offset: usize,
    ) -> Result<Vec<Concept>, UpstreamError> {
        let json = self
            .category_grid_json(&GridQuery::Feature {
                feature,
                size,
                offset,
            })
            .await?;
        let operation = self.contract.category_grid_operation.as_str();
        match extract_category_grid(&json) {
            // A corrupt or absent node: an empty list for the user, and an
            // honest signal for the operator, so drift never reads as a
            // legitimately empty grid.
            CategoryGridOutcome::Drift => {
                tracing::warn!(
                    event = "sony.categoryGrid.drift",
                    feature = feature.as_str(),
                    operation,
                    "sony category grid drift"
                );
                Ok(vec![])
            }
            CategoryGridOutcome::Ok { concepts, dropped } => {
                if dropped > 0 {
                    tracing::warn!(
                        event = "sony.categoryGrid.elementDrift",
                        feature = feature.as_str(),
                        operation,
                        dropped = count(dropped),
                        kept = count(concepts.len()),
                        "sony category grid element drift"
                    );
                }
                Ok(concepts)
            }
        }
    }

    async fn fetch_product_detail(
        &self,
        product_id: ProductId,
    ) -> Result<ProductDetail, UpstreamError> {
        let json = self
            .graphql_checked(
                &self.contract.product_operation,
                &self.contract.product_hash,
                request::product_variables(product_id.as_str())?,
            )
            .await?;
        Ok(extract_product_detail(&json))
    }

    async fn fetch_product_price(
        &self,
        product_id: ProductId,
    ) -> Result<ProductPrice, UpstreamError> {
        let json = self
            .graphql_checked(
                &self.contract.product_price_operation,
                &self.contract.product_price_hash,
                request::product_variables(product_id.as_str())?,
            )
            .await?;
        Ok(parse_product_price(&json))
    }

    async fn fetch_search_page(
        &self,
        term: String,
        offset: usize,
        size: usize,
    ) -> Result<SearchPage, UpstreamError> {
        let json = self
            .graphql_checked(
                &self.contract.search_operation,
                &self.contract.search_hash,
                request::search_variables(&term, offset, size)?,
            )
            .await?;
        match parse_search_response(&json) {
            // A broken search fails, so it stays distinct from "no results".
            SearchOutcome::Drift => {
                tracing::warn!(event = "sony.search.drift", "sony search drift");
                Err(UpstreamError::unavailable(
                    "Sony search response has an unexpected shape",
                ))
            }
            SearchOutcome::Ok {
                entries,
                is_last,
                dropped,
            } => {
                let raw_count = entries.len() + dropped;
                if dropped > 0 {
                    tracing::warn!(
                        event = "sony.search.elementDrift",
                        dropped = count(dropped),
                        kept = count(entries.len()),
                        "sony search element drift"
                    );
                }
                Ok(SearchPage {
                    candidates: narrow_search_entries(entries),
                    is_last,
                    raw_count,
                })
            }
        }
    }

    async fn fetch_browse_page(&self, request: BrowseRequest) -> Result<BrowsePage, UpstreamError> {
        let size = request.size;
        let json = self.category_grid_json(&GridQuery::Browse(request)).await?;
        match extract_browse_page(&json, size) {
            BrowseOutcome::Drift => {
                tracing::warn!(event = "sony.browse.drift", "sony browse grid drift");
                Err(UpstreamError::unavailable(
                    "Sony browse grid has an unexpected shape",
                ))
            }
            BrowseOutcome::Ok {
                concepts,
                is_last,
                dropped,
            } => {
                if dropped > 0 {
                    tracing::warn!(
                        event = "sony.browse.elementDrift",
                        dropped = count(dropped),
                        kept = count(concepts.len()),
                        "sony browse grid element drift"
                    );
                }
                Ok(BrowsePage { concepts, is_last })
            }
        }
    }

    async fn fetch_genres(&self) -> Result<Vec<Genre>, UpstreamError> {
        let json = self.category_grid_json(&GridQuery::Genres).await?;
        match extract_genres(&json) {
            GenresOutcome::Drift => {
                tracing::warn!(event = "sony.genres.drift", "sony genre facet drift");
                Err(UpstreamError::unavailable(
                    "Sony genre facet has an unexpected shape",
                ))
            }
            GenresOutcome::Ok { genres, dropped } => {
                if dropped > 0 {
                    tracing::warn!(
                        event = "sony.genres.elementDrift",
                        dropped = count(dropped),
                        kept = count(genres.len()),
                        "sony genre facet element drift"
                    );
                }
                Ok(genres)
            }
        }
    }

    /// The anonymous monthly feed. Only `Accept` is sent; the country cookie
    /// of the answer is never stored or sent back.
    async fn fetch_plus_monthly(&self) -> Result<Vec<PlusMonthlyEntry>, UpstreamError> {
        let url = format!(
            "{}?{}",
            self.monthly_url,
            request::monthly_query(&self.contract.locale)
        );
        let answer = transport::send(
            || {
                self.http
                    .get(url.as_str())
                    .header(reqwest::header::ACCEPT, "application/json")
            },
            self.attempts,
            Redirects::Follow,
        )
        .await
        .map_err(upstream_error)?;
        let json = json_body(&answer.body)?;
        match parse_plus_monthly(&json) {
            PlusMonthlyOutcome::Drift => {
                tracing::warn!(event = "sony.plusMonthly.drift", "plus monthly list drift");
                Err(UpstreamError::unavailable(
                    "PS Plus monthly list has an unexpected shape",
                ))
            }
            PlusMonthlyOutcome::Ok {
                entries,
                dropped,
                out_of_scope,
            } => {
                if entries.is_empty() {
                    tracing::warn!(
                        event = "sony.plusMonthly.empty",
                        "plus monthly list has no PS5 games"
                    );
                } else if dropped > 0 {
                    tracing::warn!(
                        event = "sony.plusMonthly.elementDrift",
                        dropped = count(dropped),
                        kept = count(entries.len()),
                        "plus monthly list element drift"
                    );
                } else {
                    tracing::debug!(
                        out_of_scope = count(out_of_scope),
                        kept = count(entries.len()),
                        "plus monthly list decoded"
                    );
                }
                Ok(entries)
            }
        }
    }
}

impl SonyCatalog for SonyCatalogClient {
    fn concepts_by_feature(
        &self,
        feature: SonyFeature,
        size: usize,
        offset: usize,
    ) -> ServiceFuture<'_, Result<Vec<Concept>, UpstreamError>> {
        Box::pin(self.fetch_concepts(feature, size, offset))
    }

    fn product_detail(
        &self,
        product_id: ProductId,
    ) -> ServiceFuture<'_, Result<ProductDetail, UpstreamError>> {
        Box::pin(self.fetch_product_detail(product_id))
    }

    fn product_price(
        &self,
        product_id: ProductId,
    ) -> ServiceFuture<'_, Result<ProductPrice, UpstreamError>> {
        Box::pin(self.fetch_product_price(product_id))
    }

    fn search_page(
        &self,
        term: String,
        offset: usize,
        size: usize,
    ) -> ServiceFuture<'_, Result<SearchPage, UpstreamError>> {
        Box::pin(self.fetch_search_page(term, offset, size))
    }

    fn plus_monthly(&self) -> ServiceFuture<'_, Result<Vec<PlusMonthlyEntry>, UpstreamError>> {
        Box::pin(self.fetch_plus_monthly())
    }

    fn browse_page(
        &self,
        request: BrowseRequest,
    ) -> ServiceFuture<'_, Result<BrowsePage, UpstreamError>> {
        Box::pin(self.fetch_browse_page(request))
    }

    fn genres(&self) -> ServiceFuture<'_, Result<Vec<Genre>, UpstreamError>> {
        Box::pin(self.fetch_genres())
    }
}

/// A count as a log field value.
fn count(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

fn rotated(operation: &str) -> UpstreamError {
    UpstreamError::QueryRotated {
        message: ROTATED_MESSAGE.to_owned(),
        operation_name: operation.to_owned(),
    }
}

/// A transport failure as a typed error with a fixed message. A 429 after
/// the retry budget is a rate limit (HTTP 503); everything else is an outage
/// (HTTP 502).
fn upstream_error(error: TransportError) -> UpstreamError {
    match error {
        TransportError::RateLimited { retry_after } => UpstreamError::RateLimited {
            message: "Sony upstream rate limited the request (HTTP 429)".to_owned(),
            retry_after_seconds: retry_after
                .map(|delay| u64::try_from(delay.as_millis().div_ceil(1000)).unwrap_or(u64::MAX)),
        },
        TransportError::Status(status) => {
            UpstreamError::unavailable(format!("Sony upstream returned {status}"))
        }
        TransportError::Failed => UpstreamError::unavailable("Sony upstream unavailable"),
    }
}

/// The body as JSON. A body that is not JSON is an outage.
fn json_body(body: &[u8]) -> Result<Value, UpstreamError> {
    serde_json::from_slice(body)
        .map_err(|_| UpstreamError::unavailable("Sony upstream returned a body that is not JSON"))
}
