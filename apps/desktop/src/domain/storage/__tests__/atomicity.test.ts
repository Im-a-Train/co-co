import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, lockDb, resetLocalData } from '../db'
import { exportAll, importAll, importWithRollback, storeFromDb, type BackupStore } from '../../backup'
import { startRound, listRounds, getSnapshot } from '../../rounds/store'
import { makeFacts } from '../../rounds/__tests__/factsFixture'
import { unlockTestDb } from './testKey'
import { EXPORT_FORMAT, EXPORT_VERSION, type CocoExport } from '../../types'

const OPTS = { dbName: 'coco2-atomic-test', legacyDbName: 'coco-atomic-test' }

beforeEach(async () => {
  await resetLocalData(OPTS)
  await unlockTestDb(OPTS)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await lockDb()
})

async function tablesOf() {
  return (await exportAll()).tables
}

const exportOf = (tables: Record<string, unknown[]>): CocoExport => ({
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exportedAt: new Date().toISOString(),
  appVersion: 't',
  tables,
})

describe('backup replace-import rollback', () => {
  it('restores the pre-import state when the import fails mid-way', async () => {
    const db = getDb()
    await db.coachInputs.put({ campIri: '/api/camps/1', keep: true } as never)
    await db.feedback.put({ id: 'fb1', campIri: '/api/camps/1' } as never)
    await db.mappings.put({ campIri: '/api/camps/1', m: 1 } as never)
    const before = await tablesOf()

    const incoming = exportOf({
      coachInputs: [{ campIri: '/api/camps/9', other: true }],
      feedback: [{ id: 'fbX', campIri: '/api/camps/9' }],
      mappings: [{ campIri: '/api/camps/9' }],
    })
    const real = storeFromDb(db)
    let failed = false // fail only the import write, not the restore
    const mappings = {
      ...real.mappings,
      bulkPut: (rows: unknown[]) => {
        if (failed) return real.mappings.bulkPut(rows)
        failed = true
        return Promise.reject(new Error('boom'))
      },
    }
    const store: BackupStore = { ...real, mappings }
    await expect(importWithRollback(store, incoming, 'replace')).rejects.toThrow(/wiederhergestellt/)
    expect(await tablesOf()).toEqual(before)
  })

  it('rejects an invalid file before touching anything', async () => {
    await getDb().coachInputs.put({ campIri: '/api/camps/1' } as never)
    const before = await tablesOf()
    const bad = exportOf({ coachInputs: [{ nope: 1 }] })
    await expect(importAll(bad, 'replace')).rejects.toThrow()
    expect(await tablesOf()).toEqual(before)
  })

  it('still imports normally', async () => {
    const report = await importAll(exportOf({ coachInputs: [{ campIri: '/api/camps/9' }] }), 'replace')
    expect(report.written.coachInputs).toBe(1)
    expect((await getDb().coachInputs.toArray()).map((r) => r.campIri)).toEqual(['/api/camps/9'])
  })
})

describe('startRound failure leaves no half round', () => {
  it('removes snapshot and new round when closing the previous round fails', async () => {
    const facts = makeFacts()
    const first = await startRound(facts)
    const db = getDb()
    const origPut = db.rounds.put.bind(db.rounds)
    let calls = 0
    vi.spyOn(db.rounds, 'put').mockImplementation(((...a: Parameters<typeof origPut>) => {
      calls++
      // 1st call = new round row, 2nd = closing the previous round
      return calls === 2 ? Promise.reject(new Error('boom')) : origPut(...a)
    }) as typeof origPut)
    await expect(startRound(facts)).rejects.toThrow('boom')
    vi.restoreAllMocks()
    const rounds = await listRounds(facts.camp.iri)
    expect(rounds.map((r) => r.id)).toEqual([first.id])
    expect(rounds[0].closedAt ?? null).toBeNull()
    expect(await db.snapshots.count()).toBe(1)
    expect(await getSnapshot(first.snapshotId)).not.toBeNull()
  })

  it('writes nothing when the snapshot write fails', async () => {
    const facts = makeFacts()
    const db = getDb()
    vi.spyOn(db.snapshots, 'put').mockRejectedValue(new Error('boom'))
    await expect(startRound(facts)).rejects.toThrow('boom')
    vi.restoreAllMocks()
    expect(await listRounds(facts.camp.iri)).toEqual([])
    expect(await db.snapshots.count()).toBe(0)
  })
})
