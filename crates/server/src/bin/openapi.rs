//! Writes the OpenAPI document of the `/api` routes to a file.
//!
//! ```text
//! cargo run --locked -p psstore-server --bin openapi -- contract/openapi.json
//! ```
//!
//! The document comes from the same route list as the server
//! (`psstore_server::http::openapi`). The export reads no environment, calls
//! no network, and needs no client build. The output is stable: the same code
//! gives the same bytes.

#![expect(
    clippy::print_stderr,
    reason = "a command-line tool reports its failure"
)]

use std::path::PathBuf;
use std::process::ExitCode;

use psstore_server::http::openapi::document_json;

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let (Some(path), None) = (args.next(), args.next()) else {
        eprintln!("usage: openapi <output path>");
        return ExitCode::from(2);
    };
    let path = PathBuf::from(path);
    let text = match document_json() {
        Ok(text) => text,
        Err(error) => {
            eprintln!("openapi: the document did not serialize: {error}");
            return ExitCode::FAILURE;
        }
    };
    if let Err(error) = std::fs::write(&path, text) {
        eprintln!("openapi: {} could not be written: {error}", path.display());
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
