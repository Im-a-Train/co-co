import { describe, expect, it } from 'vitest'
import { adoptNdsFields } from '@/composables/useNds'
import { countEntries, ndsPreChecked, ndsValueKey } from '../format'

describe('nds format helpers', () => {
  it('countEntries sorts by count, keeps unknown codes raw', () => {
    const rows = countEntries({ B_CODE: 1, A_CODE: 3, C_CODE: 1 })
    expect(rows.map((r) => r.code)).toEqual(['A_CODE', 'B_CODE', 'C_CODE'])
    expect(rows[0].n).toBe(3)
    expect(rows[0].label).toBeTruthy()
  })
  it('ndsValueKey', () => {
    expect(ndsValueKey(null)).toBeNull()
    expect(ndsValueKey(true)).toEqual({ key: 'yes' })
    expect(ndsValueKey('2026-05-03')).toEqual({ text: '2026-05-03' })
  })
  it('ndsPreChecked only when NDS value known, differs and current is empty or no', () => {
    expect(ndsPreChecked({ ndsValue: true, currentValue: null, same: false })).toBe(true)
    expect(ndsPreChecked({ ndsValue: true, currentValue: false, same: false })).toBe(true)
    expect(ndsPreChecked({ ndsValue: '2026-05-03', currentValue: '2026-05-01', same: false })).toBe(false)
    expect(ndsPreChecked({ ndsValue: null, currentValue: null, same: false })).toBe(false)
    expect(ndsPreChecked({ ndsValue: true, currentValue: true, same: true })).toBe(false)
  })
})

describe('adoptNdsFields', () => {
  it('is exported for the Lager-Angaben view', () => {
    expect(typeof adoptNdsFields).toBe('function')
  })
})
