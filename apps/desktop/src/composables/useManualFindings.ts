/**
 * Manual findings of one camp (ADR 0014). Module-level cache per camp so the DP list, the activity drawer,
 * the document viewer, the findings list (via useFindings) and the feedback view all see the same records.
 * Reloads when an MCP tool writes manual findings (`lastMcpChange` kind 'manualFinding').
 */
import { computed, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { newId, nowIso } from '@/domain/storage/db'
import { newManualFinding, type NewManualFindingInput } from '@/domain/manualFindings'
import { deleteManualFinding, listManualFindings, saveManualFinding } from '@/domain/manualFindings/store'
import type { Iri, ManualFinding } from '@/domain/types'
import { lastMcpChange } from './mcpChanges'
import { onDataStoreLocked } from './useDataStore'

export type ManualFindingPatch = Partial<Pick<ManualFinding, 'category' | 'comment' | 'anchor' | 'activityIri'>>

export interface ManualFindingsHandle {
  /** All manual findings of the camp, oldest first. */
  items: ComputedRef<ManualFinding[]>
  byActivity: ComputedRef<Map<Iri, ManualFinding[]>>
  byDocument: ComputedRef<Map<string, ManualFinding[]>>
  reload(): Promise<void>
  add(input: Omit<NewManualFindingInput, 'campIri'>): Promise<ManualFinding>
  update(id: string, patch: ManualFindingPatch): Promise<void>
  remove(id: string): Promise<void>
}

/** campIri -> records. Shared by all handles of the same camp. */
const cache = shallowRef<Map<Iri, ManualFinding[]>>(new Map())
/** Bumps on every change so dependants (useFindings) recompute. */
export const manualFindingsVersion = shallowRef(0)

function setCamp(campIri: Iri, rows: ManualFinding[]): void {
  const next = new Map(cache.value)
  next.set(campIri, rows)
  cache.value = next
  manualFindingsVersion.value++
}

/** Loads (or returns cached) manual findings of a camp without creating a handle. */
export async function loadManualFindings(campIri: Iri, force = false): Promise<ManualFinding[]> {
  if (!force && cache.value.has(campIri)) return cache.value.get(campIri)!
  const rows = await listManualFindings(campIri)
  setCamp(campIri, rows)
  return rows
}

/** Drops the cache (logout / data store locked). */
export function clearManualFindingsCache(): void {
  cache.value = new Map()
  manualFindingsVersion.value++
}

onDataStoreLocked(clearManualFindingsCache)

function group<K>(rows: ManualFinding[], key: (m: ManualFinding) => K | undefined): Map<K, ManualFinding[]> {
  const out = new Map<K, ManualFinding[]>()
  for (const m of rows) {
    const k = key(m)
    if (k === undefined) continue
    const list = out.get(k)
    if (list) list.push(m)
    else out.set(k, [m])
  }
  return out
}

export function useManualFindings(campIri: MaybeRefOrGetter<Iri>): ManualFindingsHandle {
  const items = computed(() => cache.value.get(toValue(campIri)) ?? [])
  const byActivity = computed(() => group(items.value, (m) => (m.scope === 'activity' ? m.activityIri : undefined)))
  const byDocument = computed(() => group(items.value, (m) => (m.scope === 'document' ? m.documentId : undefined)))

  async function reload(): Promise<void> {
    const iri = toValue(campIri)
    if (iri) await loadManualFindings(iri, true)
  }

  watch(
    () => toValue(campIri),
    (iri) => {
      if (iri) void loadManualFindings(iri)
    },
    { immediate: true },
  )
  watch(lastMcpChange, (c) => {
    if (c?.kind === 'manualFinding' && c.campIri === toValue(campIri)) void reload()
  })

  async function add(input: Omit<NewManualFindingInput, 'campIri'>): Promise<ManualFinding> {
    const iri = toValue(campIri)
    const rec = newManualFinding({ ...input, campIri: iri }, newId(), nowIso())
    await saveManualFinding(rec)
    setCamp(iri, [...(cache.value.get(iri) ?? []), rec])
    return rec
  }

  async function update(id: string, patch: ManualFindingPatch): Promise<void> {
    const iri = toValue(campIri)
    const rows = cache.value.get(iri) ?? (await listManualFindings(iri))
    const cur = rows.find((r) => r.id === id)
    if (!cur) throw new Error('Befund nicht gefunden')
    const merged: ManualFinding = { ...cur, ...patch, updatedAt: nowIso() }
    // Re-validate through the constructor (keeps the id and createdAt).
    const checked = newManualFinding({ ...merged, campIri: iri }, 'x', merged.createdAt)
    const next: ManualFinding = { ...checked, id: cur.id, createdAt: cur.createdAt, updatedAt: merged.updatedAt }
    await saveManualFinding(next)
    setCamp(
      iri,
      rows.map((r) => (r.id === id ? next : r)),
    )
  }

  async function remove(id: string): Promise<void> {
    const iri = toValue(campIri)
    await deleteManualFinding(id)
    setCamp(
      iri,
      (cache.value.get(iri) ?? []).filter((r) => r.id !== id),
    )
  }

  return { items, byActivity, byDocument, reload, add, update, remove }
}
