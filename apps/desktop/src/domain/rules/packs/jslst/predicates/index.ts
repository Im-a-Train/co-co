/** Predicate registry of pack coco-js-lst: one file per module, merged here (duplicate ids throw). */
import type { RulePredicate } from '@/domain/types'
import { mergePredicates } from '../../../lib/mergePredicates'
import { predicates as berg } from './berg'
import { predicates as consistency } from './consistency'
import { predicates as ebb } from './ebb'
import { predicates as js } from './js'
import { predicates as lager } from './lager'
import { predicates as lst } from './lst'
import { predicates as trekking } from './trekking'
import { predicates as wasser } from './wasser'
import { predicates as winter } from './winter'

export const predicates: Record<string, RulePredicate> = mergePredicates(js, consistency, lst, lager, trekking, berg, wasser, winter, ebb)
