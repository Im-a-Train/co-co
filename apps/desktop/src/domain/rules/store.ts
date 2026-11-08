/** Overrides + cached camp summaries (tables `overrides`, `campSummaries`). */
import { getDb, newId, nowIso } from '../storage/db'
import type { CampSummaryRecord, Iri, Override } from '../types'

export function listOverrides(campIri: Iri): Promise<Override[]> {
  return getDb().overrides.where('campIri').equals(campIri).toArray()
}

/** Creates (or replaces, same findingId) an override (Ignorieren); the reason is optional. */
export async function addOverride(campIri: Iri, findingId: string, ruleId: string, reason: string): Promise<Override> {
  const trimmed = reason.trim()
  const db = getDb()
  return db.transaction('rw', db.overrides, async () => {
    const existing = await db.overrides.where('findingId').equals(findingId).and((o) => o.campIri === campIri).toArray()
    const override: Override = { id: newId(), campIri, findingId, ruleId, reason: trimmed, createdAt: nowIso() }
    // New row first: a failure never loses the existing override.
    await db.overrides.put(override)
    if (existing.length) await db.overrides.bulkDelete(existing.map((o) => o.id))
    return override
  })
}

export async function removeOverride(id: string): Promise<void> {
  await getDb().overrides.delete(id)
}

export async function saveCampSummary(summary: CampSummaryRecord): Promise<void> {
  await getDb().campSummaries.put(summary)
}

export function listCampSummaries(): Promise<CampSummaryRecord[]> {
  return getDb().campSummaries.toArray()
}
