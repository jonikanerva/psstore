//! One shared computation per key while it runs.
//!
//! The NPSSO exchange uses this: concurrent requests with the same NPSSO share
//! one exchange (STACK.md §2.5). The entry exists only while the computation
//! runs. The result is never kept: each caller receives a copy, and the entry
//! is removed when the computation ends. The computation runs as its own task,
//! so it ends and releases its entry also when every caller leaves.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::hash::Hash;
use std::sync::{Arc, Mutex};

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};

use super::cache::LookupPanicked;

type SharedRun<T, E> = Shared<BoxFuture<'static, Result<T, E>>>;

/// The running computations by key.
pub struct InFlight<K, T, E> {
    inner: Arc<Mutex<Runs<K, T, E>>>,
}

impl<K, T, E> fmt::Debug for InFlight<K, T, E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("InFlight")
    }
}

struct Runs<K, T, E> {
    by_key: HashMap<K, (u64, SharedRun<T, E>)>,
    next: u64,
}

impl<K, T, E> Default for InFlight<K, T, E> {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Runs {
                by_key: HashMap::new(),
                next: 0,
            })),
        }
    }
}

impl<K, T, E> InFlight<K, T, E>
where
    K: Eq + Hash + Clone + Send + 'static,
    T: Clone + Send + Sync + 'static,
    E: Clone + Send + Sync + From<LookupPanicked> + 'static,
{
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Joins the running computation for `key`, or starts `run`.
    ///
    /// # Errors
    ///
    /// The failure of the shared computation, or `E::from(LookupPanicked)`
    /// when it panicked.
    pub async fn run<F, Fut>(&self, key: K, run: F) -> Result<T, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>> + Send + 'static,
    {
        let shared = {
            let mut runs = lock(&self.inner);
            if let Some((_, shared)) = runs.by_key.get(&key) {
                shared.clone()
            } else {
                runs.next += 1;
                let id = runs.next;
                let computation = run();
                let task_runs = Arc::clone(&self.inner);
                let task_key = key.clone();
                // The lock is held while the task starts, so the entry exists
                // before the task can remove it. The guard removes the entry
                // when the task ends, also when the computation panics after
                // every caller has left: tokio then drops the task's future.
                let task = tokio::spawn(async move {
                    let _entry = EntryGuard {
                        runs: task_runs,
                        key: task_key,
                        id,
                    };
                    computation.await
                });
                let shared =
                    async move { task.await.unwrap_or_else(|_| Err(E::from(LookupPanicked))) }
                        .boxed()
                        .shared();
                runs.by_key.insert(key, (id, shared.clone()));
                shared
            }
        };
        shared.await
    }

    /// The number of running computations.
    #[must_use]
    pub fn len(&self) -> usize {
        lock(&self.inner).by_key.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Removes the entry of run `id` when it drops.
struct EntryGuard<K: Eq + Hash, T, E> {
    runs: Arc<Mutex<Runs<K, T, E>>>,
    key: K,
    id: u64,
}

impl<K: Eq + Hash, T, E> Drop for EntryGuard<K, T, E> {
    fn drop(&mut self) {
        remove(&self.runs, &self.key, self.id);
    }
}

fn lock<K, T, E>(runs: &Mutex<Runs<K, T, E>>) -> std::sync::MutexGuard<'_, Runs<K, T, E>> {
    runs.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn remove<K: Eq + Hash, T, E>(runs: &Mutex<Runs<K, T, E>>, key: &K, id: u64) {
    let mut runs = lock(runs);
    if runs.by_key.get(key).is_some_and(|(entry, _)| *entry == id) {
        runs.by_key.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use super::*;
    use crate::domain::errors::UpstreamError;

    #[tokio::test(start_paused = true)]
    async fn concurrent_callers_share_one_run_and_the_entry_ends_with_it() {
        let in_flight: InFlight<&'static str, u32, UpstreamError> = InFlight::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let start = |value: u32| {
            let calls = Arc::clone(&calls);
            move || async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(10)).await;
                Ok(value)
            }
        };
        let (a, b) = tokio::join!(in_flight.run("k", start(1)), in_flight.run("k", start(2)));
        assert_eq!((a, b), (Ok(1), Ok(1)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(in_flight.is_empty(), "no result is kept after the run");
        assert_eq!(in_flight.run("k", start(3)).await, Ok(3));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_panic_after_every_caller_left_releases_the_entry() {
        let in_flight: InFlight<&'static str, u32, UpstreamError> = InFlight::new();
        let abandoned = in_flight.run("k", || async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            panic!("synthetic exchange panic");
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(1), abandoned)
                .await
                .is_err()
        );
        tokio::time::advance(Duration::from_millis(20)).await;
        tokio::task::yield_now().await;
        assert!(in_flight.is_empty(), "the key leaves memory with the task");
        assert_eq!(in_flight.run("k", || async { Ok(2) }).await, Ok(2));
    }

    #[tokio::test(start_paused = true)]
    async fn the_entry_ends_when_every_caller_leaves() {
        let in_flight: InFlight<&'static str, u32, UpstreamError> = InFlight::new();
        let abandoned = in_flight.run("k", || async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            Ok(1)
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(1), abandoned)
                .await
                .is_err()
        );
        tokio::time::advance(Duration::from_millis(20)).await;
        tokio::task::yield_now().await;
        assert!(in_flight.is_empty());
    }
}
