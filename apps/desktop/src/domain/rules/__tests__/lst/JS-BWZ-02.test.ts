import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { Y2026, Y2027 } from './helpers'

function one(ys: number | null, from = '09:00', to = '10:30') {
  const b = new FactsBuilder({ start: Y2027, days: 3 })
  const a = b.activity('Postenlauf', CAT_LS)
  const e = b.entry(a, 2, from, to, { ys })
  return { b, a, e }
}

describe('JS-BWZ-02', () => {
  it('value 20 -> should, variant under30', () => {
    const { b, e } = one(20)
    const hits = p['JS-BWZ-02'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ variant: 'under30', severity: 'should', targets: [e.iri] })
    expect(msg(hits[0])).toBe('Bewegungszeit von «Postenlauf» (20 min): unter 30 min – wird nicht angerechnet.')
  })
  it('value 50 -> must (severity not lowered), variant step', () => {
    const { b } = one(50)
    const hits = p['JS-BWZ-02'](makeCtx(b.facts))
    expect(hits[0].variant).toBe('step')
    expect(hits[0].severity).toBeUndefined()
    expect(msg(hits[0])).toContain('nicht in 15-Minuten-Schritten')
  })
  it('no value -> should, variant missing (once per activity)', () => {
    const { b, a } = one(null)
    const hits = p['JS-BWZ-02'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ variant: 'missing', severity: 'should', targets: [a.iri] })
  })
  it('120 on a 90-minute entry -> should, variant tooLong', () => {
    const { b } = one(120)
    const hits = p['JS-BWZ-02'](makeCtx(b.facts))
    expect(hits[0]).toMatchObject({ variant: 'tooLong', severity: 'should' })
    expect(msg(hits[0])).toContain('länger als die Aktivität (90 min)')
  })
  it('45 on a 60-minute entry -> none', () => {
    const { b } = one(45, '09:00', '10:00')
    expect(p['JS-BWZ-02'](makeCtx(b.facts))).toEqual([])
  })
  it('the activity-level value counts when the entry has none; non-J+S activities are ignored', () => {
    const b = new FactsBuilder({ start: Y2027, days: 3 })
    b.entry(b.activity('Mit', CAT_LS, { content: { ysPhysicalActivityDurationMinutes: 60 } }), 2, '09:00', '10:30')
    b.entry(b.activity('Essen', '/api/categories/es'), 2, '12:00', '13:00')
    expect(p['JS-BWZ-02'](makeCtx(b.facts))).toEqual([])
  })
  it('no criterion before 2027 (params null) and without mapping', () => {
    const old = new FactsBuilder({ start: Y2026, days: 3 })
    old.entry(old.activity('Lauf', CAT_LS), 2, '09:00', '10:00')
    expect(p['JS-BWZ-02'](makeCtx(old.facts))).toEqual([])
    expect(p['JS-BWZ-02'](makeCtx(one(null).b.facts, { mapping: null }))).toEqual([])
  })
})
