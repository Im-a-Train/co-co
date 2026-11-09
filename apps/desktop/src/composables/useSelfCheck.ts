/**
 * Leader self-check («Entwurfsrunde») of one camp: runs, progress vs. the latest run, report and the
 * diff of the live facts against the run's snapshot. Deliberately independent of useRounds: a draft
 * round is not a review round (no round number, no review status, no backup reminder).
 */
import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useFindings } from '@/composables/useFindings'
import { diffEntities, snapshotEntities } from '@/domain/rounds'
import { getSnapshot } from '@/domain/rounds/store'
import {
  buildSelfCheckReport,
  compareWithRun,
  isLeaderRole,
  renderSelfCheckReportHtml,
  renderSelfCheckReportText,
  type SelfCheckReportModel,
  type SelfCheckProgress,
  type SelfCheckReportOptions,
} from '@/domain/selfCheck'
import { createSelfCheckRun, deleteSelfCheck, listSelfChecks } from '@/domain/selfCheck/store'
import type { CollaboratorRole, Diff, Iri, SelfCheckRun } from '@/domain/types'

export interface SelfCheckHandle {
  /** Newest first. */
  runs: ComputedRef<SelfCheckRun[]>
  latest: ComputedRef<SelfCheckRun | null>
  /** Current user's role in this camp (null if unknown). */
  role: ComputedRef<CollaboratorRole | null>
  isLeader: ComputedRef<boolean>
  /** Open findings now vs. the latest run (null without a run). */
  progress: ComputedRef<SelfCheckProgress | null>
  /** Live facts vs. the snapshot of the latest run; null without run, snapshot or facts. */
  diffSinceLatest: ComputedRef<Diff | null>
  load(): Promise<void>
  startRun(note?: string): Promise<SelfCheckRun>
  deleteRun(id: string): Promise<void>
  /** Structured report + rendered HTML / plain text; null without facts. */
  report(opts?: { includeRedDerived?: boolean; now?: Date }): { model: SelfCheckReportModel; html: string; text: string } | null
  error: ComputedRef<string | null>
}

// Shared per camp so the camp list and the tab agree.
const runsByCamp = ref<Record<Iri, SelfCheckRun[]>>({})
const diffs = ref<Record<Iri, Diff | null>>({})
const errors = ref<Record<Iri, string | null>>({})

export function useSelfCheck(campIri: MaybeRefOrGetter<Iri>): SelfCheckHandle {
  const iri = () => toValue(campIri)
  const campFacts = useCampFacts(campIri)
  const findingsHandle = useFindings(campIri)
  const setError = (e: unknown) => {
    errors.value = { ...errors.value, [iri()]: e instanceof Error ? e.message : String(e) }
  }

  const runs = computed(() => runsByCamp.value[iri()] ?? [])
  const latest = computed(() => runs.value[0] ?? null)
  const role = computed<CollaboratorRole | null>(
    () => campFacts.facts.value?.collaborators.find((c) => c.isCurrentUser)?.role ?? null,
  )

  async function load(): Promise<void> {
    const c = iri()
    try {
      runsByCamp.value = { ...runsByCamp.value, [c]: await listSelfChecks(c) }
      errors.value = { ...errors.value, [c]: null }
    } catch (e) {
      setError(e)
    }
  }

  async function recomputeDiff(): Promise<void> {
    const c = iri()
    const run = latest.value
    const facts = campFacts.facts.value
    if (!run?.snapshotId || !facts) {
      diffs.value = { ...diffs.value, [c]: null }
      return
    }
    const snap = await getSnapshot(run.snapshotId)
    if (!snap) {
      diffs.value = { ...diffs.value, [c]: null }
      return
    }
    const live = await snapshotEntities(facts)
    diffs.value = {
      ...diffs.value,
      [c]: diffEntities(c, { roundId: snap.roundId, entities: snap.entities }, { roundId: null, entities: live }),
    }
  }
  watch([() => campFacts.facts.value, () => latest.value?.id], () => void recomputeDiff().catch(setError), { immediate: true })

  return {
    runs,
    latest,
    role,
    isLeader: computed(() => isLeaderRole(role.value)),
    progress: computed(() => (latest.value ? compareWithRun(latest.value, findingsHandle.findings.value) : null)),
    diffSinceLatest: computed(() => diffs.value[iri()] ?? null),
    error: computed(() => errors.value[iri()] ?? null),
    load,
    async startRun(note = '') {
      const facts = await campFacts.load(true)
      if (!facts) throw new Error('noFacts')
      await findingsHandle.refresh()
      const js = findingsHandle.jsDays.value
      try {
        const run = await createSelfCheckRun(facts, {
          by: isLeaderRole(role.value) ? 'leader' : 'coach',
          note,
          counts: findingsHandle.counts.value,
          validJsDays: js?.validDayCount ?? null,
          totalDays: js?.totalDayCount ?? null,
          findings: findingsHandle.findings.value,
        })
        await load()
        return run
      } catch (e) {
        setError(e)
        throw e
      }
    },
    async deleteRun(id) {
      try {
        await deleteSelfCheck(id)
        await load()
      } catch (e) {
        setError(e)
        throw e
      }
    },
    report(opts = {}) {
      const facts = campFacts.facts.value
      if (!facts) return null
      const js = findingsHandle.jsDays.value
      const options: SelfCheckReportOptions = {
        includeRedDerived: opts.includeRedDerived ?? false,
        instanceBaseUrl: facts.instanceBaseUrl,
        now: opts.now ?? new Date(),
      }
      const model = buildSelfCheckReport(
        facts,
        findingsHandle.findings.value,
        js ? { valid: js.validDayCount, total: js.totalDayCount } : null,
        progress(),
        options,
      )
      return { model, html: renderSelfCheckReportHtml(model), text: renderSelfCheckReportText(model) }
    },
  }

  function progress(): SelfCheckProgress | null {
    return latest.value ? compareWithRun(latest.value, findingsHandle.findings.value) : null
  }
}
