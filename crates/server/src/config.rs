//! The environment settings, read once at startup.
//!
//! The Sony contract values are not settings: they are constants of the Sony
//! adapter and of `docs/contracts/sony-constants.json`.

use std::path::PathBuf;

use crate::domain::secret::Secret;
use crate::observability::LogFormat;

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
    /// The log line format (`PSSTORE_LOG_FORMAT`): `json`, the default, or
    /// `text`.
    pub log_format: LogFormat,
    /// The Git commit of the deployment (`RAILWAY_GIT_COMMIT_SHA`). Railway
    /// sets it on every deployment; a local run has none.
    pub commit: Option<String>,
    /// The settings that had an invalid value. Each one uses its default.
    pub invalid: Vec<InvalidSetting>,
}

/// A setting whose value was invalid, so the server uses its default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidSetting {
    /// `PSSTORE_LOG_FORMAT` was not `json` or `text`.
    LogFormat,
    /// `RAILWAY_GIT_COMMIT_SHA` was not 7 to 64 hexadecimal digits.
    CommitSha,
}

impl InvalidSetting {
    /// A fixed tag for the log. The log never shows the invalid value.
    #[must_use]
    pub fn tag(self) -> &'static str {
        match self {
            Self::LogFormat => "invalid_log_format",
            Self::CommitSha => "invalid_commit_sha",
        }
    }
}

/// The identity of the running build, for `GET /version`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildInfo {
    /// The version of the server crate.
    pub version: &'static str,
    /// The Git commit of the deployment, or `unknown`.
    pub commit: String,
}

impl Default for BuildInfo {
    /// The crate version and an `unknown` commit.
    fn default() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION"),
            commit: "unknown".to_owned(),
        }
    }
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
    /// Reads `PORT`, `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`,
    /// `PSSTORE_LOG_FORMAT`, and `RAILWAY_GIT_COMMIT_SHA`.
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
        let mut invalid = Vec::new();
        let log_format = match non_empty("PSSTORE_LOG_FORMAT") {
            None => LogFormat::default(),
            Some(value) => LogFormat::parse(&value).unwrap_or_else(|| {
                invalid.push(InvalidSetting::LogFormat);
                LogFormat::default()
            }),
        };
        let commit = non_empty("RAILWAY_GIT_COMMIT_SHA").and_then(|value| {
            let commit = parse_commit(&value);
            if commit.is_none() {
                invalid.push(InvalidSetting::CommitSha);
            }
            commit
        });
        Self {
            port: parse_port(lookup("PORT").as_deref()),
            igdb,
            web_build: PathBuf::from(WEB_BUILD_DIR),
            log_format,
            commit,
            invalid,
        }
    }

    /// The build identity that `GET /version` shows.
    #[must_use]
    pub fn build_info(&self) -> BuildInfo {
        BuildInfo {
            commit: self.commit.clone().unwrap_or_else(|| "unknown".to_owned()),
            ..BuildInfo::default()
        }
    }
}

/// A Git commit id: 7 to 64 hexadecimal digits. The check keeps any other
/// text, such as a path, out of the `GET /version` answer.
fn parse_commit(value: &str) -> Option<String> {
    let valid = (7..=64).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_hexdigit());
    valid.then(|| value.to_owned())
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
    fn reads_the_log_format_with_json_as_the_default() {
        assert_eq!(config(&[]).log_format, LogFormat::Json);
        assert_eq!(config(&[]).invalid, Vec::<InvalidSetting>::new());
        assert_eq!(
            config(&[("PSSTORE_LOG_FORMAT", "")]).log_format,
            LogFormat::Json
        );
        assert_eq!(
            config(&[("PSSTORE_LOG_FORMAT", "text")]).log_format,
            LogFormat::Text
        );
        assert_eq!(
            config(&[("PSSTORE_LOG_FORMAT", "json")]).log_format,
            LogFormat::Json
        );
        let typo = config(&[("PSSTORE_LOG_FORMAT", "txt")]);
        assert_eq!(typo.log_format, LogFormat::Json);
        assert_eq!(typo.invalid, vec![InvalidSetting::LogFormat]);
    }

    #[test]
    fn reads_the_deployed_commit() {
        const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
        let local = config(&[]);
        assert_eq!(local.commit, None);
        assert_eq!(local.build_info().commit, "unknown");
        assert_eq!(local.build_info().version, env!("CARGO_PKG_VERSION"));

        let deployed = config(&[("RAILWAY_GIT_COMMIT_SHA", SHA)]);
        assert_eq!(deployed.commit.as_deref(), Some(SHA));
        assert_eq!(deployed.build_info().commit, SHA);
        assert_eq!(deployed.invalid, Vec::<InvalidSetting>::new());
        assert_eq!(
            config(&[("RAILWAY_GIT_COMMIT_SHA", "4581df1")])
                .commit
                .as_deref(),
            Some("4581df1")
        );

        let too_long = "a".repeat(65);
        for value in [
            "main",
            "4581df",
            "../../etc/passwd",
            "4581df1 ",
            too_long.as_str(),
        ] {
            let invalid = config(&[("RAILWAY_GIT_COMMIT_SHA", value)]);
            assert_eq!(invalid.commit, None, "{value}");
            assert_eq!(invalid.build_info().commit, "unknown", "{value}");
            assert_eq!(invalid.invalid, vec![InvalidSetting::CommitSha], "{value}");
        }
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
