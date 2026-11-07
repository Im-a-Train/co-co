/** Pure row model for the category mapping table. */
import type { ActivityFact, CategoryClass, CategoryFact, CategoryGuess, CategoryMapping, Iri } from '@/domain/types'

export const MAPPING_CLASSES: readonly CategoryClass[] = ['LS', 'LA', 'LP', 'ES', 'NONE'] as const

export interface MappingRow {
  iri: Iri
  short: string
  name: string
  color: string
  activityCount: number
  guess: CategoryClass | null
  confidence: 'high' | 'low' | null
  selected: CategoryClass
}

export function buildMappingRows(
  categories: CategoryFact[],
  activities: ActivityFact[],
  guesses: CategoryGuess[],
  draft: Record<Iri, CategoryClass>,
): MappingRow[] {
  const counts = new Map<Iri, number>()
  for (const a of activities) if (a.categoryIri) counts.set(a.categoryIri, (counts.get(a.categoryIri) ?? 0) + 1)
  const guessBy = new Map(guesses.map((g) => [g.categoryIri, g]))
  return categories.map((c) => {
    const g = guessBy.get(c.iri) ?? null
    return {
      iri: c.iri,
      short: c.short,
      name: c.name,
      color: c.color,
      activityCount: counts.get(c.iri) ?? 0,
      guess: g?.guess ?? null,
      confidence: g?.confidence ?? null,
      selected: draft[c.iri] ?? g?.guess ?? 'NONE',
    }
  })
}

/** True when the draft differs from the stored entries. */
export function mappingDirty(mapping: CategoryMapping | null, draft: Record<Iri, CategoryClass>): boolean {
  if (!mapping) return true
  const keys = new Set([...Object.keys(mapping.entries), ...Object.keys(draft)])
  for (const k of keys) if ((mapping.entries[k] ?? 'NONE') !== (draft[k] ?? 'NONE')) return true
  return false
}
