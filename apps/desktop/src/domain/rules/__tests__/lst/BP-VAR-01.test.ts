import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, CAT_LS, FactsBuilder, makeCtx } from '../factory'

const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`

describe('BP-VAR-01', () => {
  it('flags many J+S units of a single category (params lst.varMinUnits / varMinDistinct)', () => {
    const b = new FactsBuilder({ days: 3 })
    for (let i = 0; i < 4; i++) b.entry(b.activity(`LS ${i}`, CAT_LS), 2, hhmm(8 + i * 2), hhmm(9 + i * 2))
    expect(p['BP-VAR-01'](makeCtx(b.facts))).toHaveLength(1)
    b.entry(b.activity('LA', CAT_LA), 3, '09:00', '10:00')
    expect(p['BP-VAR-01'](makeCtx(b.facts))).toEqual([])
  })
  it('counts YS characteristics as variety and ignores small camps', () => {
    const b = new FactsBuilder({ days: 3 })
    ;[['kraft'], ['ausdauer'], [], []].forEach((c, i) =>
      b.entry(b.activity(`LS ${i}`, CAT_LS, { content: { ysCharacteristics: c } }), 2, hhmm(8 + i * 2), hhmm(9 + i * 2)),
    )
    expect(p['BP-VAR-01'](makeCtx(b.facts))).toEqual([])
    const few = new FactsBuilder({ days: 3 })
    few.entry(few.activity('x', CAT_LS), 2, '09:00', '10:00')
    expect(p['BP-VAR-01'](makeCtx(few.facts))).toEqual([])
  })
  it('is silent without mapping', () => {
    const b = new FactsBuilder({ days: 3 })
    for (let i = 0; i < 4; i++) b.entry(b.activity(`LS ${i}`, CAT_LS), 2, hhmm(8 + i * 2), hhmm(9 + i * 2))
    expect(p['BP-VAR-01'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
