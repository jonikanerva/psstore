//! The `universalSearch` boundary of the search operation (port of
//! `server/src/sony/searchSchema.ts`). Sony applies no platform filter to
//! search, so the decoded entries are not yet in scope:
//! `narrow_search_entries` in `domain/listing.rs` enforces the scope.

use serde_json::Value;

use super::grid::{concept, grid_product};
use super::json::{object, opt_bool, opt_list, opt_object_of, opt_string};
use crate::domain::catalog::SearchEntry;

/// The outcome of a search response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchOutcome {
    /// The node, its `results` list, or `pageInfo.isLast` is absent or
    /// unintelligible: the page cannot be paged honestly.
    Drift,
    Ok {
        entries: Vec<SearchEntry>,
        is_last: bool,
        /// Elements that failed to decode or have an unknown typename.
        dropped: usize,
    },
}

fn entry(element: &Value) -> Option<SearchEntry> {
    let typename = opt_string(object(element).ok()?, "__typename").ok()?;
    match typename.as_deref() {
        Some("Product") => grid_product(element).ok().map(SearchEntry::Product),
        Some("Concept") => concept(element).ok().map(SearchEntry::Concept),
        _ => None,
    }
}

/// Decodes a whole search response.
pub fn parse_search_response(json: &Value) -> SearchOutcome {
    let Ok(envelope) = object(json) else {
        return SearchOutcome::Drift;
    };
    let node = match envelope.get("data") {
        None | Some(Value::Null) => None,
        Some(data) => match object(data) {
            Ok(data) => data.get("universalSearch"),
            Err(_) => return SearchOutcome::Drift,
        },
    };
    let Some(Ok(node)) = node.map(object) else {
        return SearchOutcome::Drift;
    };
    let page_info = opt_object_of(node, "pageInfo", |value| opt_bool(object(value)?, "isLast"));
    let (Ok(page_info), Ok(Some(results))) = (page_info, opt_list(node, "results")) else {
        return SearchOutcome::Drift;
    };
    let Some(Some(is_last)) = page_info else {
        return SearchOutcome::Drift;
    };
    let mut entries = Vec::new();
    let mut dropped = 0;
    for element in results {
        match entry(element) {
            Some(decoded) => entries.push(decoded),
            None => dropped += 1,
        }
    }
    SearchOutcome::Ok {
        entries,
        is_last,
        dropped,
    }
}
