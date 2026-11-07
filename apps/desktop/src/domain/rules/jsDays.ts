/**
 * Lagertag-Rechner (J+S day calculator). OWNER: rules builder. Pure.
 * Used by rules JS-DAY-01..04 AND by the cockpit (raster + KPIs), so its output is the contract.
 *
 * J+S units = schedule entries whose activity category maps to LS or LA.
 * A day is valid with >= 2 J+S units AND >= 240 J+S minutes; each unit >= 30 min; >= 30 min
 * Sozialzeit between consecutive units. First + last day are combined into one day when together
 * >= 240 min (JS-DAY-04) and they are not both valid on their own.
 * Times: camp-local wall clock (eCamp serialises them with +00:00), read with UTC getters.
 *
 * Without a mapping (null) no entry counts as J+S unit.
 */
import type {
  CampFacts,
  CategoryClass,
  CategoryMapping,
  DayFact,
  Iri,
  IsoDate,
  IsoDateTime,
  ScheduleEntryFact,
} from '../types'

export const MIN_UNIT_MINUTES = 30
export const MIN_GAP_MINUTES = 30
export const MIN_DAY_MINUTES = 240
export const MIN_DAY_UNITS = 2

export interface JsUnit {
  scheduleEntryIri: Iri
  activityIri: Iri
  categoryClass: CategoryClass
  start: IsoDateTime
  end: IsoDateTime
  minutes: number
  /** false if < 30 min (JS-DAY-02) */
  longEnough: boolean
}

export interface SozialzeitGap {
  /** end of previous unit */
  start: IsoDateTime
  /** start of next unit */
  end: IsoDateTime
  minutes: number
  /** false if < 30 min (JS-DAY-03); the cockpit grid hatches these */
  ok: boolean
}

export interface JsDay {
  dayIri: Iri
  date: IsoDate
  /** 1-based number of the day within the whole camp (all periods, sorted by date). */
  number: number
  units: JsUnit[]
  gaps: SozialzeitGap[]
  jsMinutes: number
  unitCount: number
  /** Valid on its own (>= 2 units, >= 240 min, all units >= 30 min, all gaps ok). */
  valid: boolean
  /** Set on first/last day when combined per JS-DAY-04 (the other day's IRI). */
  combinedWith: Iri | null
  /** Valid as part of the arrival/departure combination. */
  validCombined: boolean
}

export interface JsDayReport {
  days: JsDay[]
  /** Counted J+S days (combined arrival+departure count once). */
  validDayCount: number
  /** Days of the camp (combined arrival+departure count once when combined). */
  totalDayCount: number
}

// ---------------------------------------------------------------------------------------------
// Wall-clock helpers (shared with rules + cockpit)
// ---------------------------------------------------------------------------------------------

/** `YYYY-MM-DD` of an eCamp date-time (wall clock). */
export function wallDate(iso: IsoDateTime): IsoDate {
  return iso.slice(0, 10)
}

/** Minutes since midnight (wall clock) of an eCamp date-time. */
export function wallMinutes(iso: IsoDateTime): number {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** Minutes between two date-times (wall clock; both use the same fake offset). */
export function minutesBetween(a: IsoDateTime, b: IsoDateTime): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}

export function entryMinutes(e: ScheduleEntryFact): number {
  return Number.isFinite(e.durationMinutes) && e.durationMinutes > 0 ? e.durationMinutes : minutesBetween(e.start, e.end)
}

export function categoryClassOf(mapping: CategoryMapping | null, categoryIri: Iri | null): CategoryClass {
  if (!mapping || !categoryIri) return 'NONE'
  return mapping.entries[categoryIri] ?? 'NONE'
}

export function isJsClass(c: CategoryClass): boolean {
  return c === 'LS' || c === 'LA'
}

/** Day of an entry: its dayIri, else the day whose date equals the entry's start date. */
export function dayOfEntry(facts: CampFacts, e: ScheduleEntryFact): DayFact | null {
  if (e.dayIri) {
    const d = facts.days.find((x) => x.iri === e.dayIri)
    if (d) return d
  }
  const date = wallDate(e.start)
  return facts.days.find((x) => x.date === date) ?? null
}

/** Days sorted by date (stable across periods). */
export function sortedDays(facts: CampFacts): DayFact[] {
  return [...facts.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ---------------------------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------------------------

function qualityOk(d: JsDay): boolean {
  return d.units.every((u) => u.longEnough) && d.gaps.every((g) => g.ok)
}

function buildDay(facts: CampFacts, mapping: CategoryMapping | null, day: DayFact, number: number): JsDay {
  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  const units: JsUnit[] = []
  for (const e of facts.scheduleEntries) {
    if (dayOfEntry(facts, e)?.iri !== day.iri) continue
    const activity = activityById.get(e.activityIri)
    const cls = categoryClassOf(mapping, activity?.categoryIri ?? null)
    if (!isJsClass(cls)) continue
    const minutes = entryMinutes(e)
    units.push({
      scheduleEntryIri: e.iri,
      activityIri: e.activityIri,
      categoryClass: cls,
      start: e.start,
      end: e.end,
      minutes,
      longEnough: minutes >= MIN_UNIT_MINUTES,
    })
  }
  units.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || (a.end < b.end ? -1 : 1))
  const gaps: SozialzeitGap[] = []
  // Merge overlapping/touching units: minutes are counted on the union, gaps from the running max end.
  let jsMinutes = 0
  let blockStart = 0
  let blockEnd = 0
  let maxEndIso = ''
  units.forEach((u, i) => {
    const s0 = new Date(u.start).getTime()
    const e0 = new Date(u.end).getTime()
    if (i === 0) {
      blockStart = s0
      blockEnd = e0
      maxEndIso = u.end
      return
    }
    if (s0 <= blockEnd) {
      if (e0 > blockEnd) {
        blockEnd = e0
        maxEndIso = u.end
      }
      return
    }
    jsMinutes += Math.round((blockEnd - blockStart) / 60000)
    const minutes = minutesBetween(maxEndIso, u.start)
    gaps.push({ start: maxEndIso, end: u.start, minutes, ok: minutes >= MIN_GAP_MINUTES })
    blockStart = s0
    blockEnd = e0
    maxEndIso = u.end
  })
  if (units.length) jsMinutes += Math.round((blockEnd - blockStart) / 60000)
  const day0: JsDay = {
    dayIri: day.iri,
    date: day.date,
    number,
    units,
    gaps,
    jsMinutes,
    unitCount: units.length,
    valid: false,
    combinedWith: null,
    validCombined: false,
  }
  day0.valid = units.length >= MIN_DAY_UNITS && jsMinutes >= MIN_DAY_MINUTES && qualityOk(day0)
  return day0
}

export function computeJsDays(facts: CampFacts, mapping: CategoryMapping | null): JsDayReport {
  const days = sortedDays(facts).map((d, i) => buildDay(facts, mapping, d, i + 1))
  let combined = false
  if (days.length >= 2) {
    const first = days[0]
    const last = days[days.length - 1]
    if (!(first.valid && last.valid)) {
      const ok =
        first.unitCount + last.unitCount >= MIN_DAY_UNITS &&
        first.jsMinutes + last.jsMinutes >= MIN_DAY_MINUTES && qualityOk(first) && qualityOk(last)
      if (ok) {
        combined = true
        first.combinedWith = last.dayIri
        last.combinedWith = first.dayIri
        first.validCombined = true
        last.validCombined = true
      }
    }
  }
  let validDayCount = 0
  days.forEach((d, i) => {
    const isEdge = i === 0 || i === days.length - 1
    if (combined && isEdge) return
    if (d.valid) validDayCount++
  })
  if (combined) validDayCount++
  return { days, validDayCount, totalDayCount: days.length - (combined ? 1 : 0) }
}

/** True if the mapping puts at least one category into LS or LA. */
export function hasJsMapping(mapping: CategoryMapping | null): boolean {
  return !!mapping && Object.values(mapping.entries).some(isJsClass)
}

/** Date of the last day with a J+S unit (null if none). */
export function lastJsDate(report: JsDayReport): IsoDate | null {
  for (let i = report.days.length - 1; i >= 0; i--) if (report.days[i].unitCount > 0) return report.days[i].date
  return null
}

/** Days without any J+S unit (trainingsfreie Tage), excluding days merged into a valid arrival/departure combination. */
export function trainingFreeDays(report: JsDayReport): JsDay[] {
  return report.days.filter((d) => d.unitCount === 0 && !d.validCombined)
}

/** Quantity check used by JS-DAY-01: enough units + minutes (ignores unit length and Sozialzeit). */
export function quantityOk(d: JsDay): boolean {
  return d.validCombined || (d.unitCount >= MIN_DAY_UNITS && d.jsMinutes >= MIN_DAY_MINUTES)
}
