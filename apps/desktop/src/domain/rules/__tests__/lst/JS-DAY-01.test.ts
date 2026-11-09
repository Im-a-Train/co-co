import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, mappingOf, msg } from '../factory'
import { ids, jsDay, Y2026, Y2027 } from './helpers'

describe('JS-DAY-01', () => {
  it('flags interior days with J+S minutes that are no J+S day; skips end days and free days', () => {
    const b = new FactsBuilder({ start: Y2026, days: 5 })
    b.entry(b.activity('x', CAT_LS), 1, '09:00', '11:00') // end day
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00') // 1 unit, 120 min
    jsDay(b, 3, null)
    // day 4: free day (JS-FREE-01)
    const hits = p['JS-DAY-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([b.dayIri(2)])
    expect(msg(hits[0])).toBe('13.07.2026 zählt nicht als J+S-Tag (120 min J+S-Aktivität in 1 Einheit(en); nötig 240 min in mindestens 2 Einheiten). Er gilt als trainingsfreier Tag.')
    expect(hits[0].severity).toBeUndefined() // should (YAML)
  })
  it('2027: enough minutes and units but too little movement time gets the bwz variant', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    jsDay(b, 2, 30) // 60 min BWZ
    const hits = p['JS-DAY-01'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].variant).toBe('bwz')
    expect(msg(hits[0])).toContain('Bewegungszeit beträgt nur 60 min (nötig 120 min)')
  })
  it('is silent without mapping (JS-CAMP-01 owns the hint), for ES-only mappings and non-J+S camps', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '10:00')
    expect(p['JS-DAY-01'](makeCtx(b.facts, { mapping: null }))).toEqual([])
    expect(p['JS-DAY-01'](makeCtx(b.facts, { mapping: mappingOf({ [CAT_ES]: 'ES' }) }))).toEqual([])
    expect(p['JS-DAY-01'](makeCtx(b.facts, { coachInputs: makeCoachInputs({ isJsCamp: false }) }))).toEqual([])
  })
  it('activity tags decide what counts as J+S', () => {
    const b = new FactsBuilder({ start: Y2026, days: 4 })
    const a = b.activity('Sport', CAT_LS)
    b.entry(a, 2, '09:00', '13:00')
    const ctx = makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: ['keine-js-aktivitaet'] } } })
    expect(p['JS-DAY-01'](ctx)).toEqual([]) // no J+S minutes left on day 2 (free day)
  })
})
