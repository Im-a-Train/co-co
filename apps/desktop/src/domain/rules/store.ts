/** Overrides + cached camp summaries (tables `overrides`, `campSummaries`). */
import { getDb, newId, nowIso } from '../storage/db'
import type { CampProgressSummary, CampSummaryRecord, Iri, Override } from '../types'

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

/** Writes the summary; an existing `progress` survives a rewrite by useFindings (merge, never drop). */
export async function saveCampSummary(summary: CampSummaryRecord): Promise<void> {
  const db = getDb()
  const progress = summary.progress ?? (await db.campSummaries.get(summary.campIri))?.progress
  await db.campSummaries.put(progress ? { ...summary, progress } : summary)
}

/**
 * Stores the review progress on the summary of the camp (Meine Lager shows it). Without a summary yet
 * (useFindings writes it shortly after the first evaluation) the `base` record is created; useFindings
 * rewrites it later and keeps the progress. Returns false when there was nothing to write to.
 */
export async function saveCampProgress(
  campIri: Iri,
  progress: CampProgressSummary,
  base?: Omit<CampSummaryRecord, 'progress'> | null,
): Promise<boolean> {
  const db = getDb()
  const existing = (await db.campSummaries.get(campIri)) ?? base
  if (!existing) return false
  await db.campSummaries.put({ ...existing, progress })
  return true
}

export function listCampSummaries(): Promise<CampSummaryRecord[]> {
  return getDb().campSummaries.toArray()
}
