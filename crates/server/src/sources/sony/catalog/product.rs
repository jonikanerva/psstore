//! The product boundaries: the product detail (`metGetProductById`) and the
//! product price (`productRetrieveForCtasWithPrice`). Port of
//! `productDetailSchema.ts`, `productPriceSchema.ts`, and
//! `extractProductDetail` in `sonyClient.ts`.

use serde_json::Value;

use super::grid::media;
use super::json::{
    Invalid, Object, object, opt_bool, opt_list, opt_list_of, opt_nullable_strings, opt_object_of,
    opt_string, opt_strings,
};
use crate::domain::catalog::{Media, ProductDetail, ProductPrice, StandardPrice};
use crate::domain::game::PlusOffer;
use crate::domain::js::js_trim;

struct Description {
    kind: Option<String>,
    value: Option<String>,
}

/// The `productRetrieve` node. Any field of the wrong type fails the whole
/// node; the caller then degrades to empty values.
struct ProductNode {
    name: Option<String>,
    media: Option<Vec<Media>>,
    release_date: Option<String>,
    publisher_name: Option<String>,
    store_display_classification: Option<String>,
    platforms: Option<Vec<String>>,
    descriptions: Option<Vec<Description>>,
    genres: Option<Vec<Option<String>>>,
}

fn description(value: &Value) -> Result<Description, Invalid> {
    let obj = object(value)?;
    opt_string(obj, "subType")?;
    Ok(Description {
        kind: opt_string(obj, "type")?,
        value: opt_string(obj, "value")?,
    })
}

fn localized_genre(value: &Value) -> Result<Option<String>, Invalid> {
    opt_string(object(value)?, "value")
}

fn product_node(value: &Value) -> Result<ProductNode, Invalid> {
    let obj = object(value)?;
    opt_string(obj, "id")?;
    Ok(ProductNode {
        name: opt_string(obj, "name")?,
        media: opt_list_of(obj, "media", media)?,
        release_date: opt_string(obj, "releaseDate")?,
        publisher_name: opt_string(obj, "publisherName")?,
        store_display_classification: opt_string(obj, "storeDisplayClassification")?,
        platforms: opt_strings(obj, "platforms")?,
        descriptions: opt_list_of(obj, "descriptions", description)?,
        genres: opt_list_of(obj, "combinedLocalizedGenres", localized_genre)?,
    })
}

/// `json.data?.productRetrieve`: the node when the body and `data` are
/// objects.
fn product_retrieve(json: &Value) -> Option<&Value> {
    object(json)
        .ok()?
        .get("data")?
        .as_object()?
        .get("productRetrieve")
}

/// The first entry of the description type, its text or the empty string.
fn description_by_type(descriptions: &[Description], kind: &str) -> String {
    descriptions
        .iter()
        .find(|entry| entry.kind.as_deref() == Some(kind))
        .and_then(|entry| entry.value.clone())
        .unwrap_or_default()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.is_empty())
}

/// The product detail of a response. A missing or malformed node degrades to
/// empty values, never to a failure. The game page shows the LONG
/// description, else the SHORT tagline; `COMPATIBILITY_NOTICE` and LEGAL
/// entries are never shown.
#[must_use]
pub fn extract_product_detail(json: &Value) -> ProductDetail {
    let node = product_retrieve(json)
        .filter(|node| !node.is_null())
        .and_then(|node| product_node(node).ok());
    let Some(node) = node else {
        return ProductDetail::default();
    };
    let descriptions = node.descriptions.unwrap_or_default();
    let long = description_by_type(&descriptions, "LONG");
    let description = if long.is_empty() {
        description_by_type(&descriptions, "SHORT")
    } else {
        long
    };
    ProductDetail {
        name: non_empty(node.name),
        media: node.media.unwrap_or_default(),
        release_date: non_empty(node.release_date),
        genres: node
            .genres
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .filter(|genre| !genre.is_empty())
            .collect(),
        description,
        publisher_name: non_empty(node.publisher_name),
        store_display_classification: non_empty(node.store_display_classification),
        platforms: node.platforms.unwrap_or_default(),
    }
}

/// Sony's subscription branding of PS Plus.
const PS_PLUS: &str = "PS_PLUS";

/// CTA types for which Sony includes the game in a PS Plus tier: the Extra
/// game catalogue, a free PS Plus game, and the Premium Classics. A trial or
/// a future tied type is not included.
const INCLUDED_CTA_TYPES: [&str; 3] = [
    "UPSELL_PS_PLUS_GAME_CATALOG",
    "UPSELL_PS_PLUS_FREE",
    "UPSELL_PS_PLUS_CLASSIC_GAME_COLLECTION",
];

struct CtaPrice {
    applicability: Option<String>,
    base_price: Option<String>,
    display_discount_text: Option<String>,
    discounted_price: Option<String>,
    is_tied_to_subscription: Option<bool>,
    service_branding: Option<Vec<Option<String>>>,
}

struct Cta {
    kind: Option<String>,
    price: Option<CtaPrice>,
}

fn cta_price(value: &Value) -> Result<CtaPrice, Invalid> {
    let obj: &Object = object(value)?;
    Ok(CtaPrice {
        applicability: opt_string(obj, "applicability")?,
        base_price: opt_string(obj, "basePrice")?,
        display_discount_text: opt_string(obj, "displayDiscountText")?,
        discounted_price: opt_string(obj, "discountedPrice")?,
        is_tied_to_subscription: opt_bool(obj, "isTiedToSubscription")?,
        service_branding: opt_nullable_strings(obj, "serviceBranding")?,
    })
}

fn cta(value: &Value) -> Result<Cta, Invalid> {
    let obj = object(value)?;
    Ok(Cta {
        kind: opt_string(obj, "type")?,
        price: opt_object_of(obj, "price", cta_price)?,
    })
}

/// The decoded CTAs. A malformed CTA is skipped; the others stay.
fn decoded_ctas(json: &Value) -> Vec<Cta> {
    let Ok(envelope) = object(json) else {
        return vec![];
    };
    let node = match envelope.get("data") {
        None | Some(Value::Null) => None,
        Some(data) => match object(data) {
            Ok(data) => data.get("productRetrieve").filter(|node| !node.is_null()),
            Err(Invalid) => return vec![],
        },
    };
    let Some(node) = node else {
        return vec![];
    };
    let Ok(Some(webctas)) = object(node).and_then(|node| opt_list(node, "webctas")) else {
        return vec![];
    };
    webctas.iter().filter_map(|entry| cta(entry).ok()).collect()
}

fn offer_from_cta(cta: &Cta) -> Option<PlusOffer> {
    let price = cta.price.as_ref()?;
    let ps_plus = price
        .service_branding
        .iter()
        .flatten()
        .any(|branding| branding.as_deref() == Some(PS_PLUS));
    if price.applicability.as_deref() != Some("UPSELL") || !ps_plus {
        return None;
    }
    match price.is_tied_to_subscription {
        Some(true) => cta
            .kind
            .as_deref()
            .filter(|kind| INCLUDED_CTA_TYPES.contains(kind))
            .map(|_| PlusOffer::Included),
        Some(false) => price
            .discounted_price
            .as_ref()
            .filter(|text| !js_trim(text).is_empty())
            .map(|text| PlusOffer::Price {
                price: text.clone(),
            }),
        None => None,
    }
}

fn standard_from_cta(cta: &Cta) -> Option<StandardPrice> {
    let price = cta.price.as_ref()?;
    if price.applicability.as_deref() == Some("UPSELL")
        || price.is_tied_to_subscription == Some(true)
    {
        return None;
    }
    let standard = StandardPrice {
        base_price: price.base_price.clone().unwrap_or_default(),
        discounted_price: price.discounted_price.clone().unwrap_or_default(),
        discount_text: price.display_discount_text.clone().unwrap_or_default(),
    };
    (!standard.base_price.is_empty() || !standard.discounted_price.is_empty()).then_some(standard)
}

/// The PS Plus offer and the standard price of a price response. The offer is
/// the first PS Plus upsell CTA; the standard price is the first CTA that is
/// neither a subscription upsell nor tied to a subscription. The price texts
/// are Sony's strings, never recomputed.
pub fn parse_product_price(json: &Value) -> ProductPrice {
    let ctas = decoded_ctas(json);
    ProductPrice {
        plus_offer: ctas.iter().find_map(offer_from_cta),
        standard: ctas.iter().find_map(standard_from_cta),
    }
}
