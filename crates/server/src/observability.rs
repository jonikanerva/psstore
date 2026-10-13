//! Structured JSON logs with allowlisted fields only (STACK.md §9).
//!
//! The log layer writes one JSON object per event. It keeps only fields from
//! [`ALLOWED_FIELDS`] and drops every other field value. It writes only events
//! from this crate, because dependency events can contain URLs. Never put a
//! cookie, a header, a token, a URL, a body, a search term, a game id, or an
//! account value into an event message: a message is a fixed text.

use std::io::Write;
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::Layer;
use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::Registry;

/// Field names that a log line may contain. Every value of these fields is
/// free of personal data by construction: route patterns, codes, counts,
/// error tags, and Sony operation names.
pub const ALLOWED_FIELDS: &[&str] = &[
    "message",
    "route",
    "method",
    "status",
    "elapsed_ms",
    "reason",
    "operation",
    "feature",
    "stage",
    "bind",
    "panic_location",
    "count",
    "entries",
    "priced",
    "dropped",
    "kept",
    "event",
    "failed",
    "out_of_scope",
];

/// The crate prefix of events that the layer writes.
const CRATE_TARGET: &str = "psstore_server";

/// A shared output for log lines.
pub type LogWriter = Arc<Mutex<dyn Write + Send>>;

/// The allowlisting JSON layer.
pub struct JsonLayer {
    writer: LogWriter,
}

impl std::fmt::Debug for JsonLayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("JsonLayer")
    }
}

impl JsonLayer {
    pub fn new(writer: LogWriter) -> Self {
        Self { writer }
    }
}

#[derive(Default)]
struct Fields {
    kept: Map<String, Value>,
    dropped: Vec<&'static str>,
}

impl Fields {
    fn put(&mut self, field: &Field, value: Value) {
        if ALLOWED_FIELDS.contains(&field.name()) {
            self.kept.insert(field.name().to_owned(), value);
        } else {
            self.dropped.push(field.name());
        }
    }
}

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.put(field, Value::from(value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.put(field, Value::from(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.put(field, Value::from(value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.put(field, Value::from(value));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.put(field, Value::from(format!("{value:?}")));
    }
}

impl<S: Subscriber> Layer<S> for JsonLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let target = metadata.target();
        let own = target == CRATE_TARGET || target.starts_with("psstore_server::");
        if !own {
            return;
        }
        let mut fields = Fields::default();
        event.record(&mut fields);

        let mut line = Map::new();
        line.insert(
            "timestamp".into(),
            Value::from(jiff::Timestamp::now().to_string()),
        );
        line.insert("level".into(), Value::from(metadata.level().as_str()));
        line.insert("target".into(), Value::from(target));
        line.extend(fields.kept);
        if !fields.dropped.is_empty() {
            // Field names are code identifiers, not data, so they are safe to log.
            line.insert("dropped_fields".into(), Value::from(fields.dropped));
        }
        let mut text = Value::Object(line).to_string();
        text.push('\n');
        let mut writer = self
            .writer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // A failed log write must not fail the request, and no other channel
        // can report it.
        writer.write_all(text.as_bytes()).ok();
    }
}

/// The subscriber: the allowlisting layer behind the filter.
pub fn subscriber(writer: LogWriter, filter: Targets) -> impl Subscriber + Send + Sync {
    Registry::default().with(JsonLayer::new(writer).with_filter(filter))
}

/// Installs the subscriber for the process at level `info`. Logs go to
/// standard output.
///
/// # Errors
///
/// Another global subscriber is already installed.
pub fn init() -> Result<(), tracing::subscriber::SetGlobalDefaultError> {
    let stdout: LogWriter = Arc::new(Mutex::new(std::io::stdout()));
    let filter = Targets::new().with_target(CRATE_TARGET, LevelFilter::INFO);
    tracing::subscriber::set_global_default(subscriber(stdout, filter))
}

/// Replaces the default panic hook. The default hook writes the panic
/// message to standard error, and a panic message can contain private data.
/// This hook writes one log event with the source location of the panic and
/// never reads the message. Call it after [`init`].
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| log_panic(info.location())));
}

/// The body of the panic hook. The location is a source file path and line
/// of this build, so it contains no request data.
fn log_panic(location: Option<&std::panic::Location<'_>>) {
    let location = location.map_or_else(
        || "unknown".to_owned(),
        |l| format!("{}:{}", l.file(), l.line()),
    );
    tracing::error!(
        panic_location = location.as_str(),
        "panic; the panic message is not logged"
    );
}

/// Log capture for tests.
///
/// Scoped subscribers race on the global callsite interest cache when tests
/// run in parallel threads, so the capture uses one global subscriber for the
/// whole test binary. Its writer sends each line to the buffer of the current
/// thread, if a test on that thread has installed one. `#[tokio::test]` uses a
/// current-thread runtime, so the request runs on the test thread.
#[cfg(test)]
pub(crate) mod testing {
    use std::cell::RefCell;
    use std::sync::Once;

    use super::*;

    type Buffer = Arc<Mutex<Vec<u8>>>;

    thread_local! {
        static CAPTURE: RefCell<Option<Buffer>> = const { RefCell::new(None) };
    }

    /// Writes to the capture buffer of the current thread, or nowhere.
    struct ThreadWriter;

    impl Write for ThreadWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            CAPTURE.with(|capture| {
                if let Some(buffer) = capture.borrow().as_ref() {
                    buffer.lock().unwrap().extend_from_slice(bytes);
                }
            });
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    static INIT: Once = Once::new();

    #[derive(Debug, Clone, Default)]
    pub struct CapturedLogs(Buffer);

    /// Stops the capture on this thread when dropped.
    #[derive(Debug)]
    pub struct CaptureGuard;

    impl Drop for CaptureGuard {
        fn drop(&mut self) {
            CAPTURE.with(|capture| capture.borrow_mut().take());
        }
    }

    impl CapturedLogs {
        pub fn text(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }

        pub fn lines(&self) -> Vec<Value> {
            self.text()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }

        /// Captures log lines of this thread until the guard drops.
        pub fn install(&self) -> CaptureGuard {
            INIT.call_once(|| {
                let filter: Targets = "trace".parse().unwrap();
                let writer: LogWriter = Arc::new(Mutex::new(ThreadWriter));
                tracing::subscriber::set_global_default(subscriber(writer, filter))
                    .expect("no other global subscriber in tests");
            });
            // Heal a callsite whose interest another thread cached before the
            // global subscriber existed.
            tracing::callsite::rebuild_interest_cache();
            CAPTURE.with(|capture| *capture.borrow_mut() = Some(self.0.clone()));
            CaptureGuard
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::CapturedLogs;

    #[test]
    fn keeps_allowlisted_fields_and_drops_others() {
        let logs = CapturedLogs::default();
        {
            let _guard = logs.install();
            tracing::info!(
                route = "/api/games/{id}",
                status = 200_u64,
                cookie = "npsso=synthetic-npsso-value",
                url = "https://example.invalid/?q=synthetic-term",
                "request completed"
            );
        }
        let text = logs.text();
        assert!(!text.contains("synthetic-npsso-value"), "{text}");
        assert!(!text.contains("synthetic-term"), "{text}");
        let lines = logs.lines();
        assert_eq!(lines.len(), 1);
        let line = &lines[0];
        assert_eq!(line["route"], "/api/games/{id}");
        assert_eq!(line["status"], 200);
        assert_eq!(line["message"], "request completed");
        assert_eq!(line["level"], "INFO");
        assert_eq!(line["dropped_fields"], serde_json::json!(["cookie", "url"]));
    }

    /// The test calls the hook body directly. Installing the hook in a test
    /// would hide the assertion messages of every other test in the binary.
    #[test]
    fn panic_hook_logs_the_location_only() {
        let logs = CapturedLogs::default();
        {
            let _guard = logs.install();
            super::log_panic(Some(std::panic::Location::caller()));
            super::log_panic(None);
        }
        let lines = logs.lines();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["level"], "ERROR");
        assert_eq!(
            lines[0]["message"],
            "panic; the panic message is not logged"
        );
        let location = lines[0]["panic_location"].as_str().unwrap();
        assert!(location.contains("observability.rs:"), "{location}");
        assert_eq!(lines[1]["panic_location"], "unknown");
    }

    #[test]
    fn ignores_events_from_other_crates() {
        let logs = CapturedLogs::default();
        {
            let _guard = logs.install();
            tracing::info!(target: "reqwest::connect", "GET https://example.invalid/?key=x");
        }
        assert_eq!(logs.text(), "");
    }
}
