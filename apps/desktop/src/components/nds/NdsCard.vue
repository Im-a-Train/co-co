<script setup lang="ts">
/** NDS card on the Lager-Angaben page: link state, explicit refresh, status chips, counts, activities, rentals, adopt. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate, formatStand } from '@/components/midata/format'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampNds, useNds } from '@/composables/useNds'
import { ndsFieldDiffs, ndsStateLabel } from '@/domain/nds'
import type { CoachInputs, Iri, NdsAggregate, NdsCampSummary, NdsField } from '@/domain/types'
import NdsAdoptDialog from './NdsAdoptDialog.vue'
import NdsCampPicker from './NdsCampPicker.vue'
import { countEntries } from './format'

const props = defineProps<{ campIri: Iri; inputs: CoachInputs }>()
const emit = defineEmits<{ adopt: [fields: NdsField[], agg: NdsAggregate] }>()

const { t } = useI18n()
const { facts } = useCampFacts(() => props.campIri)
const nds = useNds()
const camp = useCampNds(() => props.campIri, facts)

const pickerOpen = ref(false)
const adoptOpen = ref(false)

onMounted(() => {
  void nds.init()
  void camp.load()
})
watch(
  () => [props.campIri, facts.value] as const,
  () => void camp.load(),
)

const agg = computed(() => camp.record.value?.aggregate ?? null)
const diffs = computed(() => (agg.value ? ndsFieldDiffs(agg.value, props.inputs) : []))
const ready = computed(() => nds.enabled.value && nds.connected.value)

const counts = computed(() => {
  const s = agg.value?.statistics
  if (!s) return []
  const rows: { key: string; planned: number | null; actual: number | null }[] = [
    { key: 'totalParticipants', planned: s.planned.totalParticipants, actual: s.actual.totalParticipants },
    { key: 'children', planned: s.planned.children, actual: s.actual.children },
    { key: 'adolescents', planned: s.planned.adolescents, actual: s.actual.adolescents },
    { key: 'totalInstructors', planned: s.planned.totalInstructors, actual: s.actual.totalInstructors },
    { key: 'jsInstructors', planned: s.planned.jsInstructors, actual: s.actual.jsInstructors },
    { key: 'campDays', planned: s.planned.campDays, actual: s.actual.campDays },
    { key: 'totalActivities', planned: s.planned.totalActivities, actual: s.actual.totalActivities },
  ]
  return rows.filter((r) => r.planned !== null || r.actual !== null)
})
const num = (n: number | null): string => (n === null ? '–' : String(n))
const dates = computed(() => {
  const a = agg.value
  if (!a?.start) return '–'
  return a.end && a.end !== a.start ? `${formatDate(a.start)} – ${formatDate(a.end)}` : formatDate(a.start)
})

async function openPicker(): Promise<void> {
  pickerOpen.value = true
  await camp.findCamps()
}
async function pick(c: NdsCampSummary): Promise<void> {
  pickerOpen.value = false
  await camp.pickCamp(c)
}
function apply(fields: NdsField[]): void {
  adoptOpen.value = false
  if (agg.value) emit('adopt', fields, agg.value)
}
</script>

<template>
  <div data-testid="nds-card">
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1 d-flex align-center flex-wrap ga-2">
        {{ t('nds.card.title') }}
        <v-chip size="x-small" color="red-darken-2" variant="tonal" label>{{ t('nds.redZone') }}</v-chip>
      </v-card-title>
      <v-card-text>
        <template v-if="!facts">
          <span class="text-medium-emphasis">{{ t('nds.card.noFacts') }}</span>
        </template>
        <template v-else>
          <div v-if="!ready" class="d-flex align-center flex-wrap ga-3 mb-2">
            <span class="text-medium-emphasis" data-testid="nds-not-connected">
              {{ nds.enabled.value ? t('nds.card.notConnected') : t('nds.card.disabled') }}
            </span>
            <v-btn variant="tonal" size="small" to="/einstellungen" data-testid="nds-to-settings">{{ t('nds.card.toSettings') }}</v-btn>
          </div>
          <div class="d-flex align-center flex-wrap ga-3 mb-2">
            <span v-if="camp.link.value" data-testid="nds-link">{{ t('nds.card.link.set', { id: camp.link.value.campBusinessId }) }}</span>
            <span v-else class="text-medium-emphasis">{{ t('nds.card.link.none') }}</span>
            <v-btn v-if="ready" size="small" variant="tonal" data-testid="nds-pick" @click="openPicker">
              {{ camp.link.value ? t('nds.card.changeCamp') : t('nds.card.pick') }}
            </v-btn>
          </div>

          <div v-if="camp.link.value" class="d-flex align-center flex-wrap ga-3">
            <v-btn v-if="ready" color="primary" size="small" :loading="camp.loading.value" data-testid="nds-refresh" @click="camp.refresh()">
              {{ t('nds.card.refresh') }}
            </v-btn>
            <v-btn v-if="agg" variant="tonal" size="small" data-testid="nds-adopt-open" @click="adoptOpen = true">{{ t('nds.card.adopt') }}</v-btn>
            <v-btn variant="text" size="small" data-testid="nds-unlink" @click="camp.unlink()">{{ t('nds.card.unlink') }}</v-btn>
            <span v-if="agg" class="text-caption" data-testid="nds-stand">{{ t('nds.card.stand', { date: formatStand(agg.fetchedAt) }) }}</span>
            <span v-else class="text-caption text-medium-emphasis">{{ t('nds.card.noData') }}</span>
          </div>
          <div v-if="camp.link.value" class="text-caption text-medium-emphasis mt-1">{{ t('nds.card.refreshHint') }}</div>

          <v-alert v-if="camp.error.value" type="error" variant="tonal" density="compact" class="mt-3">
            {{ t('nds.card.loadFailed') }}: {{ camp.error.value }}
          </v-alert>

          <div v-if="agg" class="mt-4" data-testid="nds-summary">
            <div class="d-flex flex-wrap ga-2 mb-3">
              <v-chip v-if="agg.offerState" size="small" variant="tonal" data-testid="nds-chip-offer">
                {{ t('nds.summary.offerState') }}: {{ ndsStateLabel(agg.offerState) }}
              </v-chip>
              <v-chip v-if="agg.offerItemState" size="small" variant="tonal" data-testid="nds-chip-camp">
                {{ t('nds.summary.campState') }}: {{ ndsStateLabel(agg.offerItemState) }}
              </v-chip>
              <v-chip v-if="agg.approvedOn" size="small" variant="tonal" color="success" data-testid="nds-chip-approved">
                {{ t('nds.summary.approvedOn', { date: formatDate(agg.approvedOn) }) }}
              </v-chip>
              <v-chip v-if="agg.campAgendaUploaded !== null" size="small" variant="tonal" :color="agg.campAgendaUploaded ? 'success' : 'warning'">
                {{ agg.campAgendaUploaded ? t('nds.summary.agendaYes') : t('nds.summary.agendaNo') }}
              </v-chip>
              <v-chip v-if="agg.statistics.coachAuthorizedForContribution !== null" size="small" variant="tonal">
                {{ agg.statistics.coachAuthorizedForContribution ? t('nds.summary.contributionYes') : t('nds.summary.contributionNo') }}
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis mb-2">
              {{ t('nds.summary.dates') }}: {{ dates }}<template v-if="agg.offerNumber"> · {{ t('nds.summary.offerNumber') }}: {{ agg.offerNumber }}</template>
            </div>
            <div v-if="agg.approvedOn" class="text-caption text-medium-emphasis mb-2">{{ t('nds.summary.approvedHint') }}</div>

            <v-table v-if="counts.length" density="compact" class="mb-3" data-testid="nds-counts">
              <thead>
                <tr>
                  <th>{{ t('nds.summary.counts') }}</th>
                  <th class="text-right">{{ t('nds.summary.planned') }}</th>
                  <th class="text-right">{{ t('nds.summary.actual') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in counts" :key="r.key">
                  <td>{{ t(`nds.summary.count.${r.key}`) }}</td>
                  <td class="text-right">{{ num(r.planned) }}</td>
                  <td class="text-right">{{ num(r.actual) }}</td>
                </tr>
              </tbody>
            </v-table>

            <div class="summary mb-3">
              <div>
                <div class="text-caption text-medium-emphasis">{{ t('nds.summary.participants') }}</div>
                <div class="text-h6" data-testid="nds-participants">{{ agg.participantCount }}</div>
                <div v-for="e in countEntries(agg.participantCountsByAudience)" :key="e.code" class="text-caption">{{ e.label }}: {{ e.n }}</div>
              </div>
              <div>
                <div class="text-caption text-medium-emphasis">{{ t('nds.summary.supervisors') }}</div>
                <div v-for="e in countEntries(agg.supervisorCounts)" :key="e.code" class="text-body-2">{{ e.label }}: {{ e.n }}</div>
                <div v-if="Object.keys(agg.supervisorCounts).length === 0" class="text-h6">–</div>
              </div>
              <div v-if="agg.rega" data-testid="nds-rega">
                <div class="text-caption text-medium-emphasis">{{ t('nds.summary.rega.title') }}</div>
                <div class="text-body-2">
                  {{ t('nds.summary.rega.participants', { sent: agg.rega.participantsTransmitted, total: agg.rega.participantsTotal }) }}
                </div>
                <div class="text-body-2">
                  {{ t('nds.summary.rega.supervisors', { sent: agg.rega.supervisorsTransmitted, total: agg.rega.supervisorsTotal }) }}
                </div>
              </div>
              <div data-testid="nds-activities">
                <div class="text-caption text-medium-emphasis">{{ t('nds.summary.activities') }}</div>
                <div class="text-h6">{{ agg.activities.total }}</div>
                <div v-for="e in countEntries(agg.activities.byState)" :key="e.code" class="text-caption">{{ e.label }}: {{ e.n }}</div>
                <div v-if="agg.activities.lastActivityDate" class="text-caption">
                  {{ t('nds.summary.lastActivity', { date: formatDate(agg.activities.lastActivityDate) }) }}
                </div>
              </div>
            </div>

            <v-alert v-if="agg.activities.attendanceOpenCount > 0" type="warning" variant="tonal" density="compact" class="mb-3" data-testid="nds-awk-open">
              {{ t('nds.summary.awkOpen', { n: agg.activities.attendanceOpenCount }) }}
            </v-alert>
            <div v-else-if="agg.activities.total > 0" class="text-caption mb-3" data-testid="nds-awk-ok">{{ t('nds.summary.awkOk') }}</div>

            <div v-if="agg.rentalOrders.length" data-testid="nds-rentals">
              <div class="text-caption text-medium-emphasis">{{ t('nds.summary.rentals') }}</div>
              <div v-for="(o, i) in agg.rentalOrders" :key="i" class="text-body-2">
                {{ o.orderState ? ndsStateLabel(o.orderState) : '–' }}
                <template v-if="o.dispatchmentDate"> · {{ t('nds.summary.dispatch', { date: formatDate(o.dispatchmentDate) }) }}</template>
                <template v-if="o.returnDate"> · {{ t('nds.summary.return', { date: formatDate(o.returnDate) }) }}</template>
              </div>
            </div>
          </div>
        </template>
      </v-card-text>
    </v-card>

    <NdsCampPicker
      v-model="pickerOpen"
      :camps="camp.camps.value ?? []"
      :loading="camp.campsLoading.value ?? false"
      :error="camp.campsError.value ?? null"
      @pick="pick"
    />
    <NdsAdoptDialog v-model="adoptOpen" :diffs="diffs" @apply="apply" />
  </div>
</template>

<style scoped>
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
}
</style>
