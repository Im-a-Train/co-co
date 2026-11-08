/**
 * Module `lst` (Lagersport/Trekking – Kern): J+S days, activities, programme, Angebot (catalog v2 §4, §5.2).
 * Pure predicates of RuleContext. Day rules read the shared day model `ctx.js`; all texts live in the rule YAMLs.
 */
import type { ActivityFact, Evidence, JsModelDay, RuleContext, RuleHit, RulePredicate, ScheduleEntryFact } from '@/domain/types'
import { daysBetween } from '../../../lib/deadlines'
import { categoryClassOf, entryMinutes, hasJsMapping, isJsClass, sortedDays } from '../../../lib/jsDays'
import { parseTimeWindows } from '../../../lib/timeWindows'
import { activityEvidence, campEvidence, campHit, classOfActivity, formatDateDe, jsApplies, midataEvidence, midataStand } from '../../../lib/util'

/** J+S rules about days/activities: only for J+S camps with a known category mapping (or J+S tags). */
const ready = (ctx: RuleContext): boolean => jsApplies(ctx) && ctx.js.status === 'ok'

const jsActivities = (ctx: RuleContext): ActivityFact[] => ctx.facts.activities.filter((a) => ctx.js.isJsActivity(a.iri) === true)

const activityOf = (ctx: RuleContext, iri: string): ActivityFact | undefined => ctx.facts.activities.find((a) => a.iri === iri)

const entryOf = (ctx: RuleContext, iri: string): ScheduleEntryFact | undefined => ctx.facts.scheduleEntries.find((e) => e.iri === iri)

/** Activity evidence for schedule entries (one entry per activity). */
function entriesEvidence(ctx: RuleContext, entryIris: readonly string[]): Evidence[] {
  const seen = new Set<string>()
  const out: Evidence[] = []
  for (const iri of entryIris) {
    const e = entryOf(ctx, iri)
    const a = e ? activityOf(ctx, e.activityIri) : undefined
    if (!e || !a || seen.has(a.iri)) continue
    seen.add(a.iri)
    out.push(activityEvidence(a, `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`))
  }
  return out
}

const interiorDays = (ctx: RuleContext): JsModelDay[] => ctx.js.days.filter((d) => !d.isFirst && !d.isLast)

// JS-CAMP-01 ---------------------------------------------------------------------------------

export const jsCamp01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const days = sortedDays(ctx.facts)
  if (days.length === 0) return []
  const partner = ctx.campConfig.angebot.other4DayCamp === true
  const min = ctx.params.get<number>(partner ? 'js.minConsecutiveDaysWithOfferPartner' : 'js.minConsecutiveDays')
  const mode = ctx.params.get<string>('js.consecutiveMode')
  const hits: RuleHit[] = []
  if (ctx.js.status === 'unknown') {
    // Owner of the «Kategorie-Zuordnung fehlt» hint (§3.9.1); all other rules reading ctx.js stay silent.
    hits.push({ targets: [ctx.facts.camp.iri, 'noMapping'], variant: 'noMapping', severity: 'hint', inputs: { mappingKnown: false } })
  }
  if (mode === 'jsDaysSkipping') {
    // From 2027: J+S days only; free days and days failing the J+S-day criteria are skipped, never break the run.
    if (ctx.js.status !== 'ok') return hits
    const jsDays = ctx.js.jsDayCount
    if (jsDays < min) {
      hits.push({
        ...campHit(ctx, { jsDays, min }, { evidence: [campEvidence(ctx.facts)] }),
        variant: 'jsDays',
        inputs: { campDaysTotal: days.length, jsDayCount: jsDays, requiredDays: min, offerPartner: partner },
      })
    }
    return hits
  }
  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = daysBetween(days[i - 1].date, days[i].date) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  if (longest < min) {
    hits.push({
      ...campHit(ctx, { days: longest, min }, { evidence: [campEvidence(ctx.facts)] }),
      inputs: { campDaysTotal: days.length, longestConsecutiveDays: longest, requiredDays: min, offerPartner: partner },
    })
  }
  return hits
}

// JS-DAY-01 ----------------------------------------------------------------------------------

export const jsDay01: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const minMinutes = ctx.params.get<number>('js.minDayMinutes')
  const minUnits = ctx.params.get<number>('js.minDayUnits')
  const minBwz = ctx.params.get<number | null>('js.minBwzDayMinutes')
  const hits: RuleHit[] = []
  for (const d of interiorDays(ctx)) {
    // Free days (no J+S minutes) belong to JS-FREE-01; end days to JS-DAY-04.
    if (d.jsMinutes === 0 || d.isJsDay) continue
    const bwzOnly = d.jsMinutes >= minMinutes && d.units >= minUnits
    hits.push({
      targets: [d.dayIri],
      params: {
        date: formatDateDe(d.date),
        minutes: d.jsMinutes,
        units: d.units,
        minMinutes,
        minUnits,
        ...(bwzOnly && minBwz !== null ? { bwz: d.bwzMinutes, minBwz } : {}),
      },
      ...(bwzOnly ? { variant: 'bwz' } : {}),
      inputs: { dayDate: d.date, jsMinutes: d.jsMinutes, jsUnits: d.units, requiredMinutes: minMinutes, requiredUnits: minUnits, bwzMinutes: d.bwzMinutes },
      evidence: entriesEvidence(ctx, d.entryIris),
    })
  }
  return hits
}

// JS-DAY-02 ----------------------------------------------------------------------------------

export const jsDay02: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const min = ctx.params.get<number>('js.minUnitMinutes')
  const hits: RuleHit[] = []
  for (const d of ctx.js.days) {
    for (const iri of d.shortEntryIris) {
      const e = entryOf(ctx, iri)
      if (!e) continue
      const a = activityOf(ctx, e.activityIri)
      const minutes = entryMinutes(e)
      hits.push({
        targets: [e.iri],
        params: { day: d.number, title: a?.title ?? '?', minutes, min },
        inputs: { dayDate: d.date, unitMinutes: minutes, requiredMinutes: min },
        evidence: a ? [activityEvidence(a, `${minutes} min`)] : [],
      })
    }
  }
  return hits
}

// JS-DAY-03 ----------------------------------------------------------------------------------

export const jsDay03: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const min = ctx.params.get<number>('js.minGapMinutes')
  const hits: RuleHit[] = []
  for (const d of ctx.js.days) {
    if (d.shortGaps.length === 0) continue
    const shortest = Math.min(...d.shortGaps.map((g) => g.minutes))
    hits.push({
      targets: [d.dayIri],
      params: { day: d.number, count: d.shortGaps.length, minutes: shortest, min },
      inputs: { dayDate: d.date, gapsTooShort: d.shortGaps.length, shortestGapMinutes: shortest },
      evidence: entriesEvidence(ctx, d.entryIris),
    })
  }
  return hits
}

// JS-DAY-04 ----------------------------------------------------------------------------------

export const jsDay04: RulePredicate = (ctx) => {
  if (!ready(ctx) || ctx.js.days.length < 2 || ctx.js.endDaysMode !== 'none') return []
  const first = ctx.js.days[0]
  const last = ctx.js.days[ctx.js.days.length - 1]
  const minutes = first.jsMinutes + last.jsMinutes
  // Plain arrival/departure days without J+S activities are normal: no finding.
  if (minutes === 0) return []
  const min = ctx.params.get<number>('js.minDayMinutes')
  const minBwz = ctx.params.get<number | null>('js.minBwzDayMinutes')
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
        combinedBwzMinutes: first.bwzMinutes + last.bwzMinutes,
        requiredBwzMinutes: minBwz,
      },
      evidence: entriesEvidence(ctx, [...first.entryIris, ...last.entryIris]),
    },
  ]
}

// JS-DAY-05 ----------------------------------------------------------------------------------

export const jsDay05: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const headChars = ctx.params.get<number>('lst.warmupHeadChars')
  const hits: RuleHit[] = []
  for (const a of jsActivities(ctx)) {
    if (a.scheduleEntryIris.length === 0 && !ctx.facts.scheduleEntries.some((e) => e.activityIri === a.iri)) continue
    if (!a.content.storyboardText.trim()) continue // CMP-ACT-02 reports missing storyboards
    const head = a.content.storyboardText.slice(0, headChars)
    if (ctx.keywords.match('WARMUP', head).length > 0) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title },
      inputs: { storyboardChecked: head.length, warmupKeywordFound: false },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// JS-DAY-06 ----------------------------------------------------------------------------------

export const jsDay06: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const need = ctx.params.get<number>('js.minTimeWindows')
  const windows = parseTimeWindows(ctx.params.get('js.timeWindows'))
  const labelOf = (id: string) => windows.find((w) => w.id === id)?.label ?? id
  const slotOf = (days: JsModelDay[], covered: string[]): string => {
    if (covered.length > 0) return covered.map(labelOf).join(', ')
    const iv = days.flatMap((d) => d.intervals)[0]
    const w = iv ? windows.find((x) => x.from <= iv.from && iv.from < x.to) : undefined
    return w?.label ?? ''
  }
  const hits: RuleHit[] = []
  const check = (days: JsModelDay[], combined: boolean) => {
    if (days.reduce((n, d) => n + d.jsMinutes, 0) === 0) return
    const covered = windows.map((w) => w.id).filter((id) => days.some((d) => d.windowsCovered.includes(id)))
    if (covered.length >= need) return
    const slot = slotOf(days, covered)
    hits.push({
      targets: days.map((d) => d.dayIri),
      params: combined
        ? { first: formatDateDe(days[0].date), last: formatDateDe(days[1].date), slot, min: need }
        : { date: formatDateDe(days[0].date), slot, min: need },
      ...(combined ? { variant: 'combined' } : {}),
      inputs: { dayDate: days[0].date, windowsCovered: covered.join(','), requiredWindows: need },
      evidence: entriesEvidence(ctx, days.flatMap((d) => d.entryIris)),
    })
  }
  for (const d of interiorDays(ctx)) check([d], false)
  if (ctx.js.endDaysMode === 'combined') check([ctx.js.days[0], ctx.js.days[ctx.js.days.length - 1]], true)
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
  if (!ready(ctx)) return []
  const first = ctx.params.get<number>('js.freeDaysFirstAt')
  const every = ctx.params.get<number>('js.freeDaysEveryFurther')
  const skipping = ctx.params.get<string>('js.consecutiveMode') === 'jsDaysSkipping'
  const days = ctx.js.days.length
  const free = ctx.js.trainingFreeDays.length
  const allowedText = days < first ? 0 : 1 + Math.floor((days - first) / every)
  const allowedTable = days < first ? 0 : Math.floor((days - 2) / 2)
  if (free <= allowedText) return []
  const base = {
    ...campHit(ctx, { free, days, allowed: allowedText, allowedTable }),
    inputs: { campDays: days, trainingFreeDays: free, allowedText, allowedTable },
  }
  if (skipping) return [{ ...base, variant: 'conflict2027', severity: 'hint' as const, confidence: 'conflict' as const }]
  if (free > allowedTable) return [base]
  return [{ ...base, variant: 'conflict', severity: 'hint' as const, confidence: 'conflict' as const }]
}

// JS-BWZ-27 ----------------------------------------------------------------------------------

export const jsBwz27: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const min = ctx.params.get<number | null>('js.minBwzDayMinutes')
  const minDay = ctx.params.get<number>('js.minDayMinutes')
  if (min === null) return []
  const withJs = ctx.js.days.filter((d) => d.jsMinutes > 0)
  if (withJs.length === 0) return []
  if (!withJs.some((d) => d.bwzKnown)) return [{ ...campHit(ctx, { min }), variant: 'noData' }]
  const hits: RuleHit[] = []
  for (const d of interiorDays(ctx)) {
    if (d.jsMinutes < minDay || d.bwzMinutes >= min) continue
    hits.push({
      targets: [d.dayIri],
      params: { date: formatDateDe(d.date), bwz: d.bwzMinutes, min },
      inputs: { dayDate: d.date, jsMinutes: d.jsMinutes, movementMinutes: d.bwzMinutes, requiredMinutes: min },
      evidence: entriesEvidence(ctx, d.entryIris),
    })
  }
  return hits
}

// JS-BWZ-02 ----------------------------------------------------------------------------------

export const jsBwz02: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const min = ctx.params.get<number | null>('js.minBwzActivityMinutes')
  const step = ctx.params.get<number | null>('js.bwzStepMinutes')
  if (min === null || step === null) return []
  const hits: RuleHit[] = []
  const classify = (value: number, duration: number): { variant: string; severity?: 'should'; extra?: Record<string, number> } | null => {
    if (value < min) return { variant: 'under30', severity: 'should' }
    if (value % step !== 0) return { variant: 'step' }
    if (value > duration) return { variant: 'tooLong', severity: 'should', extra: { duration } }
    return null
  }
  for (const a of jsActivities(ctx)) {
    const entries = ctx.facts.scheduleEntries.filter((e) => e.activityIri === a.iri)
    if (entries.length === 0) continue
    const own = a.content.ysPhysicalActivityDurationMinutes
    const entryValues = entries.filter((e) => e.ysPhysicalActivityDurationMinutes != null)
    if (own == null && entryValues.length === 0) {
      hits.push({
        targets: [a.iri],
        params: { activity: a.title },
        variant: 'missing',
        severity: 'should',
        inputs: { movementMinutes: null },
        evidence: [activityEvidence(a)],
      })
      continue
    }
    for (const e of entryValues) {
      const value = e.ysPhysicalActivityDurationMinutes as number
      const c = classify(value, entryMinutes(e))
      if (!c) continue
      hits.push({
        targets: [e.iri],
        params: { activity: a.title, value, min, step, ...c.extra },
        variant: c.variant,
        ...(c.severity ? { severity: c.severity } : {}),
        inputs: { movementMinutes: value, entryMinutes: entryMinutes(e) },
        evidence: [activityEvidence(a)],
      })
    }
    if (own != null && entryValues.length === 0) {
      const total = entries.reduce((n, e) => n + entryMinutes(e), 0)
      const c = classify(own, total)
      if (!c) continue
      hits.push({
        targets: [a.iri],
        params: { activity: a.title, value: own, min, step, ...c.extra },
        variant: c.variant,
        ...(c.severity ? { severity: c.severity } : {}),
        inputs: { movementMinutes: own, activityMinutes: total },
        evidence: [activityEvidence(a)],
      })
    }
  }
  return hits
}

// CMP-ACT-01..03, CMP-LA-01 -------------------------------------------------------------------

export const cmpAct01: RulePredicate = (ctx) =>
  !jsApplies(ctx)
    ? []
    : ctx.facts.activities
        .filter((a) => a.responsibleIris.length === 0)
        .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))

export const cmpAct02: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  return jsActivities(ctx)
    .filter((a) => a.content.storyboardText.trim() === '' && a.content.notesText.trim() === '')
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))
}

const OUTDOOR_SETS = ['OUTDOOR', 'WATER', 'MOUNTAIN', 'ROPE']
const RISK_SETS = [...OUTDOOR_SETS, 'NIGHT', 'WINTER', 'FIRE']

/** Heuristic: LS activity or outdoor/water/mountain/rope keywords in title, location or storyboard. */
export function isOutdoorActivity(ctx: RuleContext, a: ActivityFact): boolean {
  if (classOfActivity(ctx, a) === 'LS') return true
  return OUTDOOR_SETS.some((set) => ctx.keywords.matchActivity(set, a, ['title', 'location', 'storyboard']).length > 0)
}

/** Risk activity: risk keyword hit or a `sb-*` / `ebb-*` tag. */
function isRiskActivity(ctx: RuleContext, a: ActivityFact): boolean {
  if (ctx.campConfig.tagsOf(a.iri).some((t) => t.startsWith('sb-') || t.startsWith('ebb-'))) return true
  return RISK_SETS.some((set) => ctx.keywords.matchActivity(set, a, ['title', 'location', 'storyboard']).length > 0)
}

export const cmpAct03: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  return jsActivities(ctx)
    .filter((a) => a.content.safetyText.trim() === '')
    .map((a) => {
      const risk = isRiskActivity(ctx, a)
      return {
        targets: [a.iri],
        params: { title: a.title },
        ...(risk ? {} : { severity: 'hint' as const }),
        inputs: { riskActivity: risk },
        evidence: [activityEvidence(a)],
      }
    })
}

export const cmpLa01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx) || !ctx.mapping) return []
  return ctx.facts.activities
    .filter((a) => classOfActivity(ctx, a) === 'LA' && a.content.laThematicAreas.length === 0)
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))
}

// BP-VAR-01 ----------------------------------------------------------------------------------

export const bpVar01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx) || !ctx.mapping || !hasJsMapping(ctx.mapping)) return []
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

// LST-ACT-01 ---------------------------------------------------------------------------------

export const lstAct01: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const hits: RuleHit[] = []
  for (const a of jsActivities(ctx)) {
    if (ctx.campConfig.tagsOf(a.iri).includes('js-aktivitaet')) continue
    const passive = ctx.keywords.match('PASSIVE', a.title)
    if (passive.length === 0) continue
    if (ctx.keywords.matchActivity('MOVEMENT', a, ['title', 'storyboard']).length > 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, term: passive[0].term },
      inputs: { passiveTerm: passive[0].term, movementKeywordFound: false },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-ACT-02 ---------------------------------------------------------------------------------

export const lstAct02: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const minOverlap = ctx.params.get<number>('js.minUnitMinutes')
  const jsEntries = ctx.facts.scheduleEntries.filter((e) => ctx.js.isJsActivity(e.activityIri) === true)
  const span = (e: ScheduleEntryFact) => ({ s: Date.parse(e.start), e: Date.parse(e.end) })
  const hits: RuleHit[] = []
  for (const a of jsActivities(ctx)) {
    const match = ctx.keywords.match('SUBGROUP', a.title)
    if (match.length === 0) continue
    const own = jsEntries.filter((e) => e.activityIri === a.iri)
    if (own.length === 0) continue
    const parallel = own.some((e) => {
      const x = span(e)
      return jsEntries.some((o) => {
        if (o.activityIri === a.iri) return false
        const y = span(o)
        return (Math.min(x.e, y.e) - Math.max(x.s, y.s)) / 60000 >= minOverlap
      })
    })
    if (parallel) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, term: match[0].term },
      inputs: { subgroupTerm: match[0].term, parallelJsEntry: false },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-ACT-03 ---------------------------------------------------------------------------------

export const lstAct03: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  return jsActivities(ctx)
    .filter((a) => a.content.learningObjectivesText.trim() === '')
    .map((a) => ({ targets: [a.iri], params: { activity: a.title }, evidence: [activityEvidence(a)] }))
}

// LST-ACT-04 ---------------------------------------------------------------------------------

export const lstAct04: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  const hits: RuleHit[] = []
  for (const a of jsActivities(ctx)) {
    const missing: NonNullable<RuleHit['fragments']>[string] = []
    if (!(a.location ?? '').trim()) missing.push({ variant: 'location' })
    if (a.content.materialText.trim() === '') missing.push({ variant: 'material' })
    const outdoor = ctx.keywords.matchActivity('OUTDOOR', a, ['title', 'location', 'storyboard']).length > 0
    if (outdoor && ctx.keywords.matchActivity('SCHLECHTWETTER', a, ['title', 'location', 'storyboard', 'notes', 'safety']).length === 0) {
      missing.push({ variant: 'weather' })
    }
    if (a.content.safetyText.trim() === '') missing.push({ variant: 'safety' })
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing },
      inputs: { missingRubrics: missing.map((m) => m.variant).join(','), outdoor },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-ACT-05 ---------------------------------------------------------------------------------

export const EF_SETS = ['EF1', 'EF2', 'EF3', 'EF4', 'EF5', 'EF6'] as const

/** Erscheinungsformen (1..6) of an activity: `ef*` tags first, keywords second. */
function formsOf(ctx: RuleContext, a: ActivityFact): number[] {
  const tags = ctx.campConfig.tagsOf(a.iri)
  const tagged = EF_SETS.map((_, i) => i + 1).filter((n) => tags.includes(`ef${n}` as never))
  if (tagged.length > 0) return tagged
  return EF_SETS.map((set, i) => (ctx.keywords.matchActivity(set, a).length > 0 ? i + 1 : 0)).filter((n) => n > 0)
}

export const lstAct05: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  return jsActivities(ctx)
    .filter((a) => formsOf(ctx, a).length === 0)
    .map((a) => ({ targets: [a.iri], params: { activity: a.title }, evidence: [activityEvidence(a)] }))
}

// LST-ANG-01 ---------------------------------------------------------------------------------

export const lstAng01: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  if (ctx.campConfig.angebot.unternehmungElsewhere === true) return []
  if (ctx.facts.activities.some((a) => ctx.campConfig.tagsOf(a.iri).includes('unternehmung'))) return []
  const addr = ctx.facts.camp.address
  const place = [addr.name, addr.street, addr.city].map((p) => (p ?? '').trim().toLowerCase()).filter((p) => p.length > 0)
  const atCamp = (loc: string | null) => {
    const l = (loc ?? '').trim().toLowerCase()
    return l !== '' && place.some((p) => l.includes(p))
  }
  const found = jsActivities(ctx).some(
    (a) =>
      !ctx.campConfig.tagsOf(a.iri).includes('keine-unternehmung') &&
      ctx.keywords.matchActivity('UNTERNEHMUNG', a, ['title', 'storyboard']).length > 0 &&
      !atCamp(a.location),
  )
  return found ? [] : [{ ...campHit(ctx), inputs: { jsActivities: jsActivities(ctx).length, unternehmungFound: false } }]
}

// LST-ANG-02 ---------------------------------------------------------------------------------

export const lstAng02: RulePredicate = (ctx) => {
  if (!ready(ctx)) return []
  if (ctx.campConfig.angebot.efCoveredElsewhere === true) return []
  const covered = new Set<number>()
  for (const a of jsActivities(ctx)) formsOf(ctx, a).forEach((n) => covered.add(n))
  const uncovered = EF_SETS.map((_, i) => i + 1).filter((n) => !covered.has(n))
  if (uncovered.length === 0) return []
  return [
    {
      ...campHit(ctx),
      fragments: { list: uncovered.map((n) => ({ variant: `ef${n}` })) },
      inputs: { uncoveredForms: uncovered.join(','), coveredForms: [...covered].sort().join(',') },
    },
  ]
}

export const predicates: Record<string, RulePredicate> = {
  'JS-CAMP-01': jsCamp01,
  'JS-DAY-01': jsDay01,
  'JS-DAY-02': jsDay02,
  'JS-DAY-03': jsDay03,
  'JS-DAY-04': jsDay04,
  'JS-DAY-05': jsDay05,
  'JS-DAY-06': jsDay06,
  'JS-LL-01': jsLl01,
  'JS-FREE-01': jsFree01,
  'JS-BWZ-27': jsBwz27,
  'JS-BWZ-02': jsBwz02,
  'CMP-ACT-01': cmpAct01,
  'CMP-ACT-02': cmpAct02,
  'CMP-ACT-03': cmpAct03,
  'CMP-LA-01': cmpLa01,
  'BP-VAR-01': bpVar01,
  'LST-ACT-01': lstAct01,
  'LST-ACT-02': lstAct02,
  'LST-ACT-03': lstAct03,
  'LST-ACT-04': lstAct04,
  'LST-ACT-05': lstAct05,
  'LST-ANG-01': lstAng01,
  'LST-ANG-02': lstAng02,
}
