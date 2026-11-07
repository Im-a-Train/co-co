<script setup lang="ts">
/** Leaders × required qualifications + qualification kind mapping + safety activities with their responsibles. */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { effectiveKeys, isUnmappedKind, nextQualMapping, qualMappingChanged, type QualificationMatrix, type QualMapping, type SafetyArea } from '@/domain/midata'
import { MIDATA_QUAL_KEYS, type MidataQualKey, type MidataQualKind } from '@/domain/types'

const props = defineProps<{
  matrix: QualificationMatrix
  kinds: MidataQualKind[]
  mapping: QualMapping
  dismissed: { iri: string; title: string; area: SafetyArea }[]
  loading?: boolean
}>()
const emit = defineEmits<{
  saveMapping: [next: QualMapping]
  reload: []
  dismiss: [iri: string, area: SafetyArea]
  restore: [iri: string, area: SafetyArea]
}>()
const { t } = useI18n()

const edited = ref<QualMapping>({})
const justSaved = ref(false)
function resetEdited(): void {
  edited.value = Object.fromEntries(props.kinds.map((k) => [k.label, effectiveKeys(k, props.mapping)]))
}
watch(() => [props.kinds, props.mapping] as const, resetEdited, { immediate: true })

const changed = computed(() => qualMappingChanged(props.kinds, props.mapping, edited.value))
const unmappedCount = computed(() => props.kinds.filter((k) => isUnmappedKind(k, props.mapping)).length)
const keyItems = MIDATA_QUAL_KEYS.map((k) => ({ value: k, title: t(`midata.matrix.quals.${k}`) }))

function save(): void {
  emit('saveMapping', nextQualMapping(props.mapping, props.kinds, edited.value))
  justSaved.value = true
}
function setKeys(label: string, keys: MidataQualKey[]): void {
  edited.value = { ...edited.value, [label]: keys }
  justSaved.value = false
}
const areaName = (a: SafetyArea): string => t(`midata.matrix.activities.areaLower.${a}`)
</script>

<template>
  <v-card variant="outlined" class="mb-4" data-testid="qual-matrix">
    <v-card-title class="text-subtitle-1">{{ t('midata.matrix.title') }}</v-card-title>
    <v-card-text>
      <p class="text-medium-emphasis mb-3">{{ t('midata.matrix.intro') }}</p>
      <v-alert
        v-if="!matrix.qualificationsReadable"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
        data-testid="qual-unreadable"
      >
        {{ t('midata.matrix.notReadable') }}
      </v-alert>
      <div v-if="matrix.rows.length === 0" class="text-medium-emphasis">{{ t('midata.matrix.noLeaders') }}</div>
      <div v-else class="table-wrap">
        <v-table density="compact">
          <thead>
            <tr>
              <th>{{ t('midata.matrix.leader') }}</th>
              <th>{{ t('midata.matrix.role') }}</th>
              <th v-for="c in matrix.columns" :key="c" class="text-center">{{ t(`midata.matrix.quals.${c}`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in matrix.rows" :key="i">
              <td>{{ r.nickname }}</td>
              <td class="text-medium-emphasis">{{ r.roleLabel }}</td>
              <td v-for="c in matrix.columns" :key="c" class="text-center">
                <v-icon
                  v-if="r.cells[c]"
                  icon="mdi-check"
                  color="success"
                  size="small"
                  :aria-label="t('midata.matrix.has')"
                />
                <v-icon
                  v-else-if="!matrix.qualificationsReadable"
                  icon="mdi-help"
                  color="grey"
                  size="small"
                  :aria-label="t('midata.matrix.unknownCell')"
                  data-testid="qual-cell-unknown"
                />
                <v-icon v-else icon="mdi-close" color="error" size="small" :aria-label="t('midata.matrix.hasNot')" />
              </td>
            </tr>
            <tr class="font-weight-medium">
              <td colspan="2">{{ t('midata.matrix.coverage') }}</td>
              <td v-for="c in matrix.columns" :key="c" class="text-center">
                <span :class="matrix.covered[c] === 0 && matrix.qualificationsReadable ? 'text-error' : ''">{{ matrix.covered[c] }} / {{ matrix.rows.length }}</span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <v-expansion-panels v-if="kinds.length" variant="accordion" class="mt-4">
        <v-expansion-panel data-testid="qual-kinds">
          <v-expansion-panel-title>
            {{ t('midata.matrix.kinds.title', { n: kinds.length }) }}
            <v-chip v-if="unmappedCount" size="x-small" color="warning" variant="tonal" class="ml-2">
              {{ t('midata.matrix.kinds.unmapped') }}: {{ unmappedCount }}
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="text-medium-emphasis mb-3">{{ t('midata.matrix.kinds.intro') }}</p>
            <div class="table-wrap">
              <v-table density="compact">
                <thead>
                  <tr>
                    <th>{{ t('midata.matrix.kinds.label') }}</th>
                    <th>{{ t('midata.matrix.kinds.mappedTo') }}</th>
                    <th class="text-center">{{ t('midata.matrix.kinds.valid') }}</th>
                    <th class="text-center">{{ t('midata.matrix.kinds.expired') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(k, i) in kinds"
                    :key="k.label"
                    :class="{ unmapped: isUnmappedKind(k, mapping) }"
                    :data-testid="`qual-kind-${i}`"
                  >
                    <td>
                      {{ k.label }}
                      <v-chip v-if="isUnmappedKind(k, mapping)" size="x-small" color="warning" variant="tonal" class="ml-1" data-testid="qual-kind-unmapped">
                        {{ t('midata.matrix.kinds.unmapped') }}
                      </v-chip>
                    </td>
                    <td class="select-cell">
                      <v-select
                        :model-value="edited[k.label] ?? []"
                        :items="keyItems"
                        multiple
                        chips
                        closable-chips
                        density="compact"
                        variant="outlined"
                        hide-details
                        :data-testid="`qual-kind-select-${i}`"
                        @update:model-value="(v: MidataQualKey[]) => setKeys(k.label, v)"
                      />
                    </td>
                    <td class="text-center">{{ k.validLeaders }}</td>
                    <td class="text-center" :class="k.expiredLeaders ? 'text-warning' : ''">{{ k.expiredLeaders }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
            <div class="d-flex align-center flex-wrap ga-3 mt-3">
              <v-btn size="small" color="primary" :disabled="!changed" data-testid="qual-kinds-save" @click="save">{{ t('midata.matrix.kinds.save') }}</v-btn>
              <v-btn size="small" variant="text" :disabled="!changed" @click="resetEdited">{{ t('midata.matrix.kinds.reset') }}</v-btn>
              <template v-if="justSaved && !changed">
                <span class="text-caption text-success">{{ t('midata.matrix.kinds.saved') }}</span>
                <v-btn size="small" variant="tonal" :loading="loading" data-testid="qual-kinds-reload" @click="emit('reload')">
                  {{ t('midata.matrix.kinds.reload') }}
                </v-btn>
              </template>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <div class="text-subtitle-2 mt-4 mb-1">{{ t('midata.matrix.activities.title') }}</div>
      <p class="text-caption text-medium-emphasis mb-2" data-testid="qual-activities-source">{{ t('midata.matrix.activities.source') }}</p>
      <div v-if="matrix.activities.length === 0" class="text-medium-emphasis">{{ t('midata.matrix.activities.none') }}</div>
      <v-list v-else density="compact" lines="three" class="pa-0">
        <v-list-item v-for="a in matrix.activities" :key="`${a.activityIri}-${a.area}`" :data-testid="`qual-activity-${a.area}`">
          <template #prepend>
            <v-icon
              :icon="a.ok === true ? 'mdi-check-circle' : a.ok === false ? 'mdi-alert' : 'mdi-help-circle'"
              :color="a.ok === true ? 'success' : a.ok === false ? 'warning' : undefined"
            />
          </template>
          <template #append>
            <v-btn size="x-small" variant="text" :data-testid="`qual-dismiss-${a.area}`" @click="emit('dismiss', a.activityIri, a.area)">
              {{ t('midata.matrix.activities.dismiss', { area: areaName(a.area) }) }}
            </v-btn>
          </template>
          <v-list-item-title>
            {{ a.activityTitle }}
            <v-chip size="x-small" variant="tonal" class="ml-1">{{ t(`midata.matrix.activities.area.${a.area}`) }}</v-chip>
          </v-list-item-title>
          <v-list-item-subtitle class="text-wrap">
            {{ t('midata.matrix.activities.requires', { quals: a.required.map((q) => t(`midata.matrix.quals.${q}`)).join(' / ') }) }}
            ·
            {{ a.responsibles.length ? a.responsibles.join(', ') : t('midata.matrix.activities.noResponsible') }}
            ·
            {{ a.ok === true ? t('midata.matrix.activities.ok') : a.ok === false ? t('midata.matrix.activities.warn') : t('midata.matrix.activities.unknown') }}
          </v-list-item-subtitle>
          <v-list-item-subtitle v-if="a.keywords.length" class="text-wrap" data-testid="qual-activity-keywords">
            {{ t('midata.matrix.activities.detectedBy', { words: a.keywords.join(', ') }) }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <div v-if="dismissed.length" class="mt-2" data-testid="qual-dismissed">
        <div class="text-caption text-medium-emphasis">{{ t('midata.matrix.activities.dismissedTitle', { n: dismissed.length }) }}</div>
        <div class="d-flex flex-wrap ga-2 mt-1">
          <v-chip
            v-for="d in dismissed"
            :key="`${d.iri}-${d.area}`"
            size="small"
            variant="outlined"
            prepend-icon="mdi-undo"
            :title="t('midata.matrix.activities.restore')"
            @click="emit('restore', d.iri, d.area)"
          >
            {{ d.title }} · {{ t(`midata.matrix.activities.area.${d.area}`) }}
          </v-chip>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}
.select-cell {
  min-width: 260px;
  padding-block: 4px;
}
.unmapped {
  background: rgba(var(--v-theme-warning), 0.08);
}
</style>
