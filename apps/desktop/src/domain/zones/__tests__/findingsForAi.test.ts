import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tauriAi', () => ({ aiComplete: vi.fn() }))
vi.mock('../../storage/settings', () => ({ getAppSettings: async () => ({ ai: { enabled: true, model: 'claude-sonnet-5-5' } }) }))
vi.mock('../../storage/db', () => ({ getDb: () => ({ aiLog: { add: async () => 1 } }) }))

import type { Finding } from '../../types'
import { AiRefusedError, assertSendable } from '../aiGateway'
import { findingsForAi } from '../features'

const base: Finding = {
  id: 'R:1',
  ruleId: 'R',
  ruleVersion: '1',
  packId: 'p',
  severity: 'should',
  confidence: 'verified',
  title: 'T',
  message: 'M',
  scope: 'camp',
  targets: ['x'],
  evidence: [],
  source: null,
  origin: 'rule',
  tags: [],
  override: null,
  explain: {
    packId: 'p',
    packName: 'P',
    packVersion: '1',
    ruleVersion: '1',
    validFrom: null,
    validTo: null,
    evaluatedFor: '2031-07-12',
    evaluatedAt: '2031-01-01T00:00:00.000Z',
    baseSeverity: 'should',
    severityReason: 'rule',
    inputs: [],
    facts: [{ key: 'n', value: 7, red: true }],
  },
}

describe('findingsForAi', () => {
  it('strips explain and drops red-derived findings', () => {
    const out = findingsForAi([base, { ...base, id: 'R:2', tags: ['midata'] }, { ...base, id: 'R:3', tags: ['nds-quelle'] }])
    expect(out.map((f) => f.id)).toEqual(['R:1'])
    expect('explain' in out[0]).toBe(false)
    expect(JSON.stringify(out)).not.toMatch(/evaluatedFor|redKeys|"red"/)
  })

  it('the gateway refuses a payload that still carries explain data', () => {
    const req = {
      feature: 'rephrase',
      campIri: 'c',
      system: { zone: 'green', value: 's' },
      parts: [{ zone: 'green', value: JSON.stringify(base) }],
      redactions: 0,
      confirmed: true,
    } as unknown as Parameters<typeof assertSendable>[0]
    expect(() => assertSendable(req)).toThrow(AiRefusedError)
  })
})
