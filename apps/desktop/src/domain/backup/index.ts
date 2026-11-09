/**
 * JSON export/import of ALL co-co data (M4).
 * File I/O goes through commands.saveTextFile / commands.openTextFile (Rust dialogs, see components/backup).
 * Uses TABLE_NAMES from storage/db.ts so new tables are included automatically.
 *
 * The logic works on a `BackupStore` (table name -> minimal table interface), so it is testable without
 * Dexie/IndexedDB. A CocoDb is adapted with `storeFromDb`.
 */
import { INTERNAL_KEY_PREFIX, TABLE_NAMES, type CocoDb } from '../storage/db'
import { MIDATA_FIELDS } from '../midata'
import { NDS_FIELDS } from '../nds'
import { EXPORT_FORMAT, EXPORT_VERSION, type CocoExport } from '../types'

export type ImportMode = 'replace' | 'merge'

/** Version of the running build (package.json, stamped by CI for releases). */
export const APP_VERSION: string = __APP_VERSION__

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
    // settings rows with an internal key ('_canary', migration progress) never leave the database
    // and survive a replace-import.
    const isInternal = (k: unknown) => name === 'settings' && String(k).startsWith(INTERNAL_KEY_PREFIX)
    out[name] = {
      toArray: async () => (name === 'settings' ? (await t.toArray()).filter((r) => !isInternal((r as { key: string }).key)) : t.toArray()),
      clear: async () => {
        if (name !== 'settings') return t.clear()
        await t.bulkDelete((await t.toCollection().primaryKeys()).filter((k) => !isInternal(k)))
      },
      bulkPut: (rows) => t.bulkPut(rows),
      bulkAdd: (rows) => t.bulkAdd(rows),
      keys: async () => (await t.toCollection().primaryKeys()).filter((k) => !isInternal(k)),
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
  midata: 'campIri',
  nds: 'campIri',
  selfChecks: 'id',
  campRuleConfig: 'campIri',
  resources: 'key',
  ruleEdits: 'ruleId',
  manualFindings: 'id',
}

export interface ExportOptions {
  /** Leave out red-derived data (the `midata` and `nds` tables). */
  omitRedDerived?: boolean
}

/** Tables holding red-derived data (omitted with `omitRedDerived`). */
export const RED_DERIVED_TABLES: readonly string[] = ['midata', 'nds']

/** Removes values adopted from MiData (red-derived) from a coachInputs row, plus the badge map. */
function stripMidataFields(row: unknown): unknown {
  const r = row as Record<string, unknown>
  const badges = r.midataFields
  if (!badges || typeof badges !== 'object') return row
  const out: Record<string, unknown> = { ...r }
  for (const f of MIDATA_FIELDS) if (f in badges) out[f] = null
  delete out.midataFields
  return out
}

/** Reset values (false/null) of NDS-adopted fields. */
const NDS_EMPTY: Record<string, unknown> = { ndsRegistered: false, ndsRegisteredOn: null, ndsClosed: false }

/** Removes values adopted from NDS (red-derived) from a coachInputs row, plus the badge map. */
function stripNdsFields(row: unknown): unknown {
  const r = row as Record<string, unknown>
  const badges = r.ndsFields
  if (!badges || typeof badges !== 'object') return row
  const out: Record<string, unknown> = { ...r }
  for (const f of NDS_FIELDS) if (f in badges) out[f] = NDS_EMPTY[f]
  delete out.ndsFields
  return out
}

/** Drops red-derived findings (quoting MiData/NDS) from a selfChecks row. */
function stripSelfCheckRed(row: unknown): unknown {
  const r = row as Record<string, unknown>
  if (!Array.isArray(r.findings)) return row
  return { ...r, findings: r.findings.filter((f) => !(f as { redDerived?: boolean } | null)?.redDerived) }
}

/** Both strippers for a coachInputs row. */
const stripRedFields = (row: unknown): unknown => stripNdsFields(stripMidataFields(row))

export async function exportFromStore(store: BackupStore, now: Date = new Date(), options: ExportOptions = {}): Promise<CocoExport> {
  const tables: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) {
    if (options.omitRedDerived && RED_DERIVED_TABLES.includes(name)) continue
    const rows = (await store[name]?.toArray()) ?? []
    tables[name] =
      options.omitRedDerived && name === 'coachInputs'
        ? rows.map(stripRedFields)
        : options.omitRedDerived && name === 'selfChecks'
          ? rows.map(stripSelfCheckRed)
          : rows
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    appVersion: APP_VERSION,
    tables,
  }
}

export async function exportAll(db?: CocoDb, now?: Date, options?: ExportOptions): Promise<CocoExport> {
  const d = db ?? (await import('../storage/db')).getDb()
  return exportFromStore(storeFromDb(d), now, options)
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
    return rows
      .filter((r) => !String((r as { key?: string }).key ?? '').startsWith(INTERNAL_KEY_PREFIX))
      .map((r) => {
        const row = r as { key?: string; value?: { ai?: Record<string, unknown>; mcp?: Record<string, unknown> } }
        // AI and the local MCP server (ADR 0012) are switched off by every import.
        if (row.key === 'app' && row.value && typeof row.value === 'object')
          return {
            ...row,
            value: {
              ...row.value,
              ai: { ...(row.value.ai ?? {}), enabled: false },
              ...(row.value.mcp ? { mcp: { ...row.value.mcp, enabled: false } } : {}),
            },
          }
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
    const table = store[name]
    if (!incoming) {
      // Replace means replace: red-derived tables absent from the file (v1 export, omitRedDerived) are emptied too.
      if (mode === 'replace' && table && RED_DERIVED_TABLES.includes(name)) {
        await table.clear()
        written[name] = 0
      }
      continue
    }
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

/**
 * Import with manual rollback. `CocoDb.transaction()` is not atomic (encrypted store, see storage/db.ts), so:
 * 1. the whole file is validated BEFORE anything is touched,
 * 2. an in-memory copy of all current (decrypted) rows is taken,
 * 3. on any failure that copy is written back (best effort) and a clear German error is thrown.
 */
export async function importWithRollback(store: BackupStore, data: CocoExport, mode: ImportMode): Promise<ImportReport> {
  validateExport(data)
  const backup: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) backup[name] = (await store[name]?.toArray()) ?? []
  try {
    return await importIntoStore(store, data, mode)
  } catch (e) {
    let restored = true
    for (const name of TABLE_NAMES) {
      const table = store[name]
      if (!table) continue
      try {
        await table.clear()
        await table.bulkPut(backup[name] ?? [])
      } catch {
        restored = false
      }
    }
    throw new Error(
      restored
        ? 'Der Import ist fehlgeschlagen. Deine bisherigen Daten wurden unverändert wiederhergestellt.'
        : 'Der Import ist fehlgeschlagen und die bisherigen Daten konnten nicht vollständig wiederhergestellt werden. Bitte starte co-co neu und prüfe deine Daten.',
      { cause: e },
    )
  }
}

export async function importAll(data: CocoExport, mode: ImportMode, db?: CocoDb): Promise<ImportReport> {
  const d = db ?? (await import('../storage/db')).getDb()
  return importWithRollback(storeFromDb(d), data, mode)
}

/** e.g. `co-co-backup-2026-11-07.json` */
export function exportFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `co-co-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}
