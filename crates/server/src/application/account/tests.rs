//! Tests of the account service with a fake Sony account client and a fake
//! store. They port `server/src/__tests__/accountService.test.ts`,
//! `wishlistEnrichment.test.ts`, and the account parts of `app.test.ts`.
//! All credential values are synthetic (STACK.md §14 → Fixtures).
//!
//! No test does I/O, so the clock is paused: a never-ending lookup meets its
//! deadline at once.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{Request, StatusCode};
use axum::response::Response;
use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use tokio::sync::watch;
use tower::ServiceExt;

use super::*;
use crate::application::Page;
use crate::domain::browse::{BrowseOrder, GenreKey};
use crate::domain::errors::{GameLookupError, UpstreamError};
use crate::domain::game::{GenreList, IdKind, PlusOffer};
use crate::domain::id::{ConceptId, GameId};
use crate::domain::library::WishlistId;
use crate::http::AppState;
use crate::http::static_files::StaticSite;
use crate::observability::testing::CapturedLogs;
use crate::wiring::NoCriticScores;

const NPSSO: &str = "synthetic-npsso-0123456789abcdefghijklmnop";
const OTHER_NPSSO: &str = "synthetic-npsso-bbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN: &str = "synthetic-access-token-qrstuvwxyz";

type Outcome<T> = Result<T, AccountError>;

fn rejected() -> AccountError {
    AccountError::session_rejected("no")
}

fn down() -> AccountError {
    AccountError::Upstream(UpstreamError::unavailable("down"))
}

fn limited() -> AccountError {
    AccountError::Upstream(UpstreamError::RateLimited {
        message: "slow".into(),
        retry_after_seconds: None,
    })
}

fn rotated() -> AccountError {
    AccountError::Upstream(UpstreamError::QueryRotated {
        message: "x".into(),
        operation_name: "op".into(),
    })
}

fn library_entry() -> PurchasedEntry {
    PurchasedEntry {
        product_id: "EP0001-PPSA00001_00-SYNTHETICALPHA00".parse().unwrap(),
        name: "Synthetic Alpha".into(),
        image_url: "https://img.test/alpha.png".into(),
    }
}

fn concept_entry() -> WishlistEntry {
    WishlistEntry {
        id: WishlistId::Concept(ConceptId::parse("10000002").unwrap()),
        name: "Wish Concept".into(),
        image_url: "https://img.test/concept.png".into(),
    }
}

fn sku(index: usize) -> String {
    format!("EP0001-PPSA{index:05}_00-SYNTHETIC{index:07}")
}

fn product_entry(index: usize) -> WishlistEntry {
    WishlistEntry {
        id: WishlistId::Product(sku(index).parse().unwrap()),
        name: format!("Wish {index}"),
        image_url: format!("https://img.test/wish{index}.png"),
    }
}

fn store_game(id: &str) -> Game {
    Game {
        id: id.parse().unwrap(),
        name: format!("Store {id}"),
        date: "2025-01-02T00:00:00.000Z".into(),
        url: "https://img.test/store.png".into(),
        price: "€39,99".into(),
        original_price: "€59,99".into(),
        discount_text: "-33%".into(),
        discount_date: String::new(),
        screenshots: vec![],
        videos: vec![],
        genres: vec!["Action".into()],
        description: String::new(),
        studio: String::new(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: Some(PlusOffer::Price {
            price: "€29,99".into(),
        }),
        id_kind: IdKind::Product,
    }
}

// ---------------------------------------------------------------------------
// The fake Sony account client.
// ---------------------------------------------------------------------------

/// A gate that holds a call until the test opens it.
#[derive(Clone)]
struct Gate(watch::Receiver<bool>);

fn gate() -> (watch::Sender<bool>, Gate) {
    let (open, wait) = watch::channel(false);
    (open, Gate(wait))
}

impl Gate {
    async fn pass(mut self) {
        // A dropped sender also opens the gate.
        self.0.wait_for(|open| *open).await.ok();
    }
}

type ExchangeFn = Box<dyn Fn(usize) -> Outcome<Secret> + Send + Sync>;

struct FakeSony {
    /// The outcome of exchange number `n`, counting from 1.
    exchange: ExchangeFn,
    exchange_gate: Option<Gate>,
    purchased: Outcome<Vec<PurchasedEntry>>,
    purchased_gate: Option<Gate>,
    wishlist: Outcome<Vec<WishlistEntry>>,
    exchanges: AtomicUsize,
    /// Exchanges that ran to their end.
    exchanges_done: AtomicUsize,
    /// The raw credential values that the fake received, for assertions.
    npssos: Mutex<Vec<String>>,
    purchased_tokens: Mutex<Vec<String>>,
    wishlist_tokens: Mutex<Vec<String>>,
}

impl FakeSony {
    fn ok() -> Self {
        Self {
            exchange: Box::new(|_| Ok(Secret::new(TOKEN))),
            exchange_gate: None,
            purchased: Ok(vec![library_entry()]),
            purchased_gate: None,
            wishlist: Ok(vec![concept_entry()]),
            exchanges: AtomicUsize::new(0),
            exchanges_done: AtomicUsize::new(0),
            npssos: Mutex::default(),
            purchased_tokens: Mutex::default(),
            wishlist_tokens: Mutex::default(),
        }
    }

    fn failing_exchange(error: AccountError) -> Self {
        Self {
            exchange: Box::new(move |_| Err(error.clone())),
            ..Self::ok()
        }
    }

    fn exchanges(&self) -> usize {
        self.exchanges.load(Ordering::SeqCst)
    }

    fn purchased_calls(&self) -> usize {
        self.purchased_tokens.lock().unwrap().len()
    }

    fn wishlist_calls(&self) -> usize {
        self.wishlist_tokens.lock().unwrap().len()
    }
}

impl SonyAccount for FakeSony {
    fn exchange_npsso(&self, npsso: Secret) -> ServiceFuture<'_, Outcome<Secret>> {
        let call = self.exchanges.fetch_add(1, Ordering::SeqCst) + 1;
        self.npssos.lock().unwrap().push(npsso.expose().to_owned());
        let gate = self.exchange_gate.clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.pass().await;
            }
            self.exchanges_done.fetch_add(1, Ordering::SeqCst);
            (self.exchange)(call)
        })
    }

    fn purchased_games(
        &self,
        access_token: Secret,
    ) -> ServiceFuture<'_, Outcome<Vec<PurchasedEntry>>> {
        self.purchased_tokens
            .lock()
            .unwrap()
            .push(access_token.expose().to_owned());
        let gate = self.purchased_gate.clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.pass().await;
            }
            self.purchased.clone()
        })
    }

    fn wishlist_games(
        &self,
        access_token: Secret,
    ) -> ServiceFuture<'_, Outcome<Vec<WishlistEntry>>> {
        self.wishlist_tokens
            .lock()
            .unwrap()
            .push(access_token.expose().to_owned());
        let outcome = self.wishlist.clone();
        Box::pin(async move { outcome })
    }
}

// ---------------------------------------------------------------------------
// The fake store.
// ---------------------------------------------------------------------------

type LookupFn =
    Box<dyn Fn(GameId) -> BoxFuture<'static, Result<Game, GameLookupError>> + Send + Sync>;

struct FakeGames {
    lookup: LookupFn,
    lookups: Mutex<Vec<GameId>>,
}

impl FakeGames {
    fn new(
        lookup: impl Fn(GameId) -> BoxFuture<'static, Result<Game, GameLookupError>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self {
            lookup: Box::new(lookup),
            lookups: Mutex::default(),
        }
    }

    /// A store with no games: every id is unknown.
    fn empty() -> Self {
        Self::new(|id| async move { Err(GameLookupError::NotFound { id }) }.boxed())
    }

    fn found() -> Self {
        Self::new(|id| async move { Ok(store_game(id.as_str())) }.boxed())
    }
}

fn no_list() -> ServiceFuture<'static, Result<PageResult, UpstreamError>> {
    Box::pin(async { Err(UpstreamError::unavailable("not used")) })
}

impl GamesApi for FakeGames {
    fn new_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        no_list()
    }
    fn upcoming_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        no_list()
    }
    fn discounted_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        no_list()
    }
    fn monthly_games(&self, _: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        no_list()
    }
    fn search_games(
        &self,
        _: String,
        _: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        no_list()
    }
    fn genres(&self) -> ServiceFuture<'_, Result<GenreList, UpstreamError>> {
        Box::pin(async { Err(UpstreamError::unavailable("not used")) })
    }
    fn browse_games(
        &self,
        _: GenreKey,
        _: BrowseOrder,
        _: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        no_list()
    }
    fn game_by_id(&self, id: GameId) -> ServiceFuture<'_, Result<Game, GameLookupError>> {
        self.lookups.lock().unwrap().push(id.clone());
        (self.lookup)(id)
    }
}

struct Harness {
    sony: Arc<FakeSony>,
    games: Arc<FakeGames>,
    service: Arc<AccountService>,
}

fn harness_with(sony: FakeSony, games: FakeGames) -> Harness {
    let sony = Arc::new(sony);
    let games = Arc::new(games);
    let sony_port: Arc<dyn SonyAccount> = sony.clone();
    let games_port: Arc<dyn GamesApi> = games.clone();
    Harness {
        sony,
        games,
        service: Arc::new(AccountService::new(sony_port, games_port)),
    }
}

fn harness(sony: FakeSony) -> Harness {
    harness_with(sony, FakeGames::empty())
}

fn npsso() -> Secret {
    Secret::new(NPSSO)
}

/// Lets every ready task run, like `settle` in the TypeScript tests.
async fn settle() {
    for _ in 0..30 {
        tokio::task::yield_now().await;
    }
}

// ---------------------------------------------------------------------------
// The account service.
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn returns_the_whole_library_as_one_page() {
    let h = harness(FakeSony::ok());
    let page = h.service.purchased_games(npsso()).await.unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.next_offset, None);
    assert_eq!(page.games[0].name, "Synthetic Alpha");
    assert_eq!(page.games[0].id_kind, IdKind::Product);
    assert_eq!(page.games[0].price, "");
}

#[tokio::test(start_paused = true)]
async fn returns_an_empty_page_for_an_empty_library() {
    let h = harness(FakeSony {
        purchased: Ok(vec![]),
        ..FakeSony::ok()
    });
    let page = h.service.purchased_games(npsso()).await.unwrap();
    assert_eq!(
        page,
        PageResult {
            games: vec![],
            total_count: 0,
            next_offset: None
        }
    );
}

#[tokio::test(start_paused = true)]
async fn passes_each_sony_failure_through_unchanged() {
    for failure in [rejected(), limited(), down()] {
        let h = harness(FakeSony::failing_exchange(failure.clone()));
        assert_eq!(
            h.service.purchased_games(npsso()).await,
            Err(failure.clone())
        );
        assert_eq!(
            h.sony.purchased_calls(),
            0,
            "no library call after a failed exchange"
        );
        assert_eq!(
            h.service.wishlist_games(npsso()).await,
            Err(failure.clone())
        );
        assert_eq!(
            h.sony.wishlist_calls(),
            0,
            "no wishlist call after a failed exchange"
        );
        assert_eq!(h.service.verify_npsso(npsso()).await, Err(failure));
    }
    for failure in [rejected(), limited(), down(), rotated()] {
        let h = harness(FakeSony {
            purchased: Err(failure.clone()),
            wishlist: Err(failure.clone()),
            ..FakeSony::ok()
        });
        assert_eq!(
            h.service.purchased_games(npsso()).await,
            Err(failure.clone())
        );
        assert_eq!(h.service.wishlist_games(npsso()).await, Err(failure));
    }
}

#[tokio::test(start_paused = true)]
async fn returns_the_whole_wishlist_as_one_page() {
    let h = harness(FakeSony::ok());
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.next_offset, None);
    let card = &page.games[0];
    assert_eq!(card.id, "10000002");
    assert_eq!(card.id_kind, IdKind::Concept);
    assert_eq!(card.name, "Wish Concept");
    assert_eq!(card.price, "");
}

#[tokio::test(start_paused = true)]
async fn returns_an_empty_page_for_an_empty_wishlist() {
    let h = harness(FakeSony {
        wishlist: Ok(vec![]),
        ..FakeSony::ok()
    });
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    assert!(page.games.is_empty(), "{:?}", page.games);
    assert_eq!(page.total_count, 0);
}

#[tokio::test(start_paused = true)]
async fn exchanges_the_npsso_again_for_each_sequential_call() {
    let h = harness(FakeSony::ok());
    h.service.purchased_games(npsso()).await.unwrap();
    h.service.purchased_games(npsso()).await.unwrap();
    h.service.verify_npsso(npsso()).await.unwrap();
    assert_eq!(h.sony.exchanges(), 3);
}

#[tokio::test(start_paused = true)]
async fn passes_the_npsso_to_the_exchange_and_the_token_to_the_lists() {
    let h = harness(FakeSony::ok());
    assert_eq!(h.service.verify_npsso(npsso()).await, Ok(()));
    h.service.purchased_games(npsso()).await.unwrap();
    h.service.wishlist_games(npsso()).await.unwrap();
    assert_eq!(*h.sony.npssos.lock().unwrap(), [NPSSO, NPSSO, NPSSO]);
    assert_eq!(*h.sony.purchased_tokens.lock().unwrap(), [TOKEN]);
    assert_eq!(*h.sony.wishlist_tokens.lock().unwrap(), [TOKEN]);
}

// ---------------------------------------------------------------------------
// The shared exchange.
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn shares_one_exchange_between_concurrent_calls_with_equal_npsso_values() {
    let (open, wait) = gate();
    let h = harness(FakeSony {
        exchange_gate: Some(wait),
        ..FakeSony::ok()
    });
    let service = &h.service;
    let both = async {
        tokio::join!(
            service.purchased_games(Secret::new(NPSSO)),
            service.verify_npsso(Secret::new(NPSSO)),
        )
    };
    let release = async {
        settle().await;
        assert_eq!(h.sony.exchanges(), 1);
        assert_eq!(service.exchanges.len(), 1);
        open.send_replace(true);
    };
    let ((purchased, verified), ()) = tokio::join!(both, release);
    assert!(purchased.is_ok());
    assert_eq!(verified, Ok(()));
    assert_eq!(h.sony.exchanges(), 1);
    assert!(
        service.exchanges.is_empty(),
        "no entry and no token after the exchange"
    );
}

#[tokio::test(start_paused = true)]
async fn exchanges_separately_for_different_npsso_values() {
    let (open, wait) = gate();
    let h = harness(FakeSony {
        exchange_gate: Some(wait),
        ..FakeSony::ok()
    });
    let service = &h.service;
    let both = async {
        tokio::join!(
            service.verify_npsso(Secret::new(NPSSO)),
            service.verify_npsso(Secret::new(OTHER_NPSSO)),
        )
    };
    let release = async {
        settle().await;
        assert_eq!(h.sony.exchanges(), 2);
        open.send_replace(true);
    };
    let ((first, second), ()) = tokio::join!(both, release);
    assert_eq!((first, second), (Ok(()), Ok(())));
}

#[tokio::test(start_paused = true)]
async fn shares_a_failing_exchange_then_exchanges_again_on_a_later_call() {
    let (open, wait) = gate();
    let h = harness(FakeSony {
        exchange: Box::new(|call| {
            if call == 1 {
                Err(down())
            } else {
                Ok(Secret::new(TOKEN))
            }
        }),
        exchange_gate: Some(wait),
        ..FakeSony::ok()
    });
    let service = &h.service;
    let both = async {
        tokio::join!(
            service.verify_npsso(Secret::new(NPSSO)),
            service.verify_npsso(Secret::new(NPSSO)),
        )
    };
    let release = async {
        settle().await;
        open.send_replace(true);
    };
    let ((first, second), ()) = tokio::join!(both, release);
    assert_eq!((first, second), (Err(down()), Err(down())));
    assert_eq!(h.sony.exchanges(), 1);
    assert!(service.exchanges.is_empty(), "a failure is not kept");
    assert_eq!(service.verify_npsso(Secret::new(NPSSO)).await, Ok(()));
    assert_eq!(h.sony.exchanges(), 2);
}

#[tokio::test(start_paused = true)]
async fn the_other_waiter_succeeds_when_one_waiter_leaves() {
    let (open, wait) = gate();
    let h = harness(FakeSony {
        exchange_gate: Some(wait),
        ..FakeSony::ok()
    });
    let service = Arc::clone(&h.service);
    let first = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.verify_npsso(Secret::new(NPSSO)).await }
    });
    let second = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.verify_npsso(Secret::new(NPSSO)).await }
    });
    settle().await;
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    open.send_replace(true);
    assert_eq!(second.await.unwrap(), Ok(()));
    assert_eq!(h.sony.exchanges(), 1);
}

/// A deliberate difference from the TypeScript server: `RcMap` interrupted
/// the exchange when every waiter left. `InFlight` lets the exchange end on
/// its own, within its deadline, and then drops the entry and the token.
#[tokio::test(start_paused = true)]
async fn the_exchange_ends_and_its_entry_goes_when_every_waiter_leaves() {
    let (open, wait) = gate();
    let h = harness(FakeSony {
        exchange_gate: Some(wait),
        ..FakeSony::ok()
    });
    let service = &h.service;
    for _ in 0..2 {
        let left = tokio::time::timeout(
            std::time::Duration::from_millis(1),
            service.verify_npsso(Secret::new(NPSSO)),
        )
        .await;
        assert!(left.is_err(), "the waiter leaves before the exchange ends");
    }
    assert_eq!(h.sony.exchanges(), 1);
    assert_eq!(service.exchanges.len(), 1);
    open.send_replace(true);
    settle().await;
    assert_eq!(h.sony.exchanges_done.load(Ordering::SeqCst), 1);
    assert!(service.exchanges.is_empty(), "no entry and no token remain");
}

#[tokio::test(start_paused = true)]
async fn closes_the_shared_entry_before_the_library_crawl() {
    let (open, wait) = gate();
    let h = harness(FakeSony {
        purchased_gate: Some(wait),
        ..FakeSony::ok()
    });
    let service = &h.service;
    let crawl = service.purchased_games(Secret::new(NPSSO));
    let check = async {
        settle().await;
        assert_eq!(h.sony.exchanges(), 1);
        assert_eq!(h.sony.purchased_calls(), 1, "the crawl runs");
        assert!(
            service.exchanges.is_empty(),
            "the entry ended before the crawl"
        );
        assert_eq!(service.verify_npsso(Secret::new(NPSSO)).await, Ok(()));
        assert_eq!(h.sony.exchanges(), 2, "a new call exchanges again");
        open.send_replace(true);
    };
    let (crawled, ()) = tokio::join!(crawl, check);
    assert!(crawled.is_ok());
}

#[tokio::test(start_paused = true)]
async fn the_debug_output_holds_no_credential_during_an_exchange() {
    let (open, wait) = gate();
    let h = harness(FakeSony {
        exchange_gate: Some(wait),
        ..FakeSony::ok()
    });
    let service = &h.service;
    let call = service.verify_npsso(Secret::new(NPSSO));
    let check = async {
        settle().await;
        assert_eq!(service.exchanges.len(), 1, "the entry holds the NPSSO now");
        let text = format!("{service:?}");
        assert!(!text.contains(NPSSO), "{text}");
        assert!(!text.contains(TOKEN), "{text}");
        open.send_replace(true);
    };
    let (outcome, ()) = tokio::join!(call, check);
    assert_eq!(outcome, Ok(()));
}

#[tokio::test(start_paused = true)]
async fn a_failure_logs_only_its_tag() {
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        for failure in [rejected(), limited(), down()] {
            let h = harness(FakeSony::failing_exchange(failure));
            assert!(h.service.verify_npsso(npsso()).await.is_err());
            assert!(h.service.purchased_games(npsso()).await.is_err());
            assert!(h.service.wishlist_games(npsso()).await.is_err());
        }
        let h = harness(FakeSony {
            wishlist: Err(rotated()),
            ..FakeSony::ok()
        });
        assert!(h.service.wishlist_games(npsso()).await.is_err());
    }
    let lines = logs.lines();
    let reasons: Vec<_> = lines
        .iter()
        .filter(|line| line["message"] == "account request failed")
        .map(|line| line["reason"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        reasons,
        [
            "SessionRejected",
            "SessionRejected",
            "SessionRejected",
            "UpstreamRateLimited",
            "UpstreamRateLimited",
            "UpstreamRateLimited",
            "UpstreamUnavailable",
            "UpstreamUnavailable",
            "UpstreamUnavailable",
            "UpstreamQueryRotated",
        ]
    );
    for line in &lines {
        assert_eq!(line["level"], "WARN", "{line}");
        assert!(line.get("dropped_fields").is_none(), "{line}");
    }
    let text = logs.text();
    for secret in [NPSSO, TOKEN, "no", "down", "slow"] {
        assert!(!text.contains(&format!("\"{secret}\"")), "{text}");
    }
    assert!(!text.contains(NPSSO) && !text.contains(TOKEN), "{text}");
}

// ---------------------------------------------------------------------------
// The wishlist enrichment.
// ---------------------------------------------------------------------------

/// The paused clock advanced to the deadline, not to a later timer.
fn within_a_second_after(started: tokio::time::Instant, deadline: std::time::Duration) {
    let elapsed = started.elapsed();
    assert!(elapsed >= deadline, "{elapsed:?}");
    assert!(
        elapsed < deadline + std::time::Duration::from_secs(1),
        "{elapsed:?}"
    );
}

fn wishlist_harness(entries: Vec<WishlistEntry>, games: FakeGames) -> Harness {
    harness_with(
        FakeSony {
            wishlist: Ok(entries),
            ..FakeSony::ok()
        },
        games,
    )
}

#[tokio::test(start_paused = true)]
async fn fills_date_prices_and_the_plus_offer_from_the_store_in_order() {
    let h = wishlist_harness(vec![product_entry(1), product_entry(2)], FakeGames::found());
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    let ids: Vec<_> = page.games.iter().map(|g| g.id.clone()).collect();
    assert_eq!(ids, [sku(1), sku(2)]);
    let first = &page.games[0];
    assert_eq!(first.price, "€39,99");
    assert_eq!(first.original_price, "€59,99");
    assert_eq!(first.discount_text, "-33%");
    assert_eq!(first.date, "2025-01-02T00:00:00.000Z");
    assert_eq!(
        first.plus_offer,
        Some(PlusOffer::Price {
            price: "€29,99".into()
        })
    );
    assert_eq!(page.total_count, 2);
    assert_eq!(page.next_offset, None);
}

#[tokio::test(start_paused = true)]
async fn keeps_a_minimal_card_when_the_store_has_no_such_game() {
    let h = wishlist_harness(vec![product_entry(1)], FakeGames::empty());
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    let card = &page.games[0];
    assert_eq!(card.id, sku(1));
    assert_eq!(card.name, "Wish 1");
    assert_eq!(card.url, "https://img.test/wish1.png");
    assert_eq!((card.price.as_str(), card.date.as_str()), ("", ""));
    assert_eq!(card.plus_offer, None);
}

#[tokio::test(start_paused = true)]
async fn degrades_only_the_entry_whose_lookup_failed() {
    let failing = sku(2);
    let games = FakeGames::new(move |id| {
        let failing = failing.clone();
        async move {
            if id.as_str() == failing {
                Err(GameLookupError::Upstream(UpstreamError::unavailable(
                    "down",
                )))
            } else {
                Ok(store_game(id.as_str()))
            }
        }
        .boxed()
    });
    let h = wishlist_harness(
        vec![product_entry(1), product_entry(2), product_entry(3)],
        games,
    );
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    let prices: Vec<_> = page.games.iter().map(|g| g.price.as_str()).collect();
    assert_eq!(prices, ["€39,99", "", "€39,99"]);
    assert_eq!(page.games[1].name, "Wish 2");
}

#[tokio::test(start_paused = true)]
async fn degrades_an_entry_whose_lookup_is_slower_than_its_deadline() {
    let slow = sku(1);
    let games = FakeGames::new(move |id| {
        let slow = slow.clone();
        async move {
            if id.as_str() == slow {
                std::future::pending::<()>().await;
            }
            Ok(store_game(id.as_str()))
        }
        .boxed()
    });
    let h = wishlist_harness(vec![product_entry(1), product_entry(2)], games);
    let started = tokio::time::Instant::now();
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    let prices: Vec<_> = page.games.iter().map(|g| g.price.as_str()).collect();
    assert_eq!(prices, ["", "€39,99"]);
    within_a_second_after(started, WISHLIST_ENRICH_ENTRY_TIMEOUT);
}

/// Like the TypeScript server, a list that runs past its deadline answers
/// minimal cards only, also for entries whose lookup had already ended.
#[tokio::test(start_paused = true)]
async fn falls_back_to_minimal_cards_when_the_whole_list_runs_past_its_deadline() {
    let fast = sku(1);
    let games = FakeGames::new(move |id| {
        let fast = fast.clone();
        async move {
            if id.as_str() != fast {
                std::future::pending::<()>().await;
            }
            Ok(store_game(id.as_str()))
        }
        .boxed()
    });
    let entries: Vec<_> = (1..=30).map(product_entry).collect();
    let h = wishlist_harness(entries, games);
    let started = tokio::time::Instant::now();
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    within_a_second_after(started, WISHLIST_ENRICH_TOTAL_TIMEOUT);
    assert_eq!(page.games.len(), 30);
    assert_eq!(page.total_count, 30);
    assert!(page.games.iter().all(|g| g.price.is_empty()));
    assert_eq!(page.games[0].name, "Wish 1");
    assert_eq!(page.games[29].name, "Wish 30");
}

#[tokio::test(start_paused = true)]
async fn never_looks_up_a_concept_entry() {
    let h = wishlist_harness(vec![concept_entry()], FakeGames::found());
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    assert!(h.games.lookups.lock().unwrap().is_empty());
    let card = &page.games[0];
    assert_eq!(card.id, "10000002");
    assert_eq!(card.id_kind, IdKind::Concept);
    assert_eq!(card.price, "");
}

#[tokio::test(start_paused = true)]
async fn runs_a_bounded_number_of_lookups_at_once() {
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let games = FakeGames::new({
        let (active, peak) = (Arc::clone(&active), Arc::clone(&peak));
        move |id| {
            let (active, peak) = (Arc::clone(&active), Arc::clone(&peak));
            async move {
                let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                active.fetch_sub(1, Ordering::SeqCst);
                Ok(store_game(id.as_str()))
            }
            .boxed()
        }
    });
    let entries: Vec<_> = (1..=20).map(product_entry).collect();
    let h = wishlist_harness(entries, games);
    let page = h.service.wishlist_games(npsso()).await.unwrap();
    assert!(page.games.iter().all(|g| g.price == "€39,99"));
    assert_eq!(peak.load(Ordering::SeqCst), WISHLIST_ENRICH_CONCURRENCY);
    assert_eq!(h.games.lookups.lock().unwrap().len(), 20);
}

#[tokio::test(start_paused = true)]
async fn caches_neither_the_wishlist_nor_the_exchange_between_calls() {
    let h = wishlist_harness(vec![product_entry(1)], FakeGames::found());
    h.service.wishlist_games(npsso()).await.unwrap();
    h.service.wishlist_games(npsso()).await.unwrap();
    assert_eq!(h.sony.wishlist_calls(), 2);
    assert_eq!(h.sony.exchanges(), 2);
}

#[tokio::test(start_paused = true)]
async fn the_enrichment_logs_counts_only() {
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        let h = wishlist_harness(vec![product_entry(1), concept_entry()], FakeGames::found());
        h.service.wishlist_games(npsso()).await.unwrap();
    }
    let lines = logs.lines();
    let line = lines
        .iter()
        .find(|line| line["message"] == "wishlist enriched")
        .unwrap();
    assert_eq!(line["entries"], 2);
    assert_eq!(line["priced"], 1);
    assert_eq!(line["level"], "INFO");
    assert!(line.get("dropped_fields").is_none(), "{line}");
    let text = logs.text();
    for data in ["Wish", "Store", &sku(1), "10000002", NPSSO, TOKEN] {
        assert!(!text.contains(data), "{text} contains {data}");
    }
}

// ---------------------------------------------------------------------------
// The routes with the real service. `http/tests.rs` covers the cookie rules
// with a fake service; these tests cover the connection to the service.
// ---------------------------------------------------------------------------

fn router_for(h: &Harness) -> axum::Router {
    let games: Arc<dyn GamesApi> = h.games.clone();
    let account: Arc<dyn AccountApi> = h.service.clone();
    crate::http::router(AppState {
        games,
        critics: Arc::new(NoCriticScores),
        account,
        site: Arc::new(StaticSite::new("/nonexistent/psstore-build")),
        build: Arc::default(),
    })
}

async fn send(h: &Harness, request: Request<Body>) -> Response {
    router_for(h).oneshot(request).await.unwrap()
}

async fn get_signed_in(h: &Harness, path: &str) -> Response {
    send(
        h,
        Request::get(path)
            .header(COOKIE, format!("npsso={NPSSO}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await
}

async fn sign_in(h: &Harness) -> Response {
    send(
        h,
        Request::post("/api/session")
            .header("content-type", "application/json")
            .body(Body::from(format!(r#"{{"npsso":"{NPSSO}"}}"#)))
            .unwrap(),
    )
    .await
}

async fn text(response: Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn set_cookies(response: &Response) -> Vec<String> {
    response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_owned())
        .collect()
}

#[tokio::test(start_paused = true)]
async fn serves_both_lists_through_the_routes_and_exchanges_on_every_request() {
    let h = harness(FakeSony::ok());
    let response = get_signed_in(&h, "/api/games/purchased").await;
    assert_eq!(response.status(), StatusCode::OK);
    let found = set_cookies(&response);
    assert!(found.is_empty(), "{found:?}");
    let body: serde_json::Value = serde_json::from_str(&text(response).await).unwrap();
    assert_eq!(body["totalCount"], 1);
    assert_eq!(body["nextOffset"], serde_json::Value::Null);
    assert_eq!(
        body["games"][0]["id"],
        "EP0001-PPSA00001_00-SYNTHETICALPHA00"
    );
    assert_eq!(body["games"][0]["idKind"], "product");
    assert_eq!(body["games"][0]["price"], "");

    let response = get_signed_in(&h, "/api/games/wishlist").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = serde_json::from_str(&text(response).await).unwrap();
    assert_eq!(body["games"][0]["id"], "10000002");
    assert_eq!(body["games"][0]["idKind"], "concept");

    get_signed_in(&h, "/api/games/purchased").await;
    assert_eq!(h.sony.exchanges(), 3, "no cache: one exchange per request");
    assert_eq!(*h.sony.purchased_tokens.lock().unwrap(), [TOKEN, TOKEN]);
    assert_eq!(*h.sony.wishlist_tokens.lock().unwrap(), [TOKEN]);
}

#[tokio::test(start_paused = true)]
async fn sign_in_verifies_once_and_sets_the_cookie_without_a_library_call() {
    let h = harness(FakeSony::ok());
    let response = sign_in(&h).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(set_cookies(&response).len(), 1);
    let body = text(response).await;
    assert_eq!(body, "");
    assert_eq!(h.sony.exchanges(), 1);
    assert_eq!(h.sony.purchased_calls() + h.sony.wishlist_calls(), 0);
}

#[tokio::test(start_paused = true)]
async fn only_a_rejection_answers_401_and_expires_the_cookie() {
    let cases: Vec<(FakeSony, StatusCode, usize)> = vec![
        (
            FakeSony::failing_exchange(rejected()),
            StatusCode::UNAUTHORIZED,
            1,
        ),
        (
            FakeSony {
                purchased: Err(rejected()),
                ..FakeSony::ok()
            },
            StatusCode::UNAUTHORIZED,
            1,
        ),
        (
            FakeSony {
                purchased: Err(down()),
                ..FakeSony::ok()
            },
            StatusCode::BAD_GATEWAY,
            0,
        ),
        (
            FakeSony::failing_exchange(limited()),
            StatusCode::SERVICE_UNAVAILABLE,
            0,
        ),
        (
            FakeSony {
                purchased: Err(rotated()),
                ..FakeSony::ok()
            },
            StatusCode::BAD_GATEWAY,
            0,
        ),
    ];
    for (sony, status, cleared) in cases {
        let h = harness(sony);
        let response = get_signed_in(&h, "/api/games/purchased").await;
        assert_eq!(response.status(), status);
        assert_eq!(set_cookies(&response).len(), cleared, "{status}");
    }
}

#[tokio::test(start_paused = true)]
async fn the_routes_never_log_the_npsso_the_token_or_a_location() {
    let logs = CapturedLogs::default();
    {
        let _guard = logs.install();
        let h = harness(FakeSony {
            purchased: Err(down()),
            wishlist: Err(down()),
            ..FakeSony::ok()
        });
        get_signed_in(&h, "/api/games/purchased").await;
        get_signed_in(&h, "/api/games/wishlist").await;
        sign_in(&h).await;
        let rejected = harness(FakeSony::failing_exchange(rejected()));
        get_signed_in(&rejected, "/api/games/purchased").await;
        sign_in(&rejected).await;
    }
    let text = logs.text();
    assert!(!logs.lines().is_empty(), "the value is empty");
    assert!(!text.contains(NPSSO), "{text}");
    assert!(!text.contains(TOKEN), "{text}");
    assert!(!text.to_lowercase().contains("location"), "{text}");
}
