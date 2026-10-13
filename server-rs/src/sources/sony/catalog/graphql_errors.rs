//! Persisted-query rotation detection (port of
//! `server/src/sony/graphqlErrors.ts`).
//!
//! Sony's GraphQL endpoint answers HTTP 200 when a persisted-query hash no
//! longer matches its store build. It reports the failure Apollo-style as a
//! top-level `errors[]` entry with `PERSISTED_QUERY_NOT_FOUND`.

use serde_json::Value;

use super::json::{Invalid, Object, object};

/// The canonical Apollo persisted-query protocol code.
const PERSISTED_QUERY_NOT_FOUND: &str = "PERSISTED_QUERY_NOT_FOUND";

/// The code and the message of one GraphQL error.
struct GraphqlError {
    code: Option<String>,
    message: Option<String>,
}

/// `Schema.optional(Schema.String)`: an absent key, or a string. Unlike the
/// other boundaries, `null` fails, so the whole envelope fails and reads as
/// no rotation.
fn opt_strict_string(obj: &Object, key: &str) -> Result<Option<String>, Invalid> {
    obj.get(key)
        .map(|value| value.as_str().map(str::to_owned).ok_or(Invalid))
        .transpose()
}

fn graphql_error(value: &Value) -> Result<GraphqlError, Invalid> {
    let obj = object(value)?;
    let message = opt_strict_string(obj, "message")?;
    let code = match obj.get("extensions") {
        None => None,
        Some(extensions) => opt_strict_string(object(extensions)?, "code")?,
    };
    Ok(GraphqlError { code, message })
}

fn errors(json: &Value) -> Result<Vec<GraphqlError>, Invalid> {
    match object(json)?.get("errors") {
        None => Ok(vec![]),
        Some(list) => list
            .as_array()
            .ok_or(Invalid)?
            .iter()
            .map(graphql_error)
            .collect(),
    }
}

/// True when a GraphQL response body reports a persisted-query rotation: the
/// canonical code, or a case-insensitive `persistedquerynotfound` in the code
/// or the message. Sony's exact wording is not captured in a fixture, so the
/// fallback is broad: a false positive only changes the kind of the 502.
pub fn detect_persisted_query_rotation(json: &Value) -> bool {
    let Ok(errors) = errors(json) else {
        return false;
    };
    errors.iter().any(|error| {
        error.code.as_deref() == Some(PERSISTED_QUERY_NOT_FOUND)
            || [&error.code, &error.message]
                .into_iter()
                .flatten()
                .any(|text| text.to_lowercase().contains("persistedquerynotfound"))
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn matches_the_canonical_code() {
        let body = json!({"errors": [{
            "message": "PersistedQueryNotFound",
            "extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}
        }]});
        assert!(detect_persisted_query_rotation(&body));
    }

    #[test]
    fn matches_the_message_substring_in_any_case() {
        let body = json!({"errors": [{"message": "persistedquerynotfound: unknown hash"}]});
        assert!(detect_persisted_query_rotation(&body));
        let body = json!({"errors": [{"extensions": {"code": "PersistedQueryNotFound"}}]});
        assert!(detect_persisted_query_rotation(&body));
    }

    #[test]
    fn does_not_match_another_error() {
        let body = json!({"errors": [{
            "message": "Some other failure",
            "extensions": {"code": "INTERNAL_SERVER_ERROR"}
        }]});
        assert!(!detect_persisted_query_rotation(&body));
    }

    #[test]
    fn a_data_response_or_a_non_object_body_is_no_rotation() {
        assert!(!detect_persisted_query_rotation(
            &json!({"data": {"categoryGridRetrieve": {}}})
        ));
        assert!(!detect_persisted_query_rotation(&json!({})));
        assert!(!detect_persisted_query_rotation(&json!(null)));
        assert!(!detect_persisted_query_rotation(&json!("nope")));
        assert!(!detect_persisted_query_rotation(&json!(42)));
    }

    /// Challenge cases: Effect `Schema.optional` without `NullOr` rejects a
    /// `null`, and one bad element fails the whole envelope.
    #[test]
    fn a_null_field_or_a_bad_element_fails_the_whole_envelope() {
        let null_message = json!({"errors": [{
            "message": null,
            "extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}
        }]});
        assert!(!detect_persisted_query_rotation(&null_message));
        let bad_neighbour = json!({"errors": [
            {"extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}},
            "text"
        ]});
        assert!(!detect_persisted_query_rotation(&bad_neighbour));
        assert!(!detect_persisted_query_rotation(&json!({"errors": null})));
        assert!(!detect_persisted_query_rotation(
            &json!({"errors": [{"extensions": null}]})
        ));
    }
}
