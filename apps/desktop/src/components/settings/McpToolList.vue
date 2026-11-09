<script setup lang="ts">
/** Settings > KI > MCP-Server: tool list grouped «Lesen» / «Schreiben» with one switch per tool (ADR 0012). */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMcp } from '@/composables/useMcp'
import { MCP_TOOLS, isToolEnabled } from '@/domain/mcp/catalog'
import type { McpToolKind } from '@/domain/mcp/types'

const { t } = useI18n()
const mcp = useMcp()
const error = ref<string | null>(null)

const groups = computed(() =>
  (['read', 'write'] as McpToolKind[]).map((kind) => {
    const tools = MCP_TOOLS.filter((x) => x.kind === kind)
    const n = tools.filter((x) => isToolEnabled(x, mcp.settings.value.tools)).length
    return { kind, tools, n }
  }),
)

async function toggle(name: string, on: boolean) {
  error.value = null
  try {
    await mcp.setToolEnabled(name, on)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div>
    <div class="text-body-2 mb-3">{{ t('mcp.toolList.intro') }}</div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3" :text="error" />
    <v-card
      v-for="g in groups"
      :key="g.kind"
      variant="outlined"
      class="mb-4"
      :data-testid="`mcp-tools-${g.kind}`"
    >
      <v-card-title class="d-flex align-center text-subtitle-1">
        <v-icon :icon="g.kind === 'read' ? 'mdi-eye-outline' : 'mdi-pencil-outline'" class="mr-2" />
        {{ g.kind === 'read' ? t('mcp.toolList.readTitle') : t('mcp.toolList.writeTitle') }}
        <v-spacer />
        <span class="text-caption">{{ t('mcp.toolList.activeCount', { n: g.n, m: g.tools.length }) }}</span>
      </v-card-title>
      <v-card-text>
        <v-alert v-if="g.kind === 'write'" type="warning" variant="tonal" density="compact" class="mb-2">
          {{ t('mcp.toolList.writeWarning') }}
        </v-alert>
        <div v-else class="text-caption mb-2">{{ t('mcp.toolList.readNote') }}</div>

        <div
          v-for="tool in g.tools"
          :key="tool.name"
          class="d-flex align-center ga-3 py-1"
          :data-testid="`mcp-tool-${tool.name}`"
        >
          <v-switch
            :model-value="isToolEnabled(tool, mcp.settings.value.tools)"
            :color="tool.kind === 'write' ? 'warning' : 'primary'"
            density="compact"
            hide-details
            class="flex-grow-0"
            @update:model-value="(v) => toggle(tool.name, !!v)"
          />
          <div style="min-width: 0">
            <div class="text-body-2 font-weight-medium">
              {{ t(tool.titleKey) }}
              <v-chip v-if="tool.kind === 'write'" size="x-small" color="warning" variant="tonal" class="ml-1">
                {{ t('mcp.toolList.writes') }}
              </v-chip>
            </div>
            <div class="text-caption">{{ t(tool.descriptionKey) }}</div>
            <code class="text-caption" style="font-family: ui-monospace, Consolas, monospace">{{ tool.name }}</code>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>
