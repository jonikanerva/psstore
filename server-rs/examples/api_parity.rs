//! The API parity check: it sends the same requests to two running servers
//! and compares the answers.
//!
//! ```text
//! cargo run --locked --example api_parity -- <base A> <base B> [--games N]
//! cargo run --locked --example api_parity -- http://127.0.0.1:3456 http://127.0.0.1:3000
//! ```
//!
//! For each request the tool calls server A and right after it server B. It
//! compares the status, the `content-type`, `set-cookie`, and `cache-control`
//! headers, and the exact body bytes. For a difference it prints the request
//! and the first difference, for example the first differing JSON path with
//! two short values. It never prints a whole body. At the end it prints a
//! summary. The exit code is 0 when all answers are the same, 1 on a
//! difference or an incomplete run, and 2 on a usage error.
//!
//! Server A is the reference. The browse genres and the game ids come from
//! the answers of server A.
//!
//! The tool never sends an NPSSO. The signed-in requests send no cookie or an
//! empty cookie. The sign-in requests send bodies that fail validation before
//! the server calls Sony.
//!
//! Upstream data can change between the two calls of a request, for example
//! when a cache entry expires. Run the tool against one server twice to see
//! this noise floor.

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
        eprintln!("usage: api_parity <base A> <base B> [--games N]");
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
    println!("api_parity: A = {}, B = {}", options.base_a, options.base_b);
    let mut run = Run {
        client,
        options,
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
}

impl Options {
    fn parse(args: &[String]) -> Option<Self> {
        let mut bases = Vec::new();
        let mut games = DEFAULT_GAMES;
        let mut rest = args.iter();
        while let Some(arg) = rest.next() {
            if arg == "--games" {
                games = rest.next()?.parse().ok()?;
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
#[derive(Debug, PartialEq, Eq)]
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

/// The result counts of one group of requests.
struct Group {
    name: &'static str,
    same: usize,
    different: usize,
}

struct Run {
    client: Client,
    options: Options,
    groups: Vec<Group>,
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

        let ids = sample_ids(&list_pages, self.options.games);
        if ids.is_empty() && self.options.games > 0 {
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

    /// Sends one request to both servers, records the result, and reports a
    /// difference. Returns the answer of server A.
    async fn compare(&mut self, group: &'static str, probe: &Probe) -> Option<Answer> {
        let a = self.send(&self.options.base_a, probe).await;
        let b = self.send(&self.options.base_b, probe).await;
        let differences = match (&a, &b) {
            (Ok(a), Ok(b)) => differences(a, b),
            (a, b) => vec![format!(
                "transport: {} vs {}",
                a.as_ref()
                    .map_or_else(Clone::clone, |_| "answer".to_owned()),
                b.as_ref()
                    .map_or_else(Clone::clone, |_| "answer".to_owned()),
            )],
        };
        let index = match self.groups.iter().position(|g| g.name == group) {
            Some(index) => index,
            None => {
                self.groups.push(Group {
                    name: group,
                    same: 0,
                    different: 0,
                });
                self.groups.len() - 1
            }
        };
        if let Some(counts) = self.groups.get_mut(index) {
            if differences.is_empty() {
                counts.same += 1;
            } else {
                counts.different += 1;
            }
        }
        if !differences.is_empty() {
            println!("DIFF {}", probe.label());
            for difference in differences {
                println!("     {difference}");
            }
        }
        a.ok()
    }

    async fn send(&self, base: &str, probe: &Probe) -> Result<Answer, String> {
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

    fn summary(&self) -> ExitCode {
        let (mut same, mut different) = (0, 0);
        println!("summary:");
        for group in &self.groups {
            println!(
                "  {:<11} {:>4} requests, {:>4} same, {:>4} different",
                group.name,
                group.same + group.different,
                group.same,
                group.different
            );
            same += group.same;
            different += group.different;
        }
        println!(
            "  {:<11} {:>4} requests, {same:>4} same, {different:>4} different",
            "total",
            same + different
        );
        for gap in &self.incomplete {
            println!("  incomplete: {gap}");
        }
        if different == 0 && self.incomplete.is_empty() {
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
    use super::*;

    fn answer(status: u16, body: &str) -> Answer {
        Answer {
            status,
            content_type: Some("application/json".into()),
            set_cookie: Vec::new(),
            cache_control: None,
            body: body.as_bytes().to_vec(),
        }
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
    fn parses_two_bases_and_the_game_count() {
        let args = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let options = Options::parse(&args(&["http://a/", "http://b", "--games", "5"])).unwrap();
        assert_eq!(
            (
                options.base_a.as_str(),
                options.base_b.as_str(),
                options.games
            ),
            ("http://a", "http://b", 5)
        );
        assert_eq!(
            Options::parse(&args(&["http://a", "http://b"]))
                .unwrap()
                .games,
            DEFAULT_GAMES
        );
        assert!(Options::parse(&args(&["http://a"])).is_none());
        assert!(Options::parse(&args(&["http://a", "http://b", "--games"])).is_none());
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
