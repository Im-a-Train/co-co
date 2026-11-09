import { describe, expect, it } from 'vitest'
import { normalizeActivityIri, normalizeCampIri } from '../ids'
import { isRedFeedback, stripRedDerivedInputs } from '../sanitize'
import { McpToolError, type JsonSchema } from '../types'
import { validateArgs } from '../validate'
import { emptyCoachInputs } from '@/domain/campFacts/store'

const schema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 2, maxLength: 5 },
    n: { type: 'integer', minimum: 1, maximum: 10 },
    f: { type: 'number' },
    b: { type: 'boolean' },
    kind: { type: 'string', enum: ['a', 'b'] },
  },
  required: ['id'],
  additionalProperties: false,
}

describe('validateArgs', () => {
  it('accepts valid arguments and treats null/undefined as empty', () => {
    expect(validateArgs(schema, { id: 'abc', n: 3, f: 1.5, b: true, kind: 'a' })).toEqual({ id: 'abc', n: 3, f: 1.5, b: true, kind: 'a' })
    expect(validateArgs({ type: 'object', properties: {} }, null)).toEqual({})
    expect(validateArgs({ type: 'object', properties: {} }, undefined)).toEqual({})
  })
  it('drops null values for optional arguments', () => {
    expect(validateArgs(schema, { id: 'abc', n: null })).toEqual({ id: 'abc' })
  })
  it.each([
    [{}, 'id'],
    [{ id: 1 }, 'id'],
    [{ id: 'a' }, 'id'],
    [{ id: 'abcdef' }, 'id'],
    [{ id: 'abc', n: 1.5 }, 'n'],
    [{ id: 'abc', n: 0 }, 'n'],
    [{ id: 'abc', n: 11 }, 'n'],
    [{ id: 'abc', f: 'x' }, 'f'],
    [{ id: 'abc', b: 'true' }, 'b'],
    [{ id: 'abc', kind: 'c' }, 'kind'],
    [{ id: 'abc', other: 1 }, 'other'],
  ])('rejects %j naming «%s»', (args, name) => {
    expect(() => validateArgs(schema, args)).toThrow(McpToolError)
    expect(() => validateArgs(schema, args)).toThrow(name)
  })
  it('rejects non-objects', () => {
    for (const bad of ['x', 3, [1], true]) expect(() => validateArgs(schema, bad)).toThrow(McpToolError)
  })
})

describe('ids', () => {
  it('normalises short ids and IRIs', () => {
    expect(normalizeCampIri('70ca971c992f')).toBe('/api/camps/70ca971c992f')
    expect(normalizeCampIri('/api/camps/70ca971c992f')).toBe('/api/camps/70ca971c992f')
    expect(normalizeActivityIri('b29d')).toBe('/api/activities/b29d')
    expect(normalizeActivityIri('/api/activities/b29d')).toBe('/api/activities/b29d')
  })
  it('rejects anything else', () => {
    for (const bad of ['', '../x', '/api/camps/a/b', '/api/activities/x', 'a b', 5, null]) expect(() => normalizeCampIri(bad)).toThrow('Ungültige Lager-ID')
    expect(() => normalizeActivityIri('/api/camps/x')).toThrow(McpToolError)
  })
})

describe('sanitize', () => {
  it('resets MiData/NDS adopted fields and removes the provenance', () => {
    const inputs = {
      ...emptyCoachInputs('/api/camps/c1'),
      participantsCount: 20,
      leadersCount: 5,
      minAge: 8,
      ndsRegistered: true,
      notes: 'bleibt',
      midataFields: { participantsCount: '2031-01-01T00:00:00Z', minAge: '2031-01-01T00:00:00Z' },
      ndsFields: { ndsRegistered: '2031-01-01T00:00:00Z' },
    }
    const out = stripRedDerivedInputs(inputs)!
    expect(out.participantsCount).toBeNull()
    expect(out.minAge).toBeNull()
    expect(out.ndsRegistered).toBe(false)
    expect(out.leadersCount).toBe(5)
    expect(out.notes).toBe('bleibt')
    expect(out.midataFields).toBeUndefined()
    expect(out.ndsFields).toBeUndefined()
    expect(inputs.participantsCount).toBe(20)
    expect(stripRedDerivedInputs(null)).toBeNull()
  })
  it('detects red feedback', () => {
    expect(isRedFeedback({ redDerived: true, text: 'x' })).toBe(true)
    expect(isRedFeedback({ text: 'Fehlt (Quelle: NDS, Stand 1.1.)' })).toBe(true)
    expect(isRedFeedback({ text: 'harmlos' })).toBe(false)
  })
})
