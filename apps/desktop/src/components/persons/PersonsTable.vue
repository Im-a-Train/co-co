<script setup lang="ts">
/** People table (RED ZONE). Birth dates are masked unless the eye toggle is on; the toggle is not stored. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBirthDate, maskBirthDate } from '@/domain/persons/age'
import { germanRoleLabel } from '@/domain/persons/roleLabels'
import { stateRank, type PersonViewRow } from '@/domain/persons/view'
import type { MidataQualKey } from '@/domain/types'
import NdsStateChip from './NdsStateChip.vue'

defineProps<{ rows: PersonViewRow[]; qualificationsReadable: boolean; qualColumns: MidataQualKey[] }>()
// Colour = state: a missing qualification of one leader is information, not a blocker (team coverage is in
// the «Leitungsteam» card), so it stays neutral; expired is orange, valid green.
const QUAL_COLOR = { valid: 'success', invalid: 'warning', none: undefined } as const
const QUAL_MARK = { valid: '✓', invalid: '!', none: '✗' } as const
const { t } = useI18n()
/** MiData fills every key for its leaders (when readable); an empty record means the row has no MiData side. */
function hasQualData(item: PersonViewRow): boolean {
  return Object.keys(item.qualifications).length > 0
}
function roleText(_item: PersonViewRow, r: string): string {
  return germanRoleLabel(r, t)
}
const reveal = ref(false)

const headers = [
  { title: t('persons.table.name'), key: 'lastName' },
  { title: t('persons.table.kind'), key: 'kind' },
  { title: t('persons.table.roles'), key: 'roles', sortable: false },
  { title: t('persons.table.birthDate'), key: 'birthDate' },
  { title: t('persons.table.age'), key: 'age' },
  { title: t('persons.table.quals'), key: 'quals', sortable: false },
  { title: t('persons.table.state'), key: 'state', sort: (a: string, b: string) => stateRank(a as never) - stateRank(b as never) },
  { title: t('persons.table.rega'), key: 'rega' },
]
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="rows"
    item-value="key"
    density="compact"
    :items-per-page="-1"
    hide-default-footer
    hover
    :no-data-text="t('persons.empty.filtered')"
    data-testid="persons-table"
  >
    <template #[`header.birthDate`]="{ column }">
      <span>{{ column.title }}</span>
      <v-btn
        :icon="reveal ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
        size="x-small"
        variant="text"
        :title="reveal ? t('persons.birth.hide') : t('persons.birth.reveal')"
        :aria-label="reveal ? t('persons.birth.hide') : t('persons.birth.reveal')"
        data-testid="persons-birth-toggle"
        @click.stop="reveal = !reveal"
      />
    </template>
    <template #item="{ item }">
      <tr data-testid="persons-row">
        <td>
          <span v-if="item.nickname" class="font-weight-bold">{{ item.nickname }}</span>
          <span :class="item.nickname ? 'text-medium-emphasis ms-1' : 'font-weight-medium'">
            {{ item.firstName }} {{ item.lastName }}
          </span>
        </td>
        <td>{{ t(`persons.kind.${item.kind}`) }}</td>
        <td>
          <v-chip v-for="r in item.roles" :key="r" size="x-small" label class="me-1">{{ roleText(item, r) }}</v-chip>
        </td>
        <td class="text-no-wrap" data-testid="persons-birth">
          {{ reveal ? formatBirthDate(item.birthDate) : maskBirthDate(item.birthDate) }}
        </td>
        <!-- J+S age only matters for TN: flag the ones outside 5–20 right next to the age (no own column). -->
        <td>
          {{ item.age ?? '–' }}
          <v-chip
            v-if="item.kind === 'participant' && item.age !== null && !item.jsAge"
            size="x-small"
            label
            color="warning"
            variant="tonal"
            class="ms-1"
            data-testid="persons-jsage"
          >
            {{ t('persons.jsAge.outside') }}
          </v-chip>
        </td>
        <td>
          <div v-if="item.kind === 'leader' && qualificationsReadable && hasQualData(item)" class="d-flex flex-wrap ga-1" data-testid="qual-chips">
            <v-chip
              v-for="k in qualColumns"
              :key="k"
              size="x-small"
              label
              variant="tonal"
              :color="QUAL_COLOR[item.qualifications[k] ?? 'none']"
              :title="`${t(`persons.qualKey.${k}`)}: ${t(`persons.qual.${item.qualifications[k] ?? 'none'}`)}`"
              data-testid="qual-chip"
            >
              {{ t(`persons.qualShort.${k}`) }} {{ QUAL_MARK[item.qualifications[k] ?? 'none'] }}
            </v-chip>
          </div>
          <v-tooltip v-else-if="item.kind === 'leader' && !qualificationsReadable" location="top" :text="t('persons.qual.unreadable')">
            <template #activator="{ props: tip }"><span v-bind="tip">–</span></template>
          </v-tooltip>
          <!-- Leader without a MiData side (NDS-only row): qualifications are unknown, not missing. -->
          <span v-else-if="item.kind === 'leader'">–</span>
        </td>
        <td><NdsStateChip :row="item" :reveal="reveal" /></td>
        <td>
          <v-chip
            v-if="item.rega !== null || (item.kind === 'participant' && item.ndsNumber !== null)"
            size="x-small"
            label
            variant="tonal"
            :color="item.rega === null ? 'grey' : item.rega ? 'success' : 'warning'"
            data-testid="persons-rega"
          >
            {{ item.rega === null ? t('persons.rega.unknown') : item.rega ? t('persons.rega.transmitted') : t('persons.rega.missing') }}
          </v-chip>
          <span v-else>–</span>
        </td>
      </tr>
    </template>
  </v-data-table>
</template>
