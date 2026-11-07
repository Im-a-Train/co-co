import { describe, expect, it } from 'vitest'
import { areaMatches, dismissedEntries, makeAreaOf, makeKeywordsOf } from '../areas'
import type { ActivityFact } from '@/domain/types'

function act(iri: string, title: string, storyboardText = ''): ActivityFact {
  return {
    iri,
    title,
    location: null,
    content: { storyboardText, safetyText: '', notesText: '' },
  } as unknown as ActivityFact
}

describe('areas: matched keywords and dismissal', () => {
  it('reports matched keywords per area', () => {
    const a = act('a', 'Skitour', 'Aufstieg zum Berg')
    expect(areaMatches(a).winter).toContain('skitour')
    expect(areaMatches(a).berg).toContain('berg')
    expect(areaMatches(act('b', 'Postenlauf'))).toEqual({})
    expect(makeKeywordsOf([act('a', 'Baden im See')])('a', 'wasser')).toEqual(expect.arrayContaining(['baden', 'see']))
    expect(makeKeywordsOf([])('zzz', 'wasser')).toEqual([])
  })
  it('makeAreaOf leaves out dismissed areas, dismissedEntries lists them', () => {
    const acts = [act('a', 'Kanu im Schnee')]
    expect(makeAreaOf(acts)('a').sort()).toEqual(['wasser', 'winter'])
    expect(makeAreaOf(acts, { a: ['wasser'] })('a')).toEqual(['winter'])
    expect(dismissedEntries(acts, { a: ['wasser', 'berg'] })).toEqual([{ iri: 'a', title: 'Kanu im Schnee', area: 'wasser' }])
  })
})
