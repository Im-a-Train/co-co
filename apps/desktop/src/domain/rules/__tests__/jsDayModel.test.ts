/** Shared J+S day model (ctx.js, catalog v2 §3.9): 2026/2027 params, parallel entries, midnight split, end days. */
import { describe, expect, it } from 'vitest'
import { windowsCovered } from '../lib/timeWindows'
import { CAT_LS, CAT_NONE, FactsBuilder, makeCtx } from './factory'

/** Two 2 h units 09–11 and 14–16 with movement time `ys` per entry. */
function jsDay(b: FactsBuilder, day: number, ys: number | null = null) {
  b.entry(b.activity(`V${day}`, CAT_LS), day, '09:00', '11:00', { ys })
  b.entry(b.activity(`N${day}`, CAT_LS), day, '14:00', '16:00', { ys })
}

describe('ctx.js (J+S day model)', () => {
  it('2026: a day with 2 units and 240 min is a J+S day (no BWZ criterion)', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    jsDay(b, 2)
    const m = makeCtx(b.facts).js
    expect(m.days[1]).toMatchObject({ jsMinutes: 240, units: 2, isJsDay: true, bwzKnown: false })
    expect(m.trainingFreeDays.map((d) => d.number)).toEqual([])
    expect(m.status).toBe('ok')
  })

  it('2027: the same day fails without 120 min movement time, passes with it', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 3 })
    jsDay(b, 2, 50)
    expect(makeCtx(b.facts).js.days[1]).toMatchObject({ bwzMinutes: 100, isJsDay: false })
    const c = new FactsBuilder({ start: '2027-07-12', days: 3 })
    jsDay(c, 2, 60)
    expect(makeCtx(c.facts).js.days[1]).toMatchObject({ bwzMinutes: 120, isJsDay: true })
  })

  it('2027: movement time below 30 min per entry counts as 0', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00', { ys: 100 })
    b.entry(b.activity('b', CAT_LS), 2, '14:00', '16:00', { ys: 20 })
    expect(makeCtx(b.facts).js.days[1].bwzMinutes).toBe(100)
  })

  it('parallel subgroups are united, never summed', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('Gruppe A', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('Gruppe B', CAT_LS), 2, '09:30', '11:30')
    b.entry(b.activity('Nachmittag', CAT_LS), 2, '14:00', '15:00')
    const d = makeCtx(b.facts).js.days[1]
    expect(d.jsMinutes).toBe(150 + 60)
    expect(d.units).toBe(2)
  })

  it('splits an entry crossing midnight onto both days', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('Nachtlauf', CAT_LS), 1, '22:00', '01:00', { endDay: 2 })
    const m = makeCtx(b.facts).js
    expect(m.days[0].intervals).toEqual([{ from: 22 * 60, to: 1440 }])
    expect(m.days[1].intervals).toEqual([{ from: 0, to: 60 }])
  })

  it('merges units separated by less than 30 min and reports the short gap', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '11:10', '13:10')
    const d = makeCtx(b.facts).js.days[1]
    expect(d.units).toBe(1)
    expect(d.shortGaps).toEqual([{ from: 660, to: 670, minutes: 10 }])
    expect(d.isJsDay).toBe(false)
  })

  it('drops entries shorter than 30 min (reported for JS-DAY-02)', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    const e = b.entry(b.activity('kurz', CAT_LS), 2, '09:00', '09:20')
    const d = makeCtx(b.facts).js.days[1]
    expect(d.shortEntryIris).toEqual([e.iri])
    expect(d.jsMinutes).toBe(0)
  })

  it('combines first and last day into one J+S day when neither counts alone', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 4 })
    b.entry(b.activity('Anreise', CAT_LS), 1, '14:00', '16:00')
    jsDay(b, 2)
    jsDay(b, 3)
    b.entry(b.activity('Abreise', CAT_LS), 4, '09:00', '11:00')
    const m = makeCtx(b.facts).js
    expect(m.endDaysMode).toBe('combined')
    expect(m.jsDayCount).toBe(3)
  })

  it('does not combine when one end day counts alone', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    jsDay(b, 1)
    jsDay(b, 2)
    b.entry(b.activity('Abreise', CAT_LS), 3, '09:00', '11:00')
    const m = makeCtx(b.facts).js
    expect(m.endDaysMode).toBe('single')
    expect(m.jsDayCount).toBe(2)
  })

  it('2027: interior days without J+S activities are training-free and skipped from the count', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 5 })
    for (const d of [1, 2, 4, 5]) jsDay(b, d, 60)
    b.entry(b.activity('Frei', CAT_NONE), 3, '09:00', '17:00')
    const m = makeCtx(b.facts).js
    expect(m.trainingFreeDays.map((d) => d.number)).toEqual([3])
    expect(m.jsDayCount).toBe(4)
  })

  it('activity tags override the mapping in both directions; no mapping and no tags = unknown', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    const a = b.activity('Frei', CAT_NONE)
    const s = b.activity('Sport', CAT_LS)
    b.entry(a, 2, '09:00', '11:00')
    b.entry(s, 2, '14:00', '16:00')
    const tagged = makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: ['js-aktivitaet'], [s.iri]: ['keine-js-aktivitaet'] } } }).js
    expect(tagged.isJsActivity(a.iri)).toBe(true)
    expect(tagged.isJsActivity(s.iri)).toBe(false)
    expect(tagged.days[1].intervals).toEqual([{ from: 540, to: 660 }])
    const unknown = makeCtx(b.facts, { mapping: null }).js
    expect(unknown.status).toBe('unknown')
    expect(unknown.isJsActivity(s.iri)).toBeNull()
  })

  it('time windows: covered with ≥ 30 min overlap (default Morgen/Nachmittag/Abend)', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '11:00', '12:20')
    b.entry(b.activity('b', CAT_LS), 2, '17:40', '19:00')
    expect(makeCtx(b.facts).js.days[1].windowsCovered).toEqual(['morgen', 'abend'])
    const w = [{ id: 'x', label: 'X', from: 0, to: 60 }]
    expect(windowsCovered([{ from: 40, to: 100 }], w, 30)).toEqual([])
    expect(windowsCovered([{ from: 30, to: 100 }], w, 30)).toEqual(['x'])
  })
})
