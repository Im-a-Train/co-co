import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'

describe('LST-LAGER-05', () => {
  it('metadata: hint/best-practice', () => {
    expect(ruleMeta('LST-LAGER-05')).toMatchObject({ severity: 'hint', confidence: 'best-practice' })
  })
  it('day 1 only «Anreise» -> hint', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Anreise', CAT_LA), 1, '14:00', '16:00')
    const hits = p['LST-LAGER-05'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toBe('Am ersten Lagertag ist kein Programmpunkt zu Lagerregeln oder Sicherheit erkennbar.')
  })
  it('«Begrüssung und Lagerregeln» -> none; so does a mention in the storyboard', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Begrüssung und Lagerregeln', CAT_LA), 1, '16:00', '17:00')
    expect(p['LST-LAGER-05'](makeCtx(b.facts))).toEqual([])
    const c = new FactsBuilder({ days: 3 })
    c.entry(c.activity('Ankommen', CAT_LA, { content: { storyboardText: 'Sicherheit und Notfall besprechen' } }), 1, '16:00', '17:00')
    expect(p['LST-LAGER-05'](makeCtx(c.facts))).toEqual([])
  })
  it('a Begrüssung on day 2 does not count', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Anreise', CAT_LA), 1, '14:00', '16:00')
    b.entry(b.activity('Lagerregeln', CAT_LA), 2, '09:00', '10:00')
    expect(p['LST-LAGER-05'](makeCtx(b.facts))).toHaveLength(1)
  })
})
