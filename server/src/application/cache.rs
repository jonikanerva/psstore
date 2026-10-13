//! An in-memory cache with a capacity, a time to live per outcome, and one
//! shared lookup per key.
//!
//! The semantics follow the Effect `Cache` that the TypeScript server used:
//!
//! - Concurrent calls for a key share one lookup. The lookup runs as its own
//!   task, so it completes and fills the cache also when every caller leaves.
//! - The time to live is a function of the outcome, so a failure can live
//!   shorter than a success. A zero time to live keeps the outcome out of the
//!   cache. The time counts from the end of the lookup.
//! - A read moves the entry to the most recently used position. When the
//!   cache holds more entries than its capacity, it drops the least recently
//!   used entries, also pending ones.
//!
//! Expiry uses `tokio::time::Instant`, so tests control it with a paused
//! clock. A hand-written cache is used instead of a cache crate because the
//! established crates read their own clock, which tests cannot pause.

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::future::Future;
use std::hash::Hash;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};
use tokio::time::Instant;

use crate::domain::errors::{GameLookupError, UpstreamError};

/// The failure value of a lookup task that panicked. The panic itself is
/// logged by the panic hook. The outcome is not cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LookupPanicked;

impl From<LookupPanicked> for UpstreamError {
    fn from(_: LookupPanicked) -> Self {
        Self::unavailable("Upstream unavailable")
    }
}

impl From<LookupPanicked> for GameLookupError {
    fn from(panicked: LookupPanicked) -> Self {
        Self::Upstream(panicked.into())
    }
}

type Ttl<V, E> = Box<dyn Fn(&Result<V, E>) -> Duration + Send + Sync>;
type SharedLookup<V, E> = Shared<BoxFuture<'static, Result<V, E>>>;

/// A bounded cache of lookup outcomes.
pub struct TtlCache<K, V, E> {
    inner: Arc<Inner<K, V, E>>,
}

impl<K, V, E> fmt::Debug for TtlCache<K, V, E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TtlCache")
            .field("capacity", &self.inner.capacity)
            .finish_non_exhaustive()
    }
}

struct Inner<K, V, E> {
    capacity: usize,
    ttl: Ttl<V, E>,
    state: Mutex<State<K, V, E>>,
}

struct State<K, V, E> {
    entries: HashMap<K, Entry<V, E>>,
    /// Entry keys by recency number, least recently used first.
    recency: BTreeMap<u64, K>,
    next: u64,
}

struct Entry<V, E> {
    /// The number of the lookup that filled the entry.
    id: u64,
    /// The recency number of the latest use.
    used: u64,
    lookup: SharedLookup<V, E>,
    /// `None` while the lookup runs, and for a time to live that the clock
    /// cannot represent.
    expires_at: Option<Instant>,
}

impl<K, V, E> TtlCache<K, V, E>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + Sync + 'static,
    E: Clone + Send + Sync + From<LookupPanicked> + 'static,
{
    /// A cache whose time to live depends on the outcome.
    pub fn new(
        capacity: usize,
        ttl: impl Fn(&Result<V, E>) -> Duration + Send + Sync + 'static,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                capacity,
                ttl: Box::new(ttl),
                state: Mutex::new(State {
                    entries: HashMap::new(),
                    recency: BTreeMap::new(),
                    next: 0,
                }),
            }),
        }
    }

    /// A cache with one time to live for every outcome.
    pub fn with_fixed_ttl(capacity: usize, ttl: Duration) -> Self {
        Self::new(capacity, move |_| ttl)
    }

    /// Returns the cached outcome for `key`, or runs `lookup` once for all
    /// concurrent callers and caches its outcome.
    pub async fn get_with<F, Fut>(&self, key: K, lookup: F) -> Result<V, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>> + Send + 'static,
    {
        let shared = {
            let mut state = self.inner.lock();
            let now = Instant::now();
            match state.fresh_entry(&key, now) {
                Some(shared) => shared,
                None => self.start_lookup(&mut state, key, lookup()),
            }
        };
        shared.await
    }

    /// The number of entries, pending ones included.
    pub fn len(&self) -> usize {
        self.inner.lock().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn start_lookup<Fut>(
        &self,
        state: &mut State<K, V, E>,
        key: K,
        lookup: Fut,
    ) -> SharedLookup<V, E>
    where
        Fut: Future<Output = Result<V, E>> + Send + 'static,
    {
        let id = state.bump();
        let task_inner = Arc::clone(&self.inner);
        let task_key = key.clone();
        // The task records the outcome itself, so the entry gets its expiry
        // also when no caller waits any more. The lock is held while the task
        // starts, so the entry exists before the task can complete.
        let task = tokio::spawn(async move {
            let outcome = lookup.await;
            task_inner.complete(&task_key, id, &outcome);
            outcome
        });
        let panic_inner = Arc::clone(&self.inner);
        let panic_key = key.clone();
        let shared = async move {
            match task.await {
                Ok(outcome) => outcome,
                Err(_) => {
                    panic_inner.remove(&panic_key, id);
                    Err(E::from(LookupPanicked))
                }
            }
        }
        .boxed()
        .shared();
        state.insert(
            key,
            Entry {
                id,
                used: id,
                lookup: shared.clone(),
                expires_at: None,
            },
        );
        state.evict_over(self.inner.capacity);
        shared
    }
}

impl<K, V, E> Inner<K, V, E>
where
    K: Eq + Hash + Clone,
{
    fn lock(&self) -> std::sync::MutexGuard<'_, State<K, V, E>> {
        // The state stays consistent between statements, so a poisoned lock
        // can be used.
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Sets the expiry of the entry that lookup `id` filled, or drops the
    /// entry when the time to live is zero.
    fn complete(&self, key: &K, id: u64, outcome: &Result<V, E>) {
        let ttl = (self.ttl)(outcome);
        let mut state = self.lock();
        if ttl.is_zero() {
            state.remove_lookup(key, id);
        } else if let Some(entry) = state.entries.get_mut(key)
            && entry.id == id
        {
            // A time to live too long for the clock never expires. `checked_add`
            // keeps a huge provider value from panicking the lookup task.
            entry.expires_at = Instant::now().checked_add(ttl);
        }
    }

    fn remove(&self, key: &K, id: u64) {
        self.lock().remove_lookup(key, id);
    }
}

impl<K, V, E> State<K, V, E>
where
    K: Eq + Hash + Clone,
{
    fn bump(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    /// The shared lookup of a usable entry, marked as most recently used. An
    /// expired entry is removed.
    fn fresh_entry(&mut self, key: &K, now: Instant) -> Option<SharedLookup<V, E>>
    where
        V: Clone,
        E: Clone,
    {
        let expired = self
            .entries
            .get(key)?
            .expires_at
            .is_some_and(|at| now >= at);
        if expired {
            self.remove_key(key);
            return None;
        }
        let used = self.bump();
        let entry = self.entries.get_mut(key)?;
        self.recency.remove(&entry.used);
        entry.used = used;
        self.recency.insert(used, key.clone());
        Some(entry.lookup.clone())
    }

    fn insert(&mut self, key: K, entry: Entry<V, E>) {
        self.remove_key(&key);
        self.recency.insert(entry.used, key.clone());
        self.entries.insert(key, entry);
    }

    fn remove_key(&mut self, key: &K) {
        if let Some(entry) = self.entries.remove(key) {
            self.recency.remove(&entry.used);
        }
    }

    /// Removes the entry only when lookup `id` filled it.
    fn remove_lookup(&mut self, key: &K, id: u64) {
        if self.entries.get(key).is_some_and(|entry| entry.id == id) {
            self.remove_key(key);
        }
    }

    fn evict_over(&mut self, capacity: usize) {
        while self.entries.len() > capacity {
            let Some((_, key)) = self.recency.pop_first() else {
                return;
            };
            self.entries.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    type TestCache = TtlCache<&'static str, u32, UpstreamError>;

    fn counting(
        calls: &Arc<AtomicUsize>,
        outcome: Result<u32, UpstreamError>,
    ) -> impl FnOnce() -> BoxFuture<'static, Result<u32, UpstreamError>> {
        let calls = Arc::clone(calls);
        move || {
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(10)).await;
                outcome
            }
            .boxed()
        }
    }

    #[tokio::test(start_paused = true)]
    async fn concurrent_callers_share_one_lookup() {
        let cache = TestCache::with_fixed_ttl(10, Duration::from_secs(30));
        let calls = Arc::new(AtomicUsize::new(0));
        let (a, b) = tokio::join!(
            cache.get_with("k", counting(&calls, Ok(1))),
            cache.get_with("k", counting(&calls, Ok(2))),
        );
        assert_eq!((a, b), (Ok(1), Ok(1)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn an_entry_expires_after_its_time_to_live() {
        let cache = TestCache::with_fixed_ttl(10, Duration::from_secs(30));
        let calls = Arc::new(AtomicUsize::new(0));
        assert_eq!(cache.get_with("k", counting(&calls, Ok(1))).await, Ok(1));
        tokio::time::advance(Duration::from_secs(29)).await;
        assert_eq!(cache.get_with("k", counting(&calls, Ok(2))).await, Ok(1));
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(cache.get_with("k", counting(&calls, Ok(3))).await, Ok(3));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_failure_lives_for_its_own_time_to_live() {
        let cache = TestCache::new(10, |outcome| match outcome {
            Ok(_) => Duration::from_secs(600),
            Err(_) => Duration::from_secs(30),
        });
        let calls = Arc::new(AtomicUsize::new(0));
        let failure = Err(UpstreamError::unavailable("down"));
        assert_eq!(
            cache.get_with("k", counting(&calls, failure.clone())).await,
            failure
        );
        tokio::time::advance(Duration::from_secs(29)).await;
        assert_eq!(
            cache.get_with("k", counting(&calls, Ok(1))).await,
            failure,
            "a failure is cached for its own time to live"
        );
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(cache.get_with("k", counting(&calls, Ok(1))).await, Ok(1));
    }

    #[tokio::test(start_paused = true)]
    async fn a_zero_time_to_live_keeps_the_outcome_out() {
        let cache = TestCache::new(10, |outcome| {
            if outcome.is_ok() {
                Duration::from_secs(60)
            } else {
                Duration::ZERO
            }
        });
        let calls = Arc::new(AtomicUsize::new(0));
        let failure = Err(UpstreamError::unavailable("down"));
        assert_eq!(
            cache.get_with("k", counting(&calls, failure.clone())).await,
            failure
        );
        assert!(cache.is_empty());
        assert_eq!(cache.get_with("k", counting(&calls, Ok(7))).await, Ok(7));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn drops_the_least_recently_used_entry_over_capacity() {
        let cache = TestCache::with_fixed_ttl(2, Duration::from_secs(60));
        let calls = Arc::new(AtomicUsize::new(0));
        cache.get_with("a", counting(&calls, Ok(1))).await.unwrap();
        cache.get_with("b", counting(&calls, Ok(2))).await.unwrap();
        // Reading `a` makes `b` the least recently used entry.
        cache.get_with("a", counting(&calls, Ok(9))).await.unwrap();
        cache.get_with("c", counting(&calls, Ok(3))).await.unwrap();
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get_with("a", counting(&calls, Ok(9))).await, Ok(1));
        assert_eq!(cache.get_with("b", counting(&calls, Ok(4))).await, Ok(4));
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn the_lookup_completes_and_is_cached_when_the_caller_leaves() {
        let cache = TestCache::with_fixed_ttl(10, Duration::from_secs(60));
        let calls = Arc::new(AtomicUsize::new(0));
        let abandoned = cache.get_with("k", counting(&calls, Ok(5)));
        // The caller gives up before the lookup ends.
        assert!(
            tokio::time::timeout(Duration::from_millis(1), abandoned)
                .await
                .is_err()
        );
        tokio::time::advance(Duration::from_millis(20)).await;
        tokio::task::yield_now().await;
        assert_eq!(cache.get_with("k", counting(&calls, Ok(6))).await, Ok(5));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_huge_time_to_live_does_not_panic_and_never_expires() {
        let cache = TestCache::with_fixed_ttl(10, Duration::MAX);
        let calls = Arc::new(AtomicUsize::new(0));
        assert_eq!(cache.get_with("k", counting(&calls, Ok(1))).await, Ok(1));
        tokio::time::advance(Duration::from_secs(365 * 24 * 60 * 60)).await;
        assert_eq!(cache.get_with("k", counting(&calls, Ok(2))).await, Ok(1));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_panicking_lookup_fails_and_is_not_cached() {
        let cache = TestCache::with_fixed_ttl(10, Duration::from_secs(60));
        let outcome = cache
            .get_with("k", || async {
                #[allow(clippy::panic, reason = "the test checks panic containment")]
                {
                    panic!("synthetic lookup panic");
                }
            })
            .await;
        assert_eq!(
            outcome,
            Err(UpstreamError::unavailable("Upstream unavailable"))
        );
        assert!(cache.is_empty());
    }
}
