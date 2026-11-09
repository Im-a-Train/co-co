import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tauriAi', () => ({ aiComplete: vi.fn() }))

import { FactsBuilder } from '@/domain/rules/__tests__/factory'
import { MAX_MCP_RESULT_CHARS, McpRefusedError, assertMcpSendable, maskTechnicalIds, redactorForFacts } from '../mcpZone'
import { containsPii } from '../redact'

describe('assertMcpSendable', () => {
  it('accepts plain JSON', () => {
    expect(() => assertMcpSendable(JSON.stringify({ title: 'Wanderung', by: 'Leiter A' }))).not.toThrow()
  })
  it('refuses red-derived markers', () => {
    for (const s of ['{"zone":"red-derived"}', 'Fehlt (Quelle: MiData, Stand 1.1.)', 'AWK (Quelle: NDS)', '{"offerBusinessId":"1"}', '{"redKeys":[]}']) {
      expect(() => assertMcpSendable(s)).toThrow(McpRefusedError)
    }
  })
  it('refuses PII patterns', () => {
    expect(() => assertMcpSendable('mail a.b@example.com')).toThrow(McpRefusedError)
    expect(() => assertMcpSendable('AHV 756.1234.5678.97')).toThrow(McpRefusedError)
    expect(() => assertMcpSendable('Tel 079 123 45 67')).toThrow(McpRefusedError)
    expect(() => assertMcpSendable('{"tel":"0791234567"}')).toThrow(McpRefusedError)
    expect(() => assertMcpSendable('{"tel":"+41 79 123 45 67","id":"3f2a9c1e-0123-4567-89ab-cdef01234567"}')).toThrow(McpRefusedError)
  })
  it('does not mistake technical ids for phone numbers', () => {
    // «0123-4567-89» inside this UUID matches the phone regex on its own.
    const uuid = '3f2a9c1e-0123-4567-89ab-cdef01234567'
    expect(containsPii(uuid)).toBe(true)
    expect(maskTechnicalIds(uuid)).toBe('ID')
    expect(() => assertMcpSendable(JSON.stringify({ id: uuid, status: 'draft' }))).not.toThrow()
    expect(() => assertMcpSendable('{"activity":"/api/activities/a0791234567b"}')).not.toThrow()
  })
  it('refuses pathological unbroken tokens quickly', () => {
    expect(() => assertMcpSendable('a'.repeat(5000))).toThrow(/Zeichenfolge/)
  })
  it('refuses oversized results', () => {
    expect(() => assertMcpSendable('ab '.repeat(MAX_MCP_RESULT_CHARS / 3))).not.toThrow()
    expect(() => assertMcpSendable('ab '.repeat(MAX_MCP_RESULT_CHARS / 3 + 1))).toThrow(/gross/)
  })
})

describe('redactorForFacts', () => {
  it('pseudonymises collaborators of the camp', () => {
    const b = new FactsBuilder()
    b.facts.collaborators.push({
      iri: '/api/camp_collaborations/cc1', userIri: null, role: 'member', status: 'established', displayName: 'Anna Beispiel',
      nickname: 'Anna', firstname: 'Anna', surname: 'Beispiel', abbreviation: null, isCurrentUser: false,
    })
    expect(redactorForFacts(b.facts).redact('Treffen mit Anna').text).toBe('Treffen mit Leiter A')
  })
})
