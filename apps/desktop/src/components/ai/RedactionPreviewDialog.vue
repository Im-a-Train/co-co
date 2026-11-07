<script setup lang="ts">
/** Shows exactly what will be sent to the AI (after redaction). */
import { useI18n } from 'vue-i18n'
import type { AiPreview } from '@/domain/zones/features'

defineProps<{ modelValue: boolean; preview: AiPreview | null; busy: boolean; error: string | null }>()
defineEmits<{ 'update:modelValue': [value: boolean]; confirm: []; cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="760" persistent @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>{{ t('ai.preview.title') }}</v-card-title>
      <v-card-text>
        <v-alert type="info" variant="tonal" density="compact" class="mb-3">
          {{ t('ai.preview.explain') }}
        </v-alert>
        <div class="text-caption mb-1">
          {{ t('ai.preview.redactions', { n: preview?.redactionCount ?? 0 }) }}
        </div>
        <pre class="preview-text pa-3 rounded border">{{ preview?.previewText }}</pre>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3" :text="error" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="busy" @click="$emit('cancel')">{{ t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="busy" @click="$emit('confirm')">
          {{ t('ai.preview.send') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.preview-text {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 50vh;
  overflow: auto;
  font-family: inherit;
  font-size: 0.85rem;
}
</style>
