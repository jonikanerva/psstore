//! The game page lookup: the lists, the PS Plus offer, and the product-id
//! fallback.

use super::lists::{OLD_ID, monthly_entry};
use super::*;
use crate::domain::catalog::StandardPrice;
use crate::observability::testing::CapturedLogs;

const ID: &str = "EP0002-PPSA02410_00-DESTINYTHEGAME02";

fn destiny() -> ProductDetail {
    let image = |role: &str, url: &str| Media {
        url: Some(url.into()),
        role: Some(role.into()),
        kind: Some("IMAGE".into()),
    };
    ProductDetail {
        name: Some("Destiny 2".into()),
        media: vec![
            image("GAMEHUB_COVER_ART", "https://img/cover"),
            image("SCREENSHOT", "https://img/shot1"),
            image("SCREENSHOT", "https://img/shot2"),
            Media {
                url: Some("https://vid/preview.mp4".into()),
                role: Some("PREVIEW".into()),
                kind: Some("VIDEO".into()),
            },
        ],
        release_date: Some("2019-10-01T00:00:00Z".into()),
        genres: vec!["Action".into(), "Shooter".into()],
        description: "Long description".into(),
        publisher_name: Some("Bungie".into()),
        store_display_classification: Some("FULL_GAME".into()),
        platforms: vec!["PS4".into(), "PS5".into()],
    }
}

fn standard(base: &str, discounted: &str, text: &str) -> ProductPrice {
    ProductPrice {
        plus_offer: None,
        standard: Some(StandardPrice {
            base_price: base.into(),
            discounted_price: discounted.into(),
            discount_text: text.into(),
        }),
    }
}

fn fallback(detail: ProductDetail, price: ProductPrice) -> FakeSony {
    FakeSony {
        detail: Box::new(move |_| Ok(detail.clone())),
        price: Box::new(move |_| Ok(price.clone())),
        ..FakeSony::default()
    }
}

// ---- Product-id fallback (gamesServiceProductFallback.test.ts) -------------

#[tokio::test(start_paused = true)]
async fn the_fallback_builds_a_game_from_the_detail_and_the_price() {
    let mut price = standard("€39,99", "€39,99", "");
    price.plus_offer = Some(PlusOffer::Price {
        price: "€34,99".into(),
    });
    let (svc, _) = service(fallback(destiny(), price));
    let game = svc.game_by_id(ID.into()).await.unwrap();
    assert_eq!(game.id, ID);
    assert_eq!(game.name, "Destiny 2");
    assert_eq!(game.date, "2019-10-01T00:00:00.000Z");
    assert_eq!(game.url, "https://img/cover");
    assert_eq!(game.price, "€39,99");
    assert_eq!(
        (game.original_price.as_str(), game.discount_text.as_str()),
        ("", "")
    );
    assert_eq!(game.screenshots, ["https://img/shot1", "https://img/shot2"]);
    assert_eq!(game.videos, ["https://vid/preview.mp4"]);
    assert_eq!(game.genres, ["Action", "Shooter"]);
    assert_eq!(game.studio, "Bungie");
    assert_eq!(game.description, "Long description");
    assert_eq!(
        game.plus_offer,
        Some(PlusOffer::Price {
            price: "€34,99".into()
        })
    );
    assert_eq!(game.plus_upsell_text, None);
    assert_eq!(game.id_kind, IdKind::Product);
    assert!(!game.pre_order);
}

#[tokio::test(start_paused = true)]
async fn the_fallback_keeps_sony_price_strings() {
    let (svc, _) = service(fallback(destiny(), standard("€39,99", "€19,99", "-50%")));
    let game = svc.game_by_id(ID.into()).await.unwrap();
    assert_eq!(
        (
            game.price.as_str(),
            game.original_price.as_str(),
            game.discount_text.as_str()
        ),
        ("€19,99", "€39,99", "-50%")
    );
    let (svc, _) = service(fallback(destiny(), standard("Free", "Free", "")));
    let game = svc.game_by_id(ID.into()).await.unwrap();
    assert_eq!(
        (game.price.as_str(), game.original_price.as_str()),
        ("Free", "")
    );
    let (svc, _) = service(fallback(destiny(), ProductPrice::default()));
    let game = svc.game_by_id(ID.into()).await.unwrap();
    assert_eq!((game.price.as_str(), game.name.as_str()), ("", "Destiny 2"));
}

#[tokio::test(start_paused = true)]
async fn the_fallback_answers_not_found_for_a_game_out_of_scope() {
    let not_found = Err(GameLookupError::NotFound { id: ID.into() });
    let cases = [
        ProductDetail {
            platforms: vec!["PS4".into()],
            ..destiny()
        },
        ProductDetail {
            store_display_classification: Some("PREMIUM_EDITION".into()),
            ..destiny()
        },
        ProductDetail::default(),
    ];
    for detail in cases {
        let (svc, _) = service(fallback(detail, ProductPrice::default()));
        assert_eq!(svc.game_by_id(ID.into()).await, not_found);
    }
}

#[tokio::test(start_paused = true)]
async fn a_ps5_product_without_a_name_is_unavailable() {
    let (svc, _) = service(fallback(
        ProductDetail {
            name: None,
            ..destiny()
        },
        ProductPrice::default(),
    ));
    assert_eq!(
        svc.game_by_id(ID.into()).await,
        Err(GameLookupError::Upstream(UpstreamError::unavailable(
            "Sony returned a PS5 product without a name"
        )))
    );
}

#[tokio::test(start_paused = true)]
async fn an_invalid_id_is_not_found_without_a_product_call() {
    let (svc, fake) = service(FakeSony::default());
    assert_eq!(
        svc.game_by_id("not-a-product-id".into()).await,
        Err(GameLookupError::NotFound {
            id: "not-a-product-id".into()
        })
    );
    let calls = fake.calls();
    assert!(calls.details.is_empty() && calls.prices.is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_failed_detail_lookup_propagates_instead_of_not_found() {
    let errors = [
        UpstreamError::unavailable("down"),
        UpstreamError::QueryRotated {
            message: "rotated".into(),
            operation_name: "op".into(),
        },
        UpstreamError::RateLimited {
            message: "slow".into(),
            retry_after_seconds: None,
        },
    ];
    for error in errors {
        let failure = error.clone();
        let (svc, _) = service(FakeSony {
            detail: Box::new(move |_| Err(failure.clone())),
            ..FakeSony::default()
        });
        assert_eq!(
            svc.game_by_id(ID.into()).await,
            Err(GameLookupError::Upstream(error))
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_failed_price_lookup_leaves_the_game_without_a_price() {
    let (svc, _) = service(FakeSony {
        detail: Box::new(|_| Ok(destiny())),
        price: Box::new(|_| Err(unavailable())),
        ..FakeSony::default()
    });
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    let game = svc.game_by_id(ID.into()).await.unwrap();
    assert_eq!(
        (
            game.name.as_str(),
            game.price.as_str(),
            game.plus_offer.clone()
        ),
        ("Destiny 2", "", None)
    );
    let line = logs
        .lines()
        .into_iter()
        .find(|line| line["message"] == "product price lookup failed")
        .unwrap();
    assert_eq!(line["reason"], "UpstreamUnavailable");
}

#[tokio::test(start_paused = true)]
async fn a_listed_id_does_not_use_the_fallback() {
    let listed = Concept {
        id: Some("1".into()),
        name: Some("Listed".into()),
        media: Some(vec![]),
        price: Some(ConceptPrice {
            base_price: Some("€9,99".into()),
            discounted_price: Some("€9,99".into()),
            ..ConceptPrice::default()
        }),
        products: Some(vec![ConceptProductRef {
            id: Some("EP0001-PPSA00001_00-LISTED0000000000".into()),
            ..ConceptProductRef::default()
        }]),
    };
    let (svc, fake) = service(FakeSony {
        concepts: Box::new(move |feature| {
            Ok(if feature == SonyFeature::New {
                vec![listed.clone()]
            } else {
                vec![]
            })
        }),
        detail: Box::new(|_| Ok(destiny())),
        ..FakeSony::default()
    });
    let game = svc
        .game_by_id("EP0001-PPSA00001_00-LISTED0000000000".into())
        .await
        .unwrap();
    assert_eq!(game.name, "Listed");
    assert_eq!(fake.calls().details.len(), 1);
    // The detail enrichment keeps Sony's date string verbatim.
    assert_eq!(game.date, "2019-10-01T00:00:00Z");
    assert_eq!(game.studio, "Bungie");
    assert_eq!(game.description, "Long description");
}

fn counting_detail(
    attempts: &Arc<AtomicUsize>,
    outcome: fn(usize) -> Result<ProductDetail, UpstreamError>,
) -> FakeSony {
    let seen = Arc::clone(attempts);
    FakeSony {
        detail: Box::new(move |_| outcome(seen.fetch_add(1, Ordering::SeqCst))),
        ..FakeSony::default()
    }
}

#[tokio::test(start_paused = true)]
async fn the_fallback_retries_a_failed_detail_after_30_seconds() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let (svc, _) = service(counting_detail(&attempts, |n| {
        if n == 0 {
            Err(UpstreamError::unavailable("down"))
        } else {
            Ok(destiny())
        }
    }));
    assert!(svc.game_by_id(ID.into()).await.is_err());
    tokio::time::advance(Duration::from_millis(29_999)).await;
    assert!(svc.game_by_id(ID.into()).await.is_err());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(svc.game_by_id(ID.into()).await.is_ok());
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn the_fallback_caches_a_miss_for_5_minutes_and_a_hit_for_6_hours() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let (svc, _) = service(counting_detail(&attempts, |_| Ok(ProductDetail::default())));
    let _ = svc.game_by_id(ID.into()).await;
    tokio::time::advance(Duration::from_millis(299_999)).await;
    let _ = svc.game_by_id(ID.into()).await;
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    let _ = svc.game_by_id(ID.into()).await;
    assert_eq!(attempts.load(Ordering::SeqCst), 2);

    let attempts = Arc::new(AtomicUsize::new(0));
    let (svc, _) = service(counting_detail(&attempts, |_| Ok(destiny())));
    svc.game_by_id(ID.into()).await.unwrap();
    tokio::time::advance(Duration::from_millis(6 * 60 * 60 * 1000 - 1)).await;
    svc.game_by_id(ID.into()).await.unwrap();
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    svc.game_by_id(ID.into()).await.unwrap();
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
}

// ---- Lists on the game page (gamesService.test.ts) -------------------------

#[tokio::test(start_paused = true)]
async fn an_upcoming_only_game_opens_from_its_grid() {
    let upcoming = priced_concept(1, "upcoming-only");
    let id = product_id(&upcoming);
    let (svc, _) = service(FakeSony {
        concepts: Box::new(move |feature| {
            Ok(match feature {
                SonyFeature::New => vec![priced_concept(2, "base-game")],
                SonyFeature::Upcoming => vec![upcoming.clone()],
                SonyFeature::Discounted => vec![],
            })
        }),
        detail: Box::new(|_| Ok(detail_at(Some(FUTURE_DATE)))),
        ..FakeSony::default()
    });
    let game = svc.game_by_id(id.clone()).await.unwrap();
    assert_eq!(
        (game.id.as_str(), game.name.as_str()),
        (id.as_str(), "upcoming-only")
    );
}

#[tokio::test(start_paused = true)]
async fn a_bare_concept_id_is_not_found_and_never_enriched() {
    let (svc, fake) = service(FakeSony {
        concepts: Box::new(|feature| {
            Ok(if feature == SonyFeature::Upcoming {
                vec![announcement("10018729", "concept-a")]
            } else {
                vec![]
            })
        }),
        ..FakeSony::default()
    });
    assert_eq!(
        svc.game_by_id("10018729".into()).await,
        Err(GameLookupError::NotFound {
            id: "10018729".into()
        })
    );
    assert!(fake.calls().details.is_empty());
}

#[tokio::test(start_paused = true)]
async fn the_game_page_reads_long_description_genres_and_publisher() {
    let (svc, _) = service(FakeSony {
        concepts: Box::new(|feature| {
            Ok(if feature == SonyFeature::New {
                vec![priced_concept(1, "detailed")]
            } else {
                vec![]
            })
        }),
        detail: Box::new(|_| {
            Ok(ProductDetail {
                release_date: Some(PAST_DATE.into()),
                genres: vec!["Toiminta".into(), "Roolipelit".into()],
                description: "<p>The long game info body.</p>".into(),
                publisher_name: Some("STUDIO OY".into()),
                ..ProductDetail::default()
            })
        }),
        ..FakeSony::default()
    });
    let id = svc.new_games(page(0, 60)).await.unwrap().games[0]
        .id
        .clone();
    let game = svc.game_by_id(id).await.unwrap();
    assert_eq!(game.description, "<p>The long game info body.</p>");
    assert_eq!(game.genres, ["Toiminta", "Roolipelit"]);
    assert_eq!(game.studio, "STUDIO OY");
}

#[tokio::test(start_paused = true)]
async fn a_failed_detail_degrades_the_listed_game_page_to_concept_values() {
    let (svc, _) = service(FakeSony {
        concepts: Box::new(|feature| {
            Ok(if feature == SonyFeature::New {
                vec![priced_concept(1, "degraded")]
            } else {
                vec![]
            })
        }),
        detail: Box::new(|_| Err(unavailable())),
        ..FakeSony::default()
    });
    let game = svc.game_by_id(sku(1, "degraded")).await.unwrap();
    assert_eq!(game.description, "");
    assert!(game.genres.is_empty());
    assert_eq!(game.date, "");
}

#[tokio::test(start_paused = true)]
async fn a_grid_outage_is_never_not_found() {
    let (svc, _) = service(FakeSony {
        concepts: Box::new(|feature| {
            if feature == SonyFeature::New {
                Ok(vec![])
            } else {
                Err(unavailable())
            }
        }),
        ..FakeSony::default()
    });
    assert_eq!(
        svc.game_by_id("EP0001-PPSA09999_00-UPCOMINGONLY00000".into())
            .await,
        Err(GameLookupError::Upstream(unavailable()))
    );
}

// ---- PS Plus offer (gamesServicePlusOffer.test.ts) -------------------------

const SKU: &str = "EP0001-PPSA00001_00-PLUSOFFER0000000";

fn plus_offer_fake(price: Respond<String, ProductPrice>) -> FakeSony {
    FakeSony {
        concepts: Box::new(|_| {
            Ok(vec![Concept {
                id: Some(SKU.into()),
                name: Some("alpha".into()),
                products: Some(vec![ConceptProductRef {
                    id: Some(SKU.into()),
                    ..ConceptProductRef::default()
                }]),
                ..Concept::default()
            }])
        }),
        price,
        ..FakeSony::default()
    }
}

fn offer(plus_offer: PlusOffer) -> Result<ProductPrice, UpstreamError> {
    Ok(ProductPrice {
        plus_offer: Some(plus_offer),
        standard: None,
    })
}

#[tokio::test(start_paused = true)]
async fn the_game_page_carries_the_plus_offer() {
    let (svc, _) = service(plus_offer_fake(Box::new(|_| {
        offer(PlusOffer::Price {
            price: "€24,95".into(),
        })
    })));
    assert_eq!(
        svc.game_by_id(SKU.into()).await.unwrap().plus_offer,
        Some(PlusOffer::Price {
            price: "€24,95".into()
        })
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_offer_is_null_and_logs_only_the_tag() {
    let (svc, _) = service(plus_offer_fake(Box::new(|_| {
        Err(UpstreamError::unavailable("secret detail"))
    })));
    let logs = CapturedLogs::default();
    let _guard = logs.install();
    let game = svc.game_by_id(SKU.into()).await.unwrap();
    assert_eq!((game.id.as_str(), game.plus_offer), (SKU, None));
    let line = logs
        .lines()
        .into_iter()
        .find(|line| line["message"] == "plus offer lookup failed")
        .unwrap();
    assert_eq!(line["reason"], "UpstreamUnavailable");
    assert!(!logs.text().contains("secret detail"));
    assert!(!logs.text().contains(SKU));
}

#[tokio::test(start_paused = true)]
async fn the_offer_is_cached_for_10_minutes_and_a_failure_for_30_seconds() {
    let (svc, fake) = service(plus_offer_fake(Box::new(|_| offer(PlusOffer::Included))));
    svc.game_by_id(SKU.into()).await.unwrap();
    svc.game_by_id(SKU.into()).await.unwrap();
    assert_eq!(fake.calls().prices.len(), 1);
    tokio::time::advance(Duration::from_millis(599_999)).await;
    svc.game_by_id(SKU.into()).await.unwrap();
    assert_eq!(fake.calls().prices.len(), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    svc.game_by_id(SKU.into()).await.unwrap();
    assert_eq!(fake.calls().prices.len(), 2);

    let failing = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let flag = Arc::clone(&failing);
    let (svc, fake) = service(plus_offer_fake(Box::new(move |_| {
        if flag.load(Ordering::SeqCst) {
            Err(unavailable())
        } else {
            offer(PlusOffer::Included)
        }
    })));
    assert_eq!(svc.game_by_id(SKU.into()).await.unwrap().plus_offer, None);
    failing.store(false, Ordering::SeqCst);
    tokio::time::advance(Duration::from_millis(29_999)).await;
    assert_eq!(svc.game_by_id(SKU.into()).await.unwrap().plus_offer, None);
    assert_eq!(fake.calls().prices.len(), 1);
    tokio::time::advance(Duration::from_millis(1)).await;
    assert_eq!(
        svc.game_by_id(SKU.into()).await.unwrap().plus_offer,
        Some(PlusOffer::Included)
    );
    assert_eq!(fake.calls().prices.len(), 2);
}

// ---- A MONTHLY game (gamesServiceMonthly.test.ts) ----------------------------

#[tokio::test(start_paused = true)]
async fn a_monthly_only_game_opens_with_detail_and_offer() {
    let (svc, _) = service(FakeSony {
        monthly: Box::new(|()| Ok(vec![monthly_entry(OLD_ID, "2024-01-01T00:00:00Z")])),
        detail: Box::new(|_| {
            Ok(ProductDetail {
                release_date: Some(PAST_DATE.into()),
                genres: vec!["Action".into()],
                description: "long text".into(),
                ..ProductDetail::default()
            })
        }),
        price: Box::new(|_| offer(PlusOffer::Included)),
        ..FakeSony::default()
    });
    let game = svc.game_by_id(OLD_ID.into()).await.unwrap();
    assert_eq!(game.id, OLD_ID);
    assert_eq!(game.description, "long text");
    assert_eq!(game.plus_offer, Some(PlusOffer::Included));
    assert_eq!(game.date, PAST_DATE);
}

#[tokio::test(start_paused = true)]
async fn a_monthly_game_page_survives_a_failed_price_and_an_unknown_id_is_not_found() {
    let (svc, _) = service(FakeSony {
        monthly: Box::new(|()| Ok(vec![monthly_entry(OLD_ID, "2024-01-01T00:00:00Z")])),
        price: Box::new(|_| Err(unavailable())),
        ..FakeSony::default()
    });
    assert_eq!(
        svc.game_by_id(OLD_ID.into()).await.unwrap().plus_offer,
        None
    );
    let missing = "UP0001-PPSA09999_00-MISSING000000000";
    assert_eq!(
        svc.game_by_id(missing.into()).await,
        Err(GameLookupError::NotFound { id: missing.into() })
    );
}

#[tokio::test(start_paused = true)]
async fn a_monthly_outage_fails_the_game_page_before_the_fallback() {
    let (svc, fake) = service(FakeSony {
        monthly: Box::new(|()| Err(unavailable())),
        ..FakeSony::default()
    });
    assert_eq!(
        svc.game_by_id(ID.into()).await,
        Err(GameLookupError::Upstream(unavailable()))
    );
    assert!(fake.calls().details.is_empty());
}
