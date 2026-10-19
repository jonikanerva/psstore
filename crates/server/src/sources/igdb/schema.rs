//! Decoding and narrowing of the Twitch token answer and the IGDB games
//! answer, with the rules of `server/src/igdb/igdbSchema.ts`.
//!
//! The decoders read the JSON value field by field. One malformed field drops
//! that field only; a games element without a string name is dropped; a games
//! body that is not an array is drift and fails the lookup.

use serde_json::Value;

use crate::domain::critic_match::CriticCandidate;
use crate::domain::game::CriticScore;
use crate::domain::js::utc_full_year;
use crate::domain::secret::Secret;

/// A Twitch app access token. Only the token and its lifetime are read.
#[derive(Debug, Clone)]
pub struct IgdbToken {
    pub access_token: Secret,
    /// The lifetime that Twitch states. Always finite and above zero.
    pub expires_in_seconds: f64,
}

/// The JSON value of an answer body, or `None` when the body is not JSON.
#[must_use]
pub fn decode_json(body: &[u8]) -> Option<Value> {
    serde_json::from_slice(body).ok()
}

/// The token of a token answer. `None` without a non-empty `access_token`
/// string and an `expires_in` number above zero.
#[must_use]
pub fn parse_token_response(json: &Value) -> Option<IgdbToken> {
    let object = json.as_object()?;
    let access_token = object
        .get("access_token")?
        .as_str()
        .filter(|token| !token.is_empty())?;
    let expires_in_seconds = object
        .get("expires_in")?
        .as_f64()
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)?;
    Some(IgdbToken {
        access_token: Secret::new(access_token),
        expires_in_seconds,
    })
}

/// The candidates of a games answer. `None` when the body is not an array.
///
/// The score is `aggregated_rating` (critics). The user score `rating` is
/// never read (`VISION.md` → Non-Goals).
pub fn parse_games_response(json: &Value) -> Option<Vec<CriticCandidate>> {
    Some(json.as_array()?.iter().filter_map(candidate_of).collect())
}

fn candidate_of(item: &Value) -> Option<CriticCandidate> {
    let object = item.as_object()?;
    let name = object.get("name")?.as_str()?;
    Some(CriticCandidate {
        name: name.to_owned(),
        release_year: object
            .get("first_release_date")
            .and_then(year_of_unix_seconds),
        rating: object.get("aggregated_rating").and_then(rating_of),
        rating_count: object.get("aggregated_rating_count").map_or(0, count_of),
    })
}

/// The JavaScript time value limit: `new Date(ms)` is invalid beyond it.
const MAX_TIME_VALUE_MS: f64 = 8.64e15;

/// The UTC year of a Unix time in seconds, like
/// `new Date(seconds * 1000).getUTCFullYear()`. JavaScript truncates the
/// millisecond value toward zero, so -0.0005 s is 1970 and -0.5 s is 1969.
pub(super) fn year_of_unix_seconds(value: &Value) -> Option<i32> {
    let seconds = value.as_f64().filter(|s| s.is_finite())?;
    let millis = (seconds * 1000.0).trunc();
    if millis.is_nan() || millis.abs() > MAX_TIME_VALUE_MS {
        return None;
    }
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the value is an integral float within ±8.64e15, so it fits in i64 exactly"
    )]
    let millis = millis as i64;
    utc_full_year(millis)
}

/// A finite score from 0 to 100, rounded like JavaScript `Math.round`.
pub(super) fn rating_of(value: &Value) -> Option<CriticScore> {
    let rating = value
        .as_f64()
        .filter(|r| r.is_finite() && (0.0..=100.0).contains(r))?;
    // `Math.round` rounds a half up. For a value that is not negative,
    // `f64::round` (a half away from zero) gives the same integer.
    let rounded = rating.round();
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the value is an integer from 0 to 100, so the cast is exact"
    )]
    let whole = rounded as u8;
    CriticScore::new(whole)
}

/// A count that is an integer of 0 or more, else 0. A JSON number such as
/// `12.0` is an integer, as in JavaScript.
pub(super) fn count_of(value: &Value) -> u64 {
    match value.as_f64() {
        Some(count) if count.is_finite() && count >= 0.0 && count.fract() == 0.0 => {
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "the value is a non-negative integral float; `as` saturates above u64::MAX, and only `>= 3` matters"
            )]
            let count = count as u64;
            count
        }
        _ => 0,
    }
}
