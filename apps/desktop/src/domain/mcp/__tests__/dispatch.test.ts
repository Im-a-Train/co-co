import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@/domain/types'
import { MCP_CALL_ABORTED, dispatchToolCall } from '../dispatch'
import type { McpToolCallEvent } from '../types'
import { EMAIL, NAME, makeFakeContext, makeFeedback, makeFinding } from './fakeContext'

function settings(mcp: Partial<AppSettings['mcp']> = {}, aiEnabled = true): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    ai: { ...DEFAULT_APP_SETTINGS.ai, enabled: aiEnabled },
    mcp: { ...DEFAULT_APP_SETTINGS.mcp, enabled: true, ...mcp },
  }
}

function call(name: string, args: unknown = {}): McpToolCallEvent {
  return { callId: 'c', name, kind: 'read', arguments: args }
}

describe('dispatchToolCall', () => {
  it('refuses when MCP or AI is disabled', async () => {
    const { ctx } = makeFakeContext()
    expect(await dispatchToolCall(call('list_camps'), ctx, settings({ enabled: false }))).toEqual({ text: 'MCP ist in co-co deaktiviert.', isError: true })
    expect((await dispatchToolCall(call('list_camps'), ctx, settings({}, false))).isError).toBe(true)
    expect(ctx.listCamps).not.toHaveBeenCalled()
  })

  it('refuses disabled and unknown tools', async () => {
    const { ctx } = makeFakeContext()
    const off = await dispatchToolCall(call('list_camps'), ctx, settings({ tools: { list_camps: false } }))
    expect(off).toEqual({ text: 'Dieses Tool ist in co-co deaktiviert: list_camps', isError: true })
    const write = await dispatchToolCall(call('add_feedback', { campId: 'c1', kind: 'kudos', text: 'x' }), ctx, settings())
    expect(write.isError).toBe(true)
    expect(write.text).toContain('deaktiviert')
    const unknown = await dispatchToolCall(call('nope'), ctx, settings())
    expect(unknown.text).toContain('nope')
    expect(ctx.saveFeedback).not.toHaveBeenCalled()
  })

  it('validates arguments', async () => {
    const { ctx } = makeFakeContext()
    const r = await dispatchToolCall(call('list_feedback', {}), ctx, settings())
    expect(r.isError).toBe(true)
    expect(r.text).toContain('campId')
    expect((await dispatchToolCall(call('list_feedback', { campId: 'c1', extra: 1 }), ctx, settings())).text).toContain('extra')
    expect((await dispatchToolCall(call('list_feedback', 'x'), ctx, settings())).isError).toBe(true)
  })

  it('returns serialized JSON on success without asking for read confirmation', async () => {
    const { ctx } = makeFakeContext()
    const r = await dispatchToolCall(call('list_camps'), ctx, settings())
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.text)[0].id).toBe('c1')
    expect(ctx.confirm).not.toHaveBeenCalled()
  })

  it('asks for read confirmation with confirmReads and honours a denial', async () => {
    const { ctx, state } = makeFakeContext()
    state.confirmAnswer = false
    const denied = await dispatchToolCall(call('list_camps'), ctx, settings({ confirmReads: true }))
    expect(denied).toEqual({ text: 'Vom Coach in co-co abgelehnt.', isError: true })
    expect(ctx.listCamps).not.toHaveBeenCalled()
    expect(ctx.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'list_camps', kind: 'read', summary: 'List camps (lesen)' }),
      undefined,
    )
    state.confirmAnswer = true
    expect((await dispatchToolCall(call('list_camps'), ctx, settings({ confirmReads: true }))).isError).toBe(false)
  })

  it('confirms write tools and runs them only after approval', async () => {
    const { ctx, state } = makeFakeContext()
    const s = settings({ tools: { add_feedback: true } })
    const args = { campId: 'c1', kind: 'kudos', text: 'Danke Leiter A' }
    state.confirmAnswer = false
    const denied = await dispatchToolCall({ ...call('add_feedback', args), kind: 'write' }, ctx, s)
    expect(denied.isError).toBe(true)
    expect(ctx.saveFeedback).not.toHaveBeenCalled()
    state.confirmAnswer = true
    const ok = await dispatchToolCall({ ...call('add_feedback', args), kind: 'write' }, ctx, s)
    expect(ok).toEqual({ text: JSON.stringify({ id: 'new-1', status: 'draft' }), isError: false })
    expect(ctx.confirm).toHaveBeenCalledTimes(2)
  })

  it('never runs a call whose signal is already aborted', async () => {
    const { ctx } = makeFakeContext()
    const ac = new AbortController()
    ac.abort('Vom MCP-Client abgebrochen.')
    const r = await dispatchToolCall(call('list_camps'), ctx, settings(), ac.signal)
    expect(r).toEqual({ text: 'Vom MCP-Client abgebrochen.', isError: true })
    expect(ctx.listCamps).not.toHaveBeenCalled()
  })

  it('does not run a write that was cancelled while the dialog was open, even when approved', async () => {
    const { ctx } = makeFakeContext()
    const ac = new AbortController()
    ;(ctx.confirm as ReturnType<typeof vi.fn>).mockImplementation(async (_req: unknown, signal?: AbortSignal) => {
      expect(signal).toBe(ac.signal)
      ac.abort()
      return true // a late «Erlauben»
    })
    const args = { campId: 'c1', kind: 'kudos', text: 'Danke' }
    const r = await dispatchToolCall({ ...call('add_feedback', args), kind: 'write' }, ctx, settings({ tools: { add_feedback: true } }), ac.signal)
    expect(r).toEqual({ text: MCP_CALL_ABORTED, isError: true })
    expect(ctx.saveFeedback).not.toHaveBeenCalled()
  })

  it('skips the write confirmation when confirmWrites is off', async () => {
    const { ctx } = makeFakeContext({ feedback: [makeFeedback()] })
    const r = await dispatchToolCall(
      call('update_feedback', { feedbackId: 'f1', text: 'Neu' }),
      ctx,
      settings({ tools: { update_feedback: true }, confirmWrites: false }),
    )
    expect(r.isError).toBe(false)
    expect(ctx.confirm).not.toHaveBeenCalled()
  })

  it('turns a red marker in the result into an error', async () => {
    const { ctx } = makeFakeContext({ findings: [makeFinding({ message: 'Fehlt (Quelle: MiData, Stand 01.06.2026)' })] })
    const r = await dispatchToolCall(call('list_findings', { campId: 'c1' }), ctx, settings())
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Rote Daten')
    expect(r.text).not.toContain('Fehlt')
  })

  it('turns PII that slipped through into an error', async () => {
    const { ctx } = makeFakeContext()
    ;(ctx.listCamps as ReturnType<typeof vi.fn>).mockResolvedValue([
      { iri: '/api/camps/c1', id: 'c1', title: `Lager von ${EMAIL}`, shortTitle: null, motto: null, start: null, end: null, role: null, isPrototype: false },
    ])
    const r = await dispatchToolCall(call('list_camps'), ctx, settings())
    expect(r.isError).toBe(true)
    expect(r.text).not.toContain(EMAIL)
    expect(r.text).not.toContain(NAME)
  })

  it('turns handler exceptions into errors', async () => {
    const { ctx } = makeFakeContext()
    ;(ctx.listCamps as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    expect(await dispatchToolCall(call('list_camps'), ctx, settings())).toEqual({ text: 'Interner Fehler: boom', isError: true })
  })

  it('passes McpToolError messages through', async () => {
    const { ctx } = makeFakeContext()
    const r = await dispatchToolCall(call('list_feedback', { campId: '../x' }), ctx, settings())
    expect(r).toEqual({ text: 'Ungültige Lager-ID', isError: true })
  })
})
