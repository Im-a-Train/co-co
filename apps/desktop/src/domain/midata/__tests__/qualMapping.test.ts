import { describe, expect, it } from 'vitest'
import type { CampFacts, MidataAggregate, MidataQualKey } from '../../types'
import { buildQualificationMatrix, effectiveKeys, isUnmappedKind, nextQualMapping, qualMappingChanged } from '../index'

const emptyFacts = { activities: [], collaborators: [], activityResponsibles: [] } as unknown as CampFacts
const agg = (over: Partial<MidataAggregate> = {}): MidataAggregate => ({ leaders: [], fetchedAt: 't', ...over }) as unknown as MidataAggregate

describe('qualification readability + keywords', () => {
  it('defaults to readable, honours qualificationsReadable=false', () => {
    expect(buildQualificationMatrix(agg(), emptyFacts, () => []).qualificationsReadable).toBe(true)
    expect(buildQualificationMatrix(agg({ qualificationsReadable: false }), emptyFacts, () => []).qualificationsReadable).toBe(false)
  })
  it('passes matched keywords to the activity checks', () => {
    const facts = {
      activities: [{ iri: '/a', title: 'Skitour' }],
      collaborators: [],
      activityResponsibles: [],
    } as unknown as CampFacts
    const m = buildQualificationMatrix(agg(), facts, () => ['berg'], (_iri, area) => (area === 'berg' ? ['berg', 'ski'] : []))
    expect(m.activities[0]!.keywords).toEqual(['berg', 'ski'])
    expect(buildQualificationMatrix(agg(), facts, () => ['berg']).activities[0]!.keywords).toEqual([])
  })
})

describe('qualification kind mapping', () => {
  const kinds = [
    { label: 'Wasser', keys: ['wasser'] as MidataQualKey[], validLeaders: 1, expiredLeaders: 0 },
    { label: 'J+S-Coach', keys: [] as MidataQualKey[], validLeaders: 1, expiredLeaders: 1 },
  ]
  it('effectiveKeys: override wins, [] ignores, order is stable', () => {
    expect(effectiveKeys(kinds[0]!, {})).toEqual(['wasser'])
    expect(effectiveKeys(kinds[0]!, { Wasser: ['slrg', 'wasser'] })).toEqual(['wasser', 'slrg'])
    expect(effectiveKeys(kinds[0]!, { Wasser: [] })).toEqual([])
  })
  it('isUnmappedKind: only without keys and without override', () => {
    expect(isUnmappedKind(kinds[1]!, {})).toBe(true)
    expect(isUnmappedKind(kinds[1]!, { 'J+S-Coach': [] })).toBe(false)
    expect(isUnmappedKind(kinds[0]!, {})).toBe(false)
  })
  it('nextQualMapping keeps the override map minimal', () => {
    expect(nextQualMapping({}, kinds, { Wasser: ['wasser'], 'J+S-Coach': [] })).toEqual({})
    expect(nextQualMapping({}, kinds, { 'J+S-Coach': ['leiterLsT'] })).toEqual({ 'J+S-Coach': ['leiterLsT'] })
    expect(nextQualMapping({ Other: ['berg'] }, kinds, { Wasser: ['berg', 'wasser'] })).toEqual({ Other: ['berg'], Wasser: ['wasser', 'berg'] })
    expect(nextQualMapping({ Wasser: ['wasser'] }, kinds, { Wasser: ['wasser'] })).toEqual({ Wasser: ['wasser'] })
  })
  it('qualMappingChanged compares with the effective keys', () => {
    expect(qualMappingChanged(kinds, {}, { Wasser: ['wasser'] })).toBe(false)
    expect(qualMappingChanged(kinds, {}, { Wasser: ['wasser', 'slrg'] })).toBe(true)
    expect(qualMappingChanged(kinds, { 'J+S-Coach': ['berg'] }, { 'J+S-Coach': ['berg'] })).toBe(false)
  })
})
