/** Refined existing lst-lager rules: CMP-DAY-01, SAFE-ROPE-01, SAFE-NIGHT-01, SAFE-WX-01 (moved from rules-safety-bp / rules-completeness). */
import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, CAT_LS, FactsBuilder, makeCtx, makeDoc, msg, ruleMeta } from '../factory'
import { checkItems, ids } from './helpers'

describe('CMP-DAY-01', () => {
  it('metadata: hint/unverified in lst-lager (2014 source only)', () => {
    expect(ruleMeta('CMP-DAY-01')).toMatchObject({ severity: 'hint', confidence: 'unverified', module: 'lst-lager' })
  })
  it('flags days without day responsible', () => {
    const b = new FactsBuilder({ days: 3 }).dayResponsible(1).dayResponsible(3)
    expect(ids(p['CMP-DAY-01'](makeCtx(b.facts)))).toEqual([b.dayIri(2)])
  })
})

describe('SAFE-ROPE-01', () => {
  const long = 'Die Seilbrücke wird mit zwei Fixpunkten gebaut, Verankerung an Bäumen mit Bandschlingen. ' + 'x'.repeat(150)
  it('metadata: should/heuristic', () => {
    expect(ruleMeta('SAFE-ROPE-01')).toMatchObject({ severity: 'should', confidence: 'heuristic' })
  })
  it('needs >= 200 chars mentioning sicherung/verankerung/bremse', () => {
    const b = new FactsBuilder()
    const short = b.activity('Seilbrücke', CAT_LS, { content: { safetyText: 'Verankerung prüfen' } })
    const noTopic = b.activity('Pioniertechnik', CAT_LS, { content: { safetyText: 'y'.repeat(250) } })
    b.activity('Abseilen', CAT_LS, { content: { safetyText: long } })
    b.activity('Seilziehen', CAT_LA)
    const hits = p['SAFE-ROPE-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([short.iri, noTopic.iri])
    expect(msg(hits[0])).toMatch(/zu kurz/)
    expect(msg(hits[1])).toMatch(/weder/)
  })
  it('detects the phrase «Flying Fox»; a Seilpark is an EBB B and not checked here', () => {
    const b = new FactsBuilder()
    const fox = b.activity('Flying Fox', CAT_LS)
    b.activity('Besuch im Seilpark', CAT_LS)
    expect(ids(p['SAFE-ROPE-01'](makeCtx(b.facts)))).toEqual([fox.iri])
  })
  it('the minimum length comes from lst.ropeMinSafetyChars', () => {
    const b = new FactsBuilder()
    b.activity('Seilbrücke', CAT_LS, { content: { safetyText: 'Verankerung an zwei Bäumen' } })
    expect(p['SAFE-ROPE-01'](makeCtx(b.facts, { paramValues: { 'lst.ropeMinSafetyChars': 20 } }))).toEqual([])
  })
})

describe('SAFE-NIGHT-01', () => {
  it('metadata: hint/heuristic', () => {
    expect(ruleMeta('SAFE-NIGHT-01')).toMatchObject({ severity: 'hint', confidence: 'heuristic' })
  })
  it('flags a late activity with short rest to the next morning', () => {
    const b = new FactsBuilder({ days: 3 })
    const night = b.activity('Lagerfeuer', CAT_LA, { content: { safetyText: 'Feuerwache' } })
    b.entry(night, 1, '20:00', '23:00')
    b.entry(b.activity('Frühsport', CAT_LS), 2, '07:00', '08:00') // rest 8h
    const hits = p['SAFE-NIGHT-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([night.iri])
    expect(msg(hits[0])).toMatch(/8 h 00 min/)
  })
  it('accepts 8.5h rest with safety text; flags missing safety text and nacht keyword', () => {
    const b = new FactsBuilder({ days: 3 })
    const ok = b.activity('Spätprogramm', CAT_LA, { content: { safetyText: 'ok' } })
    b.entry(ok, 1, '20:00', '22:30')
    b.entry(b.activity('Morgen', CAT_LS), 2, '07:00', '08:00') // 8.5h
    const kw = b.activity('Nachtwanderung', CAT_LA)
    b.entry(kw, 2, '19:00', '21:00')
    b.entry(b.activity('Später', CAT_LS), 3, '10:00', '11:00')
    const hits = p['SAFE-NIGHT-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([kw.iri])
    expect(msg(hits[0])).toMatch(/: keine Sicherheitsüberlegungen$/)
  })
  it('ignores Nachtessen', () => {
    const b = new FactsBuilder({ days: 2 })
    b.entry(b.activity('Nachtessen', CAT_LA), 1, '18:00', '19:00')
    expect(p['SAFE-NIGHT-01'](makeCtx(b.facts))).toEqual([])
  })
  it('the rest time comes from lst.minRestMinutes', () => {
    const b = new FactsBuilder({ days: 3 })
    const night = b.activity('Lagerfeuer', CAT_LA, { content: { safetyText: 'Feuerwache' } })
    b.entry(night, 1, '20:00', '23:00')
    b.entry(b.activity('Frühsport', CAT_LS), 2, '07:00', '08:00')
    expect(p['SAFE-NIGHT-01'](makeCtx(b.facts, { paramValues: { 'lst.minRestMinutes': 420 } }))).toEqual([])
  })
})

describe('SAFE-WX-01', () => {
  it('metadata: should/heuristic', () => {
    expect(ruleMeta('SAFE-WX-01')).toMatchObject({ severity: 'should', confidence: 'heuristic' })
  })
  it('flags outdoor days without a bad-weather variant', () => {
    const b = new FactsBuilder({ days: 3 })
    const a = b.activity('Wanderung zum Gipfel', CAT_LS)
    b.entry(a, 2, '09:00', '12:00')
    expect(ids(p['SAFE-WX-01'](makeCtx(b.facts)))).toEqual([b.dayIri(2)])
  })
  it('is satisfied by a mention in an activity or by a safety document', () => {
    const b = new FactsBuilder({ days: 3 })
    const a = b.activity('Wanderung', CAT_LS, { content: { storyboardText: 'Bei Schlechtwetter: Spiele im Haus' } })
    b.entry(a, 2, '09:00', '12:00')
    expect(p['SAFE-WX-01'](makeCtx(b.facts))).toEqual([])
    const c = new FactsBuilder({ days: 3 })
    c.entry(c.activity('Geländespiel', CAT_LS), 2, '09:00', '12:00')
    const doc = makeDoc({ docCheck: { items: checkItems(['badWeather']), complete: false, checkedAt: '' } })
    expect(p['SAFE-WX-01'](makeCtx(c.facts, { documents: [doc] }))).toEqual([])
  })
  it('ignores indoor days', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Basteln', CAT_LA), 2, '09:00', '12:00')
    expect(p['SAFE-WX-01'](makeCtx(b.facts))).toEqual([])
  })
})
