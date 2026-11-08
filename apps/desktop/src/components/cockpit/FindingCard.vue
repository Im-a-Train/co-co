<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { safeExternalUrl, severityColor } from '@/domain/cockpit'
import { paramValueText, reasonText } from '@/components/camps/ruleConfigUi'
import type { Finding } from '@/domain/types'
import FindingExplainPanel from './FindingExplainPanel.vue'

const props = defineProps<{ finding: Finding; compact?: boolean; hideActions?: boolean }>()
const emit = defineEmits<{
  feedback: [finding: Finding]
  override: [finding: Finding]
  removeOverride: [finding: Finding]
  openActivity: [iri: string]
}>()
const { t, te } = useI18n()
const moduleNote = computed(() => {
  const n = props.finding.moduleNote
  if (!n || !props.finding.module) return null
  return t('rules.module.suggestedNote', { module: t(`rules.catalog.module.${props.finding.module}`), reason: reasonText(t, te, n) })
})
const url = computed(() => safeExternalUrl(props.finding.source?.url))
const activityEvidence = computed(() =>
  props.finding.evidence.filter((e) => e.kind === 'activity' || e.kind === 'scheduleEntry'),
)
const otherEvidence = computed(() => props.finding.evidence.filter((e) => !activityEvidence.value.includes(e)))
</script>

<template>
  <v-card
    variant="outlined"
    density="compact"
    :class="{ 'opacity-60': finding.override }"
    :style="{ borderLeft: `4px solid rgb(var(--v-theme-${severityColor(finding.severity)}))` }"
  >
    <v-card-text class="py-3">
      <div class="d-flex align-center flex-wrap ga-2 mb-1">
        <v-chip size="x-small" label variant="outlined">{{ finding.ruleId }}</v-chip>
        <v-chip size="x-small" label variant="text">{{ t(`confidence.${finding.confidence}`) }}</v-chip>
        <v-chip v-if="finding.origin === 'ai'" size="x-small" color="secondary" label>
          {{ t('findings.aiTag') }}
        </v-chip>
        <v-chip v-if="finding.override" size="x-small" color="grey" label>{{ t('findings.overridden') }}</v-chip>
      </div>
      <div class="text-subtitle-1">{{ finding.title }}</div>
      <div class="text-body-2">{{ finding.message }}</div>

      <div v-if="moduleNote" class="text-caption text-warning mt-1" data-testid="finding-module-note">
        <v-icon icon="mdi-lightbulb-on-outline" size="x-small" /> {{ moduleNote }}
      </div>
      <div v-for="n in finding.paramNotes ?? []" :key="n.key" class="text-caption text-medium-emphasis mt-1" data-testid="finding-param-note">
        <v-icon icon="mdi-tune-variant" size="x-small" />
        {{ t('rules.paramNote', { label: n.label, value: paramValueText(n.value), default: paramValueText(n.default) }) }}
      </div>

      <div v-if="finding.override" class="text-caption mt-1">
        {{ t('findings.overrideReason', { reason: finding.override.reason }) }}
      </div>

      <div v-if="!compact && finding.evidence.length" class="d-flex align-center flex-wrap ga-1 mt-2">
        <span class="text-caption text-medium-emphasis">{{ t('findings.evidence') }}:</span>
        <v-chip
          v-for="(e, i) in activityEvidence"
          :key="`a${i}`"
          size="small"
          variant="tonal"
          prepend-icon="mdi-calendar-text"
          :text="e.label"
          :title="e.snippet"
          @click="e.iri && emit('openActivity', e.iri)"
        />
        <v-chip
          v-for="(e, i) in otherEvidence"
          :key="`o${i}`"
          size="small"
          variant="outlined"
          :text="e.label"
          :title="e.snippet"
        />
      </div>

      <FindingExplainPanel v-if="!compact && finding.explain" :finding="finding" />

      <div class="d-flex align-center flex-wrap ga-2 mt-2">
        <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" class="text-body-2">
          <v-icon icon="mdi-open-in-new" size="x-small" />
          {{ t('findings.source') }}: {{ finding.source?.title }}
        </a>
        <v-spacer />
        <template v-if="!compact && !hideActions">
          <v-btn
            v-if="!finding.override"
            size="small"
            variant="text"
            prepend-icon="mdi-eye-off-outline"
            :text="t('findings.override')"
            @click="emit('override', finding)"
          />
          <v-btn
            v-else
            size="small"
            variant="text"
            prepend-icon="mdi-undo"
            :text="t('findings.removeOverride')"
            @click="emit('removeOverride', finding)"
          />
        </template>
        <v-btn
          v-if="!hideActions"
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-message-draw"
          :text="t('findings.createFeedback')"
          @click="emit('feedback', finding)"
        />
      </div>
    </v-card-text>
  </v-card>
</template>
