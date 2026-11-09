import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, makeDoc, msg, ruleMeta } from '../factory'
import { ALL_CHECKS, docCheck } from './helpers'

function completeDossier() {
  const b = new FactsBuilder({ days: 3 })
  b.entry(b.activity('Basteln', CAT_LS), 2, '09:00', '11:00')
  const documents = [
    makeDoc({ id: 'k', name: 'Sicherheitskonzept.pdf', docCheck: docCheck(ALL_CHECKS) }),
    makeDoc({ id: 'r', name: 'Lagerregeln.pdf' }),
    makeDoc({ id: 'i', name: 'Lagerinfo.pdf' }),
  ]
  return { b, documents }
}

describe('LST-LAGER-02', () => {
  it('metadata: hint/unverified', () => {
    expect(ruleMeta('LST-LAGER-02')).toMatchObject({ severity: 'hint', confidence: 'unverified', module: 'lst-lager' })
  })
  it('no Lagerregeln document -> hint naming it', () => {
    const { b, documents } = completeDossier()
    const hits = p['LST-LAGER-02'](makeCtx(b.facts, { documents: documents.filter((d) => d.id !== 'r') }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toBe('Im Lagerdossier fehlen voraussichtlich: Lagerregeln.')
  })
  it('lists every missing part', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Wanderung', CAT_LS, { content: { hasStoryboard: false, storyboardText: '' } }), 2, '09:00', '12:00')
    const hits = p['LST-LAGER-02'](makeCtx(b.facts))
    expect(msg(hits[0])).toBe(
      'Im Lagerdossier fehlen voraussichtlich: Detailprogramm, Routenplanung, Sicherheitskonzept, Lagerregeln, TN-Information, Schlechtwetterprogramm.',
    )
  })
  it('all parts present -> none', () => {
    const { b, documents } = completeDossier()
    expect(p['LST-LAGER-02'](makeCtx(b.facts, { documents }))).toEqual([])
  })
})
