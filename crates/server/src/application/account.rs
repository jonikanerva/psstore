//! The signed-in requests (STACK.md §14). Port of
//! `server/src/services/accountService.ts`.
//!
//! Each request exchanges the NPSSO for a new access token. Concurrent
//! requests with the same NPSSO share one exchange. The shared entry ends
//! when the exchange ends, before the library request, so no access token is
//! kept. Nothing here uses a cache: the signed-in lists and the token are
//! never stored. The wishlist cards use the anonymous store lookups of
//! [`GamesApi`], which cache public store data by public product id only.
//!
//! A failure logs only its tag. The NPSSO, the token, and the list data never
//! reach a log line.

use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream;

use super::cache::LookupPanicked;
use super::in_flight::InFlight;
use super::{AccountApi, GamesApi, ServiceFuture};
use crate::domain::errors::AccountError;
use crate::domain::game::{Game, PageResult};
use crate::domain::library::{
    PurchasedEntry, WishlistEntry, WishlistId, merge_wishlist_entry, purchased_cards,
    wishlist_cards,
};
use crate::domain::secret::Secret;

/// The parallel store lookups that fill the wishlist cards.
pub const WISHLIST_ENRICH_CONCURRENCY: usize = 6;
/// The deadline of one store lookup of the wishlist.
pub const WISHLIST_ENRICH_ENTRY_TIMEOUT: Duration = Duration::from_secs(5);
/// The deadline of all store lookups of the wishlist.
pub const WISHLIST_ENRICH_TOTAL_TIMEOUT: Duration = Duration::from_secs(12);

/// The Sony account calls (the port of `SonyAccountClientApi`). Each call has
/// its own deadline and makes no retry. Only a definitive Sony rejection of
/// the credential is [`AccountError::SessionRejected`].
pub trait SonyAccount: Send + Sync {
    /// Exchanges the NPSSO for a short-lived access token. Any refresh token
    /// or id token of the answer is dropped.
    fn exchange_npsso(&self, npsso: Secret) -> ServiceFuture<'_, Result<Secret, AccountError>>;
    /// The whole PS5 library in Sony's order, without duplicate product ids.
    /// A library larger than the page cap fails: it is never cut short.
    fn purchased_games(
        &self,
        access_token: Secret,
    ) -> ServiceFuture<'_, Result<Vec<PurchasedEntry>, AccountError>>;
    /// The whole PS5 wishlist in Sony's order, without duplicate ids.
    fn wishlist_games(
        &self,
        access_token: Secret,
    ) -> ServiceFuture<'_, Result<Vec<WishlistEntry>, AccountError>>;
}

impl std::fmt::Debug for dyn SonyAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SonyAccount")
    }
}

/// A panicked exchange task fails the request as an outage. The panic hook
/// logs the panic location.
impl From<LookupPanicked> for AccountError {
    fn from(panicked: LookupPanicked) -> Self {
        Self::Upstream(panicked.into())
    }
}

/// The signed-in surface.
#[derive(Debug)]
pub struct AccountService {
    sony: Arc<dyn SonyAccount>,
    games: Arc<dyn GamesApi>,
    /// The running exchanges by NPSSO. An entry exists only while its
    /// exchange runs.
    exchanges: InFlight<Secret, Secret, AccountError>,
}

impl AccountService {
    pub fn new(sony: Arc<dyn SonyAccount>, games: Arc<dyn GamesApi>) -> Self {
        Self {
            sony,
            games,
            exchanges: InFlight::new(),
        }
    }

    /// The access token of a shared exchange. The entry ends with the
    /// exchange, so a later call exchanges again.
    async fn exchange(&self, npsso: Secret) -> Result<Secret, AccountError> {
        let sony = Arc::clone(&self.sony);
        self.exchanges
            .run(npsso.clone(), move || async move {
                sony.exchange_npsso(npsso).await
            })
            .await
    }

    async fn purchased(&self, npsso: Secret) -> Result<PageResult, AccountError> {
        let entries = logged(async {
            let access_token = self.exchange(npsso).await?;
            self.sony.purchased_games(access_token).await
        })
        .await?;
        Ok(whole_page(purchased_cards(&entries)))
    }

    async fn wishlist(&self, npsso: Secret) -> Result<PageResult, AccountError> {
        let entries = logged(async {
            let access_token = self.exchange(npsso).await?;
            self.sony.wishlist_games(access_token).await
        })
        .await?;
        Ok(whole_page(self.enrich_wishlist(&entries).await))
    }

    /// Fills the product entries from the public Finnish store, the source
    /// of the other views. When the whole list runs past its deadline, every
    /// card is the minimal card, like on the TypeScript server.
    async fn enrich_wishlist(&self, entries: &[WishlistEntry]) -> Vec<Game> {
        // The futures are built first: a closure that borrows each entry
        // inside the stream does not prove `Send` for every lifetime. A
        // future does no work until the stream polls it.
        let pending: Vec<_> = entries
            .iter()
            .map(|entry| self.enrich_entry(entry))
            .collect();
        let lookups = stream::iter(pending)
            .buffered(WISHLIST_ENRICH_CONCURRENCY)
            .collect::<Vec<_>>();
        let cards = tokio::time::timeout(WISHLIST_ENRICH_TOTAL_TIMEOUT, lookups)
            .await
            .unwrap_or_else(|_| wishlist_cards(entries));
        let priced = cards.iter().filter(|card| !card.price.is_empty()).count();
        tracing::info!(entries = entries.len(), priced, "wishlist enriched");
        cards
    }

    /// A concept entry, a missing game, or a slow or failed lookup keeps the
    /// minimal card.
    async fn enrich_entry(&self, entry: &WishlistEntry) -> Game {
        let found = match &entry.id {
            WishlistId::Product(product_id) => {
                let lookup = self.games.game_by_id(product_id.clone().into());
                match tokio::time::timeout(WISHLIST_ENRICH_ENTRY_TIMEOUT, lookup).await {
                    Ok(Ok(game)) => Some(game),
                    Ok(Err(_)) | Err(_) => None,
                }
            }
            WishlistId::Concept(_) => None,
        };
        merge_wishlist_entry(entry, found)
    }
}

/// One response page with the whole list.
fn whole_page(games: Vec<Game>) -> PageResult {
    PageResult {
        total_count: games.len(),
        games,
        next_offset: None,
    }
}

/// Logs the tag of a failure. The tag contains no data.
async fn logged<T>(
    request: impl Future<Output = Result<T, AccountError>>,
) -> Result<T, AccountError> {
    let outcome = request.await;
    if let Err(error) = &outcome {
        tracing::warn!(reason = error.tag(), "account request failed");
    }
    outcome
}

impl AccountApi for AccountService {
    fn verify_npsso(&self, npsso: Secret) -> ServiceFuture<'_, Result<(), AccountError>> {
        // The access token is dropped at once.
        Box::pin(async move { logged(self.exchange(npsso)).await.map(|_access_token| ()) })
    }

    fn purchased_games(
        &self,
        npsso: Secret,
    ) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        Box::pin(self.purchased(npsso))
    }

    fn wishlist_games(&self, npsso: Secret) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        Box::pin(self.wishlist(npsso))
    }
}

#[cfg(test)]
mod tests;
