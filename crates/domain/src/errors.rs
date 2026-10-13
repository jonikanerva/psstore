//! Typed failures of the store and account lookups.
//!
//! Each public operation declares the failures it can return. The HTTP layer
//! maps every variant to one status and one JSON body, so a new variant is a
//! compile error until the mapping handles it. A `message` is a fixed text
//! that this crate chooses. It never contains a credential, a URL, or the text
//! of a transport error.

/// A failure of an upstream store call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpstreamError {
    /// An outage, a timeout, an unexpected answer, or a broken contract
    /// (HTTP 502).
    Unavailable { message: String },
    /// Sony no longer knows a persisted-query hash. The fix is
    /// `pnpm sony:refresh` (HTTP 502).
    QueryRotated {
        message: String,
        operation_name: String,
    },
    /// Sony answered 429 after the retry budget (HTTP 503).
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameLookupError {
    /// No PS5 game has this id in the Finnish store (HTTP 404).
    NotFound {
        id: String,
    },
    Upstream(UpstreamError),
}

impl From<UpstreamError> for GameLookupError {
    fn from(error: UpstreamError) -> Self {
        Self::Upstream(error)
    }
}

/// A failure of a signed-in request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccountError {
    /// Sony definitively rejected the NPSSO or the token derived from it, or
    /// the request had no NPSSO (HTTP 401). Only this failure clears the
    /// sign-in cookie.
    SessionRejected {
        message: String,
    },
    Upstream(UpstreamError),
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

impl From<UpstreamError> for AccountError {
    fn from(error: UpstreamError) -> Self {
        Self::Upstream(error)
    }
}
