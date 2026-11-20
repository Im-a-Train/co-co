/** Module `lst-ski` (LST-SKI-01…03): skiing and snowboarding. Pure predicates; all texts live in the rule YAMLs. */
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

// LST-SKI-01 ---------------------------------------------------------------------------------

export const lstSki01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const term = skiTerm(ctx, a)
    if (term === null) continue
    if (ctx.keywords.matchActivity('SKI_LEAD', a, ALL_ACTIVITY_FIELDS).length > 0) continue
    hits.push({ targets: [a.iri], params: { activity: a.title, term }, evidence: [activityEvidence(a)] })
  }
  return hits
}

// LST-SKI-02 ---------------------------------------------------------------------------------

const GROUPS: { set: string; variant: string }[] = [
  { set: 'SKI_HELM', variant: 'ski_helm' },
  { set: 'SKI_FIS', variant: 'ski_fis' },
  { set: 'SKI_FIRSTAID', variant: 'ski_firstaid' },
  { set: 'SKI_MATERIAL', variant: 'ski_material' },
]

export const lstSki02: RulePredicate = (ctx) => {
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

// LST-SKI-03 ---------------------------------------------------------------------------------

export const lstSki03: RulePredicate = (ctx) => {
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
  'LST-SKI-01': lstSki01,
  'LST-SKI-02': lstSki02,
  'LST-SKI-03': lstSki03,
}
