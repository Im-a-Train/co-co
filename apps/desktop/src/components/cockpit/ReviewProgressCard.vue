<script setup lang="ts">
/** Übersicht: review progress bar plus one chip per step; each chip links to the tab where the step is done. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RouteLocationRaw } from 'vue-router'
import type { ReviewProgress, ReviewStepKey } from '@/domain/cockpit/progress'

const props = defineProps<{ progress: ReviewProgress; params: Record<string, string> }>()
const { t } = useI18n()

const ROUTES: Record<ReviewStepKey, (p: Record<string, string>) => RouteLocationRaw> = {
  mapping: (params) => ({ name: 'camp-grid', params, query: { zuordnung: '1' } }),
  inputs: (params) => ({ name: 'camp-inputs', params }),
  triage: (params) => ({ name: 'camp-findings', params }),
  documents: (params) => ({ name: 'camp-documents', params }),
  checklist: (params) => ({ name: 'camp-checklist', params }),
  feedback: (params) => ({ name: 'camp-feedback', params }),
  status: (params) => ({ name: 'camp-rounds', params }),
}

const BINARY = new Set<ReviewStepKey>(['mapping', 'inputs', 'status'])

const steps = computed(() =>
  props.progress.steps.map((s) => ({
    ...s,
    to: ROUTES[s.key](props.params),
    // Binary steps (mapping, inputs, status) have no meaningful count.
    partialText: !s.done && !BINARY.has(s.key) && s.total > 0 ? `${s.value}/${s.total}` : null,
  })),
)
const hint = computed(() => props.progress.steps.find((s) => s.hintKey)?.hintKey ?? null)
</script>

<template>
  <v-card variant="outlined" class="mb-4" data-testid="overview-progress">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      <span class="flex-grow-1">{{ t('cockpit.overview.progress.title') }}</span>
      <span class="text-h6" data-testid="overview-progress-percent">{{ progress.percent }} %</span>
    </v-card-title>
    <v-card-text>
      <v-progress-linear
        :model-value="progress.percent"
        :color="progress.percent >= 100 ? 'success' : 'primary'"
        :aria-label="t('cockpit.overview.progress.title')"
        height="10"
        rounded
        class="mb-3"
      />
      <div class="d-flex flex-wrap ga-2">
        <v-chip
          v-for="s in steps"
          :key="s.key"
          :to="s.to"
          :color="s.done ? 'success' : undefined"
          :variant="s.done ? 'tonal' : 'outlined'"
          size="small"
          :prepend-icon="s.done ? 'mdi-check-circle' : 'mdi-circle-outline'"
          :data-testid="`overview-progress-${s.key}`"
          :data-done="s.done"
        >
          {{ t(s.labelKey) }}
          <span v-if="s.partialText" class="ml-1 text-medium-emphasis">{{ s.partialText }}</span>
        </v-chip>
      </div>
      <div v-if="hint" class="text-body-2 text-medium-emphasis mt-3">{{ t(hint) }}</div>
    </v-card-text>
  </v-card>
</template>
