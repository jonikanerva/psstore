//! Validated product concepts and pure transformations.
//!
//! This module depends on no other module of this crate, on no HTTP or async
//! runtime type, and on no ambient time. The test
//! `domain_has_no_forbidden_dependencies` in `lib.rs` enforces this.

pub mod browse;
pub mod critic_match;
pub mod errors;
pub mod game;
pub mod library;
pub mod product_id;
pub mod secret;

#[cfg(test)]
mod boundary_tests {
    use std::path::{Path, PathBuf};

    fn rust_files(dir: &Path, found: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("domain directory is readable") {
            let path = entry.expect("directory entry is readable").path();
            if path.is_dir() {
                rust_files(&path, found);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                found.push(path);
            }
        }
    }

    /// The domain must not depend on HTTP, the async runtime, environment
    /// access, ambient time, or another module of this crate. Module
    /// visibility cannot express this rule, so this test reads the source.
    #[test]
    fn domain_has_no_forbidden_dependencies() {
        let forbidden = [
            "axum",
            "reqwest",
            "hyper",
            "tokio",
            "tower",
            "std::env",
            "env::var",
            "::now(",
            "SystemTime",
            "Instant",
            "crate::config",
            "crate::application",
            "crate::sources",
            "crate::http",
            "crate::wiring",
        ];
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/domain");
        let mut files = Vec::new();
        rust_files(&dir, &mut files);
        assert!(!files.is_empty());
        for path in files {
            let text = std::fs::read_to_string(&path).expect("source file is readable");
            // This file lists the forbidden names, so skip its own list.
            let text = if path.ends_with("domain/mod.rs") {
                text.split("mod boundary_tests")
                    .next()
                    .unwrap_or_default()
                    .to_owned()
            } else {
                text
            };
            for name in forbidden {
                assert!(
                    !text.contains(name),
                    "{} uses forbidden name {name}",
                    path.display()
                );
            }
        }
    }
}
