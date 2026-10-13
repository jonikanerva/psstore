//! Path and query validation of the API routes.
//!
//! The rules match the Effect Schema decoders of the TypeScript server, so the
//! same request gets the same answer:
//!
//! - A repeated query key is invalid. An unknown key is ignored.
//! - A number decodes like JavaScript `Number(text)`: surrounding white space
//!   is ignored, an empty text is 0, and hexadecimal and exponent forms are
//!   numbers. The number must then be an integer in range.
//! - Text lengths count UTF-16 code units, like JavaScript.
//!
//! Every invalid request answers an empty 400.

use crate::application::Page;
use crate::domain::browse::{BrowseOrder, GenreKey};
use crate::domain::id::GameId;
use crate::domain::js::js_trim;

/// The page size of a list when the request has none.
pub const DEFAULT_PAGE_SIZE: usize = 60;
/// The largest page size of a list.
pub const MAX_PAGE_SIZE: usize = 120;
/// Sony rejects a search page larger than this with a validation error. It is
/// also the default search page size.
pub const SEARCH_MAX_PAGE_SIZE: usize = 50;
/// The longest search term, in UTF-16 code units, after trimming.
pub const SEARCH_MAX_TERM_LENGTH: usize = 100;

/// An invalid request: the route answers an empty 400.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Invalid;

/// The decoded query pairs of one request.
#[derive(Debug, Default)]
pub struct Query(Vec<(String, String)>);

impl Query {
    /// Decodes `application/x-www-form-urlencoded` pairs: `+` is a space and
    /// percent escapes decode.
    #[must_use]
    pub fn parse(raw: Option<&str>) -> Self {
        Self(
            raw.map(|q| form_urlencoded::parse(q.as_bytes()).into_owned().collect())
                .unwrap_or_default(),
        )
    }

    /// The value of `key`. A repeated key is invalid.
    fn single(&self, key: &str) -> Result<Option<&str>, Invalid> {
        let mut values = self.0.iter().filter(|(k, _)| k == key).map(|(_, v)| v);
        let first = values.next();
        if values.next().is_some() {
            return Err(Invalid);
        }
        Ok(first.map(String::as_str))
    }

    fn offset(&self) -> Result<usize, Invalid> {
        match self.single("offset")? {
            None => Ok(0),
            Some(text) => integer_in(text, 0, None),
        }
    }

    fn size(&self, default: usize, max: usize) -> Result<usize, Invalid> {
        match self.single("size")? {
            None => Ok(default),
            Some(text) => integer_in(text, 1, Some(max)),
        }
    }

    fn page(&self) -> Result<Page, Invalid> {
        Ok(Page {
            offset: self.offset()?,
            size: self.size(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)?,
        })
    }
}

/// `offset` (default 0) and `size` (1 to 120, default 60).
///
/// # Errors
///
/// [`Invalid`] for a repeated key or a value out of range.
pub fn pagination(raw: Option<&str>) -> Result<Page, Invalid> {
    Query::parse(raw).page()
}

/// `q` (trimmed, 1 to 100 code units), `offset`, and `size` (1 to 50,
/// default 50).
///
/// # Errors
///
/// [`Invalid`] for a missing or repeated key or a value out of range.
pub fn search(raw: Option<&str>) -> Result<(String, Page), Invalid> {
    let query = Query::parse(raw);
    let term = js_trim(query.single("q")?.ok_or(Invalid)?);
    let length = utf16_len(term);
    if length == 0 || length > SEARCH_MAX_TERM_LENGTH {
        return Err(Invalid);
    }
    let page = Page {
        offset: query.offset()?,
        size: query.size(SEARCH_MAX_PAGE_SIZE, SEARCH_MAX_PAGE_SIZE)?,
    };
    Ok((term.to_owned(), page))
}

/// `genre` (a Sony genre key, not trimmed), `order` (an API order key),
/// `offset`, and `size`.
///
/// # Errors
///
/// [`Invalid`] for a missing or repeated key or a value out of range.
pub fn browse(raw: Option<&str>) -> Result<(GenreKey, BrowseOrder, Page), Invalid> {
    let query = Query::parse(raw);
    let genre = GenreKey::parse(query.single("genre")?.ok_or(Invalid)?).ok_or(Invalid)?;
    let order = BrowseOrder::parse(query.single("order")?.ok_or(Invalid)?).ok_or(Invalid)?;
    Ok((genre, order, query.page()?))
}

/// The game id path segment: trimmed and not empty.
///
/// # Errors
///
/// [`Invalid`] when the trimmed segment is empty.
pub fn game_id(raw: &str) -> Result<GameId, Invalid> {
    GameId::from_path(raw).ok_or(Invalid)
}

/// The largest integer that a JavaScript number holds exactly
/// (`Number.MAX_SAFE_INTEGER`, 2^53 - 1).
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Decodes `text` like JavaScript `Number(text)` and accepts an integer from
/// `min` to `max`. The integer check is Effect's `Schema.isInt`, which is
/// `Number.isSafeInteger`: a value above 2^53 - 1 is invalid.
fn integer_in(text: &str, min: usize, max: Option<usize>) -> Result<usize, Invalid> {
    let value = js_number(text).ok_or(Invalid)?;
    if !value.is_finite() || value.fract() != 0.0 || value.abs() > MAX_SAFE_INTEGER {
        return Err(Invalid);
    }
    // -0 is not below 0, like in JavaScript, and converts to 0.
    if value < 0.0 {
        return Err(Invalid);
    }
    let value = safe_integer_to_usize(value).ok_or(Invalid)?;
    if value < min || max.is_some_and(|max| value > max) {
        return Err(Invalid);
    }
    Ok(value)
}

/// A non-negative safe integer as `usize`. The conversion is exact, because
/// every integer up to 2^53 - 1 is exact in `f64` and fits in `u64`.
fn safe_integer_to_usize(value: f64) -> Option<usize> {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the caller checks that the value is a non-negative safe integer"
    )]
    let exact = value as u64;
    usize::try_from(exact).ok()
}

/// JavaScript `Number(text)` for a string: `None` where JavaScript gives NaN.
fn js_number(text: &str) -> Option<f64> {
    let text = js_trim(text);
    if text.is_empty() {
        return Some(0.0);
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = text.strip_prefix(prefix) {
            return radix_number(digits, radix);
        }
    }
    let (sign, unsigned) = match text.as_bytes().first() {
        Some(b'+') => (1.0, &text[1..]),
        Some(b'-') => (-1.0, &text[1..]),
        _ => (1.0, text),
    };
    if unsigned == "Infinity" {
        return Some(sign * f64::INFINITY);
    }
    if !is_decimal_literal(unsigned) {
        return None;
    }
    unsigned.parse::<f64>().ok().map(|value| sign * value)
}

/// Digits of one radix, at least one. The value can lose precision above
/// 2^53, like in JavaScript.
fn radix_number(digits: &str, radix: u32) -> Option<f64> {
    if digits.is_empty() {
        return None;
    }
    digits.chars().try_fold(0.0_f64, |value, c| {
        c.to_digit(radix)
            .map(|digit| value * f64::from(radix) + f64::from(digit))
    })
}

/// `digits [. digits] [e|E [+|-] digits]`, with at least one mantissa digit.
fn is_decimal_literal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0;
    let digits = |i: &mut usize| {
        let start = *i;
        while bytes.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i - start
    };
    let mut mantissa = digits(&mut i);
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        mantissa += digits(&mut i);
    }
    if mantissa == 0 {
        return false;
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(bytes.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if digits(&mut i) == 0 {
            return false;
        }
    }
    i == bytes.len()
}

/// The JavaScript `length` of a string: its UTF-16 code units.
#[must_use]
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(offset: usize, size: usize) -> Page {
        Page { offset, size }
    }

    #[test]
    fn pagination_defaults_and_bounds() {
        assert_eq!(pagination(None), Ok(page(0, 60)));
        assert_eq!(pagination(Some("")), Ok(page(0, 60)));
        assert_eq!(pagination(Some("offset=5&size=120")), Ok(page(5, 120)));
        assert_eq!(pagination(Some("size=1")), Ok(page(0, 1)));
        assert_eq!(pagination(Some("size=0")), Err(Invalid));
        assert_eq!(pagination(Some("size=121")), Err(Invalid));
        assert_eq!(pagination(Some("offset=-1")), Err(Invalid));
        assert_eq!(pagination(Some("other=1")), Ok(page(0, 60)));
    }

    #[test]
    fn numbers_decode_like_javascript_number() {
        // Observed on the TypeScript server: `offset=1e2` is 100 and
        // `offset=%20` is 0.
        assert_eq!(pagination(Some("offset=1e2&size=1")), Ok(page(100, 1)));
        assert_eq!(pagination(Some("offset=%20&size=1")), Ok(page(0, 1)));
        assert_eq!(pagination(Some("offset=&size=1")), Ok(page(0, 1)));
        assert_eq!(pagination(Some("offset=+3&size=1")), Ok(page(3, 1)));
        assert_eq!(pagination(Some("offset=-0")), Ok(page(0, 60)));
        assert_eq!(pagination(Some("offset=0x10")), Ok(page(16, 60)));
        assert_eq!(pagination(Some("offset=0b11")), Ok(page(3, 60)));
        assert_eq!(pagination(Some("offset=0o17")), Ok(page(15, 60)));
        assert_eq!(pagination(Some("offset=5.")), Ok(page(5, 60)));
        assert_eq!(pagination(Some("offset=5.0")), Ok(page(5, 60)));
        assert_eq!(pagination(Some("offset=%0A7%09")), Ok(page(7, 60)));
        for invalid in [
            "size=abc",
            "size=1.5",
            "size=",
            "offset=Infinity",
            "offset=infinity",
            "offset=NaN",
            "offset=1e",
            "offset=.",
            "offset=0x",
            "offset=-0x1",
            "offset=1_000",
            "offset=1,5",
            "offset=12abc",
        ] {
            assert_eq!(pagination(Some(invalid)), Err(Invalid), "{invalid}");
        }
    }

    /// Effect's `Schema.isInt` is `Number.isSafeInteger`, so the TypeScript
    /// server answered 400 above 2^53 - 1, before any Sony call.
    #[test]
    fn an_offset_above_the_safe_integer_range_is_invalid() {
        assert_eq!(
            pagination(Some("offset=9007199254740991")),
            Ok(page(9_007_199_254_740_991, 60))
        );
        for invalid in [
            "offset=9007199254740992",
            "offset=18446744073709551615",
            "offset=1e21",
            "offset=1e300",
            "offset=0x20000000000000",
        ] {
            assert_eq!(pagination(Some(invalid)), Err(Invalid), "{invalid}");
        }
    }

    #[test]
    fn a_repeated_key_is_invalid() {
        assert_eq!(pagination(Some("size=1&size=2")), Err(Invalid));
        assert_eq!(pagination(Some("offset=1&offset=1")), Err(Invalid));
    }

    #[test]
    fn search_trims_the_term_and_caps_the_page_size() {
        assert_eq!(search(Some("q=a")), Ok(("a".into(), page(0, 50))));
        assert_eq!(search(Some("q=+zelda+")), Ok(("zelda".into(), page(0, 50))));
        assert_eq!(search(Some("q=%C3%A4")), Ok(("ä".into(), page(0, 50))));
        assert_eq!(
            search(Some("q=a&size=50&offset=50")),
            Ok(("a".into(), page(50, 50)))
        );
        assert_eq!(search(Some("q=a&size=51")), Err(Invalid));
        assert_eq!(search(None), Err(Invalid));
        assert_eq!(search(Some("q=%20")), Err(Invalid));
        assert_eq!(search(Some("q=")), Err(Invalid));
        assert_eq!(
            search(Some(&format!("q={}", "a".repeat(100)))).map(|r| r.1),
            Ok(page(0, 50))
        );
        assert_eq!(
            search(Some(&format!("q={}", "a".repeat(101)))),
            Err(Invalid)
        );
        // An emoji is two UTF-16 code units: 50 emoji are 100 units.
        let emoji = "%F0%9F%8E%AE".repeat(50);
        assert!(search(Some(&format!("q={emoji}"))).is_ok());
        let emoji = "%F0%9F%8E%AE".repeat(51);
        assert_eq!(search(Some(&format!("q={emoji}"))), Err(Invalid));
    }

    #[test]
    fn browse_needs_a_genre_key_and_an_order() {
        let (genre, order, p) = browse(Some("genre=ACTION&order=newest")).unwrap();
        assert_eq!(genre.as_str(), "ACTION");
        assert_eq!(order, BrowseOrder::Newest);
        assert_eq!(p, page(0, 60));
        assert_eq!(
            browse(Some(
                "genre=MUSIC%2FRHYTHM&order=name-asc&offset=60&size=60"
            ))
            .map(|r| r.2),
            Ok(page(60, 60))
        );
        assert!(browse(Some("genre=action&order=newest")).is_err());
        assert!(browse(Some("genre=ACTION&order=bad")).is_err());
        assert!(browse(Some("genre=+ACTION&order=newest")).is_err());
        assert!(browse(Some("order=newest")).is_err());
        assert!(browse(Some("genre=ACTION")).is_err());
    }

    #[test]
    fn game_id_is_trimmed_and_not_empty() {
        assert_eq!(game_id(" EP0001 "), Ok("EP0001".parse().unwrap()));
        assert_eq!(game_id("  "), Err(Invalid));
        assert_eq!(game_id("\u{FEFF}"), Err(Invalid));
        assert_eq!(game_id("\u{85}"), Ok("\u{85}".parse().unwrap()));
    }
}
