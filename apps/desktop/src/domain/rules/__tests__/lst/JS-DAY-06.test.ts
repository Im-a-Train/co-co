import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { ids, Y2026 } from './helpers'

describe('JS-DAY-06', () => {
  it('fires when all J+S activities lie in one time window (overlapping entries)', () => {
    const b = new FactsBuilder({ start: Y2026, days: 4 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '10:00', '12:00')
    const hits = p['JS-DAY-06'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([b.dayIri(2)])
    expect(msg(hits[0])).toContain('in der Tageszeit «Morgen»')
    expect(msg(hits[0])).toContain('mindestens 2 Tageszeiten')
    expect(hits[0].severity).toBeUndefined() // should (YAML)
  })
  it('09:00–11:00 + 14:00–16:00 passes', () => {
    const b = new FactsBuilder({ start: Y2026, days: 4 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '14:00', '16:00')
    expect(p['JS-DAY-06'](makeCtx(b.facts))).toEqual([])
  })
  it('lenient: 11:30–12:30 + 17:00–18:30 covers morning and afternoon (≥ 30 min overlap each)', () => {
    const b = new FactsBuilder({ start: Y2026, days: 4 })
    b.entry(b.activity('a', CAT_LS), 2, '11:30', '12:30')
    b.entry(b.activity('b', CAT_LS), 2, '17:00', '18:30')
    expect(p['JS-DAY-06'](makeCtx(b.facts))).toEqual([])
  })
  it('free days and end days are not judged; combined end days are evaluated as one union', () => {
    const b = new FactsBuilder({ start: Y2026, days: 4 })
    b.entry(b.activity('an', CAT_LS), 1, '09:00', '11:00')
    expect(p['JS-DAY-06'](makeCtx(b.facts))).toEqual([]) // end day alone, interior days free

    const c = new FactsBuilder({ start: Y2026, days: 4 })
    c.entry(c.activity('an', CAT_LS), 1, '14:00', '16:00')
    c.entry(c.activity('ab', CAT_LS), 4, '09:00', '11:00')
    c.entry(c.activity('ab2', CAT_LS), 4, '11:30', '13:00')
    expect(c.facts.scheduleEntries).toHaveLength(3)
    // 120 + 210 = 330 min ≥ 240: combined; morning + afternoon covered -> none
    expect(p['JS-DAY-06'](makeCtx(c.facts))).toEqual([])

    const d = new FactsBuilder({ start: Y2026, days: 4 })
    d.entry(d.activity('an', CAT_LS), 1, '09:00', '11:00')
    d.entry(d.activity('ab', CAT_LS), 4, '09:00', '11:00')
    const hits = p['JS-DAY-06'](makeCtx(d.facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].variant).toBe('combined')
    expect(hits[0].targets).toEqual([d.dayIri(1), d.dayIri(4)])
  })
  it('is silent without mapping', () => {
    const b = new FactsBuilder({ start: Y2026, days: 4 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    expect(p['JS-DAY-06'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
