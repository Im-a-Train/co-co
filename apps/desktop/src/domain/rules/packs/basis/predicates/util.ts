/** Shared helpers of the basic rule pack predicates. Pure. */
import type { ActivityFact, CampFacts, Evidence, RuleContext, RuleHit, Severity } from '@/domain/types'
import { categoryClassOf, isJsClass } from '../../../jsDays'

// ---------------------------------------------------------------------------------------------
// Keyword matching (German, umlaut-tolerant)
// ---------------------------------------------------------------------------------------------

/**
 * Keyword syntax:
 *  - `stem`   token contains stem           (default; for long, unambiguous stems)
 *  - `=word`  token equals word (optional inflection e/en/n/s)
 *  - `^stem`  token starts with stem
 *  - `$stem`  token ends with stem (compound heads such as "Schlauchboot")
 */
export interface KeywordSet {
  keywords: string[]
  /** Tokens starting with one of these never match (e.g. "Trinkwasser"). */
  exclude?: string[]
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ß/g, 'ss')
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/baden[\s-]*powell/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function tokenMatches(token: string, keyword: string): boolean {
  const k = normalize(keyword.slice(1))
  switch (keyword[0]) {
    case '=':
      return token === k || ['e', 'en', 'n', 's'].some((s) => token === k + s)
    case '^':
      return token.startsWith(k)
    case '$':
      return token.endsWith(k) || ['e', 'en', 'n', 's'].some((s) => token.endsWith(k + s))
    default:
      return token.includes(normalize(keyword))
  }
}

/** Returns the matched keywords (as written in the set) found in `text`. */
export function matchKeywords(text: string, set: KeywordSet): string[] {
  const tokens = tokenize(text)
  const excluded = (set.exclude ?? []).map(normalize)
  const found = new Set<string>()
  for (const token of tokens) {
    if (excluded.some((e) => token.startsWith(e))) continue
    for (const kw of set.keywords) if (tokenMatches(token, kw)) found.add(kw.replace(/^[=^$]/, ''))
  }
  return [...found]
}

export function hasKeyword(text: string, set: KeywordSet): boolean {
  return matchKeywords(text, set).length > 0
}

/** Phrase (substring) check on normalised text, for multi-word phrases such as "bei regen". */
export function containsPhrase(text: string, phrases: string[]): boolean {
  const n = normalize(text)
  return phrases.some((p) => {
    const esc = normalize(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\p{L}\\p{N}])${esc}`, 'u').test(n)
  })
}

export const WATER: KeywordSet = {
  keywords: [
    '=baden', 'badi', 'schwimm', '=see', '$see', 'fluss', '=bach', '$bach', '=aare', '=reuss', '=rhein', 'kanu', 'kajak', 'kayak',
    '=boot', '$boot', 'wasser', 'rafting', 'tauchen', 'weiher', '=teich', 'strand', 'ruder',
  ],
  exclude: ['trinkwasser', 'wasserflasche', 'wasserkanister', 'wasserhahn', 'wasserstelle', 'abwasser', 'seeland'],
}

export const MOUNTAIN: KeywordSet = {
  keywords: [
    'wanderung', 'wandern', 'hike', 'hiking', 'berg', 'gipfel', '=pass', 'biwak', 'bivouac', '=ski', '^skitour', '^skifahr',
    '^skilager', 'kletter', 'trekking', 'höhenmeter', 'hoehenmeter', 'alpwanderung',
  ],
  exclude: ['bergfest'],
}

export const ROPE: KeywordSet = {
  keywords: ['seil', 'pionier', 'abseil', 'hochseil', 'flying fox', 'flyingfox'],
  exclude: ['seilziehen', 'seilspringen', 'seilspiel'],
}

export const NIGHT: KeywordSet = {
  keywords: ['^nacht'],
  exclude: ['nachtessen', 'nachtisch', 'nachtrag', 'nachtmahl', 'nachtruhe'],
}

/** Outdoor activity heuristic (superset of water / mountain / rope). */
export const OUTDOOR: KeywordSet = {
  keywords: [
    'draussen', 'outdoor', 'wald', 'wiese', 'gelände', 'gelaende', 'geländespiel', 'wanderung', 'wandern', 'hike', 'berg',
    'gipfel', 'biwak', 'trekking', 'ausflug', '=feuer', '^feuerstelle', 'orientierungslauf', 'postenlauf', 'schnitzeljagd', 'rakete', 'bräteln',
    'braeteln', 'zeltplatz', 'lagerplatz', 'spielplatz', '=hajk', 'hajk', 'abseil', 'seilbahn', 'pionier', 'kanu', 'baden',
    'schwimm', 'velo', 'radtour',
  ],
}

export const SCHLECHTWETTER_PHRASES = [
  'schlechtwetter',
  'schlechtes wetter',
  'regenprogramm',
  'regenvariante',
  'bei regen',
  'bei schlechtem wetter',
  'regenwetter',
  'plan b',
]

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
