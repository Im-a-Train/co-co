import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { jsDay, Y2026, Y2027 } from './helpers'

describe('JS-DAY-04', () => {
  it('2026: combined >= 240 min passes, too short fires (should), nothing planned is no finding', () => {
    const ok = new FactsBuilder({ start: Y2026, days: 3 })
    ok.entry(ok.activity('an', CAT_LS), 1, '15:00', '17:00')
    ok.entry(ok.activity('ab', CAT_LS), 3, '09:00', '11:00')
    expect(p['JS-DAY-04'](makeCtx(ok.facts))).toEqual([])

    const bad = new FactsBuilder({ start: Y2026, days: 3 })
    bad.entry(bad.activity('an', CAT_LS), 1, '15:00', '16:00')
    bad.entry(bad.activity('ab', CAT_LS), 3, '09:00', '10:00')
    const hits = p['JS-DAY-04'](makeCtx(bad.facts))
    expect(hits[0]).toMatchObject({ targets: [bad.dayIri(1), bad.dayIri(3)], params: { minutes: 120, min: 240 } })
    expect(msg(hits[0])).toBe('Erster und letzter Lagertag zählen nicht als J+S-Tag (zusammen 120 min, nötig 240).')

    const nothing = new FactsBuilder({ start: Y2026, days: 3 })
    nothing.facts.activities.length = 0
    jsDay(nothing, 2, null)
    expect(p['JS-DAY-04'](makeCtx(nothing.facts))).toEqual([])
  })
  it('both end days valid alone, or one valid alone: no finding (end days are not combined then)', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    jsDay(b, 1, null)
    jsDay(b, 3, null)
    expect(p['JS-DAY-04'](makeCtx(b.facts))).toEqual([])
    const one = new FactsBuilder({ start: Y2026, days: 3 })
    jsDay(one, 1, null)
    one.entry(one.activity('ab', CAT_LS), 3, '09:00', '10:00')
    expect(p['JS-DAY-04'](makeCtx(one.facts))).toEqual([])
  })
  it('the combined day needs no 2 units', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    b.entry(b.activity('an', CAT_LS), 1, '10:00', '13:00')
    b.entry(b.activity('ab', CAT_LS), 3, '10:00', '11:00')
    expect(p['JS-DAY-04'](makeCtx(b.facts))).toEqual([])
  })
  it('2027: the pair also needs the summed movement time', () => {
    const b = new FactsBuilder({ start: Y2027, days: 3 })
    b.entry(b.activity('an', CAT_LS), 1, '14:00', '16:00', { ys: 30 })
    b.entry(b.activity('ab', CAT_LS), 3, '09:00', '11:00', { ys: 30 })
    expect(p['JS-DAY-04'](makeCtx(b.facts))).toHaveLength(1) // 60 < 120 BWZ
    const ok = new FactsBuilder({ start: Y2027, days: 3 })
    ok.entry(ok.activity('an', CAT_LS), 1, '14:00', '16:00', { ys: 60 })
    ok.entry(ok.activity('ab', CAT_LS), 3, '09:00', '11:00', { ys: 60 })
    expect(p['JS-DAY-04'](makeCtx(ok.facts))).toEqual([])
  })
  it('is silent without mapping', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    b.entry(b.activity('an', CAT_LS), 1, '15:00', '16:00')
    expect(p['JS-DAY-04'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
