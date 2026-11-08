/**
 * MiData (M7, red zone) – pure helpers over the MidataAggregate. Framework-free, unit-tested.
 *
 * Red-zone rules: nothing here may be passed to the AI gateway. Leader nicknames are yellow, every
 * other value is an aggregate (counts, yes/no). Raw person data never reaches TypeScript.
 */
import type {
  CampFacts,
  CampInfo,
  CoachInputs,
  IsoDateTime,
  MidataAggregate,
  MidataField,
  MidataQualKey,
  MidataQualKind,
  MidataRecord,
} from '../types'
import { MIDATA_QUAL_KEYS } from '../types'

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
  switch (field) {
    case 'participantsCount':
      return agg.participantsCount
    case 'participantsJsAgeCount':
      return agg.participantsJsAgeCount
    case 'minAge':
      return agg.minAge
    case 'maxAge':
      return agg.maxAge
    case 'leadersCount':
      return agg.leadersCount
    case 'slrgCount':
      return agg.leaders.filter((l) => l.qualifications.slrg).length
    case 'lagerleiterAttested':
      // Only the main leader (Hauptleitung) counts, not assistants or security leaders.
      const main = agg.leaders.filter((l) => l.mainLeader === true)
      return main.length === 0 ? null : main.some((l) => l.qualifications.lagerleiter)
    default:
      return null
  }
}

/** Field-by-field comparison of the aggregate with the current coach inputs (null inputs = all empty). */
export function compareWithInputs(agg: MidataAggregate, inputs: CoachInputs | null): MidataFieldDiff[] {
  return MIDATA_FIELDS.map((field) => {
    const midataValue = midataValueFor(agg, field)
    const currentValue = (inputs?.[field] ?? null) as MidataFieldValue
    return {
      field,
      midataValue,
      currentValue,
      same: midataValue === currentValue,
      fromMidata: inputs?.midataFields?.[field] !== undefined,
    }
  })
}

/**
 * Applies the accepted fields: copies the MiData values into the inputs and records
 * `midataFields[field] = agg.fetchedAt`. Other fields are left untouched. Pure (returns a new object).
 */
export function adoptFields(inputs: CoachInputs, agg: MidataAggregate, fields: readonly MidataField[], now: IsoDateTime): CoachInputs {
  const badges: Partial<Record<MidataField, IsoDateTime>> = { ...(inputs.midataFields ?? {}) }
  const out: CoachInputs = { ...inputs, midataFields: badges, updatedAt: now }
  const target = out as unknown as Record<string, unknown>
  for (const field of fields) {
    if (!MIDATA_FIELDS.includes(field)) continue
    target[field] = midataValueFor(agg, field)
    badges[field] = agg.fetchedAt
  }
  return out
}

/**
 * Removes the MiData badge from every field whose value differs between `prev` and `next`
 * (the coach edited it by hand). Returns `next` with an updated `midataFields`; when all badges
 * are dropped the result is `{}` (not undefined). Without badges `next` is returned unchanged.
 */
export function dropEditedMidataFields(prev: CoachInputs | null, next: CoachInputs): CoachInputs {
  if (!next.midataFields) return next
  const kept: Partial<Record<MidataField, IsoDateTime>> = {}
  for (const [f, at] of Object.entries(next.midataFields) as [MidataField, IsoDateTime][]) {
    if (!prev || (prev[f] ?? null) === (next[f] ?? null)) kept[f] = at
  }
  return { ...next, midataFields: kept }
}

/** «Stand MiData» of an accepted field, or null. */
export function midataSourceOf(inputs: CoachInputs | null, field: MidataField): IsoDateTime | null {
  return inputs?.midataFields?.[field] ?? null
}

/**
 * Resolves the MiData event of a camp: eCamp link (camp.hitobitoEventId) wins over a manual pick.
 * The eCamp id is accepted when the provider is empty or matches /pbs|midata/i; other providers
 * (e.g. a different hitobito instance) are ignored.
 */
export function resolveEventLink(
  camp: Pick<CampInfo, 'hitobitoEventId' | 'hitobitoProvider'>,
  stored: MidataRecord | null,
): { eventId: string; source: 'ecamp' | 'manual' } | null {
  const id = camp.hitobitoEventId == null ? '' : String(camp.hitobitoEventId).trim()
  const provider = camp.hitobitoProvider == null ? '' : String(camp.hitobitoProvider).trim()
  if (id && (!provider || /pbs|midata/i.test(provider))) return { eventId: id, source: 'ecamp' }
  // A stored eCamp link whose eCamp side is gone becomes changeable by the coach.
  if (stored?.eventId) return { eventId: stored.eventId, source: 'manual' }
  return null
}

/** Safety areas of a camp detected from its activities (water / mountain / winter / rope …). */
export type SafetyArea = 'wasser' | 'berg' | 'winter'

/** 'valid' = valid over the whole camp, 'invalid' = held but not valid during the camp, 'none' = not held. */
export type QualCellState = 'valid' | 'invalid' | 'none'

export interface QualMatrixDetail {
  label: string
  keys: MidataQualKey[]
  validAtCamp: boolean
  finishAt: string | null
}

export interface QualMatrixRow {
  nickname: string
  roleLabel: string
  /** All roles of the person in the camp (falls back to `[roleLabel]` for old aggregates). */
  roleLabels: string[]
  cells: Record<MidataQualKey, QualCellState>
  /** Qualifications held (empty for old aggregates). */
  details: QualMatrixDetail[]
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
  /** Keywords that made the detector flag this activity for the area (heuristic; for display). */
  keywords: string[]
}

export interface QualificationMatrix {
  /** Columns shown: always 'lagerleiter' + 'leiterLsT', plus the areas the camp needs (+ 'slrg' with water). */
  columns: MidataQualKey[]
  rows: QualMatrixRow[]
  /** Per column: number of leaders holding it valid during the camp. */
  covered: Record<MidataQualKey, number>
  /** Safety activities and whether a qualified leader is responsible. */
  activities: QualMatrixActivityCheck[]
  /** false = MiData qualifications were not readable (no permission): cells are «unknown», not «missing». */
  qualificationsReadable: boolean
  fetchedAt: IsoDateTime
}

const REQUIRED_BY_AREA: Record<SafetyArea, readonly MidataQualKey[]> = {
  wasser: ['wasser', 'slrg'],
  berg: ['berg'],
  winter: ['winter'],
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
  keywordsOf: (activityIri: string, area: SafetyArea) => string[] = () => [],
): QualificationMatrix {
  const perActivity = facts.activities.map((a) => ({ a, areas: [...new Set(areaOf(a.iri))] }))
  const present = new Set<SafetyArea>(perActivity.flatMap((x) => x.areas))
  const wanted = new Set<MidataQualKey>(['lagerleiter', 'leiterLsT'])
  if (present.has('wasser')) {
    wanted.add('wasser')
    wanted.add('slrg')
  }
  if (present.has('berg')) wanted.add('berg')
  if (present.has('winter')) wanted.add('winter')
  const columns = MIDATA_QUAL_KEYS.filter((k) => wanted.has(k))

  const collabs = facts.collaborators.map((c) => ({ iri: c.iri, name: c.displayName, norm: normalizeName(c.displayName) }))
  const rows: QualMatrixRow[] = agg.leaders.map((l) => {
    const n = normalizeName(l.nickname)
    const expired = l.expiredQualifications ?? []
    const cells = Object.fromEntries(
      MIDATA_QUAL_KEYS.map((k) => [k, l.qualifications[k] === true ? 'valid' : expired.includes(k) ? 'invalid' : 'none']),
    ) as Record<MidataQualKey, QualCellState>
    return {
      nickname: l.nickname,
      roleLabel: l.roleLabel,
      roleLabels: l.roleLabels && l.roleLabels.length > 0 ? l.roleLabels : [l.roleLabel],
      cells,
      details: l.qualificationDetails ?? [],
      ecampMatches: n ? collabs.filter((c) => c.norm === n).map((c) => c.name) : [],
    }
  })
  const covered = Object.fromEntries(
    MIDATA_QUAL_KEYS.map((k) => [k, agg.leaders.filter((l) => l.qualifications[k] === true).length]),
  ) as Record<MidataQualKey, number>

  const leaderByNorm = leadersByNormName(agg.leaders)
  const activities: QualMatrixActivityCheck[] = []
  for (const { a, areas } of perActivity) {
    for (const area of areas) {
      const required = REQUIRED_BY_AREA[area]
      const iris = new Set(facts.activityResponsibles.filter((r) => r.activityIri === a.iri).map((r) => r.collaborationIri))
      const resp = collabs.filter((c) => iris.has(c.iri))
      const matched = resp.filter((c) => c.norm && leaderByNorm.has(c.norm))
      const qualified = matched.filter((c) =>
        leaderByNorm.get(c.norm)!.some((l) => required.some((k) => l.qualifications[k] === true)),
      )
      activities.push({
        activityIri: a.iri,
        activityTitle: a.title,
        area,
        required: [...required],
        responsibles: resp.map((c) => c.name),
        qualifiedResponsibles: qualified.map((c) => c.name),
        ok: matched.length === 0 ? null : qualified.length > 0,
        keywords: keywordsOf(a.iri, area),
      })
    }
  }
  return { columns, rows, covered, activities, qualificationsReadable: agg.qualificationsReadable !== false, fetchedAt: agg.fetchedAt }
}

/** Normalizes a nickname / display name / place for matching (lowercase, diacritics and ß folded, punctuation -> space). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** All leaders per normalized name (nicknames are not unique). */
export function leadersByNormName<T extends { nickname: string }>(leaders: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const l of leaders) {
    const k = normalizeName(l.nickname)
    if (k) m.set(k, [...(m.get(k) ?? []), l])
  }
  return m
}

const DAY_MS = 86_400_000
const dayNum = (iso: string): number => Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY_MS

/**
 * Earliest start / latest finish of the MiData event dates (date part). Dates that lie completely
 * outside the eCamp period ± slackDays (e.g. a Vorweekend) are ignored; if none remain, all are used.
 */
export function midataDateRange(
  agg: MidataAggregate,
  campStart: string,
  campEnd: string,
  slackDays = 7,
): { start: string; end: string } | null {
  const all = agg.eventDates.map((d) => ({ s: d.startAt.slice(0, 10), e: (d.finishAt || d.startAt).slice(0, 10) }))
  if (all.length === 0) return null
  const lo = dayNum(campStart) - slackDays
  const hi = dayNum(campEnd) + slackDays
  const near = all.filter((d) => dayNum(d.e) >= lo && dayNum(d.s) <= hi)
  const use = near.length > 0 ? near : all
  return { start: use.map((d) => d.s).sort()[0], end: use.map((d) => d.e).sort().slice(-1)[0] }
}

/** True when eCamp period dates and MiData event dates differ (by day). Used by rule CMP-MD-01. */
export function datesDiffer(agg: MidataAggregate, campStart: string | null, campEnd: string | null): boolean {
  if (!campStart || !campEnd) return false
  const r = midataDateRange(agg, campStart, campEnd)
  return r !== null && (r.start !== campStart.slice(0, 10) || r.end !== campEnd.slice(0, 10))
}

/** True when both locations are known and neither contains the other (case/diacritic-insensitive). */
export function locationDiffers(mdLocation: string | null | undefined, ecamp: ReadonlyArray<string | null | undefined>): boolean {
  const md = normalizeName(mdLocation ?? '')
  const mine = ecamp.map((x) => normalizeName(x ?? '')).filter(Boolean)
  if (!md || mine.length === 0) return false
  return !mine.some((x) => md.includes(x) || x.includes(md))
}

// ---------------------------------------------------------------------------------------------
// Qualification kind mapping (MiData label -> co-co columns)
// ---------------------------------------------------------------------------------------------

export type QualMapping = Record<string, MidataQualKey[]>

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const sortKeys = (keys: readonly MidataQualKey[]): MidataQualKey[] => MIDATA_QUAL_KEYS.filter((k) => keys.includes(k))
const sameKeys = (a: readonly MidataQualKey[], b: readonly MidataQualKey[]): boolean => {
  const x = sortKeys(a)
  const y = sortKeys(b)
  return x.length === y.length && x.every((k, i) => k === y[i])
}

/** Keys a label counts for: the override from the settings wins over the keys the aggregate carries (built-in mapping). */
export function effectiveKeys(kind: Pick<MidataQualKind, 'label' | 'keys'>, overrides: QualMapping): MidataQualKey[] {
  return sortKeys(has(overrides, kind.label) ? overrides[kind.label] : kind.keys)
}

/** A label that counts for no column and was not explicitly ignored by an override. */
export function isUnmappedKind(kind: Pick<MidataQualKind, 'label' | 'keys'>, overrides: QualMapping): boolean {
  return !has(overrides, kind.label) && kind.keys.length === 0
}

/**
 * The override map after the coach edited some labels. A label whose edited keys equal what the aggregate
 * already carries and has no override yet gets no entry (minimal map); other labels keep their entry.
 */
export function nextQualMapping(current: QualMapping, kinds: readonly MidataQualKind[], edited: QualMapping): QualMapping {
  const next: QualMapping = { ...current }
  for (const kind of kinds) {
    if (!has(edited, kind.label)) continue
    const keys = sortKeys(edited[kind.label])
    if (!has(current, kind.label) && sameKeys(keys, kind.keys)) delete next[kind.label]
    else next[kind.label] = keys
  }
  return next
}

/** True if the edited mapping differs from the effective one (enables the save button). */
export function qualMappingChanged(kinds: readonly MidataQualKind[], overrides: QualMapping, edited: QualMapping): boolean {
  return kinds.some((k) => has(edited, k.label) && !sameKeys(edited[k.label], effectiveKeys(k, overrides)))
}
