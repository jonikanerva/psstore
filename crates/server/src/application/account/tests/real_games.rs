//! The wishlist enrichment with the real games service (STACK.md §2.5). The
//! account service reads the wishlist from the fake Sony account client and
//! fills each product entry through the real `GamesService` over the fake
//! Sony store of the games tests. The tests in `tests.rs` fake `GamesApi`, so
//! they do not run the store lookups, their caches, or their failure rules.
//!
//! The default fake store has empty grids and an empty PS Plus feed, so a
//! product lookup reads NEW, UPCOMING, DISCOUNTED, and MONTHLY, then falls
//! back to the product page (the detail and the price of the product id).

use std::time::Duration;

use super::*;
use crate::application::games::tests::{FakeSony as FakeStore, service, unavailable};
use crate::domain::catalog::{
    Concept, ConceptPrice, ConceptProductRef, Media, ProductDetail, ProductPrice, SonyFeature,
    StandardPrice,
};
use crate::domain::library::wishlist_cards;

// The limits of STACK.md §2.5, written out so that a changed constant in
// `account.rs` fails these tests.
const LOOKUPS_AT_ONCE: usize = 6;
const ENTRY_DEADLINE: Duration = Duration::from_secs(5);
const LIST_DEADLINE: Duration = Duration::from_secs(12);

/// The account service over the real games service and a fake store.
fn real_harness(entries: Vec<WishlistEntry>, store: FakeStore) -> (AccountService, Arc<FakeStore>) {
    let (games, store) = service(store);
    let games: Arc<dyn GamesApi> = Arc::new(games);
    let sony: Arc<dyn SonyAccount> = Arc::new(FakeSony {
        wishlist: Ok(entries),
        ..FakeSony::ok()
    });
    (AccountService::new(sony, games), store)
}

fn media(kind: &str, role: &str, url: &str) -> Media {
    Media {
        url: Some(url.into()),
        role: Some(role.into()),
        kind: Some(kind.into()),
    }
}

/// The product page of a PS5 game. The name and the cover differ from the
/// wishlist entry, so a test sees which source filled the card.
fn store_detail() -> ProductDetail {
    ProductDetail {
        name: Some("Store Game".into()),
        media: vec![
            media(
                "IMAGE",
                "GAMEHUB_COVER_ART",
                "https://img.test/store-cover.png",
            ),
            media("IMAGE", "SCREENSHOT", "https://img.test/store-shot.png"),
            media("VIDEO", "PREVIEW", "https://vid.test/store.mp4"),
        ],
        release_date: Some("2025-03-04T00:00:00Z".into()),
        genres: vec!["Action".into(), "Adventure".into()],
        description: "Store description".into(),
        publisher_name: Some("Synthetic Studio".into()),
        store_display_classification: Some("FULL_GAME".into()),
        platforms: vec!["PS5".into()],
    }
}

fn store_plus_offer() -> PlusOffer {
    PlusOffer::Price {
        price: "€29,99".into(),
    }
}

fn store_price() -> ProductPrice {
    ProductPrice {
        plus_offer: Some(store_plus_offer()),
        standard: Some(StandardPrice {
            base_price: "€59,99".into(),
            discounted_price: "€39,99".into(),
            discount_text: "-33%".into(),
        }),
    }
}

/// A store with the same product page and price for every product id.
fn store() -> FakeStore {
    let mut store = FakeStore::default();
    store.detail = Box::new(|_| Ok(store_detail()));
    store.price = Box::new(|_| Ok(store_price()));
    store
}

/// The card of [`store_detail`] and [`store_price`] for wishlist entry
/// `index`. The product page path normalises Sony's date (STACK.md §10).
fn filled_card(index: usize) -> Game {
    Game {
        id: sku(index).parse().unwrap(),
        name: "Store Game".into(),
        date: "2025-03-04T00:00:00.000Z".into(),
        url: "https://img.test/store-cover.png".into(),
        price: "€39,99".into(),
        original_price: "€59,99".into(),
        discount_text: "-33%".into(),
        discount_date: "2025-03-04T00:00:00.000Z".into(),
        screenshots: vec!["https://img.test/store-shot.png".into()],
        videos: vec!["https://vid.test/store.mp4".into()],
        genres: vec!["Action".into(), "Adventure".into()],
        description: "Store description".into(),
        studio: "Synthetic Studio".into(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: Some(store_plus_offer()),
        id_kind: IdKind::Product,
    }
}

/// The card with the name and the image of the entry only.
fn minimal_card(id: &str, name: &str, image_url: &str, id_kind: IdKind) -> Game {
    Game {
        id: id.parse().unwrap(),
        name: name.into(),
        date: String::new(),
        url: image_url.into(),
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
        id_kind,
    }
}

/// The minimal card of [`product_entry`] `index`.
fn minimal_product_card(index: usize) -> Game {
    minimal_card(
        &sku(index),
        &format!("Wish {index}"),
        &format!("https://img.test/wish{index}.png"),
        IdKind::Product,
    )
}

/// The lookups of a product that no list has: each grid once, the PS Plus
/// feed once. The caches share these reads between the entries.
fn assert_lists_read_once(store: &FakeStore) {
    let calls = store.calls();
    assert_eq!(
        calls.concepts,
        [
            (SonyFeature::New, 300),
            (SonyFeature::Upcoming, 120),
            (SonyFeature::Discounted, 120)
        ]
    );
    assert_eq!(calls.monthly, 1);
}

fn skus(range: std::ops::RangeInclusive<usize>) -> Vec<String> {
    range.map(sku).collect()
}

#[tokio::test(start_paused = true)]
async fn fills_a_product_entry_from_its_product_page() {
    let (account, store) = real_harness(vec![product_entry(1)], store());
    let page = account.wishlist_games(npsso()).await.unwrap();
    assert_eq!(
        page,
        PageResult {
            games: vec![filled_card(1)],
            total_count: 1,
            next_offset: None,
        }
    );
    assert_lists_read_once(&store);
    let calls = store.calls();
    assert_eq!(calls.details, [sku(1)]);
    assert_eq!(calls.prices, [sku(1)]);
}

/// A game on the NEW list keeps the list card and takes the detail fields
/// from the product page. This path also normalises Sony's date (STACK.md
/// §10, issue #163).
#[tokio::test(start_paused = true)]
async fn fills_a_product_entry_from_the_new_list() {
    let listed = Concept {
        id: Some("201".into()),
        name: Some("Grid Game".into()),
        media: Some(vec![media(
            "IMAGE",
            "MASTER",
            "https://img.test/grid-cover.png",
        )]),
        price: Some(ConceptPrice {
            base_price: Some("€49,99".into()),
            discounted_price: Some("€49,99".into()),
            service_branding: Some(vec!["NONE".into()]),
            upsell_service_branding: Some(vec!["NONE".into()]),
            ..ConceptPrice::default()
        }),
        products: Some(vec![ConceptProductRef {
            id: Some(sku(2)),
            ..ConceptProductRef::default()
        }]),
    };
    let mut fake = store();
    fake.concepts = Box::new(move |feature| {
        Ok(if feature == SonyFeature::New {
            vec![listed.clone()]
        } else {
            vec![]
        })
    });
    let (account, store) = real_harness(vec![product_entry(2)], fake);
    let page = account.wishlist_games(npsso()).await.unwrap();
    let expected = Game {
        id: sku(2).parse().unwrap(),
        name: "Grid Game".into(),
        date: "2025-03-04T00:00:00.000Z".into(),
        url: "https://img.test/grid-cover.png".into(),
        price: "€49,99".into(),
        genres: vec!["Action".into(), "Adventure".into()],
        description: "Store description".into(),
        studio: "Synthetic Studio".into(),
        plus_offer: Some(store_plus_offer()),
        ..minimal_card(&sku(2), "", "", IdKind::Product)
    };
    assert_eq!(page.games, [expected]);
    let calls = store.calls();
    assert_eq!(calls.concepts, [(SonyFeature::New, 300)]);
    assert_eq!(calls.monthly, 0);
    assert_eq!(calls.details, [sku(2)]);
    assert_eq!(calls.prices, [sku(2)]);
}

#[tokio::test(start_paused = true)]
async fn keeps_name_and_image_only_for_a_concept_entry_without_a_store_call() {
    let (account, store) = real_harness(vec![concept_entry()], store());
    let page = account.wishlist_games(npsso()).await.unwrap();
    assert_eq!(
        page.games,
        [minimal_card(
            "10000002",
            "Wish Concept",
            "https://img.test/concept.png",
            IdKind::Concept
        )]
    );
    let calls = store.calls();
    assert_eq!(calls.concepts, Vec::<(SonyFeature, usize)>::new());
    assert_eq!(calls.monthly, 0);
    assert_eq!(calls.details, Vec::<String>::new());
    assert_eq!(calls.prices, Vec::<String>::new());
}

/// Sony answers an unknown product id with an empty product page, and the
/// games service answers "not found".
#[tokio::test(start_paused = true)]
async fn keeps_name_and_image_only_for_a_product_that_the_store_does_not_have() {
    let mut fake = store();
    fake.detail = Box::new(|_| Ok(ProductDetail::default()));
    let (account, store) = real_harness(vec![product_entry(1)], fake);
    let page = account.wishlist_games(npsso()).await.unwrap();
    assert_eq!(page.games, [minimal_product_card(1)]);
    assert_lists_read_once(&store);
    assert_eq!(store.calls().details, [sku(1)]);
}

/// A failed product page fails the lookup of that entry only.
#[tokio::test(start_paused = true)]
async fn keeps_name_and_image_only_for_an_entry_whose_store_lookup_failed() {
    let failing = sku(2);
    let mut fake = store();
    fake.detail = Box::new(move |id| {
        if id == failing {
            Err(unavailable())
        } else {
            Ok(store_detail())
        }
    });
    let entries = vec![product_entry(1), product_entry(2), product_entry(3)];
    let (account, store) = real_harness(entries, fake);
    let page = account.wishlist_games(npsso()).await.unwrap();
    assert_eq!(
        page.games,
        [filled_card(1), minimal_product_card(2), filled_card(3)]
    );
    assert_lists_read_once(&store);
    assert_eq!(store.calls().details, skus(1..=3));
}

/// The games service keeps a product page without a price when the price
/// lookup fails, so the card has the store details and no price.
#[tokio::test(start_paused = true)]
async fn fills_the_store_details_without_a_price_when_the_price_lookup_failed() {
    let mut fake = store();
    fake.price = Box::new(|_| Err(unavailable()));
    let (account, _) = real_harness(vec![product_entry(1)], fake);
    let page = account.wishlist_games(npsso()).await.unwrap();
    let expected = Game {
        price: String::new(),
        original_price: String::new(),
        discount_text: String::new(),
        discount_date: String::new(),
        plus_offer: None,
        ..filled_card(1)
    };
    assert_eq!(page.games, [expected]);
}

#[tokio::test(start_paused = true)]
async fn keeps_name_and_image_only_for_an_entry_slower_than_its_deadline() {
    let slow = sku(1);
    let mut fake = store();
    fake.detail_delay = Box::new(move |id| {
        if id == slow {
            Duration::from_secs(10)
        } else {
            Duration::ZERO
        }
    });
    let (account, store) = real_harness(vec![product_entry(1), product_entry(2)], fake);
    let started = tokio::time::Instant::now();
    let page = account.wishlist_games(npsso()).await.unwrap();
    within_a_second_after(started, ENTRY_DEADLINE);
    assert_eq!(page.games, [minimal_product_card(1), filled_card(2)]);
    assert_eq!(store.calls().details, skus(1..=2));
}

/// Each lookup takes 4.5 s, inside its own 5 s deadline. With 6 lookups at
/// once, the 18 entries end at 4.5 s, 9 s, and 13.5 s, so the list passes
/// its 12 s deadline. Every card is then the minimal card, also the cards
/// whose lookup had ended (`AccountService::enrich_wishlist`).
#[tokio::test(start_paused = true)]
async fn keeps_name_and_image_only_for_every_entry_when_the_list_passes_its_deadline() {
    let mut fake = store();
    fake.detail_delay = Box::new(|_| Duration::from_millis(4_500));
    let entries: Vec<_> = (1..=18).map(product_entry).collect();
    let (account, store) = real_harness(entries.clone(), fake);
    let started = tokio::time::Instant::now();
    let page = account.wishlist_games(npsso()).await.unwrap();
    within_a_second_after(started, LIST_DEADLINE);
    assert_eq!(page.games, wishlist_cards(&entries));
    assert_eq!(page.games[0], minimal_product_card(1));
    assert_eq!(page.total_count, 18);
    assert_eq!(store.calls().details, skus(1..=18));
}

#[tokio::test(start_paused = true)]
async fn runs_at_most_six_store_lookups_at_once() {
    let mut fake = store();
    fake.detail_delay = Box::new(|_| Duration::from_millis(100));
    let entries: Vec<_> = (1..=20).map(product_entry).collect();
    let (account, store) = real_harness(entries, fake);
    let page = account.wishlist_games(npsso()).await.unwrap();
    let expected: Vec<_> = (1..=20).map(filled_card).collect();
    assert_eq!(page.games, expected);
    assert_eq!(store.peak.load(Ordering::SeqCst), LOOKUPS_AT_ONCE);
    assert_lists_read_once(&store);
    assert_eq!(store.calls().details, skus(1..=20));
}
