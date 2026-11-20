<script setup lang="ts">
/** Review status chip for the camp header; the menu offers only the allowed transitions. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ApprovalGate from '@/components/rounds/ApprovalGate.vue'
import { isApprovalStatus } from '@/composables/useApprovalGuard'
import { useCampRoute } from '@/composables/useCampRoute'
import { useRounds } from '@/composables/useRounds'
import { allowedTransitions, reviewStatusColor } from '@/domain/rounds'
import type { Iri, ReviewStatus } from '@/domain/types'

const props = defineProps<{ campIri: Iri }>()
const { t } = useI18n()
const r = useRounds(() => props.campIri)
const error = ref<string | null>(null)

// Arm the check (and with it the progress snapshot for «Meine Lager») shortly after mount, off the first paint.
let armTimer: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
  void r.load()
  armTimer = setTimeout(() => (gateArmed.value = true), 1500)
})
onBeforeUnmount(() => clearTimeout(armTimer))
watch(
  () => props.campIri,
  () => void r.load(),
)

const current = computed<ReviewStatus>(() => r.review.value?.status ?? 'neu')
const options = computed(() => allowedTransitions(current.value))

const { campId } = useCampRoute()

async function apply(status: ReviewStatus, note: string | null) {
  error.value = null
  try {
    await r.setStatus(status, note)
  } catch {
    error.value = t('rounds.errors.invalidTransition')
  }
}
const menuOpen = ref(false)
const gateArmed = ref(false)
watch(menuOpen, (open) => {
  if (open) gateArmed.value = true
})
const gate = ref<InstanceType<typeof ApprovalGate> | null>(null)
/** Approval entries stay disabled until the camp is loaded and the check can run (fail closed). */
const approvalReady = computed(() => gate.value?.ready === true)
async function set(status: ReviewStatus) {
  if (!isApprovalStatus(status)) return apply(status, null)
  gateArmed.value = true
  await nextTick()
  // Without the gate (cannot happen: the menu armed it) nothing is approved unchecked.
  const result = await gate.value?.request(status)
  if (result === 'notReady' || result === undefined) error.value = t('rounds.status.notReady')
}
</script>

<template>
  <div class="d-flex align-center ga-2">
    <v-menu v-model="menuOpen">
      <template #activator="{ props: menu }">
        <v-chip
          v-bind="menu"
          :color="reviewStatusColor(current)"
          variant="flat"
          prepend-icon="mdi-clipboard-check-outline"
          append-icon="mdi-menu-down"
          :aria-label="t('rounds.status.title')"
        >
          {{ t(`reviewStatus.${current}`) }}
        </v-chip>
      </template>
      <v-list density="compact">
        <v-list-subheader>{{ t('rounds.status.setTo') }}</v-list-subheader>
        <v-list-item
          v-for="s in options"
          :key="s"
          :title="t(`reviewStatus.${s}`)"
          :subtitle="isApprovalStatus(s) && !approvalReady ? t('rounds.status.notReadyShort') : undefined"
          :disabled="isApprovalStatus(s) && !approvalReady"
          @click="set(s)"
        />
        <v-list-item v-if="!options.length" :title="t('rounds.status.noTransitions')" disabled />
      </v-list>
    </v-menu>
    <span v-if="error" class="text-caption text-error">{{ error }}</span>
    <ApprovalGate v-if="gateArmed" ref="gate" :camp-iri="campIri" :camp-id="campId" @apply="apply" />
  </div>
</template>
