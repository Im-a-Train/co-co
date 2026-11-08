import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, FactsBuilder, makeCtx, mappingOf, msg } from '../factory'
import { jsDay, Y2026, Y2027 } from './helpers'

/** Camp of `days` days where the interior days in `valid` are J+S days and the other interior days are free. */
function camp(start: string, days: number, valid: number[]) {
  const b = new FactsBuilder({ start, days })
  for (const d of valid) jsDay(b, d)
  return b
}

describe('JS-FREE-01', () => {
  it('2026: 7 days with 3 training-free days exceed both readings -> should', () => {
    const hits = p['JS-FREE-01'](makeCtx(camp(Y2026, 7, [2, 3]).facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBeUndefined()
    expect(hits[0].variant).toBeUndefined()
    expect(msg(hits[0])).toContain('3 trainingsfreie Tage bei 7 Lagertagen – erlaubt sind 2.')
  })
  it('2026: 6 days with 2 free days sit between text and table -> hint, confidence conflict', () => {
    const hits = p['JS-FREE-01'](makeCtx(camp(Y2026, 6, [2, 3]).facts))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ severity: 'hint', confidence: 'conflict', variant: 'conflict' })
    expect(msg(hits[0])).toContain('widersprechen sich')
  })
  it('2026: within the allowance -> none', () => {
    expect(p['JS-FREE-01'](makeCtx(camp(Y2026, 8, [2, 3, 4, 5]).facts))).toEqual([]) // F = 2 = A_text(8)
    expect(p['JS-FREE-01'](makeCtx(camp(Y2026, 4, [2, 3]).facts))).toEqual([]) // D < 5 -> 0 allowed, F = 0
  })
  it('2027: 9 days with 4 free days -> hint conflict2027 (J+S-day counting skips free days)', () => {
    const hits = p['JS-FREE-01'](makeCtx(camp(Y2027, 9, [2, 3, 4]).facts))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ severity: 'hint', confidence: 'conflict', variant: 'conflict2027' })
    expect(msg(hits[0])).toContain('ab 2027 erlauben Tage ohne J+S-Aktivitäten')
  })
  it('end days never count as free days', () => {
    expect(p['JS-FREE-01'](makeCtx(camp(Y2026, 5, [2, 3, 4]).facts))).toEqual([])
  })
  it('is silent without J+S mapping', () => {
    const b = camp(Y2026, 8, [])
    expect(p['JS-FREE-01'](makeCtx(b.facts, { mapping: mappingOf({ [CAT_ES]: 'ES' }) }))).toEqual([])
  })
})
