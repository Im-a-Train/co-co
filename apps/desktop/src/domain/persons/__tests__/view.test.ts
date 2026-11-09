/** Synthetic data only. */
import { describe, expect, it } from 'vitest'
import { diffPersons } from '../diff'
import type { MidataPersonRow, NdsPersonRow } from '../types'
import { filterRows, NO_FILTERS, ndsRoleKey, summarizePersons, toViewRows } from '../view'

const mp = (id: string, o: Partial<MidataPersonRow> = {}): MidataPersonRow => ({
  __red: true, id, firstName: 'Test', lastName: 'Muster', nickname: null, birthDate: '2012-03-04',
  gender: null, kind: 'participant', roleLabels: ['TN'], qualifications: {}, ...o,
})
const np = (id: string, o: Partial<NdsPersonRow> = {}): NdsPersonRow => ({
  __red: true, id, personNumber: '77', firstName: 'Test', lastName: 'Muster', birthDate: '2012-03-04',
  kind: 'participant', roleLabel: null, ...o,
})

describe('person view rows', () => {
  const diff = diffPersons(
    [mp('1', { nickname: 'Fuchs' }), mp('2', { firstName: 'Alma', kind: 'guest', birthDate: null }), mp('3', { firstName: 'Bea', birthDate: '1990-01-01', kind: 'leader' })],
    [np('a'), np('b', { firstName: 'Nur', lastName: 'Nds' })],
  )
  const rows = toViewRows(diff, '2031-07-20', true)

  it('derives state, age and J+S flag', () => {
    const fuchs = rows.find((r) => r.nickname === 'Fuchs')!
    expect(fuchs.state).toBe('match')
    expect(fuchs.age).toBe(19)
    expect(fuchs.jsAge).toBe(true)
    expect(fuchs.ndsNumber).toBe('77')
    expect(rows.find((r) => r.firstName === 'Alma')!.state).toBe('notRelevant')
    expect(rows.find((r) => r.firstName === 'Bea')!.jsAge).toBe(false)
    expect(rows.find((r) => r.firstName === 'Nur')!.state).toBe('only_in_nds')
  })
  it('shows notCompared until both sides are loaded', () => {
    expect(toViewRows(diff, null, false).every((r) => r.state === 'notCompared')).toBe(true)
  })
  it('filters by text (umlaut-insensitive), kind, state and J+S age', () => {
    expect(filterRows(rows, { ...NO_FILTERS, text: 'fuchs' })).toHaveLength(1)
    expect(filterRows(rows, { ...NO_FILTERS, kinds: ['leader'] })).toHaveLength(1)
    expect(filterRows(rows, { ...NO_FILTERS, states: ['only_in_nds'] })).toHaveLength(1)
    expect(filterRows(rows, { ...NO_FILTERS, jsAge: 'no' }).every((r) => !r.jsAge)).toBe(true)
  })
})

describe('NDS role codes', () => {
  it('maps known codes and leaves unknown ones raw', () => {
    expect(ndsRoleKey('CHILD')).toBe('CHILD')
    expect(ndsRoleKey('ADOLESCENT')).toBe('ADOLESCENT')
    expect(ndsRoleKey('SOMETHING_NEW')).toBeNull()
  })
  it('flags NDS-only roles', () => {
    const rows = toViewRows(diffPersons([], [np('z', { roleLabel: 'CHILD' })]), null, true)
    expect(rows[0].rolesFromNds).toBe(true)
  })
})

describe('Rega state and summary', () => {
  const diff = diffPersons(
    [mp('1'), mp('2', { firstName: 'Bea' }), mp('3', { firstName: 'Cy' })],
    [
      np('a', { regaTransmitted: true }),
      np('b', { firstName: 'Bea', personNumber: '78', regaTransmitted: false }),
      np('c', { firstName: 'Cy', personNumber: '79' }),
      np('d', { firstName: 'Nur', lastName: 'Nds', personNumber: '80', regaTransmitted: false }),
    ],
  )
  const rows = toViewRows(diff, '2031-07-20', true)

  it('maps the Rega state of NDS participants', () => {
    expect(rows.find((r) => r.firstName === 'Bea')!.rega).toBe(false)
    expect(rows.find((r) => r.firstName === 'Cy')!.rega).toBeNull()
    expect(rows.find((r) => r.ndsNumber === '77')!.rega).toBe(true)
  })
  it('filters Rega fehlt', () => {
    const shown = filterRows(rows, { ...NO_FILTERS, rega: 'missing' })
    expect(shown).toHaveLength(2)
    expect(shown.every((r) => r.rega === false)).toBe(true)
  })
  it('summarizes counts, differences and Rega', () => {
    const s = summarizePersons(rows)
    expect(s.compared).toBe(true)
    expect(s.regaKnown).toBe(true)
    expect(s.regaMissing).toBe(2)
    expect(summarizePersons(toViewRows(diff, null, false)).compared).toBe(false)
    expect(summarizePersons([])).toMatchObject({ compared: false, differences: 0, regaKnown: false, regaMissing: 0 })
  })
})
