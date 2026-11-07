/** Safety areas of eCamp activities for the qualification matrix (reuses the rule pack's keyword sets). */
import { activityText, matchKeywords, MOUNTAIN, WATER, type KeywordSet } from '@/domain/rules/packs/basis/predicates/util'
import type { SafetyArea } from '@/domain/midata'
import type { ActivityFact } from '@/domain/types'

export const WINTER: KeywordSet = {
  keywords: ['=ski', '^skitour', '^skifahr', 'schnee', 'winter', 'iglu', 'schneeschuh', '=schlitteln', 'langlauf'],
  exclude: ['schneewittchen'],
}

export function areasOfActivity(a: ActivityFact): SafetyArea[] {
  const text = activityText(a)
  const out: SafetyArea[] = []
  if (matchKeywords(text, WATER).length) out.push('wasser')
  if (matchKeywords(text, MOUNTAIN).length) out.push('berg')
  if (matchKeywords(text, WINTER).length) out.push('winter')
  return out
}

/** `areaOf` callback for buildQualificationMatrix. */
export function makeAreaOf(activities: readonly ActivityFact[]): (activityIri: string) => SafetyArea[] {
  const byIri = new Map(activities.map((a) => [a.iri, a]))
  return (iri) => {
    const a = byIri.get(iri)
    return a ? areasOfActivity(a) : []
  }
}
