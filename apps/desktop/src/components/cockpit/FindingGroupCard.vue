<script setup lang="ts">
/** List mode: same-rule day findings as one card («Fixpunkte (Mahlzeiten) fehlen · 7 Tage (24.–30.01.)»); the slot holds the single findings. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { severityColor } from '@/domain/cockpit'
import type { FindingGroupEntry } from '@/domain/triage'
import { groupLabel } from './findingLabels'

const props = defineProps<{ group: FindingGroupEntry; open?: boolean }>()
const emit = defineEmits<{ feedback: [group: FindingGroupEntry]; override: [group: FindingGroupEntry] }>()
const { t } = useI18n()

const expanded = ref(!!props.open)
const first = computed(() => props.group.findings[0]!)
const label = computed(() => groupLabel(t, first.value.title, props.group.findings.length, props.group.dates))
const allIgnored = computed(() => props.group.findings.every((f) => !!f.override))
</script>

<template>
  <v-card
    variant="outlined"
    density="compact"
    :class="{ 'opacity-60': allIgnored }"
    :style="{ borderLeft: `4px solid rgb(var(--v-theme-${severityColor(group.severity)}))` }"
    data-testid="finding-group"
    :data-group="group.findings.length"
  >
    <v-card-text class="py-3">
      <div class="text-subtitle-1">{{ label }}</div>
      <div class="text-body-2">{{ first.message }}</div>
      <div class="d-flex align-center flex-wrap ga-2 mt-2">
        <v-btn size="small" variant="text" :append-icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" data-testid="finding-group-toggle" @click="expanded = !expanded">
          {{ expanded ? t('findings.group.collapse') : t('findings.group.expand') }}
        </v-btn>
        <v-spacer />
        <v-btn
          v-if="!allIgnored"
          size="small"
          variant="text"
          prepend-icon="mdi-eye-off-outline"
          :text="t('findings.group.ignoreAll', { count: group.findings.length })"
          data-testid="finding-group-ignore"
          @click="emit('override', group)"
        />
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-message-draw"
          :text="t('findings.createFeedback')"
          data-testid="finding-group-feedback"
          @click="emit('feedback', group)"
        />
      </div>
    </v-card-text>
    <div v-if="expanded" class="d-flex flex-column ga-2 pa-3 pt-0" data-testid="finding-group-members">
      <slot />
    </div>
  </v-card>
</template>
