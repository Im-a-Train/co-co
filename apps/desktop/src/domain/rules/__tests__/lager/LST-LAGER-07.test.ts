import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'

describe('LST-LAGER-07', () => {
  it('metadata: hint/heuristic', () => {
    expect(ruleMeta('LST-LAGER-07')).toMatchObject({ severity: 'hint', confidence: 'heuristic' })
  })
  it('«Bräteln» without safety text -> hint', () => {
    const b = new FactsBuilder()
    const a = b.activity('Bräteln', CAT_LA)
    const hits = p['LST-LAGER-07'](makeCtx(b.facts))
    expect(hits.map((h) => h.targets[0])).toEqual([a.iri])
    expect(msg(hits[0])).toBe('«Bräteln» arbeitet mit Feuer. Überlegungen zu Feuerstelle und Waldbrandgefahr fehlen.')
  })
  it('«Feuerverbot geprüft» -> none; Feuerwerk is not fire work', () => {
    const b = new FactsBuilder()
    b.activity('Bräteln', CAT_LA, { content: { safetyText: 'Feuerverbot geprüft' } })
    b.activity('Feuerwerk anschauen', CAT_LA)
    expect(p['LST-LAGER-07'](makeCtx(b.facts))).toEqual([])
  })
})
