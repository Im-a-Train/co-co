<script setup lang="ts">
/**
 * Behoben / Offen / Neu since the last draft round; every finding links to the triage. Day findings of
 * one rule are one entry («an 7 Tagen (…)»); a finding whose id changed between the runs is marked
 * «jetzt Muss (vorher Hinweis)» / «geändert» instead of showing up as fixed and new.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { daysLabel, groupSelfCheckFindings, type SelfCheckProgress } from '@/domain/selfCheck'
import type { CampFacts, Iri, SelfCheckFinding } from '@/domain/types'
import { triageLocation } from '@/domain/triage'

const props = defineProps<{ progress: SelfCheckProgress; campIri: Iri; facts?: CampFacts | null }>()
const { t } = useI18n()

const columns = [
  { key: 'fixed', color: 'success', icon: 'mdi-check-circle-outline' },
  { key: 'remaining', color: 'warning', icon: 'mdi-progress-clock' },
  { key: 'added', color: 'error', icon: 'mdi-plus-circle-outline' },
] as const
type ColumnKey = (typeof columns)[number]['key']

/** Colour = state: red only while a Muss is in the column, orange for open Soll/Hinweis, green for fixed, none for zero. */
function colorOf(key: ColumnKey, color: string): string | undefined {
  const list = props.progress[key]
  if (list.length === 0) return undefined
  if (key === 'added') return list.some((f) => f.severity === 'must') ? 'error' : 'warning'
  return color
}

interface Entry {
  key: string
  title: string
  subtitle: string
  firstId: string
  /** Marker for findings that changed between the runs (remaining column only). */
  marker: string | null
}

function markerOf(items: readonly SelfCheckFinding[]): string | null {
  for (const f of items) {
    const c = props.progress.changed[f.id]
    if (!c) continue
    return c.severityChanged
      ? t('selfCheck.progress.changedSeverity', { now: t(`selfCheck.kpi.${c.now.severity}`), before: t(`selfCheck.kpi.${c.before.severity}`) })
      : t('selfCheck.progress.changedVariant')
  }
  return null
}

const entries = computed<Record<ColumnKey, Entry[]>>(() => {
  const build = (key: ColumnKey): Entry[] =>
    groupSelfCheckFindings(props.progress[key], props.facts ?? null).map((g) => ({
      key: `${g.ruleId}-${g.items[0]!.id}`,
      title: g.title,
      subtitle: g.merged ? daysLabel(g.dates) : g.items[0]!.message,
      firstId: g.items[0]!.id,
      marker: key === 'remaining' ? markerOf(g.items) : null,
    }))
  return { fixed: build('fixed'), remaining: build('remaining'), added: build('added') }
})
</script>

<template>
  <v-row dense>
    <v-col v-for="c in columns" :key="c.key" cols="12" md="4">
      <v-card variant="outlined" class="h-100" :data-testid="`selfcheck-${c.key}`">
        <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
          <v-icon :icon="c.icon" :color="colorOf(c.key, c.color)" size="small" />
          {{ t(`selfCheck.progress.${c.key}`) }}
          <v-chip size="x-small" :color="colorOf(c.key, c.color)" variant="tonal">{{ progress[c.key].length }}</v-chip>
        </v-card-title>
        <v-list density="compact" class="pt-0">
          <v-list-item v-if="entries[c.key].length === 0" :title="t('selfCheck.progress.empty')" class="text-medium-emphasis" />
          <v-list-item
            v-for="e in entries[c.key]"
            :key="e.key"
            :title="e.title"
            :to="c.key === 'fixed' ? undefined : triageLocation(campIri, e.firstId)"
            :title-tag="'span'"
            :data-testid="'selfcheck-finding'"
          >
            <template #subtitle>
              <span class="text-wrap d-block">{{ e.subtitle }}</span>
              <v-chip v-if="e.marker" size="x-small" label color="warning" variant="tonal" class="mt-1" data-testid="selfcheck-changed-marker">{{ e.marker }}</v-chip>
            </template>
            <template v-if="c.key !== 'fixed'" #append>
              <v-icon icon="mdi-arrow-right" size="small" :aria-label="t('selfCheck.openFinding')" />
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </v-col>
  </v-row>
</template>
