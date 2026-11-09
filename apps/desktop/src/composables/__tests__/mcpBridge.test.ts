/** MCP bridge: calls end with Rust (deadline / mcp://tool-cancel) and never run late; confirm queue aborts. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mcpToolResult = vi.fn(async () => {})
vi.mock('@/lib/tauri', () => ({
  commands: { mcpToolResult: (...a: unknown[]) => mcpToolResult(...(a as [])) },
  onMcpToolCall: vi.fn(async () => () => {}),
  onMcpToolCancel: vi.fn(async () => () => {}),
  isTauri: () => false,
}))
vi.mock('@/domain/storage/settings', () => ({ getAppSettings: async () => ({ rulePacks: [] }) }))
const dispatchToolCall = vi.fn()
vi.mock('@/domain/mcp/dispatch', () => ({ dispatchToolCall: (...a: unknown[]) => dispatchToolCall(...a) }))

import {
  MCP_CANCELLED_TEXT,
  MCP_DEADLINE_MARGIN_MS,
  MCP_TIMEOUT_TEXT,
  abortDelayMs,
  cancelMcpToolCall,
  handleMcpToolCall,
} from '../mcpBridge'
import { currentConfirm, pendingConfirmCount, requestConfirm, resolveCurrent } from '../mcpConfirm'
import type { McpConfirmRequest, McpContext, McpToolCallEvent } from '@/domain/mcp/types'

const ctx = {} as McpContext

/** dispatch stub that resolves with the abort reason once the signal aborts. */
function waitForAbort() {
  dispatchToolCall.mockImplementation(
    (_call: unknown, _ctx: unknown, _s: unknown, signal: AbortSignal) =>
      new Promise((resolve) => {
        const done = () => resolve({ text: String(signal.reason), isError: true })
        if (signal.aborted) done()
        else signal.addEventListener('abort', done)
      }),
  )
}

function call(over: Partial<McpToolCallEvent> = {}): McpToolCallEvent {
  return { callId: 'c1', name: 'add_feedback', kind: 'write', arguments: {}, ...over }
}

afterEach(() => {
  vi.useRealTimers()
  dispatchToolCall.mockReset()
  mcpToolResult.mockClear()
})

describe('abortDelayMs', () => {
  it('aborts the margin before the Rust deadline, never negative', () => {
    expect(abortDelayMs(100_000, 40_000)).toBe(60_000 - MCP_DEADLINE_MARGIN_MS)
    expect(abortDelayMs(1_000, 40_000)).toBe(0)
    expect(abortDelayMs(undefined, 0)).toBeNull()
    expect(abortDelayMs(Number.NaN, 0)).toBeNull()
  })
})

describe('handleMcpToolCall', () => {
  it('aborts at the deadline and answers Rust with a timeout', async () => {
    vi.useFakeTimers()
    waitForAbort()
    const p = handleMcpToolCall(call({ deadlineMs: Date.now() + MCP_DEADLINE_MARGIN_MS + 1_000 }), ctx)
    await vi.advanceTimersByTimeAsync(999)
    expect(mcpToolResult).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(await p).toEqual({ text: MCP_TIMEOUT_TEXT, isError: true })
    expect(mcpToolResult).toHaveBeenCalledWith('c1', { text: MCP_TIMEOUT_TEXT, isError: true })
  })

  it('aborts on mcp://tool-cancel', async () => {
    waitForAbort()
    const p = handleMcpToolCall(call({ callId: 'c7', deadlineMs: Date.now() + 60_000 }), ctx)
    cancelMcpToolCall('c7')
    expect(await p).toEqual({ text: MCP_CANCELLED_TEXT, isError: true })
    cancelMcpToolCall('unknown') // ignored
  })

  it('passes a live signal and answers once on success', async () => {
    dispatchToolCall.mockImplementation(async (_c: unknown, _x: unknown, _s: unknown, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false)
      return { text: '[]', isError: false }
    })
    expect(await handleMcpToolCall(call({ deadlineMs: Date.now() + 60_000 }), ctx)).toEqual({ text: '[]', isError: false })
    expect(mcpToolResult).toHaveBeenCalledTimes(1)
  })
})

describe('requestConfirm', () => {
  const req: McpConfirmRequest = { tool: 'add_feedback', kind: 'write', summary: 's', details: [] }

  it('closes the dialog and resolves false when the signal aborts', async () => {
    const ac = new AbortController()
    const p = requestConfirm(req, ac.signal)
    expect(currentConfirm.value).toEqual(req)
    ac.abort()
    expect(await p).toBe(false)
    expect(pendingConfirmCount.value).toBe(0)
    resolveCurrent(true) // nothing left to approve
  })

  it('resolves false at once for an already aborted signal', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(await requestConfirm(req, ac.signal)).toBe(false)
    expect(pendingConfirmCount.value).toBe(0)
  })

  it('still resolves with the coach answer', async () => {
    const p = requestConfirm(req, new AbortController().signal)
    resolveCurrent(true)
    expect(await p).toBe(true)
  })
})
