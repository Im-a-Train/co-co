<script setup lang="ts">
/**
 * Übersicht: verdict sentence, ONE primary button to the next step, suggested rule modules and the
 * progress chips (each chip links to the tab where the step is done).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RouteLocationRaw } from 'vue-router'
import { REVIEW_STEP_ROUTES, type ReviewProgress, type ReviewStepKey, type ReviewVerdict } from '@/domain/cockpit/progress'
import { formatIsoDate } from '@/components/camps/campRows'

const props = defineProps<{
  progress: ReviewProgress
  params: Record<string, string>
  verdict?: ReviewVerdict | null
  mappingConfirmed: boolean
  missingInputs: number
  triageOpen: number
  /** Display names of the rule modules in state 'suggested'. */
  suggestedNames: string[]
  /** «Alle übernehmen» is writing. */
  accepting?: boolean
}>()
const emit = defineEmits<{ acceptModules: [] }>()
const { t } = useI18n()

const BINARY = new Set<ReviewStepKey>(['mapping', 'inputs', 'status'])

/** Angaben with the «Regelmodule» panel open. */
const modulesRoute = computed<RouteLocationRaw>(() => ({ name: 'camp-inputs', params: props.params, hash: '#regelmodule' }))

function routeOf(key: ReviewStepKey): RouteLocationRaw {
  const name = REVIEW_STEP_ROUTES[key]
  if (key === 'mapping') {
    // Mapping confirmed but modules still suggested: the modules are decided in Angaben.
    return props.mappingConfirmed ? modulesRoute.value : { name, params: props.params, query: { zuordnung: '1' } }
  }
  return { name, params: props.params }
}

const steps = computed(() =>
  props.progress.steps.map((s) => ({
    ...s,
    to: routeOf(s.key),
    // Binary steps (mapping, inputs, status) have no meaningful count; inputs show how many are open.
    partialText: !s.done && !BINARY.has(s.key) && s.total > 0 ? `${s.value}/${s.total}` : null,
    inputsText: s.key === 'inputs' && !s.done && props.missingInputs > 0 ? t('cockpit.overview.progress.inputsChip', { n: props.missingInputs }) : null,
  })),
)

const next = computed(() => props.progress.steps.find((s) => !s.done) ?? null)
const approved = computed(() => props.verdict?.kind === 'approved')
const ctaLabel = computed(() => {
  const s = next.value
  if (!s) return null
  if (s.key === 'mapping') return t(props.mappingConfirmed ? 'cockpit.overview.progress.cta.modules' : 'cockpit.overview.progress.cta.mapping')
  if (s.key === 'triage') {
    return props.triageOpen > 0
      ? t('cockpit.overview.progress.cta.triage', { n: props.triageOpen })
      : t('cockpit.overview.progress.cta.triageDone')
  }
  return t(`cockpit.overview.progress.cta.${s.key}`)
})
const ctaTo = computed(() => (next.value ? routeOf(next.value.key) : null))
const hint = computed(() => {
  const s = next.value
  if (!s) return null
  return s.key === 'mapping' && props.mappingConfirmed ? 'cockpit.overview.progress.hint.modules' : (s.hintKey ?? null)
})

/** History time stamps are UTC instants: show the coach's local calendar day. */
function localDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? formatIsoDate(iso) : d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const verdictText = computed(() => {
  const v = props.verdict
  if (!v) return null
  switch (v.kind) {
    case 'approved':
      return v.at
        ? t('cockpit.overview.verdict.approved', { date: localDate(v.at) })
        : t('cockpit.overview.verdict.approvedNoDate')
    case 'waiting':
      return t('cockpit.overview.verdict.waiting')
    case 'ready':
      return t('cockpit.overview.verdict.ready')
    case 'blocked': {
      const b = v.blockers
      const parts: string[] = []
      if (b.openMust > 0) parts.push(t('cockpit.overview.verdict.part.openMust', { n: b.openMust }, b.openMust))
      if (b.mappingUnconfirmed) parts.push(t('cockpit.overview.verdict.part.mapping'))
      else if (b.jsDays) parts.push(t('cockpit.overview.verdict.part.jsDays', { valid: b.jsDays.valid, required: b.jsDays.required }))
      if (b.untriaged > 0) parts.push(t('cockpit.overview.verdict.part.untriaged', { n: b.untriaged }, b.untriaged))
      const unsent = b.unsentMust + b.unsentDrafts
      if (unsent > 0) parts.push(t('cockpit.overview.verdict.part.unsent', { n: unsent }, unsent))
      return t('cockpit.overview.verdict.blocked', { parts: parts.join(' · ') })
    }
  }
})
const verdictIcon = computed(() =>
  props.verdict?.kind === 'approved' || props.verdict?.kind === 'ready' ? 'mdi-check-circle-outline' : 'mdi-flag-outline',
)
const verdictColor = computed(() => (props.verdict?.kind === 'approved' || props.verdict?.kind === 'ready' ? 'success' : undefined))
</script>

<template>
  <v-card variant="outlined" class="mb-4" data-testid="overview-progress">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      <span class="flex-grow-1">{{ t('cockpit.overview.progress.title') }}</span>
      <span class="text-h6" data-testid="overview-progress-percent">{{ progress.percent }} %</span>
    </v-card-title>
    <v-card-text>
      <div v-if="verdictText" class="d-flex align-start ga-2 text-body-1 font-weight-medium mb-3" data-testid="overview-verdict">
        <v-icon :icon="verdictIcon" :color="verdictColor" size="small" class="mt-1" />
        <span>{{ verdictText }}</span>
      </div>
      <v-progress-linear
        :model-value="progress.percent"
        :color="progress.percent >= 100 ? 'success' : 'primary'"
        :aria-label="t('cockpit.overview.progress.title')"
        height="10"
        rounded
        class="mb-3"
      />
      <div v-if="ctaTo && ctaLabel && !approved" class="d-flex flex-wrap align-center ga-3 mb-3">
        <v-btn color="primary" variant="flat" :to="ctaTo" append-icon="mdi-arrow-right" data-testid="overview-next-step">
          {{ ctaLabel }}
        </v-btn>
        <span v-if="hint" class="text-caption text-medium-emphasis">{{ t(hint) }}</span>
      </div>
      <div v-if="suggestedNames.length" class="d-flex flex-wrap align-center ga-2 mb-3" data-testid="overview-suggested-modules">
        <v-icon icon="mdi-puzzle-outline" size="small" />
        <span class="text-body-2">
          {{ t('cockpit.overview.progress.suggested.text', { n: suggestedNames.length, names: suggestedNames.join(', ') }, suggestedNames.length) }}
        </span>
        <v-btn size="small" variant="tonal" :loading="accepting" data-testid="overview-modules-accept" @click="emit('acceptModules')">
          {{ t('cockpit.overview.progress.suggested.acceptAll') }}
        </v-btn>
        <v-btn size="small" variant="text" :to="modulesRoute" data-testid="overview-modules-review">
          {{ t('cockpit.overview.progress.suggested.review') }}
        </v-btn>
      </div>
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
          {{ s.inputsText ?? t(s.labelKey) }}
          <span v-if="s.partialText" class="ml-1 text-medium-emphasis">{{ s.partialText }}</span>
        </v-chip>
      </div>
    </v-card-text>
  </v-card>
</template>
