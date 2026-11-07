import { describe, expect, it } from 'vitest'
import { emptyCoachInputs } from '@/domain/campFacts/store'
import { fromTri, normalizeInputs, parseCount, parseDate, toTri, validateInputs } from '../inputsForm'

describe('inputsForm', () => {
  it('parses counts', () => {
    expect(parseCount('')).toBeNull()
    expect(parseCount('12')).toBe(12)
    expect(parseCount(-1)).toBeNull()
    expect(parseCount('x')).toBeNull()
    expect(parseCount(3.7)).toBe(3)
  })
  it('parses dates and tri-state', () => {
    expect(parseDate('2031-01-02')).toBe('2031-01-02')
    expect(parseDate('02.01.2031')).toBeNull()
    expect(toTri(null)).toBe('unknown')
    expect(fromTri(toTri(true))).toBe(true)
    expect(fromTri(toTri(false))).toBe(false)
    expect(fromTri('unknown')).toBeNull()
  })
  it('normalizes and validates', () => {
    const i = { ...emptyCoachInputs('/k'), participantsCount: '5' as never, minAge: 15, maxAge: 10, participantsJsAgeCount: 9 }
    const n = normalizeInputs(i)
    expect(n.participantsCount).toBe(5)
    expect(validateInputs(n)).toEqual(['ageRange', 'jsAgeCount'])
  })
})
