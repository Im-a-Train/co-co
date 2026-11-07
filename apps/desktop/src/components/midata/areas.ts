/** Safety areas of eCamp activities for the qualification matrix (reuses the rule pack's keyword sets). */
import { activityText, matchKeywords, MOUNTAIN, WATER, type KeywordSet } from '@/domain/rules/packs/basis/predicates/util'
import type { SafetyArea } from '@/domain/midata'
import type { ActivityFact } from '@/domain/types'

export const WINTER: KeywordSet = {
  keywords: ['=ski', '^skitour', '^skifahr', 'schnee', 'winter', 'iglu', 'schneeschuh', '=schlitteln', 'langlauf'],
  exclude: ['schneewittchen'],
}

export const SAFETY_AREAS: readonly SafetyArea[] = ['wasser', 'berg', 'winter']
const SETS: Record<SafetyArea, KeywordSet> = { wasser: WATER, berg: MOUNTAIN, winter: WINTER }

/** Matched keywords per area (areas without a match are absent). */
export function areaMatches(a: ActivityFact): Partial<Record<SafetyArea, string[]>> {
  const text = activityText(a)
  const out: Partial<Record<SafetyArea, string[]>> = {}
  for (const area of SAFETY_AREAS) {
    const m = matchKeywords(text, SETS[area])
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
