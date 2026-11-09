import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, msg, ruleMeta } from '../factory'
import { gpx, gpxDoc } from './helpers'

function camp(km: number, extra: { ascent?: number; descent?: number } = {}) {
  const b = new FactsBuilder()
  const a = b.activity('Wanderung', CAT_LS)
  b.entry(a, 2, '08:00', '12:00') // 240 min
  return { b, a, doc: gpxDoc(a, gpx(km, extra.ascent, extra.descent)) }
}

describe('LST-TREK-02', () => {
  it('metadata: should/heuristic, replaces SAFE-MTN-02', () => {
    const m = ruleMeta('LST-TREK-02')
    expect(m).toMatchObject({ severity: 'should', confidence: 'heuristic' })
    expect(m.formerIds).toContain('SAFE-MTN-02')
  })
  it('16 Lkm with Wölfe in a 4 h slot -> should, default values lower the confidence to unverified', () => {
    const { b, a, doc } = camp(16)
    const hits = p['LST-TREK-02'](makeCtx(b.facts, { documents: [doc], coachInputs: makeCoachInputs({ stufe: 'woelfe' }) }))
    expect(hits).toHaveLength(1)
    expect(hits[0].targets).toEqual([a.iri, 'g1'])
    expect(hits[0].confidence).toBe('unverified')
    // 16 Lkm at 3 Lkm/h = 320 min + 10 min per hour = 373 min
    expect(msg(hits[0])).toBe('Geschätzte Marschzeit von «Wanderung» 6 h 13 min (inkl. Pausen) passt nicht ins Programmfenster von 4 h 00 min.')
  })
  it('all used values coach-overridden -> confidence stays heuristic', () => {
    const { b, doc } = camp(16)
    const hits = p['LST-TREK-02'](
      makeCtx(b.facts, {
        documents: [doc],
        coachInputs: makeCoachInputs({ stufe: 'woelfe' }),
        paramValues: { 'lst.paceKidsLkmPerHour': 3, 'lst.descentHmPerLkm': 150, 'lst.pauseMinutesPerHour': 10 },
      }),
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].confidence).toBeUndefined()
  })
  it('a pace set in settings.gpx counts as coach override', () => {
    const { b, doc } = camp(16)
    const settings = { ...DEFAULT_APP_SETTINGS, gpx: { ...DEFAULT_APP_SETTINGS.gpx, paceLkmPerHour: 3 } }
    const hits = p['LST-TREK-02'](
      makeCtx(b.facts, { documents: [doc], settings, paramValues: { 'lst.descentHmPerLkm': 150, 'lst.pauseMinutesPerHour': 10 } }),
    )
    expect(hits).toHaveLength(1) // 16 Lkm at 3 = 320 min + 53 min
    expect(hits[0].confidence).toBeUndefined()
  })
  it('8 Lkm -> none', () => {
    const { b, doc } = camp(8)
    expect(p['LST-TREK-02'](makeCtx(b.facts, { documents: [doc], coachInputs: makeCoachInputs({ stufe: 'pfadi' }) }))).toEqual([])
  })
  it('descent counts via lst.descentHmPerLkm', () => {
    const { b, doc } = camp(10, { descent: 1500 }) // 10 + 10 = 20 Lkm at 4 = 300 + 50 = 350
    expect(p['LST-TREK-02'](makeCtx(b.facts, { documents: [doc] }))).toHaveLength(1)
    const flat = camp(10)
    expect(p['LST-TREK-02'](makeCtx(flat.b.facts, { documents: [flat.doc] }))).toEqual([])
  })
  it('silent without GPX or without schedule entry', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung', CAT_LS)
    expect(p['LST-TREK-02'](makeCtx(b.facts, { documents: [gpxDoc(a, gpx(30))] }))).toEqual([])
  })
})
