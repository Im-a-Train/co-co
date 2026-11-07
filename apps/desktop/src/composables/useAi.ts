/**
 * AI settings state + the shared preview/confirm flow used by the AI buttons.
 * The key itself is never read back: only `hasKey` (boolean) is known to the UI.
 */
import { computed, ref, readonly } from 'vue'
import { getDb } from '@/domain/storage/db'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import type { AiLogEntry, AiModel } from '@/domain/types'
import type { AiPreview } from '@/domain/zones/features'
import { aiAvailable } from '@/domain/zones/availability'
import { commands, isTauri } from '@/lib/tauri'

const enabled = ref(false)
const model = ref<AiModel>('claude-sonnet-5-5')
const hasKey = ref(false)
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
  } catch {
    // no storage (tests / plain browser)
  }
  if (isTauri()) {
    try {
      hasKey.value = await commands.aiHasKey()
    } catch {
      hasKey.value = false
    }
  }
  loaded.value = true
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
    ready: computed(() => aiAvailable(enabled.value, hasKey.value)),
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
