<script setup lang="ts">
/** Settings > KI > Anbieter: Anthropic key/model or an OpenAI-compatible (incl. local) server (ADR 0011). */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAi } from '@/composables/useAi'
import type { AiModel, AiProvider, OpenAiPreset } from '@/domain/types'
import { isTauri } from '@/lib/tauri'
import { PRESETS, isAllowedBaseUrl, originOf } from './aiProvider'

const { t } = useI18n()
const ai = useAi()
const inTauri = isTauri()
const models: AiModel[] = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']

const error = ref<string | null>(null)
const keyInput = ref('')
const keySaved = ref(false)
const oaKeyInput = ref('')
const oaKeySaved = ref(false)
const baseUrlInput = ref(ai.openai.value.baseUrl)
const modelInput = ref(ai.openai.value.model)
const loadedModels = ref<string[]>([])
const loadingModels = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)
const modelsNote = ref<string | null>(null)

watch(
  () => ai.openai.value.baseUrl,
  (v) => (baseUrlInput.value = v),
)
watch(
  () => ai.openai.value.model,
  (v) => (modelInput.value = v),
)

const urlValid = computed(() => isAllowedBaseUrl(baseUrlInput.value))
const origin = computed(() => originOf(ai.openai.value.baseUrl))
const activePreset = computed(() => PRESETS.find((p) => p.id === ai.openai.value.preset) ?? PRESETS[3])

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
    keySaved.value = true
  })

const saveOaKey = () =>
  guard(async () => {
    await ai.saveOpenaiKey(oaKeyInput.value)
    oaKeyInput.value = ''
    oaKeySaved.value = true
  })

const pickPreset = (p: OpenAiPreset) => {
  testResult.value = null
  modelsNote.value = null
  loadedModels.value = []
  return guard(() => ai.applyPreset(p))
}

const commitBaseUrl = () =>
  guard(async () => {
    const v = baseUrlInput.value.trim()
    if (!isAllowedBaseUrl(v) || v === ai.openai.value.baseUrl) return
    const preset = PRESETS.find((p) => p.url === v)?.id ?? 'custom'
    testResult.value = null
    loadedModels.value = []
    await ai.setOpenai({ baseUrl: v, preset })
  })

const commitModel = (v: unknown) =>
  guard(async () => {
    const name = typeof v === 'string' ? v.trim() : ''
    modelInput.value = name
    if (name !== ai.openai.value.model) await ai.setOpenai({ model: name })
  })

const loadModels = () =>
  guard(async () => {
    loadingModels.value = true
    modelsNote.value = null
    try {
      loadedModels.value = await ai.loadModels()
      modelsNote.value = t('ai.provider.modelsLoaded', { n: loadedModels.value.length })
    } finally {
      loadingModels.value = false
    }
  })

async function runTest() {
  testing.value = true
  testResult.value = null
  try {
    const list = await ai.loadModels()
    loadedModels.value = list
    testResult.value = { ok: true, text: t('ai.provider.testOk', { n: list.length }) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    testResult.value = { ok: false, text: t('ai.provider.testFailed', { message }) }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <v-row>
    <v-col cols="12" md="10" xl="8">
      <v-card variant="outlined">
        <v-card-text>
          <div class="text-subtitle-2 mb-2">{{ t('ai.provider.title') }}</div>
          <v-btn-toggle
            :model-value="ai.provider.value"
            mandatory
            color="primary"
            density="comfortable"
            variant="outlined"
            divided
            class="mb-4 flex-wrap h-auto"
            @update:model-value="(p) => guard(() => ai.setProvider(p as AiProvider))"
          >
            <v-btn value="anthropic" data-testid="ai-provider-anthropic">{{ t('ai.provider.anthropic') }}</v-btn>
            <v-btn value="openai" data-testid="ai-provider-openai">{{ t('ai.provider.openai') }}</v-btn>
          </v-btn-toggle>

          <!-- Anthropic -->
          <div v-if="ai.provider.value === 'anthropic'" data-testid="ai-panel-anthropic">
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
                data-testid="ai-key"
                @update:model-value="keySaved = false"
              />
              <v-btn :disabled="!inTauri || !keyInput.trim()" color="primary" @click="saveKey">
                {{ t('common.save') }}
              </v-btn>
              <v-btn :disabled="!inTauri || !ai.hasKey.value" @click="guard(ai.clearKey)">{{ t('ai.key.clear') }}</v-btn>
            </div>
            <div v-if="keySaved" class="text-caption text-success mt-1">{{ t('ai.key.saved') }}</div>
            <div class="text-caption mt-1 mb-4">{{ t('ai.key.hint') }}</div>

            <v-select
              :model-value="ai.model.value"
              :items="models"
              :label="t('ai.model')"
              density="compact"
              hide-details
              data-testid="ai-model"
              @update:model-value="(m) => guard(() => ai.setModel(m as AiModel))"
            />
          </div>

          <!-- OpenAI-compatible -->
          <div v-else data-testid="ai-panel-openai">
            <div class="text-subtitle-2 mb-1">{{ t('ai.provider.preset') }}</div>
            <v-chip-group
              :model-value="ai.openai.value.preset"
              mandatory
              color="primary"
              class="mb-1"
              @update:model-value="(p) => p && pickPreset(p as OpenAiPreset)"
            >
              <v-chip
                v-for="p in PRESETS"
                :key="p.id"
                :value="p.id"
                variant="outlined"
                filter
                :data-testid="`ai-openai-preset-${p.id}`"
              >
                {{ t(p.labelKey) }}
              </v-chip>
            </v-chip-group>
            <div class="text-caption mb-3" data-testid="ai-openai-help">{{ t(activePreset.hintKey) }}</div>

            <v-text-field
              v-model="baseUrlInput"
              :label="t('ai.provider.baseUrl')"
              density="compact"
              autocomplete="off"
              spellcheck="false"
              :error-messages="urlValid || !baseUrlInput ? [] : [t('ai.provider.baseUrlInvalid')]"
              :hint="t('ai.provider.baseUrlHint')"
              persistent-hint
              class="mb-2"
              data-testid="ai-openai-base-url"
              @blur="commitBaseUrl"
              @keydown.enter="commitBaseUrl"
            />

            <div class="d-flex flex-wrap ga-2 align-start mb-2">
              <v-combobox
                v-model="modelInput"
                :items="loadedModels"
                :label="t('ai.provider.model')"
                :hint="t('ai.provider.modelHint')"
                persistent-hint
                density="compact"
                autocomplete="off"
                class="flex-grow-1"
                style="min-width: 240px"
                data-testid="ai-openai-model"
                @update:model-value="commitModel"
                @blur="commitModel(modelInput)"
              />
              <v-btn
                :disabled="!inTauri || !urlValid"
                :loading="loadingModels"
                data-testid="ai-openai-load-models"
                @click="loadModels"
              >
                {{ t('ai.provider.loadModels') }}
              </v-btn>
              <v-btn
                :disabled="!inTauri || !urlValid"
                :loading="testing"
                color="primary"
                variant="tonal"
                data-testid="ai-openai-test"
                @click="runTest"
              >
                {{ t('ai.provider.test') }}
              </v-btn>
            </div>
            <div v-if="modelsNote" class="text-caption mb-1">{{ modelsNote }}</div>
            <v-alert
              v-if="testResult"
              :type="testResult.ok ? 'success' : 'error'"
              variant="tonal"
              density="compact"
              class="mb-3"
              data-testid="ai-openai-test-result"
              :text="testResult.text"
            />
            <div v-if="!inTauri" class="text-caption mb-2">{{ t('ai.provider.desktopOnly') }}</div>
            <div v-if="!ai.openaiConfigured.value" class="text-caption mb-2">{{ t('ai.provider.notReady') }}</div>

            <div class="text-subtitle-2 mb-1 mt-3">{{ t('ai.provider.key.title') }}</div>
            <div class="mb-2">
              <v-chip size="small" :color="ai.hasOpenaiKey.value ? 'success' : undefined" variant="tonal">
                {{ ai.hasOpenaiKey.value ? t('ai.provider.key.stored') : t('ai.provider.key.missing') }}
              </v-chip>
            </div>
            <div class="d-flex flex-wrap ga-2 align-start">
              <v-text-field
                v-model="oaKeyInput"
                type="password"
                autocomplete="off"
                density="compact"
                :label="t('ai.provider.key.label')"
                :disabled="!inTauri"
                hide-details="auto"
                class="flex-grow-1"
                style="min-width: 240px"
                data-testid="ai-openai-key"
                @update:model-value="oaKeySaved = false"
              />
              <v-btn
                :disabled="!inTauri || !oaKeyInput.trim() || !urlValid"
                color="primary"
                data-testid="ai-openai-key-save"
                @click="saveOaKey"
              >
                {{ t('ai.provider.key.save') }}
              </v-btn>
              <v-btn
                :disabled="!inTauri || !ai.hasOpenaiKey.value"
                data-testid="ai-openai-key-clear"
                @click="guard(ai.clearOpenaiKey)"
              >
                {{ t('ai.provider.key.clear') }}
              </v-btn>
            </div>
            <div v-if="oaKeySaved" class="text-caption text-success mt-1">{{ t('ai.provider.key.saved') }}</div>
            <div class="text-caption mt-1">
              {{ origin ? t('ai.provider.key.hint', { origin }) : t('ai.provider.key.hintNoOrigin') }}
            </div>
          </div>

          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3" :text="error" />
          <v-alert type="info" variant="tonal" density="compact" class="mt-4">{{ t('ai.provider.zonesNote') }}</v-alert>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
