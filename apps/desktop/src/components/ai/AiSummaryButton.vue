<script setup lang="ts">
/**
 * Summarise a document (only if doc.aiAllowed).
 * Props/emits are used by feedback, documents and cockpit views. Renders nothing while AI is disabled;
 * always shows the redaction preview dialog before sending.
 */
import { useI18n } from 'vue-i18n'
import { useAi, useAiFlow } from '@/composables/useAi'
import { runSummary, summariseDocument } from '@/domain/zones/features'
import type { CampFacts, DocumentRecord } from '@/domain/types'
import RedactionPreviewDialog from './RedactionPreviewDialog.vue'

const props = defineProps<{ doc: DocumentRecord; facts: CampFacts | null }>()
const emit = defineEmits<{ summarised: [text: string] }>()

const { t } = useI18n()
const { ready } = useAi()
const flow = useAiFlow<string>()

function start() {
  const facts = props.facts
  if (!facts) return
  flow.start(() => summariseDocument(props.doc, facts), runSummary, (text) => emit('summarised', text))
}
</script>

<template>
  <span v-if="ready">
    <v-btn
      size="small"
      variant="text"
      prepend-icon="mdi-creation"
      :disabled="!doc.aiAllowed || !facts"
      @click="start"
    >
      {{ t('ai.summary.button') }}
      <v-tooltip v-if="!doc.aiAllowed" activator="parent" location="bottom">{{ t('ai.summary.notAllowed') }}</v-tooltip>
    </v-btn>
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
