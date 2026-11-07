<script setup lang="ts">
/** History of draft rounds (newest first) with delete. */
import { useI18n } from 'vue-i18n'
import type { SelfCheckRun } from '@/domain/types'

defineProps<{ runs: SelfCheckRun[] }>()
const emit = defineEmits<{ delete: [id: string] }>()
const { t } = useI18n()

function when(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <v-list v-if="runs.length > 0" lines="two" data-testid="selfcheck-history">
    <v-list-item v-for="r in runs" :key="r.id" data-testid="selfcheck-run">
      <v-list-item-title>
        {{ when(r.createdAt) }}
        <v-chip size="x-small" class="ml-2" variant="tonal">{{ t(`selfCheck.history.by.${r.by}`) }}</v-chip>
      </v-list-item-title>
      <v-list-item-subtitle>
        {{ t('selfCheck.history.counts', { must: r.counts.must, should: r.counts.should, hint: r.counts.hint }) }}
        <template v-if="r.note"> · {{ r.note }}</template>
      </v-list-item-subtitle>
      <template #append>
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          size="small"
          :title="t('selfCheck.history.delete')"
          :aria-label="t('selfCheck.history.delete')"
          data-testid="selfcheck-delete"
          @click="emit('delete', r.id)"
        />
      </template>
    </v-list-item>
  </v-list>
  <div v-else class="text-medium-emphasis" data-testid="selfcheck-history-empty">{{ t('selfCheck.history.empty') }}</div>
</template>
