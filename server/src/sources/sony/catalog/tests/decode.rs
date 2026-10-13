//! The pure decoders and the scope narrowing on fixtures and synthetic
//! bodies.

use serde_json::{Value, json};

use super::super::*;
use super::fixture;
use crate::domain::catalog::{SearchCandidate, SearchEntry};
use crate::domain::game::{Genre, IdKind, PlusOffer};
use crate::domain::listing::{
    is_ps5_game, map_concepts_to_games, map_monthly_to_games, map_upcoming_concepts_to_games,
    narrow_search_entries,
};
use crate::domain::mapper::{concept_to_game, product_detail_to_game};

/// 2026-10-13T00:00:00Z.
const NOW: i64 = 1_791_849_600_000;

fn grid(node: Value) -> Value {
    json!({"data": {"categoryGridRetrieve": node}})
}

fn ok_grid(json: &Value) -> (Vec<crate::domain::catalog::Concept>, usize) {
    match extract_category_grid(json) {
        CategoryGridOutcome::Ok { concepts, dropped } => (concepts, dropped),
        CategoryGridOutcome::Drift => panic!("expected a decoded grid"),
    }
}

// ---- Product detail (sonyClient.test.ts) ----------------------------------

#[test]
fn uses_the_long_description_and_maps_localized_genres() {
    let detail = extract_product_detail(&json!({"data": {"productRetrieve": {
        "id": "UP0102-PPSA02530_00-PRAGMATA00000000",
        "releaseDate": "2026-04-23T21:00:00Z",
        "descriptions": [
            {"type": "SHORT", "value": "A tagline."},
            {"type": "LONG", "value": "<p>The long game info body.</p>"},
            {"type": "COMPATIBILITY_NOTICE", "value": "Requires a PS5 console."},
            {"type": "LEGAL", "value": "© Publisher. All rights reserved."}
        ],
        "combinedLocalizedGenres": [{"value": "Toiminta"}, {"value": "Roolipelit"}]
    }}}));
    assert_eq!(detail.release_date.as_deref(), Some("2026-04-23T21:00:00Z"));
    assert_eq!(detail.description, "<p>The long game info body.</p>");
    assert_eq!(detail.genres, ["Toiminta", "Roolipelit"]);
}

#[test]
fn never_shows_compatibility_or_legal_text_and_falls_back_to_short() {
    let only_notices = extract_product_detail(&json!({"data": {"productRetrieve": {
        "id": "test",
        "descriptions": [
            {"type": "COMPATIBILITY_NOTICE", "value": "Requires a PS5 console."},
            {"type": "LEGAL", "value": "© Publisher."}
        ]
    }}}));
    assert_eq!(only_notices.description, "");
    let short = extract_product_detail(&json!({"data": {"productRetrieve": {
        "id": "test",
        "descriptions": [{"type": "SHORT", "value": "Short tagline only."}]
    }}}));
    assert_eq!(short.description, "Short tagline only.");
    // Challenge: an empty LONG text falls back to SHORT, like `||`.
    let empty_long = extract_product_detail(&json!({"data": {"productRetrieve": {
        "descriptions": [{"type": "LONG", "value": null}, {"type": "SHORT", "value": "S"}]
    }}}));
    assert_eq!(empty_long.description, "S");
}

#[test]
fn drops_empty_genre_values() {
    let detail = extract_product_detail(&json!({"data": {"productRetrieve": {
        "id": "test",
        "combinedLocalizedGenres": [{"value": "Toiminta"}, {"value": ""}, {}]
    }}}));
    assert_eq!(detail.genres, ["Toiminta"]);
}

#[test]
fn reads_the_publisher_and_degrades_to_empty_values() {
    let detail = extract_product_detail(&json!({"data": {"productRetrieve": {
        "id": "UP4139-PPSA27597_00-STELLARDELUXEPS5",
        "releaseDate": "2025-11-11T00:00:00Z",
        "publisherName": "PARADOX GAMES INC"
    }}}));
    assert_eq!(detail.publisher_name.as_deref(), Some("PARADOX GAMES INC"));

    for body in [
        json!({"data": {"productRetrieve": {"id": "test"}}}),
        json!({"data": {}}),
        json!({}),
        json!(null),
        json!("text"),
        json!({"data": "text"}),
        json!({"data": {"productRetrieve": null}}),
    ] {
        let detail = extract_product_detail(&body);
        assert_eq!(detail.release_date, None, "{body}");
        assert_eq!(detail.publisher_name, None, "{body}");
        assert!(detail.genres.is_empty(), "{body}");
        assert_eq!(detail.description, "", "{body}");
        assert!(detail.platforms.is_empty(), "{body}");
    }
}

#[test]
fn a_malformed_node_degrades_to_empty_values() {
    let detail = extract_product_detail(&json!({"data": {"productRetrieve": {
        "id": 42,
        "descriptions": "not-an-array",
        "combinedLocalizedGenres": {"value": "wrong-shape"}
    }}}));
    assert_eq!(detail.release_date, None);
    assert!(detail.genres.is_empty());
    assert_eq!(detail.description, "");
    // Challenge: one wrong field fails the whole node, like Effect Schema.
    let one_wrong = extract_product_detail(&json!({"data": {"productRetrieve": {
        "releaseDate": "2026-01-01T00:00:00Z",
        "platforms": ["PS5", null]
    }}}));
    assert_eq!(one_wrong.release_date, None);
}

#[test]
fn null_fields_are_tolerated() {
    let detail = extract_product_detail(&json!({"data": {"productRetrieve": {
        "id": "UP0001-PPSA00001_00-GAME000000000000",
        "releaseDate": null,
        "publisherName": null,
        "storeDisplayClassification": null,
        "descriptions": null,
        "combinedLocalizedGenres": null,
        "name": "Game"
    }}}));
    assert_eq!(detail.name.as_deref(), Some("Game"));
    assert_eq!(detail.release_date, None);
    assert_eq!(detail.publisher_name, None);
}

#[test]
fn reads_the_platform_list() {
    let detail = extract_product_detail(&json!({"data": {"productRetrieve": {
        "storeDisplayClassification": "FULL_GAME",
        "platforms": ["PS4", "PS5"]
    }}}));
    assert_eq!(detail.platforms, ["PS4", "PS5"]);
    assert!(
        extract_product_detail(&json!({"data": {"productRetrieve": {}}}))
            .platforms
            .is_empty()
    );
}

// ---- Category grid (sonyClient.test.ts, scopeDrop.test.ts) ----------------

#[test]
fn concepts_win_over_products() {
    let (concepts, _) = ok_grid(&grid(json!({
        "concepts": [{
            "id": "1",
            "name": "Alpha",
            "media": [{"type": "IMAGE", "role": "MASTER", "url": "https://img/a"}],
            "price": {"basePrice": "€29.95"},
            "products": [{"id": "EP0001-PPSA00001_00-ALPHA00000000000"}]
        }],
        "products": [{"id": "EP0001-PPSA09999_00-IGNORED000000000"}]
    })));
    assert_eq!(concepts.len(), 1);
    assert_eq!(concepts[0].name.as_deref(), Some("Alpha"));
}

#[test]
fn maps_products_to_concepts_without_concepts() {
    let (concepts, _) = ok_grid(&grid(json!({
        "products": [{
            "id": "EP0001-PPSA00002_00-BRAVO00000000000",
            "name": "Bravo",
            "media": [],
            "price": {"basePrice": "€19.95"}
        }]
    })));
    assert_eq!(concepts.len(), 1);
    assert_eq!(concepts[0].name.as_deref(), Some("Bravo"));
    let products = concepts[0].products.as_ref().unwrap();
    assert_eq!(
        products[0].id.as_deref(),
        Some("EP0001-PPSA00002_00-BRAVO00000000000")
    );
}

#[test]
fn an_empty_grid_is_a_legitimate_empty_list() {
    assert_eq!(
        ok_grid(&grid(json!({"concepts": [], "products": []}))),
        (vec![], 0)
    );
    assert_eq!(ok_grid(&grid(json!({}))), (vec![], 0));
}

#[test]
fn an_absent_or_malformed_node_is_drift() {
    for body in [
        json!({"data": {}}),
        json!({}),
        grid(json!(null)),
        grid(json!({"concepts": "not-an-array", "products": 42})),
        grid(json!([])),
        json!("boom"),
        json!(null),
        json!({"data": []}),
    ] {
        assert_eq!(
            extract_category_grid(&body),
            CategoryGridOutcome::Drift,
            "{body}"
        );
    }
}

#[test]
fn keeps_concepts_and_products_with_null_fields() {
    let (concepts, dropped) = ok_grid(&grid(json!({"concepts": [
        {"id": "10018729", "name": "RunNGun", "price": null},
        {"id": "10019188", "name": "Rat Protocol", "price": null}
    ]})));
    assert_eq!(dropped, 0);
    assert_eq!(concepts.len(), 2);

    let (concepts, dropped) = ok_grid(&grid(json!({"products": [{
        "id": "EP0001-PPSA00003_00-DEAL000000000000",
        "name": "Deal",
        "price": {"basePrice": "€59,99", "discountedPrice": "€39,99", "serviceBranding": null}
    }]})));
    assert_eq!((concepts.len(), dropped), (1, 0));

    let (concepts, dropped) = ok_grid(&grid(json!({"concepts": [
        {"id": "99", "name": null, "media": null, "price": null, "products": null}
    ]})));
    assert_eq!((concepts.len(), dropped), (1, 0));
}

#[test]
fn drops_only_the_broken_element_and_counts_it() {
    let (concepts, dropped) = ok_grid(&grid(json!({"concepts": [
        {"id": "1", "name": "Good", "price": null},
        {"id": {"nope": true}, "name": "Broken"},
        null,
        ["1", "Array"],
        {"id": "2", "media": [{"type": "IMAGE", "url": 5}]},
        {"id": "3", "price": {"serviceBranding": ["PS_PLUS", null]}}
    ]})));
    let names: Vec<_> = concepts.iter().map(|c| c.name.clone()).collect();
    assert_eq!(names, [Some("Good".to_owned())]);
    assert_eq!(dropped, 5);
}

#[test]
fn drops_out_of_scope_items_and_keeps_the_in_scope_game() {
    let good = "EP0001-PPSA00001_00-ALPHA00000000000";
    let concept = |id: &str, name: &str| {
        json!({
            "id": format!("c-{name}"),
            "name": name,
            "price": {"basePrice": "€29,95", "discountedPrice": "€29,95"},
            "products": [{"id": id}]
        })
    };
    let (concepts, dropped) = ok_grid(&grid(json!({"concepts": [
        concept(good, "Alpha"),
        concept("UP0001-PPSA00002_01-ADDON000000000", "Addon"),
        concept("", "Idless"),
        {"id": {"broken": true}, "name": "Broken"},
        null
    ]})));
    assert_eq!(dropped, 2);
    let ids: Vec<_> = map_concepts_to_games(&concepts, NOW)
        .into_iter()
        .map(|g| g.id)
        .collect();
    assert_eq!(ids, [good]);

    let (concepts, _) = ok_grid(&grid(json!({"concepts": [
        concept(good, "Alpha"),
        {"id": "c-1", "name": "Announced"}
    ]})));
    assert_eq!(map_concepts_to_games(&concepts, NOW).len(), 1);
    let kinds: Vec<_> = map_upcoming_concepts_to_games(&concepts, NOW)
        .into_iter()
        .map(|g| g.id_kind)
        .collect();
    assert_eq!(kinds, [IdKind::Product, IdKind::Concept]);
}

// ---- Golden captures (goldenDecode.test.ts) --------------------------------

#[test]
fn golden_concepts_decode_without_drops_and_map_to_games() {
    let (concepts, dropped) = ok_grid(&fixture("categoryGridConcepts.golden.json"));
    assert_eq!(dropped, 0);
    assert_eq!(concepts.len(), 8);
    let games = map_concepts_to_games(&concepts, NOW);
    assert_eq!(games.len(), 5);
    // The PS Plus upsell text stays verbatim, with its non-breaking space.
    assert_eq!(
        games[0].plus_upsell_text.as_deref(),
        Some("Säästä 10\u{A0}%")
    );

    let upcoming = map_upcoming_concepts_to_games(&concepts, NOW);
    let concept_card = upcoming
        .iter()
        .find(|game| game.id_kind == IdKind::Concept)
        .unwrap();
    assert_eq!(concept_card.price, "");
    assert_eq!(concept_card.id, "10018729");
}

#[test]
fn golden_products_map_discounted_ps_plus_prices() {
    let (concepts, dropped) = ok_grid(&fixture("categoryGridProducts.golden.json"));
    assert_eq!(dropped, 0);
    let games = map_concepts_to_games(&concepts, NOW);
    assert_eq!(games.len(), 6);
    let discounted = games
        .iter()
        .find(|game| !game.original_price.is_empty() && game.plus_upsell_text.is_some())
        .unwrap();
    assert_eq!(discounted.price, "€5,97");
    assert_eq!(discounted.original_price, "€9,95");
    assert_eq!(discounted.discount_text, "–40 %");
    // A product with `serviceBranding: null` still decodes.
    let unavailable = games
        .iter()
        .find(|game| game.id == "EP8424-PPSA34421_00-CTS26EXPERTUPG01")
        .unwrap();
    assert_eq!(unavailable.price, "Ei saatavilla");
    assert_eq!(unavailable.plus_upsell_text, None);
}

#[test]
fn golden_broken_element_drops_only_the_synthetic_one() {
    let (good, _) = ok_grid(&fixture("categoryGridConcepts.golden.json"));
    let (broken, dropped) = ok_grid(&fixture("categoryGridBrokenElement.golden.json"));
    assert!(dropped >= 1);
    assert_eq!(broken.len(), good.len());
}

#[test]
fn golden_product_detail_reads_long_description_and_genres() {
    let detail = extract_product_detail(&fixture("productDetail.golden.json"));
    assert!(!detail.description.is_empty());
    assert!(!detail.genres.is_empty());
    assert!(!detail.description.contains("All rights reserved"));
}

#[test]
fn synthetic_cross_gen_detail_reads_name_media_and_platforms() {
    let detail = extract_product_detail(&fixture("productDetailCrossGen.synthetic.json"));
    assert_eq!(detail.name.as_deref(), Some("Synthetic Game PS4 & PS5"));
    assert_eq!(detail.platforms, ["PS4", "PS5"]);
    assert!(is_ps5_game(
        &detail.platforms,
        detail.store_display_classification.as_deref()
    ));
    let roles: Vec<_> = detail.media.iter().map(|m| m.role.clone()).collect();
    assert_eq!(
        roles,
        [
            Some("PREVIEW".to_owned()),
            Some("GAMEHUB_COVER_ART".to_owned()),
            Some("SCREENSHOT".to_owned())
        ]
    );
    assert_eq!(detail.description, "Synthetic long text.");

    let game = product_detail_to_game("EP0000-PPSA00000_00-SYNTHETICGAME000", &detail, None, NOW);
    assert_eq!(game.url, "https://example.invalid/cover.jpg");
    assert_eq!(game.screenshots, ["https://example.invalid/shot.jpg"]);
    assert_eq!(game.videos, ["https://example.invalid/preview.mp4"]);

    for body in [
        json!({"data": {"productRetrieve": {"name": "X"}}}),
        json!({"data": {"productRetrieve": {"name": "X", "media": null}}}),
    ] {
        assert!(extract_product_detail(&body).media.is_empty());
    }
}

// ---- BROWSE and genres (browse.test.ts) ------------------------------------

fn browse_ok(outcome: BrowseOutcome) -> (Vec<crate::domain::catalog::Concept>, bool, usize) {
    match outcome {
        BrowseOutcome::Ok {
            concepts,
            is_last,
            dropped,
        } => (concepts, is_last, dropped),
        BrowseOutcome::Drift => panic!("expected a decoded page"),
    }
}

#[test]
fn golden_browse_page_decodes_with_page_info() {
    let (concepts, is_last, dropped) = browse_ok(extract_browse_page(
        &fixture("categoryGridBrowse.golden.json"),
        12,
    ));
    assert_eq!(dropped, 0);
    assert!(!is_last);
    let names: Vec<_> = concepts.iter().map(|c| c.name.clone().unwrap()).collect();
    assert_eq!(
        names,
        [
            "Tom Clancy's Rainbow Six Siege",
            "Apex Legends™",
            "Call of Duty®"
        ]
    );
}

#[test]
fn a_short_page_without_page_info_is_the_last_page() {
    let concept = json!({"id": "1000", "name": "C", "products": [{"id": "EP0006-PPSA04874_00-APEXLEGENDRSPWN1"}]});
    let (_, is_last, _) = browse_ok(extract_browse_page(
        &grid(json!({"concepts": [concept.clone()]})),
        60,
    ));
    assert!(is_last);
    let (_, is_last, _) = browse_ok(extract_browse_page(
        &grid(json!({"concepts": [concept.clone()], "pageInfo": null})),
        1,
    ));
    assert!(!is_last);
    // Challenge: an unreadable `isLast` also falls back to the page length.
    let (_, is_last, _) = browse_ok(extract_browse_page(
        &grid(json!({"concepts": [concept], "pageInfo": {"isLast": "no"}})),
        60,
    ));
    assert!(is_last);
}

#[test]
fn a_browse_page_keeps_valid_concepts_when_one_is_broken() {
    let (concepts, is_last, dropped) = browse_ok(extract_browse_page(
        &grid(json!({
            "concepts": [{"id": "1000", "products": []}, {"id": 42}],
            "pageInfo": {"isLast": true}
        })),
        60,
    ));
    assert_eq!((concepts.len(), is_last, dropped), (1, true, 1));
}

#[test]
fn a_missing_browse_node_is_drift() {
    for body in [
        json!({"data": {}}),
        grid(json!(null)),
        grid(json!({"concepts": "x"})),
    ] {
        assert_eq!(
            extract_browse_page(&body, 60),
            BrowseOutcome::Drift,
            "{body}"
        );
    }
}

#[test]
fn golden_genres_decode_in_name_order() {
    let GenresOutcome::Ok { genres, dropped } =
        extract_genres(&fixture("categoryGridBrowse.golden.json"))
    else {
        panic!("expected genres");
    };
    assert_eq!(dropped, 0);
    assert_eq!(genres.len(), 35);
    assert_eq!(
        genres[0],
        Genre {
            key: "ACTION".into(),
            name: "Action".into()
        }
    );
    assert!(genres.iter().any(|g| g.key == "FIRST_PERSON_SHOOTER"));
    assert!(
        genres
            .iter()
            .any(|g| g.key == "MUSIC/RHYTHM" && g.name == "Music/Rhythm")
    );
}

/// The order that the TypeScript server produced for the golden capture
/// (`extractGenres` with `localeCompare(…, 'en')` on Node 24).
#[test]
fn golden_genre_order_matches_the_typescript_server() {
    let GenresOutcome::Ok { genres, .. } =
        extract_genres(&fixture("categoryGridBrowse.golden.json"))
    else {
        panic!("expected genres");
    };
    let names: Vec<_> = genres.iter().map(|g| g.name.as_str()).collect();
    assert_eq!(names, GOLDEN_GENRE_ORDER);
}

const GOLDEN_GENRE_ORDER: [&str; 35] = [
    "Action",
    "Adult",
    "Adventure",
    "American Football",
    "Arcade",
    "Baseball",
    "Basketball",
    "Brain Training",
    "Card Game",
    "Casual",
    "Combat",
    "Driving/Racing",
    "Educational",
    "Family",
    "Fantasy",
    "Fighting",
    "First Person Shooter",
    "Fitness",
    "Horror",
    "Massively Multiplayer Online Role Playing Game",
    "Music/Rhythm",
    "Party",
    "Platformer",
    "Puzzle",
    "Quiz",
    "Role Playing Games",
    "Shooter",
    "Simulation",
    "Simulator",
    "Soccer",
    "Sport",
    "Stealth",
    "Strategy",
    "Third Person Shooter",
    "Unique",
];

#[test]
fn drops_one_invalid_genre_value_and_counts_it() {
    let outcome = extract_genres(&grid(json!({"facetOptions": [{
        "name": "conceptGenres",
        "values": [
            {"key": "ACTION", "displayName": "Action"},
            {"key": null, "displayName": "No key"},
            {"key": "bad key", "displayName": "Bad"},
            7
        ]
    }]})));
    assert_eq!(
        outcome,
        GenresOutcome::Ok {
            genres: vec![Genre {
                key: "ACTION".into(),
                name: "Action".into()
            }],
            dropped: 3
        }
    );
}

#[test]
fn a_missing_or_empty_genre_facet_is_drift() {
    for node in [
        json!({"facetOptions": []}),
        json!({}),
        json!({"facetOptions": [{"name": "conceptGenres", "values": null}]}),
        json!({"facetOptions": [{"name": "conceptGenres", "values": [{"key": "bad key"}]}]}),
        json!({"facetOptions": "x"}),
    ] {
        assert_eq!(
            extract_genres(&grid(node.clone())),
            GenresOutcome::Drift,
            "{node}"
        );
    }
    // Challenge: a malformed facet before the genre facet is skipped.
    let outcome = extract_genres(&grid(json!({"facetOptions": [
        {"name": 5},
        {"name": "conceptGenres", "values": [{"key": "ACTION", "displayName": "Action"}]}
    ]})));
    assert!(matches!(outcome, GenresOutcome::Ok { .. }));
}

// ---- Search (searchResults.test.ts) ----------------------------------------

const ELDEN: &str = "EP0700-PPSA04609_00-ELDENRING0000000";
const NIGHTREIGN: &str = "EP0700-PPSA25381_00-ERSL000000000000";
const SYNTHETIC: &str = "EP0001-PPSA00001_00-SYNTHETIC0000000";

fn candidate_ids(candidates: &[SearchCandidate]) -> Vec<String> {
    candidates
        .iter()
        .map(|candidate| match candidate {
            SearchCandidate::Known(concept) => concept.id.clone().unwrap_or_default(),
            SearchCandidate::Unverified { product_id, .. } => product_id.clone(),
        })
        .collect()
}

fn search_ok(json: &Value) -> (Vec<SearchEntry>, bool, usize) {
    match parse_search_response(json) {
        SearchOutcome::Ok {
            entries,
            is_last,
            dropped,
        } => (entries, is_last, dropped),
        SearchOutcome::Drift => panic!("expected a search page"),
    }
}

#[test]
fn golden_search_decodes_and_counts_unreadable_elements() {
    let (entries, is_last, dropped) = search_ok(&fixture("searchResults.golden.json"));
    assert!(is_last);
    assert_eq!(dropped, 2);
    assert_eq!(entries.len(), 7);
    let candidates = narrow_search_entries(entries);
    assert_eq!(candidate_ids(&candidates), [ELDEN, NIGHTREIGN, SYNTHETIC]);
    let kinds: Vec<_> = candidates
        .iter()
        .map(|c| matches!(c, SearchCandidate::Known(_)))
        .collect();
    assert_eq!(kinds, [true, true, false]);
    if let Some(SearchCandidate::Unverified { concept, .. }) = candidates.last() {
        assert_eq!(concept_to_game(concept, NOW).id, SYNTHETIC);
    }
}

fn search_envelope(node: Value) -> Value {
    json!({"data": {"universalSearch": node}})
}

#[test]
fn search_tolerates_null_fields_and_drops_odd_elements() {
    let (_, is_last, dropped) = search_ok(&search_envelope(json!({
        "pageInfo": {"isLast": false},
        "results": [{
            "__typename": "Product",
            "id": ELDEN,
            "name": null,
            "media": null,
            "price": {"basePrice": null, "serviceBranding": null},
            "platforms": ["PS5"],
            "storeDisplayClassification": "FULL_GAME"
        }]
    })));
    assert_eq!((is_last, dropped), (false, 0));

    let (entries, _, dropped) = search_ok(&search_envelope(json!({
        "pageInfo": {"isLast": true},
        "results": [
            {"__typename": "Product", "id": 5},
            "text",
            null,
            {"__typename": "Product", "id": ELDEN, "platforms": ["PS5"]},
            {"__typename": null, "id": ELDEN},
            ["Product"]
        ]
    })));
    assert_eq!((entries.len(), dropped), (1, 5));

    assert_eq!(
        parse_search_response(&search_envelope(
            json!({"pageInfo": {"isLast": true, "totalCount": 0}, "results": []})
        )),
        SearchOutcome::Ok {
            entries: vec![],
            is_last: true,
            dropped: 0
        }
    );
}

#[test]
fn search_reports_drift_for_unpageable_responses() {
    for body in [
        json!({"data": {}}),
        search_envelope(json!(null)),
        json!("oops"),
        search_envelope(json!({"pageInfo": {"isLast": true}})),
        search_envelope(json!({"results": []})),
        search_envelope(json!({"pageInfo": {"isLast": "yes"}, "results": []})),
        search_envelope(json!({"pageInfo": {"isLast": true}, "results": {}})),
        search_envelope(json!({"pageInfo": null, "results": []})),
        json!({"data": "x"}),
    ] {
        assert_eq!(parse_search_response(&body), SearchOutcome::Drift, "{body}");
    }
}

fn product_entry(id: Option<&str>, platforms: Option<&[&str]>, class: Option<&str>) -> SearchEntry {
    SearchEntry::Product(crate::domain::catalog::CategoryGridProduct {
        id: id.map(str::to_owned),
        name: Some(format!("Name {}", id.unwrap_or("none"))),
        platforms: platforms.map(|p| p.iter().map(|s| (*s).to_owned()).collect()),
        store_display_classification: class.map(str::to_owned),
        ..Default::default()
    })
}

fn concept_entry(id: &str, product_ids: &[&str]) -> SearchEntry {
    SearchEntry::Concept(crate::domain::catalog::Concept {
        id: Some(id.to_owned()),
        name: Some("Concept".into()),
        products: Some(
            product_ids
                .iter()
                .map(|p| crate::domain::catalog::ConceptProductRef {
                    id: Some((*p).to_owned()),
                    ..Default::default()
                })
                .collect(),
        ),
        ..Default::default()
    })
}

#[test]
fn narrows_search_entries_to_ps5_games() {
    let valid = "EP0001-PPSA00001_00-AAAAAAAAAAAAAAAA";
    let other = "EP0001-PPSA00002_00-BBBBBBBBBBBBBBBB";
    let kept = narrow_search_entries(vec![
        product_entry(Some(valid), Some(&["PS4", "PS5"]), Some("FULL_GAME")),
        product_entry(Some(other), Some(&["PS5"]), Some("GAME_BUNDLE")),
    ]);
    assert_eq!(candidate_ids(&kept), [valid, other]);
    assert!(
        narrow_search_entries(vec![product_entry(
            Some(valid),
            Some(&["PS4"]),
            Some("FULL_GAME")
        )])
        .is_empty()
    );
    for class in [
        Some("LEVEL"),
        Some("OTHER"),
        Some("PREMIUM_EDITION"),
        Some("SEASON_PASS"),
        Some(""),
        None,
    ] {
        assert!(
            narrow_search_entries(vec![product_entry(Some(valid), Some(&["PS5"]), class)])
                .is_empty()
        );
    }
    assert!(
        narrow_search_entries(vec![
            product_entry(Some(valid), None, Some("FULL_GAME")),
            product_entry(None, Some(&["PS5"]), Some("FULL_GAME")),
            product_entry(Some("10015248"), Some(&["PS5"]), Some("FULL_GAME")),
            concept_entry("1", &[]),
            SearchEntry::Concept(crate::domain::catalog::Concept {
                id: Some("2".into()),
                ..Default::default()
            }),
            concept_entry("3", &["not-a-product-id"]),
        ])
        .is_empty()
    );
    let ordered = narrow_search_entries(vec![
        product_entry(Some(other), Some(&["PS5"]), Some("FULL_GAME")),
        concept_entry("1", &[valid]),
        product_entry(Some(valid), Some(&["PS5"]), Some("FULL_GAME")),
        product_entry(Some(other), Some(&["PS5"]), Some("FULL_GAME")),
    ]);
    assert_eq!(candidate_ids(&ordered), [other, valid]);
    assert!(matches!(ordered[1], SearchCandidate::Unverified { .. }));
}

// ---- PS Plus monthly (plusMonthly.test.ts) ---------------------------------

fn monthly_ok(json: &Value) -> (Vec<crate::domain::catalog::PlusMonthlyEntry>, usize, usize) {
    match parse_plus_monthly(json) {
        PlusMonthlyOutcome::Ok {
            entries,
            dropped,
            out_of_scope,
        } => (entries, dropped, out_of_scope),
        PlusMonthlyOutcome::Drift => panic!("expected entries"),
    }
}

fn entry(overrides: Value) -> Value {
    let mut base = json!({
        "productId": "EP0001-PPSA00001_00-ALPHA00000000000",
        "name": "Alpha",
        "imageUrl": "https://img/alpha",
        "releaseDate": "2025-01-01T00:00:00Z",
        "genre": ["Action"],
        "device": ["PS5"]
    });
    if let (Some(base), Some(overrides)) = (base.as_object_mut(), overrides.as_object()) {
        for (key, value) in overrides {
            base.insert(key.clone(), value.clone());
        }
    }
    base
}

fn bucket(games: Vec<Value>) -> Value {
    json!({"catalogKey": "A", "count": games.len(), "games": games})
}

#[test]
fn golden_monthly_keeps_the_four_ps5_games() {
    let (entries, dropped, out_of_scope) = monthly_ok(&fixture("plusMonthly.golden.json"));
    let mut names: Vec<_> = entries.iter().map(|e| e.name.clone()).collect();
    names.sort();
    assert_eq!(
        names,
        [
            "Fallout 76 PS4 & PS5",
            "MLB® The Show™ 26",
            "Sniper Elite: Resistance PS4™ & PS5™",
            "Wobbly Life"
        ]
    );
    assert_eq!((out_of_scope, dropped), (2, 0));

    let games = map_monthly_to_games(&entries);
    let ids: Vec<_> = games.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "EP1003-PPSA30933_00-PROJECTSYMES0000",
            "UP9000-PPSA30630_00-MLBTHESHOW26PLUS",
            "UP7742-PPSA29413_00-0632159817352246",
            "UP4363-PPSA17232_00-SNIPERELITERES00"
        ]
    );
    for game in &games {
        assert_eq!(game.price, "");
        assert_eq!(game.original_price, "");
        assert_eq!(game.plus_offer, None);
        assert_eq!(game.plus_upsell_text, None);
        assert!(!game.pre_order);
        assert_eq!(game.id_kind, IdKind::Product);
        assert!(game.date.ends_with(".000Z"), "{}", game.date);
    }
}

#[test]
fn monthly_flattens_buckets_and_keeps_the_first_entry_of_an_id() {
    let (entries, ..) = monthly_ok(&json!([
        bucket(vec![entry(
            json!({"productId": "EP0001-PPSA00001_00-AAAAAAAAAAAAAAAA"})
        )]),
        bucket(vec![entry(
            json!({"productId": "EP0001-PPSA00002_00-BBBBBBBBBBBBBBBB"})
        )]),
    ]));
    assert_eq!(entries.len(), 2);

    let (entries, ..) = monthly_ok(&json!([
        bucket(vec![
            entry(json!({"name": "First", "conceptId": "1"})),
            entry(json!({"name": "Second", "conceptId": "1"}))
        ]),
        bucket(vec![entry(json!({
            "name": "Other",
            "conceptId": "1",
            "productId": "EP0001-PPSA00009_00-OTHER00000000000"
        }))]),
    ]));
    let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["First", "Other"]);
}

#[test]
fn monthly_counts_out_of_scope_entries() {
    let (entries, _, out_of_scope) = monthly_ok(&json!([bucket(vec![
        entry(json!({"device": ["PS4"]})),
        entry(json!({"device": []})),
        entry(json!({"device": null})),
        entry(json!({"productId": "EP0900-CUSA29547_00-4103461541053748", "device": ["PS4"]})),
    ])]));
    assert_eq!((entries.len(), out_of_scope), (0, 4));
    let (entries, _, out_of_scope) = monthly_ok(&json!([bucket(vec![entry(
        json!({"productId": "10004896"})
    )])]));
    assert_eq!((entries.len(), out_of_scope), (0, 1));
}

#[test]
fn monthly_drops_bad_elements_without_failing_the_rest() {
    let (entries, dropped, _) = monthly_ok(&json!([
        bucket(vec![
            json!(null),
            json!("text"),
            entry(json!({"productId": 5})),
            entry(json!({"name": null})),
            entry(json!({"productId": null})),
            entry(json!({"releaseDate": 3})),
            entry(json!({"productId": "EP0001-PPSA00003_00-GOODGOODGOODGOOD"}))
        ]),
        null
    ]));
    let ids: Vec<_> = entries.iter().map(|e| e.product_id.as_str()).collect();
    assert_eq!(ids, ["EP0001-PPSA00003_00-GOODGOODGOODGOOD"]);
    assert_eq!(dropped, 7);
}

#[test]
fn monthly_keeps_an_entry_with_null_optional_fields() {
    let (entries, ..) = monthly_ok(&json!([bucket(vec![entry(
        json!({"imageUrl": null, "releaseDate": null, "genre": null})
    )])]));
    assert_eq!(entries[0].image_url, "");
    assert_eq!(entries[0].release_date, "");
    assert!(entries[0].genres.is_empty());
    assert_eq!(map_monthly_to_games(&entries)[0].date, "");
    // Challenge: null and empty genres inside the list are skipped.
    let (entries, ..) = monthly_ok(&json!([bucket(vec![entry(
        json!({"genre": ["A", null, "", "B"], "device": [null, "PS5"]})
    )])]));
    assert_eq!(entries[0].genres, ["A", "B"]);
}

#[test]
fn monthly_empty_lists_are_successful_and_non_lists_are_drift() {
    assert_eq!(monthly_ok(&json!([])).0, vec![]);
    assert_eq!(
        monthly_ok(&json!([bucket(vec![]), {"catalogKey": "B", "count": 0, "games": null}])).0,
        vec![]
    );
    for body in [
        json!(null),
        json!({}),
        json!("x"),
        json!(5),
        json!({"games": []}),
        json!(["a", 1, null]),
    ] {
        assert_eq!(
            parse_plus_monthly(&body),
            PlusMonthlyOutcome::Drift,
            "{body}"
        );
    }
}

// ---- Product price (productPrice.test.ts) ----------------------------------

fn offer(json: &Value) -> Option<PlusOffer> {
    parse_product_price(json).plus_offer
}

fn wrap(webctas: Value) -> Value {
    json!({"data": {"productRetrieve": {"webctas": webctas}}})
}

fn plus_cta(price: Value, kind: &str) -> Value {
    let mut base = json!({
        "applicability": "UPSELL",
        "serviceBranding": ["PS_PLUS"],
        "isTiedToSubscription": false,
        "discountedPrice": "€10,00"
    });
    if let (Some(base), Some(price)) = (base.as_object_mut(), price.as_object()) {
        for (key, value) in price {
            base.insert(key.clone(), value.clone());
        }
    }
    json!({"type": kind, "price": base})
}

fn plus_discount(price: Value) -> Value {
    plus_cta(price, "UPSELL_PS_PLUS_DISCOUNT")
}

fn price_offer(text: &str) -> Option<PlusOffer> {
    Some(PlusOffer::Price { price: text.into() })
}

#[test]
fn golden_price_captures_give_the_plus_offer() {
    assert_eq!(
        offer(&fixture("productPriceDiscountPreorder.golden.json")),
        price_offer("€44,95")
    );
    assert_eq!(
        offer(&fixture("productPriceDiscountReleased.golden.json")),
        price_offer("€17,95")
    );
    assert_eq!(
        offer(&fixture("productPriceIncluded.golden.json")),
        Some(PlusOffer::Included)
    );
    assert_eq!(
        offer(&fixture("productPricePlusOnly.golden.json")),
        Some(PlusOffer::Included)
    );
    assert_eq!(
        offer(&fixture("productPriceClassic.golden.json")),
        Some(PlusOffer::Included)
    );
    assert_eq!(offer(&fixture("productPriceTrial.golden.json")), None);
    assert_eq!(
        offer(&fixture("productPriceOtherSubscription.golden.json")),
        None
    );
}

#[test]
fn malformed_price_bodies_give_no_offer() {
    for body in [
        json!(null),
        json!("text"),
        json!({}),
        json!({"data": null}),
        json!({"data": {"productRetrieve": null}}),
        wrap(json!(null)),
        wrap(json!([])),
        json!({"data": []}),
    ] {
        assert_eq!(
            parse_product_price(&body),
            crate::domain::catalog::ProductPrice::default(),
            "{body}"
        );
    }
}

#[test]
fn skips_malformed_ctas_and_finds_a_later_offer() {
    let body = wrap(json!([
        null,
        "text",
        {"type": 5, "price": "x"},
        {"type": "UPSELL_PS_PLUS_DISCOUNT", "price": null},
        plus_discount(json!({}))
    ]));
    assert_eq!(offer(&body), price_offer("€10,00"));
    let body = wrap(json!([{
        "type": "UPSELL_PS_PLUS_DISCOUNT",
        "price": {
            "applicability": "UPSELL",
            "serviceBranding": ["PS_PLUS", null],
            "isTiedToSubscription": false,
            "discountedPrice": "€10,00",
            "extra": 1,
            "history": null
        },
        "more": []
    }]));
    assert_eq!(offer(&body), price_offer("€10,00"));
}

#[test]
fn the_plus_offer_needs_an_upsell_with_ps_plus_branding_and_a_price() {
    assert_eq!(
        offer(&wrap(json!([plus_discount(
            json!({"applicability": "APPLICABLE"})
        )]))),
        None
    );
    assert_eq!(
        offer(&wrap(json!([plus_discount(
            json!({"serviceBranding": ["NONE"]})
        )]))),
        None
    );
    assert_eq!(
        offer(&wrap(json!([plus_discount(
            json!({"serviceBranding": null})
        )]))),
        None
    );
    for blank in [json!(""), json!(" "), json!(null), json!("\u{FEFF}\u{A0}")] {
        assert_eq!(
            offer(&wrap(json!([plus_discount(
                json!({"discountedPrice": blank})
            )]))),
            None
        );
    }
    assert_eq!(
        offer(&wrap(json!([plus_discount(
            json!({"isTiedToSubscription": null})
        )]))),
        None
    );
    let tied = json!({"isTiedToSubscription": true, "discountedPrice": "Included"});
    assert_eq!(
        offer(&wrap(json!([plus_cta(
            tied.clone(),
            "UPSELL_PS_PLUS_GAME_CATALOG"
        )]))),
        Some(PlusOffer::Included)
    );
    assert_eq!(
        offer(&wrap(json!([plus_cta(tied, "UPSELL_PS_PLUS_NEW_TYPE")]))),
        None
    );
    // The price text stays verbatim, also with a non-breaking space.
    assert_eq!(
        offer(&wrap(json!([plus_discount(
            json!({"discountedPrice": "10,00\u{A0}€"})
        )]))),
        price_offer("10,00\u{A0}€")
    );
}

fn standard(
    base: &str,
    discounted: &str,
    text: &str,
) -> Option<crate::domain::catalog::StandardPrice> {
    Some(crate::domain::catalog::StandardPrice {
        base_price: base.into(),
        discounted_price: discounted.into(),
        discount_text: text.into(),
    })
}

fn cta(price: Value, kind: &str) -> Value {
    let mut base = json!({
        "applicability": "APPLICABLE",
        "basePrice": "€39,99",
        "discountedPrice": "€39,99",
        "displayDiscountText": null,
        "isTiedToSubscription": false,
        "serviceBranding": ["NONE"]
    });
    if let (Some(base), Some(price)) = (base.as_object_mut(), price.as_object()) {
        for (key, value) in price {
            base.insert(key.clone(), value.clone());
        }
    }
    json!({"type": kind, "price": base})
}

#[test]
fn golden_price_captures_give_the_standard_price() {
    let released = parse_product_price(&fixture("productPriceDiscountReleased.golden.json"));
    assert_eq!(released.plus_offer, price_offer("€17,95"));
    assert_eq!(released.standard, standard("€19,95", "€19,95", ""));
    assert_eq!(
        parse_product_price(&fixture("productPriceDiscountPreorder.golden.json")).standard,
        standard("€49,95", "€49,95", "")
    );
    let trial = parse_product_price(&fixture("productPriceTrial.golden.json"));
    assert_eq!(
        (trial.plus_offer, trial.standard),
        (None, standard("€4,95", "€3,96", ""))
    );
    assert_eq!(
        parse_product_price(&fixture("productPriceIncluded.golden.json")).plus_offer,
        Some(PlusOffer::Included)
    );
    let plus_only = parse_product_price(&fixture("productPricePlusOnly.golden.json"));
    assert_eq!(
        (plus_only.plus_offer, plus_only.standard),
        (Some(PlusOffer::Included), None)
    );
    assert_eq!(
        parse_product_price(&fixture("productPriceOtherSubscription.golden.json")),
        crate::domain::catalog::ProductPrice::default()
    );
}

#[test]
fn the_standard_price_is_the_first_plain_cta() {
    assert_eq!(
        parse_product_price(&wrap(json!([plus_discount(json!({}))]))).standard,
        None
    );
    assert_eq!(
        parse_product_price(&wrap(json!([cta(json!({}), "ADD_TO_CART")]))).standard,
        standard("€39,99", "€39,99", "")
    );
    assert_eq!(
        parse_product_price(&wrap(json!([cta(
            json!({"basePrice": "€39,99", "discountedPrice": "€19,99", "displayDiscountText": "-50%"}),
            "ADD_TO_CART"
        )])))
        .standard,
        standard("€39,99", "€19,99", "-50%")
    );
    assert_eq!(
        parse_product_price(&wrap(json!([cta(
            json!({"basePrice": "Free", "discountedPrice": "Free"}),
            "DOWNLOAD"
        )])))
        .standard,
        standard("Free", "Free", "")
    );
    let body = wrap(json!([
        cta(json!({"isTiedToSubscription": true}), "ADD_TO_CART"),
        cta(
            json!({"basePrice": null, "discountedPrice": null}),
            "ADD_TO_CART"
        ),
        cta(
            json!({"basePrice": "€5,00", "discountedPrice": "€5,00"}),
            "ADD_TO_CART"
        ),
    ]));
    assert_eq!(
        parse_product_price(&body).standard.map(|s| s.base_price),
        Some("€5,00".to_owned())
    );
}
