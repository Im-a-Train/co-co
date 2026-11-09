import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LS, FactsBuilder, makeCtx } from '../factory'
import { ids } from './helpers'

describe('LST-ACT-03', () => {
  it('empty objectives -> hint; text present -> none', () => {
    const b = new FactsBuilder()
    const bad = b.activity('Ohne Ziele', CAT_LS)
    b.activity('Mit Zielen', CAT_LS, { content: { learningObjectivesText: 'Die TN lernen Knoten' } })
    b.activity('Essen', CAT_ES)
    expect(ids(p['LST-ACT-03'](makeCtx(b.facts)))).toEqual([bad.iri])
  })
  it('whitespace only counts as empty; no mapping -> none', () => {
    const b = new FactsBuilder()
    b.activity('Blank', CAT_LS, { content: { learningObjectivesText: '  \n' } })
    expect(p['LST-ACT-03'](makeCtx(b.facts))).toHaveLength(1)
    expect(p['LST-ACT-03'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
