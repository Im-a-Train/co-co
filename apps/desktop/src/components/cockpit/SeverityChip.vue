<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { severityStateColor } from '@/domain/cockpit'
import type { Severity } from '@/domain/types'

defineProps<{ severity: Severity; count?: number }>()
const { t } = useI18n()
</script>

<template>
  <v-chip :color="severityStateColor(severity) ?? undefined" size="small" label variant="tonal">
    {{ t(`severity.${severity}`) }}<template v-if="count !== undefined">&nbsp;{{ count }}</template>
  </v-chip>
</template>
