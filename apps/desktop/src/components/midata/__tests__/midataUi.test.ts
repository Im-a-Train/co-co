import { describe, expect, it } from 'vitest'
import { areasOfActivity, makeAreaOf } from '../areas'
import { formatDate, formatStand, preChecked, valueKey } from '../format'
import type { ActivityFact } from '@/domain/types'

function act(iri: string, title: string, storyboardText = ''): ActivityFact {
  return {
    iri,
    title,
    location: null,
    categoryIri: null,
    progressLabelIri: null,
    rootContentNodeIri: null,
    responsibleIris: [],
    scheduleEntryIris: [],
    content: { storyboardText, safetyText: '', notesText: '', learningObjectivesText: '', materialText: '', laThematicAreas: [], learningTopics: [] },
  } as unknown as ActivityFact
}

describe('areas', () => {
  it('detects water, mountain and winter', () => {
    expect(areasOfActivity(act('a', 'Baden im See'))).toContain('wasser')
    expect(areasOfActivity(act('b', 'Wanderung zum Gipfel'))).toContain('berg')
    expect(areasOfActivity(act('c', 'Iglu bauen im Schnee'))).toContain('winter')
    expect(areasOfActivity(act('d', 'Postenlauf'))).toEqual([])
  })
  it('makeAreaOf handles unknown iris', () => {
    const f = makeAreaOf([act('a', 'Kanu fahren')])
    expect(f('a')).toContain('wasser')
    expect(f('zzz')).toEqual([])
  })
})

describe('format', () => {
  it('formats dates', () => {
    expect(formatDate('2026-07-12')).toBe('12.07.2026')
    expect(formatDate(null)).toBe('')
    expect(formatStand(new Date(2026, 6, 5, 9, 7).toISOString())).toBe('05.07.2026 09:07')
    expect(formatStand('kaputt')).toBe('kaputt')
  })
  it('valueKey', () => {
    expect(valueKey(null)).toBeNull()
    expect(valueKey(true)).toEqual({ key: 'yes' })
    expect(valueKey(0)).toEqual({ text: '0' })
  })
  it('preChecked only when different and current empty', () => {
    expect(preChecked({ midataValue: 5, currentValue: null, same: false })).toBe(true)
    expect(preChecked({ midataValue: 5, currentValue: 4, same: false })).toBe(false)
    expect(preChecked({ midataValue: null, currentValue: null, same: true })).toBe(false)
  })
})
