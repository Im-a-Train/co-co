/** Engine v2 behaviour (catalog §3.6): modules, retired rules, variants, fragments, confidence, formerIds, paramNotes. */
import { describe, expect, it } from 'vitest'
import { evaluate, hitOutcome } from '../engine'
import type { Rule, RuleHit, RuleMeta, RulePack } from '@/domain/types'
import { normalizeCampRuleConfig } from '../lib/campRuleConfig'
import { FactsBuilder, makeCtx } from './factory'

function meta(over: Partial<RuleMeta> = {}): RuleMeta {
  return {
    id: 'T-RULE-01',
    version: '1.0.0',
    module: 'lst-wasser',
    group: 'lst-wasser',
    status: 'active',
    kind: 'hard',
    title: 'Test',
    description: 'Beschreibung',
    message: 'Standard {n}',
    messageVariants: { special: 'Spezial {n}', a: 'A={x}', b: 'B={x}', partsJoin: ' + ' },
    severity: 'must',
    confidence: 'verified',
    scope: 'camp',
    sources: [{ key: 'MB-UP', page: 'S. 5' }],
    source: { title: '', url: '' },
    ...over,
  }
}
const pack = (rules: Rule[]): RulePack => ({ id: 'p', name: 'P', version: '1', description: '', rules })
const run = (m: RuleMeta, hits: RuleHit[], ctx = makeCtx(new FactsBuilder().facts)) => evaluate([pack([{ meta: m, check: () => hits }])], ctx)
const camp = '/api/camps/c1'

describe('engine v2', () => {
  it('skips rules of modules that are off; suggested caps at hint with a module note', () => {
    expect(run(meta(), [{ targets: [camp] }])).toEqual([]) // lst-wasser off without triggers
    const b = new FactsBuilder()
    b.activity('Baden im See', null)
    const [f] = run(meta(), [{ targets: [camp] }], makeCtx(b.facts))
    expect(f).toMatchObject({ severity: 'hint', module: 'lst-wasser' })
    expect(f.moduleNote).toMatchObject({ key: 'rules.module.suggestedNote', params: { module: 'lst-wasser', set: 'WATER' } })
    expect(f.explain?.severityReason).toBe('module-suggested')
    const on = run(meta(), [{ targets: [camp] }], makeCtx(b.facts, { campConfig: { modules: { 'lst-wasser': 'on' } } }))
    expect(on[0]).toMatchObject({ severity: 'must', moduleNote: null })
  })

  it('never evaluates retired rules', () => {
    expect(run(meta({ module: 'js', status: 'retired' }), [{ targets: [camp] }])).toEqual([])
  })

  it('selects messageVariants by hit.variant and renders fragments with a join variant', () => {
    const m = meta({ module: 'js', message: 'Teile: {parts}' })
    expect(run({ ...m, message: 'Standard {n}' }, [{ targets: [camp], variant: 'special', params: { n: 3 } }])[0].message).toBe('Spezial 3')
    const parts = [{ variant: 'a', params: { x: 1 } }, { variant: 'b', params: { x: 2 } }]
    expect(run(m, [{ targets: [camp], fragments: { parts } }])[0].message).toBe('Teile: A=1 + B=2')
  })

  it('hit confidence only lowers; unverified/conflict cap severity at should', () => {
    expect(hitOutcome(meta(), { confidence: 'heuristic' })).toMatchObject({ severity: 'must', confidence: 'heuristic' })
    expect(hitOutcome(meta({ confidence: 'heuristic' }), { confidence: 'verified' }).confidence).toBe('heuristic')
    expect(hitOutcome(meta(), { confidence: 'conflict' })).toMatchObject({ severity: 'should', confidence: 'conflict', reason: 'confidence-clamp' })
    expect(hitOutcome(meta(), { severity: 'hint' }, 'suggested')).toMatchObject({ severity: 'hint' })
  })

  it('resolves sources from the registry and keeps the legacy primary source', () => {
    const [f] = run(meta({ module: 'js' }), [{ targets: [camp] }])
    expect(f.sources?.[0]).toMatchObject({ key: 'MB-UP', page: 'S. 5', weight: 'binding', binding: true })
    expect(f.source?.url).toMatch(/^https:\/\//)
  })

  it('overrides and disabled ids carry over from formerIds', () => {
    const m = meta({ id: 'T-NEW-01', module: 'js', formerIds: ['T-OLD-01'] })
    const ctx = makeCtx(new FactsBuilder().facts, {
      overrides: [{ id: 'o', campIri: camp, findingId: `T-OLD-01:${camp}`, ruleId: 'T-OLD-01', reason: '', createdAt: '' }],
    })
    const [f] = run(m, [{ targets: [camp] }], ctx)
    expect(f.override?.id).toBe('o')
    expect(f.id).toBe(`T-NEW-01:${camp}`)
    expect(f.explain?.formerIds).toEqual(['T-OLD-01'])
    expect(evaluate([pack([{ meta: m, check: () => [{ targets: [camp] }] }])], ctx, { disabledRuleIds: new Set(['T-OLD-01']) })).toEqual([])
  })

  it('reports overridden params as paramNotes', () => {
    const m = meta({ module: 'js', params: ['lst.ropeMinSafetyChars'] })
    const ctx = makeCtx(new FactsBuilder().facts, { campConfig: { params: { 'lst.ropeMinSafetyChars': 120 } } })
    expect(run(m, [{ targets: [camp] }], ctx)[0].paramNotes).toEqual([
      { key: 'lst.ropeMinSafetyChars', label: expect.any(String), value: 120, default: 200 },
    ])
    expect(run(m, [{ targets: [camp] }])[0].paramNotes).toEqual([])
  })
})

describe('campRuleConfig defaults', () => {
  it('normalizes partial / foreign records', () => {
    const c = normalizeCampRuleConfig({ sport: 'other', modules: { pbs: 'off' }, junk: 1 }, camp)
    expect(c).toMatchObject({ campIri: camp, zone: 'green', sport: 'other', modules: { pbs: 'off' }, activityTags: {}, params: {} })
    expect('junk' in c).toBe(false)
    expect(normalizeCampRuleConfig(null, camp).sport).toBeNull()
  })
})
