<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { findingsForActivity, formatClock, formatDate, minutesOfDay, responsibleNames, dateOf } from '@/domain/cockpit'
import { getDb } from '@/domain/storage/db'
import type { CampFacts, CategoryClass, DocumentRecord, Finding, Iri } from '@/domain/types'
import AiSafetyReviewButton from '@/components/ai/AiSafetyReviewButton.vue'
import FindingCard from './FindingCard.vue'

const props = defineProps<{
  modelValue: boolean
  activityIri: Iri | null
  campIri: Iri
  facts: CampFacts | null
  findings: Finding[]
  classOf: (categoryIri: Iri | null) => CategoryClass
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  feedback: [finding: Finding]
  showFindings: [activityIri: Iri]
  /** Jump to the documents tab (documentId selects a document there). */
  openDocument: [documentId: string | null]
  aiFindings: [findings: Finding[]]
}>()
const { t } = useI18n()

const activity = computed(() => props.facts?.activities.find((a) => a.iri === props.activityIri) ?? null)
const category = computed(() => props.facts?.categories.find((c) => c.iri === activity.value?.categoryIri) ?? null)
const entries = computed(() => props.facts?.scheduleEntries.filter((e) => e.activityIri === props.activityIri) ?? [])
const people = computed(() => (props.activityIri && props.facts ? responsibleNames(props.facts, props.activityIri) : []))
const own = computed(() => (props.activityIri ? findingsForActivity(props.findings, props.activityIri) : []))

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

function entryTime(e: { start: string; end: string }): string {
  return `${formatDate(dateOf(e.start))} ${formatClock(minutesOfDay(e.start))}–${formatClock(minutesOfDay(e.end))}`
}
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
        <div class="text-h6 flex-grow-1">{{ activity.title }}</div>
        <v-btn icon="mdi-close" variant="text" size="small" :aria-label="t('common.close')" @click="emit('update:modelValue', false)" />
      </div>

      <v-list density="compact" class="px-0">
        <v-list-item v-for="e in entries" :key="e.iri" prepend-icon="mdi-clock-outline" :title="entryTime(e)" :subtitle="e.number ?? undefined" />
        <v-list-item v-if="category" prepend-icon="mdi-shape-outline" :title="`${category.short} ${category.name}`" :subtitle="t(`categoryClass.${classOf(category.iri)}`)">
          <template #append><span class="d-inline-block rounded-circle" :style="{ width: '14px', height: '14px', background: category.color }" /></template>
        </v-list-item>
        <v-list-item v-if="activity.location" prepend-icon="mdi-map-marker-outline" :title="activity.location" />
        <v-list-item prepend-icon="mdi-account-group-outline" :title="people.length ? people.join(', ') : t('cockpit.drawer.noResponsibles')" :subtitle="t('cockpit.drawer.responsibles')" />
      </v-list>

      <div class="text-subtitle-2 mt-3">{{ t('cockpit.drawer.storyboard') }}</div>
      <div class="text-body-2 text-pre-wrap mb-3">{{ activity.content.storyboardText || t('cockpit.drawer.empty') }}</div>

      <div class="text-subtitle-2">{{ t('cockpit.drawer.safety') }}</div>
      <div class="text-body-2 text-pre-wrap mb-3">{{ activity.content.safetyText || t('cockpit.drawer.empty') }}</div>

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
