import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  enabled: true,
  logs: [] as unknown[],
  provider: undefined as string | undefined,
  openai: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1:8b', preset: 'ollama' } as Record<string, string> | undefined,
}))
const complete = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tauriAi', () => ({ aiComplete: complete }))
vi.mock('../../storage/settings', () => ({
  getAppSettings: async () => ({
    ai: { enabled: state.enabled, model: 'claude-sonnet-5-5', provider: state.provider, openai: state.openai },
  }),
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
  state.provider = undefined
  state.openai = { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1:8b', preset: 'ollama' }
  state.logs = []
  complete.mockReset()
  complete.mockResolvedValue({ text: 'ok', inputTokens: 10, outputTokens: 5 })
})

describe('aiGateway red-derived marker', () => {
  it('refuses any part containing a serialized MiData aggregate, whatever its zone', async () => {
    const json = JSON.stringify({ zone: 'red-derived', eventId: '1' })
    for (const zone of ['green', 'yellow'] as const) {
      await expect(send(req({ parts: [{ zone, value: `Daten: ${json}`, redacted: true }] }))).rejects.toThrow(/Rote Daten/)
    }
    await expect(send(req({ parts: [{ zone: 'green', value: '{ "zone" : "red-derived" }' }] }))).rejects.toThrow(/Rote Daten/)
    expect(complete).not.toHaveBeenCalled()
  })
  it('refuses sentences quoting MiData as source', async () => {
    const value = 'Keine SLRG-Qualifikation (Quelle: MiData, Stand 01.06.2026)'
    await expect(send(req({ parts: [{ zone: 'yellow', value, redacted: true }] }))).rejects.toThrow(/Rote Daten/)
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('aiGateway NDS marker', () => {
  it('refuses sentences quoting NDS as source and serialized NDS aggregates', async () => {
    const value = 'AWK offen (Quelle: NDS, Stand 01.06.2026)'
    await expect(send(req({ parts: [{ zone: 'yellow', value, redacted: true }] }))).rejects.toThrow(/Rote Daten/)
    const json = JSON.stringify({ offerBusinessId: 'o1', campBusinessId: 'c1' })
    await expect(send(req({ parts: [{ zone: 'green', value: json }] }))).rejects.toThrow(/Rote Daten/)
    expect(complete).not.toHaveBeenCalled()
  })
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

describe('aiGateway OpenAI-compatible provider', () => {
  beforeEach(() => {
    state.provider = 'openai'
  })

  it('passes provider, baseUrl and the configured model, ignoring the request model', async () => {
    const res = await send(req({ model: 'claude-opus-5-5' }))
    expect(complete).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1:8b',
      system: 'sys',
      prompt: 'Text',
      maxTokens: 500,
    })
    expect(res.model).toBe('llama3.1:8b')
    expect(state.logs[0]).toMatchObject({ ok: true, provider: 'openai', model: 'llama3.1:8b' })
  })

  it('refuses without model or base URL', async () => {
    state.openai = { baseUrl: 'http://localhost:11434/v1', model: '  ', preset: 'ollama' }
    await expect(send(req())).rejects.toThrow(/kein Modell/)
    state.openai = { baseUrl: '', model: 'x', preset: 'custom' }
    await expect(send(req())).rejects.toThrow(/Basis-URL/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('still applies the zone rules', async () => {
    await expect(send(req({ parts: [{ zone: 'red', value: 'x' }] }))).rejects.toThrow(/Rote/)
    await expect(send(req({ parts: [{ zone: 'yellow', value: 'Max' }] }))).rejects.toThrow(/anonymisiert/)
    await expect(send(req({ confirmed: false }))).rejects.toThrow(/Vorschau/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('logs provider anthropic by default', async () => {
    state.provider = undefined
    await send(req())
    expect(state.logs[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
  })
})
