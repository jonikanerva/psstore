//! BROWSE: the order keys of the API and the Sony genre key format.

/// One order of the BROWSE view. These keys are the API values. The Sony
/// client maps each key to Sony's sort; Sony's sort names never reach the API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BrowseOrder {
    BestSelling,
    MostDownloaded,
    Newest,
    Oldest,
    NameAsc,
    NameDesc,
}

impl BrowseOrder {
    pub const ALL: [Self; 6] = [
        Self::BestSelling,
        Self::MostDownloaded,
        Self::Newest,
        Self::Oldest,
        Self::NameAsc,
        Self::NameDesc,
    ];

    /// The API key of the order.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BestSelling => "best-selling",
            Self::MostDownloaded => "most-downloaded",
            Self::Newest => "newest",
            Self::Oldest => "oldest",
            Self::NameAsc => "name-asc",
            Self::NameDesc => "name-desc",
        }
    }

    /// Parses an API key. Returns `None` for any other value.
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|order| order.as_str() == value)
    }
}

/// A Sony genre facet key, for example `ROLE_PLAYING_GAMES` or `MUSIC/RHYTHM`:
/// 1 to 64 characters from `A`–`Z`, `0`–`9`, `_`, `/`, and `-`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GenreKey(String);

impl GenreKey {
    /// Returns `None` when the value does not have the key format.
    pub fn parse(value: &str) -> Option<Self> {
        is_genre_key(value).then(|| Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// True when the value has the Sony genre key format.
pub fn is_genre_key(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value.bytes().all(|b| {
            b.is_ascii_uppercase() || b.is_ascii_digit() || matches!(b, b'_' | b'/' | b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_order_key_and_rejects_others() {
        for order in BrowseOrder::ALL {
            assert_eq!(BrowseOrder::parse(order.as_str()), Some(order));
        }
        assert_eq!(BrowseOrder::parse("bad"), None);
        assert_eq!(BrowseOrder::parse("Newest"), None);
        assert_eq!(BrowseOrder::parse(""), None);
    }

    #[test]
    fn accepts_sony_genre_keys_only() {
        assert!(is_genre_key("ACTION"));
        assert!(is_genre_key("MUSIC/RHYTHM"));
        assert!(is_genre_key("ROLE_PLAYING_GAMES"));
        assert!(is_genre_key("A-1"));
        assert!(is_genre_key(&"A".repeat(64)));
        assert!(!is_genre_key(&"A".repeat(65)));
        assert!(!is_genre_key(""));
        assert!(!is_genre_key("action"));
        assert!(!is_genre_key("ACTION GAMES"));
        assert!(!is_genre_key("ÄCTION"));
    }
}
