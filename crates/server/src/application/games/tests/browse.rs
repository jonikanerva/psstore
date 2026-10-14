//! BROWSE and the genre list (port of `gamesServiceBrowse.test.ts`).

use super::*;
use crate::domain::browse::{BrowseOrder, GenreKey};

fn ps5(n: usize) -> String {
    format!("EP0001-PPSA{n:05}_00-BROWSE{n:010}")
}

fn ps4(n: usize) -> String {
    format!("EP0001-CUSA{n:05}_00-BROWSE{n:010}")
}

fn concept(n: usize, ids: &[String]) -> Concept {
    Concept {
        id: Some(n.to_string()),
        name: Some(format!("Game {n}")),
        price: Some(ConceptPrice {
            base_price: Some("€19,99".into()),
            discounted_price: Some("€19,99".into()),
            ..ConceptPrice::default()
        }),
        products: Some(
            ids.iter()
                .map(|id| ConceptProductRef {
                    id: Some(id.clone()),
                    ..ConceptProductRef::default()
                })
                .collect(),
        ),
        ..Concept::default()
    }
}

fn game_detail() -> ProductDetail {
    ProductDetail {
        name: Some("Detail name".into()),
        release_date: Some("2024-01-01T00:00:00Z".into()),
        genres: vec!["Shooter".into()],
        store_display_classification: Some("FULL_GAME".into()),
        platforms: vec!["PS5".into()],
        ..ProductDetail::default()
    }
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "the helper builds the successful answer of the fake Sony client"
)]
fn browse_page(concepts: Vec<Concept>, is_last: bool) -> Result<BrowsePage, UpstreamError> {
    Ok(BrowsePage { concepts, is_last })
}

fn browsing(
    pages: Respond<BrowseRequest, BrowsePage>,
    detail: Respond<String, ProductDetail>,
) -> FakeSony {
    FakeSony {
        browse: pages,
        detail,
        genres: Box::new(|()| {
            Ok(vec![Genre {
                key: "ACTION".into(),
                name: "Action".into(),
            }])
        }),
        ..FakeSony::default()
    }
}

fn genre(key: &str) -> GenreKey {
    GenreKey::parse(key).unwrap()
}

fn ids(result: &PageResult) -> Vec<String> {
    result
        .games
        .iter()
        .map(|g| g.id.as_str().to_owned())
        .collect()
}

#[tokio::test(start_paused = true)]
async fn passes_the_window_to_sony_and_keeps_sony_order() {
    let (svc, fake) = service(browsing(
        Box::new(|_| browse_page(vec![concept(2, &[ps5(2)]), concept(1, &[ps5(1)])], false)),
        Box::new(|_| Ok(game_detail())),
    ));
    let result = svc
        .browse_games(
            genre("FIRST_PERSON_SHOOTER"),
            BrowseOrder::BestSelling,
            page(60, 60),
        )
        .await
        .unwrap();
    assert_eq!(
        fake.calls().browse,
        [BrowseRequest {
            genre: genre("FIRST_PERSON_SHOOTER"),
            order: BrowseOrder::BestSelling,
            offset: 60,
            size: 60
        }]
    );
    assert_eq!(ids(&result), [ps5(2), ps5(1)]);
    assert_eq!(result.games[0].date, "2024-01-01T00:00:00.000Z");
    assert_eq!(result.games[0].genres, ["Shooter"]);
    assert_eq!((result.next_offset, result.total_count), (Some(120), 2));
}

#[tokio::test(start_paused = true)]
async fn stops_paging_at_the_last_sony_page() {
    let (svc, _) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps5(1)])], true)),
        Box::new(|_| Ok(game_detail())),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::Newest, page(0, 60))
        .await
        .unwrap();
    assert_eq!(result.next_offset, None);
}

#[tokio::test(start_paused = true)]
async fn prefers_the_ps5_product_and_falls_back_to_the_next_candidate() {
    let (svc, fake) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps4(1), ps5(1)])], true)),
        Box::new(|_| Ok(game_detail())),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60))
        .await
        .unwrap();
    assert_eq!(ids(&result), [ps5(1)]);
    assert_eq!(fake.calls().details, [ps5(1)]);

    let (svc, fake) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps5(1), ps5(2), ps4(3)])], true)),
        Box::new(|id| {
            Ok(if id == ps5(1) {
                ProductDetail {
                    store_display_classification: Some("DEMO".into()),
                    ..game_detail()
                }
            } else if id == ps5(2) {
                ProductDetail {
                    store_display_classification: Some("PREMIUM_EDITION".into()),
                    ..game_detail()
                }
            } else {
                ProductDetail {
                    platforms: vec!["PS4".into(), "PS5".into()],
                    ..game_detail()
                }
            })
        }),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60))
        .await
        .unwrap();
    assert_eq!(ids(&result), [ps4(3)]);
    assert_eq!(fake.calls().details, [ps5(1), ps5(2), ps4(3)]);
}

#[tokio::test(start_paused = true)]
async fn drops_concepts_without_a_ps5_game_product() {
    let (svc, _) = service(browsing(
        Box::new(|_| {
            browse_page(
                vec![
                    Concept {
                        id: Some("10020880".into()),
                        name: Some("Concept only".into()),
                        products: Some(vec![]),
                        ..Concept::default()
                    },
                    concept(2, &[ps4(2)]),
                    concept(3, &[ps5(3)]),
                ],
                true,
            )
        }),
        Box::new(|id| {
            Ok(if id == ps4(2) {
                ProductDetail {
                    platforms: vec!["PS4".into()],
                    ..game_detail()
                }
            } else {
                game_detail()
            })
        }),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60))
        .await
        .unwrap();
    assert_eq!(ids(&result), [ps5(3)]);
}

#[tokio::test(start_paused = true)]
async fn a_failed_lookup_drops_its_concept_and_all_failed_fails_the_page() {
    let (svc, _) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps5(1)]), concept(2, &[ps5(2)])], true)),
        Box::new(|id| {
            if id == ps5(1) {
                Err(unavailable())
            } else {
                Ok(game_detail())
            }
        }),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60))
        .await
        .unwrap();
    assert_eq!(ids(&result), [ps5(2)]);

    let (svc, _) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps5(1)]), concept(2, &[ps5(2)])], true)),
        Box::new(|_| Err(unavailable())),
    ));
    assert_eq!(
        svc.browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60))
            .await,
        Err(UpstreamError::unavailable(
            "Sony product lookups failed for a browse page"
        ))
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_grid_request_propagates() {
    let (svc, _) = service(browsing(
        Box::new(|_| Err(unavailable())),
        Box::new(|_| Ok(game_detail())),
    ));
    assert_eq!(
        svc.browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60))
            .await,
        Err(unavailable())
    );
}

#[tokio::test(start_paused = true)]
async fn reads_the_next_raw_page_when_a_page_narrows_to_zero() {
    let (svc, fake) = service(browsing(
        Box::new(|request| {
            if request.offset == 0 {
                browse_page(vec![concept(1, &[ps4(1)])], false)
            } else {
                browse_page(vec![concept(2, &[ps5(2)])], true)
            }
        }),
        Box::new(|id| {
            Ok(if id == ps4(1) {
                ProductDetail {
                    platforms: vec!["PS4".into()],
                    ..game_detail()
                }
            } else {
                game_detail()
            })
        }),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 1))
        .await
        .unwrap();
    let offsets: Vec<_> = fake.calls().browse.iter().map(|r| r.offset).collect();
    assert_eq!(offsets, [0, 1]);
    assert_eq!((ids(&result), result.next_offset), (vec![ps5(2)], None));
}

#[tokio::test(start_paused = true)]
async fn reads_at_most_three_raw_pages() {
    let (svc, fake) = service(browsing(
        Box::new(|request| browse_page(vec![concept(request.offset, &[ps4(1)])], false)),
        Box::new(|_| {
            Ok(ProductDetail {
                platforms: vec!["PS4".into()],
                ..game_detail()
            })
        }),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 1))
        .await
        .unwrap();
    assert_eq!(fake.calls().browse.len(), 3);
    assert_eq!((result.games.len(), result.next_offset), (0, Some(3)));
}

#[tokio::test(start_paused = true)]
async fn equal_requests_share_one_cached_page() {
    let (svc, fake) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps5(1)])], true)),
        Box::new(|_| Ok(game_detail())),
    ));
    let (a, b, c) = tokio::join!(
        svc.browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60)),
        svc.browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60)),
        svc.browse_games(genre("ACTION"), BrowseOrder::NameDesc, page(0, 60)),
    );
    assert!(a.is_ok() && b.is_ok() && c.is_ok());
    let orders: Vec<_> = fake.calls().browse.iter().map(|r| r.order).collect();
    assert_eq!(orders, [BrowseOrder::NameAsc, BrowseOrder::NameDesc]);
}

#[tokio::test(start_paused = true)]
async fn a_browse_page_is_cached_for_30_seconds() {
    let (svc, fake) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps5(1)])], true)),
        Box::new(|_| Ok(game_detail())),
    ));
    let browse = || svc.browse_games(genre("ACTION"), BrowseOrder::Newest, page(0, 60));
    browse().await.unwrap();
    tokio::time::advance(Duration::from_millis(29_999)).await;
    browse().await.unwrap();
    assert_eq!(fake.calls().browse.len(), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    browse().await.unwrap();
    assert_eq!(fake.calls().browse.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn the_genre_list_is_cached() {
    let (svc, fake) = service(browsing(
        Box::new(|_| browse_page(vec![], true)),
        Box::new(|_| Ok(game_detail())),
    ));
    let (a, b) = tokio::join!(svc.genres(), svc.genres());
    let expected = GenreList {
        genres: vec![Genre {
            key: "ACTION".into(),
            name: "Action".into(),
        }],
    };
    assert_eq!((a, b), (Ok(expected.clone()), Ok(expected)));
    assert_eq!(fake.calls().genres, 1);
    tokio::time::advance(Duration::from_hours(1)).await;
    svc.genres().await.unwrap();
    assert_eq!(fake.calls().genres, 2);
}

#[tokio::test(start_paused = true)]
async fn a_browse_card_opens_the_chosen_product() {
    let (svc, _) = service(browsing(
        Box::new(|_| browse_page(vec![concept(1, &[ps4(1), ps5(1)])], true)),
        Box::new(|_| Ok(game_detail())),
    ));
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::NameAsc, page(0, 60))
        .await
        .unwrap();
    let game = svc.game_by_id(result.games[0].id.clone()).await.unwrap();
    assert_eq!(game.id, ps5(1));
}

#[tokio::test(start_paused = true)]
async fn a_browse_card_reads_the_pre_order_flag_from_the_clock() {
    let (svc, _, clock) = service_at(
        browsing(
            Box::new(|_| browse_page(vec![concept(1, &[ps5(1)])], true)),
            Box::new(|_| Ok(game_detail())),
        ),
        "2023-12-31T23:59:59Z",
    );
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::Newest, page(0, 60))
        .await
        .unwrap();
    assert!(result.games[0].pre_order);
    clock.set("2024-01-01T00:00:00Z".parse().unwrap());
    tokio::time::advance(Duration::from_secs(30)).await;
    let result = svc
        .browse_games(genre("ACTION"), BrowseOrder::Newest, page(0, 60))
        .await
        .unwrap();
    assert!(!result.games[0].pre_order);
}
