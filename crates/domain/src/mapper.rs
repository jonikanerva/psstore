//! Sony concepts and products to game cards (port of
//! `server/src/sony/mapper.ts`).
//!
//! The current time arrives as `now_ms`, the epoch milliseconds of the
//! injected clock. The TypeScript mapper read the ambient wall clock for the
//! pre-order flag.

use super::catalog::{
    CategoryGridProduct, Concept, ConceptPrice, ConceptProductRef, Media, PlusMonthlyEntry,
    ProductDetail, StandardPrice,
};
use super::game::{Game, IdKind};
use super::id::{GameId, ProductId};
use super::js::{parse_date_ms, to_iso_string};

/// Sony's subscription branding of PS Plus.
const PS_PLUS: &str = "PS_PLUS";

/// The cover image roles, most preferred first.
const COVER_ROLE_PRIORITY: [&str; 6] = [
    "MASTER",
    "GAMEHUB_COVER_ART",
    "PORTRAIT_BANNER",
    "FOUR_BY_THREE_BANNER",
    "SIXTEEN_BY_NINE_BANNER",
    "SCREENSHOT",
];

/// A Sony date as `toISOString()` output, or the empty string for a missing,
/// empty, or unparseable value. A missing date is never replaced by a guess.
pub fn to_iso_or_default(value: Option<&str>) -> String {
    match value {
        None | Some("") => String::new(),
        Some(text) => parse_date_ms(text)
            .and_then(to_iso_string)
            .unwrap_or_default(),
    }
}

/// A non-empty string or `None`, like JavaScript truthiness of a string.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

struct Image<'a> {
    role: &'a str,
    url: &'a str,
}

fn media_of(concept: &Concept) -> &[Media] {
    concept.media.as_deref().unwrap_or_default()
}

fn image_media(concept: &Concept) -> Vec<Image<'_>> {
    media_of(concept)
        .iter()
        .filter(|item| item.kind.as_deref() == Some("IMAGE"))
        .filter_map(|item| {
            non_empty(item.url.as_deref()).map(|url| Image {
                role: item.role.as_deref().unwrap_or_default(),
                url,
            })
        })
        .collect()
}

fn concept_screenshots(concept: &Concept) -> Vec<String> {
    image_media(concept)
        .into_iter()
        .filter(|image| image.role == "SCREENSHOT")
        .map(|image| image.url.to_owned())
        .collect()
}

fn concept_cover(concept: &Concept) -> String {
    let images = image_media(concept);
    COVER_ROLE_PRIORITY
        .iter()
        .find_map(|role| images.iter().find(|image| image.role == *role))
        .or_else(|| images.first())
        .map(|image| image.url.to_owned())
        .unwrap_or_default()
}

fn concept_videos(concept: &Concept) -> Vec<String> {
    media_of(concept)
        .iter()
        .filter(|item| item.kind.as_deref() == Some("VIDEO"))
        .filter_map(|item| non_empty(item.url.as_deref()).map(str::to_owned))
        .collect()
}

fn first_product(concept: &Concept) -> Option<&ConceptProductRef> {
    concept
        .products
        .as_ref()
        .and_then(|products| products.first())
}

fn is_ps_plus(branding: &str) -> bool {
    branding.to_uppercase() == PS_PLUS
}

/// True when Sony shows a discount text, or a base price and a different
/// discounted price.
#[must_use]
pub fn is_concept_discounted(concept: &Concept) -> bool {
    let price = concept.price.as_ref();
    let base = price
        .and_then(|p| p.base_price.as_deref())
        .unwrap_or_default();
    let discounted = price
        .and_then(|p| p.discounted_price.as_deref())
        .unwrap_or_default();
    let has_discount_text = non_empty(price.and_then(|p| p.discount_text.as_deref())).is_some();
    has_discount_text || (!base.is_empty() && !discounted.is_empty() && base != discounted)
}

/// True when the price or the upsell names PS Plus.
#[must_use]
pub fn is_concept_plus(concept: &Concept) -> bool {
    let Some(price) = concept.price.as_ref() else {
        return false;
    };
    let brandings = [&price.service_branding, &price.upsell_service_branding];
    brandings
        .into_iter()
        .flatten()
        .flatten()
        .any(|branding| is_ps_plus(branding))
}

/// The product id of a concept: its first product's id, else the concept id,
/// else the empty string.
#[must_use]
pub fn concept_product_id(concept: &Concept) -> String {
    first_product(concept)
        .and_then(|product| product.id.clone())
        .or_else(|| concept.id.clone())
        .unwrap_or_default()
}

/// A grid or search product as a concept that names only that product.
/// Platforms and classification are not carried over.
#[must_use]
pub fn product_to_concept(product: &CategoryGridProduct) -> Concept {
    Concept {
        id: product.id.clone(),
        name: product.name.clone(),
        media: product.media.clone(),
        price: product.price.clone(),
        products: Some(vec![ConceptProductRef {
            id: product.id.clone(),
            ..ConceptProductRef::default()
        }]),
    }
}

/// Sony's PS Plus upsell text, verbatim, when the upsell names PS Plus. An
/// empty text is `None`.
fn plus_upsell_text(concept: &Concept) -> Option<String> {
    let price = concept.price.as_ref()?;
    let has_plus = price
        .upsell_service_branding
        .iter()
        .flatten()
        .any(|branding| is_ps_plus(branding));
    if !has_plus {
        return None;
    }
    non_empty(price.upsell_text.as_deref()).map(str::to_owned)
}

/// The game card of a concept. The caller derives `id` from
/// [`concept_product_id`] and its scope rule. `id_kind` is `product`; the
/// UPCOMING mapping sets `concept` for a concept id.
#[must_use]
pub fn concept_to_game(concept: &Concept, id: GameId, now_ms: i64) -> Game {
    let product = first_product(concept);
    let release_date = to_iso_or_default(product.and_then(|p| p.release_date.as_deref()));
    let discounted = is_concept_discounted(concept);
    let has_release_date = !release_date.is_empty();
    let price = concept.price.as_ref();
    let text = |pick: fn(&ConceptPrice) -> &Option<String>| -> Option<&str> {
        price.and_then(|p| pick(p).as_deref())
    };
    Game {
        id,
        name: concept.name.clone().unwrap_or_default(),
        url: concept_cover(concept),
        price: non_empty(text(|p| &p.discounted_price))
            .or_else(|| non_empty(text(|p| &p.base_price)))
            .unwrap_or_default()
            .to_owned(),
        original_price: if discounted {
            text(|p| &p.base_price).unwrap_or_default().to_owned()
        } else {
            String::new()
        },
        discount_text: if discounted {
            text(|p| &p.discount_text).unwrap_or_default().to_owned()
        } else {
            String::new()
        },
        discount_date: if discounted && has_release_date {
            release_date.clone()
        } else {
            String::new()
        },
        screenshots: concept_screenshots(concept),
        videos: concept_videos(concept),
        genres: product.and_then(|p| p.genres.clone()).unwrap_or_default(),
        description: String::new(),
        studio: product
            .and_then(|p| p.provider_name.clone())
            .unwrap_or_default(),
        pre_order: has_release_date && parse_date_ms(&release_date).is_some_and(|ms| ms > now_ms),
        plus_upsell_text: plus_upsell_text(concept),
        plus_offer: None,
        id_kind: IdKind::Product,
        date: release_date,
    }
}

/// The game of a product id that no list contains, built from the product's
/// own detail and standard price. `description` and `plus_offer` stay empty;
/// the caller fills them.
#[must_use]
pub fn product_detail_to_game(
    id: &ProductId,
    detail: &ProductDetail,
    standard: Option<&StandardPrice>,
    now_ms: i64,
) -> Game {
    let concept = Concept {
        id: Some(id.as_str().to_owned()),
        name: detail.name.clone(),
        media: Some(detail.media.clone()),
        price: standard.map(|price| ConceptPrice {
            base_price: Some(price.base_price.clone()),
            discounted_price: Some(price.discounted_price.clone()),
            discount_text: Some(price.discount_text.clone()),
            ..ConceptPrice::default()
        }),
        products: Some(vec![ConceptProductRef {
            id: Some(id.as_str().to_owned()),
            release_date: detail.release_date.clone(),
            provider_name: detail.publisher_name.clone(),
            genres: Some(detail.genres.clone()),
        }]),
    };
    concept_to_game(&concept, id.clone().into(), now_ms)
}

/// The card of a PS Plus monthly game: no price and no pre-order state.
#[must_use]
pub fn monthly_entry_to_game(entry: &PlusMonthlyEntry) -> Game {
    Game {
        id: entry.product_id.clone().into(),
        name: entry.name.clone(),
        date: to_iso_or_default(Some(&entry.release_date)),
        url: entry.image_url.clone(),
        price: String::new(),
        original_price: String::new(),
        discount_text: String::new(),
        discount_date: String::new(),
        screenshots: vec![],
        videos: vec![],
        genres: entry.genres.clone(),
        description: String::new(),
        studio: String::new(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: None,
        id_kind: IdKind::Product,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-13T00:00:00Z.
    const NOW: i64 = 1_791_849_600_000;

    /// The card of a concept with the id of the lists: the product id, else
    /// the concept id. A concept without an id gets a placeholder, because
    /// these tests check the other fields.
    fn card(concept: &Concept, now_ms: i64) -> Game {
        let id = GameId::try_from(concept_product_id(concept))
            .unwrap_or_else(|_| "placeholder-id".parse().unwrap());
        concept_to_game(concept, id, now_ms)
    }

    fn image(role: &str, url: &str) -> Media {
        Media {
            url: Some(url.into()),
            role: Some(role.into()),
            kind: Some("IMAGE".into()),
        }
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| (*v).to_owned()).collect()
    }

    fn price(base: &str, discounted: &str) -> ConceptPrice {
        ConceptPrice {
            base_price: Some(base.into()),
            discounted_price: Some(discounted.into()),
            ..ConceptPrice::default()
        }
    }

    fn product_ref(id: &str) -> ConceptProductRef {
        ConceptProductRef {
            id: Some(id.into()),
            ..ConceptProductRef::default()
        }
    }

    #[test]
    fn maps_a_sony_concept_to_a_game() {
        let game = card(
            &Concept {
                id: Some("concept-id".into()),
                name: Some("Game".into()),
                media: Some(vec![image("MASTER", "https://img")]),
                price: Some(ConceptPrice {
                    discount_text: Some("sale".into()),
                    service_branding: Some(strings(&["NONE"])),
                    ..price("€70", "€50")
                }),
                products: Some(vec![ConceptProductRef {
                    id: Some("prod-id".into()),
                    release_date: Some("2027-01-01T00:00:00Z".into()),
                    provider_name: Some("Studio".into()),
                    genres: Some(strings(&["Action"])),
                }]),
            },
            NOW,
        );
        assert_eq!(game.id, "prod-id");
        assert_eq!(game.url, "https://img");
        assert_eq!(game.price, "€50");
        assert_eq!(game.genres, ["Action"]);
        assert!(game.pre_order);
        // A concept date goes through `toISOString`, so it has milliseconds.
        assert_eq!(game.date, "2027-01-01T00:00:00.000Z");
        assert_eq!(game.discount_date, "2027-01-01T00:00:00.000Z");
        assert_eq!(game.original_price, "€70");
        assert_eq!(game.discount_text, "sale");
        assert_eq!(game.studio, "Studio");
    }

    #[test]
    fn the_pre_order_flag_reads_the_given_time() {
        let concept = Concept {
            products: Some(vec![ConceptProductRef {
                id: Some("prod-id".into()),
                release_date: Some("2026-10-13T00:00:00.001Z".into()),
                ..ConceptProductRef::default()
            }]),
            ..Concept::default()
        };
        assert!(card(&concept, NOW).pre_order);
        assert!(!card(&concept, NOW + 1).pre_order);
    }

    #[test]
    fn prefers_cover_art_roles_over_screenshots() {
        let game = card(
            &Concept {
                id: Some("concept-id".into()),
                name: Some("Game".into()),
                media: Some(vec![
                    image("SCREENSHOT", "https://img/screenshot"),
                    image("GAMEHUB_COVER_ART", "https://img/cover"),
                ]),
                price: Some(price("€70", "€70")),
                products: Some(vec![product_ref("prod-id")]),
            },
            NOW,
        );
        assert_eq!(game.url, "https://img/cover");
        assert_eq!(game.screenshots, ["https://img/screenshot"]);
    }

    #[test]
    fn falls_back_to_the_first_image_and_skips_empty_urls() {
        let mut odd = image("BACKGROUND", "https://img/first");
        odd.role = None;
        let game = card(
            &Concept {
                media: Some(vec![
                    image("MASTER", ""),
                    odd,
                    Media {
                        url: Some("https://vid".into()),
                        role: None,
                        kind: Some("VIDEO".into()),
                    },
                    Media {
                        url: Some(String::new()),
                        role: None,
                        kind: Some("VIDEO".into()),
                    },
                ]),
                ..Concept::default()
            },
            NOW,
        );
        assert_eq!(game.url, "https://img/first");
        assert_eq!(game.videos, ["https://vid"]);
        assert!(game.screenshots.is_empty(), "{:?}", game.screenshots);
    }

    #[test]
    fn does_not_invent_a_release_date() {
        let game = card(
            &Concept {
                id: Some("concept-id".into()),
                name: Some("Game".into()),
                media: Some(vec![image("MASTER", "https://img")]),
                price: Some(price("€70", "€70")),
                products: Some(vec![product_ref("prod-id")]),
            },
            NOW,
        );
        assert_eq!(game.date, "");
        assert!(!game.pre_order);

        let unparseable = Concept {
            products: Some(vec![ConceptProductRef {
                release_date: Some("soon".into()),
                ..product_ref("prod-id")
            }]),
            ..Concept::default()
        };
        assert_eq!(card(&unparseable, NOW).date, "");
    }

    #[test]
    fn detects_plus_and_discounted_flags() {
        let concept = Concept {
            id: Some("concept-id".into()),
            price: Some(ConceptPrice {
                discount_text: Some("save".into()),
                service_branding: Some(strings(&["PS_PLUS"])),
                ..price("€30", "€20")
            }),
            ..Concept::default()
        };
        assert!(is_concept_discounted(&concept));
        assert!(is_concept_plus(&concept));

        let lower = Concept {
            price: Some(ConceptPrice {
                upsell_service_branding: Some(strings(&["ps_plus"])),
                ..price("€30", "€30")
            }),
            ..Concept::default()
        };
        assert!(is_concept_plus(&lower));
        assert!(!is_concept_discounted(&lower));
        assert!(!is_concept_discounted(&Concept::default()));
        // A price without a discounted price is not a discount.
        assert!(!is_concept_discounted(&Concept {
            price: Some(price("€30", "")),
            ..Concept::default()
        }));
    }

    #[test]
    fn plus_upsell_text_is_verbatim_and_needs_the_branding() {
        let with = |branding: &str, text: &str| Concept {
            id: Some("concept-id".into()),
            price: Some(ConceptPrice {
                upsell_service_branding: Some(strings(&[branding])),
                upsell_text: Some(text.into()),
                ..price("€30", "€30")
            }),
            products: Some(vec![product_ref("prod-id")]),
            ..Concept::default()
        };
        assert_eq!(
            card(&with("PS_PLUS", "Save 10%"), NOW).plus_upsell_text,
            Some("Save 10%".into())
        );
        assert_eq!(card(&with("PS_PLUS", ""), NOW).plus_upsell_text, None);
        assert_eq!(card(&with("NONE", "Save 10%"), NOW).plus_upsell_text, None);
    }

    #[test]
    fn the_id_falls_back_from_the_product_to_the_concept() {
        let concept = Concept {
            id: Some("10001".into()),
            products: Some(vec![ConceptProductRef::default()]),
            ..Concept::default()
        };
        assert_eq!(concept_product_id(&concept), "10001");
        assert_eq!(card(&concept, NOW).id, "10001");
        let empty_product_id = Concept {
            id: Some("10001".into()),
            products: Some(vec![product_ref("")]),
            ..Concept::default()
        };
        assert_eq!(concept_product_id(&empty_product_id), "");
        assert_eq!(concept_product_id(&Concept::default()), "");
    }

    #[test]
    fn the_price_uses_the_discounted_price_then_the_base_price() {
        let concept = |base: &str, discounted: &str| Concept {
            price: Some(price(base, discounted)),
            ..Concept::default()
        };
        assert_eq!(card(&concept("€9", ""), NOW).price, "€9");
        assert_eq!(card(&concept("", ""), NOW).price, "");
        assert_eq!(card(&Concept::default(), NOW).price, "");
    }

    const ID: &str = "EP0002-PPSA02410_00-DESTINYTHEGAME02";

    fn destiny() -> ProductDetail {
        ProductDetail {
            name: Some("Destiny 2".into()),
            media: vec![
                image("GAMEHUB_COVER_ART", "https://img/cover"),
                image("SCREENSHOT", "https://img/shot"),
                Media {
                    url: Some("https://vid/preview.mp4".into()),
                    role: Some("PREVIEW".into()),
                    kind: Some("VIDEO".into()),
                },
            ],
            release_date: Some("2019-10-01T00:00:00+02:00".into()),
            genres: strings(&["Action"]),
            description: "Long text".into(),
            publisher_name: Some("Bungie".into()),
            ..ProductDetail::default()
        }
    }

    #[test]
    fn maps_detail_fields_and_a_standard_price() {
        let game = product_detail_to_game(
            &ID.parse().unwrap(),
            &destiny(),
            Some(&StandardPrice {
                base_price: "€39,99".into(),
                discounted_price: "€19,99".into(),
                discount_text: "-50%".into(),
            }),
            NOW,
        );
        assert_eq!(game.id, ID);
        assert_eq!(game.name, "Destiny 2");
        assert_eq!(game.date, "2019-09-30T22:00:00.000Z");
        assert_eq!(game.url, "https://img/cover");
        assert_eq!(game.screenshots, ["https://img/shot"]);
        assert_eq!(game.videos, ["https://vid/preview.mp4"]);
        assert_eq!(game.genres, ["Action"]);
        assert_eq!(game.studio, "Bungie");
        assert_eq!(game.price, "€19,99");
        assert_eq!(game.original_price, "€39,99");
        assert_eq!(game.discount_text, "-50%");
        assert_eq!(game.plus_upsell_text, None);
        assert_eq!(game.plus_offer, None);
        assert_eq!(game.description, "");
        assert_eq!(game.id_kind, IdKind::Product);
    }

    #[test]
    fn leaves_price_date_and_name_empty_without_data() {
        let game =
            product_detail_to_game(&ID.parse().unwrap(), &ProductDetail::default(), None, NOW);
        assert_eq!(game.price, "");
        assert_eq!(game.original_price, "");
        assert_eq!(game.date, "");
        assert!(!game.pre_order);
        assert_eq!(game.name, "");
    }

    #[test]
    fn maps_a_monthly_entry_without_prices() {
        let game = monthly_entry_to_game(&PlusMonthlyEntry {
            product_id: "EP0001-PPSA00001_00-ALPHA00000000000".parse().unwrap(),
            name: "Alpha".into(),
            image_url: "https://img/alpha".into(),
            release_date: "2025-01-01T00:00:00Z".into(),
            genres: strings(&["Action"]),
        });
        assert_eq!(game.date, "2025-01-01T00:00:00.000Z");
        assert_eq!(game.url, "https://img/alpha");
        assert_eq!(game.price, "");
        assert!(!game.pre_order);
        assert_eq!(game.genres, ["Action"]);
    }
}
