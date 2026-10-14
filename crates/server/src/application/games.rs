//! The anonymous store lookups (port of `server/src/services/gamesService.ts`)
//! and their port to Sony's store, [`SonyCatalog`].
//!
//! The service keeps the caches of the TypeScript service with the same
//! capacities and times to live, and it reads the current time from the
//! injected clock.

use std::sync::Arc;
use std::time::Duration;

use futures_util::future::{join, join_all, try_join};
use futures_util::stream::{self, StreamExt};

use super::cache::TtlCache;
use super::{Clock, GamesApi, Page, ServiceFuture};
use crate::domain::browse::{BrowseOrder, GenreKey};
use crate::domain::catalog::{
    BrowsePage, BrowseRequest, Concept, PlusMonthlyEntry, ProductDetail, ProductPrice,
    SearchCandidate, SearchPage, SonyFeature,
};
use crate::domain::errors::{GameLookupError, UpstreamError};
use crate::domain::game::{Game, Genre, GenreList, IdKind, PageResult, PlusOffer};
use crate::domain::id::{GameId, ProductId};
use crate::domain::listing::{
    SortOrder, browse_candidate_ids, browse_concept_to_game, has_release_date, in_new_window,
    in_upcoming_window, is_game_classification, is_ps5_game, map_concepts_to_games,
    map_monthly_to_games, map_upcoming_concepts_to_games, merge_release_grids, paginate,
    sort_by_date,
};
use crate::domain::mapper::{concept_product_id, concept_to_game, product_detail_to_game};

/// The anonymous Sony store operations (port of `SonyClientApi`). Each
/// method decodes and scopes Sony's answer at the boundary.
pub trait SonyCatalog: Send + Sync {
    /// One category grid list in Sony's order. A drifted grid is an empty
    /// list with a warning.
    fn concepts_by_feature(
        &self,
        feature: SonyFeature,
        size: usize,
        offset: usize,
    ) -> ServiceFuture<'_, Result<Vec<Concept>, UpstreamError>>;
    /// The product detail. A missing or malformed node is an empty detail.
    fn product_detail(
        &self,
        product_id: ProductId,
    ) -> ServiceFuture<'_, Result<ProductDetail, UpstreamError>>;
    /// The PS Plus offer and the standard price.
    fn product_price(
        &self,
        product_id: ProductId,
    ) -> ServiceFuture<'_, Result<ProductPrice, UpstreamError>>;
    /// One raw search page, narrowed to the product scope.
    fn search_page(
        &self,
        term: String,
        offset: usize,
        size: usize,
    ) -> ServiceFuture<'_, Result<SearchPage, UpstreamError>>;
    /// The PS Plus monthly games in scope.
    fn plus_monthly(&self) -> ServiceFuture<'_, Result<Vec<PlusMonthlyEntry>, UpstreamError>>;
    /// One BROWSE grid page in Sony's order.
    fn browse_page(
        &self,
        request: BrowseRequest,
    ) -> ServiceFuture<'_, Result<BrowsePage, UpstreamError>>;
    /// The genre menu, sorted by name.
    fn genres(&self) -> ServiceFuture<'_, Result<Vec<Genre>, UpstreamError>>;
}

impl std::fmt::Debug for dyn SonyCatalog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SonyCatalog")
    }
}

/// NEW reads a wider window than the other grids. With the
/// `last_thirty_days` facet the released PS5 set is bounded, so 300 covers it
/// in one request.
const NEW_LIST_PAGE_SIZE: usize = 300;
const LIST_PAGE_SIZE: usize = 120;
/// The list cache lifetime, for a success and a failure alike.
const LIST_TTL: Duration = Duration::from_secs(30);
const DETAIL_TTL: Duration = Duration::from_hours(6);
const PRICE_TTL: Duration = Duration::from_mins(10);
const PRICE_FAILURE_TTL: Duration = Duration::from_secs(30);
/// The detail of the product-id fallback and of BROWSE. Sony answers an
/// unknown id with 200 and no data; that miss lives shorter than a product.
const STRICT_DETAIL_TTL: Duration = Duration::from_hours(6);
const STRICT_DETAIL_MISS_TTL: Duration = Duration::from_mins(5);
const STRICT_DETAIL_FAILURE_TTL: Duration = Duration::from_secs(30);
const MONTHLY_TTL: Duration = Duration::from_hours(1);
const MONTHLY_FAILURE_TTL: Duration = Duration::from_secs(30);
const GENRES_TTL: Duration = Duration::from_hours(1);
const GENRES_FAILURE_TTL: Duration = Duration::from_secs(30);

const CONCEPTS_CAPACITY: usize = 16;
const DETAIL_CAPACITY: usize = 10_000;
const PRICE_CAPACITY: usize = 1_000;
const STRICT_DETAIL_CAPACITY: usize = 1_000;
const BROWSE_PAGE_CAPACITY: usize = 64;

/// Raw search pages read for one request when the pages narrow to zero
/// games.
const SEARCH_RAW_PAGE_BOUND: usize = 3;
/// Concurrent product detail lookups for one search page.
const SEARCH_DETAIL_CONCURRENCY: usize = 10;
/// Concurrent concept resolutions for one BROWSE page.
const BROWSE_DETAIL_CONCURRENCY: usize = 10;
/// Raw BROWSE pages read for one request when the pages narrow to zero games.
const BROWSE_RAW_PAGE_BOUND: usize = 3;

/// The fields of a product detail that the lists read.
struct ProductMeta {
    /// Sony's release date verbatim, or the empty string.
    date: String,
    classification: Option<String>,
    genres: Vec<String>,
    platforms: Vec<String>,
}

impl ProductMeta {
    fn of(detail: &ProductDetail) -> Self {
        Self {
            date: detail.release_date.clone().unwrap_or_default(),
            classification: detail.store_display_classification.clone(),
            genres: detail.genres.clone(),
            platforms: detail.platforms.clone(),
        }
    }
}

/// The outcome of one BROWSE concept.
enum BrowseResolution {
    Game(Box<Game>),
    Dropped,
    Failed,
}

/// The release window of a list.
#[derive(Debug, Clone, Copy)]
enum Window {
    New,
    Upcoming,
}

/// The anonymous store lookups behind the list and game routes.
#[derive(Debug, Clone)]
pub struct GamesService {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    sony: Arc<dyn SonyCatalog>,
    clock: Arc<dyn Clock>,
    /// Concepts per grid list.
    concepts: TtlCache<SonyFeature, Arc<Vec<Concept>>, UpstreamError>,
    /// Product detail for the list enrichment and the game page. A failed
    /// lookup is an empty detail, so the lists never fail on one product.
    details: TtlCache<ProductId, Arc<ProductDetail>, UpstreamError>,
    /// The PS Plus offer and the standard price, read by the game page only.
    prices: TtlCache<ProductId, ProductPrice, UpstreamError>,
    /// Product detail for the product-id fallback and BROWSE. A failure stays
    /// a failure, so an outage never reads as "no such game".
    strict_details: TtlCache<ProductId, Arc<ProductDetail>, UpstreamError>,
    monthly: TtlCache<(), Arc<Vec<Game>>, UpstreamError>,
    genres: TtlCache<(), GenreList, UpstreamError>,
    browse_pages: TtlCache<BrowseRequest, PageResult, UpstreamError>,
}

fn ttl_by_outcome<V>(
    success: Duration,
    failure: Duration,
) -> impl Fn(&Result<V, UpstreamError>) -> Duration + Send + Sync + 'static {
    move |outcome| if outcome.is_ok() { success } else { failure }
}

impl GamesService {
    pub fn new(sony: Arc<dyn SonyCatalog>, clock: Arc<dyn Clock>) -> Self {
        Self {
            inner: Arc::new(Inner {
                sony,
                clock,
                concepts: TtlCache::with_fixed_ttl(CONCEPTS_CAPACITY, LIST_TTL),
                details: TtlCache::with_fixed_ttl(DETAIL_CAPACITY, DETAIL_TTL),
                prices: TtlCache::new(PRICE_CAPACITY, ttl_by_outcome(PRICE_TTL, PRICE_FAILURE_TTL)),
                strict_details: TtlCache::new(
                    STRICT_DETAIL_CAPACITY,
                    |outcome: &Result<Arc<ProductDetail>, UpstreamError>| match outcome {
                        Err(_) => STRICT_DETAIL_FAILURE_TTL,
                        Ok(detail) if detail.platforms.is_empty() => STRICT_DETAIL_MISS_TTL,
                        Ok(_) => STRICT_DETAIL_TTL,
                    },
                ),
                monthly: TtlCache::new(1, ttl_by_outcome(MONTHLY_TTL, MONTHLY_FAILURE_TTL)),
                genres: TtlCache::new(1, ttl_by_outcome(GENRES_TTL, GENRES_FAILURE_TTL)),
                browse_pages: TtlCache::with_fixed_ttl(BROWSE_PAGE_CAPACITY, LIST_TTL),
            }),
        }
    }
}

impl Inner {
    fn now_ms(&self) -> i64 {
        self.clock.now().as_millisecond()
    }

    /// The concepts of one grid list. A failure propagates.
    async fn concepts(&self, feature: SonyFeature) -> Result<Arc<Vec<Concept>>, UpstreamError> {
        let sony = Arc::clone(&self.sony);
        let size = match feature {
            SonyFeature::New => NEW_LIST_PAGE_SIZE,
            SonyFeature::Upcoming | SonyFeature::Discounted => LIST_PAGE_SIZE,
        };
        self.concepts
            .get_with(feature, move || async move {
                sony.concepts_by_feature(feature, size, 0)
                    .await
                    .map(Arc::new)
            })
            .await
    }

    /// UPCOMING or DISCOUNTED concepts. A failure is logged and propagates;
    /// it never becomes an empty list.
    async fn feature_concepts(
        &self,
        feature: SonyFeature,
    ) -> Result<Arc<Vec<Concept>>, UpstreamError> {
        let outcome = self.concepts(feature).await;
        if let Err(error) = &outcome {
            tracing::warn!(
                feature = feature.as_str(),
                reason = error.tag(),
                "feature concept query failed"
            );
        }
        outcome
    }

    /// The lenient product detail: a failed lookup is an empty detail.
    async fn detail(&self, product_id: &ProductId) -> Arc<ProductDetail> {
        let sony = Arc::clone(&self.sony);
        let id = product_id.clone();
        self.details
            .get_with(product_id.clone(), move || async move {
                Ok(Arc::new(sony.product_detail(id).await.unwrap_or_default()))
            })
            .await
            .unwrap_or_default()
    }

    /// The lenient detail of a card. Only a product has a product detail, so
    /// a card with another id has the empty detail. The list cards that reach
    /// this lookup all have product ids.
    async fn card_detail(&self, id: &GameId) -> Arc<ProductDetail> {
        match id.product_id() {
            Some(product_id) => self.detail(&product_id).await,
            None => Arc::default(),
        }
    }

    async fn card_meta(&self, id: &GameId) -> ProductMeta {
        ProductMeta::of(self.card_detail(id).await.as_ref())
    }

    async fn strict_detail(
        &self,
        product_id: &ProductId,
    ) -> Result<Arc<ProductDetail>, UpstreamError> {
        let sony = Arc::clone(&self.sony);
        let id = product_id.clone();
        self.strict_details
            .get_with(product_id.clone(), move || async move {
                sony.product_detail(id).await.map(Arc::new)
            })
            .await
    }

    async fn price(&self, product_id: &ProductId) -> Result<ProductPrice, UpstreamError> {
        let sony = Arc::clone(&self.sony);
        let id = product_id.clone();
        self.prices
            .get_with(product_id.clone(), move || async move {
                sony.product_price(id).await
            })
            .await
    }

    async fn monthly_list(&self) -> Result<Arc<Vec<Game>>, UpstreamError> {
        let sony = Arc::clone(&self.sony);
        self.monthly
            .get_with((), move || async move {
                let entries = sony.plus_monthly().await?;
                Ok(Arc::new(map_monthly_to_games(&entries)))
            })
            .await
    }

    async fn enrich_date(&self, mut game: Game) -> Game {
        game.date = self.card_meta(&game.id).await.date;
        game
    }

    /// NEW and UPCOMING read both the released and the upcoming grid. A
    /// failure of either grid fails the list: one grid alone can omit a
    /// released game that Sony files as upcoming (ADR 0001). The released
    /// grid keeps dated product SKUs only; the upcoming grid also keeps
    /// undated products and concept-only announcements.
    async fn release_games(&self) -> Result<Vec<Game>, UpstreamError> {
        let (released, upcoming) = try_join(
            self.concepts(SonyFeature::New),
            self.feature_concepts(SonyFeature::Upcoming),
        )
        .await?;
        let now_ms = self.now_ms();
        let released = map_concepts_to_games(&released, now_ms);
        let upcoming = map_upcoming_concepts_to_games(&upcoming, now_ms);
        let (released, upcoming) = join(
            join_all(released.into_iter().map(|game| self.enrich_date(game))),
            join_all(upcoming.into_iter().map(|game| async move {
                match game.id_kind {
                    IdKind::Product => self.enrich_date(game).await,
                    IdKind::Concept => game,
                }
            })),
        )
        .await;
        let released = released.into_iter().filter(has_release_date).collect();
        Ok(merge_release_grids(released, upcoming))
    }

    /// NEW is newest first. UPCOMING is soonest first, with undated cards
    /// last in grid order. Both are supersets of the client's local-day split.
    async fn release_listing(
        &self,
        window: Window,
        page: Page,
    ) -> Result<PageResult, UpstreamError> {
        let games = self.release_games().await?;
        let now_ms = self.now_ms();
        let (games, order) = match window {
            Window::New => (in_new_window(games, now_ms), SortOrder::DateDesc),
            Window::Upcoming => (in_upcoming_window(games, now_ms), SortOrder::DateAsc),
        };
        Ok(paginate(sort_by_date(games, order), page.offset, page.size))
    }

    /// DISCOUNTED keeps full-game SKUs only, newest first. A concept with an
    /// unknown classification is dropped, also when its detail lookup failed
    /// for the lifetime of the detail cache: a non-game SKU never leaks in.
    async fn discounted_games(&self, page: Page) -> Result<PageResult, UpstreamError> {
        let concepts = self.feature_concepts(SonyFeature::Discounted).await?;
        let games = map_concepts_to_games(&concepts, self.now_ms());
        let enriched = join_all(games.into_iter().map(|game| async move {
            let meta = self.card_meta(&game.id).await;
            (game, meta)
        }))
        .await;
        let games = enriched
            .into_iter()
            .filter(|(_, meta)| is_game_classification(meta.classification.as_deref()))
            .map(|(game, meta)| Game {
                date: meta.date,
                ..game
            })
            .filter(|game| !game.date.is_empty())
            .collect();
        Ok(paginate(
            sort_by_date(games, SortOrder::DateDesc),
            page.offset,
            page.size,
        ))
    }

    async fn monthly_games(&self, page: Page) -> Result<PageResult, UpstreamError> {
        let games = self.monthly_list().await.inspect_err(|error| {
            tracing::warn!(reason = error.tag(), "monthly games query failed");
        })?;
        Ok(paginate(games.to_vec(), page.offset, page.size))
    }

    /// A candidate that Sony proved PS5 only by naming its product id is
    /// checked against the product detail.
    async fn resolve_search_candidate(
        &self,
        candidate: SearchCandidate,
        now_ms: i64,
    ) -> Option<Game> {
        let (product_id, concept, unverified) = match candidate {
            SearchCandidate::Known {
                product_id,
                concept,
            } => (product_id, concept, false),
            SearchCandidate::Unverified {
                product_id,
                concept,
            } => (product_id, concept, true),
        };
        let base = concept_to_game(&concept, product_id.clone().into(), now_ms);
        let meta = ProductMeta::of(self.detail(&product_id).await.as_ref());
        if unverified && !is_ps5_game(&meta.platforms, meta.classification.as_deref()) {
            return None;
        }
        let genres = if meta.genres.is_empty() {
            base.genres.clone()
        } else {
            meta.genres
        };
        Some(Game {
            date: meta.date,
            genres,
            ..base
        })
    }

    /// One search result page. `next_offset` follows Sony's raw paging,
    /// never the narrowed length. A raw page that narrows to zero games reads
    /// the next one, up to the bound. The result is never cached.
    async fn search_games(&self, term: String, page: Page) -> Result<PageResult, UpstreamError> {
        let mut raw_offset = page.offset;
        let mut pages_left = SEARCH_RAW_PAGE_BOUND;
        loop {
            let found = self
                .sony
                .search_page(term.clone(), raw_offset, page.size)
                .await
                .inspect_err(|error| {
                    tracing::warn!(reason = error.tag(), "search query failed");
                })?;
            let next_offset = (!found.is_last).then(|| raw_offset.saturating_add(page.size));
            let now_ms = self.now_ms();
            let games: Vec<Game> = stream::iter(found.candidates)
                .map(|candidate| self.resolve_search_candidate(candidate, now_ms))
                .buffered(SEARCH_DETAIL_CONCURRENCY)
                .filter_map(|game| async move { game })
                .collect()
                .await;
            match next_offset {
                Some(next) if games.is_empty() && pages_left > 1 => {
                    raw_offset = next;
                    pages_left -= 1;
                }
                _ => {
                    return Ok(PageResult {
                        total_count: games.len(),
                        games,
                        next_offset,
                    });
                }
            }
        }
    }

    async fn plus_offer_for(&self, game: &Game) -> Option<PlusOffer> {
        if game.id_kind != IdKind::Product {
            return None;
        }
        // A product card always has a product id.
        let product_id = game.id.product_id()?;
        match self.price(&product_id).await {
            Ok(price) => price.plus_offer,
            Err(error) => {
                tracing::warn!(reason = error.tag(), "plus offer lookup failed");
                None
            }
        }
    }

    async fn enrich_with_detail(&self, game: Game) -> Game {
        let (detail, plus_offer) =
            join(self.card_detail(&game.id), self.plus_offer_for(&game)).await;
        Game {
            date: detail.release_date.clone().unwrap_or(game.date),
            genres: if detail.genres.is_empty() {
                game.genres
            } else {
                detail.genres.clone()
            },
            description: if detail.description.is_empty() {
                game.description
            } else {
                detail.description.clone()
            },
            studio: detail.publisher_name.clone().unwrap_or(game.studio),
            plus_offer,
            ..game
        }
    }

    /// The UPCOMING or DISCOUNTED game of a product id. A failure propagates,
    /// so an outage is never a 404.
    async fn find_in_feature(
        &self,
        feature: SonyFeature,
        id: &GameId,
    ) -> Result<Option<Game>, UpstreamError> {
        let concepts = self.feature_concepts(feature).await?;
        let matching: Vec<Concept> = concepts
            .iter()
            .filter(|concept| concept_product_id(concept) == id.as_str())
            .cloned()
            .collect();
        Ok(map_concepts_to_games(&matching, self.now_ms())
            .into_iter()
            .find(|game| game.id == *id))
    }

    /// The price of a game found by product id only. A failed lookup leaves
    /// the game without a price instead of failing the page.
    async fn price_or_none(&self, product_id: &ProductId) -> ProductPrice {
        match self.price(product_id).await {
            Ok(price) => price,
            Err(error) => {
                tracing::warn!(reason = error.tag(), "product price lookup failed");
                ProductPrice::default()
            }
        }
    }

    /// Runs only after every list missed. An upstream failure propagates;
    /// only a valid id that Sony proves is not a PS5 game is not found.
    async fn by_product_id(&self, id: GameId) -> Result<Game, GameLookupError> {
        let Some(product_id) = id.product_id() else {
            return Err(GameLookupError::NotFound { id });
        };
        let (detail, price) = try_join(self.strict_detail(&product_id), async {
            Ok(self.price_or_none(&product_id).await)
        })
        .await?;
        if detail.platforms.is_empty()
            || !is_ps5_game(
                &detail.platforms,
                detail.store_display_classification.as_deref(),
            )
        {
            return Err(GameLookupError::NotFound { id });
        }
        if detail.name.is_none() {
            tracing::warn!(reason = "empty_name", "product detail without a name");
            return Err(
                UpstreamError::unavailable("Sony returned a PS5 product without a name").into(),
            );
        }
        Ok(Game {
            description: detail.description.clone(),
            plus_offer: price.plus_offer,
            ..product_detail_to_game(&product_id, &detail, price.standard.as_ref(), self.now_ms())
        })
    }

    async fn game_by_id(&self, id: GameId) -> Result<Game, GameLookupError> {
        let released = self.concepts(SonyFeature::New).await?;
        let base = map_concepts_to_games(&released, self.now_ms())
            .into_iter()
            .find(|game| game.id == id);
        if let Some(game) = base {
            return Ok(self.enrich_with_detail(game).await);
        }
        for feature in [SonyFeature::Upcoming, SonyFeature::Discounted] {
            if let Some(game) = self.find_in_feature(feature, &id).await? {
                return Ok(self.enrich_with_detail(game).await);
            }
        }
        let monthly = self.monthly_list().await?;
        if let Some(game) = monthly.iter().find(|game| game.id == id) {
            return Ok(self.enrich_with_detail(game.clone()).await);
        }
        self.by_product_id(id).await
    }

    async fn genres(&self) -> Result<GenreList, UpstreamError> {
        let sony = Arc::clone(&self.sony);
        self.genres
            .get_with((), move || async move {
                Ok(GenreList {
                    genres: sony.genres().await?,
                })
            })
            .await
            .inspect_err(|error| {
                tracing::warn!(reason = error.tag(), "genre list query failed");
            })
    }

    /// The first candidate product whose detail proves a PS5 game becomes
    /// the card. The game page applies the same check, so a BROWSE card
    /// never leads to a missing game page.
    async fn resolve_browse_concept(&self, concept: Concept, now_ms: i64) -> BrowseResolution {
        for product_id in browse_candidate_ids(&concept) {
            let Ok(detail) = self.strict_detail(&product_id).await else {
                return BrowseResolution::Failed;
            };
            if is_ps5_game(
                &detail.platforms,
                detail.store_display_classification.as_deref(),
            ) {
                return BrowseResolution::Game(Box::new(browse_concept_to_game(
                    &concept,
                    &product_id,
                    detail.release_date.as_deref().unwrap_or_default(),
                    &detail.genres,
                    now_ms,
                )));
            }
        }
        BrowseResolution::Dropped
    }

    /// One BROWSE page. `next_offset` follows Sony's raw paging. A raw page
    /// that narrows to zero games reads the next one, up to the bound. A
    /// failed product lookup drops its concept; when no concept resolves and
    /// a lookup failed, the page fails, so an outage never reads as an empty
    /// genre.
    async fn read_browse_page(&self, request: BrowseRequest) -> Result<PageResult, UpstreamError> {
        let mut request = request;
        let mut pages_left = BROWSE_RAW_PAGE_BOUND;
        loop {
            let page = self.sony.browse_page(request.clone()).await?;
            let now_ms = self.now_ms();
            let resolved: Vec<BrowseResolution> = stream::iter(page.concepts)
                .map(|concept| self.resolve_browse_concept(concept, now_ms))
                .buffered(BROWSE_DETAIL_CONCURRENCY)
                .collect()
                .await;
            let failed = resolved
                .iter()
                .filter(|entry| matches!(entry, BrowseResolution::Failed))
                .count();
            let mut seen = std::collections::HashSet::new();
            let games: Vec<Game> = resolved
                .into_iter()
                .filter_map(|entry| match entry {
                    BrowseResolution::Game(game) => Some(*game),
                    BrowseResolution::Dropped | BrowseResolution::Failed => None,
                })
                .filter(|game| seen.insert(game.id.clone()))
                .collect();
            if failed > 0 && games.is_empty() {
                return Err(UpstreamError::unavailable(
                    "Sony product lookups failed for a browse page",
                ));
            }
            let next_offset = (!page.is_last).then(|| request.offset.saturating_add(request.size));
            if failed > 0 {
                tracing::warn!(
                    failed = u64::try_from(failed).unwrap_or(u64::MAX),
                    kept = u64::try_from(games.len()).unwrap_or(u64::MAX),
                    "browse product lookups failed"
                );
            }
            match next_offset {
                Some(next) if games.is_empty() && pages_left > 1 => {
                    request.offset = next;
                    pages_left -= 1;
                }
                _ => {
                    return Ok(PageResult {
                        total_count: games.len(),
                        games,
                        next_offset,
                    });
                }
            }
        }
    }

    async fn browse_games(
        self: &Arc<Self>,
        genre: GenreKey,
        order: BrowseOrder,
        page: Page,
    ) -> Result<PageResult, UpstreamError> {
        let request = BrowseRequest {
            genre,
            order,
            offset: page.offset,
            size: page.size,
        };
        let this = Arc::clone(self);
        let key = request.clone();
        self.browse_pages
            .get_with(
                key,
                move || async move { this.read_browse_page(request).await },
            )
            .await
            .inspect_err(|error| {
                tracing::warn!(reason = error.tag(), "browse query failed");
            })
    }
}

impl GamesApi for GamesService {
    fn new_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        Box::pin(self.inner.release_listing(Window::New, page))
    }

    fn upcoming_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        Box::pin(self.inner.release_listing(Window::Upcoming, page))
    }

    fn discounted_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        Box::pin(self.inner.discounted_games(page))
    }

    fn monthly_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        Box::pin(self.inner.monthly_games(page))
    }

    fn search_games(
        &self,
        term: String,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        Box::pin(self.inner.search_games(term, page))
    }

    fn genres(&self) -> ServiceFuture<'_, Result<GenreList, UpstreamError>> {
        Box::pin(self.inner.genres())
    }

    fn browse_games(
        &self,
        genre: GenreKey,
        order: BrowseOrder,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        Box::pin(self.inner.browse_games(genre, order, page))
    }

    fn game_by_id(&self, id: GameId) -> ServiceFuture<'_, Result<Game, GameLookupError>> {
        Box::pin(self.inner.game_by_id(id))
    }
}

// The account tests reuse the fake Sony store to run the real service.
#[cfg(test)]
pub(crate) mod tests;
