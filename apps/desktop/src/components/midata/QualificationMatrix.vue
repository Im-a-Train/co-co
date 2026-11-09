<script setup lang="ts">
/** Leaders: roles in the camp × qualifications at camp time + qualification kind mapping. */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { germanRoleLabel } from '@/domain/persons/roleLabels'
import { effectiveKeys, isUnmappedKind, nextQualMapping, qualMappingChanged, type QualificationMatrix, type QualMapping, type QualMatrixRow } from '@/domain/midata'
import { MIDATA_QUAL_KEYS, MIDATA_QUAL_KEYS_V2, type MidataQualKey, type MidataQualKind } from '@/domain/types'

const props = defineProps<{
  matrix: QualificationMatrix
  kinds: MidataQualKind[]
  mapping: QualMapping
  loading?: boolean
}>()
const emit = defineEmits<{
  saveMapping: [next: QualMapping]
  reload: []
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
const keyItems = [...MIDATA_QUAL_KEYS, ...MIDATA_QUAL_KEYS_V2].map((k) => ({ value: k, title: t(`midata.matrix.quals.${k}`) }))

function save(): void {
  emit('saveMapping', nextQualMapping(props.mapping, props.kinds, edited.value))
  justSaved.value = true
}
function setKeys(label: string, keys: MidataQualKey[]): void {
  edited.value = { ...edited.value, [label]: keys }
  justSaved.value = false
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
/** Tooltip of a cell: the qualifications behind it, with validity. */
function cellTip(r: QualMatrixRow, c: MidataQualKey): string {
  return r.details
    .filter((d) => d.keys.includes(c))
    .map((d) => {
      const state = d.validAtCamp
        ? d.finishAt ? t('midata.matrix.validUntil', { date: fmtDate(d.finishAt) }) : t('midata.matrix.has')
        : d.finishAt ? t('midata.matrix.validUntil', { date: fmtDate(d.finishAt) }) + ' (' + t('midata.matrix.notValidAtCamp') + ')' : t('midata.matrix.notValidAtCamp')
      return t('midata.matrix.invalidTitle', { labels: d.label, state })
    })
    .join('\n') ||t('midata.matrix.invalid')
}
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
      <p v-if="matrix.rows.length > 0" class="text-caption text-medium-emphasis mb-2" data-testid="qual-legend">{{ t('midata.matrix.legend') }}</p>
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
              <td>
                <v-chip v-for="l in r.roleLabels" :key="l" size="x-small" variant="tonal" class="mr-1" data-testid="qual-role-chip">{{ germanRoleLabel(l, t) }}</v-chip>
              </td>
              <td v-for="c in matrix.columns" :key="c" class="text-center">
                <v-icon
                  v-if="r.cells[c] === 'valid'"
                  icon="mdi-check"
                  color="success"
                  size="small"
                  :title="cellTip(r, c)"
                  :aria-label="t('midata.matrix.has')"
                  data-testid="qual-cell-valid"
                />
                <v-icon
                  v-else-if="r.cells[c] === 'invalid'"
                  icon="mdi-alert-circle-outline"
                  color="warning"
                  size="small"
                  :title="cellTip(r, c)"
                  :aria-label="t('midata.matrix.invalid')"
                  data-testid="qual-cell-invalid"
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
