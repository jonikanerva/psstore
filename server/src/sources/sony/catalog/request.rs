//! The request shapes of the TypeScript client (`sonyClient.ts` and
//! `queryStrategies.ts`).
//!
//! The variables are `JSON.stringify` output, so the JSON keys keep the
//! declaration order of the TypeScript objects. The structs below declare the
//! fields in that order; `serde_json` writes struct fields in order. The
//! query string is `URLSearchParams.toString()` output: form encoding with
//! `+` for a space.

use serde::Serialize;

use crate::domain::browse::BrowseOrder;
use crate::domain::catalog::{BrowseRequest, SonyFeature};
use crate::domain::errors::UpstreamError;
use crate::sources::sony::contract::SonyContract;

/// One category grid request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GridQuery {
    /// NEW, UPCOMING, or DISCOUNTED.
    Feature {
        feature: SonyFeature,
        size: usize,
        offset: usize,
    },
    /// One BROWSE page: one genre in one Sony order.
    Browse(BrowseRequest),
    /// The genre facet of the PS5 grid: page size 0 returns the facets
    /// without any concept.
    Genres,
}

#[derive(Serialize)]
struct PageArgs {
    size: usize,
    offset: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SonySort {
    name: &'static str,
    is_ascending: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GridVariables<'a> {
    id: &'a str,
    locale: &'a str,
    page_args: PageArgs,
    sort_by: Option<SonySort>,
    filter_by: Vec<String>,
    facet_options: [&'static str; 0],
}

const PS5_FILTER: &str = "targetPlatforms:PS5";

/// The release date order of NEW, UPCOMING, and DISCOUNTED.
const RELEASE_DATE_DESC: SonySort = SonySort {
    name: "conceptReleaseDate",
    is_ascending: false,
};

/// Sony's sort for each BROWSE order. Sony lists each of them in the grid's
/// `sortingOptions`. Sony's sort names never reach the API.
fn browse_sort(order: BrowseOrder) -> SonySort {
    let (name, is_ascending) = match order {
        BrowseOrder::BestSelling => ("sales30", false),
        BrowseOrder::MostDownloaded => ("downloads30", false),
        BrowseOrder::Newest => ("conceptReleaseDate", false),
        BrowseOrder::Oldest => ("conceptReleaseDate", true),
        BrowseOrder::NameAsc => ("conceptName", true),
        BrowseOrder::NameDesc => ("conceptName", false),
    };
    SonySort { name, is_ascending }
}

impl GridQuery {
    /// The `variables` JSON of the request.
    pub(super) fn variables(&self, contract: &SonyContract) -> Result<String, UpstreamError> {
        let all_games = contract.category_id.as_str();
        let variables = match self {
            // NEW and UPCOMING use Sony's released and upcoming facets of the
            // concept release date, so no recent release falls outside the
            // first page.
            Self::Feature {
                feature,
                size,
                offset,
            } => {
                let (id, window) = match feature {
                    SonyFeature::New => (all_games, Some("conceptReleaseDate:last_thirty_days")),
                    SonyFeature::Upcoming => {
                        (all_games, Some("conceptReleaseDate:next_thirty_days"))
                    }
                    SonyFeature::Discounted => (contract.deals_category_id.as_str(), None),
                };
                GridVariables {
                    id,
                    locale: &contract.locale,
                    page_args: PageArgs {
                        size: *size,
                        offset: *offset,
                    },
                    sort_by: Some(RELEASE_DATE_DESC),
                    filter_by: [Some(PS5_FILTER), window]
                        .into_iter()
                        .flatten()
                        .map(str::to_owned)
                        .collect(),
                    facet_options: [],
                }
            }
            // Sony answers an unknown genre key with an empty grid, not with
            // every game (observed 2026-10-06).
            Self::Browse(request) => GridVariables {
                id: all_games,
                locale: &contract.locale,
                page_args: PageArgs {
                    size: request.size,
                    offset: request.offset,
                },
                sort_by: Some(browse_sort(request.order)),
                filter_by: vec![
                    PS5_FILTER.to_owned(),
                    format!("conceptGenres:{}", request.genre.as_str()),
                ],
                facet_options: [],
            },
            Self::Genres => GridVariables {
                id: all_games,
                locale: &contract.locale,
                page_args: PageArgs { size: 0, offset: 0 },
                sort_by: None,
                filter_by: vec![PS5_FILTER.to_owned()],
                facet_options: [],
            },
        };
        encode(&variables)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductVariables<'a> {
    product_id: &'a str,
}

/// The variables of the product detail and the product price operations.
pub(super) fn product_variables(product_id: &str) -> Result<String, UpstreamError> {
    encode(&ProductVariables { product_id })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchVariables<'a> {
    country_code: &'static str,
    language_code: &'static str,
    next_cursor: &'static str,
    page_offset: usize,
    page_size: usize,
    search_term: &'a str,
}

/// The variables of the search operation. The country and the language are
/// fixed values of the TypeScript client, separate from the locale tag.
pub(super) fn search_variables(
    term: &str,
    offset: usize,
    size: usize,
) -> Result<String, UpstreamError> {
    encode(&SearchVariables {
        country_code: "FI",
        language_code: "en",
        next_cursor: "",
        page_offset: offset,
        page_size: size,
        search_term: term,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedQuery<'a> {
    version: u8,
    sha256_hash: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Extensions<'a> {
    persisted_query: PersistedQuery<'a>,
}

/// The query string of a persisted-query GET.
pub(super) fn graphql_query(
    operation: &str,
    hash: &str,
    variables: &str,
) -> Result<String, UpstreamError> {
    let extensions = encode(&Extensions {
        persisted_query: PersistedQuery {
            version: 1,
            sha256_hash: hash,
        },
    })?;
    Ok(form_urlencoded::Serializer::new(String::new())
        .append_pair("operationName", operation)
        .append_pair("variables", variables)
        .append_pair("extensions", &extensions)
        .finish())
}

/// The query string of the monthly feed.
pub(super) fn monthly_query(locale: &str) -> String {
    form_urlencoded::Serializer::new(String::new())
        .append_pair("locale", locale)
        .append_pair("categoryList", super::PLUS_MONTHLY_CATEGORY)
        .finish()
}

/// The JSON text of request variables. These structs hold only strings,
/// numbers, and booleans, so serialization does not fail in practice; a
/// failure is still an error value, never a panic.
fn encode(value: &impl Serialize) -> Result<String, UpstreamError> {
    serde_json::to_string(value)
        .map_err(|_| UpstreamError::unavailable("Sony request could not be built"))
}

/// The `x-psn-store-locale-override` value: `language-REGION` for a
/// `xx-yy` tag (`en-fi` gives `en-FI`); any other tag stays unchanged.
pub fn locale_override(locale: &str) -> String {
    match locale.split_once('-') {
        Some((language, region))
            if language.len() == 2
                && region.len() == 2
                && language.bytes().all(|b| b.is_ascii_alphabetic())
                && region.bytes().all(|b| b.is_ascii_alphabetic()) =>
        {
            format!(
                "{}-{}",
                language.to_ascii_lowercase(),
                region.to_ascii_uppercase()
            )
        }
        _ => locale.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::browse::GenreKey;

    fn contract() -> SonyContract {
        SonyContract::load().unwrap()
    }

    #[test]
    fn the_locale_override_is_language_region() {
        assert_eq!(locale_override("en-fi"), "en-FI");
        assert_eq!(locale_override("EN-fi"), "en-FI");
        assert_eq!(locale_override("en"), "en");
        assert_eq!(locale_override("en-fin"), "en-fin");
        assert_eq!(locale_override(&contract().locale), "en-FI");
    }

    /// The expected text is `JSON.stringify(buildStrategies().new
    /// .buildVariables({ size: 300, offset: 0 }))` of the TypeScript client.
    #[test]
    fn feature_variables_keep_the_typescript_key_order() {
        let c = contract();
        let new = GridQuery::Feature {
            feature: SonyFeature::New,
            size: 300,
            offset: 0,
        };
        assert_eq!(
            new.variables(&c).unwrap(),
            r#"{"id":"d0446d4b-dc9a-4f1e-86ec-651f099c9b29","locale":"en-fi","pageArgs":{"size":300,"offset":0},"sortBy":{"name":"conceptReleaseDate","isAscending":false},"filterBy":["targetPlatforms:PS5","conceptReleaseDate:last_thirty_days"],"facetOptions":[]}"#
        );
        let upcoming = GridQuery::Feature {
            feature: SonyFeature::Upcoming,
            size: 120,
            offset: 0,
        };
        assert!(upcoming.variables(&c).unwrap().contains(
            r#""filterBy":["targetPlatforms:PS5","conceptReleaseDate:next_thirty_days"]"#
        ));
        let discounted = GridQuery::Feature {
            feature: SonyFeature::Discounted,
            size: 120,
            offset: 0,
        };
        assert_eq!(
            discounted.variables(&c).unwrap(),
            r#"{"id":"3f772501-f6f8-49b7-abac-874a88ca4897","locale":"en-fi","pageArgs":{"size":120,"offset":0},"sortBy":{"name":"conceptReleaseDate","isAscending":false},"filterBy":["targetPlatforms:PS5"],"facetOptions":[]}"#
        );
    }

    #[test]
    fn browse_variables_map_each_order_to_a_sony_sort() {
        let c = contract();
        let expected = [
            (
                BrowseOrder::BestSelling,
                r#"{"name":"sales30","isAscending":false}"#,
            ),
            (
                BrowseOrder::MostDownloaded,
                r#"{"name":"downloads30","isAscending":false}"#,
            ),
            (
                BrowseOrder::Newest,
                r#"{"name":"conceptReleaseDate","isAscending":false}"#,
            ),
            (
                BrowseOrder::Oldest,
                r#"{"name":"conceptReleaseDate","isAscending":true}"#,
            ),
            (
                BrowseOrder::NameAsc,
                r#"{"name":"conceptName","isAscending":true}"#,
            ),
            (
                BrowseOrder::NameDesc,
                r#"{"name":"conceptName","isAscending":false}"#,
            ),
        ];
        for (order, sort) in expected {
            let query = GridQuery::Browse(BrowseRequest {
                genre: GenreKey::parse("ROLE_PLAYING_GAMES").unwrap(),
                order,
                offset: 60,
                size: 60,
            });
            assert_eq!(
                query.variables(&c).unwrap(),
                format!(
                    r#"{{"id":"d0446d4b-dc9a-4f1e-86ec-651f099c9b29","locale":"en-fi","pageArgs":{{"size":60,"offset":60}},"sortBy":{sort},"filterBy":["targetPlatforms:PS5","conceptGenres:ROLE_PLAYING_GAMES"],"facetOptions":[]}}"#
                )
            );
        }
    }

    #[test]
    fn the_genre_list_asks_for_facets_without_concepts() {
        assert_eq!(
            GridQuery::Genres.variables(&contract()).unwrap(),
            r#"{"id":"d0446d4b-dc9a-4f1e-86ec-651f099c9b29","locale":"en-fi","pageArgs":{"size":0,"offset":0},"sortBy":null,"filterBy":["targetPlatforms:PS5"],"facetOptions":[]}"#
        );
    }

    #[test]
    fn product_and_search_variables_match_json_stringify() {
        assert_eq!(
            product_variables("EP0001-X").unwrap(),
            r#"{"productId":"EP0001-X"}"#
        );
        assert_eq!(
            search_variables("a \"b\" \u{1f}é", 50, 50).unwrap(),
            r#"{"countryCode":"FI","languageCode":"en","nextCursor":"","pageOffset":50,"pageSize":50,"searchTerm":"a \"b\" \u001fé"}"#
        );
    }

    /// The expected text is `new URLSearchParams({...}).toString()`.
    #[test]
    fn the_query_string_matches_url_search_params() {
        assert_eq!(
            graphql_query("op", "abc", r#"{"searchTerm":"a b&c*~'"}"#).unwrap(),
            "operationName=op&variables=%7B%22searchTerm%22%3A%22a+b%26c*%7E%27%22%7D&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22abc%22%7D%7D"
        );
        assert_eq!(
            monthly_query("en-fi"),
            "locale=en-fi&categoryList=plus-monthly-games-list"
        );
    }
}
