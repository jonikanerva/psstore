//! The public failures of the `/api` routes as RFC 9457 Problem Details.
//!
//! Every failure of an `/api` route answers `application/problem+json`:
//!
//! ```json
//! {"type":"about:blank","title":"Not Found","status":404,
//!  "detail":"No PS5 game in the Finnish store has this id.","code":"game_not_found"}
//! ```
//!
//! - `type` is always `about:blank`, so `title` is the HTTP status phrase of
//!   RFC 9110 (RFC 9457, section 4.2.1).
//! - `code` is the stable application code ([`ProblemCode`]). The client
//!   branches on it.
//! - `detail` is a fixed text per code. It never contains a credential, a
//!   URL, upstream text, or user input. So the `message` texts of the domain
//!   errors and the requested game id never reach a response.
//! - `retryAfterSeconds` is an extension of `upstream_rate_limited` only.
//!
//! This module maps every failure in one place: the domain errors, the
//! request validation, and the extractor rejections. Each mapping is an
//! exhaustive `match`, so a new error variant does not compile until it has a
//! code.

use axum::extract::rejection::{BytesRejection, PathRejection};
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use utoipa::ToSchema;

use super::params::Invalid;
use crate::domain::errors::{AccountError, GameLookupError, UpstreamError};

/// The media type of a Problem Details body.
pub const PROBLEM_JSON: &str = "application/problem+json";

/// The `type` of every problem: no problem type beyond the HTTP status.
pub const ABOUT_BLANK: &str = "about:blank";

/// The stable application code of a public failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProblemCode {
    /// A query parameter, a path segment, or a request body is invalid (400).
    InvalidRequest,
    /// No `/api` route has this path and method (404).
    NotFound,
    /// No PS5 game in the Finnish store has the requested id (404).
    GameNotFound,
    /// The request has no sign-in cookie, or Sony rejected the NPSSO (401).
    SessionRejected,
    /// The sign-in body has another media type than JSON (415).
    UnsupportedMediaType,
    /// The request body is larger than the body limit (413).
    PayloadTooLarge,
    /// Sony failed, timed out, or answered unexpectedly (502).
    UpstreamUnavailable,
    /// Sony no longer knows a persisted-query hash (502).
    UpstreamQueryRotated,
    /// Sony limited the request rate (503).
    UpstreamRateLimited,
    /// The server failed to handle the request (500).
    InternalError,
}

impl ProblemCode {
    /// Every code, in declaration order.
    pub const ALL: [Self; 10] = [
        Self::InvalidRequest,
        Self::NotFound,
        Self::GameNotFound,
        Self::SessionRejected,
        Self::UnsupportedMediaType,
        Self::PayloadTooLarge,
        Self::UpstreamUnavailable,
        Self::UpstreamQueryRotated,
        Self::UpstreamRateLimited,
        Self::InternalError,
    ];

    /// The HTTP status of the code. The statuses are the statuses of the
    /// TypeScript server.
    #[must_use]
    pub fn status(self) -> StatusCode {
        match self {
            Self::InvalidRequest => StatusCode::BAD_REQUEST,
            Self::NotFound | Self::GameNotFound => StatusCode::NOT_FOUND,
            Self::SessionRejected => StatusCode::UNAUTHORIZED,
            Self::UnsupportedMediaType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UpstreamUnavailable | Self::UpstreamQueryRotated => StatusCode::BAD_GATEWAY,
            Self::UpstreamRateLimited => StatusCode::SERVICE_UNAVAILABLE,
            Self::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// The status phrase of RFC 9110, section 15.
    fn title(self) -> &'static str {
        match self {
            Self::InvalidRequest => "Bad Request",
            Self::NotFound | Self::GameNotFound => "Not Found",
            Self::SessionRejected => "Unauthorized",
            Self::UnsupportedMediaType => "Unsupported Media Type",
            Self::PayloadTooLarge => "Content Too Large",
            Self::UpstreamUnavailable | Self::UpstreamQueryRotated => "Bad Gateway",
            Self::UpstreamRateLimited => "Service Unavailable",
            Self::InternalError => "Internal Server Error",
        }
    }

    /// The fixed explanation of the code.
    fn detail(self) -> &'static str {
        match self {
            Self::InvalidRequest => "The request has an invalid parameter, path, or body.",
            Self::NotFound => "No API route has this path and method.",
            Self::GameNotFound => "No PS5 game in the Finnish store has this id.",
            Self::SessionRejected => "The Sony sign-in is missing or no longer valid.",
            Self::UnsupportedMediaType => "The request body must be application/json.",
            Self::PayloadTooLarge => "The request body is too large.",
            Self::UpstreamUnavailable => "The PlayStation Store is unavailable. Try again later.",
            Self::UpstreamQueryRotated => {
                "The PlayStation Store no longer accepts a stored query of this server."
            }
            Self::UpstreamRateLimited => {
                "The PlayStation Store limited the request rate. Try again later."
            }
            Self::InternalError => "The server failed to handle the request.",
        }
    }
}

/// An RFC 9457 Problem Details body with the application `code` extension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// Always `about:blank`.
    #[serde(rename = "type")]
    #[schema(value_type = String)]
    type_uri: &'static str,
    /// The HTTP status phrase.
    #[schema(value_type = String)]
    title: &'static str,
    /// The HTTP status code of the response.
    status: u16,
    /// A fixed explanation of the code. It contains no request data.
    #[schema(value_type = String)]
    detail: &'static str,
    code: ProblemCode,
    /// Only for `upstream_rate_limited`: the delay in seconds that Sony asked
    /// for. The key is absent when Sony gave no delay. It is never `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = u32)]
    retry_after_seconds: Option<u32>,
}

impl Problem {
    /// The problem of a code.
    #[must_use]
    pub fn new(code: ProblemCode) -> Self {
        Self {
            type_uri: ABOUT_BLANK,
            title: code.title(),
            status: code.status().as_u16(),
            detail: code.detail(),
            code,
            retry_after_seconds: None,
        }
    }

    #[must_use]
    pub fn code(&self) -> ProblemCode {
        self.code
    }
}

/// The response of a code. Use it for every failure outside the typed
/// handler results, for example the 500 of a contained panic.
#[must_use]
pub fn problem(code: ProblemCode) -> Response {
    Problem::new(code).into_response()
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let status = self.code.status();
        match serde_json::to_vec(&self) {
            Ok(body) => (
                status,
                [(CONTENT_TYPE, HeaderValue::from_static(PROBLEM_JSON))],
                body,
            )
                .into_response(),
            // The body has only text, integer, and enum fields, so this
            // serialization cannot fail. The status still holds.
            Err(_) => status.into_response(),
        }
    }
}

impl From<&UpstreamError> for Problem {
    fn from(error: &UpstreamError) -> Self {
        match error {
            UpstreamError::Unavailable { .. } => Self::new(ProblemCode::UpstreamUnavailable),
            UpstreamError::QueryRotated { .. } => Self::new(ProblemCode::UpstreamQueryRotated),
            UpstreamError::RateLimited {
                retry_after_seconds,
                ..
            } => Self {
                // The source clamps the delay to its attempt deadline, so it
                // fits in `u32`. A larger value saturates.
                retry_after_seconds: retry_after_seconds
                    .map(|seconds| u32::try_from(seconds).unwrap_or(u32::MAX)),
                ..Self::new(ProblemCode::UpstreamRateLimited)
            },
        }
    }
}

impl From<UpstreamError> for Problem {
    fn from(error: UpstreamError) -> Self {
        Self::from(&error)
    }
}

impl From<GameLookupError> for Problem {
    fn from(error: GameLookupError) -> Self {
        match error {
            GameLookupError::NotFound { .. } => Self::new(ProblemCode::GameNotFound),
            GameLookupError::Upstream(error) => Self::from(&error),
        }
    }
}

impl From<AccountError> for Problem {
    fn from(error: AccountError) -> Self {
        match error {
            AccountError::SessionRejected { .. } => Self::new(ProblemCode::SessionRejected),
            AccountError::Upstream(error) => Self::from(&error),
        }
    }
}

/// An invalid query parameter or path segment.
impl From<Invalid> for Problem {
    fn from(Invalid: Invalid) -> Self {
        Self::new(ProblemCode::InvalidRequest)
    }
}

/// A path segment that does not decode, for example invalid UTF-8.
impl From<PathRejection> for Problem {
    fn from(_: PathRejection) -> Self {
        Self::new(ProblemCode::InvalidRequest)
    }
}

/// A body over the body limit is a 413. Any other failure to read the body
/// is a 400, like the axum rejection.
impl From<BytesRejection> for Problem {
    fn from(rejection: BytesRejection) -> Self {
        if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
            Self::new(ProblemCode::PayloadTooLarge)
        } else {
            Self::new(ProblemCode::InvalidRequest)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_code_has_its_status_title_and_a_fixed_detail() {
        let expected = [
            (ProblemCode::InvalidRequest, "invalid_request", 400),
            (ProblemCode::NotFound, "not_found", 404),
            (ProblemCode::GameNotFound, "game_not_found", 404),
            (ProblemCode::SessionRejected, "session_rejected", 401),
            (
                ProblemCode::UnsupportedMediaType,
                "unsupported_media_type",
                415,
            ),
            (ProblemCode::PayloadTooLarge, "payload_too_large", 413),
            (
                ProblemCode::UpstreamUnavailable,
                "upstream_unavailable",
                502,
            ),
            (
                ProblemCode::UpstreamQueryRotated,
                "upstream_query_rotated",
                502,
            ),
            (
                ProblemCode::UpstreamRateLimited,
                "upstream_rate_limited",
                503,
            ),
            (ProblemCode::InternalError, "internal_error", 500),
        ];
        assert_eq!(expected.map(|(code, ..)| code), ProblemCode::ALL);
        for (code, text, status) in expected {
            let json = serde_json::to_value(Problem::new(code)).unwrap();
            assert_eq!(json["type"], "about:blank");
            assert_eq!(json["code"], text);
            assert_eq!(json["status"], status);
            assert_eq!(code.status().as_u16(), status);
            assert_eq!(
                Some(code.title()),
                match status {
                    // RFC 9110 renamed 413 from "Payload Too Large".
                    413 => Some("Content Too Large"),
                    _ => code.status().canonical_reason(),
                },
                "{text}"
            );
            assert!(json.get("retryAfterSeconds").is_none());
        }
    }

    #[test]
    fn upstream_errors_drop_their_message_and_keep_the_retry_delay() {
        let rotated = Problem::from(UpstreamError::QueryRotated {
            message: "synthetic message".into(),
            operation_name: "syntheticOperation".into(),
        });
        let text = serde_json::to_string(&rotated).unwrap();
        assert!(!text.contains("synthetic"), "{text}");
        assert_eq!(rotated.code(), ProblemCode::UpstreamQueryRotated);

        let limited = Problem::from(UpstreamError::RateLimited {
            message: "synthetic message".into(),
            retry_after_seconds: Some(7),
        });
        assert_eq!(
            serde_json::to_value(&limited).unwrap()["retryAfterSeconds"],
            7
        );
        let huge = Problem::from(UpstreamError::RateLimited {
            message: String::new(),
            retry_after_seconds: Some(u64::MAX),
        });
        assert_eq!(huge.retry_after_seconds, Some(u32::MAX));
    }

    #[test]
    fn a_missing_game_drops_the_requested_id() {
        let problem = Problem::from(GameLookupError::NotFound {
            id: "EP0000-PPSA00000_00-SYNTHETICID00000".parse().unwrap(),
        });
        let text = serde_json::to_string(&problem).unwrap();
        assert!(!text.contains("SYNTHETIC"), "{text}");
        assert_eq!(problem.code(), ProblemCode::GameNotFound);
    }
}
