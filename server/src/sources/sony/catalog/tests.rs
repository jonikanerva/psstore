//! Boundary tests of the Sony store client. They port the expectations of
//! `sonyClient.test.ts`, `goldenDecode.test.ts`, `scopeDrop.test.ts`,
//! `browse.test.ts`, `searchResults.test.ts`, `plusMonthly.test.ts`,
//! `productPrice.test.ts`, and `sonyClientLive.test.ts`, with the same
//! fixtures (`server/tests/fixtures/`).

mod client;
mod decode;

use std::path::Path;

use serde_json::Value;

/// A committed fixture as JSON.
fn fixture(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let text = std::fs::read_to_string(&path).expect("fixture is readable");
    serde_json::from_str(&text).expect("fixture is JSON")
}
