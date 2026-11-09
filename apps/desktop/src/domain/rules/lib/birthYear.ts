/**
 * J+S age by Jahrgang (WEB-C «J+S-Alter»): a participant is in J+S age when
 * `campYear − birthYear ∈ [ageMin, ageMax]` (params js.ageMin / js.ageMax). Pure.
 */

export function campYearOf(start: string | null | undefined, fallback: Date): number {
  return start ? Number(start.slice(0, 4)) : fallback.getUTCFullYear()
}

export function isJsAgeByYear(campYear: number, birthYear: number, ageMin: number, ageMax: number): boolean {
  const age = campYear - birthYear
  return age >= ageMin && age <= ageMax
}

/** Jahrgänge (inclusive) that are in J+S age for the camp year. */
export function jsBirthYearRange(campYear: number, ageMin: number, ageMax: number): { fromYear: number; toYear: number } {
  return { fromYear: campYear - ageMax, toYear: campYear - ageMin }
}

/** Participants in / outside J+S age from a per-Jahrgang aggregate (MidataAggregate.participantsByBirthYear). */
export function countJsAgeByYear(
  byBirthYear: Record<number, number>,
  campYear: number,
  ageMin: number,
  ageMax: number,
): { inAge: number; outside: number; outsideYears: number[] } {
  let inAge = 0
  let outside = 0
  const outsideYears: number[] = []
  for (const [y, n] of Object.entries(byBirthYear)) {
    const year = Number(y)
    if (isJsAgeByYear(campYear, year, ageMin, ageMax)) inAge += n
    else if (n > 0) {
      outside += n
      outsideYears.push(year)
    }
  }
  return { inAge, outside, outsideYears: outsideYears.sort((a, b) => a - b) }
}
