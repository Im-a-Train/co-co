<script setup lang="ts">
/** NDS reconciliation chip with a tooltip that lists differences / name-only suggestions. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatBirthDate } from '@/domain/persons/age'
import type { PersonViewRow } from '@/domain/persons/view'
import { STATE_COLOR } from './stateColor'

const props = defineProps<{ row: PersonViewRow; reveal: boolean }>()
const { t } = useI18n()

const lines = computed<string[]>(() => {
  const r = props.row
  const out: string[] = []
  if (r.differences.length)
    out.push(t('persons.tooltip.differences', { list: r.differences.map((d) => t(`persons.diff.${d}`)).join(', ') }))
  if (r.state === 'only_in_nds') out.push(t('persons.tooltip.ndsOnly'))
  if (r.suggestions.length) {
    out.push(t('persons.tooltip.suggestions'))
    for (const s of r.suggestions)
      out.push(
        t('persons.tooltip.suggestion', {
          name: `${s.firstName} ${s.lastName}`,
          birth: props.reveal ? formatBirthDate(s.birthDate) : (s.birthDate ?? '–').slice(0, 4),
        }),
      )
  }
  return out
})
</script>

<template>
  <v-tooltip location="top" :disabled="lines.length === 0">
    <template #activator="{ props: tip }">
      <v-chip v-bind="tip" size="small" label :color="STATE_COLOR[row.state]" variant="tonal" data-testid="nds-state">
        {{ t(`persons.state.${row.state}`) }}
      </v-chip>
    </template>
    <div v-for="(l, i) in lines" :key="i">{{ l }}</div>
  </v-tooltip>
</template>
