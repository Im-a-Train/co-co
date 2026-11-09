import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'

describe('LST-LAGER-06', () => {
  it('metadata: hint/unverified', () => {
    expect(ruleMeta('LST-LAGER-06')).toMatchObject({ severity: 'hint', confidence: 'unverified', scope: 'scheduleEntry' })
  })
  it('«Abbau» 22:30-23:30 -> hint', () => {
    const b = new FactsBuilder({ days: 3 })
    const e = b.entry(b.activity('Abbau', CAT_LA), 2, '22:30', '23:30')
    const hits = p['LST-LAGER-06'](makeCtx(b.facts))
    expect(hits.map((h) => h.targets[0])).toEqual([e.iri])
    expect(msg(hits[0])).toBe('«Abbau» (Auf-/Abbau) liegt zwischen 22:30 und 23:30.')
  })
  it('early morning (before 07:00) is quiet time too', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Lageraufbau', CAT_LA), 2, '06:00', '08:00')
    expect(p['LST-LAGER-06'](makeCtx(b.facts))).toHaveLength(1)
  })
  it('«Abbau» at 14:00 -> none; other activities at night are ignored', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Abbau', CAT_LA), 2, '14:00', '16:00')
    b.entry(b.activity('Nachtwanderung', CAT_LA), 2, '22:30', '23:30')
    expect(p['LST-LAGER-06'](makeCtx(b.facts))).toEqual([])
  })
})
