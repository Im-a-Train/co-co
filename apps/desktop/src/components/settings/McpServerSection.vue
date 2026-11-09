<script setup lang="ts">
/** Settings > KI > MCP-Server (ADR 0012): enable switch, status, port, URL, token, confirmations, activity log. */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAi } from '@/composables/useAi'
import { useMcp } from '@/composables/useMcp'
import { mcpToolByName } from '@/domain/mcp/catalog'
import { copyText } from '@/lib/clipboard'
import { maskToken } from './mcpGuide'

const { t } = useI18n()
const ai = useAi()
const mcp = useMcp()

const portInput = ref<number | string>(mcp.settings.value.port)
watch(
  () => mcp.settings.value.port,
  (p) => (portInput.value = p),
)

const revealed = ref(false)
const copied = ref<'url' | 'token' | null>(null)
const regenerateOpen = ref(false)
const localError = ref<string | null>(null)

const aiOff = computed(() => !ai.enabled.value)
const statusText = computed(() => {
  const s = mcp.status.value
  if (s?.running) return t('mcp.server.statusRunning', { port: s.port ?? mcp.settings.value.port })
  if (s?.error || mcp.error.value) return t('mcp.server.statusError', { error: s?.error ?? mcp.error.value })
  return t('mcp.server.statusStopped')
})
const statusColor = computed(() => {
  if (mcp.status.value?.running) return 'success'
  return mcp.status.value?.error ? 'error' : 'default'
})
const tokenShown = computed(() => {
  const tk = mcp.token.value
  if (!tk) return 'coco_' + '•'.repeat(12)
  return revealed.value ? tk : maskToken(tk)
})
const errorText = computed(() => localError.value ?? mcp.error.value)

async function guard(fn: () => Promise<unknown>) {
  localError.value = null
  try {
    await fn()
  } catch (e) {
    localError.value = e instanceof Error ? e.message : String(e)
  }
}

function flash(what: 'url' | 'token') {
  copied.value = what
  setTimeout(() => {
    if (copied.value === what) copied.value = null
  }, 2000)
}

async function copyUrl() {
  if (await copyText(mcp.url.value)) flash('url')
}
async function copyToken() {
  await guard(async () => {
    const tk = await mcp.loadToken()
    if (await copyText(tk)) flash('token')
  })
}
async function reveal() {
  if (revealed.value) {
    revealed.value = false
    return
  }
  await guard(async () => {
    await mcp.loadToken()
    revealed.value = true
  })
}
async function regenerate() {
  regenerateOpen.value = false
  await guard(async () => {
    await mcp.regenerateToken()
    revealed.value = false
  })
}

function toolTitle(name: string | null): string {
  if (!name) return t('mcp.log.none')
  return mcpToolByName(name) ? t(`mcp.tools.${name}.title`) : name
}
function time(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-CH')
}
</script>

<template>
  <v-card variant="outlined" data-testid="mcp-server">
    <v-card-title class="text-subtitle-1">{{ t('mcp.server.title') }}</v-card-title>
    <v-card-text>
      <div class="text-body-2 mb-3">{{ t('mcp.server.intro') }}</div>

      <v-alert v-if="aiOff" type="info" variant="tonal" density="compact" class="mb-3" data-testid="mcp-ai-off">
        {{ t('mcp.server.aiDisabled') }}
      </v-alert>
      <v-alert v-if="errorText" type="error" variant="tonal" density="compact" class="mb-3" :text="errorText" />

      <div class="d-flex align-center flex-wrap ga-3">
        <v-switch
          :model-value="mcp.settings.value.enabled && !aiOff"
          :label="t('mcp.server.enable')"
          :disabled="aiOff || mcp.busy.value"
          color="primary"
          density="compact"
          hide-details
          data-testid="mcp-enable"
          @update:model-value="(v) => guard(() => mcp.setEnabled(!!v))"
        />
        <v-chip size="small" :color="statusColor" variant="tonal" data-testid="mcp-status">{{ statusText }}</v-chip>
      </div>

      <div class="d-flex align-center flex-wrap ga-2 mt-3">
        <v-text-field
          v-model="portInput"
          type="number"
          :label="t('mcp.server.port')"
          min="1024"
          max="65535"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 160px"
          data-testid="mcp-port"
        />
        <v-btn
          variant="tonal"
          :disabled="mcp.busy.value"
          data-testid="mcp-port-apply"
          @click="guard(() => mcp.setPort(Number(portInput)))"
        >
          {{ t('mcp.server.portApply') }}
        </v-btn>
      </div>

      <div class="d-flex align-center ga-2 mt-3" data-testid="mcp-url">
        <span class="text-caption" style="min-width: 60px">{{ t('mcp.server.url') }}</span>
        <code class="mcp-code flex-grow-1">{{ mcp.url.value }}</code>
        <v-btn size="small" variant="text" icon="mdi-content-copy" :title="t('mcp.server.copy')" @click="copyUrl" />
        <span v-if="copied === 'url'" class="text-caption text-success">{{ t('mcp.server.copied') }}</span>
      </div>

      <div class="d-flex align-center flex-wrap ga-2 mt-2" data-testid="mcp-token">
        <span class="text-caption" style="min-width: 60px">{{ t('mcp.server.token') }}</span>
        <code class="mcp-code flex-grow-1">{{ tokenShown }}</code>
        <v-btn
          size="small"
          variant="text"
          :icon="revealed ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
          :title="revealed ? t('mcp.server.hide') : t('mcp.server.reveal')"
          data-testid="mcp-token-reveal"
          @click="reveal"
        />
        <v-btn
          size="small"
          variant="text"
          icon="mdi-content-copy"
          :title="t('mcp.server.copy')"
          data-testid="mcp-token-copy"
          @click="copyToken"
        />
        <span v-if="copied === 'token'" class="text-caption text-success">{{ t('mcp.server.copied') }}</span>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-refresh"
          data-testid="mcp-token-regenerate"
          @click="regenerateOpen = true"
        >
          {{ t('mcp.server.regenerate') }}
        </v-btn>
      </div>
      <div class="text-caption mt-1">{{ t('mcp.server.tokenHint') }}</div>

      <v-divider class="my-3" />

      <v-switch
        :model-value="mcp.settings.value.confirmWrites"
        :label="t('mcp.server.confirmWrites')"
        color="primary"
        density="compact"
        hide-details
        data-testid="mcp-confirm-writes"
        @update:model-value="(v) => guard(() => mcp.setConfirmWrites(!!v))"
      />
      <v-switch
        :model-value="mcp.settings.value.confirmReads"
        :label="t('mcp.server.confirmReads')"
        color="primary"
        density="compact"
        hide-details
        data-testid="mcp-confirm-reads"
        @update:model-value="(v) => guard(() => mcp.setConfirmReads(!!v))"
      />
      <div class="text-caption">{{ t('mcp.server.confirmHint') }}</div>

      <v-divider class="my-3" />

      <div class="text-subtitle-2 mb-1">{{ t('mcp.log.title') }}</div>
      <div data-testid="mcp-log">
        <div v-if="!mcp.status.value?.log.length" class="text-caption">{{ t('mcp.log.empty') }}</div>
        <v-table v-else density="compact">
          <thead>
            <tr>
              <th>{{ t('mcp.log.at') }}</th>
              <th>{{ t('mcp.log.tool') }}</th>
              <th>{{ t('mcp.log.kind') }}</th>
              <th>{{ t('mcp.log.status') }}</th>
              <th>{{ t('mcp.log.duration') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in mcp.status.value.log" :key="i">
              <td>{{ time(e.atMs) }}</td>
              <td>{{ toolTitle(e.tool) }}</td>
              <td>
                <v-chip v-if="e.kind" size="x-small" variant="tonal" :color="e.kind === 'write' ? 'warning' : 'default'">
                  {{ t(`mcp.kind.${e.kind}`) }}
                </v-chip>
                <span v-else>{{ t('mcp.log.none') }}</span>
              </td>
              <td>
                <v-chip size="x-small" variant="tonal" :color="e.ok ? 'success' : 'error'">
                  {{ e.ok ? t('mcp.log.ok') : t('mcp.log.failed') }}
                </v-chip>
                <span v-if="e.error" class="text-caption ml-1">{{ e.error }}</span>
              </td>
              <td>{{ t('mcp.log.ms', { ms: e.durationMs }) }}</td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-card-text>

    <v-dialog v-model="regenerateOpen" max-width="440">
      <v-card>
        <v-card-title>{{ t('mcp.server.regenerateTitle') }}</v-card-title>
        <v-card-text>{{ t('mcp.server.regenerateText') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn data-testid="mcp-regenerate-cancel" @click="regenerateOpen = false">{{ t('mcp.server.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" data-testid="mcp-regenerate-confirm" @click="regenerate">
            {{ t('mcp.server.regenerateConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.mcp-code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
  min-width: 0;
}
</style>
