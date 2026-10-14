//! Whether a critic score candidate is the same game as a Sony game, and
//! whether its score is trustworthy.
//!
//! The rules are the rules of the TypeScript server
//! (`server/src/domain/criticMatch.ts`). The title normalisation repeats the
//! JavaScript string operations in the same order, because a different order
//! gives a different title (for example, NFKD turns `™` into `TM`). The
//! Unicode data comes from ICU4X 2.3 (ICU 78, Unicode 17), the same Unicode
//! version as the ICU of Node 24.21.

use icu_normalizer::DecomposingNormalizerBorrowed;
use icu_properties::CodePointMapData;
use icu_properties::props::{GeneralCategory, GeneralCategoryGroup};

use super::game::CriticScore;
use super::js::{parse_date_ms, utc_full_year};

/// A candidate needs at least this many critic reviews behind its score.
pub const MIN_CRITIC_COUNT: u64 = 3;

/// One game from the critic score provider, decoded and narrowed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CriticCandidate {
    pub name: String,
    /// The UTC calendar year of the first release. `None` when the provider
    /// has no usable date.
    pub release_year: Option<i32>,
    /// The critic score. `None` when the provider has no usable score.
    pub rating: Option<CriticScore>,
    /// The number of critic reviews behind the score. 0 when unknown.
    pub rating_count: u64,
}

/// A closed list. Each entry is a normalised trailing phrase of a Sony title
/// that names a store edition or a platform, not a different game. A remaster
/// or a director's cut is a different game and is not in this list.
const EDITION_SUFFIXES: [&str; 20] = [
    "ps5 edition",
    "playstation 5 edition",
    "ps5 version",
    "digital edition",
    "standard edition",
    "deluxe edition",
    "digital deluxe edition",
    "ultimate edition",
    "premium edition",
    "complete edition",
    "definitive edition",
    "special edition",
    "gold edition",
    "collectors edition",
    "game of the year edition",
    "goty edition",
    "ps4 ps5",
    "ps4 and ps5",
    "ps5",
    "playstation 5",
];

/// The critic score for a game, or `None`. A candidate is accepted only when
/// its normalised name equals the normalised title, its release year is
/// within one year of `year`, and its score comes from enough critic reviews.
/// Exactly one such candidate must exist: two are ambiguous.
#[must_use]
pub fn match_critic_score(
    title: &str,
    year: i32,
    candidates: &[CriticCandidate],
) -> Option<CriticScore> {
    let name = normalize_title(title);
    if name.is_empty() {
        return None;
    }
    // An edition entry often has the same normalised name as the base game.
    // Only a candidate with a trusted score takes part in the uniqueness check.
    let mut qualified = candidates.iter().filter(|candidate| {
        candidate
            .release_year
            .is_some_and(|release| (i64::from(release) - i64::from(year)).abs() <= 1)
            && candidate.rating.is_some()
            && candidate.rating_count >= MIN_CRITIC_COUNT
            && normalize_title(&candidate.name) == name
    });
    let only = qualified.next()?;
    match qualified.next() {
        Some(_) => None,
        None => only.rating,
    }
}

/// The title in lower case, without accents, punctuation, and edition
/// suffixes.
#[must_use]
pub fn normalize_title(name: &str) -> String {
    // 1. Remove the symbols before NFKD, which would turn `™` into `TM`.
    let without_symbols: String = name
        .chars()
        .filter(|c| !matches!(c, '™' | '®' | '©' | '\'' | '\u{2019}'))
        .collect();
    // 2. NFKD, then remove the combining diacritical marks U+0300 to U+036F.
    let decomposed = DecomposingNormalizerBorrowed::new_nfkd().normalize(&without_symbols);
    let without_marks: String = decomposed
        .chars()
        .filter(|c| !('\u{0300}'..='\u{036F}').contains(c))
        .collect();
    // 3. Lower case. Rust and JavaScript both use the full Unicode mapping,
    //    including the final sigma rule.
    let lower = without_marks.to_lowercase().replace('&', " and ");
    // 4. Each run of characters that are not a letter (`\p{L}`) or a number
    //    (`\p{N}`) becomes one space, then the ends are trimmed.
    let categories = CodePointMapData::<GeneralCategory>::new();
    let mut words = String::with_capacity(lower.len());
    let mut gap = false;
    for c in lower.chars() {
        let category = categories.get(c);
        if GeneralCategoryGroup::Letter.contains(category)
            || GeneralCategoryGroup::Number.contains(category)
        {
            if gap && !words.is_empty() {
                words.push(' ');
            }
            gap = false;
            words.push(c);
        } else {
            gap = true;
        }
    }
    strip_edition_suffixes(words)
}

/// Removes edition suffixes from the end, the longest match first, until no
/// suffix matches. A title that is only a suffix stays.
fn strip_edition_suffixes(mut current: String) -> String {
    loop {
        // Two different suffixes of one length cannot both end the title, so
        // the longest match is unique.
        let longest = EDITION_SUFFIXES
            .iter()
            .filter_map(|suffix| {
                let rest = current.strip_suffix(suffix)?.strip_suffix(' ')?;
                Some((suffix.len(), rest.len()))
            })
            .max_by_key(|(suffix_len, _)| *suffix_len);
        let Some((_, rest_len)) = longest else {
            return current;
        };
        current.truncate(rest_len);
        // The title has only letters, numbers, and single spaces here.
        let trimmed_len = current.trim_end_matches(' ').len();
        current.truncate(trimmed_len);
    }
}

/// The UTC year of a date string: JavaScript
/// `new Date(Date.parse(date)).getUTCFullYear()`. `None` for an empty or
/// unparseable value.
///
/// `Game.date` holds the date text of the Sony mapper (STACK.md §10). Sony
/// sends `YYYY-MM-DDTHH:mm:ssZ`. A normalised date has milliseconds, and a
/// missing date is the empty string. The year is the calendar year of the
/// instant in UTC, so `2024-01-01T00:30:00+01:00` is 2023. The parse is
/// `js::parse_date_ms`, so its documented differences from V8 apply here too.
#[must_use]
pub fn release_year_of(date: &str) -> Option<i32> {
    parse_date_ms(date).and_then(utc_full_year)
}

#[cfg(test)]
mod tests;
