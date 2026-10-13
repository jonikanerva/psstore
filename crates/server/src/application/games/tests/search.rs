//! Search (port of `gamesServiceSearch.test.ts`).

use super::*;
use crate::domain::mapper::product_to_concept;

fn search_sku(n: usize) -> String {
    format!("EP0001-PPSA{n:05}_00-SEARCH{n:010}")
}

fn known(n: usize) -> SearchCandidate {
    SearchCandidate::Known(product_to_concept(
        &crate::domain::catalog::CategoryGridProduct {
            id: Some(search_sku(n)),
            name: Some(format!("Game {n}")),
            media: Some(vec![]),
            price: Some(ConceptPrice {
                base_price: Some("€9,99".into()),
                discounted_price: Some("€9,99".into()),
                ..ConceptPrice::default()
            }),
            ..Default::default()
        },
    ))
}

fn unverified(n: usize) -> SearchCandidate {
    SearchCandidate::Unverified {
        product_id: search_sku(n),
        concept: Concept {
            id: Some(n.to_string()),
            name: Some(format!("Concept {n}")),
            products: Some(vec![ConceptProductRef {
                id: Some(search_sku(n)),
                ..ConceptProductRef::default()
            }]),
            ..Concept::default()
        },
    }
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "the helper builds the successful answer of the fake Sony client"
)]
fn search_page(
    candidates: Vec<SearchCandidate>,
    is_last: bool,
) -> Result<SearchPage, UpstreamError> {
    Ok(SearchPage {
        raw_count: candidates.len(),
        candidates,
        is_last,
    })
}

/// `total` known games in Sony-sized windows.
fn windowed(total: usize) -> Respond<(String, usize, usize), SearchPage> {
    Box::new(move |(_, offset, size)| {
        let end = total.min(offset + size);
        search_page((offset..end).map(known).collect(), offset + size >= total)
    })
}

fn ps5_detail() -> ProductDetail {
    ProductDetail {
        release_date: Some("2024-01-01T00:00:00Z".into()),
        genres: vec!["Action".into()],
        store_display_classification: Some("FULL_GAME".into()),
        platforms: vec!["PS5".into()],
        ..ProductDetail::default()
    }
}

fn searching(search: Respond<(String, usize, usize), SearchPage>) -> FakeSony {
    FakeSony {
        search,
        detail: Box::new(|_| Ok(ps5_detail())),
        ..FakeSony::default()
    }
}

#[tokio::test(start_paused = true)]
async fn keeps_sony_order_and_enriches_the_date_and_genres() {
    let (svc, _) = service(searching(Box::new(|_| {
        search_page(vec![known(3), known(1), known(2)], true)
    })));
    let result = svc.search_games("game".into(), page(0, 50)).await.unwrap();
    assert_eq!(names(&result), ["Game 3", "Game 1", "Game 2"]);
    assert!(
        result
            .games
            .iter()
            .all(|g| g.date == "2024-01-01T00:00:00Z")
    );
    assert_eq!(result.games[0].genres, ["Action"]);
    assert_eq!(result.next_offset, None);
}

#[tokio::test(start_paused = true)]
async fn requests_the_term_offset_and_size() {
    let (svc, fake) = service(searching(windowed(10)));
    svc.search_games("elden".into(), page(20, 7)).await.unwrap();
    assert_eq!(fake.calls().searches, [("elden".to_owned(), 20, 7)]);
}

#[tokio::test(start_paused = true)]
async fn next_offset_follows_the_raw_page() {
    let (svc, _) = service(searching(Box::new(|_| search_page(vec![known(1)], false))));
    let result = svc.search_games("x".into(), page(100, 50)).await.unwrap();
    assert_eq!((result.games.len(), result.next_offset), (1, Some(150)));

    let (svc, _) = service(searching(windowed(50)));
    let result = svc.search_games("x".into(), page(0, 50)).await.unwrap();
    assert_eq!((result.games.len(), result.next_offset), (50, None));

    let (svc, _) = service(searching(windowed(51)));
    let first = svc.search_games("x".into(), page(0, 50)).await.unwrap();
    let second = svc.search_games("x".into(), page(50, 50)).await.unwrap();
    assert_eq!((first.games.len(), first.next_offset), (50, Some(50)));
    assert_eq!((second.games.len(), second.next_offset), (1, None));
}

#[tokio::test(start_paused = true)]
async fn an_empty_last_page_has_no_next_offset() {
    let (svc, fake) = service(FakeSony::default());
    let result = svc
        .search_games("xyzzyqq".into(), page(0, 50))
        .await
        .unwrap();
    assert_eq!(
        result,
        PageResult {
            games: vec![],
            total_count: 0,
            next_offset: None
        }
    );
    assert_eq!(fake.calls().searches.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn reads_at_most_three_raw_pages_that_narrow_to_zero() {
    let (svc, fake) = service(searching(Box::new(|_| search_page(vec![], false))));
    let result = svc.search_games("the".into(), page(0, 50)).await.unwrap();
    let offsets: Vec<_> = fake.calls().searches.iter().map(|s| s.1).collect();
    assert_eq!(offsets, [0, 50, 100]);
    assert_eq!((result.games.len(), result.next_offset), (0, Some(150)));
}

#[tokio::test(start_paused = true)]
async fn stops_reading_at_games_or_at_the_last_page() {
    let (svc, fake) = service(searching(Box::new(|(_, offset, _)| {
        if offset == 0 {
            search_page(vec![], false)
        } else {
            search_page(vec![known(7)], false)
        }
    })));
    let result = svc.search_games("the".into(), page(0, 50)).await.unwrap();
    assert_eq!(fake.calls().searches.len(), 2);
    assert_eq!(
        (names(&result), result.next_offset),
        (vec!["Game 7"], Some(100))
    );

    let (svc, fake) = service(searching(Box::new(|(_, offset, _)| {
        search_page(vec![], offset != 0)
    })));
    let result = svc.search_games("the".into(), page(0, 50)).await.unwrap();
    assert_eq!(fake.calls().searches.len(), 2);
    assert_eq!(result.next_offset, None);
}

#[tokio::test(start_paused = true)]
async fn an_unverified_concept_needs_a_ps5_game_detail() {
    let (svc, _) = service(FakeSony {
        search: Box::new(|_| search_page(vec![unverified(1), unverified(2), unverified(3)], true)),
        detail: Box::new(|id| {
            Ok(if id == search_sku(1) {
                ps5_detail()
            } else if id == search_sku(2) {
                ProductDetail {
                    platforms: vec!["PS4".into()],
                    ..ps5_detail()
                }
            } else {
                ProductDetail::default()
            })
        }),
        ..FakeSony::default()
    });
    let result = svc.search_games("x".into(), page(0, 50)).await.unwrap();
    let ids: Vec<_> = result.games.iter().map(|g| g.id.clone()).collect();
    assert_eq!(ids, [search_sku(1)]);

    let (svc, _) = service(FakeSony {
        search: Box::new(|_| search_page(vec![unverified(1)], true)),
        detail: Box::new(|_| {
            Ok(ProductDetail {
                store_display_classification: Some("LEVEL".into()),
                ..ps5_detail()
            })
        }),
        ..FakeSony::default()
    });
    let found = svc
        .search_games("x".into(), page(0, 50))
        .await
        .unwrap()
        .games;
    assert!(found.is_empty(), "{found:?}");
}

#[tokio::test(start_paused = true)]
async fn search_is_never_cached() {
    let (svc, fake) = service(searching(windowed(3)));
    svc.search_games("same".into(), page(0, 50)).await.unwrap();
    svc.search_games("same".into(), page(0, 50)).await.unwrap();
    assert_eq!(fake.calls().searches.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn search_propagates_typed_failures() {
    for error in [
        unavailable(),
        UpstreamError::RateLimited {
            message: "slow".into(),
            retry_after_seconds: None,
        },
    ] {
        let failure = error.clone();
        let (svc, _) = service(searching(Box::new(move |_| Err(failure.clone()))));
        assert_eq!(svc.search_games("x".into(), page(0, 50)).await, Err(error));
    }
}

#[tokio::test(start_paused = true)]
async fn bounds_the_concurrent_detail_lookups_of_one_page() {
    let (svc, fake) = service(FakeSony {
        search: Box::new(|_| search_page((0..40).map(unverified).collect(), true)),
        detail: Box::new(|_| Ok(ps5_detail())),
        detail_delay: Duration::from_millis(2),
        ..FakeSony::default()
    });
    let result = svc.search_games("x".into(), page(0, 50)).await.unwrap();
    assert_eq!(result.games.len(), 40);
    let peak = fake.peak.load(Ordering::SeqCst);
    assert!(peak <= 10, "{peak}");
    assert!(peak > 1, "{peak}");
}
