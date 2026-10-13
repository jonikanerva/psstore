//! The psstore server: a calm view of the Finnish PS5 store. `VISION.md`
//! describes the product and `STACK.md` the module responsibilities.
//!
//! Dependency direction: `http` → `application` → `domain`. `sources`
//! implements the ports of `application` and uses `domain` types. `config`
//! reads the environment. `wiring` connects the concrete services. `domain`
//! depends on no other module of this crate.

pub mod application;
pub mod config;
pub mod domain;
pub mod http;
pub mod observability;
pub mod sources;
pub mod wiring;
