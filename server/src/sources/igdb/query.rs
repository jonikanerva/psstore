//! The body of the IGDB games query: the public title and a release-year
//! range, nothing else.

use icu_properties::CodePointMapData;
use icu_properties::props::{GeneralCategory, GeneralCategoryGroup};
use jiff::civil::{Date, Time};
use jiff::tz::Offset;

/// The number of candidates that one lookup reads.
pub const IGDB_CANDIDATE_LIMIT: u32 = 10;

/// The games query for a title released from the start of `year - 1` to the
/// end of `year + 1` (UTC), with the text of `buildGamesQuery` in
/// `server/src/igdb/igdbClient.ts`.
///
/// `None` when a range limit is outside the jiff timestamp range (about the
/// years -9999 to 9999). No IGDB game has such a date, so the caller can
/// answer with no candidates and skip the request.
pub fn games_query(title: &str, year: i32) -> Option<String> {
    let from = start_of_year_seconds(year.checked_sub(1)?)?;
    let to = start_of_year_seconds(year.checked_add(2)?)?;
    Some(format!(
        "search \"{}\"; \
         fields name,first_release_date,aggregated_rating,aggregated_rating_count; \
         where first_release_date >= {from} & first_release_date < {to}; \
         limit {IGDB_CANDIDATE_LIMIT};",
        quote_title(title)
    ))
}

/// The title inside the quoted string of the IGDB query language. A quote, a
/// backslash, or a control character would end the string early, so each one
/// becomes a space. The ends are trimmed like JavaScript `String.trim`.
pub fn quote_title(title: &str) -> String {
    let replaced: String = title
        .chars()
        .map(|c| {
            let code = u32::from(c);
            if c == '"' || c == '\\' || code < 0x20 || code == 0x7f {
                ' '
            } else {
                c
            }
        })
        .collect();
    let categories = CodePointMapData::<GeneralCategory>::new();
    replaced
        .trim_matches(|c| is_js_whitespace(c, categories.get(c)))
        .to_owned()
}

/// The `WhiteSpace` and `LineTerminator` code points of ECMAScript: the
/// space separators (`Zs`) and seven other code points. Rust `str::trim`
/// differs: it removes U+0085 and keeps U+FEFF.
fn is_js_whitespace(c: char, category: GeneralCategory) -> bool {
    matches!(
        c,
        '\t' | '\u{B}' | '\u{C}' | '\u{FEFF}' | '\n' | '\r' | '\u{2028}' | '\u{2029}'
    ) || GeneralCategoryGroup::SpaceSeparator.contains(category)
}

/// Seconds from the Unix epoch to 1 January of `year`, 00:00 UTC.
fn start_of_year_seconds(year: i32) -> Option<i64> {
    let date = Date::new(i16::try_from(year).ok()?, 1, 1).ok()?;
    let start = Offset::UTC
        .to_timestamp(date.to_datetime(Time::midnight()))
        .ok()?;
    Some(start.as_second())
}
