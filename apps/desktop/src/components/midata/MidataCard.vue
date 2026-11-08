<script setup lang="ts">
/** MiData card on the Lager-Angaben page: link state, explicit refresh, summary, adopt, qualification matrix. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampMidata, useMidata } from '@/composables/useMidata'
import { buildQualificationMatrix, compareWithInputs, type QualMapping } from '@/domain/midata'
import { getAreaOverrides, type CampAreaOverrides } from '@/domain/midata/areaOverrides'
import type { CoachInputs, Iri, MidataAggregate, MidataField } from '@/domain/types'
import { makeAreaOf, makeKeywordsOf } from './areas'
import { formatStand } from './format'
import MidataAdoptDialog from './MidataAdoptDialog.vue'
import MidataEventPicker from './MidataEventPicker.vue'
import QualificationMatrix from './QualificationMatrix.vue'

const props = defineProps<{ campIri: Iri; inputs: CoachInputs }>()
const emit = defineEmits<{ adopt: [fields: MidataField[], agg: MidataAggregate] }>()

const { t } = useI18n()
const { facts } = useCampFacts(() => props.campIri)
const md = useMidata()
const camp = useCampMidata(() => props.campIri, facts)

const pickerOpen = ref(false)
const adoptOpen = ref(false)

const dismissed = ref<CampAreaOverrides>({})
async function loadDismissed(): Promise<void> {
  try {
    dismissed.value = await getAreaOverrides(props.campIri)
  } catch {
    dismissed.value = {}
  }
}

onMounted(() => {
  void md.init()
  void camp.load()
  void loadDismissed()
})
watch(
  () => [props.campIri, facts.value] as const,
  () => void camp.load(),
)
watch(() => props.campIri, () => void loadDismissed())

const agg = computed(() => camp.record.value?.aggregate ?? null)
const diffs = computed(() => (agg.value ? compareWithInputs(agg.value, props.inputs) : []))
const matrix = computed(() =>
  agg.value && facts.value
    ? buildQualificationMatrix(agg.value, facts.value, makeAreaOf(facts.value.activities, dismissed.value), makeKeywordsOf(facts.value.activities))
    : null,
)

async function saveMapping(next: QualMapping): Promise<void> {
  await md.saveQualMapping(next)
}

async function openPicker(): Promise<void> {
  pickerOpen.value = true
  await camp.findEvents()
}
async function pick(id: string): Promise<void> {
  pickerOpen.value = false
  await camp.pickEvent(id)
}
function apply(fields: MidataField[]): void {
  adoptOpen.value = false
  if (agg.value) emit('adopt', fields, agg.value)
}
</script>

<template>
  <div data-testid="midata-card">
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1 d-flex align-center flex-wrap ga-2">
        {{ t('midata.card.title') }}
        <v-chip size="x-small" color="red-darken-2" variant="tonal" label>{{ t('midata.redZone') }}</v-chip>
      </v-card-title>
      <v-card-text>
        <template v-if="!facts">
          <span class="text-medium-emphasis">{{ t('midata.card.noFacts') }}</span>
        </template>
        <template v-else>
          <div v-if="!md.connected.value" class="d-flex align-center flex-wrap ga-3 mb-2">
            <span class="text-medium-emphasis">{{ t('midata.card.notConnected') }}</span>
            <v-btn variant="tonal" size="small" to="/einstellungen" data-testid="midata-to-settings">
              {{ t('midata.card.toSettings') }}
            </v-btn>
          </div>
          <div class="d-flex align-center flex-wrap ga-3 mb-2">
            <span v-if="camp.link.value" data-testid="midata-link">
              {{ t(`midata.card.link.${camp.link.value.source}`, { id: camp.link.value.eventId }) }}
            </span>
            <span v-else class="text-medium-emphasis">{{ t('midata.card.link.none') }}</span>
            <v-btn
              v-if="md.connected.value && (!camp.link.value || camp.link.value.source === 'manual')"
              size="small"
              variant="tonal"
              data-testid="midata-pick"
              @click="openPicker"
            >
              {{ camp.link.value ? t('midata.card.changeEvent') : t('midata.card.pick') }}
            </v-btn>
          </div>

          <div v-if="camp.link.value" class="d-flex align-center flex-wrap ga-3">
            <v-btn v-if="md.connected.value" color="primary" size="small" :loading="camp.loading.value" data-testid="midata-refresh" @click="camp.refresh()">
              {{ t('midata.card.refresh') }}
            </v-btn>
            <v-btn v-if="agg" variant="tonal" size="small" data-testid="midata-adopt-open" @click="adoptOpen = true">
              {{ t('midata.card.adopt') }}
            </v-btn>
            <v-btn variant="text" size="small" data-testid="midata-unlink" @click="camp.unlink()">{{ t('midata.card.unlink') }}</v-btn>
            <span v-if="agg" class="text-caption" data-testid="midata-stand">{{ t('midata.card.stand', { date: formatStand(agg.fetchedAt) }) }}</span>
            <span v-else class="text-caption text-medium-emphasis">{{ t('midata.card.noData') }}</span>
          </div>
          <div v-if="camp.link.value" class="text-caption text-medium-emphasis mt-1">{{ t('midata.card.refreshHint') }}</div>

          <v-alert v-if="camp.error.value" type="error" variant="tonal" density="compact" class="mt-3">
            {{ t('midata.card.loadFailed') }}: {{ camp.error.value }}
          </v-alert>

          <div v-if="agg" class="summary mt-4" data-testid="midata-summary">
            <div>
              <div class="text-caption text-medium-emphasis">{{ t('midata.card.summary.participants') }}</div>
              <div class="text-h6">{{ agg.participantsCount }}</div>
              <div v-if="agg.participantsWithoutBirthday" class="text-caption">
                {{ t('midata.card.summary.withoutBirthday', { n: agg.participantsWithoutBirthday }) }}
              </div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">{{ t('midata.card.summary.jsAge') }}</div>
              <div class="text-h6">{{ agg.participantsJsAgeCount }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">{{ t('midata.card.summary.ages') }}</div>
              <div class="text-h6">
                {{ agg.minAge !== null && agg.maxAge !== null ? t('midata.card.summary.agesRange', { min: agg.minAge, max: agg.maxAge }) : '–' }}
              </div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">{{ t('midata.card.summary.leaders') }}</div>
              <div class="text-h6">{{ agg.leadersCount }}</div>
            </div>
          </div>
          <div v-if="agg" class="mt-3 d-flex align-center flex-wrap ga-2" data-testid="midata-coach">
            <template v-if="agg.coachNickname">
              <v-icon
                size="small"
                :icon="agg.coachMatch === true ? 'mdi-check-circle' : agg.coachMatch === false ? 'mdi-close-circle' : 'mdi-help-circle'"
                :color="agg.coachMatch === true ? 'success' : agg.coachMatch === false ? 'error' : undefined"
              />
              <span>{{ t('midata.card.summary.coachLine', { name: agg.coachNickname }) }}</span>
              <span :class="agg.coachMatch === true ? 'text-success' : agg.coachMatch === false ? 'text-error' : 'text-medium-emphasis'" data-testid="midata-coach-match">
                ({{ agg.coachMatch === true ? t('midata.card.summary.coachMatchYes') : agg.coachMatch === false ? t('midata.card.summary.coachMatchNo') : t('midata.card.summary.coachMatchUnknown') }})
              </span>
            </template>
            <span v-else class="text-medium-emphasis">{{ t('midata.card.summary.coachNone') }}</span>
          </div>
          <div v-if="agg" class="text-caption text-medium-emphasis mt-2">
            {{ t('midata.card.summary.event') }}: {{ agg.eventName }}<template v-if="agg.location"> · {{ t('midata.card.summary.location') }}: {{ agg.location }}</template>
          </div>
        </template>
      </v-card-text>
    </v-card>

    <QualificationMatrix
      v-if="matrix"
      :matrix="matrix"
      :kinds="agg?.qualificationKinds ?? []"
      :mapping="md.qualMapping.value"
      :loading="camp.loading.value"
      @save-mapping="saveMapping"
      @reload="camp.refresh()"
    />

    <MidataEventPicker
      v-model="pickerOpen"
      :events="camp.events.value ?? []"
      :loading="camp.eventsLoading.value ?? false"
      :error="camp.eventsError.value ?? null"
      @pick="pick"
    />
    <MidataAdoptDialog v-model="adoptOpen" :diffs="diffs" @apply="apply" />
  </div>
</template>

<style scoped>
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 16px;
}
</style>
