//! The committed API examples in `docs/contracts/api/` against the Rust
//! domain types and the HTTP error mapping.
//!
//! The test builds each example value with the public domain types and gets
//! the body from an HTTP response, like the server does: `axum::Json` for a
//! payload and `IntoResponse` of the domain error for an error.
//!
//! How the comparison works: `serde_json` has no `preserve_order` feature in
//! this crate, so a `serde_json::Value` sorts the keys of an object, and a
//! comparison of two values ignores the key order. The TypeScript server
//! writes the keys in schema order, and the port keeps that order. The test
//! therefore compares text. It removes the white space outside string
//! literals from the example file, which Prettier formats, and compares the
//! result with the response body byte for byte. This checks the values, the
//! key order of every object, and the escapes. The examples write non-ASCII
//! characters raw and escape only `"` and `\`, like `serde_json` and
//! `JSON.stringify`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use psstore_server::domain::errors::{AccountError, GameLookupError, UpstreamError};
use psstore_server::domain::game::{
    CriticScore, Game, GameDetail, Genre, GenreList, IdKind, PageResult, PlusOffer,
};
use psstore_server::http::errors::ErrorResponse;
use serde::Serialize;

/// Every example file. Each one has a case in `render`.
const EXAMPLES: [&str; 11] = [
    "page-first.json",
    "page-last.json",
    "game-detail-plus-price.json",
    "game-detail-plus-included.json",
    "genres.json",
    "error-game-not-found.json",
    "error-upstream-unavailable.json",
    "error-upstream-query-rotated.json",
    "error-upstream-rate-limited.json",
    "error-upstream-rate-limited-retry-after.json",
    "error-session-rejected.json",
];

fn examples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/contracts/api")
}

fn read_example(name: &str) -> Result<String, String> {
    let path = examples_dir().join(name);
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The JSON text without the white space outside string literals. String
/// literals stay verbatim, including their escapes.
fn compact(json: &str) -> String {
    let mut out = String::with_capacity(json.len());
    let mut in_string = false;
    let mut escaped = false;
    for c in json.chars() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
            out.push(c);
        } else if !matches!(c, ' ' | '\t' | '\n' | '\r') {
            out.push(c);
        }
    }
    out
}

/// A short report of the first byte where two texts differ, or `None` when
/// they are equal.
fn first_difference(expected: &str, actual: &str) -> Option<String> {
    if expected == actual {
        return None;
    }
    let at = expected
        .bytes()
        .zip(actual.bytes())
        .position(|(e, a)| e != a)
        .unwrap_or_else(|| expected.len().min(actual.len()));
    let excerpt = |text: &str| {
        let bytes = text.as_bytes();
        let start = at.saturating_sub(40);
        let end = (at + 40).min(bytes.len());
        String::from_utf8_lossy(bytes.get(start..end).unwrap_or_default()).into_owned()
    };
    Some(format!(
        "first difference at byte {at}\n  expected …{}…\n  actual   …{}…",
        excerpt(expected),
        excerpt(actual)
    ))
}

// ---- The example values ------------------------------------------------------

const IMAGE: &str = "https://image.api.playstation.com/vulcan/ap/rnd";
const VIDEO: &str = "https://vulcan.dl.playstation.net/img/rnd";

/// A product card with empty optional fields.
fn card(id: &str, name: &str) -> Game {
    Game {
        id: id.into(),
        name: name.into(),
        date: String::new(),
        url: String::new(),
        price: String::new(),
        original_price: String::new(),
        discount_text: String::new(),
        discount_date: String::new(),
        screenshots: vec![],
        videos: vec![],
        genres: vec![],
        description: String::new(),
        studio: String::new(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: None,
        id_kind: IdKind::Product,
    }
}

fn harvest_moon() -> Game {
    Game {
        date: "2026-10-14T21:00:00Z".into(),
        url: format!("{IMAGE}/202607/2917/9e9c256f6e3617337ef6e294bac57308cbe9fc3b1d74e17b.png"),
        price: "€49,95".into(),
        screenshots: vec![format!(
            "{IMAGE}/202607/2917/07cddd7c53a70a501f4a95fbea1b7956f581912c747265df.jpg"
        )],
        videos: vec![format!(
            "{VIDEO}/202608/3118/5fad16b3c860f21a54a759b11115d591a1364849b575345a.mp4"
        )],
        ..card(
            "UP1014-PPSA36628_00-HMEOT000000PS5US",
            "Harvest Moon®: Echoes of Teradea",
        )
    }
}

/// The list card of Bluey's Happy Snaps. The game page adds more fields.
fn bluey_card() -> Game {
    Game {
        date: "2026-10-14T21:00:00Z".into(),
        url: format!("{IMAGE}/202603/1308/9f1c36cf60ea5683ea2e3e0bdcf1d36c1b85ae3ad2beb6e4.png"),
        price: "€54,95".into(),
        screenshots: vec![format!(
            "{IMAGE}/202609/0907/3dba1d44ca1a3e66ce91a5bc35f8de0c1a700f161b6a61b7.jpg"
        )],
        videos: vec![format!(
            "{VIDEO}/202609/0915/4cfebad7f447b0b960fa27395118433c322aaccac7961a49.mp4"
        )],
        plus_upsell_text: Some("Save 25%".into()),
        ..card(
            "EP2006-PPSA33218_00-BLUEYDELUXEBUNDL",
            "Bluey's Happy Snaps",
        )
    }
}

fn hasbro_concept() -> Game {
    Game {
        url: format!("{IMAGE}/202606/0811/f838af98d46e433ae70645e0a84387cd529c3bf6feccd0ce.png"),
        screenshots: vec![format!(
            "{IMAGE}/202609/2908/88b420a1eac0bbc834314f4b23dba780a41d622c71d4729c.jpg"
        )],
        videos: vec![format!(
            "{VIDEO}/202610/1308/440e593b4c555a70ec37176de51d64df7d8b993d901deca9.mp4"
        )],
        id_kind: IdKind::Concept,
        ..card("10018611", "Hasbro Games™ Junior Collection")
    }
}

fn elta_pre_order() -> Game {
    Game {
        date: "2027-02-02T16:00:00.000Z".into(),
        url: format!("{IMAGE}/202608/0313/80e58adfa088392c42c06b1f8d24065fdee9fa47fa391593.png"),
        price: "€29,95".into(),
        screenshots: vec![format!(
            "{IMAGE}/202608/0412/6695bf6843e89eb26cdbe7cbf7202d884878da9abee422ef.jpg"
        )],
        videos: vec![format!(
            "{VIDEO}/202610/0116/b676b4785cf0e77258eaf5327cf470ec0cfd541a6464d93e.mp4"
        )],
        genres: vec!["Action".into()],
        pre_order: true,
        ..card(
            "EP4133-PPSA21224_00-ELTAGAME00000000",
            "Elta: Defy All Gods",
        )
    }
}

fn lego_batman_discounted() -> Game {
    Game {
        date: "2026-05-21T21:00:00Z".into(),
        url: format!("{IMAGE}/202508/1316/3302f35b66691aa405aee31624c0c95fe73081be8e0c75bb.png"),
        price: "€48,96".into(),
        original_price: "€69,95".into(),
        discount_text: "-30%".into(),
        screenshots: vec![format!(
            "{IMAGE}/202508/1316/5fb613721742ce88aa29e8322e62657edc5e28178458c95a.jpg"
        )],
        videos: vec![format!(
            "{VIDEO}/202605/2214/0d7b4b58dff80865a61d74ecae50dcdcc20725e46ce824bf.mp4"
        )],
        genres: vec!["Action".into()],
        plus_upsell_text: Some("Premium".into()),
        ..card(
            "UP1018-PPSA16833_00-LEGOBATMAN000000",
            "LEGO® Batman™: Legacy of the Dark Knight",
        )
    }
}

fn bluey_detail() -> GameDetail {
    GameDetail {
        game: Game {
            genres: vec!["Adventure".into(), "Fantasy".into()],
            description: concat!(
                r#"<b><font color="orange">PRE-ORDER – IMMEDIATE PAYMENT REQUIRED</font></b>"#,
                r#"<br><br/><br/>Game Content:<br/>- "Here Come the Grannies" bonus digital content<br/>"#
            )
            .into(),
            studio: "Gameloft SE".into(),
            plus_offer: Some(PlusOffer::Price {
                price: "€41,21".into(),
            }),
            ..bluey_card()
        },
        critic_score: CriticScore::new(87),
    }
}

fn f1_detail() -> GameDetail {
    GameDetail {
        game: Game {
            date: "2025-05-30T15:00:00Z".into(),
            url: format!(
                "{IMAGE}/202505/1521/44c15449fbe9485987e27e2fa2c86008a7b4a89d9ab7e0a8.png"
            ),
            genres: vec!["Driving/Racing".into()],
            description: concat!(
                "This Story is Yours. Leave your mark on the world of racing in F1® 25, ",
                "the official video game of the 2025 FIA Formula One World Championship™<br/><br/>"
            )
            .into(),
            studio: "EA Swiss Sarl".into(),
            plus_offer: Some(PlusOffer::Included),
            ..card("UP0006-PPSA24662_00-F12025PS5GAME000", "F1® 25")
        },
        critic_score: None,
    }
}

fn genres() -> GenreList {
    let genre = |key: &str, name: &str| Genre {
        key: key.into(),
        name: name.into(),
    };
    GenreList {
        genres: vec![
            genre("ACTION", "Action"),
            genre("FOOTBALL", "American Football"),
            genre("RACING", "Driving/Racing"),
            genre("MUSIC/RHYTHM", "Music/Rhythm"),
            genre("ROLE_PLAYING_GAMES", "Role Playing Games"),
        ],
    }
}

const RATE_LIMITED: &str = "Sony upstream rate limited the request (HTTP 429)";

/// The response that the server gives for an example, or `None` for an
/// unknown file name.
fn render(name: &str) -> Option<Response> {
    #[expect(
        clippy::unnecessary_wraps,
        reason = "each arm of the match below gives an optional response"
    )]
    fn json(value: impl Serialize) -> Option<Response> {
        Some(axum::Json(value).into_response())
    }
    match name {
        "page-first.json" => json(PageResult {
            games: vec![harvest_moon(), bluey_card(), hasbro_concept()],
            total_count: 5,
            next_offset: Some(3),
        }),
        "page-last.json" => json(PageResult {
            games: vec![elta_pre_order(), lego_batman_discounted()],
            total_count: 5,
            next_offset: None,
        }),
        "game-detail-plus-price.json" => json(bluey_detail()),
        "game-detail-plus-included.json" => json(f1_detail()),
        "genres.json" => json(genres()),
        "error-game-not-found.json" => Some(
            GameLookupError::NotFound {
                id: "EP0000-PPSA00000_00-UNKNOWNGAME00000".into(),
            }
            .into_error_response(),
        ),
        "error-upstream-unavailable.json" => {
            Some(UpstreamError::unavailable("Sony upstream unavailable").into_error_response())
        }
        "error-upstream-query-rotated.json" => Some(
            UpstreamError::QueryRotated {
                message:
                    "Sony rejected the persisted query (hash rotated); re-run pnpm sony:refresh"
                        .into(),
                operation_name: "categoryGridRetrieve".into(),
            }
            .into_error_response(),
        ),
        "error-upstream-rate-limited.json" => Some(
            UpstreamError::RateLimited {
                message: RATE_LIMITED.into(),
                retry_after_seconds: None,
            }
            .into_error_response(),
        ),
        "error-upstream-rate-limited-retry-after.json" => Some(
            UpstreamError::RateLimited {
                message: RATE_LIMITED.into(),
                retry_after_seconds: Some(30),
            }
            .into_error_response(),
        ),
        "error-session-rejected.json" => {
            Some(AccountError::session_rejected("Not signed in").into_error_response())
        }
        _ => None,
    }
}

/// The status of each example, from the README table and the TypeScript
/// `HttpApi` definition (`server/src/api/gamesApi.ts`).
fn expected_status(name: &str) -> StatusCode {
    match name {
        "error-game-not-found.json" => StatusCode::NOT_FOUND,
        "error-upstream-unavailable.json" | "error-upstream-query-rotated.json" => {
            StatusCode::BAD_GATEWAY
        }
        "error-upstream-rate-limited.json" | "error-upstream-rate-limited-retry-after.json" => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        "error-session-rejected.json" => StatusCode::UNAUTHORIZED,
        _ => StatusCode::OK,
    }
}

#[tokio::test]
async fn every_example_matches_the_rust_response() {
    let mut failures = Vec::new();
    for name in EXAMPLES {
        let Some(response) = render(name) else {
            failures.push(format!("{name}: no case in render()"));
            continue;
        };
        let status = response.status();
        if status != expected_status(name) {
            failures.push(format!(
                "{name}: status {status}, expected {}",
                expected_status(name)
            ));
        }
        let content_type = response.headers().get(CONTENT_TYPE).cloned();
        if content_type.as_ref().and_then(|v| v.to_str().ok()) != Some("application/json") {
            failures.push(format!("{name}: content-type {content_type:?}"));
        }
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let actual = String::from_utf8(bytes.to_vec()).unwrap();
        let expected = compact(&read_example(name).unwrap());
        if let Some(difference) = first_difference(&expected, &actual) {
            failures.push(format!("{name}: {difference}"));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn the_directory_and_the_readme_list_exactly_the_examples() {
    let listed: BTreeSet<String> = EXAMPLES.iter().map(|name| (*name).to_owned()).collect();

    let in_directory: BTreeSet<String> = std::fs::read_dir(examples_dir())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| Path::new(name).extension().is_some_and(|ext| ext == "json"))
        .collect();
    assert_eq!(in_directory, listed, "the directory and EXAMPLES differ");

    // The first cell of each table row names one example: | `name.json` | …
    let readme = read_example("README.md").unwrap();
    let in_readme: BTreeSet<String> = readme
        .lines()
        .filter_map(|line| line.strip_prefix("| `"))
        .filter_map(|rest| rest.split_once('`'))
        .map(|(name, _)| name.to_owned())
        .collect();
    assert_eq!(in_readme, listed, "the README table and EXAMPLES differ");
}

#[test]
fn compact_keeps_string_literals_verbatim() {
    assert_eq!(
        compact("{ \"a b\": [1, \"x \\\" y\"],\n  \"c\": null }"),
        r#"{"a b":[1,"x \" y"],"c":null}"#
    );
    assert_eq!(compact(r#"{ "k": "\\" }"#), r#"{"k":"\\"}"#);
}

#[test]
fn first_difference_reports_the_byte_offset() {
    assert_eq!(first_difference("abc", "abc"), None);
    let report = first_difference(r#"{"a":1,"b":2}"#, r#"{"b":2,"a":1}"#).unwrap();
    assert!(report.starts_with("first difference at byte 2"), "{report}");
    let report = first_difference("ab", "abc").unwrap();
    assert!(report.starts_with("first difference at byte 2"), "{report}");
}
