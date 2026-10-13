//! The services behind the HTTP routes, and their ports.
//!
//! The HTTP layer depends only on the traits in this module. `wiring.rs` is
//! the composition root: it is the only place that selects the concrete
//! services. Tests replace a service with a fake.
//!
//! The methods return a boxed future instead of using `async fn` in the trait,
//! because `async fn` in a trait is not object safe and the services are
//! stored as `Arc<dyn …>`. One allocation per request is negligible next to
//! the network calls.

pub mod account;
pub mod cache;
pub mod clock;
pub mod critic_scores;
pub mod games;
pub mod in_flight;

use std::future::Future;
use std::pin::Pin;

use crate::domain::browse::{BrowseOrder, GenreKey};
use crate::domain::errors::{AccountError, GameLookupError, UpstreamError};
use crate::domain::game::{CriticScore, Game, GenreList, PageResult};
use crate::domain::secret::Secret;

pub use clock::{Clock, FixedClock, SystemClock};

/// The future that a service method returns.
pub type ServiceFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One page window of a list request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Page {
    pub offset: usize,
    pub size: usize,
}

/// The anonymous store lookups.
pub trait GamesApi: Send + Sync {
    fn new_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>>;
    fn upcoming_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>>;
    fn discounted_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>>;
    fn monthly_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>>;
    /// `term` is trimmed and has 1 to 100 UTF-16 code units.
    fn search_games(
        &self,
        term: String,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>>;
    fn genres(&self) -> ServiceFuture<'_, Result<GenreList, UpstreamError>>;
    fn browse_games(
        &self,
        genre: GenreKey,
        order: BrowseOrder,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>>;
    /// `id` is trimmed and not empty.
    fn game_by_id(&self, id: String) -> ServiceFuture<'_, Result<Game, GameLookupError>>;
}

impl std::fmt::Debug for dyn GamesApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GamesApi")
    }
}

/// The critic score of the game page. The lookup never fails: a missing,
/// untrusted, slow, or failed score is `None`.
pub trait CriticScores: Send + Sync {
    fn score_for<'a>(&'a self, game: &'a Game) -> ServiceFuture<'a, Option<CriticScore>>;
}

impl std::fmt::Debug for dyn CriticScores {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CriticScores")
    }
}

/// The signed-in requests (STACK.md §14). The NPSSO comes from the request and
/// is never stored.
pub trait AccountApi: Send + Sync {
    /// Exchanges the NPSSO with Sony once. `Ok` means that Sony accepted it.
    fn verify_npsso(&self, npsso: Secret) -> ServiceFuture<'_, Result<(), AccountError>>;
    fn purchased_games(&self, npsso: Secret)
    -> ServiceFuture<'_, Result<PageResult, AccountError>>;
    fn wishlist_games(&self, npsso: Secret) -> ServiceFuture<'_, Result<PageResult, AccountError>>;
}

impl std::fmt::Debug for dyn AccountApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AccountApi")
    }
}
