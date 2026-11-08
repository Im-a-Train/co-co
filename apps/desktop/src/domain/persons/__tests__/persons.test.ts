/** Synthetic data only (invented names). */
import { describe, expect, it } from 'vitest'
import { ageAt, isJsAge, maskBirthDate } from '../age'
import { diffPersons, isNdsRelevant } from '../diff'
import { exactKey, normalizeDate, normalizeName, splitKey } from '../match'
import type { MidataPersonRow, NdsPersonRow } from '../types'

let n = 0
const mp = (o: Partial<MidataPersonRow>): MidataPersonRow => ({
  __red: true,
  id: `m${++n}`,
  firstName: 'Test',
  lastName: 'Muster',
  nickname: null,
  birthDate: '2012-03-04',
  gender: null,
  kind: 'participant',
  roleLabels: [],
  qualifications: {},
  ...o,
})
const np = (o: Partial<NdsPersonRow>): NdsPersonRow => ({
  __red: true,
  id: `n${++n}`,
  personNumber: '1',
  firstName: 'Test',
  lastName: 'Muster',
  birthDate: '2012-03-04',
  kind: 'participant',
  roleLabel: null,
  ...o,
})

describe('normalisation', () => {
  it('handles umlauts, eszett, diacritics, dashes, spaces', () => {
    expect(normalizeName('  Jürg  ')).toBe('juerg')
    expect(normalizeName('Müller')).toBe(normalizeName('Mueller'))
    expect(normalizeName('Strauß')).toBe('strauss')
    expect(normalizeName('Hélène')).toBe('helene')
    expect(normalizeName('Anna–Maria')).toBe('anna-maria')
    expect(normalizeName('Anna   Maria')).toBe('anna maria')
  })
  it('normalises dates and rejects impossible ones', () => {
    expect(normalizeDate('04.03.2012')).toBe('20120304')
    expect(normalizeDate('2012-03-04')).toBe('20120304')
    expect(normalizeDate('4/3/2012')).toBe('20120304')
    expect(normalizeDate('2012-13-04')).toBe('')
    expect(normalizeDate('')).toBe('')
  })
  it('split key unifies double names', () => {
    const a = { firstName: 'Anna Maria', lastName: 'von Arx-Muster', birthDate: '2012-03-04' }
    const b = { firstName: 'Anna-Maria', lastName: 'von Arx Muster', birthDate: '04.03.2012' }
    expect(exactKey(a)).not.toBe(exactKey(b))
    expect(splitKey(a)).toBe(splitKey(b))
    expect(exactKey({ ...a, birthDate: null })).toBe('')
  })
})

describe('diffPersons', () => {
  it('matches umlaut spellings exactly', () => {
    const rows = diffPersons([mp({ lastName: 'Müller' })], [np({ lastName: 'Mueller' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('match')
    expect(rows[0]!.nds).not.toBeNull()
  })
  it('matches double names via the split key and reports the name difference', () => {
    const rows = diffPersons([mp({ firstName: 'Anna Maria' })], [np({ firstName: 'Anna-Maria' })])
    expect(rows[0]!.state).toBe('field_diff')
    expect(rows[0]!.differences).toEqual(['name'])
  })
  it('reports missing_in_nds and only_in_nds', () => {
    const rows = diffPersons([mp({ firstName: 'Alma' })], [np({ firstName: 'Bruno', lastName: 'Beispiel' })])
    expect(rows.map((r) => r.state).sort()).toEqual(['missing_in_nds', 'only_in_nds'])
  })
  it('swapped day/month stays a mismatch (suggestion only, never auto-accepted)', () => {
    const rows = diffPersons([mp({ birthDate: '2012-03-04' })], [np({ birthDate: '2012-04-03' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('ambiguous')
    expect(rows[0]!.nds).toBeNull()
    expect(rows[0]!.suggestions).toHaveLength(1)
  })
  it('duplicate keys are ambiguous on either side', () => {
    const dupNds = diffPersons([mp({})], [np({}), np({})])
    expect(dupNds.map((r) => r.state)).toEqual(['ambiguous'])
    expect(dupNds[0]!.suggestions).toHaveLength(2)
    const dupMidata = diffPersons([mp({}), mp({})], [np({})])
    expect(dupMidata.map((r) => r.state)).toEqual(['ambiguous', 'ambiguous'])
  })
  it('kind difference is a field_diff; kitchen/coach are not compared', () => {
    expect(diffPersons([mp({ kind: 'participant' })], [np({ kind: 'leader' })])[0]!.differences).toEqual(['kind'])
    expect(diffPersons([mp({ kind: 'kitchen' })], [np({ kind: 'leader' })])[0]!.state).toBe('match')
  })
  it('guests without birth date never auto-match, only suggest by name', () => {
    const rows = diffPersons([mp({ kind: 'guest', birthDate: null })], [np({})])
    expect(rows[0]!.state).toBe('ambiguous')
    expect(rows[0]!.nds).toBeNull()
    const none = diffPersons([mp({ kind: 'guest', birthDate: null, firstName: 'Gast' })], [])
    expect(none[0]!.state).toBe('missing_in_nds')
    expect(isNdsRelevant('guest')).toBe(false)
    expect(isNdsRelevant('leader')).toBe(true)
  })
})

describe('age', () => {
  it('computes completed years at camp start', () => {
    expect(ageAt('2012-03-04', '2031-03-03')).toBe(18)
    expect(ageAt('2012-03-04', '2031-03-04')).toBe(19)
    expect(ageAt(null, '2031-03-04')).toBeNull()
    expect(ageAt('2040-01-01', '2031-03-04')).toBeNull()
  })
  it('J+S age is 5-20', () => {
    expect([4, 5, 20, 21].map(isJsAge)).toEqual([false, true, true, false])
    expect(isJsAge(null)).toBe(false)
  })
  it('masks the date but keeps the year', () => {
    expect(maskBirthDate('2012-03-04')).toBe('••.••.2012')
    expect(maskBirthDate(null)).toBe('–')
  })
})
