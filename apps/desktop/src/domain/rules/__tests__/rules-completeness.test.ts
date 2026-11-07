import { describe, expect, it } from 'vitest'
import { predicates as p } from '../packs/basis/predicates'
import { coachNameMatches } from '../packs/basis/predicates/completeness'
import { CAT_ES, CAT_LA, CAT_LS, FactsBuilder, makeCtx, mappingOf } from './factory'

const ids = (hits: { targets: string[] }[]) => hits.map((h) => h.targets.join('|'))

describe('CMP-ACT-01', () => {
  it('flags activities without responsibles', () => {
    const b = new FactsBuilder()
    b.activity('Mit', CAT_LS)
    const bad = b.activity('Ohne', CAT_LS, { responsible: false })
    expect(ids(p['CMP-ACT-01'](makeCtx(b.facts)))).toEqual([bad.iri])
  })
})

describe('CMP-ACT-02', () => {
  it('flags LS/LA activities without storyboard content only', () => {
    const b = new FactsBuilder()
    const bad = b.activity('LS leer', CAT_LS, { content: { hasStoryboard: false, storyboardText: '' } })
    const blank = b.activity('LA blank', CAT_LA, { content: { hasStoryboard: true, storyboardText: '  ' } })
    b.activity('Essen leer', CAT_ES, { content: { hasStoryboard: false, storyboardText: '' } })
    b.activity('LS voll', CAT_LS)
    expect(ids(p['CMP-ACT-02'](makeCtx(b.facts)))).toEqual([bad.iri, blank.iri])
    expect(p['CMP-ACT-02'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})

describe('CMP-ACT-03', () => {
  it('flags LS and outdoor activities without safety text', () => {
    const b = new FactsBuilder()
    const ls = b.activity('Turnen', CAT_LS)
    const outdoor = b.activity('Geländespiel im Wald', CAT_LA)
    b.activity('Basteln', CAT_LA)
    b.activity('Wald mit Sicherheit', CAT_LA, { content: { safetyText: 'Erste Hilfe dabei', hasSafetyConsiderations: true } })
    expect(ids(p['CMP-ACT-03'](makeCtx(b.facts)))).toEqual([ls.iri, outdoor.iri])
  })
})

describe('CMP-LA-01', () => {
  it('flags LA without thematic area', () => {
    const b = new FactsBuilder()
    const bad = b.activity('LA ohne', CAT_LA)
    b.activity('LA mit', CAT_LA, { content: { laThematicAreas: ['umwelt'] } })
    b.activity('LS', CAT_LS)
    expect(ids(p['CMP-LA-01'](makeCtx(b.facts)))).toEqual([bad.iri])
  })
})

describe('CMP-DAY-01', () => {
  it('flags days without day responsible', () => {
    const b = new FactsBuilder({ days: 3 }).dayResponsible(1).dayResponsible(3)
    expect(ids(p['CMP-DAY-01'](makeCtx(b.facts)))).toEqual([b.dayIri(2)])
  })
})

describe('CMP-CAMP-01', () => {
  it('flags empty coach name', () => {
    const f = new FactsBuilder({ coachName: null }).facts
    expect(p['CMP-CAMP-01'](makeCtx(f))).toHaveLength(1)
    expect(p['CMP-CAMP-01'](makeCtx(new FactsBuilder({ coachName: '  ' }).facts))).toHaveLength(1)
  })
  it('compares with the user name by name token', () => {
    const f = new FactsBuilder({ coachName: 'Max Muster' }).facts
    expect(p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Muster Max' }))).toEqual([])
    expect(p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Erika Beispiel' }))).toHaveLength(1)
    expect(p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: null }))).toEqual([])
    expect(coachNameMatches('Hawk', 'Hawk (Max Muster)')).toBe(true)
  })
})

describe('CMP-PROG-01', () => {
  const build = () => {
    const b = new FactsBuilder({ start: '2031-07-12' })
    b.facts.progressLabels = [
      { iri: '/pl/1', title: 'Idee', position: 1 },
      { iri: '/pl/2', title: 'Fertig', position: 2 },
    ]
    b.activity('Fertig', CAT_LS, { progress: '/pl/2' })
    b.activity('Idee', CAT_LS, { progress: '/pl/1' })
    b.activity('Kein', CAT_LS, { progress: null })
    return b
  }
  it('aggregates activities behind the highest label from T-21', () => {
    const b = build()
    const hits = p['CMP-PROG-01'](makeCtx(b.facts, { now: new Date('2031-06-21T00:00:00Z') }))
    expect(hits).toHaveLength(1)
    expect(hits[0].params).toMatchObject({ count: 2, label: 'Fertig', days: 21 })
    expect(hits[0].evidence).toHaveLength(2)
  })
  it('is silent before T-21 and without progress labels', () => {
    const b = build()
    expect(p['CMP-PROG-01'](makeCtx(b.facts, { now: new Date('2031-06-20T00:00:00Z') }))).toEqual([])
    b.facts.progressLabels = []
    expect(p['CMP-PROG-01'](makeCtx(b.facts, { now: new Date('2031-07-01T00:00:00Z') }))).toEqual([])
  })
})

describe('mapping variants', () => {
  it('completeness rules respect a custom mapping', () => {
    const b = new FactsBuilder()
    const a = b.activity('X', '/api/categories/custom', { content: { hasStoryboard: false, storyboardText: '' } })
    expect(p['CMP-ACT-02'](makeCtx(b.facts, { mapping: mappingOf({ '/api/categories/custom': 'LA' }) }))).toHaveLength(1)
    expect(p['CMP-ACT-02'](makeCtx(b.facts, { mapping: mappingOf({ '/api/categories/custom': 'ES' }) }))).toEqual([])
    expect(a.iri).toBeTruthy()
  })
})
