/** Module `pbs` (PBS Best Practice, Hering). Pure predicates of RuleContext. */
import type { RuleContext, RuleHit, RulePredicate, ScheduleEntryFact, Stufe } from '@/domain/types'
import { addDays, daysBetween } from '../../../lib/deadlines'
import { categoryClassOf, minutesBetween, sortedDays, wallDate, wallMinutes } from '../../../lib/jsDays'
import { hhmmToMinutes } from '../../../lib/params'
import { activityEvidence, campHit, formatDateDe, midataEvidence, midataSourceText, midataStand } from '../../../lib/util'

const MAX_EVIDENCE = 25

const entriesOnDay = (ctx: RuleContext, date: string): ScheduleEntryFact[] =>
  ctx.facts.scheduleEntries.filter((e) => wallDate(e.start) === date).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))

// BP-REST-01 ---------------------------------------------------------------------------------

export interface RestOptions {
  gapMinutes: number
  window: { from: number; to: number }
}

export function restOptions(ctx: RuleContext): RestOptions {
  const w = ctx.params.get<{ from: string; to: string }>('pbs.restWindow')
  return { gapMinutes: ctx.params.get<number>('pbs.restGapMinutes'), window: { from: hhmmToMinutes(w.from), to: hhmmToMinutes(w.to) } }
}

/** A day has a rest block if an entry is mapped to NONE (free time) or a long enough gap lies within the rest window. */
export function dayHasRest(ctx: RuleContext, date: string, opts: RestOptions = restOptions(ctx)): boolean {
  const { gapMinutes, window } = opts
  const entries = entriesOnDay(ctx, date)
  const activityById = new Map(ctx.facts.activities.map((a) => [a.iri, a]))
  if (entries.some((e) => categoryClassOf(ctx.mapping, activityById.get(e.activityIri)?.categoryIri ?? null) === 'NONE')) return true
  // Free window = minutes of the day not covered by any entry, within the rest window.
  const covered = entries
    .map((e) => [Math.max(wallMinutes(e.start), window.from), Math.min(wallDate(e.end) > wallDate(e.start) ? 24 * 60 : wallMinutes(e.end), window.to)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let cursor = window.from
  for (const [a, b] of covered) {
    if (a - cursor >= gapMinutes) return true
    cursor = Math.max(cursor, b)
  }
  return window.to - cursor >= gapMinutes
}

export const bpRest01: RulePredicate = (ctx) => {
  if (!ctx.mapping) return []
  const opts = restOptions(ctx)
  const hits: RuleHit[] = []
  for (const day of sortedDays(ctx.facts)) {
    if (entriesOnDay(ctx, day.date).length === 0) continue
    if (dayHasRest(ctx, day.date, opts)) continue
    hits.push({ targets: [day.iri], params: { date: formatDateDe(day.date), gap: opts.gapMinutes } })
  }
  return hits
}

// BP-SLEEP-01 --------------------------------------------------------------------------------

export const bpSleep01: RulePredicate = (ctx) => {
  const stufe = ctx.coachInputs?.stufe ?? null
  if (!stufe) return []
  const sleepHours = ctx.params.get<Record<Stufe, number>>('pbs.sleepHours')
  const need = sleepHours[stufe] * 60
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
  const per = ctx.params.get<number>('pbs.wolfParticipantsPerLeader')
  const needed = Math.ceil(i.participantsCount / per)
  if (i.leadersCount >= needed) return []
  const stand = midataStand(ctx, ['participantsCount', 'leadersCount'])
  return [
    campHit(
      ctx,
      { participants: i.participantsCount, leaders: i.leadersCount, needed, per, src: stand ? ` (${midataSourceText(stand)})` : '' },
      stand ? { evidence: [midataEvidence(stand)] } : {},
    ),
  ]
}

export const bpWater01: RulePredicate = (ctx) => {
  const i = ctx.coachInputs
  if (!i || i.participantsCount === null) return []
  const hasWater = ctx.facts.activities.some((a) => ctx.keywords.matchActivity('WATER', a, ['title', 'location', 'storyboard', 'safety', 'notes']).length > 0)
  if (!hasWater) return []
  const per = ctx.params.get<number>('pbs.slrgParticipantsPerPerson')
  const needed = Math.ceil(i.participantsCount / per)
  const have = i.slrgCount ?? 0
  if (have >= needed) return []
  const stand = midataStand(ctx, ['slrgCount', 'participantsCount'])
  const hit = campHit(
    ctx,
    { participants: i.participantsCount, have, needed, per, src: stand ? ` (${midataSourceText(stand)})` : '' },
    stand ? { evidence: [midataEvidence(stand)] } : {},
  )
  return [i.slrgCount === null ? { ...hit, variant: 'noCount' } : hit]
}

// CMP-PROG-01 --------------------------------------------------------------------------------

export const cmpProg01: RulePredicate = (ctx) => {
  const { facts } = ctx
  const start = facts.camp.start
  if (!start || facts.progressLabels.length === 0) return []
  const today = ctx.now.toISOString().slice(0, 10)
  if (today < addDays(start, -ctx.params.get<number>('pbs.progressLeadDays'))) return []
  const highest = facts.progressLabels.reduce((m, l) => (l.position > m.position ? l : m))
  const behind = facts.activities.filter((a) => a.progressLabelIri !== highest.iri)
  if (behind.length === 0) return []
  const left = daysBetween(today, start)
  return [
    {
      targets: [facts.camp.iri],
      params: { count: behind.length, label: highest.title, days: Math.max(left, 0) },
      evidence: behind.slice(0, MAX_EVIDENCE).map((a) => activityEvidence(a)),
    } satisfies RuleHit,
  ]
}

export const predicates: Record<string, RulePredicate> = {
  'BP-REST-01': bpRest01,
  'BP-SLEEP-01': bpSleep01,
  'BP-WOLF-01': bpWolf01,
  'BP-WATER-01': bpWater01,
  'CMP-PROG-01': cmpProg01,
}
