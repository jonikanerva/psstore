//! The two credential steps of the NPSSO exchange: the one-time code in the
//! authorize redirect and the access token in the token answer. Port of
//! `server/src/sony/sessionSchema.ts`.

use serde_json::Value;

use crate::domain::secret::Secret;

/// The one-time code of the authorize redirect, or `None` when the
/// `Location` is absent, points to another target, or has no code. The code
/// is a credential: never log it or return it.
pub(super) fn access_code(location: Option<&str>, redirect_uri: &str) -> Option<Secret> {
    let location = location?;
    if !location.starts_with(redirect_uri) {
        return None;
    }
    let (_, query) = location.split_once('?')?;
    // `URLSearchParams` drops one leading `?` of its input string.
    let query = query.strip_prefix('?').unwrap_or(query);
    let (_, code) = form_urlencoded::parse(query.as_bytes()).find(|(name, _)| name == "code")?;
    (!code.is_empty()).then(|| Secret::new(code.into_owned()))
}

/// The access token of the token answer, or `None` when the answer has no
/// usable token. The decoder reads only `access_token` and `expires_in`.
/// Sony also returns a refresh token and an id token: they are dropped with
/// the body and never read. `expires_in` is absent or a number, like in the
/// TypeScript schema; any other value fails the answer.
pub(super) fn access_token(body: Value) -> Option<Secret> {
    let Value::Object(mut fields) = body else {
        return None;
    };
    match fields.get("expires_in") {
        None | Some(Value::Number(_)) => {}
        Some(_) => return None,
    }
    match fields.remove("access_token") {
        Some(Value::String(token)) if !token.is_empty() => Some(Secret::new(token)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const REDIRECT: &str = "com.scee.psxandroid.scecompcall://redirect";

    #[test]
    fn reads_the_code_from_the_redirect_location() {
        let location = format!("{REDIRECT}/?code=v3.synthetic&cid=1");
        let code = access_code(Some(&location), REDIRECT).unwrap();
        assert_eq!(code.expose(), "v3.synthetic");
        let decoded = format!("{REDIRECT}/?cid=1&code=v3.a%2Bb+c&code=second");
        assert_eq!(
            access_code(Some(&decoded), REDIRECT).unwrap().expose(),
            "v3.a+b c",
            "the first code, decoded like URLSearchParams"
        );
        let doubled = format!("{REDIRECT}/??code=v3.synthetic");
        assert_eq!(
            access_code(Some(&doubled), REDIRECT).unwrap().expose(),
            "v3.synthetic"
        );
    }

    #[test]
    fn no_code_without_a_code_or_with_a_foreign_target() {
        for location in [
            format!("{REDIRECT}/"),
            format!("{REDIRECT}/?code="),
            format!("{REDIRECT}/?code"),
            format!("{REDIRECT}/?error=x"),
            "https://login.example.test/?code=v3.synthetic".to_owned(),
            format!("https://evil.example.test/{REDIRECT}/?code=v3.synthetic"),
        ] {
            assert!(
                access_code(Some(&location), REDIRECT).is_none(),
                "{location}"
            );
        }
        assert!(access_code(None, REDIRECT).is_none());
    }

    #[test]
    fn reads_only_the_access_token() {
        let token = access_token(json!({
            "access_token": "synthetic-access",
            "refresh_token": "synthetic-refresh",
            "id_token": "synthetic-id",
            "expires_in": 3599,
        }))
        .unwrap();
        assert_eq!(token.expose(), "synthetic-access");
        assert_eq!(format!("{token:?}"), "<redacted>");
        let without_lifetime = access_token(json!({"access_token": "synthetic-access"}));
        assert!(without_lifetime.is_some());
    }

    #[test]
    fn no_token_without_a_usable_access_token() {
        for body in [
            json!({}),
            json!({"access_token": ""}),
            json!({"access_token": 5}),
            json!({"access_token": null}),
            json!({"access_token": "synthetic-access", "expires_in": "3599"}),
            json!({"access_token": "synthetic-access", "expires_in": null}),
            json!(["synthetic-access"]),
            json!("synthetic-access"),
            json!(null),
        ] {
            assert!(access_token(body.clone()).is_none(), "{body}");
        }
    }
}
