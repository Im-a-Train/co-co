/**
 * Loads + caches CampFacts per camp (in memory, keyed by campIri).
 * Used by CampLayout and every camp view. Contract: the returned shape below.
 *
 * The cache is cleared on logout (watch useSession().isLoggedIn).
 */
import { computed, ref, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { loadCampFacts } from '@/domain/campFacts'
import type { CampFacts, Iri, LoadProgress } from '@/domain/types'
import { commands, errorMessage } from '@/lib/tauri'
import { useSession } from './useSession'

export interface CampFactsHandle {
  facts: ComputedRef<CampFacts | null>
  loading: ComputedRef<boolean>
  error: ComputedRef<string | null>
  progress: ComputedRef<LoadProgress | null>
  /** Loads if not cached (or always with force). Never throws; returns null on error. */
  load(force?: boolean): Promise<CampFacts | null>
}

const cache = shallowRef<Record<Iri, CampFacts>>({})
const errors = ref<Record<Iri, string | null>>({})
const loadingMap = ref<Record<Iri, boolean>>({})
const progressMap = ref<Record<Iri, LoadProgress | null>>({})
const inflight = new Map<Iri, Promise<CampFacts | null>>()
let watching = false

function patch<T>(r: { value: Record<Iri, T> }, key: Iri, value: T): void {
  r.value = { ...r.value, [key]: value }
}

function ensureLogoutWatch(): void {
  if (watching) return
  watching = true
  const { isLoggedIn } = useSession()
  watch(isLoggedIn, (v) => {
    if (!v) {
      cache.value = {}
      errors.value = {}
      progressMap.value = {}
      inflight.clear()
    }
  })
}

async function doLoad(campIri: Iri): Promise<CampFacts | null> {
  const { session } = useSession()
  patch(loadingMap, campIri, true)
  patch(errors, campIri, null)
  patch(progressMap, campIri, null)
  try {
    const facts = await loadCampFacts(
      (path) => commands.apiGet(path) as never,
      campIri,
      (p) => patch(progressMap, campIri, p),
      { userIri: session.value?.userIri ?? null, instanceBaseUrl: session.value?.baseUrl ?? null },
    )
    cache.value = { ...cache.value, [campIri]: facts }
    return facts
  } catch (err) {
    patch(errors, campIri, errorMessage(err))
    return null
  } finally {
    patch(loadingMap, campIri, false)
    inflight.delete(campIri)
  }
}

export function useCampFacts(campIri: MaybeRefOrGetter<Iri>): CampFactsHandle {
  ensureLogoutWatch()
  return {
    facts: computed(() => cache.value[toValue(campIri)] ?? null),
    loading: computed(() => loadingMap.value[toValue(campIri)] ?? false),
    error: computed(() => errors.value[toValue(campIri)] ?? null),
    progress: computed(() => progressMap.value[toValue(campIri)] ?? null),
    load(force = false) {
      const iri = toValue(campIri)
      const cached = cache.value[iri]
      if (cached && !force) return Promise.resolve(cached)
      const running = inflight.get(iri)
      if (running) return running
      const p = doLoad(iri)
      inflight.set(iri, p)
      return p
    },
  }
}
