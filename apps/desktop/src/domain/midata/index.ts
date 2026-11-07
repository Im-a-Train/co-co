/**
 * MiData (M7, red zone) – pure helpers over the MidataAggregate. Framework-free, unit-tested.
 *
 * Red-zone rules: nothing here may be passed to the AI gateway. Leader nicknames are yellow, every
 * other value is an aggregate (counts, yes/no). Raw person data never reaches TypeScript.
 *
 * CONTRACT (M7): signatures below are used by the rules (`domain/rules`) and the UI
 * (`composables/useMidata.ts`, `components/midata/*`). Implement the bodies; keep the signatures.
 */
import type {
  CampFacts,
  CampInfo,
  CoachInputs,
  IsoDateTime,
  MidataAggregate,
  MidataField,
  MidataQualKey,
  MidataRecord,
} from '../types'

/** Fields «Aus MiData übernehmen» offers, in display order. */
export const MIDATA_FIELDS: readonly MidataField[] = [
  'participantsCount',
  'participantsJsAgeCount',
  'minAge',
  'maxAge',
  'leadersCount',
  'slrgCount',
  'lagerleiterAttested',
]

export type MidataFieldValue = number | boolean | null

/** One row of the «Aus MiData übernehmen» dialog. */
export interface MidataFieldDiff {
  field: MidataField
  midataValue: MidataFieldValue
  currentValue: MidataFieldValue
  /** midataValue equals currentValue. */
  same: boolean
  /** The current value already came from MiData (CoachInputs.midataFields has the field). */
  fromMidata: boolean
}

/** The value MiData suggests for a coach-input field (derived from the aggregate). */
export function midataValueFor(agg: MidataAggregate, field: MidataField): MidataFieldValue {
  void agg
  void field
  throw new Error('M7: not implemented')
}

/** Field-by-field comparison of the aggregate with the current coach inputs (null inputs = all empty). */
export function compareWithInputs(agg: MidataAggregate, inputs: CoachInputs | null): MidataFieldDiff[] {
  void agg
  void inputs
  throw new Error('M7: not implemented')
}

/**
 * Applies the accepted fields: copies the MiData values into the inputs and records
 * `midataFields[field] = agg.fetchedAt`. Other fields are left untouched. Pure (returns a new object).
 */
export function adoptFields(inputs: CoachInputs, agg: MidataAggregate, fields: readonly MidataField[], now: IsoDateTime): CoachInputs {
  void inputs
  void agg
  void fields
  void now
  throw new Error('M7: not implemented')
}

/**
 * Removes the MiData badge from every field whose value differs between `prev` and `next`
 * (the coach edited it by hand). Returns `next` with an updated `midataFields`.
 */
export function dropEditedMidataFields(prev: CoachInputs | null, next: CoachInputs): CoachInputs {
  void prev
  void next
  throw new Error('M7: not implemented')
}

/** «Stand MiData» of an accepted field, or null. */
export function midataSourceOf(inputs: CoachInputs | null, field: MidataField): IsoDateTime | null {
  void inputs
  void field
  throw new Error('M7: not implemented')
}

/** Resolves the MiData event of a camp: eCamp link (camp.hitobitoEventId) wins over a manual pick. */
export function resolveEventLink(
  camp: Pick<CampInfo, 'hitobitoEventId' | 'hitobitoProvider'>,
  stored: MidataRecord | null,
): { eventId: string; source: 'ecamp' | 'manual' } | null {
  void camp
  void stored
  throw new Error('M7: not implemented')
}

/** Safety areas of a camp detected from its activities (water / mountain / winter / rope …). */
export type SafetyArea = 'wasser' | 'berg' | 'winter'

export interface QualMatrixRow {
  nickname: string
  roleLabel: string
  cells: Record<MidataQualKey, boolean>
  /** eCamp collaborator display names matched to this leader (normalized nickname compare). */
  ecampMatches: string[]
}

export interface QualMatrixActivityCheck {
  activityIri: string
  activityTitle: string
  area: SafetyArea
  /** Required qualification for the area (wasser -> 'wasser' | 'slrg', berg -> 'berg', winter -> 'winter'). */
  required: MidataQualKey[]
  /** eCamp responsibles of the activity (display names). */
  responsibles: string[]
  /** Responsibles matched to a MiData leader who holds one of `required`. */
  qualifiedResponsibles: string[]
  /** null = no responsible could be matched to MiData. */
  ok: boolean | null
}

export interface QualificationMatrix {
  /** Columns shown: always 'lagerleiter' + 'leiterLsT', plus the areas the camp needs (+ 'slrg' with water). */
  columns: MidataQualKey[]
  rows: QualMatrixRow[]
  /** Per column: number of leaders holding it. */
  covered: Record<MidataQualKey, number>
  /** Safety activities and whether a qualified leader is responsible. */
  activities: QualMatrixActivityCheck[]
  fetchedAt: IsoDateTime
}

/**
 * Leaders × required qualifications, matched to eCamp responsibles.
 * `areaOf` returns the safety areas of an activity (the rules' keyword detector is passed in, so this
 * module does not depend on the rule pack).
 */
export function buildQualificationMatrix(
  agg: MidataAggregate,
  facts: CampFacts,
  areaOf: (activityIri: string) => SafetyArea[],
): QualificationMatrix {
  void agg
  void facts
  void areaOf
  throw new Error('M7: not implemented')
}

/** Normalizes a nickname / display name for matching (lowercase, trimmed, diacritics folded, no punctuation). */
export function normalizeName(name: string): string {
  void name
  throw new Error('M7: not implemented')
}

/** True when eCamp period dates and MiData event dates differ (by day). Used by rule CMP-MD-01. */
export function datesDiffer(agg: MidataAggregate, campStart: string | null, campEnd: string | null): boolean {
  void agg
  void campStart
  void campEnd
  throw new Error('M7: not implemented')
}
