//! Structured logs with allowlisted fields only (STACK.md §9).
//!
//! The log layer writes one line per event in one of two formats. JSON (one
//! object per line) is the default and the production format. Text is a
//! readable line for development; `mise run dev` selects it with
//! `PSSTORE_LOG_FORMAT=text`. Both formats show the same fields.
//!
//! The layer keeps only fields from [`ALLOWED_FIELDS`] and drops every other
//! field value. The rule applies to the fields of the event and to the fields
//! of each span around it, so a request span adds its `request_id` to every
//! event inside the request. The layer writes only events and spans from this
//! crate, because dependency events can contain URLs. Never put a cookie, a
//! header, a token, a URL, a body, a search term, a game id, or an account
//! value into an event message: a message is a fixed text.

use std::io::Write;
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Subscriber};
use tracing_subscriber::Layer;
use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::{LookupSpan, Registry};

/// Field names that a log line may contain. Every value of these fields is
/// free of personal data by construction: random request ids, route
/// patterns, codes, counts, error tags, and Sony operation names.
pub const ALLOWED_FIELDS: &[&str] = &[
    "message",
    "request_id",
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

/// The format of a log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LogFormat {
    /// One JSON object per line: the default and the production format.
    #[default]
    Json,
    /// One readable text line per event, for development.
    Text,
}

impl LogFormat {
    /// The format of a `PSSTORE_LOG_FORMAT` value: `json` or `text`.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "json" => Some(Self::Json),
            "text" => Some(Self::Text),
            _ => None,
        }
    }
}

/// The allowlisting log layer.
pub struct LogLayer {
    writer: LogWriter,
    format: LogFormat,
}

impl std::fmt::Debug for LogLayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LogLayer")
            .field("format", &self.format)
            .finish_non_exhaustive()
    }
}

impl LogLayer {
    pub fn new(writer: LogWriter, format: LogFormat) -> Self {
        Self { writer, format }
    }
}

/// The allowlisted field values of an event or a span, and the names of the
/// dropped fields.
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
            self.drop_name(field.name());
        }
    }

    fn drop_name(&mut self, name: &'static str) {
        if !self.dropped.contains(&name) {
            self.dropped.push(name);
        }
    }

    /// Adds the fields of an enclosing span. A later span or the event itself
    /// replaces a value with the same name.
    fn merge(&mut self, other: &Self) {
        self.kept
            .extend(other.kept.iter().map(|(k, v)| (k.clone(), v.clone())));
        for name in &other.dropped {
            self.drop_name(name);
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

/// The allowlisted fields of a span, kept in the span's extensions until the
/// span closes.
struct SpanFields(Fields);

impl<S> Layer<S> for LogLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else {
            return;
        };
        let mut fields = Fields::default();
        attrs.record(&mut fields);
        span.extensions_mut().insert(SpanFields(fields));
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else {
            return;
        };
        if let Some(SpanFields(fields)) = span.extensions_mut().get_mut::<SpanFields>() {
            values.record(fields);
        }
    }

    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let target = metadata.target();
        let own = target == CRATE_TARGET || target.starts_with("psstore_server::");
        if !own {
            return;
        }
        // The spans from the root to the innermost one, then the event: an
        // inner value replaces an outer value with the same name.
        let mut fields = Fields::default();
        if let Some(scope) = ctx.event_scope(event) {
            for span in scope.from_root() {
                if let Some(SpanFields(span_fields)) = span.extensions().get::<SpanFields>() {
                    fields.merge(span_fields);
                }
            }
        }
        event.record(&mut fields);

        let timestamp = jiff::Timestamp::now().to_string();
        let level = metadata.level().as_str();
        let mut text = match self.format {
            LogFormat::Json => json_line(&timestamp, level, target, fields),
            LogFormat::Text => text_line(&timestamp, level, target, fields),
        };
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

/// One JSON object.
fn json_line(timestamp: &str, level: &str, target: &str, fields: Fields) -> String {
    let mut line = Map::new();
    line.insert("timestamp".into(), Value::from(timestamp));
    line.insert("level".into(), Value::from(level));
    line.insert("target".into(), Value::from(target));
    line.extend(fields.kept);
    if !fields.dropped.is_empty() {
        // Field names are code identifiers, not data, so they are safe to log.
        line.insert("dropped_fields".into(), Value::from(fields.dropped));
    }
    Value::Object(line).to_string()
}

/// One text line: the time, the level, the target, the message, and then
/// `name=value` for each kept field in name order.
fn text_line(timestamp: &str, level: &str, target: &str, fields: Fields) -> String {
    let Fields { mut kept, dropped } = fields;
    let mut line = format!("{timestamp} {level:>5} {target}:");
    if let Some(message) = kept.remove("message") {
        line.push(' ');
        line.push_str(&text_message(&message));
    }
    for (name, value) in &kept {
        line.push(' ');
        line.push_str(name);
        line.push('=');
        line.push_str(&text_value(value));
    }
    if !dropped.is_empty() {
        line.push_str(" dropped_fields=");
        line.push_str(&dropped.join(","));
    }
    line
}

/// A message as is. A message with a control character, such as a line
/// break, is written as a JSON string, so one event stays on one line.
fn text_message(message: &Value) -> String {
    match message {
        Value::String(text) if !text.chars().any(char::is_control) => text.clone(),
        other => other.to_string(),
    }
}

/// A string value as is when it has no white space, quote, `=`, or control
/// character; otherwise a JSON string. Numbers and booleans as is.
fn text_value(value: &Value) -> String {
    match value {
        Value::String(text)
            if !text.is_empty()
                && !text
                    .chars()
                    .any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '=') =>
        {
            text.clone()
        }
        other => other.to_string(),
    }
}

/// The subscriber: the allowlisting layer behind the filter.
pub fn subscriber(
    writer: LogWriter,
    filter: Targets,
    format: LogFormat,
) -> impl Subscriber + Send + Sync {
    Registry::default().with(LogLayer::new(writer, format).with_filter(filter))
}

/// Installs the subscriber for the process at level `info`. Logs go to
/// standard output in `format`.
///
/// # Errors
///
/// Another global subscriber is already installed.
pub fn init(format: LogFormat) -> Result<(), tracing::subscriber::SetGlobalDefaultError> {
    let stdout: LogWriter = Arc::new(Mutex::new(std::io::stdout()));
    let filter = Targets::new().with_target(CRATE_TARGET, LevelFilter::INFO);
    tracing::subscriber::set_global_default(subscriber(stdout, filter, format))
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
                tracing::subscriber::set_global_default(subscriber(
                    writer,
                    filter,
                    LogFormat::Json,
                ))
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

    #[test]
    fn events_carry_the_allowlisted_fields_of_their_spans() {
        let logs = CapturedLogs::default();
        {
            let _guard = logs.install();
            let outer = tracing::info_span!(
                "request",
                request_id = "synthetic-request-id",
                route = "/api/games/{id}",
                cookie = "npsso=synthetic-npsso-value",
            );
            outer.in_scope(|| {
                // A span takes the current span as its parent.
                let inner =
                    tracing::info_span!("lookup", route = "/inner", operation = "categoryGrid");
                inner.in_scope(|| tracing::warn!(status = 502_u64, "inside both spans"));
                tracing::info!("inside the outer span");
            });
            tracing::info!("outside every span");
        }
        let text = logs.text();
        assert!(!text.contains("synthetic-npsso-value"), "{text}");
        let lines = logs.lines();
        assert_eq!(lines.len(), 3, "{text}");
        for line in &lines {
            for name in line.as_object().unwrap().keys() {
                let known = ["timestamp", "level", "target", "dropped_fields"];
                assert!(
                    super::ALLOWED_FIELDS.contains(&name.as_str())
                        || known.contains(&name.as_str()),
                    "{name} in {line}"
                );
            }
        }

        let inside_both = &lines[0];
        assert_eq!(inside_both["request_id"], "synthetic-request-id");
        // The inner span replaces the value of the outer span.
        assert_eq!(inside_both["route"], "/inner");
        assert_eq!(inside_both["operation"], "categoryGrid");
        assert_eq!(inside_both["status"], 502);
        assert_eq!(inside_both["dropped_fields"], serde_json::json!(["cookie"]));

        let inside_outer = &lines[1];
        assert_eq!(inside_outer["request_id"], "synthetic-request-id");
        assert_eq!(inside_outer["route"], "/api/games/{id}");
        assert!(inside_outer.get("operation").is_none(), "{inside_outer}");

        let outside = &lines[2];
        assert!(outside.get("request_id").is_none(), "{outside}");
        assert!(outside.get("dropped_fields").is_none(), "{outside}");
    }

    #[test]
    fn a_span_field_recorded_later_is_allowlisted_too() {
        let logs = CapturedLogs::default();
        {
            let _guard = logs.install();
            let span = tracing::info_span!(
                "request",
                request_id = tracing::field::Empty,
                url = tracing::field::Empty,
            );
            span.record("request_id", "synthetic-late-id");
            span.record("url", "https://example.invalid/?q=synthetic-term");
            span.in_scope(|| tracing::info!("after the record"));
        }
        let text = logs.text();
        assert!(!text.contains("synthetic-term"), "{text}");
        let lines = logs.lines();
        assert_eq!(lines.len(), 1, "{text}");
        assert_eq!(lines[0]["request_id"], "synthetic-late-id");
        assert_eq!(lines[0]["dropped_fields"], serde_json::json!(["url"]));
    }

    /// Writes the events of `emit` in `format` through a subscriber of this
    /// thread only. The callsites of these tests are their own, so no other
    /// test thread can cache their interest first.
    fn lines_in(format: super::LogFormat, emit: impl FnOnce()) -> Vec<String> {
        use std::sync::{Arc, Mutex};

        let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
        let writer: super::LogWriter = buffer.clone();
        let filter: tracing_subscriber::filter::Targets = "trace".parse().unwrap();
        tracing::subscriber::with_default(super::subscriber(writer, filter, format), emit);
        let text = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
        text.lines().map(str::to_owned).collect()
    }

    fn emit_request_events() {
        let span = tracing::info_span!(
            "request",
            request_id = "synthetic-request-id",
            route = "/api/games/search",
            method = "GET",
            query = "synthetic-search-term",
        );
        span.in_scope(|| {
            tracing::info!(
                status = 200_u64,
                elapsed_ms = 7_u64,
                reason = "two words",
                "request completed"
            );
            tracing::warn!(reason = "line\nbreak", "upstream\nfailed");
        });
    }

    #[test]
    fn the_text_format_is_readable_and_allowlisted() {
        let lines = lines_in(super::LogFormat::Text, emit_request_events);
        let text = lines.join("\n");
        assert_eq!(lines.len(), 2, "{text}");
        assert!(!text.contains("synthetic-search-term"), "{text}");

        let (timestamp, rest) = lines[0].split_once(' ').unwrap();
        assert!(timestamp.parse::<jiff::Timestamp>().is_ok(), "{timestamp}");
        assert_eq!(
            rest,
            " INFO psstore_server::observability::tests: request completed \
             elapsed_ms=7 method=GET reason=\"two words\" \
             request_id=synthetic-request-id route=/api/games/search status=200 \
             dropped_fields=query"
        );
        // A line break in a message or a value stays escaped on one line.
        let (_, rest) = lines[1].split_once(' ').unwrap();
        assert_eq!(
            rest,
            " WARN psstore_server::observability::tests: \"upstream\\nfailed\" \
             method=GET reason=\"line\\nbreak\" request_id=synthetic-request-id \
             route=/api/games/search dropped_fields=query"
        );
    }

    #[test]
    fn both_formats_show_the_same_fields() {
        let json: Vec<serde_json::Value> = lines_in(super::LogFormat::Json, emit_request_events)
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let text = lines_in(super::LogFormat::Text, emit_request_events);
        assert_eq!(json.len(), text.len());
        for (object, line) in json.iter().zip(&text) {
            let names: Vec<&String> = object
                .as_object()
                .unwrap()
                .keys()
                .filter(|name| {
                    !["timestamp", "level", "target", "message"].contains(&name.as_str())
                })
                .collect();
            for name in &names {
                assert!(line.contains(&format!(" {name}=")), "{name} in {line}");
            }
            let in_text = line.matches('=').count();
            assert_eq!(in_text, names.len(), "{line}");
        }
    }

    #[test]
    fn parses_the_log_format_setting() {
        use super::LogFormat;
        assert_eq!(LogFormat::parse("json"), Some(LogFormat::Json));
        assert_eq!(LogFormat::parse("text"), Some(LogFormat::Text));
        assert_eq!(LogFormat::parse("TEXT"), None);
        assert_eq!(LogFormat::parse(""), None);
        assert_eq!(LogFormat::default(), LogFormat::Json);
    }
}
