//! swisstopo map tiles for the GPX viewer (ADR 0015). The webview has no network access, so Rust
//! fetches the tiles from the fixed WMTS host. Only tile coordinates leave the machine. Tiles are
//! cached in memory only (bounded, FIFO eviction), never on disk.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use coco_core::maptiles::{tile_url, MapLayer};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::session::read_body_capped;

const USER_AGENT: &str = concat!("co-co/", env!("CARGO_PKG_VERSION"), " (swisstopo map tiles)");
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_TILE_BYTES: usize = 2 * 1024 * 1024;
const CACHE_MAX: usize = 2048;
/// Upper bound for the summed base64 size of all cached tiles.
const CACHE_MAX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTile {
    pub content_type: String,
    pub bytes_base64: String,
}

type Key = (MapLayer, u32, u32, u32);

#[derive(Default)]
struct Cache {
    map: HashMap<Key, MapTile>,
    order: VecDeque<Key>,
    bytes: usize,
}

pub struct MapTileState {
    client: reqwest::Client,
    cache: Mutex<Cache>,
}

impl MapTileState {
    pub fn new() -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(HTTP_TIMEOUT)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { client, cache: Mutex::new(Cache::default()) })
    }

    fn cached(&self, key: &Key) -> Option<MapTile> {
        self.cache.lock().ok()?.map.get(key).cloned()
    }

    fn store(&self, key: Key, tile: MapTile) {
        let Ok(mut c) = self.cache.lock() else { return };
        let size = tile.bytes_base64.len();
        match c.map.insert(key, tile) {
            None => c.order.push_back(key),
            Some(prev) => c.bytes -= prev.bytes_base64.len(),
        }
        c.bytes += size;
        while c.order.len() > CACHE_MAX || c.bytes > CACHE_MAX_BYTES {
            let Some(old) = c.order.pop_front() else { break };
            if let Some(t) = c.map.remove(&old) {
                c.bytes -= t.bytes_base64.len();
            }
        }
    }
}

pub async fn fetch_tile(state: &MapTileState, layer: &str, z: u32, x: u32, y: u32) -> AppResult<MapTile> {
    let layer = MapLayer::parse(layer)?;
    let url = tile_url(layer, z, x, y)?;
    let key = (layer, z, x, y);
    if let Some(t) = state.cached(&key) {
        return Ok(t);
    }
    let resp = state.client.get(url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Status { status: status.as_u16(), detail: None });
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    if !content_type.starts_with("image/") {
        return Err(AppError::Unexpected("Kachel ist kein Bild".into()));
    }
    let bytes = read_body_capped(resp, MAX_TILE_BYTES).await?;
    let tile = MapTile { content_type, bytes_base64: STANDARD.encode(&bytes) };
    state.store(key, tile.clone());
    Ok(tile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_is_bounded() {
        let s = MapTileState::new().unwrap();
        for i in 0..(CACHE_MAX as u32 + 10) {
            s.store(
                (MapLayer::Base, 18, i, 0),
                MapTile { content_type: "image/png".into(), bytes_base64: String::new() },
            );
        }
        assert_eq!(s.cache.lock().unwrap().map.len(), CACHE_MAX);
        assert!(s.cached(&(MapLayer::Base, 18, 0, 0)).is_none());
        assert!(s.cached(&(MapLayer::Base, 18, CACHE_MAX as u32 + 9, 0)).is_some());
    }

    #[test]
    fn cache_respects_byte_cap() {
        let s = MapTileState::new().unwrap();
        let big = CACHE_MAX_BYTES / 4 + 1;
        for i in 0..6u32 {
            s.store(
                (MapLayer::Aerial, 10, i, 0),
                MapTile { content_type: "image/jpeg".into(), bytes_base64: "a".repeat(big) },
            );
        }
        let c = s.cache.lock().unwrap();
        assert!(c.bytes <= CACHE_MAX_BYTES);
        assert_eq!(c.map.len(), 3);
        assert!(!c.map.contains_key(&(MapLayer::Aerial, 10, 0, 0)));
        assert!(c.map.contains_key(&(MapLayer::Aerial, 10, 5, 0)));
    }
}
