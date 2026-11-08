<script setup lang="ts">
/** Settings > KI > MCP-Server: short connection guide per client (ADR 0011). Snippets show the masked token. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMcp } from '@/composables/useMcp'
import { copyText } from '@/lib/clipboard'
import { claudeCodeCommand, claudeDesktopConfig, genericConfig, maskToken } from './mcpGuide'

type Client = 'claude-desktop' | 'claude-code' | 'generic'

const { t } = useI18n()
const mcp = useMcp()
const tab = ref<Client>('claude-desktop')
const copied = ref(false)
const error = ref<string | null>(null)

const builders: Record<Client, (url: string, token: string) => string> = {
  'claude-desktop': claudeDesktopConfig,
  'claude-code': claudeCodeCommand,
  generic: genericConfig,
}
const noteKey: Record<Client, string> = {
  'claude-desktop': 'mcp.guide.noteClaudeDesktop',
  'claude-code': 'mcp.guide.noteClaudeCode',
  generic: 'mcp.guide.noteGeneric',
}

const MASK_SOURCE = 'coco_' + '0'.repeat(60) + '0000'
const maskedToken = computed(() => {
  const tk = mcp.token.value
  return tk ? maskToken(tk) : maskToken(MASK_SOURCE)
})
const snippet = computed(() => builders[tab.value](mcp.url.value, maskedToken.value))

async function copy() {
  error.value = null
  try {
    const tk = await mcp.loadToken()
    if (await copyText(builders[tab.value](mcp.url.value, tk))) {
      copied.value = true
      setTimeout(() => (copied.value = false), 2000)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <v-card variant="outlined" data-testid="mcp-guide">
    <v-card-title class="text-subtitle-1">{{ t('mcp.guide.title') }}</v-card-title>
    <v-card-text>
      <ol class="pl-5 mb-1 text-body-2">
        <li>{{ t('mcp.guide.step1') }}</li>
        <li>{{ t('mcp.guide.step2') }}</li>
        <li>{{ t('mcp.guide.step3') }}</li>
      </ol>
      <div class="text-caption mb-3">{{ t('mcp.guide.openNote') }}</div>

      <v-tabs v-model="tab" color="primary" density="compact">
        <v-tab value="claude-desktop" data-testid="mcp-guide-tab-claude-desktop">{{ t('mcp.guide.tabClaudeDesktop') }}</v-tab>
        <v-tab value="claude-code" data-testid="mcp-guide-tab-claude-code">{{ t('mcp.guide.tabClaudeCode') }}</v-tab>
        <v-tab value="generic" data-testid="mcp-guide-tab-generic">{{ t('mcp.guide.tabGeneric') }}</v-tab>
      </v-tabs>

      <div class="text-body-2 mt-3 mb-2">{{ t(noteKey[tab]) }}</div>
      <pre class="mcp-snippet" data-testid="mcp-guide-snippet">{{ snippet }}</pre>
      <div class="text-caption mt-1">{{ t('mcp.guide.snippetMasked') }}</div>

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-2" :text="error" />
      <div class="d-flex align-center ga-2 mt-2">
        <v-btn variant="tonal" prepend-icon="mdi-content-copy" data-testid="mcp-guide-copy" @click="copy">
          {{ t('mcp.guide.copy') }}
        </v-btn>
        <span v-if="copied" class="text-caption text-success">{{ t('mcp.guide.copied') }}</span>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.mcp-snippet {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.8rem;
  padding: 8px 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  overflow-x: auto;
  max-width: 100%;
  white-space: pre;
}
</style>
