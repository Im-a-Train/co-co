<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useManualFindings } from '@/composables/useManualFindings'
import { findingsForActivity } from '@/domain/cockpit'
import { getDb } from '@/domain/storage/db'
import type { CampFacts, CategoryClass, DocumentRecord, Finding, Iri } from '@/domain/types'
import AiSafetyReviewButton from '@/components/ai/AiSafetyReviewButton.vue'
import ActivityPreview from './ActivityPreview.vue'
import ActivityTagEditor from './ActivityTagEditor.vue'
import FindingCard from './FindingCard.vue'
import ManualFindingDialog from './ManualFindingDialog.vue'
import ManualFindingList from './ManualFindingList.vue'

const props = defineProps<{
  modelValue: boolean
  activityIri: Iri | null
  campIri: Iri
  facts: CampFacts | null
  findings: Finding[]
  classOf: (categoryIri: Iri | null) => CategoryClass
  /** Set when the grid was opened from a finding: shows «Zurück zum Befund». */
  origin?: { ruleId: string; title: string } | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  feedback: [finding: Finding]
  showFindings: [activityIri: Iri]
  /** Jump to the documents tab (documentId selects a document there). */
  openDocument: [documentId: string | null]
  aiFindings: [findings: Finding[]]
  backToFinding: []
}>()
const { t } = useI18n()

const activity = computed(() => props.facts?.activities.find((a) => a.iri === props.activityIri) ?? null)
const own = computed(() =>
  props.activityIri ? findingsForActivity(props.findings, props.activityIri).filter((f) => f.origin !== 'manual') : [],
)
const manualHandle = useManualFindings(() => props.campIri)
const manualOwn = computed(() => (props.activityIri ? (manualHandle.byActivity.value.get(props.activityIri) ?? []) : []))
const addOpen = ref(false)

const docs = ref<DocumentRecord[]>([])
watch(
  () => [props.modelValue, props.activityIri] as const,
  async ([open, iri]) => {
    docs.value = []
    if (!open || !iri) return
    try {
      const all = await getDb().documents.where('campIri').equals(props.campIri).toArray()
      docs.value = all.filter((d) => d.activityIris.includes(iri))
    } catch {
      docs.value = []
    }
  },
  { immediate: true },
)

</script>

<template>
  <v-navigation-drawer
    :model-value="modelValue"
    location="right"
    temporary
    width="440"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="activity" class="pa-4">
      <div class="d-flex align-start ga-2">
        <div class="flex-grow-1">
          <template v-if="origin">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              prepend-icon="mdi-arrow-left"
              :text="t('findings.backToFinding.button')"
              data-testid="drawer-back-to-finding"
              @click="emit('backToFinding')"
            />
            <div class="text-caption text-medium-emphasis mt-1">
              {{ t('findings.backToFinding.context', origin) }}
            </div>
          </template>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" :aria-label="t('common.close')" @click="emit('update:modelValue', false)" />
      </div>

      <ActivityPreview :facts="facts" :activity-iri="activityIri" :class-of="classOf" />

      <ActivityTagEditor :camp-iri="campIri" :activity-iri="activity.iri" />

      <div class="text-subtitle-2">{{ t('cockpit.drawer.documents') }}</div>
      <div v-if="docs.length" class="d-flex flex-wrap ga-1 mb-3">
        <v-chip
          v-for="d in docs"
          :key="d.id"
          size="small"
          prepend-icon="mdi-file-document-outline"
          :text="d.name"
          @click="emit('openDocument', d.id)"
        />
      </div>
      <div v-else class="text-body-2 text-medium-emphasis mb-3">{{ t('cockpit.drawer.noDocuments') }}</div>
      <v-btn
        size="small"
        variant="text"
        class="mb-3"
        prepend-icon="mdi-file-document-multiple-outline"
        :text="t('cockpit.drawer.openDocuments')"
        @click="emit('openDocument', docs[0]?.id ?? null)"
      />

      <div class="d-flex align-center mb-2">
        <div class="text-subtitle-2 flex-grow-1">{{ t('cockpit.drawer.manual.title') }} ({{ manualOwn.length }})</div>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-comment-plus-outline"
          :text="t('findings.manual.add')"
          data-testid="drawer-add-finding"
          @click="addOpen = true"
        />
      </div>
      <ManualFindingList v-if="manualOwn.length" :camp-iri="campIri" :items="manualOwn" compact class="mb-3" data-testid="drawer-manual-list" />
      <ManualFindingDialog v-model="addOpen" :camp-iri="campIri" scope="activity" :activity-iri="activity.iri" :title="activity.title" />

      <div class="d-flex align-center mb-2">
        <div class="text-subtitle-2 flex-grow-1">{{ t('cockpit.drawer.findings') }} ({{ own.length }})</div>
        <v-btn v-if="own.length" size="small" variant="text" :text="t('cockpit.drawer.allFindings')" @click="emit('showFindings', activity.iri)" />
      </div>
      <div class="mb-2">
        <AiSafetyReviewButton :activity="activity" :facts="facts" @findings="emit('aiFindings', $event)" />
      </div>
      <div v-if="!own.length" class="text-body-2 text-medium-emphasis mb-3">{{ t('cockpit.drawer.noFindings') }}</div>
      <div class="d-flex flex-column ga-2 mb-3">
        <FindingCard v-for="f in own" :key="f.id" :finding="f" compact @feedback="emit('feedback', $event)" />
      </div>
    </div>
  </v-navigation-drawer>
</template>
