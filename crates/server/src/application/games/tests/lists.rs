//! NEW, UPCOMING, DISCOUNTED, and MONTHLY.

use super::*;
use crate::domain::js::{parse_date_ms, to_iso_string};

fn grids(
    released: Vec<Concept>,
    upcoming: Vec<Concept>,
    discounted: Vec<Concept>,
) -> Respond<SonyFeature, Vec<Concept>> {
    Box::new(move |feature| {
        Ok(match feature {
            SonyFeature::New => released.clone(),
            SonyFeature::Upcoming => upcoming.clone(),
            SonyFeature::Discounted => discounted.clone(),
        })
    })
}

fn dates_by_marker(
    markers: Vec<(&'static str, Option<&'static str>)>,
    default: Option<&'static str>,
) -> Respond<String, ProductDetail> {
    Box::new(move |id| {
        let date = markers
            .iter()
            .find(|(marker, _)| id.contains(marker))
            .map_or(default, |(_, date)| *date);
        Ok(detail_at(date))
    })
}

#[tokio::test(start_paused = true)]
async fn every_list_has_games() {
    let (svc, _) = service(FakeSony {
        concepts: grids(
            vec![priced_concept(1, "alpha"), priced_concept(2, "bravo")],
            vec![priced_concept(3, "future")],
            vec![priced_concept(4, "deal")],
        ),
        detail: dates_by_marker(vec![("FUTURE", Some(FUTURE_DATE))], Some(PAST_DATE)),
        ..FakeSony::default()
    });
    assert!(
        !svc.new_games(page(0, 60)).await.unwrap().games.is_empty(),
        "the value is empty"
    );
    assert!(
        !svc.upcoming_games(page(0, 60))
            .await
            .unwrap()
            .games
            .is_empty(),
        "the value is empty"
    );
    assert!(
        !svc.discounted_games(page(0, 60))
            .await
            .unwrap()
            .games
            .is_empty(),
        "the value is empty"
    );
}

#[tokio::test(start_paused = true)]
async fn new_takes_the_product_date_verbatim_and_drops_undated_games() {
    let (svc, _) = service(FakeSony {
        concepts: grids(
            vec![priced_concept(1, "alpha"), priced_concept(2, "bravo")],
            vec![],
            vec![],
        ),
        detail: dates_by_marker(vec![("ALPHA", Some("2024-06-15T00:00:00Z"))], None),
        ..FakeSony::default()
    });
    let result = svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(names(&result), ["alpha"]);
    // The enrichment keeps Sony's string; only concept dates are normalised.
    assert_eq!(result.games[0].date, "2024-06-15T00:00:00Z");
}

#[tokio::test(start_paused = true)]
async fn new_drops_concept_ids_and_future_games() {
    let (svc, _) = service(FakeSony {
        concepts: grids(
            vec![
                priced_concept(1, "valid-game"),
                Concept {
                    products: Some(vec![]),
                    ..announcement("12345", "concept-only")
                },
                Concept {
                    products: None,
                    ..announcement("67890", "no-products")
                },
                priced_concept(2, "future"),
            ],
            vec![],
            vec![],
        ),
        detail: dates_by_marker(
            vec![("FUTURE", Some(FUTURE_DATE))],
            Some("2024-01-01T00:00:00Z"),
        ),
        ..FakeSony::default()
    });
    assert_eq!(
        names(&svc.new_games(page(0, 60)).await.unwrap()),
        ["valid-game"]
    );
}

#[tokio::test(start_paused = true)]
async fn new_is_newest_first_with_stable_ties_and_pages() {
    let (svc, _) = service(FakeSony {
        concepts: grids(
            vec![
                priced_concept(1, "old"),
                priced_concept(2, "recent"),
                priced_concept(3, "mid"),
                priced_concept(4, "tie-first"),
                priced_concept(5, "tie-second"),
            ],
            vec![],
            vec![],
        ),
        detail: dates_by_marker(
            vec![
                ("OLD", Some("2023-01-01T00:00:00Z")),
                ("RECENT", Some("2025-06-01T00:00:00Z")),
                ("TIE", Some("2024-01-01T00:00:00Z")),
            ],
            Some("2024-06-01T00:00:00Z"),
        ),
        ..FakeSony::default()
    });
    let all = svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(
        names(&all),
        ["recent", "mid", "tie-first", "tie-second", "old"]
    );
    let first = svc.new_games(page(0, 3)).await.unwrap();
    assert_eq!(
        (first.games.len(), first.total_count, first.next_offset),
        (3, 5, Some(3))
    );
    let last = svc.new_games(page(0, 200)).await.unwrap();
    assert_eq!(last.next_offset, None);
}

#[tokio::test(start_paused = true)]
async fn new_reads_a_wide_window_and_upcoming_and_discounted_the_list_size() {
    let (svc, fake) = service(FakeSony::default());
    svc.new_games(page(0, 60)).await.unwrap();
    svc.discounted_games(page(0, 60)).await.unwrap();
    let mut sizes = fake.calls().concepts.clone();
    sizes.sort_by_key(|(feature, _)| feature.as_str());
    assert_eq!(
        sizes,
        [
            (SonyFeature::Discounted, 120),
            (SonyFeature::New, 300),
            (SonyFeature::Upcoming, 120)
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_recent_release_beyond_120_concepts_is_shown() {
    let concepts: Vec<Concept> = (0..130)
        .map(|i| priced_concept(i, if i == 126 { "beyond-prefix" } else { "filler" }))
        .collect();
    let (svc, _) = service(FakeSony {
        concepts: grids(concepts, vec![], vec![]),
        detail: dates_by_marker(
            vec![("BEYONDPREFIX", Some("2025-12-29T00:00:00Z"))],
            Some("2024-01-01T00:00:00Z"),
        ),
        ..FakeSony::default()
    });
    let result = svc.new_games(page(0, 130)).await.unwrap();
    assert_eq!(result.games[0].name, "beyond-prefix");
}

#[tokio::test(start_paused = true)]
async fn maps_discount_fields_from_the_concept_price() {
    let mut on_sale = priced_concept(2, "on-sale");
    on_sale.price = Some(ConceptPrice {
        base_price: Some("€59,99".into()),
        discounted_price: Some("€39,99".into()),
        discount_text: Some("-33%".into()),
        ..ConceptPrice::default()
    });
    let (svc, _) = service(FakeSony {
        concepts: grids(
            vec![priced_concept(1, "full-price"), on_sale],
            vec![],
            vec![],
        ),
        ..FakeSony::default()
    });
    let result = svc.new_games(page(0, 60)).await.unwrap();
    let full = result
        .games
        .iter()
        .find(|g| g.name == "full-price")
        .unwrap();
    assert_eq!(
        (full.original_price.as_str(), full.discount_text.as_str()),
        ("", "")
    );
    let sale = result.games.iter().find(|g| g.name == "on-sale").unwrap();
    assert_eq!(
        (
            sale.original_price.as_str(),
            sale.discount_text.as_str(),
            sale.price.as_str()
        ),
        ("€59,99", "-33%", "€39,99")
    );
}

// ---- The release split (gamesServiceReleaseSplit.test.ts) -----------------

const SPLIT_NOW: &str = "2026-10-05T12:00:00Z";

fn at(hours: f64) -> String {
    let now = parse_date_ms(SPLIT_NOW).unwrap();
    #[expect(
        clippy::cast_possible_truncation,
        reason = "test offsets are whole minutes"
    )]
    let offset = (hours * 3_600_000.0) as i64;
    to_iso_string(now + offset).unwrap()
}

fn split(
    released: Vec<Concept>,
    upcoming: Vec<Concept>,
    dates: Vec<(String, String)>,
) -> GamesService {
    let (svc, _, _) = service_at(
        FakeSony {
            concepts: grids(released, upcoming, vec![]),
            detail: Box::new(move |id| {
                let date = dates
                    .iter()
                    .find(|(pid, _)| *pid == id)
                    .map(|(_, d)| d.as_str());
                Ok(detail_at(date))
            }),
            ..FakeSony::default()
        },
        SPLIT_NOW,
    );
    svc
}

async fn split_names(svc: &GamesService) -> (Vec<String>, Vec<String>) {
    let new = svc.new_games(page(0, 120)).await.unwrap();
    let upcoming = svc.upcoming_games(page(0, 120)).await.unwrap();
    let own = |r: &PageResult| r.games.iter().map(|g| g.name.clone()).collect();
    (own(&new), own(&upcoming))
}

#[tokio::test(start_paused = true)]
async fn a_released_product_in_the_upcoming_grid_shows_in_new() {
    let released = priced_concept(1, "released-elsewhere");
    let dates = vec![(product_id(&released), at(-7.0 * 24.0))];
    let svc = split(vec![], vec![released], dates);
    assert_eq!(
        split_names(&svc).await,
        (vec!["released-elsewhere".into()], vec![])
    );
}

#[tokio::test(start_paused = true)]
async fn a_future_product_in_the_released_grid_shows_in_upcoming() {
    let future = priced_concept(2, "future-elsewhere");
    let dates = vec![(product_id(&future), at(5.0 * 24.0))];
    let svc = split(vec![future], vec![], dates);
    assert_eq!(
        split_names(&svc).await,
        (vec![], vec!["future-elsewhere".into()])
    );
}

#[tokio::test(start_paused = true)]
async fn a_game_near_the_boundary_reaches_both_lists() {
    let old = priced_concept(3, "old");
    let just_out = priced_concept(4, "just-out");
    let later_today = priced_concept(5, "later-today");
    let edge_new = priced_concept(6, "edge-new");
    let edge_upcoming = priced_concept(7, "edge-upcoming");
    let far_future = priced_concept(8, "far-future");
    let dates = vec![
        (product_id(&old), at(-12.0 - 1.0 / 60.0)),
        (product_id(&just_out), at(-12.0)),
        (product_id(&later_today), at(6.0)),
        (product_id(&edge_new), at(37.0 - 1.0 / 60.0)),
        (product_id(&edge_upcoming), at(37.0)),
        (product_id(&far_future), at(10.0 * 24.0)),
    ];
    let svc = split(
        vec![old, just_out],
        vec![later_today, edge_new, edge_upcoming, far_future],
        dates,
    );
    let (new, upcoming) = split_names(&svc).await;
    assert_eq!(new, ["edge-new", "later-today", "just-out", "old"]);
    assert_eq!(
        upcoming,
        [
            "just-out",
            "later-today",
            "edge-new",
            "edge-upcoming",
            "far-future"
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn undated_games_are_never_new_and_last_in_upcoming() {
    let dated = priced_concept(9, "dated");
    let undated = priced_concept(10, "undated-product");
    let release_dates = vec![(product_id(&dated), at(3.0 * 24.0))];
    let svc = split(
        vec![],
        vec![announcement("10019999", "announcement"), undated, dated],
        release_dates,
    );
    let (new, upcoming) = split_names(&svc).await;
    assert!(new.is_empty(), "{new:?}");
    assert_eq!(upcoming, ["dated", "announcement", "undated-product"]);
}

#[tokio::test(start_paused = true)]
async fn an_undated_product_of_the_released_grid_is_in_no_list() {
    let dated = priced_concept(13, "dated-released");
    let undated = priced_concept(14, "released-detail-fails");
    let upcoming = priced_concept(15, "dated-upcoming");
    let release_dates = vec![
        (product_id(&dated), at(-24.0)),
        (product_id(&upcoming), at(5.0 * 24.0)),
    ];
    let svc = split(vec![dated, undated], vec![upcoming], release_dates);
    assert_eq!(
        split_names(&svc).await,
        (vec!["dated-released".into()], vec!["dated-upcoming".into()])
    );
    let concept_only = split(
        vec![announcement("10018888", "released-concept")],
        vec![],
        vec![],
    );
    assert_eq!(split_names(&concept_only).await, (vec![], vec![]));
}

#[tokio::test(start_paused = true)]
async fn a_product_in_both_grids_shows_once() {
    let twin = priced_concept(11, "twin");
    let dates = vec![(product_id(&twin), at(-24.0))];
    let svc = split(vec![twin.clone()], vec![twin], dates);
    assert_eq!(split_names(&svc).await.0, ["twin"]);
}

#[tokio::test(start_paused = true)]
async fn a_failed_grid_fails_both_release_lists() {
    for failing in [SonyFeature::New, SonyFeature::Upcoming] {
        let (svc, _) = service(FakeSony {
            concepts: Box::new(move |feature| {
                if feature == failing {
                    Err(unavailable())
                } else {
                    Ok(vec![priced_concept(12, "ok")])
                }
            }),
            ..FakeSony::default()
        });
        assert_eq!(svc.new_games(page(0, 60)).await, Err(unavailable()));
        assert_eq!(svc.upcoming_games(page(0, 60)).await, Err(unavailable()));
    }
}

#[tokio::test(start_paused = true)]
async fn upcoming_keeps_concept_announcements_and_enriches_only_skus() {
    let future = at(5.0 * 24.0);
    let sku = priced_concept(1, "sku-title");
    let sku_id = product_id(&sku);
    let (svc, fake, _) = service_at(
        FakeSony {
            concepts: grids(
                vec![],
                vec![
                    announcement("10010001", "concept-first"),
                    sku,
                    announcement("10010002", "concept-second"),
                ],
                vec![],
            ),
            detail: Box::new(move |_| Ok(detail_at(Some(&future)))),
            ..FakeSony::default()
        },
        SPLIT_NOW,
    );
    let result = svc.upcoming_games(page(0, 60)).await.unwrap();
    assert_eq!(
        names(&result),
        ["sku-title", "concept-first", "concept-second"]
    );
    let concept = &result.games[1];
    assert_eq!(
        (
            concept.id.as_str(),
            concept.id_kind,
            concept.price.as_str(),
            concept.date.as_str()
        ),
        ("10010001", IdKind::Concept, "", "")
    );
    assert_eq!(result.games[0].id_kind, IdKind::Product);
    assert_eq!(fake.calls().details, [sku_id]);
}

#[tokio::test(start_paused = true)]
async fn the_upcoming_window_reads_the_wall_clock() {
    let just_passed = priced_concept(1, "just-passed");
    let edge = priced_concept(2, "future-edge");
    let dates = vec![
        (product_id(&just_passed), at(-1.0)),
        (product_id(&edge), at(5.0 * 24.0)),
    ];
    let svc = split(vec![], vec![edge, just_passed], dates);
    assert_eq!(split_names(&svc).await.1, ["just-passed", "future-edge"]);
}

// ---- DISCOUNTED ---------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn discounted_keeps_full_games_and_bundles_only() {
    let classes = [
        ("FULLGAME", Some("FULL_GAME")),
        ("GAMEBUNDLE", Some("GAME_BUNDLE")),
        ("ADDON", Some("ADD_ON_PACK")),
        ("CURRENCY", Some("VIRTUAL_CURRENCY")),
        ("VEHICLE", Some("VEHICLE")),
        ("UNCLASSIFIED", None),
    ];
    let (svc, _) = service(FakeSony {
        concepts: grids(
            vec![],
            vec![],
            vec![
                priced_concept(1, "full-game"),
                priced_concept(2, "game-bundle"),
                priced_concept(3, "add-on"),
                priced_concept(4, "currency"),
                priced_concept(5, "vehicle"),
                priced_concept(6, "unclassified"),
            ],
        ),
        detail: Box::new(move |id| {
            let class = classes
                .iter()
                .find(|(marker, _)| id.contains(marker))
                .and_then(|(_, class)| *class);
            Ok(ProductDetail {
                release_date: Some(PAST_DATE.into()),
                store_display_classification: class.map(str::to_owned),
                ..ProductDetail::default()
            })
        }),
        ..FakeSony::default()
    });
    let mut kept = names(&svc.discounted_games(page(0, 60)).await.unwrap())
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    kept.sort();
    assert_eq!(kept, ["full-game", "game-bundle"]);
}

#[tokio::test(start_paused = true)]
async fn discounted_keeps_future_deals_newest_first_and_drops_empty_dates() {
    let (svc, _) = service(FakeSony {
        concepts: grids(
            vec![],
            vec![],
            vec![
                priced_concept(1, "old"),
                priced_concept(2, "future-deal"),
                priced_concept(3, "mid"),
                priced_concept(4, "no-date"),
                priced_concept(5, "bad-date"),
            ],
        ),
        detail: dates_by_marker(
            vec![
                ("OLD", Some("2023-01-01T00:00:00Z")),
                ("FUTURE", Some(FUTURE_DATE)),
                ("NODATE", None),
                ("BADDATE", Some("soon")),
            ],
            Some("2024-06-01T00:00:00Z"),
        ),
        ..FakeSony::default()
    });
    // A non-empty date that does not parse stays and sorts last.
    assert_eq!(
        names(&svc.discounted_games(page(0, 60)).await.unwrap()),
        ["future-deal", "mid", "old", "bad-date"]
    );
}

#[tokio::test(start_paused = true)]
async fn an_empty_grid_is_an_empty_list() {
    let (svc, _) = service(FakeSony {
        concepts: grids(vec![priced_concept(1, "base")], vec![], vec![]),
        ..FakeSony::default()
    });
    let found = svc.upcoming_games(page(0, 60)).await.unwrap().games;
    assert!(found.is_empty(), "{found:?}");
    let found = svc.discounted_games(page(0, 60)).await.unwrap().games;
    assert!(found.is_empty(), "{found:?}");
}

#[tokio::test(start_paused = true)]
async fn every_list_propagates_each_upstream_failure() {
    let errors = [
        UpstreamError::unavailable("down"),
        UpstreamError::QueryRotated {
            message: "rotated".into(),
            operation_name: "op".into(),
        },
        UpstreamError::RateLimited {
            message: "limited".into(),
            retry_after_seconds: None,
        },
    ];
    for error in errors {
        let failure = error.clone();
        let (svc, _) = service(FakeSony {
            concepts: Box::new(move |_| Err(failure.clone())),
            ..FakeSony::default()
        });
        assert_eq!(svc.new_games(page(0, 60)).await, Err(error.clone()));
        assert_eq!(svc.upcoming_games(page(0, 60)).await, Err(error.clone()));
        assert_eq!(svc.discounted_games(page(0, 60)).await, Err(error.clone()));
    }
}

#[tokio::test(start_paused = true)]
async fn list_games_carry_no_plus_offer_and_never_call_the_price_operation() {
    let (svc, fake) = service(FakeSony {
        concepts: Box::new(|_| Ok(vec![priced_concept(1, "alpha")])),
        price: Box::new(|_| {
            Ok(ProductPrice {
                plus_offer: Some(PlusOffer::Included),
                standard: None,
            })
        }),
        ..FakeSony::default()
    });
    let new = svc.new_games(page(0, 60)).await.unwrap();
    svc.upcoming_games(page(0, 60)).await.unwrap();
    svc.discounted_games(page(0, 60)).await.unwrap();
    assert!(!new.games.is_empty(), "the value is empty");
    assert!(new.games.iter().all(|g| g.plus_offer.is_none()));
    assert!(fake.calls().prices.is_empty(), "{:?}", fake.calls().prices);
}

// ---- Cache lifetimes ---------------------------------------------------------

fn counted(fake: &FakeSony, feature: SonyFeature) -> usize {
    fake.calls()
        .concepts
        .iter()
        .filter(|(f, _)| *f == feature)
        .count()
}

#[tokio::test(start_paused = true)]
async fn the_list_is_cached_for_30_seconds() {
    let (svc, fake) = service(FakeSony {
        concepts: grids(vec![priced_concept(1, "alpha")], vec![], vec![]),
        ..FakeSony::default()
    });
    svc.new_games(page(0, 60)).await.unwrap();
    svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(counted(&fake, SonyFeature::New), 1);
    tokio::time::advance(Duration::from_millis(29_999)).await;
    svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(counted(&fake, SonyFeature::New), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(counted(&fake, SonyFeature::New), 2);
}

#[tokio::test(start_paused = true)]
async fn a_failed_list_is_pinned_for_30_seconds() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&attempts);
    let (svc, _) = service(FakeSony {
        concepts: Box::new(move |feature| {
            if feature != SonyFeature::New {
                return Ok(vec![]);
            }
            if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                Err(unavailable())
            } else {
                Ok(vec![priced_concept(1, "alpha")])
            }
        }),
        ..FakeSony::default()
    });
    assert!(svc.new_games(page(0, 60)).await.is_err());
    tokio::time::advance(Duration::from_millis(29_999)).await;
    assert!(svc.new_games(page(0, 60)).await.is_err());
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    assert_eq!(svc.new_games(page(0, 60)).await.unwrap().games.len(), 1);
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn a_product_detail_is_cached_for_6_hours() {
    let (svc, fake) = service(FakeSony {
        concepts: grids(vec![priced_concept(1, "alpha")], vec![], vec![]),
        ..FakeSony::default()
    });
    svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(fake.calls().details.len(), 1);
    tokio::time::advance(Duration::from_secs(30)).await;
    svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(fake.calls().details.len(), 1);
    tokio::time::advance(Duration::from_hours(6)).await;
    svc.new_games(page(0, 60)).await.unwrap();
    assert_eq!(fake.calls().details.len(), 2);
}

// ---- MONTHLY (gamesServiceMonthly.test.ts) -----------------------------------

pub(super) fn monthly_entry(id: &str, date: &str) -> PlusMonthlyEntry {
    PlusMonthlyEntry {
        product_id: id.parse().unwrap(),
        name: id.into(),
        image_url: String::new(),
        release_date: date.into(),
        genres: vec![],
    }
}

pub(super) const OLD_ID: &str = "UP0001-PPSA00001_00-OLD0000000000000";
const NEW_ID: &str = "UP0001-PPSA00002_00-NEW0000000000000";

#[tokio::test(start_paused = true)]
async fn monthly_orders_by_release_date_and_pages_without_enrichment() {
    let (svc, fake) = service(FakeSony {
        monthly: Box::new(|()| {
            Ok(vec![
                monthly_entry(OLD_ID, "2024-01-01T00:00:00Z"),
                monthly_entry(NEW_ID, "2026-01-01T00:00:00Z"),
            ])
        }),
        ..FakeSony::default()
    });
    let result = svc.monthly_games(page(0, 1)).await.unwrap();
    assert_eq!(result.games[0].id, NEW_ID);
    assert_eq!((result.total_count, result.next_offset), (2, Some(1)));
    assert_eq!(result.games[0].date, "2026-01-01T00:00:00.000Z");
    let calls = fake.calls();
    assert!(calls.prices.is_empty() && calls.concepts.is_empty() && calls.details.is_empty());
}

#[tokio::test(start_paused = true)]
async fn monthly_is_cached_for_one_hour() {
    let (svc, fake) = service(FakeSony {
        monthly: Box::new(|()| Ok(vec![monthly_entry(OLD_ID, "2024-01-01T00:00:00Z")])),
        ..FakeSony::default()
    });
    svc.monthly_games(page(0, 60)).await.unwrap();
    svc.monthly_games(page(0, 60)).await.unwrap();
    assert_eq!(fake.calls().monthly, 1);
    tokio::time::advance(Duration::from_millis(3_599_999)).await;
    svc.monthly_games(page(0, 60)).await.unwrap();
    assert_eq!(fake.calls().monthly, 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    svc.monthly_games(page(0, 60)).await.unwrap();
    assert_eq!(fake.calls().monthly, 2);
}

#[tokio::test(start_paused = true)]
async fn a_monthly_failure_is_cached_for_30_seconds() {
    let failing = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let flag = Arc::clone(&failing);
    let (svc, fake) = service(FakeSony {
        monthly: Box::new(move |()| {
            if flag.load(Ordering::SeqCst) {
                Err(unavailable())
            } else {
                Ok(vec![monthly_entry(OLD_ID, "2024-01-01T00:00:00Z")])
            }
        }),
        ..FakeSony::default()
    });
    assert_eq!(svc.monthly_games(page(0, 60)).await, Err(unavailable()));
    failing.store(false, Ordering::SeqCst);
    tokio::time::advance(Duration::from_millis(29_999)).await;
    assert!(svc.monthly_games(page(0, 60)).await.is_err());
    assert_eq!(fake.calls().monthly, 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    assert_eq!(svc.monthly_games(page(0, 60)).await.unwrap().games.len(), 1);
    assert_eq!(fake.calls().monthly, 2);
}
