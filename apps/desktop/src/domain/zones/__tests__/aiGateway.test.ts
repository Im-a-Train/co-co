import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ enabled: true, logs: [] as unknown[] }))
const complete = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tauriAi', () => ({ aiComplete: complete }))
vi.mock('../../storage/settings', () => ({
  getAppSettings: async () => ({ ai: { enabled: state.enabled, model: 'claude-sonnet-5-5' } }),
}))
vi.mock('../../storage/db', () => ({ getDb: () => ({ aiLog: { add: async (e: unknown) => state.logs.push(e) } }) }))

import { send, type AiGatewayRequest } from '../aiGateway'

function req(over: Partial<AiGatewayRequest> = {}): AiGatewayRequest {
  return {
    feature: 'rephrase',
    campIri: '/api/camps/1',
    system: { zone: 'green', value: 'sys' },
    parts: [{ zone: 'yellow', value: 'Text', redacted: true }],
    maxTokens: 500,
    redactions: 2,
    confirmed: true,
    ...over,
  }
}

beforeEach(() => {
  state.enabled = true
  state.logs = []
  complete.mockReset()
  complete.mockResolvedValue({ text: 'ok', inputTokens: 10, outputTokens: 5 })
})

describe('aiGateway.send', () => {
  it('sends a valid request and logs metadata only', async () => {
    const res = await send(req({ maxTokens: 99999 }))
    expect(res.text).toBe('ok')
    expect(complete).toHaveBeenCalledWith({ model: 'claude-sonnet-5-5', system: 'sys', prompt: 'Text', maxTokens: 4096 })
    expect(state.logs).toHaveLength(1)
    expect(JSON.stringify(state.logs[0])).not.toContain('Text')
    expect(state.logs[0]).toMatchObject({ ok: true, inputTokens: 10, redactions: 2 })
  })

  it('refuses when disabled', async () => {
    state.enabled = false
    await expect(send(req())).rejects.toThrow(/deaktiviert/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('refuses red parts', async () => {
    await expect(send(req({ parts: [{ zone: 'red', value: 'x' }] }))).rejects.toThrow(/Rote/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('refuses unredacted yellow', async () => {
    await expect(send(req({ parts: [{ zone: 'yellow', value: 'x' }] }))).rejects.toThrow(/anonymisiert/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('refuses unconfirmed and oversized requests', async () => {
    await expect(send(req({ confirmed: false }))).rejects.toThrow(/bestätigt/)
    await expect(send(req({ parts: [{ zone: 'green', value: 'a'.repeat(30000) }] }))).rejects.toThrow(/zu lang/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('logs failures and rethrows', async () => {
    complete.mockRejectedValue(new Error('Kein API-Schlüssel hinterlegt'))
    await expect(send(req())).rejects.toThrow(/Schlüssel/)
    expect(state.logs[0]).toMatchObject({ ok: false })
  })
})
