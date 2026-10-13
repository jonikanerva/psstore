//! The signed-in wishlist. Port of `server/src/sony/wishlistSchema.ts`.
//!
//! The list is one array at `data.storeWishlistSecure`. Entries decode one by
//! one, so a malformed element never drops its neighbours. Scope is
//! default-drop: an entry is kept only when its platforms contain `PS5`, its
//! name is not empty, and its id is valid for its `__typename`. A `null` or
//! missing list is drift unless Sony also answered "access denied": it is
//! never an empty wishlist.

use std::collections::HashSet;

use serde_json::Value;

use super::fields::{Field, WrongType, nullable_string};
use crate::domain::game::IdKind;
use crate::domain::library::WishlistEntry;
use crate::domain::product_id::is_valid_product_id;

/// The decoded wishlist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum WishlistOutcome {
    /// Sony answered "access denied" and returned no list.
    Denied,
    /// The envelope has another shape.
    Drift,
    Listed(WishlistPage),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WishlistPage {
    /// In scope, in Sony's order, without duplicate ids.
    pub entries: Vec<WishlistEntry>,
    /// Elements that failed decode or had no usable id or name.
    pub dropped: usize,
    /// Decoded elements outside the product scope (platform, type, or id).
    pub out_of_scope: usize,
}

pub(super) fn parse(body: &Value) -> WishlistOutcome {
    let list = body
        .as_object()
        .and_then(|root| root.get("data"))
        .and_then(Value::as_object)
        .and_then(|data| data.get("storeWishlistSecure"))
        .and_then(Value::as_array);
    let Some(list) = list else {
        return if is_access_denied(body) {
            WishlistOutcome::Denied
        } else {
            WishlistOutcome::Drift
        };
    };
    let mut page = WishlistPage {
        entries: Vec::new(),
        dropped: 0,
        out_of_scope: 0,
    };
    let mut seen = HashSet::new();
    for raw in list {
        match decode_entry(raw) {
            Field::Kept(entry) => {
                if seen.insert(entry.id.clone()) {
                    page.entries.push(entry);
                }
            }
            Field::Dropped => page.dropped += 1,
            Field::OutOfScope => page.out_of_scope += 1,
        }
    }
    WishlistOutcome::Listed(page)
}

/// True for `{"errors": [...], "data": {"storeWishlistSecure": null}}` where
/// one error message contains "access denied" in any case. Each error must be
/// an object whose `message` is absent, `null`, or a string.
fn is_access_denied(body: &Value) -> bool {
    let Some(root) = body.as_object() else {
        return false;
    };
    let (Some(Value::Array(errors)), Some(Value::Object(data))) =
        (root.get("errors"), root.get("data"))
    else {
        return false;
    };
    if data.get("storeWishlistSecure") != Some(&Value::Null) {
        return false;
    }
    let mut messages = Vec::with_capacity(errors.len());
    for error in errors {
        match error
            .as_object()
            .ok_or(WrongType)
            .and_then(|e| nullable_string(e, "message"))
        {
            Ok(message) => messages.push(message.unwrap_or_default()),
            Err(WrongType) => return false,
        }
    }
    messages
        .iter()
        .any(|message| message.to_lowercase().contains("access denied"))
}

fn decode_entry(raw: &Value) -> Field<WishlistEntry> {
    let Some(entry) = raw.as_object() else {
        return Field::Dropped;
    };
    let platforms: &[Value] = match entry.get("platforms") {
        None | Some(Value::Null) => &[],
        Some(Value::Array(platforms)) => platforms,
        Some(_) => return Field::Dropped,
    };
    let (Ok(typename), Ok(id), Ok(name)) = (
        nullable_string(entry, "__typename"),
        nullable_string(entry, "id"),
        nullable_string(entry, "name"),
    ) else {
        return Field::Dropped;
    };
    let (Some(id), Some(name)) = (id, name) else {
        return Field::Dropped;
    };
    if id.is_empty() || name.is_empty() {
        return Field::Dropped;
    }
    let Some(id_kind) = id_kind(typename, id) else {
        return Field::OutOfScope;
    };
    if !platforms.iter().any(|p| p.as_str() == Some("PS5")) {
        return Field::OutOfScope;
    }
    Field::Kept(WishlistEntry {
        id: id.to_owned(),
        id_kind,
        name: name.to_owned(),
        image_url: box_art_url(entry.get("boxArt")).to_owned(),
    })
}

/// The id kind when the id is valid for the type name.
fn id_kind(typename: Option<&str>, id: &str) -> Option<IdKind> {
    match typename {
        Some("Product") if is_valid_product_id(id) => Some(IdKind::Product),
        Some("Concept") if id.bytes().all(|b| b.is_ascii_digit()) => Some(IdKind::Concept),
        _ => None,
    }
}

/// The box art URL, or the empty string. A box art of another shape never
/// fails the entry.
fn box_art_url(box_art: Option<&Value>) -> &str {
    match box_art.and_then(Value::as_object) {
        Some(art) => nullable_string(art, "url")
            .ok()
            .flatten()
            .unwrap_or_default(),
        None => "",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::domain::library::wishlist_cards;

    const PRODUCT: &str = "EP0001-PPSA00001_00-SYNTHETICALPHA00";
    const PRODUCT_TWO: &str = "EP0001-PPSA00002_00-SYNTHETICBETA000";
    const IMAGE: &str = "https://img.test/x.png";

    fn entry(overrides: &Value) -> Value {
        let mut entry = json!({
            "__typename": "Product",
            "id": PRODUCT,
            "name": "Synthetic Alpha",
            "platforms": ["PS5"],
            "boxArt": {"url": IMAGE},
            "price": {"basePrice": "€10,00"},
        });
        for (key, value) in overrides.as_object().unwrap() {
            entry[key] = value.clone();
        }
        entry
    }

    fn without(key: &str) -> Value {
        let mut entry = entry(&json!({}));
        entry.as_object_mut().unwrap().remove(key);
        entry
    }

    fn envelope(list: &Value) -> Value {
        json!({"data": {"storeWishlistSecure": list}})
    }

    fn listed(body: &Value) -> WishlistPage {
        match parse(body) {
            WishlistOutcome::Listed(page) => page,
            other => panic!("expected a list, got {other:?}"),
        }
    }

    #[test]
    fn keeps_a_ps5_product_and_maps_the_image() {
        let page = listed(&envelope(&json!([entry(&json!({}))])));
        assert_eq!(
            page.entries,
            [WishlistEntry {
                id: PRODUCT.into(),
                id_kind: IdKind::Product,
                name: "Synthetic Alpha".into(),
                image_url: IMAGE.into(),
            }]
        );
        assert_eq!(page.dropped + page.out_of_scope, 0);
    }

    #[test]
    fn keeps_a_ps4_and_ps5_product_and_a_ps5_concept() {
        let page = listed(&envelope(&json!([
            entry(&json!({"platforms": ["PS4", "PS5"]})),
            entry(&json!({"__typename": "Concept", "id": "10000001", "name": "Concept"})),
        ])));
        let kinds: Vec<_> = page.entries.iter().map(|e| e.id_kind).collect();
        assert_eq!(kinds, [IdKind::Product, IdKind::Concept]);
    }

    #[test]
    fn drops_out_of_scope_entries_by_default_and_counts_them() {
        let page = listed(&envelope(&json!([
            entry(&json!({"platforms": ["PS4"]})),
            entry(&json!({"platforms": []})),
            entry(&json!({"platforms": null})),
            without("platforms"),
            entry(&json!({"__typename": "Concept", "id": "10000001", "platforms": []})),
            entry(&json!({"__typename": "Other"})),
            entry(&json!({"__typename": null})),
            entry(&json!({"__typename": "Product", "id": "10000001"})),
            entry(&json!({"__typename": "Concept", "id": PRODUCT})),
            entry(&json!({"id": PRODUCT_TWO, "platforms": ["PS5"]})),
        ])));
        let ids: Vec<_> = page.entries.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, [PRODUCT_TWO]);
        assert_eq!(page.out_of_scope, 9);
    }

    #[test]
    fn drops_entries_without_a_usable_name_or_id_and_counts_them() {
        let page = listed(&envelope(&json!([
            entry(&json!({"name": ""})),
            entry(&json!({"name": null})),
            entry(&json!({"id": ""})),
            entry(&json!({"id": null})),
            "not an object",
            null,
            entry(&json!({"platforms": "PS5"})),
            entry(&json!({"id": PRODUCT_TWO})),
        ])));
        let ids: Vec<_> = page.entries.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, [PRODUCT_TWO]);
        assert_eq!(page.dropped, 7);
        assert_eq!(page.out_of_scope, 0);
    }

    /// Challenge cases beyond the TypeScript tests.
    #[test]
    fn a_field_of_the_wrong_type_drops_the_entry() {
        for broken in [
            entry(&json!({"__typename": 5})),
            entry(&json!({"id": 10_000_001})),
            entry(&json!({"name": ["Synthetic Alpha"]})),
            entry(&json!({"platforms": {"PS5": true}})),
            without("id"),
            without("name"),
            json!([]),
        ] {
            let page = listed(&envelope(&json!([broken.clone()])));
            assert_eq!(page.dropped, 1, "{broken}");
            assert!(page.entries.is_empty(), "{broken}");
        }
        // A concept id has digits only; a typename in another case is out
        // of scope.
        let page = listed(&envelope(&json!([
            entry(&json!({"__typename": "Concept", "id": "1000a"})),
            entry(&json!({"__typename": "product"})),
            entry(&json!({"platforms": ["ps5", " PS5", 5]})),
        ])));
        assert_eq!(page.out_of_scope, 3);
    }

    #[test]
    fn keeps_the_first_of_duplicate_ids_in_sony_order() {
        let page = listed(&envelope(&json!([
            entry(&json!({"name": "First"})),
            entry(&json!({"id": PRODUCT_TWO})),
            entry(&json!({"name": "Second"})),
        ])));
        let names: Vec<_> = page.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["First", "Synthetic Alpha"]);
        assert_eq!(page.dropped + page.out_of_scope, 0);
    }

    #[test]
    fn accepts_an_entry_without_box_art() {
        for art in [
            json!(null),
            json!([]),
            json!("x"),
            json!({}),
            json!({"url": 5}),
        ] {
            let page = listed(&envelope(&json!([entry(&json!({ "boxArt": art }))])));
            assert_eq!(page.entries[0].image_url, "", "{art}");
        }
        let page = listed(&envelope(&json!([without("boxArt")])));
        assert_eq!(page.entries[0].image_url, "");
    }

    #[test]
    fn treats_an_empty_list_as_an_empty_wishlist_not_as_drift() {
        let found = listed(&envelope(&json!([]))).entries;
        assert!(found.is_empty(), "{found:?}");
    }

    #[test]
    fn reports_access_denied_only_for_a_denied_answer_with_a_null_list() {
        let denied = json!({
            "errors": [{"message": "Access denied! You need to be authorized."}],
            "data": {"storeWishlistSecure": null},
        });
        assert_eq!(parse(&denied), WishlistOutcome::Denied);
        let other_case = json!({
            "errors": [{"message": "Other"}, {"message": "access DENIED"}],
            "data": {"storeWishlistSecure": null},
        });
        assert_eq!(parse(&other_case), WishlistOutcome::Denied);
    }

    #[test]
    fn reports_drift_for_null_or_missing_envelopes_without_a_denial() {
        for body in [
            json!({"data": {"storeWishlistSecure": null}}),
            json!({"data": {}}),
            json!({"data": null}),
            json!({}),
            json!(null),
            json!("x"),
            json!({"data": {"storeWishlistSecure": {}}}),
            json!({"errors": [{"message": "Something else"}], "data": null}),
            json!({"errors": [{"message": "Access denied"}], "data": null}),
            json!({"errors": [{"message": "Access denied"}]}),
            json!({"errors": [{"message": "Access denied"}], "data": {}}),
            json!({
                "errors": [{"message": "Access denied"}],
                "data": {"storeWishlistSecure": {}},
            }),
            // Challenge cases: an error of the wrong shape fails the denial.
            json!({
                "errors": [{"message": 5}, {"message": "Access denied"}],
                "data": {"storeWishlistSecure": null},
            }),
            json!({
                "errors": ["Access denied"],
                "data": {"storeWishlistSecure": null},
            }),
            json!({
                "errors": {"message": "Access denied"},
                "data": {"storeWishlistSecure": null},
            }),
        ] {
            assert_eq!(parse(&body), WishlistOutcome::Drift, "{body}");
        }
    }

    #[test]
    fn the_minimal_cards_keep_the_wishlist_order() {
        let page = listed(&envelope(&json!([
            entry(&json!({"__typename": "Concept", "id": "10000001", "name": "B"})),
            entry(&json!({"name": "A"})),
        ])));
        let cards = wishlist_cards(&page.entries);
        let names: Vec<_> = cards.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["B", "A"]);
        assert_eq!(cards[0].id_kind, IdKind::Concept);
        assert_eq!(cards[0].price, "");
    }
}
