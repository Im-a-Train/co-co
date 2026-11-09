/**
 * FROZEN legacy IndexedDB database 'coco' (plaintext, schema v1-v5; v5 = rules v2 `campRuleConfig`, shipped
 * in alpha builds before encryption). Kept only so `migrate.ts` can read it
 * once and copy it into the encrypted database `coco2` (ADR 0010). Do NOT edit the versions below and do not
 * use this class anywhere except the migration and tests.
 */
import Dexie, { type EntityTable } from 'dexie'
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
import type { SettingRecord } from './db'

export const LEGACY_DB_NAME = 'coco'

export class LegacyCocoDb extends Dexie {
  settings!: EntityTable<SettingRecord, 'key'>
  coachInputs!: EntityTable<CoachInputs, 'campIri'>
  mappings!: EntityTable<CategoryMapping, 'campIri'>
  overrides!: EntityTable<Override, 'id'>
  campSummaries!: EntityTable<CampSummaryRecord, 'campIri'>
  feedback!: EntityTable<FeedbackItem, 'id'>
  reviews!: EntityTable<ReviewState, 'campIri'>
  rounds!: EntityTable<Round, 'id'>
  snapshots!: EntityTable<Snapshot, 'id'>
  documents!: EntityTable<DocumentRecord, 'id'>
  watchedFolders!: EntityTable<WatchedFolder, 'id'>
  aiLog!: EntityTable<AiLogEntry, 'id'>
  midata!: EntityTable<MidataRecord, 'campIri'>
  nds!: EntityTable<NdsRecord, 'campIri'>
  selfChecks!: EntityTable<SelfCheckRun, 'id'>
  campRuleConfig!: EntityTable<CampRuleConfig, 'campIri'>

  constructor(name = LEGACY_DB_NAME) {
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
    this.version(2).stores({
      midata: 'campIri',
    })
    this.version(3).stores({
      nds: 'campIri',
    })
    this.version(4).stores({
      selfChecks: 'id, campIri, createdAt',
    })
    this.version(5).stores({
      campRuleConfig: 'campIri',
    })
  }
}
