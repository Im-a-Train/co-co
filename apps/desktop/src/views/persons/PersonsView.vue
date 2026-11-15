<script setup lang="ts">
/** /lager/:campId/personen: people of the camp from MiData and NDS, reconciled (P1: read only, memory only). */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MidataEventPicker from '@/components/midata/MidataEventPicker.vue'
import QualificationMatrix from '@/components/midata/QualificationMatrix.vue'
import NdsCampPicker from '@/components/nds/NdsCampPicker.vue'
import { ndsLinkLabel } from '@/components/nds/format'
import PersonsTable from '@/components/persons/PersonsTable.vue'
import { STATE_COLOR } from '@/components/persons/stateColor'
import { useCampRoute } from '@/composables/useCampRoute'
import { usePersons } from '@/composables/usePersons'
import type { PersonKind } from '@/domain/persons/types'
import { countBy, filterRows, NO_FILTERS, sortByProblem, summarizePersons, toggleValue, toViewRows, type PersonFilters, type ViewState } from '@/domain/persons/view'
import type { MidataQualKey, NdsCampSummary } from '@/domain/types'

const { t } = useI18n()
const { campIri } = useCampRoute()
const p = usePersons(campIri)

const filters = ref<PersonFilters>({ ...NO_FILTERS })
const KINDS: PersonKind[] = ['participant', 'leader', 'kitchen', 'coach', 'guest', 'other']
const STATES: ViewState[] = ['missing_in_nds', 'only_in_nds', 'ambiguous', 'field_diff', 'match']
const DEFAULT_QUALS: MidataQualKey[] = ['lagerleiter', 'leiterLsT']

const regaMissingOnly = computed({
  get: () => filters.value.rega === 'missing',
  set: (v: boolean | null) => (filters.value.rega = v ? 'missing' : 'all'),
})

// Columns of the qualification chips: the ones the camp needs (team card); LL and LS/T without a MiData aggregate.
const qualColumns = computed<MidataQualKey[]>(() => p.qualMatrix.value?.columns ?? DEFAULT_QUALS)
const allRows = computed(() => toViewRows(p.rows.value, p.campStart.value, p.compared.value))
const shown = computed(() => sortByProblem(filterRows(allRows.value, filters.value), qualColumns.value))
const kindCounts = computed(() => countBy(allRows.value.map((r) => r.kind)))
const summary = computed(() => summarizePersons(allRows.value))
const stateCounts = computed(() => countBy(allRows.value.map((r) => r.state)))
const hasData = computed(() => p.midata.value !== null || p.nds.value !== null)

const jsItems = computed(() => [
  { value: 'all', title: t('persons.filter.jsAge') },
  { value: 'yes', title: t('persons.filter.jsAgeYes') },
  { value: 'no', title: t('persons.filter.jsAgeNo') },
])

const midataPickerOpen = ref(false)
const ndsPickerOpen = ref(false)
async function openMidataPicker(): Promise<void> {
  midataPickerOpen.value = true
  await p.midataCamp.findEvents()
}
// A different source means the loaded lists belong to another event / camp: forget them (memory and Rust).
async function pickMidata(id: string): Promise<void> {
  midataPickerOpen.value = false
  const before = p.midataCamp.link.value?.eventId ?? null
  await p.midataCamp.pickEvent(id)
  if (hasData.value && p.midataCamp.link.value?.eventId !== before) await p.clear()
}
async function openNdsPicker(): Promise<void> {
  ndsPickerOpen.value = true
  await p.ndsCamp.findCamps()
}
async function pickNds(c: NdsCampSummary): Promise<void> {
  ndsPickerOpen.value = false
  const before = p.ndsCamp.link.value?.campBusinessId ?? null
  await p.ndsCamp.pickCamp(c)
  if (hasData.value && p.ndsCamp.link.value?.campBusinessId !== before) await p.clear()
}

const ndsLinkText = computed(() =>
  p.ndsCamp.link.value ? ndsLinkLabel(p.ndsCamp.link.value, p.ndsCamp.record.value?.aggregate ?? null, t) : '',
)

const time = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '')
</script>

<template>
  <div data-testid="persons-view">
    <v-alert type="warning" variant="tonal" density="compact" icon="mdi-shield-lock-outline" class="mb-3" data-testid="persons-banner">
      {{ t('persons.banner') }}
    </v-alert>

    <QualificationMatrix v-if="p.qualMatrix.value" :matrix="p.qualMatrix.value" :title="t('persons.team.title')" compact />

    <v-card variant="outlined" class="mb-3" data-testid="persons-sources">
      <v-card-title class="text-subtitle-1">{{ t('persons.sources.title') }}</v-card-title>
      <v-card-text>
        <!-- One row per source: what is linked, and the one next step (pick, change, connect, switch on). -->
        <div class="source-row" data-testid="persons-source-midata">
          <span class="font-weight-medium source-name">{{ t('persons.sources.midata') }}</span>
          <span v-if="p.midataCamp.link.value" data-testid="persons-midata-link">
            {{ t(p.midataCamp.link.value.source === 'ecamp' ? 'persons.sources.midataLinkedEcamp' : 'persons.sources.midataLinked', { id: p.midataCamp.link.value.eventId }) }}
          </span>
          <span v-if="!p.midataConnected.value" class="text-medium-emphasis" data-testid="persons-midata-notconnected">
            <template v-if="p.midataCamp.link.value">· </template>{{ t('persons.sources.midataNotConnected') }}
          </span>
          <v-btn
            v-if="p.midataConnected.value && (!p.midataCamp.link.value || p.midataCamp.link.value.source === 'manual')"
            size="small"
            :variant="p.midataCamp.link.value ? 'text' : 'tonal'"
            data-testid="persons-midata-pick"
            @click="openMidataPicker"
          >
            {{ p.midataCamp.link.value ? t('persons.sources.changeEvent') : t('persons.sources.pickEvent') }}
          </v-btn>
          <v-btn v-else-if="!p.midataConnected.value" size="small" variant="tonal" to="/einstellungen" data-testid="persons-midata-to-settings">
            {{ t('persons.sources.toSettings') }}
          </v-btn>
        </div>
        <div class="source-row" data-testid="persons-source-nds">
          <span class="font-weight-medium source-name">{{ t('persons.sources.nds') }}</span>
          <template v-if="!p.ndsEnabled.value">
            <span class="text-medium-emphasis" data-testid="persons-nds-off">{{ t('persons.sources.ndsOff') }}</span>
            <v-btn size="small" variant="tonal" to="/einstellungen" data-testid="persons-nds-turn-on">{{ t('persons.sources.ndsTurnOn') }}</v-btn>
          </template>
          <template v-else>
            <span v-if="p.ndsCamp.link.value" data-testid="persons-nds-link">{{ t('persons.sources.ndsLinked', { label: ndsLinkText }) }}</span>
            <span v-if="!p.ndsConnected.value" class="text-medium-emphasis" data-testid="persons-nds-notconnected">
              <template v-if="p.ndsCamp.link.value">· </template>{{ t('persons.sources.ndsNotConnected') }}
            </span>
            <v-btn v-if="p.ndsConnected.value" size="small" :variant="p.ndsCamp.link.value ? 'text' : 'tonal'" data-testid="persons-nds-pick" @click="openNdsPicker">
              {{ p.ndsCamp.link.value ? t('persons.sources.changeCamp') : t('persons.sources.pickCamp') }}
            </v-btn>
            <v-btn v-else size="small" variant="tonal" to="/einstellungen" data-testid="persons-nds-to-settings">{{ t('persons.sources.toSettings') }}</v-btn>
          </template>
        </div>

        <div class="d-flex flex-wrap align-center ga-2 mt-3">
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-account-arrow-down-outline"
            :loading="p.loading.value"
            :disabled="!p.canLoad.value"
            data-testid="persons-load"
            @click="p.loadAll()"
          >
            {{ t('persons.actions.load') }}
          </v-btn>
          <v-btn variant="text" size="small" :disabled="!hasData" data-testid="persons-clear" @click="p.clear()">
            {{ t('persons.actions.clear') }}
          </v-btn>
          <span v-if="p.midata.value" class="text-caption text-medium-emphasis">
            {{ t('persons.loaded.midata', { time: time(p.midata.value.fetchedAt) }) }}
          </span>
          <span v-if="p.nds.value" class="text-caption text-medium-emphasis">
            {{ t('persons.loaded.nds', { time: time(p.nds.value.fetchedAt) }) }}
          </span>
        </div>
        <div class="text-caption text-medium-emphasis mt-1">{{ t('persons.sources.hint') }}</div>
      </v-card-text>
    </v-card>

    <v-alert v-if="p.midataError.value" type="error" variant="tonal" density="compact" class="mb-2">{{ p.midataError.value }}</v-alert>
    <v-alert v-if="p.ndsError.value" type="error" variant="tonal" density="compact" class="mb-2">{{ p.ndsError.value }}</v-alert>

    <template v-if="hasData">
      <div class="d-flex flex-wrap ga-1 mb-3" data-testid="persons-chips">
        <v-chip size="small" label data-testid="persons-chip-total">{{ t('persons.chips.total', { n: allRows.length }) }}</v-chip>
        <template v-for="k in KINDS" :key="k">
          <v-chip
            v-if="kindCounts[k]"
            size="small"
            label
            :variant="filters.kinds.includes(k) ? 'flat' : 'outlined'"
            :color="filters.kinds.includes(k) ? 'primary' : undefined"
            :aria-pressed="filters.kinds.includes(k)"
            :data-testid="`persons-chip-${k}`"
            @click="filters.kinds = toggleValue(filters.kinds, k)"
          >
            {{ t(`persons.chips.${k}`, { n: kindCounts[k] }) }}
          </v-chip>
        </template>
        <template v-if="p.compared.value">
          <template v-for="s in STATES" :key="s">
            <v-chip
              v-if="stateCounts[s]"
              size="small"
              label
              :variant="filters.states.includes(s) ? 'flat' : 'tonal'"
              :color="STATE_COLOR[s]"
              :aria-pressed="filters.states.includes(s)"
              :data-testid="`persons-chip-state-${s}`"
              @click="filters.states = toggleValue(filters.states, s)"
            >
              {{ stateCounts[s] ?? 0 }} {{ t(`persons.state.${s}`) }}
            </v-chip>
          </template>
        </template>
      </div>

      <div class="d-flex flex-wrap align-center ga-2 mb-2">
        <v-text-field
          v-model="filters.text"
          :label="t('persons.filter.search')"
          prepend-inner-icon="mdi-magnify"
          density="compact"
          hide-details
          clearable
          style="max-width: 240px"
          data-testid="persons-search"
        />
        <v-switch
          v-if="summary.regaKnown"
          v-model="regaMissingOnly"
          :label="t('persons.filter.regaMissing')"
          density="compact"
          hide-details
          color="warning"
          data-testid="persons-filter-rega"
        />
        <v-select
          v-model="filters.jsAge"
          :items="jsItems"
          density="compact"
          hide-details
          style="max-width: 200px"
          data-testid="persons-filter-jsage"
        />
      </div>

      <PersonsTable :rows="shown" :qualifications-readable="p.midata.value?.qualificationsReadable ?? true" :qual-columns="qualColumns" />
    </template>
    <div v-else class="text-medium-emphasis pa-4" data-testid="persons-empty">
      {{ p.canLoad.value ? t('persons.empty.noneLinked') : t('persons.empty.none') }}
    </div>

    <MidataEventPicker
      v-model="midataPickerOpen"
      :events="p.midataCamp.events.value ?? []"
      :loading="p.midataCamp.eventsLoading.value ?? false"
      :error="p.midataCamp.eventsError.value ?? null"
      @pick="pickMidata"
    />
    <NdsCampPicker
      v-model="ndsPickerOpen"
      :camps="p.ndsCamp.camps.value ?? []"
      :loading="p.ndsCamp.campsLoading.value ?? false"
      :error="p.ndsCamp.campsError.value ?? null"
      @pick="pickNds"
    />
  </div>
</template>

<style scoped>
.source-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding-block: 4px;
}
.source-name {
  min-width: 72px;
}
</style>
