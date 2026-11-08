/**
 * One-time copy of the legacy plaintext database 'coco' into the encrypted 'coco2' (ADR 0009).
 * Copy table by table through the encryption middleware (chunked), verify counts, delete the legacy database LAST.
 * Progress is stored in an encrypted internal settings row, so an interrupted run resumes; a second run is a no-op.
 */
import Dexie from 'dexie'
import { INTERNAL_KEY_PREFIX, TABLE_NAMES, type CocoDb } from './db'
import { LEGACY_DB_NAME, LegacyCocoDb } from './legacyDb'

// Literal on purpose: db.ts and migrate.ts import each other, so INTERNAL_KEY_PREFIX is not initialised yet here.
export const MIGRATION_KEY = '_migration.legacy'
const CHUNK = 100

interface Progress {
  /** table -> rows copied and verified */
  done: Record<string, number>
}

export interface MigrateOptions {
  legacyName?: string
  /** Test hook, called after a table was copied and verified (throw to simulate an interruption). */
  afterTable?: (name: string) => void | Promise<void>
}

async function countNew(db: CocoDb, name: string): Promise<number> {
  if (name !== 'settings') return db.table(name).count()
  return (await db.settings.toCollection().primaryKeys()).filter((k) => !String(k).startsWith(INTERNAL_KEY_PREFIX)).length
}

export async function migrateLegacy(db: CocoDb, options: MigrateOptions = {}): Promise<{ migrated: boolean }> {
  const legacyName = options.legacyName ?? LEGACY_DB_NAME
  if (!(await Dexie.exists(legacyName))) {
    await db.settings.delete(MIGRATION_KEY) // leftover of a run that was killed after deleting the legacy db
    return { migrated: false }
  }
  const legacy = new LegacyCocoDb(legacyName)
  await legacy.open()
  try {
    const stored = (await db.settings.get(MIGRATION_KEY))?.value as Progress | undefined
    const progress: Progress = { done: { ...(stored?.done ?? {}) } }
    for (const name of TABLE_NAMES) {
      if (name in progress.done) continue
      const src = legacy.table(name)
      const dst = db.table(name)
      const keys = await src.toCollection().primaryKeys()
      for (let i = 0; i < keys.length; i += CHUNK) {
        const rows = (await src.bulkGet(keys.slice(i, i + CHUNK))).filter((r) => r !== undefined)
        await dst.bulkPut(rows)
      }
      const expected = keys.length
      const got = await countNew(db, name)
      if (got !== expected) throw new Error(`Migration count mismatch in ${name}: ${got} of ${expected}`)
      progress.done[name] = expected
      await db.settings.put({ key: MIGRATION_KEY, value: progress })
      await options.afterTable?.(name)
    }
  } finally {
    legacy.close()
  }
  await Dexie.delete(legacyName) // LAST
  await db.settings.delete(MIGRATION_KEY)
  return { migrated: true }
}
