/**
 * Pure helpers for the GPX viewer: equirectangular fallback projection to SVG (the viewer itself uses Web-Mercator, see mapTiles.ts), cumulative distance,
 * elevation profile and nearest-point lookup. Framework-free and unit-tested.
 */
import { haversineM, type GpxPoint } from './index'

export interface ProjectedPoint {
  x: number
  y: number
}

export interface ProjectedTrack {
  /** One entry per input point (same order). */
  points: ProjectedPoint[]
  width: number
  height: number
}

/**
 * Equirectangular projection fitted into a width x height box (with padding). Longitude is scaled by
 * cos(mean latitude) so the shape is not stretched. North is up.
 */
export function projectTrack(points: GpxPoint[], width: number, height: number, pad = 16): ProjectedTrack {
  if (!points.length) return { points: [], width, height }
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
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const spanX = Math.max((maxLon - minLon) * k, 1e-9)
  const spanY = Math.max(maxLat - minLat, 1e-9)
  const availW = Math.max(width - 2 * pad, 1)
  const availH = Math.max(height - 2 * pad, 1)
  const scale = Math.min(availW / spanX, availH / spanY)
  const offX = pad + (availW - spanX * scale) / 2
  const offY = pad + (availH - spanY * scale) / 2
  return {
    width,
    height,
    points: points.map((p) => ({
      x: offX + (p.lon - minLon) * k * scale,
      y: offY + (maxLat - p.lat) * scale,
    })),
  }
}

/** Cumulative distance in km per point (segment starts do not bridge the gap). */
export function cumulativeKm(points: GpxPoint[]): number[] {
  const out: number[] = []
  let acc = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && !points[i]!.newSegment) acc += haversineM(points[i - 1]!, points[i]!) / 1000
    out.push(acc)
  }
  return out
}

export interface ProfilePoint {
  /** Index into the original points array. */
  index: number
  km: number
  ele: number
}

/** Points that have an elevation, with their cumulative distance. */
export function elevationProfile(points: GpxPoint[]): ProfilePoint[] {
  const km = cumulativeKm(points)
  const out: ProfilePoint[] = []
  points.forEach((p, i) => {
    if (p.ele !== null && Number.isFinite(p.ele)) out.push({ index: i, km: km[i]!, ele: p.ele })
  })
  return out
}

/** Index of the point whose cumulative km is closest to the given km (-1 for no points). */
export function nearestIndexByKm(cumKm: number[], km: number): number {
  if (!cumKm.length) return -1
  let lo = 0
  let hi = cumKm.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumKm[mid]! < km) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(cumKm[lo - 1]! - km) <= Math.abs(cumKm[lo]! - km)) return lo - 1
  return lo
}

/** Index of the projected point closest to (x, y) (-1 for no points). */
export function nearestIndexByXY(points: ProjectedPoint[], x: number, y: number): number {
  let best = -1
  let bestD = Infinity
  points.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** SVG path "d" strings, one per track segment. */
export function segmentPaths(points: ProjectedPoint[], source: GpxPoint[]): string[] {
  const out: string[] = []
  let cur: string[] = []
  const flush = () => {
    if (cur.length > 1) out.push(cur.join(' '))
    cur = []
  }
  points.forEach((p, i) => {
    if (source[i]?.newSegment) flush()
    cur.push(`${cur.length ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  })
  flush()
  return out
}

export interface ProfileScale {
  /** x/y in the profile box for each profile point. */
  xy: ProjectedPoint[]
  minEle: number
  maxEle: number
  totalKm: number
}

/** Fits the elevation profile into a width x height box (padding left/bottom for labels). */
export function scaleProfile(
  profile: ProfilePoint[],
  width: number,
  height: number,
  pad = { left: 36, right: 8, top: 8, bottom: 16 },
): ProfileScale {
  if (!profile.length) return { xy: [], minEle: 0, maxEle: 0, totalKm: 0 }
  const minEle = Math.min(...profile.map((p) => p.ele))
  const maxEle = Math.max(...profile.map((p) => p.ele))
  const totalKm = profile[profile.length - 1]!.km
  const w = Math.max(width - pad.left - pad.right, 1)
  const h = Math.max(height - pad.top - pad.bottom, 1)
  const eleSpan = Math.max(maxEle - minEle, 1)
  const kmSpan = Math.max(totalKm, 1e-9)
  return {
    minEle,
    maxEle,
    totalKm,
    xy: profile.map((p) => ({
      x: pad.left + (p.km / kmSpan) * w,
      y: pad.top + h - ((p.ele - minEle) / eleSpan) * h,
    })),
  }
}
