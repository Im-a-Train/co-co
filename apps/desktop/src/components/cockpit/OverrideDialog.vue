<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Finding } from '@/domain/types'

const props = defineProps<{ modelValue: boolean; finding: Finding | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: [finding: Finding, reason: string] }>()
const { t } = useI18n()

const reason = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reason.value = ''
    }
  },
)

function submit() {
  if (!props.finding) return
  emit('confirm', props.finding, reason.value.trim())
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card :title="t('findings.dialog.title')">
      <v-card-text>
        <p class="mb-2 text-body-2">{{ t('findings.dialog.text') }}</p>
        <p v-if="finding" class="mb-3 font-weight-medium">{{ finding.ruleId }}: {{ finding.title }}</p>
        <v-textarea
          v-model="reason"
          :label="t('findings.dialog.reason')"
          rows="3"
          auto-grow
          autofocus
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :text="t('common.cancel')" @click="emit('update:modelValue', false)" />
        <v-btn color="primary" variant="flat" :text="t('findings.dialog.confirm')" @click="submit" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
