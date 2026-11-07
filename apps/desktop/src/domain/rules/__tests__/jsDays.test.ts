import { describe, expect, it } from 'vitest'
import { computeJsDays, hasJsMapping, lastJsDate, trainingFreeDays } from '../jsDays'
import { CAT_ES, CAT_LA, CAT_LS, CAT_NONE, FactsBuilder, MAPPING, mappingOf } from './factory'

describe('computeJsDays', () => {
  it('counts a day with 2 units and >= 240 min as valid', () => {
    const b = new FactsBuilder({ days: 3 }).validDay(2)
    const r = computeJsDays(b.facts, MAPPING)
    expect(r.days[1]).toMatchObject({ unitCount: 2, jsMinutes: 240, valid: true })
    expect(r.days[1].gaps).toEqual([expect.objectContaining({ minutes: 180, ok: true })])
  })

  it('only LS/LA entries count; LP/ES/NONE/unknown do not', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('Essen', CAT_ES), 2, '12:00', '13:00')
    b.entry(b.activity('Frei', CAT_NONE), 2, '13:00', '14:00')
    b.entry(b.activity('Ohne Kat', null), 2, '14:00', '15:00')
    b.entry(b.activity('LS', CAT_LS), 2, '15:00', '17:00')
    expect(computeJsDays(b.facts, MAPPING).days[1].unitCount).toBe(1)
    expect(computeJsDays(b.facts, null).days[1].unitCount).toBe(0)
  })

  it('invalid with < 240 minutes, < 2 units, a short unit or a short gap', () => {
    const b = new FactsBuilder({ days: 4 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '14:00', '15:30') // 210 min
    b.entry(b.activity('c', CAT_LS), 3, '09:00', '13:00') // 1 unit
    b.entry(b.activity('d', CAT_LS), 4, '09:00', '09:20') // short
    b.entry(b.activity('e', CAT_LS), 4, '09:40', '13:00') // gap 20
    const days = computeJsDays(b.facts, MAPPING).days
    expect(days[1]).toMatchObject({ jsMinutes: 210, valid: false })
    expect(days[2]).toMatchObject({ unitCount: 1, valid: false })
    expect(days[3].units[0].longEnough).toBe(false)
    expect(days[3].gaps[0]).toMatchObject({ minutes: 20, ok: false })
    expect(days[3].valid).toBe(false)
  })

  it('treats exactly 240 min and exactly 30 min gaps/units as ok', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:30')
    b.entry(b.activity('b', CAT_LA), 2, '12:00', '13:30')
    const d = computeJsDays(b.facts, MAPPING).days[1]
    expect(d.gaps[0]).toMatchObject({ minutes: 30, ok: true })
    expect(d).toMatchObject({ jsMinutes: 240, valid: true })
  })

  it('sorts units by start and measures gaps between consecutive ones', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('late', CAT_LS), 2, '15:00', '17:00')
    b.entry(b.activity('early', CAT_LS), 2, '09:00', '11:00')
    const d = computeJsDays(b.facts, MAPPING).days[1]
    expect(d.units.map((u) => u.start.slice(11, 16))).toEqual(['09:00', '15:00'])
    expect(d.gaps[0].minutes).toBe(240)
  })

  it('combines arrival and departure day when together >= 240 min', () => {
    const b = new FactsBuilder({ days: 4 })
    b.entry(b.activity('an', CAT_LS), 1, '16:00', '18:00')
    b.entry(b.activity('ab', CAT_LA), 4, '09:00', '11:00')
    b.validDay(2).validDay(3)
    const r = computeJsDays(b.facts, MAPPING)
    expect(r.days[0]).toMatchObject({ valid: false, validCombined: true, combinedWith: b.dayIri(4) })
    expect(r.days[3]).toMatchObject({ validCombined: true, combinedWith: b.dayIri(1) })
    expect(r.validDayCount).toBe(3)
    expect(r.totalDayCount).toBe(3)
  })

  it('does not combine when the combination is too short', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('an', CAT_LS), 1, '16:00', '17:00')
    b.entry(b.activity('ab', CAT_LA), 3, '09:00', '10:00')
    b.validDay(2)
    const r = computeJsDays(b.facts, MAPPING)
    expect(r.days[0].combinedWith).toBeNull()
    expect(r.validDayCount).toBe(1)
    expect(r.totalDayCount).toBe(3)
  })

  it('does not combine when both edge days are valid on their own', () => {
    const b = new FactsBuilder({ days: 3 }).validDay(1).validDay(3)
    const r = computeJsDays(b.facts, MAPPING)
    expect(r.days[0].combinedWith).toBeNull()
    expect(r.validDayCount).toBe(2)
    expect(r.totalDayCount).toBe(3)
  })

  it('assigns entries by date when dayIri is missing and handles a single-day camp', () => {
    const b = new FactsBuilder({ days: 1 })
    const e1 = b.entry(b.activity('a', CAT_LS), 1, '09:00', '11:00')
    const e2 = b.entry(b.activity('b', CAT_LS), 1, '14:00', '16:00')
    e1.dayIri = null
    e2.dayIri = null
    const r = computeJsDays(b.facts, MAPPING)
    expect(r.days).toHaveLength(1)
    expect(r.days[0].valid).toBe(true)
    expect(r.validDayCount).toBe(1)
  })

  it('returns no days for a camp without days', () => {
    expect(computeJsDays(new FactsBuilder({ days: 0 }).facts, MAPPING)).toEqual({ days: [], validDayCount: 0, totalDayCount: 0 })
  })

  it('helpers: hasJsMapping, lastJsDate, trainingFreeDays', () => {
    expect(hasJsMapping(MAPPING)).toBe(true)
    expect(hasJsMapping(mappingOf({ [CAT_ES]: 'ES' }))).toBe(false)
    expect(hasJsMapping(null)).toBe(false)
    const b = new FactsBuilder({ days: 4 }).validDay(2)
    const r = computeJsDays(b.facts, MAPPING)
    expect(lastJsDate(r)).toBe(b.dateOf(2))
    expect(trainingFreeDays(r).map((d) => d.number)).toEqual([1, 3, 4])
  })

  it('counts overlapping units once and takes gaps from the running max end', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('A', CAT_LS), 2, '08:00', '12:00')
    b.entry(b.activity('B', CAT_LS), 2, '09:00', '10:00')
    b.entry(b.activity('C', CAT_LA), 2, '10:15', '11:00')
    const d = computeJsDays(b.facts, MAPPING).days[1]
    expect(d.jsMinutes).toBe(240)
    expect(d.gaps).toEqual([])
  })
})
