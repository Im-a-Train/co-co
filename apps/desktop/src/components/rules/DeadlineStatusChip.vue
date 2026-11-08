<script setup lang="ts">
/** Status chip of a deadline (done=success, overdue=error, soon=warning, open=neutral). */
import { useI18n } from 'vue-i18n'
import type { DeadlineStatus } from '@/domain/rules/lib/deadlines'

defineProps<{ status: DeadlineStatus }>()
const { t } = useI18n()

const COLOR: Record<DeadlineStatus, string | undefined> = {
  done: 'success',
  overdue: 'error',
  soon: 'warning',
  open: undefined,
}
</script>

<template>
  <v-chip size="small" label :color="COLOR[status]" :variant="COLOR[status] ? 'flat' : 'tonal'">
    {{ t(`rules.deadlines.status.${status}`) }}
  </v-chip>
</template>
