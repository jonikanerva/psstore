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
use jiff::civil::{Date, Time};
use jiff::tz::Offset;
use jiff::{SignedDuration, Timestamp};

use super::game::CriticScore;

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

/// The UTC year of a date string, with the result of JavaScript `Date.parse`.
/// `None` for an empty or unparseable value.
///
/// `Game.date` is the output of the Sony mapper: a UTC ISO-8601 string with
/// `Z`, or the empty string. This function reads the ECMAScript date time
/// string format and the variants of it that V8 also accepts (lower-case `t`
/// and `z`, a space for `T`, any number of fraction digits, an offset without
/// a colon, day 29 to 31 of any month, and `24:00`). It returns `None` where
/// V8 reads a local time (a date and time without an offset) or uses its
/// legacy parser (for example `Nov 14 2023`), because the server has no time
/// zone of its own (STACK.md §12). It also returns `None` outside the jiff
/// timestamp range (about the years -9999 to 9999).
pub fn release_year_of(date: &str) -> Option<i32> {
    let parts = parse_date_time(date)?;
    let first_of_month = Date::new(parts.year, parts.month, 1).ok()?;
    let start = parts
        .offset
        .to_timestamp(first_of_month.to_datetime(Time::midnight()))
        .ok()?;
    // V8 lets day 29 to 31 and hour 24 roll over into the next month or day.
    let elapsed = SignedDuration::from_hours(24 * (i64::from(parts.day) - 1))
        .checked_add(SignedDuration::from_hours(i64::from(parts.hour)))?
        .checked_add(SignedDuration::from_mins(i64::from(parts.minute)))?
        .checked_add(SignedDuration::from_secs(i64::from(parts.second)))?
        .checked_add(SignedDuration::from_millis(i64::from(parts.millisecond)))?;
    let instant: Timestamp = start.checked_add(elapsed).ok()?;
    Some(i32::from(Offset::UTC.to_datetime(instant).year()))
}

/// The fields of a date time string.
struct DateTimeParts {
    year: i16,
    month: i8,
    day: i8,
    hour: u8,
    minute: u8,
    second: u8,
    millisecond: u16,
    offset: Offset,
}

/// Parses `YYYY[-MM[-DD]][THH:mm[:ss[.s…]]][Z|±HH:mm|±HHmm]` and the
/// `±YYYYYY` year form. A time needs an offset; a date alone is UTC.
fn parse_date_time(text: &str) -> Option<DateTimeParts> {
    let mut cursor = Cursor(text.as_bytes());
    let year = cursor.year()?;
    let mut month = 1;
    let mut day = 1;
    if cursor.eat(b'-') {
        month = cursor.number_in(2, 1, 12)?;
        if cursor.eat(b'-') {
            day = cursor.number_in(2, 1, 31)?;
        }
    }
    let (mut hour, mut minute, mut second, mut millisecond) = (0, 0, 0, 0);
    let has_time = cursor.eat_any(b"Tt ");
    if has_time {
        hour = cursor.number_in(2, 0, 24)?;
        if !cursor.eat(b':') {
            return None;
        }
        minute = cursor.number_in(2, 0, 59)?;
        if cursor.eat(b':') {
            second = cursor.number_in(2, 0, 59)?;
            if cursor.eat(b'.') {
                millisecond = cursor.fraction_millis()?;
            }
        }
        if hour == 24 && (minute, second, millisecond) != (0, 0, 0) {
            return None;
        }
    }
    let offset = match cursor.offset()? {
        Some(offset) => offset,
        None if has_time => return None,
        None => Offset::UTC,
    };
    if !cursor.0.is_empty() {
        return None;
    }
    Some(DateTimeParts {
        year,
        month: i8::try_from(month).ok()?,
        day: i8::try_from(day).ok()?,
        hour: u8::try_from(hour).ok()?,
        minute: u8::try_from(minute).ok()?,
        second: u8::try_from(second).ok()?,
        millisecond,
        offset,
    })
}

/// The unread rest of an ASCII date string.
struct Cursor<'a>(&'a [u8]);

impl Cursor<'_> {
    fn eat(&mut self, byte: u8) -> bool {
        self.eat_any(&[byte])
    }

    fn eat_any(&mut self, bytes: &[u8]) -> bool {
        match self.0.split_first() {
            Some((first, rest)) if bytes.contains(first) => {
                self.0 = rest;
                true
            }
            _ => false,
        }
    }

    /// Exactly `count` ASCII digits.
    fn digits(&mut self, count: usize) -> Option<u32> {
        let (head, rest) = self.0.split_at_checked(count)?;
        let mut value = 0_u32;
        for byte in head {
            if !byte.is_ascii_digit() {
                return None;
            }
            value = value * 10 + u32::from(byte - b'0');
        }
        self.0 = rest;
        Some(value)
    }

    fn number_in(&mut self, count: usize, min: u32, max: u32) -> Option<u32> {
        self.digits(count)
            .filter(|value| (min..=max).contains(value))
    }

    /// Four digits, or a sign and six digits. `-000000` is not a year.
    fn year(&mut self) -> Option<i16> {
        let value = if self.eat(b'+') {
            i64::from(self.digits(6)?)
        } else if self.eat(b'-') {
            let magnitude = self.digits(6)?;
            if magnitude == 0 {
                return None;
            }
            -i64::from(magnitude)
        } else {
            i64::from(self.digits(4)?)
        };
        i16::try_from(value).ok()
    }

    /// One or more fraction digits. V8 keeps the first three and drops the
    /// rest without rounding.
    fn fraction_millis(&mut self) -> Option<u16> {
        let count = self.0.iter().take_while(|b| b.is_ascii_digit()).count();
        if count == 0 {
            return None;
        }
        let (digits, rest) = self.0.split_at(count);
        let mut millis = 0_u16;
        for place in 0..3 {
            let digit = digits.get(place).map_or(0, |b| b - b'0');
            millis = millis * 10 + u16::from(digit);
        }
        self.0 = rest;
        Some(millis)
    }

    /// `Z`, `z`, `±HH:mm`, or `±HHmm`. `Some(None)` when no offset follows.
    fn offset(&mut self) -> Option<Option<Offset>> {
        if self.eat_any(b"Zz") {
            return Some(Some(Offset::UTC));
        }
        let sign = if self.eat(b'+') {
            1
        } else if self.eat(b'-') {
            -1
        } else {
            return Some(None);
        };
        let hours = self.number_in(2, 0, 23)?;
        self.eat(b':');
        let minutes = self.number_in(2, 0, 59)?;
        let seconds = i32::try_from(hours * 3600 + minutes * 60).ok()?;
        Offset::from_seconds(sign * seconds).ok().map(Some)
    }
}

#[cfg(test)]
mod tests;
