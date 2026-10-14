//! The PS Plus monthly games feed (port of
//! `server/src/sony/plusMonthlySchema.ts`): a list of alphabetical buckets,
//! each with game entries. Buckets and entries decode one by one, so a
//! malformed element never drops its neighbours.

use std::collections::HashSet;

use serde_json::Value;

use super::json::{Invalid, object, opt_list, opt_nullable_strings, opt_string};
use crate::domain::catalog::PlusMonthlyEntry;
use crate::domain::id::ProductId;
use crate::domain::listing::PS5_PLATFORM;

/// The outcome of a feed response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlusMonthlyOutcome {
    /// The body is not a list, or no element of a non-empty list is a
    /// bucket object.
    Drift,
    Ok {
        entries: Vec<PlusMonthlyEntry>,
        /// Elements that failed to decode or lack an id or a name.
        dropped: usize,
        /// Decoded entries without PS5 in `device`, or without a product id.
        out_of_scope: usize,
    },
}

struct RawEntry {
    product_id: Option<String>,
    name: Option<String>,
    image_url: Option<String>,
    release_date: Option<String>,
    genre: Option<Vec<Option<String>>>,
    device: Option<Vec<Option<String>>>,
}

fn raw_entry(value: &Value) -> Result<RawEntry, Invalid> {
    let obj = object(value)?;
    Ok(RawEntry {
        product_id: opt_string(obj, "productId")?,
        name: opt_string(obj, "name")?,
        image_url: opt_string(obj, "imageUrl")?,
        release_date: opt_string(obj, "releaseDate")?,
        genre: opt_nullable_strings(obj, "genre")?,
        device: opt_nullable_strings(obj, "device")?,
    })
}

/// The non-empty strings of a list.
fn strings(values: Option<Vec<Option<String>>>) -> Vec<String> {
    values
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect()
}

/// Flattens the buckets and keeps the entries whose `device` includes PS5 and
/// whose id is a product id. The first entry of a product id wins.
#[must_use]
pub fn parse_plus_monthly(json: &Value) -> PlusMonthlyOutcome {
    let Some(buckets) = json.as_array() else {
        return PlusMonthlyOutcome::Drift;
    };
    let mut dropped = 0;
    let mut out_of_scope = 0;
    let mut decoded_buckets = 0;
    let mut seen = HashSet::new();
    let mut entries = Vec::new();

    for bucket in buckets {
        let Ok(games) = object(bucket).and_then(|bucket| opt_list(bucket, "games")) else {
            dropped += 1;
            continue;
        };
        decoded_buckets += 1;
        for raw in games.unwrap_or_default() {
            let Ok(entry) = raw_entry(raw) else {
                dropped += 1;
                continue;
            };
            let (Some(product_id), Some(name)) = (entry.product_id, entry.name) else {
                dropped += 1;
                continue;
            };
            if product_id.is_empty() || name.is_empty() {
                dropped += 1;
                continue;
            }
            let ps5 = strings(entry.device)
                .iter()
                .any(|device| device == PS5_PLATFORM);
            let Some(product_id) = ps5.then(|| ProductId::parse(&product_id)).flatten() else {
                out_of_scope += 1;
                continue;
            };
            if !seen.insert(product_id.clone()) {
                continue;
            }
            entries.push(PlusMonthlyEntry {
                product_id,
                name,
                image_url: entry.image_url.unwrap_or_default(),
                release_date: entry.release_date.unwrap_or_default(),
                genres: strings(entry.genre),
            });
        }
    }

    if !buckets.is_empty() && decoded_buckets == 0 {
        return PlusMonthlyOutcome::Drift;
    }
    PlusMonthlyOutcome::Ok {
        entries,
        dropped,
        out_of_scope,
    }
}
