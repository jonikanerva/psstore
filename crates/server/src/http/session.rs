//! The sign-in cookie and the `/api/session` routes (STACK.md §14).
//!
//! The cookie value is the NPSSO. The cookie is `HttpOnly`, so script cannot
//! read it, and `SameSite=Strict`, so a cross-site request does not carry it.
//! The NPSSO never appears in a response body or a log line.

use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::header::{CONTENT_TYPE, COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

use super::AppState;
use super::errors::{Problem, ProblemCode, problem};
use super::openapi::{
    InternalError, InvalidRequest, PayloadTooLarge, SessionRejected, SignInRequest,
    UnsupportedMediaType, UpstreamFailure,
};
use crate::domain::secret::Secret;

/// The cookie name. The signed-in routes read it, and the sign-in route sets it.
pub const NPSSO_COOKIE_NAME: &str = "npsso";
/// The cookie lifetime: 30 days.
pub const NPSSO_COOKIE_MAX_AGE_SECONDS: u32 = 2_592_000;
/// The cookie attributes after `Max-Age`. A browser clears a cookie only when
/// the attributes of the clearing header match the attributes of the cookie.
const COOKIE_PATH_ATTRIBUTE: &str = "Path=/api";
const COOKIE_FLAGS: &str = "HttpOnly; Secure; SameSite=Strict";
/// The header that clears the cookie.
const EXPIRED_COOKIE: &str = "npsso=; Max-Age=0; Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict";

/// The shortest and the longest accepted NPSSO.
const NPSSO_MIN_LENGTH: usize = 16;
const NPSSO_MAX_LENGTH: usize = 512;

/// The NPSSO of the first `npsso` cookie of the request, or `None` when the
/// cookie is missing or empty.
pub(super) fn npsso_from_cookie(headers: &HeaderMap) -> Option<Secret> {
    let value = headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|header| header.to_str().ok())
        .flat_map(|header| header.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| name.trim() == NPSSO_COOKIE_NAME)
        .map(|(_, value)| value.trim())?;
    (!value.is_empty()).then(|| Secret::new(value))
}

/// Adds the clearing `Set-Cookie` header to a 401 response.
pub(super) fn expire_cookie_on_rejection(mut response: Response) -> Response {
    if response.status() == StatusCode::UNAUTHORIZED {
        response
            .headers_mut()
            .append(SET_COOKIE, HeaderValue::from_static(EXPIRED_COOKIE));
    }
    response
}

/// True for an NPSSO of 16 to 512 characters from the cookie-safe set
/// `A-Za-z0-9._~-`. Such a value can be stored in a cookie verbatim.
fn is_valid_npsso(value: &str) -> bool {
    (NPSSO_MIN_LENGTH..=NPSSO_MAX_LENGTH).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'~' | b'-'))
}

/// The media type of the request body without parameters, in lower case, or
/// `None` without a `Content-Type` header. A request without the header is
/// read as JSON, like on the TypeScript server.
fn media_type(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(CONTENT_TYPE)?.to_str().unwrap_or_default();
    let media = value.split(';').next().unwrap_or_default().trim();
    (!media.is_empty()).then(|| media.to_ascii_lowercase())
}

/// The NPSSO of a JSON body `{"npsso": "…"}`. Other keys are ignored.
fn npsso_from_body(body: &[u8]) -> Option<Secret> {
    let value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let npsso = value.as_object()?.get("npsso")?.as_str()?;
    is_valid_npsso(npsso).then(|| Secret::new(npsso))
}

/// `POST /api/session`: exchanges the NPSSO with Sony once and sets the cookie
/// only after Sony accepted it. The answer is an empty 204. A body that is not
/// JSON answers 415, an invalid body 400, and a body over the body limit 413.
#[utoipa::path(
    post,
    path = "/api/session",
    operation_id = "signIn",
    tag = "session",
    request_body(
        content = SignInRequest,
        content_type = "application/json",
        description = "The NPSSO token. A request without a `Content-Type` header is read as JSON."
    ),
    responses(
        (
            status = 204,
            description = "Sony accepted the NPSSO. The response sets the HttpOnly `npsso` cookie for 30 days.",
            headers(("Set-Cookie" = String, description = "`npsso=<NPSSO>; Max-Age=2592000; Path=/api; HttpOnly; Secure; SameSite=Strict`"))
        ),
        InvalidRequest,
        SessionRejected,
        PayloadTooLarge,
        UnsupportedMediaType,
        UpstreamFailure,
        InternalError
    )
)]
pub(super) async fn sign_in(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    // Axum reads the body before the handler runs, so a body over the limit
    // is a 413 whatever its media type.
    let body = match body {
        Ok(body) => body,
        Err(rejection) => return Problem::from(rejection).into_response(),
    };
    if let Some(media) = media_type(&headers)
        && media != "application/json"
    {
        return problem(ProblemCode::UnsupportedMediaType);
    }
    let Some(npsso) = npsso_from_body(&body) else {
        return problem(ProblemCode::InvalidRequest);
    };
    match state.account.verify_npsso(npsso.clone()).await {
        Ok(()) => {
            let cookie = format!(
                "{NPSSO_COOKIE_NAME}={}; Max-Age={NPSSO_COOKIE_MAX_AGE_SECONDS}; {COOKIE_PATH_ATTRIBUTE}; {COOKIE_FLAGS}",
                npsso.expose()
            );
            // The value has only cookie-safe characters, so the header is
            // valid. A failure here is a defect, not a client error.
            match HeaderValue::from_str(&cookie) {
                Ok(value) => (StatusCode::NO_CONTENT, [(SET_COOKIE, value)]).into_response(),
                Err(_) => problem(ProblemCode::InternalError),
            }
        }
        Err(error) => Problem::from(error).into_response(),
    }
}

/// `DELETE /api/session`: clears the cookie. It makes no Sony call.
#[utoipa::path(
    delete,
    path = "/api/session",
    operation_id = "signOut",
    tag = "session",
    responses(
        (
            status = 204,
            description = "The response clears the `npsso` cookie.",
            headers(("Set-Cookie" = String, description = "`npsso=; Max-Age=0; Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`"))
        ),
        InternalError
    )
)]
pub(super) async fn sign_out() -> Response {
    (
        StatusCode::NO_CONTENT,
        [(SET_COOKIE, HeaderValue::from_static(EXPIRED_COOKIE))],
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie_headers(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, HeaderValue::from_str(value).unwrap());
        headers
    }

    #[test]
    fn reads_the_first_npsso_cookie() {
        let npsso = npsso_from_cookie(&cookie_headers("a=1; npsso=abc; npsso=def")).unwrap();
        assert_eq!(npsso.expose(), "abc");
        assert!(npsso_from_cookie(&cookie_headers("npsso=; npsso=abc")).is_none());
        assert!(npsso_from_cookie(&cookie_headers("other=1")).is_none());
        assert!(npsso_from_cookie(&HeaderMap::new()).is_none());
    }

    #[test]
    fn accepts_only_cookie_safe_npsso_values() {
        assert!(is_valid_npsso(&"a".repeat(16)));
        assert!(is_valid_npsso(&format!("{}.-_~", "A1".repeat(8))));
        assert!(is_valid_npsso(&"a".repeat(512)));
        assert!(!is_valid_npsso(&"a".repeat(15)));
        assert!(!is_valid_npsso(&"a".repeat(513)));
        assert!(!is_valid_npsso(&format!("{}; Path=/", "a".repeat(20))));
        assert!(!is_valid_npsso(&format!("{}ä", "a".repeat(20))));
    }

    #[test]
    fn reads_the_npsso_from_a_json_object_only() {
        let valid = "a".repeat(20);
        assert!(npsso_from_body(format!(r#"{{"npsso":"{valid}","x":1}}"#).as_bytes()).is_some());
        for body in [
            "{}".to_owned(),
            r#"{"npsso":"short"}"#.to_owned(),
            r#"{"npsso":42}"#.to_owned(),
            "not json".to_owned(),
            String::new(),
            format!(r#"["{valid}"]"#),
        ] {
            assert!(npsso_from_body(body.as_bytes()).is_none(), "{body}");
        }
    }

    #[test]
    fn media_type_ignores_parameters_and_case() {
        let mut headers = HeaderMap::new();
        assert_eq!(media_type(&headers), None);
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("APPLICATION/JSON; charset=utf-8"),
        );
        assert_eq!(media_type(&headers).as_deref(), Some("application/json"));
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("multipart/form-data; boundary=x"),
        );
        assert_eq!(media_type(&headers).as_deref(), Some("multipart/form-data"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static(""));
        assert_eq!(media_type(&headers), None);
    }
}
