/**
 * «Personen» tab state (RED ZONE, ADR 0009): people from MiData / NDS live in memory only
 * (module-level refs, never Dexie / localStorage / backup / AI). Cleared on logout, on camp switch,
 * and by `clear()` (which also wipes the copy held in Rust).
 */
import { computed, ref, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { makeAreaOf, makeKeywordsOf } from '@/components/midata/areas'
import { buildQualificationMatrix, type QualificationMatrix } from '@/domain/midata'
import { getAreaOverrides, type CampAreaOverrides } from '@/domain/midata/areaOverrides'
import { summarizePersons, toViewRows, type PersonsSummary } from '@/domain/persons/view'
import { diffPersons } from '@/domain/persons/diff'
import type { MidataPersonsResult, NdsPersonsResult, PersonDiffRow } from '@/domain/persons/types'
import type { Iri } from '@/domain/types'
import { commands, errorMessage } from '@/lib/tauri'
import { useCampFacts } from './useCampFacts'
import { useCampMidata, useMidata, type CampMidataHandle } from './useMidata'
import { useCampNds, useNds, type CampNdsHandle } from './useNds'
import { useSession } from './useSession'
import { onDataStoreLocked } from './useDataStore'

const midata = shallowRef<MidataPersonsResult | null>(null)
const nds = shallowRef<NdsPersonsResult | null>(null)
const loadingMidata = ref(false)
const loadingNds = ref(false)
const midataError = ref<string | null>(null)
const ndsError = ref<string | null>(null)
let currentCamp: Iri | null = null
let watchingSession = false
onDataStoreLocked(() => wipeLocal())

function wipeLocal(): void {
  midata.value = null
  nds.value = null
  midataError.value = null
  ndsError.value = null
}

async function wipeAll(): Promise<void> {
  wipeLocal()
  try {
    await commands.personsClear()
  } catch {
    // nothing sensitive to report; the local copy is already gone
  }
}

export interface PersonsHandle {
  midata: typeof midata
  nds: typeof nds
  rows: ComputedRef<PersonDiffRow[]>
  /** Both sides loaded, so NDS states are meaningful. */
  compared: ComputedRef<boolean>
  campStart: ComputedRef<string | null>
  /** Counts, differences and Rega state over all rows (no personal data). */
  summary: ComputedRef<PersonsSummary>
  midataLinked: ComputedRef<boolean>
  ndsLinked: ComputedRef<boolean>
  /** NDS is switched on in the settings (a link alone is not enough to load). */
  ndsEnabled: ComputedRef<boolean>
  midataConnected: ComputedRef<boolean>
  ndsConnected: ComputedRef<boolean>
  /** Link + picker state of the sources (the pickers are the same as on «Angaben»). */
  midataCamp: CampMidataHandle
  ndsCamp: CampNdsHandle
  /** Qualification matrix from the stored MiData aggregate (not from the in-memory person list). */
  qualMatrix: ComputedRef<QualificationMatrix | null>
  /** At least one linked, connected (NDS: switched on) source. */
  canLoad: ComputedRef<boolean>
  loading: ComputedRef<boolean>
  loadingMidata: typeof loadingMidata
  loadingNds: typeof loadingNds
  midataError: typeof midataError
  ndsError: typeof ndsError
  loadMidata(): Promise<void>
  loadNds(): Promise<void>
  /** One click: loads every linked source in parallel (still an explicit action, ADR 0009). */
  loadAll(): Promise<void>
  /** Refreshes only the stored MiData aggregate (team card placeholder button). */
  refreshAggregate(): Promise<void>
  /** MiData is linked and connected, so the aggregate can be fetched. */
  midataUsable: ComputedRef<boolean>
  aggregateLoading: ComputedRef<boolean>
  clear(): Promise<void>
}

export function usePersons(campIri: MaybeRefOrGetter<Iri>): PersonsHandle {
  const { facts } = useCampFacts(campIri)
  const mdCamp = useCampMidata(campIri, facts)
  const ndsCamp = useCampNds(campIri, facts)
  const md = useMidata()
  const ndsSettings = useNds()
  void md.init()
  void ndsSettings.init()
  void mdCamp.load()
  void ndsCamp.load()

  const dismissed = ref<CampAreaOverrides>({})
  async function loadDismissed(iri: Iri): Promise<void> {
    try {
      dismissed.value = await getAreaOverrides(iri)
    } catch {
      dismissed.value = {}
    }
  }

  if (!watchingSession) {
    watchingSession = true
    const { isLoggedIn } = useSession()
    watch(isLoggedIn, (v) => {
      if (!v) {
        currentCamp = null
        void wipeAll()
      }
    })
  }

  watch(
    () => toValue(campIri),
    (iri) => {
      if (currentCamp !== null && currentCamp !== iri) void wipeAll()
      currentCamp = iri
      void loadDismissed(iri)
    },
    { immediate: true },
  )

  const rows = computed(() => diffPersons(midata.value?.persons ?? [], nds.value?.persons ?? []))
  const campStart = computed(() => facts.value?.camp.start ?? null)

  const compared = computed(() => midata.value !== null && nds.value !== null)
  const summary = computed(() => summarizePersons(toViewRows(rows.value, campStart.value, compared.value)))

  const qualMatrix = computed(() => {
    const agg = mdCamp.record.value?.aggregate ?? null
    const f = facts.value
    return agg && f ? buildQualificationMatrix(agg, f, makeAreaOf(f.activities, dismissed.value), makeKeywordsOf(f.activities)) : null
  })
  const midataLinked = computed(() => mdCamp.link.value !== null)
  const ndsLinked = computed(() => ndsCamp.link.value !== null)
  // A source can load only when it is linked AND connected (NDS also switched on); otherwise the click would
  // just end in an error, and the «Quellen» card shows the way to the settings instead.
  const midataUsable = computed(() => midataLinked.value && md.connected.value)
  const ndsUsable = computed(() => ndsLinked.value && ndsSettings.enabled.value && ndsSettings.connected.value)
  const canLoad = computed(() => midataUsable.value || ndsUsable.value)

  async function loadMidata(): Promise<void> {
    const l = mdCamp.link.value
    const f = facts.value
    if (!l || !f?.camp.start || !f.camp.end || loadingMidata.value) return
    loadingMidata.value = true
    midataError.value = null
    try {
      midata.value = await commands.personsLoadMidata(l.eventId, f.camp.start, f.camp.end)
    } catch (e) {
      midataError.value = errorMessage(e)
    } finally {
      loadingMidata.value = false
    }
  }

  async function loadNds(): Promise<void> {
    const l = ndsCamp.link.value
    if (!l || loadingNds.value) return
    loadingNds.value = true
    ndsError.value = null
    try {
      nds.value = await commands.personsLoadNds(l.campBusinessId)
    } catch (e) {
      ndsError.value = errorMessage(e)
    } finally {
      loadingNds.value = false
    }
  }

  async function loadAll(): Promise<void> {
    await Promise.all([
      midataUsable.value ? loadMidata() : Promise.resolve(),
      ndsUsable.value ? loadNds() : Promise.resolve(),
      // Same explicit click: also refresh the stored MiData aggregate behind the team card.
      midataUsable.value ? refreshAggregate() : Promise.resolve(),
    ])
  }
  /** Refreshes the stored MiData aggregate (team qualification card); failures only leave the card out. */
  async function refreshAggregate(): Promise<void> {
    try {
      await mdCamp.refresh()
    } catch {
      // the card stays out; «Angaben» shows MiData errors
    }
  }

  return {
    midata,
    nds,
    rows,
    compared,
    refreshAggregate,
    midataUsable,
    aggregateLoading: computed(() => mdCamp.loading.value),
    campStart,
    summary,
    midataLinked,
    ndsLinked,
    ndsEnabled: computed(() => ndsSettings.enabled.value),
    midataConnected: computed(() => md.connected.value),
    ndsConnected: computed(() => ndsSettings.connected.value),
    midataCamp: mdCamp,
    ndsCamp,
    qualMatrix,
    canLoad,
    loading: computed(() => loadingMidata.value || loadingNds.value),
    loadingMidata,
    loadingNds,
    midataError,
    ndsError,
    loadMidata,
    loadNds,
    loadAll,
    clear: wipeAll,
  }
}
