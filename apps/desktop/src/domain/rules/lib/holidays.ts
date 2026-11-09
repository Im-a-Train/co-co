/**
 * Public holidays from the param `js.publicHolidays` (JS-DL-04). Entries are `MM-DD` (fixed) or
 * `easter±N` (movable, relative to Easter Sunday). Pure.
 */
import type { IsoDate } from '../../types'

/** Easter Sunday of a year (Gregorian computus, Meeus/Jones/Butcher) as `YYYY-MM-DD`. */
export function easterSunday(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function shift(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** All holiday dates of `year` for the given spec entries. */
export function holidayDates(year: number, spec: readonly string[]): IsoDate[] {
  const out: IsoDate[] = []
  for (const entry of spec) {
    const rel = /^easter([+-]\d+)?$/.exec(entry)
    if (rel) out.push(shift(easterSunday(year), rel[1] ? Number(rel[1]) : 0))
    else if (/^\d{2}-\d{2}$/.test(entry)) out.push(`${year}-${entry}`)
  }
  return out
}

export function isPublicHoliday(date: IsoDate, spec: readonly string[]): boolean {
  const d = date.slice(0, 10)
  return holidayDates(Number(d.slice(0, 4)), spec).includes(d)
}

/** Day of week of a `YYYY-MM-DD` date, 0 = Sunday. */
export function weekdayOf(date: IsoDate): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
