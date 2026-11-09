/** "Meine Lager" list (CampListEntry[] via loadCampList). */
import { ref, watch, type Ref } from 'vue'
import { loadCampList } from '@/domain/campFacts'
import type { CampListEntry } from '@/domain/types'
import { commands, errorMessage } from '@/lib/tauri'
import { useSession } from './useSession'

export interface CampListHandle {
  camps: Ref<CampListEntry[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /**
   * Never throws. Skips the request when already loaded unless `force`. While a load is running, every
   * caller awaits that same load (so callers like the MCP bridge never read the empty list mid-load).
   */
  load(force?: boolean): Promise<void>
}

const camps = ref<CampListEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loaded = false
let watching = false
let inflight: Promise<void> | null = null

function load(force = false): Promise<void> {
  if (inflight) return inflight
  if (loaded && !force) return Promise.resolve()
  inflight = doLoad().finally(() => {
    inflight = null
  })
  return inflight
}

async function doLoad(): Promise<void> {
  const { session } = useSession()
  const userIri = session.value?.userIri
  if (!userIri) {
    error.value = 'Nicht angemeldet.'
    return
  }
  loading.value = true
  error.value = null
  try {
    camps.value = await loadCampList((path) => commands.apiGet(path) as never, userIri)
    loaded = true
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

export function useCampList(): CampListHandle {
  if (!watching) {
    watching = true
    const { isLoggedIn } = useSession()
    watch(isLoggedIn, (v) => {
      if (!v) {
        camps.value = []
        loaded = false
        error.value = null
      }
    })
  }
  return { camps, loading, error, load }
}
