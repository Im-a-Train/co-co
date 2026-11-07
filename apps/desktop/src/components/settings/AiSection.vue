<script setup lang="ts">
/** Settings > KI: enable AI, API key (OS keychain), model, data zones, AI log. OWNER: ai builder. */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAi } from '@/composables/useAi'
import type { AiModel } from '@/domain/types'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const ai = useAi()
const inTauri = isTauri()
const keyInput = ref('')
const error = ref<string | null>(null)
const saved = ref(false)
const models: AiModel[] = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']

onMounted(() => void ai.loadLog())

async function guard(fn: () => Promise<void>) {
  error.value = null
  try {
    await fn()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

const saveKey = () =>
  guard(async () => {
    await ai.saveKey(keyInput.value)
    keyInput.value = ''
    saved.value = true
  })
</script>

<template>
  <v-row>
    <v-col cols="12" md="8" xl="6">
      <v-card variant="outlined">
        <v-card-text>
          <v-alert type="info" variant="tonal" density="compact" class="mb-3">{{ t('ai.zones.text') }}</v-alert>
          <v-switch
            :model-value="ai.enabled.value"
            :label="t('ai.enable')"
            color="primary"
            density="compact"
            hide-details
            @update:model-value="(v) => guard(() => ai.setEnabled(!!v))"
          />
          <div class="text-caption mb-4">{{ t('ai.enableHint') }}</div>

          <div class="text-subtitle-2 mb-1">{{ t('ai.key.title') }}</div>
          <div class="mb-2">
            <v-chip size="small" :color="ai.hasKey.value ? 'success' : undefined" variant="tonal">
              {{ ai.hasKey.value ? t('ai.key.stored') : t('ai.key.missing') }}
            </v-chip>
          </div>
          <div class="d-flex ga-2 align-start">
            <v-text-field
              v-model="keyInput"
              type="password"
              autocomplete="off"
              density="compact"
              :label="t('ai.key.label')"
              :disabled="!inTauri"
              hide-details="auto"
              @update:model-value="saved = false"
            />
            <v-btn :disabled="!inTauri || !keyInput.trim()" color="primary" @click="saveKey">
              {{ t('common.save') }}
            </v-btn>
            <v-btn :disabled="!inTauri || !ai.hasKey.value" @click="guard(ai.clearKey)">{{ t('ai.key.clear') }}</v-btn>
          </div>
          <div v-if="saved" class="text-caption text-success mt-1">{{ t('ai.key.saved') }}</div>
          <div class="text-caption mt-1 mb-4">{{ t('ai.key.hint') }}</div>

          <v-select
            :model-value="ai.model.value"
            :items="models"
            :label="t('ai.model')"
            density="compact"
            hide-details
            @update:model-value="(m) => guard(() => ai.setModel(m as AiModel))"
          />
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3" :text="error" />
        </v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" md="8" xl="6">
      <div class="text-subtitle-2 mb-1">{{ t('ai.log.title') }}</div>
      <div v-if="!ai.log.value.length" class="text-caption">{{ t('ai.log.empty') }}</div>
      <v-table v-else density="compact">
        <thead>
          <tr>
            <th>{{ t('ai.log.at') }}</th>
            <th>{{ t('ai.log.feature') }}</th>
            <th>{{ t('ai.log.tokens') }}</th>
            <th>{{ t('ai.log.redactions') }}</th>
            <th>{{ t('ai.log.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in ai.log.value" :key="e.id">
            <td>{{ new Date(e.at).toLocaleString('de-CH') }}</td>
            <td>{{ t(`ai.features.${e.feature}`) }}</td>
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
</template>
