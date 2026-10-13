//! The deterministic server of the browser journeys (`e2e/`).
//!
//! ```text
//! e2e_server --port <port> --web-build <dir> [--scenario healthy|outage]
//! ```
//!
//! The server mounts the real router, the real middleware, and the built
//! client (`psstore_server::http::app`) over fake store, critic score, and
//! account services. The fakes answer from synthetic data. The server calls
//! no network service, reads no credential, and reads no environment
//! variable. It listens on `127.0.0.1` only.
//!
//! - `healthy` (the default): every view has data. A game id that no fake
//!   game has, for example `EP9000-PPSA99999_00-E2ESYNTHETIC9999`, answers
//!   404. The sign-in accepts only [`SYNTHETIC_NPSSO`].
//! - `outage`: every store lookup fails like an upstream outage (HTTP 502 or
//!   503). The sign-in check fails with 502; a request that already has the
//!   synthetic cookie gets a 502 on both signed-in lists.
//!
//! The release dates are relative to the start of the server: NEW games are
//! at least two days old and UPCOMING games at least two days ahead, so the
//! client puts each game in its list in every time zone.
//!
//! The image and video URLs use the real Sony hosts. The journeys answer
//! them with local files, so the browser applies the Content-Security-Policy
//! to the real host names without network access.

#![expect(
    clippy::print_stderr,
    reason = "a command-line tool reports a usage error before logging starts"
)]

use std::collections::HashSet;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use jiff::Timestamp;
use psstore_server::application::{AccountApi, CriticScores, GamesApi, Page, ServiceFuture};
use psstore_server::config::BuildInfo;
use psstore_server::domain::browse::{BrowseOrder, GenreKey};
use psstore_server::domain::errors::{AccountError, GameLookupError, UpstreamError};
use psstore_server::domain::game::{
    CriticScore, Game, Genre, GenreList, IdKind, PageResult, PlusOffer,
};
use psstore_server::domain::id::GameId;
use psstore_server::domain::listing::paginate;
use psstore_server::domain::secret::Secret;
use psstore_server::http::static_files::{StaticSite, index_exists};
use psstore_server::http::{self, AppState};
use psstore_server::lifecycle;
use psstore_server::observability::{self, LogFormat};

/// The only NPSSO that the fake account accepts. It is synthetic: 32
/// characters, so it is no real NPSSO (64 characters) and the secret scan
/// rule `sony-npsso` does not match it.
const SYNTHETIC_NPSSO: &str = "e2e-synthetic-npsso-000000000000";
/// The image host of Sony's store data.
const IMAGE_BASE: &str = "https://image.api.playstation.com/vulcan/ap/rnd/e2e";
/// The video host of Sony's store data.
const VIDEO_BASE: &str = "https://vulcan.dl.playstation.net/img/rnd/e2e";
/// The longest page of a fake search answer. Sony also answers short pages.
const SEARCH_PAGE_LIMIT: usize = 50;
/// The number of games in the large BROWSE genre: more than one client page
/// (60), so BROWSE loads a second page.
const ACTION_GAMES: u32 = 70;
/// The grace period after a stop signal.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);
const DAY_SECONDS: i64 = 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scenario {
    Healthy,
    Outage,
}

#[derive(Debug)]
struct Options {
    port: u16,
    web_build: PathBuf,
    scenario: Scenario,
}

impl Options {
    fn parse(args: &[String]) -> Option<Self> {
        let mut port = None;
        let mut web_build = None;
        let mut scenario = Scenario::Healthy;
        let mut rest = args.iter();
        while let Some(flag) = rest.next() {
            let value = rest.next()?;
            match flag.as_str() {
                "--port" => port = value.parse::<u16>().ok().filter(|p| *p != 0),
                "--web-build" => web_build = Some(PathBuf::from(value)),
                "--scenario" => {
                    scenario = match value.as_str() {
                        "healthy" => Scenario::Healthy,
                        "outage" => Scenario::Outage,
                        _ => return None,
                    };
                }
                _ => return None,
            }
        }
        Some(Self {
            port: port?,
            web_build: web_build?,
            scenario,
        })
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(options) = Options::parse(&args) else {
        eprintln!("usage: e2e_server --port <port> --web-build <dir> [--scenario healthy|outage]");
        return ExitCode::from(2);
    };
    if !index_exists(&options.web_build) {
        eprintln!("e2e_server: the client build has no index.html; run the web build first");
        return ExitCode::FAILURE;
    }
    let Some(catalog) = Catalog::new(Timestamp::now()) else {
        eprintln!("e2e_server: the synthetic catalogue has an invalid id");
        return ExitCode::FAILURE;
    };
    if observability::init(LogFormat::Text).is_err() {
        eprintln!("e2e_server: logging could not be set up");
        return ExitCode::FAILURE;
    }
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return ExitCode::FAILURE;
    };
    let served = runtime.block_on(serve(options, catalog));
    runtime.shutdown_background();
    if served.is_ok() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

async fn serve(options: Options, catalog: Catalog) -> std::io::Result<()> {
    let catalog = Arc::new(catalog);
    let state = AppState {
        games: Arc::new(FakeGames {
            catalog: Arc::clone(&catalog),
            scenario: options.scenario,
        }),
        critics: Arc::new(FakeScores),
        account: Arc::new(FakeAccount {
            catalog,
            scenario: options.scenario,
        }),
        site: Arc::new(StaticSite::new(options.web_build)),
        build: Arc::new(BuildInfo::default()),
    };
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, options.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(bind = %address, "e2e server started");
    lifecycle::serve(
        listener,
        http::app(state),
        lifecycle::shutdown_signal(),
        SHUTDOWN_GRACE,
    )
    .await
    .map(|_stopped| ())
}

// ---- Synthetic data ---------------------------------------------------------

/// The synthetic store. Every name and id is invented for the journeys.
#[derive(Debug)]
struct Catalog {
    new: Vec<Game>,
    upcoming: Vec<Game>,
    discounted: Vec<Game>,
    monthly: Vec<Game>,
    /// The BROWSE genres with their games in the store order.
    genres: Vec<(Genre, Vec<Game>)>,
    wishlist: Vec<Game>,
    purchased: Vec<Game>,
}

/// The product id of synthetic game `n` (1 to 9999), for example
/// `EP9000-PPSA90001_00-E2ESYNTHETIC0001`. No fake game has number 9999.
fn product_id(n: u32) -> String {
    format!("EP9000-PPSA9{n:04}_00-E2ESYNTHETIC{n:04}")
}

/// One synthetic card with the cover of its name, released `days` from
/// `now`.
fn card(id: &str, name: &str, now: Timestamp, days: i64, price: &str) -> Option<Game> {
    let date = Timestamp::from_second(now.as_second() + days * DAY_SECONDS).ok()?;
    Some(Game {
        id: GameId::from_path(id)?,
        name: name.to_owned(),
        date: date.to_string(),
        url: format!("{IMAGE_BASE}/{}-cover.png", slug(name)),
        price: price.to_owned(),
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
    })
}

/// A concept card: an announced game without a product id or a price.
fn concept(id: &str, name: &str, now: Timestamp, days: i64) -> Option<Game> {
    Some(Game {
        id_kind: IdKind::Concept,
        ..card(id, name, now, days, "")?
    })
}

/// The file name part of a name: lower case, with `-` for other characters.
fn slug(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

/// The game page data of a game: description, genres, studio, and media.
/// The description uses the tags of Sony's descriptions.
fn with_details(game: Game, genres: &[&str], media: bool) -> Game {
    let slug = slug(&game.name);
    let description = format!(
        "<p>{} is a synthetic game of the browser journeys.</p><br><b>Features:</b><br>- One <i>local</i> mode<br>- A <a href=\"https://www.playstation.com/\">PlayStation</a> link",
        game.name
    );
    let (screenshots, videos) = if media {
        (
            vec![
                format!("{IMAGE_BASE}/{slug}-shot-1.jpg"),
                format!("{IMAGE_BASE}/{slug}-shot-2.jpg"),
            ],
            vec![format!("{VIDEO_BASE}/{slug}-trailer.mp4")],
        )
    } else {
        (vec![], vec![])
    };
    Game {
        description,
        genres: genres.iter().map(|g| (*g).to_owned()).collect(),
        studio: "Synthetic Studio".to_owned(),
        screenshots,
        videos,
        ..game
    }
}

/// The large BROWSE genre: games 1001 to 1070, newest first.
fn action_games(now: Timestamp) -> Option<Vec<Game>> {
    (1..=ACTION_GAMES)
        .map(|n| {
            let days = -10 - i64::from(n);
            let name = format!("Action Sample {n:02}");
            card(&product_id(1000 + n), &name, now, days, "€9,99")
        })
        .collect()
}

impl Catalog {
    fn new(now: Timestamp) -> Option<Self> {
        let at = |n: u32, name: &str, days: i64, price: &str| {
            card(&product_id(n), name, now, days, price)
        };
        let save = |text: &str| Some(text.to_owned());
        let aurora = Game {
            plus_upsell_text: save("Save 10%"),
            ..at(1, "Aurora Drift", -2, "€69,99")?
        };
        let basalt = at(2, "Basalt Knights", -4, "€59,99")?;
        let cinder = Game {
            plus_upsell_text: save("Extra"),
            ..at(3, "Cinder Valley", -6, "€39,99")?
        };
        let delta = at(4, "Delta Signal", -9, "€19,99")?;
        let echo = Game {
            pre_order: true,
            ..at(5, "Echo Harbor", 3, "€69,99")?
        };
        let frostline = concept("900000001", "Frostline", now, 10)?;
        let glass = at(7, "Glass Orchard", 20, "€49,99")?;
        let harbor = Game {
            original_price: "€59,99".to_owned(),
            discount_text: "-50%".to_owned(),
            plus_upsell_text: save("Save 25%"),
            ..at(8, "Harbor Lights", -30, "€29,99")?
        };
        let iron = Game {
            original_price: "€39,99".to_owned(),
            discount_text: "-50%".to_owned(),
            ..at(9, "Iron Meadow", -60, "€19,99")?
        };
        let juniper = at(10, "Juniper Run", -90, "")?;
        let kestrel = at(11, "Kestrel Point", -120, "")?;
        let lumen = concept("900000002", "Lumen Tide", now, 40)?;
        // Purchased only: the public store has no page for it, so its game
        // page shows the owned entry.
        let mosaic = at(13, "Mosaic Engine", -400, "")?;
        let genre = |key: &str, name: &str| Genre {
            key: key.to_owned(),
            name: name.to_owned(),
        };

        Some(Self {
            new: vec![aurora.clone(), basalt.clone(), cinder.clone(), delta],
            upcoming: vec![echo, frostline, glass],
            discounted: vec![harbor.clone(), iron],
            monthly: vec![juniper, kestrel],
            genres: vec![
                (genre("ACTION", "Action"), action_games(now)?),
                (genre("RACING", "Driving/Racing"), vec![aurora.clone()]),
                (genre("PUZZLE", "Puzzle"), vec![]),
            ],
            wishlist: vec![aurora, harbor, lumen],
            purchased: vec![cinder, basalt, mosaic],
        })
    }

    /// Every public store game once, in list order.
    fn store_games(&self) -> impl Iterator<Item = &Game> {
        let mut seen = HashSet::new();
        self.new
            .iter()
            .chain(&self.upcoming)
            .chain(&self.discounted)
            .chain(&self.monthly)
            .chain(self.genres.iter().flat_map(|(_, games)| games))
            .filter(move |game| seen.insert(game.id.as_str().to_owned()))
    }

    /// The game page data of a public store game.
    fn detail(&self, id: &GameId) -> Option<Game> {
        let game = self.store_games().find(|game| game.id == *id)?.clone();
        Some(match game.name.as_str() {
            "Aurora Drift" => Game {
                plus_offer: Some(PlusOffer::Price {
                    price: "€62,99".to_owned(),
                }),
                ..with_details(game, &["Racing", "Arcade"], true)
            },
            "Cinder Valley" => Game {
                plus_offer: Some(PlusOffer::Included),
                ..with_details(game, &["Adventure"], false)
            },
            "Harbor Lights" => Game {
                plus_offer: Some(PlusOffer::Price {
                    price: "€22,49".to_owned(),
                }),
                ..with_details(game, &["Puzzle"], true)
            },
            _ => with_details(game, &["Action"], false),
        })
    }

    /// The store games whose name contains `term`, ignoring case.
    fn search(&self, term: &str) -> Vec<Game> {
        let term = term.to_lowercase();
        self.store_games()
            .filter(|game| game.name.to_lowercase().contains(&term))
            .cloned()
            .collect()
    }

    fn browse(&self, genre: &GenreKey, order: BrowseOrder) -> Vec<Game> {
        let mut games = self
            .genres
            .iter()
            .find(|(item, _)| item.key == genre.as_str())
            .map(|(_, games)| games.clone())
            .unwrap_or_default();
        match order {
            BrowseOrder::BestSelling | BrowseOrder::MostDownloaded => {}
            BrowseOrder::Newest => games.sort_by(|a, b| b.date.cmp(&a.date)),
            BrowseOrder::Oldest => games.sort_by(|a, b| a.date.cmp(&b.date)),
            BrowseOrder::NameAsc => games.sort_by(|a, b| a.name.cmp(&b.name)),
            BrowseOrder::NameDesc => games.sort_by(|a, b| b.name.cmp(&a.name)),
        }
        games
    }
}

// ---- Fake services ----------------------------------------------------------

/// The failure of an upstream outage: 503 when `rate_limited`, else 502.
fn outage(rate_limited: bool) -> UpstreamError {
    if rate_limited {
        UpstreamError::RateLimited {
            message: "synthetic outage".to_owned(),
            retry_after_seconds: Some(30),
        }
    } else {
        UpstreamError::unavailable("synthetic outage")
    }
}

#[derive(Debug)]
struct FakeGames {
    catalog: Arc<Catalog>,
    scenario: Scenario,
}

impl FakeGames {
    /// A list answer: one page of `games` in the healthy scenario, the outage
    /// failure otherwise.
    fn list(
        &self,
        games: impl FnOnce(&Catalog) -> Vec<Game>,
        page: Page,
        limit: usize,
        rate_limited: bool,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        let outcome = match self.scenario {
            Scenario::Healthy => Ok(paginate(
                games(&self.catalog),
                page.offset,
                page.size.min(limit),
            )),
            Scenario::Outage => Err(outage(rate_limited)),
        };
        Box::pin(async move { outcome })
    }
}

impl GamesApi for FakeGames {
    fn new_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(|c| c.new.clone(), page, usize::MAX, false)
    }
    fn upcoming_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(|c| c.upcoming.clone(), page, usize::MAX, true)
    }
    fn discounted_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(|c| c.discounted.clone(), page, usize::MAX, false)
    }
    fn monthly_games(&self, page: Page) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(|c| c.monthly.clone(), page, usize::MAX, true)
    }
    fn search_games(
        &self,
        term: String,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(|c| c.search(&term), page, SEARCH_PAGE_LIMIT, false)
    }
    fn genres(&self) -> ServiceFuture<'_, Result<GenreList, UpstreamError>> {
        let outcome = match self.scenario {
            Scenario::Healthy => Ok(GenreList {
                genres: self
                    .catalog
                    .genres
                    .iter()
                    .map(|(genre, _)| genre.clone())
                    .collect(),
            }),
            Scenario::Outage => Err(outage(true)),
        };
        Box::pin(async move { outcome })
    }
    fn browse_games(
        &self,
        genre: GenreKey,
        order: BrowseOrder,
        page: Page,
    ) -> ServiceFuture<'_, Result<PageResult, UpstreamError>> {
        self.list(|c| c.browse(&genre, order), page, usize::MAX, false)
    }
    fn game_by_id(&self, id: GameId) -> ServiceFuture<'_, Result<Game, GameLookupError>> {
        let outcome = match self.scenario {
            Scenario::Healthy => self
                .catalog
                .detail(&id)
                .ok_or(GameLookupError::NotFound { id }),
            Scenario::Outage => Err(GameLookupError::Upstream(outage(false))),
        };
        Box::pin(async move { outcome })
    }
}

/// A critic score for two games. Every other game has no trusted score.
#[derive(Debug)]
struct FakeScores;

impl CriticScores for FakeScores {
    fn score_for<'a>(&'a self, game: &'a Game) -> ServiceFuture<'a, Option<CriticScore>> {
        let score = match game.name.as_str() {
            "Aurora Drift" => CriticScore::new(87),
            "Harbor Lights" => CriticScore::new(64),
            _ => None,
        };
        Box::pin(async move { score })
    }
}

/// The signed-in lists. Only [`SYNTHETIC_NPSSO`] is a valid sign-in.
#[derive(Debug)]
struct FakeAccount {
    catalog: Arc<Catalog>,
    scenario: Scenario,
}

impl FakeAccount {
    fn check(&self, npsso: &Secret) -> Result<(), AccountError> {
        match self.scenario {
            Scenario::Outage => Err(AccountError::Upstream(outage(false))),
            Scenario::Healthy if npsso.expose() == SYNTHETIC_NPSSO => Ok(()),
            Scenario::Healthy => Err(AccountError::session_rejected("synthetic rejection")),
        }
    }

    fn list(
        &self,
        npsso: &Secret,
        games: &[Game],
    ) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        let outcome = self.check(npsso).map(|()| PageResult {
            games: games.to_vec(),
            total_count: games.len(),
            next_offset: None,
        });
        Box::pin(async move { outcome })
    }
}

impl AccountApi for FakeAccount {
    fn verify_npsso(&self, npsso: Secret) -> ServiceFuture<'_, Result<(), AccountError>> {
        let outcome = self.check(&npsso);
        Box::pin(async move { outcome })
    }
    fn purchased_games(
        &self,
        npsso: Secret,
    ) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        self.list(&npsso, &self.catalog.purchased)
    }
    fn wishlist_games(&self, npsso: Secret) -> ServiceFuture<'_, Result<PageResult, AccountError>> {
        self.list(&npsso, &self.catalog.wishlist)
    }
}
