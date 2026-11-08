/**
 * Lagertag-Rechner (J+S day calculator). Pure.
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
  ActivityTag,
  JsDayModel,
  JsInterval,
  JsModelDay,
  ParamReader,
  ScheduleEntryFact,
} from '../../types'
import { addDays } from './deadlines'
import { parseTimeWindows, windowsCovered } from './timeWindows'

export const MIN_UNIT_MINUTES = 30
export const MIN_GAP_MINUTES = 30
export const MIN_DAY_MINUTES = 240
export const MIN_DAY_UNITS = 2

/** Day thresholds (defaults = 2026 values; rules pass the camp's params, see thresholdsFromParams). */
export interface JsThresholds {
  minUnitMinutes: number
  minGapMinutes: number
  minDayMinutes: number
  minDayUnits: number
}

export const DEFAULT_JS_THRESHOLDS: JsThresholds = {
  minUnitMinutes: MIN_UNIT_MINUTES,
  minGapMinutes: MIN_GAP_MINUTES,
  minDayMinutes: MIN_DAY_MINUTES,
  minDayUnits: MIN_DAY_UNITS,
}

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

function buildDay(facts: CampFacts, mapping: CategoryMapping | null, day: DayFact, number: number, t: JsThresholds): JsDay {
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
      longEnough: minutes >= t.minUnitMinutes,
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
    gaps.push({ start: maxEndIso, end: u.start, minutes, ok: minutes >= t.minGapMinutes })
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
  day0.valid = units.length >= t.minDayUnits && jsMinutes >= t.minDayMinutes && qualityOk(day0)
  return day0
}

export function computeJsDays(facts: CampFacts, mapping: CategoryMapping | null, t: JsThresholds = DEFAULT_JS_THRESHOLDS): JsDayReport {
  const days = sortedDays(facts).map((d, i) => buildDay(facts, mapping, d, i + 1, t))
  let combined = false
  if (days.length >= 2) {
    const first = days[0]
    const last = days[days.length - 1]
    if (!(first.valid && last.valid)) {
      const ok =
        first.unitCount + last.unitCount >= t.minDayUnits &&
        first.jsMinutes + last.jsMinutes >= t.minDayMinutes && qualityOk(first) && qualityOk(last)
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

export type JsDayReason =
  | { code: 'fewUnits'; units: number; required: number }
  | { code: 'tooShort'; minutes: number; required: number }
  | { code: 'shortUnit'; activityIri: Iri; minutes: number; start: IsoDateTime; end: IsoDateTime; required: number }
  | { code: 'gap'; minutes: number; start: IsoDateTime; end: IsoDateTime; required: number }
  | { code: 'combinedOnly' }

/**
 * Why a day is not valid on its own (mirrors `buildDay` / `qualityOk`). Empty for a valid day.
 * A day that is only valid through the arrival/departure combination lists its own failures
 * followed by `combinedOnly`.
 */
export function jsDayInvalidReasons(day: JsDay, t: JsThresholds = DEFAULT_JS_THRESHOLDS): JsDayReason[] {
  if (day.valid) return []
  const reasons: JsDayReason[] = []
  if (day.unitCount < t.minDayUnits) reasons.push({ code: 'fewUnits', units: day.unitCount, required: t.minDayUnits })
  if (day.jsMinutes < t.minDayMinutes) reasons.push({ code: 'tooShort', minutes: day.jsMinutes, required: t.minDayMinutes })
  for (const u of day.units) {
    if (!u.longEnough) {
      reasons.push({
        code: 'shortUnit',
        activityIri: u.activityIri,
        minutes: u.minutes,
        start: u.start,
        end: u.end,
        required: t.minUnitMinutes,
      })
    }
  }
  for (const g of day.gaps) {
    if (!g.ok) reasons.push({ code: 'gap', minutes: g.minutes, start: g.start, end: g.end, required: t.minGapMinutes })
  }
  if (day.validCombined) reasons.push({ code: 'combinedOnly' })
  return reasons
}

/** Quantity check used by JS-DAY-01: enough units + minutes (ignores unit length and Sozialzeit). */
export function quantityOk(d: JsDay, t: JsThresholds = DEFAULT_JS_THRESHOLDS): boolean {
  return d.validCombined || (d.unitCount >= t.minDayUnits && d.jsMinutes >= t.minDayMinutes)
}

// ---------------------------------------------------------------------------------------------
// Rules v2: shared J+S day model (catalog §3.9), exposed as ctx.js
// ---------------------------------------------------------------------------------------------

/** J+S thresholds of the camp read from the params (same names as JsThresholds). */
export function thresholdsFromParams(params: ParamReader): JsThresholds {
  return {
    minUnitMinutes: params.get<number>('js.minUnitMinutes'),
    minGapMinutes: params.get<number>('js.minGapMinutes'),
    minDayMinutes: params.get<number>('js.minDayMinutes'),
    minDayUnits: params.get<number>('js.minDayUnits'),
  }
}

const JS_TAGS: readonly ActivityTag[] = ['js-aktivitaet', 'keine-js-aktivitaet', 'ebb-a', 'ebb-b']

/** J+S status of an activity: tag `keine-js-aktivitaet` → false; `js-aktivitaet`/`ebb-a`/`ebb-b` → true; else mapping (LS/LA); null = unknown. */
export function jsStatusOf(mapping: CategoryMapping | null, categoryIri: Iri | null, tags: readonly ActivityTag[]): boolean | null {
  if (tags.includes('keine-js-aktivitaet')) return false
  if (tags.includes('js-aktivitaet') || tags.includes('ebb-a') || tags.includes('ebb-b')) return true
  if (!mapping) return null
  return isJsClass(categoryClassOf(mapping, categoryIri))
}

/** Sorted union of intervals (overlapping or touching intervals merge). */
export function unionIntervals(list: readonly JsInterval[]): JsInterval[] {
  const sorted = [...list].filter((i) => i.to > i.from).sort((a, b) => a.from - b.from || a.to - b.to)
  const out: JsInterval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.from <= last.to) last.to = Math.max(last.to, i.to)
    else out.push({ ...i })
  }
  return out
}

export interface JsModelInput {
  facts: CampFacts
  mapping: CategoryMapping | null
  tagsOf: (activityIri: Iri) => readonly ActivityTag[]
  params: ParamReader
}

interface DateSlot {
  intervals: JsInterval[]
  short: Iri[]
  entries: Iri[]
  bwz: number
  bwzKnown: boolean
}

/** Builds the J+S day model of a camp (§3.9). Times are wall clock; entries crossing midnight are split. */
export function buildJsDayModel({ facts, mapping, tagsOf, params }: JsModelInput): JsDayModel {
  const t = thresholdsFromParams(params)
  const minBwzDay = params.get<number | null>('js.minBwzDayMinutes')
  const minBwzActivity = params.get<number | null>('js.minBwzActivityMinutes')
  const windows = parseTimeWindows(params.get('js.timeWindows'))
  const minOverlap = params.get<number>('js.timeWindowMinOverlap')

  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  const entriesPerActivity = new Map<Iri, number>()
  for (const e of facts.scheduleEntries) entriesPerActivity.set(e.activityIri, (entriesPerActivity.get(e.activityIri) ?? 0) + 1)
  const statusCache = new Map<Iri, boolean | null>()
  const isJsActivity = (iri: Iri): boolean | null => {
    if (!statusCache.has(iri)) statusCache.set(iri, jsStatusOf(mapping, activityById.get(iri)?.categoryIri ?? null, tagsOf(iri)))
    return statusCache.get(iri) ?? null
  }
  const anyJsTag = facts.activities.some((a) => tagsOf(a.iri).some((x) => JS_TAGS.includes(x)))
  const status: JsDayModel['status'] = mapping || anyJsTag ? 'ok' : 'unknown'

  const sorted = sortedDays(facts)
  const perDate = new Map<IsoDate, DateSlot>()
  const slot = (date: IsoDate): DateSlot => {
    let s = perDate.get(date)
    if (!s) {
      s = { intervals: [], short: [], entries: [], bwz: 0, bwzKnown: false }
      perDate.set(date, s)
    }
    return s
  }
  for (const e of facts.scheduleEntries) {
    if (isJsActivity(e.activityIri) !== true) continue
    const startDate = wallDate(e.start)
    const minutes = entryMinutes(e)
    if (minutes < t.minUnitMinutes) {
      slot(startDate).short.push(e.iri)
      continue
    }
    // Movement time per entry: entry value, else the activity value when the activity has exactly one entry.
    let bwz: number | null = e.ysPhysicalActivityDurationMinutes ?? null
    if (bwz === null) {
      const c = activityById.get(e.activityIri)?.content.ysPhysicalActivityDurationMinutes ?? null
      bwz = c !== null && entriesPerActivity.get(e.activityIri) === 1 ? c : null
    }
    const first = slot(startDate)
    if (bwz !== null) {
      first.bwzKnown = true
      first.bwz += minBwzActivity !== null && bwz < minBwzActivity ? 0 : bwz
    }
    // Split at midnight: [start, 24:00] on the start date, whole days in between, [00:00, end] on the end date.
    const endDate = wallDate(e.end)
    const startMin = wallMinutes(e.start)
    const endMin = endDate > startDate ? wallMinutes(e.end) : startMin + minutes
    let d = startDate
    for (let guard = 0; d <= endDate && guard < 60; guard++) {
      const from = d === startDate ? startMin : 0
      const to = d === endDate ? Math.min(endMin, 1440) : 1440
      if (to > from) {
        const s = slot(d)
        s.intervals.push({ from, to })
        s.entries.push(e.iri)
      }
      d = addDays(d, 1)
    }
  }

  const days: JsModelDay[] = sorted.map((day, i) => {
    const s = perDate.get(day.date)
    const intervals = unionIntervals(s?.intervals ?? [])
    const shortGaps: JsModelDay['shortGaps'] = []
    const unitIntervals: JsInterval[] = []
    for (const iv of intervals) {
      const last = unitIntervals[unitIntervals.length - 1]
      if (last && iv.from - last.to < t.minGapMinutes) {
        shortGaps.push({ from: last.to, to: iv.from, minutes: iv.from - last.to })
        last.to = Math.max(last.to, iv.to)
      } else unitIntervals.push({ ...iv })
    }
    const jsMinutes = intervals.reduce((n, iv) => n + iv.to - iv.from, 0)
    const bwzMinutes = s?.bwz ?? 0
    const isJsDay =
      jsMinutes >= t.minDayMinutes && unitIntervals.length >= t.minDayUnits && (minBwzDay === null || bwzMinutes >= minBwzDay)
    return {
      dayIri: day.iri,
      date: day.date,
      number: i + 1,
      isFirst: i === 0,
      isLast: i === sorted.length - 1,
      intervals,
      unitIntervals,
      jsMinutes,
      units: unitIntervals.length,
      shortGaps,
      shortEntryIris: s?.short ?? [],
      entryIris: s?.entries ?? [],
      bwzMinutes,
      bwzKnown: s?.bwzKnown ?? false,
      isJsDay,
      windowsCovered: windowsCovered(intervals, windows, minOverlap),
    }
  })

  const interior = days.filter((d) => !d.isFirst && !d.isLast)
  let endContribution = 0
  let endDaysMode: JsDayModel['endDaysMode'] = 'none'
  if (days.length === 1) {
    endContribution = days[0].isJsDay ? 1 : 0
    endDaysMode = days[0].isJsDay ? 'single' : 'none'
  } else if (days.length >= 2) {
    const first = days[0]
    const last = days[days.length - 1]
    endContribution = (first.isJsDay ? 1 : 0) + (last.isJsDay ? 1 : 0)
    if (endContribution > 0) endDaysMode = 'single'
    else {
      // Neither counts on its own: together they count as one J+S day (no unit minimum for the pair).
      const minutes = first.jsMinutes + last.jsMinutes
      const bwz = first.bwzMinutes + last.bwzMinutes
      if (minutes >= t.minDayMinutes && (minBwzDay === null || bwz >= minBwzDay)) {
        endContribution = 1
        endDaysMode = 'combined'
      }
    }
  }
  return {
    status,
    days,
    jsDayCount: interior.filter((d) => d.isJsDay).length + endContribution,
    endDaysMode,
    trainingFreeDays: interior.filter((d) => !d.isJsDay),
    isJsActivity,
  }
}
