<script setup lang="ts">
/** Human-readable diff grouped by general entries and by activity. OWNER: rounds builder. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { groupDiff } from '@/domain/rounds'
import type { Diff, DiffChange, DiffEntry, Iri } from '@/domain/types'

const props = defineProps<{ diff: Diff; titleOf?: (iri: Iri) => string | undefined }>()
const { t, te } = useI18n()

const groups = computed(() => groupDiff(props.diff, props.titleOf))

const COLORS: Record<DiffChange, string> = { added: 'success', changed: 'warning', removed: 'error' }
const ICONS: Record<DiffChange, string> = { added: 'mdi-plus', changed: 'mdi-pencil-outline', removed: 'mdi-minus' }

function fieldsText(e: DiffEntry): string {
  if (!e.fields?.length) return ''
  const names = e.fields.map((f) => (te(`rounds.fields.${f}`) ? t(`rounds.fields.${f}`) : f))
  return t('rounds.diff.changedFields', { fields: names.join(', ') })
}
</script>

<template>
  <div>
    <div class="text-body-2 text-medium-emphasis mb-2">
      {{ t('rounds.diff.counts', diff.counts) }}
    </div>
    <v-alert v-if="!diff.entries.length" type="success" variant="tonal" density="compact" :text="t('rounds.diff.empty')" />

    <v-card v-if="groups.general.length" variant="outlined" class="mb-3">
      <v-card-title class="text-subtitle-2">{{ t('rounds.diff.general') }}</v-card-title>
      <v-list density="compact">
        <v-list-item v-for="e in groups.general" :key="e.key" :prepend-icon="ICONS[e.change]">
          <v-list-item-title>
            <v-chip size="x-small" :color="COLORS[e.change]" label class="mr-2">{{ t(`rounds.diff.change.${e.change}`) }}</v-chip>
            {{ t(`rounds.diff.type.${e.type}`) }}: {{ e.label }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="fieldsText(e)">{{ fieldsText(e) }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-card>

    <v-card v-for="g in groups.activities" :key="g.activityIri" variant="outlined" class="mb-3">
      <v-card-title class="text-subtitle-2">{{ g.title || t('rounds.diff.unnamed') }}</v-card-title>
      <v-list density="compact">
        <v-list-item v-for="e in g.entries" :key="e.key" :prepend-icon="ICONS[e.change]">
          <v-list-item-title>
            <v-chip size="x-small" :color="COLORS[e.change]" label class="mr-2">{{ t(`rounds.diff.change.${e.change}`) }}</v-chip>
            {{ t(`rounds.diff.type.${e.type}`) }}<span v-if="e.type === 'scheduleEntry'">: {{ e.label }}</span>
          </v-list-item-title>
          <v-list-item-subtitle v-if="fieldsText(e)">{{ fieldsText(e) }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>
