/**
 * Review progress of one camp: gathers what the Übersicht needs (findings, feedback, documents, checklist,
 * rounds, mapping, rule modules) and derives progress, approval blockers, verdict and the next step.
 * Persists a compact snapshot into the camp summary so «Meine Lager» can show the next step.
 */
import { computed, onMounted, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { isCoachTodo, progressOf, statusesOf } from '@/domain/triage'
import { isDocumentReviewed, reviewProgress, reviewVerdict, toCampProgressSummary } from '@/domain/cockpit/progress'
import type { ReviewProgress, ReviewStepKey, ReviewVerdict } from '@/domain/cockpit/progress'
import { listDocuments } from '@/domain/documents/store'
import { approvalBlockers, type ApprovalBlockers } from '@/domain/rounds'
import { splitHidden } from '@/domain/rules/lib/checklistSync'
import { saveCampProgress } from '@/domain/rules/store'
import type { CampProgressSummary, DocumentRecord, Iri } from '@/domain/types'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampSettings, type CampSettingsHandle } from '@/composables/useCampSettings'
import { useFeedback } from '@/composables/useFeedback'
import { useFindings, type FindingsHandle } from '@/composables/useFindings'
import { useManualFindings } from '@/composables/useManualFindings'
import { useRounds } from '@/composables/useRounds'

export interface ReviewProgressHandle {
  progress: ComputedRef<ReviewProgress | null>
  blockers: ComputedRef<ApprovalBlockers | null>
  verdict: ComputedRef<ReviewVerdict | null>
  nextStep: ComputedRef<ReviewStepKey | null>
  /** Open (not ignored) Muss findings and still-open triage entries (coach todos excluded). */
  openMust: ComputedRef<number>
  triageOpen: ComputedRef<number>
  /** Rule modules in state 'suggested'. */
  suggestedModules: ComputedRef<string[]>
  missingInputs: ComputedRef<number>
}

export interface ReviewProgressOptions {
  /** Reuse handles of the calling view instead of creating second ones. */
  findings?: FindingsHandle
  settings?: CampSettingsHandle
  /** Write the snapshot into the camp summary (default true). */
  persist?: boolean
}

/** Last snapshot written per camp (without the time stamp), so unchanged values are not rewritten. */
const lastSaved = new Map<Iri, string>()

const snapshotKey = (s: CampProgressSummary) => `${s.percent}|${s.nextStep}|${s.triageOpen}|${s.openMust}`

export function useReviewProgress(campIriArg?: MaybeRefOrGetter<Iri>, opts: ReviewProgressOptions = {}): ReviewProgressHandle {
  const campIri = campIriArg ?? useCampRoute().campIri
  const iri = computed(() => toValue(campIri))
  const settings = opts.settings ?? useCampSettings(iri)
  const findingsHandle = opts.findings ?? useFindings(iri)
  const { facts } = useCampFacts(iri)
  const feedback = useFeedback(iri)
  const manual = useManualFindings(iri)
  const rc = useCampRuleConfig(iri)
  const rounds = useRounds(iri)

  const documents = ref<DocumentRecord[]>([])
  async function loadDocuments(): Promise<void> {
    try {
      documents.value = await listDocuments(iri.value)
    } catch {
      documents.value = []
    }
  }
  onMounted(() => {
    void loadDocuments()
    void rounds.load()
  })
  watch(iri, () => {
    void loadDocuments()
    void rounds.load()
  })

  const findings = findingsHandle.findings
  const tri = computed(() =>
    progressOf(
      statusesOf(
        findings.value.filter((f) => !isCoachTodo(f)),
        feedback.items.value,
      ),
    ),
  )
  const missingInputs = computed(() => findings.value.filter((f) => !f.override && f.needsInput === 'coachInputs').length)
  const suggestedModules = computed(() =>
    Object.entries(rc.moduleStates.value)
      .filter(([, res]) => res?.state === 'suggested')
      .map(([id]) => id),
  )
  const openMust = computed(() => findings.value.filter((f) => !f.override && f.severity === 'must').length)

  const progress = computed<ReviewProgress | null>(() => {
    if (!facts.value) return null
    const fb = feedback.items.value
    // Same items as the Checkliste tab (M17): coach points only, minus hidden ones, plus the coach's own points.
    const hidden = rc.config.value.hiddenChecklist ?? []
    const checklistItems = splitHidden(
      rc.checklist.value.filter((i) => i.audience === 'coach'),
      (i) => i.id,
      hidden,
    ).shown
    const states = rc.config.value.checklist ?? {}
    const custom = (rc.config.value.customChecklist ?? []).filter((c) => !hidden.includes(c.id))
    const customDone = custom.filter((c) => states[c.id]?.done === true).length
    // Same done state as ChecklistView (checklistSync): a milestone-linked item is also done when its milestone is.
    const milestonesDone = settings.coachInputs.value?.milestonesDone ?? {}
    const itemDone = (i: { id: string; milestone?: string | null }) =>
      states[i.id]?.done === true || (!!i.milestone && Object.prototype.hasOwnProperty.call(milestonesDone, i.milestone))
    return reviewProgress({
      reviewStatus: rounds.review.value?.status ?? null,
      mappingConfirmed: settings.mappingConfirmed.value,
      missingInputs: missingInputs.value,
      suggestedModules: suggestedModules.value,
      triage: { done: tri.value.done, total: tri.value.total },
      manualFindingCount: manual.items.value.length,
      documents: {
        total: documents.value.length,
        reviewed: documents.value.filter((d) => isDocumentReviewed(d, manual.byDocument.value.get(d.id)?.length ?? 0)).length,
      },
      checklist: {
        done: checklistItems.filter(itemDone).length + customDone,
        total: checklistItems.length + custom.length,
      },
      feedback: {
        total: fb.length,
        draft: fb.filter((i) => i.status === 'draft').length,
        posted: fb.filter((i) => i.status === 'posted').length,
        sent: fb.filter((i) => i.status === 'sent').length,
      },
      rounds: rounds.rounds.value.length,
    })
  })

  const blockers = computed<ApprovalBlockers | null>(() => {
    if (!facts.value) return null
    const confirmed = settings.mappingConfirmed.value
    const js = findingsHandle.jsDays.value
    return approvalBlockers({
      findings: findings.value,
      feedback: feedback.items.value,
      jsDays: confirmed && js ? { valid: js.validDayCount, required: findingsHandle.jsMinDays.value } : null,
      mappingConfirmed: confirmed,
    })
  })

  const verdict = computed<ReviewVerdict | null>(() => {
    const b = blockers.value
    if (!b) return null
    const review = rounds.review.value
    const approvedAt = [...(review?.history ?? [])].reverse().find((h) => h.status === 'bewilligt' || h.status === 'bewilligt_mit_auflagen')?.at ?? null
    return reviewVerdict({ blockers: b, reviewStatus: review?.status ?? null, approvedAt })
  })

  const nextStep = computed<ReviewStepKey | null>(() => progress.value?.steps.find((s) => !s.done)?.key ?? null)

  // Persist for «Meine Lager». Delayed past useFindings' own summary write (300 ms) so the record exists.
  if (opts.persist !== false) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const snapshot = computed(() =>
      progress.value ? toCampProgressSummary(progress.value, { triageOpen: Math.max(0, tri.value.total - tri.value.done), openMust: openMust.value }) : null,
    )
    watch(
      () => (snapshot.value ? `${iri.value}|${snapshotKey(snapshot.value)}` : null),
      (key) => {
        clearTimeout(timer)
        const snap = snapshot.value
        const campIriNow = iri.value
        if (!key || !snap || lastSaved.get(campIriNow) === snapshotKey(snap)) return
        timer = setTimeout(() => {
          const f = facts.value
          const base = f
            ? {
                campIri: f.camp.iri,
                title: f.camp.title,
                start: f.camp.start,
                end: f.camp.end,
                counts: findingsHandle.counts.value,
                validJsDays: null,
                totalDays: null,
                evaluatedAt: new Date().toISOString(),
              }
            : null
          void saveCampProgress(campIriNow, snap, base)
            .then((ok) => ok && lastSaved.set(campIriNow, snapshotKey(snap)))
            .catch(() => {})
        }, 700)
      },
      { immediate: true },
    )
  }

  return { progress, blockers, verdict, nextStep, openMust, triageOpen: computed(() => Math.max(0, tri.value.total - tri.value.done)), suggestedModules, missingInputs }
}
