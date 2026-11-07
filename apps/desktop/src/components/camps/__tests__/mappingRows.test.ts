import { describe, expect, it } from 'vitest'
import { buildMappingRows, mappingDirty } from '../mappingRows'
import type { ActivityFact, CategoryFact, CategoryMapping } from '@/domain/types'

const cats = [
  { iri: '/c1', short: 'LS', name: 'Sport', color: '#fff', numberingStyle: null },
  { iri: '/c2', short: 'X', name: 'Andere', color: '#000', numberingStyle: null },
] as CategoryFact[]
const acts = [{ categoryIri: '/c1' }, { categoryIri: '/c1' }, { categoryIri: null }] as ActivityFact[]

describe('mappingRows', () => {
  it('counts activities and falls back guess -> NONE', () => {
    const rows = buildMappingRows(cats, acts, [{ categoryIri: '/c1', guess: 'LS', confidence: 'high', reason: 'short:LS' }], {})
    expect(rows[0]).toMatchObject({ activityCount: 2, guess: 'LS', selected: 'LS', confidence: 'high' })
    expect(rows[1]).toMatchObject({ activityCount: 0, guess: null, selected: 'NONE' })
  })
  it('draft wins over guess', () => {
    const rows = buildMappingRows(cats, acts, [{ categoryIri: '/c1', guess: 'LS', confidence: 'low', reason: '' }], { '/c1': 'LP' })
    expect(rows[0].selected).toBe('LP')
  })
  it('detects dirty state', () => {
    const m = { campIri: '/k', entries: { '/c1': 'LS' }, confirmed: true, confirmedAt: null, updatedAt: '' } as CategoryMapping
    expect(mappingDirty(m, { '/c1': 'LS' })).toBe(false)
    expect(mappingDirty(m, { '/c1': 'LA' })).toBe(true)
    expect(mappingDirty(null, {})).toBe(true)
  })
})
