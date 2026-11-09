import { describe, expect, it } from 'vitest'
import { fitView, lonLatToWorldPx, projectToView, tilesForView } from '../mapTiles'
import type { GpxPoint } from '../index'

const pt = (lat: number, lon: number): GpxPoint => ({ lat, lon, ele: null }) as GpxPoint

describe('mapTiles', () => {
  it('projects lon/lat to world pixels', () => {
    expect(lonLatToWorldPx(0, 0, 0)).toEqual({ x: 128, y: 128 })
    const bern = lonLatToWorldPx(7.4474, 46.948, 10)
    expect(Math.floor(bern.x / 256)).toBe(533)
    expect(Math.floor(bern.y / 256)).toBe(360)
  })

  it('fits the track at the largest zoom and centers it', () => {
    const pts = [pt(46.94, 7.43), pt(46.96, 7.47)]
    const v = fitView(pts, 600, 340)
    const proj = projectToView(pts, v)
    for (const p of proj) {
      expect(p.x).toBeGreaterThanOrEqual(16 - 1e-6)
      expect(p.x).toBeLessThanOrEqual(584 + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(16 - 1e-6)
      expect(p.y).toBeLessThanOrEqual(324 + 1e-6)
    }
    expect((proj[0]!.x + proj[1]!.x) / 2).toBeCloseTo(300, 4)
    expect((proj[0]!.y + proj[1]!.y) / 2).toBeCloseTo(170, 4)
    const bigger = projectToView(pts, { ...v, zoom: v.zoom + 1, originX: 0, originY: 0 })
    const w = Math.abs(bigger[1]!.x - bigger[0]!.x)
    const h = Math.abs(bigger[1]!.y - bigger[0]!.y)
    expect(w > 568 || h > 308).toBe(true)
  })

  it('caps the zoom for a single point', () => {
    expect(fitView([pt(46.9, 7.4)], 600, 340).zoom).toBe(17)
    expect(fitView([pt(46.9, 7.4)], 600, 340, 16, 12).zoom).toBe(12)
  })

  it('lists tiles covering the view', () => {
    const v = fitView([pt(46.94, 7.43), pt(46.96, 7.47)], 600, 340)
    const tiles = tilesForView(v)
    expect(tiles.length).toBeGreaterThan(0)
    for (const t of tiles) {
      expect(t.z).toBe(v.zoom)
      expect(t.px).toBeGreaterThan(-256)
      expect(t.px).toBeLessThan(600)
      expect(t.py).toBeGreaterThan(-256)
      expect(t.py).toBeLessThan(340)
    }
  })

  it('wraps x and skips rows outside the world', () => {
    const tiles = tilesForView({ zoom: 1, width: 600, height: 600, originX: -100, originY: -100 })
    expect(tiles.every((t) => t.x >= 0 && t.x < 2 && t.y >= 0 && t.y < 2)).toBe(true)
    expect(tiles.some((t) => t.x === 1 && t.px < 0)).toBe(true)
    expect(tilesForView({ zoom: 0, width: 10, height: 10, originX: NaN, originY: 0 })).toEqual([])
  })
})
