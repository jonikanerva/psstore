//! Adapters for the external services: Sony's store and account APIs and the
//! IGDB critic score. Each adapter decodes and narrows the external data at
//! its boundary before any other code sees it.

pub mod sony;
pub mod transport;
