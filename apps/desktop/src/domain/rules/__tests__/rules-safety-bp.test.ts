import { describe, expect, it } from 'vitest'
import { predicates as p } from '../packs/basis/predicates'
import { hasKeyword, matchKeywords, MOUNTAIN, NIGHT, ROPE, WATER } from '../packs/basis/predicates/util'
import type { DocCheckItem, GpxStats, SafetyCheckKey } from '@/domain/types'
import { CAT_LA, CAT_LS, CAT_NONE, FactsBuilder, makeCoachInputs, makeCtx, makeDoc } from './factory'

const ids = (hits: { targets: string[] }[]) => hits.map((h) => h.targets.join('|'))

describe('keyword matcher', () => {
  it('matches German stems and compounds, honours exclusions', () => {
    expect(hasKeyword('Baden im Aaresee', WATER)).toBe(true)
    expect(hasKeyword('Kanufahrt auf der Aare', WATER)).toBe(true)
    expect(hasKeyword('Schlauchboot-Rennen', WATER)).toBe(true)
    expect(hasKeyword('Trinkwasser nachfüllen', WATER)).toBe(false)
    expect(hasKeyword('Seeland und Seelen', WATER)).toBe(false)
    expect(hasKeyword('Skills und Skizzen', MOUNTAIN)).toBe(false)
    expect(hasKeyword('Skitour am Pass', MOUNTAIN)).toBe(true)
    expect(hasKeyword('Passwort', MOUNTAIN)).toBe(false)
    expect(hasKeyword('Seilziehen', ROPE)).toBe(false)
    expect(hasKeyword('Seilbrücke bauen', ROPE)).toBe(true)
    expect(hasKeyword('Nachtessen', NIGHT)).toBe(false)
    expect(hasKeyword('Nachtwanderung', NIGHT)).toBe(true)
    expect(matchKeywords('Gipfelsturm', MOUNTAIN)).toEqual(['gipfel'])
  })
})

describe('SAFE-WATER-01', () => {
  it('requires responsible and safety text for water activities', () => {
    const b = new FactsBuilder()
    const noSafety = b.activity('Baden im See', CAT_LA)
    const noResp = b.activity('Kanu', CAT_LS, { responsible: false, content: { safetyText: 'Schwimmwesten' } })
    b.activity('Badi ok', CAT_LA, { content: { safetyText: 'Aufsicht SLRG' } })
    b.activity('Trinkwasser holen', CAT_LA)
    const hits = p['SAFE-WATER-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([noSafety.iri, noResp.iri])
    expect(hits[0].params?.missing).toBe('keine Sicherheitsüberlegungen')
    expect(hits[1].params?.missing).toBe('keine verantwortliche Person')
  })
  it('also finds keywords in location and storyboard', () => {
    const b = new FactsBuilder()
    b.activity('Spiel', CAT_LA, { location: 'am Fluss' })
    b.activity('Rallye', CAT_LA, { content: { storyboardText: 'Wir gehen schwimmen' } })
    expect(p['SAFE-WATER-01'](makeCtx(b.facts))).toHaveLength(2)
  })
})

describe('SAFE-MTN-01', () => {
  it('is satisfied by linked docs or the keywords Zeitberechnung/Alternativroute', () => {
    const b = new FactsBuilder()
    const bad = b.activity('Gipfelwanderung', CAT_LS)
    const withDoc = b.activity('Bergtour', CAT_LS)
    b.activity('Wanderung A', CAT_LS, { content: { notesText: 'Zeitberechnung: 4h' } })
    b.activity('Wanderung B', CAT_LS, { content: { storyboardText: 'Einstimmen. Alternativroute via Tal' } })
    const doc = makeDoc({ activityIris: [withDoc.iri] })
    expect(ids(p['SAFE-MTN-01'](makeCtx(b.facts, { documents: [doc] })))).toEqual([bad.iri])
  })
})

describe('SAFE-MTN-02', () => {
  const gpx = (estimatedMinutes: number): GpxStats => ({
    name: 'Route',
    pointCount: 10,
    distanceKm: 10,
    ascentM: 500,
    descentM: 500,
    lkm: (estimatedMinutes / 60) * 4,
    lkmWithDescent: (estimatedMinutes / 60) * 4 + 3,
    paceLkmPerHour: 4,
    estimatedMinutes,
    highestPointM: 2000,
    lowestPointM: 1000,
  })
  it('flags when the estimated time exceeds the slot', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung', CAT_LS)
    b.entry(a, 2, '08:00', '12:00') // 240
    const slow = makeDoc({ id: 'g1', name: 'route.gpx', kind: 'gpx', activityIris: [a.iri], gpx: gpx(300) })
    const fits = makeDoc({ id: 'g2', name: 'kurz.gpx', kind: 'gpx', activityIris: [a.iri], gpx: gpx(240) })
    const hits = p['SAFE-MTN-02'](makeCtx(b.facts, { documents: [slow, fits] }))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ targets: [a.iri, 'g1'], params: { estimated: '5 h 00 min', slot: '4 h 00 min' } })
  })
  it('is silent without linked GPX', () => {
    const b = new FactsBuilder()
    const a = b.activity('Wanderung', CAT_LS)
    b.entry(a, 2, '08:00', '12:00')
    expect(p['SAFE-MTN-02'](makeCtx(b.facts, { documents: [makeDoc({ activityIris: [a.iri] })] }))).toEqual([])
  })
})

describe('SAFE-ROPE-01', () => {
  const long = 'Die Seilbrücke wird mit zwei Fixpunkten gebaut, Verankerung an Bäumen mit Bandschlingen. ' + 'x'.repeat(150)
  it('needs >= 200 chars mentioning sicherung/verankerung/bremse', () => {
    const b = new FactsBuilder()
    const short = b.activity('Seilbrücke', CAT_LS, { content: { safetyText: 'Verankerung prüfen' } })
    const noTopic = b.activity('Pioniertechnik', CAT_LS, { content: { safetyText: 'y'.repeat(250) } })
    b.activity('Abseilen', CAT_LS, { content: { safetyText: long } })
    b.activity('Seilziehen', CAT_LA)
    const hits = p['SAFE-ROPE-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([short.iri, noTopic.iri])
    expect(hits[0].params?.reasons).toMatch(/zu kurz/)
    expect(hits[1].params?.reasons).toMatch(/weder/)
  })
})

describe('SAFE-NIGHT-01', () => {
  it('flags a late activity with short rest to the next morning', () => {
    const b = new FactsBuilder({ days: 3 })
    const night = b.activity('Lagerfeuer', CAT_LA, { content: { safetyText: 'Feuerwache' } })
    b.entry(night, 1, '20:00', '23:00')
    b.entry(b.activity('Frühsport', CAT_LS), 2, '07:00', '08:00') // rest 8h
    const hits = p['SAFE-NIGHT-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([night.iri])
    expect(hits[0].params?.reasons).toMatch(/8 h 00 min/)
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
    expect(hits[0].params?.reasons).toBe('keine Sicherheitsüberlegungen')
  })
  it('ignores Nachtessen', () => {
    const b = new FactsBuilder({ days: 2 })
    b.entry(b.activity('Nachtessen', CAT_LA), 1, '18:00', '19:00')
    expect(p['SAFE-NIGHT-01'](makeCtx(b.facts))).toEqual([])
  })
})

const checkItems = (found: SafetyCheckKey[]): DocCheckItem[] =>
  (['emergencyNumbers', 'hospital', 'crisisContact', 'evacuation', 'badWeather', 'threeByThree', 'firstAid', 'campAddress'] as SafetyCheckKey[]).map(
    (key) => ({ key, found: found.includes(key), snippets: [] }),
  )

describe('SAFE-WX-01', () => {
  it('flags outdoor days without a bad-weather variant', () => {
    const b = new FactsBuilder({ days: 3 })
    const a = b.activity('Wanderung zum Gipfel', CAT_LS)
    b.entry(a, 2, '09:00', '12:00')
    const hits = p['SAFE-WX-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([b.dayIri(2)])
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

describe('SAFE-DOC-01', () => {
  const f = new FactsBuilder().facts
  it('hints when no checked document exists', () => {
    const hits = p['SAFE-DOC-01'](makeCtx(f, { documents: [makeDoc()] }))
    expect(hits[0].severity).toBe('hint')
  })
  it('lists missing items of the best document and passes when complete', () => {
    const partial = makeDoc({ id: 'd1', name: 'konzept.pdf', docCheck: { items: checkItems(['emergencyNumbers', 'hospital']), complete: false, checkedAt: '' } })
    const worse = makeDoc({ id: 'd2', docCheck: { items: checkItems([]), complete: false, checkedAt: '' } })
    const hits = p['SAFE-DOC-01'](makeCtx(f, { documents: [worse, partial] }))
    expect(hits).toHaveLength(1)
    expect(hits[0].targets[1]).toBe('d1')
    expect(hits[0].params?.missing).toMatch(/Krisenkontakt/)
    expect(hits[0].params?.missing).not.toMatch(/Notrufnummern/)
    const complete = makeDoc({ docCheck: { items: checkItems(['emergencyNumbers', 'hospital', 'crisisContact', 'evacuation', 'badWeather', 'threeByThree', 'firstAid', 'campAddress']), complete: true, checkedAt: '' } })
    expect(p['SAFE-DOC-01'](makeCtx(f, { documents: [complete] }))).toEqual([])
  })
})

describe('BP-REST-01', () => {
  it('flags fully packed days; accepts a >= 60 min gap or a free (NONE) entry', () => {
    const b = new FactsBuilder({ days: 4 })
    b.entry(b.activity('a', CAT_LS), 1, '07:00', '12:00')
    b.entry(b.activity('b', CAT_LS), 1, '12:00', '22:00')
    b.entry(b.activity('c', CAT_LS), 2, '07:00', '12:00')
    b.entry(b.activity('d', CAT_LS), 2, '13:00', '22:00') // 60 min gap
    b.entry(b.activity('e', CAT_LS), 3, '07:00', '22:00')
    b.entry(b.activity('Frei', CAT_NONE), 3, '12:00', '13:00')
    expect(ids(p['BP-REST-01'](makeCtx(b.facts)))).toEqual([b.dayIri(1)])
    expect(p['BP-REST-01'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})

describe('BP-SLEEP-01', () => {
  const build = () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('a', CAT_LS), 1, '09:00', '22:00')
    b.entry(b.activity('b', CAT_LS), 2, '07:30', '21:00')
    b.entry(b.activity('c', CAT_LS), 3, '08:00', '12:00')
    return b
  }
  it('needs the Stufe; Wölfe need ~10h, Pfadi ~9h', () => {
    const b = build()
    expect(p['BP-SLEEP-01'](makeCtx(b.facts))).toEqual([])
    const woelfe = p['BP-SLEEP-01'](makeCtx(b.facts, { coachInputs: makeCoachInputs({ stufe: 'woelfe' }) }))
    expect(ids(woelfe)).toEqual([b.dayIri(2)]) // 9.5h < 10h; night 2->3 is 11h
    expect(woelfe[0].params).toMatchObject({ stufe: 'Wölfe', window: '9 h 30 min', need: '10 h' })
    expect(p['BP-SLEEP-01'](makeCtx(b.facts, { coachInputs: makeCoachInputs({ stufe: 'pfadi' }) }))).toEqual([])
  })
})

describe('BP-WOLF-01', () => {
  const f = new FactsBuilder().facts
  const run = (stufe: 'woelfe' | 'pfadi', participants: number | null, leaders: number | null) =>
    p['BP-WOLF-01'](makeCtx(f, { coachInputs: makeCoachInputs({ stufe, participantsCount: participants, leadersCount: leaders }) }))
  it('needs 1 leader per 6 Wölfe', () => {
    expect(run('woelfe', 13, 2)[0].params?.needed).toBe(3)
    expect(run('woelfe', 12, 2)).toEqual([])
    expect(run('pfadi', 40, 1)).toEqual([])
    expect(run('woelfe', null, 1)).toEqual([])
  })
})

describe('BP-WATER-01', () => {
  it('needs 1 SLRG per 12 participants when water activities exist', () => {
    const b = new FactsBuilder()
    b.activity('Baden', CAT_LA)
    const run = (participants: number | null, slrg: number | null) =>
      p['BP-WATER-01'](makeCtx(b.facts, { coachInputs: makeCoachInputs({ participantsCount: participants, slrgCount: slrg }) }))
    expect(run(25, 2)[0].params).toMatchObject({ needed: 3, have: 2 })
    expect(run(24, 2)).toEqual([])
    expect(run(10, null)[0].params?.have).toBe('keine Angabe')
    expect(run(null, 1)).toEqual([])
    const dry = new FactsBuilder()
    dry.activity('Basteln', CAT_LA)
    expect(p['BP-WATER-01'](makeCtx(dry.facts, { coachInputs: makeCoachInputs({ participantsCount: 40, slrgCount: 0 }) }))).toEqual([])
  })
})

describe('BP-VAR-01', () => {
  it('flags many J+S units of a single category', () => {
    const b = new FactsBuilder({ days: 3 })
    for (let i = 0; i < 4; i++) b.entry(b.activity(`LS ${i}`, CAT_LS), 2, `${8 + i * 2}:00`.padStart(5, '0'), `${9 + i * 2}:00`.padStart(5, '0'))
    expect(p['BP-VAR-01'](makeCtx(b.facts))).toHaveLength(1)
    b.entry(b.activity('LA', CAT_LA), 3, '09:00', '10:00')
    expect(p['BP-VAR-01'](makeCtx(b.facts))).toEqual([])
  })
  it('counts YS characteristics as variety and ignores small camps', () => {
    const b = new FactsBuilder({ days: 3 })
    const chars = [['kraft'], ['ausdauer'], [], []]
    chars.forEach((c, i) =>
      b.entry(b.activity(`LS ${i}`, CAT_LS, { content: { ysCharacteristics: c } }), 2, `${8 + i * 2}:00`.padStart(5, '0'), `${9 + i * 2}:00`.padStart(5, '0')),
    )
    expect(p['BP-VAR-01'](makeCtx(b.facts))).toEqual([])
    const few = new FactsBuilder({ days: 3 })
    few.entry(few.activity('x', CAT_LS), 2, '09:00', '10:00')
    expect(p['BP-VAR-01'](makeCtx(few.facts))).toEqual([])
  })
})
