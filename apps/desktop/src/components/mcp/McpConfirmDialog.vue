<script setup lang="ts">
/** Global confirmation dialog for MCP tool calls (ADR 0011), mounted once in App.vue. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentConfirm, pendingConfirmCount, resolveCurrent } from '@/composables/mcpConfirm'

const { t } = useI18n()
const open = computed(() => currentConfirm.value !== null)
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="560" data-testid="mcp-confirm-dialog-root">
    <v-card v-if="currentConfirm" data-testid="mcp-confirm-dialog">
      <v-card-title class="text-subtitle-1">{{ t('mcp.confirm.title') }}</v-card-title>
      <v-card-text>
        <div class="d-flex align-center ga-2 mb-2">
          <span class="text-body-1 font-weight-medium">{{ t(`mcp.tools.${currentConfirm.tool}.title`) }}</span>
          <v-chip size="x-small" variant="tonal" :color="currentConfirm.kind === 'write' ? 'warning' : 'default'">
            {{ t(`mcp.kind.${currentConfirm.kind}`) }}
          </v-chip>
        </div>
        <div class="text-body-2 mb-2">{{ currentConfirm.summary }}</div>
        <div
          v-for="(d, i) in currentConfirm.details"
          :key="i"
          class="text-body-2 pa-2 mb-1 rounded"
          style="white-space: pre-wrap; overflow-wrap: anywhere; background: rgba(var(--v-theme-on-surface), 0.06)"
        >
          {{ d }}
        </div>
        <div v-if="pendingConfirmCount > 1" class="text-caption mt-2">
          {{ t('mcp.confirm.queue', { n: pendingConfirmCount - 1 }) }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn data-testid="mcp-confirm-deny" @click="resolveCurrent(false)">{{ t('mcp.confirm.deny') }}</v-btn>
        <v-btn color="primary" variant="flat" data-testid="mcp-confirm-allow" @click="resolveCurrent(true)">
          {{ t('mcp.confirm.allow') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
