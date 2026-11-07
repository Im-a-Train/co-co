<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstances } from '@/composables/useInstances'
import { useSession } from '@/composables/useSession'
import { useSpikeProtocol } from '@/composables/useSpikeProtocol'
import { copyText } from '@/lib/clipboard'
import { buildSpikeReport, RESULT_KEYS, type ResultStatus } from '@/lib/report'

const { t, d } = useI18n()
const { logs, results, campsCount } = useSpikeProtocol()
const { session } = useSession()
const { selected, infos } = useInstances()

const snackbar = ref(false)
const snackbarText = ref('')
const showReport = ref(false)

const reversedLogs = computed(() => [...logs.value].reverse())

function statusIcon(s: ResultStatus): { icon: string; color: string } {
  if (s === 'ok') return { icon: 'mdi-check-circle', color: 'success' }
  if (s === 'failed') return { icon: 'mdi-close-circle', color: 'error' }
  return { icon: 'mdi-circle-outline', color: 'medium-emphasis' }
}

const report = computed(() => {
  const s = session.value
  const baseUrl = s?.baseUrl ?? selected.value.baseUrl
  const info = infos[baseUrl]
  return buildSpikeReport(
    {
      generatedAt: Date.now(),
      appVersion: __APP_VERSION__,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      instance: { baseUrl, apiRoot: s?.apiRoot ?? info?.apiRoot ?? null, version: info?.version ?? null },
      method: s?.method ?? null,
      cookieNames: s?.cookieNames ?? [],
      roles: s?.roles ?? [],
      tokenExp: s?.exp ?? null,
      campsCount: campsCount.value,
      results,
      logs: logs.value,
    },
    (key, params) => (params ? t(key, params) : t(key)),
  )
})

async function copyReport(): Promise<void> {
  const ok = await copyText(report.value)
  snackbarText.value = ok ? t('protocol.copied') : t('protocol.copyFailed')
  snackbar.value = true
  if (!ok) showReport.value = true
}
</script>

<template>
  <v-card class="h-100">
    <v-card-item prepend-icon="mdi-clipboard-pulse-outline">
      <v-card-title>{{ t('protocol.title') }}</v-card-title>
      <v-card-subtitle>{{ t('protocol.subtitle') }}</v-card-subtitle>
      <template #append>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-content-copy" @click="copyReport">
          {{ t('protocol.copy') }}
        </v-btn>
      </template>
    </v-card-item>

    <v-card-text>
      <v-row dense>
        <v-col cols="12" md="5">
          <div class="text-subtitle-2 mb-2">{{ t('protocol.results') }}</div>
          <v-list density="compact" class="py-0">
            <v-list-item v-for="key in RESULT_KEYS" :key="key" :title="t(`results.${key}`)">
              <template #prepend>
                <v-icon :icon="statusIcon(results[key].status).icon" :color="statusIcon(results[key].status).color" />
              </template>
              <v-list-item-subtitle>
                {{ t(`results.status.${results[key].status}`) }}
                <template v-if="key === 'campsLoaded' && campsCount != null"> · {{ campsCount }}</template>
                <template v-if="results[key].at"> · {{ d(new Date(results[key].at as number), 'time') }}</template>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-col>

        <v-col cols="12" md="7">
          <div class="text-subtitle-2 mb-2">{{ t('protocol.log') }} ({{ logs.length }})</div>
          <v-sheet border rounded="lg" class="log">
            <div v-if="!logs.length" class="pa-3 text-body-2 text-medium-emphasis">{{ t('protocol.noLog') }}</div>
            <div v-for="(entry, i) in reversedLogs" :key="i" class="log-line" :class="{ 'text-error': !entry.ok }">
              <span class="text-medium-emphasis">{{ d(new Date(entry.at), 'time') }}</span>
              <v-chip size="x-small" label class="mx-1" :color="entry.source === 'rust' ? 'secondary' : 'primary'">
                {{ entry.source }}
              </v-chip>
              <v-icon :icon="entry.ok ? 'mdi-check' : 'mdi-alert'" size="x-small" class="me-1" />
              <strong>{{ entry.step }}</strong>
              <span v-if="entry.detail"> – {{ entry.detail }}</span>
            </div>
          </v-sheet>
        </v-col>
      </v-row>

      <v-btn variant="text" size="small" class="mt-3" :prepend-icon="showReport ? 'mdi-chevron-up' : 'mdi-chevron-down'" @click="showReport = !showReport">
        {{ showReport ? t('protocol.hideReport') : t('protocol.showReport') }}
      </v-btn>
      <v-expand-transition>
        <v-textarea v-if="showReport" :model-value="report" readonly auto-grow rows="8" class="mt-2 report" variant="outlined" />
      </v-expand-transition>
    </v-card-text>

    <v-snackbar v-model="snackbar" timeout="2500">{{ snackbarText }}</v-snackbar>
  </v-card>
</template>

<style scoped>
.log {
  max-height: 320px;
  overflow-y: auto;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.8rem;
}
.log-line {
  padding: 4px 10px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  word-break: break-word;
}
.log-line:last-child {
  border-bottom: none;
}
.report :deep(textarea) {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.8rem;
}
</style>
