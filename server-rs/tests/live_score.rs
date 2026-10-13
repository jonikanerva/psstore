//! The SCORE live check: the critic score of fixed public PS5 titles through
//! the production IGDB client and critic score service.
//!
//! The check needs network access and the owner's `IGDB_CLIENT_ID` and
//! `IGDB_CLIENT_SECRET` in the process environment. Run it with
//! `cargo test --test live_score -- --ignored --nocapture`. It prints the hit
//! count and the scores only, never a credential. Without the credentials it
//! prints that it skipped and passes, like the skipped SCORE suite of the
//! TypeScript server.
//!
//! The TypeScript check samples 10 live NEW games from Sony. This check uses
//! a fixed list of public titles and release dates instead, so it does not
//! depend on the Sony adapter. Its hit count is not comparable with the
//! TypeScript count.

use std::sync::Arc;

use psstore_server::application::CriticScores;
use psstore_server::application::critic_scores::CriticScoreService;
use psstore_server::config::Config;
use psstore_server::domain::game::{Game, IdKind};
use psstore_server::sources::igdb::IgdbClient;

/// Public PS5 titles in the form of the Sony store, with their public release
/// dates as UTC instants (the form of `Game.date`).
const TITLES: [(&str, &str); 10] = [
    ("Astro Bot", "2024-09-06T00:00:00Z"),
    ("Marvel's Spider-Man 2", "2023-10-20T00:00:00Z"),
    ("Ratchet & Clank: Rift Apart", "2021-06-11T00:00:00Z"),
    ("Demon's Souls", "2020-11-12T00:00:00Z"),
    ("Returnal™", "2021-04-30T00:00:00Z"),
    ("God of War Ragnarök", "2022-11-09T00:00:00Z"),
    ("Horizon Forbidden West™", "2022-02-18T00:00:00Z"),
    ("FINAL FANTASY XVI", "2023-06-22T00:00:00Z"),
    ("ELDEN RING", "2022-02-25T00:00:00Z"),
    ("Stellar Blade™", "2024-04-26T00:00:00Z"),
];

fn game(index: usize, name: &str, date: &str) -> Game {
    Game {
        id: format!("LIVE-SCORE-{index}"),
        name: name.into(),
        date: date.into(),
        url: String::new(),
        price: String::new(),
        original_price: String::new(),
        discount_text: String::new(),
        discount_date: String::new(),
        screenshots: vec![],
        videos: vec![],
        genres: vec![],
        description: String::new(),
        studio: String::new(),
        pre_order: false,
        plus_upsell_text: None,
        plus_offer: None,
        id_kind: IdKind::Product,
    }
}

#[tokio::test]
#[ignore = "live: needs network access and the owner's IGDB credentials"]
async fn score_public_titles_get_at_least_one_critic_score() {
    let Some(credentials) = Config::from_env().igdb else {
        println!("[test:live] SCORE skipped: IGDB credentials missing");
        return;
    };
    let client = IgdbClient::new(credentials).expect("the HTTP client builds");
    let critics = CriticScoreService::new(Arc::new(client));
    let mut scores = Vec::new();
    for (index, (name, date)) in TITLES.into_iter().enumerate() {
        let score = critics.score_for(&game(index, name, date)).await;
        scores.push(score.map(|s| s.value()));
    }
    let hits = scores.iter().filter(|score| score.is_some()).count();
    println!(
        "[test:live] SCORE hits={hits}/{} scores={}",
        TITLES.len(),
        serde_json::to_string(&scores).expect("scores serialize")
    );
    assert!(hits > 0, "no title got a critic score");
}
