/**
 * Hilfsmittel state (ADR 0013): module-level list, loaded once the data store is ready. Applies the
 * effective source registry overlay and exposes a `version` counter that changes whenever the list or
 * the registry changed (components that resolve sources via getSourceRegistry() depend on it).
 */
import { ref, shallowRef, watch } from 'vue'
import { bundledResources, mergeRegistry, searchResources, type NewResourceInput, type ResourceHit, type ResourcePatch } from '@/domain/resources'
import { addResource, listResources, onResourcesChanged, resetResource, updateResource } from '@/domain/resources/store'
import { bundledSourceRecords, setRegistryOverlay } from '@/domain/rules/packs/registry'
import type { EditOrigin, ResourceRecord } from '@/domain/types'
import { onDataStoreLocked, useDataStore } from './useDataStore'

const resources = shallowRef<ResourceRecord[]>([])
const version = ref(0)
const loaded = ref(false)
const error = ref<string | null>(null)
let initialised = false

function clear() {
  resources.value = []
  loaded.value = false
  setRegistryOverlay(null)
  version.value++
}

export async function reloadResources(): Promise<void> {
  try {
    const list = await listResources()
    resources.value = list
    setRegistryOverlay(mergeRegistry(bundledSourceRecords(), list))
    loaded.value = true
    error.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  version.value++
}

/** Call once at app start (App.vue): loads when the data store becomes ready, clears on lock. */
export function initResources(): void {
  if (initialised) return
  initialised = true
  const { state } = useDataStore()
  onDataStoreLocked(clear)
  onResourcesChanged(() => void reloadResources())
  watch(state, (s) => (s === 'ready' ? void reloadResources() : undefined), { immediate: true })
}

export function useResources() {
  return {
    resources,
    version,
    loaded,
    error,
    reload: reloadResources,
    /** Bundled defaults (for «geändert» comparison and UI before the store is loaded). */
    bundled: () => bundledResources(),
    add: (input: NewResourceInput, origin: EditOrigin = 'manual') => addResource(input, origin),
    update: (key: string, patch: ResourcePatch, origin: EditOrigin = 'manual') => updateResource(key, patch, origin),
    reset: (key: string) => resetResource(key),
    search: (query: string, limit?: number): ResourceHit[] => searchResources(resources.value, query, limit ? { limit } : undefined),
  }
}
