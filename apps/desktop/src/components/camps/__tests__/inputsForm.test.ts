import { describe, expect, it } from 'vitest'
import { emptyCoachInputs } from '@/domain/campFacts/store'
import { loadBundledPacks } from '@/domain/rules/packs'
import { fromTri, INPUT_RULES, MISSING_INPUT_FIELDS, missingInputKeys, normalizeInputs, parseCount, parseDate, toTri, validateInputs } from '../inputsForm'

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

describe('INPUT_RULES / MISSING_INPUT_FIELDS', () => {
  const ids = new Set(loadBundledPacks().flatMap((p) => p.rules.map((r) => r.meta.id)))
  it('every referenced rule id exists in the bundled packs', () => {
    const referenced = [...Object.values(INPUT_RULES).flat(), ...Object.keys(MISSING_INPUT_FIELDS)]
    expect(referenced.filter((id) => !ids.has(id as string))).toEqual([])
  })
  it('points stufe and leadersCount at the rules that read them', () => {
    expect(INPUT_RULES.stufe).toContain('LST-TREK-02')
    expect(INPUT_RULES.leadersCount).toEqual(['BP-WOLF-01'])
  })
  it('lists the missing inputs of coachInputs findings once, in order', () => {
    const f = (ruleId: string, needsInput?: string) => ({ ruleId, needsInput })
    expect(missingInputKeys([f('JS-LL-01', 'coachInputs'), f('JS-CAMP-02', 'coachInputs'), f('JS-LL-01', 'coachInputs'), f('JS-STAFF-02', 'midata'), f('JS-CAMP-01')])).toEqual([
      'lagerleiterAttested',
      'participantsJsAgeCount',
    ])
  })
})

