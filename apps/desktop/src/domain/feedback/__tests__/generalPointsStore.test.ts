import { describe, expect, it } from 'vitest'
import type { CocoDb } from '../../storage/db'
import { GENERAL_POINTS, visibleGeneralPoints } from '../defaults'
import { getHiddenGeneralPoints, hideGeneralPoint, restoreAllGeneralPoints } from '../generalPointsStore'

function fakeDb(initial?: unknown): CocoDb {
  const rows = new Map<string, unknown>()
  if (initial !== undefined) rows.set('feedback.hiddenGeneralPoints', initial)
  return {
    transaction: async (_m: string, _t: unknown, fn: () => Promise<unknown>) => fn(),
    settings: {
      get: async (k: string) => (rows.has(k) ? { key: k, value: rows.get(k) } : undefined),
      put: async (r: { key: string; value: unknown }) => void rows.set(r.key, r.value),
    },
  } as unknown as CocoDb
}

describe('visibleGeneralPoints', () => {
  it('filters hidden ids and keeps order', () => {
    expect(visibleGeneralPoints([])).toHaveLength(GENERAL_POINTS.length)
    const v = visibleGeneralPoints(['siko', 'nope'])
    expect(v.map((p) => p.id)).not.toContain('siko')
    expect(v).toHaveLength(GENERAL_POINTS.length - 1)
  })
})

describe('general points store', () => {
  it('hides and restores per camp', async () => {
    const db = fakeDb()
    expect(await getHiddenGeneralPoints('/c/1', db)).toEqual([])
    await hideGeneralPoint('/c/1', 'siko', db)
    await hideGeneralPoint('/c/1', 'siko', db)
    await hideGeneralPoint('/c/1', 'psa', db)
    await hideGeneralPoint('/c/2', 'wetter', db)
    expect(await getHiddenGeneralPoints('/c/1', db)).toEqual(['siko', 'psa'])
    expect(await getHiddenGeneralPoints('/c/2', db)).toEqual(['wetter'])
    await restoreAllGeneralPoints('/c/1', db)
    expect(await getHiddenGeneralPoints('/c/1', db)).toEqual([])
    expect(await getHiddenGeneralPoints('/c/2', db)).toEqual(['wetter'])
  })
  it('ignores junk', async () => {
    const db = fakeDb({ '/c/1': ['a', 3], '/c/2': 'x' })
    expect(await getHiddenGeneralPoints('/c/1', db)).toEqual(['a'])
    expect(await getHiddenGeneralPoints('/c/2', db)).toEqual([])
  })
})
