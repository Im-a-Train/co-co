/** Predicate registry of pack coco-pbs (module pbs). */
import type { RulePredicate } from '@/domain/types'
import { mergePredicates } from '../../../lib/mergePredicates'
import { predicates as pbs } from './pbs'

export const predicates: Record<string, RulePredicate> = mergePredicates(pbs)
