import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCtx, makeDoc, msg, ruleMeta } from '../factory'

describe('LST-LAGER-03', () => {
  const f = new FactsBuilder().facts
  const full = 'Sicherheit geht vor, kein Feuer ohne Leitung. Alkohol und Tabak sind verboten. Respekt gegenüber allen. Handy abgeben. Abfall trennen.'
  it('metadata: hint/unverified', () => {
    expect(ruleMeta('LST-LAGER-03')).toMatchObject({ severity: 'hint', confidence: 'unverified' })
  })
  it('rules without Handy -> hint', () => {
    const doc = makeDoc({ id: 'r', name: 'Lagerregeln.pdf', text: full.replace('Handy abgeben. ', '') })
    const hits = p['LST-LAGER-03'](makeCtx(f, { documents: [doc] }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toBe('In den Lagerregeln fehlt ein Bezug zu: Handy und Elektronik.')
  })
  it('all five groups -> none', () => {
    expect(p['LST-LAGER-03'](makeCtx(f, { documents: [makeDoc({ name: 'Lagerregeln.pdf', text: full })] }))).toEqual([])
  })
  it('silent without a Lagerregeln document', () => {
    expect(p['LST-LAGER-03'](makeCtx(f, { documents: [makeDoc({ name: 'x.pdf', text: 'nichts' })] }))).toEqual([])
  })
})
