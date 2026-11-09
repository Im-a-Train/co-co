<script setup lang="ts">
/** People table (RED ZONE). Birth dates are masked unless the eye toggle is on; the toggle is not stored. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBirthDate, maskBirthDate } from '@/domain/persons/age'
import { germanRoleLabel } from '@/domain/persons/roleLabels'
import type { PersonViewRow } from '@/domain/persons/view'
import NdsStateChip from './NdsStateChip.vue'
import QualDots from './QualDots.vue'

defineProps<{ rows: PersonViewRow[]; qualificationsReadable: boolean }>()
const { t } = useI18n()
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
  { title: t('persons.table.jsAge'), key: 'jsAge' },
  { title: t('persons.table.quals'), key: 'quals', sortable: false },
  { title: t('persons.table.state'), key: 'state' },
  { title: t('persons.table.ndsNumber'), key: 'ndsNumber' },
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
        <td>{{ item.age ?? '–' }}</td>
        <td>
          <v-chip
            v-if="item.age !== null"
            size="x-small"
            label
            :color="item.jsAge ? 'success' : 'grey'"
            variant="tonal"
            data-testid="persons-jsage"
          >
            {{ item.jsAge ? t('persons.jsAge.yes') : t('persons.jsAge.no') }}
          </v-chip>
          <span v-else>–</span>
        </td>
        <td>
          <QualDots v-if="item.kind === 'leader' && qualificationsReadable" :quals="item.qualifications" />
          <v-tooltip v-else-if="item.kind === 'leader'" location="top" :text="t('persons.qual.unreadable')">
            <template #activator="{ props: tip }"><span v-bind="tip">–</span></template>
          </v-tooltip>
        </td>
        <td><NdsStateChip :row="item" :reveal="reveal" /></td>
        <td>{{ item.ndsNumber ?? '–' }}</td>
      </tr>
    </template>
  </v-data-table>
</template>
