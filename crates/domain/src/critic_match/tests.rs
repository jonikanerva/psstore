use super::*;
use crate::js::{parse_date_ms, utc_full_year};

fn score(value: u8) -> Option<CriticScore> {
    CriticScore::new(value)
}

fn candidate() -> CriticCandidate {
    CriticCandidate {
        name: "Synthetic Quest".into(),
        release_year: Some(2023),
        rating: score(84),
        rating_count: 12,
    }
}

fn named(name: &str) -> CriticCandidate {
    CriticCandidate {
        name: name.into(),
        ..candidate()
    }
}

// ---------------------------------------------------------------------------
// The cases of `server/src/__tests__/criticMatch.test.ts`.
// ---------------------------------------------------------------------------

#[test]
fn normalize_drops_marks_case_punctuation_and_accents() {
    assert_eq!(
        normalize_title("  Pokémon™: The Game®  "),
        "pokemon the game"
    );
    assert_eq!(normalize_title("Marvel's Spider-Man"), "marvels spider man");
}

#[test]
fn normalize_strips_a_closed_list_of_edition_suffixes() {
    assert_eq!(
        normalize_title("Synthetic Quest - PS5 Edition"),
        "synthetic quest"
    );
    assert_eq!(
        normalize_title("Synthetic Quest Digital Deluxe Edition"),
        "synthetic quest"
    );
    assert_eq!(
        normalize_title("Synthetic Quest (PS4 & PS5)"),
        "synthetic quest"
    );
    assert_eq!(
        normalize_title("Synthetic Quest Collector's Edition"),
        "synthetic quest"
    );
}

#[test]
fn normalize_keeps_a_remaster_or_a_cut_as_a_different_title() {
    assert_eq!(
        normalize_title("Synthetic Quest Remastered"),
        "synthetic quest remastered"
    );
    assert_eq!(
        normalize_title("Synthetic Quest Director's Cut"),
        "synthetic quest directors cut"
    );
}

#[test]
fn normalize_keeps_a_title_that_is_only_a_suffix() {
    assert_eq!(normalize_title("Standard Edition"), "standard edition");
}

/// The year is the calendar year of the instant in UTC, not the year in
/// the offset of the text.
#[test]
fn release_year_reads_the_utc_year() {
    assert_eq!(release_year_of("2023-12-31T23:30:00Z"), Some(2023));
    assert_eq!(release_year_of("2024-01-01T00:30:00Z"), Some(2024));
    assert_eq!(release_year_of("2024-01-01T00:30:00+01:00"), Some(2023));
    assert_eq!(release_year_of("2023-12-31T23:30:00-01:00"), Some(2024));
    assert_eq!(release_year_of("2023-12-31T21:00:00-03:00"), Some(2024));
    assert_eq!(release_year_of("2024-01-01T02:00:00+02:00"), Some(2024));
}

#[test]
fn release_year_is_none_for_an_empty_or_invalid_date() {
    assert_eq!(release_year_of(""), None);
    assert_eq!(release_year_of("not a date"), None);
}

#[test]
fn accepts_an_equal_name_in_the_same_year() {
    assert_eq!(
        match_critic_score("Synthetic Quest PS5 Edition", 2023, &[candidate()]),
        score(84)
    );
}

#[test]
fn accepts_a_release_year_one_apart_and_refuses_two_apart() {
    assert_eq!(
        match_critic_score("Synthetic Quest", 2024, &[candidate()]),
        score(84)
    );
    assert_eq!(
        match_critic_score("Synthetic Quest", 2025, &[candidate()]),
        None
    );
}

#[test]
fn refuses_a_remaster_with_a_different_name() {
    let remaster = CriticCandidate {
        release_year: Some(2025),
        ..named("Synthetic Quest Remastered")
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[remaster]),
        None
    );
}

#[test]
fn refuses_an_ambiguous_result() {
    let other_year = CriticCandidate {
        release_year: Some(2024),
        rating: score(60),
        ..candidate()
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[candidate(), other_year]),
        None
    );
}

#[test]
fn ignores_candidates_that_do_not_match_while_one_does() {
    let other = CriticCandidate {
        rating: score(10),
        ..named("Other Game")
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[other, candidate()]),
        score(84)
    );
}

#[test]
fn ignores_an_unrated_edition_entry_next_to_a_rated_base_entry() {
    let edition = CriticCandidate {
        rating: None,
        rating_count: 0,
        ..named("Synthetic Quest Deluxe Edition")
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[candidate(), edition]),
        score(84)
    );
}

#[test]
fn ignores_an_edition_entry_with_too_few_reviews_next_to_a_rated_base_entry() {
    let edition = CriticCandidate {
        release_year: Some(2024),
        rating: score(94),
        rating_count: MIN_CRITIC_COUNT - 1,
        ..named("Synthetic Quest Complete Edition")
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[candidate(), edition]),
        score(84)
    );
}

#[test]
fn refuses_two_qualified_candidates_with_the_same_name() {
    let edition = CriticCandidate {
        rating: score(94),
        ..named("Synthetic Quest Complete Edition")
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[candidate(), edition]),
        None
    );
}

#[test]
fn refuses_when_every_same_name_candidate_is_unrated() {
    let base = CriticCandidate {
        rating: None,
        rating_count: 0,
        ..candidate()
    };
    let edition = CriticCandidate {
        rating: None,
        ..named("Synthetic Quest Deluxe Edition")
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[base, edition]),
        None
    );
}

#[test]
fn refuses_a_score_with_too_few_critic_reviews() {
    let few = CriticCandidate {
        rating_count: MIN_CRITIC_COUNT - 1,
        ..candidate()
    };
    assert_eq!(match_critic_score("Synthetic Quest", 2023, &[few]), None);
    let enough = CriticCandidate {
        rating_count: MIN_CRITIC_COUNT,
        ..candidate()
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[enough]),
        score(84)
    );
}

#[test]
fn refuses_a_candidate_without_a_rating_or_a_release_year() {
    let unrated = CriticCandidate {
        rating: None,
        ..candidate()
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[unrated]),
        None
    );
    let without_year = CriticCandidate {
        release_year: None,
        ..candidate()
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[without_year]),
        None
    );
}

#[test]
fn refuses_an_empty_candidate_list_and_an_empty_title() {
    assert_eq!(match_critic_score("Synthetic Quest", 2023, &[]), None);
    assert_eq!(match_critic_score("™®", 2023, &[named("")]), None);
}

// ---------------------------------------------------------------------------
// Challenge cases beyond the TypeScript tests.
// ---------------------------------------------------------------------------

#[test]
fn accepts_a_score_of_zero() {
    let zero = CriticCandidate {
        rating: score(0),
        ..candidate()
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", 2023, &[zero]),
        score(0)
    );
}

#[test]
fn refuses_a_release_year_two_before() {
    assert_eq!(
        match_critic_score("Synthetic Quest", 2021, &[candidate()]),
        None
    );
    assert_eq!(
        match_critic_score("Synthetic Quest", 2022, &[candidate()]),
        score(84)
    );
}

#[test]
fn year_distance_does_not_overflow() {
    let far = CriticCandidate {
        release_year: Some(i32::MIN),
        ..candidate()
    };
    assert_eq!(
        match_critic_score("Synthetic Quest", i32::MAX, &[far]),
        None
    );
}

#[test]
fn matches_when_both_sides_carry_different_edition_suffixes() {
    let deluxe = named("Synthetic Quest: Deluxe Edition");
    assert_eq!(
        match_critic_score("Synthetic Quest™ PS4 & PS5", 2023, &[deluxe]),
        score(84)
    );
}

#[test]
fn matches_accented_and_unaccented_names() {
    assert_eq!(
        match_critic_score("Pokémon™ Quest", 2023, &[named("Pokemon Quest")]),
        score(84)
    );
}

#[test]
fn an_edition_suffix_must_be_a_whole_word() {
    // "Ps5Edition" is one word, so no suffix ends the title.
    assert_eq!(normalize_title("Game Ps5Edition"), "game ps5edition");
    assert_eq!(
        match_critic_score("Game Ps5Edition", 2023, &[named("Game")]),
        None
    );
}

/// Expected values from Node 24.21.0 (ICU 78.3, Unicode 17.0) running
/// `normalizeTitle` of `server/src/domain/criticMatch.ts`. Each pair is
/// `[input, output]`.
#[test]
fn normalize_matches_the_typescript_output() {
    let cases = [
        ("Marvel’s Spider-Man 2", "marvels spider man 2"),
        ("ＦＩＮＡＬ ＦＡＮＴＡＳＹ Ⅶ", "final fantasy vii"),
        ("Ⓐstro Ⓑot", "astro bot"),
        // U+1F170 is a symbol without a decomposition, so it separates.
        ("🅰stro 🄰ot", "stro aot"),
        ("ΣΑΣ Quest", "σας quest"),
        ("ΟΔΥΣΣΕΥΣ", "οδυσσευς"),
        ("İstanbul Nights", "istanbul nights"),
        ("Ōkami HD", "okami hd"),
        (
            "Tom Clancy’s The Division® 2 – Gold Edition",
            "tom clancys the division 2",
        ),
        ("Fish & Chips (PS4 & PS5)", "fish and chips"),
        ("Ｒ＆Ｄ", "r and d"),
        ("Game™ Deluxe Edition PS5 Edition", "game"),
        (
            "Synthetic Quest - Game of the Year Edition",
            "synthetic quest",
        ),
        ("PS5", "ps5"),
        ("Quest PS5", "quest"),
        ("Quest  -  PS5", "quest"),
        ("Nier:Automata", "nier automata"),
        ("Hello_World", "hello world"),
        ("ﬁnal ﬂight", "final flight"),
        ("Kingdom Hearts ½", "kingdom hearts 1 2"),
        ("x²", "x2"),
        // Marks outside U+0300 to U+036F are not letters, so they separate.
        ("देवनागरी खेल", "द वन गर ख ल"),
        ("שָׁלוֹם", "ש לו ם"),
        ("ゲームガ", "ケ ームカ"),
        ("Cafe\u{0301}", "cafe"),
        ("e\u{20D7}x", "e x"),
        ("Game\u{200D}Title", "game title"),
        ("\u{FEFF}Game\u{00A0}Title\u{3000}", "game title"),
        ("ǅungla", "dzungla"),
        ("Ⅻ Chapters", "xii chapters"),
        ("＃１ Racer", "1 racer"),
        ("Straße", "straße"),
        ("ǈ", "lj"),
        ("EA SPORTS FC™ 25", "ea sports fc 25"),
        ("Edition", "edition"),
        ("Deluxe Edition Deluxe Edition", "deluxe edition"),
        ("tm™tm", "tmtm"),
        ("©®™", ""),
        ("'’", ""),
        ("Ⓟⓢ５", "ps5"),
        ("Ǳ", "dz"),
        ("ﬀ", "ff"),
        ("㎏", "kg"),
        ("™Game", "game"),
        ("A\u{0345}B", "ab"),
        ("Ⰰ", "ⰰ"),
        ("ꙮ", "ꙮ"),
        ("𝔊𝔞𝔪𝔢", "game"),
        ("𝟙𝟚𝟛", "123"),
        ("ℌello", "hello"),
        // U+2776 is an "other number" (No), so it stays.
        ("❶ Shot", "❶ shot"),
        ("⑳", "20"),
    ];
    for (input, expected) in cases {
        assert_eq!(normalize_title(input), expected, "input {input:?}");
    }
}

/// One input table for both callers of the date parser: the year that
/// `js::parse_date_ms` gives to the Sony mapper and the listings, and the
/// year of `release_year_of` (issue #159).
///
/// Each row has the input, the year of Node 24.21.0 with `TZ=UTC`
/// (`new Date(Date.parse(s)).getUTCFullYear()`, `None` for `NaN`), and the
/// year of this server. The two years differ only in the rows that the
/// comments mark as deliberate differences (`js::parse_date_ms` documents
/// them).
const YEAR_CASES: [(&str, Option<i32>, Option<i32>); 84] = [
    // The forms that Sony sends, and the normalised form with
    // milliseconds.
    ("2023-11-14T00:00:00Z", Some(2023), Some(2023)),
    ("2023-11-14T00:00:00.000Z", Some(2023), Some(2023)),
    ("2023-12-31T21:00:00Z", Some(2023), Some(2023)),
    ("2024-01-01T00:00:00.000Z", Some(2024), Some(2024)),
    ("", None, None),
    // The UTC year of the instant.
    ("2024-01-01T00:30:00+01:00", Some(2023), Some(2023)),
    ("2023-12-31T23:30:00-01:00", Some(2024), Some(2024)),
    // The ECMAScript date time string format and the V8 leniencies.
    ("2023", Some(2023), Some(2023)),
    ("2023-11", Some(2023), Some(2023)),
    ("2023-11-14", Some(2023), Some(2023)),
    ("2023Z", Some(2023), Some(2023)),
    ("2023-11Z", Some(2023), Some(2023)),
    ("2023-11-14Z", Some(2023), Some(2023)),
    ("2023-02-30", Some(2023), Some(2023)),
    ("2024-02-30T00:00:00Z", Some(2024), Some(2024)),
    ("2023-04-31T00:00:00Z", Some(2023), Some(2023)),
    ("2023-11-14T24:00:00Z", Some(2023), Some(2023)),
    ("2023-12-31T24:00:00Z", Some(2024), Some(2024)),
    ("2023-12-31T24:00Z", Some(2024), Some(2024)),
    ("2023-11-14T24:00:00.000Z", Some(2023), Some(2023)),
    ("+002023-11-14T00:00:00Z", Some(2023), Some(2023)),
    ("-000001-01-01T00:00:00Z", Some(-1), Some(-1)),
    ("-002023-11-14T00:00:00Z", Some(-2023), Some(-2023)),
    ("0000-01-01T00:00:00Z", Some(0), Some(0)),
    ("0099-06-01T00:00:00Z", Some(99), Some(99)),
    ("2023-11-14T00:00Z", Some(2023), Some(2023)),
    ("2023-11-14T12:30+01:00", Some(2023), Some(2023)),
    ("2023-11-14T00:00:00.1Z", Some(2023), Some(2023)),
    ("2023-12-31T23:59:59.9999Z", Some(2023), Some(2023)),
    ("2023-11-14t00:00:00z", Some(2023), Some(2023)),
    ("2023-11-14 00:00:00Z", Some(2023), Some(2023)),
    ("2023-11-14T00:00:00+0100", Some(2023), Some(2023)),
    ("2023-12-31T23:00:00-23:59", Some(2024), Some(2024)),
    ("2023-11-14T00:00:00-00:00", Some(2023), Some(2023)),
    ("9999-12-30T22:00:00Z", Some(9999), Some(9999)),
    ("-009999-01-02T01:59:59Z", Some(-9999), Some(-9999)),
    ("-009999-01-05T00:00:00Z", Some(-9999), Some(-9999)),
    // Invalid inputs.
    ("not a date", None, None),
    ("soon", None, None),
    ("2023-13-01", None, None),
    ("2023-00-14T00:00:00Z", None, None),
    ("2023-11-00T00:00:00Z", None, None),
    ("2023-11-32T00:00:00Z", None, None),
    ("2023-11-14T24:00:00.001Z", None, None),
    ("2023-11-14T24:00:01Z", None, None),
    ("2023-11-14T25:00:00Z", None, None),
    ("2023-11-14T23:60:00Z", None, None),
    ("2023-11-14T23:59:60Z", None, None),
    ("-000000-01-01T00:00:00Z", None, None),
    ("+2023-11-14T00:00:00Z", None, None),
    ("2023-11-14T00:00:00+01", None, None),
    ("2023-11-14T00:00:00+24:00", None, None),
    ("2023-11-14T00:00:00+23:60", None, None),
    ("2023-11-14T00:00:00+01:00:00", None, None),
    ("2023-11-14T00:00:00+1:00", None, None),
    ("2023-11-14T00:00:00 Z", None, None),
    ("2023-11-14T00:00:00GMT", None, None),
    ("2023-11-14T00:00:00,000Z", None, None),
    ("2023-11-14T00:00:00.Z", None, None),
    ("2023-11-14T00Z", None, None),
    ("2023-11-14TZ", None, None),
    ("2023-1-14T00:00:00Z", None, None),
    ("02023-11-14T00:00:00Z", None, None),
    (" 2023-11-14T00:00:00Z", None, None),
    ("2023-11-14T00:00:00Z ", None, None),
    ("１９９９-01-01T00:00:00Z", None, None),
    ("10000-01-01T00:00:00Z", None, None),
    // A date and time without an offset. V8 reads local time; the
    // server reads UTC, the time zone of the production host. Node runs
    // with `TZ=UTC` here, so the years agree. Before #159,
    // `release_year_of` gave `None` for these.
    ("2023-11-14T00:00:00", Some(2023), Some(2023)),
    ("2023-11-14T00:00", Some(2023), Some(2023)),
    ("2023-11-14T00:00:00.000", Some(2023), Some(2023)),
    ("2023-12-31T23:30:00", Some(2023), Some(2023)),
    // Deliberate difference (owner decision on #159): a date with an
    // offset but without a time. V8 gives `NaN`.
    ("2024-01-08+02:00", None, Some(2024)),
    // Deliberate difference (owner decision on #159): V8 reads a year
    // from 0 to 99 in its legacy forms as 1950 to 2049.
    ("0000-12-06Z", Some(2000), Some(0)),
    ("0099-12-06Z", Some(1999), Some(99)),
    ("0000-01-01 12:00:00Z", Some(2000), Some(0)),
    // Not ported: the legacy forms of V8.
    ("Nov 14 2023", Some(2023), None),
    ("2023/11/14", Some(2023), None),
    ("2023-11-1", Some(2023), None),
    // Not ported: instants outside the jiff range.
    ("+275760-09-13T00:00:00.000Z", Some(275_760), None),
    ("+012023-11-14T00:00:00Z", Some(12023), None),
    ("-010000-01-01T00:00:00Z", Some(-10000), None),
    ("9999-12-31T23:59:59.999Z", Some(9999), None),
    ("9999-12-30T22:00:01Z", Some(9999), None),
    ("-009999-01-01T00:00:00Z", Some(-9999), None),
];

/// The rows of `YEAR_CASES` where the server and Node differ. Each one is
/// a documented difference.
const NODE_DIFFERENCES: [&str; 13] = [
    "2024-01-08+02:00",
    "0000-12-06Z",
    "0099-12-06Z",
    "0000-01-01 12:00:00Z",
    "Nov 14 2023",
    "2023/11/14",
    "2023-11-1",
    "+275760-09-13T00:00:00.000Z",
    "+012023-11-14T00:00:00Z",
    "-010000-01-01T00:00:00Z",
    "9999-12-31T23:59:59.999Z",
    "9999-12-30T22:00:01Z",
    "-009999-01-01T00:00:00Z",
];

/// Runs both callers of the date parser on `YEAR_CASES` (issue #159).
#[test]
fn both_callers_read_one_year_from_each_date() {
    for (input, node, expected) in YEAR_CASES {
        let parsed_year = parse_date_ms(input).and_then(utc_full_year);
        assert_eq!(parsed_year, expected, "parse_date_ms, input {input:?}");
        assert_eq!(
            release_year_of(input),
            expected,
            "release_year_of, input {input:?}"
        );
        assert_eq!(
            node != expected,
            NODE_DIFFERENCES.contains(&input),
            "difference from Node, input {input:?}"
        );
    }
}
