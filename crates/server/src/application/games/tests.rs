//! Service tests with a fake Sony store. They port `gamesService.test.ts`,
//! `gamesServiceBrowse.test.ts`, `gamesServiceMonthly.test.ts`,
//! `gamesServicePlusOffer.test.ts`, `gamesServiceProductFallback.test.ts`,
//! `gamesServiceReleaseSplit.test.ts`, and `gamesServiceSearch.test.ts`.
//!
//! Cache expiry runs on the paused Tokio clock; the wall clock of the lists
//! is a `FixedClock`.

mod browse;
mod lists;
mod lookup;
mod search;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use jiff::Timestamp;

use super::*;
use crate::application::FixedClock;
use crate::domain::catalog::{ConceptPrice, ConceptProductRef, Media};

pub(super) const PAST_DATE: &str = "2025-01-01T00:00:00Z";
pub(super) const FUTURE_DATE: &str = "2099-01-01T00:00:00Z";

type Respond<A, T> = Box<dyn Fn(A) -> Result<T, UpstreamError> + Send + Sync>;

/// The calls that the fake received.
#[derive(Debug, Default)]
pub(super) struct Calls {
    pub concepts: Vec<(SonyFeature, usize)>,
    pub details: Vec<String>,
    pub prices: Vec<String>,
    pub searches: Vec<(String, usize, usize)>,
    pub monthly: usize,
    pub browse: Vec<BrowseRequest>,
    pub genres: usize,
}

/// A fake Sony store driven by closures.
pub(super) struct FakeSony {
    pub concepts: Respond<SonyFeature, Vec<Concept>>,
    pub detail: Respond<String, ProductDetail>,
    pub price: Respond<String, ProductPrice>,
    pub search: Respond<(String, usize, usize), SearchPage>,
    pub monthly: Respond<(), Vec<PlusMonthlyEntry>>,
    pub browse: Respond<BrowseRequest, BrowsePage>,
    pub genres: Respond<(), Vec<Genre>>,
    /// A delay of each detail lookup, to measure the concurrency.
    pub detail_delay: Duration,
    pub calls: Mutex<Calls>,
    in_flight: AtomicUsize,
    pub peak: AtomicUsize,
}

pub(super) fn detail_at(date: Option<&str>) -> ProductDetail {
    ProductDetail {
        release_date: date.map(str::to_owned),
        store_display_classification: Some("FULL_GAME".into()),
        ..ProductDetail::default()
    }
}

impl Default for FakeSony {
    fn default() -> Self {
        Self {
            concepts: Box::new(|_| Ok(vec![])),
            detail: Box::new(|_| Ok(detail_at(Some(PAST_DATE)))),
            price: Box::new(|_| Ok(ProductPrice::default())),
            search: Box::new(|_| {
                Ok(SearchPage {
                    candidates: vec![],
                    is_last: true,
                    raw_count: 0,
                })
            }),
            monthly: Box::new(|()| Ok(vec![])),
            browse: Box::new(|_| {
                Ok(BrowsePage {
                    concepts: vec![],
                    is_last: true,
                })
            }),
            genres: Box::new(|()| Ok(vec![])),
            detail_delay: Duration::ZERO,
            calls: Mutex::default(),
            in_flight: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        }
    }
}

impl FakeSony {
    pub fn calls(&self) -> std::sync::MutexGuard<'_, Calls> {
        self.calls.lock().unwrap()
    }
}

fn ready<T: Send + 'static>(value: T) -> ServiceFuture<'static, T> {
    Box::pin(async move { value })
}

impl SonyCatalog for FakeSony {
    fn concepts_by_feature(
        &self,
        feature: SonyFeature,
        size: usize,
        _offset: usize,
    ) -> ServiceFuture<'_, Result<Vec<Concept>, UpstreamError>> {
        self.calls().concepts.push((feature, size));
        ready((self.concepts)(feature))
    }

    fn product_detail(
        &self,
        product_id: String,
    ) -> ServiceFuture<'_, Result<ProductDetail, UpstreamError>> {
        self.calls().details.push(product_id.clone());
        Box::pin(async move {
            let running = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(running, Ordering::SeqCst);
            if !self.detail_delay.is_zero() {
                tokio::time::sleep(self.detail_delay).await;
            }
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
            (self.detail)(product_id)
        })
    }

    fn product_price(
        &self,
        product_id: String,
    ) -> ServiceFuture<'_, Result<ProductPrice, UpstreamError>> {
        self.calls().prices.push(product_id.clone());
        ready((self.price)(product_id))
    }

    fn search_page(
        &self,
        term: String,
        offset: usize,
        size: usize,
    ) -> ServiceFuture<'_, Result<SearchPage, UpstreamError>> {
        self.calls().searches.push((term.clone(), offset, size));
        ready((self.search)((term, offset, size)))
    }

    fn plus_monthly(&self) -> ServiceFuture<'_, Result<Vec<PlusMonthlyEntry>, UpstreamError>> {
        self.calls().monthly += 1;
        ready((self.monthly)(()))
    }

    fn browse_page(
        &self,
        request: BrowseRequest,
    ) -> ServiceFuture<'_, Result<BrowsePage, UpstreamError>> {
        self.calls().browse.push(request.clone());
        ready((self.browse)(request))
    }

    fn genres(&self) -> ServiceFuture<'_, Result<Vec<Genre>, UpstreamError>> {
        self.calls().genres += 1;
        ready((self.genres)(()))
    }
}

/// The service over a fake, with the wall clock at `now`.
pub(super) fn service_at(
    fake: FakeSony,
    now: &str,
) -> (GamesService, Arc<FakeSony>, Arc<FixedClock>) {
    let fake = Arc::new(fake);
    let clock = Arc::new(FixedClock::new(now.parse::<Timestamp>().unwrap()));
    let sony: Arc<dyn SonyCatalog> = fake.clone();
    let wall: Arc<dyn Clock> = clock.clone();
    (GamesService::new(sony, wall), fake, clock)
}

/// The service with the wall clock at 2026-01-01.
pub(super) fn service(fake: FakeSony) -> (GamesService, Arc<FakeSony>) {
    let (service, fake, _) = service_at(fake, "2026-01-01T00:00:00Z");
    (service, fake)
}

pub(super) fn page(offset: usize, size: usize) -> Page {
    Page { offset, size }
}

pub(super) fn names(result: &PageResult) -> Vec<&str> {
    result.games.iter().map(|g| g.name.as_str()).collect()
}

pub(super) fn unavailable() -> UpstreamError {
    UpstreamError::unavailable("down")
}

/// A product id like the TypeScript tests: `EP0001-PPSA<n>_00-<NAME>`.
pub(super) fn sku(n: usize, name: &str) -> String {
    let mut label: String = name
        .to_uppercase()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect();
    while label.len() < 16 {
        label.push('0');
    }
    label.truncate(16);
    format!("EP0001-PPSA{n:05}_00-{label}")
}

/// A priced concept that names one product SKU.
pub(super) fn priced_concept(n: usize, name: &str) -> Concept {
    Concept {
        id: Some(n.to_string()),
        name: Some(name.into()),
        media: Some(vec![Media {
            url: Some(format!("https://img/{name}")),
            role: Some("MASTER".into()),
            kind: Some("IMAGE".into()),
        }]),
        price: Some(ConceptPrice {
            base_price: Some("€29.95".into()),
            discounted_price: Some("€29.95".into()),
            discount_text: None,
            service_branding: Some(vec!["NONE".into()]),
            upsell_service_branding: Some(vec!["NONE".into()]),
            upsell_text: None,
        }),
        products: Some(vec![ConceptProductRef {
            id: Some(sku(n, name)),
            ..ConceptProductRef::default()
        }]),
    }
}

/// A concept-only announcement without a price or a product.
pub(super) fn announcement(id: &str, name: &str) -> Concept {
    Concept {
        id: Some(id.into()),
        name: Some(name.into()),
        media: Some(vec![]),
        price: None,
        products: Some(vec![]),
    }
}

/// The first product id of a concept.
pub(super) fn product_id(concept: &Concept) -> String {
    concept_product_id(concept)
}
