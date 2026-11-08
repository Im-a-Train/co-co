/** Module `lst-winter` (LST-WINTER-01…08). Pure predicates of RuleContext; all texts live in the rule YAMLs. */
import type { ActivityFact, DocumentRecord, MessageFragment, RuleContext, RuleHit, RulePredicate, ScheduleEntryFact } from '@/domain/types'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { wallDate, wallMinutes } from '../../../lib/jsDays'
import { hhmmToMinutes } from '../../../lib/params'
import { activityEvidence, campHit, hhmm } from '../../../lib/util'

const monthOf = (iso: string): number => Number(iso.slice(5, 7))

const winterMonths = (ctx: RuleContext): number[] => ctx.params.get<number[]>('lst.winterMonths')

/** True if any day of the camp lies in a winter month (§2.2 «camp overlaps lst.winterMonths»). */
export function campOverlapsWinter(ctx: RuleContext): boolean {
  const months = winterMonths(ctx)
  const dates = ctx.facts.days.map((d) => d.date)
  if (ctx.facts.camp.start) dates.push(ctx.facts.camp.start)
  if (ctx.facts.camp.end) dates.push(ctx.facts.camp.end)
  return dates.some((d) => months.includes(monthOf(d)))
}

const entriesOf = (ctx: RuleContext, a: ActivityFact): ScheduleEntryFact[] => ctx.facts.scheduleEntries.filter((e) => e.activityIri === a.iri)

/** Activity takes place in a winter month (its entries; without entries the camp period decides). */
function activityInWinter(ctx: RuleContext, a: ActivityFact): boolean {
  const entries = entriesOf(ctx, a)
  if (entries.length === 0) return campOverlapsWinter(ctx)
  const months = winterMonths(ctx)
  return entries.some((e) => months.includes(monthOf(wallDate(e.start))))
}

const matches = (ctx: RuleContext, set: string, a: ActivityFact) => ctx.keywords.matchActivity(set, a, ['title', 'location', 'storyboard', 'notes'])
const hasAny = (ctx: RuleContext, sets: string[], a: ActivityFact): boolean => sets.some((s) => matches(ctx, s, a).length > 0)
const inSafety = (ctx: RuleContext, set: string, a: ActivityFact): boolean => ctx.keywords.match(set, a.content.safetyText).length > 0
const isSecured = (ctx: RuleContext, a: ActivityFact): boolean => ctx.campConfig.tagsOf(a.iri).includes('gesicherter-bereich') || matches(ctx, 'WINTER_SECURED', a).length > 0

const asFragments = (variants: string[]): MessageFragment[] => variants.map((variant) => ({ variant }))

// LST-WINTER-01 ------------------------------------------------------------------------------

export const lstWinter01: RulePredicate = (ctx) => {
  if (!campOverlapsWinter(ctx)) return []
  const { campForm, winterSafeAccess } = ctx.campConfig.camp
  const inputs = { campForm, winterSafeAccess }
  if (campForm === 'zelt' || campForm === 'gemischt') {
    return [{ ...campHit(ctx), variant: 'notHouse', fragments: { campForm: [{ variant: `form_${campForm}` }] }, inputs }]
  }
  if (winterSafeAccess === false) return [{ ...campHit(ctx), variant: 'noAccess', severity: 'hint', inputs }]
  if (winterSafeAccess === null) return [{ ...campHit(ctx), severity: 'hint', inputs }]
  return []
}

// LST-WINTER-02 ------------------------------------------------------------------------------

const BASIC_RULES: { set: string; variant: string }[] = [
  { set: 'WR_HANG', variant: 'wr_hang' },
  { set: 'WR_LAWINE', variant: 'wr_lawine' },
  { set: 'WR_HOEHE', variant: 'wr_hoehe' },
  { set: 'WR_3X3', variant: 'wr_3x3' },
  { set: 'WR_DEFENSIV', variant: 'wr_defensiv' },
]

export const lstWinter02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  const max = ctx.params.get<number>('lst.winterMaxAltitude')
  for (const a of ctx.facts.activities) {
    if (!hasAny(ctx, ['SNOWSHOE', 'WINTERHIKE'], a)) continue
    // The secured-area exception covers rules 1-3 (slope, avalanche level, altitude): only 4-5 remain.
    const required = isSecured(ctx, a) ? BASIC_RULES.slice(3) : BASIC_RULES
    const missing = required.filter((r) => !inSafety(ctx, r.set, a))
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, max },
      fragments: { missing: asFragments(missing.map((m) => m.variant)) },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-WINTER-03 ------------------------------------------------------------------------------

export const lstWinter03: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  const max = ctx.params.get<number>('lst.winterMaxAltitude')
  const months = winterMonths(ctx)
  for (const a of ctx.facts.activities) {
    if (!hasAny(ctx, ['SNOWSHOE', 'WINTERHIKE'], a)) continue
    if (!entriesOf(ctx, a).some((e) => months.includes(monthOf(wallDate(e.start))))) continue
    if (isSecured(ctx, a)) continue
    const docs: DocumentRecord[] = ctx.documents.filter((d) => d.activityIris.includes(a.iri) && d.gpx?.highestPointM != null)
    const highest = docs.reduce((m, d) => Math.max(m, d.gpx?.highestPointM ?? 0), 0)
    if (highest <= max) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, m: Math.round(highest), max },
      inputs: { highestPointM: Math.round(highest), maxAltitude: max },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-WINTER-04 ------------------------------------------------------------------------------

const SLED_GROUPS: { set: string; variant: string }[] = [
  { set: 'SLED_HELM', variant: 'sled_helm' },
  { set: 'SLED_TEST', variant: 'sled_test' },
  { set: 'SLED_ZONE', variant: 'sled_zone' },
  { set: 'SLED_AUFSICHT', variant: 'sled_aufsicht' },
]

export const lstWinter04: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    if (matches(ctx, 'SLED', a).length === 0) continue
    const missing = SLED_GROUPS.filter((g) => {
      if (g.set === 'SLED_AUFSICHT' && a.responsibleIris.length < 2) return true
      return !inSafety(ctx, g.set, a)
    })
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing: asFragments(missing.map((m) => m.variant)) },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-WINTER-05 ------------------------------------------------------------------------------

export const lstWinter05: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  const months = winterMonths(ctx)
  const table = ctx.params.get<Record<string, string>>('lst.sunsetTable')
  for (const a of ctx.facts.activities) {
    if (!hasAny(ctx, ['OUTDOOR', 'HIKE', 'SNOWSHOE', 'SLED'], a)) continue
    const sled = matches(ctx, 'SLED', a).length > 0
    for (const e of entriesOf(ctx, a)) {
      const date = wallDate(e.start)
      const month = monthOf(date)
      if (!months.includes(month)) continue
      const sunset = table[String(month)]
      if (!sunset) continue
      const endMin = wallMinutes(e.end) + (wallDate(e.end) > date ? 24 * 60 : 0)
      if (endMin <= hhmmToMinutes(sunset) + 15) continue
      hits.push({
        targets: [e.iri],
        variant: sled ? 'sled' : undefined,
        params: { activity: a.title, end: hhmm(e.end), sunset },
        inputs: { endMinutes: endMin, sunset },
        evidence: [activityEvidence(a)],
      })
    }
  }
  return hits
}

// LST-WINTER-06 ------------------------------------------------------------------------------

export const lstWinter06: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    if (!hasAny(ctx, ['SNOWSHOE', 'BIWAK', 'HIKE'], a)) continue
    if (!activityInWinter(ctx, a)) continue
    if (ctx.keywords.matchActivity('RUECKMELD', a, ALL_ACTIVITY_FIELDS).length > 0) continue
    hits.push({ targets: [a.iri], params: { activity: a.title }, evidence: [activityEvidence(a)] })
  }
  return hits
}

// LST-WINTER-07 ------------------------------------------------------------------------------

export const lstWinter07: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = ctx.keywords.matchActivity('WINTER_FORBIDDEN', a, ALL_ACTIVITY_FIELDS)
    if (found.length === 0) continue
    const ebbA = ctx.campConfig.tagsOf(a.iri).includes('ebb-a')
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, term: found[0].term },
      ...(ebbA ? { severity: 'hint' as const } : {}),
      evidence: [activityEvidence(a, found[0].term)],
    })
  }
  return hits
}

// LST-WINTER-08 ------------------------------------------------------------------------------

export const lstWinter08: RulePredicate = (ctx) => {
  const fromCoach = ctx.coachInputs?.participantsCount ?? null
  const participants = fromCoach ?? ctx.midata?.participantsCount ?? null
  if (participants === null || participants <= 0) return []
  const max = ctx.params.get<number>('lst.snowGroupMax')
  const needed = Math.ceil(participants / max)
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    if (matches(ctx, 'SNOWSHOE', a).length === 0) continue
    if (a.responsibleIris.length >= needed) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, participants, responsible: a.responsibleIris.length, max },
      inputs: { participants, responsible: a.responsibleIris.length, needed },
      ...(fromCoach === null ? { redKeys: ['participants'] } : {}),
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'LST-WINTER-01': lstWinter01,
  'LST-WINTER-02': lstWinter02,
  'LST-WINTER-03': lstWinter03,
  'LST-WINTER-04': lstWinter04,
  'LST-WINTER-05': lstWinter05,
  'LST-WINTER-06': lstWinter06,
  'LST-WINTER-07': lstWinter07,
  'LST-WINTER-08': lstWinter08,
}
