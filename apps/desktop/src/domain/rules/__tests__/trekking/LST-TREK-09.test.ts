import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'

const region = (r: 'mittelland' | 'jura' | 'voralpen' | 'alpen' | 'ausland' | null, abroad: boolean | null = null) => ({
  camp: { region: r, campForm: null, winterSafeAccess: null, abroad },
})

describe('LST-TREK-09', () => {
  it('metadata: should/heuristic', () => {
    expect(ruleMeta('LST-TREK-09')).toMatchObject({ severity: 'should', confidence: 'heuristic' })
  })
  it('alpen without reko -> should', () => {
    const b = new FactsBuilder()
    b.activity('Wanderung', CAT_LS)
    const hits = p['LST-TREK-09'](makeCtx(b.facts, { campConfig: region('alpen') }))
    expect(hits).toHaveLength(1)
    expect(hits[0].variant).toBeUndefined()
    expect(msg(hits[0])).toBe(
      'Für «Wanderung» ist keine Rekognoszierung festgehalten. Wanderungen in alpinen und voralpinen Gebieten, im Jura und im Ausland müssen rekognosziert werden.',
    )
  })
  it('jura, voralpen and abroad are strict too', () => {
    const b = new FactsBuilder()
    b.activity('Wanderung', CAT_LS)
    for (const cfg of [region('jura'), region('voralpen'), region('mittelland', true)]) {
      expect(p['LST-TREK-09'](makeCtx(b.facts, { campConfig: cfg }))[0].severity).toBeUndefined()
    }
  })
  it('mittelland or unset region -> hint (variant soll)', () => {
    const b = new FactsBuilder()
    b.activity('Wanderung', CAT_LS)
    for (const cfg of [region('mittelland'), region(null)]) {
      const hits = p['LST-TREK-09'](makeCtx(b.facts, { campConfig: cfg }))
      expect(hits[0]).toMatchObject({ variant: 'soll', severity: 'hint' })
      expect(msg(hits[0])).toBe('Für «Wanderung» ist keine Rekognoszierung festgehalten. Alle Wanderungen sollen vor dem Lager rekognosziert werden.')
    }
  })
  it('«Route am 12.5. rekognosziert» -> none', () => {
    const b = new FactsBuilder()
    b.activity('Wanderung', CAT_LS, { content: { notesText: 'Route am 12.5. rekognosziert' } })
    expect(p['LST-TREK-09'](makeCtx(b.facts, { campConfig: region('alpen') }))).toEqual([])
  })
  it('only for hikes / Unternehmungen', () => {
    const b = new FactsBuilder()
    b.activity('Basteln', CAT_LS)
    expect(p['LST-TREK-09'](makeCtx(b.facts, { campConfig: region('alpen') }))).toEqual([])
  })
})
