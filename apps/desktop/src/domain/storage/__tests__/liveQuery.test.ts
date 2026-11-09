import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { liveQuery } from 'dexie'
import { getDb, lockDb, resetLocalData } from '../db'
import { unlockTestDb } from './testKey'

const OPTS = { dbName: 'coco2-live-test', legacyDbName: 'coco-live-test-legacy' }

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for liveQuery emission')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('liveQuery through the encryption middleware', () => {
  beforeEach(async () => {
    await resetLocalData(OPTS)
    await unlockTestDb(OPTS)
  })
  afterEach(async () => {
    await lockDb()
    await resetLocalData(OPTS)
  })

  it('observers see puts and deletes (writes use a raw transaction, so the middleware announces them)', async () => {
    const db = getDb()
    const seen: unknown[] = []
    const sub = liveQuery(() => db.settings.get('live')).subscribe({ next: (v) => seen.push(v?.value ?? null) })
    try {
      await waitFor(() => seen.length >= 1)
      expect(seen.at(-1)).toBeNull()

      await db.settings.put({ key: 'live', value: 'eins' })
      await waitFor(() => seen.at(-1) === 'eins')

      await db.settings.put({ key: 'live', value: 'zwei' })
      await waitFor(() => seen.at(-1) === 'zwei')

      await db.settings.delete('live')
      await waitFor(() => seen.at(-1) === null && seen.length > 1)
    } finally {
      sub.unsubscribe()
    }
  })
})
