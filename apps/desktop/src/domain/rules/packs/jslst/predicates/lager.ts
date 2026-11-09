/** Module `lst-lager` (Lagerleben und Organisation). Keyword based on German activity texts; all texts live in the rule YAMLs. Pure. */
import type { ActivityFact, DocumentRecord, Evidence, MessageFragment, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { DOC_CHECK } from '../../../lib/docCheck'
import { minutesBetween, sortedDays, wallDate, wallMinutes } from '../../../lib/jsDays'
import { normalizeText } from '../../../lib/keywords'
import { hhmmToMinutes } from '../../../lib/params'
import { activityEvidence, campEvidence, formatDateDe, hhmm } from '../../../lib/util'
import { fmtDuration, lstTrek01 } from './trekking'

const terms = (m: { term: string }[]) => m.map((x) => x.term)

// CMP-DAY-01 ---------------------------------------------------------------------------------

export const cmpDay01: RulePredicate = (ctx) => {
  const withResp = new Set(ctx.facts.dayResponsibles.map((r) => r.dayIri))
  return ctx.facts.days
    .filter((d) => !withResp.has(d.iri))
    .map((d) => ({
      targets: [d.iri],
      params: { date: formatDateDe(d.date) },
      evidence: [{ kind: 'day' as const, iri: d.iri, label: formatDateDe(d.date) }],
    }))
}

// SAFE-ROPE-01 -------------------------------------------------------------------------------

export const safeRope01: RulePredicate = (ctx) => {
  const min = ctx.params.get<number>('lst.ropeMinSafetyChars')
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = terms(ctx.keywords.matchActivity('ROPE', a, ['title', 'location', 'storyboard']))
    if (found.length === 0) continue
    const safety = a.content.safetyText.trim()
    const topics = ctx.keywords.match('ROPE_SAFETY', safety)
    const reasons: MessageFragment[] = []
    if (safety.length < min) reasons.push({ variant: 'tooShort', params: { chars: safety.length, min } })
    if (topics.length === 0) reasons.push({ variant: 'noTopics' })
    if (reasons.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title },
      fragments: { reasons },
      inputs: { matchedKeyword: found[0], safetyTextChars: safety.length, requiredChars: min, topicsMentioned: topics.length },
      evidence: [activityEvidence(a, found.slice(0, 3).join(', '))],
    })
  }
  return hits
}

// SAFE-NIGHT-01 ------------------------------------------------------------------------------

export const safeNight01: RulePredicate = (ctx) => {
  const { facts } = ctx
  const nightEnd = hhmmToMinutes(ctx.params.get<string>('lst.nightEndTime'))
  const minRest = ctx.params.get<number>('lst.minRestMinutes')
  const morning = ctx.params.get<{ from: string; to: string }>('lst.morningWindow')
  const morningFrom = hhmmToMinutes(morning.from)
  const morningTo = hhmmToMinutes(morning.to)
  const hits: RuleHit[] = []
  for (const a of facts.activities) {
    const entries = facts.scheduleEntries.filter((e) => e.activityIri === a.iri)
    const keyword = ctx.keywords.matchActivity('NIGHT', a, ['title', 'location', 'storyboard']).length > 0
    const late = entries.filter((e) => wallMinutes(e.end) > nightEnd || wallDate(e.end) > wallDate(e.start))
    if (!keyword && late.length === 0) continue
    const reasons: MessageFragment[] = []
    if (a.content.safetyText.trim() === '') reasons.push({ variant: 'noSafety' })
    const checkEntries = late.length > 0 ? late : entries
    for (const e of checkEntries) {
      // Next morning start: earliest entry after this one that starts within the morning window.
      const next = facts.scheduleEntries
        .filter((o) => o.iri !== e.iri && o.start > e.end && wallMinutes(o.start) >= morningFrom && wallMinutes(o.start) < morningTo)
        .filter((o) => wallDate(o.start) > wallDate(e.start))
        .sort((x, y) => (x.start < y.start ? -1 : 1))[0]
      if (!next) continue
      const rest = minutesBetween(e.end, next.start)
      if (rest < minRest) {
        reasons.push({ variant: 'shortRest', params: { rest: fmtDuration(rest), next: next.start.slice(11, 16), need: fmtDuration(minRest) } })
        break
      }
    }
    if (reasons.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title },
      fragments: { reasons },
      inputs: {
        nightKeyword: keyword,
        lateEntries: late.length,
        safetyTextChars: a.content.safetyText.trim().length,
        minRestMinutes: minRest,
      },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// SAFE-WX-01 ---------------------------------------------------------------------------------

const OUTDOOR_SETS = ['OUTDOOR', 'WATER', 'MOUNTAIN', 'ROPE']

export const safeWx01: RulePredicate = (ctx) => {
  const { facts } = ctx
  const docCovers = ctx.documents.some((d) => d.docCheck?.items.some((i) => i.key === 'badWeather' && i.found))
  if (docCovers) return []
  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  const hits: RuleHit[] = []
  for (const day of sortedDays(facts)) {
    const acts = new Map<string, ActivityFact>()
    for (const e of facts.scheduleEntries) {
      if (wallDate(e.start) !== day.date) continue
      const a = activityById.get(e.activityIri)
      if (a) acts.set(a.iri, a)
    }
    const list = [...acts.values()]
    const outdoor = list.filter((a) => OUTDOOR_SETS.some((set) => ctx.keywords.matchActivity(set, a, ['title', 'location', 'storyboard']).length > 0))
    if (outdoor.length === 0) continue
    if (list.some((a) => ctx.keywords.matchActivity('SCHLECHTWETTER', a, ['title', 'location', 'storyboard', 'safety', 'notes']).length > 0)) continue
    hits.push({
      targets: [day.iri],
      inputs: { dayDate: day.date, outdoorActivities: outdoor.length, activitiesOnDay: list.length, badWeatherPlanFound: false },
      params: { date: formatDateDe(day.date), count: outdoor.length },
      evidence: outdoor.slice(0, 10).map((a) => activityEvidence(a)),
    })
  }
  return hits
}


// LST-LAGER-01 -------------------------------------------------------------------------------

const RISK_SETS = ['MOUNTAIN', 'WATER', 'WINTER', 'ROPE', 'EBB_A', 'EBB_B']
const RISK_TAGS = ['sb-berg', 'sb-wasser', 'sb-winter', 'ebb-a', 'ebb-b']

const itemsFound = (d: DocumentRecord) => d.docCheck?.items.filter((i) => i.found).length ?? 0

/** The safety concept: a document named like one, else the document with the most docCheck items found. */
function conceptDoc(ctx: RuleContext): DocumentRecord | null {
  const checked = ctx.documents.filter((d) => d.docCheck)
  if (checked.length === 0) return null
  const named = checked.filter((d) => ctx.keywords.match('DOC_SICHERHEITSKONZEPT', d.name).length > 0)
  const pool = named.length > 0 ? named : checked
  return [...pool].sort((a, b) => itemsFound(b) - itemsFound(a))[0]
}

/** Risk sets an activity hits (water without supervised baths); tags count as data. */
function riskSetsOf(ctx: RuleContext, a: ActivityFact): string[] {
  const tags = ctx.campConfig.tagsOf(a.iri)
  const pool = ctx.keywords.matchActivity('POOL', a).length > 0
  const sets = RISK_SETS.filter((set) => ctx.keywords.matchActivity(set, a).length > 0 && !(set === 'WATER' && pool))
  if (tags.some((t) => RISK_TAGS.includes(t)) && sets.length === 0) sets.push('TAG')
  return sets
}

export const lstLager01: RulePredicate = (ctx) => {
  const camp = ctx.facts.camp.iri
  const doc = conceptDoc(ctx)
  if (!doc) return [{ targets: [camp], inputs: { checkedDocuments: 0 } }]
  const hits: RuleHit[] = []
  const evidence: Evidence[] = [{ kind: 'document', documentId: doc.id, label: doc.name }]
  const missing = doc.docCheck?.items.filter((i) => !i.found).map((i) => DOC_CHECK.labels[i.key]) ?? []
  if (missing.length > 0) {
    hits.push({
      targets: [camp, doc.id],
      variant: 'incomplete',
      params: { doc: doc.name, missing: missing.join(', ') },
      inputs: { bestDocumentItemsFound: itemsFound(doc), itemsMissing: missing.length },
      evidence,
    })
  }
  const text = normalizeText(doc.text)
  if (text !== '') {
    const notNamed = ctx.facts.activities.filter((a) => {
      const sets = riskSetsOf(ctx, a)
      if (sets.length === 0) return false
      if (text.includes(normalizeText(a.title))) return false
      return !sets.some((set) => set !== 'TAG' && ctx.keywords.match(set, doc.text).length > 0)
    })
    if (notNamed.length > 0) {
      hits.push({
        targets: [camp],
        variant: 'riskNotNamed',
        severity: 'hint',
        params: { list: notNamed.map((a) => a.title).join(', ') },
        inputs: { riskActivities: notNamed.length },
        evidence: [...evidence, ...notNamed.slice(0, 10).map((a) => activityEvidence(a))],
      })
    }
  }
  return hits
}

// LST-LAGER-02 -------------------------------------------------------------------------------

/** Share of J+S activities with a storyboard or notes text that counts as a detailed programme. */
const DETAIL_MIN_SHARE = 0.9

const nameMatches = (ctx: RuleContext, set: string) => ctx.documents.some((d) => ctx.keywords.match(set, d.name).length > 0)

export const lstLager02: RulePredicate = (ctx) => {
  const missing: MessageFragment[] = []
  const jsActs = ctx.facts.activities.filter((a) => ctx.js.isJsActivity(a.iri) === true)
  const detailed = jsActs.filter((a) => a.content.storyboardText.trim() !== '' || a.content.notesText.trim() !== '').length
  const share = jsActs.length === 0 ? 1 : detailed / jsActs.length
  if (share < DETAIL_MIN_SHARE) missing.push({ variant: 'partDetail' })
  if (lstTrek01(ctx).length > 0) missing.push({ variant: 'partRoute' })
  if (lstLager01(ctx).some((h) => h.variant !== 'riskNotNamed')) missing.push({ variant: 'partConcept' })
  if (!nameMatches(ctx, 'DOC_LAGERREGELN')) missing.push({ variant: 'partRules' })
  if (!nameMatches(ctx, 'DOC_LAGERINFO')) missing.push({ variant: 'partInfo' })
  if (safeWx01(ctx).length > 0) missing.push({ variant: 'partWeather' })
  if (missing.length === 0) return []
  return [
    {
      targets: [ctx.facts.camp.iri],
      fragments: { missing },
      inputs: { jsActivities: jsActs.length, detailedShare: Math.round(share * 100), partsMissing: missing.length },
      evidence: [campEvidence(ctx.facts)],
    },
  ]
}

// LST-LAGER-03 -------------------------------------------------------------------------------

const RULE_AREAS: [set: string, variant: string][] = [
  ['RULES_SICHERHEIT', 'areaSicherheit'],
  ['RULES_SUCHT', 'areaSucht'],
  ['RULES_ZUSAMMEN', 'areaZusammen'],
  ['RULES_ELEKTRONIK', 'areaElektronik'],
  ['RULES_UMWELT', 'areaUmwelt'],
]

export const lstLager03: RulePredicate = (ctx) => {
  const doc = ctx.documents.find((d) => ctx.keywords.match('DOC_LAGERREGELN', d.name).length > 0)
  if (!doc) return []
  const missing: MessageFragment[] = RULE_AREAS.filter(([set]) => ctx.keywords.match(set, doc.text).length === 0).map(([, variant]) => ({ variant }))
  if (missing.length === 0) return []
  return [
    {
      targets: [ctx.facts.camp.iri, doc.id],
      fragments: { missing },
      inputs: { areasMissing: missing.length },
      evidence: [{ kind: 'document', documentId: doc.id, label: doc.name }],
    },
  ]
}

// LST-LAGER-04 -------------------------------------------------------------------------------

export const lstLager04: RulePredicate = (ctx) => {
  const { facts } = ctx
  const days = sortedDays(facts)
  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  return days.slice(0, -1).flatMap((day) => {
    const has = facts.scheduleEntries.some((e) => {
      const a = e.dayIri === day.iri ? activityById.get(e.activityIri) : undefined
      return a !== undefined && ctx.keywords.match('HOECK', a.title).length > 0
    })
    if (has) return []
    return [
      {
        targets: [day.iri],
        params: { date: formatDateDe(day.date) },
        inputs: { dayDate: day.date, hoeckFound: false },
        evidence: [{ kind: 'day' as const, iri: day.iri, label: formatDateDe(day.date) }],
      },
    ]
  })
}

// LST-LAGER-05 -------------------------------------------------------------------------------

export const lstLager05: RulePredicate = (ctx) => {
  const { facts } = ctx
  const first = sortedDays(facts)[0]
  if (!first) return []
  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  const found = facts.scheduleEntries.some((e) => {
    const a = e.dayIri === first.iri ? activityById.get(e.activityIri) : undefined
    return a !== undefined && ctx.keywords.matchActivity('DAY1_INFO', a, ['title', 'storyboard']).length > 0
  })
  if (found) return []
  return [
    {
      targets: [facts.camp.iri],
      inputs: { firstDay: first.date, infoFound: false },
      evidence: [{ kind: 'day' as const, iri: first.iri, label: formatDateDe(first.date) }],
    },
  ]
}

// LST-LAGER-06 -------------------------------------------------------------------------------

export const lstLager06: RulePredicate = (ctx) => {
  const { facts } = ctx
  const win = ctx.params.get<{ from: string; to: string }>('lst.buildQuietWindow')
  const from = hhmmToMinutes(win.from)
  const to = hhmmToMinutes(win.to)
  // Quiet intervals in minutes since the entry's day start (the window may wrap over midnight).
  const quiet: [number, number][] =
    from > to
      ? [
          [0, to],
          [from, 1440 + to],
        ]
      : [[from, to]]
  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  const hits: RuleHit[] = []
  for (const e of facts.scheduleEntries) {
    const a = activityById.get(e.activityIri)
    if (!a || ctx.keywords.match('BUILD', a.title).length === 0) continue
    const s = wallMinutes(e.start)
    const end = s + minutesBetween(e.start, e.end)
    if (!quiet.some(([qs, qe]) => s < qe && end > qs)) continue
    hits.push({
      targets: [e.iri],
      params: { activity: a.title, from: hhmm(e.start), to: hhmm(e.end) },
      inputs: { entryStart: hhmm(e.start), entryEnd: hhmm(e.end), quietFrom: win.from, quietTo: win.to },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-LAGER-07 -------------------------------------------------------------------------------

export const lstLager07: RulePredicate = (ctx) =>
  ctx.facts.activities
    .filter((a) => ctx.keywords.matchActivity('FIRE', a).length > 0 && ctx.keywords.match('FIRE_SAFETY', a.content.safetyText).length === 0)
    .map((a) => ({
      targets: [a.iri],
      params: { activity: a.title },
      inputs: { safetyTextChars: a.content.safetyText.trim().length, fireSafetyFound: false },
      evidence: [activityEvidence(a)],
    }))

export const predicates: Record<string, RulePredicate> = {
  'CMP-DAY-01': cmpDay01,
  'SAFE-ROPE-01': safeRope01,
  'SAFE-NIGHT-01': safeNight01,
  'SAFE-WX-01': safeWx01,
  'LST-LAGER-01': lstLager01,
  'LST-LAGER-02': lstLager02,
  'LST-LAGER-03': lstLager03,
  'LST-LAGER-04': lstLager04,
  'LST-LAGER-05': lstLager05,
  'LST-LAGER-06': lstLager06,
  'LST-LAGER-07': lstLager07,
}
