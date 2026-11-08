/**
 * MCP server state for Settings > KI (ADR 0011): settings (AppSettings.mcp), server status, token, tool switches.
 *
 * CONTRACT (architect). Implementation: UI-MCP package. Module-level singleton state like useAi.ts.
 * - init(): called once from App.vue onMounted (Tauri only). Loads settings + mcp_status, subscribes to
 *   onMcpStatus, pushes mcpToolRegistrations(settings.mcp.tools) via mcp_set_tools and starts the server when
 *   settings.ai.enabled && settings.mcp.enabled. Watches useAi().enabled: when AI is switched off, stops the server.
 * - Every tool switch / setting change persists via updateAppSettings({ mcp: … }) and re-pushes the registrations.
 * - The token is only loaded on demand (loadToken / reveal), never logged.
 */
import { computed, readonly, ref, watch, type ComputedRef, type DeepReadonly, type Ref } from 'vue'
import { DEFAULT_APP_SETTINGS, type McpSettings } from '@/domain/types'
import type { McpStatus } from '@/domain/mcp/types'
import { mcpToolRegistrations } from '@/domain/mcp/catalog'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import { commands, isTauri, onMcpStatus } from '@/lib/tauri'
import { useAi } from '@/composables/useAi'

export interface McpHandle {
  settings: DeepReadonly<Ref<McpSettings>>
  status: DeepReadonly<Ref<McpStatus | null>>
  /** Token once loaded (null until loadToken()). Shown masked by default in the UI. */
  token: DeepReadonly<Ref<string | null>>
  /** Last error of an action (German). */
  error: DeepReadonly<Ref<string | null>>
  busy: DeepReadonly<Ref<boolean>>
  /** ai.enabled && mcp.enabled (the server may still have failed to start, see status.error). */
  active: ComputedRef<boolean>
  /** Effective URL for the guide: status.url, else http://127.0.0.1:<settings.port>/mcp. */
  url: ComputedRef<string>
  init(): Promise<void>
  /** Persists mcp.enabled and starts/stops the server. Enabling requires AI to be enabled (throws a German error otherwise). */
  setEnabled(on: boolean): Promise<void>
  /** Validates 1024-65535, persists, restarts the server when running. */
  setPort(port: number): Promise<void>
  setToolEnabled(name: string, on: boolean): Promise<void>
  setConfirmWrites(on: boolean): Promise<void>
  setConfirmReads(on: boolean): Promise<void>
  loadToken(): Promise<string>
  regenerateToken(): Promise<string>
  refreshStatus(): Promise<void>
  /** Re-reads the settings (e.g. after a backup import) and starts/stops the server accordingly. Never throws. */
  reload(): Promise<void>
}

const settings = ref<McpSettings>({ ...DEFAULT_APP_SETTINGS.mcp })
const status = ref<McpStatus | null>(null)
const token = ref<string | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

let initialized = false

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function persist(patch: Partial<McpSettings>): Promise<void> {
  const next = { ...settings.value, ...patch }
  await updateAppSettings({ mcp: next })
  settings.value = next
}

async function pushTools(): Promise<void> {
  await commands.mcpSetTools(mcpToolRegistrations(settings.value.tools))
}

async function start(): Promise<void> {
  try {
    status.value = await commands.mcpStart(settings.value.port)
    error.value = status.value.error
  } catch (e) {
    error.value = msg(e)
  }
}

async function stop(): Promise<void> {
  try {
    status.value = await commands.mcpStop()
  } catch (e) {
    error.value = msg(e)
  }
}

/** Runs an action with the busy flag; errors go into `error` and are re-thrown. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  busy.value = true
  error.value = null
  try {
    return await fn()
  } catch (e) {
    error.value = msg(e)
    throw e
  } finally {
    busy.value = false
  }
}

/**
 * Re-reads the stored settings and brings the Rust server in line: pushes the tool switches, starts it when
 * AI + MCP are enabled and STOPS it otherwise. The Rust server outlives a webview reload, so after e.g. a
 * backup import (which switches AI and MCP off) a server from before the reload must be stopped here.
 */
async function syncWithSettings(): Promise<void> {
  const s = await getAppSettings()
  settings.value = { ...s.mcp }
  if (!isTauri()) return
  status.value = await commands.mcpStatus()
  await pushTools()
  if (s.ai.enabled && s.mcp.enabled) await start()
  else if (status.value?.running) await stop()
}

async function init(): Promise<void> {
  if (initialized || !isTauri()) return
  initialized = true
  try {
    await onMcpStatus((st) => {
      status.value = st
    })
    await syncWithSettings()
    watch(useAi().enabled, (on) => {
      if (!on) void stop()
      else if (settings.value.enabled && !status.value?.running) void start()
    })
  } catch (e) {
    error.value = msg(e)
  }
}

export function useMcp(): McpHandle {
  const aiEnabled = useAi().enabled
  return {
    settings: readonly(settings),
    status: readonly(status),
    token: readonly(token),
    error: readonly(error),
    busy: readonly(busy),
    active: computed(() => aiEnabled.value && settings.value.enabled),
    url: computed(() => status.value?.url ?? `http://127.0.0.1:${settings.value.port}/mcp`),
    init,
    setEnabled: (on) =>
      run(async () => {
        if (on && !aiEnabled.value) throw new Error('KI-Funktionen sind deaktiviert.')
        await persist({ enabled: on })
        if (on) {
          await pushTools()
          await start()
        } else await stop()
      }),
    setPort: (port) =>
      run(async () => {
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          throw new Error('Der Port muss eine ganze Zahl zwischen 1024 und 65535 sein.')
        }
        await persist({ port })
        if (status.value?.running) await start()
      }),
    setToolEnabled: (name, on) =>
      run(async () => {
        await persist({ tools: { ...settings.value.tools, [name]: on } })
        if (isTauri()) await pushTools()
      }),
    setConfirmWrites: (on) => run(() => persist({ confirmWrites: on })),
    setConfirmReads: (on) => run(() => persist({ confirmReads: on })),
    loadToken: () =>
      run(async () => {
        if (token.value === null) token.value = await commands.mcpGetToken()
        return token.value
      }),
    regenerateToken: () =>
      run(async () => {
        token.value = await commands.mcpRegenerateToken()
        return token.value
      }),
    reload: async () => {
      try {
        await syncWithSettings()
      } catch (e) {
        error.value = msg(e)
      }
    },
    refreshStatus: async () => {
      if (!isTauri()) return
      try {
        status.value = await commands.mcpStatus()
      } catch (e) {
        error.value = msg(e)
      }
    },
  }
}
