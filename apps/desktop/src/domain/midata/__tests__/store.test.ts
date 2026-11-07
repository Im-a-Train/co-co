import { describe, expect, it } from 'vitest'
import type { CocoDb } from '../../storage/db'
import type { MidataAggregate, MidataRecord } from '../../types'
import { clearMidata, getMidataRecord, saveMidataAggregate, saveMidataLink } from '../store'

/** No fake-indexeddb in the project: a Map-backed stand-in for the `midata` table. */
function fakeDb(): CocoDb {
  const rows = new Map<string, MidataRecord>()
  return {
    midata: {
      get: async (k: string) => rows.get(k),
      put: async (r: MidataRecord) => void rows.set(r.campIri, r),
      delete: async (k: string) => void rows.delete(k),
    },
  } as unknown as CocoDb
}

const agg = (eventId: string): MidataAggregate => ({ zone: 'red-derived', eventId, fetchedAt: 't' }) as unknown as MidataAggregate
const CAMP = '/api/camps/1'

describe('midata store', () => {
  it('returns null when nothing stored', async () => {
    expect(await getMidataRecord(CAMP, fakeDb())).toBeNull()
  })

  it('saves a link tagged red-derived', async () => {
    const db = fakeDb()
    const r = await saveMidataLink(CAMP, '42', 'ecamp', db)
    expect(r).toMatchObject({ zone: 'red-derived', eventId: '42', eventSource: 'ecamp', aggregate: null })
    expect(await getMidataRecord(CAMP, db)).toEqual(r)
  })

  it('same event keeps the aggregate, a different event drops it', async () => {
    const db = fakeDb()
    await saveMidataLink(CAMP, '42', 'manual', db)
    await saveMidataAggregate(CAMP, agg('42'), db)
    expect((await saveMidataLink(CAMP, '42', 'manual', db)).aggregate).not.toBeNull()
    const r = await saveMidataLink(CAMP, '43', 'manual', db)
    expect(r.aggregate).toBeNull()
    expect(r.eventId).toBe('43')
  })

  it('aggregate must match the linked event', async () => {
    const db = fakeDb()
    await saveMidataLink(CAMP, '42', 'ecamp', db)
    await expect(saveMidataAggregate(CAMP, agg('99'), db)).rejects.toThrow(/anderen Anlass/)
    const r = await saveMidataAggregate(CAMP, agg('42'), db)
    expect(r).toMatchObject({ eventSource: 'ecamp', zone: 'red-derived' })
  })

  it('creates a manual record when none exists', async () => {
    const r = await saveMidataAggregate(CAMP, agg('7'), fakeDb())
    expect(r).toMatchObject({ eventId: '7', eventSource: 'manual', zone: 'red-derived' })
    expect(r.aggregate?.eventId).toBe('7')
  })

  it('clear removes the record', async () => {
    const db = fakeDb()
    await saveMidataLink(CAMP, '1', 'manual', db)
    await clearMidata(CAMP, db)
    expect(await getMidataRecord(CAMP, db)).toBeNull()
  })
})
