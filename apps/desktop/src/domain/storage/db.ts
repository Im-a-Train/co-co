/**
 * IndexedDB (Dexie) database 'coco' with the tables of ALL milestones. FROZEN (architect).
 *
 * Rules for builders
 * - Only touch the tables your module owns (docs/contracts/ownership.md); read others if needed.
 * - Never change the schema here. Schema changes go through the architect as a NEW version
 *   (`this.version(2).stores({...}).upgrade(...)`), never by editing version(1).
 * - Records are plain JSON (see domain/types.ts), so backup export/import is a table dump.
 * - Importing this module is safe in Node (vitest): Dexie only opens IndexedDB on first query.
 *   Pure domain logic must still not depend on it, so it stays testable without IndexedDB.
 */
import Dexie, { type EntityTable } from 'dexie'
import type {
  AiLogEntry,
  CampSummaryRecord,
  CategoryMapping,
  CoachInputs,
  DocumentRecord,
  FeedbackItem,
  Override,
  ReviewState,
  Round,
  Snapshot,
  WatchedFolder,
} from '../types'

export interface SettingRecord {
  key: string
  value: unknown
}

export const DB_NAME = 'coco'

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

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({
      settings: 'key',
      coachInputs: 'campIri',
      mappings: 'campIri',
      overrides: 'id, campIri, findingId, ruleId',
      campSummaries: 'campIri',
      feedback: 'id, campIri, activityIri, roundId, status, updatedAt',
      reviews: 'campIri, status',
      rounds: 'id, campIri, [campIri+number]',
      snapshots: 'id, campIri, roundId',
      documents: 'id, campIri, path, contentHash, folder, [campIri+path]',
      watchedFolders: 'id, campIri, &path',
      aiLog: '++id, at, feature, campIri',
    })
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
] as const

export type TableName = (typeof TABLE_NAMES)[number]

let instance: CocoDb | null = null

/** Lazily created singleton. Tests may pass their own CocoDb to module functions instead. */
export function getDb(): CocoDb {
  instance ??= new CocoDb()
  return instance
}

/** Generates ids for records (crypto.randomUUID is available in Tauri webviews and Node >= 19). */
export function newId(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}
