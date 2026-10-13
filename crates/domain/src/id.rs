//! The entity ids that cross the crate boundary or the API: one type per
//! entity.
//!
//! The constructors keep the acceptance rules of the TypeScript server. Sony
//! data that the boundary does not validate stays text in the catalogue
//! types of `catalog.rs`; the scope functions in `listing.rs` turn it into
//! these types.

use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize};

use super::js::js_trim;
use super::product_id::is_valid_product_id;

/// A value that does not have the format of the id type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the value does not have the format of the id")]
pub struct InvalidId;

/// The id of a game card and of a game page path: a product SKU id or
/// another Sony id. It is never empty.
///
/// A card keeps Sony's text as it is. Only the game page path is trimmed
/// ([`GameId::from_path`]). The JSON form is the plain string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct GameId(String);

impl GameId {
    /// The id of a game page path: trimmed like JavaScript `trim()`, and not
    /// empty.
    #[must_use]
    pub fn from_path(raw: &str) -> Option<Self> {
        let id = js_trim(raw);
        (!id.is_empty()).then(|| Self(id.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The product SKU id, when this id is one.
    #[must_use]
    pub fn product_id(&self) -> Option<ProductId> {
        ProductId::parse(&self.0)
    }
}

/// Compares the id with a text, for example a requested id.
impl PartialEq<str> for GameId {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl PartialEq<&str> for GameId {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

impl PartialEq<String> for GameId {
    fn eq(&self, other: &String) -> bool {
        self.0 == *other
    }
}

/// A card id from Sony data. Only the empty string is invalid.
impl TryFrom<String> for GameId {
    type Error = InvalidId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() {
            Err(InvalidId)
        } else {
            Ok(Self(value))
        }
    }
}

impl From<ProductId> for GameId {
    fn from(id: ProductId) -> Self {
        Self(id.0)
    }
}

impl From<ConceptId> for GameId {
    fn from(id: ConceptId) -> Self {
        Self(id.0)
    }
}

/// The same rule as [`TryFrom<String>`].
impl FromStr for GameId {
    type Err = InvalidId;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::try_from(value.to_owned())
    }
}

/// Deserialization applies the same rule as [`TryFrom<String>`], so it
/// cannot create an empty id.
impl<'de> Deserialize<'de> for GameId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::try_from(value).map_err(serde::de::Error::custom)
    }
}

/// A Sony product SKU id, for example `EP0006-PPSA04874_00-APEXLEGENDRSPWN1`
/// ([`is_valid_product_id`]).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ProductId(String);

impl ProductId {
    /// Returns `None` when the value is not a product SKU id.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        is_valid_product_id(value).then(|| Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl PartialEq<str> for ProductId {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl PartialEq<&str> for ProductId {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

impl PartialEq<String> for ProductId {
    fn eq(&self, other: &String) -> bool {
        self.0 == *other
    }
}

impl FromStr for ProductId {
    type Err = InvalidId;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value).ok_or(InvalidId)
    }
}

impl TryFrom<String> for ProductId {
    type Error = InvalidId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if is_valid_product_id(&value) {
            Ok(Self(value))
        } else {
            Err(InvalidId)
        }
    }
}

/// A Sony concept id: one or more ASCII digits, for example `10001234`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConceptId(String);

impl ConceptId {
    /// Returns `None` when the value is empty or has a character other than
    /// an ASCII digit.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        (!value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()))
            .then(|| Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRODUCT: &str = "EP0006-PPSA04874_00-APEXLEGENDRSPWN1";

    #[test]
    fn a_path_id_is_trimmed_like_javascript_and_not_empty() {
        let id = GameId::from_path("\u{feff} \t EP0001-PPSA00001_00-X \n").unwrap();
        assert_eq!(id.as_str(), "EP0001-PPSA00001_00-X");
        assert_eq!(GameId::from_path(" \u{a0} "), None);
        assert_eq!(GameId::from_path(""), None);
    }

    #[test]
    fn a_card_id_keeps_sony_text_and_rejects_only_the_empty_string() {
        let id = GameId::try_from(" concept-id ".to_owned()).unwrap();
        assert_eq!(id.as_str(), " concept-id ");
        assert_eq!(GameId::try_from(String::new()), Err(InvalidId));
    }

    #[test]
    fn a_game_id_serializes_as_the_plain_string_and_rejects_empty_json() {
        let id = GameId::try_from(PRODUCT.to_owned()).unwrap();
        assert_eq!(
            serde_json::to_string(&id).unwrap(),
            format!("\"{PRODUCT}\"")
        );
        let back: GameId = serde_json::from_str(&format!("\"{PRODUCT}\"")).unwrap();
        assert_eq!(back, id);
        assert!(serde_json::from_str::<GameId>("\"\"").is_err());
    }

    #[test]
    fn a_product_id_has_the_sku_format() {
        assert_eq!(ProductId::parse(PRODUCT).unwrap().as_str(), PRODUCT);
        assert_eq!(ProductId::parse("10001234"), None);
        assert_eq!(ProductId::try_from(String::new()), Err(InvalidId));
        // The check reads the first 20 bytes only, like the TypeScript rule.
        assert!(ProductId::parse("EP0006-PPSA04874_00- trailing").is_some());
        let game: GameId = ProductId::parse(PRODUCT).unwrap().into();
        assert_eq!(game.product_id(), ProductId::parse(PRODUCT));
        assert_eq!(
            GameId::try_from("10001234".to_owned())
                .unwrap()
                .product_id(),
            None
        );
    }

    #[test]
    fn a_concept_id_has_digits_only() {
        assert_eq!(ConceptId::parse("10001234").unwrap().as_str(), "10001234");
        assert_eq!(ConceptId::parse(""), None);
        assert_eq!(ConceptId::parse("1000-1234"), None);
        assert_eq!(ConceptId::parse(PRODUCT), None);
        let game: GameId = ConceptId::parse("10001234").unwrap().into();
        assert_eq!(game.as_str(), "10001234");
    }
}
