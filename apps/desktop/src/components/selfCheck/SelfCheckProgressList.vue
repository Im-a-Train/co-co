<script setup lang="ts">
/** Behoben / Offen / Neu since the last draft round; every finding links to the triage. */
import { useI18n } from 'vue-i18n'
import type { SelfCheckProgress } from '@/domain/selfCheck'
import type { Iri, SelfCheckFinding } from '@/domain/types'
import { triageLocation } from '@/domain/triage'

const props = defineProps<{ progress: SelfCheckProgress; campIri: Iri }>()
const { t } = useI18n()

const columns = [
  { key: 'fixed', color: 'success', icon: 'mdi-check-circle-outline' },
  { key: 'remaining', color: 'warning', icon: 'mdi-progress-clock' },
  { key: 'added', color: 'error', icon: 'mdi-plus-circle-outline' },
] as const

function items(key: (typeof columns)[number]['key']): SelfCheckFinding[] {
  return props.progress[key]
}
</script>

<template>
  <v-row dense>
    <v-col v-for="c in columns" :key="c.key" cols="12" md="4">
      <v-card variant="outlined" class="h-100" :data-testid="`selfcheck-${c.key}`">
        <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
          <v-icon :icon="c.icon" :color="c.color" size="small" />
          {{ t(`selfCheck.progress.${c.key}`) }}
          <v-chip size="x-small" :color="c.color" variant="tonal">{{ items(c.key).length }}</v-chip>
        </v-card-title>
        <v-list density="compact" class="pt-0">
          <v-list-item v-if="items(c.key).length === 0" :title="t('selfCheck.progress.empty')" class="text-medium-emphasis" />
          <v-list-item
            v-for="f in items(c.key)"
            :key="f.id"
            :title="f.title"
            :subtitle="f.message"
            :to="c.key === 'fixed' ? undefined : triageLocation(campIri, f.id)"
            :title-tag="'span'"
            :data-testid="'selfcheck-finding'"
          >
            <template v-if="c.key !== 'fixed'" #append>
              <v-icon icon="mdi-arrow-right" size="small" :aria-label="t('selfCheck.openFinding')" />
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </v-col>
  </v-row>
</template>
