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

/// A field value of the wrong type. It fails the element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct WrongType;

/// `Ok(None)` for an absent or `null` field, `Ok(Some(text))` for a string,
/// and [`WrongType`] for a value of another type.
pub(super) fn nullable_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<Option<&'a str>, WrongType> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text)),
        Some(_) => Err(WrongType),
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
        assert_eq!(nullable_string(object, "absent"), Ok(None));
        assert_eq!(nullable_string(object, "null"), Ok(None));
        assert_eq!(nullable_string(object, "text"), Ok(Some("x")));
        assert_eq!(nullable_string(object, "number"), Err(WrongType));
        assert_eq!(nullable_string(object, "list"), Err(WrongType));
    }
}
