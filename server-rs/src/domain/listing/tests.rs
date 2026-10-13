//! Port of the pure parts of `browse.test.ts` and `searchResults.test.ts`,
//! with challenge cases for the sort, the pagination, and the windows.

use super::*;
use crate::domain::catalog::{ConceptPrice, ConceptProductRef};
use crate::domain::js::parse_date_ms;

const HOUR: i64 = 60 * 60 * 1000;

fn now() -> i64 {
    parse_date_ms("2026-10-05T12:00:00Z").unwrap()
}

fn game(id: &str, date: &str) -> Game {
    Game {
        id: id.into(),
        name: id.into(),
        date: date.into(),
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

fn ids(games: &[Game]) -> Vec<&str> {
    games.iter().map(|g| g.id.as_str()).collect()
}

fn concept(ids: &[&str]) -> Concept {
    Concept {
        id: Some("1000".into()),
        name: Some("Concept".into()),
        products: Some(
            ids.iter()
                .map(|id| ConceptProductRef {
                    id: Some((*id).to_owned()),
                    ..ConceptProductRef::default()
                })
                .collect(),
        ),
        ..Concept::default()
    }
}

#[test]
fn sorts_by_date_with_undated_games_last_and_stable_ties() {
    let games = vec![
        game("undated-1", ""),
        game("old", "2023-01-01T00:00:00Z"),
        game("tie-a", "2024-06-01T00:00:00Z"),
        game("bad", "soon"),
        game("recent", "2025-06-01T00:00:00.000Z"),
        game("tie-b", "2024-06-01T00:00:00.000Z"),
        game("undated-2", ""),
    ];
    assert_eq!(
        ids(&sort_by_date(games.clone(), SortOrder::DateDesc)),
        [
            "recent",
            "tie-a",
            "tie-b",
            "old",
            "undated-1",
            "bad",
            "undated-2"
        ]
    );
    assert_eq!(
        ids(&sort_by_date(games, SortOrder::DateAsc)),
        [
            "old",
            "tie-a",
            "tie-b",
            "recent",
            "undated-1",
            "bad",
            "undated-2"
        ]
    );
}

#[test]
fn paginates_with_a_next_offset_until_the_last_page() {
    let games: Vec<Game> = (0..10).map(|i| game(&i.to_string(), "")).collect();
    let page = paginate(games.clone(), 0, 3);
    assert_eq!(
        (ids(&page.games), page.total_count, page.next_offset),
        (vec!["0", "1", "2"], 10, Some(3))
    );
    let last = paginate(games.clone(), 9, 3);
    assert_eq!((ids(&last.games), last.next_offset), (vec!["9"], None));
    let exact = paginate(games.clone(), 7, 3);
    assert_eq!(exact.next_offset, None);
    let past = paginate(games.clone(), 20, 3);
    assert_eq!(
        (past.games.len(), past.total_count, past.next_offset),
        (0, 10, None)
    );
    // Challenge: the largest offset that the route accepts never overflows.
    let huge = paginate(games, usize::MAX, 120);
    assert_eq!((huge.games.len(), huge.next_offset), (0, None));
}

#[test]
fn the_windows_are_supersets_of_the_local_day_split() {
    let at = |hours: i64| to_iso_string(now() + hours * HOUR).unwrap();
    let games = vec![
        game("old", &to_iso_string(now() - 12 * HOUR - 60_000).unwrap()),
        game("just-out", &at(-12)),
        game("later-today", &at(6)),
        game(
            "edge-new",
            &to_iso_string(now() + 37 * HOUR - 60_000).unwrap(),
        ),
        game("edge-upcoming", &at(37)),
        game("undated", ""),
    ];
    assert_eq!(
        ids(&in_new_window(games.clone(), now())),
        ["old", "just-out", "later-today", "edge-new"]
    );
    assert_eq!(
        ids(&in_upcoming_window(games, now())),
        [
            "just-out",
            "later-today",
            "edge-new",
            "edge-upcoming",
            "undated"
        ]
    );
}

#[test]
fn merging_the_grids_keeps_the_first_occurrence() {
    let merged = merge_release_grids(
        vec![game("a", "1"), game("b", "2")],
        vec![game("b", "3"), game("c", "4")],
    );
    assert_eq!(ids(&merged), ["a", "b", "c"]);
    assert_eq!(merged[1].date, "2");
}

#[test]
fn upcoming_keeps_concept_ids_and_drops_id_less_entries() {
    let sku = "EP0001-PPSA00001_00-ALPHA00000000000";
    let concepts = vec![
        concept(&[sku]),
        Concept {
            id: Some("10018729".into()),
            products: Some(vec![]),
            ..Concept::default()
        },
        Concept::default(),
    ];
    let games = map_upcoming_concepts_to_games(&concepts, now());
    assert_eq!(ids(&games), [sku, "10018729"]);
    assert_eq!(games[1].id_kind, IdKind::Concept);
    assert_eq!(map_concepts_to_games(&concepts, now()).len(), 1);
}

#[test]
fn a_ps5_game_needs_ps5_and_a_game_classification() {
    let ps5 = vec!["PS4".to_owned(), "PS5".to_owned()];
    assert!(is_ps5_game(&ps5, Some("FULL_GAME")));
    assert!(is_ps5_game(&ps5, Some("GAME_BUNDLE")));
    assert!(!is_ps5_game(&ps5, Some("PREMIUM_EDITION")));
    assert!(!is_ps5_game(&ps5, None));
    assert!(!is_ps5_game(&["PS4".to_owned()], Some("FULL_GAME")));
    assert!(!is_ps5_game(&["ps5".to_owned()], Some("FULL_GAME")));
}

const PS4_A: &str = "EP0006-CUSA12552_00-APEXLEGENDRSPWN1";
const PS5_A: &str = "EP0006-PPSA04874_00-APEXLEGENDRSPWN1";
const PS5_B: &str = "EP0006-PPSA04874_00-APEXLEGENDDELUX";

#[test]
fn browse_candidates_put_ps5_title_ids_first() {
    assert_eq!(
        browse_candidate_ids(&concept(&[PS4_A, PS5_A, PS5_B])),
        [PS5_A, PS5_B, PS4_A]
    );
}

#[test]
fn browse_candidates_are_capped_and_drop_invalid_and_repeated_ids() {
    let many: Vec<String> = (0..6)
        .map(|i| format!("EP0001-PPSA0000{i}_00-GAME000000000000"))
        .collect();
    let mut input = vec!["10020880", many[0].as_str(), ""];
    input.extend(many.iter().map(String::as_str));
    let candidates = browse_candidate_ids(&concept(&input));
    assert_eq!(candidates, many[..BROWSE_MAX_CANDIDATES]);
    assert!(browse_candidate_ids(&concept(&[])).is_empty());
    assert!(browse_candidate_ids(&Concept::default()).is_empty());
}

#[test]
fn narrows_genres_by_key_and_sorts_by_name() {
    let raw = |key: &str, name: &str| RawGenre {
        key: key.into(),
        name: name.into(),
    };
    let genres = narrow_genres(vec![
        raw("SHOOTER", "Shooter"),
        raw("MUSIC/RHYTHM", "Music/Rhythm"),
        raw("ACTION", "Action"),
        raw("ACTION", "Action again"),
        raw("bad key", "Bad"),
        raw(&"X".repeat(65), "Too long"),
    ]);
    let pairs: Vec<_> = genres
        .iter()
        .map(|g| (g.key.as_str(), g.name.as_str()))
        .collect();
    assert_eq!(
        pairs,
        [
            ("ACTION", "Action"),
            ("MUSIC/RHYTHM", "Music/Rhythm"),
            ("SHOOTER", "Shooter")
        ]
    );
}

fn apex() -> Concept {
    Concept {
        id: Some("232352".into()),
        name: Some("Apex Legends™".into()),
        price: Some(ConceptPrice {
            base_price: Some("€19,99".into()),
            discounted_price: Some("€9,99".into()),
            discount_text: Some("-50%".into()),
            ..ConceptPrice::default()
        }),
        ..concept(&[PS4_A, PS5_A])
    }
}

fn browse_now() -> i64 {
    parse_date_ms("2026-10-06T12:00:00Z").unwrap()
}

#[test]
fn a_browse_card_uses_the_chosen_product_and_the_concept_name() {
    let shooter = vec!["Shooter".to_owned()];
    let game = browse_concept_to_game(
        &apex(),
        PS5_A,
        "2026-11-01T00:00:00+02:00",
        &shooter,
        browse_now(),
    );
    assert_eq!(game.id, PS5_A);
    assert_eq!(game.name, "Apex Legends™");
    assert_eq!(game.date, "2026-10-31T22:00:00.000Z");
    assert_eq!(game.discount_date, "2026-10-31T22:00:00.000Z");
    assert_eq!(game.genres, ["Shooter"]);
    assert!(game.pre_order);
    assert_eq!(game.id_kind, IdKind::Product);
    assert_eq!(game.price, "€9,99");
}

#[test]
fn a_browse_card_reads_the_pre_order_flag_from_the_given_time() {
    let game = browse_concept_to_game(&apex(), PS5_A, "2026-10-01T00:00:00Z", &[], browse_now());
    assert!(!game.pre_order);
}

#[test]
fn a_browse_card_never_guesses_a_date() {
    for date in ["soon", ""] {
        let game = browse_concept_to_game(&apex(), PS5_A, date, &[], browse_now());
        assert_eq!(game.date, "", "{date}");
        assert_eq!(game.discount_date, "", "{date}");
        assert!(!game.pre_order, "{date}");
    }
}

#[test]
fn a_browse_card_keeps_concept_genres_without_detail_genres() {
    let mut with_genres = apex();
    if let Some(products) = with_genres.products.as_mut() {
        products[0].genres = Some(vec!["Concept genre".into()]);
    }
    let game = browse_concept_to_game(&with_genres, PS5_A, "", &[], browse_now());
    assert_eq!(game.genres, ["Concept genre"]);
}

#[test]
fn monthly_games_are_newest_first() {
    let entry = |id: &str, date: &str| PlusMonthlyEntry {
        product_id: id.into(),
        name: id.into(),
        image_url: String::new(),
        release_date: date.into(),
        genres: vec![],
    };
    let games = map_monthly_to_games(&[
        entry("old", "2024-01-01T00:00:00Z"),
        entry("undated", ""),
        entry("new", "2026-01-01T00:00:00Z"),
    ]);
    assert_eq!(ids(&games), ["new", "old", "undated"]);
    assert_eq!(games[0].date, "2026-01-01T00:00:00.000Z");
}
