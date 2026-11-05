//! Bounded concurrent lookups that keep the order of their items.

use futures_util::stream::{self, StreamExt};

/// Runs `lookup` on each item with at most `limit` lookups at once, and
/// gives the outputs in the order of the items.
///
/// `buffered` also keeps the order, but it counts a finished output that
/// waits behind a slower earlier lookup as one of its `limit` slots
/// (futures-util 0.3.34, `Buffered::poll_next` and `FuturesOrdered::len`).
/// One lookup that waits for its deadline then stops all new lookups of the
/// list, the search page, the BROWSE page, or the wishlist. Here a finished
/// lookup frees its slot at once, and the index of each item restores the
/// order. The order is visible: the lists, search, BROWSE, and the wishlist
/// keep Sony's order, and BROWSE keeps the first card of a repeated game.
pub(super) async fn in_order_bounded<T, F, Fut>(
    items: impl IntoIterator<Item = T>,
    limit: usize,
    lookup: F,
) -> Vec<Fut::Output>
where
    F: Fn(T) -> Fut,
    Fut: Future,
{
    let mut outputs: Vec<(usize, Fut::Output)> = stream::iter(items.into_iter().enumerate())
        .map(|(index, item)| {
            let pending = lookup(item);
            async move { (index, pending.await) }
        })
        .buffer_unordered(limit)
        .collect()
        .await;
    outputs.sort_by_key(|(index, _)| *index);
    outputs.into_iter().map(|(_, output)| output).collect()
}
