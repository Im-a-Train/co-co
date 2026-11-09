<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AiSummaryButton from '@/components/ai/AiSummaryButton.vue'
import type { CampFacts, DocumentAnchor, DocumentRecord } from '@/domain/types'
import DocumentFindings from './DocumentFindings.vue'
import DocumentViewer from './DocumentViewer.vue'
import GpxCard from './GpxCard.vue'
import SafetyChecklist from './SafetyChecklist.vue'

const props = defineProps<{
  doc: DocumentRecord | null
  /** Deep link target (?page=<n>) applied when the document is opened. */
  initialAnchor?: DocumentAnchor | null
  facts: CampFacts | null
  paceDefault: number
  paceWoelfe: number
  includeDescent: boolean
}>()
const emit = defineEmits<{ aiAllowed: [id: string, value: boolean]; summarised: [id: string, text: string] }>()
const { t } = useI18n()

const tab = ref<'view' | 'text'>('view')
/** Anchor the viewer jumps to; a fresh object per request so repeated jumps to the same place still fire. */
const jumpTarget = ref<DocumentAnchor | null>(null)
watch(
  () => [props.doc?.id, props.initialAnchor] as const,
  () => {
    tab.value = 'view'
    jumpTarget.value = props.initialAnchor ? { ...props.initialAnchor } : null
  },
  { immediate: true },
)
function jump(a: DocumentAnchor) {
  tab.value = 'view'
  jumpTarget.value = { ...a }
}

function fmtSize(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">{{ doc?.name ?? t('documents.detail.title') }}</v-card-title>
    <v-card-text v-if="!doc" class="text-medium-emphasis">{{ t('documents.detail.select') }}</v-card-text>
    <v-card-text v-else class="d-flex flex-column ga-3">
      <div class="text-caption text-medium-emphasis">
        {{ t('documents.detail.path') }}: {{ doc.path }} · {{ fmtSize(doc.size) }} ·
        {{ doc.text ? t('documents.detail.textLength', { n: doc.text.length }) : t('documents.detail.noText') }}
      </div>
      <v-alert v-if="doc.extractError" type="warning" variant="tonal" density="compact" :text="doc.extractError" />
      <v-chip size="small" color="warning" variant="tonal" prepend-icon="mdi-shield-lock-outline" class="align-self-start">
        {{ t('documents.detail.zone') }}
      </v-chip>

      <v-tabs v-model="tab" density="compact">
        <v-tab value="view" data-testid="document-tab-view">{{ t('documents.detail.tabView') }}</v-tab>
        <v-tab value="text" data-testid="document-tab-text">{{ t('documents.detail.tabText') }}</v-tab>
      </v-tabs>

      <!-- v-show keeps the viewer mounted: switching tabs neither re-reads the file nor loses the position. -->
      <div v-show="tab === 'view'" class="d-flex flex-column ga-3">
        <DocumentViewer :doc="doc" :target="jumpTarget" />
        <DocumentFindings :doc="doc" @jump="jump" />
      </div>

      <template v-if="tab === 'text'">
      <GpxCard
        v-if="doc.gpx"
        :doc="doc"
        :facts="facts"
        :pace-default="paceDefault"
        :pace-woelfe="paceWoelfe"
        :include-descent-default="includeDescent"
      />
      <SafetyChecklist v-else-if="doc.kind !== 'gpx'" :check="doc.docCheck" />

      <v-card variant="tonal" color="warning">
        <v-card-text>
          <v-switch
            :model-value="doc.aiAllowed"
            :label="t('documents.ai.label')"
            color="warning"
            density="compact"
            hide-details
            @update:model-value="emit('aiAllowed', doc.id, !!$event)"
          />
          <div class="text-caption mt-1">{{ t('documents.ai.warning') }}</div>
          <div v-if="doc.aiAllowed" class="mt-2">
            <AiSummaryButton :doc="doc" :facts="facts" @summarised="(txt: string) => emit('summarised', doc!.id, txt)" />
            <div v-if="doc.aiSummary" class="mt-2"><strong>{{ t('documents.ai.summary') }}:</strong> {{ doc.aiSummary }}</div>
          </div>
        </v-card-text>
      </v-card>

      <div v-if="doc.text">
        <div class="text-subtitle-2">{{ t('documents.detail.preview') }}</div>
        <pre class="preview text-caption">{{ doc.text.slice(0, 1500) }}{{ doc.text.length > 1500 ? ' …' : '' }}</pre>
      </div>
      </template>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.preview {
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
}
</style>
