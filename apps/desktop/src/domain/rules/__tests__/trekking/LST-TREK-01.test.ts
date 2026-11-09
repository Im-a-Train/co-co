import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, makeDoc, msg, ruleMeta } from '../factory'
import { gpx, gpxDoc, ids } from './helpers'

describe('LST-TREK-01', () => {
  it('metadata: should/heuristic, replaces SAFE-MTN-01', () => {
    const m = ruleMeta('LST-TREK-01')
    expect(m).toMatchObject({ severity: 'should', confidence: 'heuristic', module: 'lst-trekking' })
    expect(m.formerIds).toContain('SAFE-MTN-01')
  })
  it('«Wanderung Rigi» with GPX only -> should, missing Alternativroute and Sicherheitskonzept', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung Rigi', CAT_LS)
    const hits = p['LST-TREK-01'](makeCtx(b.facts, { documents: [gpxDoc(a, gpx(10))] }))
    expect(ids(hits)).toEqual([a.iri])
    expect(msg(hits[0])).toBe(
      'Für «Wanderung Rigi» fehlen Unterlagen, die mit dem Lagerprogramm beim Coach einzureichen sind: Alternativroute, Sicherheitskonzept.',
    )
  })
  it('without anything all four parts are missing', () => {
    const b = new FactsBuilder()
    b.activity('Wanderung Rigi', CAT_LS)
    const hits = p['LST-TREK-01'](makeCtx(b.facts))
    expect(msg(hits[0])).toContain('Route / Kartenausschnitt, Alternativroute, Zeitberechnung, Sicherheitskonzept')
  })
  it('all four present -> none', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung Rigi', CAT_LS, {
      content: { notesText: 'Alternativroute via Tal', safetyText: 'Sicherheit: '.padEnd(160, 'x') },
    })
    expect(p['LST-TREK-01'](makeCtx(b.facts, { documents: [gpxDoc(a, gpx(10))] }))).toEqual([])
  })
  it('text mentions replace documents: Karte, Marschzeit, Alternativroute; linked PDF counts as concept', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung', CAT_LS, { content: { notesText: 'Karte 1:25000, Marschzeit 4 h, Alternativroute über Pass' } })
    const pdf = makeDoc({ id: 'p1', name: 'Planung.pdf', activityIris: [a.iri] })
    expect(p['LST-TREK-01'](makeCtx(b.facts, { documents: [pdf] }))).toEqual([])
  })
  it('the safety text minimum comes from lst.hikeSafetyMinChars', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung', CAT_LS, { content: { notesText: 'Karte, Marschzeit, Alternativroute', safetyText: 'Erste Hilfe dabei' } })
    expect(p['LST-TREK-01'](makeCtx(b.facts))).toHaveLength(1)
    expect(p['LST-TREK-01'](makeCtx(b.facts, { paramValues: { 'lst.hikeSafetyMinChars': 10 } }))).toEqual([])
    expect(a.iri).toBeTruthy()
  })
  it('tag unternehmung applies without keyword; keine-unternehmung exempts a keyword hit', () => {
    const b = new FactsBuilder()
    const tagged = b.activity('Tagesausflug', CAT_LS)
    const exempt = b.activity('Wanderung zum Spielplatz', CAT_LS)
    const hits = p['LST-TREK-01'](makeCtx(b.facts, { campConfig: { activityTags: { [tagged.iri]: ['unternehmung'], [exempt.iri]: ['keine-unternehmung'] } } }))
    expect(ids(hits)).toEqual([tagged.iri])
  })
})
