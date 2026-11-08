/**
 * Runs one MCP tool call (ADR 0011): enabled check, argument validation, optional in-app confirmation,
 * handler, zone check. Never throws; every problem becomes an `isError` outcome.
 * Argument values are never logged.
 */
import type { AppSettings } from '../types'
import { McpRefusedError, assertMcpSendable } from '../zones/mcpZone'
import { isToolEnabled, mcpToolByName } from './catalog'
import { MCP_CONFIRM, MCP_HANDLERS } from './handlers'
import { McpToolError, type McpConfirmRequest, type McpContext, type McpToolCallEvent, type McpToolOutcome } from './types'
import { validateArgs } from './validate'

const fail = (text: string): McpToolOutcome => ({ text, isError: true })

/** Default abort text when the signal carries no string reason. */
export const MCP_CALL_ABORTED = 'Abgebrochen: Der Aufruf ist nicht mehr gültig.'

function abortedText(signal: AbortSignal): string {
  return typeof signal.reason === 'string' ? signal.reason : MCP_CALL_ABORTED
}

/**
 * `signal` aborts when the call is no longer wanted (client cancelled, Rust gave up or the deadline is close):
 * the confirmation dialog closes and the handler is never started afterwards.
 */
export async function dispatchToolCall(
  call: McpToolCallEvent,
  ctx: McpContext,
  settings: AppSettings,
  signal?: AbortSignal,
): Promise<McpToolOutcome> {
  try {
    if (signal?.aborted) return fail(abortedText(signal))
    if (!settings.ai.enabled || !settings.mcp.enabled) return fail('MCP ist in co-co deaktiviert.')
    const tool = mcpToolByName(call.name)
    if (!tool || !isToolEnabled(tool, settings.mcp.tools)) return fail(`Dieses Tool ist in co-co deaktiviert: ${call.name}`)

    const args = validateArgs(tool.inputSchema, call.arguments)

    if ((tool.kind === 'write' && settings.mcp.confirmWrites) || (tool.kind === 'read' && settings.mcp.confirmReads)) {
      const builder = MCP_CONFIRM[tool.name]
      const request: McpConfirmRequest = builder
        ? await builder(args, ctx)
        : {
            tool: tool.name,
            kind: tool.kind,
            summary: `${tool.title} (${tool.kind === 'read' ? 'lesen' : 'schreiben'})`,
            details: Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
          }
      if (signal?.aborted) return fail(abortedText(signal))
      const ok = await ctx.confirm(request, signal)
      if (signal?.aborted) return fail(abortedText(signal))
      if (!ok) return fail('Vom Coach in co-co abgelehnt.')
    }

    if (signal?.aborted) return fail(abortedText(signal))
    const value = await MCP_HANDLERS[tool.name](args, ctx)
    const text = JSON.stringify(value ?? null)
    assertMcpSendable(text)
    return { text, isError: false }
  } catch (e) {
    if (e instanceof McpToolError || e instanceof McpRefusedError) return fail(e.message)
    return fail(`Interner Fehler: ${e instanceof Error ? e.message : String(e)}`)
  }
}
