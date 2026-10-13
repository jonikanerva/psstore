//! The environment settings, read once at startup.
//!
//! The Sony contract values are not settings: they are constants of the Sony
//! adapter and of `docs/contracts/sony-constants.json`.

use std::path::PathBuf;

use crate::domain::secret::Secret;

/// The port when `PORT` is missing or not a usable port.
pub const DEFAULT_PORT: u16 = 3000;

/// The client build: the build output of the `web` package, relative to the
/// working directory.
pub const WEB_BUILD_DIR: &str = "web/build";

/// The validated settings.
#[derive(Debug, Clone)]
pub struct Config {
    /// The listening port on all interfaces.
    pub port: u16,
    /// The IGDB credentials. Without both values the critic score is off.
    pub igdb: Option<IgdbCredentials>,
    pub web_build: PathBuf,
}

/// The Twitch app credentials of the IGDB critic score.
///
/// STACK.md §9 forbids logging the `Client-ID`, so the `Debug` output hides
/// both values.
#[derive(Clone)]
pub struct IgdbCredentials {
    pub client_id: String,
    pub client_secret: Secret,
}

impl std::fmt::Debug for IgdbCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IgdbCredentials")
            .field("client_id", &"<redacted>")
            .field("client_secret", &self.client_secret)
            .finish()
    }
}

impl Config {
    /// Reads `PORT`, `IGDB_CLIENT_ID`, and `IGDB_CLIENT_SECRET`.
    #[must_use]
    pub fn from_env() -> Self {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// The settings from a lookup function, for tests.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Self {
        let non_empty = |name: &str| lookup(name).filter(|value| !value.is_empty());
        let igdb = match (non_empty("IGDB_CLIENT_ID"), non_empty("IGDB_CLIENT_SECRET")) {
            (Some(client_id), Some(secret)) => Some(IgdbCredentials {
                client_id,
                client_secret: Secret::new(secret),
            }),
            _ => None,
        };
        Self {
            port: parse_port(lookup("PORT").as_deref()),
            igdb,
            web_build: PathBuf::from(WEB_BUILD_DIR),
        }
    }
}

/// The port of `PORT`. A missing, invalid, or zero value is the default port,
/// like `Number.parseInt(PORT) || 3000` on the TypeScript server.
fn parse_port(value: Option<&str>) -> u16 {
    value
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|port| *port != 0)
        .unwrap_or(DEFAULT_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(pairs: &[(&str, &str)]) -> Config {
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        Config::from_lookup(|name| {
            pairs
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        })
    }

    #[test]
    fn reads_the_port_with_a_default() {
        assert_eq!(config(&[]).port, 3000);
        assert_eq!(config(&[("PORT", "8080")]).port, 8080);
        assert_eq!(config(&[("PORT", "0")]).port, 3000);
        assert_eq!(config(&[("PORT", "abc")]).port, 3000);
        assert_eq!(config(&[("PORT", "70000")]).port, 3000);
    }

    #[test]
    fn the_critic_score_needs_both_credentials() {
        assert!(config(&[]).igdb.is_none());
        assert!(config(&[("IGDB_CLIENT_ID", "id")]).igdb.is_none());
        assert!(
            config(&[("IGDB_CLIENT_ID", "id"), ("IGDB_CLIENT_SECRET", "")])
                .igdb
                .is_none()
        );
        let igdb = config(&[("IGDB_CLIENT_ID", "id"), ("IGDB_CLIENT_SECRET", "s3cr3t")])
            .igdb
            .unwrap();
        assert_eq!(igdb.client_id, "id");
        assert_eq!(igdb.client_secret.expose(), "s3cr3t");
        let debug = format!("{igdb:?}");
        assert!(!debug.contains("s3cr3t"), "{debug}");
        assert!(!debug.contains("\"id\""), "{debug}");
    }
}
