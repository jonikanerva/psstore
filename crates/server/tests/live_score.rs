//! The SCORE live checks: the critic score through the production IGDB client
//! and critic score service.
//!
//! - The NEW sample is the one of the TypeScript server's SCORE check: the
//!   first 10 games of one NEW grid page of 60, each with the release date of
//!   its product detail. Its hit count is the hit-rate measurement, so it
//!   compares with the TypeScript count of the same moment. It asserts
//!   nothing: new releases often have no critic score yet (0 of 10 for both
//!   servers on 2026-10-13).
//! - The control titles are public PS5 games with critic scores. At least one
//!   must get a score, so a broken credential, request, or match fails.
//!
//! The check needs network access and the owner's `IGDB_CLIENT_ID` and
//! `IGDB_CLIENT_SECRET` in the process environment. Run it with
//! `pnpm test:live`. It prints the hit count and the scores only, never a
//! credential. Without the credentials it prints that it skipped and passes,
//! like the skipped SCORE suite of the TypeScript server.

use std::sync::Arc;

use psstore_server::application::CriticScores;
use psstore_server::application::critic_scores::CriticScoreService;
use psstore_server::application::games::SonyCatalog;
use psstore_server::config::Config;
use psstore_server::domain::catalog::SonyFeature;
use psstore_server::domain::game::{CriticScore, Game, IdKind};
use psstore_server::domain::listing::map_concepts_to_games;
use psstore_server::sources::igdb::IgdbClient;
use psstore_server::sources::sony::catalog::{
    CategoryGridOutcome, GridQuery, SonyCatalogClient, extract_category_grid,
};
use psstore_server::sources::sony::contract::SonyContract;

/// The games of the sample: 10 Sony detail calls, then at most 10 sequential
/// provider calls.
const SCORE_SAMPLE: usize = 10;

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

#[expect(clippy::unwrap_used, reason = "the synthetic id is not empty")]
fn game(index: usize, name: &str, date: &str) -> Game {
    Game {
        id: format!("LIVE-SCORE-{index}").parse().unwrap(),
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
async fn score_control_titles_get_at_least_one_critic_score() {
    let Some(credentials) = Config::from_env().igdb else {
        println!("[test:live] SCORE skipped: IGDB credentials missing");
        return;
    };
    let client = IgdbClient::new(credentials).expect("the HTTP client builds");
    let critics = CriticScoreService::new(Arc::new(client));
    let mut scores = Vec::new();
    for (index, (name, date)) in TITLES.into_iter().enumerate() {
        let score = critics.score_for(&game(index, name, date)).await;
        scores.push(score.map(CriticScore::value));
    }
    let hits = scores.iter().filter(|score| score.is_some()).count();
    println!(
        "[test:live] SCORE control hits={hits}/{} scores={}",
        TITLES.len(),
        serde_json::to_string(&scores).expect("scores serialize")
    );
    assert!(hits > 0, "no control title got a critic score");
}

#[tokio::test]
#[ignore = "live: needs network access and the owner's IGDB credentials"]
async fn score_hit_rate_of_a_sample_of_new_games() {
    let Some(credentials) = Config::from_env().igdb else {
        println!("[test:live] SCORE skipped: IGDB credentials missing");
        return;
    };
    let sony = SonyCatalogClient::new(&SonyContract::load().unwrap()).unwrap();
    let json = sony
        .category_grid_json(&GridQuery::Feature {
            feature: SonyFeature::New,
            size: 60,
            offset: 0,
        })
        .await
        .unwrap();
    let CategoryGridOutcome::Ok { concepts, .. } = extract_category_grid(&json) else {
        panic!("the NEW grid drifted");
    };
    // The pre-order flag does not change the match, so the instant is 0.
    let sample: Vec<_> = map_concepts_to_games(&concepts, 0)
        .into_iter()
        .take(SCORE_SAMPLE)
        .collect();

    let client = IgdbClient::new(credentials).expect("the HTTP client builds");
    let critics = CriticScoreService::new(Arc::new(client));
    let mut scores = Vec::new();
    for mut game in sample {
        let detail = sony
            .product_detail(game.id.product_id().unwrap())
            .await
            .unwrap();
        game.date = detail.release_date.unwrap_or_default();
        scores.push(critics.score_for(&game).await.map(CriticScore::value));
    }
    let hits = scores.iter().filter(|score| score.is_some()).count();
    println!(
        "[test:live] SCORE new hits={hits}/{} scores={}",
        scores.len(),
        serde_json::to_string(&scores).expect("scores serialize")
    );
}
