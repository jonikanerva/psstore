//! Typed failures of the store and account lookups.
//!
//! Each public operation declares the failures it can return. The HTTP layer
//! maps every variant to one status and one JSON body, so a new variant is a
//! compile error until the mapping handles it. A `message` is a fixed text
//! that this crate chooses. It never contains a credential, a URL, or the text
//! of a transport error.
//!
//! The `Display` text of each variant is a fixed text too. It interpolates no
//! field, so it cannot show an id from a request or a value from Sony.

use super::id::GameId;

/// A failure of an upstream store call.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UpstreamError {
    /// An outage, a timeout, an unexpected answer, or a broken contract
    /// (HTTP 502).
    #[error("the upstream store is unavailable")]
    Unavailable { message: String },
    /// Sony no longer knows a persisted-query hash. The fix is
    /// `pnpm sony:refresh` (HTTP 502).
    #[error("the upstream store no longer knows a persisted query")]
    QueryRotated {
        message: String,
        operation_name: String,
    },
    /// Sony answered 429 after the retry budget (HTTP 503).
    #[error("the upstream store limited the request rate")]
    RateLimited {
        message: String,
        retry_after_seconds: Option<u64>,
    },
}

impl UpstreamError {
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::Unavailable {
            message: message.into(),
        }
    }

    /// The variant name, for a log field. It contains no data.
    #[must_use]
    pub fn tag(&self) -> &'static str {
        match self {
            Self::Unavailable { .. } => "UpstreamUnavailable",
            Self::QueryRotated { .. } => "UpstreamQueryRotated",
            Self::RateLimited { .. } => "UpstreamRateLimited",
        }
    }
}

/// A failure of the game page lookup.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GameLookupError {
    /// No PS5 game has this id in the Finnish store (HTTP 404).
    #[error("no PS5 game has this id")]
    NotFound { id: GameId },
    #[error(transparent)]
    Upstream(#[from] UpstreamError),
}

/// A failure of a signed-in request.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AccountError {
    /// Sony definitively rejected the NPSSO or the token derived from it, or
    /// the request had no NPSSO (HTTP 401). Only this failure clears the
    /// sign-in cookie.
    #[error("Sony rejected the sign-in")]
    SessionRejected { message: String },
    #[error(transparent)]
    Upstream(#[from] UpstreamError),
}

impl AccountError {
    pub fn session_rejected(message: impl Into<String>) -> Self {
        Self::SessionRejected {
            message: message.into(),
        }
    }

    /// The variant name, for a log field. It contains no data.
    #[must_use]
    pub fn tag(&self) -> &'static str {
        match self {
            Self::SessionRejected { .. } => "SessionRejected",
            Self::Upstream(error) => error.tag(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_texts_are_fixed_and_show_no_field() {
        let rotated = UpstreamError::QueryRotated {
            message: "synthetic message".into(),
            operation_name: "syntheticOperation".into(),
        };
        let limited = UpstreamError::RateLimited {
            message: "synthetic message".into(),
            retry_after_seconds: Some(37),
        };
        let cases = [
            (
                UpstreamError::unavailable("synthetic message").to_string(),
                "the upstream store is unavailable",
            ),
            (
                rotated.to_string(),
                "the upstream store no longer knows a persisted query",
            ),
            (
                limited.to_string(),
                "the upstream store limited the request rate",
            ),
            (
                GameLookupError::NotFound {
                    id: "synthetic-id".parse().unwrap(),
                }
                .to_string(),
                "no PS5 game has this id",
            ),
            (
                GameLookupError::from(UpstreamError::unavailable("synthetic message")).to_string(),
                "the upstream store is unavailable",
            ),
            (
                AccountError::session_rejected("synthetic message").to_string(),
                "Sony rejected the sign-in",
            ),
            (
                AccountError::from(limited).to_string(),
                "the upstream store limited the request rate",
            ),
        ];
        for (text, expected) in cases {
            assert_eq!(text, expected);
            assert!(!text.contains("synthetic"), "{text}");
            assert!(!text.contains("37"), "{text}");
        }
    }
}
