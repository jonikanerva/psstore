//! The `categoryGridRetrieve` boundary: NEW, UPCOMING, DISCOUNTED, BROWSE,
//! and the genre facet (port of `server/src/sony/categoryGridSchema.ts` and
//! the pure extraction functions of `sonyClient.ts`).
//!
//! The decode is tolerant on purpose: every field accepts an absent key or
//! `null`, unknown keys are ignored, and the elements decode one by one, so
//! one odd element is dropped and counted instead of emptying the grid.

use serde_json::Value;

use super::json::{
    Invalid, object, opt_bool, opt_list, opt_list_of, opt_object_of, opt_string, opt_strings,
};
use crate::domain::catalog::{
    CategoryGridProduct, Concept, ConceptPrice, ConceptProductRef, Media, RawGenre,
};
use crate::domain::game::Genre;
use crate::domain::listing::narrow_genres;
use crate::domain::mapper::product_to_concept;

pub(super) fn media(value: &Value) -> Result<Media, Invalid> {
    let obj = object(value)?;
    Ok(Media {
        url: opt_string(obj, "url")?,
        role: opt_string(obj, "role")?,
        kind: opt_string(obj, "type")?,
    })
}

fn concept_price(value: &Value) -> Result<ConceptPrice, Invalid> {
    let obj = object(value)?;
    Ok(ConceptPrice {
        base_price: opt_string(obj, "basePrice")?,
        discounted_price: opt_string(obj, "discountedPrice")?,
        discount_text: opt_string(obj, "discountText")?,
        service_branding: opt_strings(obj, "serviceBranding")?,
        upsell_service_branding: opt_strings(obj, "upsellServiceBranding")?,
        upsell_text: opt_string(obj, "upsellText")?,
    })
}

fn product_ref(value: &Value) -> Result<ConceptProductRef, Invalid> {
    let obj = object(value)?;
    Ok(ConceptProductRef {
        id: opt_string(obj, "id")?,
        release_date: opt_string(obj, "releaseDate")?,
        provider_name: opt_string(obj, "providerName")?,
        genres: opt_strings(obj, "genres")?,
    })
}

/// One concept element.
pub(super) fn concept(value: &Value) -> Result<Concept, Invalid> {
    let obj = object(value)?;
    Ok(Concept {
        id: opt_string(obj, "id")?,
        name: opt_string(obj, "name")?,
        media: opt_list_of(obj, "media", media)?,
        price: opt_object_of(obj, "price", concept_price)?,
        products: opt_list_of(obj, "products", product_ref)?,
    })
}

/// One product element.
pub(super) fn grid_product(value: &Value) -> Result<CategoryGridProduct, Invalid> {
    let obj = object(value)?;
    // The schema declares `npTitleId`, so a value of the wrong type drops the
    // element although no code reads it.
    opt_string(obj, "npTitleId")?;
    Ok(CategoryGridProduct {
        id: opt_string(obj, "id")?,
        name: opt_string(obj, "name")?,
        media: opt_list_of(obj, "media", media)?,
        price: opt_object_of(obj, "price", concept_price)?,
        platforms: opt_strings(obj, "platforms")?,
        store_display_classification: opt_string(obj, "storeDisplayClassification")?,
    })
}

/// Decodes each element on its own and counts the failures.
fn decode_each<T>(items: &[Value], decode: fn(&Value) -> Result<T, Invalid>) -> (Vec<T>, usize) {
    let mut kept = Vec::new();
    let mut dropped = 0;
    for item in items {
        match decode(item) {
            Ok(value) => kept.push(value),
            Err(Invalid) => dropped += 1,
        }
    }
    (kept, dropped)
}

/// The `data.categoryGridRetrieve` node, or `None` when the body, `data`, or
/// the node is missing, `null`, or not an object envelope.
fn grid_node(json: &Value) -> Option<&Value> {
    let data = object(json).ok()?.get("data")?;
    if data.is_null() {
        return None;
    }
    object(data)
        .ok()?
        .get("categoryGridRetrieve")
        .filter(|node| !node.is_null())
}

struct ParsedGrid {
    concepts: Vec<Concept>,
    products: Vec<CategoryGridProduct>,
    dropped: usize,
}

/// The node decoded per element, or `None` when its outer shape is
/// unintelligible.
fn parse_grid(node: &Value) -> Option<ParsedGrid> {
    let obj = object(node).ok()?;
    let concepts = opt_list(obj, "concepts").ok()?.unwrap_or_default();
    let products = opt_list(obj, "products").ok()?.unwrap_or_default();
    let (concepts, dropped_concepts) = decode_each(concepts, concept);
    let (products, dropped_products) = decode_each(products, grid_product);
    Some(ParsedGrid {
        concepts,
        products,
        dropped: dropped_concepts + dropped_products,
    })
}

/// The outcome of a NEW, UPCOMING, or DISCOUNTED grid response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CategoryGridOutcome {
    /// The node is absent or its outer shape is unintelligible.
    Drift,
    /// The kept concepts and the number of elements that failed to decode.
    Ok {
        concepts: Vec<Concept>,
        dropped: usize,
    },
}

/// A grid response: the concepts when there are any, otherwise the products
/// as concepts.
pub fn extract_category_grid(json: &Value) -> CategoryGridOutcome {
    let Some(grid) = grid_node(json).and_then(parse_grid) else {
        return CategoryGridOutcome::Drift;
    };
    let concepts = if grid.concepts.is_empty() {
        grid.products.iter().map(product_to_concept).collect()
    } else {
        grid.concepts
    };
    CategoryGridOutcome::Ok {
        concepts,
        dropped: grid.dropped,
    }
}

/// Sony's `pageInfo.isLast`, or `None` when the node has no readable value.
fn parse_grid_is_last(node: &Value) -> Option<bool> {
    let obj = object(node).ok()?;
    let page_info =
        opt_object_of(obj, "pageInfo", |value| opt_bool(object(value)?, "isLast")).ok()?;
    page_info.flatten()
}

/// The outcome of a BROWSE grid response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowseOutcome {
    Drift,
    Ok {
        concepts: Vec<Concept>,
        is_last: bool,
        dropped: usize,
    },
}

/// A BROWSE page. Without readable page info, a page shorter than `size` is
/// the last one. BROWSE reads the concepts only.
pub fn extract_browse_page(json: &Value, size: usize) -> BrowseOutcome {
    let Some(node) = grid_node(json) else {
        return BrowseOutcome::Drift;
    };
    let Some(grid) = parse_grid(node) else {
        return BrowseOutcome::Drift;
    };
    let is_last = parse_grid_is_last(node).unwrap_or(grid.concepts.len() < size);
    BrowseOutcome::Ok {
        concepts: grid.concepts,
        is_last,
        dropped: grid.dropped,
    }
}

/// Sony's facet name of the concept genre.
const GENRE_FACET_NAME: &str = "conceptGenres";

struct ParsedGenreFacet {
    genres: Vec<RawGenre>,
    dropped: usize,
}

/// The values of the genre facet, decoded per element, or `None` when the
/// node has no genre facet.
fn parse_genre_facet(node: &Value) -> Option<ParsedGenreFacet> {
    let obj = object(node).ok()?;
    let options = opt_list(obj, "facetOptions").ok()?.unwrap_or_default();
    let values = options
        .iter()
        .filter_map(|option| {
            let facet = object(option).ok()?;
            let name = opt_string(facet, "name").ok()?;
            let values = opt_list(facet, "values").ok()?;
            Some((name, values))
        })
        .find(|(name, _)| name.as_deref() == Some(GENRE_FACET_NAME))
        .and_then(|(_, values)| values)?;
    let mut genres = Vec::new();
    let mut dropped = 0;
    for item in values {
        match genre_value(item) {
            Some(genre) => genres.push(genre),
            None => dropped += 1,
        }
    }
    Some(ParsedGenreFacet { genres, dropped })
}

/// A facet value with a non-empty key and display name.
fn genre_value(item: &Value) -> Option<RawGenre> {
    let obj = object(item).ok()?;
    let key = opt_string(obj, "key").ok()?;
    let name = opt_string(obj, "displayName").ok()?;
    match (key, name) {
        (Some(key), Some(name)) if !key.is_empty() && !name.is_empty() => {
            Some(RawGenre { key, name })
        }
        _ => None,
    }
}

/// The outcome of a genre list response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GenresOutcome {
    /// No genre facet, or a facet without one usable genre.
    Drift,
    Ok {
        genres: Vec<Genre>,
        dropped: usize,
    },
}

/// The genre menu: the facet values with an API key, sorted by name.
pub fn extract_genres(json: &Value) -> GenresOutcome {
    let Some(facet) = grid_node(json).and_then(parse_genre_facet) else {
        return GenresOutcome::Drift;
    };
    let raw_count = facet.genres.len();
    let genres = narrow_genres(facet.genres);
    if genres.is_empty() {
        return GenresOutcome::Drift;
    }
    let dropped = facet.dropped + raw_count - genres.len();
    GenresOutcome::Ok { genres, dropped }
}
