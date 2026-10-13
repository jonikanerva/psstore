//! JavaScript semantics that the TypeScript server relied on: `Date.parse`,
//! `Date.prototype.toISOString`, `String.prototype.trim`, and
//! `localeCompare(…, 'en')`.
//!
//! The API output must be the same as on the TypeScript server, so these
//! functions follow the V8 behaviour that was observed with Node 24. Each
//! function documents the inputs that it does not port.

use std::cmp::Ordering;

use jiff::Span;
use jiff::Timestamp;
use jiff::civil::{Date, DateTime};
use jiff::tz::Offset;

/// `Date.parse(text)`: the epoch milliseconds, or `None` where JavaScript
/// gives `NaN`.
///
/// The port covers the ECMAScript date time string format with the V8
/// leniencies that Node 24 shows:
///
/// - `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`; also `±YYYYYY` (`-000000` is
///   invalid).
/// - An optional time after `T`, `t`, or a space: `HH:mm`, `HH:mm:ss`, or
///   `HH:mm:ss.f…`. Fraction digits after the third are dropped.
/// - An optional offset: `Z`, `z`, `±HH:mm`, or `±HHmm`.
/// - A day up to 31 rolls over into the next month (`2024-02-30` is
///   2024-03-01), and `24:00` is the start of the next day.
///
/// Not ported, so these give `None` here and a value in V8: the legacy forms
/// such as `2024/06/15`, `June 15, 2024`, and RFC 2822 dates, and instants
/// outside the `jiff` timestamp range (about -9999-01-02 to 9999-12-30). V8 reads a date with a time but without an offset
/// as local time. This port reads it as UTC, which is the time zone of the
/// production host. Sony sends `YYYY-MM-DDTHH:mm:ssZ`.
#[must_use]
pub fn parse_date_ms(text: &str) -> Option<i64> {
    let mut cursor = Cursor {
        bytes: text.as_bytes(),
        at: 0,
    };
    let year = cursor.year()?;
    let mut month = 1;
    let mut day = 1;
    if cursor.eat(b'-') {
        month = cursor.digits(2)?;
        if cursor.eat(b'-') {
            day = cursor.digits(2)?;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let (mut hour, mut minute, mut second, mut millisecond) = (0, 0, 0, 0);
    if cursor.eat_any(b"Tt ") {
        hour = cursor.digits(2)?;
        cursor.expect(b':')?;
        minute = cursor.digits(2)?;
        if cursor.eat(b':') {
            second = cursor.digits(2)?;
            if cursor.eat(b'.') {
                millisecond = cursor.fraction_ms()?;
            }
        }
    }
    let offset_seconds = cursor.offset()?;
    if !cursor.done() {
        return None;
    }
    let end_of_day = hour == 24 && minute == 0 && second == 0 && millisecond == 0;
    if (hour > 23 && !end_of_day) || minute > 59 || second > 59 {
        return None;
    }

    let mut date = Date::new(i16::try_from(year).ok()?, i8::try_from(month).ok()?, 1)
        .ok()?
        .checked_add(Span::new().days(day - 1))
        .ok()?;
    if end_of_day {
        date = date.checked_add(Span::new().days(1)).ok()?;
        hour = 0;
    }
    let datetime = DateTime::new(
        date.year(),
        date.month(),
        date.day(),
        i8::try_from(hour).ok()?,
        i8::try_from(minute).ok()?,
        i8::try_from(second).ok()?,
        i32::try_from(millisecond).ok()? * 1_000_000,
    )
    .ok()?;
    let offset = Offset::from_seconds(offset_seconds).ok()?;
    Some(offset.to_timestamp(datetime).ok()?.as_millisecond())
}

/// `new Date(ms).toISOString()`: always with milliseconds and `Z`. A year
/// outside 0 to 9999 has a sign and six digits, like in JavaScript.
#[must_use]
pub fn to_iso_string(ms: i64) -> Option<String> {
    let timestamp = Timestamp::from_millisecond(ms).ok()?;
    let dt = Offset::UTC.to_datetime(timestamp);
    let year = i32::from(dt.year());
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", year.unsigned_abs())
    } else {
        format!("+{year:06}")
    };
    Some(format!(
        "{year}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        dt.month(),
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second(),
        dt.millisecond()
    ))
}

/// A cursor over the ASCII bytes of a date string.
struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Cursor<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn eat(&mut self, byte: u8) -> bool {
        self.eat_any(&[byte])
    }

    fn eat_any(&mut self, options: &[u8]) -> bool {
        match self.peek() {
            Some(byte) if options.contains(&byte) => {
                self.at += 1;
                true
            }
            _ => false,
        }
    }

    fn expect(&mut self, byte: u8) -> Option<()> {
        self.eat(byte).then_some(())
    }

    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }

    /// Exactly `count` ASCII digits.
    fn digits(&mut self, count: usize) -> Option<i64> {
        let mut value = 0_i64;
        for _ in 0..count {
            let byte = self.peek().filter(u8::is_ascii_digit)?;
            value = value * 10 + i64::from(byte - b'0');
            self.at += 1;
        }
        Some(value)
    }

    /// `YYYY`, or a sign and six digits. `-000000` is invalid.
    fn year(&mut self) -> Option<i64> {
        match self.peek() {
            Some(b'+') => {
                self.at += 1;
                self.digits(6)
            }
            Some(b'-') => {
                self.at += 1;
                let value = self.digits(6)?;
                (value != 0).then_some(-value)
            }
            _ => self.digits(4),
        }
    }

    /// One or more fraction digits as milliseconds. Digits after the third
    /// are dropped, not rounded.
    fn fraction_ms(&mut self) -> Option<i64> {
        let mut value = 0_i64;
        let mut count = 0;
        while let Some(byte) = self.peek().filter(u8::is_ascii_digit) {
            if count < 3 {
                value = value * 10 + i64::from(byte - b'0');
            }
            count += 1;
            self.at += 1;
        }
        match count {
            0 => None,
            1 => Some(value * 100),
            2 => Some(value * 10),
            _ => Some(value),
        }
    }

    /// The offset in seconds east of UTC: `Z`, `z`, `±HH:mm`, `±HHmm`, or
    /// none (0).
    fn offset(&mut self) -> Option<i32> {
        if self.eat_any(b"Zz") {
            return Some(0);
        }
        let sign = match self.peek() {
            Some(b'+') => 1,
            Some(b'-') => -1,
            _ => return Some(0),
        };
        self.at += 1;
        let hours = self.digits(2)?;
        self.eat(b':');
        let minutes = self.digits(2)?;
        if hours > 23 || minutes > 59 {
            return None;
        }
        i32::try_from(sign * (hours * 3600 + minutes * 60)).ok()
    }
}

/// `String.prototype.trim`. JavaScript white space differs from Rust white
/// space in two characters: U+FEFF is white space and U+0085 is not.
#[must_use]
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
}

/// `a.localeCompare(b, 'en')` with the ICU root collation of Node 24, for the
/// printable ASCII range.
///
/// ICU compares the primary weights of the whole strings first: white space,
/// then punctuation and symbols in a fixed order, then digits, then letters
/// without case. Only on a primary tie does it compare accents, and then
/// case, where lower case comes first. Latin-1 letters with an accent count
/// as their base letter plus an accent. Other characters sort after the
/// letters by code point; that part is an approximation.
pub fn locale_compare_en(a: &str, b: &str) -> Ordering {
    let keys_a: Vec<CollationKey> = a.chars().filter_map(collation_key).collect();
    let keys_b: Vec<CollationKey> = b.chars().filter_map(collation_key).collect();
    let level = |keys: &[CollationKey], pick: fn(&CollationKey) -> u32| -> Vec<u32> {
        keys.iter().map(pick).collect()
    };
    level(&keys_a, |k| k.primary)
        .cmp(&level(&keys_b, |k| k.primary))
        .then_with(|| level(&keys_a, |k| k.secondary).cmp(&level(&keys_b, |k| k.secondary)))
        .then_with(|| level(&keys_a, |k| k.tertiary).cmp(&level(&keys_b, |k| k.tertiary)))
}

/// The printable ASCII characters other than digits and letters, in the
/// primary order of the ICU root collation (observed with Node 24).
const ASCII_SYMBOL_ORDER: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

/// The primary weight of the first digit. Symbols come before it.
const DIGIT_BASE: u32 = 100;
/// The primary weight of `a`. Digits come before it.
const LETTER_BASE: u32 = 200;
/// The primary weight base of every other character, after the letters.
const OTHER_BASE: u32 = 1000;

#[derive(Debug, Clone, Copy)]
struct CollationKey {
    primary: u32,
    secondary: u32,
    tertiary: u32,
}

/// The collation key of one character. Control characters are ignorable.
fn collation_key(c: char) -> Option<CollationKey> {
    if c.is_control() {
        return None;
    }
    if let Some(index) = ASCII_SYMBOL_ORDER.chars().position(|s| s == c) {
        return Some(CollationKey {
            primary: u32::try_from(index).ok()?,
            secondary: 0,
            tertiary: 0,
        });
    }
    if let Some(digit) = c.to_digit(10).filter(|_| c.is_ascii_digit()) {
        return Some(CollationKey {
            primary: DIGIT_BASE + digit,
            secondary: 0,
            tertiary: 0,
        });
    }
    let (base, accent) = latin_base(c);
    if base.is_ascii_alphabetic() {
        let lower = base.to_ascii_lowercase();
        return Some(CollationKey {
            primary: LETTER_BASE + u32::from(lower) - u32::from('a'),
            secondary: accent,
            tertiary: u32::from(base.is_ascii_uppercase()),
        });
    }
    Some(CollationKey {
        primary: OTHER_BASE + u32::from(c),
        secondary: 0,
        tertiary: 0,
    })
}

/// The base letter and the accent rank of a Latin-1 letter. The rank order
/// follows the secondary weights of the root collation.
fn latin_base(c: char) -> (char, u32) {
    const ACUTE: u32 = 1;
    const GRAVE: u32 = 2;
    const CIRCUMFLEX: u32 = 4;
    const RING: u32 = 6;
    const DIAERESIS: u32 = 7;
    const TILDE: u32 = 9;
    const CEDILLA: u32 = 11;
    match c {
        'À' => ('A', GRAVE),
        'Á' => ('A', ACUTE),
        'Â' => ('A', CIRCUMFLEX),
        'Ã' => ('A', TILDE),
        'Ä' => ('A', DIAERESIS),
        'Å' => ('A', RING),
        'Ç' => ('C', CEDILLA),
        'È' => ('E', GRAVE),
        'É' => ('E', ACUTE),
        'Ê' => ('E', CIRCUMFLEX),
        'Ë' => ('E', DIAERESIS),
        'Ì' => ('I', GRAVE),
        'Í' => ('I', ACUTE),
        'Î' => ('I', CIRCUMFLEX),
        'Ï' => ('I', DIAERESIS),
        'Ñ' => ('N', TILDE),
        'Ò' => ('O', GRAVE),
        'Ó' => ('O', ACUTE),
        'Ô' => ('O', CIRCUMFLEX),
        'Õ' => ('O', TILDE),
        'Ö' => ('O', DIAERESIS),
        'Ù' => ('U', GRAVE),
        'Ú' => ('U', ACUTE),
        'Û' => ('U', CIRCUMFLEX),
        'Ü' => ('U', DIAERESIS),
        'Ý' => ('Y', ACUTE),
        'à' => ('a', GRAVE),
        'á' => ('a', ACUTE),
        'â' => ('a', CIRCUMFLEX),
        'ã' => ('a', TILDE),
        'ä' => ('a', DIAERESIS),
        'å' => ('a', RING),
        'ç' => ('c', CEDILLA),
        'è' => ('e', GRAVE),
        'é' => ('e', ACUTE),
        'ê' => ('e', CIRCUMFLEX),
        'ë' => ('e', DIAERESIS),
        'ì' => ('i', GRAVE),
        'í' => ('i', ACUTE),
        'î' => ('i', CIRCUMFLEX),
        'ï' => ('i', DIAERESIS),
        'ñ' => ('n', TILDE),
        'ò' => ('o', GRAVE),
        'ó' => ('o', ACUTE),
        'ô' => ('o', CIRCUMFLEX),
        'õ' => ('o', TILDE),
        'ö' => ('o', DIAERESIS),
        'ù' => ('u', GRAVE),
        'ú' => ('u', ACUTE),
        'û' => ('u', CIRCUMFLEX),
        'ü' => ('u', DIAERESIS),
        'ý' => ('y', ACUTE),
        'ÿ' => ('y', DIAERESIS),
        other => (other, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iso(text: &str) -> String {
        parse_date_ms(text)
            .and_then(to_iso_string)
            .unwrap_or_else(|| "NaN".into())
    }

    /// Expected values from Node 24 (`TZ=UTC`), `new Date(Date.parse(x))
    /// .toISOString()`.
    #[test]
    fn parses_like_v8() {
        let cases = [
            ("2024-06-15T00:00:00Z", "2024-06-15T00:00:00.000Z"),
            ("2024-06-15T00:00:00.123Z", "2024-06-15T00:00:00.123Z"),
            ("2024-06-15T00:00:00.1234567Z", "2024-06-15T00:00:00.123Z"),
            ("2024-06-15T00:00:00.5Z", "2024-06-15T00:00:00.500Z"),
            ("2024-06-15T00:00:00.999999Z", "2024-06-15T00:00:00.999Z"),
            ("2024-06-15T00:00Z", "2024-06-15T00:00:00.000Z"),
            ("2024-06-15", "2024-06-15T00:00:00.000Z"),
            ("2024-06", "2024-06-01T00:00:00.000Z"),
            ("2024", "2024-01-01T00:00:00.000Z"),
            ("2024-06-15Z", "2024-06-15T00:00:00.000Z"),
            ("2024-06T10:00Z", "2024-06-01T10:00:00.000Z"),
            ("2024T10:00Z", "2024-01-01T10:00:00.000Z"),
            ("+002024-06-15T00:00:00Z", "2024-06-15T00:00:00.000Z"),
            ("-000001-01-01T00:00:00Z", "-000001-01-01T00:00:00.000Z"),
            ("0000-01-01T00:00:00Z", "0000-01-01T00:00:00.000Z"),
            ("2024-06-15T00:00:00+02:00", "2024-06-14T22:00:00.000Z"),
            ("2024-06-15T00:00:00+0200", "2024-06-14T22:00:00.000Z"),
            ("2024-06-15T00:00:00-00:00", "2024-06-15T00:00:00.000Z"),
            ("2024-06-15T00:00:00+23:59", "2024-06-14T00:01:00.000Z"),
            ("2024-06-15T23:59:59.999+14:00", "2024-06-15T09:59:59.999Z"),
            ("2024-06-15T00:00:00", "2024-06-15T00:00:00.000Z"),
            ("2024-06-15 00:00:00Z", "2024-06-15T00:00:00.000Z"),
            ("2024-06-15t00:00:00z", "2024-06-15T00:00:00.000Z"),
            ("2024-06-15T24:00:00Z", "2024-06-16T00:00:00.000Z"),
            ("2024-06-15T24:00Z", "2024-06-16T00:00:00.000Z"),
            ("2024-06-15T24:00:00+01:00", "2024-06-15T23:00:00.000Z"),
            ("2024-02-30T00:00:00Z", "2024-03-01T00:00:00.000Z"),
            ("2024-02-31T10:00:00Z", "2024-03-02T10:00:00.000Z"),
            ("2023-02-29", "2023-03-01T00:00:00.000Z"),
            ("2024-06-31", "2024-07-01T00:00:00.000Z"),
            ("1969-12-31T23:59:59.999Z", "1969-12-31T23:59:59.999Z"),
            ("9999-12-30T21:59:59.999Z", "9999-12-30T21:59:59.999Z"),
        ];
        for (input, expected) in cases {
            assert_eq!(iso(input), expected, "{input}");
        }
    }

    #[test]
    fn rejects_what_v8_rejects() {
        for input in [
            "",
            "soon",
            "2024-06-15T00Z",
            "2024-06-15T00:00:60Z",
            "2024-06-15T00:60:00Z",
            "2024-06-15T25:00:00Z",
            "2024-06-15T24:00:01Z",
            "2024-06-15T24:30Z",
            "2024-06-15T24:00:00.001Z",
            " 2024-06-15T00:00:00Z",
            "2024-06-15T00:00:00Z ",
            "2024-06-15T00:00:00.Z",
            "2024-06-15T00:00:00,123Z",
            "2024-13-01",
            "2024-06-32",
            "2024-06-00",
            "2024-00-10",
            "-000000-01-01T00:00:00Z",
            "2024-06-15T00:00:00+24:00",
            "2024-06-15T00:00:00+02",
            "2024-06-15T00:00:00+02:0",
            "2024-06-15T00:00:00+2:00",
            "2024-06-15T00:00:00 Z",
            "2024-06-15T00:00:00 GMT",
            "2024-06-15T1:00:00Z",
            "2024-06-15T",
            "2024-06-15T00:00:00ZZ",
            "20240615",
        ] {
            assert_eq!(parse_date_ms(input), None, "{input}");
        }
    }

    /// Deliberate differences from V8, which parses each of these.
    #[test]
    fn does_not_port_legacy_forms_or_extreme_years() {
        for input in [
            "2024/06/15",
            "June 15, 2024",
            "Sat, 15 Jun 2024 00:00:00 GMT",
            "2024-6-5",
            "12024-06-15",
            "+275760-09-13T00:00:00Z",
            "9999-12-31T23:59:59.999Z",
        ] {
            assert_eq!(parse_date_ms(input), None, "{input}");
        }
    }

    #[test]
    fn epoch_values_match_javascript() {
        assert_eq!(parse_date_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_date_ms("2024-06-15T00:00:00Z"),
            Some(1_718_409_600_000)
        );
        assert_eq!(parse_date_ms("1969-12-31T23:59:59.999Z"), Some(-1));
    }

    #[test]
    fn trims_like_javascript() {
        assert_eq!(js_trim(" \u{FEFF}a b\t\n"), "a b");
        assert_eq!(js_trim("\u{85}a"), "\u{85}a");
        assert_eq!(js_trim("\u{A0}a\u{2028}"), "a");
    }

    /// The expected order is the output of Node 24:
    /// `xs.sort((a, b) => a.localeCompare(b, 'en'))`.
    #[test]
    fn sorts_like_icu() {
        let mut ascii: Vec<String> = (32_u8..127).map(|b| char::from(b).to_string()).collect();
        ascii.sort_by(|a, b| locale_compare_en(a, b));
        assert_eq!(
            ascii.concat(),
            " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ"
        );

        let mut words = vec![
            "a",
            "A",
            "b",
            "B",
            "ab",
            "Ab",
            "aB",
            "a b",
            "a-b",
            "ab ",
            "a/b",
            "a_b",
            "a1",
            "a10",
            "a2",
            "é",
            "e",
            "f",
            "E",
            "ä",
            "z",
            "Ä",
            "a",
            "Music/Rhythm",
            "Music",
            "Musical",
            "Role Playing Games",
            "Role-Playing",
            "Rolex",
            "Shooter",
            "Shoot em up",
            "Action",
            "Action-Adventure",
            "Action Adventure",
            "Ação",
        ];
        words.sort_by(|a, b| locale_compare_en(a, b));
        assert_eq!(
            words,
            [
                "a",
                "a",
                "A",
                "ä",
                "Ä",
                "a b",
                "a_b",
                "a-b",
                "a/b",
                "a1",
                "a10",
                "a2",
                "ab",
                "aB",
                "Ab",
                "ab ",
                "Ação",
                "Action",
                "Action Adventure",
                "Action-Adventure",
                "b",
                "B",
                "e",
                "E",
                "é",
                "f",
                "Music",
                "Music/Rhythm",
                "Musical",
                "Role Playing Games",
                "Role-Playing",
                "Rolex",
                "Shoot em up",
                "Shooter",
                "z",
            ]
        );
        assert_eq!(locale_compare_en("a", "a"), Ordering::Equal);
    }
}
