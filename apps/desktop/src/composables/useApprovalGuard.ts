/**
 * Guard for the two approval entry points (header status menu and Runden stepper): setting «Bewilligt» or
 * «Bewilligt mit Auflagen» while something still speaks against it asks first (ApprovalCheckDialog).
 * Local co-co state only; nothing is written to eCamp.
 */
import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useReviewProgress } from '@/composables/useReviewProgress'
import type { ApprovalBlockers } from '@/domain/rounds'
import type { Iri, ReviewStatus } from '@/domain/types'

export const isApprovalStatus = (s: ReviewStatus): boolean => s === 'bewilligt' || s === 'bewilligt_mit_auflagen'

export function useApprovalGuard(
  campIri: MaybeRefOrGetter<Iri>,
  apply: (status: ReviewStatus, note: string | null) => Promise<void> | void,
) {
  const progress = useReviewProgress(campIri, { persist: false })
  const pending = ref<{ status: ReviewStatus; note: string | null } | null>(null)
  const blockers = computed<ApprovalBlockers | null>(() => progress.blockers.value)

  /** Applies the status at once, or opens the dialog when approving with open blockers. */
  async function request(status: ReviewStatus, note: string | null = null): Promise<void> {
    if (isApprovalStatus(status) && blockers.value?.any) {
      pending.value = { status, note }
      return
    }
    await apply(status, note)
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
  return { request, confirm, open, pending, blockers, campIri: computed(() => toValue(campIri)) }
}
