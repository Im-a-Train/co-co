<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { compareGpxToSlot, gpxWithPace, type ActivityOption } from '@/domain/documents'
import type { CampFacts, DocumentRecord, Iri, Stufe } from '@/domain/types'
import ActivityLinkPicker from './ActivityLinkPicker.vue'

const props = defineProps<{
  doc: DocumentRecord
  facts: CampFacts | null
  paceDefault: number
  paceWoelfe: number
  includeDescentDefault: boolean
  /** Stufe from «Angaben»; «Wölfe» presets the slower pace. */
  stufe?: Stufe | null
  options: ActivityOption[]
}>()
const emit = defineEmits<{ link: [iri: Iri] }>()
const { t } = useI18n()

const woelfeFromInputs = computed(() => props.stufe === 'woelfe')
const woelfe = ref(woelfeFromInputs.value)
const includeDescent = ref(props.includeDescentDefault)
// Multi-source watch: saving the record (new doc object, e.g. after a link) must not reset the switches.
watch(
  [() => props.doc.id, () => props.stufe],
  () => {
    woelfe.value = woelfeFromInputs.value
    includeDescent.value = props.includeDescentDefault
  },
)

const stats = computed(() =>
  props.doc.gpx ? gpxWithPace(props.doc.gpx, woelfe.value ? props.paceWoelfe : props.paceDefault, includeDescent.value) : null,
)
const linked = computed(() => props.doc.activityIris.length > 0)
const slot = computed(() => (stats.value ? compareGpxToSlot(stats.value, props.facts, props.doc.activityIris) : null))

function fmtMin(n: number): string {
  const h = Math.floor(n / 60)
  const m = n % 60
  return h ? t('documents.hoursMinutes', { h, m }) : t('documents.minutes', { n: m })
}
const statsLine = computed(() => {
  const s = stats.value
  if (!s) return ''
  const base = t('documents.gpx.stats', { km: s.distanceKm, up: s.ascentM, down: s.descentM })
  return s.highestPointM !== null ? base + t('documents.gpx.statsMax', { m: s.highestPointM }) : base
})
</script>

<template>
  <div v-if="stats" data-testid="gpx-card">
    <div class="d-flex flex-wrap align-center ga-2">
      <span class="text-subtitle-1 font-weight-medium" data-testid="gpx-lead">
        {{ t('documents.gpx.lead', { time: fmtMin(stats.estimatedMinutes), lkm: includeDescent ? stats.lkmWithDescent : stats.lkm, pace: stats.paceLkmPerHour }) }}
      </span>
      <template v-if="linked && slot && slot.slotMinutes !== null">
        <v-chip v-if="slot.fits" size="small" color="success" variant="tonal">{{ t('documents.gpx.fits') }}</v-chip>
        <v-chip v-else size="small" color="warning" variant="tonal">{{ t('documents.gpx.tooLong', { min: slot.deltaMinutes }) }}</v-chip>
      </template>
    </div>
    <div v-if="linked && slot && slot.slotMinutes !== null" class="text-caption text-medium-emphasis">
      {{ t('documents.gpx.slot') }}: {{ fmtMin(slot.slotMinutes) }}
    </div>
    <div v-else-if="linked" class="text-caption text-medium-emphasis">
      <v-icon size="small" icon="mdi-information-outline" /> {{ t('documents.gpx.noSlot') }}
    </div>
    <div v-else class="mt-2" data-testid="gpx-pick-activity">
      <div class="text-body-2 mb-1">{{ t('documents.gpx.pickActivity') }}</div>
      <ActivityLinkPicker :options="options" @pick="emit('link', $event)" />
    </div>

    <div class="text-body-2 text-medium-emphasis mt-2" data-testid="gpx-stats">
      {{ statsLine }}<span v-if="stats.name"> · {{ stats.name }}</span>
    </div>

    <v-expansion-panels variant="accordion" class="mt-3">
      <v-expansion-panel data-testid="gpx-adjust">
        <v-expansion-panel-title>{{ t('documents.gpx.adjust') }}</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="text-caption text-medium-emphasis mb-2">{{ t('documents.gpx.lkmFormula') }}</div>
          <div class="d-flex flex-wrap align-center ga-4">
            <v-switch v-model="includeDescent" :label="t('documents.gpx.includeDescent')" density="compact" hide-details color="primary" />
            <v-switch
              v-model="woelfe"
              :label="t(woelfeFromInputs ? 'documents.gpx.paceFromInputs' : 'documents.gpx.paceWoelfe', { pace: paceWoelfe })"
              density="compact"
              hide-details
              color="primary"
            />
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>
