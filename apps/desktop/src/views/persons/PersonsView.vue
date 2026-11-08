<script setup lang="ts">
/** /lager/:campId/personen: people of the camp from MiData and NDS, reconciled (P1: read only, memory only). */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PersonsTable from '@/components/persons/PersonsTable.vue'
import { STATE_COLOR } from '@/components/persons/stateColor'
import { useCampRoute } from '@/composables/useCampRoute'
import { usePersons } from '@/composables/usePersons'
import type { PersonKind } from '@/domain/persons/types'
import { countBy, filterRows, NO_FILTERS, toViewRows, type PersonFilters, type ViewState } from '@/domain/persons/view'

const { t } = useI18n()
const { campId, campIri } = useCampRoute()
const p = usePersons(campIri)

const filters = ref<PersonFilters>({ ...NO_FILTERS })
const KINDS: PersonKind[] = ['participant', 'leader', 'kitchen', 'coach', 'guest', 'other']
const STATES: ViewState[] = ['match', 'field_diff', 'missing_in_nds', 'only_in_nds', 'ambiguous']

const allRows = computed(() => toViewRows(p.rows.value, p.campStart.value, p.compared.value))
const shown = computed(() => filterRows(allRows.value, filters.value))
const kindCounts = computed(() => countBy(allRows.value.map((r) => r.kind)))
const stateCounts = computed(() => countBy(allRows.value.map((r) => r.state)))
const hasData = computed(() => p.midata.value !== null || p.nds.value !== null)

const kindItems = computed(() => KINDS.map((k) => ({ value: k, title: t(`persons.kind.${k}`) })))
const stateItems = computed(() => STATES.map((s) => ({ value: s, title: t(`persons.state.${s}`) })))
const jsItems = computed(() => [
  { value: 'all', title: t('persons.filter.jsAge') },
  { value: 'yes', title: t('persons.filter.jsAgeYes') },
  { value: 'no', title: t('persons.filter.jsAgeNo') },
])

const time = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '')
</script>

<template>
  <div data-testid="persons-view">
    <v-alert type="warning" variant="tonal" density="compact" icon="mdi-shield-lock-outline" class="mb-3" data-testid="persons-banner">
      {{ t('persons.banner') }}
    </v-alert>

    <div class="d-flex flex-wrap align-center ga-2 mb-3">
      <v-btn
        color="primary"
        prepend-icon="mdi-account-arrow-down-outline"
        :loading="p.loadingMidata.value"
        :disabled="!p.midataLinked.value"
        data-testid="persons-load-midata"
        @click="p.loadMidata()"
      >
        {{ t('persons.actions.loadMidata') }}
      </v-btn>
      <v-btn
        color="primary"
        prepend-icon="mdi-cloud-download-outline"
        :loading="p.loadingNds.value"
        :disabled="!p.ndsLinked.value"
        data-testid="persons-load-nds"
        @click="p.loadNds()"
      >
        {{ t('persons.actions.loadNds') }}
      </v-btn>
      <v-btn variant="text" prepend-icon="mdi-delete-outline" :disabled="!hasData" data-testid="persons-clear" @click="p.clear()">
        {{ t('persons.actions.clear') }}
      </v-btn>
      <span v-if="p.midata.value" class="text-caption text-medium-emphasis">
        {{ t('persons.loaded.midata', { time: time(p.midata.value.fetchedAt) }) }}
      </span>
      <span v-if="p.nds.value" class="text-caption text-medium-emphasis">
        {{ t('persons.loaded.nds', { time: time(p.nds.value.fetchedAt) }) }}
      </span>
    </div>

    <v-alert v-if="!p.midataLinked.value" type="info" variant="tonal" density="compact" class="mb-2" data-testid="persons-midata-unlinked">
      {{ t('persons.empty.midataNotLinked') }}
      <v-btn size="small" variant="text" :to="{ name: 'camp-inputs', params: { campId } }">{{ t('persons.empty.toInputs') }}</v-btn>
    </v-alert>
    <v-alert v-if="!p.ndsLinked.value" type="info" variant="tonal" density="compact" class="mb-2" data-testid="persons-nds-unlinked">
      {{ t('persons.empty.ndsNotLinked') }}
      <v-btn size="small" variant="text" :to="{ name: 'camp-inputs', params: { campId } }">{{ t('persons.empty.toInputs') }}</v-btn>
    </v-alert>
    <v-alert v-if="p.midataError.value" type="error" variant="tonal" density="compact" class="mb-2">{{ p.midataError.value }}</v-alert>
    <v-alert v-if="p.ndsError.value" type="error" variant="tonal" density="compact" class="mb-2">{{ p.ndsError.value }}</v-alert>

    <template v-if="hasData">
      <div class="d-flex flex-wrap ga-1 mb-3" data-testid="persons-chips">
        <v-chip size="small" label data-testid="persons-chip-total">{{ t('persons.chips.total', { n: allRows.length }) }}</v-chip>
        <template v-for="k in KINDS" :key="k">
          <v-chip v-if="kindCounts[k]" size="small" label variant="outlined" :data-testid="`persons-chip-${k}`">
            {{ t(`persons.chips.${k}`, { n: kindCounts[k] }) }}
          </v-chip>
        </template>
        <template v-if="p.compared.value">
          <v-chip
            v-for="s in STATES"
            :key="s"
            v-show="stateCounts[s]"
            size="small"
            label
            variant="tonal"
            :color="STATE_COLOR[s]"
            :data-testid="`persons-chip-state-${s}`"
          >
            {{ stateCounts[s] ?? 0 }} {{ t(`persons.state.${s}`) }}
          </v-chip>
        </template>
      </div>

      <div class="d-flex flex-wrap ga-2 mb-2">
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
        <v-select
          v-model="filters.kinds"
          :items="kindItems"
          :label="t('persons.filter.kind')"
          multiple
          chips
          density="compact"
          hide-details
          clearable
          style="max-width: 260px"
          data-testid="persons-filter-kind"
        />
        <v-select
          v-model="filters.states"
          :items="stateItems"
          :label="t('persons.filter.state')"
          multiple
          chips
          density="compact"
          hide-details
          clearable
          :disabled="!p.compared.value"
          style="max-width: 300px"
          data-testid="persons-filter-state"
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

      <PersonsTable :rows="shown" :qualifications-readable="p.midata.value?.qualificationsReadable ?? true" />
    </template>
    <div v-else class="text-medium-emphasis pa-4" data-testid="persons-empty">{{ t('persons.empty.none') }}</div>
  </div>
</template>
