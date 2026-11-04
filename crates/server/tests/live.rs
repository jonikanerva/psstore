//! The live Sony check (port of `smoke.integration.test.ts` and the live
//! client checks of `pnpm test:live`). Every test is `#[ignore]`, so
//! `cargo test` never reaches the network. Run it on purpose:
//!
//! ```text
//! mise exec -- cargo test --locked --test live -- --ignored --nocapture
//! ```
//!
//! Each test decodes a real answer through the production boundary and
//! prints the per-feature counts with the `[test:live]` prefix of the
//! TypeScript suite. A Sony drift that drops or empties a list fails here.
//!
//! Load fence, as in the TypeScript suite: one grid request per feature, one
//! genre list, one BROWSE page without product lookups, one monthly feed,
//! one search page per term, and a few single product lookups. The service
//! checks at the end read only the cheap paths (genres, monthly, and one game
//! page). They never drive the NEW enrichment, which fans out to hundreds of
//! product lookups.
//!
//! Upstream flakiness (#204): Sony sometimes fails a request at the transport
//! level, and Sony sometimes answers a search with no results at all. Each
//! lookup therefore gets at most [`ATTEMPTS`] attempts (see [`live`]). Only a
//! transport failure and an empty search answer start a new attempt. A drift,
//! a rotated query, a rate limit, or an error status fails at once. Each new
//! attempt prints a `[test:live] RETRY` line, so the run output shows it. In
//! the worst case, the load is [`ATTEMPTS`] times the fence above.

#![expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "the helpers of this test binary fail a check by panicking"
)]

use std::cell::Cell;
use std::sync::Arc;
use std::time::Duration;

use psstore_server::application::games::GamesService;
use psstore_server::application::{GamesApi, Page, SystemClock};
use psstore_server::domain::browse::{BrowseOrder, GenreKey};
use psstore_server::domain::catalog::{BrowseRequest, Concept, SearchPage, SonyFeature};
use psstore_server::domain::errors::{GameLookupError, UpstreamError};
use psstore_server::domain::game::Game;
use psstore_server::domain::listing::{
    browse_candidate_ids, is_ps5_game, map_concepts_to_games, map_upcoming_concepts_to_games,
};
use psstore_server::domain::mapper::product_detail_to_game;
use psstore_server::sources::sony::catalog::{
    BrowseOutcome, CategoryGridOutcome, GenresOutcome, GridQuery, SonyCatalog, SonyCatalogClient,
    extract_browse_page, extract_category_grid, extract_genres,
};
use psstore_server::sources::sony::contract::SonyContract;

fn client() -> SonyCatalogClient {
    SonyCatalogClient::new(&SonyContract::load().unwrap()).unwrap()
}

/// The maximum number of attempts of one live lookup.
const ATTEMPTS: u32 = 3;

/// The pause before a new attempt.
const PAUSE: Duration = Duration::from_secs(2);

/// The fixed message of a transport failure (a timeout or a connection
/// failure after the retries of the transport). `upstream_error` in
/// `crates/server/src/sources/sony/catalog.rs` sets this text. If that text
/// changes, no lookup gets a new attempt, so a failure stays visible.
const TRANSPORT_FAILURE: &str = "Sony upstream unavailable";

/// True only for a transport failure. Every other failure is a possible
/// contract drift and must fail the check at once.
fn is_transport_failure(error: &UpstreamError) -> bool {
    matches!(error, UpstreamError::Unavailable { message } if message == TRANSPORT_FAILURE)
}

/// Runs one live lookup with at most [`ATTEMPTS`] attempts. A new attempt
/// starts only after a transport failure, or after a value that `is_empty`
/// accepts. After the last attempt, an empty value goes back to the caller,
/// so the assertion of the check fails. Any other failure panics at once.
#[expect(
    clippy::print_stdout,
    reason = "the RETRY line is part of the evidence of the live run"
)]
async fn live<T>(
    label: &str,
    lookup: impl AsyncFn() -> Result<T, UpstreamError>,
    is_empty: impl Fn(&T) -> bool,
) -> T {
    let mut attempt = 1;
    loop {
        let reason = match lookup().await {
            Ok(value) if attempt < ATTEMPTS && is_empty(&value) => "empty",
            Ok(value) => return value,
            Err(error) if attempt < ATTEMPTS && is_transport_failure(&error) => "transport",
            Err(error) => panic!("{label}: {error:?} (attempt {attempt}/{ATTEMPTS})"),
        };
        println!(
            "[test:live] RETRY label={label} failedAttempt={attempt}/{ATTEMPTS} reason={reason}"
        );
        tokio::time::sleep(PAUSE).await;
        attempt += 1;
    }
}

/// A live lookup that only a transport failure repeats.
async fn live_once<T>(label: &str, lookup: impl AsyncFn() -> Result<T, UpstreamError>) -> T {
    live(label, lookup, |_| false).await
}

/// One search page of 50. An answer with no result elements at all gets a
/// new attempt: Sony sometimes answers a known term with nothing (#204).
/// `raw_count` counts the dropped elements too, so an element drift is never
/// empty here and fails the check at once. An envelope drift is an error
/// that is not a transport failure, so it also fails at once.
async fn search(term: &str) -> SearchPage {
    live(
        &format!("search:{term}"),
        async || client().search_page(term.into(), 0, 50).await,
        |page: &SearchPage| page.raw_count == 0,
    )
    .await
}

/// One grid page of 60, like the TypeScript suite.
async fn grid(feature: SonyFeature) -> (Vec<Concept>, usize) {
    let json = live_once(&format!("grid:{}", feature.as_str()), async || {
        client()
            .category_grid_json(&GridQuery::Feature {
                feature,
                size: 60,
                offset: 0,
            })
            .await
    })
    .await;
    match extract_category_grid(&json) {
        CategoryGridOutcome::Ok { concepts, dropped } => (concepts, dropped),
        CategoryGridOutcome::Drift => panic!("the {} grid drifted", feature.as_str()),
    }
}

/// No silent drops: `dropped == 0`, and concepts map to at least one game.
fn assert_no_silent_drops(
    concepts: &[Concept],
    dropped: usize,
    map: fn(&[Concept], i64) -> Vec<Game>,
) {
    assert_eq!(dropped, 0);
    if !concepts.is_empty() {
        assert!(!map(concepts, 0).is_empty(), "the value is empty");
    }
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn new_decodes_without_drops() {
    let (concepts, dropped) = grid(SonyFeature::New).await;
    assert_no_silent_drops(&concepts, dropped, map_concepts_to_games);
    assert!(!concepts.is_empty(), "the value is empty");
    println!("[test:live] NEW concepts={}", concepts.len());
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn upcoming_decodes_without_drops() {
    let (concepts, dropped) = grid(SonyFeature::Upcoming).await;
    assert_no_silent_drops(&concepts, dropped, map_upcoming_concepts_to_games);
    println!("[test:live] UPCOMING concepts={}", concepts.len());
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn discounted_decodes_without_drops() {
    let (concepts, dropped) = grid(SonyFeature::Discounted).await;
    assert_no_silent_drops(&concepts, dropped, map_concepts_to_games);
    println!("[test:live] DISCOUNTED concepts={}", concepts.len());
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn genres_include_fps_and_rpg() {
    let json = live_once("genres", async || {
        client().category_grid_json(&GridQuery::Genres).await
    })
    .await;
    let GenresOutcome::Ok { genres, dropped } = extract_genres(&json) else {
        panic!("the genre facet drifted");
    };
    assert_eq!(dropped, 0);
    let keys: Vec<&str> = genres.iter().map(|g| g.key.as_str()).collect();
    assert!(keys.contains(&"FIRST_PERSON_SHOOTER"));
    assert!(keys.contains(&"ROLE_PLAYING_GAMES"));
    println!("[test:live] GENRES count={}", genres.len());
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn browse_page_decodes_and_names_product_ids() {
    let size = 60;
    let json = live_once("browse", async || {
        client()
            .category_grid_json(&GridQuery::Browse(BrowseRequest {
                genre: GenreKey::parse("FIRST_PERSON_SHOOTER").unwrap(),
                order: BrowseOrder::BestSelling,
                offset: 0,
                size,
            }))
            .await
    })
    .await;
    let BrowseOutcome::Ok {
        concepts,
        is_last,
        dropped,
    } = extract_browse_page(&json, size)
    else {
        panic!("the browse grid drifted");
    };
    assert_eq!(dropped, 0);
    assert!(!concepts.is_empty(), "the value is empty");
    let with_ids = concepts
        .iter()
        .filter(|concept| !browse_candidate_ids(concept).is_empty())
        .count();
    assert!(with_ids > 0);
    println!(
        "[test:live] BROWSE concepts={} withProductIds={with_ids} isLast={is_last}",
        concepts.len()
    );
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn monthly_has_a_ps5_game() {
    let entries = live_once("monthly", async || client().plus_monthly().await).await;
    assert!(!entries.is_empty(), "the value is empty");
    println!("[test:live] MONTHLY entries={}", entries.len());
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn search_keeps_ps5_games() {
    for term in ["elden", "god of war"] {
        let page = search(term).await;
        assert!(
            page.raw_count > 0,
            "{term}: no result in {ATTEMPTS} attempts"
        );
        assert!(!page.candidates.is_empty(), "{term}");
        println!(
            "[test:live] SEARCH term={term} raw={} candidates={} isLast={}",
            page.raw_count,
            page.candidates.len(),
            page.is_last
        );
    }
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn search_narrows_a_ps4_only_title_to_zero() {
    let page = search("bloodborne").await;
    assert!(page.raw_count > 0, "no result in {ATTEMPTS} attempts");
    assert!(page.candidates.is_empty(), "{:?}", page.candidates);
    println!(
        "[test:live] SEARCH term=bloodborne raw={} candidates=0",
        page.raw_count
    );
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn pdp_resolves_for_a_new_sku() {
    let (concepts, _) = grid(SonyFeature::New).await;
    let games = map_concepts_to_games(&concepts, 0);
    let sku = games.first().and_then(|game| game.id.product_id()).unwrap();
    let detail = live_once("pdp", async || client().product_detail(sku.clone()).await).await;
    println!(
        "[test:live] PDP sku={} genres={} descLen={}",
        sku.as_str(),
        detail.genres.len(),
        detail.description.encode_utf16().count()
    );
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn price_resolves_for_a_known_sku() {
    let sku = "EP2640-PPSA29380_00-0000000000000000";
    let price = live_once("price", async || {
        client().product_price(sku.parse().unwrap()).await
    })
    .await;
    println!(
        "[test:live] PRICE sku={sku} plusOffer={:?} standard={:?}",
        price.plus_offer, price.standard
    );
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn a_search_only_cross_gen_id_is_a_ps5_game() {
    let id = "EP0002-PPSA02410_00-DESTINYTHEGAME02";
    let (detail, price) = live_once("cross-gen", async || {
        let sony = client();
        let (detail, price) = tokio::join!(
            sony.product_detail(id.parse().unwrap()),
            sony.product_price(id.parse().unwrap())
        );
        Ok((detail?, price?))
    })
    .await;
    assert!(is_ps5_game(
        &detail.platforms,
        detail.store_display_classification.as_deref()
    ));
    let game = product_detail_to_game(&id.parse().unwrap(), &detail, price.standard.as_ref(), 0);
    assert!(!game.name.is_empty(), "the value is empty");
    assert!(!game.url.is_empty(), "the value is empty");
    println!(
        "[test:live] PRODUCT-ID sku={id} name={} platforms={:?} price={}",
        game.name, detail.platforms, game.price
    );
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn a_ps4_only_id_is_not_a_ps5_game() {
    let id = "EP9000-CUSA00207_00-BLOODBORNE0000EU";
    let detail = live_once("ps4-only", async || {
        client().product_detail(id.parse().unwrap()).await
    })
    .await;
    assert!(!is_ps5_game(
        &detail.platforms,
        detail.store_display_classification.as_deref()
    ));
    println!(
        "[test:live] PRODUCT-ID sku={id} platforms={:?}",
        detail.platforms
    );
}

/// The real service on its cheap paths: one genre request, one monthly
/// request, and one game page of a product that no list contains. Each
/// attempt uses a new service, because the service cache keeps a failure for
/// a short time.
#[tokio::test]
#[ignore = "reaches live Sony"]
async fn the_service_serves_genres_monthly_and_a_game_page() {
    let id = "EP0002-PPSA02410_00-DESTINYTHEGAME02";
    let (genres, monthly, game) = live_once("service", async || {
        let service = GamesService::new(Arc::new(client()), Arc::new(SystemClock));
        let genres = service.genres().await?;
        let monthly = service
            .monthly_games(Page {
                offset: 0,
                size: 60,
            })
            .await?;
        let game = match service.game_by_id(id.parse().unwrap()).await {
            Ok(game) => game,
            Err(GameLookupError::Upstream(error)) => return Err(error),
            Err(error) => panic!("the game page failed: {error:?}"),
        };
        Ok((genres, monthly, game))
    })
    .await;
    assert!(!genres.genres.is_empty(), "the value is empty");
    assert!(!monthly.games.is_empty(), "the value is empty");
    assert_eq!(game.id, id);
    assert!(!game.name.is_empty(), "the value is empty");
    println!(
        "[test:live] SERVICE genres={} monthly={} gamePage={} name={}",
        genres.genres.len(),
        monthly.total_count,
        game.id.as_str(),
        game.name
    );
}

// The tests below check the attempt rule without network access, so
// `mise run test` runs them.

#[test]
fn only_a_transport_failure_gets_a_new_attempt() {
    assert!(is_transport_failure(&UpstreamError::unavailable(
        TRANSPORT_FAILURE
    )));
    for drift in [
        "Sony search response has an unexpected shape",
        "Sony upstream returned a body that is not JSON",
        "Sony upstream returned 500",
        "Sony upstream returned 404",
        "Upstream unavailable",
    ] {
        assert!(
            !is_transport_failure(&UpstreamError::unavailable(drift)),
            "{drift}"
        );
    }
    assert!(!is_transport_failure(&UpstreamError::QueryRotated {
        message: TRANSPORT_FAILURE.to_owned(),
        operation_name: "getSearchResults".to_owned(),
    }));
    assert!(!is_transport_failure(&UpstreamError::RateLimited {
        message: TRANSPORT_FAILURE.to_owned(),
        retry_after_seconds: None,
    }));
}

#[tokio::test(start_paused = true)]
async fn a_transport_failure_and_an_empty_value_get_a_new_attempt() {
    let calls = Cell::new(0_u32);
    let value = live(
        "unit",
        async || {
            calls.set(calls.get() + 1);
            match calls.get() {
                1 => Err(UpstreamError::unavailable(TRANSPORT_FAILURE)),
                2 => Ok(0),
                _ => Ok(7),
            }
        },
        |value: &u32| *value == 0,
    )
    .await;
    assert_eq!((value, calls.get()), (7, 3));
}

#[tokio::test(start_paused = true)]
async fn an_empty_value_returns_after_the_last_attempt() {
    let calls = Cell::new(0_u32);
    let value = live(
        "unit",
        async || {
            calls.set(calls.get() + 1);
            Ok(0_u32)
        },
        |value: &u32| *value == 0,
    )
    .await;
    assert_eq!((value, calls.get()), (0, ATTEMPTS));
}

#[tokio::test(start_paused = true)]
#[should_panic(expected = "attempt 3/3")]
async fn a_transport_failure_fails_after_the_last_attempt() {
    let _: u32 = live_once("unit", async || {
        Err(UpstreamError::unavailable(TRANSPORT_FAILURE))
    })
    .await;
}

#[tokio::test(start_paused = true)]
#[should_panic(expected = "attempt 1/3")]
async fn a_drift_fails_at_once() {
    let _: u32 = live_once("unit", async || {
        Err(UpstreamError::unavailable(
            "Sony search response has an unexpected shape",
        ))
    })
    .await;
}
