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

describe('aiGateway red brand (ADR 0008)', () => {
  it('refuses any payload that contains a __red branded object, however deep', async () => {
    const person = { __red: true, firstName: 'Test' }
    await expect(send({ ...req(), parts: [{ zone: 'green', value: 'x', extra: [{ nested: person }] } as never] })).rejects.toThrow(/Rote Daten/)
    await expect(send({ ...req(), extra: person } as never)).rejects.toThrow(/Rote Daten/)
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
