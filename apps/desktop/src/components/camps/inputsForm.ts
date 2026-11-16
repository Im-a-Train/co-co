/** Helpers of the Lager-Angaben form: parsing and the static input -> rule hints. */
import type { CoachInputs, Stufe } from '@/domain/types'

export const STUFEN: readonly Stufe[] = ['biber', 'woelfe', 'pfadi', 'pios', 'rover', 'gemischt'] as const

/** Number field value -> integer or null (empty / invalid / negative -> null). */
export function parseCount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

export function parseDate(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

export type TriState = 'yes' | 'no' | 'unknown'
export const toTri = (v: boolean | null): TriState => (v === null ? 'unknown' : v ? 'yes' : 'no')
export const fromTri = (v: TriState | null): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null)

/**
 * Rule ids that read each coach input (static; titles are resolved from the bundled packs when present).
 * `lagerbewilligungDone` has no rule of its own: it is the done flag of the deadline «Lagerbewilligung»
 * (see the purpose text camps.inputs.purpose.lagerbewilligungDone). Guarded by a unit test: every id exists.
 */
export const INPUT_RULES: Partial<Record<keyof CoachInputs, string[]>> = {
  isJsCamp: ['JS-CAMP-02', 'JS-LL-01', 'JS-STAFF-02', 'JS-STAFF-03'],
  participantsCount: ['JS-CAMP-02', 'JS-STAFF-02', 'JS-STAFF-03', 'BP-WATER-01'],
  participantsJsAgeCount: ['JS-CAMP-02'],
  stufe: ['BP-SLEEP-01', 'BP-WOLF-01', 'LST-TREK-02'],
  leadersCount: ['BP-WOLF-01'],
  slrgCount: ['BP-WATER-01'],
  lagerleiterAttested: ['JS-LL-01'],
  ndsRegistered: ['JS-DL-01'],
  ndsRegisteredOn: ['JS-DL-01'],
  ndsClosed: ['JS-DL-02'],
  ndsClosedOn: ['JS-DL-02'],
  jsLeadersCount: ['JS-STAFF-02', 'JS-STAFF-03'],
  leihmaterialOrdered: ['JS-DL-03'],
  leihmaterialDeliveryDate: ['JS-DL-03', 'JS-DL-04', 'JS-DL-06'],
  landeskartenDeliveryDate: ['JS-DL-03'],
  landeskartenOrdered: ['JS-DL-03'],
}

/** Normalises a draft before saving (counts to integers, invalid dates dropped). */
export function normalizeInputs(i: CoachInputs): CoachInputs {
  return {
    ...i,
    participantsCount: parseCount(i.participantsCount),
    participantsJsAgeCount: parseCount(i.participantsJsAgeCount),
    minAge: parseCount(i.minAge),
    maxAge: parseCount(i.maxAge),
    leadersCount: parseCount(i.leadersCount),
    slrgCount: parseCount(i.slrgCount),
    ...(i.jsLeadersCount !== undefined ? { jsLeadersCount: parseCount(i.jsLeadersCount) } : {}),
    ...(i.leihmaterialDeliveryDate !== undefined ? { leihmaterialDeliveryDate: parseDate(i.leihmaterialDeliveryDate) } : {}),
    ...(i.landeskartenDeliveryDate !== undefined ? { landeskartenDeliveryDate: parseDate(i.landeskartenDeliveryDate) } : {}),
    ndsRegisteredOn: parseDate(i.ndsRegisteredOn),
    ndsClosedOn: parseDate(i.ndsClosedOn),
  }
}

/** Validation message keys (under camps.inputs.errors) for an inconsistent draft. */
export function validateInputs(i: CoachInputs): string[] {
  const errs: string[] = []
  if (i.minAge !== null && i.maxAge !== null && i.minAge > i.maxAge) errs.push('ageRange')
  if (i.participantsCount !== null && i.participantsJsAgeCount !== null && i.participantsJsAgeCount > i.participantsCount)
    errs.push('jsAgeCount')
  return errs
}

/**
 * Inputs a «missing» finding (needsInput === 'coachInputs') points to, by rule id. `winterSafeAccess` is not a
 * CoachInputs field but a camp context answer (CampRuleConfig.camp), edited in place via the rule config.
 */
export type MissingInputKey = keyof CoachInputs | 'winterSafeAccess'
export const MISSING_INPUT_FIELDS: Record<string, MissingInputKey[]> = {
  'JS-CAMP-02': ['participantsJsAgeCount'],
  'JS-STAFF-02': ['jsLeadersCount'],
  'JS-LL-01': ['lagerleiterAttested'],
  'LST-WINTER-01': ['winterSafeAccess'],
}

/**
 * The inputs to fill in, in rule order and without duplicates, for the open coach-input findings. Ignored
 * findings (override) do not count, same as `missingInputs` of the review progress.
 */
export function missingInputKeys(findings: ReadonlyArray<{ ruleId: string; needsInput?: string; override?: unknown }>): MissingInputKey[] {
  const out: MissingInputKey[] = []
  for (const f of findings) {
    if (f.needsInput !== 'coachInputs' || f.override) continue
    for (const k of MISSING_INPUT_FIELDS[f.ruleId] ?? []) if (!out.includes(k)) out.push(k)
  }
  return out
}

/** Which validation error belongs to which field (shown inline at the field). */
export const ERROR_FIELDS: Record<string, Array<keyof CoachInputs>> = {
  ageRange: ['minAge', 'maxAge'],
  jsAgeCount: ['participantsJsAgeCount'],
}
