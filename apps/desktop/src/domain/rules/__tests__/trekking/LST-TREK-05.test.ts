import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'
import { ids } from './helpers'

describe('LST-TREK-05', () => {
  it('metadata: hint/best-practice', () => {
    expect(ruleMeta('LST-TREK-05')).toMatchObject({ severity: 'hint', confidence: 'best-practice' })
  })
  it('1 responsible on a hike or bike tour -> hint', () => {
    const b = new FactsBuilder()
    const hike = b.activity('Wanderung', CAT_LS)
    const bike = b.activity('Velotour', CAT_LS, { responsible: false })
    b.activity('Basteln', CAT_LS)
    const hits = p['LST-TREK-05'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([hike.iri, bike.iri])
    expect(msg(hits[0])).toBe('«Wanderung» hat 1 verantwortliche Person(en). Unterwegs sollten mindestens zwei Leitende dabei sein (Spitze und Schluss).')
  })
  it('2 responsibles -> none', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung', CAT_LS)
    a.responsibleIris = ['/api/camp_collaborations/cc1', '/api/camp_collaborations/cc2']
    expect(p['LST-TREK-05'](makeCtx(b.facts))).toEqual([])
  })
})
