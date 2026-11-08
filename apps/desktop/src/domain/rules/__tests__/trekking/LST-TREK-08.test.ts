import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'
import { ids } from './helpers'

describe('LST-TREK-08', () => {
  it('metadata: should/heuristic', () => {
    expect(ruleMeta('LST-TREK-08')).toMatchObject({ severity: 'should', confidence: 'heuristic' })
  })
  it('«Velotour» without «Helm» -> should', () => {
    const b = new FactsBuilder()
    const a = b.activity('Velotour', CAT_LS)
    const hits = p['LST-TREK-08'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([a.iri])
    expect(msg(hits[0])).toBe(
      'Für «Velotour» fehlen: Helmkontrolle, Instruktion Fahr- und Bremstechnik (Helmkontrolle, Instruktion Fahr- und Bremstechnik, bei Inline-Skates Schutzausrüstung).',
    )
  })
  it('«Helm, Bremstechnik instruiert» -> none', () => {
    const b = new FactsBuilder()
    b.activity('Velotour', CAT_LS, { content: { safetyText: 'Helm kontrolliert, Bremstechnik instruiert' } })
    expect(p['LST-TREK-08'](makeCtx(b.facts))).toEqual([])
  })
  it('inline skates additionally need protective gear', () => {
    const b = new FactsBuilder()
    const a = b.activity('Inline-Skating', CAT_LS, { content: { safetyText: 'Helm, Instruktion Fahrtechnik' } })
    const hits = p['LST-TREK-08'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([a.iri])
    expect(msg(hits[0])).toContain('fehlen: Schutzausrüstung (')
    a.content.safetyText += ', Handgelenkschoner'
    expect(p['LST-TREK-08'](makeCtx(b.facts))).toEqual([])
  })
  it('«Trottinett-Abfahrt» is a bike activity too; the material list counts', () => {
    const b = new FactsBuilder()
    const a = b.activity('Trottinett-Abfahrt', CAT_LS, { content: { materialText: 'Helme' } })
    expect(msg(p['LST-TREK-08'](makeCtx(b.facts))[0])).toContain('fehlen: Instruktion Fahr- und Bremstechnik (')
    expect(a.iri).toBeTruthy()
  })
})
