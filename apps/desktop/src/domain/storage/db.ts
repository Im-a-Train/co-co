/**
 * Encrypted IndexedDB (Dexie) database 'coco2' with all co-co tables (ADR 0010). Shared by all modules.
 * The legacy plaintext database 'coco' (v1-v4) lives frozen in legacyDb.ts and is migrated by migrate.ts.
 * getDb() throws LockedError until unlockDb(key) ran; every row goes through the encryption middleware.
 *
 * Schema rules
 * - Never edit an existing schema version. Add `this.version(n+1).stores({...}).upgrade(...)` instead.
 * - Keep TABLE_NAMES, TABLE_ENCRYPTION (encryptionConfig.ts) and the backup export/import in sync with the tables.
 * - Records are plain JSON (see domain/types.ts), so backup export/import is a table dump.
 * - `db.transaction()` is NOT atomic here (see CocoDb.transaction); rw scopes are serialised, do not nest them.
 * - Importing this module is safe in Node (vitest): Dexie only opens IndexedDB on first query.
 *   Pure domain logic must still not depend on it, so it stays testable without IndexedDB.
 */
import Dexie, { type EntityTable } from 'dexie'
import { importDataKey } from './crypto'
import { TABLE_ENCRYPTION } from './encryptionConfig'
import { createEncryptionMiddleware, type KeyHolder } from './encryptionMiddleware'
import { DecryptError, LockedError } from './errors'
import { LEGACY_DB_NAME } from './legacyDb'
import { migrateLegacy } from './migrate'
import type {
  AiLogEntry,
  CampRuleConfig,
  CampSummaryRecord,
  CategoryMapping,
  CoachInputs,
  DocumentRecord,
  FeedbackItem,
  MidataRecord,
  NdsRecord,
  Override,
  ReviewState,
  Round,
  SelfCheckRun,
  Snapshot,
  WatchedFolder,
} from '../types'

export interface SettingRecord {
  key: string
  value: unknown
}

export const DB_NAME = 'coco2'

export { DecryptError, LockedError }

export class CocoDb extends Dexie {
  /** key/value; key 'app' holds AppSettings (see storage/settings.ts). Owner: architect (shared). */
  settings!: EntityTable<SettingRecord, 'key'>
  /** Owner: data */
  coachInputs!: EntityTable<CoachInputs, 'campIri'>
  /** Owner: data */
  mappings!: EntityTable<CategoryMapping, 'campIri'>
  /** Owner: rules (written via domain/rules/overrides.ts) */
  overrides!: EntityTable<Override, 'id'>
  /** Owner: rules (cached counts for "Meine Lager") */
  campSummaries!: EntityTable<CampSummaryRecord, 'campIri'>
  /** Owner: feedback */
  feedback!: EntityTable<FeedbackItem, 'id'>
  /** Owner: rounds */
  reviews!: EntityTable<ReviewState, 'campIri'>
  /** Owner: rounds */
  rounds!: EntityTable<Round, 'id'>
  /** Owner: rounds */
  snapshots!: EntityTable<Snapshot, 'id'>
  /** Owner: documents */
  documents!: EntityTable<DocumentRecord, 'id'>
  /** Owner: documents */
  watchedFolders!: EntityTable<WatchedFolder, 'id'>
  /** Owner: ai */
  aiLog!: EntityTable<AiLogEntry, 'id'>
  /** Owner: midata (M7). Aggregates only, tagged red-derived. */
  midata!: EntityTable<MidataRecord, 'campIri'>
  /** Owner: nds (M8). Aggregates only, tagged red-derived. */
  nds!: EntityTable<NdsRecord, 'campIri'>
  /** Owner: selfCheck. Leader self-check runs («Entwurfsrunden»), separate from review rounds. */
  selfChecks!: EntityTable<SelfCheckRun, 'id'>
  /** Owner: rules (v2). Per-camp rule modules, activity tags, camp/offer context, checklist (zone green). */
  campRuleConfig!: EntityTable<CampRuleConfig, 'campIri'>

  private rwQueue: Promise<void> = Promise.resolve()

  constructor(name = DB_NAME) {
    // cache 'disabled': Dexie's query cache would hold encrypted rows below the middleware.
    super(name, { cache: 'disabled' })
    // v1 of the encrypted database = the legacy v4 tables with the reduced index set (plan section 4):
    // indexes that leaked content and were never queried are gone.
    this.version(1).stores({
      settings: 'key',
      coachInputs: 'campIri',
      mappings: 'campIri',
      overrides: 'id, campIri, findingId',
      campSummaries: 'campIri',
      feedback: 'id, campIri',
      reviews: 'campIri',
      rounds: 'id, campIri, [campIri+number]',
      snapshots: 'id, campIri',
      documents: 'id, campIri',
      watchedFolders: 'id, campIri',
      aiLog: '++id, at',
      midata: 'campIri',
      nds: 'campIri',
      selfChecks: 'id, campIri',
    })
    // v2 (rules v2): per-camp rule config. New table only, no data migration.
    this.version(2).stores({
      campRuleConfig: 'campIri',
    })
  }

  /**
   * Not a real IndexedDB transaction: WebCrypto is async and would let a real transaction auto-commit
   * mid-scope. Table operations inside run individually; 'rw' scopes are serialised (read-modify-write
   * stays safe) but a failure does not roll back earlier writes of the scope. Never nest transactions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override transaction(...args: any[]): any {
    const scope = args[args.length - 1] as () => unknown
    const rw = args[0] === 'rw' || args[0] === 'readwrite'
    const run = () => Promise.resolve().then(() => scope())
    if (!rw) return run()
    const result = this.rwQueue.then(run, run)
    this.rwQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

/** Table names in export order (backup uses this list; keep in sync with the schema above). */
export const TABLE_NAMES = [
  'settings',
  'coachInputs',
  'mappings',
  'overrides',
  'campSummaries',
  'feedback',
  'reviews',
  'rounds',
  'snapshots',
  'documents',
  'watchedFolders',
  'aiLog',
  'midata',
  'nds',
  'selfChecks',
  'campRuleConfig',
] as const

export type TableName = (typeof TABLE_NAMES)[number]

interface Unlocked {
  db: CocoDb
  holder: KeyHolder
}
let current: Unlocked | null = null

/** Settings keys starting with '_' are internal (canary, migration progress): hidden from backups. */
export const INTERNAL_KEY_PREFIX = '_'
export const CANARY_KEY = '_canary'

export interface UnlockOptions {
  /** Test hook: database names (defaults: 'coco2' / legacy 'coco'). */
  dbName?: string
  legacyDbName?: string
}

/** Creates a CocoDb with the encryption middleware installed (not opened yet; also used by tests). */
export function createEncryptedDb(key: CryptoKey, name = DB_NAME): Unlocked {
  const holder: KeyHolder = { key }
  const db = new CocoDb(name)
  db.use(createEncryptionMiddleware(holder, TABLE_ENCRYPTION))
  return { db, holder }
}

/** Throws DecryptError when the key cannot read what is stored; creates the canary on a fresh database. */
export async function ensureCanary(db: CocoDb): Promise<void> {
  const canary = await db.settings.get(CANARY_KEY) // DecryptError = wrong or lost key
  if (canary) return
  for (const name of TABLE_NAMES) await db.table(name).limit(1).toArray() // any existing row must decrypt
  await db.settings.put({ key: CANARY_KEY, value: 'ok' })
}

/**
 * Imports the data key (non-extractable, `keyBytes` is zeroed), opens the encrypted database, verifies the key
 * against a canary row (DecryptError = key lost) and migrates legacy plaintext data once.
 */
export async function unlockDb(keyBytes: Uint8Array, options: UnlockOptions = {}): Promise<{ migrated: boolean }> {
  if (current) await lockDb()
  const key = await importDataKey(keyBytes)
  const next = createEncryptedDb(key, options.dbName)
  try {
    await next.db.open()
    await ensureCanary(next.db)
  } catch (e) {
    next.holder.key = null
    next.db.close()
    throw e
  }
  current = next
  try {
    return await migrateLegacy(next.db, { legacyName: options.legacyDbName ?? LEGACY_DB_NAME })
  } catch (e) {
    await lockDb()
    throw e
  }
}

/** Closes the database and drops the key reference. */
export async function lockDb(): Promise<void> {
  const c = current
  current = null
  if (!c) return
  c.holder.key = null
  c.db.close()
}

export function isUnlocked(): boolean {
  return current !== null
}

/** The unlocked database; throws LockedError while locked (so a missed reader fails loudly). */
export function getDb(): CocoDb {
  if (!current) throw new LockedError()
  return current.db
}

/** Deletes the encrypted and the legacy database (key lost: "reset local data"). Locks first. */
export async function resetLocalData(options: UnlockOptions = {}): Promise<void> {
  await lockDb()
  await Dexie.delete(options.dbName ?? DB_NAME)
  await Dexie.delete(options.legacyDbName ?? LEGACY_DB_NAME)
}

/** Generates ids for records (crypto.randomUUID is available in Tauri webviews and Node >= 19). */
export function newId(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}
