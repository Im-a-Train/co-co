/** Module `lst-trekking` (Unterwegs / Trekking). Pure predicates of RuleContext; all texts live in the rule YAMLs. */
import { jsOnly } from '../../../lib/gate'
import {
  DEFAULT_APP_SETTINGS,
  type ActivityFact,
  type DocumentRecord,
  type Evidence,
  type GpxStats,
  type MessageFragment,
  type RuleContext,
  type RuleHit,
  type RulePredicate,
} from '@/domain/types'
import { campYearOf } from '../../../lib/birthYear'
import { minutesBetween } from '../../../lib/jsDays'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { activityEvidence } from '../../../lib/util'

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

/** Hours with at most one decimal and a decimal comma (4,5). */
function fmtHours(minutes: number): string {
  return String(Number((minutes / 60).toFixed(1))).replace('.', ',')
}

/** Participants below this J+S-Alter count as children (Biber/Wölfe level; BERG S.4). */
const KIDS_BELOW_AGE = 10
const REGIONS_STRICT = ['voralpen', 'alpen', 'jura', 'ausland']

// ---- helpers ------------------------------------------------------------------------------------

const docsOf = (ctx: RuleContext, a: ActivityFact): DocumentRecord[] => ctx.documents.filter((d) => d.activityIris.includes(a.iri))
const isGpxDoc = (d: DocumentRecord) => d.kind === 'gpx' || d.gpx !== null

/** Keyword hit in title, location, storyboard or notes. */
const hit = (ctx: RuleContext, set: string, a: ActivityFact): boolean => ctx.keywords.matchActivity(set, a).length > 0

/** Keyword hit in any activity text (incl. safety) or the material list. */
const anyText = (ctx: RuleContext, set: string, a: ActivityFact): boolean =>
  ctx.keywords.matchActivity(set, a, ALL_ACTIVITY_FIELDS).length > 0 || ctx.keywords.match(set, a.content.materialText).length > 0

const docMatches = (ctx: RuleContext, set: string, d: DocumentRecord): boolean =>
  ctx.keywords.match(set, d.name).length > 0 || ctx.keywords.match(set, d.text).length > 0

/** Activity counts as Unternehmung: tag `unternehmung`, or a HIKE hit unless tagged `keine-unternehmung`. */
function isUnternehmung(ctx: RuleContext, a: ActivityFact): boolean {
  const tags = ctx.campConfig.tagsOf(a.iri)
  return tags.includes('unternehmung') || (!tags.includes('keine-unternehmung') && hit(ctx, 'HIKE', a))
}

const waterNotPool = (ctx: RuleContext, a: ActivityFact) => hit(ctx, 'WATER', a) && !hit(ctx, 'POOL', a)

interface Group {
  kids: boolean
  youngestAge: number | null
}

/** Children group: Stufe Biber/Wölfe, or youngest Jahrgang (MiData) below 10. */
function kidsGroup(ctx: RuleContext): Group {
  const stufe = ctx.coachInputs?.stufe
  const md = ctx.midata
  let youngestAge: number | null = null
  if (md?.participantsByBirthYear) {
    const years = Object.entries(md.participantsByBirthYear)
      .filter(([, n]) => n > 0)
      .map(([y]) => Number(y))
    if (years.length > 0) youngestAge = campYearOf(ctx.facts.camp.start, ctx.now) - Math.max(...years)
  } else if (md && md.minAge !== null) {
    youngestAge = md.minAge
  }
  const kids = stufe === 'biber' || stufe === 'woelfe' || (youngestAge !== null && youngestAge < KIDS_BELOW_AGE)
  return { kids, youngestAge }
}

const groupInputs = (g: Group): { inputs: Record<string, number | boolean | null>; redKeys: string[] } =>
  g.youngestAge !== null
    ? { inputs: { kidsGroup: g.kids, youngestAge: g.youngestAge }, redKeys: ['youngestAge'] }
    : { inputs: { kidsGroup: g.kids }, redKeys: [] }

// ---- GPX time estimate (LST-TREK-02/-03) ---------------------------------------------------------

interface Estimate {
  walkMinutes: number
  totalMinutes: number
  /** Every value used (pace, descent, pause) was set by the coach. */
  allOverridden: boolean
}

function estimateOf(ctx: RuleContext, g: GpxStats, kids: boolean): Estimate {
  const paceKey = kids ? 'lst.paceKidsLkmPerHour' : 'lst.paceLkmPerHour'
  const settingsPace = kids ? ctx.settings.gpx.paceWoelfeLkmPerHour : ctx.settings.gpx.paceLkmPerHour
  const defaultPace = kids ? DEFAULT_APP_SETTINGS.gpx.paceWoelfeLkmPerHour : DEFAULT_APP_SETTINGS.gpx.paceLkmPerHour
  const paceFromSettings = settingsPace !== defaultPace && settingsPace > 0
  const pace = paceFromSettings ? settingsPace : ctx.params.get<number>(paceKey)
  const descentHm = ctx.params.get<number>('lst.descentHmPerLkm')
  const pausePerHour = ctx.params.get<number>('lst.pauseMinutesPerHour')
  const lkm = g.lkm + g.descentM / descentHm
  const walk = (lkm / pace) * 60
  const total = walk + (walk / 60) * pausePerHour
  const allOverridden =
    (paceFromSettings || ctx.params.isOverridden(paceKey) !== null) &&
    ctx.params.isOverridden('lst.descentHmPerLkm') !== null &&
    ctx.params.isOverridden('lst.pauseMinutesPerHour') !== null
  return { walkMinutes: Math.round(walk), totalMinutes: Math.round(total), allOverridden }
}

// LST-TREK-01 --------------------------------------------------------------------------------

export const lstTrek01: RulePredicate = (ctx) => {
  const minSafety = ctx.params.get<number>('lst.hikeSafetyMinChars')
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    if (!isUnternehmung(ctx, a)) continue
    const docs = docsOf(ctx, a)
    const gpx = docs.some(isGpxDoc)
    const other = docs.some((d) => !isGpxDoc(d))
    const safetyChars = a.content.safetyText.trim().length
    const missing: MessageFragment[] = []
    if (!(gpx || docs.some((d) => docMatches(ctx, 'ROUTE_DOC', d)) || anyText(ctx, 'ROUTE_DOC', a))) missing.push({ variant: 'partRoute' })
    if (!(other || anyText(ctx, 'ALT_ROUTE', a))) missing.push({ variant: 'partAlt' })
    if (!(gpx || anyText(ctx, 'MARSCHZEIT', a) || docs.some((d) => docMatches(ctx, 'MARSCHZEIT', d)))) missing.push({ variant: 'partTime' })
    if (!(safetyChars >= minSafety || other)) missing.push({ variant: 'partSafety' })
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing },
      inputs: { linkedDocuments: docs.length, gpxLinked: gpx, safetyTextChars: safetyChars, requiredChars: minSafety },
      evidence: [activityEvidence(a), ...docs.map((d): Evidence => ({ kind: 'document', documentId: d.id, label: d.name }))],
    })
  }
  return hits
}

// LST-TREK-02 --------------------------------------------------------------------------------

export const lstTrek02: RulePredicate = (ctx) => {
  const g = kidsGroup(ctx)
  const gi = groupInputs(g)
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const gpxDocs = docsOf(ctx, a).filter((d) => d.gpx)
    if (gpxDocs.length === 0) continue
    const entries = ctx.facts.scheduleEntries.filter((e) => e.activityIri === a.iri)
    if (entries.length === 0) continue
    const slot = Math.max(...entries.map((e) => (e.durationMinutes > 0 ? e.durationMinutes : minutesBetween(e.start, e.end))))
    for (const d of gpxDocs) {
      if (!d.gpx) continue
      const est = estimateOf(ctx, d.gpx, g.kids)
      if (est.totalMinutes <= slot) continue
      hits.push({
        targets: [a.iri, d.id],
        params: { activity: a.title, estimate: fmtDuration(est.totalMinutes), slot: fmtDuration(slot) },
        ...(est.allOverridden ? {} : { confidence: 'unverified' as const }),
        inputs: { ...gi.inputs, estimatedMinutes: est.totalMinutes, walkMinutes: est.walkMinutes, slotMinutes: slot, valuesOverriddenByCoach: est.allOverridden },
        ...(gi.redKeys.length > 0 ? { redKeys: gi.redKeys } : {}),
        evidence: [activityEvidence(a), { kind: 'document', documentId: d.id, label: d.name }],
      })
    }
  }
  return hits
}

// LST-TREK-03 --------------------------------------------------------------------------------

export const lstTrek03: RulePredicate = (ctx) => {
  const g = kidsGroup(ctx)
  if (!g.kids) return []
  const gi = groupInputs(g)
  const max = ctx.params.get<number>('lst.hikeKidsMaxMinutes')
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    for (const d of docsOf(ctx, a)) {
      if (!d.gpx) continue
      const est = estimateOf(ctx, d.gpx, true)
      if (est.walkMinutes <= max) continue
      hits.push({
        targets: [a.iri, d.id],
        params: { activity: a.title, h: fmtHours(est.walkMinutes), max: fmtHours(max) },
        inputs: { ...gi.inputs, walkMinutes: est.walkMinutes, maxMinutes: max },
        ...(gi.redKeys.length > 0 ? { redKeys: gi.redKeys } : {}),
        evidence: [activityEvidence(a), { kind: 'document', documentId: d.id, label: d.name }],
      })
    }
  }
  return hits
}

// LST-TREK-04 --------------------------------------------------------------------------------

export const lstTrek04: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const tags = ctx.campConfig.tagsOf(a.iri)
    const strong = hit(ctx, 'HIKE', a) || hit(ctx, 'MOUNTAIN', a) || tags.includes('sb-berg')
    const weak = waterNotPool(ctx, a) || hit(ctx, 'WINTER', a) || hit(ctx, 'ROPE', a) || tags.includes('sb-wasser') || tags.includes('sb-winter')
    if (!strong && !weak) continue
    if (ctx.keywords.match('UMKEHR', a.content.safetyText).length > 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      ...(strong ? {} : { severity: 'hint' as const }),
      inputs: { safetyTextChars: a.content.safetyText.trim().length, umkehrFound: false },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-TREK-05 --------------------------------------------------------------------------------

export const lstTrek05: RulePredicate = (ctx) =>
  ctx.facts.activities
    .filter((a) => (hit(ctx, 'HIKE', a) || hit(ctx, 'BIKE', a)) && a.responsibleIris.length < 2)
    .map((a) => ({
      targets: [a.iri],
      params: { activity: a.title, n: a.responsibleIris.length },
      inputs: { responsibles: a.responsibleIris.length },
      evidence: [activityEvidence(a)],
    }))

// LST-TREK-06 --------------------------------------------------------------------------------

export const lstTrek06: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const applies =
      ctx.campConfig.tagsOf(a.iri).includes('unternehmung') ||
      hit(ctx, 'HIKE', a) ||
      hit(ctx, 'BIWAK', a) ||
      waterNotPool(ctx, a) ||
      (hit(ctx, 'WINTER', a) && hit(ctx, 'OUTDOOR', a))
    if (!applies) continue
    const text = `${a.content.materialText}\n${a.content.safetyText}`
    const missing: MessageFragment[] = []
    if (ctx.keywords.match('KIT_APOTHEKE', text).length === 0) missing.push({ variant: 'kitApotheke' })
    if (ctx.keywords.match('KIT_RETTUNGSDECKE', text).length === 0) missing.push({ variant: 'kitRettungsdecke' })
    if (ctx.keywords.match('KIT_ALARM', text).length === 0) missing.push({ variant: 'kitAlarm' })
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing },
      inputs: { materialTextChars: a.content.materialText.trim().length, safetyTextChars: a.content.safetyText.trim().length, groupsMissing: missing.length },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-TREK-07 --------------------------------------------------------------------------------

export const lstTrek07: RulePredicate = (ctx) => {
  const g = kidsGroup(ctx)
  if (!g.kids) return []
  const gi = groupInputs(g)
  return ctx.facts.activities
    .filter((a) => hit(ctx, 'BIWAK', a))
    .map((a) => ({
      targets: [a.iri],
      params: { activity: a.title },
      inputs: gi.inputs,
      ...(gi.redKeys.length > 0 ? { redKeys: gi.redKeys } : {}),
      evidence: [activityEvidence(a)],
    }))
}

// LST-TREK-08 --------------------------------------------------------------------------------

export const lstTrek08: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    if (!hit(ctx, 'BIKE', a)) continue
    const inline = hit(ctx, 'BIKE_INLINE', a)
    const missing: MessageFragment[] = []
    if (!anyText(ctx, 'BIKE_HELM', a)) missing.push({ variant: 'bikeHelm' })
    if (!anyText(ctx, 'BIKE_INSTR', a)) missing.push({ variant: 'bikeInstr' })
    if (inline && !anyText(ctx, 'BIKE_PROTECT', a)) missing.push({ variant: 'bikeProtect' })
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing },
      inputs: { inlineSkates: inline, groupsMissing: missing.length },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-TREK-09 --------------------------------------------------------------------------------

export const lstTrek09: RulePredicate = (ctx) => {
  const camp = ctx.campConfig.camp
  const strict = camp.abroad === true || (camp.region !== null && REGIONS_STRICT.includes(camp.region))
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    if (!isUnternehmung(ctx, a)) continue
    if (anyText(ctx, 'RECO', a) || docsOf(ctx, a).some((d) => docMatches(ctx, 'RECO', d))) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      ...(strict ? {} : { variant: 'soll', severity: 'hint' as const }),
      inputs: { region: camp.region ?? null, abroad: camp.abroad ?? null, recoFound: false },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'LST-TREK-01': jsOnly(lstTrek01),
  'LST-TREK-02': lstTrek02,
  'LST-TREK-03': lstTrek03,
  'LST-TREK-04': lstTrek04,
  'LST-TREK-05': lstTrek05,
  'LST-TREK-06': lstTrek06,
  'LST-TREK-07': lstTrek07,
  'LST-TREK-08': lstTrek08,
  'LST-TREK-09': lstTrek09,
}
