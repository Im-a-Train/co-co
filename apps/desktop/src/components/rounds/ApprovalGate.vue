<script setup lang="ts">
/**
 * Approval guard + ApprovalCheckDialog as a component, so the camp header can mount it on demand:
 * useApprovalGuard evaluates all rules (useFindings), which the header must not do on every camp page.
 */
import ApprovalCheckDialog from '@/components/rounds/ApprovalCheckDialog.vue'
import { useApprovalGuard } from '@/composables/useApprovalGuard'
import type { Iri, ReviewStatus } from '@/domain/types'

const props = defineProps<{ campIri: Iri; campId: string }>()
const emit = defineEmits<{ (e: 'apply', status: ReviewStatus, note: string | null): void }>()

const guard = useApprovalGuard(
  () => props.campIri,
  (status, note) => emit('apply', status, note),
)
defineExpose({ request: guard.request })
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
