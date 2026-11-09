/**
 * AI settings state + the shared preview/confirm flow used by the AI buttons.
 * The key itself is never read back: only `hasKey` (boolean) is known to the UI.
 */
import { computed, ref, readonly } from 'vue'
import { getDb } from '@/domain/storage/db'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import { DEFAULT_APP_SETTINGS, OPENAI_PRESET_URLS } from '@/domain/types'
import type { AiLogEntry, AiModel, AiProvider, OpenAiPreset, OpenAiSettings } from '@/domain/types'
import { isAllowedBaseUrl } from '@/components/settings/aiProvider'
import type { AiPreview } from '@/domain/zones/features'
import { aiAvailable } from '@/domain/zones/availability'
import { commands, isTauri } from '@/lib/tauri'

const enabled = ref(false)
const model = ref<AiModel>('claude-sonnet-5-5')
const hasKey = ref(false)
const provider = ref<AiProvider>('anthropic')
const openai = ref<OpenAiSettings>({ ...DEFAULT_APP_SETTINGS.ai.openai })
const hasOpenaiKey = ref(false)
const loaded = ref(false)
const log = ref<AiLogEntry[]>([])

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function load(): Promise<void> {
  try {
    const s = await getAppSettings()
    enabled.value = s.ai.enabled
    model.value = s.ai.model
    provider.value = s.ai.provider ?? DEFAULT_APP_SETTINGS.ai.provider
    openai.value = { ...DEFAULT_APP_SETTINGS.ai.openai, ...(s.ai.openai ?? {}) }
  } catch {
    // no storage (tests / plain browser)
  }
  if (isTauri()) {
    try {
      hasKey.value = await commands.aiHasKey()
    } catch {
      hasKey.value = false
    }
    await refreshOpenaiKey()
  }
  loaded.value = true
}

async function refreshOpenaiKey(): Promise<void> {
  if (!isTauri()) return
  try {
    hasOpenaiKey.value = await commands.aiOpenaiHasKey(openai.value.baseUrl)
  } catch {
    hasOpenaiKey.value = false
  }
}

const openaiConfigured = computed(() => isAllowedBaseUrl(openai.value.baseUrl) && openai.value.model.trim() !== '')

async function setOpenai(patch: Partial<OpenAiSettings>): Promise<void> {
  const next = { ...openai.value, ...patch }
  await updateAppSettings({ ai: { openai: next } })
  const urlChanged = next.baseUrl !== openai.value.baseUrl
  openai.value = next
  if (urlChanged) {
    hasOpenaiKey.value = false
    await refreshOpenaiKey()
  }
}

async function applyPreset(preset: OpenAiPreset): Promise<void> {
  const cur = openai.value
  if (preset === 'custom') return setOpenai({ preset })
  return setOpenai({
    preset,
    baseUrl: OPENAI_PRESET_URLS[preset],
    model: preset === cur.preset ? cur.model : '',
  })
}

async function loadLog(limit = 20): Promise<void> {
  try {
    log.value = (await getDb().aiLog.orderBy('at').reverse().limit(limit).toArray()) as AiLogEntry[]
  } catch {
    log.value = []
  }
}

export function useAi() {
  if (!loaded.value) void load()
  return {
    enabled: readonly(enabled),
    model: readonly(model),
    hasKey: readonly(hasKey),
    /** AI buttons are shown/enabled only when AI is enabled AND an API key is stored. */
    provider: readonly(provider),
    openai: readonly(openai),
    hasOpenaiKey: readonly(hasOpenaiKey),
    openaiConfigured,
    ready: computed(() =>
      aiAvailable(enabled.value, provider.value === 'anthropic' ? hasKey.value : openaiConfigured.value),
    ),
    setOpenai,
    applyPreset,
    async setProvider(p: AiProvider) {
      await updateAppSettings({ ai: { provider: p } })
      provider.value = p
    },
    async loadModels(): Promise<string[]> {
      return commands.aiOpenaiModels(openai.value.baseUrl)
    },
    async saveOpenaiKey(key: string) {
      await commands.aiOpenaiSetKey(openai.value.baseUrl, key.trim())
      hasOpenaiKey.value = true
    },
    async clearOpenaiKey() {
      await commands.aiOpenaiClearKey()
      hasOpenaiKey.value = false
    },
    log: readonly(log),
    reload: load,
    loadLog,
    async setEnabled(v: boolean) {
      await updateAppSettings({ ai: { enabled: v } })
      enabled.value = v
    },
    async setModel(m: AiModel) {
      await updateAppSettings({ ai: { model: m } })
      model.value = m
    },
    async saveKey(key: string) {
      await commands.aiSetKey(key.trim())
      hasKey.value = true
    },
    async clearKey() {
      await commands.aiClearKey()
      hasKey.value = false
    },
  }
}

/** Shared flow: build preview -> show dialog -> confirm -> run. */
export function useAiFlow<T>() {
  const open = ref(false)
  const preview = ref<AiPreview | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)
  let runner: ((p: AiPreview) => Promise<T>) | null = null
  let done: ((r: T) => void) | null = null

  return {
    open,
    preview,
    busy,
    error,
    start(build: () => AiPreview, run: (p: AiPreview) => Promise<T>, onDone: (r: T) => void) {
      error.value = null
      try {
        preview.value = build()
      } catch (e) {
        error.value = msg(e)
        return
      }
      runner = run
      done = onDone
      open.value = true
    },
    async confirm() {
      if (!preview.value || !runner) return
      busy.value = true
      error.value = null
      try {
        const r = await runner(preview.value)
        open.value = false
        done?.(r)
      } catch (e) {
        error.value = msg(e)
      } finally {
        busy.value = false
      }
    },
    cancel() {
      open.value = false
      error.value = null
    },
  }
}
