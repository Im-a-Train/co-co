<script setup lang="ts">
/** Field-by-field difference between two versions of a rule (before / after). */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RuleMeta } from '@/domain/types'
import { fieldDiffs, type FieldDiff } from './ruleDiff'

const props = defineProps<{ before: RuleMeta; after: RuleMeta; beforeLabel?: string; afterLabel?: string }>()
const { t } = useI18n()

const diffs = computed(() => fieldDiffs(props.before, props.after))

function label(d: FieldDiff): string {
  return d.field === 'variant' ? t('rules.edit.diff.variant', { name: d.name ?? '' }) : t(`rules.edit.fields.${d.field}`)
}
function text(field: FieldDiff['field'], v: string): string {
  if (!v) return field === 'validFrom' || field === 'validTo' ? t('rules.edit.diff.removed') : t('rules.edit.diff.empty')
  if (field === 'severity') return t(`severity.${v}`)
  if (field === 'confidence') return t(`confidence.${v}`)
  if (field === 'status') return t(`rules.edit.status.${v}`)
  return v
}
</script>

<template>
  <div data-testid="rule-diff">
    <p v-if="!diffs.length" class="text-body-2 text-medium-emphasis">{{ t('rules.edit.diff.none') }}</p>
    <v-table v-else density="compact" class="diff-table">
      <thead>
        <tr>
          <th />
          <th>{{ beforeLabel ?? t('rules.edit.diff.before') }}</th>
          <th>{{ afterLabel ?? t('rules.edit.diff.after') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in diffs" :key="d.field + (d.name ?? '')">
          <th scope="row" class="text-no-wrap">{{ label(d) }}</th>
          <td class="before">{{ text(d.field, d.before) }}</td>
          <td class="after">{{ text(d.field, d.after) }}</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<style scoped>
.diff-table td,
.diff-table th {
  white-space: pre-wrap;
  vertical-align: top;
  padding-block: 6px;
}
.before {
  background: rgba(var(--v-theme-error), 0.08);
}
.after {
  background: rgba(var(--v-theme-success), 0.1);
}
</style>
