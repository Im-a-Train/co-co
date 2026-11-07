<script setup lang="ts">
/** Leaders × required qualifications + safety activities with their responsibles. */
import { useI18n } from 'vue-i18n'
import type { QualificationMatrix } from '@/domain/midata'

defineProps<{ matrix: QualificationMatrix }>()
const { t } = useI18n()
</script>

<template>
  <v-card variant="outlined" class="mb-4" data-testid="qual-matrix">
    <v-card-title class="text-subtitle-1">{{ t('midata.matrix.title') }}</v-card-title>
    <v-card-text>
      <p class="text-medium-emphasis mb-3">{{ t('midata.matrix.intro') }}</p>
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
                <v-icon v-else icon="mdi-close" color="error" size="small" :aria-label="t('midata.matrix.hasNot')" />
              </td>
            </tr>
            <tr class="font-weight-medium">
              <td colspan="2">{{ t('midata.matrix.coverage') }}</td>
              <td v-for="c in matrix.columns" :key="c" class="text-center">
                <span :class="matrix.covered[c] === 0 ? 'text-error' : ''">{{ matrix.covered[c] }} / {{ matrix.rows.length }}</span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <div class="text-subtitle-2 mt-4 mb-1">{{ t('midata.matrix.activities.title') }}</div>
      <div v-if="matrix.activities.length === 0" class="text-medium-emphasis">{{ t('midata.matrix.activities.none') }}</div>
      <v-list v-else density="compact" lines="two" class="pa-0">
        <v-list-item v-for="a in matrix.activities" :key="`${a.activityIri}-${a.area}`" :data-testid="`qual-activity-${a.area}`">
          <template #prepend>
            <v-icon
              :icon="a.ok === true ? 'mdi-check-circle' : a.ok === false ? 'mdi-alert' : 'mdi-help-circle'"
              :color="a.ok === true ? 'success' : a.ok === false ? 'warning' : undefined"
            />
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
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}
</style>
