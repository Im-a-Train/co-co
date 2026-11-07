import { describe, expect, it } from 'vitest'
import type { CocoDb } from '../../storage/db'
import { AREA_OVERRIDES_KEY, getAreaOverrides, saveAreaOverrides, setAreaDismissed } from '../areaOverrides'

function fakeDb(): CocoDb & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>()
  return {
    rows,
    settings: {
      get: async (k: string) => (rows.has(k) ? { key: k, value: rows.get(k) } : undefined),
      put: async (r: { key: string; value: unknown }) => void rows.set(r.key, r.value),
    },
  } as unknown as CocoDb & { rows: Map<string, unknown> }
}

describe('setAreaDismissed', () => {
  it('adds, dedupes and removes', () => {
    const a = setAreaDismissed({}, 'x', 'wasser', true)
    expect(a).toEqual({ x: ['wasser'] })
    expect(setAreaDismissed(a, 'x', 'wasser', true)).toEqual({ x: ['wasser'] })
    expect(setAreaDismissed(a, 'x', 'berg', true)).toEqual({ x: ['wasser', 'berg'] })
    expect(setAreaDismissed(a, 'x', 'wasser', false)).toEqual({})
  })
})

describe('area overrides storage', () => {
  it('round-trips per camp and ignores junk', async () => {
    const db = fakeDb()
    expect(await getAreaOverrides('/c/1', db)).toEqual({})
    await saveAreaOverrides('/c/1', { a: ['wasser'] }, db)
    await saveAreaOverrides('/c/2', { b: ['berg'] }, db)
    expect(await getAreaOverrides('/c/1', db)).toEqual({ a: ['wasser'] })
    await saveAreaOverrides('/c/1', {}, db)
    expect(await getAreaOverrides('/c/1', db)).toEqual({})
    expect(await getAreaOverrides('/c/2', db)).toEqual({ b: ['berg'] })
    db.rows.set(AREA_OVERRIDES_KEY, { '/c/3': { a: ['quatsch', 'winter'], b: 'x' }, '/c/4': 7 })
    expect(await getAreaOverrides('/c/3', db)).toEqual({ a: ['winter'] })
    expect(await getAreaOverrides('/c/4', db)).toEqual({})
  })
})
