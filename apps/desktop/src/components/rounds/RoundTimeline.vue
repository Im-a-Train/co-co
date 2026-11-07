<script setup lang="ts">
/** Timeline of rounds (newest first) with per-round change toggle. */
import { useI18n } from 'vue-i18n'
import type { Round } from '@/domain/types'

defineProps<{ rounds: Round[]; selectedId: string | null }>()
const emit = defineEmits<{ (e: 'select', id: string | null): void; (e: 'close', id: string): void }>()
const { t, d } = useI18n()
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">{{ t('rounds.timeline.title') }}</v-card-title>
    <v-card-text>
      <div v-if="!rounds.length" class="text-body-2">{{ t('rounds.timeline.empty') }}</div>
      <v-timeline v-else side="end" density="compact" align="start" truncate-line="both">
        <v-timeline-item
          v-for="r in [...rounds].reverse()"
          :key="r.id"
          :dot-color="r.closedAt ? 'grey' : 'primary'"
          size="x-small"
        >
          <div class="d-flex flex-wrap align-center ga-2">
            <span class="text-subtitle-2">{{ t('rounds.timeline.round', { n: r.number }) }}</span>
            <v-chip size="x-small" label :color="r.closedAt ? undefined : 'primary'">
              {{ r.closedAt ? t('rounds.timeline.closed', { date: d(new Date(r.closedAt), 'date') }) : t('rounds.timeline.open') }}
            </v-chip>
            <v-chip size="x-small" label :color="r.exportedAt ? 'success' : 'warning'" variant="tonal">
              {{ r.exportedAt ? t('rounds.timeline.exported') : t('rounds.timeline.notExported') }}
            </v-chip>
          </div>
          <div class="text-caption text-medium-emphasis">
            {{ t('rounds.timeline.started', { date: d(new Date(r.startedAt), 'dateTime') }) }}
          </div>
          <div v-if="r.note" class="text-body-2 mt-1">{{ r.note }}</div>
          <div class="mt-1 d-flex ga-2">
            <v-btn size="x-small" variant="text" @click="emit('select', selectedId === r.id ? null : r.id)">
              {{ selectedId === r.id ? t('rounds.timeline.hideChanges') : t('rounds.timeline.showChanges') }}
            </v-btn>
            <v-btn v-if="!r.closedAt" size="x-small" variant="text" @click="emit('close', r.id)">
              {{ t('rounds.close.button') }}
            </v-btn>
          </div>
        </v-timeline-item>
      </v-timeline>
    </v-card-text>
  </v-card>
</template>
