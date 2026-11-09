import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'

describe('JS-PROG-01', () => {
  it('is must/verified with scope day', () => {
    expect(ruleMeta('JS-PROG-01')).toMatchObject({ severity: 'must', confidence: 'verified', scope: 'day' })
  })
  it('fires for an empty day 3 only', () => {
    const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
    for (const d of [1, 2, 4, 5]) b.entry(b.activity(`A${d}`, CAT_LS), d, '09:00', '11:00')
    const hits = p['JS-PROG-01'](makeCtx(b.facts))
    expect(hits.map((h) => h.targets[0])).toEqual([b.dayIri(3)])
    expect(msg(hits[0])).toContain('14.07.2031')
  })
  it('is silent when every day has an entry', () => {
    const b = new FactsBuilder({ days: 3 })
    for (const d of [1, 2, 3]) b.entry(b.activity(`A${d}`, CAT_LS), d, '09:00', '11:00')
    expect(p['JS-PROG-01'](makeCtx(b.facts))).toEqual([])
  })
})

describe('JS-PROG-02', () => {
  it('is hint/heuristic', () => {
    expect(ruleMeta('JS-PROG-02')).toMatchObject({ severity: 'hint', confidence: 'heuristic' })
  })
  it('fires for a day with only «Geländespiel», not for a day with «Zmittag» or an empty day', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Geländespiel', CAT_LS), 1, '09:00', '11:00')
    b.entry(b.activity('Zmittag', CAT_LS), 2, '12:00', '13:00')
    // day 3 stays empty (reported by JS-PROG-01)
    const hits = p['JS-PROG-02'](makeCtx(b.facts))
    expect(hits.map((h) => h.targets[0])).toEqual([b.dayIri(1)])
    expect(msg(hits[0])).toContain('keine Fixpunkte')
  })
})
