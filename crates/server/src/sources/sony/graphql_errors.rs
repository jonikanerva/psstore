//! The persisted-query rotation in a Sony GraphQL answer.
//!
//! Sony answers HTTP 200 also when it no longer knows a persisted-query hash.
//! The body then has an Apollo-style top-level `errors` array with the code
//! `PERSISTED_QUERY_NOT_FOUND`. The adapters inspect each decoded body for it.
//! Port of `server/src/sony/graphqlErrors.ts`.

use serde_json::{Map, Value};

/// The canonical Apollo persisted-query protocol code.
const PERSISTED_QUERY_NOT_FOUND: &str = "PERSISTED_QUERY_NOT_FOUND";

/// True when the body reports a persisted-query rotation.
///
/// The envelope decode follows the TypeScript schema: `errors` is absent or an
/// array of objects. In each object, `message` is absent or a string, and
/// `extensions` is absent or an object whose `code` is absent or a string.
/// Any other shape gives `false`. A match is the canonical code, or the text
/// `persistedquerynotfound` in the code or the message in any case. No fixture
/// holds Sony's exact wording, so the fallback stays broad: a false positive
/// only changes one 502 into another.
#[must_use]
pub fn is_persisted_query_rotation(body: &Value) -> bool {
    let Some(root) = body.as_object() else {
        return false;
    };
    let Some(Value::Array(errors)) = root.get("errors") else {
        return false;
    };
    let mut decoded = Vec::with_capacity(errors.len());
    for error in errors {
        match decode_error(error) {
            Some(fields) => decoded.push(fields),
            // One element of the wrong shape fails the whole envelope.
            None => return false,
        }
    }
    decoded.iter().any(|(message, code)| {
        code.is_some_and(|code| code == PERSISTED_QUERY_NOT_FOUND)
            || [*code, *message]
                .into_iter()
                .flatten()
                .any(|text| text.to_lowercase().contains("persistedquerynotfound"))
    })
}

/// The message and the code of one error, or `None` for a wrong shape.
fn decode_error(error: &Value) -> Option<(Option<&str>, Option<&str>)> {
    let error = error.as_object()?;
    let message = optional_string(error, "message").ok()?;
    let code = match error.get("extensions") {
        None => None,
        Some(Value::Object(extensions)) => optional_string(extensions, "code").ok()?,
        Some(_) => return None,
    };
    Some((message, code))
}

/// A field value of the wrong shape. It fails the envelope.
struct WrongShape;

/// `Ok(None)` for an absent key, `Ok(Some(text))` for a string, and
/// [`WrongShape`] for any other value, `null` included.
fn optional_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<Option<&'a str>, WrongShape> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::String(text)) => Ok(Some(text)),
        Some(_) => Err(WrongShape),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn matches_the_canonical_apollo_code() {
        let body = json!({"errors": [{
            "message": "PersistedQueryNotFound",
            "extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}
        }]});
        assert!(is_persisted_query_rotation(&body));
    }

    #[test]
    fn matches_the_message_in_any_case() {
        let body = json!({"errors": [{"message": "persistedquerynotfound: unknown hash"}]});
        assert!(is_persisted_query_rotation(&body));
    }

    #[test]
    fn matches_the_code_text_in_any_case() {
        let body = json!({"errors": [{"extensions": {"code": "PersistedQueryNotFound"}}]});
        assert!(is_persisted_query_rotation(&body));
    }

    #[test]
    fn does_not_match_an_unrelated_error() {
        let body = json!({"errors": [{
            "message": "Some other failure",
            "extensions": {"code": "INTERNAL_SERVER_ERROR"}
        }]});
        assert!(!is_persisted_query_rotation(&body));
    }

    #[test]
    fn a_normal_answer_or_a_non_object_body_is_no_rotation() {
        for body in [
            json!({"data": {"categoryGridRetrieve": {}}}),
            json!({}),
            json!(null),
            json!("nope"),
            json!(42),
            json!([{"message": "PersistedQueryNotFound"}]),
        ] {
            assert!(!is_persisted_query_rotation(&body), "{body}");
        }
    }

    /// The TypeScript schema fails the whole envelope on one element of the
    /// wrong shape, so a matching neighbour does not count.
    #[test]
    fn an_element_of_the_wrong_shape_fails_the_whole_envelope() {
        let matching = json!({"extensions": {"code": "PERSISTED_QUERY_NOT_FOUND"}});
        for broken in [
            json!(null),
            json!("text"),
            json!([]),
            json!({"message": null}),
            json!({"message": 5}),
            json!({"extensions": null}),
            json!({"extensions": "x"}),
            json!({"extensions": {"code": 7}}),
        ] {
            let body = json!({"errors": [broken.clone(), matching.clone()]});
            assert!(!is_persisted_query_rotation(&body), "{broken}");
        }
        assert!(!is_persisted_query_rotation(&json!({"errors": null})));
        assert!(!is_persisted_query_rotation(&json!({"errors": {}})));
    }
}
