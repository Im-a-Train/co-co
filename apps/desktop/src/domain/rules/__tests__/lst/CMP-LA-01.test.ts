import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, CAT_LS, FactsBuilder, makeCtx, ruleMeta } from '../factory'
import { ids } from './helpers'

describe('CMP-LA-01', () => {
  it('flags LA without thematic area', () => {
    const b = new FactsBuilder()
    const bad = b.activity('LA ohne', CAT_LA)
    b.activity('LA mit', CAT_LA, { content: { laThematicAreas: ['umwelt'] } })
    b.activity('LS', CAT_LS)
    expect(ids(p['CMP-LA-01'](makeCtx(b.facts)))).toEqual([bad.iri])
  })
  it('is only valid until 2026-12-31 (the LA concept is absent from the 2027 sources)', () => {
    expect(ruleMeta('CMP-LA-01').validTo).toBe('2026-12-31')
  })
  it('is silent without mapping', () => {
    const b = new FactsBuilder()
    b.activity('LA ohne', CAT_LA)
    expect(p['CMP-LA-01'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
