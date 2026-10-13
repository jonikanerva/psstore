//! Field rules of the tolerant list decoders.
//!
//! The rules follow the Effect schemas of the TypeScript server: a list
//! element must be a JSON object, a field may be absent or `null`, and a field
//! of the wrong type fails the element. A decoded element is then in scope or
//! out of scope.

use serde_json::{Map, Value};

/// The outcome of one list element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Field<T> {
    Kept(T),
    /// The element failed decode or had no usable id or name.
    Dropped,
    /// The element decoded but is outside the product scope.
    OutOfScope,
}

/// `Some(None)` for an absent or `null` field, `Some(Some(text))` for a
/// string, and `None` for a value of another type.
pub(super) fn nullable_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Option<Option<&'a str>> {
    match object.get(key) {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(text)) => Some(Some(text)),
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_field_is_absent_null_a_string_or_of_the_wrong_type() {
        let value = json!({"null": null, "text": "x", "number": 5, "list": []});
        let object = value.as_object().unwrap();
        assert_eq!(nullable_string(object, "absent"), Some(None));
        assert_eq!(nullable_string(object, "null"), Some(None));
        assert_eq!(nullable_string(object, "text"), Some(Some("x")));
        assert_eq!(nullable_string(object, "number"), None);
        assert_eq!(nullable_string(object, "list"), None);
    }
}
