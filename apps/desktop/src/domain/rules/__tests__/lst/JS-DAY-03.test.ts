import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx } from '../factory'
import { ids, Y2026 } from './helpers'

describe('JS-DAY-03', () => {
  it('flags days with Sozialzeit gaps under 30 minutes (one hit per day)', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '11:20', '12:00')
    b.entry(b.activity('c', CAT_LS), 2, '12:10', '13:00')
    const hits = p['JS-DAY-03'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([b.dayIri(2)])
    expect(hits[0].params).toMatchObject({ count: 2, minutes: 10, min: 30 })
  })
  it('accepts exactly 30 minutes and parallel entries (no gap)', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '11:30', '13:00')
    b.entry(b.activity('c', CAT_LS), 2, '12:00', '14:00')
    expect(p['JS-DAY-03'](makeCtx(b.facts))).toEqual([])
  })
  it('is silent without mapping', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '11:10', '12:00')
    expect(p['JS-DAY-03'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
