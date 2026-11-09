/**
 * In-app confirmation queue for MCP tool calls (ADR 0012). The bridge (mcpBridge.ts) calls requestConfirm();
 * components/mcp/McpConfirmDialog.vue (mounted once in App.vue) shows `current` and answers with resolveCurrent().
 * One dialog at a time; further requests wait in FIFO order.
 *
 * A request resolves false when it is not answered within CONFIRM_TIMEOUT_MS or when its AbortSignal fires.
 * The bridge aborts the signal when the call is cancelled by the client / Rust (`mcp://tool-cancel`) or shortly
 * before the call's deadline, so a dialog never outlives the Rust call and a late «Erlauben» runs nothing.
 */
import { computed, shallowRef } from 'vue'
import type { McpConfirmRequest } from '@/domain/mcp/types'

/** Fallback only; the per-call deadline (Rust: 55 s) normally closes the dialog first. */
export const CONFIRM_TIMEOUT_MS = 55_000

interface Pending {
  request: McpConfirmRequest
  resolve: (ok: boolean) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

const queue = shallowRef<Pending[]>([])

/** The request currently shown (null = dialog closed). */
export const currentConfirm = computed<McpConfirmRequest | null>(() => queue.value[0]?.request ?? null)
/** Number of waiting requests including the current one. */
export const pendingConfirmCount = computed(() => queue.value.length)

function settle(entry: Pending, ok: boolean): void {
  if (!queue.value.includes(entry)) return
  clearTimeout(entry.timer)
  entry.cleanup()
  queue.value = queue.value.filter((p) => p !== entry)
  entry.resolve(ok)
}

export function requestConfirm(request: McpConfirmRequest, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const onAbort = () => settle(entry, false)
    const entry: Pending = {
      request,
      resolve,
      timer: setTimeout(() => settle(entry, false), CONFIRM_TIMEOUT_MS),
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    queue.value = [...queue.value, entry]
  })
}

/** Answer for the request currently shown. */
export function resolveCurrent(ok: boolean): void {
  const entry = queue.value[0]
  if (entry) settle(entry, ok)
}
