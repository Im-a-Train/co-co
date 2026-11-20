/**
 * NDS (M8, red zone) – pure helpers over the NdsAggregate. Framework-free, unit-tested.
 *
 * Red-zone rules: nothing here may be passed to the AI gateway. Every value is an aggregate
 * (counts, dates, raw state codes). Raw person data never reaches TypeScript.
 *
 * CONTRACT (M8): the types live in `../types` (mirror coco-core/src/nds.rs) and are re-exported here.
 * The helpers below are filled in by the domain implementer.
 */
import { tr } from '../feedback/i18n'
import type { CoachInputs, IsoDateTime, NdsAggregate, NdsField } from '../types'

export type {
  NdsActivities,
  NdsAttendance,
  NdsCampDetails,
  NdsCoachProfile,
  NdsPersonDetection,
  NdsProtocol,
  NdsRecognition,
  NdsRecognitionsResult,
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
export const NDS_FIELDS: readonly NdsField[] = ['ndsRegistered', 'ndsRegisteredOn', 'ndsClosed', 'ndsClosedOn']

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
 * German label of a state code, from the locale table `nds.state.<CODE>` (offerState, offerItemState,
 * activityState, activityType and orderState share one table). Only observed codes are listed; unknown
 * codes are returned raw (null -> empty string).
 */
export function ndsStateLabel(code: string | null): string {
  if (!code) return ''
  const key = `nds.state.${code}`
  const label = tr(key)
  return label === key ? code : label
}

/** True for observed states that count as closed. Unknown/null never do. */
export function isKnownClosedState(code: string | null | undefined): boolean {
  return !!code && NDS_KNOWN_CLOSED_STATES.includes(code)
}

type NdsSuggestions = Partial<Pick<CoachInputs, 'ndsRegistered' | 'ndsRegisteredOn' | 'ndsClosed' | 'ndsClosedOn'>>

/**
 * Suggestions for coach inputs from an aggregate. Unknown codes yield no suggestion.
 * ndsRegisteredOn is the submission date from the offer protocol («eingereicht am», M22) when known,
 * else the approval date («bewilligt am»): the registration happened on or before it.
 * ndsClosedOn is the protocol's closing date (only when present).
 */
export function ndsSuggestions(aggregate: NdsAggregate): NdsSuggestions {
  const out: NdsSuggestions = {}
  const registeredOn = aggregate.protocol?.submittedOn ?? aggregate.approvedOn
  if (registeredOn) {
    out.ndsRegistered = true
    out.ndsRegisteredOn = registeredOn.slice(0, 10)
  }
  const closedOn = aggregate.protocol?.closedOn
  if (closedOn) out.ndsClosedOn = closedOn.slice(0, 10)
  if (closedOn || isKnownClosedState(aggregate.offerItemState) || isKnownClosedState(aggregate.offerState)) out.ndsClosed = true
  return out
}

/**
 * True when the adopted «angemeldet am» (inputs.ndsFields.ndsRegisteredOn set) equals the protocol's
 * submission date, i.e. it is the real submission date and not just the approval date. Used by JS-DL-01 and the UI hint.
 */
export function ndsRegisteredOnIsSubmission(agg: NdsAggregate | null | undefined, inputs: CoachInputs | null | undefined): boolean {
  const on = inputs?.ndsRegisteredOn
  if (!inputs?.ndsFields?.ndsRegisteredOn || !on) return false
  const sub = agg?.protocol?.submittedOn
  return !!sub && sub.slice(0, 10) === on
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

/** `dd.mm.yyyy` of an ISO date (or date-time). */
function dmy(iso: string): { d: string; m: string; y: string } {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return { d, m, y }
}

/** «24.–30.01.2031» within one month, «30.01. – 03.02.2031» within one year, else full dates; empty without start. */
export function ndsDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return ''
  const a = dmy(start)
  if (!end || end.slice(0, 10) === start.slice(0, 10)) return `${a.d}.${a.m}.${a.y}`
  const b = dmy(end)
  if (a.y === b.y && a.m === b.m) return `${a.d}.–${b.d}.${b.m}.${b.y}`
  if (a.y === b.y) return `${a.d}.${a.m}. – ${b.d}.${b.m}.${b.y}`
  return `${a.d}.${a.m}.${a.y} – ${b.d}.${b.m}.${b.y}`
}

/**
 * What the link line shows. A loaded aggregate wins (it is the latest NDS state and always belongs to the
 * linked camp, see saveNdsLink); otherwise the extras stored with the link at pick time.
 */
export interface NdsLinkInfo {
  groupName: string | null
  offerNumber: string | null
  dates: string
}

export function ndsLinkInfo(
  link: { groupName?: string | null; offerNumber?: string | null; start?: string | null; end?: string | null },
  agg: { offerNumber: string | null; start: string | null; end: string | null } | null,
): NdsLinkInfo {
  return {
    groupName: link.groupName ?? null,
    offerNumber: agg?.offerNumber ?? link.offerNumber ?? null,
    dates: agg?.start ? ndsDateRange(agg.start, agg.end) : ndsDateRange(link.start, link.end),
  }
}
