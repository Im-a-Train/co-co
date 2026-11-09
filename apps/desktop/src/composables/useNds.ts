/**
 * NDS (M8, red zone): connection state + per-camp link/aggregate. Nothing is fetched automatically;
 * `refresh()` and `findCamps()` run only on explicit user action. Only aggregates reach this layer.
 */
import { computed, ref, shallowRef, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { ndsSuggestions, NDS_FIELDS } from '@/domain/nds'
import { clearNds, getNdsRecord, saveNdsAggregate, saveNdsLink } from '@/domain/nds/store'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import type { CampFacts, CoachInputs, Iri, NdsAggregate, NdsCampSummary, NdsField, NdsProbe, NdsRecord, NdsStatus } from '@/domain/types'
import { commands, errorMessage, isTauri, onNdsStatus } from '@/lib/tauri'
import i18n from '@/plugins/i18n'
import { bumpNds } from './ndsSignal'
import { onDataStoreLocked } from './useDataStore'

const t = (key: string): string => i18n.global.t(key)

const NO_STATUS: NdsStatus = { connected: false, cookieNames: [] }

const enabled = ref(false)
const status = ref<NdsStatus>({ ...NO_STATUS })
const busy = ref(false)
const error = ref<string | null>(null)
let started: Promise<void> | null = null
onDataStoreLocked(() => {
  started = null
  enabled.value = false
  records.value = {}
  loadingMap.value = {}
  errorMap.value = {}
})

async function refreshStatus(): Promise<void> {
  if (!isTauri()) return
  try {
    status.value = await commands.ndsStatus()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

function start(): Promise<void> {
  if (started) return started
  started = (async () => {
    try {
      enabled.value = (await getAppSettings()).nds.enabled
    } catch (e) {
      error.value = errorMessage(e)
    }
    await refreshStatus()
    if (isTauri()) {
      try {
        await onNdsStatus((s) => {
          status.value = s
        })
      } catch {
        // Event subscription is a nicety; status is also read on demand.
      }
    }
  })()
  return started
}

async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = true
  error.value = null
  try {
    return await fn()
  } catch (e) {
    error.value = errorMessage(e)
    return undefined
  } finally {
    busy.value = false
  }
}

/**
 * Applies the chosen NDS suggestions to the coach inputs and tags them with the NDS badge
 * (timestamp = Stand of the aggregate). Fields without a suggestion are left alone.
 */
export function adoptNdsFields(inputs: CoachInputs, agg: NdsAggregate, fields: readonly NdsField[], now: string): CoachInputs {
  const suggestions = ndsSuggestions(agg) as Partial<Record<NdsField, boolean | string>>
  const badges: Partial<Record<NdsField, string>> = { ...(inputs.ndsFields ?? {}) }
  const out: CoachInputs = { ...inputs, ndsFields: badges, updatedAt: now }
  const target = out as unknown as Record<string, unknown>
  for (const f of fields) {
    if (!NDS_FIELDS.includes(f) || suggestions[f] === undefined) continue
    target[f] = suggestions[f]
    badges[f] = agg.fetchedAt
  }
  return out
}

export interface NdsHandle {
  enabled: typeof enabled
  status: typeof status
  busy: typeof busy
  error: typeof error
  connected: ComputedRef<boolean>
  init(): Promise<void>
  setEnabled(on: boolean): Promise<void>
  connectWithLogin(): Promise<void>
  logout(): Promise<void>
  probe(campBusinessId: string): Promise<NdsProbe | null>
}

export function useNds(): NdsHandle {
  return {
    enabled,
    status,
    busy,
    error,
    connected: computed(() => status.value.connected),
    init: start,
    async setEnabled(on) {
      await guard(async () => {
        await updateAppSettings({ nds: { enabled: on } })
        enabled.value = on
      })
    },
    async connectWithLogin() {
      await guard(() => commands.ndsOpenLogin())
    },
    async logout() {
      await guard(async () => {
        await commands.ndsLogout()
        status.value = { ...NO_STATUS }
      })
    },
    async probe(campBusinessId) {
      return (await guard(() => commands.ndsProbe(campBusinessId.trim()))) ?? null
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Per camp
// ---------------------------------------------------------------------------------------------

const records = shallowRef<Record<Iri, NdsRecord | null>>({})
const loadingMap = ref<Record<Iri, boolean>>({})
const errorMap = ref<Record<Iri, string | null>>({})

function patch<T>(r: { value: Record<Iri, T> }, key: Iri, value: T): void {
  r.value = { ...r.value, [key]: value }
}

export interface CampNdsHandle {
  record: ComputedRef<NdsRecord | null>
  link: ComputedRef<{ offerBusinessId: string; campBusinessId: string } | null>
  loading: ComputedRef<boolean>
  error: ComputedRef<string | null>
  camps: ReturnType<typeof ref<NdsCampSummary[]>>
  campsLoading: ReturnType<typeof ref<boolean>>
  campsError: ReturnType<typeof ref<string | null>>
  load(): Promise<void>
  findCamps(): Promise<void>
  pickCamp(c: NdsCampSummary): Promise<void>
  refresh(): Promise<boolean>
  unlink(): Promise<void>
}

export function useCampNds(campIri: MaybeRefOrGetter<Iri>, facts: MaybeRefOrGetter<CampFacts | null>): CampNdsHandle {
  const record = computed(() => records.value[toValue(campIri)] ?? null)
  const link = computed(() => record.value?.link ?? null)
  const camps = ref<NdsCampSummary[]>([])
  const campsLoading = ref(false)
  const campsError = ref<string | null>(null)

  async function load(): Promise<void> {
    const iri = toValue(campIri)
    patch(errorMap, iri, null)
    try {
      patch(records, iri, await getNdsRecord(iri))
    } catch (e) {
      patch(errorMap, iri, errorMessage(e))
    }
  }

  async function findCamps(): Promise<void> {
    const f = toValue(facts)
    camps.value = []
    campsError.value = null
    if (!f?.camp.start || !f.camp.end) {
      campsError.value = t('nds.card.noDates')
      return
    }
    campsLoading.value = true
    try {
      camps.value = await commands.ndsFindCamps(f.camp.start, f.camp.end)
    } catch (e) {
      campsError.value = errorMessage(e)
    } finally {
      campsLoading.value = false
    }
  }

  async function pickCamp(c: NdsCampSummary): Promise<void> {
    const iri = toValue(campIri)
    try {
      patch(records, iri, await saveNdsLink(iri, { offerBusinessId: c.offerBusinessId, campBusinessId: c.campBusinessId }))
      bumpNds()
    } catch (e) {
      patch(errorMap, iri, errorMessage(e))
    }
  }

  async function unlink(): Promise<void> {
    const iri = toValue(campIri)
    try {
      await clearNds(iri)
      patch(records, iri, null)
      bumpNds()
    } catch (e) {
      patch(errorMap, iri, errorMessage(e))
    }
  }

  async function refresh(): Promise<boolean> {
    const iri = toValue(campIri)
    const l = link.value
    if (!l) return false
    patch(loadingMap, iri, true)
    patch(errorMap, iri, null)
    try {
      const agg = await commands.ndsFetchAggregate(l.offerBusinessId, l.campBusinessId)
      patch(records, iri, await saveNdsAggregate(iri, agg))
      bumpNds()
      return true
    } catch (e) {
      patch(errorMap, iri, errorMessage(e))
      return false
    } finally {
      patch(loadingMap, iri, false)
    }
  }

  return {
    record,
    link,
    loading: computed(() => loadingMap.value[toValue(campIri)] ?? false),
    error: computed(() => errorMap.value[toValue(campIri)] ?? null),
    camps,
    campsLoading,
    campsError,
    load,
    findCamps,
    pickCamp,
    refresh,
    unlink,
  }
}
