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

#![expect(
    clippy::unwrap_used,
    clippy::panic,
    reason = "the helpers of this test binary fail a check by panicking"
)]

use std::sync::Arc;

use psstore_server::application::games::GamesService;
use psstore_server::application::{GamesApi, Page, SystemClock};
use psstore_server::domain::browse::{BrowseOrder, GenreKey};
use psstore_server::domain::catalog::{BrowseRequest, Concept, SonyFeature};
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

/// One grid page of 60, like the TypeScript suite.
async fn grid(feature: SonyFeature) -> (Vec<Concept>, usize) {
    let json = client()
        .category_grid_json(&GridQuery::Feature {
            feature,
            size: 60,
            offset: 0,
        })
        .await
        .unwrap();
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
    let json = client()
        .category_grid_json(&GridQuery::Genres)
        .await
        .unwrap();
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
    let json = client()
        .category_grid_json(&GridQuery::Browse(BrowseRequest {
            genre: GenreKey::parse("FIRST_PERSON_SHOOTER").unwrap(),
            order: BrowseOrder::BestSelling,
            offset: 0,
            size,
        }))
        .await
        .unwrap();
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
    let entries = client().plus_monthly().await.unwrap();
    assert!(!entries.is_empty(), "the value is empty");
    println!("[test:live] MONTHLY entries={}", entries.len());
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn search_keeps_ps5_games() {
    for term in ["elden", "god of war"] {
        let page = client().search_page(term.into(), 0, 50).await.unwrap();
        assert!(page.raw_count > 0, "{term}");
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
    let page = client()
        .search_page("bloodborne".into(), 0, 50)
        .await
        .unwrap();
    assert!(page.raw_count > 0);
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
    let sku = games.first().map(|game| game.id.clone()).unwrap();
    let detail = client().product_detail(sku.clone()).await.unwrap();
    println!(
        "[test:live] PDP sku={sku} genres={} descLen={}",
        detail.genres.len(),
        detail.description.encode_utf16().count()
    );
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn price_resolves_for_a_known_sku() {
    let sku = "EP2640-PPSA29380_00-0000000000000000";
    let price = client().product_price(sku.into()).await.unwrap();
    println!(
        "[test:live] PRICE sku={sku} plusOffer={:?} standard={:?}",
        price.plus_offer, price.standard
    );
}

#[tokio::test]
#[ignore = "reaches live Sony"]
async fn a_search_only_cross_gen_id_is_a_ps5_game() {
    let id = "EP0002-PPSA02410_00-DESTINYTHEGAME02";
    let sony = client();
    let (detail, price) = tokio::join!(
        sony.product_detail(id.into()),
        sony.product_price(id.into())
    );
    let (detail, price) = (detail.unwrap(), price.unwrap());
    assert!(is_ps5_game(
        &detail.platforms,
        detail.store_display_classification.as_deref()
    ));
    let game = product_detail_to_game(id, &detail, price.standard.as_ref(), 0);
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
    let detail = client().product_detail(id.into()).await.unwrap();
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
/// request, and one game page of a product that no list contains.
#[tokio::test]
#[ignore = "reaches live Sony"]
async fn the_service_serves_genres_monthly_and_a_game_page() {
    let service = GamesService::new(Arc::new(client()), Arc::new(SystemClock));
    let genres = service.genres().await.unwrap();
    assert!(!genres.genres.is_empty(), "the value is empty");
    let monthly = service
        .monthly_games(Page {
            offset: 0,
            size: 60,
        })
        .await
        .unwrap();
    assert!(!monthly.games.is_empty(), "the value is empty");
    let id = "EP0002-PPSA02410_00-DESTINYTHEGAME02";
    let game = service.game_by_id(id.into()).await.unwrap();
    assert_eq!(game.id, id);
    assert!(!game.name.is_empty(), "the value is empty");
    println!(
        "[test:live] SERVICE genres={} monthly={} gamePage={} name={}",
        genres.genres.len(),
        monthly.total_count,
        game.id,
        game.name
    );
}
