/** Module `ski` (SKI-01, SKI-02): sport skiing (and snowboarding). Pure predicates; all texts live in the rule YAMLs. */
import type { ActivityFact, MessageFragment, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { activityEvidence } from '../../../lib/util'

const FIELDS = ['title', 'location', 'storyboard', 'notes'] as const

const frag = (variants: string[]): MessageFragment[] => variants.map((variant) => ({ variant }))
const excluded = (ctx: RuleContext, a: ActivityFact): boolean => ctx.campConfig.tagsOf(a.iri).includes('kein-ebb')
const inSafety = (ctx: RuleContext, set: string, a: ActivityFact): boolean => ctx.keywords.match(set, a.content.safetyText).length > 0

/** First matched SKI term, or null when the activity is not skiing (or tagged `kein-ebb`). */
function skiTerm(ctx: RuleContext, a: ActivityFact): string | null {
  if (excluded(ctx, a)) return null
  return ctx.keywords.matchActivity('SKI', a, FIELDS)[0]?.term ?? null
}

// SKI-01 ---------------------------------------------------------------------------------

const GROUPS: { set: string; variant: string }[] = [
  { set: 'SKI_HELM', variant: 'ski_helm' },
  { set: 'SKI_FIS', variant: 'ski_fis' },
  { set: 'SKI_FIRSTAID', variant: 'ski_firstaid' },
  { set: 'SKI_MATERIAL', variant: 'ski_material' },
]

export const ski01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    if (skiTerm(ctx, a) === null) continue
    const missing = GROUPS.filter((g) => !inSafety(ctx, g.set, a))
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing: frag(missing.map((m) => m.variant)) },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// SKI-02 ---------------------------------------------------------------------------------

export const ski02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  const max = ctx.params.get<number>('ski.offPisteMaxSlope')
  const maxFreeride = ctx.params.get<number>('ski.freerideMaxSlope')
  for (const a of ctx.facts.activities) {
    if (excluded(ctx, a)) continue
    const term = ctx.keywords.matchActivity('SKI_OFFPISTE', a, ALL_ACTIVITY_FIELDS)[0]?.term
    if (!term) continue
    if (inSafety(ctx, 'SKI_OFFPISTE_PLAN', a)) continue
    hits.push({ targets: [a.iri], params: { activity: a.title, term, max, maxFreeride }, evidence: [activityEvidence(a)] })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'SKI-01': ski01,
  'SKI-02': ski02,
}
