import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, CAT_LS, CAT_NONE, FactsBuilder, makeCoachInputs, makeCtx, msg, ruleMeta } from '../factory'

const ids = (hits: { targets: string[] }[]) => hits.map((h) => h.targets.join('|'))

describe('PBS rule metadata (§4.4)', () => {
  it('BP-REST-01 is hint/unverified with LAGER S.18 and H', () => {
    const m = ruleMeta('BP-REST-01')
    expect(m).toMatchObject({ severity: 'hint', confidence: 'unverified', module: 'pbs' })
    expect((m.sources ?? []).map((s) => s.key)).toEqual(['LAGER', 'H'])
  })
  it('BP-SLEEP-01 cites MAN S.55; BP-WOLF-01 / BP-WATER-01 are best-practice hints', () => {
    expect(ruleMeta('BP-SLEEP-01').sources?.[0]).toMatchObject({ key: 'MAN', page: 'S. 55' })
    expect(ruleMeta('BP-WOLF-01')).toMatchObject({ severity: 'hint', confidence: 'best-practice' })
    expect(ruleMeta('BP-WATER-01')).toMatchObject({ severity: 'hint', confidence: 'best-practice' })
  })
  it('PBS-METH-01 is hint/unverified and its sets are provisional', () => {
    expect(ruleMeta('PBS-METH-01')).toMatchObject({ severity: 'hint', confidence: 'unverified', module: 'pbs' })
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
  it('reads the gap from the param', () => {
    const b = new FactsBuilder({ days: 1 })
    b.entry(b.activity('c', CAT_LS), 1, '07:00', '12:00')
    b.entry(b.activity('d', CAT_LS), 1, '13:00', '22:00')
    expect(p['BP-REST-01'](makeCtx(b.facts, { paramValues: { 'pbs.restGapMinutes': 90 } }))).toHaveLength(1)
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
    expect(woelfe[0].params).toMatchObject({ window: '9 h 30 min', need: '10 h' })
    expect(msg(woelfe[0])).toContain('empfohlen für Wölfe: 10 h')
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
  it('reads the ratio from the param', () => {
    const ctx = makeCtx(f, { coachInputs: makeCoachInputs({ stufe: 'woelfe', participantsCount: 12, leadersCount: 2 }), paramValues: { 'pbs.wolfParticipantsPerLeader': 4 } })
    expect(p['BP-WOLF-01'](ctx)[0].params?.needed).toBe(3)
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
    expect(msg(run(10, null)[0])).toContain('SLRG-Qualifizierte: keine Angabe')
    expect(run(null, 1)).toEqual([])
    const dry = new FactsBuilder()
    dry.activity('Basteln', CAT_LA)
    expect(p['BP-WATER-01'](makeCtx(dry.facts, { coachInputs: makeCoachInputs({ participantsCount: 40, slrgCount: 0 }) }))).toEqual([])
  })
})

describe('MiData source in BP rules', () => {
  const stand = '2031-01-01T10:00:00.000Z'
  it('BP-WOLF-01 / BP-WATER-01 carry the MiData source', () => {
    const b = new FactsBuilder()
    b.activity('Baden im See', CAT_LA, { content: { safetyText: 'Aufsicht' } })
    const f = b.facts
    const wolf = p['BP-WOLF-01'](
      makeCtx(f, { coachInputs: makeCoachInputs({ stufe: 'woelfe', participantsCount: 20, leadersCount: 2, midataFields: { leadersCount: stand } }) }),
    )
    expect(wolf[0].params?.src).toBe(' (Quelle: MiData, Stand 01.01.2031)')
    const water = p['BP-WATER-01'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 30, slrgCount: 1, midataFields: { slrgCount: stand } }) }))
    expect(water[0].params?.src).toBe(' (Quelle: MiData, Stand 01.01.2031)')
    const manual = p['BP-WATER-01'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 30, slrgCount: 1 }) }))
    expect(manual[0].params?.src).toBe('')
  })
})

describe('PBS-METH-01', () => {
  const ALL = [
    'Persönlicher Fortschritt', 'Pfadigesetz', 'Gruppenleben', 'Lagerfeuer Ritual', 'Mitbestimmung', 'Draussen leben im Wald', 'Geländespiel',
    'Persönlichkeit stärken', 'Gemeinschaft', 'Umwelt', 'Besinnung', 'Bewegung',
  ]
  it('missing «Natur»/«Draussen» term -> hint naming the method', () => {
    const b = new FactsBuilder()
    for (const t of ALL.filter((t) => !t.startsWith('Draussen') && t !== 'Umwelt')) b.activity(t, CAT_LA)
    const hits = p['PBS-METH-01'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Draussen leben')
    expect(msg(hits[0])).toContain('Beziehung zur Umwelt')
    expect(msg(hits[0])).not.toContain('Spielen')
  })
  it('all groups present -> none', () => {
    const b = new FactsBuilder()
    for (const t of ALL) b.activity(t, CAT_LA)
    expect(p['PBS-METH-01'](makeCtx(b.facts))).toEqual([])
  })
  it('no activities -> none', () => expect(p['PBS-METH-01'](makeCtx(new FactsBuilder().facts))).toEqual([]))
})
