import { describe, expect, it, vi } from 'vitest'
import { countFindings, evaluate, findingId, isValidOn, validateRuleMeta } from '../engine'
import type { Rule, RuleMeta, RulePack } from '@/domain/types'
import { FactsBuilder, makeCtx } from './factory'

function meta(over: Partial<RuleMeta> = {}): RuleMeta {
  return {
    id: 'T-RULE-01',
    version: '1.0.0',
    module: 'js',
    group: 'js',
    status: 'active',
    kind: 'hard',
    sources: [{ key: 'WEB-L', page: '' }],
    title: 'Test',
    description: 'Beschreibung',
    message: 'Tag {day}: {text}',
    severity: 'must',
    confidence: 'verified',
    scope: 'day',
    source: { title: 'J+S', url: 'https://www.jugendundsport.ch/de/lager' },
    ...over,
  }
}

const pack = (rules: Rule[], over: Partial<RulePack> = {}): RulePack => ({
  id: 'p',
  name: 'P',
  version: '1',
  description: '',
  rules,
  ...over,
})

const ctx = () => makeCtx(new FactsBuilder({ start: '2031-07-12' }).facts)

describe('isValidOn', () => {
  it('handles open ends and bounds', () => {
    expect(isValidOn({}, '2030-01-01')).toBe(true)
    expect(isValidOn({ validFrom: '2027-01-01' }, '2026-12-31')).toBe(false)
    expect(isValidOn({ validFrom: '2027-01-01' }, '2027-01-01')).toBe(true)
    expect(isValidOn({ validTo: '2026-12-31' }, '2027-01-01')).toBe(false)
    expect(isValidOn({ validTo: '2026-12-31' }, '2026-12-31')).toBe(true)
  })
})

describe('validateRuleMeta', () => {
  it('accepts a valid meta', () => expect(validateRuleMeta(meta())).toEqual([]))
  it('rejects unverified/conflict + must', () => {
    expect(validateRuleMeta(meta({ confidence: 'unverified' })).join()).toMatch(/must/)
    expect(validateRuleMeta(meta({ confidence: 'conflict' })).join()).toMatch(/must/)
    expect(validateRuleMeta(meta({ confidence: 'unverified', severity: 'should' }))).toEqual([])
  })
  it('requires a source and valid dates', () => {
    expect(validateRuleMeta(meta({ sources: [] })).length).toBeGreaterThan(0)
    expect(validateRuleMeta(meta({ validFrom: '1.1.2026' })).length).toBeGreaterThan(0)
  })
})

describe('evaluate', () => {
  it('builds findings with ids, filled message and source', () => {
    const rule: Rule = { meta: meta(), check: () => [{ targets: ['/api/days/d1'], params: { day: 1, text: 'x' } }] }
    const [f] = evaluate([pack([rule])], ctx())
    expect(f.id).toBe(findingId('T-RULE-01', ['/api/days/d1']))
    expect(f.message).toBe('Tag 1: x')
    expect(f.packId).toBe('p')
    expect(f.origin).toBe('rule')
    expect(f.source?.url).toContain('jugendundsport')
    expect(f.override).toBeNull()
  })

  it('clamps must to should for unverified/conflict rules and honours hit downgrade only', () => {
    const bad: Rule = { meta: meta({ id: 'T-BAD-01', confidence: 'unverified' }), check: () => [{ targets: ['a'] }] }
    const down: Rule = { meta: meta({ id: 'T-DOWN-01' }), check: () => [{ targets: ['a'], severity: 'hint' }] }
    const up: Rule = { meta: meta({ id: 'T-UP-01', severity: 'hint' }), check: () => [{ targets: ['a'], severity: 'must' }] }
    const res = evaluate([pack([bad, down, up])], ctx())
    const sev = Object.fromEntries(res.map((f) => [f.ruleId, f.severity]))
    expect(sev).toEqual({ 'T-BAD-01': 'should', 'T-DOWN-01': 'hint', 'T-UP-01': 'hint' })
  })

  it('filters rules and packs by camp start date', () => {
    const future: Rule = { meta: meta({ id: 'T-FUT-01', validFrom: '2032-01-01' }), check: () => [{ targets: ['a'] }] }
    const past: Rule = { meta: meta({ id: 'T-PAST-01', validTo: '2030-12-31' }), check: () => [{ targets: ['a'] }] }
    const ok: Rule = { meta: meta({ id: 'T-OK-01', validFrom: '2031-01-01', validTo: '2031-12-31' }), check: () => [{ targets: ['a'] }] }
    expect(evaluate([pack([future, past, ok])], ctx()).map((f) => f.ruleId)).toEqual(['T-OK-01'])
    expect(evaluate([pack([ok], { validFrom: '2040-01-01' })], ctx())).toEqual([])
  })

  it('falls back to now when the camp has no dates', () => {
    const facts = new FactsBuilder({ days: 0 }).facts
    const r: Rule = { meta: meta({ validFrom: '2031-01-01' }), check: () => [{ targets: ['a'] }] }
    expect(evaluate([pack([r])], makeCtx(facts, { now: new Date('2031-06-01T00:00:00Z') }))).toHaveLength(1)
    expect(evaluate([pack([r])], makeCtx(facts, { now: new Date('2030-06-01T00:00:00Z') }))).toHaveLength(0)
  })

  it('applies overrides and keeps overridden findings', () => {
    const rule: Rule = { meta: meta(), check: () => [{ targets: ['x'] }, { targets: ['y'] }] }
    const override = { id: 'o1', campIri: 'c', findingId: findingId('T-RULE-01', ['x']), ruleId: 'T-RULE-01', reason: 'ok', createdAt: '' }
    const res = evaluate([pack([rule])], { ...ctx(), overrides: [override] })
    expect(res).toHaveLength(2)
    expect(res.find((f) => f.targets[0] === 'x')?.override?.reason).toBe('ok')
    expect(countFindings(res)).toEqual({ must: 1, should: 0, hint: 0, overridden: 1 })
  })

  it('skips a throwing predicate and drops duplicate ids', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom: Rule = { meta: meta({ id: 'T-BOOM-01' }), check: () => { throw new Error('x') } }
    const dup: Rule = { meta: meta({ id: 'T-DUP-01' }), check: () => [{ targets: ['a'] }, { targets: ['a'] }] }
    const res = evaluate([pack([boom, dup])], ctx())
    spy.mockRestore()
    expect(res.map((f) => f.ruleId)).toEqual(['T-DUP-01'])
  })

  it('orders deterministically: severity, rule id, id', () => {
    const mk = (id: string, severity: RuleMeta['severity'], targets: string[]): Rule => ({
      meta: meta({ id, severity }),
      check: () => targets.map((t) => ({ targets: [t] })),
    })
    const res = evaluate([pack([mk('T-B-01', 'hint', ['z']), mk('T-A-01', 'should', ['b', 'a']), mk('T-C-01', 'must', ['q'])])], ctx())
    expect(res.map((f) => f.id)).toEqual(['T-C-01:q', 'T-A-01:a', 'T-A-01:b', 'T-B-01:z'])
  })

  it('supports a per-hit message template via params._message', () => {
    const r: Rule = { meta: meta(), check: () => [{ targets: ['a'], params: { _message: 'Spezial {n}', n: 3 } }] }
    expect(evaluate([pack([r])], ctx())[0].message).toBe('Spezial 3')
  })
})
