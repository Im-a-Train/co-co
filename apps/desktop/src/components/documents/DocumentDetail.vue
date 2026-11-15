<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AiSummaryButton from '@/components/ai/AiSummaryButton.vue'
import ManualFindingDialog from '@/components/cockpit/ManualFindingDialog.vue'
import { activityOptions, checkCounts, isSafetyConcept } from '@/domain/documents'
import type { CampFacts, DocumentAnchor, DocumentRecord, Iri, SafetyCheckKey, Stufe } from '@/domain/types'
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
  /** Stufe from «Angaben» (presets the GPX pace). */
  stufe?: Stufe | null
}>()
const emit = defineEmits<{
  aiAllowed: [id: string, value: boolean]
  summarised: [id: string, text: string]
  link: [id: string, activityIri: Iri]
  safetyConcept: [id: string, value: boolean | null]
  confirmItem: [id: string, key: SafetyCheckKey, value: boolean]
}>()
const { t } = useI18n()

/** Anchor the viewer jumps to; a fresh object per request so repeated jumps to the same place still fire. */
const jumpTarget = ref<DocumentAnchor | null>(null)
// Multi-source watch: compares element by element, so saving the record (new object) does not reset the viewer.
watch(
  [() => props.doc?.id, () => props.initialAnchor],
  () => {
    jumpTarget.value = props.initialAnchor ? { ...props.initialAnchor } : null
  },
  { immediate: true },
)
function jump(a: DocumentAnchor) {
  jumpTarget.value = { ...a }
}

const options = computed(() => activityOptions(props.facts))
const asConcept = computed(() => !!props.doc && props.doc.kind !== 'gpx' && !props.doc.gpx && isSafetyConcept(props.doc))
const counts = computed(() => (props.doc?.docCheck ? checkCounts(props.doc.docCheck, props.doc.docCheckConfirmed ?? []) : null))
const panels = ref([0])
const showText = computed(() => !!props.doc?.text && ['pdf', 'docx', 'xlsx'].includes(props.doc.kind))

// «Als Befund übernehmen» for a checklist item: opens the finding dialog prefilled.
const findingDialog = ref(false)
const findingText = ref('')
function itemToFinding(key: SafetyCheckKey) {
  findingText.value = t('documents.checklist.findingText', { item: t(`documents.checklist.short.${key}`) })
  findingDialog.value = true
}

function fmtSize(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">{{ doc?.name ?? t('documents.detail.title') }}</v-card-title>
    <v-card-text v-if="doc" class="d-flex flex-column ga-3">
      <div class="text-caption text-medium-emphasis">
        {{ t('documents.detail.path') }}: {{ doc.path }} · {{ fmtSize(doc.size) }} ·
        {{ doc.text ? t('documents.detail.textLength', { n: doc.text.length }) : t('documents.detail.noText') }}
      </div>
      <v-alert v-if="doc.extractError" type="warning" variant="tonal" density="compact" :text="doc.extractError" />
      <v-chip size="small" color="warning" variant="tonal" prepend-icon="mdi-shield-lock-outline" class="align-self-start" data-testid="document-zone">
        {{ doc.aiAllowed ? t('documents.detail.zoneAi') : t('documents.detail.zoneLocal') }}
      </v-chip>

      <v-card variant="tonal" data-testid="document-check">
        <v-card-title class="text-subtitle-1">{{ t('documents.detail.checkTitle') }}</v-card-title>
        <v-card-text>
          <GpxCard
            v-if="doc.gpx"
            :doc="doc"
            :facts="facts"
            :pace-default="paceDefault"
            :pace-woelfe="paceWoelfe"
            :include-descent-default="includeDescent"
            :stufe="stufe"
            :options="options"
            @link="(iri: Iri) => emit('link', doc!.id, iri)"
          />
          <template v-else-if="asConcept">
            <v-expansion-panels v-model="panels" multiple variant="accordion">
              <v-expansion-panel data-testid="document-check-panel">
                <v-expansion-panel-title>
                  <span v-if="counts" data-testid="document-check-verdict">
                    {{ t('documents.detail.conceptVerdict', counts) }}
                  </span>
                  <span v-else>{{ t('documents.checklist.title') }}</span>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <SafetyChecklist
                    :check="doc.docCheck"
                    :confirmed="doc.docCheckConfirmed"
                    @confirm="(k: SafetyCheckKey, v: boolean) => emit('confirmItem', doc!.id, k, v)"
                    @to-finding="itemToFinding"
                  />
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
            <v-btn
              size="small"
              variant="text"
              class="mt-2"
              data-testid="document-unmark-concept"
              :text="t('documents.detail.unmarkConcept')"
              @click="emit('safetyConcept', doc.id, false)"
            />
          </template>
          <template v-else>
            <div class="text-body-2">{{ t('documents.detail.notConcept') }}</div>
            <v-btn
              size="small"
              variant="tonal"
              class="mt-2"
              data-testid="document-mark-concept"
              :text="t('documents.detail.markConcept')"
              @click="emit('safetyConcept', doc.id, true)"
            />
          </template>
        </v-card-text>
      </v-card>

      <DocumentViewer :doc="doc" :target="jumpTarget" />
      <DocumentFindings :doc="doc" @jump="jump" />

      <v-card variant="tonal" color="warning">
        <v-card-text>
          <v-switch
            :model-value="doc.aiAllowed"
            :label="t('documents.ai.label')"
            color="warning"
            density="compact"
            hide-details
            data-testid="document-ai-switch"
            @update:model-value="emit('aiAllowed', doc.id, !!$event)"
          />
          <div class="text-caption mt-1">{{ t('documents.ai.warning') }}</div>
          <div v-if="doc.aiAllowed" class="mt-2">
            <AiSummaryButton :doc="doc" :facts="facts" show-not-ready @summarised="(txt: string) => emit('summarised', doc!.id, txt)" />
            <div v-if="doc.aiSummary" class="mt-2"><strong>{{ t('documents.ai.summary') }}:</strong> {{ doc.aiSummary }}</div>
          </div>
        </v-card-text>
      </v-card>

      <v-expansion-panels v-if="showText" variant="accordion">
        <v-expansion-panel data-testid="document-extracted-text">
          <v-expansion-panel-title>{{ t('documents.detail.extractedText', { n: doc.text.length }) }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <pre class="preview text-caption">{{ doc.text.slice(0, 3000) }}{{ doc.text.length > 3000 ? ' …' : '' }}</pre>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <ManualFindingDialog
        v-model="findingDialog"
        :camp-iri="doc.campIri"
        scope="document"
        :document-id="doc.id"
        :title="doc.name"
        default-category="documents"
        :initial-comment="findingText"
      />
    </v-card-text>
  </v-card>
</template>

<style scoped>
.preview {
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
}
</style>
