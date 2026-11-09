import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { decryptJson, encryptJson, importDataKey, makeAad } from '../crypto'
import { DecryptError, LockedError, TABLE_NAMES, getDb, isUnlocked, lockDb, resetLocalData, unlockDb } from '../db'
import { testKeyBytes, unlockTestDb } from './testKey'

const OPTS = { dbName: 'coco2-enc-test', legacyDbName: 'coco-enc-test-legacy' }
const MARKER = 'GEHEIM-MARKER-4711'

/** Reads every raw row of every table, bypassing Dexie's middleware, as one big string. */
async function rawDump(dbName: string): Promise<string> {
  const raw = new Dexie(dbName)
  await raw.open()
  try {
    const parts: string[] = []
    for (const t of raw.tables) {
      for (const row of await t.toArray()) {
        parts.push(JSON.stringify(row, (_k, v) => (v instanceof Uint8Array ? 'u8:' + Buffer.from(v).toString('latin1') : v)))
      }
    }
    return parts.join('\n')
  } finally {
    raw.close()
  }
}

async function rawRows(dbName: string, table: string): Promise<Record<string, unknown>[]> {
  const raw = new Dexie(dbName)
  await raw.open()
  try {
    return (await raw.table(table).toArray()) as Record<string, unknown>[]
  } finally {
    raw.close()
  }
}

const samples: Record<string, Record<string, unknown>> = {
  settings: { key: 'app', value: { note: MARKER } },
  coachInputs: { campIri: '/api/camps/1', note: MARKER },
  mappings: { campIri: '/api/camps/1', note: MARKER },
  overrides: { id: 'o1', campIri: '/api/camps/1', findingId: 'f1', ruleId: 'r', note: MARKER },
  campSummaries: { campIri: '/api/camps/1', note: MARKER },
  feedback: { id: 'fb1', campIri: '/api/camps/1', text: MARKER, status: 'draft', updatedAt: 'x' },
  reviews: { campIri: '/api/camps/1', status: 'open', note: MARKER },
  rounds: { id: 'r1', campIri: '/api/camps/1', number: 1, note: MARKER },
  snapshots: { id: 's1', campIri: '/api/camps/1', roundId: 'r1', facts: { title: MARKER } },
  documents: { id: 'd1', campIri: '/api/camps/1', path: 'C:/' + MARKER + '.pdf', text: MARKER },
  watchedFolders: { id: 'w1', campIri: '/api/camps/1', path: 'C:/' + MARKER },
  aiLog: { at: '2026-01-02T00:00:00Z', feature: MARKER, campIri: '/api/camps/1' },
  midata: { campIri: '/api/camps/1', note: MARKER },
  nds: { campIri: '/api/camps/1', note: MARKER },
  selfChecks: { id: 'sc1', campIri: '/api/camps/1', createdAt: 'x', title: MARKER },
  campRuleConfig: { campIri: '/api/camps/1', modules: { js: 'on' }, note: MARKER },
  resources: { key: 'MAN', title: MARKER, origin: 'bundled', modified: true },
  ruleEdits: { ruleId: 'BP-VAR-01', patch: { title: MARKER }, baseVersion: '1.0.0' },
}

beforeEach(async () => {
  await resetLocalData(OPTS)
})
afterEach(async () => {
  await lockDb()
})

describe('crypto envelope', () => {
  it('roundtrips and binds the AAD', async () => {
    const key = await importDataKey(testKeyBytes())
    const env = await encryptJson(key, { a: 1 }, makeAad('t', 'k1'))
    expect(await decryptJson(key, env, makeAad('t', 'k1'))).toEqual({ a: 1 })
    await expect(decryptJson(key, env, makeAad('t', 'k2'))).rejects.toBeInstanceOf(DecryptError)
    await expect(decryptJson(key, env, makeAad('u', 'k1'))).rejects.toBeInstanceOf(DecryptError)
  })

  it('zeroes the key bytes and the key is not extractable', async () => {
    const bytes = testKeyBytes()
    const key = await importDataKey(bytes)
    expect(bytes.every((b) => b === 0)).toBe(true)
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toBeTruthy()
  })

  it('uses a fresh IV per write', async () => {
    const key = await importDataKey(testKeyBytes())
    const a = await encryptJson(key, 'x', makeAad('t', 1))
    const b = await encryptJson(key, 'x', makeAad('t', 1))
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false)
  })
})

describe('encrypted db', () => {
  it('roundtrips every table and hides content in the raw database', async () => {
    await unlockTestDb(OPTS)
    const db = getDb()
    expect(Object.keys(samples).sort()).toEqual([...TABLE_NAMES].sort())
    for (const name of TABLE_NAMES) await db.table(name).put(samples[name])
    for (const name of TABLE_NAMES) {
      const rows = (await db.table(name).toArray()).filter((r) => !(name === 'settings' && String(r.key).startsWith('_')))
      expect(rows, name).toHaveLength(1)
      const expected = name === 'aiLog' ? { ...samples[name], id: 1 } : samples[name]
      expect(rows[0], name).toEqual(expected)
    }
    await lockDb()
    const dump = await rawDump(OPTS.dbName)
    expect(dump).not.toContain(MARKER)
    expect(dump).not.toContain('draft')
    const raw = await rawRows(OPTS.dbName, 'documents')
    expect(Object.keys(raw[0]).sort()).toEqual(['_enc', 'campIri', 'id'])
  })

  it('keeps get/getMany/where/compound/orderBy/count/modify working', async () => {
    await unlockTestDb(OPTS)
    const db = getDb()
    await db.rounds.bulkPut([
      { id: 'a', campIri: 'c1', number: 2, n: 'x' },
      { id: 'b', campIri: 'c1', number: 1, n: 'y' },
      { id: 'c', campIri: 'c2', number: 1, n: 'z' },
    ] as never)
    expect((await db.rounds.where('campIri').equals('c1').toArray()).map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(((await db.rounds.where('[campIri+number]').equals(['c1', 2]).first()) as unknown as { n: string }).n).toBe('x')
    expect((await db.rounds.get('c'))).toMatchObject({ n: 'z' })
    expect((await db.rounds.bulkGet(['a', 'zz', 'b'])).map((r) => (r as { id: string } | undefined)?.id)).toEqual(['a', undefined, 'b'])
    expect(await db.rounds.where('campIri').equals('c1').count()).toBe(2)
    // cursor path (filter) and reverse sort
    expect((await db.rounds.where('campIri').equals('c1').and((r) => (r as unknown as { n: string }).n === 'y').toArray()).map((r) => r.id)).toEqual(['b'])
    expect((await db.rounds.orderBy('campIri').reverse().toArray()).map((r) => r.id)[0]).toBe('c')
    // update/modify (get -> encrypt -> put) keeps encrypted fields
    await db.rounds.update('a', { n: 'changed' } as never)
    expect(await db.rounds.get('a')).toMatchObject({ n: 'changed', number: 2 })
    await db.rounds.where('campIri').equals('c1').modify({ extra: 1 } as never)
    expect(await db.rounds.get('b')).toMatchObject({ extra: 1, n: 'y' })
    await db.rounds.delete('a')
    expect(await db.rounds.get('a')).toBeUndefined()
    // findingId index on overrides
    await db.overrides.put({ id: 'o', campIri: 'c1', findingId: 'f', x: 1 } as never)
    expect(await db.overrides.where('findingId').equals('f').and((o) => o.campIri === 'c1').toArray()).toHaveLength(1)
  })

  it('aiLog: auto-increment ids and orderBy(at)', async () => {
    await unlockTestDb(OPTS)
    const db = getDb()
    await db.aiLog.add({ at: '2026-01-01', feature: 'a' } as never)
    await db.aiLog.add({ at: '2026-03-01', feature: 'c' } as never)
    await db.aiLog.add({ at: '2026-02-01', feature: 'b' } as never)
    const latest = await db.aiLog.orderBy('at').reverse().limit(2).toArray()
    expect(latest.map((r) => (r as unknown as { feature: string }).feature)).toEqual(['c', 'b'])
    expect(typeof latest[0].id).toBe('number')
  })

  it('transactions: read-modify-write works and rw scopes are serialised', async () => {
    await unlockTestDb(OPTS)
    const db = getDb()
    await db.settings.put({ key: 'n', value: 0 })
    await Promise.all(
      Array.from({ length: 5 }, () =>
        db.transaction('rw', db.settings, async () => {
          const cur = (await db.settings.get('n'))!.value as number
          await db.settings.put({ key: 'n', value: cur + 1 })
        }),
      ),
    )
    expect((await db.settings.get('n'))!.value).toBe(5)
  })

  it('rejects a row moved to another key (AAD swap) and another table', async () => {
    await unlockTestDb(OPTS)
    const db = getDb()
    await db.feedback.put({ id: 'one', campIri: 'c', text: 'a' } as never)
    await lockDb()
    // copy the raw row under another primary key, bypassing the middleware
    const raw = new Dexie(OPTS.dbName)
    await raw.open()
    const row = (await raw.table('feedback').get('one')) as Record<string, unknown>
    await raw.table('feedback').put({ ...row, id: 'two' })
    await raw.table('documents').put({ ...row, id: 'one' })
    raw.close()
    await unlockTestDb(OPTS)
    const db2 = getDb()
    expect(await db2.feedback.get('one')).toMatchObject({ text: 'a' })
    await expect(db2.feedback.get('two')).rejects.toBeInstanceOf(DecryptError)
    await expect(db2.documents.get('one')).rejects.toBeInstanceOf(DecryptError)
    await expect(db2.feedback.toArray()).rejects.toBeInstanceOf(DecryptError)
  })

  it('wrong key -> DecryptError on unlock, and stays locked', async () => {
    await unlockTestDb(OPTS, 1)
    await getDb().feedback.put({ id: 'x', campIri: 'c', text: 't' } as never)
    await lockDb()
    await expect(unlockTestDb(OPTS, 2)).rejects.toBeInstanceOf(DecryptError)
    expect(isUnlocked()).toBe(false)
    await unlockTestDb(OPTS, 1)
    expect(await getDb().feedback.get('x')).toMatchObject({ text: 't' })
  })

  it('wrong key is detected even without the canary row when other rows exist', async () => {
    await unlockTestDb(OPTS, 1)
    await getDb().feedback.put({ id: 'x', campIri: 'c', text: 't' } as never)
    await getDb().settings.delete('_canary')
    await lockDb()
    await expect(unlockTestDb(OPTS, 2)).rejects.toBeInstanceOf(DecryptError)
  })

  it('getDb() throws LockedError when locked; lock then unlock keeps data', async () => {
    expect(() => getDb()).toThrow(LockedError)
    await unlockTestDb(OPTS)
    const stale = getDb()
    await getDb().coachInputs.put({ campIri: 'c', a: 1 } as never)
    await lockDb()
    expect(isUnlocked()).toBe(false)
    expect(() => getDb()).toThrow(LockedError)
    await expect(stale.coachInputs.get('c')).rejects.toBeTruthy() // closed handle never serves data
    await unlockTestDb(OPTS)
    expect(await getDb().coachInputs.get('c')).toMatchObject({ a: 1 })
    expect((await unlockDb(testKeyBytes(), OPTS)).migrated).toBe(false) // re-unlock while unlocked is fine
  })

  it('encrypts and decrypts a ~2 MB document text quickly', async () => {
    await unlockTestDb(OPTS)
    const db = getDb()
    const text = 'Lagerbericht mit Umlauten äöü. '.repeat(70_000) // ~2.2 MB
    const t0 = performance.now()
    await db.documents.put({ id: 'big', campIri: 'c', text } as never)
    const t1 = performance.now()
    const back = (await db.documents.get('big')) as unknown as { text: string }
    const t2 = performance.now()
    expect(back.text).toBe(text)
    console.info(`2 MB document: write+encrypt ${(t1 - t0).toFixed(0)} ms, read+decrypt ${(t2 - t1).toFixed(0)} ms`)
  })
})
