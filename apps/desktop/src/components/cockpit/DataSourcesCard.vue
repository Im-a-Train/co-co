<script setup lang="ts">
/**
 * Übersicht: state of the NDS/MiData comparison and Rega registration. Counts only, never names (ADR 0009).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePersons } from '@/composables/usePersons'
import { getNdsRecord } from '@/domain/nds/store'
import type { Iri, NdsRegaCounts } from '@/domain/types'

const props = defineProps<{ campIri: Iri; params: Record<string, string> }>()
const { t } = useI18n()
const persons = usePersons(() => props.campIri)

const rega = ref<NdsRegaCounts | null>(null)
const ndsLoaded = ref(false)

async function loadRega(): Promise<void> {
  try {
    rega.value = (await getNdsRecord(props.campIri))?.aggregate?.rega ?? null
  } catch {
    rega.value = null
  }
  ndsLoaded.value = true
}
onMounted(() => void loadRega())
watch(
  () => [props.campIri, persons.nds.value],
  () => void loadRega(),
)

const summary = computed(() => persons.summary.value)
const regaMissing = computed(() =>
  rega.value
    ? Math.max(0, rega.value.participantsTotal - rega.value.participantsTransmitted) +
      Math.max(0, rega.value.supervisorsTotal - rega.value.supervisorsTransmitted)
    : 0,
)
</script>

<template>
  <v-card variant="outlined" class="mb-4" data-testid="overview-datasources">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      <span class="flex-grow-1">{{ t('cockpit.overview.sources.title') }}</span>
      <v-btn
        size="small"
        variant="text"
        :to="{ name: 'camp-persons', params }"
        :text="t('cockpit.overview.sources.open')"
        append-icon="mdi-arrow-right"
      />
    </v-card-title>
    <v-card-text class="d-flex flex-column ga-2">
      <div class="d-flex align-center ga-2" data-testid="overview-sources-compare">
        <v-icon
          :icon="!summary.compared ? 'mdi-information-outline' : summary.differences ? 'mdi-alert-outline' : 'mdi-check-circle-outline'"
          :color="!summary.compared ? undefined : summary.differences ? 'warning' : 'success'"
          size="small"
        />
        <span v-if="!summary.compared" class="text-body-2 text-medium-emphasis">
          {{ t('cockpit.overview.sources.notCompared') }}
        </span>
        <span v-else class="text-body-2">
          {{
            summary.differences
              ? t('cockpit.overview.sources.differences', { count: summary.differences }, summary.differences)
              : t('cockpit.overview.sources.noDifferences')
          }}
        </span>
      </div>
      <div class="d-flex align-center ga-2" data-testid="overview-sources-rega">
        <v-icon
          :icon="rega ? (regaMissing ? 'mdi-alert-outline' : 'mdi-check-circle-outline') : 'mdi-information-outline'"
          :color="rega ? (regaMissing ? 'warning' : 'success') : undefined"
          size="small"
        />
        <span v-if="!rega" class="text-body-2 text-medium-emphasis">{{ t('cockpit.overview.sources.regaNone') }}</span>
        <span v-else class="text-body-2" :class="{ 'text-warning': regaMissing > 0 }">
          {{
            t('cockpit.overview.sources.rega', {
              done: rega.participantsTransmitted,
              total: rega.participantsTotal,
            })
          }}
          <template v-if="rega.supervisorsTotal > 0">
            ·
            {{
              t('cockpit.overview.sources.regaSupervisors', {
                done: rega.supervisorsTransmitted,
                total: rega.supervisorsTotal,
              })
            }}
          </template>
        </span>
      </div>
    </v-card-text>
  </v-card>
</template>
