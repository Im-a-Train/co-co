import { describe, expect, it } from 'vitest'
import { bwzRequiredMinutes, computeJsDays, jsModelDayReasons, reportFromJsModel, thresholdsFromParams } from '../lib/jsDays'
import { CAT_LS, FactsBuilder, makeCtx, type CtxOverrides } from './factory'

function setup(b: FactsBuilder, over: CtxOverrides = {}) {
  const ctx = makeCtx(b.facts, over)
  const t = thresholdsFromParams(ctx.params)
  const bwz = bwzRequiredMinutes(ctx.params)
  const legacy = computeJsDays(b.facts, ctx.mapping, t)
  return { ctx, t, bwz, legacy, model: ctx.js }
}

describe('jsModelDayReasons', () => {
  it('2026: valid day has no reasons; none required for bwz', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 }).validDay(2)
    const { model, t, bwz } = setup(b)
    expect(bwz).toBeNull()
    expect(jsModelDayReasons(model.days[1], model, t, bwz)).toEqual([])
  })

  it('fewUnits and tooShort', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('A', CAT_LS), 2, '09:00', '10:00')
    const { model, t, bwz } = setup(b)
    expect(jsModelDayReasons(model.days[1], model, t, bwz)).toEqual([
      { code: 'fewUnits', units: 1, required: 2 },
      { code: 'tooShort', minutes: 60, required: 240 },
    ])
  })

  it('bwz: 2027 day with enough units and minutes but too little movement time', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 3 })
    b.entry(b.activity('V', CAT_LS), 2, '09:00', '11:00', { ys: 50 })
    b.entry(b.activity('N', CAT_LS), 2, '14:00', '16:00', { ys: 50 })
    const { model, t, bwz } = setup(b)
    expect(bwz).toBe(120)
    expect(jsModelDayReasons(model.days[1], model, t, bwz)).toEqual([{ code: 'bwz', minutes: 100, required: 120 }])
  })

  it('gap: short Sozialzeit merges the units (fewUnits) and is reported', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('V', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('N', CAT_LS), 2, '11:15', '13:15')
    const { model, t, bwz } = setup(b)
    const r = jsModelDayReasons(model.days[1], model, t, bwz)
    expect(r.map((x) => x.code)).toEqual(['fewUnits', 'gap'])
    expect(r[1]).toMatchObject({ code: 'gap', minutes: 15, required: 30, start: '2026-07-13T11:00:00+00:00', end: '2026-07-13T11:15:00+00:00' })
  })

  it('shortUnit: the model decides which entries are short, the units give the details', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    const kurz = b.activity('Kurz', CAT_LS)
    const e = b.entry(kurz, 2, '09:00', '09:20')
    b.entry(b.activity('V', CAT_LS), 2, '10:00', '12:00')
    const { model, t, bwz, legacy } = setup(b)
    const units = legacy.days.flatMap((d) => d.units)
    expect(jsModelDayReasons(model.days[1], model, t, bwz).some((r) => r.code === 'shortUnit')).toBe(false)
    expect(jsModelDayReasons(model.days[1], model, t, bwz, units)).toContainEqual({
      code: 'shortUnit',
      activityIri: kurz.iri,
      minutes: 20,
      start: e.start,
      end: e.end,
      required: 30,
    })
    // Not on another day, even with all units of the camp at hand.
    expect(jsModelDayReasons(model.days[0], model, t, bwz, units).some((r) => r.code === 'shortUnit')).toBe(false)
  })

  it('shortUnit: an entry tagged «keine J+S-Aktivität» is no J+S unit, so it is no reason either', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    const kurz = b.activity('Kurz', CAT_LS)
    b.entry(kurz, 2, '09:00', '09:20')
    b.entry(b.activity('V', CAT_LS), 2, '10:00', '12:00')
    const { model, t, bwz, legacy } = setup(b, { campConfig: { activityTags: { [kurz.iri]: ['keine-js-aktivitaet'] } } })
    // The legacy calculator only knows the mapping and still sees a short unit …
    expect(legacy.days[1].units.some((u) => !u.longEnough)).toBe(true)
    // … the model (and so the reasons) does not.
    const r = jsModelDayReasons(model.days[1], model, t, bwz, legacy.days.flatMap((d) => d.units))
    expect(r.map((x) => x.code)).toEqual(['fewUnits', 'tooShort'])
  })

  it('combinedOnly on the end days of a pair', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('A', CAT_LS), 1, '14:00', '16:00')
    b.entry(b.activity('B', CAT_LS), 3, '09:00', '11:00')
    const { model, t, bwz } = setup(b)
    expect(model.endDaysMode).toBe('combined')
    expect(jsModelDayReasons(model.days[0], model, t, bwz).map((r) => r.code)).toEqual(['fewUnits', 'tooShort', 'combinedOnly'])
    expect(jsModelDayReasons(model.days[1], model, t, bwz).map((r) => r.code)).toEqual(['fewUnits', 'tooShort'])
  })
})

describe('reportFromJsModel', () => {
  /** 2027 camp, 5 days: interior days fine, end days 2x2h with 40 min BWZ each (pair fails the 120 min BWZ). */
  function bwzCamp() {
    const b = new FactsBuilder({ start: '2027-07-12', days: 5 })
    for (const d of [2, 3, 4]) {
      b.entry(b.activity(`V${d}`, CAT_LS), d, '09:00', '11:00', { ys: 60 })
      b.entry(b.activity(`N${d}`, CAT_LS), d, '14:00', '16:00', { ys: 60 })
    }
    for (const d of [1, 5]) {
      b.entry(b.activity(`V${d}`, CAT_LS), d, '09:00', '11:00', { ys: 40 })
      b.entry(b.activity(`N${d}`, CAT_LS), d, '14:00', '16:00')
    }
    return b
  }

  it('takes validity, count and total from the model; end days failing BWZ do not count', () => {
    const { model, t, bwz, legacy } = setup(bwzCamp())
    expect(legacy.validDayCount).toBe(5) // legacy ignores BWZ
    const rep = reportFromJsModel(model, legacy, t, bwz)
    expect(model.jsDayCount).toBe(3)
    expect(rep.validDayCount).toBe(3)
    expect(rep.totalDayCount).toBe(5)
    expect(rep.days.map((d) => d.valid || d.validCombined)).toEqual([false, true, true, true, false])
    expect(rep.days[0].reasons).toEqual([{ code: 'bwz', minutes: 40, required: 120 }])
    expect(rep.days[2].reasons).toEqual([])
  })

  it('fills shortUnit details from the legacy units', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('Kurz', CAT_LS), 2, '09:00', '09:20')
    b.entry(b.activity('V', CAT_LS), 2, '10:00', '12:00')
    const { model, t, bwz, legacy } = setup(b)
    const rep = reportFromJsModel(model, legacy, t, bwz)
    expect(rep.days[1].reasons?.map((r) => r.code)).toEqual(['fewUnits', 'tooShort', 'shortUnit'])
    // Minutes follow the model (the 20 min entry does not count), units/gaps stay legacy for the grid.
    expect(rep.days[1]).toMatchObject({ jsMinutes: 120, unitCount: 1 })
    expect(rep.days[1].units).toHaveLength(2)
  })

  it('combined end days count once and total shrinks by one', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 4 })
    b.validDay(2).validDay(3)
    b.entry(b.activity('A', CAT_LS), 1, '14:00', '16:00')
    b.entry(b.activity('B', CAT_LS), 4, '09:00', '11:00')
    const { model, t, bwz, legacy } = setup(b)
    const rep = reportFromJsModel(model, legacy, t, bwz)
    expect(rep.validDayCount).toBe(model.jsDayCount)
    expect(rep.validDayCount).toBe(3)
    expect(rep.totalDayCount).toBe(3)
    expect(rep.days[0]).toMatchObject({ valid: false, validCombined: true, combinedWith: rep.days[3].dayIri })
    expect(rep.days[3]).toMatchObject({ valid: false, validCombined: true, combinedWith: rep.days[0].dayIri })
  })
})
