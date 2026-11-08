import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeMidata, msg, ruleMeta } from '../factory'
import { gpx, gpxDoc } from './helpers'

function camp(km: number) {
  const b = new FactsBuilder()
  const a = b.activity('Wanderung', CAT_LS)
  return { b, doc: gpxDoc(a, gpx(km)) }
}

describe('LST-TREK-03', () => {
  it('metadata: hint/unverified', () => {
    expect(ruleMeta('LST-TREK-03')).toMatchObject({ severity: 'hint', confidence: 'unverified' })
  })
  it('4 h with Wölfe -> hint', () => {
    const { b, doc } = camp(12) // 12 Lkm at 3 Lkm/h = 240 min
    const hits = p['LST-TREK-03'](makeCtx(b.facts, { documents: [doc], coachInputs: makeCoachInputs({ stufe: 'woelfe' }) }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toBe('Geschätzte Marschzeit von «Wanderung» 4 h. Mit Kindern sollte die effektive Wanderzeit 3 h nicht überschreiten.')
  })
  it('Pfadi -> none', () => {
    const { b, doc } = camp(12)
    expect(p['LST-TREK-03'](makeCtx(b.facts, { documents: [doc], coachInputs: makeCoachInputs({ stufe: 'pfadi' }) }))).toEqual([])
  })
  it('youngest Jahrgang < 10 from MiData counts as children (red input)', () => {
    const { b, doc } = camp(12)
    const midata = makeMidata({ participantsByBirthYear: { 2023: 3, 2018: 5 } }) // camp 2031 -> youngest 8
    const hits = p['LST-TREK-03'](makeCtx(b.facts, { documents: [doc], midata }))
    expect(hits).toHaveLength(1)
    expect(hits[0].redKeys).toEqual(['youngestAge'])
    const older = makeMidata({ participantsByBirthYear: { 2018: 5 } }) // youngest 13
    expect(p['LST-TREK-03'](makeCtx(b.facts, { documents: [doc], midata: older }))).toEqual([])
  })
  it('a short route with Wölfe -> none', () => {
    const { b, doc } = camp(6)
    expect(p['LST-TREK-03'](makeCtx(b.facts, { documents: [doc], coachInputs: makeCoachInputs({ stufe: 'woelfe' }) }))).toEqual([])
  })
})
