//! The critic score of the game page (`VISION.md` → Product Shape, item 3).
//!
//! One provider supplies the score through the [`CriticSource`] port. The
//! service caches each outcome by the public Sony id, title, and release year,
//! like `server/src/services/criticScoreService.ts`. A lookup has a time
//! budget. Every failure degrades to no score and logs only its error tag.

use std::sync::Arc;
use std::time::Duration;

use super::cache::{LookupPanicked, TtlCache};
use super::{CriticScores, ServiceFuture};
use crate::domain::critic_match::{CriticCandidate, match_critic_score, release_year_of};
use crate::domain::game::{CriticScore, Game};

/// The number of games whose outcome the cache keeps.
pub const SCORE_CACHE_CAPACITY: usize = 5_000;

/// How long a lookup outcome stays cached: a score and a miss alike.
pub const SCORE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// How long a failed lookup stays cached before the next attempt.
pub const SCORE_FAILURE_TTL: Duration = Duration::from_secs(60);

/// The total time that the game page waits for a critic score. The budget
/// covers the token request, the games request, and the token refresh.
pub const SCORE_BUDGET: Duration = Duration::from_millis(1500);

/// A failure of the critic score provider. The variants carry no data, so an
/// error value cannot hold a credential, a URL, or a title.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CriticSourceError {
    /// The provider refused the credentials or the token (HTTP 400, 401, or
    /// 403).
    Rejected,
    /// Any other failure: an outage, a timeout, the time budget, or an
    /// unexpected answer.
    Unavailable,
}

impl CriticSourceError {
    /// The error tag of the TypeScript server, for the log field `reason`.
    pub fn tag(self) -> &'static str {
        match self {
            Self::Rejected => "CriticSourceRejected",
            Self::Unavailable => "CriticSourceUnavailable",
        }
    }
}

impl From<LookupPanicked> for CriticSourceError {
    fn from(_: LookupPanicked) -> Self {
        Self::Unavailable
    }
}

/// The critic score provider.
pub trait CriticSource: Send + Sync {
    /// The candidates for a public game title released within one year of
    /// `year`. The provider receives only the title and the year range.
    fn find_games<'a>(
        &'a self,
        title: &'a str,
        year: i32,
    ) -> ServiceFuture<'a, Result<Vec<CriticCandidate>, CriticSourceError>>;
}

impl std::fmt::Debug for dyn CriticSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CriticSource")
    }
}

/// The cache key: public data only.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CriticKey {
    id: String,
    title: String,
    year: i32,
}

type ScoreOutcome = Result<Option<CriticScore>, CriticSourceError>;

/// The critic score service when the provider credentials exist.
#[derive(Debug)]
pub struct CriticScoreService {
    source: Arc<dyn CriticSource>,
    cache: TtlCache<CriticKey, Option<CriticScore>, CriticSourceError>,
}

impl CriticScoreService {
    pub fn new(source: Arc<dyn CriticSource>) -> Self {
        Self {
            source,
            cache: TtlCache::new(SCORE_CACHE_CAPACITY, score_ttl),
        }
    }

    async fn lookup(&self, game: &Game) -> Option<CriticScore> {
        // Without a release year there is nothing to match against, and the
        // provider is not called.
        let year = release_year_of(&game.date)?;
        let key = CriticKey {
            id: game.id.clone(),
            title: game.name.clone(),
            year,
        };
        let source = Arc::clone(&self.source);
        let title = game.name.clone();
        // The budget is inside the cached lookup, as in the TypeScript server:
        // a lookup that runs out of time is a failure and is cached as one.
        let outcome = self
            .cache
            .get_with(key, move || async move {
                let lookup = async {
                    let candidates = source.find_games(&title, year).await?;
                    Ok(match_critic_score(&title, year, &candidates))
                };
                tokio::time::timeout(SCORE_BUDGET, lookup)
                    .await
                    .unwrap_or(Err(CriticSourceError::Unavailable))
            })
            .await;
        match outcome {
            Ok(score) => score,
            Err(error) => {
                tracing::warn!(reason = error.tag(), "critic score lookup failed");
                None
            }
        }
    }
}

fn score_ttl(outcome: &ScoreOutcome) -> Duration {
    if outcome.is_ok() {
        SCORE_TTL
    } else {
        SCORE_FAILURE_TTL
    }
}

impl CriticScores for CriticScoreService {
    fn score_for<'a>(&'a self, game: &'a Game) -> ServiceFuture<'a, Option<CriticScore>> {
        Box::pin(self.lookup(game))
    }
}

#[cfg(test)]
mod tests;
