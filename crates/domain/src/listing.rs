//! Sorting, pagination, scope filtering, and concept-to-game mapping of the
//! lists (port of `server/src/domain/listing.ts`).
//!
//! Pure functions only. The current time arrives as `now_ms`, the epoch
//! milliseconds of the injected clock.

use std::cmp::Ordering;
use std::collections::HashSet;

use super::browse::is_genre_key;
use super::catalog::{Concept, PlusMonthlyEntry, RawGenre, SearchCandidate, SearchEntry};
use super::game::{Game, Genre, IdKind, PageResult};
use super::js::{locale_compare_en, parse_date_ms, to_iso_string};
use super::mapper::{
    concept_product_id, concept_to_game, is_concept_discounted, monthly_entry_to_game,
    product_to_concept,
};
use super::product_id::is_valid_product_id;

/// The sort direction of a date-sorted list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortOrder {
    DateDesc,
    DateAsc,
}

/// Sorts by release date. A missing or unparseable date sorts last in both
/// directions. Equal dates keep Sony's order, because the sort is stable.
#[must_use]
pub fn sort_by_date(mut games: Vec<Game>, order: SortOrder) -> Vec<Game> {
    games.sort_by(|a, b| {
        let (a, b) = (parse_date_ms(&a.date), parse_date_ms(&b.date));
        match (a, b, order) {
            (Some(a), Some(b), SortOrder::DateDesc) => b.cmp(&a),
            (Some(a), Some(b), SortOrder::DateAsc) => a.cmp(&b),
            (Some(_), None, _) => Ordering::Less,
            (None, Some(_), _) => Ordering::Greater,
            (None, None, _) => Ordering::Equal,
        }
    });
    games
}

/// One page of `games`. `next_offset` is `None` on the last page.
#[must_use]
pub fn paginate(games: Vec<Game>, offset: usize, size: usize) -> PageResult {
    let total_count = games.len();
    let end = offset.saturating_add(size);
    let next_offset = (end < total_count).then_some(end);
    let games = games.into_iter().skip(offset).take(size).collect();
    PageResult {
        games,
        total_count,
        next_offset,
    }
}

// NEW and UPCOMING split at the start of the viewer's next local day. The
// client makes that split (docs/adr/0001-new-upcoming-day-split.md). In every
// time zone the next local midnight is at most 25 hours away, and the margin
// absorbs a client clock that is up to 12 hours off. Each server list is a
// superset of the client's result.
const MAX_LOCAL_DAY_MS: i64 = 25 * 60 * 60 * 1000;
const CLIENT_CLOCK_MARGIN_MS: i64 = 12 * 60 * 60 * 1000;

fn release_ms(game: &Game) -> Option<i64> {
    parse_date_ms(&game.date)
}

/// True when the date of the game parses.
#[must_use]
pub fn has_release_date(game: &Game) -> bool {
    release_ms(game).is_some()
}

/// NEW: a dated game released before the latest possible local midnight.
#[must_use]
pub fn in_new_window(games: Vec<Game>, now_ms: i64) -> Vec<Game> {
    let end = now_ms + MAX_LOCAL_DAY_MS + CLIENT_CLOCK_MARGIN_MS;
    games
        .into_iter()
        .filter(|game| release_ms(game).is_some_and(|ms| ms < end))
        .collect()
}

/// UPCOMING: a game released after the earliest possible local midnight, or
/// a game without a parseable date.
#[must_use]
pub fn in_upcoming_window(games: Vec<Game>, now_ms: i64) -> Vec<Game> {
    let start = now_ms - CLIENT_CLOCK_MARGIN_MS;
    games
        .into_iter()
        .filter(|game| release_ms(game).is_none_or(|ms| ms >= start))
        .collect()
}

/// The released grid, then the upcoming grid. The first occurrence of a
/// repeated id wins.
#[must_use]
pub fn merge_release_grids(released: Vec<Game>, upcoming: Vec<Game>) -> Vec<Game> {
    let mut seen = HashSet::new();
    released
        .into_iter()
        .chain(upcoming)
        .filter(|game| seen.insert(game.id.clone()))
        .collect()
}

/// NEW and DISCOUNTED: the cards whose id is a product SKU.
#[must_use]
pub fn map_concepts_to_games(concepts: &[Concept], now_ms: i64) -> Vec<Game> {
    concepts
        .iter()
        .map(|concept| concept_to_game(concept, now_ms))
        .filter(|game| !game.id.is_empty() && is_valid_product_id(&game.id))
        .collect()
}

/// MONTHLY, newest release first. The feed has no date of the PS Plus
/// addition.
pub fn map_monthly_to_games(entries: &[PlusMonthlyEntry]) -> Vec<Game> {
    sort_by_date(
        entries.iter().map(monthly_entry_to_game).collect(),
        SortOrder::DateDesc,
    )
}

/// UPCOMING: also keeps concept-only announcements that Sony does not expose
/// as a product SKU. Only id-less entries are dropped. A product SKU id is
/// `product`; any other id is a `concept` id.
#[must_use]
pub fn map_upcoming_concepts_to_games(concepts: &[Concept], now_ms: i64) -> Vec<Game> {
    concepts
        .iter()
        .map(|concept| concept_to_game(concept, now_ms))
        .filter(|game| !game.id.is_empty())
        .map(|mut game| {
            game.id_kind = if is_valid_product_id(&game.id) {
                IdKind::Product
            } else {
                IdKind::Concept
            };
            game
        })
        .collect()
}

/// Sony `storeDisplayClassification` values that are full games. Unknown and
/// future values are excluded, so a new non-game SKU type cannot leak in.
pub const GAME_CLASSIFICATIONS: [&str; 2] = ["FULL_GAME", "GAME_BUNDLE"];

/// True for a full game or a game bundle classification.
#[must_use]
pub fn is_game_classification(classification: Option<&str>) -> bool {
    classification.is_some_and(|value| GAME_CLASSIFICATIONS.contains(&value))
}

/// Sony's platform name of the PS5.
pub const PS5_PLATFORM: &str = "PS5";

/// True for a PS5 full game or game bundle.
#[must_use]
pub fn is_ps5_game(platforms: &[String], classification: Option<&str>) -> bool {
    platforms.iter().any(|platform| platform == PS5_PLATFORM)
        && is_game_classification(classification)
}

fn candidate_id(candidate: &SearchCandidate) -> String {
    match candidate {
        SearchCandidate::Known(concept) => concept_product_id(concept),
        SearchCandidate::Unverified { product_id, .. } => product_id.clone(),
    }
}

fn narrow_search_entry(entry: SearchEntry) -> Option<SearchCandidate> {
    match entry {
        SearchEntry::Product(product) => {
            let in_scope = product.id.as_deref().is_some_and(is_valid_product_id)
                && is_ps5_game(
                    product.platforms.as_deref().unwrap_or_default(),
                    product.store_display_classification.as_deref(),
                );
            in_scope.then(|| SearchCandidate::Known(product_to_concept(&product)))
        }
        SearchEntry::Concept(concept) => {
            let product_id = concept
                .products
                .as_ref()
                .and_then(|products| products.first())
                .and_then(|product| product.id.clone())
                .filter(|id| is_valid_product_id(id))?;
            Some(SearchCandidate::Unverified {
                product_id,
                concept,
            })
        }
    }
}

/// Search scope: Sony applies no platform filter, so only PS5 game products
/// and concepts that name a product id stay. Keeps Sony's relevance order and
/// the first occurrence of a repeated id.
pub fn narrow_search_entries(entries: Vec<SearchEntry>) -> Vec<SearchCandidate> {
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter_map(narrow_search_entry)
        .filter(|candidate| seen.insert(candidate_id(candidate)))
        .collect()
}

/// The genre facet narrowed to keys that the API accepts, sorted by display
/// name like `localeCompare(…, 'en')`. The first entry of a repeated key
/// wins.
#[must_use]
pub fn narrow_genres(genres: Vec<RawGenre>) -> Vec<Genre> {
    let mut seen = HashSet::new();
    let mut kept: Vec<Genre> = genres
        .into_iter()
        .filter(|genre| is_genre_key(&genre.key) && seen.insert(genre.key.clone()))
        .map(|genre| Genre {
            key: genre.key,
            name: genre.name,
        })
        .collect();
    kept.sort_by(|a, b| locale_compare_en(&a.name, &b.name));
    kept
}

/// Product lookups for one BROWSE concept at most (ADR 0002).
pub const BROWSE_MAX_CANDIDATES: usize = 3;

/// True for a PS5 title product id (`PPSA`), for example
/// `EP0006-PPSA04874_00-APEXLEGENDRSPWN1`. A PS4 title id has `CUSA`.
fn is_ps5_title_product_id(id: &str) -> bool {
    is_valid_product_id(id) && id.get(7..11) == Some("PPSA")
}

/// The product ids to try for one BROWSE concept, in order: PS5 title ids
/// first, otherwise Sony's order. The prefix only orders the lookups; the
/// product detail decides. A concept without a product id has none.
#[must_use]
pub fn browse_candidate_ids(concept: &Concept) -> Vec<String> {
    let mut seen = HashSet::new();
    let ids: Vec<String> = concept
        .products
        .iter()
        .flatten()
        .filter_map(|product| product.id.clone())
        .filter(|id| !id.is_empty() && is_valid_product_id(id) && seen.insert(id.clone()))
        .collect();
    let (ps5, other): (Vec<String>, Vec<String>) =
        ids.into_iter().partition(|id| is_ps5_title_product_id(id));
    ps5.into_iter()
        .chain(other)
        .take(BROWSE_MAX_CANDIDATES)
        .collect()
}

/// The BROWSE card of a concept for the product that passed the scope
/// check. The name, cover, and list price come from the concept; the date
/// and genres come from that product's detail.
pub fn browse_concept_to_game(
    concept: &Concept,
    product_id: &str,
    release_date: &str,
    genres: &[String],
    now_ms: i64,
) -> Game {
    let base = concept_to_game(concept, now_ms);
    let release = parse_date_ms(release_date);
    let date = release.and_then(to_iso_string).unwrap_or_default();
    Game {
        id: product_id.to_owned(),
        discount_date: if is_concept_discounted(concept) {
            date.clone()
        } else {
            String::new()
        },
        genres: if genres.is_empty() {
            base.genres.clone()
        } else {
            genres.to_vec()
        },
        pre_order: !date.is_empty() && release.is_some_and(|ms| ms > now_ms),
        date,
        ..base
    }
}

#[cfg(test)]
mod tests;
