use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use futures_util::FutureExt;
use futures_util::future::BoxFuture;

use super::*;
use crate::domain::game::IdKind;
use crate::observability::testing::CapturedLogs;

const GAME_ID: &str = "EP0001-PPSA00001_00-ALPHA00000000000";

fn game() -> Game {
    Game {
        id: GAME_ID.parse().unwrap(),
        name: "Synthetic Quest".into(),
        date: "2023-11-14T00:00:00Z".into(),
        url: String::new(),
        price: String::new(),
        original_price: String::new(),
        discount_text: String::new(),
        discount_date: String::new(),
        screenshots: vec![],
        videos: vec![],
        genres: vec![],
        description: String::new(),
        studio: String::new(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: None,
        id_kind: IdKind::Product,
    }
}

fn rated() -> CriticCandidate {
    CriticCandidate {
        name: "Synthetic Quest".into(),
        release_year: Some(2023),
        rating: CriticScore::new(84),
        rating_count: 12,
    }
}

type Outcome = Result<Vec<CriticCandidate>, CriticSourceError>;
type Respond = Box<dyn Fn(usize) -> BoxFuture<'static, Outcome> + Send + Sync>;

/// A provider that answers with `respond(call number)` and records each
/// request.
struct FakeSource {
    calls: AtomicUsize,
    seen: Mutex<Vec<(String, i32)>>,
    respond: Respond,
}

impl FakeSource {
    fn new(
        respond: impl Fn(usize) -> BoxFuture<'static, Outcome> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            calls: AtomicUsize::new(0),
            seen: Mutex::new(Vec::new()),
            respond: Box::new(respond),
        })
    }

    fn answering(outcome: Outcome) -> Arc<Self> {
        Self::new(move |_| futures_util::future::ready(outcome.clone()).boxed())
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl CriticSource for FakeSource {
    fn find_games<'a>(
        &'a self,
        title: &'a str,
        year: i32,
    ) -> ServiceFuture<'a, Result<Vec<CriticCandidate>, CriticSourceError>> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        self.seen.lock().unwrap().push((title.to_owned(), year));
        (self.respond)(call)
    }
}

fn service(source: &Arc<FakeSource>) -> CriticScoreService {
    let source: Arc<dyn CriticSource> = Arc::<FakeSource>::clone(source);
    CriticScoreService::new(source)
}

// ---------------------------------------------------------------------------
// The cases of `server/src/__tests__/criticScoreService.test.ts`.
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn returns_the_matched_score() {
    let source = FakeSource::answering(Ok(vec![rated()]));
    assert_eq!(
        service(&source).score_for(&game()).await,
        CriticScore::new(84)
    );
}

#[tokio::test(start_paused = true)]
async fn returns_none_on_a_miss() {
    let source = FakeSource::answering(Ok(vec![]));
    assert_eq!(service(&source).score_for(&game()).await, None);
}

#[tokio::test(start_paused = true)]
async fn returns_none_and_skips_the_provider_when_the_date_is_missing() {
    let source = FakeSource::answering(Ok(vec![rated()]));
    let critics = service(&source);
    for date in ["", "soon"] {
        let undated = Game {
            date: date.into(),
            ..game()
        };
        assert_eq!(critics.score_for(&undated).await, None);
    }
    assert_eq!(source.calls(), 0);
}

#[tokio::test(start_paused = true)]
async fn degrades_a_provider_failure_to_none_and_logs_only_the_tag() {
    for error in [CriticSourceError::Unavailable, CriticSourceError::Rejected] {
        let logs = CapturedLogs::default();
        let source = FakeSource::answering(Err(error));
        {
            let _guard = logs.install();
            assert_eq!(service(&source).score_for(&game()).await, None);
        }
        let lines = logs.lines();
        assert_eq!(lines.len(), 1, "{}", logs.text());
        assert_eq!(lines[0]["level"], "WARN");
        assert_eq!(lines[0]["message"], "critic score lookup failed");
        assert_eq!(lines[0]["reason"], error.tag());
        assert!(lines[0].get("dropped_fields").is_none());
        let text = logs.text();
        assert!(!text.contains("Synthetic Quest"), "{text}");
        assert!(!text.contains(GAME_ID), "{text}");
    }
}

#[tokio::test(start_paused = true)]
async fn degrades_a_slow_provider_to_none_after_the_budget() {
    let source = FakeSource::new(|_| futures_util::future::pending().boxed());
    let started = tokio::time::Instant::now();
    assert_eq!(service(&source).score_for(&game()).await, None);
    assert_eq!(started.elapsed(), SCORE_BUDGET);
    assert_eq!(SCORE_BUDGET, Duration::from_millis(1500));
}

#[tokio::test(start_paused = true)]
async fn looks_a_game_up_once_per_day_for_a_hit_and_for_a_miss() {
    for answer in [vec![rated()], vec![]] {
        let source = FakeSource::answering(Ok(answer));
        let critics = service(&source);
        critics.score_for(&game()).await;
        critics.score_for(&game()).await;
        tokio::time::advance(Duration::from_hours(24) - Duration::from_millis(1)).await;
        critics.score_for(&game()).await;
        assert_eq!(source.calls(), 1);
        tokio::time::advance(Duration::from_millis(1)).await;
        critics.score_for(&game()).await;
        assert_eq!(source.calls(), 2);
    }
}

#[tokio::test(start_paused = true)]
async fn retries_a_failed_lookup_after_a_short_time() {
    let source = FakeSource::new(|call| {
        let outcome = if call == 0 {
            Err(CriticSourceError::Unavailable)
        } else {
            Ok(vec![rated()])
        };
        futures_util::future::ready(outcome).boxed()
    });
    let critics = service(&source);
    let first = critics.score_for(&game()).await;
    let cached = critics.score_for(&game()).await;
    tokio::time::advance(Duration::from_secs(60) - Duration::from_millis(1)).await;
    let still_cached = critics.score_for(&game()).await;
    tokio::time::advance(Duration::from_millis(1)).await;
    let retried = critics.score_for(&game()).await;
    assert_eq!(
        [first, cached, still_cached, retried],
        [None, None, None, CriticScore::new(84)]
    );
    assert_eq!(source.calls(), 2);
}

#[tokio::test(start_paused = true)]
async fn is_disabled_without_credentials() {
    let disabled = crate::wiring::NoCriticScores;
    assert_eq!(disabled.score_for(&game()).await, None);
}

// ---------------------------------------------------------------------------
// Challenge cases beyond the TypeScript tests.
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_lookup_that_runs_out_of_time_is_cached_as_a_failure() {
    let source = FakeSource::new(|_| futures_util::future::pending().boxed());
    let critics = service(&source);
    assert_eq!(critics.score_for(&game()).await, None);
    assert_eq!(critics.score_for(&game()).await, None);
    assert_eq!(source.calls(), 1, "the failure is cached");
    tokio::time::advance(SCORE_FAILURE_TTL).await;
    assert_eq!(critics.score_for(&game()).await, None);
    assert_eq!(source.calls(), 2);
}

#[tokio::test(start_paused = true)]
async fn concurrent_callers_share_one_lookup() {
    let source = FakeSource::new(|_| {
        async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(vec![rated()])
        }
        .boxed()
    });
    let critics = service(&source);
    let game = game();
    let (a, b) = tokio::join!(critics.score_for(&game), critics.score_for(&game));
    assert_eq!((a, b), (CriticScore::new(84), CriticScore::new(84)));
    assert_eq!(source.calls(), 1);
}

#[tokio::test(start_paused = true)]
async fn the_cache_key_is_the_id_the_title_and_the_year() {
    let source = FakeSource::answering(Ok(vec![]));
    let critics = service(&source);
    critics.score_for(&game()).await;
    let other_id = Game {
        id: "EP0001-PPSA00002_00-BETA000000000000".parse().unwrap(),
        ..game()
    };
    critics.score_for(&other_id).await;
    let other_title = Game {
        name: "Synthetic Quest II".into(),
        ..game()
    };
    critics.score_for(&other_title).await;
    let other_year = Game {
        date: "2024-11-14T00:00:00Z".into(),
        ..game()
    };
    critics.score_for(&other_year).await;
    let same_year = Game {
        date: "2023-01-02T00:00:00Z".into(),
        ..game()
    };
    critics.score_for(&same_year).await;
    assert_eq!(source.calls(), 4);
}

#[tokio::test(start_paused = true)]
async fn sends_only_the_title_and_the_utc_release_year() {
    let source = FakeSource::answering(Ok(vec![]));
    let late = Game {
        date: "2023-12-31T23:30:00-01:00".into(),
        ..game()
    };
    service(&source).score_for(&late).await;
    assert_eq!(
        *source.seen.lock().unwrap(),
        vec![("Synthetic Quest".to_owned(), 2024)]
    );
}

#[tokio::test(start_paused = true)]
async fn a_panicking_provider_degrades_to_none() {
    let source = FakeSource::new(|_| {
        async {
            panic!("synthetic provider panic");
        }
        .boxed()
    });
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        assert_eq!(service(&source).score_for(&game()).await, None);
    }
    let lines = logs.lines();
    assert_eq!(lines.len(), 1, "{}", logs.text());
    assert_eq!(lines[0]["reason"], "CriticSourceUnavailable");
}

#[test]
fn the_cache_settings_match_the_typescript_server() {
    assert_eq!(SCORE_CACHE_CAPACITY, 5_000);
    assert_eq!(SCORE_TTL, Duration::from_hours(24));
    assert_eq!(SCORE_FAILURE_TTL, Duration::from_secs(60));
    assert_eq!(score_ttl(Ok(None)), SCORE_TTL);
    assert_eq!(score_ttl(Ok(CriticScore::new(1))), SCORE_TTL);
    assert_eq!(
        score_ttl(Err(CriticSourceError::Rejected)),
        SCORE_FAILURE_TTL
    );
}

#[test]
fn error_values_carry_no_data() {
    assert_eq!(format!("{:?}", CriticSourceError::Rejected), "Rejected");
    assert_eq!(
        format!("{:?}", CriticSourceError::Unavailable),
        "Unavailable"
    );
}
