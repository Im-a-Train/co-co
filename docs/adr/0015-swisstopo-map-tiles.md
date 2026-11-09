# ADR 0015: swisstopo map tiles in the GPX viewer

- Status: accepted
- Date: 2026-11-09
- Builds on: [ADR 0014](0014-coach-findings-ai-viewer.md) (document viewer, GPX without tiles),
  [ADR 0005](0005-data-zones-and-ai.md) (data zones)

## Context

The GPX viewer drew only an SVG track. Coaches want to see the route on a map (terrain, hiking trails,
slopes steeper than 30 degrees) to judge a hike. The webview has no network access (strict CSP), and the
rule «network only through Rust» stays.

## Decision

- New command `map_tile(layer, z, x, y)` returns a tile as `{ contentType, bytesBase64 }`. Rust fetches it
  from the **fixed host** `wmts.geo.admin.ch` (swisstopo WMTS, Web Mercator / EPSG:3857). The data is free
  OGD; the viewer shows the attribution «© swisstopo».
- **Layers are allowlisted** (`coco_core::maptiles::MapLayer`): `base` (pixelkarte-farbe, JPEG), `hiking`
  (swisstlm3d-wanderwege, PNG), `slope` (hangneigung-ueber_30, PNG). The URL is built from the enum and
  validated numbers (`z` 0..=18, `x`,`y` < 2^z), never from input strings. Redirects are not followed.
- Responses must be 2xx with an `image/*` content type and at most 2 MB.
- **CSP stays strict.** The webview gets the tile bytes over IPC and renders them itself.
- **Only tile coordinates leave the machine.** They reveal the approximate area of the track to swisstopo;
  this is accepted: no personal data, no track points, no camp or person identifiers. The coach can switch
  the map off in the viewer, which makes no tile requests.
- **In-memory cache only** (512 tiles, FIFO eviction), no disk cache, so no map data persists.

## Consequences

- The GPX viewer needs internet for the map; without it the SVG track still works.
- New network host `wmts.geo.admin.ch`, reachable only through this command.
- Adding a layer needs a code change and review (allowlist), not just a string from the UI.
