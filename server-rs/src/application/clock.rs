//! The injected wall clock.

use std::sync::Mutex;

use jiff::Timestamp;

/// The source of the current instant. Code outside this module and `main`
/// receives a `Clock` and never reads ambient time for response content.
/// Deadlines and cache expiry use `tokio::time::Instant`, which tests pause.
pub trait Clock: Send + Sync {
    fn now(&self) -> Timestamp;
}

impl std::fmt::Debug for dyn Clock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Clock")
    }
}

/// The system wall clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Timestamp {
        Timestamp::now()
    }
}

/// A clock for tests. It returns a fixed instant until a test changes it.
#[derive(Debug)]
pub struct FixedClock(Mutex<Timestamp>);

impl FixedClock {
    pub fn new(now: Timestamp) -> Self {
        Self(Mutex::new(now))
    }

    pub fn set(&self, now: Timestamp) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = now;
    }
}

impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        *self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}
