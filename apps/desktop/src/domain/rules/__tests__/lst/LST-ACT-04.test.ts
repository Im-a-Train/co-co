import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { ids } from './helpers'

describe('LST-ACT-04', () => {
  it('outdoor activity without location and weather variant -> hint listing both', () => {
    const b = new FactsBuilder()
    const a = b.activity('Geländespiel im Wald', CAT_LS, { content: { materialText: 'Bälle', safetyText: 'Erste Hilfe' } })
    const hits = p['LST-ACT-04'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([a.iri])
    const text = msg(hits[0])
    expect(text).toBe('Bei «Geländespiel im Wald» fehlen Rubriken der Detailplanung: Ort, Schlechtwettervariante.')
  })
  it('all rubrics present -> none', () => {
    const b = new FactsBuilder()
    b.activity('Geländespiel im Wald', CAT_LS, {
      location: 'Waldrand',
      content: { materialText: 'Bälle', safetyText: 'Erste Hilfe', storyboardText: 'Einstimmen. Bei Regen: Turnhalle.' },
    })
    expect(p['LST-ACT-04'](makeCtx(b.facts))).toEqual([])
  })
  it('the weather variant is only required for outdoor activities', () => {
    const b = new FactsBuilder()
    const a = b.activity('Basteln', CAT_LS, { location: 'Saal', content: { materialText: 'Schere', safetyText: 'Keine Besonderheiten' } })
    expect(p['LST-ACT-04'](makeCtx(b.facts))).toEqual([])
    a.content.materialText = ''
    expect(msg(p['LST-ACT-04'](makeCtx(b.facts))[0])).toContain('fehlen Rubriken der Detailplanung: Material.')
  })
  it('missing safety text is listed; non-J+S activities and no mapping -> none', () => {
    const b = new FactsBuilder()
    b.activity('Basteln', CAT_LS, { location: 'Saal', content: { materialText: 'Schere' } })
    b.activity('Essen', CAT_ES)
    expect(msg(p['LST-ACT-04'](makeCtx(b.facts))[0])).toContain('Sicherheitsüberlegungen')
    expect(p['LST-ACT-04'](makeCtx(b.facts))).toHaveLength(1)
    expect(p['LST-ACT-04'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
