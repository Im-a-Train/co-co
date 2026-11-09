import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { TABLE_NAMES, getDb, lockDb, resetLocalData } from '../db'
import { LegacyCocoDb } from '../legacyDb'
import { MIGRATION_KEY, migrateLegacy } from '../migrate'
import { unlockTestDb } from './testKey'

const OPTS = { dbName: 'coco2-mig-test', legacyDbName: 'coco-mig-test' }
const CAMP = '/api/camps/1'

async function seedLegacy(): Promise<Record<string, number>> {
  const legacy = new LegacyCocoDb(OPTS.legacyDbName)
  await legacy.open()
  const many = Array.from({ length: 250 }, (_, i) => ({ id: 'doc' + i, campIri: CAMP, path: '/p' + i, contentHash: 'h' + i, folder: 'f', text: 'text ' + i }))
  await legacy.settings.bulkPut([
    { key: 'app', value: { ai: { enabled: false } } },
    { key: 'ruleState', value: { disabled: ['x'] } },
  ])
  await legacy.coachInputs.put({ campIri: CAMP, a: 1 } as never)
  await legacy.mappings.put({ campIri: CAMP, m: 1 } as never)
  await legacy.overrides.put({ id: 'o1', campIri: CAMP, findingId: 'f', ruleId: 'r' } as never)
  await legacy.campSummaries.put({ campIri: CAMP } as never)
  await legacy.feedback.put({ id: 'fb', campIri: CAMP, activityIri: 'a', roundId: 'r', status: 'draft', updatedAt: 'u' } as never)
  await legacy.reviews.put({ campIri: CAMP, status: 'open' } as never)
  await legacy.rounds.bulkPut([
    { id: 'r1', campIri: CAMP, number: 1 },
    { id: 'r2', campIri: CAMP, number: 2 },
  ] as never)
  await legacy.snapshots.put({ id: 's1', campIri: CAMP, roundId: 'r1' } as never)
  await legacy.documents.bulkPut(many as never)
  await legacy.watchedFolders.put({ id: 'w', campIri: CAMP, path: '/w' } as never)
  await legacy.aiLog.bulkAdd([{ at: 't1', feature: 'f', campIri: CAMP }, { at: 't2', feature: 'f', campIri: CAMP }] as never)
  await legacy.midata.put({ campIri: CAMP } as never)
  await legacy.nds.put({ campIri: CAMP } as never)
  await legacy.selfChecks.put({ id: 'sc', campIri: CAMP, createdAt: 'c' } as never)
  await legacy.campRuleConfig.put({ campIri: CAMP, modules: { js: 'on' } } as never)
  const counts: Record<string, number> = {}
  for (const n of TABLE_NAMES) counts[n] = await legacy.table(n).count()
  legacy.close()
  return counts
}

async function userCount(name: string): Promise<number> {
  const keys = await getDb().table(name).toCollection().primaryKeys()
  return keys.filter((k) => !String(k).startsWith('_')).length
}

beforeEach(async () => {
  await resetLocalData(OPTS)
})
afterEach(async () => {
  await lockDb()
})

describe('legacy migration', () => {
  it('is a no-op without a legacy database', async () => {
    expect(await unlockTestDb(OPTS)).toEqual({ migrated: false })
  })

  it('copies all 16 tables, verifies counts and deletes the legacy database; second run is a no-op', async () => {
    const counts = await seedLegacy()
    expect(Object.values(counts).every((n) => n > 0)).toBe(true)
    expect(await unlockTestDb(OPTS)).toEqual({ migrated: true })
    for (const n of TABLE_NAMES) expect(await userCount(n), n).toBe(counts[n])
    expect(await getDb().documents.get('doc249')).toMatchObject({ text: 'text 249', path: '/p249' })
    expect(await getDb().rounds.where('[campIri+number]').equals([CAMP, 2]).count()).toBe(1)
    expect(await Dexie.exists(OPTS.legacyDbName)).toBe(false)
    expect(await getDb().settings.get(MIGRATION_KEY)).toBeUndefined()
    await lockDb()
    expect(await unlockTestDb(OPTS)).toEqual({ migrated: false })
    for (const n of TABLE_NAMES) expect(await userCount(n), n).toBe(counts[n])
  })

  it('migrates a legacy database that never reached v5 (no campRuleConfig table)', async () => {
    // A plaintext 'coco' at schema v4, as written by builds before rules v2.
    const v4 = new Dexie(OPTS.legacyDbName)
    v4.version(1).stores({
      settings: 'key', coachInputs: 'campIri', mappings: 'campIri', overrides: 'id, campIri, findingId, ruleId',
      campSummaries: 'campIri', feedback: 'id, campIri, activityIri, roundId, status, updatedAt', reviews: 'campIri, status',
      rounds: 'id, campIri, [campIri+number]', snapshots: 'id, campIri, roundId',
      documents: 'id, campIri, path, contentHash, folder, [campIri+path]', watchedFolders: 'id, campIri, &path',
      aiLog: '++id, at, feature, campIri',
    })
    v4.version(2).stores({ midata: 'campIri' })
    v4.version(3).stores({ nds: 'campIri' })
    v4.version(4).stores({ selfChecks: 'id, campIri, createdAt' })
    await v4.open()
    await v4.table('feedback').put({ id: 'fb', campIri: CAMP })
    v4.close()
    expect(await unlockTestDb(OPTS)).toEqual({ migrated: true })
    expect(await getDb().feedback.get('fb')).toMatchObject({ campIri: CAMP })
    expect(await getDb().campRuleConfig.count()).toBe(0)
    expect(await Dexie.exists(OPTS.legacyDbName)).toBe(false)
  })

  it('resumes after an interruption and keeps the legacy database until the end', async () => {
    const counts = await seedLegacy()
    await unlockTestDb({ ...OPTS, legacyDbName: 'does-not-exist' }) // open coco2 first, then migrate by hand
    const db = getDb()
    let seen = 0
    await expect(
      migrateLegacy(db, {
        legacyName: OPTS.legacyDbName,
        afterTable: () => {
          if (++seen === 6) throw new Error('boom')
        },
      }),
    ).rejects.toThrow('boom')
    expect(await Dexie.exists(OPTS.legacyDbName)).toBe(true) // legacy still there
    const progress = (await db.settings.get(MIGRATION_KEY))!.value as { done: Record<string, number> }
    expect(Object.keys(progress.done)).toEqual(TABLE_NAMES.slice(0, 6))
    const copied: string[] = []
    expect(await migrateLegacy(db, { legacyName: OPTS.legacyDbName, afterTable: (n) => void copied.push(n) })).toEqual({ migrated: true })
    expect(copied).toEqual(TABLE_NAMES.slice(6)) // finished tables are not copied again
    for (const n of TABLE_NAMES) expect(await userCount(n), n).toBe(counts[n])
    expect(await Dexie.exists(OPTS.legacyDbName)).toBe(false)
    expect(await migrateLegacy(db, { legacyName: OPTS.legacyDbName })).toEqual({ migrated: false })
  })

  it('stores the migrated content encrypted', async () => {
    await seedLegacy()
    await unlockTestDb(OPTS)
    await lockDb()
    const raw = new Dexie(OPTS.dbName)
    await raw.open()
    const doc = (await raw.table('documents').get('doc1')) as Record<string, unknown>
    raw.close()
    expect(doc.text).toBeUndefined()
    expect(doc.path).toBeUndefined()
    expect(doc._enc).toBeTruthy()
  })
})
