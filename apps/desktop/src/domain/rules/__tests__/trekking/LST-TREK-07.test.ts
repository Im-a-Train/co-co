import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, msg, ruleMeta } from '../factory'
import { ids } from './helpers'

describe('LST-TREK-07', () => {
  it('metadata: hint/unverified', () => {
    expect(ruleMeta('LST-TREK-07')).toMatchObject({ severity: 'hint', confidence: 'unverified' })
  })
  it('Wölfe biwak -> hint', () => {
    const b = new FactsBuilder()
    const a = b.activity('Biwak im Wald', CAT_LS)
    const hits = p['LST-TREK-07'](makeCtx(b.facts, { coachInputs: makeCoachInputs({ stufe: 'woelfe' }) }))
    expect(ids(hits)).toEqual([a.iri])
    expect(msg(hits[0])).toBe('«Biwak im Wald» ist ein Biwak/Zelttrekking. Biwaks eignen sich primär für Jugendliche.')
  })
  it('Pios -> none; no Stufe known -> none', () => {
    const b = new FactsBuilder()
    b.activity('Biwak', CAT_LS)
    expect(p['LST-TREK-07'](makeCtx(b.facts, { coachInputs: makeCoachInputs({ stufe: 'pios' }) }))).toEqual([])
    expect(p['LST-TREK-07'](makeCtx(b.facts))).toEqual([])
  })
})
