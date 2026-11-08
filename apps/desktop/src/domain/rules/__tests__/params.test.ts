/** Params (catalog v2 §3.4): validity by camp start, contiguity, overrides. */
import { describe, expect, it } from 'vitest'
import { createParamReader, parseParamDefs, validateRows } from '../lib/params'
import { paramDefsOf } from '../lib/context'
import { loadBundledPacks } from '../packs'
import type { ParamDef } from '@/domain/types'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import { FactsBuilder, makeCtx } from './factory'

const defs = paramDefsOf(loadBundledPacks())
const reader = (date: string, admin = {}, camp = {}) => createParamReader({ defs, date, adminParams: admin, campParams: camp })

describe('bundled params', () => {
  it('resolve by camp start date (2026 vs 2027)', () => {
    expect(reader('2026-07-12').get('js.consecutiveMode')).toBe('calendar')
    expect(reader('2027-07-12').get('js.consecutiveMode')).toBe('jsDaysSkipping')
    expect(reader('2026-12-31').get('js.minBwzDayMinutes')).toBeNull()
    expect(reader('2027-01-01').get('js.minBwzDayMinutes')).toBe(120)
    expect(reader('2026-07-12').get('js.bwzStepMinutes')).toBeNull()
    expect(reader('2027-07-12').get('js.bwzStepMinutes')).toBe(15)
  })

  it('keep today’s values for the migrated rules', () => {
    const r = reader('2026-07-12')
    expect([r.get('js.minUnitMinutes'), r.get('js.minGapMinutes'), r.get('js.minDayMinutes'), r.get('js.minDayUnits')]).toEqual([30, 30, 240, 2])
    expect([r.get('js.minConsecutiveDays'), r.get('js.minParticipants'), r.get('js.participantsDiffTolerance')]).toEqual([4, 12, 0.2])
    expect([r.get('js.ndsRegistrationLeadDays'), r.get('js.ndsClosingDays'), r.get('js.leihmaterialLeadDays')]).toEqual([30, 30, 35])
    expect([r.get('js.landeskartenLeadDays'), r.get('js.landeskartenLeadDaysSummer'), r.get('js.landeskartenSummerMonths')]).toEqual([21, 35, [6, 7, 8]])
    expect([r.get('lst.ropeMinSafetyChars'), r.get('lst.nightEndTime'), r.get('lst.minRestMinutes'), r.get('lst.warmupHeadChars')]).toEqual([200, '22:00', 510, 400])
    expect(r.get('lst.morningWindow')).toEqual({ from: '05:00', to: '14:00' })
    expect([r.get('pbs.restGapMinutes'), r.get('pbs.wolfParticipantsPerLeader'), r.get('pbs.slrgParticipantsPerPerson'), r.get('pbs.progressLeadDays')]).toEqual([60, 6, 12, 21])
    expect(r.get('pbs.restWindow')).toEqual({ from: '07:00', to: '22:00' })
    expect(r.get('pbs.sleepHours')).toEqual({ biber: 11, woelfe: 10, pfadi: 9, pios: 8.5, rover: 8, gemischt: 9 })
    expect([r.get('lst.varMinUnits'), r.get('lst.varMinDistinct'), r.get('js.deadlineSoonDays')]).toEqual([4, 2, 14])
  })

  it('every key covers the whole time line from 2026-01-01', () => {
    for (const d of defs) {
      expect(validateRows(d.values), d.key).toEqual([])
      expect(d.values[0].validFrom, d.key).toBe('2026-01-01')
    }
  })

  it('unknown keys and dates before the first row throw', () => {
    expect(() => reader('2026-07-12').get('js.nope')).toThrow(/js\.nope/)
    expect(() => reader('2025-07-12').get('js.minDayMinutes')).toThrow(/kein Wert/)
  })
})

describe('overrides', () => {
  it('coach (campConfig) only for overridable: coach; admin (settings) for admin|coach', () => {
    const r = reader('2026-07-12', { 'lst.treelineM': 1900, 'js.minDayMinutes': 200 }, { 'lst.ropeMinSafetyChars': 100, 'js.minParticipants': 5 })
    expect(r.get('lst.ropeMinSafetyChars')).toBe(100) // coach
    expect(r.isOverridden('lst.ropeMinSafetyChars')).toEqual({ value: 100, default: 200 })
    expect(r.get('js.minParticipants')).toBe(12) // none: camp override ignored
    expect(r.get('js.minDayMinutes')).toBe(240) // none: admin override ignored
    expect(r.get('lst.treelineM')).toBe(1900) // coach param, admin value applies
    expect(r.isOverridden('js.minParticipants')).toBeNull()
  })

  it('camp value beats the admin value; an override equal to the default is no override', () => {
    const r = reader('2026-07-12', { 'lst.ropeMinSafetyChars': 300 }, { 'lst.ropeMinSafetyChars': 150 })
    expect(r.get('lst.ropeMinSafetyChars')).toBe(150)
    expect(reader('2026-07-12', {}, { 'lst.ropeMinSafetyChars': 200 }).isOverridden('lst.ropeMinSafetyChars')).toBeNull()
  })

  it('ctx.params uses campConfig.params and settings.ruleParams', () => {
    const facts = new FactsBuilder({ start: '2026-07-12' }).facts
    const ctx = makeCtx(facts, {
      campConfig: { params: { 'lst.ropeMinSafetyChars': 120 } },
      settings: { ...DEFAULT_APP_SETTINGS, ruleParams: { 'lst.bergSuggestAltitude': 1500 } },
    })
    expect(ctx.params.get('lst.ropeMinSafetyChars')).toBe(120)
    expect(ctx.params.get('lst.bergSuggestAltitude')).toBe(1500)
  })
})

describe('parseParamDefs', () => {
  const base = { key: 'x.a', label: 'A', unit: 'days', overridable: 'none' }
  it('rejects gaps, overlaps, a closed last row and bad overridable', () => {
    expect(() =>
      parseParamDefs([{ ...base, values: [{ value: 1, validFrom: '2026-01-01', validTo: '2026-06-30' }, { value: 2, validFrom: '2026-08-01' }] }], 't'),
    ).toThrow(/Lücke/)
    expect(() => parseParamDefs([{ ...base, values: [{ value: 1, validFrom: '2026-01-01', validTo: '2026-12-31' }] }], 't')).toThrow(/offen/)
    expect(() => parseParamDefs([{ ...base, overridable: 'all', values: [{ value: 1, validFrom: '2026-01-01' }] }], 't')).toThrow(/overridable/)
  })
  it('parses YAML dates in values to ISO strings', () => {
    const [d] = parseParamDefs([{ ...base, values: [{ value: { from: new Date('2026-12-11') }, validFrom: new Date('2026-01-01') }] }], 't') as ParamDef[]
    expect(d.values[0]).toEqual({ value: { from: '2026-12-11' }, validFrom: '2026-01-01' })
  })
})
