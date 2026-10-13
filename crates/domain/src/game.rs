//! The game card and the list payloads of the public API.
//!
//! The JSON field names, the field order, and the `null` values are part of
//! the contract with the client (`shared/src/schemas/game.ts`). The committed
//! examples in `docs/contracts/api/` pin the exact JSON.

use serde::{Deserialize, Serialize};

/// One PS5 game card. All prices are Sony's verbatim strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub name: String,
    /// A UTC instant as an ISO-8601 string, or the empty string when Sony
    /// gives no valid date.
    pub date: String,
    /// The cover image URL.
    pub url: String,
    pub price: String,
    pub original_price: String,
    pub discount_text: String,
    pub discount_date: String,
    pub screenshots: Vec<String>,
    pub videos: Vec<String>,
    pub genres: Vec<String>,
    pub description: String,
    pub studio: String,
    pub pre_order: bool,
    pub plus_upsell_text: Option<String>,
    /// Set only by the game page lookup. List payloads carry `null`.
    pub plus_offer: Option<PlusOffer>,
    pub id_kind: IdKind,
}

/// The PS Plus offer on the game page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlusOffer {
    /// A PS Plus price as Sony's verbatim string.
    Price { price: String },
    /// The game is part of a PS Plus subscription tier.
    Included,
}

/// What the `id` of a game identifies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdKind {
    /// A product SKU with a store page and usually a price.
    Product,
    /// An announced UPCOMING title that Sony does not expose as a priced SKU.
    Concept,
}

/// The game page payload: a game and an optional critic score.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDetail {
    #[serde(flatten)]
    pub game: Game,
    /// The aggregated critic score, 0 to 100. The key is absent when no
    /// trusted score exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critic_score: Option<CriticScore>,
}

/// An aggregated critic score in the range 0 to 100.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct CriticScore(u8);

impl CriticScore {
    /// Returns `None` for a value above 100.
    #[must_use]
    pub fn new(value: u8) -> Option<Self> {
        (value <= 100).then_some(Self(value))
    }

    #[must_use]
    pub fn value(self) -> u8 {
        self.0
    }
}

/// One page of a game list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResult {
    pub games: Vec<Game>,
    pub total_count: usize,
    /// The offset of the next page, or `null` on the last page.
    pub next_offset: Option<usize>,
}

/// One Sony genre: its facet key and its display name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Genre {
    pub key: String,
    pub name: String,
}

/// The BROWSE genre menu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenreList {
    pub genres: Vec<Genre>,
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn sample_game() -> Game {
        Game {
            id: "EP0001-PPSA00001_00-SAMPLEGAME000001".into(),
            name: "Sample".into(),
            date: "2026-10-14T21:00:00Z".into(),
            url: "https://image.example/cover.png".into(),
            price: "€49,95".into(),
            original_price: String::new(),
            discount_text: String::new(),
            discount_date: String::new(),
            screenshots: vec![],
            videos: vec![],
            genres: vec![],
            description: String::new(),
            studio: String::new(),
            pre_order: false,
            plus_upsell_text: None,
            plus_offer: None,
            id_kind: IdKind::Product,
        }
    }

    #[test]
    fn serializes_a_list_game_with_null_fields_in_contract_order() {
        let json = serde_json::to_string(&sample_game()).unwrap();
        assert_eq!(
            json,
            r#"{"id":"EP0001-PPSA00001_00-SAMPLEGAME000001","name":"Sample","date":"2026-10-14T21:00:00Z","url":"https://image.example/cover.png","price":"€49,95","originalPrice":"","discountText":"","discountDate":"","screenshots":[],"videos":[],"genres":[],"description":"","studio":"","preOrder":false,"plusUpsellText":null,"plusOffer":null,"idKind":"product"}"#
        );
    }

    #[test]
    fn serializes_both_plus_offer_kinds() {
        let price = PlusOffer::Price {
            price: "€39,95".into(),
        };
        assert_eq!(
            serde_json::to_string(&price).unwrap(),
            r#"{"kind":"price","price":"€39,95"}"#
        );
        assert_eq!(
            serde_json::to_string(&PlusOffer::Included).unwrap(),
            r#"{"kind":"included"}"#
        );
    }

    #[test]
    fn game_detail_omits_a_missing_score_and_appends_a_present_one() {
        let without = GameDetail {
            game: sample_game(),
            critic_score: None,
        };
        let text = serde_json::to_string(&without).unwrap();
        assert!(!text.contains("criticScore"), "{text}");
        assert!(text.ends_with(r#""idKind":"product"}"#), "{text}");

        let with = GameDetail {
            game: sample_game(),
            critic_score: CriticScore::new(87),
        };
        let text = serde_json::to_string(&with).unwrap();
        assert!(
            text.ends_with(r#""idKind":"product","criticScore":87}"#),
            "{text}"
        );
    }

    #[test]
    fn critic_score_rejects_values_above_100() {
        assert_eq!(CriticScore::new(100).map(CriticScore::value), Some(100));
        assert_eq!(CriticScore::new(101), None);
    }

    #[test]
    fn serializes_a_page_with_a_null_next_offset() {
        let page = PageResult {
            games: vec![],
            total_count: 0,
            next_offset: None,
        };
        assert_eq!(
            serde_json::to_string(&page).unwrap(),
            r#"{"games":[],"totalCount":0,"nextOffset":null}"#
        );
    }
}
