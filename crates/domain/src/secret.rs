//! A credential value that cannot reach a log, a response, or a cache key by
//! accident.

use std::fmt;

/// A credential: the NPSSO, a Sony access token, or the IGDB client secret.
///
/// The type has no `Display` and no `Serialize` implementation, and its
/// `Debug` output is `<redacted>`. Read the value with [`Secret::expose`] only
/// where it goes into an outbound request or into the sign-in cookie.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The raw value. Call it only at an outbound request or the cookie.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_hides_the_value() {
        let secret = Secret::new("synthetic-npsso-value");
        assert_eq!(format!("{secret:?}"), "<redacted>");
        assert_eq!(format!("{:?}", Some(&secret)), "Some(<redacted>)");
        assert_eq!(secret.expose(), "synthetic-npsso-value");
    }
}
