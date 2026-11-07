import { ref } from 'vue'
import { activitiesPath, campsPath, toCampSummary, toPeriod, type CampSummary } from '@/lib/camps'
import { asResource, collectionCount, embeddedList, linkHref, selfHref, str, type HalResource } from '@/lib/hal'
import { commands, errorMessage } from '@/lib/tauri'
import { useSession } from './useSession'
import { useSpikeProtocol } from './useSpikeProtocol'

export interface ActivitiesSummary {
  campIri: string
  count: number
  titles: string[]
}

const camps = ref<CampSummary[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

const selectedIri = ref<string | null>(null)
const activities = ref<ActivitiesSummary | null>(null)
const activitiesLoading = ref(false)
const activitiesError = ref<string | null>(null)

const FIRST_TITLES = 5

/**
 * Bumped by reset() (logout / session change). A request that started under
 * an older value belongs to a session that no longer exists: its result is
 * dropped instead of being written back after the reset.
 */
let loadSeq = 0

async function loadCamps(): Promise<void> {
  const spike = useSpikeProtocol()
  const seq = loadSeq
  loading.value = true
  error.value = null
  try {
    // eCamp requires a filter on /api/camps (HTTP 400 otherwise). Like eCamp's own camp list
    // (frontend/src/views/Camps.vue) we ask for the camps the current user collaborates on,
    // which includes camps where the coach is invited as guest.
    const userIri = useSession().session.value?.userIri
    if (!userIri) throw new Error('Benutzer unbekannt – bitte neu anmelden.')
    const items: HalResource[] = []
    const seen = new Set<string>()
    let next: string | null = campsPath(userIri)
    while (next && !seen.has(next)) {
      seen.add(next)
      const res: HalResource | null = asResource(await commands.apiGet<HalResource>(next))
      items.push(...embeddedList(res))
      next = linkHref(res, 'next')
      if (next === selfHref(res)) next = null
    }
    if (seq !== loadSeq) return
    camps.value = items
      .map(toCampSummary)
      .filter((c): c is CampSummary => c !== null)
    loaded.value = true
    spike.campsCount.value = camps.value.length
    spike.addLog('ui', 'api-get-camps', true, `${camps.value.length}`)
    spike.markResult('apiCallOk', 'ok', 'GET /api/camps?campCollaborator=[user]')
    spike.markResult('campsLoaded', 'ok', String(camps.value.length))
  } catch (err) {
    if (seq !== loadSeq) return
    error.value = errorMessage(err)
    spike.addLog('ui', 'api-get-camps', false, error.value)
    spike.markResult('campsLoaded', 'failed', error.value)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function selectCamp(camp: CampSummary): Promise<void> {
  const spike = useSpikeProtocol()
  const seq = loadSeq
  selectedIri.value = camp.iri
  activities.value = null
  activitiesError.value = null
  activitiesLoading.value = true
  try {
    if (camp.periods === null && camp.periodsHref) {
      try {
        const res = asResource(await commands.apiGet<HalResource>(camp.periodsHref))
        if (seq !== loadSeq) return
        const periods = embeddedList(res).map(toPeriod)
        camps.value = camps.value.map((c) => (c.iri === camp.iri ? { ...c, periods } : c))
      } catch (err) {
        if (seq !== loadSeq) return
        spike.addLog('ui', 'api-get-periods', false, errorMessage(err))
      }
    }
    const res = asResource(await commands.apiGet<HalResource>(activitiesPath(camp.iri)))
    if (seq !== loadSeq || selectedIri.value !== camp.iri) return
    const items = embeddedList(res)
    activities.value = {
      campIri: camp.iri,
      count: collectionCount(res),
      titles: items
        .map((a) => str(a, 'title'))
        .filter((t): t is string => t !== null)
        .slice(0, FIRST_TITLES),
    }
    spike.addLog('ui', 'api-get-activities', true, `${activities.value.count}`)
  } catch (err) {
    if (seq !== loadSeq || selectedIri.value !== camp.iri) return
    activitiesError.value = errorMessage(err)
    spike.addLog('ui', 'api-get-activities', false, activitiesError.value)
  } finally {
    if (seq === loadSeq && selectedIri.value === camp.iri) activitiesLoading.value = false
  }
}

function reset(): void {
  loadSeq++
  loading.value = false
  activitiesLoading.value = false
  camps.value = []
  loaded.value = false
  error.value = null
  selectedIri.value = null
  activities.value = null
  activitiesError.value = null
}

export function useCamps() {
  return {
    camps,
    loaded,
    loading,
    error,
    selectedIri,
    activities,
    activitiesLoading,
    activitiesError,
    loadCamps,
    selectCamp,
    reset,
  }
}
