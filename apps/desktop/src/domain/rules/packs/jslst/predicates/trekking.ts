/** Module `lst-trekking` (Unterwegs / Trekking). Pure predicates of RuleContext. */
import type { ActivityFact, DocumentRecord, Evidence, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { gpxWithPace } from '@/domain/documents'
import { leadersByNormName, normalizeName } from '@/domain/midata'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { minutesBetween } from '../../../lib/jsDays'
import { activityEvidence, formatStand, midataEvidence } from '../../../lib/util'
import { fmtDuration } from './lager'

const docsOf = (ctx: RuleContext, a: ActivityFact): DocumentRecord[] => ctx.documents.filter((d) => d.activityIris.includes(a.iri))
const mountainTerms = (ctx: RuleContext, a: ActivityFact) => ctx.keywords.matchActivity('MOUNTAIN', a, ALL_ACTIVITY_FIELDS).map((m) => m.term)

// SAFE-MTN-01 (superseded by LST-TREK-01 in catalog v2) ---------------------------------------

export const safeMtn01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = mountainTerms(ctx, a)
    if (found.length === 0) continue
    if (docsOf(ctx, a).length > 0) continue // GPX or planning document linked
    const planned = ['MARSCHZEIT', 'ALT_ROUTE'].some((set) => ctx.keywords.matchActivity(set, a, ALL_ACTIVITY_FIELDS).length > 0)
    if (planned) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title, keywords: found.slice(0, 3).join(', ') },
      inputs: { matchedKeyword: found[0], linkedDocuments: 0, timeCalculationFound: false },
      evidence: [activityEvidence(a, `Stichwörter: ${found.slice(0, 3).join(', ')}`)],
    })
  }
  return hits
}

// SAFE-MTN-02 (superseded by LST-TREK-02 in catalog v2) ---------------------------------------

export const safeMtn02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const gpxDocs = docsOf(ctx, a).filter((d) => d.gpx)
    if (gpxDocs.length === 0) continue
    const entries = ctx.facts.scheduleEntries.filter((e) => e.activityIri === a.iri)
    if (entries.length === 0) continue
    const slot = Math.max(...entries.map((e) => (e.durationMinutes > 0 ? e.durationMinutes : minutesBetween(e.start, e.end))))
    for (const d of gpxDocs) {
      // Pace stays in settings.gpx (coach setting) until LST-TREK-02 reads lst.pace* params.
      const pace = ctx.coachInputs?.stufe === 'woelfe' ? ctx.settings.gpx.paceWoelfeLkmPerHour : ctx.settings.gpx.paceLkmPerHour
      const g = d.gpx ? gpxWithPace(d.gpx, pace, ctx.settings.gpx.includeDescent) : null
      const est = Math.round(g?.estimatedMinutes ?? 0)
      if (est <= slot) continue
      const evidence: Evidence[] = [activityEvidence(a), { kind: 'document', documentId: d.id, label: d.name }]
      hits.push({
        targets: [a.iri, d.id],
        params: { title: a.title, estimated: fmtDuration(est), slot: fmtDuration(slot), doc: d.name },
        inputs: { estimatedMinutes: est, slotMinutes: slot },
        evidence,
      })
    }
  }
  return hits
}

// SAFE-MTN-03 (superseded by LST-SB-03 in catalog v2) -----------------------------------------

/** Mountain activities: responsibles matched to MiData leaders by name; none holds the mountain qualification. */
export const safeMtn03: RulePredicate = (ctx) => {
  const md = ctx.midata
  if (!md || md.qualificationsReadable === false) return []
  const leadersByName = leadersByNormName(md.leaders)
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = mountainTerms(ctx, a)
    if (found.length === 0 || a.responsibleIris.length === 0) continue
    const matched = a.responsibleIris
      .map((iri) => ctx.facts.collaborators.find((c) => c.iri === iri))
      .flatMap((c) => (c ? (leadersByName.get(normalizeName(c.displayName)) ?? []) : []))
    if (matched.length === 0 || matched.some((l) => l.qualifications.berg)) continue
    const stand = formatStand(md.fetchedAt)
    const kw = found.slice(0, 3).join(', ')
    hits.push({
      targets: [a.iri],
      inputs: { matchedKeyword: found[0], responsiblesMatchedInMidata: matched.length, bergQualificationFound: false },
      redKeys: ['responsiblesMatchedInMidata', 'bergQualificationFound'],
      params: { title: a.title, keywords: kw, stand },
      evidence: [activityEvidence(a, `Stichwörter: ${kw}`), midataEvidence(stand)],
    })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'SAFE-MTN-01': safeMtn01,
  'SAFE-MTN-02': safeMtn02,
  'SAFE-MTN-03': safeMtn03,
}
