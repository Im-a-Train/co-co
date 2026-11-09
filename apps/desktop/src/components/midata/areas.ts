/** Safety areas of eCamp activities for the qualification matrix (reuses the rule packs' keyword sets). */
import type { SafetyArea } from '@/domain/midata'
import type { ActivityFact, KeywordSetDef } from '@/domain/types'
import { ALL_ACTIVITY_FIELDS, activityField, compileKeywordSets, matchCompiled, type CompiledSet } from '@/domain/rules/lib/keywords'
import { loadBundledPacks } from '@/domain/rules/packs'

/** Matrix winter area (broader than the rules' WINTER set: includes ski / langlauf). */
export const WINTER: KeywordSetDef = {
  id: 'AREA_WINTER',
  include: ['=ski', '^skitour', '^skifahr', 'schnee', 'winter', 'iglu', 'schneeschuh', '=schlitteln', 'langlauf'],
  exclude: ['schneewittchen'],
}

export const SAFETY_AREAS: readonly SafetyArea[] = ['wasser', 'berg', 'winter']
const SET_IDS: Record<SafetyArea, string> = { wasser: 'WATER', berg: 'MOUNTAIN', winter: 'AREA_WINTER' }

let compiled: Map<string, CompiledSet> | null = null
function sets(): Map<string, CompiledSet> {
  compiled ??= compileKeywordSets([...loadBundledPacks().flatMap((p) => p.keywordSets ?? []), WINTER])
  return compiled
}

/** Matched keywords per area (areas without a match are absent). */
export function areaMatches(a: ActivityFact): Partial<Record<SafetyArea, string[]>> {
  const text = ALL_ACTIVITY_FIELDS.map((f) => activityField(a, f)).join('\n')
  const out: Partial<Record<SafetyArea, string[]>> = {}
  for (const area of SAFETY_AREAS) {
    const m = matchCompiled(sets().get(SET_IDS[area])!, text)
    if (m.length) out[area] = m
  }
  return out
}

export function areasOfActivity(a: ActivityFact): SafetyArea[] {
  return Object.keys(areaMatches(a)) as SafetyArea[]
}

/** Areas the coach dismissed per activity iri. */
export type DismissedAreas = Record<string, SafetyArea[]>

/** `areaOf` callback for buildQualificationMatrix; dismissed areas are left out. */
export function makeAreaOf(activities: readonly ActivityFact[], dismissed: DismissedAreas = {}): (activityIri: string) => SafetyArea[] {
  const byIri = new Map(activities.map((a) => [a.iri, a]))
  return (iri) => {
    const a = byIri.get(iri)
    return a ? areasOfActivity(a).filter((x) => !(dismissed[iri] ?? []).includes(x)) : []
  }
}

/** `keywordsOf` callback for buildQualificationMatrix. */
export function makeKeywordsOf(activities: readonly ActivityFact[]): (activityIri: string, area: SafetyArea) => string[] {
  const byIri = new Map(activities.map((a) => [a.iri, a]))
  return (iri, area) => {
    const a = byIri.get(iri)
    return a ? (areaMatches(a)[area] ?? []) : []
  }
}

/** Dismissed (activity, area) pairs that the detector still flags, for the «ausgeblendet» list. */
export function dismissedEntries(activities: readonly ActivityFact[], dismissed: DismissedAreas): { iri: string; title: string; area: SafetyArea }[] {
  return activities.flatMap((a) => {
    const found = areaMatches(a)
    return (dismissed[a.iri] ?? []).filter((area) => found[area]).map((area) => ({ iri: a.iri, title: a.title, area }))
  })
}
