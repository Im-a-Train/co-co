/**
 * Review status + rounds of one camp, and the diff of the live facts against the last round.
 * OWNER: rounds builder. Used by the cockpit KPI "Änderungen seit letzter Runde" and Meine Lager.
 */
import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { refreshBackupState } from '@/components/backup/useBackup'
import { useCampFacts } from '@/composables/useCampFacts'
import { RoundsError, diffEntities, snapshotEntities } from '@/domain/rounds'
import * as store from '@/domain/rounds/store'
import type { CampFacts, Diff, Iri, ReviewState, ReviewStatus, Round, Snapshot } from '@/domain/types'

export interface RoundsHandle {
  review: ComputedRef<ReviewState | null>
  rounds: ComputedRef<Round[]>
  /** Live facts vs. snapshot of the latest round; null without rounds or facts. */
  diffSinceLastRound: ComputedRef<Diff | null>
  load(): Promise<void>
  setStatus(status: ReviewStatus, note?: string | null): Promise<void>
  /** Snapshot current facts as a new round; afterwards the UI reminds to export a backup. */
  startRound(note?: string): Promise<Round>
  /** Closes the open round without starting a new one (also triggers the backup reminder). */
  closeRound(roundId: string): Promise<void>
  /** Diff of a stored round against its predecessor (everything added for round 1). */
  diffForRound(roundId: string): Promise<Diff | null>
  /** Snapshots of this camp's rounds by round id (loaded lazily by diffs). */
  snapshotOf(roundId: string): Promise<Snapshot | null>
  /** Facts of the latest round's snapshot (to resolve titles of removed activities). */
  lastSnapshotFacts: ComputedRef<CampFacts | null>
  loading: ComputedRef<boolean>
  /** RoundsError code or message of the last failed action. */
  error: ComputedRef<string | null>
}

// Module-level caches so several components (cockpit, camp list, rounds view) share one state per camp.
const reviews = ref<Record<Iri, ReviewState | null>>({})
const roundsByCamp = ref<Record<Iri, Round[]>>({})
const snapshotCache = new Map<string, Snapshot>()
const diffs = ref<Record<Iri, Diff | null>>({})
const lastFacts = ref<Record<Iri, CampFacts | null>>({})
const loadingState = ref<Record<Iri, boolean>>({})
const errors = ref<Record<Iri, string | null>>({})

async function snapshotById(id: string): Promise<Snapshot | null> {
  const hit = snapshotCache.get(id)
  if (hit) return hit
  const s = await store.getSnapshot(id)
  if (s) snapshotCache.set(id, s)
  return s
}

export function useRounds(campIri: MaybeRefOrGetter<Iri>): RoundsHandle {
  const campFacts = useCampFacts(campIri)
  const iri = () => toValue(campIri)
  const setError = (e: unknown) => {
    errors.value = { ...errors.value, [iri()]: e instanceof RoundsError ? e.code : e instanceof Error ? e.message : String(e) }
  }

  const rounds = computed(() => roundsByCamp.value[iri()] ?? [])
  const latest = computed(() => rounds.value[rounds.value.length - 1] ?? null)

  async function load(): Promise<void> {
    const c = iri()
    loadingState.value = { ...loadingState.value, [c]: true }
    try {
      const [review, list] = await Promise.all([store.getReview(c), store.listRounds(c)])
      reviews.value = { ...reviews.value, [c]: review }
      roundsByCamp.value = { ...roundsByCamp.value, [c]: list }
      errors.value = { ...errors.value, [c]: null }
      await recomputeDiff()
    } catch (e) {
      setError(e)
    } finally {
      loadingState.value = { ...loadingState.value, [c]: false }
    }
  }

  async function recomputeDiff(): Promise<void> {
    const c = iri()
    const last = latest.value
    const facts = campFacts.facts.value
    if (!last || !facts) {
      diffs.value = { ...diffs.value, [c]: null }
      return
    }
    const snap = await snapshotById(last.snapshotId)
    if (!snap) {
      diffs.value = { ...diffs.value, [c]: null }
      return
    }
    lastFacts.value = { ...lastFacts.value, [c]: snap.facts }
    const live = await snapshotEntities(facts)
    diffs.value = {
      ...diffs.value,
      [c]: diffEntities(c, { roundId: last.id, entities: snap.entities }, { roundId: null, entities: live }),
    }
  }

  // Keep the live diff current when facts or the latest round change.
  watch([() => campFacts.facts.value, () => latest.value?.id], () => void recomputeDiff().catch(setError), { immediate: true })

  return {
    review: computed(() => reviews.value[iri()] ?? null),
    rounds,
    diffSinceLastRound: computed(() => diffs.value[iri()] ?? null),
    lastSnapshotFacts: computed(() => lastFacts.value[iri()] ?? null),
    loading: computed(() => loadingState.value[iri()] ?? false),
    error: computed(() => errors.value[iri()] ?? null),
    load,
    async setStatus(status, note) {
      try {
        const next = await store.setReviewStatus(iri(), status, note)
        reviews.value = { ...reviews.value, [iri()]: next }
        errors.value = { ...errors.value, [iri()]: null }
      } catch (e) {
        setError(e)
        throw e
      }
    },
    async startRound(note = '') {
      const facts = await campFacts.load(true)
      if (!facts) {
        const e = new RoundsError('noFacts')
        setError(e)
        throw e
      }
      try {
        const round = await store.startRound(facts, note)
        // Starting a review round moves neu / aenderungen_angefragt to in_review.
        const status = reviews.value[iri()]?.status ?? 'neu'
        if (status === 'neu' || status === 'aenderungen_angefragt') {
          reviews.value = { ...reviews.value, [iri()]: await store.setReviewStatus(iri(), 'in_review', null) }
        }
        await load()
        await refreshBackupState()
        return round
      } catch (e) {
        setError(e)
        throw e
      }
    },
    async closeRound(roundId) {
      try {
        await store.closeRound(roundId)
        await load()
        await refreshBackupState()
      } catch (e) {
        setError(e)
        throw e
      }
    },
    snapshotOf: (roundId) => {
      const r = rounds.value.find((x) => x.id === roundId)
      return r ? snapshotById(r.snapshotId) : Promise.resolve(null)
    },
    async diffForRound(roundId) {
      const list = rounds.value
      const idx = list.findIndex((r) => r.id === roundId)
      if (idx < 0) return null
      const cur = await snapshotById(list[idx]!.snapshotId)
      if (!cur) return null
      const prevRound = list[idx - 1]
      const prev = prevRound ? await snapshotById(prevRound.snapshotId) : null
      return diffEntities(
        iri(),
        prev && prevRound ? { roundId: prevRound.id, entities: prev.entities } : null,
        { roundId, entities: cur.entities },
      )
    },
  }
}
