import { describe, expect, it } from 'vitest'
import { evaluate } from '../engine'
import { buildExplanation } from '../explain'
import type { Rule, RuleHit, RuleMeta, RulePack } from '@/domain/types'
import { FactsBuilder, makeCoachInputs, makeCtx, makeDoc, makeMidata, makeNds } from './factory'

function meta(over: Partial<RuleMeta> = {}): RuleMeta {
  return {
    id: 'T-RULE-01',
    version: '2.1.0',
    group: 'js',
    title: 'Test',
    description: 'Beschreibung',
    message: 'Tag {day}',
    severity: 'must',
    confidence: 'verified',
    scope: 'day',
    source: { title: 'J+S', url: 'https://www.jugendundsport.ch/de/lager' },
    validFrom: '2027-01-01',
    ...over,
  }
}
const pack: RulePack = { id: 'p', name: 'Pack X', version: '2026.1', description: '', rules: [] }
const facts = () => new FactsBuilder({ start: '2031-07-12' }).facts
const ctx = (over = {}) => makeCtx(facts(), over)
const hit = (over: Partial<RuleHit> = {}): RuleHit => ({ targets: ['a'], ...over })
const run = (m: RuleMeta, h: RuleHit, c = ctx()) => {
  const rule: Rule = { meta: m, check: () => [h] }
  return evaluate([{ ...pack, rules: [rule] }], c)[0]
}

describe('buildExplanation', () => {
  it('carries pack, rule version, validity and evaluation dates', () => {
    const f = run(meta(), hit())
    expect(f.explain).toMatchObject({
      packId: 'p',
      packName: 'Pack X',
      packVersion: '2026.1',
      ruleVersion: '2.1.0',
      validFrom: '2027-01-01',
      validTo: null,
      evaluatedFor: '2031-07-12',
      evaluatedAt: '2031-01-01T12:00:00.000Z',
      baseSeverity: 'must',
    })
  })

  it('reports used and missing inputs', () => {
    const m = meta({ inputs: ['mapping', 'coachInputs', 'documents', 'settings'] })
    const none = run(m, hit(), ctx({ mapping: null })).explain!
    expect(none.inputs).toEqual([
      { key: 'mapping', state: 'missing' },
      { key: 'coachInputs', state: 'missing' },
      { key: 'documents', state: 'missing' },
      { key: 'settings', state: 'used' },
    ])
    const all = run(m, hit(), ctx({ coachInputs: makeCoachInputs(), documents: [makeDoc(), makeDoc({ id: 'd2' })] })).explain!
    expect(all.inputs).toEqual([
      { key: 'mapping', state: 'used', detail: 'bestätigt' },
      { key: 'coachInputs', state: 'used' },
      { key: 'documents', state: 'used', detail: '2 Dokumente' },
      { key: 'settings', state: 'used' },
    ])
  })

  it('detects midata / nds by rule tag and by redKeys', () => {
    const md = makeMidata({ fetchedAt: '2031-05-01T08:00:00.000Z' })
    const tagged = run(meta({ tags: ['midata'] }), hit(), ctx({ midata: md })).explain!
    expect(tagged.inputs).toEqual([{ key: 'midata', state: 'used', detail: 'Stand MiData 01.05.2031' }])
    const missing = run(meta({ tags: ['nds'] }), hit(), ctx()).explain!
    expect(missing.inputs).toEqual([{ key: 'nds', state: 'missing' }])
    const byKeys = run(meta(), hit({ inputs: { n: 3 }, redKeys: ['n'] }), ctx({ nds: makeNds() })).explain!
    expect(byKeys.inputs.map((i) => i.key)).toEqual(['nds'])
    const none = run(meta(), hit({ inputs: { n: 3 } }), ctx({ midata: md })).explain!
    expect(none.inputs).toEqual([])
  })

  it('orders facts inputs-first, dedupes by key and drops _ params', () => {
    const f = run(meta(), hit({ inputs: { b: 1, a: 'x' }, params: { a: 'p', c: 2, _message: 'm' } })).explain!
    expect(f.facts).toEqual([
      { key: 'b', value: 1 },
      { key: 'a', value: 'x' },
      { key: 'c', value: 2 },
    ])
  })

  it('marks red facts and tags the finding', () => {
    const f = run(meta(), hit({ inputs: { n: 5, m: 1 }, redKeys: ['n'] }), ctx({ midata: makeMidata() }))
    expect(f.explain!.facts).toEqual([
      { key: 'n', value: 5, red: true },
      { key: 'm', value: 1 },
    ])
    expect(f.tags).toContain('midata')
    expect(f.tags).not.toContain('nds-quelle')
    const g = run(meta(), hit({ inputs: { n: 5 }, redKeys: ['n'], evidence: [{ kind: 'camp', label: 'x (Quelle: NDS, Stand 01.05.2031)' }] }), ctx({ nds: makeNds(), midata: makeMidata() }))
    expect(g.tags).toContain('nds-quelle')
    expect(g.tags).not.toContain('midata')
  })

  it('derives severityReason in all three cases', () => {
    expect(run(meta(), hit()).explain!.severityReason).toBe('rule')
    const down = run(meta(), hit({ severity: 'hint' }))
    expect(down.severity).toBe('hint')
    expect(down.explain!.severityReason).toBe('hit-downgrade')
    const clamp = run(meta({ confidence: 'unverified' }), hit())
    expect(clamp.severity).toBe('should')
    expect(clamp.explain!.severityReason).toBe('confidence-clamp')
    expect(clamp.explain!.baseSeverity).toBe('must')
  })

  it('is pure and leaves AI findings without explain', () => {
    const m = meta()
    const e = buildExplanation(m, null, hit(), ctx(), '2031-07-12', 'must')
    expect(e.packId).toBeNull()
    const ai = { id: 'AI-1', origin: 'ai' } as { explain?: unknown }
    expect(ai.explain).toBeUndefined()
  })
})
