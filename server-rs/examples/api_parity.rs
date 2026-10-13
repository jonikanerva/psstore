//! The API parity check: it sends the same requests to two running servers
//! and compares the answers.
//!
//! ```text
//! cargo run --locked --example api_parity -- <base A> <base B> [--games N] [--repeat N]
//! cargo run --locked --example api_parity -- http://127.0.0.1:3456 http://127.0.0.1:3000
//! ```
//!
//! For each request the tool calls server A and right after it server B. It
//! compares the status, the `content-type`, `set-cookie`, and `cache-control`
//! headers, and the exact body bytes. For a difference it prints the request
//! and the first difference, for example the first differing JSON path with
//! two short values. It never prints a whole body. At the end it prints a
//! summary per group of requests.
//!
//! Upstream data can change between the two calls of a pair, for example when
//! a cache entry expires or when Sony search answers in another order. When a
//! pair differs, the tool sends the pair again, up to `--repeat` times
//! (default 3). When a retry pair matches byte for byte, the request counts as
//! unstable, not as a difference. When no retry matches, the tool sends the
//! request to server A alone once more. The report says whether server A then
//! changed its own answer. A changed answer marks upstream noise, not a port
//! difference.
//!
//! The exit code is 0 when no difference remains, 1 on a remaining difference
//! or an incomplete run, and 2 on a usage error. An unstable request does not
//! fail the run.
//!
//! Server A is the reference. The browse genres and the game ids come from
//! the first answers of server A.
//!
//! The tool never sends an NPSSO. The signed-in requests send no cookie or an
//! empty cookie. The sign-in requests send bodies that fail validation before
//! the server calls Sony.

#![allow(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "a command-line tool prints its report"
)]

use std::process::ExitCode;
use std::time::Duration;

use reqwest::header::{ACCEPT, CACHE_CONTROL, CONTENT_TYPE, COOKIE, HeaderMap, SET_COOKIE};
use reqwest::{Client, Method, redirect};
use serde_json::Value;

/// The default number of game pages to compare.
const DEFAULT_GAMES: usize = 30;
/// The default number of retry pairs for a pair that differs.
const DEFAULT_REPEAT: usize = 3;
/// A store request can wait for several Sony calls.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// The longest value or excerpt in a difference report, in characters.
const SHORT: usize = 60;

const LISTS: [&str; 4] = ["new", "upcoming", "discounted", "monthly"];
const BROWSE_ORDERS: [&str; 6] = [
    "best-selling",
    "most-downloaded",
    "newest",
    "oldest",
    "name-asc",
    "name-desc",
];
const BROWSE_GENRES: usize = 3;
const SEARCH_TERMS: [&str; 5] = ["zelda", "fifa", "lego", "ö", "a b"];
/// A well-formed product id that no store page has.
const UNKNOWN_GAME_ID: &str = "EP0000-PPSA00000_00-PARITYUNKNOWN000";

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(options) = Options::parse(&args) else {
        eprintln!("usage: api_parity <base A> <base B> [--games N] [--repeat N]");
        return ExitCode::from(2);
    };
    let client = match Client::builder()
        .redirect(redirect::Policy::none())
        // No decompression: the tool compares the bytes that the server sent.
        .no_gzip()
        // The tool talks to the two servers directly, never through a proxy.
        .no_proxy()
        .timeout(REQUEST_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            eprintln!("api_parity: the HTTP client could not start: {error}");
            return ExitCode::FAILURE;
        }
    };
    println!(
        "api_parity: A = {}, B = {}, games = {}, repeat = {}",
        options.base_a, options.base_b, options.games, options.repeat
    );
    let mut run = Run {
        servers: HttpServers {
            client,
            base_a: options.base_a,
            base_b: options.base_b,
        },
        games: options.games,
        repeat: options.repeat,
        groups: Vec::new(),
        incomplete: Vec::new(),
    };
    run.all().await;
    run.summary()
}

/// The command-line options.
struct Options {
    base_a: String,
    base_b: String,
    games: usize,
    repeat: usize,
}

impl Options {
    fn parse(args: &[String]) -> Option<Self> {
        let mut bases = Vec::new();
        let mut games = DEFAULT_GAMES;
        let mut repeat = DEFAULT_REPEAT;
        let mut rest = args.iter();
        while let Some(arg) = rest.next() {
            if arg == "--games" {
                games = rest.next()?.parse().ok()?;
            } else if arg == "--repeat" {
                repeat = rest.next()?.parse().ok()?;
            } else if arg.starts_with("--") {
                return None;
            } else {
                bases.push(arg.trim_end_matches('/').to_owned());
            }
        }
        let [base_a, base_b] = <[String; 2]>::try_from(bases).ok()?;
        Some(Self {
            base_a,
            base_b,
            games,
            repeat,
        })
    }
}

/// One request that both servers get.
struct Probe {
    method: Method,
    /// The path and the query, for example `/api/games/new?size=10`.
    target: String,
    headers: Vec<(&'static str, &'static str)>,
    body: Option<&'static str>,
}

impl Probe {
    fn get(target: impl Into<String>) -> Self {
        Self::new(Method::GET, target)
    }

    fn new(method: Method, target: impl Into<String>) -> Self {
        Self {
            method,
            target: target.into(),
            headers: Vec::new(),
            body: None,
        }
    }

    fn header(mut self, name: &'static str, value: &'static str) -> Self {
        self.headers.push((name, value));
        self
    }

    fn body(mut self, body: &'static str) -> Self {
        self.body = Some(body);
        self
    }

    /// The request line and the extra headers, for the report.
    fn label(&self) -> String {
        let mut label = format!("{} {}", self.method, self.target);
        for (name, value) in &self.headers {
            label.push_str(&format!(" [{name}: {value}]"));
        }
        if let Some(body) = self.body {
            label.push_str(&format!(" [body: {body:?}]"));
        }
        label
    }
}

/// The parts of an answer that the tool compares.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Answer {
    status: u16,
    content_type: Option<String>,
    set_cookie: Vec<String>,
    cache_control: Option<String>,
    body: Vec<u8>,
}

impl Answer {
    /// The body as JSON, or `None` when it is not JSON.
    fn json(&self) -> Option<Value> {
        serde_json::from_slice(&self.body).ok()
    }
}

/// The answer of one server, or the text of a transport error.
type Exchange = Result<Answer, String>;

/// One of the two servers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    A,
    B,
}

/// Sends one request to one of the two servers. The unit tests use a fake.
trait Servers {
    async fn send(&self, side: Side, probe: &Probe) -> Exchange;
}

/// The two servers over HTTP.
struct HttpServers {
    client: Client,
    base_a: String,
    base_b: String,
}

impl Servers for HttpServers {
    async fn send(&self, side: Side, probe: &Probe) -> Exchange {
        let base = match side {
            Side::A => &self.base_a,
            Side::B => &self.base_b,
        };
        let mut request = self
            .client
            .request(probe.method.clone(), format!("{base}{}", probe.target));
        for (name, value) in &probe.headers {
            request = request.header(*name, *value);
        }
        if let Some(body) = probe.body {
            request = request.body(body);
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let body = response.bytes().await.map_err(|e| e.to_string())?;
        Ok(Answer {
            status,
            content_type: header(&headers, CONTENT_TYPE),
            set_cookie: headers
                .get_all(SET_COOKIE)
                .iter()
                .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
                .collect(),
            cache_control: header(&headers, CACHE_CONTROL),
            body: body.to_vec(),
        })
    }
}

/// The result of one request after its retries.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    /// The first pair matched.
    Same,
    /// The first pair differed, and retry pair `retry` (from 1) matched.
    Unstable { retry: usize },
    /// No pair matched. `differences` describes the first pair.
    Different {
        differences: Vec<String>,
        a_alone: AloneCheck,
    },
}

/// The answer of server A to the request that the tool sends to it alone
/// after a remaining difference, against its first answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AloneCheck {
    /// The same answer: server A was stable.
    Unchanged,
    /// Another answer: server A itself changed, so the upstream data moved.
    Changed,
    /// One of the two requests to server A got no answer.
    NoAnswer,
}

/// Sends one request pair. When the pair differs, it sends up to `repeat`
/// retry pairs and stops at the first pair that matches. When no pair
/// matches, it sends the request to server A alone once more. Returns the
/// first answer of server A and the outcome.
async fn check(servers: &impl Servers, probe: &Probe, repeat: usize) -> (Option<Answer>, Outcome) {
    let first_a = servers.send(Side::A, probe).await;
    let first_b = servers.send(Side::B, probe).await;
    let differences = pair_differences(&first_a, &first_b);
    if differences.is_empty() {
        return (first_a.ok(), Outcome::Same);
    }
    for retry in 1..=repeat {
        let a = servers.send(Side::A, probe).await;
        let b = servers.send(Side::B, probe).await;
        if pair_differences(&a, &b).is_empty() {
            return (first_a.ok(), Outcome::Unstable { retry });
        }
    }
    let again = servers.send(Side::A, probe).await;
    let a_alone = alone_check(&first_a, &again);
    (
        first_a.ok(),
        Outcome::Different {
            differences,
            a_alone,
        },
    )
}

/// The differences of one pair. An empty list means that the pair matched
/// byte for byte. A transport error is always a difference.
fn pair_differences(a: &Exchange, b: &Exchange) -> Vec<String> {
    match (a, b) {
        (Ok(a), Ok(b)) => differences(a, b),
        _ => vec![format!("transport: {} vs {}", transport(a), transport(b))],
    }
}

fn transport(exchange: &Exchange) -> &str {
    match exchange {
        Ok(_) => "answer",
        Err(error) => error,
    }
}

fn alone_check(first: &Exchange, again: &Exchange) -> AloneCheck {
    match (first, again) {
        (Ok(first), Ok(again)) if first == again => AloneCheck::Unchanged,
        (Ok(_), Ok(_)) => AloneCheck::Changed,
        _ => AloneCheck::NoAnswer,
    }
}

/// The report lines of one request. A request that matched at once has none.
fn report(probe: &Probe, outcome: &Outcome, repeat: usize) -> Vec<String> {
    match outcome {
        Outcome::Same => Vec::new(),
        Outcome::Unstable { retry } => vec![format!(
            "UNSTABLE {}: matched on retry {retry} of {repeat}",
            probe.label()
        )],
        Outcome::Different {
            differences,
            a_alone,
        } => {
            let mut lines = vec![format!("DIFF {}", probe.label())];
            lines.extend(differences.iter().map(|d| format!("     {d}")));
            let a_alone = match a_alone {
                AloneCheck::Unchanged => "same answer as its first answer",
                AloneCheck::Changed => "another answer than its first answer (upstream noise)",
                AloneCheck::NoAnswer => "no answer",
            };
            lines.push(format!(
                "     no retry of {repeat} matched; server A alone: {a_alone}"
            ));
            lines
        }
    }
}

/// The outcome counts of one group of requests.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Counts {
    same: usize,
    unstable: usize,
    different: usize,
}

impl Counts {
    fn record(&mut self, outcome: &Outcome) {
        match outcome {
            Outcome::Same => self.same += 1,
            Outcome::Unstable { .. } => self.unstable += 1,
            Outcome::Different { .. } => self.different += 1,
        }
    }

    fn total(self) -> usize {
        self.same + self.unstable + self.different
    }

    fn add(self, other: Self) -> Self {
        Self {
            same: self.same + other.same,
            unstable: self.unstable + other.unstable,
            different: self.different + other.different,
        }
    }
}

/// True when no difference remains and the request set is complete.
fn passed(groups: &[(&str, Counts)], incomplete: &[String]) -> bool {
    incomplete.is_empty() && groups.iter().all(|(_, counts)| counts.different == 0)
}

struct Run {
    servers: HttpServers,
    games: usize,
    repeat: usize,
    /// The counts per group, in the order of the first request of each group.
    groups: Vec<(&'static str, Counts)>,
    /// The parts of the request set that the tool could not build.
    incomplete: Vec<String>,
}

impl Run {
    async fn all(&mut self) {
        // Lists: the default page and several explicit pages, including an
        // offset past the end. Keep server A's default pages for the game ids.
        let mut list_pages = Vec::new();
        let mut lists = Vec::new();
        for list in LISTS {
            for query in [
                "",
                "?offset=0&size=10",
                "?offset=10&size=10",
                "?offset=60",
                "?size=120",
                "?offset=100000",
            ] {
                lists.push(Probe::get(format!("/api/games/{list}{query}")));
            }
        }
        for probe in &lists {
            let answer = self.compare("lists", probe).await;
            if !probe.target.contains('?') {
                list_pages.push(answer);
            }
        }

        let genres = self
            .compare("genres", &Probe::get("/api/games/genres"))
            .await;
        let genre_keys = genre_keys(genres.as_ref());
        if genre_keys.is_empty() {
            self.incomplete
                .push("browse: server A gave no genre list".to_owned());
        }
        for key in genre_keys.iter().take(BROWSE_GENRES) {
            for order in BROWSE_ORDERS {
                let base = format!("/api/games/browse?genre={}&order={order}", query_value(key));
                for page in ["", "&offset=60"] {
                    self.compare("browse", &Probe::get(format!("{base}{page}")))
                        .await;
                }
            }
        }

        for term in SEARCH_TERMS {
            let target = format!("/api/games/search?q={}", query_value(term));
            self.compare("search", &Probe::get(target)).await;
        }
        self.compare("search", &Probe::get("/api/games/search?q=zelda&size=5"))
            .await;
        self.compare(
            "search",
            &Probe::get("/api/games/search?q=lego&offset=5&size=5"),
        )
        .await;

        let ids = sample_ids(&list_pages, self.games);
        if ids.is_empty() && self.games > 0 {
            self.incomplete
                .push("game pages: server A gave no game ids".to_owned());
        }
        for id in ids
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(UNKNOWN_GAME_ID))
        {
            let target = format!("/api/games/{}", path_segment(id));
            self.compare("game pages", &Probe::get(target)).await;
        }

        for probe in edge_cases() {
            self.compare("edge cases", &probe).await;
        }
    }

    /// Checks one request, prints its report lines, and counts its outcome.
    /// Returns the first answer of server A.
    async fn compare(&mut self, group: &'static str, probe: &Probe) -> Option<Answer> {
        let (first_a, outcome) = check(&self.servers, probe, self.repeat).await;
        for line in report(probe, &outcome, self.repeat) {
            println!("{line}");
        }
        match self.groups.iter_mut().find(|(name, _)| *name == group) {
            Some((_, counts)) => counts.record(&outcome),
            None => {
                let mut counts = Counts::default();
                counts.record(&outcome);
                self.groups.push((group, counts));
            }
        }
        first_a
    }

    fn summary(&self) -> ExitCode {
        let line = |name: &str, counts: Counts| {
            println!(
                "  {name:<11} {:>4} requests, {:>4} same, {:>4} unstable, {:>4} different",
                counts.total(),
                counts.same,
                counts.unstable,
                counts.different
            );
        };
        println!("summary:");
        let mut total = Counts::default();
        for (name, counts) in &self.groups {
            line(name, *counts);
            total = total.add(*counts);
        }
        line("total", total);
        for gap in &self.incomplete {
            println!("  incomplete: {gap}");
        }
        if passed(&self.groups, &self.incomplete) {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        }
    }
}

/// Invalid parameters, routing edge cases, the sign-in routes, and the client
/// build.
fn edge_cases() -> Vec<Probe> {
    let mut probes: Vec<Probe> = [
        "/healthz",
        "/api/games/new?size=0",
        "/api/games/new?size=121",
        "/api/games/new?offset=-1",
        "/api/games/new?size=abc",
        "/api/games/new?offset=1.5",
        "/api/games/new?size=1&size=2",
        "/api/games/search",
        "/api/games/search?q=",
        "/api/games/search?q=%20",
        "/api/games/search?q=a&size=51",
        "/api/games/browse",
        "/api/games/browse?genre=action&order=newest",
        "/api/games/browse?genre=ACTION&order=bad",
        "/api/games/%20",
        "/api/games/new/",
        "/api/games/genres/",
        "/api/nope",
        "/api/games/purchased",
        "/api/games/wishlist",
        "/assets/nope.js",
    ]
    .into_iter()
    .map(Probe::get)
    .collect();
    probes.extend([
        Probe::get("/api/nope").header(ACCEPT.as_str(), "text/html"),
        Probe::get("/").header(ACCEPT.as_str(), "text/html"),
        Probe::get("/g/1").header(ACCEPT.as_str(), "text/html"),
        Probe::get("/api/games/purchased").header(COOKIE.as_str(), "npsso="),
        Probe::new(Method::PUT, "/api/session"),
        Probe::new(Method::DELETE, "/api/session"),
        Probe::new(Method::POST, "/api/session")
            .header(CONTENT_TYPE.as_str(), "text/plain")
            .body("x"),
        Probe::new(Method::POST, "/api/session")
            .header(CONTENT_TYPE.as_str(), "application/json")
            .body("{not json"),
        Probe::new(Method::POST, "/api/session")
            .header(CONTENT_TYPE.as_str(), "application/json")
            .body("{}"),
    ]);
    probes
}

/// The first value of a header, or `None` when it is missing.
fn header(headers: &HeaderMap, name: reqwest::header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
}

/// The genre keys of a `/genres` answer, in its order.
fn genre_keys(answer: Option<&Answer>) -> Vec<String> {
    let Some(Value::Object(body)) = answer.and_then(Answer::json) else {
        return Vec::new();
    };
    let Some(Value::Array(genres)) = body.get("genres") else {
        return Vec::new();
    };
    genres
        .iter()
        .filter_map(|genre| genre.get("key")?.as_str().map(str::to_owned))
        .collect()
}

/// Up to `limit` distinct game ids from the list pages, one from each list in
/// turn. A turn order mixes the lists, so the sample has UPCOMING concept ids
/// and MONTHLY ids too.
fn sample_ids(pages: &[Option<Answer>], limit: usize) -> Vec<String> {
    let lists: Vec<Vec<String>> = pages
        .iter()
        .map(|page| {
            let Some(Value::Object(body)) = page.as_ref().and_then(Answer::json) else {
                return Vec::new();
            };
            let Some(Value::Array(games)) = body.get("games") else {
                return Vec::new();
            };
            games
                .iter()
                .filter_map(|game| game.get("id")?.as_str().map(str::to_owned))
                .collect()
        })
        .collect();
    let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
    let mut ids: Vec<String> = Vec::new();
    for index in 0..longest {
        for list in &lists {
            if let Some(id) = list.get(index)
                && !ids.contains(id)
                && ids.len() < limit
            {
                ids.push(id.clone());
            }
        }
    }
    ids
}

/// A query value in `application/x-www-form-urlencoded` form.
fn query_value(value: &str) -> String {
    form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// A path segment: each byte outside the unreserved set is percent-encoded.
fn path_segment(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// The differences between two answers, one line each.
fn differences(a: &Answer, b: &Answer) -> Vec<String> {
    let mut found = Vec::new();
    if a.status != b.status {
        found.push(format!("status: {} vs {}", a.status, b.status));
    }
    for (name, a_value, b_value) in [
        ("content-type", &a.content_type, &b.content_type),
        ("cache-control", &a.cache_control, &b.cache_control),
    ] {
        if a_value != b_value {
            found.push(format!("{name}: {a_value:?} vs {b_value:?}"));
        }
    }
    if a.set_cookie != b.set_cookie {
        found.push(format!(
            "set-cookie: {:?} vs {:?}",
            a.set_cookie, b.set_cookie
        ));
    }
    if a.body != b.body {
        found.push(format!("body: {}", body_difference(a, b)));
    }
    found
}

/// The first difference of two bodies that differ.
fn body_difference(a: &Answer, b: &Answer) -> String {
    match (a.json(), b.json()) {
        (Some(a_json), Some(b_json)) if a_json != b_json => {
            let (path, a_value, b_value) = first_json_difference("$", &a_json, &b_json);
            format!("{path}: {a_value} vs {b_value}")
        }
        // `serde_json` sorts the keys of a `Value`, so equal values can still
        // differ in the key order.
        (Some(_), Some(_)) => format!(
            "same JSON values, other bytes (key order or formatting); {}",
            byte_difference(&a.body, &b.body)
        ),
        _ => byte_difference(&a.body, &b.body),
    }
}

/// The first JSON path where two values differ, with a short form of both
/// values. The values must differ.
fn first_json_difference(path: &str, a: &Value, b: &Value) -> (String, String, String) {
    match (a, b) {
        (Value::Object(a_map), Value::Object(b_map)) => {
            let mut keys: Vec<&String> = a_map.keys().chain(b_map.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let child = format!("{path}.{key}");
                match (a_map.get(key), b_map.get(key)) {
                    (Some(a_value), Some(b_value)) if a_value != b_value => {
                        return first_json_difference(&child, a_value, b_value);
                    }
                    (Some(a_value), None) => return (child, short(a_value), "(absent)".into()),
                    (None, Some(b_value)) => return (child, "(absent)".into(), short(b_value)),
                    _ => {}
                }
            }
        }
        (Value::Array(a_items), Value::Array(b_items)) => {
            for (index, (a_item, b_item)) in a_items.iter().zip(b_items).enumerate() {
                if a_item != b_item {
                    return first_json_difference(&format!("{path}[{index}]"), a_item, b_item);
                }
            }
            return (
                format!("{path} length"),
                a_items.len().to_string(),
                b_items.len().to_string(),
            );
        }
        _ => {}
    }
    (path.to_owned(), short(a), short(b))
}

/// A JSON value in at most `SHORT` characters.
fn short(value: &Value) -> String {
    let text = value.to_string();
    if text.chars().count() <= SHORT {
        text
    } else {
        format!("{}…", text.chars().take(SHORT).collect::<String>())
    }
}

/// The first differing byte offset of two bodies and a short excerpt of each.
fn byte_difference(a: &[u8], b: &[u8]) -> String {
    let at = a
        .iter()
        .zip(b)
        .position(|(x, y)| x != y)
        .unwrap_or_else(|| a.len().min(b.len()));
    let excerpt = |bytes: &[u8]| {
        let start = at.saturating_sub(SHORT / 2);
        let end = (at + SHORT / 2).min(bytes.len());
        let text = String::from_utf8_lossy(bytes.get(start..end).unwrap_or_default());
        format!("{text:?}")
    };
    format!(
        "bytes differ at offset {at} (lengths {} vs {}): {} vs {}",
        a.len(),
        b.len(),
        excerpt(a),
        excerpt(b)
    )
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::VecDeque;

    use super::*;
    use Side::{A, B};

    fn answer(status: u16, body: &str) -> Answer {
        Answer {
            status,
            content_type: Some("application/json".into()),
            set_cookie: Vec::new(),
            cache_control: None,
            body: body.as_bytes().to_vec(),
        }
    }

    fn ok(body: &str) -> Exchange {
        Ok(answer(200, body))
    }

    /// Fake servers: each side answers from its own script, in order, and
    /// the fake records the side of every call.
    struct Script {
        a: RefCell<VecDeque<Exchange>>,
        b: RefCell<VecDeque<Exchange>>,
        calls: RefCell<Vec<Side>>,
    }

    impl Script {
        fn new(a: Vec<Exchange>, b: Vec<Exchange>) -> Self {
            Self {
                a: RefCell::new(a.into()),
                b: RefCell::new(b.into()),
                calls: RefCell::default(),
            }
        }

        fn calls(&self) -> Vec<Side> {
            self.calls.borrow().clone()
        }
    }

    impl Servers for Script {
        async fn send(&self, side: Side, _probe: &Probe) -> Exchange {
            self.calls.borrow_mut().push(side);
            let script = match side {
                Side::A => &self.a,
                Side::B => &self.b,
            };
            script
                .borrow_mut()
                .pop_front()
                .unwrap_or_else(|| Err("the script has no more answers".into()))
        }
    }

    fn probe() -> Probe {
        Probe::get("/api/games/search?q=lego")
    }

    #[tokio::test]
    async fn a_matching_pair_is_same_without_a_retry() {
        let servers = Script::new(vec![ok("1")], vec![ok("1")]);
        let (first_a, outcome) = check(&servers, &probe(), 3).await;
        assert_eq!(outcome, Outcome::Same);
        assert_eq!(first_a, Some(answer(200, "1")));
        assert_eq!(servers.calls(), vec![A, B]);
    }

    #[tokio::test]
    async fn a_pair_that_matches_on_a_retry_is_unstable_and_stops_there() {
        let servers = Script::new(
            vec![ok("1"), ok("2"), ok("3"), ok("4")],
            vec![ok("x"), ok("y"), ok("3"), ok("4")],
        );
        let (first_a, outcome) = check(&servers, &probe(), 3).await;
        assert_eq!(outcome, Outcome::Unstable { retry: 2 });
        // The first answer of server A feeds the genre and id samples.
        assert_eq!(first_a, Some(answer(200, "1")));
        assert_eq!(servers.calls(), vec![A, B, A, B, A, B]);
    }

    #[tokio::test]
    async fn a_pair_that_never_matches_is_a_difference_with_a_stable_server_a() {
        let servers = Script::new(vec![ok("1"); 5], vec![ok("2"); 4]);
        let (_, outcome) = check(&servers, &probe(), 3).await;
        assert_eq!(
            outcome,
            Outcome::Different {
                differences: vec!["body: $: 1 vs 2".into()],
                a_alone: AloneCheck::Unchanged,
            }
        );
        assert_eq!(servers.calls(), vec![A, B, A, B, A, B, A, B, A]);
    }

    #[tokio::test]
    async fn the_a_alone_check_reports_a_changed_answer_of_server_a() {
        let servers = Script::new(vec![ok("1"), ok("1"), ok("9")], vec![ok("2"), ok("2")]);
        let (_, outcome) = check(&servers, &probe(), 1).await;
        assert!(
            matches!(
                outcome,
                Outcome::Different {
                    a_alone: AloneCheck::Changed,
                    ..
                }
            ),
            "{outcome:?}"
        );
        assert_eq!(servers.calls(), vec![A, B, A, B, A]);
    }

    #[tokio::test]
    async fn repeat_zero_checks_server_a_alone_without_a_retry() {
        let servers = Script::new(vec![ok("1"), ok("1")], vec![ok("2")]);
        let (_, outcome) = check(&servers, &probe(), 0).await;
        assert!(
            matches!(
                outcome,
                Outcome::Different {
                    a_alone: AloneCheck::Unchanged,
                    ..
                }
            ),
            "{outcome:?}"
        );
        assert_eq!(servers.calls(), vec![A, B, A]);
    }

    #[tokio::test]
    async fn a_transport_error_is_never_a_match() {
        let refused = || -> Exchange { Err("connection refused".into()) };
        let servers = Script::new(
            vec![refused(), refused(), refused()],
            vec![refused(), refused()],
        );
        let (first_a, outcome) = check(&servers, &probe(), 1).await;
        assert_eq!(first_a, None);
        assert_eq!(
            outcome,
            Outcome::Different {
                differences: vec!["transport: connection refused vs connection refused".into()],
                a_alone: AloneCheck::NoAnswer,
            }
        );
    }

    #[test]
    fn reports_one_line_for_an_unstable_request() {
        assert!(report(&probe(), &Outcome::Same, 3).is_empty());
        assert_eq!(
            report(&probe(), &Outcome::Unstable { retry: 2 }, 3),
            vec!["UNSTABLE GET /api/games/search?q=lego: matched on retry 2 of 3"]
        );
    }

    #[test]
    fn reports_a_difference_with_the_server_a_check() {
        let outcome = Outcome::Different {
            differences: vec!["status: 200 vs 502".into()],
            a_alone: AloneCheck::Changed,
        };
        assert_eq!(
            report(&probe(), &outcome, 3),
            vec![
                "DIFF GET /api/games/search?q=lego",
                "     status: 200 vs 502",
                "     no retry of 3 matched; server A alone: another answer than its first answer (upstream noise)",
            ]
        );
    }

    #[test]
    fn only_a_remaining_difference_or_a_gap_fails_the_run() {
        let mut counts = Counts::default();
        counts.record(&Outcome::Same);
        counts.record(&Outcome::Unstable { retry: 1 });
        assert_eq!(
            counts,
            Counts {
                same: 1,
                unstable: 1,
                different: 0
            }
        );
        assert!(passed(&[("search", counts)], &[]));
        assert!(!passed(
            &[("search", counts)],
            &["browse: no genres".into()]
        ));
        counts.record(&Outcome::Different {
            differences: Vec::new(),
            a_alone: AloneCheck::Unchanged,
        });
        assert_eq!(counts.total(), 3);
        assert!(!passed(
            &[("lists", Counts::default()), ("search", counts)],
            &[]
        ));
    }

    #[test]
    fn equal_answers_have_no_difference() {
        assert!(differences(&answer(200, "{}"), &answer(200, "{}")).is_empty());
    }

    #[test]
    fn reports_status_headers_and_the_first_json_path() {
        let a = answer(200, r#"{"games":[{"id":"A","date":"x"}],"totalCount":1}"#);
        let mut b = answer(502, r#"{"games":[{"id":"A","date":"y"}],"totalCount":1}"#);
        b.set_cookie = vec!["npsso=; Max-Age=0".into()];
        b.cache_control = Some("no-cache".into());
        assert_eq!(
            differences(&a, &b),
            vec![
                "status: 200 vs 502",
                r#"cache-control: None vs Some("no-cache")"#,
                r#"set-cookie: [] vs ["npsso=; Max-Age=0"]"#,
                r#"body: $.games[0].date: "x" vs "y""#,
            ]
        );
    }

    #[test]
    fn reports_a_missing_key_and_an_array_length() {
        let a = answer(200, r#"{"a":1,"b":[1,2]}"#);
        assert_eq!(
            body_difference(&a, &answer(200, r#"{"b":[1,2]}"#)),
            "$.a: 1 vs (absent)"
        );
        assert_eq!(
            body_difference(&a, &answer(200, r#"{"a":1,"b":[1]}"#)),
            "$.b length: 2 vs 1"
        );
    }

    #[test]
    fn reports_a_key_order_difference_as_a_byte_offset() {
        let report = body_difference(
            &answer(200, r#"{"a":1,"b":2}"#),
            &answer(200, r#"{"b":2,"a":1}"#),
        );
        assert!(
            report.starts_with("same JSON values, other bytes"),
            "{report}"
        );
        assert!(report.contains("offset 2"), "{report}");
    }

    #[test]
    fn reports_a_non_json_body_as_a_short_excerpt() {
        let long = "x".repeat(500);
        let report = body_difference(
            &answer(200, &format!("{long}a")),
            &answer(200, &format!("{long}b")),
        );
        assert!(
            report.starts_with("bytes differ at offset 500 (lengths 501 vs 501)"),
            "{report}"
        );
        assert!(report.len() < 200, "{report}");
    }

    #[test]
    fn samples_ids_from_each_list_in_turn() {
        let page = |ids: &str| Some(answer(200, &format!(r#"{{"games":[{ids}]}}"#)));
        let pages = vec![
            page(r#"{"id":"N1"},{"id":"N2"},{"id":"N3"}"#),
            page(r#"{"id":"U1"},{"id":"N2"}"#),
            None,
            page(r#"{"id":"M1"}"#),
        ];
        assert_eq!(sample_ids(&pages, 10), vec!["N1", "U1", "M1", "N2", "N3"]);
        assert_eq!(sample_ids(&pages, 2), vec!["N1", "U1"]);
    }

    #[test]
    fn parses_two_bases_the_game_count_and_the_repeat_count() {
        let args = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let options = Options::parse(&args(&[
            "http://a/",
            "http://b",
            "--games",
            "5",
            "--repeat",
            "0",
        ]))
        .unwrap();
        assert_eq!(
            (
                options.base_a.as_str(),
                options.base_b.as_str(),
                options.games,
                options.repeat
            ),
            ("http://a", "http://b", 5, 0)
        );
        let defaults = Options::parse(&args(&["http://a", "http://b"])).unwrap();
        assert_eq!(
            (defaults.games, defaults.repeat),
            (DEFAULT_GAMES, DEFAULT_REPEAT)
        );
        assert!(Options::parse(&args(&["http://a"])).is_none());
        assert!(Options::parse(&args(&["http://a", "http://b", "--games"])).is_none());
        assert!(Options::parse(&args(&["http://a", "http://b", "--repeat", "-1"])).is_none());
        assert!(Options::parse(&args(&["http://a", "http://b", "--other"])).is_none());
    }

    #[test]
    fn encodes_query_values_and_path_segments() {
        assert_eq!(query_value("a b"), "a+b");
        assert_eq!(query_value("ö"), "%C3%B6");
        assert_eq!(query_value("MUSIC/RHYTHM"), "MUSIC%2FRHYTHM");
        assert_eq!(
            path_segment("EP0000-PPSA00000_00-X"),
            "EP0000-PPSA00000_00-X"
        );
        assert_eq!(path_segment("a b/c"), "a%20b%2Fc");
    }
}
