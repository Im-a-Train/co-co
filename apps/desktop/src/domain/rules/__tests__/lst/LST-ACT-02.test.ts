import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { ids, Y2027 } from './helpers'

describe('LST-ACT-02', () => {
  it('«Pio-Workshop» alone -> hint', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    const a = b.activity('Pio-Workshop', CAT_LS)
    b.entry(a, 2, '14:00', '16:00')
    b.entry(b.activity('Ruhe', CAT_LS), 2, '17:00', '18:00')
    const hits = p['LST-ACT-02'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([a.iri])
    expect(msg(hits[0])).toContain('scheint sich nur an einen Teil der Gruppe zu richten («pio»)')
  })
  it('«Pio-Workshop» in parallel with «Wölfe-Postenlauf» -> none', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    b.entry(b.activity('Pio-Workshop', CAT_LS), 2, '14:00', '16:00')
    b.entry(b.activity('Wölfe-Postenlauf', CAT_LS), 2, '14:30', '16:30')
    expect(p['LST-ACT-02'](makeCtx(b.facts))).toEqual([])
  })
  it('an overlap shorter than 30 minutes does not count as parallel', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    b.entry(b.activity('Pio-Workshop', CAT_LS), 2, '14:00', '16:00')
    b.entry(b.activity('Postenlauf', CAT_LS), 2, '15:45', '17:00')
    expect(p['LST-ACT-02'](makeCtx(b.facts))).toHaveLength(1)
  })
  it('titles without subgroup keyword and no mapping -> none', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    b.entry(b.activity('Postenlauf', CAT_LS), 2, '14:00', '16:00')
    expect(p['LST-ACT-02'](makeCtx(b.facts))).toEqual([])
    const c = new FactsBuilder({ start: Y2027, days: 4 })
    c.entry(c.activity('Pio-Workshop', CAT_LS), 2, '14:00', '16:00')
    expect(p['LST-ACT-02'](makeCtx(c.facts, { mapping: null }))).toEqual([])
  })
})
