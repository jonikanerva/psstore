//! The Effect Schema decode rules of the TypeScript boundary, over a parsed
//! JSON value.
//!
//! The decoders walk a `serde_json::Value` instead of deriving `Deserialize`
//! on raw structs. A derived struct accepts a JSON array as a struct (by
//! position) and fails on a repeated key. Effect `Schema.Struct` rejects an
//! array and `JSON.parse` keeps the last repeated key, like `Value` does. The
//! rules below are the Effect rules:
//!
//! - `Schema.Struct`: an object that is not `null` and not an array. Unknown
//!   keys are ignored.
//! - `Schema.optional(Schema.NullOr(X))`: an absent key or `null` is `None`;
//!   a value of another type fails the whole struct.
//! - `Schema.Array(X)`: one failing element fails the whole array.

use serde_json::{Map, Value};

/// A JSON object.
pub(super) type Object = Map<String, Value>;

/// A value that does not have the expected shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Invalid;

/// `Schema.Struct`: the value must be an object.
pub(super) fn object(value: &Value) -> Result<&Object, Invalid> {
    value.as_object().ok_or(Invalid)
}

/// The value of an `optional(NullOr(…))` key: `None` when absent or `null`.
fn present<'a>(obj: &'a Object, key: &str) -> Option<&'a Value> {
    obj.get(key).filter(|value| !value.is_null())
}

/// `optional(NullOr(String))`.
pub(super) fn opt_string(obj: &Object, key: &str) -> Result<Option<String>, Invalid> {
    present(obj, key)
        .map(|value| value.as_str().map(str::to_owned).ok_or(Invalid))
        .transpose()
}

/// `optional(NullOr(Boolean))`.
pub(super) fn opt_bool(obj: &Object, key: &str) -> Result<Option<bool>, Invalid> {
    present(obj, key)
        .map(|value| value.as_bool().ok_or(Invalid))
        .transpose()
}

/// `optional(NullOr(Array(Unknown)))`: the elements stay undecoded, so one
/// bad element can be dropped on its own.
pub(super) fn opt_list<'a>(obj: &'a Object, key: &str) -> Result<Option<&'a [Value]>, Invalid> {
    present(obj, key)
        .map(|value| value.as_array().map(Vec::as_slice).ok_or(Invalid))
        .transpose()
}

/// `optional(NullOr(Array(X)))`: every element must decode.
pub(super) fn opt_list_of<T>(
    obj: &Object,
    key: &str,
    decode: impl Fn(&Value) -> Result<T, Invalid>,
) -> Result<Option<Vec<T>>, Invalid> {
    opt_list(obj, key)?
        .map(|items| items.iter().map(decode).collect())
        .transpose()
}

/// `optional(NullOr(Array(String)))`.
pub(super) fn opt_strings(obj: &Object, key: &str) -> Result<Option<Vec<String>>, Invalid> {
    opt_list_of(obj, key, string)
}

/// `optional(NullOr(Array(NullOr(String))))`.
pub(super) fn opt_nullable_strings(
    obj: &Object,
    key: &str,
) -> Result<Option<Vec<Option<String>>>, Invalid> {
    opt_list_of(obj, key, |value| {
        if value.is_null() {
            Ok(None)
        } else {
            string(value).map(Some)
        }
    })
}

/// `optional(NullOr(S))` for a nested struct `S`.
pub(super) fn opt_object_of<T>(
    obj: &Object,
    key: &str,
    decode: impl Fn(&Value) -> Result<T, Invalid>,
) -> Result<Option<T>, Invalid> {
    present(obj, key).map(decode).transpose()
}

/// `Schema.String`.
pub(super) fn string(value: &Value) -> Result<String, Invalid> {
    value.as_str().map(str::to_owned).ok_or(Invalid)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_struct_is_an_object_only() {
        assert!(object(&json!({})).is_ok());
        for value in [json!(null), json!([]), json!(["a"]), json!("x"), json!(1)] {
            assert_eq!(object(&value), Err(Invalid), "{value}");
        }
    }

    #[test]
    fn optional_nullable_fields_accept_absent_and_null_only() {
        let obj = json!({"a": "x", "n": null, "b": true, "wrong": 5});
        let obj = object(&obj).unwrap();
        assert_eq!(opt_string(obj, "a"), Ok(Some("x".into())));
        assert_eq!(opt_string(obj, "n"), Ok(None));
        assert_eq!(opt_string(obj, "missing"), Ok(None));
        assert_eq!(opt_string(obj, "wrong"), Err(Invalid));
        assert_eq!(opt_bool(obj, "b"), Ok(Some(true)));
        assert_eq!(opt_bool(obj, "a"), Err(Invalid));
    }

    #[test]
    fn one_bad_element_fails_a_typed_array() {
        let obj = json!({"ok": ["a", "b"], "bad": ["a", null], "nullable": ["a", null]});
        let obj = object(&obj).unwrap();
        assert_eq!(
            opt_strings(obj, "ok"),
            Ok(Some(vec!["a".into(), "b".into()]))
        );
        assert_eq!(opt_strings(obj, "bad"), Err(Invalid));
        assert_eq!(
            opt_nullable_strings(obj, "nullable"),
            Ok(Some(vec![Some("a".into()), None]))
        );
        assert_eq!(
            opt_list(obj, "ok").map(|v| v.map(<[Value]>::len)),
            Ok(Some(2))
        );
        let not_list = json!({"x": {}});
        assert_eq!(opt_list(object(&not_list).unwrap(), "x"), Err(Invalid));
    }
}
