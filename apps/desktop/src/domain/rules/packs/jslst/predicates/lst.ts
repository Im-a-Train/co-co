/** Module `lst` (Lagersport/Trekking – Kern): J+S days, activities, programme. Pure predicates of RuleContext. */
import type { ActivityFact, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { daysBetween } from '../../../lib/deadlines'
import {
  categoryClassOf,
  computeJsDays,
  entryMinutes,
  hasJsMapping,
  isJsClass,
  quantityOk,
  sortedDays,
  thresholdsFromParams,
  trainingFreeDays,
  type JsDayReport,
} from '../../../lib/jsDays'
import {
  activityEvidence,
  campEvidence,
  campHit,
  classOfActivity,
  formatDateDe,
  isJsActivity,
  jsApplies,
  midataEvidence,
  midataStand,
} from '../../../lib/util'

/** Legacy day report (today's semantics) with the camp's day thresholds. */
const report = (ctx: RuleContext): JsDayReport => computeJsDays(ctx.facts, ctx.mapping, thresholdsFromParams(ctx.params))

/** Rules about J+S days need a mapping with at least one LS/LA category. */
const dayReady = (ctx: RuleContext) => jsApplies(ctx) && hasJsMapping(ctx.mapping)

const activityOf = (ctx: RuleContext, iri: string): ActivityFact | undefined => ctx.facts.activities.find((a) => a.iri === iri)

// JS-CAMP-01 ---------------------------------------------------------------------------------

export const jsCamp01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const min = ctx.params.get<number>('js.minConsecutiveDays')
  const days = sortedDays(ctx.facts)
  if (days.length === 0) return []
  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = daysBetween(days[i - 1].date, days[i].date) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  if (days.length === 1) longest = 1
  return longest >= min
    ? []
    : [
        {
          ...campHit(ctx, { days: longest, min }, { evidence: [campEvidence(ctx.facts)] }),
          inputs: { campDaysTotal: days.length, longestConsecutiveDays: longest, requiredDays: min },
        },
      ]
}

// JS-DAY-01 ----------------------------------------------------------------------------------

export const jsDay01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx) || ctx.mapping === null) return []
  if (!hasJsMapping(ctx.mapping)) return [{ ...campHit(ctx, {}, { severity: 'hint' }), variant: 'noMapping' }]
  const t = thresholdsFromParams(ctx.params)
  const r = report(ctx)
  const n = r.days.length
  const hits: RuleHit[] = []
  r.days.forEach((d, i) => {
    // First/last day of a multi-day camp are judged by JS-DAY-04 (arrival/departure combination).
    if (n > 1 && (i === 0 || i === n - 1)) return
    if (d.unitCount === 0) return // training-free day, see JS-FREE-01
    if (quantityOk(d, t)) return
    hits.push({
      targets: [d.dayIri],
      params: { day: d.number, units: d.unitCount, minutes: d.jsMinutes, minUnits: t.minDayUnits, minMinutes: t.minDayMinutes },
      inputs: { dayDate: d.date, jsUnits: d.unitCount, jsMinutes: d.jsMinutes, requiredUnits: t.minDayUnits, requiredMinutes: t.minDayMinutes },
      evidence: d.units.map((u) => {
        const a = activityOf(ctx, u.activityIri)
        return a ? activityEvidence(a, `${u.minutes} Min.`) : { kind: 'scheduleEntry' as const, iri: u.scheduleEntryIri, label: u.scheduleEntryIri }
      }),
    })
  })
  return hits
}

// JS-DAY-02 ----------------------------------------------------------------------------------

export const jsDay02: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const min = ctx.params.get<number>('js.minUnitMinutes')
  const hits: RuleHit[] = []
  for (const d of report(ctx).days) {
    for (const u of d.units) {
      if (u.longEnough) continue
      const a = activityOf(ctx, u.activityIri)
      hits.push({
        targets: [u.scheduleEntryIri],
        params: { day: d.number, title: a?.title ?? '?', minutes: u.minutes, min },
        inputs: { dayDate: d.date, unitMinutes: u.minutes, requiredMinutes: min },
        evidence: a ? [activityEvidence(a, `${u.minutes} Min.`)] : [],
      })
    }
  }
  return hits
}

// JS-DAY-03 ----------------------------------------------------------------------------------

export const jsDay03: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const min = ctx.params.get<number>('js.minGapMinutes')
  const hits: RuleHit[] = []
  for (const d of report(ctx).days) {
    const bad = d.gaps.filter((g) => !g.ok)
    if (bad.length === 0) continue
    const shortest = Math.min(...bad.map((g) => g.minutes))
    hits.push({
      targets: [d.dayIri],
      params: { day: d.number, count: bad.length, minutes: shortest, min },
      inputs: { dayDate: d.date, gapsTooShort: bad.length, shortestGapMinutes: shortest, unitsOnDay: d.units.length },
      evidence: d.units.map((u) => {
        const a = activityOf(ctx, u.activityIri)
        return a ? activityEvidence(a, `${u.start.slice(11, 16)}–${u.end.slice(11, 16)}`) : { kind: 'scheduleEntry' as const, iri: u.scheduleEntryIri, label: u.scheduleEntryIri }
      }),
    })
  }
  return hits
}

// JS-DAY-04 ----------------------------------------------------------------------------------

export const jsDay04: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const min = ctx.params.get<number>('js.minDayMinutes')
  const r = report(ctx)
  if (r.days.length < 2) return []
  const first = r.days[0]
  const last = r.days[r.days.length - 1]
  if ((first.valid && last.valid) || first.validCombined) return []
  const minutes = first.jsMinutes + last.jsMinutes
  return [
    {
      targets: [first.dayIri, last.dayIri],
      params: { first: first.number, last: last.number, minutes, min },
      inputs: {
        firstDayDate: first.date,
        lastDayDate: last.date,
        firstDayMinutes: first.jsMinutes,
        lastDayMinutes: last.jsMinutes,
        combinedMinutes: minutes,
        requiredMinutes: min,
      },
      // Nothing planned at all on arrival/departure is normal: only a hint.
      severity: minutes === 0 ? 'hint' : undefined,
    },
  ]
}

// JS-DAY-05 ----------------------------------------------------------------------------------

export const jsDay05: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const headChars = ctx.params.get<number>('lst.warmupHeadChars')
  const hits: RuleHit[] = []
  const seen = new Set<string>()
  for (const d of report(ctx).days) {
    for (const u of d.units) {
      if (seen.has(u.activityIri)) continue
      seen.add(u.activityIri)
      const a = activityOf(ctx, u.activityIri)
      if (!a || !a.content.storyboardText.trim()) continue // CMP-ACT-02 reports missing storyboards
      const head = a.content.storyboardText.slice(0, headChars)
      if (ctx.keywords.match('WARMUP', head).length > 0) continue
      hits.push({
        targets: [a.iri],
        params: { title: a.title },
        inputs: { storyboardChecked: head.length, warmupKeywordFound: false },
        evidence: [activityEvidence(a)],
      })
    }
  }
  return hits
}

// JS-LL-01 -----------------------------------------------------------------------------------

export const jsLl01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const v = ctx.coachInputs?.lagerleiterAttested ?? null
  if (v === true) return []
  const stand = v === false ? midataStand(ctx, ['lagerleiterAttested']) : null
  if (stand) return [{ ...campHit(ctx, { stand }, { evidence: [midataEvidence(stand)] }), variant: 'midata' }]
  return [v === null ? { ...campHit(ctx, {}, { severity: 'hint' }), variant: 'missing' } : campHit(ctx, {})]
}

// JS-FREE-01 ---------------------------------------------------------------------------------

export const jsFree01: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  return trainingFreeDays(report(ctx)).map((d) => ({
    targets: [d.dayIri],
    params: { day: d.number, date: formatDateDe(d.date) },
    inputs: { dayDate: d.date, jsUnits: d.unitCount, jsMinutes: d.jsMinutes },
  }))
}

// JS-BWZ-27 ----------------------------------------------------------------------------------

export const jsBwz27: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const min = ctx.params.get<number | null>('js.minBwzDayMinutes')
  if (min === null) return []
  const { facts } = ctx
  const entriesByActivity = new Map<string, number>()
  for (const e of facts.scheduleEntries) entriesByActivity.set(e.activityIri, (entriesByActivity.get(e.activityIri) ?? 0) + 1)
  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  const perDay = new Map<string, number>()
  let anyData = false
  for (const e of facts.scheduleEntries) {
    let v = e.ysPhysicalActivityDurationMinutes
    if (v === null || v === undefined) {
      const a = activityById.get(e.activityIri)
      const c = a?.content.ysPhysicalActivityDurationMinutes ?? null
      v = c !== null && entriesByActivity.get(e.activityIri) === 1 ? c : null
    }
    if (v !== null) anyData = true
    const date = e.start.slice(0, 10)
    perDay.set(date, (perDay.get(date) ?? 0) + (v ?? 0))
  }
  if (!anyData) return facts.days.length === 0 ? [] : [{ ...campHit(ctx, { min }), variant: 'noData' }]
  const hits: RuleHit[] = []
  for (const day of sortedDays(facts)) {
    const minutes = perDay.get(day.date) ?? 0
    if (minutes < min) {
      hits.push({
        targets: [day.iri],
        params: { day: formatDateDe(day.date), minutes, min },
        inputs: { dayDate: day.date, movementMinutes: minutes, requiredMinutes: min },
      })
    }
  }
  return hits
}

// CMP-ACT-01..03, CMP-LA-01 -------------------------------------------------------------------

export const cmpAct01: RulePredicate = (ctx) =>
  ctx.facts.activities
    .filter((a) => a.responsibleIris.length === 0)
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))

export const cmpAct02: RulePredicate = (ctx) => {
  if (!ctx.mapping) return []
  return ctx.facts.activities
    .filter((a) => isJsActivity(ctx, a) && (!a.content.hasStoryboard || a.content.storyboardText.trim() === ''))
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))
}

const OUTDOOR_SETS = ['OUTDOOR', 'WATER', 'MOUNTAIN', 'ROPE']

/** Heuristic: LS activity or outdoor/water/mountain/rope keywords in title, location or storyboard. */
export function isOutdoorActivity(ctx: RuleContext, a: ActivityFact): boolean {
  if (classOfActivity(ctx, a) === 'LS') return true
  return OUTDOOR_SETS.some((set) => ctx.keywords.matchActivity(set, a, ['title', 'location', 'storyboard']).length > 0)
}

export const cmpAct03: RulePredicate = (ctx) =>
  ctx.facts.activities
    .filter((a) => isOutdoorActivity(ctx, a) && a.content.safetyText.trim() === '')
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))

export const cmpLa01: RulePredicate = (ctx) => {
  if (!ctx.mapping) return []
  return ctx.facts.activities
    .filter((a) => classOfActivity(ctx, a) === 'LA' && a.content.laThematicAreas.length === 0)
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))
}

// BP-VAR-01 ----------------------------------------------------------------------------------

export const bpVar01: RulePredicate = (ctx) => {
  if (!ctx.mapping || !hasJsMapping(ctx.mapping)) return []
  const minUnits = ctx.params.get<number>('lst.varMinUnits')
  const minDistinct = ctx.params.get<number>('lst.varMinDistinct')
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
  if (units < minUnits) return []
  const variety = Math.max(categories.size, characteristics.size)
  return variety >= minDistinct ? [] : [campHit(ctx, { units })]
}

export const predicates: Record<string, RulePredicate> = {
  'JS-CAMP-01': jsCamp01,
  'JS-DAY-01': jsDay01,
  'JS-DAY-02': jsDay02,
  'JS-DAY-03': jsDay03,
  'JS-DAY-04': jsDay04,
  'JS-DAY-05': jsDay05,
  'JS-LL-01': jsLl01,
  'JS-FREE-01': jsFree01,
  'JS-BWZ-27': jsBwz27,
  'CMP-ACT-01': cmpAct01,
  'CMP-ACT-02': cmpAct02,
  'CMP-ACT-03': cmpAct03,
  'CMP-LA-01': cmpLa01,
  'BP-VAR-01': bpVar01,
}
