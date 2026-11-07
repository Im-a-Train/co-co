/**
 * MiData (M7, red zone): connection state + per-camp link/aggregate. Nothing is fetched automatically;
 * `refresh()` and `findEvents()` run only on explicit user action. Only aggregates reach this layer.
 */
import { computed, ref, shallowRef, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { resolveEventLink } from '@/domain/midata'
import { clearMidata, getMidataRecord, saveMidataAggregate, saveMidataLink } from '@/domain/midata/store'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import type { CampFacts, Iri, MidataEventSummary, MidataProbe, MidataRecord, MidataStatus } from '@/domain/types'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import { commands, errorMessage, isTauri, onMidataStatus } from '@/lib/tauri'
import i18n from '@/plugins/i18n'
import { bumpMidata, midataVersion } from './midataSignal'

const t = (key: string): string => i18n.global.t(key)

const NO_STATUS: MidataStatus = { connected: false, baseUrl: null, method: null, cookieNames: [] }

const baseUrl = ref(DEFAULT_APP_SETTINGS.midata.baseUrl)
const personId = ref<string | null>(DEFAULT_APP_SETTINGS.midata.personId)
const status = ref<MidataStatus>({ ...NO_STATUS })
const busy = ref(false)
const error = ref<string | null>(null)
let started: Promise<void> | null = null

async function refreshStatus(): Promise<void> {
  if (!isTauri()) return
  try {
    status.value = await commands.midataStatus()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

function start(): Promise<void> {
  if (started) return started
  started = (async () => {
    try {
      const s = await getAppSettings()
      baseUrl.value = s.midata.baseUrl || DEFAULT_APP_SETTINGS.midata.baseUrl
      personId.value = s.midata.personId
    } catch (e) {
      error.value = errorMessage(e)
    }
    await refreshStatus()
    if (isTauri()) {
      try {
        await onMidataStatus((s) => {
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

export interface MidataHandle {
  baseUrl: typeof baseUrl
  personId: typeof personId
  status: typeof status
  busy: typeof busy
  error: typeof error
  connected: ComputedRef<boolean>
  init(): Promise<void>
  saveSettings(next: { baseUrl: string; personId: string | null }): Promise<void>
  connectWithLogin(): Promise<void>
  connectWithToken(token: string): Promise<boolean>
  logout(): Promise<void>
  probe(eventId: string, groupId: string | null): Promise<MidataProbe | null>
}

export function useMidata(): MidataHandle {
  return {
    baseUrl,
    personId,
    status,
    busy,
    error,
    connected: computed(() => status.value.connected),
    init: start,
    async saveSettings(next) {
      await guard(async () => {
        const url = next.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_APP_SETTINGS.midata.baseUrl
        const pid = next.personId?.trim() || null
        await updateAppSettings({ midata: { baseUrl: url, personId: pid } })
        baseUrl.value = url
        personId.value = pid
      })
    },
    async connectWithLogin() {
      await guard(() => commands.midataOpenLogin(baseUrl.value))
    },
    async connectWithToken(token) {
      const s = await guard(() => commands.midataSetToken(baseUrl.value, token.trim()))
      if (s) status.value = s
      return !!s?.connected
    },
    async logout() {
      await guard(async () => {
        await commands.midataLogout()
        status.value = { ...NO_STATUS }
      })
    },
    async probe(eventId, groupId) {
      return (await guard(() => commands.midataProbe(eventId.trim(), groupId?.trim() || null))) ?? null
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Per camp
// ---------------------------------------------------------------------------------------------

const records = shallowRef<Record<Iri, MidataRecord | null>>({})
const loadingMap = ref<Record<Iri, boolean>>({})
const errorMap = ref<Record<Iri, string | null>>({})

function patch<T>(r: { value: Record<Iri, T> }, key: Iri, value: T): void {
  r.value = { ...r.value, [key]: value }
}

export interface CampMidataHandle {
  record: ComputedRef<MidataRecord | null>
  link: ComputedRef<{ eventId: string; source: 'ecamp' | 'manual' } | null>
  loading: ComputedRef<boolean>
  error: ComputedRef<string | null>
  events: ReturnType<typeof ref<MidataEventSummary[]>>
  eventsLoading: ReturnType<typeof ref<boolean>>
  eventsError: ReturnType<typeof ref<string | null>>
  load(): Promise<void>
  findEvents(): Promise<void>
  pickEvent(eventId: string): Promise<void>
  refresh(): Promise<boolean>
  unlink(): Promise<void>
}

export function useCampMidata(campIri: MaybeRefOrGetter<Iri>, facts: MaybeRefOrGetter<CampFacts | null>): CampMidataHandle {
  const record = computed(() => records.value[toValue(campIri)] ?? null)
  const link = computed(() => {
    const f = toValue(facts)
    return f ? resolveEventLink(f.camp, record.value) : null
  })
  const events = ref<MidataEventSummary[]>([])
  const eventsLoading = ref(false)
  const eventsError = ref<string | null>(null)

  async function load(): Promise<void> {
    const iri = toValue(campIri)
    patch(errorMap, iri, null)
    try {
      let rec = await getMidataRecord(iri)
      const f = toValue(facts)
      const l = f ? resolveEventLink(f.camp, rec) : null
      // Persist the eCamp link once so it survives the camp losing it.
      if (l && l.source === 'ecamp' && (!rec || rec.eventId !== l.eventId)) rec = await saveMidataLink(iri, l.eventId, 'ecamp')
      patch(records, iri, rec)
    } catch (e) {
      patch(errorMap, iri, errorMessage(e))
    }
  }

  async function findEvents(): Promise<void> {
    const f = toValue(facts)
    events.value = []
    eventsError.value = null
    if (!f?.camp.start || !f.camp.end) {
      eventsError.value = t('midata.card.noDates')
      return
    }
    eventsLoading.value = true
    try {
      events.value = await commands.midataFindEvents(f.camp.start, f.camp.end)
    } catch (e) {
      eventsError.value = errorMessage(e)
    } finally {
      eventsLoading.value = false
    }
  }

  async function pickEvent(eventId: string): Promise<void> {
    const iri = toValue(campIri)
    try {
      patch(records, iri, await saveMidataLink(iri, eventId, 'manual'))
      midataVersion.value += 1
    } catch (e) {
      patch(errorMap, iri, errorMessage(e))
    }
  }

  async function unlink(): Promise<void> {
    const iri = toValue(campIri)
    try {
      await clearMidata(iri)
      patch(records, iri, null)
      bumpMidata()
    } catch (e) {
      patch(errorMap, iri, errorMessage(e))
    }
  }

  async function refresh(): Promise<boolean> {
    const iri = toValue(campIri)
    const f = toValue(facts)
    const l = link.value
    if (!f || !l) return false
    if (!f.camp.start || !f.camp.end) {
      patch(errorMap, iri, t('midata.card.noDates'))
      return false
    }
    patch(loadingMap, iri, true)
    patch(errorMap, iri, null)
    try {
      const agg = await commands.midataFetchAggregate(l.eventId, f.camp.start, f.camp.end, personId.value)
      patch(records, iri, await saveMidataAggregate(iri, agg))
      midataVersion.value += 1
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
    events,
    eventsLoading,
    eventsError,
    load,
    findEvents,
    pickEvent,
    refresh,
    unlink,
  }
}
