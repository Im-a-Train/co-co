/** Module `lst-berg` (SAC-Skala, Gewitter, Altschnee). Pure predicates of RuleContext; texts live in the rule YAMLs. */
import type { ActivityFact, RuleContext, RuleHit, RulePredicate, ScheduleEntryFact } from '@/domain/types'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { wallMinutes } from '../../../lib/jsDays'
import { hhmmToMinutes } from '../../../lib/params'
import { activityEvidence } from '../../../lib/util'

/** Matches of a keyword set in all text fields of the activity plus its material list. */
function matchesIn(ctx: RuleContext, a: ActivityFact, set: string): string[] {
  const terms = ctx.keywords.matchActivity(set, a, ALL_ACTIVITY_FIELDS).map((m) => m.term)
  for (const m of ctx.keywords.match(set, a.content.materialText)) terms.push(m.term)
  return terms
}

const entriesOf = (ctx: RuleContext, a: ActivityFact): ScheduleEntryFact[] => ctx.facts.scheduleEntries.filter((e) => e.activityIri === a.iri)
const monthOf = (e: ScheduleEntryFact): number => Number(e.start.slice(5, 7))

// LST-BERG-01 --------------------------------------------------------------------------------

export const lstBerg01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = matchesIn(ctx, a, 'ALPINE')
    if (found.length === 0) continue
    const ebbA = ctx.campConfig.tagsOf(a.iri).includes('ebb-a')
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, term: found[0] },
      ...(ebbA ? { variant: 'ebbA', severity: 'hint' as const } : {}),
      inputs: { matchedKeyword: found[0], taggedEbbA: ebbA },
      evidence: [activityEvidence(a, `Stichwörter: ${found.slice(0, 3).join(', ')}`)],
    })
  }
  return hits
}

// LST-BERG-02 --------------------------------------------------------------------------------

function kidsPresent(ctx: RuleContext): { kids: boolean; red: boolean } {
  const stufe = ctx.coachInputs?.stufe
  if (stufe === 'biber' || stufe === 'woelfe') return { kids: true, red: false }
  const byYear = ctx.midata?.participantsByBirthYear
  const start = ctx.facts.camp.start
  if (byYear && start) {
    const maxAge = ctx.params.get<number>('lst.sbMinAgeByYear')
    const campYear = Number(start.slice(0, 4))
    const kids = Object.entries(byYear).some(([year, n]) => n > 0 && campYear - Number(year) < maxAge)
    return { kids, red: true }
  }
  return { kids: false, red: false }
}

export const lstBerg02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  const { kids, red } = kidsPresent(ctx)
  for (const a of ctx.facts.activities) {
    if (ctx.campConfig.tagsOf(a.iri).includes('sb-berg')) continue
    const found = matchesIn(ctx, a, 'T3')
    if (found.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      ...(kids ? { variant: 'kids' } : {}),
      inputs: { matchedKeyword: found[0], kidsPresent: kids },
      ...(red ? { redKeys: ['kidsPresent'] } : {}),
      evidence: [activityEvidence(a, `Stichwort: ${found[0]}`)],
    })
  }
  return hits
}

// LST-BERG-03 --------------------------------------------------------------------------------

export const lstBerg03: RulePredicate = (ctx) => {
  const months = ctx.params.get<number[]>('lst.thunderstormMonths')
  const endLimit = hhmmToMinutes(ctx.params.get<string>('lst.thunderstormEnd'))
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const mountain = matchesIn(ctx, a, 'MOUNTAIN')
    const water = matchesIn(ctx, a, 'WATER')
    const pool = matchesIn(ctx, a, 'POOL')
    const found = mountain.length > 0 ? mountain : pool.length === 0 ? water : []
    if (found.length === 0) continue
    if (ctx.keywords.match('GEWITTER', a.content.safetyText).length > 0) continue
    const late = entriesOf(ctx, a)
      .filter((e) => months.includes(monthOf(e)) && wallMinutes(e.end) > endLimit)
      .sort((x, y) => (x.start < y.start ? -1 : 1))[0]
    if (!late) continue
    const end = late.end.slice(11, 16)
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, end },
      inputs: { matchedKeyword: found[0], entryMonth: monthOf(late), endTime: end, limit: ctx.params.get<string>('lst.thunderstormEnd') },
      evidence: [activityEvidence(a, `Stichwort: ${found[0]}`)],
    })
  }
  return hits
}

// LST-BERG-04 --------------------------------------------------------------------------------

export const lstBerg04: RulePredicate = (ctx) => {
  const highAlt = ctx.params.get<number>('lst.oldSnowHighAltitude')
  const highMonths = ctx.params.get<number[]>('lst.oldSnowHighMonths')
  const lowAlt = ctx.params.get<number>('lst.oldSnowLowAltitude')
  const lowMonths = ctx.params.get<number[]>('lst.oldSnowLowMonths')
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const heights = ctx.documents
      .filter((d) => d.activityIris.includes(a.iri))
      .map((d) => d.gpx?.highestPointM)
      .filter((h): h is number => typeof h === 'number')
    if (heights.length === 0) continue
    const top = Math.max(...heights)
    const entry = entriesOf(ctx, a)
      .filter((e) => (top > highAlt && highMonths.includes(monthOf(e))) || (top > lowAlt && lowMonths.includes(monthOf(e))))
      .sort((x, y) => (x.start < y.start ? -1 : 1))[0]
    if (!entry) continue
    if (matchesIn(ctx, a, 'SNOW_FOG').length > 0) continue
    const month = monthOf(entry)
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, m: Math.round(top) },
      fragments: { month: [{ variant: `monthName${month}` }] },
      inputs: { highestPointM: Math.round(top), entryMonth: month },
      evidence: [activityEvidence(a, `Höchster Punkt ${Math.round(top)} m ü. M.`)],
    })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'LST-BERG-01': lstBerg01,
  'LST-BERG-02': lstBerg02,
  'LST-BERG-03': lstBerg03,
  'LST-BERG-04': lstBerg04,
}
