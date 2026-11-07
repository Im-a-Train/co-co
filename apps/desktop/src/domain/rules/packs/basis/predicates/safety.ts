/** Safety heuristics (group 'safety'). Keyword based on German title/location/storyboard/safety text. Pure. */
import type { ActivityFact, DocumentRecord, Evidence, RuleContext, RuleHit, RulePredicate, SafetyCheckKey } from '@/domain/types'
import { leadersByNormName, normalizeName } from '@/domain/midata'
import { gpxWithPace } from '@/domain/documents'
import { minutesBetween, sortedDays, wallDate, wallMinutes } from '../../../jsDays'
import {
  activityEvidence,
  activityText,
  containsPhrase,
  formatStand,
  hasKeyword,
  matchKeywords,
  midataEvidence,
  midataSourceText,
  MOUNTAIN,
  NIGHT,
  OUTDOOR,
  ROPE,
  SCHLECHTWETTER_PHRASES,
  WATER,
} from './util'

const docsOf = (ctx: RuleContext, a: ActivityFact): DocumentRecord[] => ctx.documents.filter((d) => d.activityIris.includes(a.iri))

// SAFE-WATER-01 ------------------------------------------------------------------------------

export const safeWater01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = matchKeywords(activityText(a), WATER)
    if (found.length === 0) continue
    const missing: string[] = []
    if (a.responsibleIris.length === 0) missing.push('keine verantwortliche Person')
    if (a.content.safetyText.trim() === '') missing.push('keine Sicherheitsüberlegungen')
    const evidence: Evidence[] = [activityEvidence(a, `Stichwörter: ${found.slice(0, 3).join(', ')}`)]
    const md = ctx.midata
    if (md && a.responsibleIris.length > 0) {
      // Match eCamp responsibles with MiData leaders by normalised name; only judged if at least one matches.
      const leadersByName = leadersByNormName(md.leaders)
      const matched = a.responsibleIris
        .map((iri) => ctx.facts.collaborators.find((c) => c.iri === iri))
        .flatMap((c) => (c ? (leadersByName.get(normalizeName(c.displayName)) ?? []) : []))
      if (matched.length > 0 && !matched.some((l) => l.qualifications.wasser || l.qualifications.slrg)) {
        const stand = formatStand(md.fetchedAt)
        missing.push(`keine verantwortliche Person mit Wasser-/SLRG-Qualifikation (${midataSourceText(stand)})`)
        evidence.push(midataEvidence(stand))
      }
    }
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title, missing: missing.join(' und '), keywords: found.slice(0, 3).join(', ') },
      evidence,
    })
  }
  return hits
}

// SAFE-MTN-01 --------------------------------------------------------------------------------

const MTN_SATISFIED = ['zeitberechnung', 'alternativroute', 'alternativ-route', 'alternative route']

export const safeMtn01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = matchKeywords(activityText(a), MOUNTAIN)
    if (found.length === 0) continue
    if (docsOf(ctx, a).length > 0) continue // GPX or planning document linked
    if (containsPhrase(activityText(a), MTN_SATISFIED)) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title, keywords: found.slice(0, 3).join(', ') },
      evidence: [activityEvidence(a, `Stichwörter: ${found.slice(0, 3).join(', ')}`)],
    })
  }
  return hits
}

// SAFE-MTN-02 --------------------------------------------------------------------------------

export const safeMtn02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const gpxDocs = docsOf(ctx, a).filter((d) => d.gpx)
    if (gpxDocs.length === 0) continue
    const entries = ctx.facts.scheduleEntries.filter((e) => e.activityIri === a.iri)
    if (entries.length === 0) continue
    const slot = Math.max(...entries.map((e) => (e.durationMinutes > 0 ? e.durationMinutes : minutesBetween(e.start, e.end))))
    for (const d of gpxDocs) {
      const g = d.gpx ? gpxWithPace(d.gpx, ctx.coachInputs?.stufe === 'woelfe' ? ctx.settings.gpx.paceWoelfeLkmPerHour : ctx.settings.gpx.paceLkmPerHour, ctx.settings.gpx.includeDescent) : null
      const est = Math.round(g?.estimatedMinutes ?? 0)
      if (est <= slot) continue
      const evidence: Evidence[] = [activityEvidence(a), { kind: 'document', documentId: d.id, label: d.name }]
      hits.push({
        targets: [a.iri, d.id],
        params: { title: a.title, estimated: fmtDuration(est), slot: fmtDuration(slot), doc: d.name },
        evidence,
      })
    }
  }
  return hits
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

// SAFE-MTN-03 --------------------------------------------------------------------------------

/**
 * Mountain activities: responsibles matched to MiData leaders by name; none holds the mountain
 * qualification. Winter is not checked (no winter keyword set exists in the pack).
 */
export const safeMtn03: RulePredicate = (ctx) => {
  const md = ctx.midata
  if (!md || md.qualificationsReadable === false) return []
  const leadersByName = leadersByNormName(md.leaders)
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = matchKeywords(activityText(a), MOUNTAIN)
    if (found.length === 0 || a.responsibleIris.length === 0) continue
    const matched = a.responsibleIris
      .map((iri) => ctx.facts.collaborators.find((c) => c.iri === iri))
      .flatMap((c) => (c ? (leadersByName.get(normalizeName(c.displayName)) ?? []) : []))
    if (matched.length === 0 || matched.some((l) => l.qualifications.berg)) continue
    const stand = formatStand(md.fetchedAt)
    const kw = found.slice(0, 3).join(', ')
    hits.push({
      targets: [a.iri],
      params: {
        title: a.title,
        keywords: kw,
        _message: `«${a.title}» (Berg/Wanderung: ${kw}): keine verantwortliche Person mit Berg-Qualifikation (${midataSourceText(stand)})`,
      },
      evidence: [activityEvidence(a, `Stichwörter: ${kw}`), midataEvidence(stand)],
    })
  }
  return hits
}

// SAFE-ROPE-01 -------------------------------------------------------------------------------

const ROPE_TOPICS = ['sicherung', 'verankerung', 'bremse']

export const ROPE_MIN_CHARS = 200

export const safeRope01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = matchKeywords(activityText(a, { safety: false, notes: false }), ROPE)
    if (found.length === 0) continue
    const safety = a.content.safetyText.trim()
    const topics = ROPE_TOPICS.filter((t) => containsPhrase(safety, [t]))
    const reasons: string[] = []
    if (safety.length < ROPE_MIN_CHARS) reasons.push(`Sicherheitstext zu kurz (${safety.length} von ${ROPE_MIN_CHARS} Zeichen)`)
    if (topics.length === 0) reasons.push('weder Sicherung, Verankerung noch Bremse erwähnt')
    if (reasons.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { title: a.title, reasons: reasons.join('; ') },
      evidence: [activityEvidence(a, `Stichwörter: ${found.slice(0, 3).join(', ')}`)],
    })
  }
  return hits
}

// SAFE-NIGHT-01 ------------------------------------------------------------------------------

export const NIGHT_END_MINUTES = 22 * 60
export const MIN_REST_MINUTES = 8.5 * 60

export const safeNight01: RulePredicate = (ctx) => {
  const { facts } = ctx
  const hits: RuleHit[] = []
  for (const a of facts.activities) {
    const entries = facts.scheduleEntries.filter((e) => e.activityIri === a.iri)
    const keyword = hasKeyword(activityText(a, { safety: false, notes: false }), NIGHT)
    const late = entries.filter((e) => wallMinutes(e.end) > NIGHT_END_MINUTES || wallDate(e.end) > wallDate(e.start))
    if (!keyword && late.length === 0) continue
    const reasons: string[] = []
    if (a.content.safetyText.trim() === '') reasons.push('keine Sicherheitsüberlegungen')
    const checkEntries = late.length > 0 ? late : entries
    for (const e of checkEntries) {
      // Next morning start: earliest entry after this one that starts between 05:00 and 14:00.
      const next = facts.scheduleEntries
        .filter((o) => o.iri !== e.iri && o.start > e.end && wallMinutes(o.start) >= 5 * 60 && wallMinutes(o.start) < 14 * 60)
        .filter((o) => wallDate(o.start) > wallDate(e.start))
        .sort((x, y) => (x.start < y.start ? -1 : 1))[0]
      if (!next) continue
      const rest = minutesBetween(e.end, next.start)
      if (rest < MIN_REST_MINUTES) {
        reasons.push(`nur ${fmtDuration(rest)} Ruhe bis zum nächsten Programmstart (${next.start.slice(11, 16)} Uhr, nötig: 8 h 30 min)`)
        break
      }
    }
    if (reasons.length === 0) continue
    hits.push({ targets: [a.iri], params: { title: a.title, reasons: reasons.join('; ') }, evidence: [activityEvidence(a)] })
  }
  return hits
}

// SAFE-WX-01 ---------------------------------------------------------------------------------

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
    const outdoor = list.filter((a) => {
      const t = activityText(a, { safety: false, notes: false })
      return [OUTDOOR, WATER, MOUNTAIN, ROPE].some((set) => hasKeyword(t, set))
    })
    if (outdoor.length === 0) continue
    if (list.some((a) => containsPhrase(activityText(a), SCHLECHTWETTER_PHRASES))) continue
    hits.push({
      targets: [day.iri],
      params: { date: `${day.date.slice(8, 10)}.${day.date.slice(5, 7)}.${day.date.slice(0, 4)}`, count: outdoor.length },
      evidence: outdoor.slice(0, 10).map((a) => activityEvidence(a)),
    })
  }
  return hits
}

// SAFE-DOC-01 --------------------------------------------------------------------------------

export const SAFETY_CHECK_LABELS: Record<SafetyCheckKey, string> = {
  emergencyNumbers: 'Notrufnummern',
  hospital: 'Spital',
  crisisContact: 'Krisenkontakt',
  evacuation: 'Evakuation/Notunterkunft',
  badWeather: 'Schlechtwetterplan',
  threeByThree: '3x3',
  firstAid: 'Notfallapotheke',
  campAddress: 'Lageradresse/Koordinaten',
}

export const safeDoc01: RulePredicate = (ctx) => {
  const checked = ctx.documents.filter((d) => d.docCheck)
  const camp = ctx.facts.camp.iri
  if (checked.length === 0) {
    return [{ targets: [camp], params: { _message: 'Noch kein Sicherheitskonzept als Dokument hinterlegt (Tab «Dokumente»).' }, severity: 'hint' }]
  }
  // Best document = most items found.
  const score = (d: DocumentRecord) => d.docCheck?.items.filter((i) => i.found).length ?? 0
  const best = [...checked].sort((a, b) => score(b) - score(a))[0]
  const missing = best.docCheck?.items.filter((i) => !i.found).map((i) => SAFETY_CHECK_LABELS[i.key]) ?? []
  if (missing.length === 0) return []
  return [
    {
      targets: [camp, best.id],
      params: { doc: best.name, missing: missing.join(', ') },
      evidence: [{ kind: 'document', documentId: best.id, label: best.name }],
    },
  ]
}
