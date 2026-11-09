<script setup lang="ts">
/** Leaders: one small dot per qualification key (green valid, yellow expired, red none). */
import { useI18n } from 'vue-i18n'
import { MIDATA_QUAL_KEYS, type MidataQualKey } from '@/domain/types'
import type { QualState } from '@/domain/persons/types'

defineProps<{ quals: Partial<Record<MidataQualKey, QualState>> }>()
const { t } = useI18n()
const COLOR: Record<QualState, string> = { valid: 'success', invalid: 'warning', none: 'error' }
</script>

<template>
  <div class="d-flex ga-1" data-testid="qual-dots">
    <v-tooltip v-for="k in MIDATA_QUAL_KEYS" :key="k" location="top">
      <template #activator="{ props: tip }">
        <v-icon v-bind="tip" icon="mdi-circle" size="x-small" :color="quals[k] ? COLOR[quals[k]!] : 'grey-lighten-1'" />
      </template>
      {{ t(`persons.qualKey.${k}`) }}: {{ quals[k] ? t(`persons.qual.${quals[k]}`) : t('persons.qual.none') }}
    </v-tooltip>
  </div>
</template>
