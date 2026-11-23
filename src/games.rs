//! Catálogo central de jogos, proxy de busca com cache e resolução de metadados.
//!
//! O servidor atua como intermediário entre o cliente e a fonte externa de metadados:
//! - Catálogo curado local sempre disponível (inclusive offline);
//! - Cache em memória + disco (`data/game-catalog-cache.json`) para não depender
//!   de API externa ao abrir perfis;
//! - Busca ao vivo via Steam Store Search API (sem chave embutida no cliente)
//!   com suporte opcional a `RAWG_API_KEY` no ambiente do servidor.

use crate::state::SharedState;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const SEARCH_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_CACHED_QUERIES: usize = 400;
const MAX_CACHED_GAMES: usize = 4000;
const EXTERNAL_TIMEOUT: Duration = Duration::from_millis(3500);

const ALLOWED_COVER_HOSTS: &[&str] = &[
    "shared.fastly.steamstatic.com",
    "shared.akamai.steamstatic.com",
    "cdn.cloudflare.steamstatic.com",
    "cdn.akamai.steamstatic.com",
    "store.steampowered.com",
    "steamcdn-a.akamaihd.net",
    "media.rawg.io",
    "images.igdb.com",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameMetadata {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_year: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platforms: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

struct CuratedSeed {
    id: &'static str,
    title: &'static str,
    aliases: &'static [&'static str],
    steam_appid: Option<u32>,
    release_year: u16,
    developer: &'static str,
    platforms: &'static [&'static str],
}

fn steam_header(appid: u32) -> String {
    format!(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{appid}/header.jpg"
    )
}

const CURATED_SEEDS: &[CuratedSeed] = &[
    CuratedSeed { id: "sancord:minecraft", title: "Minecraft", aliases: &["mine", "mc", "minecraft java", "minecraft bedrock"], steam_appid: None, release_year: 2011, developer: "Mojang Studios", platforms: &["PC", "Console", "Mobile"] },
    CuratedSeed { id: "steam:730", title: "Counter-Strike 2", aliases: &["cs2", "csgo", "cs", "counter strike"], steam_appid: Some(730), release_year: 2023, developer: "Valve", platforms: &["PC"] },
    CuratedSeed { id: "sancord:valorant", title: "VALORANT", aliases: &["val", "vava", "valorant"], steam_appid: None, release_year: 2020, developer: "Riot Games", platforms: &["PC", "Console"] },
    CuratedSeed { id: "sancord:league-of-legends", title: "League of Legends", aliases: &["lol", "league"], steam_appid: None, release_year: 2009, developer: "Riot Games", platforms: &["PC"] },
    CuratedSeed { id: "steam:271590", title: "Grand Theft Auto V", aliases: &["gta 5", "gtav", "gta v", "gta"], steam_appid: Some(271590), release_year: 2015, developer: "Rockstar Games", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:1245620", title: "ELDEN RING", aliases: &["elden", "elden ring"], steam_appid: Some(1245620), release_year: 2022, developer: "FromSoftware", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:1091500", title: "Cyberpunk 2077", aliases: &["cp2077", "cyberpunk"], steam_appid: Some(1091500), release_year: 2020, developer: "CD PROJEKT RED", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:1174180", title: "Red Dead Redemption 2", aliases: &["rdr2", "red dead 2", "red dead"], steam_appid: Some(1174180), release_year: 2019, developer: "Rockstar Games", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "sancord:fortnite", title: "Fortnite", aliases: &["fort", "fn"], steam_appid: None, release_year: 2017, developer: "Epic Games", platforms: &["PC", "PlayStation", "Xbox", "Switch", "Mobile"] },
    CuratedSeed { id: "sancord:roblox", title: "Roblox", aliases: &["rbx"], steam_appid: None, release_year: 2006, developer: "Roblox Corporation", platforms: &["PC", "Console", "Mobile"] },
    CuratedSeed { id: "steam:1086940", title: "Baldur's Gate 3", aliases: &["bg3", "baldurs gate 3", "baldurs gate"], steam_appid: Some(1086940), release_year: 2023, developer: "Larian Studios", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:367520", title: "Hollow Knight", aliases: &["hk", "hollow"], steam_appid: Some(367520), release_year: 2017, developer: "Team Cherry", platforms: &["PC", "Switch", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:105600", title: "Terraria", aliases: &["terraria"], steam_appid: Some(105600), release_year: 2011, developer: "Re-Logic", platforms: &["PC", "Console", "Mobile"] },
    CuratedSeed { id: "steam:413150", title: "Stardew Valley", aliases: &["stardew"], steam_appid: Some(413150), release_year: 2016, developer: "ConcernedApe", platforms: &["PC", "Switch", "PlayStation", "Xbox", "Mobile"] },
    CuratedSeed { id: "steam:292030", title: "The Witcher 3: Wild Hunt", aliases: &["witcher 3", "tw3", "geralt"], steam_appid: Some(292030), release_year: 2015, developer: "CD PROJEKT RED", platforms: &["PC", "PlayStation", "Xbox", "Switch"] },
    CuratedSeed { id: "steam:570", title: "Dota 2", aliases: &["dota"], steam_appid: Some(570), release_year: 2013, developer: "Valve", platforms: &["PC"] },
    CuratedSeed { id: "steam:1172470", title: "Apex Legends", aliases: &["apex"], steam_appid: Some(1172470), release_year: 2019, developer: "Respawn Entertainment", platforms: &["PC", "PlayStation", "Xbox", "Switch"] },
    CuratedSeed { id: "steam:2357570", title: "Overwatch 2", aliases: &["ow2", "overwatch"], steam_appid: Some(2357570), release_year: 2022, developer: "Blizzard Entertainment", platforms: &["PC", "PlayStation", "Xbox", "Switch"] },
    CuratedSeed { id: "steam:252490", title: "Rust", aliases: &["rust"], steam_appid: Some(252490), release_year: 2018, developer: "Facepunch Studios", platforms: &["PC", "Console"] },
    CuratedSeed { id: "steam:1623730", title: "Palworld", aliases: &["palworld"], steam_appid: Some(1623730), release_year: 2024, developer: "Pocketpair", platforms: &["PC", "Xbox", "PlayStation"] },
    CuratedSeed { id: "steam:553850", title: "HELLDIVERS 2", aliases: &["hd2", "helldivers", "helldivers 2"], steam_appid: Some(553850), release_year: 2024, developer: "Arrowhead Game Studios", platforms: &["PC", "PlayStation"] },
    CuratedSeed { id: "steam:1966720", title: "Lethal Company", aliases: &["lethal", "lethal company"], steam_appid: Some(1966720), release_year: 2023, developer: "Zeekerss", platforms: &["PC"] },
    CuratedSeed { id: "steam:1145360", title: "Hades", aliases: &["hades"], steam_appid: Some(1145360), release_year: 2020, developer: "Supergiant Games", platforms: &["PC", "Switch", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:1145350", title: "Hades II", aliases: &["hades 2", "hades ii"], steam_appid: Some(1145350), release_year: 2024, developer: "Supergiant Games", platforms: &["PC"] },
    CuratedSeed { id: "steam:945360", title: "Among Us", aliases: &["among", "amogus"], steam_appid: Some(945360), release_year: 2018, developer: "Innersloth", platforms: &["PC", "Mobile", "Console"] },
    CuratedSeed { id: "steam:359550", title: "Tom Clancy's Rainbow Six Siege", aliases: &["r6", "r6s", "rainbow six", "siege"], steam_appid: Some(359550), release_year: 2015, developer: "Ubisoft", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:381210", title: "Dead by Daylight", aliases: &["dbd", "dead by daylight"], steam_appid: Some(381210), release_year: 2016, developer: "Behaviour Interactive", platforms: &["PC", "PlayStation", "Xbox", "Switch"] },
    CuratedSeed { id: "steam:550", title: "Left 4 Dead 2", aliases: &["l4d2", "left 4 dead"], steam_appid: Some(550), release_year: 2009, developer: "Valve", platforms: &["PC"] },
    CuratedSeed { id: "steam:620", title: "Portal 2", aliases: &["portal 2", "portal"], steam_appid: Some(620), release_year: 2011, developer: "Valve", platforms: &["PC", "Console"] },
    CuratedSeed { id: "steam:489830", title: "The Elder Scrolls V: Skyrim Special Edition", aliases: &["skyrim", "tesv"], steam_appid: Some(489830), release_year: 2016, developer: "Bethesda Game Studios", platforms: &["PC", "PlayStation", "Xbox", "Switch"] },
    CuratedSeed { id: "steam:2050650", title: "Resident Evil 4", aliases: &["re4", "re4 remake", "resident evil 4"], steam_appid: Some(2050650), release_year: 2023, developer: "CAPCOM", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "steam:1593500", title: "God of War", aliases: &["gow", "god of war"], steam_appid: Some(1593500), release_year: 2022, developer: "Santa Monica Studio", platforms: &["PC", "PlayStation"] },
    CuratedSeed { id: "steam:1817070", title: "Marvel's Spider-Man Remastered", aliases: &["spider-man", "spiderman", "homem aranha"], steam_appid: Some(1817070), release_year: 2022, developer: "Insomniac Games", platforms: &["PC", "PlayStation"] },
    CuratedSeed { id: "steam:1172620", title: "Sea of Thieves", aliases: &["sot", "sea of thieves"], steam_appid: Some(1172620), release_year: 2018, developer: "Rare", platforms: &["PC", "Xbox", "PlayStation"] },
    CuratedSeed { id: "steam:739630", title: "Phasmophobia", aliases: &["phasmo", "phasmophobia"], steam_appid: Some(739630), release_year: 2020, developer: "Kinetic Games", platforms: &["PC", "Console"] },
    CuratedSeed { id: "steam:227300", title: "Euro Truck Simulator 2", aliases: &["ets2", "euro truck"], steam_appid: Some(227300), release_year: 2012, developer: "SCS Software", platforms: &["PC"] },
    CuratedSeed { id: "steam:1551360", title: "Forza Horizon 5", aliases: &["fh5", "forza", "forza 5"], steam_appid: Some(1551360), release_year: 2021, developer: "Playground Games", platforms: &["PC", "Xbox"] },
    CuratedSeed { id: "steam:322170", title: "Geometry Dash", aliases: &["gd", "geometry dash"], steam_appid: Some(322170), release_year: 2013, developer: "RobTop Games", platforms: &["PC", "Mobile"] },
    CuratedSeed { id: "steam:252950", title: "Rocket League", aliases: &["rl", "rocket league"], steam_appid: Some(252950), release_year: 2015, developer: "Psyonix", platforms: &["PC", "PlayStation", "Xbox", "Switch"] },
    CuratedSeed { id: "steam:1938090", title: "Call of Duty", aliases: &["cod", "warzone", "call of duty", "mw3", "bo6"], steam_appid: Some(1938090), release_year: 2022, developer: "Activision", platforms: &["PC", "PlayStation", "Xbox"] },
    CuratedSeed { id: "sancord:genshin-impact", title: "Genshin Impact", aliases: &["genshin"], steam_appid: None, release_year: 2020, developer: "HoYoverse", platforms: &["PC", "PlayStation", "Mobile"] },
    CuratedSeed { id: "sancord:honkai-star-rail", title: "Honkai: Star Rail", aliases: &["hsr", "honkai", "star rail"], steam_appid: None, release_year: 2023, developer: "HoYoverse", platforms: &["PC", "PlayStation", "Mobile"] },
    CuratedSeed { id: "sancord:world-of-warcraft", title: "World of Warcraft", aliases: &["wow", "warcraft"], steam_appid: None, release_year: 2004, developer: "Blizzard Entertainment", platforms: &["PC"] },
    CuratedSeed { id: "sancord:escape-from-tarkov", title: "Escape from Tarkov", aliases: &["eft", "tarkov"], steam_appid: None, release_year: 2017, developer: "Battlestate Games", platforms: &["PC"] },
    CuratedSeed { id: "sancord:osu", title: "osu!", aliases: &["osu"], steam_appid: None, release_year: 2007, developer: "ppy", platforms: &["PC"] },
    CuratedSeed { id: "sancord:gta-vi", title: "Grand Theft Auto VI", aliases: &["gta 6", "gtavi", "gta vi"], steam_appid: None, release_year: 2026, developer: "Rockstar Games", platforms: &["PlayStation", "Xbox"] },
    CuratedSeed { id: "sancord:zelda-totk", title: "The Legend of Zelda: Tears of the Kingdom", aliases: &["zelda", "totk", "tears of the kingdom"], steam_appid: None, release_year: 2023, developer: "Nintendo", platforms: &["Switch"] },
    CuratedSeed { id: "sancord:super-mario-odyssey", title: "Super Mario Odyssey", aliases: &["mario", "mario odyssey"], steam_appid: None, release_year: 2017, developer: "Nintendo", platforms: &["Switch"] },
];

impl CuratedSeed {
    fn to_metadata(&self) -> GameMetadata {
        GameMetadata {
            id: self.id.to_string(),
            title: self.title.to_string(),
            cover_url: self.steam_appid.map(steam_header),
            release_year: Some(self.release_year),
            developer: Some(self.developer.to_string()),
            publisher: None,
            platforms: self.platforms.iter().map(|p| (*p).to_string()).collect(),
            summary: None,
            source: Some("curated".to_string()),
        }
    }
}

pub fn curated_games() -> Vec<GameMetadata> {
    CURATED_SEEDS.iter().map(CuratedSeed::to_metadata).collect()
}

/// Normaliza uma string para busca tolerante a acentos, pontuação e maiúsculas.
pub fn normalize_search_key(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_space = true;
    for ch in raw.chars() {
        let lower = match ch.to_ascii_lowercase() {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        };
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    out.trim().to_string()
}

/// Valida se um `game_id` possui formato seguro (`steam:123` ou `sancord:minecraft` ou `rawg:123`).
pub fn is_valid_game_id(id: &str) -> bool {
    let clean = id.trim();
    if clean.is_empty() || clean.len() > 80 {
        return false;
    }
    clean
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'-' | b'_' | b'.'))
}

/// Valida URL de capa externa ou anexo local do próprio Sancord.
/// Rejeita domínios arbitrários, credenciais, HTTP sem TLS e esquemas perigosos.
pub fn is_safe_game_cover_url(raw: &str) -> bool {
    let clean = raw.trim();
    if clean.is_empty() || clean.len() > 500 {
        return false;
    }
    if let Some(rest) = clean.strip_prefix("/api/attachments/") {
        let mut parts = rest.split('/');
        let id = parts.next().unwrap_or("");
        let name = parts.next().unwrap_or("");
        return id.len() == 32
            && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            && !name.is_empty()
            && parts.next().is_none();
    }
    let Ok(parsed) = reqwest::Url::parse(clean) else {
        return false;
    };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host_lower = host.to_ascii_lowercase();
    ALLOWED_COVER_HOSTS.iter().any(|allowed| *allowed == host_lower)
}

#[derive(Clone)]
struct CachedSearch {
    games: Vec<GameMetadata>,
    stored_at: Instant,
}

#[derive(Serialize, Deserialize, Default)]
struct PersistedGameCache {
    games: Vec<GameMetadata>,
}

pub struct GameCatalogCache {
    by_id: HashMap<String, GameMetadata>,
    queries: HashMap<String, CachedSearch>,
    cache_path: PathBuf,
    external_enabled: bool,
    rawg_api_key: Option<String>,
    http: reqwest::Client,
}

impl GameCatalogCache {
    pub fn load(data_dir: &std::path::Path, external_enabled: bool) -> Arc<RwLock<Self>> {
        let cache_path = data_dir.join("game-catalog-cache.json");
        let mut by_id = HashMap::new();

        for game in curated_games() {
            by_id.insert(game.id.clone(), game);
        }

        if let Ok(raw) = std::fs::read_to_string(&cache_path) {
            if let Ok(persisted) = serde_json::from_str::<PersistedGameCache>(&raw) {
                for mut game in persisted.games.into_iter().take(MAX_CACHED_GAMES) {
                    if !is_valid_game_id(&game.id) || game.title.trim().is_empty() {
                        continue;
                    }
                    if let Some(ref url) = game.cover_url {
                        if !is_safe_game_cover_url(url) {
                            game.cover_url = None;
                        }
                    }
                    by_id.entry(game.id.clone()).or_insert(game);
                }
            }
        }

        let rawg_api_key = std::env::var("RAWG_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let http = reqwest::Client::builder()
            .timeout(EXTERNAL_TIMEOUT)
            .user_agent("SancordServer/0.2")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Arc::new(RwLock::new(Self {
            by_id,
            queries: HashMap::new(),
            cache_path,
            external_enabled,
            rawg_api_key,
            http,
        }))
    }

    pub fn popular(&self, limit: usize) -> Vec<GameMetadata> {
        curated_games().into_iter().take(limit.clamp(1, 50)).collect()
    }

    pub fn get_by_id(&self, id: &str) -> Option<GameMetadata> {
        self.by_id.get(id).cloned()
    }

    /// Resolve rapidamente um nome de jogo (ex.: detectado pelo Windows / Rich Presence)
    /// usando o catálogo curado e o cache persistido, sem chamadas externas.
    pub fn resolve_by_name(&self, name: &str) -> Option<GameMetadata> {
        let needle = normalize_search_key(name);
        if needle.is_empty() {
            return None;
        }
        for seed in CURATED_SEEDS {
            if normalize_search_key(seed.title) == needle
                || seed.aliases.iter().any(|a| normalize_search_key(a) == needle)
            {
                return Some(seed.to_metadata());
            }
        }
        if let Some(exact) = self
            .by_id
            .values()
            .find(|g| normalize_search_key(&g.title) == needle)
        {
            return Some(exact.clone());
        }
        // Correspondência por prefixo/inclusão forte (evita falsos positivos em títulos curtos).
        if needle.len() >= 4 {
            for seed in CURATED_SEEDS {
                let norm = normalize_search_key(seed.title);
                if norm.starts_with(&needle) || needle.starts_with(&norm) {
                    return Some(seed.to_metadata());
                }
            }
        }
        None
    }

    fn search_local(&self, query: &str, limit: usize) -> Vec<GameMetadata> {
        let needle = normalize_search_key(query);
        if needle.is_empty() {
            return self.popular(limit);
        }
        let tokens: Vec<&str> = needle.split_whitespace().collect();
        let mut scored: Vec<(i32, GameMetadata)> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        for seed in CURATED_SEEDS {
            let norm_title = normalize_search_key(seed.title);
            let mut score = score_match(&norm_title, &needle, &tokens);
            for alias in seed.aliases {
                let alias_norm = normalize_search_key(alias);
                score = score.max(score_match(&alias_norm, &needle, &tokens));
            }
            if score > 0 {
                let meta = seed.to_metadata();
                seen_ids.insert(meta.id.clone());
                scored.push((score + 15, meta));
            }
        }

        for game in self.by_id.values() {
            if seen_ids.contains(&game.id) {
                continue;
            }
            let norm_title = normalize_search_key(&game.title);
            let score = score_match(&norm_title, &needle, &tokens);
            if score > 0 {
                seen_ids.insert(game.id.clone());
                scored.push((score, game.clone()));
            }
        }

        scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.title.cmp(&b.1.title)));
        scored.into_iter().take(limit).map(|(_, g)| g).collect()
    }

    fn ingest_games(&mut self, games: &[GameMetadata]) {
        let mut changed = false;
        for game in games {
            if !is_valid_game_id(&game.id) || game.title.trim().is_empty() {
                continue;
            }
            if self.by_id.len() >= MAX_CACHED_GAMES && !self.by_id.contains_key(&game.id) {
                continue;
            }
            let replace = match self.by_id.get(&game.id) {
                None => true,
                Some(existing) => existing.cover_url.is_none() && game.cover_url.is_some(),
            };
            if replace {
                self.by_id.insert(game.id.clone(), game.clone());
                changed = true;
            }
        }
        if changed {
            self.persist_best_effort();
        }
    }

    fn persist_best_effort(&self) {
        let external_only: Vec<GameMetadata> = self
            .by_id
            .values()
            .filter(|g| g.source.as_deref() != Some("curated"))
            .take(MAX_CACHED_GAMES)
            .cloned()
            .collect();
        if external_only.is_empty() {
            return;
        }
        let payload = PersistedGameCache { games: external_only };
        if let Ok(json) = serde_json::to_string(&payload) {
            if let Some(parent) = self.cache_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let tmp = self.cache_path.with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &self.cache_path);
            }
        }
    }

    fn record_query(&mut self, key: String, games: Vec<GameMetadata>) {
        if self.queries.len() >= MAX_CACHED_QUERIES {
            let now = Instant::now();
            self.queries
                .retain(|_, v| now.duration_since(v.stored_at) < SEARCH_CACHE_TTL);
            if self.queries.len() >= MAX_CACHED_QUERIES {
                self.queries.clear();
            }
        }
        self.queries.insert(
            key,
            CachedSearch {
                games,
                stored_at: Instant::now(),
            },
        );
    }
}

fn score_match(haystack: &str, needle: &str, tokens: &[&str]) -> i32 {
    if haystack == needle {
        return 100;
    }
    if haystack.starts_with(needle) {
        return 80;
    }
    if haystack.contains(needle) {
        return 60;
    }
    if !tokens.is_empty() && tokens.iter().all(|tok| haystack.contains(tok)) {
        return 45;
    }
    0
}

#[derive(Deserialize)]
struct SteamSearchResponse {
    #[serde(default)]
    items: Vec<SteamSearchItem>,
}

#[derive(Deserialize)]
struct SteamSearchItem {
    id: u32,
    name: String,
    #[serde(default)]
    tiny_image: Option<String>,
    #[serde(default)]
    platforms: Option<SteamPlatforms>,
}

#[derive(Deserialize)]
struct SteamPlatforms {
    #[serde(default)]
    windows: bool,
    #[serde(default)]
    mac: bool,
    #[serde(default)]
    linux: bool,
}

#[derive(Deserialize)]
struct RawgSearchResponse {
    #[serde(default)]
    results: Vec<RawgGameItem>,
}

#[derive(Deserialize)]
struct RawgGameItem {
    id: u64,
    name: String,
    #[serde(default)]
    background_image: Option<String>,
    #[serde(default)]
    released: Option<String>,
}

async fn fetch_steam_games(client: &reqwest::Client, query: &str) -> Result<Vec<GameMetadata>, String> {
    let url = reqwest::Url::parse_with_params(
        "https://store.steampowered.com/api/storesearch/",
        &[("term", query), ("l", "portuguese"), ("cc", "BR")],
    )
    .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: SteamSearchResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in parsed.items.into_iter().take(18) {
        let title = item.name.trim().to_string();
        if title.is_empty() {
            continue;
        }
        let header_url = steam_header(item.id);
        let cover_url = if is_safe_game_cover_url(&header_url) {
            Some(header_url)
        } else {
            item.tiny_image.filter(|u| is_safe_game_cover_url(u))
        };
        let mut platforms = Vec::new();
        if let Some(p) = item.platforms {
            if p.windows || p.mac || p.linux {
                platforms.push("PC".to_string());
            }
        }
        out.push(GameMetadata {
            id: format!("steam:{}", item.id),
            title,
            cover_url,
            release_year: None,
            developer: None,
            publisher: None,
            platforms,
            summary: None,
            source: Some("steam".to_string()),
        });
    }
    Ok(out)
}

async fn fetch_rawg_games(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
) -> Result<Vec<GameMetadata>, String> {
    let url = reqwest::Url::parse_with_params(
        "https://api.rawg.io/api/games",
        &[("search", query), ("page_size", "10"), ("key", api_key)],
    )
    .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: RawgSearchResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in parsed.results {
        let title = item.name.trim().to_string();
        if title.is_empty() {
            continue;
        }
        let release_year = item
            .released
            .as_deref()
            .and_then(|d| d.get(0..4))
            .and_then(|y| y.parse::<u16>().ok());
        let cover_url = item
            .background_image
            .filter(|u| is_safe_game_cover_url(u));
        out.push(GameMetadata {
            id: format!("rawg:{}", item.id),
            title,
            cover_url,
            release_year,
            developer: None,
            publisher: None,
            platforms: Vec::new(),
            summary: None,
            source: Some("rawg".to_string()),
        });
    }
    Ok(out)
}

fn merge_results(primary: Vec<GameMetadata>, secondary: Vec<GameMetadata>, limit: usize) -> Vec<GameMetadata> {
    let mut out = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut seen_titles = HashSet::new();
    for game in primary.into_iter().chain(secondary) {
        let norm = normalize_search_key(&game.title);
        if seen_ids.contains(&game.id) || (!norm.is_empty() && seen_titles.contains(&norm)) {
            continue;
        }
        seen_ids.insert(game.id.clone());
        if !norm.is_empty() {
            seen_titles.insert(norm);
        }
        out.push(game);
        if out.len() >= limit {
            break;
        }
    }
    out
}

pub async fn search_games(
    catalog: &Arc<RwLock<GameCatalogCache>>,
    raw_query: &str,
    limit: usize,
) -> (Vec<GameMetadata>, bool) {
    let limit = limit.clamp(1, 24);
    let clean = raw_query.trim();
    if clean.is_empty() {
        let guard = catalog.read().await;
        return (guard.popular(limit), false);
    }
    let cache_key = normalize_search_key(clean);
    let (local_matches, cached_hit, external_enabled, http, rawg_key) = {
        let guard = catalog.read().await;
        let hit = guard.queries.get(&cache_key).and_then(|entry| {
            (Instant::now().duration_since(entry.stored_at) < SEARCH_CACHE_TTL)
                .then(|| entry.games.clone())
        });
        (
            guard.search_local(clean, limit),
            hit,
            guard.external_enabled,
            guard.http.clone(),
            guard.rawg_api_key.clone(),
        )
    };

    if let Some(hit) = cached_hit {
        return (merge_results(local_matches, hit, limit), false);
    }

    if !external_enabled || cache_key.len() < 2 {
        return (local_matches, false);
    }

    let mut external = Vec::new();
    let mut degraded = false;

    match fetch_steam_games(&http, clean).await {
        Ok(items) => external.extend(items),
        Err(err) => {
            tracing::debug!("Busca externa Steam indisponível para '{clean}': {err}");
            degraded = true;
        }
    }

    if let Some(ref api_key) = rawg_key {
        if let Ok(rawg_items) = fetch_rawg_games(&http, api_key, clean).await {
            external.extend(rawg_items);
            degraded = false;
        }
    }

    if !external.is_empty() {
        let mut guard = catalog.write().await;
        guard.ingest_games(&external);
        guard.record_query(cache_key, external.clone());
    }

    let merged = merge_results(local_matches, external, limit);
    let is_degraded = degraded && merged.is_empty();
    (merged, is_degraded)
}

// ---------------------------------------------------------------------------
// Endpoints HTTP (`/api/games/*`)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct ResolveQuery {
    #[serde(default)]
    pub name: String,
}

#[derive(Serialize)]
struct GamesListResponse {
    ok: bool,
    games: Vec<GameMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    degraded: bool,
}

#[derive(Serialize)]
struct GameSingleResponse {
    ok: bool,
    game: Option<GameMetadata>,
}

pub async fn popular_handler(
    State(state): State<SharedState>,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    let catalog = state.read().await.game_catalog.clone();
    let limit = q.limit.unwrap_or(24).clamp(1, 48);
    let games = catalog.read().await.popular(limit);
    let mut resp = Json(GamesListResponse {
        ok: true,
        games,
        query: None,
        degraded: false,
    })
    .into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );
    resp
}

pub async fn search_handler(
    State(state): State<SharedState>,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    let query = q.q.trim().chars().take(80).collect::<String>();
    let limit = q.limit.unwrap_or(18).clamp(1, 24);
    let catalog = state.read().await.game_catalog.clone();
    let (games, degraded) = search_games(&catalog, &query, limit).await;
    let mut resp = Json(GamesListResponse {
        ok: true,
        games,
        query: Some(query),
        degraded,
    })
    .into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=120"),
    );
    resp
}

pub async fn resolve_handler(
    State(state): State<SharedState>,
    Query(q): Query<ResolveQuery>,
) -> impl IntoResponse {
    let name = q.name.trim().chars().take(80).collect::<String>();
    let catalog = state.read().await.game_catalog.clone();
    let game = catalog.read().await.resolve_by_name(&name);
    Json(GameSingleResponse { ok: true, game })
}

pub async fn by_id_handler(
    State(state): State<SharedState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    if !is_valid_game_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(GameSingleResponse {
                ok: false,
                game: None,
            }),
        );
    }
    let catalog = state.read().await.game_catalog.clone();
    let found = catalog.read().await.get_by_id(&id);
    match found {
        Some(game) => (
            StatusCode::OK,
            Json(GameSingleResponse {
                ok: true,
                game: Some(game),
            }),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(GameSingleResponse {
                ok: false,
                game: None,
            }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curated_catalog_finds_by_title_and_alias() {
        let dir = std::env::temp_dir().join(format!("sancord-games-{}", uuid::Uuid::new_v4()));
        let catalog = GameCatalogCache::load(&dir, false);
        let guard = catalog.blocking_read();
        let mine = guard.resolve_by_name("Minecraft").expect("Minecraft no catálogo");
        assert_eq!(mine.id, "sancord:minecraft");
        assert_eq!(mine.release_year, Some(2011));

        let cs = guard.resolve_by_name("cs2").expect("Alias cs2");
        assert_eq!(cs.id, "steam:730");
        assert!(cs.cover_url.as_deref().unwrap().starts_with("https://shared.fastly.steamstatic.com/"));

        let results = guard.search_local("elden", 10);
        assert_eq!(results.first().map(|g| g.id.as_str()), Some("steam:1245620"));
    }

    #[test]
    fn cover_url_validator_blocks_unsafe_origins() {
        assert!(is_safe_game_cover_url(
            "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg"
        ));
        assert!(is_safe_game_cover_url(
            "/api/attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/capa"
        ));
        assert!(!is_safe_game_cover_url("javascript:alert(1)"));
        assert!(!is_safe_game_cover_url("http://shared.fastly.steamstatic.com/a.jpg"));
        assert!(!is_safe_game_cover_url("https://evil.example.com/tracker.png"));
        assert!(!is_safe_game_cover_url("https://user@shared.fastly.steamstatic.com/a.jpg"));
    }
}
