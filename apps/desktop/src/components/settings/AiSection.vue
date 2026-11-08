<script setup lang="ts">
/**
 * Settings > KI (ADR 0005, ADR 0011): data-zone note + master switch, then three sub-areas as tabs:
 * «Anbieter» (AiProviderSection: Anthropic / OpenAI-kompatibel incl. lokal), «MCP-Server» (McpServerSection,
 * McpGuide, McpToolList) and «Protokoll» (AI request log, counts only).
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAi } from '@/composables/useAi'
import AiProviderSection from './AiProviderSection.vue'
import McpGuide from './McpGuide.vue'
import McpServerSection from './McpServerSection.vue'
import McpToolList from './McpToolList.vue'

const { t } = useI18n()
const ai = useAi()
const tab = ref<'provider' | 'mcp' | 'log'>('provider')
const error = ref<string | null>(null)

onMounted(() => void ai.loadLog())

async function guard(fn: () => Promise<void>) {
  error.value = null
  try {
    await fn()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div>
    <v-row>
      <v-col cols="12" md="10" xl="8">
        <v-alert type="info" variant="tonal" density="compact" class="mb-3">{{ t('ai.zones.text') }}</v-alert>
        <v-switch
          :model-value="ai.enabled.value"
          :label="t('ai.enable')"
          color="primary"
          density="compact"
          hide-details
          data-testid="ai-enable"
          @update:model-value="(v) => guard(() => ai.setEnabled(!!v))"
        />
        <div class="text-caption mb-3">{{ t('ai.enableHint') }}</div>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3" :text="error" />
      </v-col>
    </v-row>

    <v-tabs v-model="tab" color="primary" density="compact" class="mb-3">
      <v-tab value="provider" data-testid="ai-tab-provider">{{ t('ai.sections.provider') }}</v-tab>
      <v-tab value="mcp" data-testid="ai-tab-mcp">{{ t('ai.sections.mcp') }}</v-tab>
      <v-tab value="log" data-testid="ai-tab-log">{{ t('ai.sections.log') }}</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="provider">
        <AiProviderSection />
      </v-window-item>

      <v-window-item value="mcp">
        <McpServerSection />
        <McpGuide class="mt-4" />
        <McpToolList class="mt-4" />
      </v-window-item>

      <v-window-item value="log">
        <v-row>
          <v-col cols="12" md="10" xl="8">
            <div class="text-subtitle-2 mb-1">{{ t('ai.log.title') }}</div>
            <div v-if="!ai.log.value.length" class="text-caption">{{ t('ai.log.empty') }}</div>
            <v-table v-else density="compact">
              <thead>
                <tr>
                  <th>{{ t('ai.log.at') }}</th>
                  <th>{{ t('ai.log.feature') }}</th>
                  <th>{{ t('ai.log.model') }}</th>
                  <th>{{ t('ai.log.tokens') }}</th>
                  <th>{{ t('ai.log.redactions') }}</th>
                  <th>{{ t('ai.log.status') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in ai.log.value" :key="e.id">
                  <td>{{ new Date(e.at).toLocaleString('de-CH') }}</td>
                  <td>{{ t(`ai.features.${e.feature}`) }}</td>
                  <td>{{ e.model }}</td>
                  <td>{{ e.inputTokens }} / {{ e.outputTokens }}</td>
                  <td>{{ e.redactions }}</td>
                  <td>
                    <v-chip size="x-small" :color="e.ok ? 'success' : 'error'" variant="tonal">
                      {{ e.ok ? t('ai.log.ok') : t('ai.log.failed') }}
                    </v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-col>
        </v-row>
      </v-window-item>
    </v-window>
  </div>
</template>
