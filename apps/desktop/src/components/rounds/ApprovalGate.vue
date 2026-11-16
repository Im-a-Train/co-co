<script setup lang="ts">
/**
 * Approval guard + ApprovalCheckDialog as a component, so the camp header can mount it on demand:
 * useApprovalGuard evaluates all rules (useFindings); the header arms it shortly after mount so the progress snapshot
 * stays current on every camp tab, and at the latest when the menu opens.
 */
import ApprovalCheckDialog from '@/components/rounds/ApprovalCheckDialog.vue'
import { useApprovalGuard } from '@/composables/useApprovalGuard'
import type { Iri, ReviewStatus } from '@/domain/types'

const props = defineProps<{ campIri: Iri; campId: string }>()
const emit = defineEmits<{ (e: 'apply', status: ReviewStatus, note: string | null): void }>()

// The header instance is the one that keeps the «Meine Lager» progress snapshot current on every camp tab.
const guard = useApprovalGuard(
  () => props.campIri,
  (status, note) => emit('apply', status, note),
  { persist: true },
)
defineExpose({ request: guard.request, ready: guard.ready })
</script>

<template>
  <ApprovalCheckDialog
    v-if="guard.pending.value && guard.blockers.value"
    v-model="guard.open.value"
    :camp-id="campId"
    :blockers="guard.blockers.value"
    :target="guard.pending.value.status"
    :initial-note="guard.pending.value.note"
    @confirm="guard.confirm"
  />
</template>
