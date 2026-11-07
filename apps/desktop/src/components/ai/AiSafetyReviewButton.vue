<script setup lang="ts">
/**
 * Soft AI review of an activity's safety considerations. Used in the findings view;
 * emitted findings go to useFindings().addAiFindings.
 * Props/emits are used by feedback, documents and cockpit views.
 * Renders nothing while AI is disabled;
 * always shows the redaction preview dialog before sending.
 */
import { useI18n } from 'vue-i18n'
import { useAi, useAiFlow } from '@/composables/useAi'
import { reviewActivitySafety, runSafetyReview } from '@/domain/zones/features'
import type { ActivityFact, CampFacts, Finding } from '@/domain/types'
import RedactionPreviewDialog from './RedactionPreviewDialog.vue'

const props = defineProps<{ activity: ActivityFact; facts: CampFacts | null }>()
const emit = defineEmits<{ findings: [findings: Finding[]] }>()

const { t } = useI18n()
const { ready } = useAi()
const flow = useAiFlow<Finding[]>()

function start() {
  const facts = props.facts
  if (!facts) return
  flow.start(
    () => reviewActivitySafety(props.activity, facts),
    (p) => runSafetyReview(p, props.activity),
    (f) => emit('findings', f),
  )
}
</script>

<template>
  <span v-if="ready">
    <v-btn size="small" variant="text" prepend-icon="mdi-creation" :disabled="!facts" @click="start">
      {{ t('ai.safety.button') }}
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
