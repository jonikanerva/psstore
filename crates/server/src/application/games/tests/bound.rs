//! The bound of the concurrent product detail lookups of NEW, UPCOMING, and
//! DISCOUNTED (issue #212).

use super::*;

/// More product cards than the bound, in each list.
const RELEASED: usize = 60;
const UPCOMING: usize = 30;
const DISCOUNTED: usize = 50;
const UPCOMING_DATE: &str = "2026-03-01T00:00:00Z";

fn released_name(n: usize) -> String {
    format!("released-{n:03}")
}

fn upcoming_name(n: usize) -> String {
    format!("upcoming-{n:03}")
}

/// The number in a product id of `sku`.
fn sku_number(id: &str) -> usize {
    id["EP0001-PPSA".len().."EP0001-PPSA".len() + 5]
        .parse()
        .unwrap()
}

/// An earlier card waits longer than a later one, so the lookups finish in
/// the reverse order of the list.
fn reverse_delay() -> Delay {
    Box::new(|id| Duration::from_millis(500 - u64::try_from(sku_number(id)).unwrap()))
}

/// The NEW and UPCOMING grids: released products 0 to 59, and upcoming
/// products 100 to 129 with two concept announcements between them.
fn release_grids() -> Respond<SonyFeature, Vec<Concept>> {
    Box::new(|feature| {
        Ok(match feature {
            SonyFeature::New => (0..RELEASED)
                .map(|n| priced_concept(n, &released_name(n)))
                .collect(),
            SonyFeature::Upcoming => {
                let mut grid: Vec<Concept> = (100..100 + UPCOMING)
                    .map(|n| priced_concept(n, &upcoming_name(n)))
                    .collect();
                grid.insert(10, announcement("10010001", "concept-first"));
                grid.insert(20, announcement("10010002", "concept-second"));
                grid
            }
            SonyFeature::Discounted => (200..200 + DISCOUNTED)
                .map(|n| priced_concept(n, &format!("deal-{n:03}")))
                .collect(),
        })
    })
}

/// Every released product has the same past date and every upcoming
/// product the same future date, so the stable sort keeps the grid order.
fn release_dates() -> Respond<String, ProductDetail> {
    Box::new(|id| {
        let date = if sku_number(&id) < 100 {
            PAST_DATE
        } else {
            UPCOMING_DATE
        };
        Ok(detail_at(Some(date)))
    })
}

#[tokio::test(start_paused = true)]
async fn new_and_upcoming_bound_the_lookups_and_keep_the_grid_order() {
    let (svc, fake) = service(FakeSony {
        concepts: release_grids(),
        detail: release_dates(),
        detail_delay: reverse_delay(),
        ..FakeSony::default()
    });
    let new = svc.new_games(page(0, 120)).await.unwrap();
    let expected: Vec<String> = (0..RELEASED).map(released_name).collect();
    assert_eq!(names(&new), expected);
    // One bound covers both grids of one request.
    assert_eq!(fake.peak.load(Ordering::SeqCst), LIST_DETAIL_CONCURRENCY);
    assert_eq!(fake.calls().details.len(), RELEASED + UPCOMING);

    let upcoming = svc.upcoming_games(page(0, 120)).await.unwrap();
    let mut expected: Vec<String> = (100..100 + UPCOMING).map(upcoming_name).collect();
    // Undated concept cards come last, in grid order.
    expected.extend(["concept-first".into(), "concept-second".into()]);
    assert_eq!(names(&upcoming), expected);
}

#[tokio::test(start_paused = true)]
async fn discounted_bounds_the_lookups_and_keeps_the_grid_order() {
    let (svc, fake) = service(FakeSony {
        concepts: release_grids(),
        detail_delay: reverse_delay(),
        ..FakeSony::default()
    });
    let result = svc.discounted_games(page(0, 120)).await.unwrap();
    let expected: Vec<String> = (200..200 + DISCOUNTED)
        .map(|n| format!("deal-{n:03}"))
        .collect();
    assert_eq!(names(&result), expected);
    assert_eq!(fake.peak.load(Ordering::SeqCst), LIST_DETAIL_CONCURRENCY);
    assert_eq!(fake.calls().details.len(), DISCOUNTED);
}

#[tokio::test(start_paused = true)]
async fn a_slow_lookup_does_not_stop_the_next_lookups() {
    // The first product waits 10 s; every other one answers in 10 ms.
    let (svc, fake) = service(FakeSony {
        concepts: release_grids(),
        detail: release_dates(),
        detail_delay: Box::new(|id| {
            if sku_number(id) == 0 {
                Duration::from_secs(10)
            } else {
                Duration::from_millis(10)
            }
        }),
        ..FakeSony::default()
    });
    let pending = tokio::spawn(async move { svc.new_games(page(0, 120)).await });
    tokio::time::sleep(Duration::from_secs(5)).await;
    // While the first lookup waits, all the other lookups start and end.
    assert_eq!(fake.calls().details.len(), RELEASED + UPCOMING);
    assert_eq!(fake.in_flight.load(Ordering::SeqCst), 1);
    let new = pending.await.unwrap().unwrap();
    assert_eq!(new.games.len(), RELEASED);
    assert_eq!(new.games[0].name, released_name(0));
}
