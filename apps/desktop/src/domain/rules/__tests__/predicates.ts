/** All bundled predicates (both packs) for predicate tests; hits remember their rule id for msg(hit). */
import type { RuleHit, RulePredicate } from '@/domain/types'
import { mergePredicates } from '../lib/mergePredicates'
import { predicates as jslst } from '../packs/jslst/predicates'
import { predicates as pbs } from '../packs/pbs/predicates'

/** Rule id of every hit returned through allPredicates (see factory.msg). */
export const hitRuleIds = new WeakMap<RuleHit, string>()

const tracked = (id: string, fn: RulePredicate): RulePredicate => (ctx) => {
  const hits = fn(ctx)
  for (const h of hits) hitRuleIds.set(h, id)
  return hits
}

export const allPredicates: Record<string, RulePredicate> = Object.fromEntries(
  Object.entries(mergePredicates(jslst, pbs)).map(([id, fn]) => [id, tracked(id, fn)]),
)
