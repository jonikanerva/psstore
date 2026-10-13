//! The composition root: the one place that selects the concrete services.
//!
//! Each service has its own function, so that changes to one service do not
//! touch the lines of another.

use std::sync::Arc;

use crate::application::games::GamesService;
use crate::application::{AccountApi, CriticScores, GamesApi, Page, ServiceFuture, SystemClock};
use crate::config::Config;
use crate::domain::browse::{BrowseOrder, GenreKey};
use crate::domain::errors::{AccountError, GameLookupError, UpstreamError};
use crate::domain::game::{CriticScore, Game, GenreList, PageResult};
use crate::domain::secret::Secret;
use crate::http::AppState;
use crate::http::static_files::StaticSite;
use crate::sources::sony::catalog::SonyCatalogClient;
use crate::sources::sony::contract::SonyContract;

/// The production services.
#[must_use]
pub fn state(config: &Config, sony: &SonyContract) -> AppState {
    let games = games(sony);
    AppState {
        games: Arc::clone(&games),
        critics: critic_scores(config),
        account: account(sony, games),
        site: Arc::new(StaticSite::new(config.web_build.clone())),
    }
}

// ---------------------------------------------------------------------------
// The anonymous store lookups.
// ---------------------------------------------------------------------------

fn games(sony: &SonyContract) -> Arc<dyn GamesApi> {
    // The client fails to build only when its TLS set-up fails. The service
    // then answers each store request as an outage.
    let Ok(client) = SonyCatalogClient::new(sony) else {
        tracing::error!(
            stage = "sony_client",
            "the Sony store client could not start"
        );
        return Arc::new(NotConnected);
    };
    Arc::new(GamesService::new(Arc::new(client), Arc::new(SystemClock)))
}

// ---------------------------------------------------------------------------
// The critic score. Without IGDB credentials the feature is off.
// ---------------------------------------------------------------------------

fn critic_scores(config: &Config) -> Arc<dyn CriticScores> {
    let Some(credentials) = &config.igdb else {
        return Arc::new(NoCriticScores);
    };
    let Ok(client) = crate::sources::igdb::IgdbClient::new(credentials.clone()) else {
        // The feature is optional, so the server starts without it.
        tracing::warn!(
            stage = "igdb_client",
            "critic score off: the HTTP client could not be built"
        );
        return Arc::new(NoCriticScores);
    };
    Arc::new(crate::application::critic_scores::CriticScoreService::new(
        Arc::new(client),
    ))
}

// ---------------------------------------------------------------------------
// The signed-in requests. The wishlist fills its cards from `games`.
// ---------------------------------------------------------------------------

fn account(sony: &SonyContract, games: Arc<dyn GamesApi>) -> Arc<dyn AccountApi> {
    use crate::application::account::AccountService;
    use crate::sources::sony::account::{AccountTiming, SonyAccountClient};

    // Without an HTTP client every signed-in request is an outage. The
    // sign-in cookie stays, because an outage is no rejection.
    let Ok(client) = SonyAccountClient::new(sony.clone(), AccountTiming::default(), true) else {
        tracing::error!(
            stage = "account_client",
            "the Sony account client could not start"
        );
        return Arc::new(NotConnected);
    };
    Arc::new(AccountService::new(Arc::new(client), games))
}

/// The critic score when the feature is off: never a score.
#[derive(Debug, Clone, Copy)]
pub struct NoCriticScores;

impl CriticScores for NoCriticScores {
    fn score_for<'a>(&'a self, _game: &'a Game) -> ServiceFuture<'a, Option<CriticScore>> {
        Box::pin(async { None })
    }
}

/// A placeholder service that answers every request as an upstream outage.
/// It stands in until the Sony adapters are connected.
#[derive(Debug, Clone, Copy)]
struct NotConnected;

fn outage<T: Send + 'static, E: From<UpstreamError> + Send + 'static>()
-> ServiceFuture<'static, Result<T, E>> {
    Box::pin(async { Err(E::from(UpstreamError::unavailable("Upstream unavailable"))) })
}

impl GamesApi for NotConnected {
    fn new_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        outage()
    }
    fn upcoming_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        outage()
    }
    fn discounted_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        outage()
    }
    fn monthly_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        outage()
    }
    fn search_games(
        &self,
        _: String,
        _: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        outage()
    }
    fn genres(&self) -> ServiceFuture<'_, Result<GenreList, UpstreamError>> {
        outage()
    }
    fn browse_games(
        &self,
        _: GenreKey,
        _: BrowseOrder,
        _: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        outage()
    }
    fn game_by_id(&self, _: String) -> ServiceFuture<'_, Result<Game, GameLookupError>> {
        outage()
    }
}

impl AccountApi for NotConnected {
    fn verify_npsso(&self, _: Secret) -> ServiceFuture<'_, Result<(), AccountError>> {
        outage()
    }
    fn purchased_games(&self, _: Secret) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        outage()
    }
    fn wishlist_games(&self, _: Secret) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        outage()
    }
}
