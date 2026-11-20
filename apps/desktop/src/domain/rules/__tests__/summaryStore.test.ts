import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CampSummaryRecord } from '../../types'

const rows = new Map<string, CampSummaryRecord>()
vi.mock('../../storage/db', () => ({
  getDb: () => ({
    campSummaries: {
      get: async (k: string) => rows.get(k),
      put: async (r: CampSummaryRecord) => void rows.set(r.campIri, r),
    },
  }),
  newId: () => 'id',
  nowIso: () => 'now',
}))

import { saveCampProgress, saveCampSummary } from '../store'

const CAMP = '/api/camps/1'
const summary = (o: Partial<CampSummaryRecord> = {}): CampSummaryRecord => ({
  campIri: CAMP, title: 'Sola', start: null, end: null,
  counts: { must: 1, should: 0, hint: 0, overridden: 0 }, validJsDays: null, totalDays: null, evaluatedAt: 't', ...o,
})
const progress = { percent: 40, nextStep: 'triage', triageOpen: 3, openMust: 1, updatedAt: 't' }

describe('camp summary store', () => {
  beforeEach(() => rows.clear())

  it('saveCampProgress creates the base record when no summary exists yet', async () => {
    const { progress: _p, ...base } = summary()
    void _p
    expect(await saveCampProgress(CAMP, progress, base)).toBe(true)
    expect(rows.get(CAMP)).toMatchObject({ title: 'Sola', progress })
  })

  it('saveCampProgress needs an existing summary or a base', async () => {
    expect(await saveCampProgress(CAMP, progress)).toBe(false)
    expect(rows.size).toBe(0)
  })

  it('saveCampProgress merges into the summary', async () => {
    await saveCampSummary(summary())
    expect(await saveCampProgress(CAMP, progress)).toBe(true)
    expect(rows.get(CAMP)).toMatchObject({ title: 'Sola', progress })
  })

  it('a rewritten summary keeps the existing progress', async () => {
    await saveCampSummary(summary())
    await saveCampProgress(CAMP, progress)
    await saveCampSummary(summary({ counts: { must: 0, should: 2, hint: 0, overridden: 0 } }))
    expect(rows.get(CAMP)?.counts.should).toBe(2)
    expect(rows.get(CAMP)?.progress).toEqual(progress)
  })
})
