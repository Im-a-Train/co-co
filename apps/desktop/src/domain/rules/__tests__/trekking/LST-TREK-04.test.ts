import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'
import { ids } from './helpers'

describe('LST-TREK-04', () => {
  it('metadata: should/unverified', () => {
    expect(ruleMeta('LST-TREK-04')).toMatchObject({ severity: 'should', confidence: 'unverified' })
  })
  it('hike without Umkehrzeit -> should', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung zum Säntis', CAT_LS)
    const hits = p['LST-TREK-04'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([a.iri])
    expect(hits[0].severity).toBeUndefined()
    expect(msg(hits[0])).toBe('Für «Wanderung zum Säntis» sind keine Umkehrzeit bzw. Abbruch- und Ausweichkriterien festgehalten.')
  })
  it('raft, winter and rope activities -> hint', () => {
    const b = new FactsBuilder()
    b.activity('Raftingtour', CAT_LS)
    b.activity('Schlitteln', CAT_LS)
    b.activity('Seilbrücke', CAT_LS)
    const hits = p['LST-TREK-04'](makeCtx(b.facts))
    expect(hits).toHaveLength(3)
    expect(hits.every((h) => h.severity === 'hint')).toBe(true)
  })
  it('supervised baths are not water here', () => {
    const b = new FactsBuilder()
    b.activity('Hallenbad Besuch', CAT_LS)
    expect(p['LST-TREK-04'](makeCtx(b.facts))).toEqual([])
  })
  it('«Umkehrzeit 14:00» in the safety text -> none', () => {
    const b = new FactsBuilder()
    b.activity('Wanderung', CAT_LS, { content: { safetyText: 'Umkehrzeit 14:00 bei Gewitter' } })
    b.activity('Gipfeltour', CAT_LS, { content: { safetyText: 'Abbruch bei Nebel, Ausweichroute via Hütte' } })
    expect(p['LST-TREK-04'](makeCtx(b.facts))).toEqual([])
  })
  it('coach tag sb-berg counts as mountain (should), sb-wasser as water (hint)', () => {
    const b = new FactsBuilder()
    const t1 = b.activity('Tour A', CAT_LS)
    const t2 = b.activity('Tour B', CAT_LS)
    const hits = p['LST-TREK-04'](makeCtx(b.facts, { campConfig: { activityTags: { [t1.iri]: ['sb-berg'], [t2.iri]: ['sb-wasser'] } } }))
    expect(hits.map((h) => h.severity)).toEqual([undefined, 'hint'])
  })
})
