/**
 * «Personen» tab state (RED ZONE, ADR 0008): people from MiData / NDS live in memory only
 * (module-level refs, never Dexie / localStorage / backup / AI). Cleared on logout, on camp switch,
 * and by `clear()` (which also wipes the copy held in Rust).
 */
import { computed, ref, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { diffPersons } from '@/domain/persons/diff'
import type { MidataPersonsResult, NdsPersonsResult, PersonDiffRow } from '@/domain/persons/types'
import type { Iri } from '@/domain/types'
import { commands, errorMessage } from '@/lib/tauri'
import { useCampFacts } from './useCampFacts'
import { useCampMidata } from './useMidata'
import { useCampNds } from './useNds'
import { useSession } from './useSession'

const midata = shallowRef<MidataPersonsResult | null>(null)
const nds = shallowRef<NdsPersonsResult | null>(null)
const loadingMidata = ref(false)
const loadingNds = ref(false)
const midataError = ref<string | null>(null)
const ndsError = ref<string | null>(null)
let currentCamp: Iri | null = null
let watchingSession = false

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
  midataLinked: ComputedRef<boolean>
  ndsLinked: ComputedRef<boolean>
  loadingMidata: typeof loadingMidata
  loadingNds: typeof loadingNds
  midataError: typeof midataError
  ndsError: typeof ndsError
  loadMidata(): Promise<void>
  loadNds(): Promise<void>
  clear(): Promise<void>
}

export function usePersons(campIri: MaybeRefOrGetter<Iri>): PersonsHandle {
  const { facts } = useCampFacts(campIri)
  const mdCamp = useCampMidata(campIri, facts)
  const ndsCamp = useCampNds(campIri, facts)
  void mdCamp.load()
  void ndsCamp.load()

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
    },
    { immediate: true },
  )

  const rows = computed(() => diffPersons(midata.value?.persons ?? [], nds.value?.persons ?? []))
  const campStart = computed(() => facts.value?.camp.start ?? null)

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

  return {
    midata,
    nds,
    rows,
    compared: computed(() => midata.value !== null && nds.value !== null),
    campStart,
    midataLinked: computed(() => mdCamp.link.value !== null),
    ndsLinked: computed(() => ndsCamp.link.value !== null),
    loadingMidata,
    loadingNds,
    midataError,
    ndsError,
    loadMidata,
    loadNds,
    clear: wipeAll,
  }
}
