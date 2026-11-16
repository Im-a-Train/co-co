<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Finding } from '@/domain/types'

/** `findings`: one finding, or all findings of a group (ignored together with one reason). */
const props = defineProps<{ modelValue: boolean; findings: Finding[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: [findings: Finding[], reason: string] }>()
const { t } = useI18n()

const reason = ref('')
/** Ignoring a Muss needs a reason. */
const needsReason = computed(() => props.findings.some((f) => f.severity === 'must'))
const canSubmit = computed(() => !needsReason.value || !!reason.value.trim())

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reason.value = ''
    }
  },
)

function submit() {
  if (!props.findings.length || !canSubmit.value) return
  emit('confirm', props.findings, reason.value.trim())
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card :title="t('findings.dialog.title')">
      <v-card-text>
        <p class="mb-2 text-body-2">{{ t(needsReason ? 'findings.dialog.textMust' : 'findings.dialog.text') }}</p>
        <p v-if="findings.length" class="mb-3 font-weight-medium">
          {{ findings[0]!.title }}<template v-if="findings.length > 1"> · {{ t('findings.counter.findings', { count: findings.length }, findings.length) }}</template>
        </p>
        <v-textarea
          v-model="reason"
          :label="needsReason ? t('findings.dialog.reasonMust') : t('findings.dialog.reason')"
          rows="3"
          auto-grow
          autofocus
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :text="t('common.cancel')" @click="emit('update:modelValue', false)" />
        <v-btn color="primary" variant="flat" :disabled="!canSubmit" :text="t('findings.dialog.confirm')" data-testid="override-confirm" @click="submit" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
