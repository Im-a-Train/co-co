/** Age helpers for the Personen tab. Pure. J+S age band: 5-20 years at camp start (same rule as the aggregates). */
export const JS_AGE_MIN = 5
export const JS_AGE_MAX = 20

/** Completed years at `ref` (both `YYYY-MM-DD`, wall-clock, no time zones); null for unreadable dates. */
export function ageAt(birthDate: string | null | undefined, ref: string | null | undefined): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate ?? '')
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(ref ?? '')
  if (!b || !r) return null
  let age = Number(r[1]) - Number(b[1])
  if (Number(r[2]) < Number(b[2]) || (Number(r[2]) === Number(b[2]) && Number(r[3]) < Number(b[3]))) age -= 1
  return age < 0 ? null : age
}

export function isJsAge(age: number | null): boolean {
  return age !== null && age >= JS_AGE_MIN && age <= JS_AGE_MAX
}

/** `••.••.2012` for `2012-03-04`; '–' when unknown. */
export function maskBirthDate(birthDate: string | null): string {
  const m = /^(\d{4})-/.exec(birthDate ?? '')
  return m ? `••.••.${m[1]}` : '–'
}

/** `04.03.2012` for `2012-03-04`; '–' when unknown. */
export function formatBirthDate(birthDate: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '–'
}
