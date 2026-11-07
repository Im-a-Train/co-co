<script setup lang="ts">
/** Small «MiData» badge next to a coach input that was accepted from MiData. */
import { useI18n } from 'vue-i18n'
import { formatStand } from './format'

defineProps<{ since: string }>()
const { t } = useI18n()
</script>

<template>
  <v-chip size="x-small" color="red-darken-2" variant="tonal" label class="midata-badge" data-testid="midata-badge">
    {{ t('midata.badge.label') }}
    <v-tooltip activator="parent" location="top" scroll-strategy="none">{{ t('midata.badge.tooltip', { date: formatStand(since) }) }}</v-tooltip>
  </v-chip>
</template>
