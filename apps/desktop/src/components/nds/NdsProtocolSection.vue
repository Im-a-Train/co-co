<script setup lang="ts">
/** M22: «NDS-Verlauf»: protocol events (status history) and the submission/approval/closing dates derived from it. */
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/components/midata/format'
import type { NdsProtocol } from '@/domain/types'
import { protocolKindColor } from './format'

defineProps<{ protocol: NdsProtocol }>()
const { t } = useI18n()
</script>

<template>
  <div class="mt-4" data-testid="nds-protocol">
    <div class="text-subtitle-2 mb-1">{{ t('nds.protocol.title') }}</div>
    <div class="d-flex flex-wrap ga-2 mb-2">
      <v-chip v-if="protocol.submittedOn" size="small" variant="tonal" data-testid="nds-protocol-submitted">
        {{ t('nds.protocol.submittedOn', { date: formatDate(protocol.submittedOn) }) }}
      </v-chip>
      <v-chip v-if="protocol.approvedOn" size="small" variant="tonal" color="success" data-testid="nds-protocol-approved">
        {{ t('nds.protocol.approvedOn', { date: formatDate(protocol.approvedOn) }) }}
      </v-chip>
      <v-chip v-if="protocol.closedOn" size="small" variant="tonal" color="primary" data-testid="nds-protocol-closed">
        {{ t('nds.protocol.closedOn', { date: formatDate(protocol.closedOn) }) }}
      </v-chip>
    </div>
    <div v-for="(e, i) in protocol.events" :key="i" class="d-flex align-center ga-2 text-body-2" data-testid="nds-protocol-event">
      <span class="text-no-wrap">{{ formatDate(e.date) }}</span>
      <span>{{ e.label }}</span>
      <v-chip size="x-small" variant="tonal" label :color="protocolKindColor(e.kind)">{{ t(`nds.protocol.kind.${e.kind}`) }}</v-chip>
    </div>
    <div v-if="protocol.truncated" class="text-caption text-medium-emphasis mt-1" data-testid="nds-protocol-truncated">
      {{ t('nds.protocol.truncated') }}
    </div>
  </div>
</template>
