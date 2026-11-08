/**
 * «Personen» tab contract (ADR 0008, plan docs/plans/participants-and-nds-sync.md, phase P1).
 *
 * RED ZONE. These rows are personal data (names, birth dates, roles). Rules:
 * - Never sent to the AI: every type here carries the `__red` brand; aiGateway refuses it.
 * - Never persisted (no Dexie table, no localStorage, not in backups), never logged, never in
 *   error messages or events. Rust keeps the rows in memory only; `persons_clear` and app close wipe them.
 * - v1 holds NO AHV number, no address, no e-mail/phone, no health data.
 *
 * Shapes mirror the Rust structs in `coco-core::persons` (serde camelCase). Keep both in sync.
 */
import type { IsoDate, IsoDateTime } from '../types'
import type { MidataQualKey } from '../types'

/** Brand that marks red-zone personal data (checked by the AI gateway contract test). */
export interface RedBrand {
  readonly __red: true
}

export type PersonKind = 'participant' | 'leader' | 'kitchen' | 'coach' | 'guest' | 'other'

export type QualState = 'valid' | 'invalid' | 'none'

/** One person of the MiData event (deduplicated over participations). */
export interface MidataPersonRow extends RedBrand {
  /** MiData person id (`guest:<id>` for event guests). Stays local. */
  id: string
  firstName: string
  lastName: string
  nickname: string | null
  /** YYYY-MM-DD, null when unknown (guests, hidden). */
  birthDate: IsoDate | null
  /** 'm' | 'w' | null as MiData delivers it (no inference). */
  gender: string | null
  kind: PersonKind
  /** All event role labels of this person, in MiData order. */
  roleLabels: string[]
  /** Leaders only: state per qualification key at camp time; empty for others or when unreadable. */
  qualifications: Partial<Record<MidataQualKey, QualState>>
}

/** One person of the NDS camp (participants and supervisors lists). */
export interface NdsPersonRow extends RedBrand {
  /** NDS person businessId. Stays local. */
  id: string
  /** NDS person number (shown, needed to find the person in NDS). */
  personNumber: string | null
  firstName: string
  lastName: string
  birthDate: IsoDate | null
  /** 'participant' from ParticipantsListForCamp, 'leader' from SupervisorsListForCamp. */
  kind: 'participant' | 'leader'
  /** NDS role / target audience label as delivered (e.g. targetAudienceGroup, involvement type). */
  roleLabel: string | null
}

export interface MidataPersonsResult extends RedBrand {
  eventId: string
  persons: MidataPersonRow[]
  qualificationsReadable: boolean
  fetchedAt: IsoDateTime
}

export interface NdsPersonsResult extends RedBrand {
  ndsCampId: string
  persons: NdsPersonRow[]
  fetchedAt: IsoDateTime
}

/** Reconciliation state of one person (domain/persons/diff.ts). */
export type PersonMatchState =
  | 'match' // same person in both, no field difference
  | 'field_diff' // matched, but a compared field differs (e.g. kind)
  | 'missing_in_nds' // in MiData, not found in NDS
  | 'only_in_nds' // in NDS, not found in MiData
  | 'ambiguous' // several candidates; never auto-matched (name-only suggestion or duplicate key)

export interface PersonDiffRow extends RedBrand {
  key: string
  state: PersonMatchState
  midata: MidataPersonRow | null
  nds: NdsPersonRow | null
  /** Suggestions for ambiguous / missing rows (name-only matches), never auto-accepted. */
  suggestions: NdsPersonRow[]
  /** Field names that differ for 'field_diff' (e.g. 'kind', 'birthDate'). */
  differences: string[]
}

/*
 * Tauri commands (Rust, window `main` only; wrappers in src/lib/tauri.ts):
 *   persons_load_midata(eventId: string, campStart: IsoDate, campEnd: IsoDate) -> MidataPersonsResult
 *   persons_load_nds(ndsCampId: string) -> NdsPersonsResult
 *   persons_clear() -> void          // wipes the in-memory copies in Rust
 * Errors never contain personal data (only HTTP status / path / parameter names).
 */
