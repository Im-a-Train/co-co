/**
 * NDS (M8, red zone): connection state + per-camp link/aggregate. Nothing is fetched automatically;
 * `refresh()` and `findCamps()` run only on explicit user action. Only aggregates reach this layer.
 */
import { computed, ref, shallowRef, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { adoptNdsFields } from '@/domain/nds'
import { clearNds, getNdsRecord, saveNdsAggregate, saveNdsLink } from '@/domain/nds/store'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import type {
  CampFacts,
  Iri,
  NdsCampSummary,
  NdsCoachProfile,
  NdsLink,
  NdsPersonDetection,
  NdsProbe,
  NdsRecognitionsResult,
  NdsRecord,
  NdsStatus,
} from '@/domain/types'
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
/** M22: the coach's own NDS person id (settings nds.personId) and the red-zone data derived from it. Memory only. */
const personId = ref<string | null>(null)
const coachProfile = shallowRef<NdsCoachProfile | null>(null)
const recognitions = shallowRef<NdsRecognitionsResult | null>(null)
const profileLoading = ref(false)
const recognitionsLoading = ref(false)
const detecting = ref(false)
const personError = ref<string | null>(null)
const profileError = ref<string | null>(null)
const recognitionsError = ref<string | null>(null)

/** Own-person data never outlives the NDS session or the unlocked data store. */
function clearOwnData(): void {
  coachProfile.value = null
  recognitions.value = null
  profileError.value = null
  recognitionsError.value = null
}
function applyStatus(s: NdsStatus): void {
  status.value = s
  if (!s.connected) clearOwnData()
}

onDataStoreLocked(() => {
  started = null
  enabled.value = false
  personId.value = null
  detection.value = null
  clearOwnData()
  records.value = {}
  loadingMap.value = {}
  errorMap.value = {}
})

async function refreshStatus(): Promise<void> {
  if (!isTauri()) return
  try {
    applyStatus(await commands.ndsStatus())
  } catch (e) {
    error.value = errorMessage(e)
  }
}

function start(): Promise<void> {
  if (started) return started
  started = (async () => {
    try {
      const settings = (await getAppSettings()).nds
      enabled.value = settings.enabled
      personId.value = settings.personId ?? null
    } catch (e) {
      error.value = errorMessage(e)
    }
    await refreshStatus()
    if (isTauri()) {
      try {
        await onNdsStatus((s) => applyStatus(s))
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

// Re-exported for the Lager-Angaben view; the implementation lives in the domain.
export { adoptNdsFields }

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
  /** M22: own NDS person id (numeric string) or null. */
  personId: typeof personId
  coachProfile: typeof coachProfile
  recognitions: typeof recognitions
  profileLoading: typeof profileLoading
  recognitionsLoading: typeof recognitionsLoading
  detecting: typeof detecting
  personError: typeof personError
  profileError: typeof profileError
  recognitionsError: typeof recognitionsError
  /** Last detection result (kept for the hint line; the id itself is only stored when none is set). */
  detection: typeof detection
  detectPerson(): Promise<void>
  /** Manual override; null or empty clears. Returns false when the value is not numeric. */
  setPersonId(v: string | null): Promise<boolean>
  loadCoachProfile(): Promise<void>
  loadRecognitions(): Promise<void>
}

/** True for a plausible NDS person id: digits only. */
export function isValidPersonId(v: string): boolean {
  return /^\d{1,12}$/.test(v)
}

const detection = ref<NdsPersonDetection | null>(null)

async function savePersonId(v: string | null): Promise<void> {
  await updateAppSettings({ nds: { personId: v } })
  personId.value = v
  // A different person means different data: drop what was loaded for the previous id.
  clearOwnData()
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
        // Switched off means off: end a surviving NDS session so the UI never shows «aus» and «verbunden» together.
        if (!on && status.value.connected) {
          await commands.ndsLogout()
          applyStatus({ ...NO_STATUS })
        }
      })
    },
    async connectWithLogin() {
      await guard(() => commands.ndsOpenLogin())
    },
    async logout() {
      await guard(async () => {
        await commands.ndsLogout()
        applyStatus({ ...NO_STATUS })
      })
    },
    async probe(campBusinessId) {
      return (await guard(() => commands.ndsProbe(campBusinessId.trim()))) ?? null
    },
    personId,
    coachProfile,
    recognitions,
    profileLoading,
    recognitionsLoading,
    detecting,
    personError,
    profileError,
    recognitionsError,
    detection,
    async detectPerson() {
      detecting.value = true
      personError.value = null
      try {
        const d = await commands.ndsDetectPerson()
        detection.value = d
        // Never overwrite a manually entered value: store only while none is set.
        if (d.personId && isValidPersonId(d.personId) && !personId.value) await savePersonId(d.personId)
      } catch (e) {
        personError.value = errorMessage(e)
      } finally {
        detecting.value = false
      }
    },
    async setPersonId(v) {
      const trimmed = (v ?? '').trim()
      personError.value = null
      if (trimmed && !isValidPersonId(trimmed)) return false
      try {
        await savePersonId(trimmed || null)
        return true
      } catch (e) {
        personError.value = errorMessage(e)
        return false
      }
    },
    async loadCoachProfile() {
      const id = personId.value
      if (!id) return
      profileLoading.value = true
      profileError.value = null
      try {
        const r = await commands.ndsFetchCoachProfile(id)
        if (personId.value === id && status.value.connected) coachProfile.value = r
      } catch (e) {
        profileError.value = errorMessage(e)
      } finally {
        profileLoading.value = false
      }
    },
    async loadRecognitions() {
      const id = personId.value
      if (!id) return
      recognitionsLoading.value = true
      recognitionsError.value = null
      try {
        const r = await commands.ndsFetchRecognitions(id)
        if (personId.value === id && status.value.connected) recognitions.value = r
      } catch (e) {
        recognitionsError.value = errorMessage(e)
      } finally {
        recognitionsLoading.value = false
      }
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
  link: ComputedRef<NdsLink | null>
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
      patch(records, iri, await saveNdsLink(iri, {
          offerBusinessId: c.offerBusinessId,
          campBusinessId: c.campBusinessId,
          groupName: c.groupName,
          offerNumber: c.offerNumber,
          start: c.start,
          end: c.end,
        }))
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
