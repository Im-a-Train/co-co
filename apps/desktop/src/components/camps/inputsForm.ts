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

/** Rule ids that read each coach input (static; titles are resolved from the bundled packs when present). */
export const INPUT_RULES: Partial<Record<keyof CoachInputs, string[]>> = {
  isJsCamp: ['JS-CAMP-02', 'JS-LL-01', 'JS-STAFF-02', 'JS-STAFF-03'],
  participantsCount: ['JS-CAMP-02', 'JS-STAFF-02', 'JS-STAFF-03', 'BP-WATER-01'],
  participantsJsAgeCount: ['JS-CAMP-02'],
  stufe: ['BP-SLEEP-01', 'BP-WOLF-01', 'SAFE-MTN-02'],
  leadersCount: ['JS-STAFF-02', 'JS-STAFF-03'],
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
