/** Shared helpers of rule predicates (all packs). Pure. Keyword matching: ./keywords.ts (ctx.keywords). */
import type { ActivityFact, CampFacts, Evidence, MidataField, NdsField, RuleContext, RuleHit, Severity } from '@/domain/types'
import { categoryClassOf, isJsClass } from './jsDays'

/** Lower case + ß→ss (name matching; keyword matching lives in ./keywords.ts). */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/ß/g, 'ss')
}

// ---------------------------------------------------------------------------------------------
// Facts helpers
// ---------------------------------------------------------------------------------------------

export function activityText(a: ActivityFact, opts: { safety?: boolean; storyboard?: boolean; notes?: boolean } = {}): string {
  const parts = [a.title, a.location ?? '']
  if (opts.storyboard !== false) parts.push(a.content.storyboardText)
  if (opts.safety !== false) parts.push(a.content.safetyText)
  if (opts.notes !== false) parts.push(a.content.notesText)
  return parts.join('\n')
}

export function classOfActivity(ctx: RuleContext, a: ActivityFact) {
  return categoryClassOf(ctx.mapping, a.categoryIri)
}

/** J+S by mapping class only (legacy rules; the v2 model with tags is ctx.js.isJsActivity). */
export function isJsActivity(ctx: RuleContext, a: ActivityFact): boolean {
  return isJsClass(classOfActivity(ctx, a))
}

export function campEvidence(facts: CampFacts, label?: string): Evidence {
  return { kind: 'camp', iri: facts.camp.iri, label: label ?? facts.camp.title }
}

export function activityEvidence(a: ActivityFact, snippet?: string): Evidence {
  return { kind: 'activity', iri: a.iri, label: a.title, snippet }
}

/** True unless the coach explicitly marked the camp as non-J+S. */
export function jsApplies(ctx: RuleContext): boolean {
  return ctx.coachInputs?.isJsCamp !== false
}

/** Camp-level hit (target = camp IRI). */
export function campHit(
  ctx: RuleContext,
  params: Record<string, string | number> = {},
  extra: { severity?: Severity; evidence?: Evidence[] } = {},
): RuleHit {
  return { targets: [ctx.facts.camp.iri], params, ...extra }
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

export function formatDateDe(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

export function hhmm(iso: string): string {
  return iso.slice(11, 16)
}

// ---------------------------------------------------------------------------------------------
// MiData (M7) helpers. Red-derived data: only the aggregate is available here.
// ---------------------------------------------------------------------------------------------

export function formatStand(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return formatDateDe(iso)
  return d.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** «Stand» date (dd.mm.yyyy, de-CH) of the first of `fields` that was adopted from MiData, else null. */
export function midataStand(ctx: RuleContext, fields: MidataField[]): string | null {
  const map = ctx.coachInputs?.midataFields
  if (!map) return null
  for (const f of fields) {
    const ts = map[f]
    if (ts) return formatStand(ts)
  }
  return null
}

export function midataSourceText(stand: string): string {
  return `Quelle: MiData, Stand ${stand}`
}

/** Evidence entry naming the MiData source. */
export function midataEvidence(stand: string): Evidence {
  return { kind: 'text', label: midataSourceText(stand) }
}

// ---------------------------------------------------------------------------------------------
// NDS (M8) helpers. Red-derived data: only the aggregate is available here.
// ---------------------------------------------------------------------------------------------

/** «Stand» date (dd.mm.yyyy) of the first of `fields` that was adopted from NDS, else null. */
export function ndsStand(ctx: RuleContext, fields: NdsField[]): string | null {
  const map = ctx.coachInputs?.ndsFields
  if (!map) return null
  for (const f of fields) {
    const ts = map[f]
    if (ts) return formatStand(ts)
  }
  return null
}

export function ndsSourceText(stand: string): string {
  return `Quelle: NDS, Stand ${stand}`
}

/** Evidence entry naming the NDS source. */
export function ndsEvidence(stand: string): Evidence {
  return { kind: 'text', label: ndsSourceText(stand) }
}
