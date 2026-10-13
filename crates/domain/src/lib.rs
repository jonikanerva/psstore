//! The psstore domain: validated product concepts and pure transformations.
//!
//! This crate depends on no HTTP, async runtime, or I/O crate, and on no
//! other crate of this workspace. Two mechanisms enforce the boundary:
//!
//! - `Cargo.toml` declares the dependencies. The server crate depends on this
//!   crate, so this crate cannot use the server code.
//! - `clippy.toml` of this crate disallows the ambient clock, the environment,
//!   the filesystem, process and network I/O, and random seeds. `mise
//!   run lint` denies the lints. The list names the common entry points
//!   only; review covers the rest, for example another `std::fs` function.
//!
//! The current time, the settings, and every external value arrive as
//! parameters.
//!
//! This code replaced a TypeScript server (issue #157, ADR 0003). A comment
//! that names a `server/src/**/*.ts` file refers to that server. Read the file
//! with `git show 2330421:<path>`.

pub mod browse;
pub mod catalog;
pub mod critic_match;
pub mod errors;
pub mod game;
pub mod id;
pub mod js;
pub mod library;
pub mod listing;
pub mod mapper;
pub mod product_id;
pub mod secret;
