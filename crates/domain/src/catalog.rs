//! Sony store data after the boundary decode.
//!
//! The Sony adapter decodes each response into these types before any other
//! code reads it. A field is `None` when Sony sent no value or `null`: the
//! TypeScript server read both the same way. The types keep the shape of
//! Sony's data; the scope rules live in `listing.rs`.

use super::browse::{BrowseOrder, GenreKey};
use super::game::PlusOffer;

/// One media entry of a concept or a product.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Media {
    pub url: Option<String>,
    pub role: Option<String>,
    /// Sony's `type`, for example `IMAGE` or `VIDEO`.
    pub kind: Option<String>,
}

/// The list price of a concept or a product, as Sony's verbatim strings.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConceptPrice {
    pub base_price: Option<String>,
    pub discounted_price: Option<String>,
    pub discount_text: Option<String>,
    pub service_branding: Option<Vec<String>>,
    pub upsell_service_branding: Option<Vec<String>>,
    pub upsell_text: Option<String>,
}

/// A product that a concept names.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConceptProductRef {
    pub id: Option<String>,
    pub release_date: Option<String>,
    pub provider_name: Option<String>,
    pub genres: Option<Vec<String>>,
}

/// A concept of the category grid or of the search result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Concept {
    pub id: Option<String>,
    pub name: Option<String>,
    pub media: Option<Vec<Media>>,
    pub price: Option<ConceptPrice>,
    pub products: Option<Vec<ConceptProductRef>>,
}

/// A product of the category grid or of the search result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CategoryGridProduct {
    pub id: Option<String>,
    pub name: Option<String>,
    pub media: Option<Vec<Media>>,
    pub price: Option<ConceptPrice>,
    pub platforms: Option<Vec<String>>,
    pub store_display_classification: Option<String>,
}

/// The product detail of the game page and of the list date enrichment.
/// Text fields that Sony sent empty are `None`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProductDetail {
    pub name: Option<String>,
    pub media: Vec<Media>,
    pub release_date: Option<String>,
    pub genres: Vec<String>,
    /// The LONG description, or the SHORT one, or the empty string.
    pub description: String,
    pub publisher_name: Option<String>,
    pub store_display_classification: Option<String>,
    pub platforms: Vec<String>,
}

/// The standard (non-subscription) price of a product, as Sony's verbatim
/// strings. An absent value is the empty string.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StandardPrice {
    pub base_price: String,
    pub discounted_price: String,
    pub discount_text: String,
}

/// The PS Plus offer and the standard price of one product.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProductPrice {
    pub plus_offer: Option<PlusOffer>,
    pub standard: Option<StandardPrice>,
}

/// One PS5 game of the PS Plus monthly feed, in scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlusMonthlyEntry {
    pub product_id: String,
    pub name: String,
    pub image_url: String,
    pub release_date: String,
    pub genres: Vec<String>,
}

/// One decoded element of the search result, before the scope check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchEntry {
    Product(CategoryGridProduct),
    Concept(Concept),
}

/// A search result that survived the scope check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchCandidate {
    /// The search response itself proves a PS5 game.
    Known(Concept),
    /// A concept that names a product id. The product detail must prove a
    /// PS5 game.
    Unverified {
        product_id: String,
        concept: Concept,
    },
}

/// One search page after the scope check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchPage {
    pub candidates: Vec<SearchCandidate>,
    /// Sony's `pageInfo.isLast`.
    pub is_last: bool,
    /// The number of result elements before the scope check, the dropped
    /// elements included.
    pub raw_count: usize,
}

/// One BROWSE grid page in Sony's order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowsePage {
    pub concepts: Vec<Concept>,
    pub is_last: bool,
}

/// One value of Sony's genre facet, before the key format check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawGenre {
    pub key: String,
    pub name: String,
}

/// The category grid lists that NEW, UPCOMING, and DISCOUNTED read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SonyFeature {
    /// PS5 games released in the last thirty days.
    New,
    /// PS5 games that release in the next thirty days.
    Upcoming,
    /// The PS5 deals category.
    Discounted,
}

impl SonyFeature {
    /// The name of the feature, for a log field.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Upcoming => "upcoming",
            Self::Discounted => "discounted",
        }
    }
}

/// One BROWSE page request to Sony.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BrowseRequest {
    pub genre: GenreKey,
    pub order: BrowseOrder,
    pub offset: usize,
    pub size: usize,
}
