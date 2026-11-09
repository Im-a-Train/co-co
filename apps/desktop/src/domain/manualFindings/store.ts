/** Manual finding persistence (Dexie table `manualFindings`, v4, ADR 0014). */
import { getDb } from '../storage/db'
import type { Iri, ManualFinding } from '../types'

export async function listManualFindings(campIri: Iri): Promise<ManualFinding[]> {
  const rows = await getDb().manualFindings.where('campIri').equals(campIri).toArray()
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

export async function getManualFinding(id: string): Promise<ManualFinding | undefined> {
  return getDb().manualFindings.get(id)
}

export async function saveManualFinding(item: ManualFinding): Promise<void> {
  // Items held in Vue state may carry reactive proxies, which IndexedDB cannot clone.
  await getDb().manualFindings.put(JSON.parse(JSON.stringify(item)) as ManualFinding)
}

export async function deleteManualFinding(id: string): Promise<void> {
  await getDb().manualFindings.delete(id)
}
