<script setup lang="ts">
/**
 * Rephrase a feedback item in Feedback-Kultur tone. Embedded by the feedback builder.
 * OWNER: ai builder. CONTRACT: props + emits below are frozen. Renders nothing while AI is disabled;
 * always shows the redaction preview dialog before sending.
 */
import { useI18n } from 'vue-i18n'
import { useAi, useAiFlow } from '@/composables/useAi'
import { rephraseFeedback, runRephrase } from '@/domain/zones/features'
import type { CampFacts, FeedbackItem } from '@/domain/types'
import RedactionPreviewDialog from './RedactionPreviewDialog.vue'

const props = defineProps<{ item: FeedbackItem; facts: CampFacts | null }>()
const emit = defineEmits<{ rephrased: [text: string] }>()

const { t } = useI18n()
const { ready } = useAi()
const flow = useAiFlow<string>()

function start() {
  const facts = props.facts
  if (!facts) {
    flow.error.value = t('ai.noFacts')
    return
  }
  flow.start(() => rephraseFeedback(props.item, facts), runRephrase, (text) => emit('rephrased', text))
}
</script>

<template>
  <span v-if="ready">
    <v-btn size="small" variant="text" prepend-icon="mdi-creation" :disabled="!facts" @click="start">
      {{ t('ai.rephrase.button') }}
    </v-btn>
    <v-tooltip v-if="flow.error.value && !flow.open.value" activator="parent" location="bottom">
      {{ flow.error.value }}
    </v-tooltip>
    <RedactionPreviewDialog
      v-model="flow.open.value"
      :preview="flow.preview.value"
      :busy="flow.busy.value"
      :error="flow.error.value"
      @confirm="flow.confirm"
      @cancel="flow.cancel"
    />
  </span>
</template>
