//! The signed-in lists: the purchased games and the Sony wishlist, and their
//! game cards.
//!
//! The Sony adapter decodes and narrows the lists at its boundary, so every
//! entry here is in scope: a PS5 game with a non-empty name and a valid id.
//! The values are account data. Never log them.

use std::collections::HashSet;

use super::game::{Game, IdKind};

/// One game of the purchased library.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchasedEntry {
    /// A valid product SKU id.
    pub product_id: String,
    pub name: String,
    /// The cover image URL, or the empty string.
    pub image_url: String,
}

/// One game of the Sony wishlist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WishlistEntry {
    /// A product SKU id for [`IdKind::Product`], a concept id (digits only)
    /// for [`IdKind::Concept`].
    pub id: String,
    pub id_kind: IdKind,
    pub name: String,
    /// The cover image URL, or the empty string.
    pub image_url: String,
}

/// Keeps the first entry per product id, in Sony's order.
pub fn dedupe_purchased(entries: Vec<PurchasedEntry>) -> Vec<PurchasedEntry> {
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter(|entry| seen.insert(entry.product_id.clone()))
        .collect()
}

/// A card with a name and an image only. The signed-in lists carry no release
/// date and no price, so those fields stay empty.
fn library_card(id: &str, name: &str, image_url: &str, id_kind: IdKind) -> Game {
    Game {
        id: id.to_owned(),
        name: name.to_owned(),
        date: String::new(),
        url: image_url.to_owned(),
        price: String::new(),
        original_price: String::new(),
        discount_text: String::new(),
        discount_date: String::new(),
        screenshots: Vec::new(),
        videos: Vec::new(),
        genres: Vec::new(),
        description: String::new(),
        studio: String::new(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: None,
        id_kind,
    }
}

/// The purchased cards in Sony's order. The id is always the product id,
/// because the game page resolves product ids.
pub fn purchased_cards(entries: &[PurchasedEntry]) -> Vec<Game> {
    entries
        .iter()
        .map(|entry| {
            library_card(
                &entry.product_id,
                &entry.name,
                &entry.image_url,
                IdKind::Product,
            )
        })
        .collect()
}

/// The minimal card of a wishlist entry. The id kind comes from the entry:
/// the boundary has already checked the id against it.
pub fn wishlist_card(entry: &WishlistEntry) -> Game {
    library_card(&entry.id, &entry.name, &entry.image_url, entry.id_kind)
}

/// The minimal cards of a wishlist, in Sony's order.
pub fn wishlist_cards(entries: &[WishlistEntry]) -> Vec<Game> {
    entries.iter().map(wishlist_card).collect()
}

/// A wishlist card: the public store's game when the store returned one,
/// else the minimal card. The card keeps the wishlist id and takes a missing
/// name or cover from the entry.
pub fn merge_wishlist_entry(entry: &WishlistEntry, found: Option<Game>) -> Game {
    match found {
        None => wishlist_card(entry),
        Some(game) => Game {
            id: entry.id.clone(),
            name: if game.name.is_empty() {
                entry.name.clone()
            } else {
                game.name
            },
            url: if game.url.is_empty() {
                entry.image_url.clone()
            } else {
                game.url
            },
            ..game
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::game::PlusOffer;

    const PRODUCT: &str = "EP0001-PPSA00001_00-SYNTHETICALPHA00";

    fn purchased(product_id: &str, name: &str) -> PurchasedEntry {
        PurchasedEntry {
            product_id: product_id.into(),
            name: name.into(),
            image_url: "u".into(),
        }
    }

    fn wish(id: &str, id_kind: IdKind, name: &str, image_url: &str) -> WishlistEntry {
        WishlistEntry {
            id: id.into(),
            id_kind,
            name: name.into(),
            image_url: image_url.into(),
        }
    }

    fn store_game() -> Game {
        Game {
            id: "store-id".into(),
            name: "Store name".into(),
            date: "2025-01-02T00:00:00.000Z".into(),
            url: "https://img.test/store.png".into(),
            price: "€39,99".into(),
            original_price: "€59,99".into(),
            discount_text: "-33%".into(),
            discount_date: String::new(),
            screenshots: vec![],
            videos: vec![],
            genres: vec!["Action".into()],
            description: String::new(),
            studio: String::new(),
            pre_order: false,
            plus_upsell_text: None,
            plus_offer: Some(PlusOffer::Price {
                price: "€29,99".into(),
            }),
            id_kind: IdKind::Product,
        }
    }

    #[test]
    fn dedupe_keeps_the_first_entry_per_product_id_in_sony_order() {
        let unique = dedupe_purchased(vec![
            purchased("A", "first"),
            purchased("B", "second"),
            purchased("A", "duplicate"),
        ]);
        let names: Vec<_> = unique.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["first", "second"]);
    }

    #[test]
    fn purchased_cards_keep_sony_order_with_no_date_and_no_price() {
        let cards = purchased_cards(&[purchased("B", "Bravo"), purchased("A", "Alpha")]);
        let names: Vec<_> = cards.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["Bravo", "Alpha"]);
        let first = &cards[0];
        assert_eq!(first.id, "B");
        assert_eq!(first.id_kind, IdKind::Product);
        assert_eq!(first.url, "u");
        assert_eq!((first.date.as_str(), first.price.as_str()), ("", ""));
        assert!(!first.pre_order);
        assert_eq!(first.plus_offer, None);
    }

    #[test]
    fn wishlist_cards_map_name_and_image_only_in_sony_order() {
        let cards = wishlist_cards(&[
            wish("10000001", IdKind::Concept, "B", "b"),
            wish(PRODUCT, IdKind::Product, "A", "a"),
        ]);
        let names: Vec<_> = cards.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["B", "A"]);
        let first = &cards[0];
        assert_eq!(first.id, "10000001");
        assert_eq!(first.id_kind, IdKind::Concept);
        assert_eq!(first.url, "b");
        assert_eq!(first.price, "");
        assert_eq!(first.original_price, "");
        assert_eq!(first.discount_text, "");
        assert_eq!(first.plus_offer, None);
        assert_eq!(cards[1].id_kind, IdKind::Product);
    }

    #[test]
    fn merge_keeps_the_store_game_with_the_wishlist_id() {
        let entry = wish(PRODUCT, IdKind::Product, "Wish", "https://img.test/w.png");
        let merged = merge_wishlist_entry(&entry, Some(store_game()));
        assert_eq!(merged.id, PRODUCT);
        assert_eq!(merged.name, "Store name");
        assert_eq!(merged.url, "https://img.test/store.png");
        assert_eq!(merged.price, "€39,99");
        assert_eq!(merged.date, "2025-01-02T00:00:00.000Z");
        assert_eq!(
            merged.plus_offer,
            Some(PlusOffer::Price {
                price: "€29,99".into()
            })
        );
    }

    #[test]
    fn merge_fills_an_empty_store_name_or_cover_from_the_entry() {
        let entry = wish(PRODUCT, IdKind::Product, "Wish", "https://img.test/w.png");
        let mut game = store_game();
        game.name = String::new();
        game.url = String::new();
        let merged = merge_wishlist_entry(&entry, Some(game));
        assert_eq!(merged.name, "Wish");
        assert_eq!(merged.url, "https://img.test/w.png");
        assert_eq!(merged.price, "€39,99");
    }

    #[test]
    fn merge_without_a_store_game_is_the_minimal_card() {
        let entry = wish(
            "10000002",
            IdKind::Concept,
            "Wish",
            "https://img.test/w.png",
        );
        assert_eq!(merge_wishlist_entry(&entry, None), wishlist_card(&entry));
    }
}
