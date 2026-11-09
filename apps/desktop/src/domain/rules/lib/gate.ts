/** Predicate wrappers shared by the J+S pack. Pure. */
import type { RulePredicate } from '@/domain/types'
import { jsApplies } from './util'

/** Rule that encodes a J+S-specific obligation (LS/T, EBB, J+S approval): silent when the coach marked the camp as non-J+S. */
export const jsOnly =
  (predicate: RulePredicate): RulePredicate =>
  (ctx) =>
    jsApplies(ctx) ? predicate(ctx) : []
