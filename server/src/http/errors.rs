//! The status and the JSON body of each typed failure.
//!
//! The body is the tagged error of the TypeScript server, for example
//! `{"_tag":"GameNotFound","id":"…"}`. The client reads only the status.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::domain::errors::{AccountError, GameLookupError, UpstreamError};

#[derive(Serialize)]
#[serde(tag = "_tag")]
enum ErrorBody<'a> {
    GameNotFound {
        id: &'a str,
    },
    UpstreamUnavailable {
        message: &'a str,
    },
    UpstreamQueryRotated {
        message: &'a str,
        #[serde(rename = "operationName")]
        operation_name: &'a str,
    },
    UpstreamRateLimited {
        message: &'a str,
        #[serde(rename = "retryAfterSeconds", skip_serializing_if = "Option::is_none")]
        retry_after_seconds: Option<u64>,
    },
    SessionRejected {
        message: &'a str,
    },
}

fn respond(status: StatusCode, body: &ErrorBody<'_>) -> Response {
    (status, Json(body)).into_response()
}

impl IntoResponse for UpstreamError {
    fn into_response(self) -> Response {
        match &self {
            Self::Unavailable { message } => respond(
                StatusCode::BAD_GATEWAY,
                &ErrorBody::UpstreamUnavailable { message },
            ),
            Self::QueryRotated {
                message,
                operation_name,
            } => respond(
                StatusCode::BAD_GATEWAY,
                &ErrorBody::UpstreamQueryRotated {
                    message,
                    operation_name,
                },
            ),
            Self::RateLimited {
                message,
                retry_after_seconds,
            } => respond(
                StatusCode::SERVICE_UNAVAILABLE,
                &ErrorBody::UpstreamRateLimited {
                    message,
                    retry_after_seconds: *retry_after_seconds,
                },
            ),
        }
    }
}

impl IntoResponse for GameLookupError {
    fn into_response(self) -> Response {
        match self {
            Self::NotFound { id } => {
                respond(StatusCode::NOT_FOUND, &ErrorBody::GameNotFound { id: &id })
            }
            Self::Upstream(error) => error.into_response(),
        }
    }
}

impl IntoResponse for AccountError {
    fn into_response(self) -> Response {
        match self {
            Self::SessionRejected { message } => respond(
                StatusCode::UNAUTHORIZED,
                &ErrorBody::SessionRejected { message: &message },
            ),
            Self::Upstream(error) => error.into_response(),
        }
    }
}
