<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { compareGpxToSlot, gpxWithPace } from '@/domain/documents'
import type { CampFacts, DocumentRecord } from '@/domain/types'

const props = defineProps<{
  doc: DocumentRecord
  facts: CampFacts | null
  paceDefault: number
  paceWoelfe: number
  includeDescentDefault: boolean
}>()
const { t } = useI18n()

const woelfe = ref(false)
const includeDescent = ref(props.includeDescentDefault)
watch(
  () => props.doc.id,
  () => {
    woelfe.value = false
    includeDescent.value = props.includeDescentDefault
  },
)

const stats = computed(() =>
  props.doc.gpx ? gpxWithPace(props.doc.gpx, woelfe.value ? props.paceWoelfe : props.paceDefault, includeDescent.value) : null,
)
const slot = computed(() => (stats.value ? compareGpxToSlot(stats.value, props.facts, props.doc.activityIris) : null))

function fmtMin(n: number): string {
  const h = Math.floor(n / 60)
  const m = n % 60
  return h ? t('documents.hoursMinutes', { h, m }) : t('documents.minutes', { n: m })
}
</script>

<template>
  <v-card v-if="stats" variant="outlined">
    <v-card-title class="text-subtitle-1">
      {{ t('documents.gpx.title') }}
      <span v-if="stats.name" class="text-medium-emphasis text-body-2 ml-2">{{ stats.name }}</span>
    </v-card-title>
    <v-card-text>
      <div class="d-flex flex-wrap ga-2 mb-3">
        <v-chip size="small" prepend-icon="mdi-map-marker-distance">{{ t('documents.gpx.distance') }}: {{ stats.distanceKm }} km</v-chip>
        <v-chip size="small" prepend-icon="mdi-trending-up">{{ t('documents.gpx.ascent') }}: {{ stats.ascentM }} m</v-chip>
        <v-chip size="small" prepend-icon="mdi-trending-down">{{ t('documents.gpx.descent') }}: {{ stats.descentM }} m</v-chip>
        <v-chip v-if="stats.highestPointM !== null" size="small" prepend-icon="mdi-summit">
          {{ t('documents.gpx.highest') }}: {{ stats.highestPointM }} m
        </v-chip>
        <v-chip size="small" variant="tonal">{{ t('documents.gpx.points', { n: stats.pointCount }) }}</v-chip>
      </div>
      <div class="text-h6">{{ t('documents.gpx.lkm') }}: {{ includeDescent ? stats.lkmWithDescent : stats.lkm }}</div>
      <div class="text-caption text-medium-emphasis mb-2">{{ t('documents.gpx.lkmFormula') }}</div>
      <div class="d-flex flex-wrap align-center ga-4">
        <v-switch v-model="includeDescent" :label="t('documents.gpx.includeDescent')" density="compact" hide-details color="primary" />
        <v-switch
          v-model="woelfe"
          :label="`${t('documents.gpx.paceWoelfe')} (${paceWoelfe} Lkm/h)`"
          density="compact"
          hide-details
          color="primary"
        />
      </div>
      <div class="mt-3">
        {{ t('documents.gpx.estimate') }}: <strong>{{ fmtMin(stats.estimatedMinutes) }}</strong>
        <span class="text-caption text-medium-emphasis ml-1">({{ stats.paceLkmPerHour }} Lkm/h)</span>
      </div>
      <div v-if="slot" class="mt-1">
        <template v-if="slot.slotMinutes === null">
          <v-icon size="small" icon="mdi-information-outline" /> {{ t('documents.gpx.noSlot') }}
        </template>
        <template v-else>
          {{ t('documents.gpx.slot') }}: {{ fmtMin(slot.slotMinutes) }}
          <v-chip v-if="slot.fits" size="small" color="success" variant="tonal" class="ml-2">{{ t('documents.gpx.fits') }}</v-chip>
          <v-chip v-else size="small" color="warning" variant="tonal" class="ml-2">
            {{ t('documents.gpx.tooLong', { min: slot.deltaMinutes }) }}
          </v-chip>
        </template>
      </div>
    </v-card-text>
  </v-card>
</template>
