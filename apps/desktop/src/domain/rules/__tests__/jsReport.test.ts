import { describe, expect, it } from 'vitest'
import { loadBundledPacks } from '../packs'
import { campJsReport, jsMinDaysOf, lastModelJsDate } from '../lib/jsReport'
import { CAT_LS, FactsBuilder, makeCtx, MAPPING } from './factory'

describe('campJsReport', () => {
  it('is the model-derived answer (2027 BWZ counts) and null without a usable mapping', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 3 })
    b.entry(b.activity('V', CAT_LS), 2, '09:00', '11:00', { ys: 50 })
    b.entry(b.activity('N', CAT_LS), 2, '14:00', '16:00', { ys: 50 })
    const ctx = makeCtx(b.facts)
    const packs = loadBundledPacks()
    const r = campJsReport(packs, { facts: b.facts, mapping: MAPPING, coachInputs: null, documents: [], settings: ctx.settings, now: new Date('2027-01-01'), userDisplayName: null, overrides: [], campConfig: null })
    expect(r?.report.validDayCount).toBe(0)
    expect(r?.report.totalDayCount).toBe(3)
    expect(r?.lastJsDate).toBe('2027-07-13')
    expect(r && lastModelJsDate(r.model)).toBe('2027-07-13')
    expect(campJsReport(packs, { facts: b.facts, mapping: null, coachInputs: null, documents: [], settings: ctx.settings, now: new Date('2027-01-01'), userDisplayName: null, overrides: [], campConfig: null })).toBeNull()
  })
  it('jsMinDaysOf reads js.minConsecutiveDays, or the offer-partner value like JS-CAMP-01', () => {
    const facts = new FactsBuilder().facts
    expect(jsMinDaysOf(makeCtx(facts))).toBe(4)
    const angebot = { other4DayCamp: true, unternehmungElsewhere: null, efCoveredElsewhere: null, lastActivityDate: null }
    expect(jsMinDaysOf(makeCtx(facts, { campConfig: { angebot } }))).toBe(3)
  })
})
