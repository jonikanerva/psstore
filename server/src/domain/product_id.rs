//! Sony product SKU ids.

/// True for a Sony product SKU id, for example
/// `EP0006-PPSA04874_00-APEXLEGENDRSPWN1`. The id starts with two upper-case
/// letters, four digits, `-`, four upper-case letters, five digits, and
/// `_00-`. A concept id (digits only) never matches.
pub fn is_valid_product_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    let pattern: &[fn(u8) -> bool] = &[
        is_upper,
        is_upper,
        is_digit,
        is_digit,
        is_digit,
        is_digit,
        is_dash,
        is_upper,
        is_upper,
        is_upper,
        is_upper,
        is_digit,
        is_digit,
        is_digit,
        is_digit,
        is_digit,
        is_underscore,
        is_zero,
        is_zero,
        is_dash,
    ];
    bytes.len() >= pattern.len()
        && pattern
            .iter()
            .zip(bytes)
            .all(|(matches, byte)| matches(*byte))
}

fn is_upper(b: u8) -> bool {
    b.is_ascii_uppercase()
}

fn is_digit(b: u8) -> bool {
    b.is_ascii_digit()
}

fn is_dash(b: u8) -> bool {
    b == b'-'
}

fn is_underscore(b: u8) -> bool {
    b == b'_'
}

fn is_zero(b: u8) -> bool {
    b == b'0'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_product_skus_and_rejects_concepts() {
        assert!(is_valid_product_id("EP0006-PPSA04874_00-APEXLEGENDRSPWN1"));
        assert!(is_valid_product_id("UP1014-CUSA36628_00-"));
        assert!(!is_valid_product_id("10001234"));
        assert!(!is_valid_product_id("EP0006-PPSA04874_01-APEX"));
        assert!(!is_valid_product_id("ep0006-PPSA04874_00-APEX"));
        assert!(!is_valid_product_id("EP0006-PPSA04874_00"));
        assert!(!is_valid_product_id(""));
    }
}
