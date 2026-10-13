//! The Sony GraphQL contract values: the endpoint, the persisted-query
//! operation names and hashes, and the store category ids.
//!
//! The values live in `docs/contracts/sony-constants.json`. The server
//! compiles the file in, and the Sony contract tooling (`pnpm sony:validate`,
//! `pnpm sony:refresh`, and the signed-in probes) reads the same file. A hash
//! rotation changes only that file.

use serde::Deserialize;

/// The contract file, compiled into the binary.
const CONTRACT_JSON: &str = include_str!("../../../../docs/contracts/sony-constants.json");

/// The Sony contract values.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SonyContract {
    #[serde(rename = "SONY_GRAPHQL_URL")]
    pub graphql_url: String,
    #[serde(rename = "SONY_OPERATION_NAME")]
    pub category_grid_operation: String,
    #[serde(rename = "SONY_CATEGORY_GRID_HASH")]
    pub category_grid_hash: String,
    #[serde(rename = "SONY_CATEGORY_ID")]
    pub category_id: String,
    #[serde(rename = "SONY_DEALS_CATEGORY_ID")]
    pub deals_category_id: String,
    #[serde(rename = "SONY_PRODUCT_OPERATION_NAME")]
    pub product_operation: String,
    #[serde(rename = "SONY_PRODUCT_BY_ID_HASH")]
    pub product_hash: String,
    #[serde(rename = "SONY_PRODUCT_PRICE_OPERATION_NAME")]
    pub product_price_operation: String,
    #[serde(rename = "SONY_PRODUCT_PRICE_HASH")]
    pub product_price_hash: String,
    #[serde(rename = "SONY_SEARCH_OPERATION_NAME")]
    pub search_operation: String,
    #[serde(rename = "SONY_SEARCH_HASH")]
    pub search_hash: String,
    #[serde(rename = "SONY_PURCHASED_OPERATION_NAME")]
    pub purchased_operation: String,
    #[serde(rename = "SONY_PURCHASED_HASH")]
    pub purchased_hash: String,
    #[serde(rename = "SONY_WISHLIST_OPERATION_NAME")]
    pub wishlist_operation: String,
    #[serde(rename = "SONY_WISHLIST_HASH")]
    pub wishlist_hash: String,
}

impl SonyContract {
    /// Parses the compiled-in contract file. `main` calls it once at startup;
    /// the test below proves that the committed file parses.
    pub fn load() -> Result<Self, serde_json::Error> {
        serde_json::from_str(CONTRACT_JSON)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_committed_contract_file_parses() {
        let contract = SonyContract::load().unwrap();
        assert!(contract.graphql_url.starts_with("https://"));
        for hash in [
            &contract.category_grid_hash,
            &contract.product_hash,
            &contract.product_price_hash,
            &contract.search_hash,
            &contract.purchased_hash,
            &contract.wishlist_hash,
        ] {
            assert_eq!(hash.len(), 64, "{hash}");
            assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()), "{hash}");
        }
    }
}
