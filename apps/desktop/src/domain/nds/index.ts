/**
 * NDS (M8, red zone) – pure helpers over the NdsAggregate. Framework-free, unit-tested.
 *
 * Red-zone rules: nothing here may be passed to the AI gateway. Every value is an aggregate
 * (counts, dates, raw state codes). Raw person data never reaches TypeScript.
 *
 * CONTRACT (M8): the types live in `../types` (mirror coco-core/src/nds.rs) and are re-exported here.
 * The helpers below are filled in by the domain implementer.
 */
import type { CoachInputs, IsoDateTime, NdsAggregate, NdsField } from '../types'

export type {
  NdsActivities,
  NdsAggregate,
  NdsCampSummary,
  NdsCounts,
  NdsField,
  NdsProbe,
  NdsProbeEndpoint,
  NdsRecord,
  NdsRentalOrder,
  NdsStatistics,
  NdsStatus,
} from '../types'

/** Fields «Aus NDS übernehmen» offers, in display order. */
export const NDS_FIELDS: readonly NdsField[] = ['ndsRegistered', 'ndsRegisteredOn', 'ndsClosed']

/** Observed states that count as «closed» (ndsClosed suggestion). Other/unknown codes never do. */
export const NDS_KNOWN_CLOSED_STATES: readonly string[] = ['WAITING_FOR_ASSESSMENT', 'PAYED_CH', 'PARTIALLY_PAYED']

export type NdsFieldValue = boolean | string | null

/** One row of the «Aus NDS übernehmen» dialog. */
export interface NdsFieldDiff {
  field: NdsField
  ndsValue: NdsFieldValue
  currentValue: NdsFieldValue
  same: boolean
  /** The current value already came from NDS (CoachInputs.ndsFields has the field). */
  fromNds: boolean
}


/**
 * Single table state code -> German label. Only observed codes are listed; everything else is shown raw.
 * (offerState, offerItemState, activityState, activityType and orderState share one table.)
 */
export const NDS_STATE_LABELS: Readonly<Record<string, string>> = {
  WAITING_FOR_ASSESSMENT: 'Wartet auf Abrechnungsprüfung',
  PAYED_CH: 'Ausbezahlt',
  PARTIALLY_PAYED: 'Teilweise ausbezahlt',
  UNFINISHED_BY_BATCH: 'Unvollständig abgeschlossen (automatisch)',
  ATTENDANCE_CHECKED: 'Präsenzkontrolle erledigt',
  CAMP_DAY_WITH_YOUTH_SPORT_ACTIVITIES: 'Lagertag mit J+S-Aktivitäten',
  FIRST_CAMP_DAY: 'Erster Lagertag',
  LAST_CAMP_DAY: 'Letzter Lagertag',
  FINISHED: 'Abgeschlossen',
  // involvementType / targetAudienceGroup (observed in captures)
  INSTRUCTOR: 'Leitende',
  ASSISTANT_INSTRUCTOR: 'Hilfsleitende',
  YOUTH_TRAINING: 'J+S-Kinder und -Jugendsport',
}

/** German label of a state code; unknown codes are returned raw (null -> empty string). */
export function ndsStateLabel(code: string | null): string {
  if (!code) return ''
  return NDS_STATE_LABELS[code] ?? code
}

/** True for observed states that count as closed. Unknown/null never do. */
export function isKnownClosedState(code: string | null | undefined): boolean {
  return !!code && NDS_KNOWN_CLOSED_STATES.includes(code)
}

type NdsSuggestions = Partial<Pick<CoachInputs, 'ndsRegistered' | 'ndsRegisteredOn' | 'ndsClosed'>>

/**
 * Suggestions for coach inputs from an aggregate. Unknown codes yield no suggestion.
 * ndsRegisteredOn is the approval date («bewilligt am»): the registration happened on or before it.
 */
export function ndsSuggestions(aggregate: NdsAggregate): NdsSuggestions {
  const out: NdsSuggestions = {}
  if (aggregate.approvedOn) {
    out.ndsRegistered = true
    out.ndsRegisteredOn = aggregate.approvedOn.slice(0, 10)
  }
  if (isKnownClosedState(aggregate.offerItemState) || isKnownClosedState(aggregate.offerState)) out.ndsClosed = true
  return out
}

const nvl = (v: unknown): NdsFieldValue => (v === undefined ? null : (v as NdsFieldValue))

/** Diff rows between the aggregate's suggestions and the current inputs (only fields NDS suggests). */
export function ndsFieldDiffs(aggregate: NdsAggregate, inputs: CoachInputs | null): NdsFieldDiff[] {
  const sug = ndsSuggestions(aggregate) as Record<string, unknown>
  const cur = (inputs ?? {}) as Record<string, unknown>
  return NDS_FIELDS.filter((f) => f in sug).map((field) => {
    const ndsValue = nvl(sug[field])
    const currentValue = nvl(cur[field])
    return { field, ndsValue, currentValue, same: ndsValue === currentValue, fromNds: inputs?.ndsFields?.[field] !== undefined }
  })
}

/**
 * Applies the accepted fields: copies the NDS suggestions into the inputs and records
 * `ndsFields[field] = aggregate.fetchedAt`. Fields without a suggestion are skipped. Pure.
 */
export function adoptNdsFields(inputs: CoachInputs, aggregate: NdsAggregate, fields: readonly NdsField[], now: IsoDateTime): CoachInputs {
  const sug = ndsSuggestions(aggregate) as Record<string, unknown>
  const badges: Partial<Record<NdsField, IsoDateTime>> = { ...(inputs.ndsFields ?? {}) }
  const out: CoachInputs = { ...inputs, ndsFields: badges, updatedAt: now }
  const target = out as unknown as Record<string, unknown>
  for (const field of fields) {
    if (!NDS_FIELDS.includes(field) || !(field in sug)) continue
    target[field] = sug[field]
    badges[field] = aggregate.fetchedAt
  }
  return out
}

/**
 * Removes NDS badges of fields that were edited manually (like dropEditedMidataFields): returns `next`
 * with an updated `ndsFields`; without badges `next` is returned unchanged.
 */
export function dropEditedNdsFields(prev: CoachInputs | null, next: CoachInputs): CoachInputs {
  if (!next.ndsFields) return next
  const kept: Partial<Record<NdsField, IsoDateTime>> = {}
  const p = (prev ?? {}) as Record<string, unknown>
  const n = next as unknown as Record<string, unknown>
  for (const [f, at] of Object.entries(next.ndsFields) as [NdsField, IsoDateTime][]) {
    if (!prev || (p[f] ?? null) === (n[f] ?? null)) kept[f] = at
  }
  return { ...next, ndsFields: kept }
}

/** «Stand NDS» of an accepted field, or null. */
export function ndsSourceOf(inputs: CoachInputs | null, field: NdsField): IsoDateTime | null {
  return inputs?.ndsFields?.[field] ?? null
}

/** True when NDS camp dates (date part) differ from the eCamp period. Missing dates never differ. */
export function ndsDatesDiffer(agg: NdsAggregate, campStart: string | null, campEnd: string | null): boolean {
  if (!agg.start || !agg.end || !campStart || !campEnd) return false
  return agg.start.slice(0, 10) !== campStart.slice(0, 10) || agg.end.slice(0, 10) !== campEnd.slice(0, 10)
}

/** True when two participant counts differ by more than `threshold` (relative to the larger). Needs both > 0. */
export function participantsDiffer(ndsPlanned: number | null, other: number | null, threshold = 0.2): boolean {
  if (!ndsPlanned || !other || ndsPlanned <= 0 || other <= 0) return false
  return Math.abs(ndsPlanned - other) / Math.max(ndsPlanned, other) > threshold
}
