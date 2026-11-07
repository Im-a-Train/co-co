<script setup lang="ts">
/** Key content of one activity (time, category, place, responsibles, storyboard, safety). Shared by drawer and triage. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatClock, formatDate, minutesOfDay, responsibleNames, dateOf } from '@/domain/cockpit'
import type { CampFacts, CategoryClass, Iri } from '@/domain/types'

const props = defineProps<{
  facts: CampFacts | null
  activityIri: Iri | null
  classOf: (categoryIri: Iri | null) => CategoryClass
  /** Shorten long storyboard/safety texts (triage pane). */
  excerpt?: boolean
}>()
const { t } = useI18n()

const activity = computed(() => props.facts?.activities.find((a) => a.iri === props.activityIri) ?? null)
const category = computed(() => props.facts?.categories.find((c) => c.iri === activity.value?.categoryIri) ?? null)
const entries = computed(() => props.facts?.scheduleEntries.filter((e) => e.activityIri === props.activityIri) ?? [])
const people = computed(() => (props.activityIri && props.facts ? responsibleNames(props.facts, props.activityIri) : []))

function entryTime(e: { start: string; end: string }): string {
  return `${formatDate(dateOf(e.start))} ${formatClock(minutesOfDay(e.start))}–${formatClock(minutesOfDay(e.end))}`
}
const MAX = 320
function cut(raw: string): string {
  if (!raw) return t('cockpit.drawer.empty')
  if (!props.excerpt) return raw
  const text = raw.replace(/\n\s*\n+/g, '\n').trim()
  return text.length > MAX ? `${text.slice(0, MAX).trimEnd()} …` : text
}
</script>

<template>
  <div v-if="activity" class="activity-preview" data-testid="activity-preview">
    <div class="text-h6">{{ activity.title }}</div>
    <v-list density="compact" class="px-0">
      <v-list-item v-for="e in entries" :key="e.iri" prepend-icon="mdi-clock-outline" :title="entryTime(e)" :subtitle="e.number ?? undefined" />
      <v-list-item
        v-if="category"
        prepend-icon="mdi-shape-outline"
        :title="`${category.short} ${category.name}`"
        :subtitle="t(`categoryClass.${classOf(category.iri)}`)"
      >
        <template #append>
          <span class="d-inline-block rounded-circle" :style="{ width: '14px', height: '14px', background: category.color }" />
        </template>
      </v-list-item>
      <v-list-item v-if="activity.location" prepend-icon="mdi-map-marker-outline" :title="activity.location" />
      <v-list-item
        prepend-icon="mdi-account-group-outline"
        :title="people.length ? people.join(', ') : t('cockpit.drawer.noResponsibles')"
        :subtitle="t('cockpit.drawer.responsibles')"
      />
    </v-list>

    <div class="text-subtitle-2 mt-2">{{ t('cockpit.drawer.storyboard') }}</div>
    <div class="text-body-2 text-pre-wrap mb-3">{{ cut(activity.content.storyboardText) }}</div>

    <div class="text-subtitle-2">{{ t('cockpit.drawer.safety') }}</div>
    <div class="text-body-2 text-pre-wrap mb-3">{{ cut(activity.content.safetyText) }}</div>
  </div>
</template>
