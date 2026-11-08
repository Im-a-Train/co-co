/** Module `lst-lager` (Lagerleben und Organisation). Keyword based on German activity texts. Pure. */
import type { ActivityFact, DocumentRecord, Evidence, MessageFragment, RuleHit, RulePredicate } from '@/domain/types'
import { leadersByNormName, normalizeName } from '@/domain/midata'
import { DOC_CHECK } from '../../../lib/docCheck'
import { minutesBetween, sortedDays, wallDate, wallMinutes } from '../../../lib/jsDays'
import { hhmmToMinutes } from '../../../lib/params'
import { activityEvidence, formatDateDe, formatStand, midataEvidence } from '../../../lib/util'

const terms = (m: { term: string }[]) => m.map((x) => x.term)

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

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

// SAFE-WATER-01 (superseded by LST-WASSER-01/-04 in catalog v2) -------------------------------

export const safeWater01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = terms(ctx.keywords.matchActivity('WATER', a, ['title', 'location', 'storyboard', 'safety', 'notes']))
    if (found.length === 0) continue
    const missing: MessageFragment[] = []
    if (a.responsibleIris.length === 0) missing.push({ variant: 'noResponsible' })
    if (a.content.safetyText.trim() === '') missing.push({ variant: 'noSafety' })
    const evidence: Evidence[] = [activityEvidence(a, `Stichwörter: ${found.slice(0, 3).join(', ')}`)]
    const md = ctx.midata
    let qualChecked = false
    if (md && a.responsibleIris.length > 0) {
      // Match eCamp responsibles with MiData leaders by normalised name; only judged if at least one matches.
      const leadersByName = leadersByNormName(md.leaders)
      const matched = a.responsibleIris
        .map((iri) => ctx.facts.collaborators.find((c) => c.iri === iri))
        .flatMap((c) => (c ? (leadersByName.get(normalizeName(c.displayName)) ?? []) : []))
      if (matched.length > 0 && !matched.some((l) => l.qualifications.wasser || l.qualifications.slrg)) {
        qualChecked = true
        const stand = formatStand(md.fetchedAt)
        missing.push({ variant: 'noQualification', params: { stand } })
        evidence.push(midataEvidence(stand))
      }
    }
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title, keywords: found.slice(0, 3).join(', ') },
      fragments: { missing },
      inputs: {
        matchedKeyword: found[0],
        responsiblesCount: a.responsibleIris.length,
        safetyTextChars: a.content.safetyText.trim().length,
        ...(qualChecked ? { waterQualificationFound: false } : {}),
      },
      ...(qualChecked ? { redKeys: ['waterQualificationFound'] } : {}),
      evidence,
    })
  }
  return hits
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
      evidence: [activityEvidence(a, `Stichwörter: ${found.slice(0, 3).join(', ')}`)],
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

// SAFE-DOC-01 (superseded by LST-LAGER-01 in catalog v2) --------------------------------------

export const safeDoc01: RulePredicate = (ctx) => {
  const checked = ctx.documents.filter((d) => d.docCheck)
  const camp = ctx.facts.camp.iri
  if (checked.length === 0) return [{ targets: [camp], variant: 'noDocument', severity: 'hint' }]
  // Best document = most items found.
  const score = (d: DocumentRecord) => d.docCheck?.items.filter((i) => i.found).length ?? 0
  const best = [...checked].sort((a, b) => score(b) - score(a))[0]
  const missing = best.docCheck?.items.filter((i) => !i.found).map((i) => DOC_CHECK.labels[i.key]) ?? []
  if (missing.length === 0) return []
  return [
    {
      targets: [camp, best.id],
      params: { doc: best.name, missing: missing.join(', ') },
      inputs: { checkedDocuments: checked.length, bestDocumentItemsFound: score(best), itemsMissing: missing.length },
      evidence: [{ kind: 'document', documentId: best.id, label: best.name }],
    },
  ]
}

export const predicates: Record<string, RulePredicate> = {
  'CMP-DAY-01': cmpDay01,
  'SAFE-WATER-01': safeWater01,
  'SAFE-ROPE-01': safeRope01,
  'SAFE-NIGHT-01': safeNight01,
  'SAFE-WX-01': safeWx01,
  'SAFE-DOC-01': safeDoc01,
}
