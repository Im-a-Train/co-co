import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'
import { ids } from './helpers'

describe('LST-TREK-06', () => {
  it('metadata: should/heuristic', () => {
    expect(ruleMeta('LST-TREK-06')).toMatchObject({ severity: 'should', confidence: 'heuristic' })
  })
  it('hike material without a Rettungsdecke -> should', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung', CAT_LS, { content: { materialText: 'Apotheke, Natel, Znüni' } })
    const hits = p['LST-TREK-06'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([a.iri])
    expect(msg(hits[0])).toBe(
      'Im Material/Sicherheitsteil von «Wanderung» fehlt: Rettungsdecke oder Biwaksack (Notfallapotheke, Rettungsdecke oder Biwaksack, Alarmierungsmittel).',
    )
  })
  it('«Apotheke, Biwaksack, Natel» -> none; safety text counts too', () => {
    const b = new FactsBuilder()
    b.activity('Wanderung', CAT_LS, { content: { materialText: 'Apotheke, Biwaksack, Natel' } })
    b.activity('Biwak', CAT_LS, { content: { materialText: 'Apotheke', safetyText: 'Rettungsdecke und Mobiltelefon dabei' } })
    expect(p['LST-TREK-06'](makeCtx(b.facts))).toEqual([])
  })
  it('applies to tag unternehmung, not to indoor activities or supervised baths', () => {
    const b = new FactsBuilder()
    const t = b.activity('Ausflug', CAT_LS)
    b.activity('Basteln', CAT_LS)
    b.activity('Hallenbad', CAT_LS)
    const hits = p['LST-TREK-06'](makeCtx(b.facts, { campConfig: { activityTags: { [t.iri]: ['unternehmung'] } } }))
    expect(ids(hits)).toEqual([t.iri])
  })
})
