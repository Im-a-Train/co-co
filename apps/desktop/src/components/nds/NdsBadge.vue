<script setup lang="ts">
/** Small «NDS» badge next to a coach input that was accepted from NDS. */
import { useI18n } from 'vue-i18n'
import { formatStand } from '@/components/midata/format'

defineProps<{ since: string }>()
const { t } = useI18n()
</script>

<template>
  <v-chip size="x-small" color="red-darken-2" variant="tonal" label class="nds-badge" data-testid="nds-badge">
    {{ t('nds.badge.label') }}
    <v-tooltip activator="parent" location="top" scroll-strategy="none">{{ t('nds.badge.tooltip', { date: formatStand(since) }) }}</v-tooltip>
  </v-chip>
</template>
