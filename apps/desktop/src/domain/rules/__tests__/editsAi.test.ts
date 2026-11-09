import { describe, expect, it } from 'vitest'
import { loadBundledPacks } from '../packs'
import { knownSourceKeys } from '../editsStore'
import { buildRuleUpdateRequest, excerptOf, extractJsonObject, parseRuleUpdate, ruleToPromptText } from '../../zones/ruleUpdate'
import { assertSendable, MAX_PROMPT_CHARS } from '../../zones/aiGateway'
import type { ResourceRecord } from '../../types'

const rules = loadBundledPacks().flatMap((p) => p.rules)
const should = rules.find((r) => r.meta.severity === 'should')!.meta
const known = knownSourceKeys()
const res = (key: string, content: string): ResourceRecord =>
  ({ key, title: `Titel ${key}`, edition: '2027', url: null, weight: 'binding', pageConvention: 'section', partlyRead: [], origin: 'bundled', modified: false, updatedAt: 'x', updatedBy: 'manual', content }) as ResourceRecord

describe('extractJsonObject', () => {
  it('finds the object in fences and prose, handles braces in strings', () => {
    expect(extractJsonObject('Hier:\n```json\n{"patch":{"title":"a {x} b"},"reason":"r"}\n```\nEnde')).toEqual({ patch: { title: 'a {x} b' }, reason: 'r' })
    expect(extractJsonObject('nichts')).toBeNull()
  })
})

describe('parseRuleUpdate', () => {
  it('accepts a valid proposal and reduces it to differences', () => {
    const text = JSON.stringify({ patch: { title: 'Neu', severity: should.severity }, reason: 'Handbuch S. 3', resourceKeys: ['A', 'X'] })
    const p = parseRuleUpdate(text, should, known, ['A'])
    expect(p.errors).toEqual([])
    expect(p.patch).toEqual({ title: 'Neu' })
    expect(p.result!.title).toBe('Neu')
    expect(p.resourceKeys).toEqual(['A'])
  })
  it('refuses must / verified from the AI, unknown sources, non-JSON', () => {
    expect(parseRuleUpdate('{"patch":{"severity":"must"}}', should, known).errors.join()).toMatch(/nicht auf «muss»/)
    expect(parseRuleUpdate('{"patch":{"confidence":"verified"}}', should, known).errors.join()).toMatch(/nicht auf «geprüft»/)
    expect(parseRuleUpdate('{"patch":{"sources":[{"key":"ZZZ","page":""}]}}', should, known).errors.join()).toMatch(/ZZZ/)
    expect(parseRuleUpdate('Keine Ahnung', should, known).errors[0]).toMatch(/JSON/)
    expect(parseRuleUpdate('{"reason":"x"}', should, known).errors[0]).toMatch(/patch/)
  })
  it('empty patch = no change', () => {
    const p = parseRuleUpdate('{"patch":{},"reason":"passt","resourceKeys":[]}', should, known)
    expect(p.errors).toEqual([])
    expect(p.patch).toEqual({})
  })
})

describe('buildRuleUpdateRequest', () => {
  it('is green only, unconfirmed, contains rule and excerpts, stays sendable once confirmed', () => {
    const { request, usedKeys, previewText } = buildRuleUpdateRequest(should, [res('A', 'Erster Absatz.\n\nZweiter Absatz zu ' + should.title), res('B', '')])
    expect(usedKeys).toEqual(['A'])
    expect(request.feature).toBe('ruleUpdate')
    expect(request.confirmed).toBe(false)
    expect([request.system, ...request.parts].every((p) => p.zone === 'green')).toBe(true)
    expect(previewText).toContain(`id: ${should.id}`)
    expect(previewText).toContain('Hilfsmittel A')
    expect(() => assertSendable({ ...request, confirmed: true })).not.toThrow()
  })
  it('needs a resource with text and truncates long contents under the limit', () => {
    expect(() => buildRuleUpdateRequest(should, [res('B', ' ')])).toThrow(/Hilfsmittel/)
    const big = Array.from({ length: 400 }, (_, i) => `Absatz ${i} ${should.title} Text`).join('\n\n')
    const { request } = buildRuleUpdateRequest(should, [res('A', big), res('B', big), res('C', big)])
    const size = request.system.value.length + request.parts.reduce((n, p) => n + p.value.length, 0)
    expect(size).toBeLessThan(MAX_PROMPT_CHARS)
  })
  it('excerptOf prefers paragraphs matching the rule', () => {
    const text = `${'Füllstoff '.repeat(200)}\n\nHier steht etwas über ${should.title.split(' ')[0]} und anderes\n\n${'Mehr Füllstoff '.repeat(200)}`
    expect(excerptOf(text, should, 300).length).toBeLessThanOrEqual(1300)
    expect(ruleToPromptText(should)).toContain('sources:')
  })
})
