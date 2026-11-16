/**
 * Guard for the two approval entry points (header status menu and Runden stepper): setting «Bewilligt» or
 * «Bewilligt mit Auflagen» while something still speaks against it asks first (ApprovalCheckDialog).
 * Local co-co state only; nothing is written to eCamp.
 */
import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useReviewProgress } from '@/composables/useReviewProgress'
import type { ApprovalBlockers } from '@/domain/rounds'
import type { Iri, ReviewStatus } from '@/domain/types'

/** How long an approval request waits for the camp to finish loading. */
const approvalWaitMs = 10_000

export const isApprovalStatus = (s: ReviewStatus): boolean => s === 'bewilligt' || s === 'bewilligt_mit_auflagen'

export function useApprovalGuard(
  campIri: MaybeRefOrGetter<Iri>,
  apply: (status: ReviewStatus, note: string | null) => Promise<void> | void,
  opts: { /** Also write the «Meine Lager» progress snapshot (only the header instance does). */ persist?: boolean } = {},
) {
  const progress = useReviewProgress(campIri, { persist: opts.persist === true })
  const pending = ref<{ status: ReviewStatus; note: string | null } | null>(null)
  const blockers = computed<ApprovalBlockers | null>(() => progress.blockers.value)

  /** The check can run: camp facts are loaded and the blockers are computed. */
  const ready = computed(() => blockers.value !== null)

  /** Waits for the blockers (camp still loading); false when they do not arrive in time. */
  function whenReady(timeoutMs: number): Promise<boolean> {
    if (blockers.value !== null) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        stop()
        resolve(false)
      }, timeoutMs)
      const stop = watch(blockers, (b) => {
        if (b === null) return
        clearTimeout(timer)
        stop()
        resolve(true)
      })
    })
  }

  /**
   * Applies the status at once, or opens the dialog when approving with open blockers. Fails closed: an approval
   * is never applied while the check could not run (returns 'notReady' then).
   */
  async function request(status: ReviewStatus, note: string | null = null): Promise<'applied' | 'pending' | 'notReady'> {
    if (isApprovalStatus(status)) {
      if (!(await whenReady(approvalWaitMs))) return 'notReady'
      if (blockers.value?.any) {
        pending.value = { status, note }
        return 'pending'
      }
    }
    await apply(status, note)
    return 'applied'
  }
  async function confirm(note: string | null): Promise<void> {
    const p = pending.value
    pending.value = null
    if (p) await apply(p.status, note ?? p.note)
  }
  const open = computed({
    get: () => pending.value !== null,
    set: (v: boolean) => {
      if (!v) pending.value = null
    },
  })
  return { request, confirm, open, pending, blockers, ready, campIri: computed(() => toValue(campIri)) }
}
