import { describe, expect, it } from 'vitest'
import { predicates as p } from '../packs/basis/predicates'
import { coachNameMatches } from '../packs/basis/predicates/completeness'
import { CAT_ES, CAT_LA, CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeMidata, makeNds, mappingOf } from './factory'

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

describe('CMP-CAMP-01 with MiData', () => {
  it('hints when the MiData advisor is not the coach', () => {
    const f = new FactsBuilder().facts
    const hits = p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Muster Max', midata: makeMidata({ coachMatch: false }) }))
    expect(hits).toHaveLength(1)
    expect(hits[0].params?.detail).toContain('Quelle: MiData, Stand 01.01.2031')
  })
  it('names the MiData coach in the hint when known', () => {
    const f = new FactsBuilder().facts
    const withName = p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Muster Max', midata: makeMidata({ coachMatch: false, coachNickname: 'Falk' }) }))
    expect(withName[0].params?.detail).toContain('«Falk»')
    const without = p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Muster Max', midata: makeMidata({ coachMatch: false, coachNickname: null }) }))
    expect(without[0].params?.detail).toContain('eine andere Person')
  })
  it('stays quiet for match true / unknown', () => {
    const f = new FactsBuilder().facts
    expect(p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Muster Max', midata: makeMidata({ coachMatch: true }) }))).toEqual([])
    expect(p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Muster Max', midata: makeMidata({ coachMatch: null }) }))).toEqual([])
  })
})

describe('CMP-NDS rules', () => {
  const f = new FactsBuilder({ start: '2031-07-12', days: 5 }).facts
  const after = new Date('2031-08-01T12:00:00Z')
  const counts = (n: number | null) => ({ children: null, adolescents: null, totalParticipants: n, totalInstructors: null, jsInstructors: null, campDays: null, totalActivities: null })
  const withPlanned = (n: number | null) => makeNds({ statistics: { planned: counts(n), actual: counts(null), coachAuthorizedForContribution: null } })

  it('CMP-NDS-01 is silent without NDS and with equal dates, hints on difference', () => {
    expect(p['CMP-NDS-01'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-01'](makeCtx(f, { nds: makeNds() }))).toEqual([])
    expect(p['CMP-NDS-01'](makeCtx(f, { nds: makeNds({ start: null }) }))).toEqual([])
    const hits = p['CMP-NDS-01'](makeCtx(f, { nds: makeNds({ end: '2031-07-18' }) }))
    expect(hits).toHaveLength(1)
    expect(String(hits[0].params?._message)).toContain('12.07.2031–16.07.2031')
    expect(String(hits[0].params?._message)).toContain('12.07.2031–18.07.2031')
    expect(String(hits[0].params?._message)).toContain('Quelle: NDS, Stand 01.01.2031')
  })

  it('CMP-NDS-02 flags open AWK only after the camp end', () => {
    const nds = makeNds({ activities: { total: 5, byState: {}, byType: {}, lastActivityDate: null, attendanceOpenCount: 2 } })
    expect(p['CMP-NDS-02'](makeCtx(f, { nds }))).toEqual([]) // now = 2031-01-01, before the camp
    const hits = p['CMP-NDS-02'](makeCtx(f, { nds, now: after }))
    expect(hits).toHaveLength(1)
    expect(String(hits[0].params?._message)).toContain('2 Aktivitäten')
    expect(p['CMP-NDS-02'](makeCtx(f, { nds: makeNds(), now: after }))).toEqual([])
    expect(p['CMP-NDS-02'](makeCtx(f, { now: after }))).toEqual([])
  })

  it('CMP-NDS-03 compares NDS planned participants with MiData, else the coach input (>20 %)', () => {
    expect(p['CMP-NDS-03'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-03'](makeCtx(f, { nds: withPlanned(null), midata: makeMidata() }))).toEqual([])
    expect(p['CMP-NDS-03'](makeCtx(f, { nds: withPlanned(22), midata: makeMidata({ participantsCount: 20 }) }))).toEqual([])
    const hits = p['CMP-NDS-03'](makeCtx(f, { nds: withPlanned(30), midata: makeMidata({ participantsCount: 20 }) }))
    expect(hits).toHaveLength(1)
    expect(String(hits[0].params?._message)).toContain('MiData')
    const own = p['CMP-NDS-03'](makeCtx(f, { nds: withPlanned(30), coachInputs: makeCoachInputs({ participantsCount: 20 }) }))
    expect(own).toHaveLength(1)
    expect(String(own[0].params?._message)).toContain('Angabe des Coachs')
    expect(p['CMP-NDS-03'](makeCtx(f, { nds: withPlanned(30) }))).toEqual([])
  })
})

describe('CMP-MD-01', () => {
  const f = new FactsBuilder({ start: '2031-07-12', days: 5 }).facts
  it('is silent without MiData or with equal dates', () => {
    expect(p['CMP-MD-01'](makeCtx(f))).toEqual([])
    expect(p['CMP-MD-01'](makeCtx(f, { midata: makeMidata() }))).toEqual([])
  })
  it('hints when dates differ', () => {
    const md = makeMidata({ eventDates: [{ startAt: '2031-07-13T00:00:00', finishAt: '2031-07-16' }] })
    const hits = p['CMP-MD-01'](makeCtx(f, { midata: md }))
    expect(hits).toHaveLength(1)
    expect(String(hits[0].params?._message)).toContain('12.07.2031–16.07.2031')
    expect(String(hits[0].params?._message)).toContain('13.07.2031–16.07.2031')
  })
})
