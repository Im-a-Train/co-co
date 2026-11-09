/**
 * Pure Web-Mercator (EPSG:3857) helpers for the GPX map: world pixels, fitting a track into a view at an
 * integer zoom level and listing the 256px XYZ tiles that cover the view. Framework-free and unit-tested.
 */
import type { GpxPoint } from './index'
import type { ProjectedPoint } from './gpxView'

export const TILE_SIZE = 256
/** Web-Mercator latitude limit. */
const MAX_LAT = 85.05112878

export interface MapView {
  zoom: number
  width: number
  height: number
  /** World pixel (at `zoom`) shown at the top-left corner of the view. */
  originX: number
  originY: number
}

export interface TileRef {
  z: number
  /** Wrapped tile column (0 <= x < 2^z). */
  x: number
  y: number
  /** Position of the tile's top-left corner inside the view. */
  px: number
  py: number
}

/** World pixel of a lon/lat at zoom z (origin top-left of the world, y down). */
export function lonLatToWorldPx(lon: number, lat: number, z: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** z
  const clat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  const s = Math.sin((clat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  }
}

/** Largest integer zoom (<= maxZoom) at which the track bbox fits into the view; the bbox is centered. */
export function fitView(points: GpxPoint[], width: number, height: number, pad = 16, maxZoom = 17): MapView {
  if (!points.length) return { zoom: 0, width, height, originX: 0, originY: 0 }
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const p of points) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLon = Math.min(minLon, p.lon)
    maxLon = Math.max(maxLon, p.lon)
  }
  const availW = Math.max(width - 2 * pad, 1)
  const availH = Math.max(height - 2 * pad, 1)
  let zoom = 0
  for (let z = Math.max(0, Math.floor(maxZoom)); z >= 0; z--) {
    const a = lonLatToWorldPx(minLon, maxLat, z)
    const b = lonLatToWorldPx(maxLon, minLat, z)
    if (b.x - a.x <= availW && b.y - a.y <= availH) {
      zoom = z
      break
    }
  }
  const a = lonLatToWorldPx(minLon, maxLat, zoom)
  const b = lonLatToWorldPx(maxLon, minLat, zoom)
  return { zoom, width, height, originX: (a.x + b.x) / 2 - width / 2, originY: (a.y + b.y) / 2 - height / 2 }
}

/** Points in view coordinates (same shape/order as projectTrack output). */
export function projectToView(points: GpxPoint[], view: MapView): ProjectedPoint[] {
  return points.map((p) => {
    const w = lonLatToWorldPx(p.lon, p.lat, view.zoom)
    return { x: w.x - view.originX, y: w.y - view.originY }
  })
}

/** Tiles covering the view. Columns wrap around the antimeridian; rows outside the world are skipped. */
export function tilesForView(view: MapView): TileRef[] {
  const n = 2 ** view.zoom
  const x0 = Math.floor(view.originX / TILE_SIZE)
  const x1 = Math.floor((view.originX + view.width - 1e-6) / TILE_SIZE)
  const y0 = Math.floor(view.originY / TILE_SIZE)
  const y1 = Math.floor((view.originY + view.height - 1e-6) / TILE_SIZE)
  const out: TileRef[] = []
  if (![x0, x1, y0, y1].every(Number.isFinite)) return out
  for (let ty = y0; ty <= y1; ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = x0; tx <= x1; tx++) {
      out.push({ z: view.zoom, x: ((tx % n) + n) % n, y: ty, px: tx * TILE_SIZE - view.originX, py: ty * TILE_SIZE - view.originY })
    }
  }
  return out
}
