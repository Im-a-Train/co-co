import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { evaluate } from '../../engine'
import { loadBundledPacks } from '../../packs'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { ids, jsDay, Y2026, Y2027 } from './helpers'

describe('JS-BWZ-27', () => {
  it('is valid from 2027 only, should/verified, and never runs for a 2026 camp', () => {
    const rule = loadBundledPacks()
      .flatMap((x) => x.rules)
      .find((r) => r.meta.id === 'JS-BWZ-27')!
    expect(rule.meta).toMatchObject({ validFrom: '2027-01-01', severity: 'should', confidence: 'verified' })
    const old = new FactsBuilder({ start: Y2026, days: 4 })
    jsDay(old, 2, 10)
    expect(p['JS-BWZ-27'](makeCtx(old.facts))).toEqual([])
    expect(evaluate(loadBundledPacks(), makeCtx(old.facts)).some((f) => f.ruleId === 'JS-BWZ-27')).toBe(false)
  })
  it('flags interior days with >= 240 min J+S but < 120 min movement time', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    jsDay(b, 2, 45) // 90 min
    jsDay(b, 3, 60) // 120 min -> ok
    const hits = p['JS-BWZ-27'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([b.dayIri(2)])
    expect(msg(hits[0])).toBe('13.07.2027: nur 90 min Bewegungszeit (nötig 120) – Tag zählt nicht als J+S-Tag.')
  })
  it('uses the activity-level value of single-entry activities', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    b.entry(b.activity('a', CAT_LS, { content: { ysPhysicalActivityDurationMinutes: 150 } }), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '14:00', '16:00')
    expect(p['JS-BWZ-27'](makeCtx(b.facts))).toEqual([]) // 150 >= 120
  })
  it('no movement-time data at all: one camp hint (noData)', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    jsDay(b, 2, null)
    jsDay(b, 3, null)
    const hits = p['JS-BWZ-27'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].variant).toBe('noData')
    expect(msg(hits[0])).toContain('Keine Angaben zur Bewegungszeit')
  })
  it('is silent without mapping', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    jsDay(b, 2, 10)
    expect(p['JS-BWZ-27'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
