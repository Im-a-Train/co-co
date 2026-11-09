import { describe, expect, it } from 'vitest'
import type { SearchHit } from '@/domain/documents'
import { groupHits, highlightParts } from './campSearch'

const hit = (ref: string, kind: 'document' | 'activity'): SearchHit => ({ ref, kind, title: ref, snippet: '', score: 1 })

describe('groupHits', () => {
  it('puts activities before documents and caps each group', () => {
    const hits = [hit('d1', 'document'), ...Array.from({ length: 12 }, (_, i) => hit(`a${i}`, 'activity'))]
    const g = groupHits(hits, 8)
    expect(g.map((x) => x.kind)).toEqual(['activity', 'document'])
    expect(g[0]!.hits).toHaveLength(8)
  })
  it('omits empty groups', () => {
    expect(groupHits([hit('d', 'document')]).map((x) => x.kind)).toEqual(['document'])
    expect(groupHits([])).toEqual([])
  })
})

describe('highlightParts', () => {
  it('marks terms case-insensitively', () => {
    expect(highlightParts('Das Feuer brennt', 'feuer')).toEqual([
      { text: 'Das ', mark: false },
      { text: 'Feuer', mark: true },
      { text: ' brennt', mark: false },
    ])
  })
  it('keeps HTML-like text as plain text and survives regex characters', () => {
    expect(highlightParts('<b>a+b</b>', 'a+b')).toEqual([
      { text: '<b>', mark: false },
      { text: 'a+b', mark: true },
      { text: '</b>', mark: false },
    ])
  })
  it('returns plain text for an empty query', () => {
    expect(highlightParts('abc', '  ')).toEqual([{ text: 'abc', mark: false }])
  })
})
