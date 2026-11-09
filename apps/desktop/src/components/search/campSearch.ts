/** Pure helpers for the central camp search: grouping hits and splitting snippets for highlighting. */
import type { SearchHit } from '@/domain/documents'

export interface HitGroup {
  kind: 'activity' | 'document'
  hits: SearchHit[]
}

export interface SnippetPart {
  text: string
  mark: boolean
}

/** Groups hits into activities then documents (score order kept), at most `max` per group. */
export function groupHits(hits: SearchHit[], max = 8): HitGroup[] {
  const out: HitGroup[] = []
  for (const kind of ['activity', 'document'] as const) {
    const g = hits.filter((h) => h.kind === kind).slice(0, max)
    if (g.length) out.push({ kind, hits: g })
  }
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Splits text into plain and marked parts (case-insensitive terms). Rendered as text nodes, never as HTML. */
export function highlightParts(text: string, query: string): SnippetPart[] {
  if (!text) return []
  const terms = [...new Set(query.split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!terms.length) return [{ text, mark: false }]
  // With one capture group, split() puts the matches at the odd indices.
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'i')
  return text
    .split(new RegExp(re.source, 'gi'))
    .map((p, i) => ({ text: p, mark: i % 2 === 1 }))
    .filter((p) => p.text !== '')
}
