import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listFeedback, saveFeedback } from '@/domain/feedback/store'
import type { FeedbackItem } from '@/domain/types'
import { lockDb, resetLocalData } from '../db'
import { subscribeLive } from '../live'
import { unlockTestDb } from './testKey'

const OPTS = { dbName: 'coco2-live-helper-test', legacyDbName: 'coco-live-helper-test-legacy' }
const CAMP = '/api/camps/live1'

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for a live emission')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const item = (id: string, campIri = CAMP): FeedbackItem => ({
  id,
  campIri,
  scope: 'camp',
  kind: 'suggestion',
  text: `Text ${id}`,
  status: 'draft',
  createdAt: `2026-11-16T00:00:0${id.length}Z`,
  updatedAt: '2026-11-16T00:00:00Z',
})

describe('subscribeLive', () => {
  beforeEach(async () => {
    await resetLocalData(OPTS)
    await unlockTestDb(OPTS)
  })
  afterEach(async () => {
    await lockDb()
    await resetLocalData(OPTS)
  })

  it('emits the current list and again after another handle writes (header progress stays current)', async () => {
    const seen: string[][] = []
    const stop = subscribeLive(
      () => listFeedback(CAMP),
      (v) => seen.push(v.map((i) => i.id)),
    )
    try {
      await waitFor(() => seen.length >= 1)
      expect(seen.at(-1)).toEqual([])
      await saveFeedback(item('a'))
      await waitFor(() => seen.at(-1)?.length === 1)
      expect(seen.at(-1)).toEqual(['a'])
      await saveFeedback(item('bb'))
      await waitFor(() => seen.at(-1)?.length === 2)
      expect(seen.at(-1)).toEqual(['a', 'bb'])
    } finally {
      stop()
    }
    const before = seen.length
    await saveFeedback(item('ccc'))
    await new Promise((r) => setTimeout(r, 100))
    expect(seen.length).toBe(before)
  })

  it('returns a no-op unsubscribe when the query cannot run', async () => {
    await lockDb()
    const seen: unknown[] = []
    const stop = subscribeLive(
      () => listFeedback(CAMP),
      (v) => seen.push(v),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([])
    stop()
  })
})
