import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, msg } from '../factory'
import { jsDay, Y2026, Y2027 } from './helpers'

const partner = { angebot: { other4DayCamp: true, unternehmungElsewhere: null, efCoveredElsewhere: null, lastActivityDate: null } }

describe('JS-CAMP-01 (2026: calendar days)', () => {
  it('4 consecutive days pass, 3 days fire, 3 days with an offer partner pass', () => {
    expect(p['JS-CAMP-01'](makeCtx(new FactsBuilder({ start: Y2026, days: 4 }).facts))).toEqual([])
    const hits = p['JS-CAMP-01'](makeCtx(new FactsBuilder({ start: Y2026, days: 3 }).facts))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toBe('Das Lager dauert nur 3 aufeinanderfolgende Tage (nötig: mindestens 4).')
    expect(p['JS-CAMP-01'](makeCtx(new FactsBuilder({ start: Y2026, days: 3 }).facts, { campConfig: partner }))).toEqual([])
  })
  it('a date gap breaks the run (free days are calendar days, no skipping in 2026)', () => {
    const b = new FactsBuilder({ start: Y2026, days: 6 })
    b.facts.days.splice(3, 1)
    expect(p['JS-CAMP-01'](makeCtx(b.facts))).toHaveLength(1)
  })
  it('ignores non-J+S camps', () => {
    const ctx = makeCtx(new FactsBuilder({ start: Y2026, days: 2 }).facts, { coachInputs: makeCoachInputs({ isJsCamp: false }) })
    expect(p['JS-CAMP-01'](ctx)).toEqual([])
  })
  it('without mapping: calendar count still evaluated, plus the noMapping hint (owner of the hint)', () => {
    const hits = p['JS-CAMP-01'](makeCtx(new FactsBuilder({ start: Y2026, days: 3 }).facts, { mapping: null }))
    expect(hits).toHaveLength(2)
    const hint = hits.find((h) => h.variant === 'noMapping')!
    expect(hint.severity).toBe('hint')
    expect(msg(hint)).toContain('Kategorie-Zuordnung fehlt')
    expect(new Set(hits.map((h) => h.targets.join('|'))).size).toBe(2)
  })
})

describe('JS-CAMP-01 (2027: J+S days, free days never break the run)', () => {
  it('5 days with free day 3 and 4 J+S days pass', () => {
    const b = new FactsBuilder({ start: Y2027, days: 5 })
    for (const d of [1, 2, 4, 5]) jsDay(b, d)
    expect(p['JS-CAMP-01'](makeCtx(b.facts))).toEqual([])
  })
  it('5 days with 3 J+S days fire and the message says how skipped days are treated', () => {
    const b = new FactsBuilder({ start: Y2027, days: 5 })
    for (const d of [1, 2, 5]) jsDay(b, d)
    const hits = p['JS-CAMP-01'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('nur 3 J+S-Tage (nötig: mindestens 4)')
    expect(msg(hits[0])).toContain('unterbrechen die Folge aber auch nicht')
  })
  it('a day failing the J+S-day criteria is skipped, not counted', () => {
    const b = new FactsBuilder({ start: Y2027, days: 5 })
    for (const d of [1, 2, 4, 5]) jsDay(b, d)
    b.entry(b.activity('Einzeln', CAT_LS), 3, '09:00', '10:00', { ys: 60 })
    expect(p['JS-CAMP-01'](makeCtx(b.facts))).toEqual([])
  })
  it('first and last day combined count once', () => {
    const b = new FactsBuilder({ start: Y2027, days: 5 })
    b.entry(b.activity('Anreise', CAT_LS), 1, '14:00', '16:00', { ys: 60 })
    b.entry(b.activity('Abreise', CAT_LS), 5, '09:00', '11:00', { ys: 60 })
    jsDay(b, 2)
    jsDay(b, 3)
    expect(p['JS-CAMP-01'](makeCtx(b.facts))[0].params).toMatchObject({ jsDays: 3, min: 4 })
    jsDay(b, 4)
    expect(p['JS-CAMP-01'](makeCtx(b.facts))).toEqual([])
  })
  it('an offer partner lowers the minimum to 3', () => {
    const b = new FactsBuilder({ start: Y2027, days: 5 })
    for (const d of [1, 2, 5]) jsDay(b, d)
    expect(p['JS-CAMP-01'](makeCtx(b.facts, { campConfig: partner }))).toEqual([])
  })
  it('without mapping only the noMapping hint is reported (count skipped)', () => {
    const hits = p['JS-CAMP-01'](makeCtx(new FactsBuilder({ start: Y2027, days: 5 }).facts, { mapping: null }))
    expect(hits.map((h) => h.variant)).toEqual(['noMapping'])
  })
})
