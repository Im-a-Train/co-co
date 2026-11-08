/**
 * Dexie DBCore middleware that encrypts every row at rest (ADR 0009).
 *
 * Stored row = { <plaintext allowlist fields incl. primary key>, _enc: { v, iv, ct } }.
 * Reads decrypt and merge; failures throw DecryptError (never empty data), a dropped key throws LockedError.
 *
 * IndexedDB constraint that shapes this file: WebCrypto is asynchronous and an IDB transaction auto-commits
 * when it has no pending request. So (1) writes are encrypted FIRST and then run in a fresh transaction obtained
 * from the layer below (the transaction Dexie opened for the call is left unused), (2) reads decrypt after the
 * raw read finished, (3) cursors are materialised (all raw entries read synchronously, then decrypted) and
 * served from memory, (4) `CocoDb.transaction()` does not open a real IDB transaction (see db.ts).
 */
import Dexie from 'dexie'
import type { DBCore, DBCoreCursor, DBCoreMutateRequest, DBCoreOpenCursorRequest, DBCoreTable } from 'dexie'
import { decryptJson, encryptJson, makeAad } from './crypto'
import { LockedError } from './errors'
import type { TableEncryptionConfig } from './encryptionConfig'

export type KeyHolder = { key: CryptoKey | null }

const ENV = '_enc'

type Row = Record<string, unknown>

export function createEncryptionMiddleware(holder: KeyHolder, config: Readonly<Record<string, TableEncryptionConfig>>) {
  const getKey = (): CryptoKey => {
    if (!holder.key) throw new LockedError()
    return holder.key
  }

  return {
    stack: 'dbcore' as const,
    name: 'encryption',
    level: 20,
    create(down: DBCore): DBCore {
      return {
        ...down,
        table(tableName: string): DBCoreTable {
          const t = down.table(tableName)
          const cfg = config[tableName]
          if (!cfg) throw new Error(`No encryption config for table "${tableName}"`)
          const pkIndex = t.schema.primaryKey
          const pkPaths = pkIndex.keyPath == null ? [] : Array.isArray(pkIndex.keyPath) ? pkIndex.keyPath : [pkIndex.keyPath]
          const plain = new Set<string>([...cfg.plain, ...pkPaths])
          // Auto-increment keys do not exist yet while encrypting an add, so they are not part of the AAD.
          const aadFor = (row: Row, explicitKey?: unknown): Uint8Array =>
            makeAad(tableName, pkIndex.autoIncrement ? '' : explicitKey !== undefined ? explicitKey : pkIndex.extractKey?.(row))

          const encryptRow = async (row: Row, explicitKey?: unknown): Promise<Row> => {
            const key = getKey()
            const out: Row = {}
            const rest: Row = {}
            for (const [k, v] of Object.entries(row)) (plain.has(k) ? out : rest)[k] = v
            out[ENV] = await encryptJson(key, rest, aadFor(row, explicitKey))
            return out
          }
          const decryptRow = async (row: Row | undefined | null): Promise<Row | undefined | null> => {
            if (row === undefined || row === null) return row
            const key = getKey()
            const { [ENV]: env, ...visible } = row
            const rest = (await decryptJson(key, env, aadFor(row))) as Row
            return { ...rest, ...visible }
          }
          const decryptAll = (rows: Row[]) => Promise.all(rows.map((r) => decryptRow(r) as Promise<Row>))

          return {
            ...t,
            async mutate(req: DBCoreMutateRequest) {
              if (req.type === 'add' || req.type === 'put') {
                const values = await Promise.all(req.values.map((v, i) => encryptRow(v as Row, req.keys?.[i])))
                // The caller's transaction is already inactive after the awaits: use a fresh one.
                const trans = down.transaction([tableName], 'readwrite') as unknown as IDBTransaction
                const done = new Promise<void>((resolve, reject) => {
                  trans.addEventListener('complete', () => resolve())
                  trans.addEventListener('abort', () => reject(trans.error ?? new Error('Transaction aborted')))
                })
                done.catch(() => {})
                const res = await t.mutate({ ...req, trans, values })
                await done
                // Dexie only announces changes of its own transactions; this one is raw, so live queries would stay stale.
                const parts = (trans as unknown as { mutatedParts?: object }).mutatedParts
                if (parts) (Dexie.on as unknown as { storagemutated: { fire(p: object): void } }).storagemutated.fire(parts)
                return res
              }
              return t.mutate(req)
            },
            async get(req) {
              return decryptRow((await t.get(req)) as Row | undefined)
            },
            async getMany(req) {
              return Promise.all((await t.getMany(req)).map((r) => decryptRow(r as Row)))
            },
            async query(req) {
              const res = await t.query(req)
              return req.values ? { ...res, result: await decryptAll(res.result as Row[]) } : res
            },
            async openCursor(req: DBCoreOpenCursorRequest) {
              if (!req.values) return t.openCursor(req)
              const cursor = await t.openCursor(req)
              if (!cursor) return null
              const entries: { key: unknown; primaryKey: unknown; value: Row }[] = []
              await cursor.start(() => {
                entries.push({ key: cursor.key, primaryKey: cursor.primaryKey, value: cursor.value as Row })
                cursor.continue()
              })
              const values = await decryptAll(entries.map((e) => e.value))
              entries.forEach((e, i) => (e.value = values[i]))
              return entries.length === 0 ? null : memoryCursor(cursor.trans, entries, !!req.reverse)
            },
          }
        },
      }
    },
  }
}

/** A DBCoreCursor over pre-read entries (same contract as Dexie's own cursor). */
function memoryCursor(trans: DBCoreCursor['trans'], entries: { key: unknown; primaryKey: unknown; value: unknown }[], reverse: boolean): DBCoreCursor {
  const cmp = (a: unknown, b: unknown) => indexedDB.cmp(a as IDBValidKey, b as IDBValidKey)
  const dir = reverse ? -1 : 1
  let pos = 0
  let done = false
  let started = false
  let stopped = false
  let resolveIt: (v: unknown) => void = () => {}
  let rejectIt: (e: unknown) => void = () => {}
  let onNext: () => void = () => {}
  let inCb = false
  let acted = false

  const run = () => {
    while (!stopped) {
      if (pos >= entries.length) {
        done = true
        cursor.stop()
        return
      }
      acted = false
      inCb = true
      try {
        onNext()
      } catch (e) {
        inCb = false
        stopped = true
        rejectIt(e)
        return
      }
      inCb = false
      if (!acted) return // continue()/stop() will be called later
    }
  }
  const acted_ = () => {
    acted = true
    if (!inCb && !stopped) run()
  }
  const notStarted = () => {
    throw new Error('Cursor not started')
  }
  const cursor = {
    trans,
    get key() {
      return entries[pos]?.key
    },
    get primaryKey() {
      return entries[pos]?.primaryKey
    },
    get value() {
      return entries[pos]?.value
    },
    get done() {
      return done
    },
    continue: notStarted as (key?: unknown) => void,
    continuePrimaryKey: notStarted as (key: unknown, pk: unknown) => void,
    advance: notStarted as (n: number) => void,
    stop: notStarted as (v?: unknown) => void,
    fail: (e: Error) => {
      stopped = true
      rejectIt(e)
    },
    start(cb: () => void) {
      if (started) throw new Error('Cursor already started')
      started = true
      onNext = cb
      const p = new Promise((resolve, reject) => {
        resolveIt = resolve
        rejectIt = reject
      })
      cursor.stop = (v?: unknown) => {
        stopped = true
        resolveIt(v)
      }
      cursor.continue = (key?: unknown) => {
        pos++
        if (key !== undefined) while (pos < entries.length && cmp(entries[pos].key, key) * dir < 0) pos++
        acted_()
      }
      cursor.continuePrimaryKey = (key: unknown, pk: unknown) => {
        pos++
        while (pos < entries.length) {
          const c = cmp(entries[pos].key, key) * dir
          if (c > 0 || (c === 0 && cmp(entries[pos].primaryKey, pk) >= 0)) break
          pos++
        }
        acted_()
      }
      cursor.advance = (n: number) => {
        pos += n
        acted_()
      }
      run()
      return p
    },
    next() {
      let gotOne = 1
      return cursor
        .start(() => (gotOne-- ? cursor.continue() : cursor.stop()))
        .then(() => cursor)
    },
  }
  return cursor as unknown as DBCoreCursor
}

