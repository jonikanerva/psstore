//! One page of the signed-in library list. Port of
//! `server/src/sony/purchasedSchema.ts`.
//!
//! The envelope must be `data.purchasedTitlesRetrieve.games`; any other shape
//! is drift. Games decode one by one, so a malformed element never drops its
//! neighbours. Scope is default-drop: an entry is kept only when its platform
//! is exactly `PS5`, its name is not empty, and its product id is valid.

use serde_json::Value;

use super::fields::{Field, WrongType, nullable_string};
use crate::domain::library::PurchasedEntry;
use crate::domain::product_id::is_valid_product_id;

/// A decoded page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PurchasedPage {
    /// The games that Sony returned on this page, before any filter. The crawl
    /// compares it with the page size to find the last page.
    pub raw_count: usize,
    pub entries: Vec<PurchasedEntry>,
    /// Elements that failed decode or had no usable id or name.
    pub dropped: usize,
    /// Decoded elements outside the product scope (platform or id).
    pub out_of_scope: usize,
}

/// The page, or `None` for an envelope of another shape (drift).
pub(super) fn parse_page(body: &Value) -> Option<PurchasedPage> {
    let games = body
        .as_object()?
        .get("data")?
        .as_object()?
        .get("purchasedTitlesRetrieve")?
        .as_object()?
        .get("games")?
        .as_array()?;
    let mut page = PurchasedPage {
        raw_count: games.len(),
        entries: Vec::new(),
        dropped: 0,
        out_of_scope: 0,
    };
    for game in games {
        match decode_entry(game) {
            Field::Kept(entry) => page.entries.push(entry),
            Field::Dropped => page.dropped += 1,
            Field::OutOfScope => page.out_of_scope += 1,
        }
    }
    Some(page)
}

fn decode_entry(raw: &Value) -> Field<PurchasedEntry> {
    let Some(game) = raw.as_object() else {
        return Field::Dropped;
    };
    // `image` is absent, `null`, or an object whose `url` is absent, `null`,
    // or a string. Any other shape fails the element.
    let image_url = match game.get("image") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(image)) => nullable_string(image, "url"),
        Some(_) => Err(WrongType),
    };
    let (Ok(product_id), Ok(name), Ok(platform), Ok(image_url)) = (
        nullable_string(game, "productId"),
        nullable_string(game, "name"),
        nullable_string(game, "platform"),
        image_url,
    ) else {
        return Field::Dropped;
    };
    let (Some(product_id), Some(name)) = (product_id, name) else {
        return Field::Dropped;
    };
    if name.is_empty() {
        return Field::Dropped;
    }
    if platform != Some("PS5") || !is_valid_product_id(product_id) {
        return Field::OutOfScope;
    }
    Field::Kept(PurchasedEntry {
        product_id: product_id.to_owned(),
        name: name.to_owned(),
        image_url: image_url.unwrap_or_default().to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::domain::game::IdKind;
    use crate::domain::library::purchased_cards;

    /// The synthetic fixture of the TypeScript tests. It holds no real account
    /// data (`crates/server/tests/fixtures/README.md`).
    const FIXTURE: &str = include_str!("../../../../tests/fixtures/purchasedPage.synthetic.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).unwrap()
    }

    fn page(games: &[Value]) -> Value {
        json!({"data": {"purchasedTitlesRetrieve": {"games": games}}})
    }

    fn game(overrides: &Value) -> Value {
        let mut game = json!({
            "conceptId": "10000001",
            "name": "Synthetic Game",
            "platform": "PS5",
            "productId": "EP0001-PPSA00001_00-SYNTHETICGAME000",
            "image": {"url": "https://img.test/game.png"},
        });
        for (key, value) in overrides.as_object().unwrap() {
            game[key] = value.clone();
        }
        game
    }

    fn without(key: &str) -> Value {
        let mut game = game(&json!({}));
        game.as_object_mut().unwrap().remove(key);
        game
    }

    #[test]
    fn keeps_only_exact_ps5_entries_from_the_synthetic_fixture() {
        let outcome = parse_page(&fixture()).unwrap();
        assert_eq!(outcome.raw_count, 5);
        let names: Vec<_> = outcome.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Synthetic Alpha", "Synthetic Beta"]);
        assert_eq!(outcome.out_of_scope, 3);
        assert_eq!(outcome.dropped, 0);
    }

    #[test]
    fn drops_other_platforms_odd_case_and_missing_platforms() {
        for platform in [
            json!("PS4"),
            json!("PS3"),
            json!("ps5"),
            json!("Ps5"),
            json!(" PS5"),
            json!(""),
            json!(null),
        ] {
            let outcome = parse_page(&page(&[game(&json!({ "platform": platform }))])).unwrap();
            assert!(outcome.entries.is_empty(), "{platform}");
            assert_eq!(outcome.out_of_scope, 1, "{platform}");
        }
        let missing = parse_page(&page(&[without("platform")])).unwrap();
        assert!(missing.entries.is_empty(), "{:?}", missing.entries);
        assert_eq!(missing.out_of_scope, 1);
    }

    #[test]
    fn drops_an_invalid_product_id_as_out_of_scope() {
        for id in ["bogus", "", "10000001"] {
            let outcome = parse_page(&page(&[game(&json!({ "productId": id }))])).unwrap();
            assert!(outcome.entries.is_empty(), "{id}");
            assert_eq!(outcome.out_of_scope, 1, "{id}");
        }
    }

    #[test]
    fn counts_a_malformed_element_as_dropped_and_keeps_its_neighbours() {
        let outcome = parse_page(&page(&[
            json!(42),
            json!(null),
            game(&json!({"name": ""})),
            game(&json!({"productId": 7})),
            game(&json!({})),
        ]))
        .unwrap();
        assert_eq!(outcome.dropped, 4);
        assert_eq!(outcome.entries.len(), 1);
        assert_eq!(outcome.raw_count, 5);
    }

    /// Challenge cases beyond the TypeScript tests: every field of the wrong
    /// type fails the element, and a missing id or name drops it.
    #[test]
    fn a_field_of_the_wrong_type_drops_the_element() {
        for broken in [
            game(&json!({"name": 5})),
            game(&json!({"name": null})),
            game(&json!({"productId": null})),
            game(&json!({"platform": ["PS5"]})),
            game(&json!({"image": "https://img.test/x.png"})),
            game(&json!({"image": {"url": 5}})),
            game(&json!({"image": []})),
            without("name"),
            without("productId"),
            json!([]),
            json!("Synthetic Game"),
        ] {
            let outcome = parse_page(&page(std::slice::from_ref(&broken))).unwrap();
            assert_eq!(outcome.dropped, 1, "{broken}");
            assert!(outcome.entries.is_empty(), "{broken}");
        }
    }

    #[test]
    fn reports_an_unknown_envelope_as_drift() {
        for body in [
            json!(null),
            json!({}),
            json!([]),
            json!({"data": null}),
            json!({"data": {}}),
            json!({"data": []}),
            json!({"data": {"purchasedTitlesRetrieve": null}}),
            json!({"data": {"purchasedTitlesRetrieve": {"games": "x"}}}),
            json!({"data": {"purchasedTitlesRetrieve": {"games": null}}}),
            json!({"data": {"purchasedTitlesRetrieve": {}}}),
        ] {
            assert_eq!(parse_page(&body), None, "{body}");
        }
    }

    #[test]
    fn treats_an_empty_list_as_a_successful_empty_page() {
        let outcome = parse_page(&page(&[])).unwrap();
        assert_eq!(outcome.raw_count, 0);
        assert!(outcome.entries.is_empty(), "{:?}", outcome.entries);
    }

    #[test]
    fn uses_an_empty_image_url_when_the_image_is_absent() {
        for game in [
            game(&json!({"image": null})),
            without("image"),
            game(&json!({"image": {}})),
            game(&json!({"image": {"url": null}})),
        ] {
            let outcome = parse_page(&page(std::slice::from_ref(&game))).unwrap();
            assert_eq!(outcome.entries[0].image_url, "", "{game}");
        }
    }

    #[test]
    fn the_cards_always_link_to_the_product() {
        let outcome = parse_page(&fixture()).unwrap();
        let cards = purchased_cards(&outcome.entries);
        let ids: Vec<_> = cards.iter().map(|g| (g.id.as_str(), g.id_kind)).collect();
        assert_eq!(
            ids,
            [
                ("EP0001-PPSA00001_00-SYNTHETICALPHA00", IdKind::Product),
                ("EP0001-PPSA00002_00-SYNTHETICBETA000", IdKind::Product),
            ]
        );
    }
}
