/** Completeness rules (group 'completeness'). Pure predicates of RuleContext. */
import type { RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { datesDiffer, locationDiffers, midataDateRange } from '@/domain/midata'
import { addDays, daysBetween } from '../../../deadlines'
import {
  activityEvidence,
  activityText,
  classOfActivity,
  formatDateDe,
  formatStand,
  hasKeyword,
  isJsActivity,
  midataEvidence,
  midataSourceText,
  MOUNTAIN,
  normalize,
  OUTDOOR,
  ROPE,
  WATER,
} from './util'

const MAX_EVIDENCE = 25

// CMP-ACT-01 ---------------------------------------------------------------------------------

export const cmpAct01: RulePredicate = (ctx) =>
  ctx.facts.activities
    .filter((a) => a.responsibleIris.length === 0)
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))

// CMP-ACT-02 ---------------------------------------------------------------------------------

export const cmpAct02: RulePredicate = (ctx) => {
  if (!ctx.mapping) return []
  return ctx.facts.activities
    .filter((a) => isJsActivity(ctx, a) && (!a.content.hasStoryboard || a.content.storyboardText.trim() === ''))
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))
}

// CMP-ACT-03 ---------------------------------------------------------------------------------

/** Heuristic: LS activity or outdoor/water/mountain/rope keywords in title, location or storyboard. */
export function isOutdoorActivity(ctx: RuleContext, a: RuleContext['facts']['activities'][number]): boolean {
  if (classOfActivity(ctx, a) === 'LS') return true
  const text = activityText(a, { safety: false, notes: false })
  return [OUTDOOR, WATER, MOUNTAIN, ROPE].some((set) => hasKeyword(text, set))
}

export const cmpAct03: RulePredicate = (ctx) =>
  ctx.facts.activities
    .filter((a) => isOutdoorActivity(ctx, a) && a.content.safetyText.trim() === '')
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))

// CMP-LA-01 ----------------------------------------------------------------------------------

export const cmpLa01: RulePredicate = (ctx) => {
  if (!ctx.mapping) return []
  return ctx.facts.activities
    .filter((a) => classOfActivity(ctx, a) === 'LA' && a.content.laThematicAreas.length === 0)
    .map((a) => ({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] }))
}

// CMP-DAY-01 ---------------------------------------------------------------------------------

export const cmpDay01: RulePredicate = (ctx) => {
  const withResp = new Set(ctx.facts.dayResponsibles.map((r) => r.dayIri))
  return ctx.facts.days
    .filter((d) => !withResp.has(d.iri))
    .map((d) => ({ targets: [d.iri], params: { date: formatDate(d.date) }, evidence: [{ kind: 'day' as const, iri: d.iri, label: formatDate(d.date) }] }))
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

// CMP-CAMP-01 --------------------------------------------------------------------------------

function nameTokens(name: string): string[] {
  return normalize(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
}

/** True if coach name and user name share at least one name token (nickname, first or last name). */
export function coachNameMatches(coachName: string, userName: string): boolean {
  const a = nameTokens(coachName)
  const b = nameTokens(userName)
  return a.some((t) => b.includes(t))
}

export const cmpCamp01: RulePredicate = (ctx) => {
  const details: string[] = []
  const evidence: RuleHit['evidence'] = []
  const coach = (ctx.facts.camp.coachName ?? '').trim()
  if (!coach) details.push('Im Lager ist kein Coach eingetragen')
  else if (ctx.userDisplayName && !coachNameMatches(coach, ctx.userDisplayName)) {
    details.push(`Eingetragen ist «${coach}», angemeldet ist «${ctx.userDisplayName}»`)
  }
  if (ctx.midata?.coachMatch === false) {
    const stand = formatStand(ctx.midata.fetchedAt)
    details.push(`Im MiData-Anlass ist eine andere Person als Coach (Berater) eingetragen (${midataSourceText(stand)})`)
    evidence.push(midataEvidence(stand))
  }
  if (details.length === 0) return []
  return [{ targets: [ctx.facts.camp.iri], params: { detail: details.join('; ') }, ...(evidence.length ? { evidence } : {}) }]
}

// CMP-MD-01 ----------------------------------------------------------------------------------

/** eCamp camp dates vs. MiData event dates (earliest start, latest finish, date part only). */
export const cmpMd01: RulePredicate = (ctx) => {
  const md = ctx.midata
  const { start, end } = ctx.facts.camp
  if (!md || !start || !end) return []
  const range = midataDateRange(md, start, end)
  const datesOff = datesDiffer(md, start, end)
  const a = ctx.facts.camp.address
  const placeOff = locationDiffers(md.location, [a?.city, a?.name])
  if (!datesOff && !placeOff) return []
  const stand = formatStand(md.fetchedAt)
  const diffs: string[] = []
  if (datesOff && range)
    diffs.push(
      `Lagerdaten in eCamp (${formatDateDe(start)}–${formatDateDe(end)}) und MiData (${formatDateDe(range.start)}–${formatDateDe(range.end)}) stimmen nicht überein`,
    )
  if (placeOff) diffs.push(`Lagerort in eCamp («${a?.city ?? a?.name}») und MiData («${md.location}») stimmen nicht überein`)
  return [
    {
      targets: [ctx.facts.camp.iri],
      params: { _message: `${diffs.join('; ')} (${midataSourceText(stand)})`, stand },
      evidence: [midataEvidence(stand)],
    },
  ]
}

// CMP-PROG-01 --------------------------------------------------------------------------------

export const cmpProg01: RulePredicate = (ctx) => {
  const { facts } = ctx
  const start = facts.camp.start
  if (!start || facts.progressLabels.length === 0) return []
  const today = ctx.now.toISOString().slice(0, 10)
  if (today < addDays(start, -21)) return []
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
