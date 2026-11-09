import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'
import { ids } from './helpers'

describe('LST-LAGER-04', () => {
  it('metadata: hint/best-practice', () => {
    expect(ruleMeta('LST-LAGER-04')).toMatchObject({ severity: 'hint', confidence: 'best-practice' })
  })
  it('flags every day but the last without a Leiterhöck', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Leiterhöck 21:30', CAT_LA), 1, '21:30', '22:30')
    const hits = p['LST-LAGER-04'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([b.dayIri(2)])
    expect(msg(hits[0])).toBe(`Am ${b.dateOf(2).split('-').reverse().join('.')} ist kein Leiterhöck / Tagesrückblick im Programm.`)
  })
  it('none when every day but the last has one', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Leiterhöck', CAT_LA), 1, '21:30', '22:00')
    b.entry(b.activity('Tagesrückblick', CAT_LA), 2, '21:30', '22:00')
    expect(p['LST-LAGER-04'](makeCtx(b.facts))).toEqual([])
  })
})
