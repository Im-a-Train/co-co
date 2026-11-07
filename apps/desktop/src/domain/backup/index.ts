/**
 * JSON export/import of ALL co-co data (M4).
 * File I/O goes through commands.saveTextFile / commands.openTextFile (Rust dialogs, see components/backup).
 * Uses TABLE_NAMES from storage/db.ts so new tables are included automatically.
 *
 * The logic works on a `BackupStore` (table name -> minimal table interface), so it is testable without
 * Dexie/IndexedDB. A CocoDb is adapted with `storeFromDb`.
 */
import { TABLE_NAMES, type CocoDb } from '../storage/db'
import { EXPORT_FORMAT, EXPORT_VERSION, type CocoExport } from '../types'

export type ImportMode = 'replace' | 'merge'

export const APP_VERSION = '0.1.0'

export interface ImportReport {
  mode: ImportMode
  /** table -> number of records written */
  written: Record<string, number>
  skippedTables: string[]
}

/** Machine-readable failure; the UI maps `code` to German text (`backup.errors.<code>`). */
export class BackupError extends Error {
  constructor(
    public readonly code: 'notJson' | 'notCoco' | 'tooNew' | 'badTables' | 'badRecord',
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'BackupError'
  }
}

/** Minimal table surface used by export/import (Dexie tables satisfy it). */
export interface BackupTable {
  toArray(): Promise<unknown[]>
  clear(): Promise<unknown>
  bulkPut(rows: unknown[]): Promise<unknown>
  bulkAdd(rows: unknown[]): Promise<unknown>
  /** Primary keys currently present (for merge of settings). */
  keys(): Promise<unknown[]>
}
export type BackupStore = Record<string, BackupTable>

export function storeFromDb(db: CocoDb): BackupStore {
  const out: BackupStore = {}
  for (const name of TABLE_NAMES) {
    const t = db.table(name)
    out[name] = {
      toArray: () => t.toArray(),
      clear: () => t.clear(),
      bulkPut: (rows) => t.bulkPut(rows),
      bulkAdd: (rows) => t.bulkAdd(rows),
      keys: () => t.toCollection().primaryKeys(),
    }
  }
  return out
}

/** Primary key field per table (aiLog uses an auto-increment id that may be absent). */
const PRIMARY_KEY: Record<string, string> = {
  settings: 'key',
  coachInputs: 'campIri',
  mappings: 'campIri',
  overrides: 'id',
  campSummaries: 'campIri',
  feedback: 'id',
  reviews: 'campIri',
  rounds: 'id',
  snapshots: 'id',
  documents: 'id',
  watchedFolders: 'id',
  aiLog: 'id',
}

export async function exportFromStore(store: BackupStore, now: Date = new Date()): Promise<CocoExport> {
  const tables: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) tables[name] = (await store[name]?.toArray()) ?? []
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    appVersion: APP_VERSION,
    tables,
  }
}

export async function exportAll(db?: CocoDb, now?: Date): Promise<CocoExport> {
  const d = db ?? (await import('../storage/db')).getDb()
  return exportFromStore(storeFromDb(d), now)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Throws BackupError when `json` is not a valid co-co export. Pure. */
export function validateExport(json: unknown): CocoExport {
  if (!isObj(json) || json.format !== EXPORT_FORMAT) throw new BackupError('notCoco')
  if (typeof json.version !== 'number' || !Number.isInteger(json.version) || json.version < 1) throw new BackupError('notCoco')
  if (json.version > EXPORT_VERSION) throw new BackupError('tooNew', String(json.version))
  if (typeof json.exportedAt !== 'string' || Number.isNaN(Date.parse(json.exportedAt))) throw new BackupError('notCoco', 'exportedAt')
  if (!isObj(json.tables)) throw new BackupError('badTables')
  for (const [name, rows] of Object.entries(json.tables)) {
    if (!Array.isArray(rows)) throw new BackupError('badTables', name)
    const pk = PRIMARY_KEY[name]
    rows.forEach((row, i) => {
      if (!isObj(row)) throw new BackupError('badRecord', `${name}[${i}]`)
      if (pk && pk !== 'id' && typeof row[pk] !== 'string') throw new BackupError('badRecord', `${name}[${i}].${pk}`)
      if (pk === 'id' && name !== 'aiLog' && typeof row[pk] !== 'string') throw new BackupError('badRecord', `${name}[${i}].id`)
    })
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: json.exportedAt,
    appVersion: typeof json.appVersion === 'string' ? json.appVersion : 'unknown',
    tables: json.tables as Record<string, unknown[]>,
  }
}

/** Parses file text and validates it. */
export function parseExport(text: string): CocoExport {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new BackupError('notJson')
  }
  return validateExport(json)
}

/** Record count per known table plus names of unknown tables (for the confirmation preview). */
export function summarizeExport(data: CocoExport): { counts: Record<string, number>; unknownTables: string[] } {
  const known = new Set<string>(TABLE_NAMES)
  const counts: Record<string, number> = {}
  const unknownTables: string[] = []
  for (const [name, rows] of Object.entries(data.tables)) {
    if (known.has(name)) counts[name] = rows.length
    else unknownTables.push(name)
  }
  return { counts, unknownTables }
}

/** Imports must never enable AI or loosen data zones on their own. */
function sanitizeRows(name: string, rows: unknown[] | undefined): unknown[] | undefined {
  if (!rows) return rows
  if (name === 'documents') {
    return rows.map((r) => {
      const d = r as Record<string, unknown>
      return { ...d, zone: d.zone === 'red' ? 'red' : 'yellow', aiAllowed: false }
    })
  }
  if (name === 'settings') {
    return rows.map((r) => {
      const row = r as { key?: string; value?: { ai?: Record<string, unknown> } }
      if (row.key === 'app' && row.value && typeof row.value === 'object')
        return { ...row, value: { ...row.value, ai: { ...(row.value.ai ?? {}), enabled: false } } }
      return r
    })
  }
  return rows
}

export async function importIntoStore(store: BackupStore, data: CocoExport, mode: ImportMode): Promise<ImportReport> {
  const written: Record<string, number> = {}
  const skippedTables = Object.keys(data.tables).filter((n) => !(TABLE_NAMES as readonly string[]).includes(n))
  for (const name of TABLE_NAMES) {
    const incoming = sanitizeRows(name, data.tables[name])
    if (!incoming) continue
    const table = store[name]
    if (!table) continue
    if (mode === 'replace') {
      await table.clear()
      await table.bulkPut(incoming)
      written[name] = incoming.length
    } else if (name === 'settings') {
      // Merge keeps local settings; only keys that do not exist yet are added.
      const have = new Set((await table.keys()).map(String))
      const add = incoming.filter((r) => !have.has(String((r as { key: string }).key)))
      await table.bulkPut(add)
      written[name] = add.length
    } else if (name === 'aiLog') {
      // Auto-increment ids would collide; append without ids.
      const rows = incoming.map((r) => {
        const { id: _id, ...rest } = r as Record<string, unknown>
        return rest
      })
      await table.bulkAdd(rows)
      written[name] = rows.length
    } else {
      await table.bulkPut(incoming)
      written[name] = incoming.length
    }
  }
  return { mode, written, skippedTables }
}

export async function importAll(data: CocoExport, mode: ImportMode, db?: CocoDb): Promise<ImportReport> {
  const d = db ?? (await import('../storage/db')).getDb()
  const store = storeFromDb(d)
  const tables = TABLE_NAMES.map((n) => d.table(n))
  return d.transaction('rw', tables, () => importIntoStore(store, data, mode))
}

/** e.g. `co-co-backup-2026-11-07.json` */
export function exportFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `co-co-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}
