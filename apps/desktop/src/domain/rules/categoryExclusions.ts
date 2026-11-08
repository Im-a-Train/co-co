/** Drops findings about activities whose category the coach excluded from the rule check. Pure. */
import type { CampFacts, Finding, Iri } from '../types'
import { activityIriOfFinding } from '../triage'
import { isCategoryExcluded, type RuleState } from './ruleState'

export function filterExcludedFindings(
  findings: Finding[],
  facts: CampFacts | null,
  state: RuleState,
  campIri: Iri,
): { kept: Finding[]; excluded: number } {
  if (!facts || !state.excludedCategories.some((e) => e.campIri === campIri)) return { kept: findings, excluded: 0 }
  const kept = findings.filter((f) => {
    if (f.scope !== 'activity' && f.scope !== 'scheduleEntry') return true
    const actIri = activityIriOfFinding(f, facts)
    const categoryIri = actIri ? (facts.activities.find((a) => a.iri === actIri)?.categoryIri ?? null) : null
    return !categoryIri || !isCategoryExcluded(state, campIri, categoryIri, f.ruleId)
  })
  return { kept, excluded: findings.length - kept.length }
}
