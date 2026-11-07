/** PBS best practice hints (group 'best-practice'). Pure predicates of RuleContext. */
import type { RuleContext, RuleHit, RulePredicate, ScheduleEntryFact, Stufe } from '@/domain/types'
import { categoryClassOf, entryMinutes, hasJsMapping, isJsClass, minutesBetween, sortedDays, wallDate, wallMinutes } from '../../../jsDays'
import { activityText, campHit, hasKeyword, WATER } from './util'

const entriesOnDay = (ctx: RuleContext, date: string): ScheduleEntryFact[] =>
  ctx.facts.scheduleEntries.filter((e) => wallDate(e.start) === date).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))

// BP-REST-01 ---------------------------------------------------------------------------------

export const REST_GAP_MINUTES = 60
const REST_WINDOW = { from: 7 * 60, to: 22 * 60 }

/** A day has a rest block if an entry is mapped to NONE (free time) or a >= 60 min gap lies within 07-22h. */
export function dayHasRest(ctx: RuleContext, date: string): boolean {
  const entries = entriesOnDay(ctx, date)
  const activityById = new Map(ctx.facts.activities.map((a) => [a.iri, a]))
  if (entries.some((e) => categoryClassOf(ctx.mapping, activityById.get(e.activityIri)?.categoryIri ?? null) === 'NONE')) return true
  // Free window = minutes of the day not covered by any entry, within 07-22h.
  const covered = entries
    .map((e) => [Math.max(wallMinutes(e.start), REST_WINDOW.from), Math.min(wallDate(e.end) > wallDate(e.start) ? 24 * 60 : wallMinutes(e.end), REST_WINDOW.to)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let cursor = REST_WINDOW.from
  for (const [a, b] of covered) {
    if (a - cursor >= REST_GAP_MINUTES) return true
    cursor = Math.max(cursor, b)
  }
  return REST_WINDOW.to - cursor >= REST_GAP_MINUTES
}

export const bpRest01: RulePredicate = (ctx) => {
  if (!ctx.mapping) return []
  const hits: RuleHit[] = []
  for (const day of sortedDays(ctx.facts)) {
    if (entriesOnDay(ctx, day.date).length === 0) continue
    if (dayHasRest(ctx, day.date)) continue
    hits.push({ targets: [day.iri], params: { date: `${day.date.slice(8, 10)}.${day.date.slice(5, 7)}.${day.date.slice(0, 4)}` } })
  }
  return hits
}

// BP-SLEEP-01 --------------------------------------------------------------------------------

/** Heuristic recommended sleep window (hours between last programme end and next programme start). */
export const SLEEP_HOURS: Record<Stufe, number> = { biber: 11, woelfe: 10, pfadi: 9, pios: 8.5, rover: 8, gemischt: 9 }

export const bpSleep01: RulePredicate = (ctx) => {
  const stufe = ctx.coachInputs?.stufe ?? null
  if (!stufe) return []
  const need = SLEEP_HOURS[stufe] * 60
  const days = sortedDays(ctx.facts)
  const hits: RuleHit[] = []
  for (let i = 1; i < days.length; i++) {
    const prev = entriesOnDay(ctx, days[i - 1].date)
    const next = entriesOnDay(ctx, days[i].date)
    if (prev.length === 0 || next.length === 0) continue
    const lastEnd = prev.reduce((m, e) => (e.end > m ? e.end : m), prev[0].end)
    const firstStart = next[0].start
    const window = minutesBetween(lastEnd, firstStart)
    if (window >= need) continue
    hits.push({
      targets: [days[i].iri],
      params: { day: days[i].number, window: fmtHours(window), need: fmtHours(need), stufe: stufe === 'woelfe' ? 'Wölfe' : stufe },
    })
  }
  return hits
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// BP-WOLF-01 / BP-WATER-01 -------------------------------------------------------------------

export const bpWolf01: RulePredicate = (ctx) => {
  const i = ctx.coachInputs
  if (!i || i.stufe !== 'woelfe' || i.participantsCount === null || i.leadersCount === null) return []
  const needed = Math.ceil(i.participantsCount / 6)
  return i.leadersCount >= needed ? [] : [campHit(ctx, { participants: i.participantsCount, leaders: i.leadersCount, needed })]
}

export const bpWater01: RulePredicate = (ctx) => {
  const i = ctx.coachInputs
  if (!i || i.participantsCount === null) return []
  const hasWater = ctx.facts.activities.some((a) => hasKeyword(activityText(a), WATER))
  if (!hasWater) return []
  const needed = Math.ceil(i.participantsCount / 12)
  const have = i.slrgCount ?? 0
  return have >= needed
    ? []
    : [campHit(ctx, { participants: i.participantsCount, have: i.slrgCount === null ? 'keine Angabe' : have, needed })]
}

// BP-VAR-01 ----------------------------------------------------------------------------------

export const bpVar01: RulePredicate = (ctx) => {
  if (!ctx.mapping || !hasJsMapping(ctx.mapping)) return []
  const activityById = new Map(ctx.facts.activities.map((a) => [a.iri, a]))
  const categories = new Set<string>()
  const characteristics = new Set<string>()
  let units = 0
  for (const e of ctx.facts.scheduleEntries) {
    const a = activityById.get(e.activityIri)
    if (!a || !isJsClass(categoryClassOf(ctx.mapping, a.categoryIri)) || entryMinutes(e) <= 0) continue
    units++
    if (a.categoryIri) categories.add(a.categoryIri)
    a.content.ysCharacteristics.forEach((c) => characteristics.add(c))
  }
  if (units < 4) return []
  const variety = Math.max(categories.size, characteristics.size)
  return variety >= 2 ? [] : [campHit(ctx, { units })]
}
